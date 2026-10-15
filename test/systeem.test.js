// Backups of the configuration, the live-traffic regulator, updates and the screens overview:
// `node --test test/`.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'palv-test-'));

test('configuratie: reservekopieën en herstel van een onleesbaar bestand', () => {
  const config = require('../src/main/config');
  const dir = tmp();
  config.init(dir);
  assert.strictEqual(config.read(), null, 'eerste start: geen indeling');
  const a = { version: 7, pages: [{ name: 'A', widgets: [] }] };
  config.write(a);
  assert.deepStrictEqual(config.read(), a);
  // A second write within the hour makes a backup only for a named reason.
  config.write({ ...a, activePage: 0 });
  const before = config.list().length;
  assert.ok(config.backup('import'), 'vóór een import altijd een kopie');
  assert.strictEqual(config.list().length, before + 1);
  assert.strictEqual(config.list()[0].reason, 'import');
  // config.json damaged: the newest good backup comes back, and is said so once.
  fs.writeFileSync(path.join(dir, 'config.json'), '{ kapot');
  const back = config.read();
  assert.ok(back && Array.isArray(back.pages), 'kopie teruggezet');
  assert.ok(config.takeRestored(), 'melding voor het dashboard');
  assert.strictEqual(config.takeRestored(), null, 'maar één keer');
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).some((f) => f.endsWith('-broken.json')), 'kapotte versie bewaard');
  assert.throws(() => config.parse('{"pages": 1}'));
});

test('verkeer: precies één ophaallus, hoe vaak het dashboard ook vernieuwt', async () => {
  const traffic = require('../src/traffic');
  let calls = 0, inFlight = 0, maxInFlight = 0;
  traffic.start(async () => {
    calls += 1; inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 120));
    inFlight -= 1;
    return { now: Date.now(), ac: [] };
  }, () => {});
  const req = { area: { lat: 52.2, lon: 5.3, nm: 100 }, groups: {} };
  const t0 = Date.now();
  // The renderer renews often; also exactly while a request is under way.
  const iv = setInterval(() => traffic.watch(req), 25);
  await new Promise((r) => setTimeout(r, 3300));
  clearInterval(iv);
  traffic.stop();
  const secs = (Date.now() - t0) / 1000;
  assert.ok(maxInFlight <= 2, `hooguit één verzoek per bron tegelijk (${maxInFlight})`);
  // One adsb.fi round a second plus an adsb.lol supplement every few seconds.
  assert.ok(calls <= Math.ceil(secs) + 3, `${calls} verzoeken in ${secs.toFixed(1)} s`);
});

test('verkeer: na een weigering rust de bron en neemt de andere het over', async () => {
  const traffic = require('../src/traffic');
  const asked = [];
  traffic.start(async (url) => {
    asked.push(url.includes('adsb.fi') ? 'fi' : 'lol');
    if (url.includes('adsb.fi')) throw new Error('HTTP 429');
    return { now: Date.now() / 1000, aircraft: [{ hex: 'abc123', lat: 52, lon: 5, seen: 0, seen_pos: 0 }] };
  }, () => {});
  traffic.watch({ area: { lat: 52.2, lon: 5.3, nm: 100 }, groups: {} });
  await new Promise((r) => setTimeout(r, 2500));
  traffic.stop();
  assert.ok(traffic.gate.fi.until > Date.now() - 2500, 'adsb.fi rust');
  assert.ok(asked.filter((s) => s === 'fi').length <= 2, `adsb.fi niet bestookt: ${asked.join(',')}`);
  assert.ok(traffic.snapshot().ok, 'feed blijft actueel via adsb.lol');
  assert.ok(traffic.records().has('abc123'));
});

test('updates: versies vergelijken', () => {
  const { newer } = require('../src/main/updater');
  assert.strictEqual(newer('1.14.0', '1.13.0'), true);
  assert.strictEqual(newer('v1.14.1', '1.14.0'), true);
  assert.strictEqual(newer('1.14.0', '1.14.0'), false);
  assert.strictEqual(newer('1.9.9', '1.10.0'), false);
  assert.strictEqual(newer('2.0.0', '1.99.99'), true);
});

test('schermen: alleen privé- en Tailscale-adressen', () => {
  const { isPrivate } = require('../src/main/screens');
  for (const a of ['127.0.0.1', '::1', '::ffff:192.168.1.20', '10.0.0.5', '172.20.1.1', '100.125.25.107', 'fd7a:115c:a1e0::1']) assert.strictEqual(isPrivate(a), true, a);
  for (const a of ['8.8.8.8', '172.32.0.1', '100.20.0.1', '2a02:a46::1', '']) assert.strictEqual(isPrivate(a), false, a);
});
