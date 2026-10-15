// Observed runway use at Schiphol, derived from live ADS-B traffic.
// An aircraft descending on final towards a threshold counts as a landing on that runway;
// an aircraft climbing out over the far end counts as a departure. Published sources proved
// stale or wrong during development (LVNL feed down, third-party ATIS mismatching real traffic);
// the traffic itself is always current.

const FIELD = { lat: 52.31, lon: 4.76 };
const NM_PER_DEG_LAT = 60;
const NM_PER_DEG_LON = 60 * Math.cos((FIELD.lat * Math.PI) / 180);

const STRIPS = [
  { a: '18R', b: '36L', pa: [52.36025, 4.71183], pb: [52.32862, 4.70889] },
  { a: '18C', b: '36C', pa: [52.33139, 4.74003], pb: [52.30186, 4.7375] },
  { a: '18L', b: '36R', pa: [52.32123, 4.78012], pb: [52.29069, 4.77747] },
  { a: '06', b: '24', pa: [52.28792, 4.73422], pb: [52.30462, 4.77752] },
  { a: '09', b: '27', pa: [52.31667, 4.74636], pb: [52.31842, 4.79689] },
  { a: '04', b: '22', pa: [52.30036, 4.78348], pb: [52.31403, 4.80302] },
];

const toXY = ([lat, lon]) => [(lon - FIELD.lon) * NM_PER_DEG_LON, (lat - FIELD.lat) * NM_PER_DEG_LAT];

// One entry per runway direction: threshold T, far end F, unit vector u (direction of movement), heading.
const ENDS = STRIPS.flatMap((s) => {
  const A = toXY(s.pa), B = toXY(s.pb);
  const mk = (id, T, F) => {
    const len = Math.hypot(F[0] - T[0], F[1] - T[1]);
    const u = [(F[0] - T[0]) / len, (F[1] - T[1]) / len];
    return { id, T, F, u, hdg: (Math.atan2(u[0], u[1]) * 180) / Math.PI };
  };
  return [mk(s.a, A, B), mk(s.b, B, A)];
});

const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

function classify(ac) {
  if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return null;
  if (typeof ac.alt_baro !== 'number' || typeof ac.track !== 'number' || typeof ac.gs !== 'number') return null;
  if (ac.category === 'A7' || ac.gs < 90 || ac.gs > 260 || ac.alt_baro > 4000) return null;
  const P = toXY([ac.lat, ac.lon]);
  const rate = typeof ac.baro_rate === 'number' ? ac.baro_rate : typeof ac.geom_rate === 'number' ? ac.geom_rate : null;
  let best = null;

  for (const e of ENDS) {
    // Landing: on the extended centreline before the threshold, on a plausible glide path.
    {
      const dx = P[0] - e.T[0], dy = P[1] - e.T[1];
      const along = dx * e.u[0] + dy * e.u[1];
      const cross = Math.abs(dx * e.u[1] - dy * e.u[0]);
      if (along > -9 && along < 0.2 && cross < 0.22 + 0.03 * Math.abs(along) && angDiff(ac.track, e.hdg) < 10 && ac.alt_baro < 330 * Math.abs(along) + 900 && (rate == null || rate < 150)) {
        if (!best || cross < best.cross) best = { mode: 'landing', rwy: e.id, cross };
      }
    }
    // Departure: climbing out just beyond the far end of the runway.
    {
      const dx = P[0] - e.F[0], dy = P[1] - e.F[1];
      const along = dx * e.u[0] + dy * e.u[1];
      const cross = Math.abs(dx * e.u[1] - dy * e.u[0]);
      if (along > -0.8 && along < 4 && cross < 0.3 + 0.25 * Math.max(along, 0) && angDiff(ac.track, e.hdg) < (along < 1.2 ? 20 : 40) && rate != null && rate > 400 && ac.gs > 110) {
        if (!best || cross < best.cross) best = { mode: 'departure', rwy: e.id, cross };
      }
    }
  }
  return best;
}

const WINDOW_MS = 15 * 60000;
const SUPERSEDE_MS = 7 * 60000;
const SOURCES = [['lol', 'https://api.adsb.lol/v2/point/52.31/4.76/14'], ['fi', 'https://opendata.adsb.fi/api/v3/lat/52.31/lon/4.76/dist/14']];

const obs = { landing: new Map(), departure: new Map() }; // rwy -> Map(hex -> lastSeen)
const status = { lastOk: 0, lastTry: 0, failures: 0, firstOk: 0, startedAt: 0 };
let timer = null;

function record(mode, rwy, hex, now) {
  if (!obs[mode].has(rwy)) obs[mode].set(rwy, new Map());
  obs[mode].get(rwy).set(hex, now);
}

function summarize(mode, now) {
  const rows = [];
  for (const [rwy, seen] of obs[mode]) {
    for (const [hex, t] of seen) if (now - t > WINDOW_MS) seen.delete(hex);
    if (!seen.size) { obs[mode].delete(rwy); continue; }
    const times = [...seen.values()].sort((a, b) => b - a);
    rows.push({ rwy, count: times.length, last: times[0], times });
  }
  const total = rows.reduce((n, r) => n + r.count, 0);
  let active = rows.filter((r) => r.count >= 2 || total <= 3);
  // After a runway change: drop a runway once another one has clearly taken over.
  active = active.filter((r) => {
    if (now - r.last < SUPERSEDE_MS) return true;
    return !rows.some((o) => o !== r && o.times.filter((t) => t > r.last).length >= 2);
  });
  active.sort((a, b) => b.count - a.count || b.last - a.last);
  return active.map((r, i) => ({ rwy: r.rwy, role: i === 0 ? 'main' : 'secondary', count: r.count, last: r.last }));
}

// Fed from the live traffic feed when that covers the field: every round, without asking the sources
// anything extra. Only when the feed does not cover Schiphol are the sources asked here, through the
// same regulator as the feed (traffic.request), so the two never crowd each other out.
let fedAt = 0;
function ingest(records, now = Date.now()) {
  for (const r of records.values()) {
    if (r.lat == null || now - r.posAt > 15000) continue;
    const hit = classify({ lat: r.lat, lon: r.lon, alt_baro: r.alt, track: r.track, gs: r.gs, baro_rate: r.vs, category: r.cat });
    if (hit) record(hit.mode, hit.rwy, r.hex, now);
  }
  status.lastOk = now;
  status.firstOk = status.firstOk || now;
  status.failures = 0;
  fedAt = now;
}

async function poll(request) {
  const now = Date.now();
  if (now - fedAt < 20000) return; // the live feed is doing it
  status.lastTry = now;
  for (const [src, url] of SOURCES) {
    const data = await request(src, url);
    if (!data || !Array.isArray(data.ac)) continue;
    for (const ac of data.ac) {
      const hit = classify(ac);
      if (hit) record(hit.mode, hit.rwy, ac.hex, now);
    }
    status.lastOk = now;
    status.firstOk = status.firstOk || now;
    status.failures = 0;
    return;
  }
  status.failures += 1;
}

function start(request, intervalMs = 12000) {
  if (timer) return;
  status.startedAt = Date.now();
  poll(request);
  timer = setInterval(() => poll(request), intervalMs);
}

function snapshot() {
  const now = Date.now();
  return {
    ok: status.lastOk > 0 && now - status.lastOk < 90000,
    lastOk: status.lastOk,
    startedAt: status.startedAt,
    watchingSince: status.firstOk,
    landing: summarize('landing', now),
    departure: summarize('departure', now),
  };
}

module.exports = { start, snapshot, classify, ingest };
