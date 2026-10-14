// The unit's own aircraft and the other emergency services, by their Mode-S codes: which of them are
// up right now, how high and fast, and since when. Positions come from the same open ADS-B feeds as
// the runway use; the moment of take-off is read from the flown route that ADS-B Exchange keeps, and
// otherwise counted from when the aircraft was first seen in the air here.

const SOURCES = [(hex) => `https://api.adsb.lol/v2/hex/${hex}`, (hex) => `https://opendata.adsb.fi/api/v2/hex/${hex}`];
const TRACES = (hex) => ['recent', 'full'].map((kind) => `https://globe.adsbexchange.com/data/traces/${hex.slice(-2)}/trace_${kind}_${hex}.json`);

const SHOW_MS = 75000;        // in the list for this long after the last message
const FORGET_MS = 10 * 60000; // after this long without a message a next appearance is a new flight
const GAP_S = 600;            // a gap this long in a route means the aircraft stood somewhere in between

const hexes = new Map(); // hex -> group
const seen = new Map();  // hex -> { ac, at, airborneSince, takeoff, lookup }
const status = { lastOk: 0, failures: 0, startedAt: 0 };
let timer = null, fetchJson = null, fetchTrace = null;

function setHexes(groups) {
  hexes.clear();
  for (const [group, list] of Object.entries(groups || {})) {
    for (const hex of list || []) if (/^[0-9a-f]{6}$/.test(hex)) hexes.set(hex, group);
  }
}

const airborne = (alt) => typeof alt === 'number';

// Start of the flight in progress, from the route: walk back from its newest point while the aircraft
// was in the air, stopping at a leg start, a long gap or a point on the ground.
function takeoffFromTrace(traces, nowMs) {
  const pts = [];
  for (const t of traces) {
    if (!t || !Array.isArray(t.trace)) continue;
    for (const p of t.trace) pts.push({ t: p[0] + (t.timestamp || 0), alt: p[3], flags: p[6] | 0 });
  }
  pts.sort((a, b) => a.t - b.t);
  // A route that has not reached this flight yet, or that ends on the ground, says nothing about it.
  if (!pts.length || nowMs / 1000 - pts[pts.length - 1].t > GAP_S || !airborne(pts[pts.length - 1].alt)) return null;
  let i = pts.length - 1;
  while (i > 0) {
    const p = pts[i], prev = pts[i - 1];
    if (p.flags & 2 || p.t - prev.t > GAP_S || prev.alt === 'ground') break;
    i -= 1;
  }
  while (i < pts.length - 1 && !airborne(pts[i].alt)) i += 1;
  return airborne(pts[i].alt) ? pts[i].t * 1000 : null;
}

async function lookupTakeoff(hex, entry) {
  const l = entry.lookup;
  if (l.busy || l.tries >= 6 || Date.now() < l.next) return;
  l.busy = true;
  l.tries += 1;
  try {
    const traces = await Promise.all(TRACES(hex).map((url) => fetchTrace(url).catch(() => null)));
    const t = takeoffFromTrace(traces, Date.now());
    // Only a take-off that fits what was seen here: not after the aircraft was already up.
    if (t && t <= entry.airborneSince + 60000 && t > Date.now() - 12 * 3600e3) { entry.takeoff = t; l.tries = 99; }
  } catch { /* try again later */ }
  l.busy = false;
  l.next = Date.now() + 120000;
}

async function poll() {
  if (!hexes.size) return;
  const list = [...hexes.keys()].join(',');
  let data = null;
  for (const url of SOURCES) {
    try {
      data = await fetchJson(url(list));
      if (data && Array.isArray(data.ac)) break;
      data = null;
    } catch { /* next source */ }
  }
  const now = Date.now();
  if (!data) { status.failures += 1; return; }
  status.lastOk = now;
  status.failures = 0;
  for (const ac of data.ac) {
    const hex = String(ac.hex || '').toLowerCase();
    if (!hexes.has(hex)) continue;
    const at = now - (Number(ac.seen) || 0) * 1000;
    let e = seen.get(hex);
    if (!e) seen.set(hex, (e = { ac, at, airborneSince: null, takeoff: null, firstPoll: now - status.startedAt < 30000, lookup: { tries: 0, next: 0, busy: false } }));
    e.ac = ac;
    e.at = at;
    if (airborne(ac.alt_baro)) {
      if (!e.airborneSince) { e.airborneSince = at; e.takeoff = null; e.lookup = { tries: 0, next: 0, busy: false }; }
      if (!e.takeoff) lookupTakeoff(hex, e);
    } else if (ac.alt_baro === 'ground') {
      e.airborneSince = null; e.takeoff = null; e.firstPoll = false;
    }
  }
  for (const [hex, e] of seen) if (now - e.at > FORGET_MS || !hexes.has(hex)) seen.delete(hex);
}

function start(json, trace, intervalMs = 10000) {
  fetchJson = json;
  fetchTrace = trace;
  if (timer) return;
  status.startedAt = Date.now();
  setTimeout(poll, 0);
  timer = setInterval(poll, intervalMs);
}

function snapshot() {
  const now = Date.now();
  const aircraft = [];
  for (const [hex, e] of seen) {
    if (now - e.at > SHOW_MS) continue;
    const a = e.ac;
    const up = !!e.airborneSince;
    aircraft.push({
      hex,
      group: hexes.get(hex),
      flight: String(a.flight || '').trim() || null,
      reg: a.r || null,
      type: a.t || null,
      alt: airborne(a.alt_baro) ? a.alt_baro : null,
      onGround: a.alt_baro === 'ground',
      gs: typeof a.gs === 'number' ? Math.round(a.gs) : null,
      vs: typeof a.baro_rate === 'number' ? a.baro_rate : typeof a.geom_rate === 'number' ? a.geom_rate : null,
      squawk: a.squawk || null,
      emergency: a.emergency && a.emergency !== 'none' ? a.emergency : null,
      // Without a route the flight is counted from the first sighting; when that was at start-up the
      // aircraft may well have been up for longer.
      takeoff: up ? e.takeoff || e.airborneSince : null,
      approx: up && !e.takeoff,
      atLeast: up && !e.takeoff && e.firstPoll,
      ageS: Math.round((now - e.at) / 1000),
    });
  }
  aircraft.sort((x, y) => (x.onGround - y.onGround) || ((x.takeoff || 0) - (y.takeoff || 0)));
  return { ok: status.lastOk > 0 && now - status.lastOk < 60000, lastOk: status.lastOk, startedAt: status.startedAt, tracked: hexes.size, aircraft };
}

module.exports = { start, setHexes, snapshot, takeoffFromTrace };
