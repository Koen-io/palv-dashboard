// Zoek & Plan: the search box of the planning map. Autocomplete over three sources, merged into one list:
// - PDOK Locatieserver (the Netherlands: addresses, streets, postcodes, places, municipalities, provinces,
//   and hectometre posts, which only the /free endpoint knows: "A2 hmp 45,3" finds post A2-453);
// - Photon by komoot (worldwide, OpenStreetMap). A free service that throttles heavy use, so it is only
//   asked from 3 characters on, when world search is on or PDOK finds little, one request at a time with
//   a minimum gap, and every answer is kept for a day;
// - OurAirports (public domain), downloaded monthly into dir/ourairports/ and searched locally.
// Coordinates typed into the box (DMS, RD, MGRS) are parsed in the renderer, not here.
//
// Injected (start): fetchJson(url, { headers, timeoutMs }) -> parsed JSON, and fetchText(url, { headers,
// timeoutMs }) -> the body as a string, or { status, text, etag, lastModified } so a monthly check can be
// answered with 304. Both throw on a failed request (an "HTTP 429" in the message pauses Photon).
const fs = require('fs');
const path = require('path');

const UA = 'P-ALV-Dashboard/1.17 (desktop dashboard)';
const PDOK = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';
const PHOTON = 'https://photon.komoot.io';
const OA = 'https://davidmegginson.github.io/ourairports-data/';
const OA_FILES = ['airports.csv', 'runways.csv', 'airport-frequencies.csv', 'countries.csv'];
const PDOK_TYPES = ['provincie', 'gemeente', 'woonplaats', 'weg', 'postcode', 'adres'];
const PDOK_FL = 'id,type,weergavenaam,centroide_ll,score';
const DAY = 86400000;
const AIRPORTS_EVERY = 30 * DAY;
const PHOTON_GAP_MS = 700;      // at most about one request per 0.7 s, whatever the typing speed
const PHOTON_TTL = DAY;
const REVERSE_TTL = 30 * DAY;
const RESOLVE_TTL = 30 * DAY;
const PDOK_TTL = 10 * 60000;    // in memory only: retyping the same letters should not ask again
const PDOK_FEW = 3;             // fewer PDOK results than this: Photon is asked even with world search off
const PDOK_REVERSE_MAX_M = 250; // PDOK always answers with the nearest Dutch address, even from Brussels
// The Netherlands, coarsely and with a margin (lon, lat): where PDOK is asked for the nearest address.
const NL_AREA = [[3.2, 51.2], [3.9, 51.2], [4.6, 51.4], [5.0, 51.4], [5.6, 51.15], [5.6, 50.7], [6.1, 50.7], [6.2, 51.0], [6.1, 51.25], [6.3, 51.6], [6.0, 51.8], [6.8, 51.85], [7.1, 52.2], [7.1, 52.6], [7.3, 53.3], [6.9, 53.65], [5.0, 53.6], [4.5, 53.3], [4.3, 52.5], [3.7, 51.85], [3.2, 51.45]];
const TIMEOUT = 8000;

let dir = null, fetchJson = null, fetchText = null;
let log = { info() {}, warn() {} };
let timer = null;

// ---------- small helpers ----------

const num = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const rad = (d) => (d * Math.PI) / 180;
function distM(aLat, aLon, bLat, bLon) {
  const x = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(x)));
}
function inNL(lat, lon) {
  let inside = false;
  for (let i = 0, j = NL_AREA.length - 1; i < NL_AREA.length; j = i++) {
    const [xi, yi] = NL_AREA[i], [xj, yj] = NL_AREA[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function parsePoint(wkt) {
  const m = /POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i.exec(wkt || '');
  return m ? { x: +m[1], y: +m[2] } : null;
}
// The bounding box [s, w, n, e] of any WKT geometry in degrees; null for a point.
function wktBbox(wkt) {
  if (!wkt || /^\s*POINT/i.test(wkt)) return null;
  let s = 90, w = 180, n = -90, e = -180, any = false;
  for (const m of String(wkt).matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
    const lon = +m[1], lat = +m[2];
    any = true;
    if (lat < s) s = lat; if (lat > n) n = lat; if (lon < w) w = lon; if (lon > e) e = lon;
  }
  return any ? [s, w, n, e] : null;
}
function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const errText = (err) => String((err && err.name === 'AbortError' ? 'geen antwoord' : err && err.message) || err);

// Default fetchers (plain node), used when none are injected.
async function defaultFetch(url, { headers = {}, timeoutMs = TIMEOUT } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctl.signal });
    if (res.status === 304) return { status: 304, text: '' };
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { status: res.status, text: await res.text(), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
  } finally { clearTimeout(t); }
}
const defaultJson = async (url, opts) => JSON.parse((await defaultFetch(url, opts)).text);

// ---------- caches (memory, persisted to dir/geocode-cache.json) ----------

const caches = { photon: new Map(), reverse: new Map(), resolve: new Map() };
const CACHE_MAX = { photon: 800, reverse: 500, resolve: 500 };
const TTL = { photon: PHOTON_TTL, reverse: REVERSE_TTL, resolve: RESOLVE_TTL };
const pdokCache = new Map();
let saveTimer = null;
const cacheFile = () => (dir ? path.join(dir, 'geocode-cache.json') : null);

function cacheGet(name, key, now = Date.now()) {
  const hit = caches[name].get(key);
  if (!hit) return undefined;
  if (now - hit.t > TTL[name]) { caches[name].delete(key); return undefined; }
  return hit.v;
}
function cacheSet(name, key, v, now = Date.now()) {
  const m = caches[name];
  m.delete(key);
  m.set(key, { t: now, v });
  while (m.size > CACHE_MAX[name]) m.delete(m.keys().next().value);
  scheduleSave();
}
function scheduleSave() {
  if (!cacheFile() || saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveCaches(); }, 5000);
  if (saveTimer.unref) saveTimer.unref();
}
function saveCaches() {
  const file = cacheFile();
  if (!file) return;
  const out = {};
  for (const name of Object.keys(caches)) out[name] = [...caches[name]];
  try { writeAtomic(file, JSON.stringify(out)); } catch (err) { log.warn('geocode', 'zoekgeheugen niet opgeslagen: ' + err.message); }
}
function loadCaches() {
  const d = readJson(cacheFile());
  if (!d) return;
  const now = Date.now();
  for (const name of Object.keys(caches)) {
    caches[name].clear();
    for (const [k, e] of Array.isArray(d[name]) ? d[name] : []) if (e && now - e.t <= TTL[name]) caches[name].set(k, e);
  }
}

// The items of recent suggestions, so resolve() of a Photon or airport id needs no new request.
const recent = new Map();
function remember(item) {
  recent.delete(item.id);
  recent.set(item.id, item);
  if (recent.size > 500) recent.delete(recent.keys().next().value);
}

// ---------- kinds ----------

const KIND_LABEL = {
  adres: 'Adres', weg: 'Weg', postcode: 'Postcode', woonplaats: 'Woonplaats', gemeente: 'Gemeente', provincie: 'Provincie',
  hectometerpaal: 'Hectometerpaal', luchthaven: 'Luchthaven', heliport: 'Heliport', vliegveld: 'Vliegveld', plaats: 'Plaats',
  land: 'Land', regio: 'Regio', water: 'Water', natuur: 'Natuur', poi: 'Locatie',
};
const ICON = {
  adres: 'home', weg: 'road', postcode: 'mail', woonplaats: 'city', gemeente: 'boundary', provincie: 'boundary',
  hectometerpaal: 'milestone', luchthaven: 'plane', heliport: 'helipad', vliegveld: 'plane-small', plaats: 'city',
  land: 'flag', regio: 'boundary', water: 'water', natuur: 'tree', poi: 'pin',
};
const sub = (...parts) => parts.filter((p) => p != null && String(p).trim()).join(' · ');

// ---------- PDOK ----------

// One PDOK document as a suggestion.
function pdokItem(doc) {
  const kind = doc.type;
  const w = String(doc.weergavenaam || '');
  const p = parsePoint(doc.centroide_ll);
  let label = w, place = '';
  if (kind === 'gemeente') label = w.replace(/^Gemeente\s+/, '');
  else if (kind === 'provincie') label = w.replace(/^Provincie\s+/, '');
  else if (kind === 'woonplaats') {
    // "Utrecht, Utrecht, Utrecht": place, municipality, province; the municipality only when it differs.
    const [name, gem, prov] = w.split(', ');
    label = name;
    place = [gem && gem !== name ? gem : null, prov].filter(Boolean).join(', ');
  } else if (kind === 'hectometerpaal') {
    const road = doc.wegnummer || (/([A-Z]*\d+)-/.exec(w) || [])[1] || '';
    const hm = parseInt(doc.hectometernummer, 10);
    const letter = doc.hectometerletter || (/\d([a-z])$/i.exec(doc.identificatie || w) || [])[1] || '';
    label = Number.isFinite(hm) ? `${road} hmp ${Math.floor(hm / 10)},${hm % 10}${letter}` : w.replace(/^Hectometerpaal\s+/, '');
    place = road;
  } else if (kind === 'postcode') {
    // "Domplein, 3512JD Utrecht": the postcode first, the street and town as second line.
    const m = /^(.*?),\s*(\d{4}\s?[A-Z]{2})\s+(.*)$/.exec(w);
    if (m) { label = m[2]; place = `${m[1]}, ${m[3]}`; }
  } else {
    const i = w.indexOf(', ');
    if (i > 0) { label = w.slice(0, i); place = w.slice(i + 2); }
  }
  return {
    id: 'pdok:' + doc.id, label, sub: sub(KIND_LABEL[kind] || kind, place), kind, icon: ICON[kind] || 'pin',
    lat: p ? p.y : null, lon: p ? p.x : null, bbox: null, src: 'PDOK',
  };
}
const parsePdok = (data) => ((data && data.response && data.response.docs) || []).filter((d) => d && d.id).map(pdokItem);

async function pdokSuggest(q, bias, rows) {
  let url = `${PDOK}/suggest?q=${encodeURIComponent(q)}&rows=${rows}&fl=${PDOK_FL}&fq=${encodeURIComponent(`type:(${PDOK_TYPES.join(' OR ')})`)}`;
  if (bias) url += `&lat=${bias.lat.toFixed(5)}&lon=${bias.lon.toFixed(5)}`;
  const hit = pdokCache.get(url);
  if (hit && Date.now() - hit.t < PDOK_TTL) return hit.v;
  const v = parsePdok(await fetchJson(url, { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT }));
  pdokCache.set(url, { t: Date.now(), v });
  if (pdokCache.size > 300) pdokCache.delete(pdokCache.keys().next().value);
  return v;
}

// "A2 hmp 45,3", "A2 45.3", "a2 km 45,3", "N201 hm 20,7", "A2-453": a road and a hectometre post.
// With a decimal it is one post; with whole kilometres only ("A2 hmp 45") the ten posts of that km;
// "A2-453" is the post number as written on the sign. Returns null for anything else.
function parseHmp(q) {
  const s = String(q || '').trim();
  let m = /^([ans])\s*(\d{1,3})\s*-\s*(\d{1,4})\s*([a-z])?$/i.exec(s);
  if (m) return { road: m[1].toUpperCase() + m[2], hm: m[3].replace(/^0+(?=\d)/, ''), letter: (m[4] || '').toLowerCase(), exact: true };
  m = /^([ans])\s*(\d{1,3})\s*(?:-|\s)\s*(?:(?:hmp|hm|hectometer(?:paal)?|km|paal|bij)\.?\s*)?(\d{1,3})(?:\s*[.,]\s*(\d))?\s*([a-z])?$/i.exec(s);
  if (!m) return null;
  const road = m[1].toUpperCase() + m[2];
  const km = String(parseInt(m[3], 10));
  if (m[4] != null) return { road, hm: (km === '0' ? '' : km) + m[4], letter: (m[5] || '').toLowerCase(), exact: true };
  return { road, hm: km === '0' ? '' : km, letter: '', exact: false };
}

async function pdokHmp(h, rows) {
  const id = `${h.road}-${h.hm}`;
  const url = `${PDOK}/free?q=${encodeURIComponent(`identificatie:${id}*`)}&fq=type:hectometerpaal&rows=${Math.max(rows, 12)}&fl=id,type,weergavenaam,identificatie,wegnummer,hectometernummer,hectometerletter,centroide_ll`;
  const docs = ((await fetchJson(url, { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT })).response || {}).docs || [];
  // The wildcard also catches longer numbers (A2-4530); keep the post itself (and its letter variants),
  // or the ten posts of the kilometre.
  const want = h.exact ? new RegExp(`^${id}${h.letter ? h.letter : '[a-z]?'}$`, 'i') : new RegExp(`^${id}\\d[a-z]?$`, 'i');
  return docs.filter((d) => want.test(d.identificatie || ''))
    .sort((a, b) => parseInt(a.hectometernummer, 10) - parseInt(b.hectometernummer, 10) || String(a.identificatie).localeCompare(b.identificatie))
    .map(pdokItem);
}

// ---------- Photon ----------

function photonKind(p) {
  const k = p.osm_key, v = p.osm_value;
  if (k === 'aeroway' && v === 'helipad') return 'heliport';
  if (k === 'aeroway' && (v === 'aerodrome' || v === 'airport')) return 'luchthaven';
  if (k === 'place') {
    if (v === 'country') return 'land';
    if (v === 'state' || v === 'region' || v === 'province' || v === 'county') return 'regio';
    if (v === 'house') return 'adres';
    return 'plaats';
  }
  if (k === 'boundary') return 'regio';
  if (k === 'water' || k === 'waterway' || (k === 'natural' && /^(water|bay|strait|spring|wetland)$/.test(v))) return 'water';
  if (k === 'natural' || (k === 'leisure' && /park|nature_reserve/.test(v))) return 'natuur';
  if (k === 'highway' && p.type === 'street') return 'weg';
  if (p.type === 'street') return 'weg';
  if (p.type === 'house' && p.housenumber) return 'adres';
  return 'poi';
}
function photonItem(f) {
  const p = (f && f.properties) || {};
  const c = (f && f.geometry && f.geometry.coordinates) || [];
  const kind = photonKind(p);
  const street = p.street ? (p.housenumber ? `${p.street} ${p.housenumber}` : p.street) : null;
  const label = p.name || street || p.city || p.state || p.country || '?';
  const town = p.city || p.town || p.village || p.locality || p.district || p.county;
  const place = [street && street !== label ? street : null, town && town !== label ? town : null, !town && p.state !== label ? p.state : null]
    .filter(Boolean).join(', ');
  const country = kind === 'land' ? null : p.country;
  // Photon's extent is [minLon, maxLat, maxLon, minLat].
  const x = Array.isArray(p.extent) && p.extent.length === 4 ? p.extent.map(Number) : null;
  return {
    id: `photon:${p.osm_type || ''}${p.osm_id != null ? p.osm_id : ''}`, label, sub: sub(KIND_LABEL[kind], place, country), kind, icon: ICON[kind],
    lat: num(c[1]), lon: num(c[0]), bbox: x && x.every(Number.isFinite) ? [x[3], x[0], x[1], x[2]] : null, src: 'Photon',
  };
}
const parsePhoton = (data) => ((data && data.features) || []).filter((f) => f && f.geometry).map(photonItem);

let photonSeq = 0, photonLast = 0, photonPause = 0, photonError = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const photonAllowed = (q) => q.length >= 3 && Date.now() >= photonPause;

// One Photon request at a time, at most one per PHOTON_GAP_MS; a request overtaken by a newer one
// while it waits is dropped (the user has typed on). Returns null when dropped.
async function photonGet(url) {
  const mine = ++photonSeq;
  const wait = photonLast + PHOTON_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  if (mine !== photonSeq) return null;
  photonLast = Date.now();
  try {
    const data = await fetchJson(url, { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT });
    photonError = null;
    return data;
  } catch (err) {
    const msg = errText(err);
    // Too many requests: rest for ten minutes; PDOK and the airports keep working.
    if (/\b429\b/.test(msg)) photonPause = Date.now() + 10 * 60000;
    if (msg !== photonError) log.warn('geocode', 'Photon: ' + msg);
    photonError = msg;
    throw err;
  }
}

async function photonSearch(q, bias, limit) {
  const key = `${norm(q)}|${bias ? bias.lat.toFixed(1) + ',' + bias.lon.toFixed(1) : ''}|${limit}`;
  const hit = cacheGet('photon', key);
  if (hit) return hit;
  let url = `${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=${limit}`;
  if (bias) url += `&lat=${bias.lat.toFixed(4)}&lon=${bias.lon.toFixed(4)}`;
  const data = await photonGet(url);
  if (!data) return null;
  const v = parsePhoton(data);
  cacheSet('photon', key, v);
  return v;
}

// ---------- OurAirports ----------

// RFC 4180: quoted fields may hold commas, doubled quotes and line breaks.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const s = String(text || '');
  const n = s.length;
  while (i < n) {
    const ch = s.charCodeAt(i);
    if (quoted) {
      if (ch === 34) {
        if (s.charCodeAt(i + 1) === 34) { field += '"'; i += 2; continue; }
        quoted = false; i += 1; continue;
      }
      const j = s.indexOf('"', i);
      if (j < 0) { field += s.slice(i); i = n; continue; }
      field += s.slice(i, j); i = j; continue;
    }
    if (ch === 34) { quoted = true; i += 1; continue; }
    if (ch === 44) { row.push(field); field = ''; i += 1; continue; }
    if (ch === 10 || ch === 13) {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      i += ch === 13 && s.charCodeAt(i + 1) === 10 ? 2 : 1;
      continue;
    }
    // Plain run up to the next special character.
    let j = i;
    while (j < n) { const c = s.charCodeAt(j); if (c === 44 || c === 10 || c === 13 || c === 34) break; j += 1; }
    field += s.slice(i, j); i = j;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function csvObjects(text) {
  const rows = parseCsv(text);
  const head = rows.shift() || [];
  return rows.map((r) => { const o = {}; head.forEach((h, k) => { o[h] = r[k] == null ? '' : r[k]; }); return o; });
}

// Columns of one airport in the index file.
const A = { ident: 0, icao: 1, iata: 2, local: 3, name: 4, city: 5, country: 6, type: 7, lat: 8, lon: 9, elev: 10, keywords: 11, sched: 12, region: 13, gps: 14 };

// The compact index (airports) and the details (runways, frequencies per ident) from the four CSV texts.
function buildAirportIndex({ airports, runways, frequencies, countries }, built = Date.now()) {
  const list = [];
  for (const a of csvObjects(airports)) {
    const lat = num(a.latitude_deg), lon = num(a.longitude_deg);
    if (!a.ident || lat == null || lon == null) continue;
    list.push([
      a.ident, a.icao_code || '', a.iata_code || '', a.local_code || '', a.name || '', a.municipality || '', a.iso_country || '',
      a.type || '', Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, num(a.elevation_ft), String(a.keywords || '').slice(0, 200),
      a.scheduled_service === 'yes' ? 1 : 0, a.iso_region || '', a.gps_code || '',
    ]);
  }
  const details = {};
  const d = (id) => (details[id] = details[id] || { r: [], f: [] });
  for (const r of csvObjects(runways || '')) {
    if (!r.airport_ident) continue;
    d(r.airport_ident).r.push([r.le_ident || '', r.he_ident || '', num(r.length_ft), num(r.width_ft), r.surface || '', r.lighted === '1' ? 1 : 0, r.closed === '1' ? 1 : 0, num(r.le_heading_degT), num(r.he_heading_degT)]);
  }
  for (const f of csvObjects(frequencies || '')) {
    if (!f.airport_ident) continue;
    d(f.airport_ident).f.push([f.type || '', f.description || '', num(f.frequency_mhz)]);
  }
  const names = {};
  for (const c of csvObjects(countries || '')) if (c.code) names[c.code] = c.name;
  return { index: { v: 1, built, countries: names, airports: list }, details };
}

let apt = null;          // { list, by: Map(ident -> row), codes: Map(code -> rows), hay: [] , countries, built }
let aptDetails = null;
let aptMeta = { checked: 0, built: 0, files: {} };
let aptBusy = false, aptError = null;
const oaDir = () => (dir ? path.join(dir, 'ourairports') : null);

// Codes found among the keywords: old ICAO codes ("EBMB") and the Dutch hospital codes ("EH0010").
const KW_CODE = /^(?:[A-Z]{4}|[A-Z]{2}\d{4}|[A-Z]{2}-?\d{2,4})$/;

function useIndex(index) {
  const list = index.airports || [];
  const by = new Map(), codes = new Map(), local = new Map(), alt = new Map(), hay = new Array(list.length);
  const add = (m, code, r) => { if (!code) return; const k = code.toUpperCase(); const a = m.get(k); if (a) { if (!a.includes(r)) a.push(r); } else m.set(k, [r]); };
  list.forEach((r, i) => {
    by.set(r[A.ident].toUpperCase(), r);
    for (const c of [r[A.ident], r[A.icao], r[A.iata]]) add(codes, c, r);
    for (const c of [r[A.local], r[A.gps]]) add(local, c, r);
    for (const k of String(r[A.keywords] || '').split(/\s*,\s*/)) if (KW_CODE.test(k)) add(alt, k, r);
    hay[i] = ' ' + norm(`${r[A.name]} ${r[A.city]} ${r[A.keywords]}`) + ' ';
  });
  apt = { list, by, codes, local, alt, hay, countries: index.countries || {}, built: index.built || 0 };
  aptDetails = null;
}

function loadAirports() {
  const d = oaDir();
  if (!d) return false;
  aptMeta = readJson(path.join(d, 'meta.json')) || aptMeta;
  const index = readJson(path.join(d, 'index.json'));
  if (index && Array.isArray(index.airports)) { useIndex(index); return true; }
  return false;
}

const TYPE_RANK = { large_airport: 15, medium_airport: 11, heliport: 8, small_airport: 4, seaplane_base: 2, balloonport: 1, closed: 0 };
function aptKind(type) {
  if (type === 'heliport') return 'heliport';
  if (type === 'large_airport' || type === 'medium_airport') return 'luchthaven';
  return 'vliegveld';
}
function aptItem(r) {
  const kind = aptKind(r[A.type]);
  const code = r[A.icao] || r[A.gps] || r[A.ident];
  const codes = [code, r[A.iata]].filter(Boolean).join(' / ');
  const country = (apt && apt.countries[r[A.country]]) || r[A.country];
  return {
    id: 'apt:' + r[A.ident], label: r[A.name], sub: sub(codes, r[A.type] === 'closed' ? 'Gesloten' : KIND_LABEL[kind], r[A.city], country),
    kind, icon: ICON[kind], lat: r[A.lat], lon: r[A.lon], bbox: null, src: 'OurAirports', code,
  };
}

// Local airport search: an exact code first, then codes that start with the query, then names and
// places whose words start with the query words (accents ignored). Bigger fields and nearer ones higher.
function searchAirports(q, { bias = null, limit = 12, closed = false } = {}) {
  if (!apt) return [];
  const qc = String(q || '').trim().toUpperCase().replace(/\s+/g, '');
  const toks = norm(q).split(' ').filter(Boolean);
  if (!qc || !toks.length) return [];
  const scored = new Map();
  const put = (r, s) => {
    if (r[A.type] === 'closed' && !closed) return;
    const prev = scored.get(r);
    if (prev == null || s > prev) scored.set(r, s);
  };
  for (const r of apt.codes.get(qc) || []) put(r, 100);
  for (const r of apt.local.get(qc) || []) put(r, 97);
  for (const r of apt.alt.get(qc) || []) put(r, 95);
  if (qc.length >= 2 && /^[A-Z0-9-]+$/.test(qc)) {
    for (const m of [apt.codes, apt.local]) for (const [code, rs] of m) if (code.length > qc.length && code.startsWith(qc)) for (const r of rs) put(r, 70);
  }
  // Word prefixes; a single letter or digit is too vague for names.
  if (toks.join('').length >= 2) {
    for (let i = 0; i < apt.list.length; i += 1) {
      const h = apt.hay[i];
      let whole = 0, ok = true;
      for (const t of toks) {
        if (!h.includes(' ' + t)) { ok = false; break; }
        if (h.includes(' ' + t + ' ')) whole += 1;
      }
      if (ok) put(apt.list[i], 55 + (whole === toks.length ? 8 : 0));
    }
  }
  const out = [];
  for (const [r, s] of scored) {
    let score = s + (TYPE_RANK[r[A.type]] || 0) + (r[A.sched] ? 2 : 0);
    if (bias) score += 10 / (1 + distM(bias.lat, bias.lon, r[A.lat], r[A.lon]) / 50000);
    out.push({ r, score });
  }
  out.sort((a, b) => b.score - a.score || a.r[A.name].localeCompare(b.r[A.name]));
  return out.slice(0, limit).map(({ r, score }) => ({ ...aptItem(r), score }));
}

function loadDetails() {
  if (aptDetails) return aptDetails;
  aptDetails = (oaDir() && readJson(path.join(oaDir(), 'details.json'))) || {};
  return aptDetails;
}

function airport(ident) {
  if (!apt) return null;
  const key = String(ident || '').replace(/^apt:/, '').trim().toUpperCase();
  let r = apt.by.get(key);
  if (!r) { const rs = apt.codes.get(key) || apt.local.get(key); r = rs && rs[0]; }
  if (!r) return null;
  const det = loadDetails()[r[A.ident]] || { r: [], f: [] };
  return {
    ...aptItem(r), ident: r[A.ident], icao: r[A.icao] || null, iata: r[A.iata] || null, local: r[A.local] || null, gps: r[A.gps] || null,
    name: r[A.name], municipality: r[A.city], country: r[A.country], countryName: apt.countries[r[A.country]] || r[A.country],
    region: r[A.region], type: r[A.type], elevation_ft: r[A.elev], scheduled: !!r[A.sched], keywords: r[A.keywords],
    runways: det.r.map(([le, he, length, width, surface, lighted, closed, leHdg, heHdg]) => ({
      ident: [le, he].filter(Boolean).join('/'), le, he, length_ft: length, width_ft: width, surface, lighted: !!lighted, closed: !!closed, le_heading: leHdg, he_heading: heHdg,
    })),
    frequencies: det.f.map(([type, description, mhz]) => ({ type, description, mhz })),
  };
}

// Fetch one CSV with the validators of the last time; null when it did not change.
async function fetchCsv(name, force) {
  const prev = (!force && aptMeta.files && aptMeta.files[name]) || {};
  const headers = { 'User-Agent': UA };
  if (prev.etag) headers['If-None-Match'] = prev.etag;
  if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
  const res = await fetchText(OA + name, { headers, timeoutMs: 120000 });
  const r = typeof res === 'string' ? { status: 200, text: res } : res || {};
  if (r.status === 304) return null;
  if (typeof r.text !== 'string' || !r.text.length) throw new Error(`${name}: leeg antwoord`);
  return { text: r.text, etag: r.etag || null, lastModified: r.lastModified || null };
}

// The monthly download; rebuilds the index when any file changed (or there is no index yet).
async function refreshAirports({ force = false } = {}) {
  if (aptBusy || !oaDir() || !fetchText) return false;
  aptBusy = true;
  const d = oaDir();
  try {
    fs.mkdirSync(d, { recursive: true });
    let changed = force || !apt;
    const files = { ...(aptMeta.files || {}) };
    for (const name of OA_FILES) {
      const got = await fetchCsv(name, force || !fs.existsSync(path.join(d, name)));
      if (!got) continue;
      writeAtomic(path.join(d, name), got.text);
      files[name] = { etag: got.etag, lastModified: got.lastModified };
      changed = true;
    }
    if (changed) {
      const read = (n) => fs.readFileSync(path.join(d, n), 'utf8');
      const { index, details } = buildAirportIndex({ airports: read('airports.csv'), runways: read('runways.csv'), frequencies: read('airport-frequencies.csv'), countries: read('countries.csv') });
      if (index.airports.length < 10) throw new Error('airports.csv onbruikbaar');
      writeAtomic(path.join(d, 'index.json'), JSON.stringify(index));
      writeAtomic(path.join(d, 'details.json'), JSON.stringify(details));
      useIndex(index);
      log.info('geocode', `OurAirports bijgewerkt: ${index.airports.length} velden`);
    }
    aptMeta = { checked: Date.now(), built: apt ? apt.built : 0, files };
    writeAtomic(path.join(d, 'meta.json'), JSON.stringify(aptMeta));
    aptError = null;
    return changed;
  } catch (err) {
    aptError = errText(err);
    log.warn('geocode', 'OurAirports: ' + aptError);
    return false;
  } finally { aptBusy = false; }
}

function checkAirports() {
  if (!apt || Date.now() - (aptMeta.checked || 0) > AIRPORTS_EVERY) refreshAirports().catch(() => {});
}

// ---------- merging ----------

const AREA = new Set(['plaats', 'woonplaats', 'gemeente', 'provincie', 'regio']);
// A Photon result is the same place as a PDOK one when the names match and they lie within 300 m, or,
// for towns and regions (whose centre points differ per source), within 5 km.
function samePlace(a, b) {
  if (a.lat == null || b.lat == null) return false;
  const d = distM(a.lat, a.lon, b.lat, b.lon);
  if (d <= 300 && (norm(a.label) === norm(b.label) || a.kind === b.kind)) return true;
  if (AREA.has(a.kind) && AREA.has(b.kind) && norm(a.label) === norm(b.label) && d <= 5000) return true;
  return false;
}
// Photon's aerodrome is the OurAirports field when within 3 km.
const sameAirport = (a, b) => a.lat != null && b.lat != null && distM(a.lat, a.lon, b.lat, b.lon) <= 3000;

// One ranked list: exact airport codes and hectometre posts first, then PDOK in its own order with the
// matching airports among it, then Photon. Scores are only for ordering.
function merge({ pdok = [], photon = [], airports = [], hmp = false }, limit = 12) {
  const items = [];
  pdok.forEach((it, i) => items.push({ it, s: (hmp ? 98 : 90) - i * 3 }));
  airports.forEach((it) => items.push({ it, s: it.score }));
  photon.forEach((it, i) => {
    if (pdok.some((p) => samePlace(it, p))) return;
    if ((it.kind === 'luchthaven' || it.kind === 'heliport') && airports.some((a) => sameAirport(it, a))) return;
    items.push({ it, s: 74 - i * 3 });
  });
  items.sort((a, b) => b.s - a.s);
  const seen = new Set(), out = [];
  for (const { it } of items) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    const clean = { ...it };
    delete clean.score;
    out.push(clean);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- API ----------

async function suggest(q, opts = {}) {
  const out = [];
  out.errors = [];
  const query = String(q || '').trim().replace(/\s+/g, ' ');
  if (!query || !fetchJson) return out;
  const limit = Math.max(1, Math.min(50, opts.limit || 12));
  const bias = Number.isFinite(opts.lat) && Number.isFinite(opts.lon) ? { lat: opts.lat, lon: opts.lon } : null;
  const fail = (src) => (err) => { out.errors.push({ src, message: errText(err) }); return []; };

  let airports = [];
  try { airports = searchAirports(query, { bias, limit: Math.min(limit, 6), closed: !!opts.closed }); } catch (err) { fail('OurAirports')(err); }
  const exactCode = airports.some((a) => a.score >= 95);
  const h = parseHmp(query);
  const pdokP = (h ? pdokHmp(h, limit) : pdokSuggest(query, bias, limit)).catch(fail('PDOK'));
  const photonQ = () => photonSearch(query, bias, Math.min(limit, 10)).then((v) => v || []).catch(fail('Photon'));
  const wantPhoton = !h && opts.photon !== false && photonAllowed(query);
  let photonP = wantPhoton && opts.world ? photonQ() : null;
  const pdok = await pdokP;
  if (!photonP && wantPhoton && pdok.length < PDOK_FEW && !exactCode) photonP = photonQ();
  const photon = photonP ? await photonP : [];

  for (const it of merge({ pdok, photon, airports, hmp: !!h }, limit)) { remember(it); out.push(it); }
  return out;
}

async function resolve(id) {
  const key = String(id || '');
  try {
    if (key.startsWith('apt:')) {
      const a = airport(key);
      return a ? { lat: a.lat, lon: a.lon, label: a.label, bbox: null } : null;
    }
    if (key.startsWith('pdok:')) {
      const hit = cacheGet('resolve', key);
      if (hit) return hit;
      const url = `${PDOK}/lookup?id=${encodeURIComponent(key.slice(5))}&fl=id,type,weergavenaam,centroide_ll,centroide_rd,geometrie_ll`;
      const doc = (((await fetchJson(url, { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT })) || {}).response || {}).docs;
      const d = doc && doc[0];
      if (!d) return null;
      const it = pdokItem(d);
      const rd = parsePoint(d.centroide_rd);
      const v = { lat: it.lat, lon: it.lon, label: it.label, sub: it.sub, kind: it.kind, bbox: wktBbox(d.geometrie_ll), rd: rd ? { x: rd.x, y: rd.y } : null };
      if (v.lat == null) return null;
      cacheSet('resolve', key, v);
      return v;
    }
    const it = recent.get(key);
    return it && it.lat != null ? { lat: it.lat, lon: it.lon, label: it.label, bbox: it.bbox || null } : null;
  } catch (err) {
    log.warn('geocode', `opzoeken ${key}: ${errText(err)}`);
    return null;
  }
}

async function reverse(lat, lon) {
  lat = num(lat); lon = num(lon);
  if (lat == null || lon == null || !fetchJson) return null;
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const hit = cacheGet('reverse', key);
  if (hit) return hit;
  let near = null;
  if (inNL(lat, lon)) {
    try {
      const data = await fetchJson(`${PDOK}/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}&rows=1&fl=id,type,weergavenaam,centroide_ll,afstand`, { headers: { 'User-Agent': UA }, timeoutMs: TIMEOUT });
      const d = data && data.response && data.response.docs && data.response.docs[0];
      if (d) {
        const it = pdokItem(d);
        const m = num(d.afstand);
        near = { label: it.label, sub: it.sub, lat: it.lat, lon: it.lon, distance: m == null ? null : Math.round(m), src: 'PDOK' };
        if (m == null || m <= PDOK_REVERSE_MAX_M) { cacheSet('reverse', key, near); return near; }
      }
    } catch (err) { log.warn('geocode', 'PDOK omgekeerd: ' + errText(err)); }
  }
  if (Date.now() >= photonPause) {
    try {
      const data = await photonGet(`${PHOTON}/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`);
      const it = data && parsePhoton(data)[0];
      if (it) {
        const v = { label: it.label, sub: it.sub, lat: it.lat, lon: it.lon, distance: it.lat == null ? null : Math.round(distM(lat, lon, it.lat, it.lon)), src: 'Photon' };
        cacheSet('reverse', key, v);
        return v;
      }
    } catch { /* reported by photonGet */ }
  }
  // Nothing closer: the nearest Dutch address, with how far it is.
  if (near) return { ...near, sub: sub(near.sub, near.distance != null ? `${(near.distance / 1000).toFixed(1).replace('.', ',')} km` : null) };
  return null;
}

function status() {
  return {
    airports: { count: apt ? apt.list.length : 0, updated: apt && apt.built ? new Date(apt.built).toISOString() : null, checked: aptMeta.checked ? new Date(aptMeta.checked).toISOString() : null, busy: aptBusy, error: aptError },
    photon: { cached: caches.photon.size, paused: Date.now() < photonPause ? new Date(photonPause).toISOString() : null, error: photonError },
    cache: { reverse: caches.reverse.size, resolve: caches.resolve.size },
  };
}

// autoUpdate: false keeps the monthly download off (tests); airportsDelayMs delays the first check so
// it does not compete with the start-up of the screens.
function start({ dir: d, fetchJson: fj, fetchText: ft, log: l, autoUpdate = true, airportsDelayMs = 30000 } = {}) {
  dir = d || null;
  fetchJson = fj || defaultJson;
  fetchText = ft || defaultFetch;
  if (l) log = l;
  for (const m of Object.values(caches)) m.clear();
  pdokCache.clear(); recent.clear();
  apt = null; aptDetails = null; aptMeta = { checked: 0, built: 0, files: {} }; aptError = null;
  photonSeq = 0; photonLast = 0; photonPause = 0; photonError = null;
  if (timer) { clearInterval(timer); timer = null; }
  if (dir) {
    loadCaches();
    try { loadAirports(); } catch (err) { log.warn('geocode', 'luchthavenindex niet gelezen: ' + errText(err)); }
    if (autoUpdate) {
      const first = setTimeout(checkAirports, airportsDelayMs);
      if (first.unref) first.unref();
      timer = setInterval(checkAirports, 6 * 3600000);
      if (timer.unref) timer.unref();
    }
  }
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; saveCaches(); }
}

module.exports = {
  start, stop, suggest, resolve, reverse, airport, status, refreshAirports,
  // Pure parts, for the tests.
  parseCsv, csvObjects, parseHmp, parsePdok, parsePhoton, buildAirportIndex, searchAirports, merge, wktBbox, useIndex, saveCaches,
};
