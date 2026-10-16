// Zoek & Plan: aeronautical data from openAIP. Never touches the network: the answers are trimmed real
// openAIP responses in test/fixtures/plan-aero. `node --test test/plan-aero.test.js`.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const aero = require('../src/plan/aero');

const FIX = path.join(__dirname, 'fixtures', 'plan-aero');
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n + '.json'), 'utf8'));
const quiet = { info() {}, warn() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'palv-aero-'));
const KEY = 'test-key-not-real-0123456789';
const DAY = 86400e3;

// A fake fetchJson that answers by URL and records every request with its headers.
function fake(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    for (const [re, answer] of routes) if (re.test(url)) return typeof answer === 'function' ? answer(url, opts) : answer;
    throw Object.assign(new Error('HTTP 404'), { status: 404 });
  };
  fn.calls = calls;
  fn.count = (re) => calls.filter((c) => re.test(c.url)).length;
  return fn;
}
const fixtureRoutes = () => [
  [/\/airspaces\?/, fixture('airspaces')], [/\/airports\?/, fixture('airports')], [/\/reporting-points\?/, fixture('reporting-points')],
  [/\/navaids\?/, fixture('navaids')], [/\/obstacles\?/, fixture('obstacles')],
];
const sleeps = [];
const sleep = async (ms) => { sleeps.push(ms); };
function begin(dir, fetchJson, withKey = true) {
  if (withKey) fs.writeFileSync(path.join(dir, 'openaip.json'), JSON.stringify({ key: KEY }));
  aero.start({ dir, fetchJson, log: quiet, sleep, gapMs: 0, bboxGapMs: 0, retryMs: [5, 10] });
}
const settle = async () => { while (aero.status().busy) await new Promise((r) => setTimeout(r, 1)); };

test('AIRAC cycles from 25 January 2024, every 28 days', () => {
  assert.strictEqual(aero.airac(Date.UTC(2024, 0, 25)).ident, '2401');
  assert.strictEqual(aero.airac(Date.UTC(2024, 1, 21)).ident, '2401', 'the day before the next cycle');
  assert.strictEqual(aero.airac(Date.UTC(2024, 1, 22)).ident, '2402');
  assert.strictEqual(aero.airac(Date.UTC(2024, 11, 26)).ident, '2413', '2024 has 13 cycles');
  const c = aero.airac(Date.UTC(2025, 0, 23, 12));
  assert.strictEqual(c.ident, '2501');
  assert.strictEqual(c.start, Date.UTC(2025, 0, 23));
  assert.strictEqual(c.next, Date.UTC(2025, 1, 20));
  assert.strictEqual(aero.airac(Date.UTC(2026, 9, 16)).ident, '2610');
  assert.strictEqual(aero.airac(Date.UTC(2026, 9, 16)).start, Date.UTC(2026, 9, 1));
  assert.strictEqual(aero.airac(Date.UTC(2023, 11, 30)).ident, '2313', 'before the epoch too');
});

test('stale after 7 days or when a new AIRAC cycle started', () => {
  const now = Date.UTC(2026, 9, 16);
  assert.strictEqual(aero.isStale(now - 2 * DAY, now), false);
  assert.strictEqual(aero.isStale(now - 8 * DAY, now), true);
  assert.strictEqual(aero.isStale(Date.UTC(2026, 8, 30), Date.UTC(2026, 9, 2)), true, 'cycle 2610 began on 1 October');
  assert.strictEqual(aero.isStale(null, now), true);
});

test('airspaces: types, classes, vertical limits, frequencies, squawk, hours, geometry', () => {
  const { airspaces } = aero.normalize({ airspaces: fixture('airspaces').items });
  const by = (n) => airspaces.find((a) => a.name === n);
  const ctr = by('CTR1 EHAM');
  assert.strictEqual(ctr.type, 'CTR');
  assert.strictEqual(ctr.icaoClass, 'C');
  assert.deepStrictEqual(ctr.lower, { v: 0, unit: 'ft', ref: 'GND', ft: 0, text: 'GND' });
  assert.deepStrictEqual(ctr.upper, { v: 3000, unit: 'ft', ref: 'MSL', ft: 3000, text: '3000 ft AMSL' });
  assert.strictEqual(ctr.hours, 'H24');
  assert.strictEqual(ctr.geometry.type, 'Polygon');
  for (const [lon, lat] of ctr.geometry.coordinates[0]) {
    assert.ok(lon > 4 && lon < 5.5 && lat > 52 && lat < 52.6, 'lon/lat order');
    assert.strictEqual(Math.round(lon * 1e6) / 1e6, lon, 'rounded to 6 decimals');
  }
  const [s, w, n, e] = ctr.bbox;
  assert.ok(s < n && w < e && s > 52 && e < 5.5);
  const tma = by('EHAM TMA1');
  assert.strictEqual(tma.type, 'TMA');
  assert.strictEqual(tma.icaoClass, 'A');
  assert.deepStrictEqual(tma.upper, { v: 95, unit: 'FL', ref: 'STD', ft: 9500, text: 'FL 095' });
  const tmz = by('7010');
  assert.strictEqual(tmz.type, 'TMZ');
  assert.strictEqual(tmz.icaoClass, 'SUA');
  assert.deepStrictEqual(tmz.freqs, [{ name: null, mhz: 122.99, primary: true }]);
  assert.deepStrictEqual(tmz.squawk, ['7010']);
  assert.strictEqual(by('EH-R4 VLIEHORS').type, 'R');
  assert.strictEqual(by('EH-P26 (H24)').type, 'P');
  assert.strictEqual(by('EHAA').type, 'FIR');
  assert.strictEqual(by('EHAA').upper.text, 'UNL');
  assert.strictEqual(by('EH-R3A OLDEBROEK').hours, 'ma-vr H24, za-zo NOTAM');
  for (const a of airspaces) {
    assert.ok(aero.TYPES[a.type] && aero.TYPES[a.type].name && aero.TYPES[a.type].color, `TYPES has ${a.type}`);
    assert.strictEqual(a.country, 'NL');
  }
});

test('every openAIP airspace type has a code with a Dutch name', () => {
  assert.strictEqual(aero.TYPE_CODES.length, 37);
  for (const c of aero.TYPE_CODES) assert.ok(aero.TYPES[c] && /^#[0-9a-f]{6}$/.test(aero.TYPES[c].color), c);
  const { airspaces } = aero.normalize({ airspaces: [{ _id: 'x', name: 'X', type: 20, icaoClass: 6, geometry: { type: 'Polygon', coordinates: [[[5, 52], [5.1, 52], [5.1, 52.1], [5, 52]]] }, lowerLimit: { value: 300, unit: 0, referenceDatum: 0 }, upperLimit: { value: 1500, unit: 1, referenceDatum: 0 } }] });
  assert.strictEqual(airspaces[0].type, 'HTZ');
  assert.strictEqual(airspaces[0].icaoClass, 'G');
  assert.deepStrictEqual(airspaces[0].lower, { v: 300, unit: 'm', ref: 'GND', ft: 984, text: '300 m AGL' });
  assert.strictEqual(airspaces[0].upper.text, '1500 ft AGL');
});

test('airports, heliports, reporting points, navaids and obstacles', () => {
  const d = aero.normalize({
    airports: fixture('airports').items, reportingPoints: fixture('reporting-points').items,
    navaids: fixture('navaids').items, obstacles: fixture('obstacles').items,
  });
  const ehle = d.airports.find((a) => a.icao === 'EHLE');
  assert.strictEqual(ehle.iata, 'LEY');
  assert.strictEqual(ehle.type, 'airport-ifr');
  assert.strictEqual(ehle.elevFt, -13);
  assert.deepStrictEqual(ehle.runways[0], { des: '05', trueHdg: 47, lengthM: 2700, widthM: 45, surface: 'Asfalt' });
  assert.deepStrictEqual(ehle.freqs.find((f) => f.type === 'TWR'), { name: 'LELYSTAD TOWER', mhz: 135.18, type: 'TWR', primary: true });
  assert.strictEqual(d.airports.find((a) => a.name === 'VU MEDISCH CENTRUM').type, 'heliport-hospital');
  assert.strictEqual(d.airports.find((a) => a.name === 'K12-A').type, 'heliport-offshore');
  assert.strictEqual(d.airports.find((a) => a.name === 'EEMSHAVEN').type, 'heliport');
  assert.strictEqual(d.airports.find((a) => a.icao === 'EHTX').type, 'airfield');

  assert.deepStrictEqual(d.reportingPoints[0], { id: '629cc0acf4b4089a578e0647', name: 'ALPHA', lat: 53.045, lon: 4.911667, compulsory: true, airports: ['EHTX'], country: 'NL' });

  const ams = d.navaids.find((n) => n.ident === 'AMS');
  assert.strictEqual(ams.freq, '113.950 MHz');
  assert.strictEqual(ams.channel, '86Y');
  assert.strictEqual(ams.type, 'DME');
  assert.strictEqual(ams.magVar, 1.9);
  const ndb = aero.normalize({ navaids: [{ ...fixture('navaids').items[0], type: 2, frequency: { value: '352.000', unit: 1 } }] }).navaids[0];
  assert.strictEqual(ndb.type, 'NDB');
  assert.strictEqual(ndb.freq, '352 kHz');

  const [tall, untagged, tower] = d.obstacles;
  assert.strictEqual(tall.type, 'wind-turbine');
  assert.strictEqual(tall.heightFtAgl, 443);
  assert.strictEqual(tall.elevFtAmsl, 39);
  assert.strictEqual(tall.topFtAmsl, 482);
  assert.strictEqual(untagged.type, 'wind-turbine', 'type 0 with the OSM wind tag');
  assert.strictEqual(tower.type, 'tower');
  for (const o of d.obstacles) assert.ok(aero.OBSTACLE_TYPES[o.type]);
});

test('pagination: all pages by totalPages, and bbox pages until a short one', async () => {
  const dir = tmp();
  const many = (n, off) => Array.from({ length: n }, (_, i) => ({ _id: 'o' + (off + i), name: 'M', type: 4, geometry: { type: 'Point', coordinates: [5 + i / 1e4, 52] }, elevation: { value: 1, unit: 0 } }));
  const f = fake([
    [/\/obstacles\?country=NL.*page=(\d)/, (u) => { const p = +/page=(\d)/.exec(u)[1]; return { limit: 1000, totalCount: 2500, totalPages: 3, page: p, items: many(p < 3 ? 1000 : 500, (p - 1) * 1000) }; }],
    [/\/obstacles\?bbox=/, (u) => { const p = +/page=(\d)/.exec(u)[1]; return { limit: 1000, page: p, items: many(p === 1 ? 1000 : 3, (p - 1) * 1000) }; }],
    [/\?(country|bbox)=/, { limit: 1000, page: 1, items: [] }],
  ]);
  begin(dir, f);
  const d = await aero.data({ countries: ['NL'] });
  assert.strictEqual(d.ok, true);
  assert.strictEqual(d.obstacles.length, 2500);
  assert.strictEqual(f.count(/obstacles\?country=NL/), 3);
  assert.ok(f.calls.every((c) => /limit=1000/.test(c.url)));
  assert.strictEqual(f.calls[0].opts.headers['x-openaip-api-key'], KEY);
  assert.match(f.calls[0].opts.headers['User-Agent'], /^P-ALV-Dashboard\//);
  assert.ok(f.calls[0].opts.timeoutMs > 0);
  assert.strictEqual(d.attribution, '© openAIP (CC BY-NC 4.0)');

  const a = await aero.area([52, 5, 52.5, 5.2]);
  assert.strictEqual(f.count(/obstacles\?bbox=5,50,10,55&/), 2, 'a full page asks for the next one');
  assert.ok(a.obstacles.length > 0 && a.obstacles.every((o) => o.lon >= 5 && o.lon <= 5.2), 'filtered to the asked area');
  assert.deepStrictEqual(Object.keys(a.fetchedAt), ['50_5']);
  assert.ok(fs.existsSync(path.join(dir, 'plan-aero-tile-50_5.json')));
  const again = await aero.area([52, 5, 52.5, 5.2]);
  assert.strictEqual(f.count(/obstacles\?bbox=/), 2, 'the tile comes from the cache');
  assert.strictEqual(again.obstacles.length, a.obstacles.length);
  assert.deepStrictEqual((await aero.area([0, 0, 40, 40])).errors.length, 1, 'too many tiles');
  assert.strictEqual((await aero.area([5, 5, 4, 4])).ok, false);
});

test('tiles of 5 degrees cover the area', () => {
  assert.deepStrictEqual(aero.tilesFor([51, 3, 54, 7.5]).map((t) => t.id), ['50_0', '50_5']);
  assert.deepStrictEqual(aero.tilesFor([-1, -1, 1, 1]).map((t) => t.id), ['-5_-5', '-5_0', '0_-5', '0_0']);
});

test('429 is retried after a wait; a refusal is not', async () => {
  const dir = tmp();
  let n = 0;
  const f = fake([
    [/\/airspaces\?/, () => { if (n++ < 2) throw Object.assign(new Error('HTTP 429'), { status: 429 }); return fixture('airspaces'); }],
    ...fixtureRoutes(),
  ]);
  sleeps.length = 0;
  begin(dir, f);
  const d = await aero.data({ countries: ['NL'] });
  assert.strictEqual(d.ok, true);
  assert.strictEqual(f.count(/airspaces/), 3);
  assert.deepStrictEqual(sleeps, [5, 10], 'growing waits');
  assert.strictEqual(d.airspaces.length, 7);
  assert.strictEqual(d.airports.length, 5);
});

test('cache: served from disk at once, refreshed in the background when old', async () => {
  const dir = tmp();
  const old = { v: 1, id: 'NL', fetchedAt: Date.now() - 8 * DAY, airac: 'x', data: aero.normalize({ navaids: fixture('navaids').items }), errors: [] };
  fs.writeFileSync(path.join(dir, 'plan-aero-NL.json'), JSON.stringify(old));
  const f = fake(fixtureRoutes());
  begin(dir, f);
  assert.deepStrictEqual(aero.status().counts.NL.navaids, 2, 'status knows the disk cache at start');
  const d = await aero.data({ countries: ['NL'] });
  assert.strictEqual(d.navaids.length, 2);
  assert.strictEqual(d.airspaces.length, 0, 'the old cache, not waiting for the network');
  assert.strictEqual(d.fetchedAt.NL, old.fetchedAt);
  await settle();
  assert.strictEqual(f.count(/./), 5, 'five lists fetched in the background');
  const d2 = await aero.data({ countries: ['NL'] });
  assert.strictEqual(d2.airspaces.length, 7);
  assert.ok(d2.fetchedAt.NL > old.fetchedAt);
  const disk = JSON.parse(fs.readFileSync(path.join(dir, 'plan-aero-NL.json'), 'utf8'));
  assert.strictEqual(disk.data.airspaces.length, 7);
  assert.strictEqual(disk.airac, aero.airac().ident);
  await aero.data({ countries: ['NL'] });
  assert.strictEqual(f.count(/./), 5, 'fresh cache: no new requests');

  // A new start reads the fresh cache from disk and asks nothing.
  const f2 = fake([]);
  begin(dir, f2);
  assert.strictEqual((await aero.data({ countries: ['NL'] })).airspaces.length, 7);
  assert.strictEqual(f2.calls.length, 0);
});

test('a fresh cache from an earlier AIRAC cycle is refreshed', async () => {
  const dir = tmp();
  const prevCycle = aero.airac().start - 1000;
  fs.writeFileSync(path.join(dir, 'plan-aero-NL.json'), JSON.stringify({ v: 1, id: 'NL', fetchedAt: prevCycle, data: aero.normalize({}), errors: [] }));
  const f = fake(fixtureRoutes());
  begin(dir, f);
  await aero.data({ countries: ['NL'] });
  await settle();
  assert.ok(f.count(/airspaces/) >= 1);
});

test('without a key: no requests, a Dutch message, the cache still served', async () => {
  const dir = tmp();
  const f = fake(fixtureRoutes());
  begin(dir, f, false);
  const d = await aero.data({ countries: ['NL', 'BE'] });
  assert.strictEqual(d.ok, false);
  assert.deepStrictEqual(d.errors, ['Geen openAIP-sleutel ingesteld']);
  assert.strictEqual(f.calls.length, 0);
  assert.strictEqual(aero.status().configured, false);
});

test('setKey: stored with mode 0600, checked with one small request, never shown', async () => {
  const dir = tmp();
  const f = fake(fixtureRoutes());
  begin(dir, f, false);
  const st = await aero.setKey('  ' + KEY + ' ');
  assert.strictEqual(f.calls.length, 1);
  assert.match(f.calls[0].url, /limit=1&/);
  assert.strictEqual(f.calls[0].opts.headers['x-openaip-api-key'], KEY);
  assert.strictEqual(st.configured, true);
  assert.strictEqual(st.ok, true);
  const file = path.join(dir, 'openaip.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).key, KEY);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  await aero.data({ countries: ['NL'] });
  assert.ok(!JSON.stringify(aero.status()).includes(KEY), 'status never contains the key');
  assert.ok(!fs.readFileSync(path.join(dir, 'plan-aero-NL.json'), 'utf8').includes(KEY), 'nor does the cache');

  // A refused key is not stored.
  const dir2 = tmp();
  begin(dir2, fake([[/./, () => { throw Object.assign(new Error('HTTP 401'), { status: 401 }); }]]), false);
  const bad = await aero.setKey('wrong');
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.configured, false);
  assert.match(bad.lastError, /weigert/);
  assert.ok(!fs.existsSync(path.join(dir2, 'openaip.json')));

  // An empty key removes it.
  begin(dir, f);
  assert.strictEqual(aero.status().configured, true);
  assert.strictEqual((await aero.setKey('')).configured, false);
  assert.ok(!fs.existsSync(file));
});

test('a failing country is reported, the others still come', async () => {
  const dir = tmp();
  const f = fake([
    [/country=BE/, () => { throw Object.assign(new Error('HTTP 500'), { status: 500 }); }],
    ...fixtureRoutes(),
  ]);
  begin(dir, f);
  const d = await aero.data({ countries: ['NL', 'BE'] });
  assert.strictEqual(d.ok, false);
  assert.strictEqual(d.airspaces.length, 7);
  assert.ok(d.errors.some((e) => /^BE: .*HTTP 500/.test(e)), d.errors.join('|'));
  assert.deepStrictEqual(Object.keys(d.fetchedAt), ['NL']);
  const n = f.calls.length;
  await aero.data({ countries: ['NL', 'BE'] });
  assert.strictEqual(f.calls.length, n, 'not asked again right away');
});
