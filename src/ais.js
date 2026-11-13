// Live AIS (ships) for the Offshore tab, from aisstream.io: one WebSocket that pushes every position and
// static message of every vessel in the North Sea area. Free, with an API key of a free account; the key
// is kept in the unit's private file (like the openAIP key), so every screen of the unit gets it.
//
// Between the screens: as with the live air traffic, only one screen keeps the stream open. A screen that
// follows another one for the air traffic (share.js) asks that screen for its ships; when that screen has
// no AIS, any screen of the unit that has it will do. A follower polls every 2 seconds for what changed.
//
// What is kept per vessel: the newest position (SOG, COG, heading, rate of turn, navigational status),
// the static data (name, IMO, call sign, type, dimensions, draught, destination, ETA) and a track of the
// last hours. Vessels not heard from for an hour are dropped. The static data also goes to disk, so a
// vessel has its name again right after a restart, before its next static message (those come every
// 6 minutes at most).
//
// Photos: Wikimedia Commons keeps a category per IMO number ("Category:IMO 9321483") with photos of the
// ship; the first good one is shown, with the photographer and the licence. Without an IMO number (most
// small craft) the name is searched.
//
// Which ship is looked at must never leave the unit. So a tap never asks anything outside: the screen
// that holds the stream fetches, slowly and in the background, a photo of EVERY ship in the stream (in the
// order they were first heard, ships with an IMO number first), and keeps it on disk with the not-found
// answers. A tapped ship is only looked up in that store, or in the store of the screen this one follows
// (over the unit key). Wikimedia only ever sees the whole North Sea being worked through, under the
// neutral name of ua.js. A ship heard for the first time has no photo until its turn comes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

//
// Two sources, merged per MMSI (1.52): aisstream.io (with the key) and Open Waters (ais.openwaters.io, free,
// no key, anonymous tier: 20 messages a second over at most 100 square degrees). Open Waters re-serves the
// AISHub aggregate, volunteer receivers (one near Antwerp at the native rate), Kystverket and BarentsWatch
// (the Norwegian sector) and aisstream itself; the aisstream part is skipped while our own aisstream runs.
// Every message is placed at the time it was received by the station (not when it reached us), and a
// position only counts when it is newer than the one the vessel has: the freshest wins, whatever the source.
// A coarse long-range position (msg 27) never replaces a precise class A/B position of the last 10 minutes.
//
// To the renderer and the other screens: a request may wait (long-poll) until something changed, so a new
// position is on every screen within about a second instead of after the next 2-second poll.
// The register (positions of the last hour) goes to disk too, so the map is full right after a restart.
const STREAM = 'wss://stream.aisstream.io/v0/stream';
const OW_STREAM = 'wss://ais.openwaters.io/v1/stream';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
// The North Sea around the Netherlands, generous: Dover to the German Bight and up to the Danish sector.
const DEFAULT_BBOX = [[50.0, -2.0], [57.5, 9.5]];
// The same box for Open Waters ([minLat, minLon, maxLat, maxLon]): 7.5° × 11.5° = 86 square degrees.
const OW_BBOX = [[DEFAULT_BBOX[0][0], DEFAULT_BBOX[0][1], DEFAULT_BBOX[1][0], DEFAULT_BBOX[1][1]]];
const LR_HOLD_MS = 10 * 60000;     // a long-range position (msg 27) waits this long behind a precise one
const FUTURE_MS = 5000;            // a station clock this far ahead is not believed: the time of arrival
const WAIT_MAX_MS = 25000;         // the longest a request waits for something new
const LIVE_FILE = 'ais-live.json';
const MSG_TYPES = ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport', 'AidsToNavigationReport', 'LongRangeAisBroadcastMessage', 'BaseStationReport'];
const KEEP_MS = 60 * 60000;        // a vessel silent this long is dropped
const TRACK_MS = 6 * 3600e3;       // the track kept per vessel
const TRACK_MAX = 900;             // points per vessel
const TRACK_MIN_M = 25;            // a new point only after this much movement, or a minute
const TRACK_MIN_S = 60;
const STATIC_FILE = 'ais-static.json', PHOTO_FILE = 'ais-fotos.json', PHOTO_DIR = 'ais-fotos';
const OLD_PHOTO_FILE = 'ais-photos.json'; // up to 1.32: links to Commons, looked up per tap
const STATIC_MAX = 30000;
const PHOTO_OK_MS = 90 * 86400e3;  // a found photo is checked again after this long
const PHOTO_BAD_MS = 21 * 86400e3; // a ship without a photo is asked again after this long
const PHOTO_GAP_MS = 4000;         // between two lookups: at most about 900 an hour, gentle for Commons
const PHOTO_IDLE_MS = 60000;       // nothing to do: look again after a minute
const PHOTO_PAUSE_MS = 30 * 60000; // Commons asks to slow down (429/403): rest this long
const PHOTO_RETRY_MS = 15 * 60000; // a lookup that failed (network) is tried again after this long
const PHOTO_FILES_MAX = 5000;      // photos kept on disk (well under 1 GB), the oldest go first
const PHOTO_INDEX_MAX = 40000;     // found and not-found answers kept
const PHOTO_W = 960;               // width of the stored photo, enough for the card on a 4K screen
const FOLLOW_MS = 700;           // at least this long between two answers from the screen this one follows
const WATCH_MS = 20000;            // a renderer that asked this recently keeps the follower polling
const RECONNECT_MS = [3000, 6000, 12000, 30000, 60000];
const UA = require('./ua').APP;

let dir = null, log = { info() {}, warn() {} }, screens = null, share = null, store = null, peerGet = null;
let key = null, lastMsg = 0, lastErr = null, stopping = false;
let role = 'lead', via = null, followBusy = false, lastWatch = 0, followSince = 0;
let staticDirty = false, liveDirty = false;
let owOn = false;            // Open Waters: on from start() (not in the tests, which never start)
// One live stream per source: its socket, state and message rate.
const mkSource = (id, name) => ({ id, name, ws: null, connected: false, lastMsg: 0, lastErr: null, retries: 0, timer: null, count: 0, window: [], used: 0, info: null });
const SRC = { aisstream: mkSource('aisstream', 'aisstream.io'), openwaters: mkSource('openwaters', 'Open Waters') };
const anyConnected = () => SRC.aisstream.connected || SRC.openwaters.connected;
const vessels = new Map();   // mmsi -> record
const tracks = new Map();    // mmsi -> [[t, lat, lon, sog, cog]]
const gone = [];             // [mmsi, rev] of dropped vessels, for the followers
let rev = 0;
let staticData = {};         // mmsi -> { name, imo, callsign, type, a, b, c, d, draught, at }
let photos = {};             // 'imo:<n>' | 'name:<name>' -> { img: { title, file, page, author, licence, desc, w, h } | null, how, at }
let photosDirty = false, photoTimer = null, photoPauseUntil = 0, photoErr = null;
const photoRetry = new Map(); // key -> not before (ms), after a failed lookup

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => { const s = String(v == null ? '' : v).replace(/@/g, '').trim(); return s || null; };
const rad = (d) => (d * Math.PI) / 180;
function distM(aLat, aLon, bLat, bLon) {
  const x = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(x)));
}

/* ---------- files ---------- */
function loadFiles() {
  try { staticData = JSON.parse(fs.readFileSync(path.join(dir, STATIC_FILE), 'utf8')) || {}; } catch { staticData = {}; }
  try { photos = JSON.parse(fs.readFileSync(path.join(dir, PHOTO_FILE), 'utf8')) || {}; } catch { photos = {}; }
  try { fs.mkdirSync(path.join(dir, PHOTO_DIR), { recursive: true }); } catch { /* reported when a photo is written */ }
  // The old store only held links that were looked up per tap: it goes.
  try { fs.unlinkSync(path.join(dir, OLD_PHOTO_FILE)); } catch { /* not there */ }
}
function saveStatic() {
  if (!staticDirty) return;
  staticDirty = false;
  try {
    const keys = Object.keys(staticData);
    if (keys.length > STATIC_MAX) for (const k of keys.sort((a, b) => (staticData[a].at || 0) - (staticData[b].at || 0)).slice(0, keys.length - STATIC_MAX)) delete staticData[k];
    fs.writeFileSync(path.join(dir, STATIC_FILE), JSON.stringify(staticData), 'utf8');
  } catch (err) { log.warn('ais', 'scheepsgegevens opslaan mislukt: ' + err.message); }
}
function savePhotos() {
  if (!photosDirty) return;
  photosDirty = false;
  try {
    // At most PHOTO_INDEX_MAX answers and PHOTO_FILES_MAX photos: the oldest go first, with their file.
    const keys = Object.keys(photos).sort((a, b) => (photos[a].at || 0) - (photos[b].at || 0));
    let total = keys.length, files = keys.filter((k) => photos[k].img).length;
    for (const k of keys) {
      if (total <= PHOTO_INDEX_MAX && !(photos[k].img && files > PHOTO_FILES_MAX)) continue;
      if (photos[k].img) { removePhotoFile(photos[k].img.file); files -= 1; }
      delete photos[k];
      total -= 1;
    }
    const file = path.join(dir, PHOTO_FILE), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(photos), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) { log.warn('ais', 'fotolijst opslaan mislukt: ' + err.message); }
}
// The register itself (the last hour), so the map is full again right after a restart.
function saveLive() {
  if (!liveDirty || !dir) return;
  liveDirty = false;
  try {
    const now = Date.now(), out = [];
    for (const r of vessels.values()) if (r.lat != null && now - r.msgAt < KEEP_MS) out.push({ ...pub(r), lr: !!r.lr });
    const file = path.join(dir, LIVE_FILE), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ at: now, vessels: out }), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) { log.warn('ais', 'schepenregister opslaan mislukt: ' + err.message); }
}
function loadLive() {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(path.join(dir, LIVE_FILE), 'utf8')); } catch { return 0; }
  const now = Date.now();
  let n = 0;
  for (const v of (saved && Array.isArray(saved.vessels) ? saved.vessels : [])) {
    const mmsi = String((v && v.mmsi) || '').replace(/\D/g, '');
    if (!mmsi || vessels.has(mmsi) || !(now - (+v.msgAt || 0) < KEEP_MS) || num(v.lat) == null || num(v.lon) == null) continue;
    const r = rec(mmsi);
    for (const k of PUB_KEYS) if (k !== 'mmsi' && v[k] !== undefined) r[k] = v[k];
    r.lr = !!v.lr;
    r.rev = ++rev;
    n += 1;
  }
  return n;
}

/* ---------- the register ---------- */
function rec(mmsi) {
  let r = vessels.get(mmsi);
  if (!r) {
    const st = staticData[mmsi] || {};
    r = { mmsi, name: st.name || null, imo: st.imo || null, callsign: st.callsign || null, type: st.type ?? null, a: st.a ?? null, b: st.b ?? null, c: st.c ?? null, d: st.d ?? null, draught: st.draught ?? null, dest: st.dest || null, eta: st.eta || null,
      lat: null, lon: null, sog: null, cog: null, hdg: null, rot: null, nav: null, posAt: 0, msgAt: 0, cls: null, rev: 0, src: 'aisstream', attr: null, lr: false };
    vessels.set(mmsi, r);
  }
  return r;
}
function touch(r) { r.rev = ++rev; r.msgAt = Date.now(); liveDirty = true; changed(); }

// When a message was received by its station: aisstream's "2026-11-13 16:10:32.123456789 +0000 UTC" or
// Open Waters' ISO time. A clock ahead of ours (or no time at all) is the moment it reached us.
function msgTime(s, now = Date.now()) {
  if (!s) return now;
  const iso = String(s).trim().replace(/ \+0000 UTC$/, 'Z').replace(/^(\d{4}-\d\d-\d\d) /, '$1T').replace(/(\.\d{3})\d+/, '$1');
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t > now + FUTURE_MS) return now;
  return Math.min(t, now);
}

function addTrack(r, t) {
  let tr = tracks.get(r.mmsi);
  if (!tr) { tr = []; tracks.set(r.mmsi, tr); }
  const last = tr[tr.length - 1];
  if (last && t - last[0] < TRACK_MIN_S * 1000 && distM(last[1], last[2], r.lat, r.lon) < TRACK_MIN_M) return;
  tr.push([t, r.lat, r.lon, r.sog, r.cog]);
  if (tr.length > TRACK_MAX) tr.splice(0, tr.length - TRACK_MAX);
}

// One message in aisstream.io's shape: { MessageType, MetaData: { MMSI, ShipName, latitude, longitude,
// time_utc }, Message: { <type>: {...} } }. Open Waters events are put in that shape first (owMessage).
// `from` names the source shown on the card ({ src, attr }); without it: aisstream.io.
function ingest(m, from) {
  const meta = m.MetaData || {};
  const mmsi = String(meta.MMSI || '').replace(/\D/g, '');
  if (!mmsi) return;
  const body = (m.Message && m.Message[m.MessageType]) || {};
  const t = msgTime(meta.time_utc);
  if (Date.now() - t > KEEP_MS) return; // an hour old: of no use
  const r = rec(mmsi);
  const nameMeta = str(meta.ShipName);
  if (nameMeta && !r.name) r.name = nameMeta;
  switch (m.MessageType) {
    case 'PositionReport':
    case 'StandardClassBPositionReport':
    case 'ExtendedClassBPositionReport':
    case 'LongRangeAisBroadcastMessage': {
      const lat = num(body.Latitude ?? meta.latitude), lon = num(body.Longitude ?? meta.longitude);
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
      // The freshest position wins: one that was received earlier than the one we have is old news.
      if (r.lat != null && t < r.posAt) return;
      const lr = m.MessageType === 'LongRangeAisBroadcastMessage';
      if (lr && r.lat != null && !r.lr && t - r.posAt < LR_HOLD_MS) return;
      r.lat = lat; r.lon = lon; r.lr = lr;
      r.src = (from && from.src) || 'aisstream'; r.attr = (from && from.attr) || null;
      if (m.MessageType === 'ExtendedClassBPositionReport') {
        const name = str(body.Name); if (name) r.name = name;
        const type = num(body.Type); if (type != null && type > 0) r.type = type;
        const d = body.Dimension || {};
        if (num(d.A) != null && num(d.A) + num(d.B) > 0) { r.a = num(d.A); r.b = num(d.B); r.c = num(d.C); r.d = num(d.D); }
        if (name || type) remember(r);
      }
      const sog = num(body.Sog); r.sog = sog != null && sog < 102.3 ? sog : null;
      const cog = num(body.Cog); r.cog = cog != null && cog < 360 ? cog : null;
      const hdg = num(body.TrueHeading); r.hdg = hdg != null && hdg < 360 ? hdg : null;
      if (m.MessageType === 'PositionReport') {
        const rot = num(body.RateOfTurn); r.rot = rot != null && rot !== -128 ? rot : null;
        const nav = num(body.NavigationalStatus); r.nav = nav != null && nav !== 15 ? nav : r.nav;
        r.cls = 'A';
      } else if (m.MessageType === 'LongRangeAisBroadcastMessage') { const nav = num(body.NavigationalStatus); if (nav != null && nav !== 15) r.nav = nav; }
      else r.cls = 'B';
      r.posAt = t;
      addTrack(r, t);
      touch(r);
      break;
    }
    case 'ShipStaticData': {
      r.cls = 'A';
      const name = str(body.Name); if (name) r.name = name;
      const imo = num(body.ImoNumber); r.imo = imo && imo > 0 ? imo : r.imo;
      r.callsign = str(body.CallSign) || r.callsign;
      const type = num(body.Type); if (type != null && type > 0) r.type = type;
      const d = body.Dimension || {};
      if (num(d.A) != null) { r.a = num(d.A); r.b = num(d.B); r.c = num(d.C); r.d = num(d.D); }
      const dr = num(body.MaximumStaticDraught); if (dr != null && dr > 0) r.draught = dr;
      r.dest = str(body.Destination) || r.dest;
      const e = body.Eta || {};
      if (num(e.Month) && num(e.Day)) r.eta = `${String(e.Month).padStart(2, '0')}-${String(e.Day).padStart(2, '0')} ${String(e.Hour ?? 24).padStart(2, '0')}:${String(e.Minute ?? 60).padStart(2, '0')}`;
      remember(r);
      touch(r);
      break;
    }
    case 'StaticDataReport': {
      r.cls = r.cls || 'B';
      const a = body.ReportA || {}, b = body.ReportB || {};
      const name = str(a.Name); if (name) r.name = name;
      const type = num(b.ShipType); if (type != null && type > 0) r.type = type;
      r.callsign = str(b.CallSign) || r.callsign;
      const d = b.Dimension || {};
      if (num(d.A) != null) { r.a = num(d.A); r.b = num(d.B); r.c = num(d.C); r.d = num(d.D); }
      remember(r);
      touch(r);
      break;
    }
    case 'AidsToNavigationReport': {
      const lat = num(body.Latitude ?? meta.latitude), lon = num(body.Longitude ?? meta.longitude);
      if (lat == null || lon == null || t < r.posAt) return;
      r.cls = 'aton'; r.lat = lat; r.lon = lon; r.posAt = t;
      r.name = str(body.Name) || r.name; r.type = num(body.Type) ?? r.type;
      r.src = (from && from.src) || 'aisstream'; r.attr = (from && from.attr) || null;
      touch(r);
      break;
    }
    case 'BaseStationReport': {
      const lat = num(body.Latitude ?? meta.latitude), lon = num(body.Longitude ?? meta.longitude);
      if (lat == null || lon == null || t < r.posAt) return;
      r.cls = 'base'; r.lat = lat; r.lon = lon; r.posAt = t;
      r.src = (from && from.src) || 'aisstream'; r.attr = (from && from.attr) || null;
      touch(r);
      break;
    }
    default: return;
  }
  if (!r.name && nameMeta) r.name = nameMeta;
}
function remember(r) {
  staticData[r.mmsi] = { name: r.name, imo: r.imo, callsign: r.callsign, type: r.type, a: r.a, b: r.b, c: r.c, d: r.d, draught: r.draught, dest: r.dest, eta: r.eta, at: Date.now() };
  staticDirty = true;
}

function prune() {
  const now = Date.now();
  for (const [mmsi, r] of vessels) {
    if (now - r.msgAt > KEEP_MS) { vessels.delete(mmsi); tracks.delete(mmsi); gone.push([mmsi, ++rev]); }
  }
  for (const tr of tracks.values()) while (tr.length && now - tr[0][0] > TRACK_MS) tr.shift();
  while (gone.length > 5000) gone.shift();
}

/* ---------- the streams ---------- */
// Open Waters event -> aisstream's shape. The aisstream part of Open Waters is skipped while our own
// aisstream stream runs (the same messages, a little later). Returns null for anything that is no vessel news.
const OW_NAMES = { aishub: 'AISHub', aisstream: 'aisstream.io', kystverket: 'Kystverket', barentswatch: 'BarentsWatch', digitraffic: 'Digitraffic', udp: 'ontvanger', station: 'ontvanger' };
function owMessage(m) {
  if (!m || m.type !== 'event' || !m.msg_type || !m.mmsi) return null;
  const kind = String(m.source || '').split(':')[0];
  if (kind === 'aisstream' && SRC.aisstream.connected) return null;
  const from = { src: `Open Waters · ${OW_NAMES[kind] || kind || 'onbekend'}`, attr: str(String(m.attribution || '').slice(0, 240)) };
  return { msg: { MessageType: m.msg_type, MetaData: { MMSI: m.mmsi, latitude: m.lat, longitude: m.lon, time_utc: m.time }, Message: { [m.msg_type]: m.message || {} } }, from };
}
// What each source needs to open its stream; null when it cannot (aisstream without a key).
function opening(s) {
  if (s.id === 'aisstream') return key ? { url: STREAM, hello: { APIKey: key, BoundingBoxes: [DEFAULT_BBOX], FilterMessageTypes: MSG_TYPES } } : null;
  return owOn ? { url: OW_STREAM, hello: { type: 'subscribe', bbox: OW_BBOX } } : null;
}
function connect(s) {
  if (s.ws || stopping || role !== 'lead' || typeof WebSocket === 'undefined') return;
  const how = opening(s);
  if (!how) return;
  let sock;
  try { sock = new WebSocket(how.url); } catch (err) { s.lastErr = err.message; scheduleReconnect(s); return; }
  s.ws = sock;
  const opened = Date.now();
  sock.addEventListener('open', () => { try { sock.send(JSON.stringify(how.hello)); } catch (err) { s.lastErr = err.message; } });
  // aisstream.io sends its JSON as binary frames: taken as bytes and decoded, not as text.
  try { sock.binaryType = 'arraybuffer'; } catch { /* not every implementation */ }
  const onText = (text) => {
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!s.connected) { s.connected = true; s.retries = 0; s.lastErr = null; log.info('ais', `verbonden met ${s.name}`); }
    s.lastMsg = Date.now(); s.count += 1;
    if (m && m.error) { s.lastErr = String(m.error); log.warn('ais', `${s.name}: ${s.lastErr}`); return; }
    if (s.id === 'openwaters') {
      if (m && m.type === 'welcome') { s.info = { role: m.role || null, limits: m.limits || null }; return; }
      if (m && (m.type === 'error' || m.type === 'notice')) { s.lastErr = String(m.message || m.reason || m.type); log.warn('ais', `Open Waters: ${s.lastErr}`); return; }
      const got = owMessage(m);
      if (!got) return;
      try { ingest(got.msg, got.from); s.used += 1; } catch { /* one bad message */ }
    } else {
      try { ingest(m); s.used += 1; } catch { /* one bad message */ }
    }
    lastMsg = Math.max(lastMsg, s.lastMsg);
  };
  sock.addEventListener('message', (ev) => {
    const d = ev.data;
    if (typeof d === 'string') onText(d);
    else if (d instanceof ArrayBuffer) onText(Buffer.from(d).toString('utf8'));
    else if (ArrayBuffer.isView(d)) onText(Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString('utf8'));
    else if (d && typeof d.text === 'function') d.text().then(onText).catch(() => {});
  });
  const down = (why) => {
    if (s.ws !== sock) return;
    s.ws = null;
    const was = s.connected;
    s.connected = false;
    if (was || Date.now() - opened > 10000) log.warn('ais', `verbinding met ${s.name} weg (${why}); opnieuw proberen`);
    if (!s.lastErr || !was) s.lastErr = why;
    scheduleReconnect(s);
  };
  sock.addEventListener('close', (ev) => down(`gesloten ${ev.code || ''}${ev.reason ? ' ' + ev.reason : ''}`.trim()));
  sock.addEventListener('error', () => down('fout'));
}
function scheduleReconnect(s) {
  clearTimeout(s.timer); s.timer = null;
  if (stopping || role !== 'lead' || !opening(s)) return;
  const wait = RECONNECT_MS[Math.min(s.retries, RECONNECT_MS.length - 1)];
  s.retries += 1;
  s.timer = setTimeout(() => { s.timer = null; connect(s); }, wait);
  if (s.timer.unref) s.timer.unref();
}
function disconnect(why, only) {
  for (const s of Object.values(SRC)) {
    if (only && s.id !== only) continue;
    clearTimeout(s.timer); s.timer = null;
    const w = s.ws;
    s.ws = null;
    if (w) { try { w.close(); } catch { /* closed */ } if (s.connected) log.info('ais', `${s.name} gesloten: ${why}`); }
    s.connected = false;
  }
}
const connectAll = () => { for (const s of Object.values(SRC)) if (!s.ws && !s.timer) connect(s); };

/* ---------- following another screen ---------- */
// The screen to take the ships from: the one this screen follows for the air traffic when it has AIS,
// else any screen of the unit that has it; none when this screen has a key of its own and the others not.
function pickSource() {
  const peers = screens ? screens.peers() : [];
  const has = (p) => p.online && p.secure && p.status && !p.status.ephemeral && p.status.ais && p.status.ais.connected;
  const info = share && share.info();
  const leadId = info && info.leader ? info.leader.id : null;
  const lead = leadId ? peers.find((p) => p.id === leadId && has(p)) : null;
  if (lead) return lead;
  if (key) return null;
  return peers.find(has) || null;
}
function evaluate() {
  const src = pickSource();
  if (src) {
    if (role !== 'follow' || !via || via.id !== src.id) { role = 'follow'; via = { id: src.id, name: src.name, address: src.address, port: src.port, secure: true }; followSince = 0; disconnect(`volgt ${src.name}`); }
    else via.address = src.address;
  } else if (role !== 'lead') { role = 'lead'; via = null; followSince = 0; for (const s of Object.values(SRC)) s.retries = 0; }
  if (role === 'lead' && !stopping) {
    if (!key) disconnect('geen sleutel', 'aisstream');
    connectAll();
  }
}
// Asks the screen it follows for what changed; that screen answers at once when it has news, or else as
// soon as something comes in (up to 15 s, under the 20 s socket timeout of the unit agent). A screen of before 1.52 answers at once: then once a second.
async function followOnce() {
  if (role !== 'follow' || !via || followBusy || Date.now() - lastWatch > WATCH_MS) return false;
  followBusy = true;
  const from = via;
  try {
    const got = await peerGet(from, `/api/ais/snap?since=${followSince}&wait=15000`, 22000);
    if (!got || !Array.isArray(got.vessels)) throw new Error('geen antwoord');
    if (via !== from) return true;
    const now = Date.now();
    for (const v of got.vessels) {
      const mmsi = String(v.mmsi || '');
      if (!mmsi) continue;
      const r = rec(mmsi);
      const moved = v.lat != null && (v.lat !== r.lat || v.lon !== r.lon);
      Object.assign(r, v, { rev: 0, src: v.src ? `${String(v.src).replace(/ (via .*)$/, '')} (via ${from.name})` : `via ${from.name}` });
      r.msgAt = now;
      if (moved && r.lat != null) addTrack(r, v.posAt || now);
      touch(r);
    }
    for (const mmsi of got.gone || []) if (vessels.delete(String(mmsi))) { tracks.delete(String(mmsi)); gone.push([String(mmsi), ++rev]); changed(); }
    followSince = got.rev || followSince;
    lastMsg = got.lastMsg || now;
    lastErr = null;
    return true;
  } catch (err) { lastErr = `${from.name}: ${err.message}`; followSince = 0; return false; }
  finally { followBusy = false; }
}
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
async function followLoop() {
  while (!stopping) {
    if (role !== 'follow' || !via || Date.now() - lastWatch > WATCH_MS) { await sleep(500); continue; }
    const t0 = Date.now();
    const ok = await followOnce();
    // At least FOLLOW_MS between two answers (a screen that answers at once is not asked in a tight loop).
    await sleep(Math.max(0, (ok ? FOLLOW_MS : 3000) - (Date.now() - t0)));
  }
}

/* ---------- what the dashboard and the other screens get ---------- */
const PUB_KEYS = ['mmsi', 'name', 'imo', 'callsign', 'type', 'a', 'b', 'c', 'd', 'draught', 'dest', 'eta', 'lat', 'lon', 'sog', 'cog', 'hdg', 'rot', 'nav', 'posAt', 'msgAt', 'cls', 'src', 'attr'];
function pub(r) { const o = {}; for (const k of PUB_KEYS) o[k] = r[k] === undefined ? null : r[k]; return o; }
function snapshot(since = 0) {
  lastWatch = Date.now();
  const out = [];
  for (const r of vessels.values()) if (r.rev > since && r.lat != null) out.push(pub(r));
  return { ok: true, now: Date.now(), rev, since, vessels: out, gone: gone.filter((g) => g[1] > since).map((g) => g[0]), total: vessels.size, lastMsg, status: status() };
}
// Waiting for news: whoever asks with a stand that is already current gets an answer as soon as something
// changes (gathered for 60 ms, so a burst of messages goes in one answer), or after waitMs with nothing.
const waiters = new Set();
let changeTimer = null;
function changed() {
  if (!waiters.size || changeTimer) return;
  changeTimer = setTimeout(() => { changeTimer = null; const all = [...waiters]; waiters.clear(); for (const f of all) f(); }, 60);
}
function snapWait(since = 0, waitMs = 0) {
  lastWatch = Date.now();
  const ms = Math.min(WAIT_MAX_MS, Math.max(0, +waitMs || 0));
  if (!ms || rev > since || stopping) return Promise.resolve(snapshot(since));
  return new Promise((resolve) => {
    let t = null;
    const done = () => { clearTimeout(t); waiters.delete(done); resolve(snapshot(since)); };
    t = setTimeout(done, ms);
    waiters.add(done);
  });
}
function track(mmsi) { return (tracks.get(String(mmsi)) || []).slice(); }
function srcStatus(s, now) {
  s.window = s.window.filter((x) => now - x[0] < 60000);
  const perMin = s.window.reduce((n, x) => n + x[1], 0), usedMin = s.window.reduce((n, x) => n + x[2], 0);
  return { name: s.name, on: !!opening(s) && role === 'lead', connected: s.connected, lastMsg: s.lastMsg, lastErr: s.lastErr, perMin, usedMin, info: s.info };
}
function status() {
  const now = Date.now();
  const sources = { aisstream: srcStatus(SRC.aisstream, now), openwaters: srcStatus(SRC.openwaters, now) };
  const lead = role === 'lead';
  const live = lead ? anyConnected() : !!via;
  const err = lead ? (anyConnected() ? null : (key && SRC.aisstream.lastErr) || SRC.openwaters.lastErr || lastErr) : lastErr;
  return { on: !!key || !!via || (lead && owOn), key: !!key, connected: live, role, via: via ? via.name : null, count: vessels.size, lastMsg, lastErr: err,
    perMin: sources.aisstream.perMin + sources.openwaters.perMin, sources };
}
// Per minute message rate per source, for the settings page and the status on the map.
const rateTimer = setInterval(() => { const now = Date.now(); for (const s of Object.values(SRC)) { if (s.count || s.used) s.window.push([now, s.count, s.used]); s.count = 0; s.used = 0; } }, 5000);
if (rateTimer.unref) rateTimer.unref();

/* ---------- photos ---------- */
async function commons(params) {
  const u = `${COMMONS}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params }).toString()}`;
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}
const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();
function pickImage(json, name) {
  const pages = (json && json.query && json.query.pages) || [];
  const want = String(name || '').toLowerCase();
  const list = pages.filter((p) => p.imageinfo && p.imageinfo[0] && /\.(jpe?g|png|webp)$/i.test(p.title || '')).map((p) => {
    const ii = p.imageinfo[0], md = ii.extmetadata || {};
    return { title: p.title, url: ii.thumburl || ii.url, page: ii.descriptionurl, author: strip(md.Artist && md.Artist.value).slice(0, 120), licence: strip(md.LicenseShortName && md.LicenseShortName.value).slice(0, 60), desc: strip(md.ImageDescription && md.ImageDescription.value).slice(0, 200), w: ii.thumbwidth || ii.width, h: ii.thumbheight || ii.height };
  });
  // A photo whose title carries the ship's name first; a landscape one over a portrait one.
  list.sort((x, y) => ((want && y.title.toLowerCase().includes(want)) - (want && x.title.toLowerCase().includes(want))) || ((y.w > y.h) - (x.w > x.h)));
  return list[0] || null;
}

// The key a photo is kept under: the IMO number, or else the name (at least 3 letters).
function photoKey({ imo, name } = {}) {
  const n = Number(imo);
  if (imo != null && Number.isFinite(n) && n > 0) return `imo:${Math.round(n)}`;
  const nm = String(name || '').trim().toLowerCase();
  return nm.length >= 3 ? `name:${nm.slice(0, 60)}` : null;
}
const PHOTO_KEY_RE = /^(imo:\d{1,10}|name:.{3,60})$/;
const photoPath = (file) => path.join(dir, PHOTO_DIR, path.basename(String(file || '')));
function removePhotoFile(file) { if (file) try { fs.unlinkSync(photoPath(file)); } catch { /* gone already */ } }
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const extOf = (mime) => Object.keys(MIME).find((e) => MIME[e] === mime) || null;
function writePhotoFile(k, ext, buf) {
  const file = `${crypto.createHash('sha1').update(k).digest('hex').slice(0, 20)}.${ext}`;
  fs.writeFileSync(photoPath(file), buf);
  return file;
}
// A stored answer: a photo whose file is still there, or a "none". Null when there is nothing (usable).
function storedPhoto(k) {
  const hit = photos[k];
  if (!hit) return null;
  if (hit.img && !fs.existsSync(photoPath(hit.img.file))) { delete photos[k]; photosDirty = true; return null; }
  return hit;
}
const photoFresh = (hit) => !!hit && Date.now() - (hit.at || 0) < (hit.img ? PHOTO_OK_MS : PHOTO_BAD_MS);
const wantsPhoto = (r) => r.cls !== 'aton' && r.cls !== 'base' && !!staticData[r.mmsi];

// The next ship to fetch a photo for. Never chosen by what anyone looks at: the ships with an IMO number
// in the order they were first heard, then the other seagoing ships (class A) by name, then the rest.
// A ship only counts once its static data has come in, so its IMO number is known before its name is used.
function nextForPhoto() {
  const now = Date.now();
  const passes = [(r) => !!r.imo, (r) => r.cls === 'A', () => true];
  for (const pass of passes) {
    for (const r of vessels.values()) {
      if (!wantsPhoto(r) || !pass(r)) continue;
      const k = photoKey(r);
      if (!k || (photoRetry.get(k) || 0) > now) continue;
      if (photoFresh(photos[k])) continue; // a missing file is noticed when it is shown, and fetched again
      return r;
    }
  }
  return null;
}
function photoQueue() {
  const seen = new Set();
  for (const r of vessels.values()) {
    if (!wantsPhoto(r)) continue;
    const k = photoKey(r);
    if (k && !photoFresh(photos[k])) seen.add(k);
  }
  return seen.size;
}

// Look one ship up on Commons and keep the answer, and the photo itself, on disk.
async function fetchPhoto(r) {
  const k = photoKey(r);
  if (!k) return;
  let img = null, how = null;
  if (r.imo) {
    img = pickImage(await commons({ generator: 'categorymembers', gcmtitle: `Category:IMO ${r.imo}`, gcmtype: 'file', gcmlimit: '20', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(PHOTO_W) }), r.name);
    how = 'IMO-categorie';
  }
  if (!img && r.name && String(r.name).length >= 3) {
    img = pickImage(await commons({ generator: 'search', gsrsearch: `"${r.name}" ship`, gsrnamespace: '6', gsrlimit: '10', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: String(PHOTO_W) }), r.name);
    how = 'zoeken op naam';
  }
  const old = photos[k];
  if (img) {
    const u = new URL(img.url);
    if (u.protocol !== 'https:' || !/(^|\.)wikimedia\.org$/.test(u.hostname)) throw new Error('onverwacht fotoadres');
    const res = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const ext = extOf(String(res.headers.get('content-type') || '').split(';')[0].trim());
    if (!ext) throw new Error('geen foto');
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 5e6) throw new Error('foto leeg of te groot');
    const file = writePhotoFile(k, ext, buf);
    if (old && old.img && old.img.file !== file) removePhotoFile(old.img.file);
    const { title, page, author, licence, desc, w, h } = img;
    photos[k] = { img: { title, page, author, licence, desc, w, h, file }, how, at: Date.now() };
  } else {
    if (old && old.img) removePhotoFile(old.img.file);
    photos[k] = { img: null, how, at: Date.now() };
  }
  photosDirty = true;
}

// The background round: one lookup every few seconds while this screen holds the stream.
async function photoTick() {
  photoTimer = null;
  if (stopping) return;
  let wait = PHOTO_GAP_MS;
  const r = role === 'lead' && anyConnected() && Date.now() >= photoPauseUntil ? nextForPhoto() : null;
  if (!r) wait = PHOTO_IDLE_MS;
  else {
    try { await fetchPhoto(r); photoErr = null; } catch (err) {
      photoErr = String((err && err.message) || err);
      if (err && (err.status === 429 || err.status === 403)) { photoPauseUntil = Date.now() + PHOTO_PAUSE_MS; log.warn('ais', `Wikimedia vraagt om rustiger aan te doen (${photoErr}); foto's een half uur gepauzeerd`); }
      else photoRetry.set(photoKey(r), Date.now() + PHOTO_RETRY_MS);
      if (photoRetry.size > 5000) photoRetry.clear();
    }
  }
  if (!stopping) { photoTimer = setTimeout(photoTick, wait); if (photoTimer.unref) photoTimer.unref(); }
}

// What a screen shows for a ship it taps: only from the store, never from outside. A screen that follows
// another one asks that screen (over the unit key) and keeps the answer.
function fromStore(k) {
  const hit = storedPhoto(k);
  if (!hit) return null;
  if (!hit.img) return { ok: true, img: null, how: hit.how, at: hit.at };
  try {
    const mime = MIME[path.extname(hit.img.file).slice(1)] || 'image/jpeg';
    return { ok: true, img: { ...hit.img, url: `data:${mime};base64,${fs.readFileSync(photoPath(hit.img.file)).toString('base64')}` }, how: hit.how, at: hit.at };
  } catch { return null; }
}
function photoForPeer(k) {
  k = String(k || '');
  const hit = PHOTO_KEY_RE.test(k) ? storedPhoto(k) : null;
  if (!hit) return { ok: true, known: false };
  if (!hit.img) return { ok: true, known: true, img: null, how: hit.how, at: hit.at };
  try {
    const mime = MIME[path.extname(hit.img.file).slice(1)] || 'image/jpeg';
    return { ok: true, known: true, img: hit.img, how: hit.how, at: hit.at, mime, data: fs.readFileSync(photoPath(hit.img.file)).toString('base64') };
  } catch { return { ok: true, known: false }; }
}
async function photo({ imo, name } = {}) {
  const k = photoKey({ imo, name });
  if (!k) return { ok: true, img: null, none: 'Geen naam of IMO-nummer' };
  const own = fromStore(k);
  if (own) return own;
  if (role === 'follow' && via && peerGet) {
    try {
      const got = await peerGet(via, `/api/ais/photo?k=${encodeURIComponent(k)}`, 10000);
      if (got && got.ok && got.known && !got.img) {
        photos[k] = { img: null, how: got.how || null, at: +got.at || Date.now() };
        photosDirty = true;
        return { ok: true, img: null, how: got.how || null };
      }
      if (got && got.ok && got.known && got.img && typeof got.data === 'string') {
        const buf = Buffer.from(got.data, 'base64');
        if (buf.length && buf.length <= 5e6) {
          const { title, page, author, licence, desc, w, h } = got.img;
          photos[k] = { img: { title, page, author, licence, desc, w, h, file: writePhotoFile(k, extOf(got.mime) || 'jpg', buf) }, how: got.how || null, at: +got.at || Date.now() };
          photosDirty = true;
          const out = fromStore(k);
          if (out) return out;
        }
      }
    } catch { /* that screen is busy or gone: "not yet" */ }
  }
  return { ok: true, img: null, pending: true };
}
function photoStatus() {
  let found = 0, none = 0;
  for (const v of Object.values(photos)) { if (v.img) found += 1; else none += 1; }
  const fetching = role === 'lead' && anyConnected();
  return { found, none, queue: fetching ? photoQueue() : null, fetching, paused: Date.now() < photoPauseUntil ? photoPauseUntil : null, lastErr: photoErr };
}

/* ---------- start ---------- */
function setKey(k) {
  const next = String(k || '').trim() || null;
  if (next === key) return status();
  key = next;
  SRC.aisstream.retries = 0; SRC.aisstream.lastErr = null;
  disconnect(key ? 'nieuwe sleutel' : 'sleutel verwijderd', 'aisstream');
  evaluate();
  return status();
}
const routes = {
  // A photo out of this screen's store, for a screen of the unit that follows this one.
  '/api/ais/photo': (req, res, caller, respond) => {
    if (!caller || !caller.secure) return respond(res, 403, 'text/plain', 'Niet toegestaan');
    respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(photoForPeer(new URL(req.url, 'http://x').searchParams.get('k'))));
  },
  '/api/ais/snap': (req, res, caller, respond) => {
    const u = new URL(req.url, 'http://x');
    if (!caller || !caller.secure) return respond(res, 403, 'text/plain', 'Niet toegestaan');
    if (role !== 'lead') return respond(res, 409, 'text/plain; charset=utf-8', 'Dit scherm haalt de schepen zelf niet op');
    // With ?wait=ms the answer comes when something changed (long-poll), at the latest after that time.
    let open = true;
    req.on('close', () => { open = false; });
    snapWait(Math.max(0, +u.searchParams.get('since') || 0), +u.searchParams.get('wait') || 0).then((snap) => {
      if (open && !res.writableEnded && !res.destroyed) respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(snap));
    });
  },
};

function start(opts) {
  ({ dir, screens, share, store, peerGet } = opts);
  if (opts.log) log = opts.log;
  owOn = opts.openWaters !== false;
  loadFiles();
  const restored = loadLive();
  if (restored) log.info('ais', `${restored} schepen uit het register van vóór de herstart`);
  const readKey = () => { const k = store.get('private').keys.aisstream; setKey(k && k.value); };
  readKey();
  store.onChange((kind) => { if (kind === 'private') readKey(); });
  const t1 = setInterval(() => { evaluate(); prune(); }, 5000);
  followLoop();
  const t3 = setInterval(() => { saveStatic(); savePhotos(); saveLive(); }, 2 * 60000);
  for (const t of [t1, t3]) if (t.unref) t.unref();
  evaluate();
  // A stream that goes quiet without closing: a fresh one after two minutes without a message.
  const t4 = setInterval(() => {
    for (const s of Object.values(SRC)) if (role === 'lead' && s.ws && s.connected && Date.now() - s.lastMsg > 120000) { disconnect('stil', s.id); scheduleReconnect(s); }
  }, 30000);
  if (t4.unref) t4.unref();
  // The photo round starts a while after the stream, when the first static messages are in.
  photoTimer = setTimeout(photoTick, opts.photoDelayMs ?? 90000);
  if (photoTimer.unref) photoTimer.unref();
  return { routes };
}
function stop() { stopping = true; disconnect('stop'); clearTimeout(photoTimer); for (const f of [...waiters]) f(); saveStatic(); savePhotos(); liveDirty = true; saveLive(); }

module.exports = { start, stop, status, snapshot, snapWait, track, photo, photoStatus, setKey, routes, vessels: () => vessels, _ingest: ingest, _ow: owMessage, _msgTime: msgTime, _live: { save: () => { liveDirty = true; saveLive(); }, load: () => loadLive(), clear: () => { vessels.clear(); tracks.clear(); } }, _photo: { photoKey, nextForPhoto, fetchPhoto, photoForPeer, photos: () => photos, setDir: (d) => { dir = d; loadFiles(); }, setRole: (r, v, g) => { role = r; via = v || null; if (g) peerGet = g; } } };
