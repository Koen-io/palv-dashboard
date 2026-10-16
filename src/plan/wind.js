// Wind for the planning map (Zoek & Plan): a grid of wind at five heights for the particle flow and
// the barbs, and point lookups along a route. Source is Open-Meteo, free and worldwide, within its
// free tier: 600 calls per minute, 5000 per hour, 10000 per day, where every location in a request is
// a call and more than 10 variables count as vars/10 calls.
//
// Why it is built this way:
// - one grid request asks all five levels for the next 13 hours (exactly 10 variables, so 1 call per
//   location); after that every level and hour comes from the cache, without a request;
// - grid spacing grows with the area so a request stays under ~192 locations, and the area is snapped
//   outward to multiples of the spacing, so panning a little hits the same cache entry;
// - the model is chosen per region: best_match leaves 975/950/900 hPa empty over the North Sea (the
//   regional Harmonie models there have no such levels), icon_seamless and gfs_seamless are complete
//   everywhere. ICON (2-7 km over Europe) for Europe, GFS (with HRRR over the US) elsewhere, and
//   whatever is still empty is filled from the other one;
// - a budget guard counts calls per minute, hour and UTC day and stops at 85 % of a limit, so the
//   dashboard can never use up the free tier (the day count survives restarts).
const fs = require('fs');
const path = require('path');

const API = 'https://api.open-meteo.com/v1/forecast';
const UA = 'P-ALV-Dashboard/1.17 (desktop dashboard)';
const LIMITS = { minute: 600, hour: 5000, day: 10000 };
const MARGIN = 0.85;
const HOURS = 13;               // hour 0 = the current hour, then 12 ahead
const FRESH_MS = 60 * 60 * 1000;
const MAX_GRIDS = 30;
const MAX_POINT_LOCS = 500;
const KEEP_POINTS_MS = 6 * 3600 * 1000;  // older point data is only used as stale fallback until then
const MAX_FORECAST_H = 168;
const MAX_POINTS = 192;         // grid locations per request (~16 x 12)
const SPACINGS = [0.05, 0.1, 0.125, 0.25, 0.5, 1, 2, 2.5, 5, 10];
const POST_ABOVE = 40;          // locations; longer lists go in a POST body instead of the URL
const TIMEOUT_MS = 60000; // a large grid from GFS can take half a minute when Open-Meteo is busy
const PRIMARY_EU = 'icon_seamless', PRIMARY_WORLD = 'gfs_seamless';
const FT = 0.3048;

const LEVELS = [
  { key: '10m', name: 'Grond (10 m)', ft: 33, hpa: null },
  { key: '975', name: '≈1.000 ft (975 hPa)', ft: 1060, hpa: 975 },
  { key: '950', name: '≈1.800 ft (950 hPa)', ft: 1770, hpa: 950 },
  { key: '900', name: '≈3.200 ft (900 hPa)', ft: 3240, hpa: 900 },
  { key: '850', name: '≈4.800 ft (850 hPa)', ft: 4780, hpa: 850 },
];
const PRESSURE = LEVELS.filter((l) => l.hpa);
const spdVar = (l) => (l.hpa ? `wind_speed_${l.hpa}hPa` : 'wind_speed_10m');
const dirVar = (l) => (l.hpa ? `wind_direction_${l.hpa}hPa` : 'wind_direction_10m');
const GRID_VARS = LEVELS.flatMap((l) => [spdVar(l), dirVar(l)]);
// Points also want gusts, temperature and the real height of each pressure level: 20 variables, 2 calls each.
const POINT_VARS = [...GRID_VARS, 'wind_gusts_10m', 'temperature_2m',
  ...PRESSURE.flatMap((l) => [`temperature_${l.hpa}hPa`, `geopotential_height_${l.hpa}hPa`])];

const MSG = {
  budget: 'Daglimiet van Open-Meteo bijna bereikt; wind wordt later ververst',
  busy: 'Veel windverzoeken achter elkaar; wind wordt zo ververst',
  blocked: 'Open-Meteo weigert tijdelijk (te veel verzoeken); wind wordt later ververst',
  net: 'Geen verbinding met Open-Meteo; wind wordt later ververst',
  bad: 'Onverwacht antwoord van Open-Meteo',
  far: 'Geen windverwachting zo ver vooruit',
  pos: 'Ongeldige positie',
  level: 'Onbekende hoogte',
  start: 'Wind is niet gestart',
};

let dir = null, fetchJson = null, now = () => Date.now();
let log = { info() {}, warn() {} };
let grids = new Map();            // key -> grid entry (see fetchGrid)
const pointCache = new Map();     // 'lat,lon' -> { fetchedAt, model, elev, times, h: { var: [] } }
const inflight = new Map();
let spend = { day: null, used: 0 };
let recent = [];                  // [t, cost] for the rolling minute and hour
let blockedUntil = 0, backoffMs = 0, lastError = null;
const counters = { requests: 0, locations: 0, gridHits: 0, gridFetches: 0, pointHits: 0, pointFetches: 0, fills: 0, refused: 0, lastFetchAt: 0, lastOkAt: 0 };

// ---- pure helpers -------------------------------------------------------------------------------

const r2 = (v) => { const x = Math.round(v * 100) / 100; return x === 0 ? 0 : x; };
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const rad = (d) => (d * Math.PI) / 180;

// Wind vector from speed and the direction it blows FROM: u east, v north (meteorological convention).
function uv(speed, dirFrom) {
  if (!Number.isFinite(speed) || !Number.isFinite(dirFrom)) return { u: null, v: null };
  return { u: r2(-speed * Math.sin(rad(dirFrom))), v: r2(-speed * Math.cos(rad(dirFrom))) };
}
function fromUv(u, v) {
  const speed = Math.hypot(u, v);
  const d = speed < 1e-9 ? 0 : ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return { speed, dirFrom: d };
}

// The area snapped to a nice spacing so it holds at most MAX_POINTS locations, rounded outward.
// bbox [south, west, north, east] in degrees. Latitude stays within ±85, longitude within ±180 (an area
// across the antimeridian is simply cut off at 180). An area too big even at 10° is cut down around its
// middle.
function snapBox(bbox) {
  let [s, w, n, e] = (bbox || []).map(Number);
  if (![s, w, n, e].every(Number.isFinite)) return null;
  if (s > n) [s, n] = [n, s];
  if (e < w) e += 360;
  s = Math.max(-85, Math.min(85, s)); n = Math.max(-85, Math.min(85, n));
  w = Math.max(-180, Math.min(180, w)); e = Math.max(-180, Math.min(180, e));
  const fit = (sp, a, b) => {
    const lo = r6(Math.floor(r6(a / sp)) * sp), hi = r6(Math.ceil(r6(b / sp)) * sp);
    return [lo, hi === lo ? r6(lo + sp) : hi];
  };
  for (const sp of SPACINGS) {
    let [south, north] = fit(sp, s, n), [west, east] = fit(sp, w, e);
    if (south < -85) south = r6(south + sp); if (north > 85) north = r6(north - sp);
    if (west < -180) west = r6(west + sp); if (east > 180) east = r6(east - sp);
    if (north < south) north = south;
    if (east < west) east = west;
    const nx = Math.round((east - west) / sp) + 1, ny = Math.round((north - south) / sp) + 1;
    if (nx * ny <= MAX_POINTS || sp === SPACINGS[SPACINGS.length - 1]) {
      if (nx * ny <= MAX_POINTS) return { south, west, north, east, dx: sp, dy: sp, nx, ny };
      // Too big for 10°: keep the middle 16 x 12 (or fewer along a short side).
      const cx = Math.min(nx, 16), cy = Math.min(ny, Math.floor(MAX_POINTS / cx));
      const mx = Math.round(((west + east) / 2) / sp) * sp, my = Math.round(((south + north) / 2) / sp) * sp;
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
      const w2 = clamp(r6(mx - Math.floor((cx - 1) / 2) * sp), -180, r6(180 - (cx - 1) * sp));
      const s2 = clamp(r6(my - Math.floor((cy - 1) / 2) * sp), -80, r6(80 - (cy - 1) * sp));
      return { south: s2, west: w2, north: r6(s2 + (cy - 1) * sp), east: r6(w2 + (cx - 1) * sp), dx: sp, dy: sp, nx: cx, ny: cy };
    }
  }
  return null;
}
const boxKey = (b) => `${b.dx}|${b.south}|${b.west}|${b.north}|${b.east}`;
const contains = (a, b) => a.dx === b.dx && a.south <= b.south + 1e-9 && a.north >= b.north - 1e-9 && a.west <= b.west + 1e-9 && a.east >= b.east - 1e-9;

// Model per region: ICON-EU's area (29.5-70.5 N, 23.5 W-62.5 E), else GFS.
const inEurope = (lat, lon) => lat >= 29.5 && lat <= 70.5 && lon >= -23.5 && lon <= 62.5;
const modelFor = (lat, lon) => (inEurope(lat, lon) ? PRIMARY_EU : PRIMARY_WORLD);
const otherModel = (m) => (m === PRIMARY_EU ? PRIMARY_WORLD : PRIMARY_EU);

// ISA height (m) of a pressure level, for when the model's own height is missing.
const isaHeightM = (hpa) => 44330.8 * (1 - Math.pow(hpa / 1013.25, 0.190263));

// Wind and temperature at height h (m AMSL) from nodes [{ h, speed, dir, t }] (any order). Speed and
// temperature linear in height, direction along the shorter way round. Below the lowest node the lowest
// counts (the 10 m wind), above the highest the highest.
function interpLevels(nodes, h) {
  const ns = (nodes || []).filter((n) => Number.isFinite(n.h) && Number.isFinite(n.speed) && Number.isFinite(n.dir)).sort((a, b) => a.h - b.h);
  if (!ns.length) return null;
  if (!Number.isFinite(h) || h <= ns[0].h) return { ...ns[0], h };
  const top = ns[ns.length - 1];
  if (h >= top.h) return { ...top, h, above: h > top.h };
  let i = 1; while (ns[i].h < h) i++;
  const a = ns[i - 1], b = ns[i], f = (h - a.h) / (b.h - a.h);
  const dd = ((b.dir - a.dir + 540) % 360) - 180;
  const t = Number.isFinite(a.t) && Number.isFinite(b.t) ? a.t + f * (b.t - a.t) : Number.isFinite(a.t) ? a.t : b.t;
  return { h, speed: a.speed + f * (b.speed - a.speed), dir: (a.dir + f * dd + 360) % 360, t };
}

// Nodes of one location and hour from a point response: the 10 m wind 10 m above the ground and the
// pressure levels that lie above it (below-ground levels are extrapolated by the model and meaningless).
function nodesAt(hourly, i, elev) {
  const g = Number.isFinite(elev) ? elev : 0;
  const val = (k) => { const a = hourly[k]; const v = a && a[i]; return typeof v === 'number' ? v : null; };
  const nodes = [{ h: g + 10, speed: val('wind_speed_10m'), dir: val('wind_direction_10m'), t: val('temperature_2m') }];
  for (const l of PRESSURE) {
    const gh = val(`geopotential_height_${l.hpa}hPa`);
    const h = gh != null ? gh : isaHeightM(l.hpa);
    if (h <= g + 10) continue;
    nodes.push({ h, speed: val(spdVar(l)), dir: val(dirVar(l)), t: val(`temperature_${l.hpa}hPa`) });
  }
  return nodes;
}

// Calls a request costs on Open-Meteo's meter.
const callCost = (locations, nVars) => locations * Math.max(1, nVars / 10);
const hourStart = (t) => Math.floor(t / 3600000) * 3600000;
const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const roundTo = (v, step) => r6(Math.round(v / step) * step);

// ---- budget -------------------------------------------------------------------------------------

const budgetFile = () => (dir ? path.join(dir, 'plan-wind-budget.json') : null);
const cacheFile = () => (dir ? path.join(dir, 'plan-wind-cache.json') : null);

function writeJson(file, data) {
  if (!file) return;
  const tmp = file + '.tmp';
  try { fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); } catch (err) { log.warn('wind', 'niet opgeslagen: ' + err.message); }
}
function rollDay(t) { const d = utcDay(t); if (spend.day !== d) spend = { day: d, used: 0 }; }
function windowSums(t) {
  recent = recent.filter((x) => t - x[0] < 3600000);
  let minute = 0, hour = 0;
  for (const [at, c] of recent) { hour += c; if (t - at < 60000) minute += c; }
  return { minute: r2(minute), hour: r2(hour) };
}
function budget() {
  const t = now(); rollDay(t);
  const w = windowSums(t);
  return { day: r2(spend.used), dayLimit: LIMITS.day, hour: w.hour, hourLimit: LIMITS.hour, minute: w.minute, minuteLimit: LIMITS.minute, blockedUntil: blockedUntil > t ? blockedUntil : 0, lastError };
}
// Null when the request may go out, else the Dutch reason why not.
function refuse(cost) {
  const t = now(); rollDay(t);
  if (t < blockedUntil) return MSG.blocked;
  if (spend.used + cost > LIMITS.day * MARGIN) return MSG.budget;
  const w = windowSums(t);
  if (w.hour + cost > LIMITS.hour * MARGIN || w.minute + cost > LIMITS.minute * MARGIN) return MSG.busy;
  return null;
}
function charge(cost) {
  const t = now(); rollDay(t);
  spend.used += cost; recent.push([t, cost]);
  writeJson(budgetFile(), spend);
}

// ---- network ------------------------------------------------------------------------------------

// One Open-Meteo request; the hourly data per location in the order asked.
async function request(locs, vars, model, hours) {
  const cost = callCost(locs.length, vars.length);
  const why = refuse(cost);
  if (why) { counters.refused++; const e = new Error(why); e.refused = true; throw e; }
  const q = `latitude=${locs.map((l) => l.lat).join(',')}&longitude=${locs.map((l) => l.lon).join(',')}` +
    `&hourly=${vars.join(',')}&models=${model}&wind_speed_unit=kn&timeformat=unixtime&forecast_hours=${hours}&cell_selection=nearest`;
  const headers = { 'User-Agent': UA, Accept: 'application/json' };
  const post = locs.length > POST_ABOVE;
  charge(cost); // counted when sent: Open-Meteo counts failed requests too
  counters.requests++; counters.locations += locs.length; counters.lastFetchAt = now();
  let data;
  try {
    data = post
      ? await fetchJson(API, { method: 'POST', body: q, headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }, timeoutMs: TIMEOUT_MS })
      : await fetchJson(`${API}?${q}`, { method: 'GET', headers, timeoutMs: TIMEOUT_MS });
  } catch (err) {
    if (err && err.status === 429) {
      // Open-Meteo says which limit it hit; wait until that window is over, else back off doubling.
      const t = now(), m = String(err.message || '');
      backoffMs = Math.min(3600000, backoffMs ? backoffMs * 2 : 60000);
      let until = t + backoffMs;
      if (/daily/i.test(m)) until = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + 1);
      else if (/hourly/i.test(m)) until = Math.max(until, hourStart(t) + 3600000);
      blockedUntil = until;
      log.warn('wind', `Open-Meteo 429, gepauzeerd tot ${new Date(until).toISOString()}`);
      const e = new Error(MSG.blocked); e.refused = true; throw e;
    }
    const e = new Error(err && err.status ? `Open-Meteo gaf een fout (HTTP ${err.status})` : MSG.net);
    log.warn('wind', `${e.message}: ${err && err.message}`);
    throw e;
  }
  const list = Array.isArray(data) ? data : [data];
  if (list.length !== locs.length || list.some((x) => !x || !x.hourly || !Array.isArray(x.hourly.time))) throw new Error(MSG.bad);
  backoffMs = 0; counters.lastOkAt = now();
  return list;
}

// Locations that still have an empty value in `vars` are asked again from the other model, and only the
// empty values are filled in. Returns the models that contributed.
async function fillGaps(locs, list, vars, model, hours) {
  const gaps = [];
  list.forEach((x, i) => { if (vars.some((k) => !Array.isArray(x.hourly[k]) || x.hourly[k].some((v) => v == null))) gaps.push(i); });
  if (!gaps.length) return [model];
  const alt = otherModel(model);
  let extra;
  try { extra = await request(gaps.map((i) => locs[i]), vars, alt, hours); } catch (err) { log.warn('wind', 'aanvullen mislukt: ' + err.message); return [model]; }
  counters.fills += gaps.length;
  gaps.forEach((li, gi) => {
    const a = list[li].hourly, b = extra[gi].hourly;
    for (const k of vars) {
      if (!Array.isArray(a[k])) a[k] = new Array(a.time.length).fill(null);
      a[k] = a[k].map((v, ti) => (v == null && b[k] && b[k][ti] != null ? b[k][ti] : v));
    }
  });
  return [model, alt];
}

// One request at a time per key: a second identical call waits for the first.
function once(key, fn) {
  if (inflight.has(key)) return inflight.get(key);
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// ---- grid ---------------------------------------------------------------------------------------

async function fetchGrid(box) {
  const locs = [];
  for (let j = 0; j < box.ny; j++) for (let i = 0; i < box.nx; i++) locs.push({ lat: r6(box.north - j * box.dy), lon: r6(box.west + i * box.dx) });
  const model = modelFor((box.south + box.north) / 2, (box.west + box.east) / 2);
  const list = await request(locs, GRID_VARS, model, HOURS);
  const models = await fillGaps(locs, list, GRID_VARS, model, HOURS);
  const times = list[0].hourly.time.map((s) => s * 1000);
  const levels = {};
  for (const l of LEVELS) {
    // [hour][location], speeds and directions rounded to save space on disk
    levels[l.key] = {
      s: times.map((_, ti) => list.map((x) => { const v = x.hourly[spdVar(l)][ti]; return v == null ? null : Math.round(v * 10) / 10; })),
      d: times.map((_, ti) => list.map((x) => { const v = x.hourly[dirVar(l)][ti]; return v == null ? null : Math.round(v); })),
    };
  }
  const entry = { key: boxKey(box), box, model: models.join('+'), fetchedAt: now(), times, elev: list.map((x) => (Number.isFinite(x.elevation) ? Math.round(x.elevation) : null)), levels };
  grids.set(entry.key, entry);
  counters.gridFetches++;
  trimGrids();
  saveGrids();
  log.info('wind', `raster ${box.nx}x${box.ny} @${box.dx}° opgehaald (${entry.model})`);
  return entry;
}

function trimGrids() {
  if (grids.size <= MAX_GRIDS) return;
  const keep = [...grids.values()].sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, MAX_GRIDS);
  grids = new Map(keep.map((g) => [g.key, g]));
}
function saveGrids() { writeJson(cacheFile(), { v: 1, grids: [...grids.values()] }); }

// A cached grid for the area: the exact one, else a bigger one with the same spacing that holds it.
function findGrid(box, wantTime, freshOnly) {
  const t = now();
  const ok = (g) => (!freshOnly || t - g.fetchedAt < FRESH_MS) && (wantTime == null || g.times.includes(wantTime));
  const exact = grids.get(boxKey(box));
  if (exact && ok(exact)) return exact;
  let best = null;
  for (const g of grids.values()) if (contains(g.box, box) && ok(g) && (!best || g.fetchedAt > best.fetchedAt)) best = g;
  return best;
}

// The grid entry cut to the area, as level and hour.
function shape(entry, box, levelKey, ti, extra) {
  const src = entry.box, lv = entry.levels[levelKey];
  const oi = Math.round((box.west - src.west) / src.dx), oj = Math.round((src.north - box.north) / src.dy);
  const u = [], v = [], speedKt = [], dirDeg = [], elevM = [];
  for (let j = 0; j < box.ny; j++) for (let i = 0; i < box.nx; i++) {
    const k = (oj + j) * src.nx + (oi + i);
    const s = lv.s[ti][k], d = lv.d[ti][k], w = uv(s, d);
    speedKt.push(s); dirDeg.push(d); u.push(w.u); v.push(w.v); elevM.push(entry.elev ? entry.elev[k] : null);
  }
  return {
    ok: true, level: levelKey, hour: Math.round((entry.times[ti] - hourStart(now())) / 3600000), validTime: entry.times[ti], times: entry.times,
    fetchedAt: entry.fetchedAt, model: entry.model, nx: box.nx, ny: box.ny, la1: box.north, lo1: box.west, la2: box.south, lo2: box.east,
    dx: box.dx, dy: box.dy, bbox: [box.south, box.west, box.north, box.east], u, v, speedKt, dirDeg, elevM, ...extra,
  };
}

async function grid({ bbox, level = '10m', hour = 0 } = {}) {
  if (!fetchJson) return { ok: false, error: MSG.start };
  const box = snapBox(bbox);
  if (!box) return { ok: false, error: MSG.pos };
  const lk = String(level);
  if (!LEVELS.some((l) => l.key === lk)) return { ok: false, error: MSG.level };
  const h = Math.max(0, Math.min(HOURS - 1, Math.round(Number(hour) || 0)));
  const want = hourStart(now()) + h * 3600000;
  const hit = findGrid(box, want, true);
  if (hit) { counters.gridHits++; return shape(hit, box, lk, hit.times.indexOf(want)); }
  try {
    const entry = await once('g:' + boxKey(box), () => fetchGrid(box));
    const ti = entry.times.indexOf(want);
    lastError = null;
    return shape(entry, box, lk, ti >= 0 ? ti : Math.min(h, entry.times.length - 1));
  } catch (err) {
    lastError = err.message;
    const old = findGrid(box, null, false);
    if (!old) return { ok: false, error: err.message };
    // The closest hour the old grid has.
    let ti = 0; old.times.forEach((t, i) => { if (Math.abs(t - want) < Math.abs(old.times[ti] - want)) ti = i; });
    return { ...shape(old, box, lk, ti, { stale: true, error: err.message }), ok: false };
  }
}

// ---- points -------------------------------------------------------------------------------------

const locKey = (lat, lon) => `${lat},${lon}`;

function pointFrom(c, p, ti, stale) {
  const hrl = c.h, i = ti;
  const elev = c.elev;
  const target = Number.isFinite(p.ftAmsl) ? p.ftAmsl * FT : -Infinity;
  const at = interpLevels(nodesAt(hrl, i, elev), target);
  if (!at) return { ok: false, error: MSG.bad };
  const g = hrl.wind_gusts_10m && hrl.wind_gusts_10m[i];
  const t2 = hrl.temperature_2m && hrl.temperature_2m[i];
  const out = {
    ok: true, dirDeg: Math.round(at.dir) % 360, speedKt: Math.round(at.speed * 10) / 10,
    gustKt: typeof g === 'number' ? g : null,
    tempC: Number.isFinite(at.t) ? Math.round(at.t * 10) / 10 : typeof t2 === 'number' ? t2 : null,
    validTime: c.times[i], source: 'Open-Meteo ' + c.model, elevM: elev,
  };
  if (at.above) out.aboveTop = true;
  if (stale) { out.stale = true; out.ok = false; out.error = stale; }
  return out;
}

function lookupPoint(p, freshOnly) {
  const c = pointCache.get(p.key);
  if (!c) return null;
  if (freshOnly && now() - c.fetchedAt >= FRESH_MS) return null;
  const ti = c.times.indexOf(p.hourT);
  return ti < 0 ? null : { c, ti };
}

async function fetchPoints(list, hours) {
  // One request per model region; a route seldom crosses one.
  const groups = new Map();
  for (const p of list) { const m = modelFor(p.lat, p.lon); if (!groups.has(m)) groups.set(m, []); groups.get(m).push(p); }
  for (const [model, ps] of groups) {
    const locs = ps.map((p) => ({ lat: p.lat, lon: p.lon }));
    const res = await request(locs, POINT_VARS, model, hours);
    const models = await fillGaps(locs, res, POINT_VARS, model, hours);
    const t = now();
    res.forEach((x, i) => {
      pointCache.delete(ps[i].key);
      pointCache.set(ps[i].key, { fetchedAt: t, model: models.join('+'), elev: Number.isFinite(x.elevation) ? x.elevation : 0, times: x.hourly.time.map((s) => s * 1000), h: x.hourly });
    });
    counters.pointFetches += ps.length;
  }
  // Oldest first in a Map: drop from the front.
  const cut = now() - KEEP_POINTS_MS;
  for (const [k, c] of pointCache) if (pointCache.size > MAX_POINT_LOCS || c.fetchedAt < cut) pointCache.delete(k); else break;
}

async function points(list) {
  const arr = Array.isArray(list) ? list : [];
  if (!fetchJson) return arr.map(() => ({ ok: false, error: MSG.start }));
  const h0 = hourStart(now());
  const ps = arr.map((p) => {
    const lat = Number(p && p.lat), lon = Number(p && p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90) return { bad: MSG.pos };
    const t = p.time == null ? now() : typeof p.time === 'number' ? p.time : Date.parse(p.time);
    const hourT = Math.max(h0, hourStart(Number.isFinite(t) ? t : now()));
    if (hourT - h0 >= MAX_FORECAST_H * 3600000) return { bad: MSG.far };
    const rl = roundTo(lat, 0.05), ro = roundTo(((lon + 540) % 360) - 180, 0.05);
    return { lat: rl, lon: ro, key: locKey(rl, ro), hourT, ftAmsl: Number(p.ftAmsl) };
  });
  const need = new Map();
  for (const p of ps) if (!p.bad && !lookupPoint(p, true)) {
    const n = need.get(p.key);
    if (!n || n.hourT < p.hourT) need.set(p.key, p);
  }
  let error = null;
  if (need.size) {
    const todo = [...need.values()];
    const span = Math.max(...todo.map((p) => p.hourT));
    const hours = Math.max(HOURS, Math.min(MAX_FORECAST_H, Math.round((span - h0) / 3600000) + 1));
    const key = 'p:' + hours + ':' + todo.map((p) => p.key).sort().join(';');
    try { await once(key, () => fetchPoints(todo, hours)); lastError = null; } catch (err) { error = err.message; lastError = err.message; }
  }
  return ps.map((p) => {
    if (p.bad) return { ok: false, error: p.bad };
    const fresh = lookupPoint(p, true);
    if (fresh) { if (!need.has(p.key)) counters.pointHits++; return pointFrom(fresh.c, p, fresh.ti); }
    const old = lookupPoint(p, false);
    if (old) return pointFrom(old.c, p, old.ti, error || MSG.bad);
    return { ok: false, error: error || MSG.bad };
  });
}

// ---- sharing between screens --------------------------------------------------------------------

function validGrid(g) {
  if (!g || typeof g.key !== 'string' || !g.box || !Array.isArray(g.times) || !g.levels || !Number.isFinite(g.fetchedAt)) return false;
  const n = g.box.nx * g.box.ny;
  return LEVELS.every((l) => g.levels[l.key] && Array.isArray(g.levels[l.key].s) && g.levels[l.key].s.length === g.times.length && g.levels[l.key].s.every((row) => Array.isArray(row) && row.length === n));
}
function serialize() {
  const t = now();
  return {
    v: 1,
    grids: [...grids.values()].filter((g) => t - g.fetchedAt < FRESH_MS),
    points: [...pointCache.entries()].filter(([, c]) => t - c.fetchedAt < FRESH_MS).map(([k, c]) => ({ k, ...c })),
  };
}
function ingest(data) {
  if (!data || typeof data !== 'object') return 0;
  let n = 0;
  for (const g of Array.isArray(data.grids) ? data.grids : []) {
    if (!validGrid(g) || g.fetchedAt > now() + 60000) continue;
    const have = grids.get(g.key);
    if (!have || g.fetchedAt > have.fetchedAt) { grids.set(g.key, g); n++; }
  }
  for (const p of Array.isArray(data.points) ? data.points : []) {
    if (!p || typeof p.k !== 'string' || !Array.isArray(p.times) || !p.h || !Number.isFinite(p.fetchedAt)) continue;
    const have = pointCache.get(p.k);
    if (!have || p.fetchedAt > have.fetchedAt) { const { k, ...c } = p; pointCache.delete(k); pointCache.set(k, c); n++; }
  }
  if (n) { trimGrids(); saveGrids(); }
  return n;
}

// ---- lifecycle ----------------------------------------------------------------------------------

function start(opts = {}) {
  dir = opts.dir || null;
  fetchJson = opts.fetchJson || null;
  if (opts.log) log = opts.log;
  if (typeof opts.now === 'function') now = opts.now; // for tests
  grids = new Map(); pointCache.clear(); inflight.clear();
  spend = { day: null, used: 0 }; recent = []; blockedUntil = 0; backoffMs = 0; lastError = null;
  for (const k of Object.keys(counters)) counters[k] = 0;
  try {
    const b = JSON.parse(fs.readFileSync(budgetFile(), 'utf8'));
    if (b && typeof b.day === 'string' && Number.isFinite(b.used)) spend = { day: b.day, used: b.used };
  } catch { /* first start */ }
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
    const cut = now() - 24 * 3600000;
    for (const g of (c && c.grids) || []) if (validGrid(g) && g.fetchedAt > cut) grids.set(g.key, g);
    trimGrids();
  } catch { /* no cache yet */ }
}

function stats() {
  const t = now();
  return {
    grids: grids.size, freshGrids: [...grids.values()].filter((g) => t - g.fetchedAt < FRESH_MS).length,
    pointLocations: pointCache.size, inflight: inflight.size,
    models: [...new Set([...grids.values()].map((g) => g.model))],
    ...counters, budget: budget(),
  };
}

module.exports = {
  start, grid, points, budget, stats, serialize, ingest, LEVELS,
  // pure helpers, for the tests
  uv, fromUv, snapBox, interpLevels, nodesAt, isaHeightM, callCost, modelFor, GRID_VARS, POINT_VARS, MSG,
};
