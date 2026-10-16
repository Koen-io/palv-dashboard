// Live traffic shared between the dashboards: one of them asks the sources, the others receive every
// change from it the moment it comes in. With 1 or 10 screens the sources are asked equally often, so
// none of them starts refusing or blocking because several screens share one internet connection.
//
// Who fetches is chosen by the screens themselves, from what they tell each other in their status
// (screens.js), without anything to set:
// - the screen whose adsb.fi works best (score 2: adsb.fi answers; 1: only adsb.lol or nothing known;
//   0: no ADS-B source at all) fetches;
// - with equal scores the screen that already fetches stays, and otherwise the one with the lowest id;
// - a change of fetcher only goes through when it holds for a few seconds, so a single hiccup never
//   makes the screens flip back and forth;
// - a screen that follows never passes the traffic on, so there are no chains or circles.
//
// The link: the follower opens one HTTP request to the fetcher (GET /api/traffic/stream on the status
// port) that stays open. The fetcher writes one line of JSON per round to it, with only the aircraft
// that changed since the line before; on a local network that adds a few milliseconds at most. A line
// comes at least every second, also when nothing changed. When the link breaks or stays silent for
// 2.5 seconds, the follower fetches by itself straight away: the aircraft it has stay on the map, and the
// next round from the sources follows within about a second.
const http = require('http');

const PROTO = 1;
const STREAM = '/api/traffic/stream';
const WANT = '/api/traffic/want';
const SILENT_MS = 2500;      // no line for this long: the link is gone
const CONNECT_MS = 3000;     // no answer to the link request within this time: give up
const HEARTBEAT_MS = 1000;   // the fetcher writes at least this often
const HOLD_MS = 5000;        // a new choice of fetcher must hold this long
const RETRY_MS = [5000, 10000, 20000, 40000, 60000];
const PROBE_MS = 10 * 60000; // a follower checks every 10 minutes whether adsb.fi answers it
const PROBE_VALID_MS = 15 * 60000;
const FRESH_MS = 15000;      // a fetcher whose adsb.fi answered within this time scores 2
const MAX_BUFFER = 4e6;      // a follower that cannot keep up is cut off rather than kept in memory
const WANT_MS = 4000;

let traffic = null, self = () => ({}), peers = () => [], log = { info() {}, warn() {} };
let enabled = false, httpLib = http;
let role = 'lead';           // 'lead': fetches by itself (also when alone); 'follow': receives
const streams = new Set();   // followers of this screen: { id, name, res, rev }
let link = null;             // the link to the fetcher this screen follows, or is setting up
let pending = null;          // { id, since }: a change of fetcher waiting to hold
const retry = new Map();     // screen id -> { at, n }: when that fetcher may be tried again
let probe = { at: 0, ok: false, tried: 0 };
let timer = null, lastBroadcast = 0;

/* ---------- choosing who fetches ---------- */

// This screen's own score: as fetcher from its own rounds, as follower from the last probe.
function score(now = Date.now()) {
  if (role === 'lead') {
    const st = traffic.feedStatus(now);
    if (st.fiAt && now - st.fiAt < FRESH_MS) return 2;
    if (st.adsbAt && now - st.adsbAt < FRESH_MS) return 1;
    // Just started and not asked anything yet: no worse than an unknown follower.
    return now - startedAt < 20000 ? 1 : 0;
  }
  return probe.ok && now - probe.at < PROBE_VALID_MS ? 2 : 1;
}
let startedAt = Date.now();

// Best first: highest score, then the one already fetching, then the lowest id. Pure, for the tests.
function rank(list) {
  return [...list].sort((a, b) => b.score - a.score || (b.leading ? 1 : 0) - (a.leading ? 1 : 0) || String(a.id).localeCompare(String(b.id)));
}

// The other screens that can share: running, of this protocol, no test windows, not waiting to retry.
function candidates(now) {
  const out = [];
  for (const p of peers()) {
    const sh = p.online && p.status && !p.status.ephemeral && p.status.share;
    if (!sh || sh.v !== PROTO || !p.id) continue;
    let sc = +sh.score || 0, leading = sh.role === 'lead';
    // The fetcher this screen follows tells its score in every line: that is newer than its status.
    if (link && link.live && link.id === p.id) { sc = link.score; leading = true; }
    out.push({ id: p.id, name: p.status.name || p.name, address: p.address, port: p.port, score: sc, leading, retryAt: (retry.get(p.id) || {}).at || 0 });
  }
  return out;
}

// Which screen this one should get its traffic from: its own id (fetch itself) or that of a fetcher.
function choose(now = Date.now()) {
  const me = { id: self().id, score: score(now), leading: role === 'lead' };
  const others = candidates(now);
  const best = rank([me, ...others])[0];
  if (best.id === me.id) return { id: me.id };
  // Only a screen that fetches itself can be followed; one that is about to start will say so soon.
  if (best.leading && best.retryAt <= now) return { id: best.id, peer: best };
  if (link && link.live) return { id: link.id, peer: others.find((o) => o.id === link.id) || link.peer };
  return { id: me.id };
}

function evaluate() {
  if (!enabled) return;
  const now = Date.now();
  const want = choose(now);
  const current = link ? link.id : self().id;
  if (want.id === current) { pending = null; return; }
  // A first link while fetching alone, or a better fetcher: only when the choice holds.
  if (!pending || pending.id !== want.id) { pending = { id: want.id, since: now }; return; }
  if (now - pending.since < HOLD_MS) return;
  pending = null;
  if (want.id === self().id) drop('dit scherm haalt zelf het best op');
  else connect(want.peer);
}

/* ---------- following: the link to the fetcher ---------- */

function connect(peer) {
  if (!peer || !peer.address) return;
  // While the new link is set up this screen fetches by itself, so the map never stands still.
  if (link) drop(null);
  const me = self();
  const l = { id: peer.id, name: peer.name || peer.address, peer, live: false, lastLine: Date.now(), score: peer.score, buf: '', req: null, closed: false };
  link = l;
  const host = peer.address.replace(/^\[|\]$/g, '');
  const req = httpLib.get({
    host, port: peer.port, path: STREAM, agent: false,
    headers: {
      'X-Palv-Screen': JSON.stringify({ id: me.id, name: me.name, port: me.port }),
      'X-Palv-Want': JSON.stringify(traffic.ownWant()),
    },
  });
  l.req = req;
  const connectTimer = setTimeout(() => fail(l, 'geen antwoord'), CONNECT_MS);
  req.on('socket', (sock) => { sock.setNoDelay(true); sock.setKeepAlive(true, 5000); });
  req.on('response', (res) => {
    clearTimeout(connectTimer);
    if (res.statusCode !== 200) { res.resume(); return fail(l, `HTTP ${res.statusCode}`); }
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      if (l.closed) return;
      l.buf += chunk;
      let i;
      while ((i = l.buf.indexOf('\n')) >= 0) {
        const line = l.buf.slice(0, i);
        l.buf = l.buf.slice(i + 1);
        if (line) onLine(l, line);
      }
      if (l.buf.length > MAX_BUFFER) fail(l, 'te grote regel');
    });
    res.on('end', () => fail(l, 'verbinding gesloten'));
    res.on('error', (err) => fail(l, err.message));
  });
  req.on('error', (err) => { clearTimeout(connectTimer); fail(l, (err && (err.code || err.message)) || 'fout'); });
}

function onLine(l, line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(l, 'onleesbaar bericht'); }
  l.lastLine = Date.now();
  if (msg.lead && Number.isFinite(msg.lead.score)) l.score = msg.lead.score;
  if (msg.t === 'bye') {
    // The fetcher hands over to another screen: straight there when this one knows it.
    const next = msg.next && candidates(Date.now()).find((c) => c.id === msg.next);
    fail(l, 'overgedragen', { quiet: true });
    if (next) connect({ ...next, leading: true });
    return;
  }
  if (msg.t !== 'r') return; // a heartbeat: only the time counts
  if (!l.live) {
    l.live = true;
    retry.delete(l.id);
    // What this screen just saw itself while fetching is the best probe there is.
    const own = traffic.feedStatus();
    if (own.fiAt && Date.now() - own.fiAt < FRESH_MS) probe = { at: Date.now(), ok: true, tried: Date.now() };
    else if (traffic.gate.fi.until > Date.now()) probe = { at: Date.now(), ok: false, tried: Date.now() };
    // From the first round on this screen stops fetching, and its own followers go to the fetcher.
    role = 'follow';
    traffic.follow(l.name);
    handOver(l.id);
    // Whether adsb.fi would answer this screen itself, should the fetcher lose it one day.
    if (Date.now() - probe.tried > PROBE_MS) runProbe();
  }
  traffic.ingestShared(msg);
}

// The link is gone: fetch by itself at once, and try that fetcher again later.
function fail(l, why, { quiet = false } = {}) {
  if (l.closed) return;
  l.closed = true;
  try { l.req && l.req.destroy(); } catch { /* already closed */ }
  if (!quiet) {
    const r = retry.get(l.id) || { n: 0 };
    r.at = Date.now() + RETRY_MS[Math.min(r.n, RETRY_MS.length - 1)];
    r.n += 1;
    retry.set(l.id, r);
  }
  if (link === l) {
    link = null;
    if (l.live) log.warn('delen', `verbinding met ${l.name} verbroken (${why}); haalt zelf op`);
    else if (!quiet) log.info('delen', `${l.name} niet te volgen (${why})`);
    lead();
  }
}

function drop(why, { keep = false } = {}) {
  const l = link;
  if (!l) return;
  l.closed = true;
  link = null;
  try { l.req && l.req.destroy(); } catch { /* already closed */ }
  if (why) log.info('delen', `volgt ${l.name} niet meer: ${why}`);
  if (!keep) lead();
}

function lead() {
  if (role !== 'lead') { role = 'lead'; traffic.follow(null); }
}

// Followers of this screen are sent on to the fetcher it now follows.
function handOver(nextId) {
  if (!streams.size) return;
  const line = JSON.stringify({ t: 'bye', next: nextId }) + '\n';
  for (const s of [...streams]) { try { s.res.end(line); } catch { /* gone */ } }
}

// The own wish (radar area, own aircraft) to the fetcher, when it changes and every few seconds.
let wantSent = { at: 0, sig: '' };
function sendWant(want) {
  const l = link;
  if (!l || !l.live || l.closed) return;
  const sig = JSON.stringify(want), now = Date.now();
  if (sig === wantSent.sig && now - wantSent.at < WANT_MS - 500) return;
  wantSent = { at: now, sig };
  const me = self();
  const req = httpLib.get({
    host: l.peer.address.replace(/^\[|\]$/g, ''), port: l.peer.port, path: WANT,
    headers: { 'X-Palv-Screen': JSON.stringify({ id: me.id, name: me.name, port: me.port }), 'X-Palv-Want': sig },
    timeout: 3000,
  }, (res) => res.resume());
  req.on('timeout', () => req.destroy());
  req.on('error', () => {});
}

// One small question to adsb.fi through the regulator of the feed. A source that rests after a refusal
// or block counts as not answering; one that is only busy or was asked a moment ago is waited for.
async function runProbe() {
  probe.tried = Date.now();
  let ok = false;
  for (let i = 0; i < 6; i += 1) {
    const g = traffic.gate.fi;
    if (Date.now() < g.until) break;
    if (g.busy || Date.now() - g.last < 1200) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    ok = !!(await traffic.request('fi', 'https://opendata.adsb.fi/api/v2/lat/52.31/lon/4.76/dist/3').catch(() => null));
    break;
  }
  probe = { at: Date.now(), ok, tried: probe.tried };
}

/* ---------- fetching: the followers of this screen ---------- */

// GET /api/traffic/stream from screens.js; `from` is the follower as it introduced itself.
function handleStream(req, res, from) {
  if (!enabled || role !== 'lead' || !from || !from.id) {
    res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(role === 'lead' ? 'Delen staat uit' : 'Dit scherm haalt zelf niet op');
  }
  let want = null;
  try { want = JSON.parse(req.headers['x-palv-want'] || 'null'); } catch { /* none */ }
  // One link per follower: a new one replaces an old one that may not have noticed it was gone.
  for (const s of streams) if (s.id === from.id) { streams.delete(s); try { s.res.destroy(); } catch { /* gone */ } }
  const s = { id: from.id, name: from.name || from.id, res, rev: 0 };
  streams.add(s);
  traffic.remoteWant(from.id, want);
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (res.socket) { res.socket.setNoDelay(true); res.socket.setKeepAlive(true, 5000); }
  log.info('delen', `${s.name} ontvangt het verkeer van dit scherm`);
  const close = () => {
    if (!streams.delete(s)) return;
    if (![...streams].some((x) => x.id === s.id)) traffic.dropWant(s.id);
    log.info('delen', `${s.name} ontvangt het verkeer niet meer van dit scherm`);
  };
  res.on('close', close);
  res.on('error', close);
  // Everything known straight away, so the follower's map is complete from the first line.
  write(s, Date.now());
}

function handleWant(req, from) {
  if (!from || !from.id || ![...streams].some((s) => s.id === from.id)) return false;
  try { traffic.remoteWant(from.id, JSON.parse(req.headers['x-palv-want'] || 'null')); } catch { return false; }
  return true;
}

function message(since, now) {
  const { seq, recs } = traffic.exportSince(since);
  return { seq, line: JSON.stringify({ t: 'r', now, recs, st: traffic.feedStatus(now), lead: { score: score(now) } }) + '\n' };
}

function write(s, now, cache) {
  if (s.res.writableLength > MAX_BUFFER) { log.warn('delen', `${s.name} kan het niet bijhouden; verbinding verbroken`); s.res.destroy(); return; }
  let m = cache && cache.get(s.rev);
  if (!m) { m = message(s.rev, now); if (cache) cache.set(s.rev, m); }
  s.res.write(m.line);
  s.rev = m.seq;
}

// After every change in the own feed (traffic.js): to all followers at once.
function broadcast() {
  if (!streams.size || role !== 'lead') return;
  const now = Date.now();
  lastBroadcast = now;
  const cache = new Map(); // followers that are equally far along get the same line, built once
  for (const s of [...streams]) { try { write(s, now, cache); } catch { streams.delete(s); } }
}

function heartbeat() {
  const now = Date.now();
  if (streams.size && role === 'lead' && now - lastBroadcast >= HEARTBEAT_MS) {
    lastBroadcast = now;
    const line = JSON.stringify({ t: 'h', now, lead: { score: score(now) } }) + '\n';
    for (const s of [...streams]) { try { s.res.write(line); } catch { streams.delete(s); } }
  }
  // A link that has gone silent: fetch by itself.
  if (link && now - link.lastLine > SILENT_MS) fail(link, link.live ? 'stil' : 'geen antwoord');
  // A follower checks now and then whether adsb.fi would answer it.
  if (role === 'follow' && now - probe.tried > PROBE_MS) runProbe();
}

/* ---------- start and status ---------- */

function start(opts) {
  traffic = opts.traffic;
  self = opts.self;
  peers = opts.peers;
  if (opts.log) log = opts.log;
  if (opts.http) httpLib = opts.http;
  enabled = !opts.disabled;
  startedAt = Date.now();
  clearInterval(timer);
  // Every 250 ms: a silent link is noticed within 2.75 s, and choosing costs next to nothing.
  let n = 0;
  timer = setInterval(() => { heartbeat(); if (++n % 4 === 0) evaluate(); }, 250);
  if (timer.unref) timer.unref();
}

function stop() {
  clearInterval(timer);
  timer = null;
  if (link) drop(null, { keep: true });
  for (const s of [...streams]) { try { s.res.destroy(); } catch { /* gone */ } }
  streams.clear();
  role = 'lead';
  enabled = false;
}

// For the status of this screen (screens.js) and the dashboard.
function info(now = Date.now()) {
  if (!enabled) return null;
  return {
    v: PROTO,
    role,
    score: score(now),
    leader: link && link.live ? { id: link.id, name: link.name } : null,
    followers: [...streams].map((s) => s.name),
  };
}

module.exports = { start, stop, info, broadcast, sendWant, handleStream, handleWant, rank, choose, evaluate, STREAM, WANT, PROTO, _state: () => ({ role, link, streams, retry, pending }) };
