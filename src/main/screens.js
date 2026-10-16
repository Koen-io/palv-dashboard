// Screens overview: every running dashboard answers on port 47800 with its own status, finds the
// other dashboards on the same network by itself (UDP broadcast) and polls them every 10 seconds.
// Dashboards elsewhere, such as over Tailscale, are added once by address; the other side learns the
// way back from the poll. A browser on any device in the network can open http://<address>:47800/.
// Read-only: there is nothing to change through it, and it answers only private and Tailscale addresses.
const http = require('http');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const log = require('./log');

const PORT = 47800;
const POLL_MS = 10000;
const ANNOUNCE_MS = 30000;
const ONLINE_MS = 35000;   // a screen not heard from for this long is shown as not running
const FORGET_DAYS = 30;    // a found (not added) screen silent for this long is dropped from the list
// A found screen that was only seen briefly (a test, a laptop passing by) is dropped sooner.
const BRIEF_MS = 30 * 60000, BRIEF_GONE_MS = 60 * 60000;
let ephemeral = false;     // a test run: looks at the others, but never joins their lists

let file = null;
let self = { id: null, name: os.hostname() };
let peers = new Map(); // id or address -> peer
let selfStatus = () => ({});
let onChange = () => {};
let server = null, udp = null, port = PORT;
let share = null; // live traffic between the screens (share.js): its two routes are served here
let routes = {}; // more routes for the other screens (Zoek & Plan): path -> (req, res, caller, respond)


const isPrivate = (addr) => {
  const a = String(addr || '').replace(/^::ffff:/, '');
  if (a === '::1' || /^127\./.test(a)) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = /^172\.(\d+)\./.exec(a);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  const t = /^100\.(\d+)\./.exec(a); // Tailscale and other carrier-grade NAT: 100.64.0.0/10
  if (t && +t[1] >= 64 && +t[1] <= 127) return true;
  return /^f[cd][0-9a-f]{2}:/i.test(a) || /^fe80:/i.test(a);
};
const clean = (addr) => String(addr || '').replace(/^::ffff:/, '');

function load(userData) {
  file = path.join(userData, 'screens.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first start */ }
  self.id = data.id || crypto.randomUUID();
  if (data.name) self.name = data.name;
  peers = new Map();
  for (const p of data.peers || []) if (p && p.address) peers.set(key(p), { ...p, status: null, online: false, error: null });
  save();
}

const key = (p) => p.id || `${p.address}:${p.port || PORT}`;

function save() {
  try {
    fs.writeFileSync(file, JSON.stringify({
      id: self.id,
      name: self.name,
      peers: [...peers.values()].map(({ id, name, address, port: pp, manual, lastSeen, firstSeen }) => ({ id, name, address, port: pp, manual, lastSeen, firstSeen })),
    }, null, 2), 'utf8');
  } catch (err) { log.warn('screens', 'opslaan mislukt', err.message); }
}

// A peer heard of: by its own announcement, by calling us, or added by hand.
function meet({ id, name, address, port: pp, manual }) {
  if (!address || (id && id === self.id)) return null;
  pp = +pp || PORT;
  let p = id ? peers.get(id) : null;
  if (!p) p = [...peers.values()].find((x) => x.address === address && (x.port || PORT) === pp) || null;
  if (p && id && p.id !== id) { peers.delete(key(p)); p.id = id; }
  if (!p) {
    p = { id: id || null, name: name || address, address, port: pp, manual: !!manual, firstSeen: Date.now(), lastSeen: 0, status: null, online: false };
    log.info('screens', `scherm gevonden: ${p.name} (${address}:${pp})`);
  }
  p.address = address;
  p.port = pp;
  if (name) p.name = name;
  if (manual) p.manual = true;
  peers.set(key(p), p);
  save();
  return p;
}

async function poll(p) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  const wasOnline = p.online;
  try {
    const host = p.address.includes(':') ? `[${p.address}]` : p.address;
    const res = await fetch(`http://${host}:${p.port || PORT}/api/status`, {
      signal: ctl.signal,
      headers: { 'X-Palv-Screen': JSON.stringify({ id: self.id, name: self.name, port, ephemeral }) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const s = await res.json();
    if (s.id === self.id) { peers.delete(key(p)); save(); return; } // that address is this screen itself
    if (s.id && p.id !== s.id) { peers.delete(key(p)); p.id = s.id; peers.set(key(p), p); }
    // A test run of the dashboard is not a screen of its own.
    if (s.ephemeral && !p.manual) { peers.delete(key(p)); save(); return; }
    p.status = s;
    p.name = s.name || p.name;
    p.lastSeen = Date.now();
    p.online = true;
    p.error = null;
    p.latency = Date.now() - s.now; // includes clock difference; only a rough indication
  } catch (err) {
    p.error = err.name === 'AbortError' ? 'geen antwoord' : String(err.cause && err.cause.code || err.message || err);
    p.online = !!p.lastSeen && Date.now() - p.lastSeen < ONLINE_MS;
  } finally {
    clearTimeout(t);
  }
  if (wasOnline !== p.online) {
    (p.online ? log.info : log.warn)('screens', `${p.name} (${p.address}) ${p.online ? 'draait weer' : 'niet meer bereikbaar: ' + p.error}`);
    save();
  }
}

async function pollAll() {
  const now = Date.now();
  for (const [k, p] of peers) {
    if (!p.manual && p.lastSeen && now - p.lastSeen > FORGET_DAYS * 864e5) peers.delete(k);
    else if (!p.manual && p.lastSeen && now - p.lastSeen > BRIEF_GONE_MS && p.lastSeen - (p.firstSeen || p.lastSeen) < BRIEF_MS) peers.delete(k);
  }
  await Promise.all([...peers.values()].map(poll));
  onChange(list());
}

function list() {
  const me = { ...selfStatus(), self: true, online: true, address: addresses()[0] || '127.0.0.1', port };
  return [me, ...[...peers.values()].map((p) => ({
    ...(p.status || {}),
    id: p.id, name: p.name, address: p.address, port: p.port || PORT, manual: !!p.manual,
    online: p.online, lastSeen: p.lastSeen, error: p.error, self: false,
  }))];
}

function addresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      out.push({ name, address: a.address, tailscale: /^100\./.test(a.address) || /tailscale/i.test(name) });
    }
  }
  // Tailscale first: reachable from everywhere, also from a phone on the road.
  return out.sort((a, b) => b.tailscale - a.tailscale).map((a) => a.address);
}

/* ---------- HTTP ---------- */
function respond(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function handle(req, res) {
  const from = clean(req.socket.remoteAddress);
  if (!isPrivate(from)) { res.destroy(); return; }
  if (req.method !== 'GET') return respond(res, 405, 'text/plain', 'Alleen lezen');
  // A dashboard that polls us is a peer as well: that is how the way back is learned.
  const hdr = req.headers['x-palv-screen'];
  let caller = null;
  if (hdr) {
    try {
      const p = JSON.parse(hdr);
      if (p && typeof p.id === 'string' && p.id.length < 80 && !p.ephemeral) {
        const known = peers.get(p.id);
        meet({ id: p.id, name: String(p.name || '').slice(0, 60), address: from, port: +p.port || PORT });
        caller = { id: p.id, name: String(p.name || '').slice(0, 60) || from };
        if (!known) setTimeout(pollAll, 500);
      }
    } catch { /* ignore a malformed header */ }
  }
  const url = (req.url || '/').split('?')[0];
  if (share && url === share.STREAM) return share.handleStream(req, res, caller);
  if (share && url === share.WANT) return respond(res, share.handleWant(req, caller) ? 200 : 409, 'text/plain; charset=utf-8', '');
  if (routes[url]) return routes[url](req, res, caller, respond);
  if (url === '/api/status') return respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(selfStatus()));
  if (url === '/api/screens') return respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(list()));
  if (url === '/' || url === '/index.html') return respond(res, 200, 'text/html; charset=utf-8', page());
  if (url === '/logo.png') {
    try { return respond(res, 200, 'image/png', fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'logo.png'))); } catch { /* fall through */ }
  }
  respond(res, 404, 'text/plain', 'Niet gevonden');
}

function listen(p) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handle);
    s.once('error', reject);
    s.listen(p, '0.0.0.0', () => resolve(s));
  });
}

/* ---------- UDP discovery ---------- */
function announce() {
  if (!udp || ephemeral) return;
  const msg = Buffer.from(JSON.stringify({ palv: 1, id: self.id, name: self.name, port }));
  const targets = new Set(['255.255.255.255']);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || !a.netmask) continue;
      const ip = a.address.split('.').map(Number), mask = a.netmask.split('.').map(Number);
      targets.add(ip.map((n, i) => (n & mask[i]) | (~mask[i] & 255)).join('.'));
    }
  }
  for (const t of targets) udp.send(msg, PORT, t, () => {});
}

function startUdp() {
  udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  udp.on('error', (err) => { log.warn('screens', 'zoeken op het netwerk niet mogelijk', err.message); try { udp.close(); } catch { /* closed */ } udp = null; });
  udp.on('message', (buf, rinfo) => {
    if (!isPrivate(rinfo.address)) return;
    try {
      const m = JSON.parse(buf.toString('utf8'));
      if (m.palv !== 1 || !m.id || m.id === self.id) return;
      const known = peers.get(m.id);
      meet({ id: String(m.id).slice(0, 80), name: String(m.name || '').slice(0, 60), address: rinfo.address, port: +m.port || PORT });
      if (!known) { announce(); setTimeout(pollAll, 300); }
    } catch { /* not ours */ }
  });
  udp.bind(PORT, () => {
    try { udp.setBroadcast(true); } catch { /* no broadcast on this network */ }
    announce();
  });
}

async function start({ userData, status, onUpdate, test, share: sh, routes: extra }) {
  ephemeral = !!test;
  share = sh || null;
  routes = extra || {};
  load(userData);
  selfStatus = () => ({ ...status(), id: self.id, name: self.name, port, ephemeral });
  onChange = onUpdate || (() => {});

  for (let p = PORT; p < PORT + 5; p += 1) {
    try { server = await listen(p); port = p; break; } catch (err) { log.warn('screens', `poort ${p} bezet`, err.code); }
  }
  if (server) log.info('screens', `statuspagina op http://${addresses()[0] || 'localhost'}:${port}/`);
  else log.error('screens', 'statusserver kon niet starten');
  startUdp();
  setInterval(announce, ANNOUNCE_MS);
  setInterval(pollAll, POLL_MS);
  setTimeout(pollAll, 1500);
}

function rename(name) {
  self.name = String(name || '').trim().slice(0, 40) || os.hostname();
  save();
  announce();
  return self.name;
}

function add(address) {
  const m = /^\s*\[?([^\]\s]+?)\]?(?::(\d+))?\s*$/.exec(String(address || ''));
  if (!m) throw new Error('Ongeldig adres');
  const p = meet({ address: m[1], port: m[2] ? +m[2] : PORT, manual: true });
  if (!p) throw new Error('Dat is dit scherm zelf');
  poll(p).then(() => onChange(list()));
  return list();
}

function remove(id) {
  for (const [k, p] of peers) if (p.id === id || `${p.address}:${p.port || PORT}` === id) peers.delete(k);
  save();
  onChange(list());
  return list();
}

/* ---------- the status page for a browser ---------- */
function page() {
  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>P-ALV Schermen</title>
<style>
:root{--bg:#080e18;--card:#101a2b;--line:#23344f;--text:#e9eff8;--muted:#8ea2bf;--amber:#f59a00;--green:#3ecf6e;--red:#ff5148}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 "Segoe UI",system-ui,-apple-system,sans-serif}
header{display:flex;align-items:center;gap:14px;padding:18px 20px;background:linear-gradient(180deg,#0f1a2c,#0a1220);border-bottom:2px solid var(--amber)}
header img{width:48px;height:48px}header h1{margin:0;font:700 22px/1 Bahnschrift,"Segoe UI",sans-serif;letter-spacing:.04em}header h1 span{font-weight:300;color:#8fb7e6}
header p{margin:4px 0 0;color:var(--muted);font-size:12px;letter-spacing:.18em}#sum{margin-left:auto;text-align:right;font-weight:700}
main{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));padding:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;border-left:4px solid var(--green)}
.card.warn{border-left-color:var(--amber)}.card.bad{border-left-color:var(--red);opacity:.85}
.top{display:flex;align-items:center;gap:10px}.top b{font-size:17px}.top i{margin-left:auto;font-style:normal;font-size:12px;font-weight:800;letter-spacing:.1em;padding:3px 8px;border-radius:4px;background:var(--green);color:#04130a}
.warn .top i{background:var(--amber);color:#1a1200}.bad .top i{background:var(--red);color:#fff}
dl{display:grid;grid-template-columns:auto 1fr;gap:3px 12px;margin:10px 0 0;font-size:13px}dt{color:var(--muted)}dd{margin:0;font-variant-numeric:tabular-nums}
.issues{margin-top:8px;color:var(--amber);font-size:13px}.bad .issues{color:#ff8a83}
footer{padding:6px 20px 20px;color:var(--muted);font-size:12px}
</style></head><body>
<header><img src="/logo.png" alt=""><div><h1>P-ALV <span>SCHERMEN</span></h1><p>POLICE AIR SUPPORT UNIT</p></div><div id="sum"></div></header>
<main id="list"></main><footer id="foot"></footer>
<script>
const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dur=(ms)=>{const m=Math.floor(ms/60000);return m<60?m+' min':Math.floor(m/60)+' u '+(m%60)+' min'};
const ago=(t)=>{if(!t)return 'nooit';const s=Math.round((Date.now()-t)/1000);return s<60?s+' s geleden':dur(s*1000)+' geleden'};
function judge(s){
  if(!s.online)return['bad','NIET ACTIEF',['Niet bereikbaar'+(s.error?' ('+esc(s.error)+')':'')+', laatst gezien '+ago(s.lastSeen)]];
  const w=[];
  if(!s.renderer||!s.renderer.alive)w.push('Dashboard reageert niet');
  if(s.window&&!s.window.visible)w.push('Venster verborgen');
  if(s.window&&s.window.minimized)w.push('Venster geminimaliseerd');
  if(s.displays===0)w.push('Geen beeldscherm aangesloten');
  if(s.locked)w.push('Computer vergrendeld');
  if(s.health&&s.health.length)w.push('Bronnen zonder verse gegevens: '+s.health.map(esc).join(', '));
  return w.length?['warn','DRAAIT · LET OP',w]:['ok','DRAAIT',[]];
}
async function load(){
  try{
    const list=await (await fetch('/api/screens',{cache:'no-store'})).json();
    let ok=0;
    document.getElementById('list').innerHTML=list.map((s)=>{const [c,l,w]=judge(s);if(c!=='bad')ok++;
      return '<div class="card '+(c==='ok'?'':c)+'"><div class="top"><b>'+esc(s.name)+'</b>'+(s.self?' <small style="color:#8ea2bf">(dit scherm)</small>':'')+'<i>'+l+'</i></div><dl>'
      +'<dt>Adres</dt><dd>'+esc(s.address)+':'+esc(s.port)+'</dd>'
      +(s.version?'<dt>Versie</dt><dd>'+esc(s.version)+(s.update&&s.update.latest&&s.update.latest!==s.version?' → '+esc(s.update.latest):'')+'</dd>':'')
      +(s.platform?'<dt>Systeem</dt><dd>'+esc(s.platform)+(s.hostname?' · '+esc(s.hostname):'')+'</dd>':'')
      +(s.startedAt&&s.online?'<dt>Draait sinds</dt><dd>'+dur(s.now-s.startedAt)+'</dd>':'')
      +(s.window&&s.online?'<dt>Venster</dt><dd>'+(s.window.fullscreen?'volledig scherm':s.window.minimized?'geminimaliseerd':'venster')+(s.page?' · pagina '+esc(s.page):'')+'</dd>':'')
      +(s.online&&s.displays!=null?'<dt>Beeldschermen</dt><dd>'+esc(s.displays)+(s.displayList?' ('+s.displayList.map(esc).join(', ')+')':'')+'</dd>':'')
      +(s.online&&s.renderer?'<dt>Hartslag</dt><dd>'+ago(s.renderer.heartbeat)+(s.renderer.reloads?' · '+esc(s.renderer.reloads)+'× herstart':'')+'</dd>':'')
      +(s.online&&s.share?'<dt>Live verkeer</dt><dd>'+(s.share.leader?'via '+esc(s.share.leader.name):'haalt zelf op'+(s.share.followers&&s.share.followers.length?' · deelt met '+s.share.followers.map(esc).join(', '):''))+'</dd>':'')
      +(s.online?'':'<dt>Laatst gezien</dt><dd>'+ago(s.lastSeen)+'</dd>')
      +'</dl>'+(w.length?'<div class="issues">'+w.join('<br>')+'</div>':'')+'</div>';}).join('');
    document.getElementById('sum').innerHTML='<span style="color:'+(ok===list.length?'#3ecf6e':'#ff5148')+'">'+ok+' van '+list.length+'</span><br><small style="color:#8ea2bf;font-weight:400">schermen actief</small>';
    document.getElementById('foot').textContent='Bijgewerkt '+new Date().toLocaleTimeString('nl-NL')+' · ververst elke 5 seconden · alleen-lezen';
  }catch(e){document.getElementById('foot').textContent='Geen verbinding met dit scherm: '+e.message}
}
load();setInterval(load,5000);
</script></body></html>`;
}

// The other screens as last polled, for choosing who fetches the live traffic (share.js).
const peerList = () => [...peers.values()].map((p) => ({ id: p.id, name: p.name, address: p.address, port: p.port || PORT, online: p.online, status: p.status }));

module.exports = { start, list, rename, add, remove, addresses, isPrivate, pollAll, peers: peerList, id: () => self.id, name: () => self.name, port: () => port, PORT };
