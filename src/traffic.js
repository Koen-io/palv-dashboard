// Live air traffic for the Vluchtradar, for "In de lucht", for the runways in use and for the emergency
// watch, from the open ADS-B aggregators. adsb.fi answers about once a second with positions that are
// mostly well under a second old; adsb.lol fills in every few seconds with what its own receivers hear.
// Per aircraft the newest message and the newest position win, so two sources never make an aircraft
// jump back. Every round is pushed to the dashboard straight away instead of waiting for it to ask.
//
// Both sources limit how often they may be asked, and refuse (HTTP 429) when asked too often, also when
// several dashboards share one internet connection. Every request therefore goes through one regulator
// per source: a minimum time between requests, and after a refusal a pause that grows each time
// (2, 4, 8 ... up to 60 s, or what the source asks for itself) and is reset by the first success. While
// one source pauses the other one takes over, so the feed keeps running.

const FI = 'https://opendata.adsb.fi/api/v2';
const LOL = 'https://api.adsb.lol/v2';
const TICK_MS = 1000;      // one round a second
const LOL_GAP_MS = 6000;   // adsb.lol as a supplement, now and then
const KEEP_MS = 90000;     // an aircraft is forgotten this long after its last message
const WATCH_MS = 20000;    // a watcher that has not renewed for this long has gone
const MAX_NM = 250;        // largest area the sources answer for

// The regulator: minimum spacing between two requests to a source, and the pause after a refusal.
const SOURCES = {
  fi: { name: 'adsb.fi', gap: 1000, timeout: 4000 },
  lol: { name: 'adsb.lol', gap: 3000, timeout: 5000 },
};
const gate = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, { last: 0, until: 0, refusals: 0, busy: false, ok: 0, fail: 0, lastError: null }]));

const store = new Map(); // hex -> record
const status = { lastOk: 0, failures: 0, startedAt: 0, src: null, latency: null };
let area = null, areaAt = 0, watchedAt = 0;
let hexes = new Map(); // hex -> group of the own aircraft
let fetchJson = null, onUpdate = null, timer = null, round = 0, lastLol = 0;
// Exactly one round loop at a time: it runs from the first watcher until nobody watches any more.
let looping = false;
let log = { info() {}, warn() {} };

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
  if (!looping) {
    looping = true;
    status.startedAt = status.startedAt || now;
    timer = setTimeout(tick, 0);
  }
  return snapshot();
}

// May this source be asked now?
const free = (src, now = Date.now()) => { const g = gate[src]; return !g.busy && now >= g.until && now - g.last >= SOURCES[src].gap; };

// One request through the regulator; null when the source is resting or did not answer usefully.
async function request(src, url) {
  const g = gate[src], now = Date.now();
  if (!free(src, now)) return null;
  g.busy = true;
  g.last = now;
  try {
    const data = await fetchJson(url, SOURCES[src].timeout);
    if (!data || !(Array.isArray(data.ac) || Array.isArray(data.aircraft))) throw new Error('onbruikbaar antwoord');
    if (g.refusals) log.info('verkeer', `${SOURCES[src].name} levert weer`);
    g.refusals = 0;
    g.ok += 1;
    g.lastError = null;
    return data;
  } catch (err) {
    g.fail += 1;
    const msg = String((err && err.message) || err);
    g.lastError = msg;
    const m = /\b(429|403|503)\b/.exec(msg);
    if (m) {
      // Refused: rest, longer each time, or as long as the source asks.
      g.refusals += 1;
      const asked = err && err.retryAfter ? err.retryAfter * 1000 : 0;
      const pause = Math.min(60000, Math.max(asked, 2000 * 2 ** (g.refusals - 1)));
      g.until = Date.now() + pause;
      if (g.refusals === 1 || g.refusals % 5 === 0) log.warn('verkeer', `${SOURCES[src].name} weigert (HTTP ${m[1]}), pauze ${Math.round(pause / 1000)} s`);
    }
    return null;
  } finally {
    g.busy = false;
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
  if (started - watchedAt > WATCH_MS) { looping = false; return; } // nobody is looking any more
  try {
    await runRound(started);
  } catch (err) {
    log.warn('verkeer', 'ronde mislukt: ' + ((err && err.message) || err));
  }
  // The next round as soon as a second has passed and adsb.fi may be asked again.
  const g = gate.fi, end = Date.now();
  const fiDue = Math.max(g.last + SOURCES.fi.gap, end < g.until ? end : 0) - end;
  timer = setTimeout(tick, Math.max(50, TICK_MS - (end - started), Math.min(fiDue, TICK_MS)));
}

async function runRound(started) {
  round += 1;
  const wantArea = !!area && started - areaAt < WATCH_MS;
  const own = [...hexes.keys()];
  // Mostly the area; every fifth round the own aircraft by code, for the ones outside the area.
  const byHex = own.length && (!wantArea || round % 5 === 0);
  const path = byHex ? `/hex/${own.join(',')}` : wantArea ? `/lat/${area.lat}/lon/${area.lon}/dist/${area.nm}` : null;
  const results = [];
  // adsb.lol as a supplement over the area: what its own receivers hear that adsb.fi misses. It runs
  // alongside and is merged whenever it answers, so a slow answer never holds up a round.
  if (wantArea && started - lastLol >= LOL_GAP_MS && free('lol')) {
    lastLol = started;
    request('lol', `${LOL}/lat/${area.lat}/lon/${area.lon}/dist/${area.nm}`).then((d) => {
      if (!d) return;
      merge(d, 'adsb.lol');
      status.lastOk = Date.now();
    });
  }
  if (path) {
    // adsb.fi first; when it rests after a refusal or fails, adsb.lol takes the round.
    let d = await request('fi', FI + path);
    if (d) results.push(['adsb.fi', d]);
    else if ((d = await request('lol', LOL + path))) { results.push(['adsb.lol', d]); lastLol = Date.now(); }
  }
  const now = Date.now();
  if (results.length) {
    for (const [src, data] of results) merge(data, src);
    status.lastOk = now;
    status.failures = 0;
    status.src = results[0][0];
    status.latency = now - started;
  } else if (path) status.failures += 1;
  for (const [hex, r] of store) if (now - r.msgAt > KEEP_MS) store.delete(hex);
  if (onUpdate) { try { onUpdate(snapshot()); } catch { /* window gone */ } }
}

function start(json, update, logger) {
  fetchJson = json;
  onUpdate = update;
  if (logger) log = logger;
}

function records() { return store; }

// Stops the round loop (tests, shutting down); the next watcher starts it again.
function stop() { clearTimeout(timer); timer = null; looping = false; }

// Why there is no fresh data, in words for the dashboard.
function reason(now) {
  const resting = Object.entries(gate).filter(([, g]) => now < g.until).map(([k]) => SOURCES[k].name);
  if (resting.length === Object.keys(SOURCES).length) return `bronnen beperken het aantal verzoeken (${resting.join(', ')})`;
  const errs = Object.entries(gate).map(([k, g]) => g.lastError && `${SOURCES[k].name}: ${g.lastError}`).filter(Boolean);
  return errs.length ? errs.join(' · ') : null;
}

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
  const ok = status.lastOk > 0 && now - status.lastOk < 30000;
  return {
    now,
    ok,
    lastOk: status.lastOk,
    startedAt: status.startedAt,
    src: status.src,
    latency: status.latency,
    reason: ok ? null : reason(now),
    area,
    tracked: hexes.size,
    ac,
  };
}

// Whether the feed has covered a point (with a margin, in NM) in the last few seconds: the runways in
// use are then read from it rather than asked separately.
function covers(lat, lon, marginNm, now = Date.now()) {
  if (!area || now - areaAt > WATCH_MS || now - status.lastOk > 5000) return false;
  const d = Math.hypot((lat - area.lat) * 60, (lon - area.lon) * 60 * Math.cos((lat * Math.PI) / 180));
  return d + marginNm <= area.nm;
}

module.exports = { start, stop, watch, snapshot, records, merge, request, covers, hexGroups: () => hexes, gate };
