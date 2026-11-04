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
// small craft) the name is searched. Found and not-found answers are kept for a while.
const fs = require('fs');
const path = require('path');

const STREAM = 'wss://stream.aisstream.io/v0/stream';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
// The North Sea around the Netherlands, generous: Dover to the German Bight and up to the Danish sector.
const DEFAULT_BBOX = [[50.0, -2.0], [57.5, 9.5]];
const KEEP_MS = 60 * 60000;        // a vessel silent this long is dropped
const TRACK_MS = 6 * 3600e3;       // the track kept per vessel
const TRACK_MAX = 900;             // points per vessel
const TRACK_MIN_M = 25;            // a new point only after this much movement, or a minute
const TRACK_MIN_S = 60;
const STATIC_FILE = 'ais-static.json', PHOTO_FILE = 'ais-photos.json';
const STATIC_MAX = 30000;
const PHOTO_OK_MS = 30 * 86400e3, PHOTO_BAD_MS = 2 * 86400e3;
const FOLLOW_MS = 2000;
const WATCH_MS = 20000;            // a renderer that asked this recently keeps the follower polling
const RECONNECT_MS = [3000, 6000, 12000, 30000, 60000];
const UA = 'P-ALV-Dashboard (desktop dashboard for a police aviation unit; contact via github.com/Koen-io/palv-dashboard)';

let dir = null, log = { info() {}, warn() {} }, screens = null, share = null, store = null, peerGet = null;
let key = null, ws = null, connected = false, lastMsg = 0, lastErr = null, retries = 0, reconnectTimer = null, stopping = false;
let role = 'lead', via = null, followTimer = null, followBusy = false, lastWatch = 0, followSince = 0;
let msgCount = 0, msgWindow = [], staticDirty = false;
const vessels = new Map();   // mmsi -> record
const tracks = new Map();    // mmsi -> [[t, lat, lon, sog, cog]]
const gone = [];             // [mmsi, rev] of dropped vessels, for the followers
let rev = 0;
let staticData = {};         // mmsi -> { name, imo, callsign, type, a, b, c, d, draught, at }
let photos = {};

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
  try { fs.writeFileSync(path.join(dir, PHOTO_FILE), JSON.stringify(photos), 'utf8'); } catch { /* not essential */ }
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
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
const strip = (s) => String(s || '').replace(/<[^>]*>/g, '').trim();
function pickImage(json, name) {
  const pages = (json && json.query && json.query.pages) || [];
  const want = String(name || '').toLowerCase();
  const list = pages.filter((p) => p.imageinfo && p.imageinfo[0] && /\.(jpe?g|png|webp)$/i.test(p.title || '')).map((p) => {
    const ii = p.imageinfo[0], md = ii.extmetadata || {};
    return { title: p.title, url: ii.thumburl || ii.url, full: ii.url, page: ii.descriptionurl, author: strip(md.Artist && md.Artist.value), licence: strip(md.LicenseShortName && md.LicenseShortName.value), desc: strip(md.ImageDescription && md.ImageDescription.value).slice(0, 200), w: ii.thumbwidth || ii.width, h: ii.thumbheight || ii.height };
  });
  // A photo whose title carries the ship's name first; a landscape one over a portrait one.
  list.sort((x, y) => ((want && y.title.toLowerCase().includes(want)) - (want && x.title.toLowerCase().includes(want))) || ((y.w > y.h) - (x.w > x.h)));
  return list[0] || null;
}
async function photo({ imo, name, mmsi }) {
  const k = imo ? `imo:${imo}` : name ? `name:${String(name).toLowerCase()}` : mmsi ? `mmsi:${mmsi}` : null;
  if (!k) return { ok: false, error: 'Geen naam of IMO-nummer' };
  const hit = photos[k];
  if (hit && Date.now() - hit.at < (hit.img ? PHOTO_OK_MS : PHOTO_BAD_MS)) return { ok: true, ...hit, cached: true };
  let img = null, how = null;
  try {
    if (imo) {
      const j = await commons({ generator: 'categorymembers', gcmtitle: `Category:IMO ${imo}`, gcmtype: 'file', gcmlimit: '20', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '900' });
      img = pickImage(j, name);
      how = 'IMO-categorie';
    }
    if (!img && name && String(name).length >= 3) {
      const j = await commons({ generator: 'search', gsrsearch: `"${name}" ship`, gsrnamespace: '6', gsrlimit: '10', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '900' });
      img = pickImage(j, name);
      how = 'zoeken op naam';
    }
  } catch (err) { return { ok: false, error: err.message, ...(hit || {}) }; }
  photos[k] = { img, how, at: Date.now() };
  savePhotos();
  return { ok: true, ...photos[k] };
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
  const t3 = setInterval(saveStatic, 5 * 60000);
  for (const t of [t1, t2, t3]) if (t.unref) t.unref();
  // A stream that goes quiet without closing: a fresh one after two minutes without a message.
  const t4 = setInterval(() => { if (role === 'lead' && ws && connected && Date.now() - lastMsg > 120000) { disconnect('stil'); scheduleReconnect(); } }, 30000);
  if (t4.unref) t4.unref();
  return { routes };
}
function stop() { stopping = true; disconnect('stop'); clearInterval(followTimer); saveStatic(); }

module.exports = { start, stop, status, snapshot, track, photo, setKey, routes, vessels: () => vessels, _ingest: ingest };
