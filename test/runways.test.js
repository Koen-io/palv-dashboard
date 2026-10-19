// Runway use at Schiphol: Casper per flight first, ADS-B as fallback, and the one-way runways never the
// wrong way round. `node test/runways.test.js`.
//
// The ADS-B thresholds were tuned by replaying a week of Casper radar tracks (positions, altitudes and
// speeds of every flight) through classify() and comparing with Casper's runway per flight: 1516 flights,
// 3 wrong (light jets on the Oostbaan), none of them a departure from 36R. The old, wider departure cone
// had 16 wrong, among them 36C departures turning right that were counted as departures from 36R.
const assert = require('assert');
const runways = require('../src/runways');

const NOW = Date.now();

/* ---------- runway designators from Casper ---------- */
assert.strictEqual(runways.rwyId(24), '24', 'a number becomes the designator');
assert.strictEqual(runways.rwyId(6), '06', 'with the leading zero');
assert.strictEqual(runways.rwyId('36c'), '36C');
assert.strictEqual(runways.rwyId('05'), null, 'not a Schiphol runway (Eindhoven, Lelystad, ...)');
assert.strictEqual(runways.rwyId(null), null);

/* ---------- ADS-B classification ---------- */
const base = { gs: 160, category: 'A3' };
// Climbing out straight ahead beyond the north end of the Polderbaan: departure 36L.
let hit = runways.classify({ ...base, lat: 52.375, lon: 4.7128, alt_baro: 1500, track: 357, baro_rate: 2200 });
assert.deepStrictEqual(hit && [hit.mode, hit.rwy], ['departure', '36L']);
// Climbing north beyond the north end of the Aalsmeerbaan: that runway is never used for departures.
hit = runways.classify({ ...base, lat: 52.34, lon: 4.7818, alt_baro: 1500, track: 357, baro_rate: 2200 });
assert.ok(!hit || hit.mode !== 'departure' || hit.rwy !== '36R', 'never a departure from 36R');
// On final for 18R from the north.
hit = runways.classify({ ...base, gs: 140, lat: 52.42, lon: 4.7175, alt_baro: 1150, track: 183, baro_rate: -700 });
assert.deepStrictEqual(hit && [hit.mode, hit.rwy], ['landing', '18R']);
// The same strip from the south (36L) is never a landing runway.
hit = runways.classify({ ...base, gs: 140, lat: 52.30, lon: 4.7077, alt_baro: 1000, track: 357, baro_rate: -700 });
assert.ok(!hit || hit.rwy !== '36L', 'never a landing on 36L');
// Helicopters do not count.
assert.strictEqual(runways.classify({ ...base, category: 'A7', lat: 52.375, lon: 4.7128, alt_baro: 1500, track: 357, baro_rate: 2200 }), null);

/* ---------- ADS-B feed: an aircraft keeps the runway it departed from ---------- */
runways.reset();
const feed = (recs, now) => runways.ingest(new Map(recs.map((r) => [r.hex, { posAt: now, cat: 'A3', gs: 160, ...r }])), now);
// Two departures from 36L, one landing on 06.
feed([{ hex: 'a', lat: 52.375, lon: 4.7128, alt: 1500, track: 357, vs: 2200 }, { hex: 'b', lat: 52.37, lon: 4.7124, alt: 1200, track: 357, vs: 2000 }], NOW - 60000);
feed([{ hex: 'c', gs: 140, lat: 52.262, lon: 4.668, alt: 1500, track: 57, vs: -700 }], NOW - 30000);
let snap = runways.snapshot(NOW);
assert.strictEqual(snap.source, 'adsb', 'nothing from Casper yet');
assert.deepStrictEqual(snap.departure.map((r) => r.rwy), ['36L']);
assert.deepStrictEqual(snap.landing.map((r) => r.rwy), ['06']);

/* ---------- Casper: per flight, ahead of ADS-B ---------- */
const at = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const flights = [
  { id: 1, dep_af: 'EHAM', dep_rwy: '36C', dep_time: at(NOW - 120000), 'at.propulsion': 'J', _wvc: 'MEDIUM' },
  { id: 2, dep_af: 'EHAM', dep_rwy: '36C', dep_time: at(NOW - 60000), 'at.propulsion': 'J', _wvc: 'HEAVY' },
  { id: 3, dep_af: 'EHAM', dep_rwy: 24, dep_time: at(NOW - 90000), 'at.propulsion': 'J', _wvc: 'MEDIUM' },
  { id: 4, dep_af: 'EHAM', dep_rwy: 24, 'at.propulsion': 'J', _wvc: 'MEDIUM' }, // just airborne
  { id: 5, des_af: 'EHAM', des_rwy: '18R', des_time: at(NOW - 100000), 'at.propulsion': 'J' },
  { id: 6, des_af: 'EHAM', des_rwy: '18R', 'at.propulsion': 'J' }, // inbound, cleared for 18R
  { id: 7, des_af: 'EHAM', des_rwy: '18R', 'at.propulsion': 'J' },
  { id: 8, dep_af: 'EHAM', dep_rwy: '36R', dep_time: at(NOW - 30000), 'at.propulsion': 'J' }, // impossible
  { id: 9, dep_af: 'EHAM', dep_rwy: '04', dep_time: at(NOW - 30000), 'at.propulsion': 'J', _wvc: 'LIGHT' },
  { id: 10, dep_af: 'EHAM', dep_rwy: '04', dep_time: at(NOW - 20000), 'at.propulsion': 'P' },
  { id: 11, dep_af: 'EHEH', dep_rwy: '03', des_af: 'LEPA', 'at.propulsion': 'J' }, // Eindhoven
  { id: 12, dep_af: 'EHAM', dep_rwy: '36L', dep_time: at(NOW - 40 * 60000), 'at.propulsion': 'J' }, // long ago
];
let asked = null;
runways.pollCasper(async (url) => { asked = url; return { '/flight/updates': flights }; }, NOW).then(() => {
  assert.ok(asked.startsWith('https://bas.flighttracking.casper.aero/?/timeline&urls[0]=%2Fflight%2Fupdates&initial=true'));
  snap = runways.snapshot(Date.now());
  assert.strictEqual(snap.source, 'casper');
  assert.ok(snap.ok);
  assert.deepStrictEqual(snap.departure.map((r) => r.rwy).sort(), ['24', '36C'], 'no 36R, no light aircraft, no Eindhoven, nothing old');
  assert.deepStrictEqual(snap.landing.map((r) => [r.rwy, r.count]), [['18R', 3]]);
  assert.deepStrictEqual(snap.adsb.departure.map((r) => r.rwy), ['36L'], 'ADS-B keeps running alongside');

  // A cleared runway that changes moves the flight along.
  runways.ingestCasper([{ id: 6, des_af: 'EHAM', des_rwy: '18C', 'at.propulsion': 'J' }], Date.now());
  snap = runways.snapshot(Date.now());
  assert.deepStrictEqual(snap.landing.map((r) => [r.rwy, r.count]), [['18R', 2], ['18C', 1]], 'flight 6 moved from 18R to 18C');

  // Casper silent for minutes: back to ADS-B.
  snap = runways.snapshot(Date.now() + 5 * 60000);
  assert.strictEqual(snap.source, 'adsb');
  console.log('runways: ok');
});
