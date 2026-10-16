// Wind for the planning map: grid shape and order, the u/v convention, caching, vertical interpolation,
// the budget guard and 429 backoff. Open-Meteo is faked with recorded answers. `node --test test/plan-wind.test.js`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const wind = require('../src/plan/wind');

const FIX = path.join(__dirname, 'fixtures', 'plan-wind');
const GRID = JSON.parse(fs.readFileSync(path.join(FIX, 'grid-nl.json'), 'utf8'));
const POINTS = JSON.parse(fs.readFileSync(path.join(FIX, 'points-nl.json'), 'utf8'));
const T0 = GRID[0].hourly.time[0] * 1000; // 10:00 UTC, hour 0 of the recordings
let clock = T0 + 20 * 60000;
const now = () => clock;
const quiet = { info() {}, warn() {} };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-wind-'));

// A fake Open-Meteo: answers any list of locations from the recordings (cycled), with the location's
// index as the 10 m speed of hour 0 so the order can be checked. `hook` may change or refuse an answer.
function fake(hook) {
  const calls = [];
  const fetchJson = async (url, opts = {}) => {
    const q = new URLSearchParams(opts.method === 'POST' ? opts.body : url.split('?')[1]);
    const lats = q.get('latitude').split(',').map(Number), lons = q.get('longitude').split(',').map(Number);
    const vars = q.get('hourly').split(',');
    const call = { url, method: opts.method, lats, lons, vars, model: q.get('models'), hours: Number(q.get('forecast_hours')) };
    calls.push(call);
    const src = vars.includes('geopotential_height_850hPa') ? POINTS : GRID;
    let out = lats.map((lat, i) => {
      const x = JSON.parse(JSON.stringify(src[i % src.length]));
      x.latitude = lat; x.longitude = lons[i];
      if (src === GRID) x.hourly.wind_speed_10m[0] = i;
      return x;
    });
    if (hook) out = hook(out, call);
    return out.length === 1 ? out[0] : out;
  };
  return { calls, fetchJson };
}

test('u/v: wind from 270° at 10 kt blows east', () => {
  assert.deepStrictEqual(wind.uv(10, 270), { u: 10, v: 0 });
  assert.deepStrictEqual(wind.uv(10, 360), { u: 0, v: -10 });
  assert.deepStrictEqual(wind.uv(10, 90), { u: -10, v: 0 });
  const back = wind.fromUv(wind.uv(12, 225).u, wind.uv(12, 225).v);
  assert.ok(Math.abs(back.speed - 12) < 0.05 && Math.abs(back.dirFrom - 225) < 0.5);
});

test('snapBox: nice spacing, outward, bounded, stable when panning a little', () => {
  const nl = wind.snapBox([50.7, 3.3, 53.6, 7.3]);
  assert.deepStrictEqual(nl, { south: 50.5, west: 3, north: 54, east: 7.5, dx: 0.5, dy: 0.5, nx: 10, ny: 8 });
  assert.deepStrictEqual(wind.snapBox([50.75, 3.35, 53.65, 7.35]), nl, 'a little pan hits the same box');
  for (const b of [[52.31, 4.71, 52.33, 4.74], [51.9, 4.2, 52.6, 5.1], [30, -20, 70, 40], [-90, -180, 90, 180], [60, 170, 70, -170]]) {
    const s = wind.snapBox(b);
    assert.ok(s.nx * s.ny <= 192, JSON.stringify(b));
    assert.ok(s.south >= -85 && s.north <= 85 && s.west >= -180 && s.east <= 180, JSON.stringify(s));
    assert.ok([0.05, 0.1, 0.125, 0.25, 0.5, 1, 2, 2.5, 5, 10].includes(s.dx));
  }
  assert.strictEqual(wind.snapBox([60, 170, 70, -170]).east, 180, 'antimeridian: cut at 180');
  assert.strictEqual(wind.snapBox(['x', 1, 2, 3]), null);
});

test('grid: shape, order north to south and west to east, cached for all levels and hours', async () => {
  const f = fake();
  const dir = tmp();
  clock = T0 + 20 * 60000;
  wind.start({ dir, fetchJson: f.fetchJson, log: quiet, now });
  const g = await wind.grid({ bbox: [52, 4, 53, 6], level: '10m', hour: 0 });
  assert.strictEqual(g.ok, true);
  assert.strictEqual(f.calls.length, 1);
  const c = f.calls[0];
  assert.strictEqual(c.lats.length, g.nx * g.ny);
  assert.ok(c.lats.length <= 192);
  assert.strictEqual(c.vars.length, 10, '10 variables: 1 call per location');
  assert.strictEqual(c.model, 'icon_seamless');
  assert.strictEqual(c.hours, 13);
  assert.strictEqual(c.method, 'POST', 'many locations go in the body');
  assert.strictEqual(g.la1, 53); assert.strictEqual(g.lo1, 4);
  assert.deepStrictEqual([c.lats[0], c.lons[0]], [53, 4], 'first is north-west');
  assert.deepStrictEqual([c.lats[1], c.lons[1]], [53, 4 + g.dx], 'then east');
  assert.deepStrictEqual([c.lats[g.nx], c.lons[g.nx]], [53 - g.dy, 4], 'next row is further south');
  assert.deepStrictEqual(g.speedKt.slice(0, 4), [0, 1, 2, 3], 'values in request order');
  assert.strictEqual(g.u.length, g.nx * g.ny);
  assert.strictEqual(g.validTime, T0, 'hour 0 is the current hour');
  assert.strictEqual(g.times.length, 13);
  assert.strictEqual(g.model, 'icon_seamless');

  // Another level and hour: from the cache, no request.
  const g2 = await wind.grid({ bbox: [52, 4, 53, 6], level: '950', hour: 3 });
  assert.strictEqual(f.calls.length, 1);
  assert.strictEqual(g2.validTime, T0 + 3 * 3600000);
  assert.strictEqual(g2.speedKt[0], GRID[0].hourly.wind_speed_950hPa[3]);
  assert.strictEqual(g2.dirDeg[0], GRID[0].hourly.wind_direction_950hPa[3]);
  const w = wind.uv(g2.speedKt[0], g2.dirDeg[0]);
  assert.deepStrictEqual([g2.u[0], g2.v[0]], [w.u, w.v]);

  // An hour later the same grid's hour 1 is the new hour 0.
  clock = T0 + 65 * 60000;
  const g3 = await wind.grid({ bbox: [52, 4, 53, 6], level: '950', hour: 0 });
  assert.strictEqual(f.calls.length, 1, 'still fresh (fetched 45 min ago)');
  assert.strictEqual(g3.validTime, T0 + 3600000);

  // A restart reads the cache from disk.
  const f2 = fake();
  wind.start({ dir, fetchJson: f2.fetchJson, log: quiet, now });
  assert.strictEqual((await wind.grid({ bbox: [52, 4, 53, 6], level: '850', hour: 2 })).ok, true);
  assert.strictEqual(f2.calls.length, 0);
  assert.ok(fs.existsSync(path.join(dir, 'plan-wind-cache.json')));

  // After 60 minutes it is fetched again.
  clock = T0 + 90 * 60000;
  await wind.grid({ bbox: [52, 4, 53, 6], level: '850', hour: 0 });
  assert.strictEqual(f2.calls.length, 1);
});

test('grid: identical concurrent requests share one fetch; regions pick their model', async () => {
  const f = fake();
  clock = T0 + 20 * 60000;
  wind.start({ dir: tmp(), fetchJson: f.fetchJson, log: quiet, now });
  const [a, b] = await Promise.all([wind.grid({ bbox: [52, 4, 53, 6], level: '10m' }), wind.grid({ bbox: [52, 4, 53, 6], level: '975' })]);
  assert.ok(a.ok && b.ok);
  assert.strictEqual(f.calls.length, 1);
  // A second large grid in the same minute would go past half the minute limit: refused, asked later.
  const soon = await wind.grid({ bbox: [38, -106, 41, -103], level: '850' });
  if (wind.budget().minute + 150 > wind.LIMITS.minute * wind.MARGIN.minute) assert.strictEqual(soon.ok, false);
  clock += 61000;
  const us = await wind.grid({ bbox: [38, -106, 41, -103], level: '850' });
  assert.strictEqual(us.model, 'gfs_seamless');
});

test('budget: the other screens behind the same connection count along', async () => {
  const f = fake();
  clock = T0 + 20 * 60000;
  // The others already used 6900 of today's 7000 (70 %): one more grid does not fit.
  wind.start({ dir: tmp(), fetchJson: f.fetchJson, log: quiet, now, others: () => ({ day: 6900, hour: 0, minute: 0 }) });
  const g = await wind.grid({ bbox: [52, 4, 53, 6], level: '10m' });
  assert.strictEqual(g.ok, false);
  assert.strictEqual(f.calls.length, 0, 'nothing asked');
  assert.strictEqual(wind.budget().others.day, 6900);
  // Own use for the others to count: none yet.
  assert.strictEqual(wind.own().day, 0);
  wind.start({ dir: tmp(), fetchJson: f.fetchJson, log: quiet, now, others: () => ({ day: 100, hour: 0, minute: 0 }) });
  assert.ok((await wind.grid({ bbox: [52, 4, 53, 6], level: '10m' })).ok);
  assert.ok(wind.own().day > 0);
});

test('grid: empty values are filled from the other model', async () => {
  const f = fake((out, call) => {
    if (call.model === 'icon_seamless') out[1].hourly.wind_speed_950hPa = out[1].hourly.wind_speed_950hPa.map(() => null);
    else out.forEach((x) => { x.hourly.wind_speed_950hPa = x.hourly.wind_speed_950hPa.map(() => 42); });
    return out;
  });
  clock = T0 + 20 * 60000;
  wind.start({ dir: tmp(), fetchJson: f.fetchJson, log: quiet, now });
  const g = await wind.grid({ bbox: [52, 4, 53, 6], level: '950' });
  assert.strictEqual(f.calls.length, 2);
  assert.strictEqual(f.calls[1].lats.length, 1, 'only the location with gaps is asked again');
  assert.strictEqual(f.calls[1].model, 'gfs_seamless');
  assert.strictEqual(g.speedKt[1], 42);
  assert.strictEqual(g.speedKt[0], GRID[0].hourly.wind_speed_950hPa[0]);
  assert.strictEqual(g.model, 'icon_seamless+gfs_seamless');
});

test('vertical interpolation', () => {
  const nodes = [{ h: 10, speed: 10, dir: 350, t: 15 }, { h: 310, speed: 20, dir: 10, t: 12 }, { h: 1000, speed: 30, dir: 40, t: 8 }];
  const mid = wind.interpLevels(nodes, 160);
  assert.ok(Math.abs(mid.speed - 15) < 1e-9);
  assert.ok(Math.abs(mid.dir - 0) < 1e-9 || Math.abs(mid.dir - 360) < 1e-9, 'direction the short way round: ' + mid.dir);
  assert.ok(Math.abs(mid.t - 13.5) < 1e-9);
  assert.strictEqual(wind.interpLevels(nodes, 0).speed, 10, 'below 10 m: the 10 m wind');
  const top = wind.interpLevels(nodes, 3000);
  assert.strictEqual(top.speed, 30); assert.strictEqual(top.above, true);
  // Pressure levels under the ground (Denver, 1596 m) are left out; missing heights fall back to ISA.
  const hourly = { wind_speed_10m: [3], wind_direction_10m: [40], temperature_2m: [3] };
  for (const [p, gh] of [[975, 565], [950, 780], [900, 1224], [850, 1688]]) Object.assign(hourly, { [`wind_speed_${p}hPa`]: [p / 100], [`wind_direction_${p}hPa`]: [40], [`geopotential_height_${p}hPa`]: [gh] });
  assert.deepStrictEqual(wind.nodesAt(hourly, 0, 1596).map((n) => Math.round(n.h)), [1606, 1688]);
  delete hourly.geopotential_height_975hPa;
  assert.strictEqual(Math.round(wind.nodesAt(hourly, 0, 0)[1].h), Math.round(wind.isaHeightM(975)));
  assert.ok(Math.abs(wind.isaHeightM(950) / 0.3048 - 1770) < 15, 'ISA height of 950 hPa ≈ 1770 ft');
});

test('points: interpolated by the model heights, in order, cached', async () => {
  const f = fake();
  clock = T0 + 20 * 60000;
  wind.start({ dir: tmp(), fetchJson: f.fetchJson, log: quiet, now });
  const h = POINTS[0].hourly, elev = POINTS[0].elevation;
  const g950 = h.geopotential_height_950hPa[0], g900 = h.geopotential_height_900hPa[0];
  const midFt = ((g950 + g900) / 2) / 0.3048;
  const res = await wind.points([
    { lat: 52.31, lon: 4.76, ftAmsl: 0, time: clock },
    { lat: 52.31, lon: 4.76, ftAmsl: midFt, time: clock },
    { lat: 52.95, lon: 4.8, ftAmsl: 900, time: T0 + 2 * 3600000 + 600000 },
    { lat: 'x', lon: 4 },
  ]);
  assert.strictEqual(f.calls.length, 1, 'one request for all points');
  assert.strictEqual(f.calls[0].lats.length, 2, 'same rounded location asked once');
  assert.strictEqual(f.calls[0].vars.length, 20);
  assert.deepStrictEqual([f.calls[0].lats[0], f.calls[0].lons[0]], [52.3, 4.75], 'rounded to 0.05°');
  const [ground, mid, other, bad] = res;
  assert.strictEqual(ground.ok, true);
  assert.strictEqual(ground.speedKt, h.wind_speed_10m[0]);
  assert.strictEqual(ground.dirDeg, h.wind_direction_10m[0]);
  assert.strictEqual(ground.gustKt, h.wind_gusts_10m[0]);
  assert.strictEqual(ground.tempC, h.temperature_2m[0]);
  assert.strictEqual(ground.validTime, T0);
  assert.strictEqual(ground.source, 'Open-Meteo icon_seamless');
  assert.ok(g950 > elev + 10);
  const want = (h.wind_speed_950hPa[0] + h.wind_speed_900hPa[0]) / 2;
  assert.ok(Math.abs(mid.speedKt - want) < 0.06, `${mid.speedKt} vs ${want}`);
  assert.ok(Math.abs(mid.tempC - (h.temperature_950hPa[0] + h.temperature_900hPa[0]) / 2) < 0.06);
  assert.strictEqual(other.validTime, T0 + 2 * 3600000);
  assert.strictEqual(other.gustKt, POINTS[1].hourly.wind_gusts_10m[2]);
  assert.strictEqual(bad.ok, false);

  const again = await wind.points([{ lat: 52.95, lon: 4.8, ftAmsl: 900, time: T0 + 2 * 3600000 }]);
  assert.strictEqual(f.calls.length, 1, 'from the cache');
  assert.deepStrictEqual(again[0], other);

  // Further ahead than the cached 13 hours: asked again, with a longer horizon.
  await wind.points([{ lat: 52.95, lon: 4.8, ftAmsl: 900, time: T0 + 20 * 3600000 }]);
  assert.strictEqual(f.calls.length, 2);
  assert.strictEqual(f.calls[1].hours, 21);
});

test('budget: refuses above 70 % of the day, serves the stale grid', async () => {
  const dir = tmp();
  const f = fake();
  clock = T0 + 20 * 60000;
  wind.start({ dir, fetchJson: f.fetchJson, log: quiet, now });
  await wind.grid({ bbox: [52, 4, 53, 6] });
  assert.strictEqual(wind.budget().day, f.calls[0].lats.length);
  assert.strictEqual(wind.budget().dayLimit, 10000);
  assert.strictEqual(wind.callCost(10, 20), 20);
  assert.strictEqual(wind.callCost(10, 10), 10);

  // A day counter near the limit, persisted on disk, survives a restart.
  fs.writeFileSync(path.join(dir, 'plan-wind-budget.json'), JSON.stringify({ day: new Date(clock).toISOString().slice(0, 10), used: 8499 }));
  wind.start({ dir, fetchJson: f.fetchJson, log: quiet, now });
  clock = T0 + 100 * 60000; // the cached grid is no longer fresh
  const g = await wind.grid({ bbox: [52, 4, 53, 6], level: '950' });
  assert.strictEqual(f.calls.length, 1, 'no request sent');
  assert.strictEqual(g.ok, false);
  assert.strictEqual(g.error, 'Daglimiet van Open-Meteo bijna bereikt; wind wordt later ververst');
  assert.strictEqual(g.stale, true);
  assert.strictEqual(g.nx * g.ny, g.speedKt.length);
  const p = await wind.points([{ lat: 10, lon: 10 }]);
  assert.strictEqual(p[0].ok, false);
  assert.strictEqual(wind.budget().lastError, 'Daglimiet van Open-Meteo bijna bereikt; wind wordt later ververst');

  // A new UTC day starts at zero.
  clock = Date.UTC(2026, 9, 17, 0, 5);
  await wind.grid({ bbox: [52, 4, 53, 6] });
  assert.strictEqual(f.calls.length, 2);
});

test('429: backs off and does not ask until the pause is over', async () => {
  let fail = true;
  const f = fake((out) => { if (fail) { const e = new Error('Minutely API request limit exceeded'); e.status = 429; throw e; } return out; });
  clock = T0 + 20 * 60000;
  wind.start({ dir: tmp(), fetchJson: f.fetchJson, log: quiet, now });
  const g = await wind.grid({ bbox: [52, 4, 53, 6] });
  assert.strictEqual(g.ok, false);
  assert.match(g.error, /weigert tijdelijk/);
  const b = wind.budget();
  assert.ok(b.blockedUntil > clock, 'blockedUntil set');
  await wind.grid({ bbox: [52, 4, 53, 6] });
  assert.strictEqual(f.calls.length, 1, 'no request while blocked');
  fail = false;
  clock = b.blockedUntil + 1000;
  assert.strictEqual((await wind.grid({ bbox: [52, 4, 53, 6] })).ok, true);
  assert.strictEqual(f.calls.length, 2);
  assert.strictEqual(wind.budget().blockedUntil, 0);
});

test('serialize and ingest: another screen gets the grids without fetching', async () => {
  const f = fake();
  clock = T0 + 20 * 60000;
  wind.start({ dir: tmp(), fetchJson: f.fetchJson, log: quiet, now });
  await wind.grid({ bbox: [52, 4, 53, 6] });
  await wind.points([{ lat: 52.3, lon: 4.75 }]);
  const data = JSON.parse(JSON.stringify(wind.serialize()));
  const f2 = fake();
  wind.start({ dir: tmp(), fetchJson: f2.fetchJson, log: quiet, now });
  assert.strictEqual(wind.ingest(data), 2);
  assert.strictEqual(wind.ingest(data), 0, 'nothing newer the second time');
  assert.strictEqual(wind.ingest({ grids: [{ key: 'x' }] }), 0, 'malformed entries are ignored');
  assert.strictEqual((await wind.grid({ bbox: [52, 4, 53, 6], level: '900', hour: 5 })).ok, true);
  assert.strictEqual((await wind.points([{ lat: 52.3, lon: 4.75 }]))[0].ok, true);
  assert.strictEqual(f2.calls.length, 0);
  assert.strictEqual(wind.stats().grids, 1);
});
