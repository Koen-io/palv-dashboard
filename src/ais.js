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

const STREAM = 'wss://stream.aisstream.io/v0/stream';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
// The North Sea around the Netherlands, generous: Dover to the German Bight and up to the Danish sector.
const DEFAULT_BBOX = [[50.0, -2.0], [57.5, 9.5]];
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
const FOLLOW_MS = 2000;
const WATCH_MS = 20000;            // a renderer that asked this recently keeps the follower polling
const RECONNECT_MS = [3000, 6000, 12000, 30000, 60000];
const UA = require('./ua').APP;

let dir = null, log = { info() {}, warn() {} }, screens = null, share = null, store = null, peerGet = null;
let key = null, ws = null, connected = false, lastMsg = 0, lastErr = null, retries = 0, reconnectTimer = null, stopping = false;
let role = 'lead', via = null, followTimer = null, followBusy = false, lastWatch = 0, followSince = 0;
let msgCount = 0, msgWindow = [], staticDirty = false;
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

/* ---------- the register ---------- */
function rec(mmsi) {
  let r = vessels.get(mmsi);
  if (!r) {
    const st = staticData[mmsi] || {};
    r = { mmsi, name: st.name || null, imo: st.imo || null, callsign: st.callsign || null, type: st.type ?? null, a: st.a ?? null, b: st.b ?? null, c: st.c ?? null, d: st.d ?? null, draught: st.draught ?? null, dest: st.dest || null, eta: st.eta || null,
      lat: null, lon: null, sog: null, cog: null, hdg: null, rot: null, nav: null, posAt: 0, msgAt: 0, cls: null, rev: 0, src: 'aisstream' };
    vessels.set(mmsi, r);
  }
  return r;
}
function touch(r) { r.rev = ++rev; r.msgAt = Date.now(); }

function addTrack(r, t) {
  let tr = tracks.get(r.mmsi);
  if (!tr) { tr = []; tracks.set(r.mmsi, tr); }
  const last = tr[tr.length - 1];
  if (last && t - last[0] < TRACK_MIN_S * 1000 && distM(last[1], last[2], r.lat, r.lon) < TRACK_MIN_M) return;
  tr.push([t, r.lat, r.lon, r.sog, r.cog]);
  if (tr.length > TRACK_MAX) tr.splice(0, tr.length - TRACK_MAX);
}

// One message from aisstream.io: { MessageType, MetaData: { MMSI, ShipName, latitude, longitude, time_utc }, Message: { <type>: {...} } }
function ingest(m) {
  const meta = m.MetaData || {};
  const mmsi = String(meta.MMSI || '').replace(/\D/g, '');
  if (!mmsi) return;
  const body = (m.Message && m.Message[m.MessageType]) || {};
  const r = rec(mmsi);
  const t = Date.now();
  const nameMeta = str(meta.ShipName);
  if (nameMeta && !r.name) r.name = nameMeta;
  switch (m.MessageType) {
    case 'PositionReport':
    case 'StandardClassBPositionReport':
    case 'ExtendedClassBPositionReport':
    case 'LongRangeAisBroadcastMessage': {
      const lat = num(body.Latitude ?? meta.latitude), lon = num(body.Longitude ?? meta.longitude);
      if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return;
      r.lat = lat; r.lon = lon;
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
      if (lat == null || lon == null) return;
      r.cls = 'aton'; r.lat = lat; r.lon = lon; r.posAt = t;
      r.name = str(body.Name) || r.name; r.type = num(body.Type) ?? r.type;
      touch(r);
      break;
    }
    case 'BaseStationReport': {
      const lat = num(body.Latitude ?? meta.latitude), lon = num(body.Longitude ?? meta.longitude);
      if (lat == null || lon == null) return;
      r.cls = 'base'; r.lat = lat; r.lon = lon; r.posAt = t;
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

/* ---------- the stream ---------- */
function connect() {
  if (ws || !key || stopping || typeof WebSocket === 'undefined') return;
  let sock;
  try { sock = new WebSocket(STREAM); } catch (err) { lastErr = err.message; scheduleReconnect(); return; }
  ws = sock;
  const opened = Date.now();
  sock.addEventListener('open', () => {
    try { sock.send(JSON.stringify({ APIKey: key, BoundingBoxes: [DEFAULT_BBOX], FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'ShipStaticData', 'StaticDataReport', 'AidsToNavigationReport', 'LongRangeAisBroadcastMessage'] })); } catch (err) { lastErr = err.message; }
  });
  // aisstream.io sends its JSON as binary frames: taken as bytes and decoded, not as text.
  try { sock.binaryType = 'arraybuffer'; } catch { /* not every implementation */ }
  const onText = (text) => {
    if (!connected) { connected = true; retries = 0; lastErr = null; log.info('ais', 'verbonden met aisstream.io'); }
    lastMsg = Date.now();
    msgCount += 1;
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (m && m.error) { lastErr = String(m.error); log.warn('ais', 'aisstream.io: ' + lastErr); return; }
    try { ingest(m); } catch (err) { /* one bad message */ }
  };
  sock.addEventListener('message', (ev) => {
    const d = ev.data;
    if (typeof d === 'string') onText(d);
    else if (d instanceof ArrayBuffer) onText(Buffer.from(d).toString('utf8'));
    else if (ArrayBuffer.isView(d)) onText(Buffer.from(d.buffer, d.byteOffset, d.byteLength).toString('utf8'));
    else if (d && typeof d.text === 'function') d.text().then(onText).catch(() => {});
  });
  const down = (why) => {
    if (ws !== sock) return;
    ws = null;
    const was = connected;
    connected = false;
    if (was || Date.now() - opened > 10000) log.warn('ais', `verbinding met aisstream.io weg (${why}); opnieuw proberen`);
    else lastErr = lastErr || why;
    scheduleReconnect();
  };
  sock.addEventListener('close', (ev) => down(`gesloten ${ev.code || ''}${ev.reason ? ' ' + ev.reason : ''}`.trim()));
  sock.addEventListener('error', () => down('fout'));
}
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (stopping || !key || role !== 'lead') return;
  const wait = RECONNECT_MS[Math.min(retries, RECONNECT_MS.length - 1)];
  retries += 1;
  reconnectTimer = setTimeout(connect, wait);
}
function disconnect(why) {
  clearTimeout(reconnectTimer);
  const s = ws;
  ws = null;
  if (s) { try { s.close(); } catch { /* closed */ } if (connected) log.info('ais', `stream gesloten: ${why}`); }
  connected = false;
}

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
  } else if (role !== 'lead') { role = 'lead'; via = null; followSince = 0; if (key) connect(); }
  else if (key && !ws && !reconnectTimer && !stopping) connect();
  if (!key && role === 'lead') disconnect('geen sleutel');
}
async function followOnce() {
  if (role !== 'follow' || !via || followBusy || Date.now() - lastWatch > WATCH_MS) return;
  followBusy = true;
  try {
    const got = await peerGet(via, `/api/ais/snap?since=${followSince}`, 6000);
    if (!got || !Array.isArray(got.vessels)) throw new Error('geen antwoord');
    const now = Date.now();
    for (const v of got.vessels) {
      const mmsi = String(v.mmsi || '');
      if (!mmsi) continue;
      const r = rec(mmsi);
      const moved = v.lat != null && (v.lat !== r.lat || v.lon !== r.lon);
      Object.assign(r, v, { rev: 0, src: `via ${via.name}` });
      r.msgAt = now;
      if (moved && r.lat != null) addTrack(r, v.posAt || now);
      touch(r);
    }
    for (const mmsi of got.gone || []) if (vessels.delete(String(mmsi))) { tracks.delete(String(mmsi)); gone.push([String(mmsi), ++rev]); }
    followSince = got.rev || followSince;
    lastMsg = got.lastMsg || now;
    lastErr = null;
  } catch (err) { lastErr = `${via.name}: ${err.message}`; followSince = 0; }
  finally { followBusy = false; }
}

/* ---------- what the dashboard and the other screens get ---------- */
const pub = (r) => ({ mmsi: r.mmsi, name: r.name, imo: r.imo, callsign: r.callsign, type: r.type, a: r.a, b: r.b, c: r.c, d: r.d, draught: r.draught, dest: r.dest, eta: r.eta, lat: r.lat, lon: r.lon, sog: r.sog, cog: r.cog, hdg: r.hdg, rot: r.rot, nav: r.nav, posAt: r.posAt, msgAt: r.msgAt, cls: r.cls, src: r.src });
function snapshot(since = 0) {
  lastWatch = Date.now();
  const out = [];
  for (const r of vessels.values()) if (r.rev > since && r.lat != null) out.push(pub(r));
  return { ok: true, now: Date.now(), rev, since, vessels: out, gone: gone.filter((g) => g[1] > since).map((g) => g[0]), total: vessels.size, lastMsg, status: status() };
}
function track(mmsi) { return (tracks.get(String(mmsi)) || []).slice(); }
function status() {
  const now = Date.now();
  msgWindow = msgWindow.filter((t) => now - t < 60000);
  return { on: !!key || !!via, key: !!key, connected: role === 'lead' ? connected : !!via, role, via: via ? via.name : null, count: vessels.size, lastMsg, lastErr, perMin: msgWindow.length };
}
// Per minute message rate, for the settings page.
setInterval(() => { if (msgCount) { for (let i = 0; i < Math.min(msgCount, 5000); i += 1) msgWindow.push(Date.now()); msgCount = 0; } }, 5000).unref();

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
  const r = role === 'lead' && key && connected && Date.now() >= photoPauseUntil ? nextForPhoto() : null;
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
  const fetching = role === 'lead' && !!key;
  return { found, none, queue: fetching ? photoQueue() : null, fetching, paused: Date.now() < photoPauseUntil ? photoPauseUntil : null, lastErr: photoErr };
}

/* ---------- start ---------- */
function setKey(k) {
  const next = String(k || '').trim() || null;
  if (next === key) return status();
  key = next;
  retries = 0;
  disconnect(key ? 'nieuwe sleutel' : 'sleutel verwijderd');
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
    respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(snapshot(Math.max(0, +u.searchParams.get('since') || 0))));
  },
};

function start(opts) {
  ({ dir, screens, share, store, peerGet } = opts);
  if (opts.log) log = opts.log;
  loadFiles();
  const readKey = () => { const k = store.get('private').keys.aisstream; setKey(k && k.value); };
  readKey();
  store.onChange((kind) => { if (kind === 'private') readKey(); });
  const t1 = setInterval(() => { evaluate(); prune(); }, 5000);
  const t2 = setInterval(followOnce, FOLLOW_MS);
  const t3 = setInterval(() => { saveStatic(); savePhotos(); }, 2 * 60000);
  for (const t of [t1, t2, t3]) if (t.unref) t.unref();
  // A stream that goes quiet without closing: a fresh one after two minutes without a message.
  const t4 = setInterval(() => { if (role === 'lead' && ws && connected && Date.now() - lastMsg > 120000) { disconnect('stil'); scheduleReconnect(); } }, 30000);
  if (t4.unref) t4.unref();
  // The photo round starts a while after the stream, when the first static messages are in.
  photoTimer = setTimeout(photoTick, opts.photoDelayMs ?? 90000);
  if (photoTimer.unref) photoTimer.unref();
  return { routes };
}
function stop() { stopping = true; disconnect('stop'); clearInterval(followTimer); clearTimeout(photoTimer); saveStatic(); savePhotos(); }

module.exports = { start, stop, status, snapshot, track, photo, photoStatus, setKey, routes, vessels: () => vessels, _ingest: ingest, _photo: { photoKey, nextForPhoto, fetchPhoto, photoForPeer, photos: () => photos, setDir: (d) => { dir = d; loadFiles(); }, setRole: (r, v, g) => { role = r; via = v || null; if (g) peerGet = g; } } };
