// One dashboard for the sharing test (delen.test.js), in a process of its own: the real traffic.js and
// share.js, a small status server in place of screens.js, and made-up sources whose behaviour the test
// sets through messages. Never asks a real source.
const http = require('http');
const traffic = require('../../src/traffic');
const share = require('../../src/share');

const id = process.env.SCREEN_ID;
const name = process.env.SCREEN_NAME || id;
let peers = []; // { id, name, address, port, online, status }
const sources = { fi: 'ok', lol: 'ok' }; // 'ok', '403', 'down'
const calls = { fi: 0, lol: 0, urls: [] };
const seen = { latency: [], rounds: 0, lastAt: 0 };

// Made-up aircraft that move a little every second; each answer as fresh as a real adsb.fi answer.
function fakeAnswer(url) {
  const now = Date.now();
  const ac = [];
  for (let i = 0; i < 50; i += 1) {
    ac.push({ hex: (0x400000 + i).toString(16), flight: `TST${i}`, alt_baro: 10000 + i * 100, gs: 300, track: 90, lat: 52 + i * 0.02, lon: 4 + ((now / 1000) % 600) * 0.001, squawk: '1000', seen: 0, seen_pos: 0 });
  }
  return { now, ac, url };
}
async function fetchJson(url) {
  const src = url.includes('adsb.fi') ? 'fi' : 'lol';
  calls[src] += 1;
  calls.urls.push(url);
  if (calls.urls.length > 50) calls.urls.shift();
  await new Promise((r) => setTimeout(r, 20)); // a little network time
  if (sources[src] === '403') throw new Error('HTTP 403');
  if (sources[src] === 'down') throw new Error('fetch failed');
  return fakeAnswer(url);
}

traffic.start(fetchJson, (snap) => {
  seen.rounds += 1;
  seen.lastAt = Date.now();
  let newest = 0;
  for (const a of snap.ac) if (a.posAt > newest) newest = a.posAt;
  // How long a new position took to reach this screen; a repaint without anything new says nothing.
  if (newest > (seen.newest || 0)) { seen.latency.push(Date.now() - newest); if (seen.latency.length > 30) seen.latency.shift(); }
  seen.newest = Math.max(seen.newest || 0, newest);
  seen.via = snap.via || null;
  seen.count = snap.ac.length;
}, { info() {}, warn() {} }, { onShare: () => share.broadcast(), onWant: (w) => share.sendWant(w) });

const server = http.createServer((req, res) => {
  let caller = null;
  try { const p = JSON.parse(req.headers['x-palv-screen'] || 'null'); if (p && p.id) caller = { id: p.id, name: p.name }; } catch { /* none */ }
  const url = req.url.split('?')[0];
  if (url === share.STREAM) return share.handleStream(req, res, caller);
  if (url === share.WANT) { res.writeHead(share.handleWant(req, caller) ? 200 : 409); return res.end(); }
  if (url === '/api/status') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ id, name, now: Date.now(), share: share.info() })); }
  res.writeHead(404); res.end();
});

// The status of the others, as screens.js polls it (here every second instead of every 10).
async function pollPeers() {
  for (const p of peers) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 800);
      const s = await (await fetch(`http://127.0.0.1:${p.port}/api/status`, { signal: ctl.signal })).json();
      clearTimeout(t);
      p.status = s; p.online = true; p.lastSeen = Date.now();
    } catch { p.online = !!p.lastSeen && Date.now() - p.lastSeen < 3000; }
  }
}

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  share.start({ traffic, peers: () => peers, self: () => ({ id, name, port }), log: { info() {}, warn() {} } });
  // A radar on screen: this dashboard watches an area (the test can move it).
  let area = { lat: 52.3, lon: 4.8, nm: 60 };
  const watchAgain = () => traffic.watch({ area, groups: { eigen: ['484a91'] } });
  watchAgain();
  setInterval(watchAgain, 4000);
  setInterval(pollPeers, 1000);
  process.on('message', (m) => {
    if (m.peers) peers = m.peers.map((p) => ({ ...p, address: '127.0.0.1', online: false, status: null }));
    if (m.sources) Object.assign(sources, m.sources);
    if (m.area) { area = m.area; watchAgain(); }
    // A frozen screen: its links stay open, but nothing comes through any more (network or computer stuck).
    if (m.freeze) { const w = http.ServerResponse.prototype.write; http.ServerResponse.prototype.write = function (chunk, ...rest) { return this.req && this.req.url.startsWith(share.STREAM) ? true : w.call(this, chunk, ...rest); }; }
    if (m.reset) { calls.fi = 0; calls.lol = 0; calls.urls = []; seen.latency = []; }
    if (m.ask) {
      const lat = seen.latency.slice(-10).sort((a, b) => a - b);
      process.send({ id, reply: m.ask, info: share.info(), following: traffic.following(), calls: { fi: calls.fi, lol: calls.lol, last: calls.urls[calls.urls.length - 1] || null }, latency: lat.length ? lat[Math.floor(lat.length / 2)] : null, maxLatency: lat.length ? lat[lat.length - 1] : null, count: seen.count, sinceUpdate: Date.now() - seen.lastAt, via: seen.via });
    }
  });
  process.send({ id, port });
});
