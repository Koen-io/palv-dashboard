// Aviation data for the dashboard: METAR/TAF of one airfield, all stations around the Netherlands for
// the weather radar, live traffic for the Vluchtradar and "In de lucht", and the runways in use.
const { ipcMain } = require('electron');
const runways = require('../runways');
const fleet = require('../fleet');
const traffic = require('../traffic');
const log = require('./log');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const APP_UA = 'P-ALV-Dashboard/1.0 (desktop dashboard)';

async function fetchText(url, timeoutMs = 20000, ua = UA, extra = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua, 'Cache-Control': 'no-cache', ...extra }, signal: ctl.signal });
    if (!res.ok) {
      // A refusal carries how long to wait, when the source says so.
      const err = new Error(`HTTP ${res.status}`);
      const ra = parseInt(res.headers.get('retry-after'), 10);
      if (ra > 0) err.retryAfter = Math.min(ra, 300);
      throw err;
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

ipcMain.handle('data:metar', async (_e, icao) => {
  const id = String(icao || 'EHAM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  try {
    const text = await fetchText(`https://aviationweather.gov/api/data/metar?ids=${id}&format=json&taf=true`);
    const list = text.trim() ? JSON.parse(text) : [];
    if (!list.length) return { ok: false, error: `Geen METAR beschikbaar voor ${id}` };
    const m = list[0];
    return {
      ok: true,
      icao: m.icaoId,
      name: m.name,
      raw: m.rawOb,
      taf: m.rawTaf || null,
      obsTime: m.obsTime ? m.obsTime * 1000 : null,
      fltCat: m.fltCat || null,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Every METAR and TAF in and around the Netherlands in one go, for the station layer on the weather
// radar. The source refreshes once a minute; all widgets share one answer in between.
const WX_BBOX = '50.6,3.0,53.8,7.4';
let wxCache = null, wxPending = null;
async function loadWxMap() {
  const list = async (path) => { const text = await fetchText(`https://aviationweather.gov/api/data/${path}&bbox=${WX_BBOX}&format=json`); return text.trim() ? JSON.parse(text) : []; };
  const [metars, tafs] = await Promise.all([list('metar?hours=2'), list('taf?').catch(() => null)]);
  if (!metars.length) throw new Error('Geen METAR-gegevens ontvangen');
  return {
    ok: true,
    metars: metars.filter((m) => m.rawOb && m.obsTime && m.lat != null).map((m) => ({ icao: m.icaoId, name: m.name, lat: m.lat, lon: m.lon, raw: m.rawOb, obsTime: m.obsTime * 1000 })),
    tafs: (tafs || []).filter((t) => t.rawTAF).map((t) => ({ icao: t.icaoId, raw: t.rawTAF })),
    tafOk: !!tafs,
    fetchedAt: Date.now(),
  };
}
ipcMain.handle('data:wxmap', async () => {
  if (wxCache && Date.now() - wxCache.fetchedAt < 45000) return wxCache;
  if (!wxPending) {
    wxPending = loadWxMap()
      .then((res) => (wxCache = res))
      .catch((err) => ({ ok: false, error: String(err.message || err) }))
      .finally(() => { wxPending = null; });
  }
  return wxPending;
});

// Live traffic for the Vluchtradar and the own aircraft for "In de lucht": one feed, pushed to the
// dashboard after every round. The renderer renews what it watches every few seconds; without that the
// feed goes quiet by itself.
function start(getWin) {
  traffic.start(
    async (url, timeoutMs) => JSON.parse(await fetchText(url, timeoutMs, APP_UA)),
    (snap) => {
      const groups = traffic.hexGroups();
      fleet.ingest(traffic.records(), groups, snap.now);
      snap.fleet = { ok: snap.ok, lastOk: snap.lastOk, startedAt: snap.startedAt, tracked: snap.tracked, src: snap.src, aircraft: fleet.snapshot(groups, snap.now) };
      const win = getWin();
      // The runways in use, read from the same feed while it covers Schiphol.
      if (traffic.covers(52.31, 4.76, 14, snap.now)) runways.ingest(traffic.records(), snap.now);
      if (win && !win.isDestroyed()) win.webContents.send('traffic:update', snap);
    },
    { info: (s, m) => log.info(s, m), warn: (s, m) => log.warn(s, m) }
  );
  fleet.start(async (url) => JSON.parse(await fetchText(url, 10000, UA, { Referer: 'https://globe.adsbexchange.com/' })));
}
ipcMain.handle('traffic:watch', (_e, req) => { traffic.watch(req); return true; });
ipcMain.handle('traffic:route', (_e, hex) => fleet.route(hex).catch(() => []));

// Runways actually in use, observed from live ADS-B traffic around the field.
ipcMain.handle('data:runways', () => {
  runways.start(traffic.request);
  return runways.snapshot();
});

module.exports = { start, fetchText };
