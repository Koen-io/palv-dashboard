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
// one source pauses the other one takes over, so the feed keeps running. When adsb.fi blocks the
// address outright (403) it is only tried again after minutes, up to once every 30 minutes, because
// asking again and again only keeps a block in place.
//
// When neither brings anything fresh for a few seconds, OpenSky (opensky.js) steps in as a reserve,
// within its own strict daily budget.
//
// With several dashboards, only one of them asks the sources (share.js): it fetches for the areas and
// aircraft that all of them want, and every change is pushed to the others the moment it comes in.
// A dashboard that follows another does not ask anything itself, until that link falls away.

const opensky = require('./opensky');

const FI = 'https://opendata.adsb.fi/api/v2';
const LOL = 'https://api.adsb.lol/v2';
const TICK_MS = 1100;      // one round as often as adsb.fi may be asked
const LOL_GAP_MS = 10000;  // adsb.lol as a supplement, now and then
const STALE_MS = 5000;     // nothing fresh from adsb.fi or adsb.lol for this long: OpenSky steps in
const KEEP_MS = 90000;     // an aircraft is forgotten this long after its last message
const WATCH_MS = 20000;    // a watcher that has not renewed for this long has gone
const MAX_NM = 250;        // largest area the sources answer for

// The regulator: minimum spacing between two requests to a source, and the pause after a refusal.
const SOURCES = {
  // adsb.fi allows one request a second per address: a little room under that.
  fi: { name: 'adsb.fi', gap: 1100, timeout: 4000 },
  // adsb.lol refuses quickly when asked every few seconds; also when it has to stand in for adsb.fi.
  lol: { name: 'adsb.lol', gap: 5000, timeout: 6000 },
};
const gate = Object.fromEntries(Object.keys(SOURCES).map((k) => [k, { last: 0, until: 0, refusals: 0, busy: false, ok: 0, fail: 0, lastError: null, lastOkAt: 0 }]));

const store = new Map(); // hex -> record
// lastOk: newest answer from any source; lastAdsb: newest from adsb.fi or adsb.lol, which decides
// whether OpenSky is needed. loopAt: start of the current round loop, so OpenSky is not asked at start-up.
const status = { lastOk: 0, lastAdsb: 0, loopAt: 0, failures: 0, startedAt: 0, src: null, latency: null };
let area = null, areaAt = 0, watchedAt = 0;
let hexes = new Map(); // hex -> group of the own aircraft
let fetchJson = null, onUpdate = null, timer = null, round = 0, lastLol = 0;
// Sharing with the other dashboards (share.js). seq numbers every change to a record, so a follower is
// sent only what changed since its last message. remote: what the followers want (area, own aircraft).
let seq = 0, onShare = null, onWant = null;
const remote = new Map(); // screen id -> { area, hexes }
// While this dashboard follows another one: its name, and what that one says about its sources.
let upstream = null;
const up = { at: 0, src: null, reason: null, reserve: false, adsbFresh: false };
// Exactly one round loop at a time: it runs from the first watcher until nobody watches any more.
let looping = false;
let log = { info() {}, warn() {} };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// What the dashboard wants to see: an area for the radar (or none) and the own aircraft by group.
const cleanArea = (a) => (a && num(a.lat) != null && num(a.lon) != null
  ? { lat: +a.lat.toFixed(3), lon: +a.lon.toFixed(3), nm: Math.round(Math.min(MAX_NM, Math.max(20, +a.nm || 100))) }
  : null);
function cleanGroups(groups) {
  const out = new Map();
  for (const [group, list] of Object.entries(groups || {})) {
    if (!Array.isArray(list)) continue;
    for (const hex of list.slice(0, 500)) if (/^[0-9a-f]{6}$/.test(hex)) out.set(hex, String(group).slice(0, 20));
  }
  return out;
}

function watch(req) {
  const now = Date.now();
  watchedAt = now;
  const a = cleanArea(req && req.area);
  if (a) { area = a; areaAt = now; } else if (req && 'area' in req) area = null;
  hexes = cleanGroups(req && req.groups);
  ensureLoop(now);
  if (onWant) { try { onWant(ownWant(now)); } catch { /* sharing must never stop the feed */ } }
  return snapshot();
}

function ensureLoop(now = Date.now()) {
  if (looping) return;
  looping = true;
  status.startedAt = status.startedAt || now;
  status.loopAt = now;
  timer = setTimeout(tick, 0);
}

// What this dashboard itself wants, to pass on to the one it follows.
function ownWant(now = Date.now()) {
  const groups = {};
  for (const [hex, g] of hexes) (groups[g] || (groups[g] = [])).push(hex);
  return { area: area && now - areaAt < WATCH_MS ? area : null, groups };
}

// A follower's wish, kept while its link is open (share.js removes it when the link closes).
function remoteWant(id, req) {
  remote.set(String(id), { area: cleanArea(req && req.area), hexes: cleanGroups(req && req.groups) });
  ensureLoop();
}
function dropWant(id) { remote.delete(String(id)); }

// What to fetch: the own area and those of the followers together, as one circle around them all,
// and the own aircraft of all of them.
function wanted(now = Date.now()) {
  const areas = [];
  if (area && now - areaAt < WATCH_MS) areas.push(area);
  for (const w of remote.values()) if (w.area) areas.push(w.area);
  const all = new Set(hexes.keys());
  for (const w of remote.values()) for (const hex of w.hexes.keys()) all.add(hex);
  if (areas.length <= 1) return { area: areas[0] || null, hexes: [...all] };
  const lat = areas.reduce((n, a) => n + a.lat, 0) / areas.length, lon = areas.reduce((n, a) => n + a.lon, 0) / areas.length;
  const nm = Math.max(...areas.map((a) => Math.hypot((a.lat - lat) * 60, (a.lon - lon) * 60 * Math.cos((lat * Math.PI) / 180)) + a.nm));
  return { area: { lat: +lat.toFixed(3), lon: +lon.toFixed(3), nm: Math.round(Math.min(MAX_NM, nm)) }, hexes: [...all] };
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
    g.blocked = false;
    g.ok += 1;
    g.lastOkAt = Date.now();
    g.lastError = null;
    return data;
  } catch (err) {
    g.fail += 1;
    const msg = String((err && err.message) || err);
    g.lastError = msg;
    const m = /\b(429|403|503)\b/.exec(msg);
    if (m) {
      // Refused: rest, longer each time, or as long as the source asks. "Too many" (429) is over within
      // a minute; "forbidden" (403) means the address is blocked for a while, and asking again and
      // again only keeps the block in place, so that rests 2, 4, 8, 16 and then 30 minutes.
      g.refusals += 1;
      const blocked = m[1] === '403';
      const asked = err && err.retryAfter ? err.retryAfter * 1000 : 0;
      const pause = blocked
        ? Math.min(1800000, Math.max(asked, 120000 * 2 ** (g.refusals - 1)))
        : Math.min(60000, Math.max(asked, 2000 * 2 ** (g.refusals - 1)));
      g.until = Date.now() + pause;
      g.blocked = blocked;
      if (g.refusals <= 2 || g.refusals % 5 === 0) log.warn('verkeer', `${SOURCES[src].name} ${blocked ? 'blokkeert dit adres' : 'weigert'} (HTTP ${m[1]}), pauze ${Math.round(pause / 1000)} s`);
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
    if (!r) store.set(hex, (r = { hex, msgAt: 0, posAt: 0, lat: null, lon: null, rev: 0 }));
    const before = r.rev;
    if (msgAt >= r.msgAt) {
      if (msgAt > r.msgAt) r.rev = ++seq;
      r.msgAt = msgAt;
      r.src = src;
      r.flight = String(ac.flight || '').trim() || null;
      r.reg = ac.r || r.reg || null;
      r.type = ac.t || r.type || null;
      r.desc = ac.desc || r.desc || null;
      r.cat = ac.category || r.cat || null; // OpenSky often has no category: keep what was heard before
      r.alt = ac.alt_baro === 'ground' ? 'ground' : num(ac.alt_baro);
      r.altGeom = num(ac.alt_geom);
      r.gs = num(ac.gs);
      r.track = num(ac.track) ?? num(ac.true_heading) ?? r.track ?? null;
      r.vs = num(ac.baro_rate) ?? num(ac.geom_rate);
      r.squawk = ac.squawk || null;
      r.emergency = ac.emergency && ac.emergency !== 'none' ? ac.emergency : null;
      r.mil = ac.dbFlags == null ? !!r.mil : !!((ac.dbFlags | 0) & 1);
      r.mlat = Array.isArray(ac.mlat) && ac.mlat.includes('lat');
    }
    if (num(ac.lat) != null && num(ac.lon) != null) {
      const posAt = srvNow - (num(ac.seen_pos) ?? num(ac.seen) ?? 0) * 1000;
      if (posAt > r.posAt) { r.posAt = posAt; r.lat = ac.lat; r.lon = ac.lon; if (r.rev === before) r.rev = ++seq; }
    }
    n += 1;
  }
  return n;
}

// Records from the dashboard this one follows, in the shape of the store: per aircraft the newest
// message and the newest position win, exactly as with the sources themselves.
const MSG_FIELDS = ['src', 'flight', 'reg', 'type', 'desc', 'cat', 'alt', 'altGeom', 'gs', 'track', 'vs', 'squawk', 'emergency', 'mil', 'mlat'];
const FLAGS = new Set(['mil', 'mlat']);
function mergeShared(recs) {
  let n = 0;
  for (const s of Array.isArray(recs) ? recs : []) {
    const hex = s && String(s.hex || '').toLowerCase();
    if (!hex || !/^~?[0-9a-f]{6}$/.test(hex)) continue;
    let r = store.get(hex);
    if (!r) store.set(hex, (r = { hex, msgAt: 0, posAt: 0, lat: null, lon: null, rev: 0 }));
    let changed = false;
    if (num(s.msgAt) != null && s.msgAt > r.msgAt) {
      r.msgAt = s.msgAt;
      for (const k of MSG_FIELDS) r[k] = FLAGS.has(k) ? !!s[k] : s[k] ?? null;
      changed = true;
    }
    if (num(s.posAt) != null && s.posAt > r.posAt && num(s.lat) != null && num(s.lon) != null) {
      r.posAt = s.posAt; r.lat = s.lat; r.lon = s.lon;
      changed = true;
    }
    if (changed) { r.rev = ++seq; n += 1; }
  }
  return n;
}

// Everything that changed after change number `since`, for one follower; empty values left out.
function exportSince(since) {
  const recs = [];
  for (const r of store.values()) {
    if (r.rev <= since) continue;
    const o = { hex: r.hex, msgAt: r.msgAt, posAt: r.posAt };
    if (r.lat != null) { o.lat = r.lat; o.lon = r.lon; }
    for (const k of MSG_FIELDS) if (r[k] != null && r[k] !== false) o[k] = r[k];
    recs.push(o);
  }
  return { seq, recs };
}

// How the own sources are doing, for the followers and for choosing who fetches.
function feedStatus(now = Date.now()) {
  if (upstream) return { src: up.src, adsbFresh: up.adsbFresh && now - up.at < STALE_MS, fiAt: 0, adsbAt: 0, reserve: up.reserve, reason: up.reason };
  const adsbFresh = now - status.lastAdsb < STALE_MS;
  return {
    src: status.src,
    adsbFresh,
    fiAt: gate.fi.lastOkAt,
    adsbAt: status.lastAdsb,
    reserve: status.src === 'OpenSky' && !adsbFresh,
    reason: now - status.lastOk < 30000 && status.src !== 'OpenSky' ? null : reason(now),
  };
}

// Following another dashboard (by name), or with null: fetching again, at once.
function follow(name) {
  if (name && !upstream) log.info('verkeer', `ontvangt het verkeer van ${name}`);
  if (name && upstream && name !== upstream) log.info('verkeer', `ontvangt het verkeer nu van ${name}`);
  if (!name && upstream) {
    log.info('verkeer', `haalt het verkeer weer zelf op (was via ${upstream})`);
    // OpenSky only if the sources also stay quiet for a while from here.
    status.loopAt = Date.now();
    upstream = null;
    if (looping && timer) { clearTimeout(timer); timer = setTimeout(tick, 0); }
    return;
  }
  upstream = name || null;
}
const following = () => upstream;

// One round from the dashboard followed: merged and passed on to the screen at once.
function ingestShared(msg) {
  const now = Date.now();
  mergeShared(msg && msg.recs);
  const st = (msg && msg.st) || {};
  up.at = now;
  up.src = st.src || null;
  up.reason = st.reason || null;
  up.reserve = !!st.reserve;
  up.adsbFresh = !!st.adsbFresh;
  status.lastOk = now;
  if (up.adsbFresh) status.lastAdsb = now;
  status.failures = 0;
  publish();
}

// A new picture: to this screen, and to the dashboards that follow this one.
function publish() {
  if (onUpdate) { try { onUpdate(snapshot()); } catch { /* window gone */ } }
  if (onShare) { try { onShare(); } catch (err) { log.warn('verkeer', 'delen mislukt: ' + ((err && err.message) || err)); } }
}

async function tick() {
  timer = null;
  const started = Date.now();
  if (started - watchedAt > WATCH_MS && !remote.size) { looping = false; return; } // nobody is looking any more
  try {
    await runRound(started);
  } catch (err) {
    log.warn('verkeer', 'ronde mislukt: ' + ((err && err.message) || err));
  }
  // The next round as soon as adsb.fi may be asked again (while it rests, after the usual tick).
  const g = gate.fi, end = Date.now();
  const fiDue = end < g.until ? 0 : g.last + SOURCES.fi.gap - end;
  timer = setTimeout(tick, Math.max(50, TICK_MS - (end - started), Math.min(fiDue, TICK_MS)));
}

async function runRound(started) {
  if (upstream) {
    // Following another dashboard: nothing is asked here. Old aircraft are still forgotten, and the
    // screen stays up to date should the rounds from the other side pause for a moment.
    for (const [hex, r] of store) if (started - r.msgAt > KEEP_MS) store.delete(hex);
    if (started - up.at > 1500 && onUpdate) { try { onUpdate(snapshot()); } catch { /* window gone */ } }
    return;
  }
  round += 1;
  const want = wanted(started);
  const fetchArea = want.area;
  const wantArea = !!fetchArea;
  const own = want.hexes;
  // Mostly the area; every fifth round the own aircraft by code, for the ones outside the area.
  const byHex = own.length && (!wantArea || round % 5 === 0);
  const path = byHex ? `/hex/${own.join(',')}` : wantArea ? `/lat/${fetchArea.lat}/lon/${fetchArea.lon}/dist/${fetchArea.nm}` : null;
  const results = [];
  // adsb.lol as a supplement over the area: what its own receivers hear that adsb.fi misses. It runs
  // alongside and is merged whenever it answers, so a slow answer never holds up a round.
  if (wantArea && started - lastLol >= LOL_GAP_MS && free('lol')) {
    lastLol = started;
    request('lol', `${LOL}/lat/${fetchArea.lat}/lon/${fetchArea.lon}/dist/${fetchArea.nm}`).then((d) => {
      if (!d || upstream) return;
      merge(d, 'adsb.lol');
      status.lastOk = status.lastAdsb = Date.now();
      if (status.src === 'OpenSky') status.src = 'adsb.lol';
      publish(); // straight to the screen and the followers, not at the next round
    });
  }
  // The reserve: OpenSky over the area (or the Netherlands) when the others have gone quiet.
  if (started - Math.max(status.lastAdsb, status.loopAt) > STALE_MS && opensky.ready(started)) {
    opensky.fetchArea(fetchArea, started).then((d) => {
      if (!d || !d.ac.length || upstream) return;
      merge(d, 'OpenSky');
      status.lastOk = Date.now();
      if (Date.now() - status.lastAdsb > STALE_MS) status.src = 'OpenSky';
      publish();
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
    status.lastOk = status.lastAdsb = now;
    status.failures = 0;
    status.src = results[0][0];
    status.latency = now - started;
  } else if (path) status.failures += 1;
  for (const [hex, r] of store) if (now - r.msgAt > KEEP_MS) store.delete(hex);
  if (upstream) return; // started following while this round was under way
  publish();
}

function start(json, update, logger, share = {}) {
  fetchJson = json;
  onUpdate = update;
  if (logger) log = logger;
  onShare = share.onShare || null;
  onWant = share.onWant || null;
}

function records() { return store; }

// Stops the round loop (tests, shutting down); the next watcher starts it again.
function stop() { clearTimeout(timer); timer = null; looping = false; }

// Why there is no fresh data, in words for the dashboard.
function reason(now) {
  const os = opensky.status(now);
  const reserve = os.configured ? `reserve OpenSky: ${os.lastError || (os.budget ? `nog ${os.budget} verzoeken vandaag` : 'dagbudget op')}` : '';
  return [sourcesReason(now), reserve].filter(Boolean).join(' · ') || null;
}
function sourcesReason(now) {
  const resting = Object.entries(gate).filter(([, g]) => now < g.until).map(([k]) => SOURCES[k].name);
  if (resting.length === Object.keys(SOURCES).length) return `bronnen beperken het aantal verzoeken (${resting.join(', ')})`;
  const errs = Object.entries(gate).map(([k, g]) => g.lastError && `${SOURCES[k].name}: ${g.lastError}`).filter(Boolean);
  return errs.length ? errs.join(' · ') : null;
}

function acList() {
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
  return ac;
}

function snapshot() {
  const now = Date.now();
  const ac = acList();
  const ok = status.lastOk > 0 && now - status.lastOk < 30000;
  if (upstream) {
    // Following: the state of the sources is that of the dashboard that fetches.
    return {
      now, ok, lastOk: status.lastOk, startedAt: status.startedAt,
      src: up.src, via: upstream, latency: null,
      reason: ok ? (up.reserve ? up.reason : null) : up.reason || `geen verbinding met ${upstream}`,
      reserve: ok && up.reserve,
      area, tracked: hexes.size, ac,
    };
  }
  return {
    now,
    ok,
    lastOk: status.lastOk,
    startedAt: status.startedAt,
    src: status.src,
    latency: status.latency,
    reason: ok && status.src !== 'OpenSky' ? null : reason(now),
    reserve: ok && status.src === 'OpenSky', // the newest data came from the reserve
    area,
    tracked: hexes.size,
    ac,
  };
}

// Whether the feed has covered a point (with a margin, in NM) in the last few seconds: the runways in
// use are then read from it rather than asked separately.
function covers(lat, lon, marginNm, now = Date.now()) {
  if (!area || now - areaAt > WATCH_MS || now - status.lastAdsb > 5000) return false;
  const d = Math.hypot((lat - area.lat) * 60, (lon - area.lon) * 60 * Math.cos((lat * Math.PI) / 180));
  return d + marginNm <= area.nm;
}

module.exports = {
  start, stop, watch, snapshot, records, merge, request, covers, hexGroups: () => hexes, gate,
  // sharing between dashboards (share.js)
  ownWant, remoteWant, dropWant, wanted, exportSince, mergeShared, ingestShared, feedStatus, follow, following,
};
