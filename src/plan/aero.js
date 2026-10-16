// Aeronautical vector data for Zoek & Plan: airspaces with their vertical limits and frequencies,
// reporting points, navaids, airfields and heliports with runways and frequencies, and obstacles, from
// the openAIP core API (https://api.core.openaip.net/api/, licence CC BY-NC 4.0).
//
// - Per country everything is kept on disk (plan-aero-<CC>.json) and served from there at once; it is
//   fetched again in the background after 7 days, or as soon as a new AIRAC cycle has started.
// - Anywhere else in the world: area() asks by bounding box, cached per 5x5 degree tile for 7 days.
//   openAIP calls the bbox query compute intensive and limits it hard, so those requests are spaced
//   far apart.
// - All requests go one at a time, with a pause in between and a growing wait after a 429.
// - The key lives in openaip.json in the user data folder (mode 0600), never in the code or the layout,
//   and status() never shows it.
const fs = require('fs');
const path = require('path');

const API = 'https://api.core.openaip.net/api/';
const UA = 'P-ALV-Dashboard/1.17 (desktop dashboard)';
const ATTRIBUTION = '© openAIP (CC BY-NC 4.0)';
const DEFAULT_COUNTRIES = ['NL', 'BE', 'DE', 'GB', 'DK', 'FR', 'LU'];
const MAX_AGE = 7 * 86400e3;
const RETRY_FAILED_MS = 3600e3;   // after a failed refresh, wait this long before trying again
const LIMIT = 1000;               // the maximum page size openAIP accepts
const MAX_PAGES = 200;
const TIMEOUT_MS = 30000;
const GAP_MS = 1200;              // between two requests
const BBOX_GAP_MS = 25000;        // between two bbox requests (at 15-20 s openAIP already refuses some)
const RETRY_MS = [10000, 30000, 90000];
const TILE = 5;                   // degrees
const MAX_TILES = 12;
const M2FT = 3.28084;
const KINDS = { airspaces: 'airspaces', reportingPoints: 'reporting-points', navaids: 'navaids', airports: 'airports', obstacles: 'obstacles' };

// openAIP airspace types (the spec's enum) with a readable code, a Dutch name and a colour suggestion.
const TYPE_CODES = ['OTHER', 'R', 'D', 'P', 'CTR', 'TMZ', 'RMZ', 'TMA', 'TRA', 'TSA', 'FIR', 'UIR', 'ADIZ', 'ATZ', 'MATZ', 'AWY', 'MTR', 'ALERT', 'WARNING', 'PROTECTED', 'HTZ', 'GLIDING', 'TRP', 'TIZ', 'TIA', 'MTA', 'CTA', 'ACC', 'SPORT', 'LOW_OVERFLIGHT', 'MRT', 'TFR', 'VFR_SECTOR', 'FIS', 'LTA', 'UTA', 'MCTR'];
const TYPES = {
  OTHER: { name: 'Overig luchtruim', color: '#8a8f98' },
  R: { name: 'Beperkt gebied (R)', color: '#d1342f' },
  D: { name: 'Gevaarlijk gebied (D)', color: '#e0662a' },
  P: { name: 'Verboden gebied (P)', color: '#a3001b' },
  CTR: { name: 'Controlezone (CTR)', color: '#c2185b' },
  TMZ: { name: 'Transponderverplichte zone (TMZ)', color: '#6d4c9f' },
  RMZ: { name: 'Radioverplichte zone (RMZ)', color: '#2e7d32' },
  TMA: { name: 'Naderingsgebied (TMA)', color: '#1565c0' },
  TRA: { name: 'Tijdelijk gereserveerd gebied (TRA)', color: '#ef6c00' },
  TSA: { name: 'Tijdelijk gescheiden gebied (TSA)', color: '#bf360c' },
  FIR: { name: 'Vluchtinformatiegebied (FIR)', color: '#455a64' },
  UIR: { name: 'Hoger vluchtinformatiegebied (UIR)', color: '#37474f' },
  ADIZ: { name: 'Luchtverdedigingszone (ADIZ)', color: '#880e4f' },
  ATZ: { name: 'Vliegveldverkeerszone (ATZ)', color: '#00838f' },
  MATZ: { name: 'Militaire vliegveldverkeerszone (MATZ)', color: '#00695c' },
  AWY: { name: 'Luchtweg (AWY)', color: '#5c6bc0' },
  MTR: { name: 'Militaire oefenroute (MTR)', color: '#8d6e63' },
  ALERT: { name: 'Alarmeringsgebied', color: '#f9a825' },
  WARNING: { name: 'Waarschuwingsgebied', color: '#f57f17' },
  PROTECTED: { name: 'Beschermd gebied', color: '#558b2f' },
  HTZ: { name: 'Helikopterverkeerszone (HTZ)', color: '#0097a7' },
  GLIDING: { name: 'Zweefvliegsector', color: '#7cb342' },
  TRP: { name: 'Transpondergebied (TRP)', color: '#7e57c2' },
  TIZ: { name: 'Verkeersinformatiezone (TIZ)', color: '#0288d1' },
  TIA: { name: 'Verkeersinformatiegebied (TIA)', color: '#039be5' },
  MTA: { name: 'Militair oefengebied (MTA)', color: '#6d4c41' },
  CTA: { name: 'Verkeersleidingsgebied (CTA)', color: '#283593' },
  ACC: { name: 'ACC-sector', color: '#546e7a' },
  SPORT: { name: 'Luchtsport en recreatie', color: '#9e9d24' },
  LOW_OVERFLIGHT: { name: 'Beperking laag overvliegen', color: '#d84315' },
  MRT: { name: 'Militaire route (MRT)', color: '#795548' },
  TFR: { name: 'Aanvliegroute TSA/TRA (TFR)', color: '#a1887f' },
  VFR_SECTOR: { name: 'VFR-sector', color: '#26a69a' },
  FIS: { name: 'FIS-sector', color: '#78909c' },
  LTA: { name: 'Lower Traffic Area (LTA)', color: '#3949ab' },
  UTA: { name: 'Upper Traffic Area (UTA)', color: '#303f9f' },
  MCTR: { name: 'Militaire controlezone (MCTR)', color: '#ad1457' },
};
const ICAO_CLASS = { 0: 'A', 1: 'B', 2: 'C', 3: 'D', 4: 'E', 5: 'F', 6: 'G', 8: 'SUA' };
const ACTIVITY = { 1: 'Parachutespringen', 2: 'Kunstvliegen', 3: 'Aeroclub- en luchtwerkgebied', 4: 'Ultralichte vliegtuigen', 5: 'Scherm- en deltavliegen' };
const LIMIT_UNIT = { 0: 'm', 1: 'ft', 6: 'FL' };
const LIMIT_REF = { 0: 'GND', 1: 'MSL', 2: 'STD' };
const AIRPORT_TYPES = {
  0: { code: 'airport', name: 'Luchthaven' },
  1: { code: 'glider', name: 'Zweefvliegveld' },
  2: { code: 'airfield', name: 'Vliegveld' },
  3: { code: 'international', name: 'Internationale luchthaven' },
  4: { code: 'heliport-military', name: 'Militaire helihaven' },
  5: { code: 'military', name: 'Militair vliegveld' },
  6: { code: 'ultralight', name: 'Ultralicht vliegveld' },
  7: { code: 'heliport', name: 'Helihaven' },
  8: { code: 'closed', name: 'Gesloten vliegveld' },
  9: { code: 'airport-ifr', name: 'Luchthaven (IFR)' },
  10: { code: 'water', name: 'Watervliegveld' },
  11: { code: 'strip', name: 'Landingsstrook' },
  12: { code: 'agricultural', name: 'Landbouwstrook' },
  13: { code: 'altiport', name: 'Altiport' },
};
// Civil heliports split further by name, since openAIP has only one type for them.
const HOSPITAL = /ZIEKENH|MEDISCH|\bMC\b|\bUMC|KLINIEK|KLINIK|HOSPITAL|H[OÔ]PITAL|KRANKENHAUS|\bCHU\b|\bCHR\b|\bAZ\b|\bUZ\b|INFIRMARY|MEDICAL|ISALA|CLINIC/i;
const OFFSHORE = /^[A-Q]\d{1,2}[A-Z]?\d*[- /]|PLATFORM|OFFSHORE|BORWIN|DOLWIN|HELWIN|SYLWIN|KUST (NOORD|ZUID|WEST)|BORSSELE|RIFFGAT|VEJA MATE|BARD \d|GLOBAL TECH|DEUTSCHE BUCHT|BUITENGAATS|\bOSS\b|(ALPHA|BETA|GAMMA|DELTA|EPSILON)$|-[A-Z]{1,2}\d?$|^(AWG|BW\d|OSY|GOEREE|ZUIDWAL|EUROPLATFORM)\b/i;
AIRPORT_TYPES.hospital = { code: 'heliport-hospital', name: 'Ziekenhuishelihaven' };
AIRPORT_TYPES.offshore = { code: 'heliport-offshore', name: 'Offshore helidek' };
const FREQ_TYPE = ['APP', 'APRON', 'ARR', 'CENTER', 'CTAF', 'DEL', 'DEP', 'FIS', 'GLIDING', 'GND', 'INFO', 'MULTICOM', 'UNICOM', 'RADAR', 'TWR', 'ATIS', 'RADIO', 'OTHER', 'AIRMET', 'AWOS', 'LIGHTS', 'VOLMET', 'AFIS', 'ASOS', 'AWIS', 'EMERGENCY', 'CLEARANCE', 'RCO', 'GCO', 'FSS', 'CLASS_C', 'CLASS_B', 'VFR_ADVISORY', 'TRSA'];
const SURFACE = ['Asfalt', 'Beton', 'Gras', 'Zand', 'Water', 'Bitumen', 'Baksteen', 'Macadam', 'Steen', 'Koraal', 'Klei', 'Laterietklei', 'Grind', 'Aarde', 'IJs', 'Sneeuw', 'Rubber', 'Metaal', 'Landingsmat', 'Stalen platen', 'Hout', 'Niet-bitumineus mengsel', 'Onbekend'];
const NAVAID_TYPE = ['DME', 'TACAN', 'NDB', 'VOR', 'VOR-DME', 'VORTAC', 'DVOR', 'DVOR-DME', 'DVORTAC'];
const OBSTACLE_TYPES = {
  obstacle: { name: 'Obstakel' }, chimney: { name: 'Schoorsteen' }, building: { name: 'Gebouw' },
  'wind-turbine': { name: 'Windturbine' }, tower: { name: 'Mast of toren' },
};
const OBSTACLE_CODE = ['obstacle', 'chimney', 'building', 'wind-turbine', 'tower'];
const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

// AIRAC cycles: every 28 days from 25 January 2024 (cycle 2401).
const AIRAC_EPOCH = Date.UTC(2024, 0, 25);
const CYCLE_MS = 28 * 86400e3;
function airac(t = Date.now()) {
  const n = Math.floor((t - AIRAC_EPOCH) / CYCLE_MS);
  const start = AIRAC_EPOCH + n * CYCLE_MS;
  const year = new Date(start).getUTCFullYear();
  const first = Math.ceil((Date.UTC(year, 0, 1) - AIRAC_EPOCH) / CYCLE_MS);
  const ident = String(year % 100).padStart(2, '0') + String(n - first + 1).padStart(2, '0');
  return { ident, start, next: start + CYCLE_MS };
}
const isStale = (fetchedAt, now = Date.now()) => !fetchedAt || now - fetchedAt > MAX_AGE || airac(fetchedAt).start !== airac(now).start;

// ---- normalisation -------------------------------------------------------------------------------

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const mToFt = (m) => (num(m) == null ? null : Math.round(m * M2FT));
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const point = (g) => {
  const c = g && g.type === 'Point' && Array.isArray(g.coordinates) ? g.coordinates : null;
  return c && num(c[0]) != null && num(c[1]) != null ? { lat: r6(c[1]), lon: r6(c[0]) } : null;
};
const elevFt = (e) => (e && num(e.value) != null ? (e.unit === 0 || e.unit == null ? mToFt(e.value) : Math.round(e.value)) : null);

function vlimit(l) {
  if (!l || num(l.value) == null) return null;
  const unit = LIMIT_UNIT[l.unit] || 'ft';
  const ref = LIMIT_REF[l.referenceDatum] || (unit === 'FL' ? 'STD' : 'MSL');
  const v = l.value;
  const ft = unit === 'FL' ? v * 100 : unit === 'm' ? mToFt(v) : Math.round(v);
  let text;
  if (unit === 'FL') text = v >= 999 ? 'UNL' : 'FL ' + String(v).padStart(3, '0');
  else if (ref === 'GND' && v === 0) text = 'GND';
  else text = `${v} ${unit} ${ref === 'GND' ? 'AGL' : ref === 'STD' ? 'STD' : 'AMSL'}`;
  return { v, unit, ref, ft, text };
}

function ring(r) {
  const out = [];
  for (const c of r || []) {
    if (!Array.isArray(c) || num(c[0]) == null || num(c[1]) == null) continue;
    const p = [r6(c[0]), r6(c[1])];
    const q = out[out.length - 1];
    if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push(p);
  }
  return out.length >= 4 ? out : null;
}
function geometry(g) {
  if (!g) return null;
  if (g.type === 'Polygon') { const rs = (g.coordinates || []).map(ring).filter(Boolean); return rs.length ? { type: 'Polygon', coordinates: rs } : null; }
  if (g.type === 'MultiPolygon') {
    const ps = (g.coordinates || []).map((p) => (p || []).map(ring).filter(Boolean)).filter((p) => p.length);
    return ps.length ? { type: 'MultiPolygon', coordinates: ps } : null;
  }
  return null;
}
function bboxOf(g) {
  let s = 90, w = 180, n = -90, e = -180;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const p of polys) for (const [lon, lat] of p[0]) { if (lat < s) s = lat; if (lat > n) n = lat; if (lon < w) w = lon; if (lon > e) e = lon; }
  return [s, w, n, e];
}

// "H24", or the days grouped by equal times: "ma-vr 07:00-17:00, za NOTAM".
function hours(h) {
  const list = (h && Array.isArray(h.operatingHours) ? h.operatingHours : []).filter((o) => o && o.dayOfWeek >= 0 && o.dayOfWeek <= 6);
  if (!list.length) return null;
  const fmt = (o) => (o.byNotam ? 'NOTAM' : `${o.sunrise ? 'SR' : o.startTime || '?'}-${o.sunset ? 'SS' : o.endTime || '?'}`);
  const per = {};
  for (const o of list) per[o.dayOfWeek] = per[o.dayOfWeek] ? per[o.dayOfWeek] + ', ' + fmt(o) : fmt(o);
  if (Object.keys(per).length === 7 && Object.values(per).every((t) => t === '00:00-00:00' || t === '00:00-23:59')) return 'H24';
  const parts = [];
  for (let d = 0; d < 7; d++) {
    if (!per[d]) continue;
    let e = d;
    while (e < 6 && per[e + 1] === per[d]) e++;
    parts.push(`${DAYS[d]}${e > d ? '-' + DAYS[e] : ''} ${per[d] === '00:00-00:00' ? 'H24' : per[d]}`);
    d = e;
  }
  return parts.join(', ');
}

function airspace(a) {
  const geom = geometry(a && a.geometry);
  if (!geom) return null;
  const out = {
    id: a._id, name: str(a.name) || '', type: TYPE_CODES[a.type] || 'OTHER',
    icaoClass: ICAO_CLASS[a.icaoClass] || null,
    lower: vlimit(a.lowerLimit), upper: vlimit(a.upperLimit),
    freqs: (a.frequencies || []).filter((f) => f && parseFloat(f.value) > 0).map((f) => ({ name: str(f.name), mhz: parseFloat(f.value), primary: !!f.primary })),
    country: str(a.country), geometry: geom, bbox: bboxOf(geom),
  };
  const sq = (a.transponderSettings || []).map((t) => t && t.code).filter(Boolean);
  if (sq.length) out.squawk = sq;
  if (ACTIVITY[a.activity]) out.activity = ACTIVITY[a.activity];
  for (const k of ['onDemand', 'onRequest', 'byNotam', 'specialAgreement', 'requestCompliance']) if (a[k]) out[k] = true;
  const h = hours(a.hoursOfOperation);
  if (h) out.hours = h;
  if (str(a.remarks)) out.remarks = str(a.remarks);
  if (str(a.activeFrom)) out.activeFrom = a.activeFrom;
  if (str(a.activeUntil)) out.activeUntil = a.activeUntil;
  return out;
}

function reportingPoint(p, airportIcao = {}) {
  const pt = point(p && p.geometry);
  if (!pt) return null;
  return {
    id: p._id, name: str(p.name) || '', lat: pt.lat, lon: pt.lon, compulsory: !!p.compulsory,
    airports: (p.airports || []).map((id) => airportIcao[id]).filter(Boolean), country: str(p.country),
  };
}

function navaid(n) {
  const pt = point(n && n.geometry);
  if (!pt) return null;
  const f = n.frequency || {};
  const fv = parseFloat(f.value);
  const freq = fv > 0 ? (f.unit === 1 ? `${fv} kHz` : `${f.value} MHz`) : null;
  const out = {
    id: n._id, ident: str(n.identifier), name: str(n.name) || '', type: NAVAID_TYPE[n.type] || 'OTHER',
    freq, channel: str(n.channel), lat: pt.lat, lon: pt.lon, elevFt: elevFt(n.elevation),
    magVar: num(n.magneticDeclination) == null ? null : Math.round(n.magneticDeclination * 10) / 10,
    country: str(n.country),
  };
  if (n.range && num(n.range.value) != null) out.rangeNm = n.range.value;
  return out;
}

function airportType(a) {
  if (a.type === 7) {
    const name = String(a.name || '');
    if (HOSPITAL.test(name)) return AIRPORT_TYPES.hospital.code;
    if (OFFSHORE.test(name)) return AIRPORT_TYPES.offshore.code;
  }
  return (AIRPORT_TYPES[a.type] || AIRPORT_TYPES[0]).code;
}
function airport(a) {
  const pt = point(a && a.geometry);
  if (!pt) return null;
  const out = {
    id: a._id, icao: str(a.icaoCode), iata: str(a.iataCode), name: str(a.name) || '', type: airportType(a),
    lat: pt.lat, lon: pt.lon, elevFt: elevFt(a.elevation),
    runways: (a.runways || []).filter(Boolean).map((r) => {
      const d = r.dimension || {};
      const s = r.surface || {};
      const rw = {
        des: str(r.designator), trueHdg: num(r.trueHeading),
        lengthM: d.length ? num(d.length.value) : null, widthM: d.width ? num(d.width.value) : null,
        surface: SURFACE[s.mainComposite] || null,
      };
      if (r.operations === 1 || r.operations === 2) rw.closed = true;
      return rw;
    }),
    freqs: (a.frequencies || []).filter((f) => f && parseFloat(f.value) > 0).map((f) => ({ name: str(f.name), mhz: parseFloat(f.value), type: FREQ_TYPE[f.type] || 'OTHER', primary: !!f.primary })),
    country: str(a.country), ppr: !!a.ppr, private: !!a.private,
  };
  if (Array.isArray(a.trafficType) && a.trafficType.includes(1)) out.ifr = true;
  return out;
}

function obstacle(o) {
  const pt = point(o && o.geometry);
  if (!pt) return null;
  const tags = o.osmTags || {};
  let type = OBSTACLE_CODE[o.type] || 'obstacle';
  if (type === 'obstacle' && (tags['generator:source'] === 'wind' || tags.value === 'wind_turbine')) type = 'wind-turbine';
  // openAIP's height is often missing where the OpenStreetMap tag has it (in metres).
  const hM = o.height && num(o.height.value) != null ? o.height.value : parseFloat(tags.height);
  const heightFtAgl = Number.isFinite(hM) && hM > 0 ? mToFt(hM) : null;
  const elev = elevFt(o.elevation);
  const lit = Object.keys(tags).some((k) => /light/i.test(k) && !/lighting=no/.test(`${k}=${tags[k]}`));
  return {
    id: o._id, name: str(o.name) || '', type, lat: pt.lat, lon: pt.lon,
    heightFtAgl, elevFtAmsl: elev, topFtAmsl: heightFtAgl != null && elev != null ? elev + heightFtAgl : null,
    lighted: lit ? true : null, country: str(o.country),
  };
}

// Raw openAIP lists to the compact shapes; reporting points get the ICAO codes of their airfields.
function normalize(raw, knownAirports = {}) {
  const airports = (raw.airports || []).map(airport).filter(Boolean);
  const icao = { ...knownAirports };
  for (const a of airports) icao[a.id] = a.icao || a.name;
  return {
    airspaces: (raw.airspaces || []).map(airspace).filter(Boolean),
    reportingPoints: (raw.reportingPoints || []).map((p) => reportingPoint(p, icao)).filter(Boolean),
    navaids: (raw.navaids || []).map(navaid).filter(Boolean),
    airports,
    obstacles: (raw.obstacles || []).map(obstacle).filter(Boolean),
  };
}

// ---- network ------------------------------------------------------------------------------------

let dir = null, fetchFn = null, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let log = { info() {}, warn() {} };
let key = null, lastError = null, ok = null;
let gapMs = GAP_MS, bboxGapMs = BBOX_GAP_MS, retryMs = RETRY_MS;
let lastReq = 0, lastBboxReq = 0, chain = Promise.resolve();
const countries = new Map();     // CC -> { fetchedAt, airac, data, errors }
const tiles = new Map();         // tile id -> same
const inflight = new Map();
const lastTry = new Map();

const errText = (e) => (e && e.status === 401 || e && e.status === 403 ? 'openAIP weigert de sleutel' : e && e.status === 429 ? 'openAIP vraagt om later terug te komen (te veel verzoeken)' : e && e.status ? `openAIP antwoordt HTTP ${e.status}` : `openAIP onbereikbaar: ${(e && e.message) || e}`);

// One request at a time, spaced out; 429s and server errors are retried after a growing wait.
function get(query, { bbox = false, k = key } = {}) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const now = Date.now();
      const wait = Math.max(lastReq + gapMs, bbox ? lastBboxReq + bboxGapMs : 0) - now;
      if (wait > 0) await sleep(wait);
      lastReq = Date.now();
      if (bbox) lastBboxReq = lastReq;
      try {
        return await fetchFn(API + query, { headers: { 'x-openaip-api-key': k, 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: TIMEOUT_MS });
      } catch (e) {
        const retryable = !e || !e.status || e.status === 429 || e.status >= 500;
        if (!retryable || attempt >= retryMs.length) throw e;
        const ms = Math.max(retryMs[attempt], (e && e.retryAfter > 0 ? e.retryAfter * 1000 : 0));
        log.warn('aero', `${errText(e)}; opnieuw over ${Math.round(ms / 1000)} s`);
        await sleep(ms);
      }
    }
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

// All pages of a list. Country queries tell the number of pages; bbox queries do not, so a full page
// means there may be more.
async function getAll(endpoint, params, opts) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const j = await get(`${endpoint}?${params}&limit=${LIMIT}&page=${page}`, opts);
    const items = j && Array.isArray(j.items) ? j.items : [];
    out.push(...items);
    const total = j && num(j.totalPages);
    if (total != null ? page >= total : items.length < LIMIT) break;
  }
  return out;
}

async function fetchSet(params, opts, previous) {
  const raw = {}, errors = [];
  for (const [kind, ep] of Object.entries(KINDS)) {
    try { raw[kind] = await getAll(ep, params, opts); } catch (e) { errors.push(`${kind}: ${errText(e)}`); raw[kind] = null; lastError = errText(e); if (e && (e.status === 401 || e.status === 403)) { ok = false; break; } }
  }
  const knownAirports = {};
  for (const c of countries.values()) for (const a of c.data.airports || []) knownAirports[a.id] = a.icao || a.name;
  const data = normalize(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v || []])), knownAirports);
  // A kind that failed keeps what the previous fetch brought.
  for (const kind of Object.keys(KINDS)) if (raw[kind] == null) data[kind] = previous ? previous.data[kind] || [] : [];
  return { data, errors };
}

// ---- disk ---------------------------------------------------------------------------------------

function writeJson(file, obj, mode) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
  if (mode) try { fs.chmodSync(file, mode); } catch {}
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
const countryFile = (cc) => path.join(dir, `plan-aero-${cc}.json`);
const tileFile = (id) => path.join(dir, `plan-aero-tile-${id}.json`);

function loadCached(map, id, file) {
  if (map.has(id)) return map.get(id);
  const j = dir ? readJson(file) : null;
  if (j && j.data && num(j.fetchedAt)) { map.set(id, j); return j; }
  return null;
}

// ---- refresh ------------------------------------------------------------------------------------

function refresh(map, id, file, params, opts) {
  if (inflight.has(file)) return inflight.get(file);
  const p = (async () => {
    lastTry.set(file, Date.now());
    const previous = map.get(id) || null;
    const { data, errors } = await fetchSet(params, opts, previous);
    if (errors.length && !previous && Object.values(data).every((l) => !l.length)) throw new Error(errors[0]);
    const now = Date.now();
    // A partial fetch is kept, but under the old date, so it is tried again later.
    const entry = { v: 1, id, fetchedAt: errors.length && previous ? previous.fetchedAt : now, airac: airac(now).ident, data, errors };
    if (!errors.length) { ok = true; lastError = null; }
    map.set(id, entry);
    try { writeJson(file, entry); } catch (e) { log.warn('aero', `cache ${path.basename(file)} niet geschreven: ${e.message}`); }
    log.info('aero', `${id}: ${Object.entries(data).map(([k, v]) => `${v.length} ${k}`).join(', ')}${errors.length ? ' (' + errors.join('; ') + ')' : ''}`);
    return entry;
  })().finally(() => inflight.delete(file));
  inflight.set(file, p);
  return p;
}

const mayRetry = (file) => Date.now() - (lastTry.get(file) || 0) > RETRY_FAILED_MS;

async function ensure(map, id, file, params, opts, errors) {
  let c = loadCached(map, id, file);
  if (!key) return c;
  if (!c) {
    if (!mayRetry(file) && !inflight.has(file)) { errors.push(`${id}: ${lastError || 'ophalen mislukt'}`); return null; }
    try { c = await refresh(map, id, file, params, opts); } catch (e) { errors.push(`${id}: ${e.message}`); return null; }
  } else if (isStale(c.fetchedAt) && mayRetry(file)) {
    refresh(map, id, file, params, opts).catch((e) => log.warn('aero', `${id} verversen mislukt: ${e.message}`));
  }
  return c;
}

function merge(parts, filter) {
  const out = { airspaces: [], reportingPoints: [], navaids: [], airports: [], obstacles: [] };
  const seen = new Set();
  for (const p of parts) for (const kind of Object.keys(out)) for (const item of p.data[kind] || []) {
    if (seen.has(item.id) || (filter && !filter(item))) continue;
    seen.add(item.id);
    out[kind].push(item);
  }
  return out;
}

const blank = () => ({ airspaces: [], reportingPoints: [], navaids: [], airports: [], obstacles: [] });

async function data({ countries: list = DEFAULT_COUNTRIES } = {}) {
  const ccs = [...new Set((Array.isArray(list) ? list : []).map((c) => String(c || '').toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))];
  const errors = [];
  if (!key) errors.push('Geen openAIP-sleutel ingesteld');
  const parts = [];
  const fetchedAt = {};
  for (const cc of ccs) {
    const c = await ensure(countries, cc, countryFile(cc), `country=${cc}`, {}, errors);
    if (!c) continue;
    parts.push(c);
    fetchedAt[cc] = c.fetchedAt;
    for (const e of c.errors || []) errors.push(`${cc}: ${e}`);
  }
  return { ok: parts.length === ccs.length && !errors.length, fetchedAt, attribution: ATTRIBUTION, ...(parts.length ? merge(parts) : blank()), errors };
}

// The 5x5 degree tiles covering [south, west, north, east].
function tilesFor([s, w, n, e]) {
  const out = [];
  for (let lat = Math.floor(s / TILE) * TILE; lat < n; lat += TILE) {
    for (let lon = Math.floor(w / TILE) * TILE; lon < e; lon += TILE) out.push({ id: `${lat}_${lon}`, s: lat, w: lon, n: Math.min(lat + TILE, 90), e: Math.min(lon + TILE, 180) });
  }
  return out;
}

function within([s, w, n, e]) {
  return (item) => {
    if (item.bbox) return item.bbox[0] <= n && item.bbox[2] >= s && item.bbox[1] <= e && item.bbox[3] >= w;
    return item.lat >= s && item.lat <= n && item.lon >= w && item.lon <= e;
  };
}

async function area(bbox) {
  const b = Array.isArray(bbox) ? bbox.map(Number) : [];
  if (b.length !== 4 || b.some((v) => !Number.isFinite(v)) || b[0] >= b[2] || b[1] >= b[3] || b[0] < -90 || b[2] > 90 || b[1] < -180 || b[3] > 180) {
    return { ok: false, fetchedAt: {}, attribution: ATTRIBUTION, ...blank(), errors: ['Ongeldig gebied'] };
  }
  const ts = tilesFor(b);
  if (ts.length > MAX_TILES) return { ok: false, fetchedAt: {}, attribution: ATTRIBUTION, ...blank(), errors: ['Gebied te groot voor openAIP (maximaal ' + MAX_TILES + ' vakken van 5x5 graden)'] };
  const errors = [];
  if (!key) errors.push('Geen openAIP-sleutel ingesteld');
  const parts = [];
  const fetchedAt = {};
  for (const t of ts) {
    const c = await ensure(tiles, t.id, tileFile(t.id), `bbox=${t.w},${t.s},${t.e},${t.n}`, { bbox: true }, errors);
    if (!c) continue;
    parts.push(c);
    fetchedAt[t.id] = c.fetchedAt;
    for (const e of c.errors || []) errors.push(`${t.id}: ${e}`);
  }
  return { ok: parts.length === ts.length && !errors.length, fetchedAt, attribution: ATTRIBUTION, ...(parts.length ? merge(parts, within(b)) : blank()), errors };
}

// ---- key and status ------------------------------------------------------------------------------

const keyFile = () => path.join(dir, 'openaip.json');

async function setKey(k) {
  const v = String(k || '').trim();
  if (!v) {
    key = null; ok = null; lastError = null;
    try { fs.unlinkSync(keyFile()); } catch {}
    return status();
  }
  try {
    await get('airspaces?country=NL&limit=1&page=1', { k: v });
    key = v; ok = true; lastError = null;
    writeJson(keyFile(), { key: v }, 0o600);
  } catch (e) {
    lastError = errText(e);
    if (e && (e.status === 401 || e.status === 403)) { ok = false; return { ...status(), ok: false }; }
    // Not reachable right now: keep the key, it is checked again with the next fetch.
    key = v; ok = false;
    writeJson(keyFile(), { key: v }, 0o600);
  }
  return status();
}

function status() {
  const fetchedAt = {}, counts = {};
  for (const [cc, c] of countries) {
    fetchedAt[cc] = c.fetchedAt;
    counts[cc] = Object.fromEntries(Object.entries(c.data).map(([k, v]) => [k, (v || []).length]));
  }
  return { configured: !!key, ok, lastError, fetchedAt, counts, busy: inflight.size > 0, attribution: ATTRIBUTION };
}

function start(opts = {}) {
  dir = opts.dir || null;
  fetchFn = opts.fetchJson;
  if (opts.log) log = opts.log;
  if (opts.sleep) sleep = opts.sleep;
  if (opts.gapMs != null) gapMs = opts.gapMs;
  if (opts.bboxGapMs != null) bboxGapMs = opts.bboxGapMs;
  if (opts.retryMs) retryMs = opts.retryMs;
  countries.clear(); tiles.clear(); inflight.clear(); lastTry.clear();
  key = null; ok = null; lastError = null;
  const j = dir ? readJson(keyFile()) : null;
  if (j && typeof j.key === 'string' && j.key.trim()) key = j.key.trim();
  // Show what is on disk in status() right away.
  if (dir) {
    try {
      for (const f of fs.readdirSync(dir)) { const m = /^plan-aero-([A-Z]{2})\.json$/.exec(f); if (m) loadCached(countries, m[1], countryFile(m[1])); }
    } catch {}
  }
}

module.exports = {
  start, setKey, status, data, area,
  airac, isStale, normalize, tilesFor,
  TYPES, TYPE_CODES, AIRPORT_TYPES, OBSTACLE_TYPES, FREQ_TYPE, NAVAID_TYPE, ATTRIBUTION,
};
