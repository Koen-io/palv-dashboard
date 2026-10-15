// Live air traffic for the Vluchtradar and for "In de lucht", from the open ADS-B aggregators.
// adsb.fi answers once a second with positions that are mostly well under a second old; adsb.lol
// fills in every few seconds with what its own receivers hear. Per aircraft the newest message and
// the newest position win, so two sources never make an aircraft jump back. Every round is pushed
// to the dashboard straight away instead of waiting for it to ask.

const FI = 'https://opendata.adsb.fi/api/v2';
const LOL = 'https://api.adsb.lol/v2';
const TICK_MS = 1000;      // adsb.fi allows one request a second
const LOL_GAP_MS = 8000;   // adsb.lol throttles hard; now and then is what it takes
const KEEP_MS = 90000;     // an aircraft is forgotten this long after its last message
const WATCH_MS = 20000;    // a watcher that has not renewed for this long has gone
const MAX_NM = 250;        // largest area the sources answer for

const store = new Map(); // hex -> record
const status = { lastOk: 0, failures: 0, startedAt: 0, src: null, latency: null };
const pause = { fi: 0, lol: 0 }; // no requests to a source before this moment (after a refusal)
let area = null, areaAt = 0, watchedAt = 0;
let hexes = new Map(); // hex -> group of the own aircraft
let fetchJson = null, onUpdate = null, timer = null, round = 0, lastLol = 0;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// What the dashboard wants to see: an area for the radar (or none) and the own aircraft by group.
function watch(req) {
  const now = Date.now();
  watchedAt = now;
  const a = req && req.area;
  if (a && num(a.lat) != null && num(a.lon) != null) {
    area = { lat: +a.lat.toFixed(3), lon: +a.lon.toFixed(3), nm: Math.round(Math.min(MAX_NM, Math.max(20, +a.nm || 100))) };
    areaAt = now;
  } else if (req && 'area' in req) area = null;
  const next = new Map();
  for (const [group, list] of Object.entries((req && req.groups) || {})) {
    for (const hex of list || []) if (/^[0-9a-f]{6}$/.test(hex)) next.set(hex, group);
  }
  hexes = next;
  if (!timer) {
    status.startedAt = status.startedAt || now;
    timer = setTimeout(tick, 0);
  }
  return snapshot();
}

async function get(src, url) {
  if (Date.now() < pause[src]) return null;
  try {
    const data = await fetchJson(url, src === 'fi' ? 5000 : 4000);
    return data && (Array.isArray(data.ac) || Array.isArray(data.aircraft)) ? data : null;
  } catch (err) {
    // Asked to slow down: leave the source alone for a while.
    if (/429|403/.test(String(err && err.message))) pause[src] = Date.now() + (src === 'fi' ? 5000 : 60000);
    return null;
  }
}

function merge(data, src) {
  const list = data.ac || data.aircraft;
  const srvNow = data.now > 1e12 ? data.now : data.now * 1000;
  let n = 0;
  for (const ac of list) {
    const hex = String(ac.hex || '').toLowerCase();
    if (!hex) continue;
    const msgAt = srvNow - (num(ac.seen) || 0) * 1000;
    let r = store.get(hex);
    if (!r) store.set(hex, (r = { hex, msgAt: 0, posAt: 0, lat: null, lon: null }));
    if (msgAt >= r.msgAt) {
      r.msgAt = msgAt;
      r.src = src;
      r.flight = String(ac.flight || '').trim() || null;
      r.reg = ac.r || r.reg || null;
      r.type = ac.t || r.type || null;
      r.desc = ac.desc || r.desc || null;
      r.cat = ac.category || null;
      r.alt = ac.alt_baro === 'ground' ? 'ground' : num(ac.alt_baro);
      r.altGeom = num(ac.alt_geom);
      r.gs = num(ac.gs);
      r.track = num(ac.track) ?? num(ac.true_heading) ?? r.track ?? null;
      r.vs = num(ac.baro_rate) ?? num(ac.geom_rate);
      r.squawk = ac.squawk || null;
      r.emergency = ac.emergency && ac.emergency !== 'none' ? ac.emergency : null;
      r.mil = !!((ac.dbFlags | 0) & 1);
      r.mlat = Array.isArray(ac.mlat) && ac.mlat.includes('lat');
    }
    if (num(ac.lat) != null && num(ac.lon) != null) {
      const posAt = srvNow - (num(ac.seen_pos) ?? num(ac.seen) ?? 0) * 1000;
      if (posAt > r.posAt) { r.posAt = posAt; r.lat = ac.lat; r.lon = ac.lon; }
    }
    n += 1;
  }
  return n;
}

async function tick() {
  timer = null;
  const started = Date.now();
  if (started - watchedAt > WATCH_MS) return; // nobody is looking any more
  round += 1;
  const wantArea = !!area && started - areaAt < WATCH_MS;
  const own = [...hexes.keys()];
  // Mostly the area; every fifth round the own aircraft by code, for the ones outside the area.
  const byHex = own.length && (!wantArea || round % 5 === 0);
  const path = byHex ? `/hex/${own.join(',')}` : wantArea ? `/lat/${area.lat}/lon/${area.lon}/dist/${area.nm}` : null;
  const jobs = [];
  if (path) jobs.push(get('fi', FI + path).then((d) => d || get('lol', LOL + path).then((l) => (l ? ['adsb.lol', l] : null))).then((d) => (Array.isArray(d) ? d : d ? ['adsb.fi', d] : null)));
  if (wantArea && started - lastLol >= LOL_GAP_MS) {
    lastLol = started;
    jobs.push(get('lol', `${LOL}/lat/${area.lat}/lon/${area.lon}/dist/${area.nm}`).then((d) => (d ? ['adsb.lol', d] : null)));
  }
  const results = (await Promise.all(jobs)).filter(Boolean);
  const now = Date.now();
  if (results.length) {
    for (const [src, data] of results) merge(data, src);
    status.lastOk = now;
    status.failures = 0;
    status.src = results[0][0];
    status.latency = now - started;
  } else if (jobs.length) status.failures += 1;
  for (const [hex, r] of store) if (now - r.msgAt > KEEP_MS) store.delete(hex);
  if (onUpdate) { try { onUpdate(snapshot()); } catch { /* window gone */ } }
  timer = setTimeout(tick, Math.max(50, TICK_MS - (Date.now() - started)));
}

function start(json, update) {
  fetchJson = json;
  onUpdate = update;
}

function records() { return store; }

function snapshot() {
  const now = Date.now();
  const ac = [];
  for (const r of store.values()) {
    ac.push({
      hex: r.hex, flight: r.flight, reg: r.reg, type: r.type, desc: r.desc, cat: r.cat,
      alt: r.alt, altGeom: r.altGeom, gs: r.gs, track: r.track, vs: r.vs,
      squawk: r.squawk, emergency: r.emergency, mil: r.mil, mlat: r.mlat,
      lat: r.lat, lon: r.lon, posAt: r.posAt, msgAt: r.msgAt, src: r.src,
      group: hexes.get(r.hex) || null,
    });
  }
  return {
    now,
    ok: status.lastOk > 0 && now - status.lastOk < 30000,
    lastOk: status.lastOk,
    startedAt: status.startedAt,
    src: status.src,
    latency: status.latency,
    area,
    tracked: hexes.size,
    ac,
  };
}

module.exports = { start, watch, snapshot, records, merge, hexGroups: () => hexes };
