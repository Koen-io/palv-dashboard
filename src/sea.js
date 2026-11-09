// Sea state and sea water temperature for the North Sea: the observations of Rijkswaterstaat's measuring
// stations (significant wave height, mean and maximum wave period, wave direction, water and air
// temperature, wind) and, for any point at sea, the wave model of Open-Meteo. The sea state is the
// Douglas scale number for the significant wave height, as used in the maritime and helicopter world.
//
// Pure: fetching is handed in (main/data.js), so the parsing and the scale can be tested on their own.
const RWS_URL = 'https://ddapi20-waterwebservices.rijkswaterstaat.nl/ONLINEWAARNEMINGENSERVICES/OphalenLaatsteWaarnemingen';
const OM_URL = 'https://marine-api.open-meteo.com/v1/marine';

// The stations on the Dutch part of the North Sea that report waves and/or water temperature; the code is
// Rijkswaterstaat's (OphalenCatalogus). Stations that only give wind are left out.
const STATIONS = [
  { code: 'europlatform', name: 'Europlatform', lat: 51.99781, lon: 3.275071 },
  { code: 'k13a.1', name: 'K13a', lat: 53.2155, lon: 3.2217 },
  { code: 'q1.1', name: 'Q1', lat: 52.925335, lon: 4.150361 },
  { code: 'hollandsekust.zuid.alpha', name: 'Hollandse Kust Zuid', lat: 52.232547, lon: 4.19569 },
  { code: 'hollandsekust.noord.alpha', name: 'Hollandse Kust Noord', lat: 52.69777, lon: 4.2935 },
  { code: 'hollandsekust.west.alpha', name: 'Hollandse Kust West', lat: 52.67977, lon: 3.8046 },
  { code: 'hollandsekust.zuid.windparknoord', name: 'HKZ windpark noord', lat: 52.393, lon: 4.056 },
  { code: 'hollandsekust.zuid.windparkzuid', name: 'HKZ windpark zuid', lat: 52.244, lon: 4.0849 },
  { code: 'borsselealpha', name: 'Borssele Alpha', lat: 51.699921, lon: 3.056707 },
  { code: 'buitenbanken.west', name: 'Buitenbanken west', lat: 51.79502, lon: 2.97225 },
  { code: 'f3', name: 'F3', lat: 54.853199, lon: 4.726133 },
  { code: 'f16', name: 'F16', lat: 54.116667, lon: 4.012222 },
  { code: 'j6', name: 'J6', lat: 53.816632, lon: 2.95001 },
  { code: 'l9', name: 'L9', lat: 53.616667, lon: 4.966667 },
  { code: 'k14', name: 'K14', lat: 53.266667, lon: 3.633333 },
  { code: 'a12', name: 'A12', lat: 55.383333, lon: 3.8 },
  { code: 'd15', name: 'D15', lat: 54.325667, lon: 2.93575 },
  { code: 'eierlandsegat', name: 'Eierlandse Gat', lat: 53.2762, lon: 4.660347 },
  { code: 'schiermonnikoog.noord', name: 'Schiermonnikoog noord', lat: 53.594837, lon: 6.165377 },
  { code: 'amelandwestgat', name: 'Ameland Westgat', lat: 53.49164, lon: 5.94114 },
  { code: 'noordwijk.meetpost', name: 'Meetpost Noordwijk', lat: 52.273107, lon: 4.294811 },
  { code: 'ijmuiden.munitiestort.1', name: 'IJmuiden munitiestort', lat: 52.549225, lon: 4.057019 },
  { code: 'goeree.lichteiland', name: 'Lichteiland Goeree', lat: 51.925034, lon: 3.668416 },
  { code: 'texel.lichtschip', name: 'Texel lichtschip', lat: 53.027021, lon: 4.299789 },
];
const STATION_BY_CODE = Object.fromEntries(STATIONS.map((s) => [s.code, s]));
// What is asked, per compartment: surface water (OW) and air (LT).
const QUANTITIES = [['OW', 'Hm0'], ['OW', 'T'], ['OW', 'Tm02'], ['OW', 'Tmax'], ['OW', 'Th0'], ['LT', 'WINDSHD'], ['LT', 'WINDRTG'], ['LT', 'T']];
const MAX_AGE_MS = 3 * 3600e3;

// The Douglas sea state (0–9) for a significant wave height in metres, with the Dutch and English names.
const DOUGLAS = [
  { code: 0, max: 0.05, nl: 'Spiegelglad', en: 'Calm (glassy)' },
  { code: 1, max: 0.1, nl: 'Vlak', en: 'Calm (rippled)' },
  { code: 2, max: 0.5, nl: 'Kalm', en: 'Smooth' },
  { code: 3, max: 1.25, nl: 'Licht', en: 'Slight' },
  { code: 4, max: 2.5, nl: 'Matig', en: 'Moderate' },
  { code: 5, max: 4, nl: 'Ruw', en: 'Rough' },
  { code: 6, max: 6, nl: 'Zeer ruw', en: 'Very rough' },
  { code: 7, max: 9, nl: 'Hoog', en: 'High' },
  { code: 8, max: 14, nl: 'Zeer hoog', en: 'Very high' },
  { code: 9, max: Infinity, nl: 'Buitengewoon', en: 'Phenomenal' },
];
function seaState(hs) {
  if (!Number.isFinite(hs) || hs < 0) return null;
  return DOUGLAS.find((d) => hs < d.max) || DOUGLAS[DOUGLAS.length - 1];
}

const rwsBody = (codes) => JSON.stringify({
  LocatieLijst: codes.map((c) => ({ Code: c })),
  AquoPlusWaarnemingMetadataLijst: QUANTITIES.map(([comp, g]) => ({ AquoMetadata: { Compartiment: { Code: comp }, Grootheid: { Code: g } } })),
});

// The newest usable value per station and quantity out of a Rijkswaterstaat answer. A station may carry
// several series of one quantity (an old buoy, a new sensor): the most recent measurement wins, as long as
// it is not older than MAX_AGE_MS at `now` and not a missing-value marker.
function parseRws(data, now = Date.now()) {
  const out = {};
  if (!data || !Array.isArray(data.WaarnemingenLijst)) return out;
  for (const w of data.WaarnemingenLijst) {
    const code = w.Locatie && w.Locatie.Code, meta = w.AquoMetadata || {};
    const g = meta.Grootheid && meta.Grootheid.Code, comp = meta.Compartiment && meta.Compartiment.Code;
    if (!code || !g) continue;
    for (const m of w.MetingenLijst || []) {
      const t = Date.parse(m.Tijdstip);
      const v = m.Meetwaarde && m.Meetwaarde.Waarde_Numeriek;
      const q = m.WaarnemingMetadata && m.WaarnemingMetadata.Kwaliteitswaardecode;
      if (!Number.isFinite(t) || !Number.isFinite(v) || v <= -999 || v >= 999999 || q === '99' || t > now + 15 * 60000 || now - t > MAX_AGE_MS) continue;
      const key = `${comp}/${g}`;
      const st = out[code] || (out[code] = {});
      if (!st[key] || t > st[key].t) st[key] = { v, t };
    }
  }
  const obs = {};
  for (const [code, st] of Object.entries(out)) {
    const pick = (k) => (st[k] ? st[k].v : null), at = (k) => (st[k] ? st[k].t : null);
    const o = {
      code, name: (STATION_BY_CODE[code] || {}).name || code, lat: (STATION_BY_CODE[code] || {}).lat, lon: (STATION_BY_CODE[code] || {}).lon,
      hs: pick('OW/Hm0') == null ? null : +(pick('OW/Hm0') / 100).toFixed(2), hsAt: at('OW/Hm0'),
      tm02: pick('OW/Tm02'), tmax: pick('OW/Tmax'), dir: pick('OW/Th0'),
      tw: pick('OW/T'), twAt: at('OW/T'), ta: pick('LT/T'),
      windMs: pick('LT/WINDSHD'), windDir: pick('LT/WINDRTG'), windAt: at('LT/WINDSHD'),
    };
    o.at = Math.max(...Object.values(st).map((x) => x.t));
    o.state = o.hs == null ? null : seaState(o.hs).code;
    if (o.hs != null || o.tw != null) obs[code] = o;
  }
  return obs;
}

// Open-Meteo marine: the model values at a point right now (wave height, period, direction, swell, wind
// waves, sea surface temperature). Model data, not a measurement: shown with the nearest stations beside it.
const omUrl = (lat, lon) => `${OM_URL}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,wind_wave_height,sea_surface_temperature&timezone=UTC`;
function parseOm(data) {
  const c = data && data.current;
  if (!c) return null;
  const num = (x) => (Number.isFinite(x) ? x : null);
  const hs = num(c.wave_height);
  return {
    hs, period: num(c.wave_period), dir: num(c.wave_direction), swell: num(c.swell_wave_height), swellPeriod: num(c.swell_wave_period), windWave: num(c.wind_wave_height),
    sst: num(c.sea_surface_temperature), at: Date.parse(c.time + (String(c.time).endsWith('Z') ? '' : 'Z')) || null,
    state: hs == null ? null : seaState(hs).code,
    lat: data.latitude, lon: data.longitude,
  };
}

const distKm = (a, b) => { const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180, s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); };
// The stations with an observation, nearest first, with their distance (km) to a point.
function nearest(obs, lat, lon, n = 3) {
  return Object.values(obs).filter((o) => Number.isFinite(o.lat)).map((o) => ({ ...o, km: distKm({ lat, lon }, o) })).sort((a, b) => a.km - b.km).slice(0, n);
}

/* ---------- the service: fetching with caches ---------- */
let fetchJson = null, log = { info() {}, warn() {} };
let rws = { at: 0, obs: {}, pending: null, error: null };
const points = new Map(); // "lat,lon" -> { at, data }
const RWS_TTL = 5 * 60000, OM_TTL = 10 * 60000;

function start(opts) { fetchJson = opts.fetchJson; if (opts.log) log = opts.log; }

async function observations() {
  if (Date.now() - rws.at < RWS_TTL && Object.keys(rws.obs).length) return rws;
  if (!rws.pending) {
    rws.pending = (async () => {
      try {
        const data = await fetchJson(RWS_URL, { method: 'POST', body: rwsBody(STATIONS.map((s) => s.code)), headers: { 'Content-Type': 'application/json' }, timeoutMs: 30000 });
        const obs = parseRws(data);
        if (!Object.keys(obs).length) throw new Error('geen bruikbare waarnemingen');
        rws = { at: Date.now(), obs, pending: null, error: null, fetchedAt: Date.now() };
      } catch (err) {
        rws = { ...rws, pending: null, error: String((err && err.message) || err), at: Object.keys(rws.obs).length ? rws.at : Date.now() - RWS_TTL + 60000 };
        log.warn('zee', `Rijkswaterstaat: ${rws.error}`);
      }
      return rws;
    })();
  }
  return rws.pending;
}

// Only a rounded point goes out: on a grid of 0.05 degrees (about 5.5 by 3.5 km here), coarser than the wave
// model itself. A tapped ship or spot cannot be told from the others in its square, so Open-Meteo never
// learns which ship or which exact spot was looked at.
const SNAP = 20; // steps per degree
const snap = (v) => Math.round(v * SNAP) / SNAP;
async function point(lat, lon) {
  const sLat = snap(lat), sLon = snap(lon);
  const key = `${sLat.toFixed(2)},${sLon.toFixed(2)}`;
  const hit = points.get(key);
  if (hit && Date.now() - hit.at < OM_TTL) return hit.data;
  const data = parseOm(await fetchJson(omUrl(sLat, sLon), { timeoutMs: 20000 }));
  points.set(key, { at: Date.now(), data });
  if (points.size > 200) points.delete(points.keys().next().value);
  return data;
}

// The whole picture for the header: every station, and the one chosen as the reference.
async function overview(refCode) {
  const r = await observations();
  const list = Object.values(r.obs).sort((a, b) => a.name.localeCompare(b.name));
  const ref = r.obs[refCode] || r.obs.europlatform || list.find((o) => o.hs != null) || null;
  const states = list.map((o) => o.state).filter((s) => s != null);
  return { ok: list.length > 0, error: r.error, fetchedAt: r.fetchedAt || null, stations: list, ref, range: states.length ? [Math.min(...states), Math.max(...states)] : null };
}

// The picture at one point: the model there and the nearest observations.
async function at(lat, lon) {
  const [r, model] = await Promise.all([observations(), point(lat, lon).catch((err) => ({ error: String(err.message || err) }))]);
  return { ok: true, model: model && !model.error ? model : null, modelError: model && model.error ? model.error : null, nearest: nearest(r.obs, lat, lon, 3), fetchedAt: r.fetchedAt || null };
}

module.exports = { snap, STATIONS, DOUGLAS, seaState, parseRws, parseOm, nearest, rwsBody, omUrl, start, observations, point, overview, at, _reset: () => { rws = { at: 0, obs: {}, pending: null, error: null }; points.clear(); } };
