// Live traffic shared between dashboards: exactly one fetches, the others receive every round within
// milliseconds, and when the fetcher falls away or loses adsb.fi another takes over. Three dashboards,
// each in a process of its own, with made-up sources: `node --test test/delen.test.js` (about a minute).
const test = require('node:test');
const assert = require('assert');
const path = require('path');
const { fork } = require('child_process');
const share = require('../src/share');

test('volgorde: beste bron, dan wie al ophaalt, dan laagste id', () => {
  const r = (list) => share.rank(list).map((x) => x.id).join(',');
  assert.strictEqual(r([{ id: 'b', score: 1, leading: true }, { id: 'a', score: 2, leading: false }]), 'a,b', 'adsb.fi werkt gaat voor');
  assert.strictEqual(r([{ id: 'a', score: 2, leading: false }, { id: 'b', score: 2, leading: true }]), 'b,a', 'gelijk: wie al ophaalt blijft');
  assert.strictEqual(r([{ id: 'c', score: 2, leading: true }, { id: 'b', score: 2, leading: true }]), 'b,c', 'twee ophalers: laagste id');
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startScreen(id) {
  const child = fork(path.join(__dirname, 'helpers', 'scherm.js'), [], { env: { ...process.env, SCREEN_ID: id }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  const s = { id, child, port: null, asks: new Map(), n: 0 };
  s.ready = new Promise((resolve) => child.once('message', (m) => { s.port = m.port; resolve(); }));
  child.on('message', (m) => { if (m.reply && s.asks.has(m.reply)) { s.asks.get(m.reply)(m); s.asks.delete(m.reply); } });
  s.ask = () => new Promise((resolve) => { const k = ++s.n; s.asks.set(k, resolve); child.send({ ask: k }); });
  s.send = (m) => child.send(m);
  return s;
}

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await wait(250);
  }
  throw new Error(`niet binnen ${ms / 1000} s: ${what}`);
}

test('drie schermen: één haalt op, de andere krijgen alles direct door, en nemen over', { timeout: 120000 }, async (t) => {
  // Ids in this order, so "a" fetches when all is equal.
  const screens = ['a', 'b', 'c'].map(startScreen);
  t.after(() => { for (const s of screens) { try { s.child.kill(); } catch { /* gone */ } } });
  await Promise.all(screens.map((s) => s.ready));
  for (const s of screens) s.send({ peers: screens.filter((o) => o !== s).map((o) => ({ id: o.id, name: o.id, port: o.port })) });
  const [a, b, c] = screens;
  const all = () => Promise.all(screens.filter((s) => s.child.connected).map((s) => s.ask()));

  // 1. They agree on one fetcher, the lowest id, within the time a real set-up takes.
  await until(async () => { const st = await all(); return st.every((x) => (x.id === 'a' ? x.info.role === 'lead' : x.info.leader && x.info.leader.id === 'a')); }, 20000, 'b en c volgen a');
  const lead = await a.ask();
  assert.deepStrictEqual(lead.info.followers.sort(), ['b', 'c']);

  // 2. Only the fetcher asks the sources (a follower checks adsb.fi at most once now and then).
  for (const s of screens) s.send({ reset: true });
  await wait(6000);
  const [sa, sb, sc] = await all();
  assert.ok(sa.calls.fi >= 4, `a vraagt adsb.fi zelf (${sa.calls.fi}x in 6 s)`);
  assert.ok(sb.calls.fi + sb.calls.lol <= 1 && sc.calls.fi + sc.calls.lol <= 1, `b en c vragen niets (${sb.calls.fi + sb.calls.lol}, ${sc.calls.fi + sc.calls.lol})`);

  // 3. The followers are as fresh as the fetcher itself: a few milliseconds more at most.
  assert.ok(sb.via === 'a' && sc.via === 'a', 'zij tonen "via a"');
  assert.ok(sb.count >= 50 && sc.count >= 50, 'alle toestellen komen aan');
  assert.ok(sb.latency != null && sb.latency - sa.latency < 60, `vertraging b ${sb.latency} ms tegen a ${sa.latency} ms`);
  assert.ok(sb.maxLatency < 400, `slechtste versheid b ${sb.maxLatency} ms`);
  assert.ok(sb.sinceUpdate < 1500 && sc.sinceUpdate < 1500, 'elke ronde komt door');
  t.diagnostic(`versheid: ophaler a ${sa.latency} ms, volger b ${sb.latency} ms (slechtste ${sb.maxLatency}), volger c ${sc.latency} ms`);

  // 4. The fetcher fetches for the area of a follower too, also when it lies far away.
  c.send({ area: { lat: 53.4, lon: 6.6, nm: 40 } });
  await until(async () => { const x = await a.ask(); const m = /\/lat\/([\d.]+)\/lon\/([\d.]+)\/dist\/(\d+)/.exec(x.calls.last || ''); return m && +m[1] > 52.5 && +m[3] > 60; }, 8000, 'a haalt ook het gebied van c op');

  // 5. The fetcher falls away: the others fetch themselves within seconds, then again only one does.
  const gone = Date.now();
  a.child.kill();
  await until(async () => { const st = await Promise.all([b.ask(), c.ask()]); return st.every((x) => x.sinceUpdate < 1500) && st.some((x) => x.info.role === 'lead'); }, 6000, 'b of c haalt binnen een paar seconden zelf op');
  const took = Date.now() - gone;
  assert.ok(took < 6000, `overname in ${took} ms`);
  t.diagnostic(`overname na wegvallen ophaler: ${took} ms`);
  await until(async () => { const [x, y] = await Promise.all([b.ask(), c.ask()]); return x.info.role === 'lead' && y.info.leader && y.info.leader.id === 'b'; }, 20000, 'c volgt b');

  // 6. adsb.fi blocks the fetcher (b), not c: c finds out and takes over, b then follows c.
  b.send({ sources: { fi: '403' } });
  await until(async () => { const [x, y] = await Promise.all([b.ask(), c.ask()]); return y.info.role === 'lead' && x.info.leader && x.info.leader.id === 'c'; }, 60000, 'c neemt over van de geblokkeerde b');
  const [fb, fc] = await Promise.all([b.ask(), c.ask()]);
  assert.strictEqual(fb.via, 'c');
  assert.ok(fb.sinceUpdate < 1500 && fc.sinceUpdate < 1500, 'beide blijven vers');

  // 7. The fetcher (c) freezes without closing the link: b notices the silence and fetches itself.
  b.send({ sources: { fi: 'ok' } });
  const frozen = Date.now();
  c.send({ freeze: true });
  await until(async () => { const x = await b.ask(); return x.info.role === 'lead' && x.sinceUpdate < 1500 && !x.following; }, 8000, 'b haalt zelf op na stilte van c');
  const quiet = Date.now() - frozen;
  t.diagnostic(`overname na stille ophaler: ${quiet} ms`);
  assert.ok(quiet < 5000, `overname na stilte in ${quiet} ms`);
});
