// The unit key between dashboards: two screens that knew each other agree on one key by themselves, a
// screen from outside gets nothing until it is paired with the code, and nothing private goes over
// plain HTTP or to a wrong key. Three dashboards, each in a process of its own (about 30 seconds).
const test = require('node:test');
const assert = require('assert');
const path = require('path');
const http = require('http');
const tls = require('tls');
const crypto = require('crypto');
const { fork } = require('child_process');
const unit = require('../src/main/unit');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startScreen(name, base) {
  const child = fork(path.join(__dirname, 'helpers', 'sleutelscherm.js'), [], { env: { ...process.env, SCREEN_ID: name, PALV_SCREENS_PORT: String(base) }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const s = { name, child, asks: new Map(), n: 0 };
  s.ready = new Promise((resolve) => child.on('message', (m) => { if (m.ready) { s.port = m.port; s.id = m.id; resolve(); } }));
  child.on('message', (m) => { if (m.reply && s.asks.has(m.reply)) { s.asks.get(m.reply)(m); s.asks.delete(m.reply); } });
  s.ask = (m) => new Promise((resolve) => { const k = ++s.n; s.asks.set(k, resolve); child.send({ ...m, ask: k }); });
  return s;
}

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fn();
    if (r) return r;
    await wait(300);
  }
  throw new Error(`niet binnen ${ms / 1000} s: ${what}`);
}

const get = (port, pathname) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: pathname, headers: { 'X-Palv-Screen': JSON.stringify({ id: 'indringer', name: 'x', port: 1 }) } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', () => resolve(0));
});

test('koppelcode: heen en terug, typfouten worden herkend', () => {
  const key = crypto.randomBytes(32);
  unit._set(key);
  const code = unit.code();
  assert.ok(unit.parseCode(code.toLowerCase().replace(/-/g, ' ')).equals(key));
  const typo = code.slice(0, 5) + (code[5] === 'A' ? 'B' : 'A') + code.slice(6);
  assert.throws(() => unit.parseCode(typo), /klopt niet/);
  assert.throws(() => unit.parseCode(code.slice(0, 30)), /niet compleet/);
});

test('eenheidssleutel tussen drie dashboards', { timeout: 90000 }, async (t) => {
  const a = startScreen('a', 48800), b = startScreen('b', 48810);
  const all = [a, b];
  t.after(() => { for (const s of all) { try { s.child.kill(); } catch { /* gone */ } } });
  await Promise.all([a.ready, b.ready]);

  // 1. Two screens that know each other: one makes the key, the other gets it, both trust each other.
  await a.ask({ add: `127.0.0.1:${b.port}` });
  const secure = (s, other) => s.ask({ list: true }).then((r) => r.list.find((x) => x.id === other.id && x.secure));
  const took = Date.now();
  await until(async () => (await secure(a, b)) && (await secure(b, a)), 40000, 'a en b beveiligd verbonden');
  t.diagnostic(`a en b beveiligd na ${Date.now() - took} ms`);
  const [la, lb] = await Promise.all([a.ask({ list: true }), b.ask({ list: true })]);
  assert.ok(la.auth.fp && la.auth.fp === lb.auth.fp, 'zelfde sleutel');

  // 2. Nothing private over plain HTTP, also not with an id of the unit; the status page stays open.
  assert.strictEqual(await get(a.port, '/api/plan/sync?kind=private'), 403);
  assert.strictEqual(await get(a.port, '/api/status'), 200);
  assert.strictEqual(await get(a.port, '/api/pair'), 403, 'de sleutel gaat niet naar een onbekende');

  // 3. A wrong key gets no TLS connection at all.
  const refused = await new Promise((resolve) => {
    const s = tls.connect({ ...unit.TLS, host: '127.0.0.1', port: a.port + 1, pskCallback: () => ({ psk: crypto.randomBytes(32), identity: unit.IDENTITY }), checkServerIdentity: () => undefined });
    s.on('secureConnect', () => { s.destroy(); resolve(false); });
    s.on('error', () => resolve(true));
  });
  assert.ok(refused, 'verkeerde sleutel geweigerd');

  // 4. A screen from outside: it sees the others, but gets neither the key nor anything private.
  const c = startScreen('c', 48820);
  all.push(c);
  await c.ready;
  await a.ask({ add: `127.0.0.1:${c.port}` });
  await c.ask({ add: `127.0.0.1:${a.port}` });
  await wait(4000);
  await c.ask({ poll: true });
  await c.ask({ poll: true });
  const lc = await c.ask({ list: true });
  assert.ok(!lc.auth.fp, 'c heeft geen sleutel gekregen');
  assert.ok(!lc.list.some((x) => x.secure), 'c vertrouwt niemand');
  assert.strictEqual(((await a.ask({ list: true })).list.find((x) => x.id === c.id) || {}).secure, false, 'a vertrouwt c niet');

  // 5. Paired with the code of a: from then on c belongs to the unit.
  const { code } = await a.ask({ code: true });
  await c.ask({ pair: code });
  await until(async () => (await secure(c, a)) && (await secure(a, c)), 25000, 'c gekoppeld');

  // 6. A screen of an older version (status page only, nothing on the TLS port next to it, where a
  //    firewall leaves the knock unanswered): still seen as running, never trusted.
  const held = new Set();
  const silent = require('net').createServer((sock) => { held.add(sock); sock.on('error', () => {}); }); // never answers
  const old = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'oud', name: 'oud', now: Date.now() })); });
  await new Promise((r) => old.listen(48830, '127.0.0.1', r));
  await new Promise((r) => silent.listen(48831, '127.0.0.1', r));
  t.after(() => { for (const sock of held) sock.destroy(); old.close(); silent.close(); });
  await a.ask({ add: '127.0.0.1:48830' });
  const seen = await until(async () => (await a.ask({ list: true })).list.find((x) => x.id === 'oud' && x.online), 15000, 'oude versie zichtbaar');
  assert.strictEqual(seen.secure, false);
  assert.strictEqual(seen.lock, 'oud');
});
