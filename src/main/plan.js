// Zoek & Plan in the main process: every source the tab draws on (wind, airspace, platforms, search,
// weather along the route), the private and shared files, the map tile cache, the exports, and the way
// the screens pass all of that on to each other.
//
// Between the screens:
// - wind: a screen that follows another one for the live traffic (share.js) asks that screen for its wind
//   first, so with several screens Open-Meteo is asked once; when that screen does not answer it asks itself.
// - the private file (unit figures, helidecks, key) and the shared file (routes, favourites): every screen
//   tells a fingerprint of both in its status; a screen that sees a different one fetches the other's file
//   and keeps the newest version of every item (store.js).
const { app, ipcMain, dialog, BrowserWindow, protocol, net } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('./log');
const store = require('../plan/store');
const wind = require('../plan/wind');
const aero = require('../plan/aero');
const platforms = require('../plan/platforms');
const geocode = require('../plan/geocode');

const UA = `P-ALV-Dashboard/${app.getVersion()} (desktop dashboard)`;
const lg = { info: (s, m) => log.info(s, m), warn: (s, m) => log.warn(s, m) };

/* ---------- fetching ---------- */
async function request(url, { method = 'GET', body = null, headers = {}, timeoutMs = 25000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method, body, headers: { 'User-Agent': UA, ...headers }, signal: ctl.signal });
    if (!res.ok) {
      let text = '';
      try { text = (await res.text()).slice(0, 300); } catch { /* none */ }
      const err = new Error(`HTTP ${res.status}${text ? `: ${text}` : ''}`);
      err.status = res.status;
      throw err;
    }
    return res;
  } catch (err) {
    if (err.name === 'AbortError') { const e = new Error('geen antwoord (time-out)'); e.status = 0; throw e; }
    throw err;
  } finally { clearTimeout(timer); }
}
const fetchText = async (url, opts) => (await request(url, opts)).text();
const fetchJson = async (url, opts) => JSON.parse(await fetchText(url, opts));
const fetchBuffer = async (url, opts) => Buffer.from(await (await request(url, opts)).arrayBuffer());

/* ---------- the other screens ---------- */
let screens = null, share = null, getWin = () => null;
const send = (ch, payload) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, payload); };

// Always over TLS with the unit key (screens.js), and only to a screen that proved it holds it.
function peerGet(peer, pathname, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (!peer.secure) return reject(new Error('geen beveiligde verbinding'));
    const req = screens.request(peer, {
      path: pathname, timeout: timeoutMs,
      headers: { 'X-Palv-Screen': JSON.stringify({ id: screens.id(), name: screens.name(), port: screens.port() }) },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; if (buf.length > 3e7) req.destroy(new Error('te groot')); });
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`)); try { resolve(JSON.parse(buf)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('geen antwoord')));
    req.on('error', reject);
  });
}
// The screen this one follows for the live traffic, when there is one.
function leaderPeer() {
  const info = share && share.info();
  if (!info || !info.leader) return null;
  return screens.peers().find((p) => p.id === info.leader.id && p.online) || null;
}
// Only the unit's own screens (peers this screen has found or was given) get the files.
const isPeer = (caller) => !!caller && caller.secure === true && screens.peers().some((p) => p.id === caller.id);

async function syncFiles() {
  const mine = store.digests();
  for (const p of screens.peers()) {
    const theirs = p.online && p.status && p.status.plan;
    if (!theirs || p.status.ephemeral || !p.secure) continue;
    for (const kind of Object.keys(store.KINDS)) {
      if (!theirs[kind] || theirs[kind] === mine[kind]) continue;
      try {
        const data = await peerGet(p, `/api/plan/sync?kind=${kind}`);
        if (store.merge(kind, data)) log.info('plan', `${kind === 'private' ? 'eigen profielen en dekken' : 'routes en favorieten'} bijgewerkt van ${p.name}`);
      } catch (err) { /* that screen is busy or gone; the next round tries again */ }
    }
  }
}

const routes = {
  '/api/plan/sync': (req, res, caller, respond) => {
    const kind = new URL(req.url, 'http://x').searchParams.get('kind');
    if (!isPeer(caller) || !store.KINDS[kind]) return respond(res, 403, 'text/plain', 'Niet toegestaan');
    respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(store.get(kind, { withDeleted: true })));
  },
  // Wind for a screen that follows this one: from the cache, or fetched now on its behalf.
  '/api/plan/wind/grid': async (req, res, caller, respond) => {
    if (!isPeer(caller)) return respond(res, 403, 'text/plain', 'Niet toegestaan');
    try {
      const q = JSON.parse(new URL(req.url, 'http://x').searchParams.get('q') || '{}');
      respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(await wind.grid(q)));
    } catch (err) { respond(res, 400, 'text/plain', String(err.message)); }
  },
  '/api/plan/wind/points': async (req, res, caller, respond) => {
    if (!isPeer(caller)) return respond(res, 403, 'text/plain', 'Niet toegestaan');
    try {
      const q = JSON.parse(new URL(req.url, 'http://x').searchParams.get('q') || '[]');
      respond(res, 200, 'application/json; charset=utf-8', JSON.stringify(await wind.points(Array.isArray(q) ? q.slice(0, 200) : [])));
    } catch (err) { respond(res, 400, 'text/plain', String(err.message)); }
  },
};

// Wind through the screen this one follows when there is one, else straight from Open-Meteo.
async function windVia(kind, q) {
  const lead = leaderPeer();
  if (lead) {
    try {
      const got = await peerGet(lead, `/api/plan/wind/${kind}?q=${encodeURIComponent(JSON.stringify(q))}`, 20000);
      if (kind === 'grid' ? got && got.ok : Array.isArray(got)) return { ...(kind === 'grid' ? got : { list: got }), via: lead.name };
    } catch { /* ask ourselves */ }
  }
  return kind === 'grid' ? wind.grid(q) : { list: await wind.points(q) };
}

/* ---------- weather along a route ---------- */
const wxCache = new Map();
async function wxArea(bbox) {
  const [s, w, n, e] = bbox.map((x) => Math.round(x * 10) / 10);
  const key = [s, w, n, e].join(',');
  const hit = wxCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60000) return hit.data;
  const q = `bbox=${s},${w},${n},${e}&format=json`;
  const [metars, tafs] = await Promise.all([
    fetchJson(`https://aviationweather.gov/api/data/metar?${q}&hours=2`).catch(() => []),
    fetchJson(`https://aviationweather.gov/api/data/taf?${q}`).catch(() => []),
  ]);
  const data = {
    ok: true, fetchedAt: Date.now(),
    metars: (Array.isArray(metars) ? metars : []).filter((m) => m.rawOb && m.lat != null).map((m) => ({ icao: m.icaoId, name: m.name, lat: m.lat, lon: m.lon, raw: m.rawOb, obsTime: m.obsTime * 1000, fltCat: m.fltCat || null })),
    tafs: (Array.isArray(tafs) ? tafs : []).filter((t) => t.rawTAF).map((t) => ({ icao: t.icaoId, raw: t.rawTAF })),
  };
  wxCache.set(key, { at: Date.now(), data });
  if (wxCache.size > 40) wxCache.delete(wxCache.keys().next().value);
  return data;
}
let sigmetCache = null;
async function sigmets() {
  if (sigmetCache && Date.now() - sigmetCache.at < 5 * 60000) return sigmetCache.data;
  const list = await fetchJson('https://aviationweather.gov/api/data/isigmet?format=json');
  const data = (Array.isArray(list) ? list : []).map((s) => ({
    id: `${s.firId || ''}-${s.seriesId || ''}-${s.validTimeFrom || ''}`, fir: s.firId, firName: s.firName, hazard: s.hazard, qualifier: s.qualifier,
    from: s.validTimeFrom * 1000, to: s.validTimeTo * 1000, base: s.base, top: s.top, raw: s.rawSigmet,
    coords: Array.isArray(s.coords) ? s.coords.map((c) => [c.lon, c.lat]) : null,
  }));
  sigmetCache = { at: Date.now(), data };
  return data;
}

/* ---------- map tiles kept on disk ---------- */
// The tab's maps go through palvtile://<source>/<z>/<x>/<y>: every tile seen is kept for 30 days, so an
// area flown before still shows without a connection. OpenStreetMap's tile policy forbids downloading
// areas ahead; for the other sources a bounded area can be saved on purpose (prefetch).
const TILE_SOURCES = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, prefetch: false },
  s2: { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg', max: 15, prefetch: true },
  foto: { url: 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg', max: 19, prefetch: true },
  brt: { url: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png', max: 19, prefetch: true },
  brtgrijs: { url: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/grijs/EPSG:3857/{z}/{x}/{y}.png', max: 19, prefetch: true },
  ofmbase: { url: 'https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.jpg?path=latest/base/latest', max: 12, prefetch: true },
  ofmaero: { url: 'https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest', max: 12, prefetch: true },
  topo: { url: 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png', max: 17, prefetch: false },
  seamark: { url: 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', max: 18, prefetch: false },
};
const TILE_KEEP_MS = 30 * 864e5, TILE_MAX_BYTES = 2.5e9;
let tileDir = null, tileBytes = 0;
const tileFile = (src, z, x, y) => path.join(tileDir, src, String(z), String(x), `${y}.tile`);

async function tile(src, z, x, y) {
  const def = TILE_SOURCES[src];
  if (!def || z > def.max) return null;
  const file = tileFile(src, z, x, y);
  let st = null;
  try { st = fs.statSync(file); } catch { /* not kept */ }
  if (st && Date.now() - st.mtimeMs < TILE_KEEP_MS) return { body: fs.readFileSync(file), cached: true };
  try {
    const url = def.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const res = await net.fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFile(file, body, () => {});
    tileBytes += body.length;
    return { body, type: res.headers.get('content-type') };
  } catch (err) {
    // Offline or refused: an older copy is better than a hole in the map.
    if (st) return { body: fs.readFileSync(file), cached: true, stale: true };
    return null;
  }
}

// Once a day: tiles older than the keeping time go, and the oldest when the cache grows too big.
function pruneTiles() {
  const all = [];
  const walk = (d) => { let list = []; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of list) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { try { const s = fs.statSync(p); all.push({ p, t: s.mtimeMs, n: s.size }); } catch { /* gone */ } } } };
  walk(tileDir);
  all.sort((a, b) => a.t - b.t);
  let total = all.reduce((n, f) => n + f.n, 0), removed = 0;
  for (const f of all) {
    if (Date.now() - f.t < TILE_KEEP_MS && total < TILE_MAX_BYTES) break;
    try { fs.rmSync(f.p); total -= f.n; removed += 1; } catch { /* in use */ }
  }
  tileBytes = total;
  if (removed) log.info('plan', `${removed} oude kaarttegels opgeruimd`);
}

// Saving an area ahead (not for OpenStreetMap): at most 6000 tiles per run, one at a time.
let prefetchRun = null;
async function prefetch({ src, bbox, zMin, zMax }) {
  const def = TILE_SOURCES[src];
  if (!def || !def.prefetch) throw new Error('Deze kaart mag niet vooraf worden opgeslagen');
  const xy = (lat, lon, z) => { const n = 2 ** z, r = (lat * Math.PI) / 180; return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)]; };
  const jobs = [];
  for (let z = Math.max(0, zMin); z <= Math.min(def.max, zMax); z += 1) {
    const [x0, y0] = xy(bbox[2], bbox[1], z), [x1, y1] = xy(bbox[0], bbox[3], z);
    for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) jobs.push([z, x, y]);
  }
  if (jobs.length > 6000) throw new Error(`Te groot gebied (${jobs.length} tegels, max. 6000): zoom verder in of kies minder zoomniveaus`);
  const run = { total: jobs.length, done: 0, failed: 0, stop: false };
  prefetchRun = run;
  (async () => {
    for (const [z, x, y] of jobs) {
      if (run.stop) break;
      const got = await tile(src, z, x, y);
      if (got) run.done += 1; else run.failed += 1;
      if ((run.done + run.failed) % 25 === 0 || run.done + run.failed === run.total) send('plan:prefetch', { ...run });
    }
    send('plan:prefetch', { ...run, finished: true });
  })();
  return { total: jobs.length };
}

/* ---------- exports ---------- */
async function saveFile(title, name, filters, content) {
  const res = await dialog.showSaveDialog(getWin(), { title, defaultPath: name, filters });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, content);
  return res.filePath;
}
// The kneeboard card: an HTML page laid out by the renderer, printed to PDF in a hidden window.
async function printPdf(html, name) {
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, offscreen: true } });
  try {
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const pdf = await w.webContents.printToPDF({ pageSize: 'A5', printBackground: true, margins: { marginType: 'custom', top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 } });
    return saveFile('Kniebordkaart opslaan', name, [{ name: 'PDF', extensions: ['pdf'] }], pdf);
  } finally { w.destroy(); }
}

/* ---------- start ---------- */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'palvtile', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
}

function start(opts) {
  ({ screens, share } = opts);
  getWin = opts.getWin;
  const dir = app.getPath('userData');
  tileDir = path.join(dir, 'plan-tiles');
  store.start({ dir, log: lg });
  // The other screens' own use of Open-Meteo today, as they tell it in their status: one budget for all.
  const today = () => new Date().toISOString().slice(0, 10);
  const others = () => {
    const sum = { day: 0, hour: 0, minute: 0 };
    for (const p of screens.peers()) {
      const w = p.online && p.status && p.status.plan && p.status.plan.wind;
      if (!w || w.d !== today() || p.status.ephemeral) continue;
      sum.day += +w.day || 0; sum.hour += +w.hour || 0; sum.minute += +w.minute || 0;
    }
    return sum;
  };
  wind.start({ dir, fetchJson, log: lg, others });
  aero.start({ dir, fetchJson, log: lg });
  platforms.start({ dir, fetchText, fetchBuffer, log: lg });
  geocode.start({ dir, fetchJson, fetchText, log: lg });
  store.onChange((kind) => send('plan:store', { kind, data: store.get(kind) }));
  // The openAIP key from the private file, when this screen has none of its own yet.
  const keyFromStore = () => {
    const k = store.get('private').keys.openaip;
    if (k && k.value && !aero.status().configured) aero.setKey(k.value).catch((err) => log.warn('plan', 'openAIP-sleutel uit het profielbestand geweigerd', err.message));
  };
  keyFromStore();
  store.onChange((kind) => { if (kind === 'private') keyFromStore(); });

  protocol.handle('palvtile', async (req) => {
    const u = new URL(req.url);
    const [z, x, y] = u.pathname.split('/').filter(Boolean).map(Number);
    const got = await tile(u.hostname, z, x, y);
    if (!got) return new Response('', { status: 404 });
    return new Response(got.body, { status: 200, headers: { 'Content-Type': got.type || 'image/png', 'Cache-Control': 'max-age=86400', 'Access-Control-Allow-Origin': '*' } });
  });
  setTimeout(pruneTiles, 60000);
  setInterval(pruneTiles, 864e5);
  if (!opts.test) setInterval(() => syncFiles().catch(() => {}), 15000);
  return { routes };
}

/* ---------- what the tab asks ---------- */
const safe = (fn) => async (...args) => { try { return await fn(...args); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };

ipcMain.handle('plan:store', () => ({ private: store.get('private'), shared: store.get('shared') }));
ipcMain.handle('plan:put', safe((_e, kind, list, id, item) => store.put(kind, list, id, item)));
ipcMain.handle('plan:importProfiles', safe(async () => {
  const res = await dialog.showOpenDialog(getWin(), { title: 'Profielbestand importeren', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
  const ids = store.importProfiles(JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8')));
  return { ok: true, ids };
}));
ipcMain.handle('plan:exportPrivate', safe(async () => ({ ok: !!(await saveFile('Eigen profielen en dekken exporteren', 'palv-plan-prive.json', [{ name: 'JSON', extensions: ['json'] }], JSON.stringify(store.get('private'), null, 2))) })));

ipcMain.handle('plan:windGrid', safe((_e, q) => windVia('grid', q)));
ipcMain.handle('plan:windPoints', safe((_e, list) => windVia('points', Array.isArray(list) ? list.slice(0, 400) : [])));
ipcMain.handle('plan:windBudget', () => wind.budget());

ipcMain.handle('plan:aero', safe(async (_e, countries) => ({ ...(await aero.data({ countries })), types: aero.TYPES, obstacleTypes: aero.OBSTACLE_TYPES })));
ipcMain.handle('plan:aeroArea', safe((_e, bbox) => aero.area(bbox)));
ipcMain.handle('plan:aeroStatus', () => aero.status());
ipcMain.handle('plan:aeroKey', safe(async (_e, key) => {
  const st = await aero.setKey(String(key || '').trim());
  // Also in the private file, so the other screens of the unit get it too.
  if (st && st.ok) store.put('private', 'keys', 'openaip', { value: String(key).trim() });
  return st;
}));

ipcMain.handle('plan:platforms', safe((_e, opts) => platforms.list(opts || {})));
ipcMain.handle('plan:platformsOsm', safe((_e, bbox) => platforms.osm(bbox)));
ipcMain.handle('plan:platformAreas', safe(() => platforms.areas()));

ipcMain.handle('plan:suggest', safe((_e, q, opts) => geocode.suggest(String(q || '').slice(0, 120), opts || {})));
ipcMain.handle('plan:resolve', safe((_e, id) => geocode.resolve(String(id))));
ipcMain.handle('plan:reverse', safe((_e, lat, lon) => geocode.reverse(+lat, +lon)));
ipcMain.handle('plan:airport', safe((_e, ident) => geocode.airport(String(ident))));

ipcMain.handle('plan:wx', safe((_e, bbox) => wxArea(bbox)));
ipcMain.handle('plan:sigmets', safe(() => sigmets()));

ipcMain.handle('plan:prefetch', safe((_e, q) => prefetch(q)));
ipcMain.handle('plan:prefetchStop', () => { if (prefetchRun) prefetchRun.stop = true; return true; });
ipcMain.handle('plan:tileStats', () => ({ bytes: tileBytes, sources: Object.fromEntries(Object.entries(TILE_SOURCES).map(([k, d]) => [k, { max: d.max, prefetch: d.prefetch }])) }));

ipcMain.handle('plan:saveText', safe(async (_e, { title, name, ext, content }) => ({ ok: !!(await saveFile(title, name, [{ name: ext.toUpperCase(), extensions: [ext] }], String(content))) })));
ipcMain.handle('plan:printPdf', safe(async (_e, { html, name }) => ({ ok: !!(await printPdf(String(html), String(name || 'kniebord.pdf'))) })));

const status = () => ({ ...store.digests(), wind: wind.own() });

module.exports = { start, registerScheme, status, TILE_SOURCES };
