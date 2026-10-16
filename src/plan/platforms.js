// Zoek & Plan: offshore platforms (oil and gas, wind-farm substations, wind turbines) for the planning
// map, from the official sources where there are any and OpenStreetMap for the rest of the world.
//
// Sources (each one is fetched, cached and allowed to fail on its own; a failing source keeps the
// items of its last good answer):
// - NLOG (TNO): all Dutch mining facilities, onshore ones included (kind 'onshore', offshore false so
//   the map can hide them). The same GeoServer also has wells, well trajectories, fields, licences and
//   seismic lines/grids, but no pipelines; those layers are not used here.
// - Rijkswaterstaat: offshore wind turbines and transformer platforms (OHVS/OSS), and the outlines and
//   500 m safety zones of the wind farms (areas()).
// - Energistyrelsen via GEUS (Denmark): platforms with helideck and highest-point elevations.
// - Sodir (Norway): all fixed facilities. Moveable units (rigs, vessels) are left out: their position
//   in the register says nothing about where they are now.
// - NSTA (United Kingdom): surface infrastructure, WGS84 service on ArcGIS Online (the old
//   data.nstauthority.co.uk host no longer resolves).
// - BOEM (United States, Gulf of America): fixed-width files in ZIPs, read with the small unzip below.
//   Only structures that have not been removed (about 1300 of 7100).
// - EMODnet Human Activities: platforms of the other European countries, and extra attributes (water
//   depth, weights, function) for the national ones.
//
// Datums, checked against the national sources in October 2026:
// - EMODnet's Dutch, Norwegian and Danish positions are ED50 labelled as WGS84 (110-120 m off to the
//   north-east). Shifted with the standard ED50 -> WGS84 parameters they agree with NLOG, Sodir and
//   GEUS within 2-3 m (median). The Irish ones look the same (few samples, against OSM). The British
//   positions are already WGS84 (median 0 m from NSTA); for Italy, Croatia, Germany and the rest OSM
//   agrees better with the raw positions, so those are used as they are.
// - BOEM gives NAD27. Fitted against 1281 OSM platforms in the Gulf: WGS84 lies about 26 m north and
//   10-25 m west of it, growing to the west; corrected with that fit (a few metres).
//
// Injected (start): fetchText(url, { timeoutMs, headers, method, body }) -> string (or { text }), and
// fetchBuffer(url, opts) -> Buffer. Both throw on a failed request.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const UA = 'P-ALV-Dashboard/1.17 (desktop dashboard)';
const DAY = 86400000;
const MAX_AGE = 7 * DAY;           // official sources: refresh weekly
const RETRY_MS = 6 * 3600000;      // a failed source is asked again after this
const OSM_TTL = 30 * DAY;
const FIRST_WAIT_MS = 45000;       // the very first list() waits at most this long for the sources
const TILE = 5;                    // OSM tiles of 5 x 5 degrees
const MAX_TILES = 12;              // a larger area is taken from the world query
const OSM_GAP_MS = 1000;
const NEAR_OFFICIAL_M = 300;       // an OSM platform this close to an official one is the same one
const CACHE = 'plan-platforms.json', AREAS = 'plan-platforms-areas.json', OSM_FILE = 'plan-platforms-osm.json';

const GDN = 'https://www.gdngeoservices.nl/geoserver/nlog/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=json&srsName=EPSG:4326&typeName=';
const RWS = 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/windenergiegebieden/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json&srsName=EPSG:4326&typeName=';
const GEUS = 'https://data.geus.dk/geusmap/ows/4326.jsp?SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature&TYPENAME=';
const SODIR = 'https://factmaps.sodir.no/api/rest/services/Factmaps/FactMapsWGS84/MapServer/307/query';
const NSTA = 'https://services-eu1.arcgis.com/OZMfUznmLTnWccBc/arcgis/rest/services/UKCS%20offshore%20infrastructure%20surface%20points%20WGS84/FeatureServer/1/query';
const BOEM = 'https://www.data.boem.gov/';
const URLS = {
  nlog: GDN + 'nlog:GDW_NG_FACILITY_UTM',
  rwsTurbines: RWS + 'windenergiegebieden:windparken_turbines',
  rwsFarms: RWS + 'windenergiegebieden:vergunde_windparken',
  rwsZones: RWS + 'windenergiegebieden:vergunde_windparken_veiligheidszones',
  emodnet: 'https://ows.emodnet-humanactivities.eu/wfs?service=WFS&version=2.0.0&request=GetFeature&typeName=emodnet:platforms&outputFormat=application/json',
  geusPlatform: GEUS + 'ens_platform',
  geusFlight: GEUS + 'ens_flight_safety',
  sodir: (offset) => `${SODIR}?where=1%3D1&outFields=*&f=geojson&orderByFields=OBJECTID&resultRecordCount=1000&resultOffset=${offset}`,
  nsta: (offset) => `${NSTA}?where=1%3D1&outFields=*&f=geojson&orderByFields=OBJECTID&resultRecordCount=1000&resultOffset=${offset}`,
  boemMast: BOEM + 'Platform/Files/platmastfixed.zip',
  boemLoc: BOEM + 'Platform/Files/platlocfixed.zip',
  boemStru: BOEM + 'Platform/Files/platstrufixed.zip',
  boemComp: BOEM + 'Company/Files/compallfixed.zip',
};
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

// In merge priority: the national source of a country wins over the others.
const SOURCES = [
  { key: 'nlog', src: 'NLOG', name: 'NLOG (TNO) – mijnbouwlocaties Nederland', url: 'https://www.nlog.nl', licence: 'Open data – bron: NLOG.nl (TNO, Geologische Dienst Nederland)' },
  { key: 'rws', src: 'RWS', name: 'Rijkswaterstaat – windparken op zee', url: 'https://geo.rijkswaterstaat.nl/services/ogc/gdr/windenergiegebieden/ows', licence: 'CC0 – Rijkswaterstaat' },
  { key: 'geus', src: 'GEUS', name: 'Energistyrelsen / GEUS – platforms Denemarken', url: 'https://data.geus.dk', licence: 'Vrij te gebruiken met bronvermelding – Energistyrelsen, via GEUS' },
  { key: 'nsta', src: 'NSTA', name: 'North Sea Transition Authority – installaties VK', url: 'https://opendata-nstauthority.hub.arcgis.com', licence: 'Open Government Licence v3.0 – Contains information provided by the North Sea Transition Authority and/or other third parties' },
  { key: 'sodir', src: 'Sodir', name: 'Sokkeldirektoratet (Sodir) – installaties Noorwegen', url: 'https://factpages.sodir.no', licence: 'NLOD 2.0 – Sokkeldirektoratet' },
  { key: 'boem', src: 'BOEM', name: 'BOEM – platforms Golf van Amerika (VS)', url: 'https://www.data.boem.gov/Main/Platform.aspx', licence: 'Publiek domein – U.S. Bureau of Ocean Energy Management' },
  { key: 'emodnet', src: 'EMODnet', name: 'EMODnet Human Activities – platforms Europa', url: 'https://emodnet.ec.europa.eu/en/human-activities', licence: 'CC BY 4.0 – EMODnet Human Activities' },
];
const OSM_SOURCE = { key: 'osm', src: 'OSM', name: 'OpenStreetMap (Overpass)', url: 'https://www.openstreetmap.org', licence: 'ODbL – © OpenStreetMap-bijdragers' };
const HOME = { NL: 'NLOG', GB: 'NSTA', DK: 'GEUS', NO: 'Sodir', US: 'BOEM' };

let dir = null, fetchText = null, fetchBuffer = null, now = () => Date.now(), firstWait = FIRST_WAIT_MS, osmGap = OSM_GAP_MS;
let log = { info() {}, warn() {} };
let cache = null, merged = null, refreshing = null;
const busy = new Set();
let areasCache = null, areasBusy = null;
let osmCache = null, osmChain = Promise.resolve(), osmLast = 0, worldBusy = null;

// ---------- small helpers ----------

const num = (v) => { if (v == null || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const str = (v) => { if (v == null) return null; const s = String(v).trim(); return s && !/^(-|unknown|n\/a|null|none)$/i.test(s) ? s : null; };
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const rad = (d) => (d * Math.PI) / 180;
function distM(aLat, aLon, bLat, bLon) {
  const x = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLon - aLon) / 2) ** 2;
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(x)));
}
const isoDay = (ms) => (Number.isFinite(ms) ? new Date(ms + 12 * 3600000).toISOString().slice(0, 10) : null); // dates at local midnight
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
function dmy(s) { // '29-APR-2004' -> '2004-04-29'
  const m = /^(\d{2})-([A-Z]{3})-(\d{4})$/.exec(String(s || '').trim());
  return m && MON[m[2]] ? `${m[3]}-${String(MON[m[2]]).padStart(2, '0')}-${m[1]}` : null;
}
const ymd = (s) => { const m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : str(s); };
const yesNo = (v) => (v === 'Y' ? 'ja' : v === 'N' ? 'nee' : null);
const bodyOf = (r) => (typeof r === 'string' ? r : r && typeof r.text === 'string' ? r.text : r && Buffer.isBuffer(r) ? r.toString('utf8') : '');
const errText = (e) => (e && e.message) || String(e);
// Only the pairs with a value, so the map's detail panel shows no empty rows.
const fieldList = (pairs) => pairs.filter(([, v]) => v != null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v)));

// Names compared across sources: case, accents, brackets, the word "platform" and leading zeros in
// block numbers ("K09ab-B" is "K9ab-B") do not count.
function normName(s) {
  return String(s || '').toUpperCase().replace(/Ø/g, 'O').replace(/Æ/g, 'AE').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, ' ').replace(/\bPLATF?ORMS?\b/g, ' ').replace(/([A-Z])0+(\d)/g, '$1$2').replace(/[^A-Z0-9]/g, '');
}

// ---------- status ----------

const STATUS_CODES = { USE: 'in gebruik', NUS: 'buiten gebruik', ABN: 'ontmanteld', REM: 'verwijderd' };
const STATUS_RULES = [
  [/not in use|buiten gebruik|shut ?down|closed down|laid up|suspended|disused|idle|niet in gebruik/, 'buiten gebruik'],
  [/partly removed|decommission|abandon|ontmanteld|plugged/, 'ontmanteld'],
  [/removed|disposal|verwijderd|dismantled/, 'verwijderd'],
  [/future|toekomst|plan|ontwikkeling|ontwerp|construction|installation|fabrication|approved|vergund|aanleg/, 'gepland'],
  [/in use|operational|active|in service|in gebruik|in bedrijf|producing|production|^operating$/, 'in gebruik'],
];
// Any source's status in the Dutch set: in gebruik, buiten gebruik, ontmanteld, verwijderd, gepland, onbekend.
function normStatus(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 'onbekend';
  if (STATUS_CODES[s.toUpperCase()]) return STATUS_CODES[s.toUpperCase()];
  const l = s.toLowerCase();
  for (const [re, out] of STATUS_RULES) if (re.test(l)) return out;
  return 'onbekend';
}

// ---------- datums ----------

// ED50 (International 1924) to WGS84, three-parameter shift (EPSG:1133, western Europe mean).
function ed50ToWgs84(lat, lon) {
  const a1 = 6378388, f1 = 1 / 297, a2 = 6378137, f2 = 1 / 298.257223563;
  const e1 = 2 * f1 - f1 * f1, e2 = 2 * f2 - f2 * f2, p = rad(lat), l = rad(lon);
  const N = a1 / Math.sqrt(1 - e1 * Math.sin(p) ** 2);
  const X = N * Math.cos(p) * Math.cos(l) - 87, Y = N * Math.cos(p) * Math.sin(l) - 98, Z = N * (1 - e1) * Math.sin(p) - 121;
  const P = Math.hypot(X, Y);
  let q = Math.atan2(Z, P * (1 - e2));
  for (let i = 0; i < 5; i++) q = Math.atan2(Z + e2 * (a2 / Math.sqrt(1 - e2 * Math.sin(q) ** 2)) * Math.sin(q), P);
  return [r6((q * 180) / Math.PI), r6((Math.atan2(Y, X) * 180) / Math.PI)];
}
// NAD27 to WGS84 in the Gulf of America, a linear fit of the offsets to OSM (see the top).
const nad27GulfToWgs84 = (lat, lon) => [r6(lat + 0.000233 - 0.0000075 * (lon + 89)), r6(lon - 0.00005 + 0.0000235 * (lon + 89))];

// ---------- the item shape ----------

function item(o) {
  return {
    id: o.id, name: o.name || null, lat: r6(o.lat), lon: r6(o.lon), country: o.country || null,
    offshore: o.offshore !== false, kind: o.kind || 'other', status: o.status || 'onbekend', operator: o.operator || null,
    waterDepthM: o.waterDepthM > 0 ? r1(o.waterDepthM) : null, helideck: o.helideck == null ? null : !!o.helideck,
    helideckElevationM: o.helideckElevationM == null ? null : o.helideckElevationM,
    src: o.src, srcUrl: o.srcUrl || null, updated: o.updated || null, fields: fieldList(o.fields || []),
  };
}
const valid = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
const point = (f) => { const c = f && f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null; return c ? [num(c[1]), num(c[0])] : [null, null]; };

// ---------- NLOG ----------

const NLOG_TYPE = {
  'Production platform': 'Productieplatform', 'Production satellite': 'Satellietplatform', Subsea: 'Onderzeese installatie',
  'Production location': 'Productielocatie (land)', Plant: 'Installatie', Refinery: 'Raffinaderij', Sidetap: 'Sidetap (aftakking pijpleiding)',
  'Tanker mooring and loading system': 'Afmeer- en laadsysteem voor tankers', 'Geothermal installation': 'Aardwarmte-installatie', 'Off-load Terminal': 'Overslagterminal',
};
const NLOG_KIND = { 'Production platform': 'platform', 'Production satellite': 'satellite', Subsea: 'subsea', Sidetap: 'subsea', 'Tanker mooring and loading system': 'other', 'Off-load Terminal': 'other' };
const NLOG_SEA_TYPES = new Set(['Production platform', 'Subsea', 'Sidetap', 'Tanker mooring and loading system', 'Off-load Terminal']);
// Offshore satellites are named after their block ("K14-FB-1", "PE-K4-PA"); onshore ones after a place.
const BLOCK_NAME = /^(?:(?:PE|PL|CP|UN)-)?[A-Q]-?\d{1,2}[a-z]{0,3}[-/]/i;

function parseNlog(json) {
  const out = [];
  for (const f of (json && json.features) || []) {
    const p = f.properties || {}, [lat, lon] = point(f);
    if (!valid(lat, lon)) continue;
    const name = str(p.FACILITY_NAME), code = str(p.FACILITY_CODE), type = str(p.FACILITY_TYPE_DESCRIPTION) || '';
    const offshore = NLOG_SEA_TYPES.has(type) || BLOCK_NAME.test(name || '') || BLOCK_NAME.test(code || '') || lat > 53.56 || lon < 3.3;
    const removed = /\(verwijderd\)/i.test(name || '');
    out.push(item({
      id: 'nlog:' + (code || name), name: name || code, lat, lon, country: /\(United Kingdom\)/i.test(name || '') ? 'GB' : 'NL', offshore,
      kind: offshore ? NLOG_KIND[type] || 'other' : 'onshore',
      status: normStatus(p.STATUS_CODE || p.STATUS_DESCRIPTION || (removed ? 'verwijderd' : '')),
      operator: str(p.OPERATOR), src: 'NLOG', srcUrl: 'https://www.nlog.nl',
      fields: [['Code', code], ['Type', NLOG_TYPE[type] || type || null], ['Putten', str(p.BOREHOLES) && p.BOREHOLES.split(',').map((s) => s.trim()).join(', ')]],
    }));
  }
  return out;
}

// ---------- Rijkswaterstaat ----------

const cleanOwner = (s) => { const v = str(s); return v ? v.replace(/^[^:]{1,20}:\s*/, '').replace(/\.$/, '').trim() || null : null; };
const featureNo = (f, i) => { const m = /\.(\d+)$/.exec(String(f.id || '')); return m ? m[1] : String(i + 1); };

// Turbines and transformer platforms. The layer has HKZ Alpha and Beta twice (as "OSS platform" and as
// "OHVS", up to 70 m apart); the OHVS records are kept.
function parseRws(json) {
  const subs = [], turbines = [];
  ((json && json.features) || []).forEach((f, i) => {
    const p = f.properties || {}, [lat, lon] = point(f);
    if (!valid(lat, lon)) return;
    const opm = str(p.opmerking) || '', park = str(p.naam), nr = str(p.turbine_nr);
    const isSub = /OHVS|OSS/i.test(opm);
    let name;
    if (!isSub) name = [park, nr].filter(Boolean).join(' ');
    else if (nr && park && nr.toUpperCase().includes(park.toUpperCase())) name = nr;
    else if (nr && park && park.toUpperCase().includes(nr.toUpperCase())) name = park;
    else name = [park, nr].filter(Boolean).join(' ');
    const it = item({
      id: 'rws:' + featureNo(f, i), name, lat, lon, country: 'NL', offshore: true, kind: isSub ? 'substation' : 'turbine',
      status: normStatus(p.status), operator: cleanOwner(p.eigenaar), src: 'RWS', srcUrl: 'https://www.rijkswaterstaat.nl/water/waterbeheer/windenergie-op-zee',
      fields: isSub ? [['Windpark', park], ['Soort', /OSS/i.test(opm) ? 'Transformatorplatform (OSS)' : 'Transformatorplatform (OHVS)'], ['Eigenaar', str(p.eigenaar)]]
        : [['Windpark', park], ['Turbinenummer', nr], opm && opm !== 'Turbine' ? ['Opmerking', opm] : ['', null]],
    });
    it._ohvs = /OHVS/i.test(opm);
    (isSub ? subs : turbines).push(it);
  });
  const keep = [];
  for (const s of subs.sort((a, b) => b._ohvs - a._ohvs)) if (!keep.some((k) => distM(k.lat, k.lon, s.lat, s.lon) < 100)) keep.push(s);
  return [...keep, ...turbines].map((x) => { delete x._ohvs; return x; });
}

// Outlines and safety zones of the wind farms, as GeoJSON geometries rounded to 6 decimals.
const roundGeom = (g) => {
  const r = (c) => (typeof c[0] === 'number' ? [r6(c[0]), r6(c[1])] : c.map(r));
  return g && g.coordinates ? { type: g.type, coordinates: r(g.coordinates) } : null;
};
function parseRwsAreas(farmsJson, zonesJson) {
  const farms = ((farmsJson && farmsJson.features) || []).map((f, i) => {
    const p = f.properties || {};
    return { id: 'rws-park:' + featureNo(f, i), name: str(p.naam), status: normStatus(p.status), owner: cleanOwner(p.eigenaar), built: str(p.aanlegdatu), areaKm2: r1(num(p.km2)), polygon: roundGeom(f.geometry) };
  }).filter((a) => a.polygon);
  const zones = ((zonesJson && zonesJson.features) || []).map((f, i) => {
    const p = f.properties || {};
    return { id: 'rws-zone:' + featureNo(f, i), name: str(p.naam), status: normStatus(p.status), owner: cleanOwner(p.eigenaar), kind: /OHVS/i.test(p.opmerking || '') ? 'substation' : 'farm', bufferM: num(p.buff_dist), polygon: roundGeom(f.geometry) };
  }).filter((a) => a.polygon);
  return { farms, zones };
}

// ---------- EMODnet ----------

const EMOD_COUNTRY = { Denmark: 'DK', Bulgaria: 'BG', Germany: 'DE', Ireland: 'IE', Netherlands: 'NL', Norway: 'NO', Croatia: 'HR', Poland: 'PL', Spain: 'ES', Ukraine: 'UA', Italy: 'IT', Lybia: 'LY', Libya: 'LY', Russia: 'RU', 'United Kingdom': 'GB', France: 'FR', Belgium: 'BE', Portugal: 'PT', Greece: 'GR', Romania: 'RO', Turkey: 'TR', Malta: 'MT', Sweden: 'SE', Finland: 'FI' };
const ED50_COUNTRIES = new Set(['NL', 'NO', 'DK', 'IE']);
const EN_NL = {
  'fixed steel': 'Vast, staal', 'subsea steel': 'Onderzees, staal', 'floating steel': 'Drijvend, staal', 'floating concrete': 'Drijvend, beton',
  'gravity-based concrete': 'Betonnen zwaartekrachtfundering', 'gravity based concrete': 'Betonnen zwaartekrachtfundering',
  'above water production': 'Productie boven water', 'above water storage and production': 'Opslag en productie boven water', subsea: 'Onderzees',
  production: 'Productie', 'production platform': 'Productieplatform', satellite: 'Satelliet', other: 'Overig', others: 'Overig',
  'natural gas': 'Aardgas', gas: 'Gas', oil: 'Olie', condensate: 'Condensaat', 'oil and gas': 'Olie en gas', 'oil & gas': 'Olie en gas',
  wellhead: 'Putplatform (wellhead)', process: 'Procesplatform',
};
const nl = (s) => { const v = str(s); return v ? EN_NL[v.toLowerCase()] || v : null; };

function emodKind(cat, fn, name) {
  const c = `${cat || ''} ${fn || ''}`.toUpperCase();
  if (/TERMINAL|DEPOT|TANKS\b/.test(c)) return 'onshore';
  if (/SUBSEA/.test(c)) return 'subsea';
  if (/FPSO|FSO|FSU|STORAGE UNIT/.test(c)) return 'fpso';
  if (/BUOY|SBM|SPM|MOORING/.test(c) || /BUOY/i.test(name || '')) return 'other';
  if (/SATELLITE/.test(c)) return 'satellite';
  return 'platform';
}
function parseEmodnet(json) {
  const out = [];
  for (const f of (json && json.features) || []) {
    const p = f.properties || {};
    let [lat, lon] = point(f);
    if (!valid(lat, lon)) continue;
    const country = EMOD_COUNTRY[p.country] || null;
    if (ED50_COUNTRIES.has(country)) [lat, lon] = ed50ToWgs84(lat, lon);
    const kind = emodKind(p.category, p.function, p.name);
    out.push(item({
      id: 'emodnet:' + (str(p.platformid) || String(f.id || '').replace(/^platforms\./, '')), name: str(p.name), lat, lon, country,
      offshore: kind !== 'onshore', kind, status: normStatus(p.current_status), operator: str(p.operator), waterDepthM: num(p.water_depth),
      src: 'EMODnet', srcUrl: 'https://emodnet.ec.europa.eu/geoviewer/', updated: ymd(p.valid_from),
      fields: [
        ['Constructie', nl(p.category)], ['Functie', nl(p.function)], ['Primaire productie', nl(p.primary_production)], ['Blok', str(p.location_blocks)],
        ['Gewicht onderbouw (t)', num(p.weight_sub)], ['Gewicht bovenbouw (t)', num(p.weight_top)], ['Productie sinds', str(p.production_start)],
        ['In gebruik sinds', ymd(p.valid_from)], ['Afstand tot de kust (km)', num(p.coast_dist) == null ? null : r1(num(p.coast_dist) / 1000)],
        ['Opmerking', str(p.remarks)], ['OSPAR-id', str(p.platformid)],
      ],
    }));
  }
  return out;
}

// ---------- GEUS (GML 2) ----------

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
function gmlMembers(xml) {
  return [...String(xml || '').matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/g)].map((m) => {
    const o = {};
    for (const t of m[1].matchAll(/<ms:([A-Za-z0-9_]+)>([^<]*)<\/ms:\1>/g)) o[t[1]] = unxml(t[2]).trim();
    const c = /<gml:Point[^>]*>\s*<gml:coordinates>\s*([-\d.]+),([-\d.]+)/.exec(m[1]);
    o._lon = c ? +c[1] : null; o._lat = c ? +c[2] : null;
    return o;
  });
}
const GEUS_TYPE = { process: 'Procesplatform', wellhead: 'Putplatform (wellhead)' };
const FS_TYPE = { helideck: 'helideck', 'highest point': 'hoogste punt', 'unknown highest elevation': 'hoogste punt (onzeker)' };

function parseGeus(platformXml, flightXml) {
  const flight = new Map();
  for (const o of gmlMembers(flightXml)) {
    const k = normName(o.platform_name);
    if (!flight.has(k)) flight.set(k, []);
    flight.get(k).push(o);
  }
  const out = [];
  for (const o of gmlMembers(platformXml)) {
    const lat = o._lat != null ? o._lat : num(o.platform_lat), lon = o._lon != null ? o._lon : num(o.platform_long);
    if (!valid(lat, lon)) continue;
    const fs1 = flight.get(normName(o.platform_name)) || [];
    const deck = fs1.find((x) => x.feature_type === 'helideck');
    let heli = num(o.helideck_elevation);
    if (heli == null && deck) heli = num(deck.elevation);
    let top = num(o.max_elevation);
    const tops = fs1.filter((x) => x.feature_type !== 'helideck').map((x) => num(x.elevation)).filter((v) => v != null);
    if (top == null && tops.length) top = Math.max(...tops);
    const name = str(o.platform_name);
    const kind = /buoy|load|offloading/i.test(`${name} ${o.category_name || ''}`) ? 'other' : /subsea/i.test(o.function_name || '') ? 'subsea' : 'platform';
    out.push(item({
      id: 'geus:' + (str(o.id) || str(o.ospar_id) || name), name, lat, lon, country: 'DK', offshore: true, kind,
      status: normStatus(o.status_name), operator: str(o.operator_name), waterDepthM: num(o.water_depth),
      helideck: heli != null ? true : null, helideckElevationM: heli, src: 'GEUS', srcUrl: 'https://data.geus.dk/geusmap/?mapname=denmark',
      updated: str(o.max_elevation_date) || str(o.helideck_elevation_date),
      fields: [
        ['Type', GEUS_TYPE[o.platform_type_name] || str(o.platform_type_name)], ['Constructie', nl(o.category_name)], ['Functie', nl(o.function_name)],
        ['In gebruik sinds', str(o.start_using_year)], ['Primaire productie', nl(o.primary_production)],
        ['Hoogste punt (m)', top], ['Hoogste punt', str(o.max_elevation_desc)],
        ['Gewicht onderbouw (t)', num(o.weight_substructure)], ['Gewicht bovenbouw (t)', num(o.weight_topside)],
        ['Luchtvaartobstakels', fs1.length ? fs1.map((x) => `${x.description || FS_TYPE[x.feature_type] || x.feature_type} ${String(num(x.elevation)).replace('.', ',')} m`).join('; ') : null],
        ['Opmerking', str(o.ospar_remark)], ['OSPAR-id', str(o.ospar_id)],
      ],
    }));
  }
  return out;
}

// ---------- Sodir ----------

function sodirKind(p) {
  const k = String(p.fclKind || '').toUpperCase();
  if (/ONSHORE|LANDFALL/.test(k)) return 'onshore';
  if (/WIND TURBINE/.test(k)) return 'turbine';
  if (/FPSO|FSU|MOPUSTOR/.test(k)) return 'fpso';
  if (/TEMPLATE|SUBSEA/.test(k) || p.fclSurface === 'N') return 'subsea';
  if (/LOADING/.test(k)) return 'other';
  return 'platform';
}
const cap = (s) => { const v = str(s); return v ? v.charAt(0) + v.slice(1).toLowerCase() : null; };
function parseSodir(features) {
  const out = [];
  for (const f of features || []) {
    const p = f.properties || f.attributes || {};
    if (String(p.fclFixedOrMoveable || '').toUpperCase() !== 'FIXED') continue;
    const [lat, lon] = point(f);
    if (!valid(lat, lon)) continue;
    const kind = sodirKind(p);
    out.push(item({
      id: 'sodir:' + (p.fclNpdidFacility || p.OBJECTID), name: str(p.fclName), lat, lon, country: str(p.fclNationCode2) || 'NO', offshore: kind !== 'onshore', kind,
      status: normStatus(p.fclPhase), operator: str(p.fclCurrentOperatorName), waterDepthM: num(p.fclWaterDepth),
      src: 'Sodir', srcUrl: str(p.fclFactPageUrl) || 'https://factpages.sodir.no', updated: isoDay(num(p.fclDateUpdated)),
      fields: [
        ['Type', cap(p.fclKind)], ['Functies', cap(p.fclFunctions)], ['Hoort bij', str(p.fclBelongsToName) && `${p.fclBelongsToName}${p.fclBelongsToKind ? ` (${String(p.fclBelongsToKind).toLowerCase()})` : ''}`],
        ['Status volgens Sodir', cap(p.fclPhase)], ['In gebruik sinds', isoDay(num(p.fclStartupDate))], ['Ontwerplevensduur (jaar)', num(p.fclDesignLifetime) || null],
        ['Boven water', yesNo(p.fclSurface)], ['Stilgelegd', isoDay(num(p.fclDateShutdown))], ['Verwijderd', isoDay(num(p.fclDateRemoved))],
        ['Sodir-id', p.fclNpdidFacility],
      ],
    }));
  }
  return out;
}

// ---------- NSTA ----------

const NSTA_KIND = { PLATFORM: 'platform', FPSO: 'fpso', FSO: 'fpso', FSU: 'fpso', TERMINAL: 'onshore', BUOY: 'other', 'MONITOR BUOY': 'other', SBM: 'other', 'FLARE STACK': 'other' };
function parseNsta(features) {
  const out = [];
  for (const f of features || []) {
    const p = f.properties || f.attributes || {}, [lat, lon] = point(f);
    if (!valid(lat, lon)) continue;
    const type = String(p.INF_TYPE || '').toUpperCase().trim(), kind = NSTA_KIND[type] || 'other';
    const desc = str(p.DESCRIPTIO);
    out.push(item({
      id: 'nsta:' + (p.LEGACY_ID || p.FEATURE_ID || p.OBJECTID), name: str(p.NAME), lat, lon, country: 'GB', offshore: kind !== 'onshore', kind,
      status: normStatus(p.STATUS), operator: str(p.REP_GROUP), src: 'NSTA', srcUrl: 'https://opendata-nstauthority.hub.arcgis.com', updated: isoDay(num(p.UPD_DATE)),
      fields: [
        ['Type', cap(p.INF_TYPE)], ['Omschrijving', desc && desc !== str(p.NAME) ? desc : null], ['Pijpleidingsysteem', str(p.PIPE_SYS)],
        ['Startdatum', isoDay(num(p.START_DATE))], ['Einddatum', isoDay(num(p.END_DATE))], ['Reden einde', cap(p.END_REAS)],
      ],
    }));
  }
  return out;
}

// ---------- BOEM ----------

const BOEM_TYPE = { CAIS: 'Caisson', FIXED: 'Vast platform', WP: 'Putbeschermer (well protector)', TLP: 'Tension-leg platform', MTLP: 'Mini tension-leg platform', SPAR: 'Spar', MOPU: 'Mobiele productie-eenheid', SEMI: 'Semi-submersible', CT: 'Compliant tower', FPSO: 'FPSO', SSTMP: 'Onderzeese template' };
const BOEM_KIND = { FPSO: 'fpso', SSTMP: 'subsea' };
const QTR = { P: 'permanent', T: 'tijdelijk', Y: 'ja', N: 'nee' };
const cut = (l, start, len) => l.substr(start - 1, len).trim();
const lines = (t) => String(t || '').split(/\r?\n/).filter((l) => l.trim());

// The newest name per company number (rows without an end date first).
function boemCompanies(text) {
  const best = new Map();
  for (const l of lines(text)) {
    const n = l.slice(0, 5), name = cut(l, 14, 100), start = cut(l, 6, 8), ended = !!cut(l, 189, 8);
    if (!/^\d{5}$/.test(n) || !name) continue;
    const score = `${ended ? 0 : 1}${start}`;
    if (!best.has(n) || best.get(n).score < score) best.set(n, { name, score });
  }
  return new Map([...best].map(([k, v]) => [k, v.name]));
}
function parseBoem({ mast, loc, stru, comp }) {
  const companies = boemCompanies(comp);
  const masters = new Map();
  for (const l of lines(mast)) masters.set(cut(l, 1, 8), l);
  const where = new Map();
  for (const l of lines(loc)) where.set(cut(l, 4, 8) + '/' + cut(l, 12, 3), l);
  const out = [];
  for (const l of lines(stru)) {
    if (cut(l, 44, 11)) continue; // removed
    const cx = cut(l, 9, 8), sn = cut(l, 82, 3), w = where.get(cx + '/' + sn);
    if (!w) continue;
    const lat0 = num(cut(w, 100, 13)), lon0 = num(cut(w, 86, 14));
    if (!valid(lat0, lon0)) continue;
    const [lat, lon] = nad27GulfToWgs84(lat0, lon0);
    const m = masters.get(cx) || '';
    const area = cut(l, 1, 2), block = cut(l, 3, 6), sname = cut(l, 67, 15) || cut(w, 23, 15), type = cut(l, 85, 5);
    const heli = m ? cut(m, 48, 1) : '';
    const depthFt = m ? num(cut(m, 51, 5)) : null;
    out.push(item({
      id: `boem:${cx}-${sn}`, name: [area, block, sname].filter(Boolean).join(' '), lat, lon, country: 'US', offshore: true,
      kind: BOEM_KIND[type] || 'platform', status: 'in gebruik', operator: m ? companies.get(cut(m, 21, 5)) || null : null,
      waterDepthM: depthFt == null ? null : depthFt * 0.3048, helideck: heli === 'Y' ? true : heli === 'N' ? false : null,
      src: 'BOEM', srcUrl: 'https://www.data.boem.gov/Platform/PlatformStructures/Default.aspx', updated: dmy(cut(l, 31, 11)),
      fields: [
        ['Type', BOEM_TYPE[type] || type || null], ['Gebied en blok', [area, block].filter(Boolean).join(' ') || null], ['Complex-id', cx], ['Structuurnummer', sn],
        ['Lease', m ? cut(m, 28, 7) || null : null], ['Geïnstalleerd', dmy(cut(l, 20, 11))], ['24 uur bemand', m ? yesNo(cut(m, 26, 1)) : null],
        ['Verblijfsaccommodatie', m ? QTR[cut(m, 63, 1)] || null : null], ['Bedden', m ? num(cut(m, 85, 3)) : null], ['Kranen', m ? num(cut(m, 81, 2)) : null],
        ['Dekken', num(cut(l, 17, 2))], ['Afstand tot de kust (NM)', m ? num(cut(m, 13, 4)) : null],
        ['Gepland voor verwijdering', m && cut(m, 9, 1) === 'Y' ? 'ja' : null],
      ],
    }));
  }
  return out;
}

// ---------- OpenStreetMap ----------

function parseOverpass(json) {
  const out = [];
  for (const e of (json && json.elements) || []) {
    const t = e.tags || {}, lat = num(e.lat != null ? e.lat : e.center && e.center.lat), lon = num(e.lon != null ? e.lon : e.center && e.center.lon);
    if (!valid(lat, lon)) continue;
    const cat = t['seamark:platform:category'] || '';
    const kind = t.power === 'substation' || /substation/i.test(cat) ? 'substation' : /fpso/i.test(cat) ? 'fpso' : 'platform';
    const status = t['disused:man_made'] || t.disused === 'yes' ? 'buiten gebruik' : t.abandoned === 'yes' || t['abandoned:man_made'] ? 'ontmanteld'
      : t.construction || t['construction:man_made'] ? 'gepland' : 'in gebruik';
    const light = t['seamark:light:character'] ? [t['seamark:light:character'], t['seamark:light:group'] && `(${t['seamark:light:group']})`, t['seamark:light:colour'], t['seamark:light:period'] && `${t['seamark:light:period']} s`].filter(Boolean).join(' ') : null;
    out.push(item({
      id: `osm:${e.type}/${e.id}`, name: t.name || t['seamark:name'] || t.ref || null, lat, lon, country: null, offshore: true, kind, status,
      operator: t.operator || null, waterDepthM: num(t.depth), helideck: t.aeroway === 'helipad' || t.icao ? true : null,
      src: 'OSM', srcUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`, updated: null,
      fields: [
        ['Ref', t.ref && t.ref !== t.name ? t.ref : null], ['Categorie', cat || null], ['Product', t.substance || t['seamark:platform:product'] || null],
        ['Veld', t.field_name || null], ['Hoogte (m)', num(t.height)], ['In gebruik sinds', t.start_date || null], ['ICAO', t.icao || null],
        ['Licht', light], ['Spanning (V)', t.voltage || null], ['Wikidata', t.wikidata || null],
      ],
    }));
  }
  return out;
}

// ---------- merging ----------

// A grid of about 1 km for the "is there one near here" questions.
function grid() {
  const cells = new Map();
  const key = (lat, lon) => `${Math.floor(lat * 100)}:${Math.floor(lon * 100)}`;
  return {
    add(x) { const k = key(x.lat, x.lon); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(x); },
    remove(x) { const a = cells.get(key(x.lat, x.lon)); if (a) { const i = a.indexOf(x); if (i >= 0) a.splice(i, 1); } },
    near(lat, lon, m) {
      const out = [], d = Math.ceil(m / 1000) + 1, la = Math.floor(lat * 100), lo = Math.floor(lon * 100);
      for (let i = -d; i <= d; i++) for (let j = -d * 2; j <= d * 2; j++) for (const x of cells.get(`${la + i}:${lo + j}`) || []) { const dm = distM(lat, lon, x.lat, x.lon); if (dm <= m) out.push([x, dm]); }
      return out.sort((a, b) => a[1] - b[1]);
    },
  };
}
const names = (x) => {
  const out = [normName(x.name)];
  for (const [label, v] of x.fields) if (label === 'Code') out.push(normName(v));
  return out.filter((n) => n.length >= 2);
};
// 2: the same name, 1: one name contains the other ("GROVE" in "GROVE PLATFORM"), 0: different.
const nameMatch = (a, b) => {
  const na = names(a), nb = names(b);
  if (na.some((p) => nb.includes(p))) return 2;
  return na.some((p) => nb.some((q) => Math.min(p.length, q.length) >= 4 && (p.includes(q) || q.includes(p)))) ? 1 : 0;
};
// Fills what the winner lacks from the loser, and notes where else it appears.
function absorb(win, lose) {
  for (const k of ['operator', 'waterDepthM', 'helideckElevationM', 'name', 'country']) if (win[k] == null && lose[k] != null) win[k] = lose[k];
  if (win.helideck == null && lose.helideck != null) win.helideck = lose.helideck;
  if (win.status === 'onbekend' && lose.status !== 'onbekend') win.status = lose.status;
  // A value the winner already shows (EMODnet's British "type" is NSTA's type again) is not repeated.
  const have = new Set(win.fields.map((f) => f[0]));
  const shown = new Set([win.name, ...win.fields.map((f) => f[1])].map((v) => String(v).toLowerCase()));
  for (const f of lose.fields) {
    if (have.has(f[0]) || f[0] === 'Code' || f[0] === 'Ook in bron' || shown.has(String(f[1]).toLowerCase())) continue;
    win.fields.push(f); have.add(f[0]);
  }
  const also = win.fields.find((f) => f[0] === 'Ook in bron');
  const tag = `${lose.src} (${lose.id.replace(/^[^:]+:/, '')})`;
  if (also) { if (!also[1].includes(tag)) also[1] += ', ' + tag; } else win.fields.push(['Ook in bron', tag]);
}
const home = (x) => HOME[x.country] === x.src || (x.src === 'RWS' && x.country === 'NL');
const clone = (x) => ({ ...x, fields: x.fields.map((f) => [...f]) });

// All sources into one list: the same structure from two national sources is kept once (the country's
// own source wins), and EMODnet only adds what no national source has; otherwise its attributes are
// merged into the national item. Turbines are never merged.
function mergeAll(bySource) {
  const out = [], idx = grid();
  for (const s of SOURCES) {
    if (s.key === 'emodnet') continue;
    for (const x0 of bySource[s.key] || []) {
      const x = clone(x0);
      if (x.kind === 'turbine') { out.push(x); continue; }
      const hit = idx.near(x.lat, x.lon, 1000).find(([y, d]) => { if (y.src === x.src) return false; const m = nameMatch(x, y); return m === 2 || d < 15 || (m === 1 && d < 150); });
      if (!hit) { out.push(x); idx.add(x); continue; }
      const y = hit[0];
      if (home(x) && !home(y)) { // the newcomer is the country's own source: it takes the place
        absorb(x, y); out[out.indexOf(y)] = x; idx.remove(y); idx.add(x);
      } else absorb(y, x);
    }
  }
  // EMODnet: the same name nearby, else the nearest within 100 m, else a similar name within 500 m.
  // A national item takes the attributes of one EMODnet record at most.
  const taken = new Set();
  for (const e0 of bySource.emodnet || []) {
    const e = clone(e0);
    const near = idx.near(e.lat, e.lon, 3000).filter(([y]) => y.src !== 'EMODnet' && !taken.has(y));
    const hit = near.find(([y]) => nameMatch(e, y) === 2) || near.find(([y, d]) => d < 100 && (y.kind === 'subsea') === (e.kind === 'subsea'))
      || near.find(([y, d]) => d < 500 && nameMatch(e, y) === 1);
    if (hit) { absorb(hit[0], e); taken.add(hit[0]); } else { out.push(e); idx.add(e); }
  }
  // Ids stay unique (EMODnet has a few platforms twice under one id).
  const ids = new Set();
  for (const x of out) { let id = x.id, i = 2; while (ids.has(id)) id = `${x.id}#${i++}`; x.id = id; ids.add(id); }
  return out;
}

// ---------- fetching ----------

const headers = (extra) => ({ 'User-Agent': UA, ...extra });
async function defaultFetchText(url, { timeoutMs = 30000, headers: h = {}, method = 'GET', body } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, body, headers: headers(h), signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(t); }
}
async function defaultFetchBuffer(url, { timeoutMs = 60000, headers: h = {} } = {}) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: headers(h), signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally { clearTimeout(t); }
}
const getText = async (url, timeoutMs = 60000, extra = {}) => bodyOf(await fetchText(url, { timeoutMs, headers: headers(), ...extra }));
async function getJson(url, timeoutMs) {
  const t = await getText(url, timeoutMs);
  try { return JSON.parse(t); } catch { throw new Error('geen geldig antwoord (geen JSON)'); }
}

// A minimal ZIP reader (central directory, stored or deflated entries): name -> Buffer.
function unzip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf || []);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('geen geldig zip-bestand');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('beschadigd zip-bestand');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('beschadigd zip-bestand');
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error(`zip-methode ${method} niet ondersteund`);
    if (data.length !== usize) throw new Error('beschadigd zip-bestand');
    out.set(name, data);
  }
  return out;
}
const zipText = (buf, re) => { for (const [n, d] of unzip(buf)) if (re.test(n)) return d.toString('latin1'); throw new Error('bestand ontbreekt in zip'); };

// ArcGIS pages of at most 1000; stops on a short page.
async function arcgisAll(urlFor, timeoutMs) {
  const all = [];
  for (let page = 0; page < 20; page++) {
    const j = await getJson(urlFor(page * 1000), timeoutMs);
    if (j.error) throw new Error(errText(j.error));
    const f = j.features || [];
    all.push(...f);
    if (f.length < 1000 && !(j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit))) break;
  }
  return all;
}

const FETCH = {
  nlog: async () => parseNlog(await getJson(URLS.nlog, 60000)),
  rws: async () => parseRws(await getJson(URLS.rwsTurbines, 60000)),
  emodnet: async () => parseEmodnet(await getJson(URLS.emodnet, 120000)),
  geus: async () => {
    const [p, f] = await Promise.all([getText(URLS.geusPlatform, 60000), getText(URLS.geusFlight, 60000).catch((err) => { log.warn('platforms', 'GEUS luchtvaartgegevens niet gelezen: ' + errText(err)); return ''; })]);
    return parseGeus(p, f);
  },
  sodir: async () => parseSodir(await arcgisAll(URLS.sodir, 60000)),
  nsta: async () => parseNsta(await arcgisAll(URLS.nsta, 60000)),
  boem: async () => {
    const get = (u) => fetchBuffer(u, { timeoutMs: 120000, headers: headers() });
    const [mast, loc, stru] = await Promise.all([get(URLS.boemMast), get(URLS.boemLoc), get(URLS.boemStru)]);
    const comp = await get(URLS.boemComp).then((b) => zipText(b, /\.(txt|dat)$/i)).catch((err) => { log.warn('platforms', 'BOEM bedrijvenlijst niet gelezen: ' + errText(err)); return ''; });
    return parseBoem({ mast: zipText(mast, /\.dat$/i), loc: zipText(loc, /\.dat$/i), stru: zipText(stru, /\.dat$/i), comp });
  },
};

// ---------- disk cache ----------

const file = (name) => (dir ? path.join(dir, name) : null);
function readJson(name) {
  const f = file(name);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}
function writeJson(name, obj) {
  const f = file(name);
  if (!f) return;
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj), 'utf8');
    fs.renameSync(tmp, f);
  } catch (err) { log.warn('platforms', `${name} niet opgeslagen: ${errText(err)}`); }
}
function loadCache() {
  if (cache) return cache;
  const c = readJson(CACHE);
  cache = c && c.sources && typeof c.sources === 'object' ? c : { version: 1, sources: {} };
  return cache;
}

// ---------- official sources: refresh and list ----------

function due(key, t = now()) {
  const e = cache.sources[key];
  if (!e) return true;
  if (t - (e.triedAt || 0) < RETRY_MS) return false;
  return !e.ok || t - (e.fetchedAt || 0) > MAX_AGE;
}

async function refreshOne(key) {
  if (busy.has(key)) return;
  busy.add(key);
  const prev = cache.sources[key];
  const t = now();
  try {
    const items = await FETCH[key]();
    if (!items.length) throw new Error('geen objecten ontvangen');
    cache.sources[key] = { ok: true, error: null, fetchedAt: t, triedAt: t, count: items.length, items };
    log.info('platforms', `${key}: ${items.length} objecten`);
  } catch (err) {
    cache.sources[key] = { ...(prev || { items: [], count: 0, fetchedAt: null }), ok: false, error: errText(err), triedAt: t };
    log.warn('platforms', `${key} niet bijgewerkt: ${errText(err)}`);
  } finally {
    busy.delete(key);
    merged = null;
    writeJson(CACHE, cache);
  }
}
function refresh(keys) {
  const run = Promise.all(keys.map((k) => refreshOne(k)));
  const tracked = run.finally(() => { if (refreshing === tracked) refreshing = null; });
  refreshing = tracked;
  return run;
}

function view() {
  if (!merged) {
    const by = {};
    for (const s of SOURCES) by[s.key] = (cache.sources[s.key] && cache.sources[s.key].items) || [];
    merged = mergeAll(by);
  }
  const sources = SOURCES.map((s) => {
    const e = cache.sources[s.key];
    return {
      key: s.key, name: s.name, url: s.url, licence: s.licence, count: e ? e.count || 0 : 0, ok: !!(e && e.ok), error: e ? e.error || null : null,
      fetchedAt: e && e.fetchedAt ? new Date(e.fetchedAt).toISOString() : null, busy: busy.has(s.key),
    };
  });
  const times = SOURCES.map((s) => cache.sources[s.key] && cache.sources[s.key].fetchedAt).filter(Boolean);
  return { ok: merged.length > 0, fetchedAt: times.length ? new Date(Math.max(...times)).toISOString() : null, sources, items: merged };
}

async function list({ force = false } = {}) {
  loadCache();
  const keys = SOURCES.map((s) => s.key);
  if (force) {
    if (refreshing) await refreshing;
    await refresh(keys.filter((k) => !busy.has(k)));
    return view();
  }
  const stale = keys.filter((k) => due(k) && !busy.has(k));
  const empty = !keys.some((k) => cache.sources[k] && cache.sources[k].items && cache.sources[k].items.length);
  if (stale.length) {
    const run = refresh(stale).catch(() => {});
    // Nothing on disk yet: wait for the sources, but not forever; the slow ones finish in the background.
    if (empty) await Promise.race([run, new Promise((r) => { const t = setTimeout(r, firstWait); if (t.unref) t.unref(); })]);
  } else if (empty && refreshing) await refreshing;
  return view();
}

// ---------- wind farm areas ----------

async function fetchAreas() {
  const t = now();
  try {
    const [farms, zones] = await Promise.all([getJson(URLS.rwsFarms, 60000), getJson(URLS.rwsZones, 60000)]);
    const a = parseRwsAreas(farms, zones);
    if (!a.farms.length && !a.zones.length) throw new Error('geen gebieden ontvangen');
    areasCache = { ok: true, error: null, fetchedAt: t, triedAt: t, ...a };
  } catch (err) {
    areasCache = { farms: [], zones: [], fetchedAt: null, ...(areasCache || {}), ok: false, error: errText(err), triedAt: t };
    log.warn('platforms', 'windparkgebieden niet bijgewerkt: ' + errText(err));
  }
  writeJson(AREAS, areasCache);
}
async function areas({ force = false } = {}) {
  if (!areasCache) areasCache = readJson(AREAS);
  const t = now(), a = areasCache;
  const stale = !a || (t - (a.triedAt || 0) > RETRY_MS && (!a.ok || t - (a.fetchedAt || 0) > MAX_AGE));
  if (force || stale) {
    if (!areasBusy) areasBusy = fetchAreas().finally(() => { areasBusy = null; });
    if (force || !a || !(a.farms || []).length) await areasBusy;
  }
  const c = areasCache || {};
  return { ok: !!c.ok, error: c.error || null, fetchedAt: c.fetchedAt ? new Date(c.fetchedAt).toISOString() : null, farms: c.farms || [], zones: c.zones || [] };
}

// ---------- OpenStreetMap ----------

const OSM_TAGS = '["man_made"="offshore_platform"]';
const overpassQuery = (bbox) => {
  const b = bbox ? `(${bbox.join(',')})` : '';
  return `[out:json][timeout:${bbox ? 90 : 240}];(node${OSM_TAGS}${b};way${OSM_TAGS}${b};relation${OSM_TAGS}${b};);out center tags;`;
};
// One Overpass request at a time, at least a second apart, trying the next server on any failure.
function overpass(query, timeoutMs) {
  const run = osmChain.then(async () => {
    const wait = osmLast + osmGap - now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    let lastErr = null;
    for (const url of OVERPASS) {
      try {
        osmLast = now();
        const text = bodyOf(await fetchText(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), timeoutMs, headers: headers({ 'Content-Type': 'application/x-www-form-urlencoded' }) }));
        const j = JSON.parse(text);
        if (!Array.isArray(j.elements)) throw new Error('onverwacht antwoord');
        if (j.remark && /error|timed out|runtime/i.test(j.remark)) throw new Error(j.remark);
        return j;
      } catch (err) { lastErr = err; }
    }
    throw new Error('Overpass niet bereikbaar: ' + errText(lastErr));
  });
  osmChain = run.catch(() => {});
  return run;
}
function loadOsm() {
  if (!osmCache) { const c = readJson(OSM_FILE); osmCache = c && c.tiles ? c : { world: null, tiles: {} }; }
  return osmCache;
}
const tileKey = (lat, lon) => `${lat},${lon}`;
function tilesFor([s, w, n, e]) {
  const out = [];
  for (let lat = Math.floor(s / TILE) * TILE; lat < n; lat += TILE) for (let lon = Math.floor(w / TILE) * TILE; lon < e; lon += TILE) out.push([lat, lon]);
  return out;
}

// The whole world in one Overpass query (about 4000 platforms, 30 s, 1 MB), kept for a month.
async function osmWorld({ force = false } = {}) {
  const c = loadOsm();
  const fresh = c.world && now() - c.world.fetchedAt < OSM_TTL;
  if (!force && fresh) return { ok: true, fetchedAt: new Date(c.world.fetchedAt).toISOString(), count: c.world.items.length };
  if (!worldBusy) {
    worldBusy = (async () => {
      try {
        const items = parseOverpass(await overpass(overpassQuery(null), 300000));
        if (!items.length) throw new Error('geen objecten ontvangen');
        c.world = { fetchedAt: now(), items };
        c.tiles = {};
        writeJson(OSM_FILE, c);
        log.info('platforms', `OSM wereld: ${items.length} objecten`);
        return { ok: true, fetchedAt: new Date(c.world.fetchedAt).toISOString(), count: items.length };
      } catch (err) {
        log.warn('platforms', 'OSM wereld niet opgehaald: ' + errText(err));
        return { ok: false, error: errText(err), fetchedAt: c.world ? new Date(c.world.fetchedAt).toISOString() : null, count: c.world ? c.world.items.length : 0 };
      } finally { worldBusy = null; }
    })();
  }
  return worldBusy;
}

// Platforms from OSM in [south, west, north, east], without the ones an official source already has.
async function osm(bbox, { force = false } = {}) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) return { ok: false, error: 'ongeldig gebied', items: [] };
  const s = Math.max(-90, Math.min(bbox[0], bbox[2])), n = Math.min(90, Math.max(bbox[0], bbox[2]));
  const w = Math.max(-180, Math.min(bbox[1], bbox[3])), e = Math.min(180, Math.max(bbox[1], bbox[3]));
  const c = loadOsm();
  const tiles = tilesFor([s, w, n, e]);
  let pool = [], error = null;
  if (c.world && !force) {
    if (now() - c.world.fetchedAt > OSM_TTL) osmWorld().catch(() => {}); // stale: use it, renew in the background
    pool = c.world.items;
  } else if (tiles.length > MAX_TILES) {
    const r = await osmWorld({ force });
    if (!r.ok) error = r.error;
    pool = c.world ? c.world.items : [];
  } else {
    for (const [la, lo] of tiles) {
      const k = tileKey(la, lo), hit = c.tiles[k];
      if (hit && !force && now() - hit.fetchedAt < OSM_TTL) { pool.push(...hit.items); continue; }
      try {
        const items = parseOverpass(await overpass(overpassQuery([la, lo, la + TILE, lo + TILE]), 120000));
        c.tiles[k] = { fetchedAt: now(), items };
        writeJson(OSM_FILE, c);
        pool.push(...items);
      } catch (err) {
        error = errText(err);
        if (hit) pool.push(...hit.items);
      }
    }
  }
  const inBox = pool.filter((x) => x.lat >= s && x.lat <= n && x.lon >= w && x.lon <= e);
  // Leave out what the official sources already show (OSM maps the same platforms, less precisely).
  loadCache();
  const idx = grid();
  for (const x of view().items) if (x.kind !== 'turbine' && x.lat >= s - 0.05 && x.lat <= n + 0.05 && x.lon >= w - 0.1 && x.lon <= e + 0.1) idx.add(x);
  const seen = new Set();
  const items = inBox.filter((x) => { if (seen.has(x.id)) return false; seen.add(x.id); return !idx.near(x.lat, x.lon, NEAR_OFFICIAL_M).length; });
  return { ok: !error, error, items, source: { ...OSM_SOURCE } };
}

// ---------- start ----------

// firstWaitMs and osmGapMs are for the tests.
function start({ dir: d, fetchText: ft, fetchBuffer: fb, log: l, now: n, firstWaitMs = FIRST_WAIT_MS, osmGapMs = OSM_GAP_MS } = {}) {
  dir = d || null;
  fetchText = ft || defaultFetchText;
  fetchBuffer = fb || defaultFetchBuffer;
  if (l) log = l;
  now = n || (() => Date.now());
  firstWait = firstWaitMs; osmGap = osmGapMs;
  cache = null; merged = null; refreshing = null; busy.clear();
  areasCache = null; areasBusy = null;
  osmCache = null; osmChain = Promise.resolve(); osmLast = 0; worldBusy = null;
}

// Waits for whatever is still being fetched (tests, and a clean shutdown).
async function idle() {
  while (refreshing || areasBusy || worldBusy) await Promise.all([refreshing, areasBusy, worldBusy].filter(Boolean)).catch(() => {});
  await osmChain;
}

module.exports = {
  start, list, osm, osmWorld, areas, idle, SOURCES, OSM_SOURCE, URLS,
  // Pure parts, for the tests.
  parseNlog, parseRws, parseRwsAreas, parseEmodnet, parseGeus, parseSodir, parseNsta, parseBoem, boemCompanies, parseOverpass,
  mergeAll, normStatus, normName, ed50ToWgs84, nad27GulfToWgs84, unzip, distM,
};
