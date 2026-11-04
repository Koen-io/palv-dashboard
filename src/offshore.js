// Offshore tab, main process side: the points along the coast that are not in the platform sources
// (KNRM lifeboat stations, lighthouses, coastguard stations, major lights and harbours) from
// OpenStreetMap through Overpass, kept on disk for 30 days, and the IPC for the AIS register.
const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

const FILE = 'offshore-places.json';
const TTL = 30 * 86400e3;
const BBOX = '50.5,2.3,54.2,7.6';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const QUERY = `[out:json][timeout:90];(
nwr["emergency"="lifeboat_station"](${BBOX});
nwr["amenity"="coast_guard"](${BBOX});
nwr["man_made"="lighthouse"](${BBOX});
node["seamark:type"="light_major"](${BBOX});
nwr["seamark:type"="harbour"]["seamark:harbour:category"~"marina|fishing|ferry|offshore_support|port"](${BBOX});
nwr["amenity"="hospital"]["emergency"="yes"](${BBOX});
nwr["aeroway"="helipad"](${BBOX});
);out center tags;`;

let dir = null, fetchText = null, log = { info() {}, warn() {} }, ais = null;
let cache = null, busy = null;

function kindOf(t) {
  if (t.emergency === 'lifeboat_station') return 'lifeboat';
  if (t.amenity === 'coast_guard') return 'coastguard';
  if (t.man_made === 'lighthouse' || t['seamark:type'] === 'light_major') return 'lighthouse';
  if (t['seamark:type'] === 'harbour') return 'harbour';
  if (t.amenity === 'hospital') return 'hospital';
  if (t.aeroway === 'helipad') return 'helipad';
  return null;
}
function load() {
  try { const d = JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')); if (d && Array.isArray(d.items)) cache = d; } catch { /* none */ }
}
async function refresh() {
  for (const url of OVERPASS) {
    try {
      const text = await fetchText(`${url}?data=${encodeURIComponent(QUERY)}`, { timeoutMs: 120000 });
      const json = JSON.parse(text);
      const items = [];
      for (const e of json.elements || []) {
        const t = e.tags || {};
        const kind = kindOf(t);
        const lat = e.lat ?? (e.center && e.center.lat), lon = e.lon ?? (e.center && e.center.lon);
        if (!kind || lat == null) continue;
        items.push({ id: `${e.type[0]}${e.id}`, kind, lat, lon, name: t.name || t['seamark:name'] || t.operator || null, operator: t.operator || null, phone: t.phone || t['contact:phone'] || null, website: t.website || null, height: t.height || t['seamark:light:height'] || null, light: t['seamark:light:character'] || (t['seamark:light:1:character'] ? `${t['seamark:light:1:character']} ${t['seamark:light:1:colour'] || ''}`.trim() : null) || null, range: t['seamark:light:range'] || t['seamark:light:1:range'] || null, category: t['seamark:harbour:category'] || null });
      }
      cache = { items, fetchedAt: Date.now(), src: url };
      fs.writeFileSync(path.join(dir, FILE), JSON.stringify(cache), 'utf8');
      log.info('offshore', `${items.length} kustpunten van OpenStreetMap`);
      return cache;
    } catch (err) { log.warn('offshore', `${url}: ${err.message}`); }
  }
  throw new Error('Overpass niet bereikbaar');
}
async function places(force) {
  if (!force && cache && Date.now() - cache.fetchedAt < TTL) return { ok: true, ...cache };
  if (!busy) busy = refresh().finally(() => { busy = null; });
  try { return { ok: true, ...(await busy) }; } catch (err) { return cache ? { ok: true, ...cache, stale: true, error: err.message } : { ok: false, error: err.message }; }
}

function start(opts) {
  ({ dir, fetchText, ais } = opts);
  if (opts.log) log = opts.log;
  load();
  const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  ipcMain.handle('offshore:places', safe((_e, force) => places(!!force)));
  ipcMain.handle('ais:snap', (_e, since) => ais.snapshot(Math.max(0, +since || 0)));
  ipcMain.handle('ais:status', () => ais.status());
  ipcMain.handle('ais:track', (_e, mmsi) => ais.track(String(mmsi || '')));
  ipcMain.handle('ais:photo', safe((_e, q) => ais.photo(q && typeof q === 'object' ? q : {})));
  ipcMain.handle('ais:setKey', safe(async (_e, k) => {
    const v = String(k || '').trim();
    // In the unit's private file, like the openAIP key: the other screens of the unit get it too.
    opts.store.put('private', 'keys', 'aisstream', v ? { value: v } : null);
    opts.poke();
    return ais.setKey(v);
  }));
}

module.exports = { start, places };
