// The unit's own aircraft and the other emergency services, by their Mode-S codes: which of them are
// up right now, how high and fast, and since when. They come out of the same live feed as the
// Vluchtradar (traffic.js), every second; the moment of take-off is read from the flown route that
// ADS-B Exchange keeps, and otherwise counted from when the aircraft was first seen in the air here.

const TRACES = (hex) => ['recent', 'full'].map((kind) => `https://globe.adsbexchange.com/data/traces/${hex.slice(-2)}/trace_${kind}_${hex}.json`);

const SHOW_MS = 75000;        // in the list for this long after the last message
const FORGET_MS = 10 * 60000; // after this long without a message a next appearance is a new flight
const GAP_S = 600;            // a gap this long in a route means the aircraft stood somewhere in between

const seen = new Map();  // hex -> { r, at, airborneSince, takeoff, lookup }
const routes = new Map(); // hex -> { at, points } — flown route of the current flight, for the map
let fetchTrace = null, startedAt = 0;

const airborne = (alt) => typeof alt === 'number';

function tracePoints(traces) {
  const pts = [];
  for (const t of traces) {
    if (!t || !Array.isArray(t.trace)) continue;
    for (const p of t.trace) pts.push({ t: p[0] + (t.timestamp || 0), lat: p[1], lon: p[2], alt: p[3], flags: p[6] | 0 });
  }
  pts.sort((a, b) => a.t - b.t);
  return pts;
}

// Index of the first point of the flight in progress: walk back from the newest point while the
// aircraft was in the air, stopping at a leg start, a long gap or a point on the ground.
function flightStart(pts, nowMs) {
  // A route that has not reached this flight yet, or that ends on the ground, says nothing about it.
  if (!pts.length || nowMs / 1000 - pts[pts.length - 1].t > GAP_S || !airborne(pts[pts.length - 1].alt)) return -1;
  let i = pts.length - 1;
  while (i > 0) {
    const p = pts[i], prev = pts[i - 1];
    if (p.flags & 2 || p.t - prev.t > GAP_S || prev.alt === 'ground') break;
    i -= 1;
  }
  while (i < pts.length - 1 && !airborne(pts[i].alt)) i += 1;
  return airborne(pts[i].alt) ? i : -1;
}

function takeoffFromTrace(traces, nowMs) {
  const pts = tracePoints(traces);
  const i = flightStart(pts, nowMs);
  return i < 0 ? null : pts[i].t * 1000;
}

const getTraces = (hex) => Promise.all(TRACES(hex).map((url) => fetchTrace(url).catch(() => null)));

async function lookupTakeoff(hex, entry) {
  const l = entry.lookup;
  if (l.busy || l.tries >= 6 || Date.now() < l.next) return;
  l.busy = true;
  l.tries += 1;
  try {
    const t = takeoffFromTrace(await getTraces(hex), Date.now());
    // Only a take-off that fits what was seen here: not after the aircraft was already up.
    if (t && t <= entry.airborneSince + 60000 && t > Date.now() - 12 * 3600e3) { entry.takeoff = t; l.tries = 99; }
  } catch { /* try again later */ }
  l.busy = false;
  l.next = Date.now() + 120000;
}

// The flown route of the current flight as [time ms, lat, lon, alt], for drawing on the Vluchtradar.
async function route(hex) {
  hex = String(hex || '').toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex) || !fetchTrace) return [];
  const cached = routes.get(hex);
  if (cached && Date.now() - cached.at < 60000) return cached.points;
  const pts = tracePoints(await getTraces(hex));
  const i = flightStart(pts, Date.now());
  const points = i < 0 ? [] : pts.slice(i).map((p) => [Math.round(p.t * 1000), p.lat, p.lon, airborne(p.alt) ? p.alt : null]);
  routes.set(hex, { at: Date.now(), points });
  return points;
}

// One round of the live feed: the records of every aircraft heard, keyed by hex code.
function ingest(records, groups, now) {
  for (const [hex] of groups) {
    const r = records.get(hex);
    if (!r || !r.msgAt) continue;
    let e = seen.get(hex);
    if (!e) seen.set(hex, (e = { r, at: r.msgAt, airborneSince: null, takeoff: null, firstPoll: now - startedAt < 30000, lookup: { tries: 0, next: 0, busy: false } }));
    e.r = r;
    e.at = r.msgAt;
    if (airborne(r.alt)) {
      if (!e.airborneSince) { e.airborneSince = r.msgAt; e.takeoff = null; e.lookup = { tries: 0, next: 0, busy: false }; }
      if (!e.takeoff && fetchTrace) lookupTakeoff(hex, e);
    } else if (r.alt === 'ground') {
      e.airborneSince = null; e.takeoff = null; e.firstPoll = false;
    }
  }
  for (const [hex, e] of seen) if (now - e.at > FORGET_MS || !groups.has(hex)) seen.delete(hex);
}

function start(trace, since) {
  fetchTrace = trace;
  startedAt = startedAt || since || Date.now();
}

function snapshot(groups, now = Date.now()) {
  const aircraft = [];
  for (const [hex, e] of seen) {
    if (now - e.at > SHOW_MS) continue;
    const a = e.r;
    const up = !!e.airborneSince;
    aircraft.push({
      hex,
      group: groups.get(hex),
      flight: a.flight,
      reg: a.reg,
      type: a.type,
      alt: airborne(a.alt) ? a.alt : null,
      onGround: a.alt === 'ground',
      gs: typeof a.gs === 'number' ? Math.round(a.gs) : null,
      vs: a.vs,
      squawk: a.squawk,
      emergency: a.emergency,
      // Without a route the flight is counted from the first sighting; when that was at start-up the
      // aircraft may well have been up for longer.
      takeoff: up ? e.takeoff || e.airborneSince : null,
      approx: up && !e.takeoff,
      atLeast: up && !e.takeoff && e.firstPoll,
      msgAt: a.msgAt,
      posAt: a.posAt,
      lat: a.lat,
      lon: a.lon,
      src: a.src,
    });
  }
  aircraft.sort((x, y) => (x.onGround - y.onGround) || ((x.takeoff || 0) - (y.takeoff || 0)));
  return aircraft;
}

module.exports = { start, ingest, snapshot, route, takeoffFromTrace };
