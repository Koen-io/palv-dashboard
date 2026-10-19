// Runway use at Schiphol, from two sources:
// 1. Casper, the flight tracker of the Bewoners Aanspreekpunt Schiphol (bas.flighttracking.casper.aero),
//    which Schiphol itself links to for "which runways are in use now". For every flight it gives the
//    runway it took off from or landed on, taken from the radar, and for inbound flights the runway they
//    are cleared to. Asked once a minute while a runway widget is on screen.
//    Its own runway-use summary (/runway/use) is NOT used: in testing it named the opposite configuration
//    of what was flying, and it comes back empty when LVNL's feed is down. The per-flight data stayed right.
// 2. Live ADS-B traffic around the field, as fallback when Casper does not answer: an aircraft descending
//    on final towards a threshold counts as a landing on that runway; one climbing out just beyond the far
//    end as a departure. Tuned against a week of Casper radar tracks (see test/runways.test.js).
//
// Schiphol's fixed one-way runways are never reported the wrong way round: no departures from 18R or 36R,
// no landings on 36L or 18L (Polderbaan lands from the north and departs to the north, Aalsmeerbaan lands
// from the south and departs to the south). An aircraft that departs 36C and turns right climbs out close
// to the extended centreline of 36R, which is how "departure 36R" used to show up.

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
const RUNWAY_IDS = new Set(STRIPS.flatMap((s) => [s.a, s.b]));
const NEVER = { landing: new Set(['36L', '18L']), departure: new Set(['18R', '36R']) };

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
    if (!NEVER.landing.has(e.id)) {
      const dx = P[0] - e.T[0], dy = P[1] - e.T[1];
      const along = dx * e.u[0] + dy * e.u[1];
      const cross = Math.abs(dx * e.u[1] - dy * e.u[0]);
      if (along > -9 && along < 0.2 && cross < 0.22 + 0.03 * Math.abs(along) && angDiff(ac.track, e.hdg) < 10 && ac.alt_baro < 330 * Math.abs(along) + 900 && (rate == null || rate < 150)) {
        if (!best || cross < best.cross) best = { mode: 'landing', rwy: e.id, cross };
      }
    }
    // Departure: climbing out just beyond the far end, still close to runway heading. A narrow cone: wider
    // ones caught departures from the parallel runway that had started their turn.
    if (!NEVER.departure.has(e.id)) {
      const dx = P[0] - e.F[0], dy = P[1] - e.F[1];
      const along = dx * e.u[0] + dy * e.u[1];
      const cross = Math.abs(dx * e.u[1] - dy * e.u[0]);
      if (along > -0.8 && along < 4 && cross < 0.3 + 0.1 * Math.max(along, 0) && angDiff(ac.track, e.hdg) < 20 && ac.alt_baro < 3000 && rate != null && rate > 300 && ac.gs > 110) {
        if (!best || cross < best.cross) best = { mode: 'departure', rwy: e.id, cross };
      }
    }
  }
  return best;
}

const WINDOW_MS = 15 * 60000;
const SUPERSEDE_MS = 7 * 60000;
const CASPER = 'https://bas.flighttracking.casper.aero';
const CASPER_EVERY_MS = 60000;
const CASPER_FRESH_MS = 3.5 * 60000;
const WATCH_MS = 30000; // Casper is only asked while someone looked at the runway use this recently
const SOURCES = [['lol', 'https://api.adsb.lol/v2/point/52.31/4.76/14'], ['fi', 'https://opendata.adsb.fi/api/v3/lat/52.31/lon/4.76/dist/14']];

// Per source and mode: rwy -> Map(key -> time). The key is the aircraft (ADS-B) or the flight (Casper);
// one key sits on one runway per mode at a time.
const newObs = () => ({ landing: new Map(), departure: new Map() });
const obs = { adsb: newObs(), casper: newObs() };
const status = { lastOk: 0, lastTry: 0, failures: 0, firstOk: 0, startedAt: 0 };
const casper = { lastOk: 0, lastTry: 0, firstOk: 0, flights: 0, error: null, busy: false };
let timer = null, askedAt = 0;

function keyRunway(store, key) {
  for (const [rwy, seen] of store) if (seen.has(key)) return rwy;
  return null;
}

// first: an aircraft keeps the first runway it was seen departing from (climbing out it drifts towards
// other runways' centrelines, never the other way round). Otherwise the newest runway wins.
function record(o, mode, rwy, key, t, first = false) {
  const store = o[mode];
  const had = keyRunway(store, key);
  if (had && had !== rwy) {
    if (first) return;
    store.get(had).delete(key);
  }
  if (!store.has(rwy)) store.set(rwy, new Map());
  store.get(rwy).set(key, t);
}

function summarize(o, mode, now) {
  const rows = [];
  for (const [rwy, seen] of o[mode]) {
    for (const [key, t] of seen) if (now - t > WINDOW_MS) seen.delete(key);
    if (!seen.size) { o[mode].delete(rwy); continue; }
    const times = [...seen.values()].sort((a, b) => b - a);
    rows.push({ rwy, count: times.length, last: times[0], times });
  }
  const total = rows.reduce((n, r) => n + r.count, 0);
  let active = rows.filter((r) => r.count >= 2 || total <= 3);
  // After a runway change: drop a runway once another one has clearly taken over.
  active = active.filter((r) => {
    if (now - r.last < SUPERSEDE_MS) return true;
    return !rows.some((o2) => o2 !== r && o2.times.filter((t) => t > r.last).length >= 2);
  });
  active.sort((a, b) => b.count - a.count || b.last - a.last);
  return active.map((r, i) => ({ rwy: r.rwy, role: i === 0 ? 'main' : 'secondary', count: r.count, last: r.last }));
}

/* ---------- Casper ---------- */

// "24" sometimes comes as the number 24, and so could 06 as 6.
function rwyId(v) {
  if (v == null || v === '') return null;
  const id = String(v).trim().toUpperCase().padStart(2, '0');
  return RUNWAY_IDS.has(id) ? id : null;
}
const casperTime = (s) => { const t = s ? Date.parse(String(s).replace(' ', 'T') + 'Z') : NaN; return Number.isFinite(t) ? t : null; };

// One answer of /flight/updates: the flights to and from Schiphol with their runway. Light aircraft and
// helicopters on the Oostbaan are left out; the runway use is about the airliners.
function ingestCasper(list, now = Date.now()) {
  let n = 0;
  for (const f of list || []) {
    if (!f || f.id == null) continue;
    if (f['at.propulsion'] === 'H' || f['at.propulsion'] === 'P' || f._wvc === 'LIGHT') continue;
    const key = String(f.id);
    if (f.dep_af === 'EHAM') {
      const rwy = rwyId(f.dep_rwy);
      if (rwy && !NEVER.departure.has(rwy)) {
        // Without a departure time it is lining up or just airborne: in use now.
        const t = Math.min(casperTime(f.dep_time) || now, now);
        if (now - t < WINDOW_MS) { record(obs.casper, 'departure', rwy, key, t); n += 1; }
      }
    }
    if (f.des_af === 'EHAM') {
      const rwy = rwyId(f.des_rwy);
      if (rwy && !NEVER.landing.has(rwy)) {
        // Landed: at its landing time. Still inbound: the runway it is cleared to, in use now.
        const t = Math.min(casperTime(f.des_time) || now, now);
        if (now - t < WINDOW_MS) { record(obs.casper, 'landing', rwy, key, t); n += 1; }
      }
    }
  }
  return n;
}

async function pollCasper(getJson, now = Date.now()) {
  if (casper.busy || now - casper.lastTry < CASPER_EVERY_MS - 2000) return;
  casper.busy = true;
  casper.lastTry = now;
  try {
    const url = `${CASPER}/?/timeline&urls[0]=%2Fflight%2Fupdates&initial=true&from=${now - 20000}&upto=${now}`;
    const data = await getJson(url);
    const list = data && data['/flight/updates'];
    if (!Array.isArray(list)) throw new Error('onbruikbaar antwoord');
    const done = Date.now();
    casper.flights = ingestCasper(list, done);
    casper.lastOk = done;
    casper.firstOk = casper.firstOk || done;
    casper.error = null;
  } catch (err) {
    casper.error = String((err && err.message) || err);
  } finally {
    casper.busy = false;
  }
}

/* ---------- ADS-B ---------- */

function ingestAircraft(ac, hex, now) {
  const hit = classify(ac);
  if (hit) record(obs.adsb, hit.mode, hit.rwy, hex, now, hit.mode === 'departure');
}

// Fed from the live traffic feed when that covers the field: every round, without asking the sources
// anything extra. Only when the feed does not cover Schiphol are the sources asked here, through the
// same regulator as the feed (traffic.request), so the two never crowd each other out.
let fedAt = 0;
function ingest(records, now = Date.now()) {
  for (const r of records.values()) {
    if (r.lat == null || now - r.posAt > 15000) continue;
    ingestAircraft({ lat: r.lat, lon: r.lon, alt_baro: r.alt, track: r.track, gs: r.gs, baro_rate: r.vs, category: r.cat }, r.hex, now);
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
    for (const ac of data.ac) ingestAircraft(ac, ac.hex, now);
    status.lastOk = now;
    status.firstOk = status.firstOk || now;
    status.failures = 0;
    return;
  }
  status.failures += 1;
}

let getJson = null;
function start(request, casperJson, intervalMs = 12000) {
  askedAt = Date.now();
  if (casperJson) getJson = casperJson;
  if (timer) return;
  status.startedAt = Date.now();
  const tick = () => {
    poll(request);
    if (getJson && Date.now() - askedAt < WATCH_MS) pollCasper(getJson);
  };
  tick();
  timer = setInterval(tick, intervalMs);
}

function snapshot(now = Date.now()) {
  askedAt = now;
  const casperOk = casper.lastOk > 0 && now - casper.lastOk < CASPER_FRESH_MS;
  const adsbOk = status.lastOk > 0 && now - status.lastOk < 90000;
  const adsb = { landing: summarize(obs.adsb, 'landing', now), departure: summarize(obs.adsb, 'departure', now) };
  const cas = { landing: summarize(obs.casper, 'landing', now), departure: summarize(obs.casper, 'departure', now) };
  // Casper as soon as it answers; ADS-B while it does not (or has not yet).
  const useCasper = casperOk && (cas.landing.length || cas.departure.length || !(adsb.landing.length || adsb.departure.length));
  const pick = useCasper ? cas : adsb;
  return {
    ok: casperOk || adsbOk,
    source: useCasper ? 'casper' : 'adsb',
    lastOk: useCasper ? casper.lastOk : status.lastOk,
    startedAt: status.startedAt,
    watchingSince: useCasper ? casper.firstOk : status.firstOk,
    casper: { ok: casperOk, lastOk: casper.lastOk, error: casper.error },
    adsb: { ok: adsbOk, lastOk: status.lastOk, ...adsb },
    landing: pick.landing,
    departure: pick.departure,
  };
}

function reset() {
  obs.adsb = newObs();
  obs.casper = newObs();
  Object.assign(casper, { lastOk: 0, lastTry: 0, firstOk: 0, flights: 0, error: null, busy: false });
  Object.assign(status, { lastOk: 0, lastTry: 0, failures: 0, firstOk: 0, startedAt: 0 });
  fedAt = 0;
}

module.exports = { start, snapshot, classify, ingest, ingestCasper, pollCasper, rwyId, reset, NEVER };
