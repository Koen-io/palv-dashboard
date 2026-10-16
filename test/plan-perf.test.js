// Zoek & Plan: rekenen op de aardbol en vliegprestaties. `node --test test/plan-perf.test.js`.
const test = require('node:test');
const assert = require('assert');
const G = require('../src/renderer/plan/geo.js');
const P = require('../src/renderer/plan/perf.js');
const U = require('../src/renderer/plan/units.js');

const EHAM = { lat: 52.3086, lon: 4.7639 }, EHRD = { lat: 51.9569, lon: 4.4375 };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≉ ${b} (±${tol})`);

test('distance and course', () => {
  // One minute of latitude is one nautical mile, near enough (1852 m by definition, 1853 on this sphere).
  near(G.dist({ lat: 52, lon: 5 }, { lat: 52 + 1 / 60, lon: 5 }), 1853.2, 0.5, '1 boogminuut');
  // Schiphol – Rotterdam: about 24.3 NM on course 210°.
  near(G.dist(EHAM, EHRD) / 1852, 24.3, 0.2, 'EHAM-EHRD');
  near(G.bearing(EHAM, EHRD), 209.7, 0.3, 'koers EHAM-EHRD');
  const d = G.dest(EHAM, 90, 10 * 1852);
  near(G.dist(EHAM, d), 10 * 1852, 0.01, 'dest/dist round trip');
  near(G.bearing(EHAM, d), 90, 0.01);
  const mid = G.interp(EHAM, EHRD, 0.5);
  near(G.dist(EHAM, mid), G.dist(mid, EHRD), 0.01, 'midpoint');
});

test('route: point at a distance and the nearest point', () => {
  const r = G.measure([EHAM, EHRD, { lat: 51.4500, lon: 5.3742 }]);
  near(r.total, r.cum[1] + G.dist(EHRD, { lat: 51.45, lon: 5.3742 }), 0.01);
  const p = G.pointAt(r, r.cum[1] + 1000);
  assert.strictEqual(p.leg, 1);
  near(G.dist(EHRD, p), 1000, 0.5);
  const n = G.nearest(r, G.dest(G.interp(EHAM, EHRD, 0.25), 300, 2000));
  assert.strictEqual(n.leg, 0);
  near(n.off, 2000 * Math.abs(Math.sin(G.rad(300 - G.bearing(EHAM, EHRD)))), 15, 'off-track');
});

test('crossings of a polygon', () => {
  // A square of 0.2° around 52.1, 4.6; the route from EHAM to EHRD runs through it.
  const sq = { type: 'Polygon', coordinates: [[[4.5, 52.0], [4.7, 52.0], [4.7, 52.2], [4.5, 52.2], [4.5, 52.0]]] };
  const r = G.measure([EHAM, EHRD]);
  const x = G.crossings(r, sq);
  assert.strictEqual(x.length, 1);
  const enter = G.pointAt(r, x[0].from), leave = G.pointAt(r, x[0].to);
  near(enter.lat, 52.2, 0.0005, 'in at the north edge');
  assert.ok(leave.lat > 51.99 && leave.lat < 52.01 || leave.lon < 4.501, 'out at the south or west edge');
  assert.ok(G.inGeometry(sq, 52.1, 4.6));
  assert.ok(!G.inGeometry(sq, 52.1, 4.8));
});

test('wind triangle', () => {
  const t = P.triangle(360, 100, 90, 20);
  near(t.wca, 11.54, 0.01, 'wca');
  near(t.heading, 11.54, 0.01);
  near(t.gs, 97.98, 0.01, 'gs');
  near(P.triangle(360, 100, 360, 20).gs, 80, 1e-9, 'headwind');
  near(P.triangle(360, 100, 180, 20).gs, 120, 1e-9, 'tailwind');
  assert.strictEqual(P.triangle(0, 30, 90, 40), null, 'too much crosswind');
  const c = P.components(270, 300, 20);
  near(c.head, 17.32, 0.01); near(c.cross, 10, 0.01);
  const m = P.meanWind([{ dirDeg: 350, speedKt: 10 }, { dirDeg: 10, speedKt: 10 }]);
  near(G.norm180(m.dirDeg), 0, 1e-9, 'vector mean across north'); near(m.speedKt, 9.848, 0.001);
});

test('atmosphere and true airspeed', () => {
  near(P.densityAltitude(0, 15), 0, 1, 'ISA sea level');
  near(P.densityAltitude(0, 30), 1725, 30, '+15 °C ≈ 1725 ft');
  // 120 KIAS at 5000 ft ISA ≈ 129 KTAS.
  near(P.tasFromIas(120, 5000), 129, 0.6);
  near(P.iasFromTas(P.tasFromIas(120, 3000, 20), 3000, 20), 120, 1e-9);
});

test('VNE from a chart', () => {
  const t = [
    { weightKg: 2300, hpFt: 0, oatC: -20, kias: 155 }, { weightKg: 2300, hpFt: 0, oatC: 40, kias: 150 },
    { weightKg: 2300, hpFt: 10000, oatC: -20, kias: 140 }, { weightKg: 2300, hpFt: 10000, oatC: 40, kias: 130 },
    { weightKg: 2910, hpFt: 0, oatC: -20, kias: 140 }, { weightKg: 2910, hpFt: 0, oatC: 40, kias: 140 },
  ];
  near(P.vneAt(t, { weightKg: 2000, paFt: 0, oatC: -20 }).kias, 155, 1e-9);
  near(P.vneAt(t, { weightKg: 2000, paFt: 5000, oatC: 10 }).kias, (152.5 + 135) / 2, 1e-9, 'bilinear');
  const edge = P.vneAt(t, { weightKg: 2000, paFt: 20000, oatC: 50 });
  near(edge.kias, 130, 1e-9, 'clamped at the edge');
  assert.strictEqual(edge.exact, false, 'beyond the chart is flagged');
  const heavy = P.vneAt(t, { weightKg: 2800, paFt: 5000, oatC: 10 });
  assert.strictEqual(heavy.band, 2910);
  assert.strictEqual(heavy.exact, false);
  assert.strictEqual(heavy.kias, 140, 'missing corners: lowest known neighbour');
});

test('fuel flow from a table', () => {
  const t = [{ kias: 80, weightKg: 2400, hpFt: 0, kgh: 160 }, { kias: 120, weightKg: 2400, hpFt: 0, kgh: 200 }, { kias: 80, weightKg: 2900, hpFt: 0, kgh: 180 }, { kias: 120, weightKg: 2900, hpFt: 0, kgh: 230 }];
  near(P.flowAt(t, { kias: 100, weightKg: 2400, paFt: 0 }).kgh, 180, 1e-9, 'on a curve');
  const mid = P.flowAt(t, { kias: 100, weightKg: 2650, paFt: 0 }).kgh;
  assert.ok(mid > 180 && mid < 205, 'between two weights');
  assert.deepStrictEqual(P.flowAt(null, { kias: 100 }, 210), { kgh: 210, src: 'planning' });
});

test('a route flown with wind', () => {
  const pts = [EHAM, EHRD];
  const calm = P.planRoute({ points: pts, tasKt: 120, flowKgh: 240, fuelKg: 500, taxiKg: 20, reserveKg: 100 });
  const nm = G.dist(EHAM, EHRD) / 1852;
  near(calm.total.timeMin, (nm / 120) * 60, 0.01, 'calm: distance / TAS');
  near(calm.legs[0].fuelRemKg, 480 - (240 * calm.total.timeMin) / 60, 1e-6);
  near(calm.total.fuelKg, (240 * calm.total.timeMin) / 60 + 20, 1e-6);
  // A 30 kt wind straight on the nose (the course is ~210°).
  const head = P.planRoute({ points: pts, tasKt: 120, flowKgh: 240, windAt: () => ({ dirDeg: G.bearing(EHAM, EHRD), speedKt: 30 }) });
  near(head.total.timeMin, (nm / 90) * 60, 0.05, 'headwind 30 kt');
  near(head.legs[0].gs, 90, 0.1);
  // Magnetic course: with 2° east variation the magnetic course is 2° less.
  const mag = P.planRoute({ points: pts, tasKt: 120, magVar: () => 2 });
  near(mag.legs[0].mc, G.norm360(mag.legs[0].tc - 2), 1e-9);
  // Halfway along, time and fuel are half.
  const half = P.sampleAt(calm, calm.total.distM / 2);
  near(half.tMin, calm.total.timeMin / 2, 0.01);
});

test('point of no return and reach', () => {
  // 100 kt, 60 kg of usable fuel at 120 kg/h = 30 min: calm, the PNR lies 25 NM out (12.5 min there and back... ).
  const far = G.dest(EHAM, 90, 100 * 1852);
  const plan = P.planRoute({ points: [EHAM, far], tasKt: 100, flowKgh: 120, fuelKg: 60 });
  const pnr = P.pointOfReturn(plan, { home: EHAM, tasKt: 100, flowKgh: 120 });
  near(pnr.m / 1852, 25, 0.05, 'calm PNR = half the endurance');
  assert.strictEqual(pnr.beyond, true);
  // With 20 kt of tailwind out: out 120, back 80 → 30 min * 120*80/200 = 24 NM.
  const windy = () => ({ dirDeg: 270, speedKt: 20 });
  const plan2 = P.planRoute({ points: [EHAM, far], tasKt: 100, flowKgh: 120, fuelKg: 60, windAt: windy });
  near(P.pointOfReturn(plan2, { home: EHAM, tasKt: 100, flowKgh: 120, windAt: windy }).m / 1852, 24, 0.1, 'PNR with wind');
  const ring = P.reach(EHAM, { tasKt: 100, minutes: 30, wind: { dirDeg: 270, speedKt: 20 } });
  const east = ring.find((r) => r.brg === 90);
  near(east.m / 1852, 24, 0.01, 'radius of action east');
  const north = ring.find((r) => r.brg === 0);
  near(north.m / 1852, (0.5 * 97.98 * 97.98) / (2 * 97.98), 0.01, 'radius of action across the wind');
});

test('orbit', () => {
  // 90 KTAS at 30° bank: r = V²/(g tan 30°) ≈ 378 m.
  near(P.turnRadius(90, 30), 378.3, 0.5);
  const o = P.orbit({ tasKt: 90, radiusM: 500, windKt: 20 });
  assert.ok(o.bankMax > o.bankCalm && o.bankCalm > o.bankMin);
  near(P.bankFor(90, P.turnRadius(90, 30)), 30, 1e-9);
});

test('search patterns', () => {
  const D = { lat: 52.5, lon: 4.5 };
  const ss = P.expandingSquare(D, { spacingM: 1852, legs: 4, firstTrack: 0 });
  assert.strictEqual(ss.length, 5);
  near(G.dist(ss[0], ss[1]), 1852, 0.5); near(G.dist(ss[2], ss[3]), 3704, 1);
  near(G.bearing(ss[1], ss[2]), 90, 0.1, 'right turns');
  const vs = P.sectorSearch(D, { radiusM: 1852 * 2 });
  assert.strictEqual(vs.length, 10);
  for (let i = 1; i < vs.length; i += 1) near(G.dist(vs[i - 1], vs[i]), 3704, 3, `leg ${i} = R`);
  near(G.dist(vs[3], D), 0, 0.01, 'through the datum');
  const cs = P.ladder(D, { lengthM: 10 * 1852, widthM: 4 * 1852, spacingM: 1852, axis: 0 });
  assert.strictEqual(cs.length, 20, '10 legs across the long axis');
  near(G.dist(cs[0], cs[1]), 3 * 1852, 3, 'leg = width - S');
});

test('units', () => {
  assert.strictEqual(U.fmtDist(1852 * 12.34, 'nm'), '12 NM');
  assert.strictEqual(U.fmtDist(1852 * 2.345, 'nm'), '2,3 NM');
  assert.strictEqual(U.fmtDist(1500, 'km'), '1,5 km');
  assert.strictEqual(U.fmtSpeed(100, 'kmh'), '185 km/u');
  assert.strictEqual(U.fmtAlt(1500, 'm'), '455 m');
  assert.strictEqual(U.hdg(0), '360°');
  assert.strictEqual(U.hdg(5.4), '005°');
  assert.strictEqual(U.fmtWind(270, 15), '270° / 15 kt');
  assert.strictEqual(U.fmtWindSpeed(25, 'bft'), '6 Bft');
  assert.strictEqual(U.fmtDur(65), '1:05');
  assert.strictEqual(U.fmtDur(45, true), '45 min');
  near(U.fuelKg(U.fuelIn(500, 'l', 0.79), 'l', 0.79), 500, 1e-9);
});

test('fuel policy: required fuel and final reserve', () => {
  // AW139 VFR day: 20 min at best range (389 kg/h) is 130 kg, the fixed 200 kg is higher and counts.
  const frf = P.finalReserve({ minutes: 20, flowKgh: 389, fixedKg: 200 });
  near(frf.fromMin, 129.67, 0.01); assert.strictEqual(frf.kg, 200); assert.strictEqual(frf.by, 'fixed');
  // Without a fixed figure the minutes count.
  assert.strictEqual(P.finalReserve({ minutes: 30, flowKgh: 160 }).kg, 80);
  // 5 % contingency over trip and alternate.
  const f = P.fuelPlan({ taxiKg: 30, tripKg: 400, alternateKg: 100, contingencyPct: 5, finalReserveKg: 200, extraKg: 0, onBoardKg: 800 });
  near(f.contingencyKg, 25, 1e-9); near(f.requiredKg, 755, 1e-9); near(f.marginKg, 45, 1e-9);
});
