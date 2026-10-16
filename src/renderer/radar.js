'use strict';

/* ============================================================
   Vluchtradar — the dashboard's own map of the live traffic
   ============================================================ */
// Map tiles through Leaflet; the aircraft, their labels and routes are drawn on one canvas over it
// from the feed the main process pushes every second (traffic.js). Between two messages an aircraft is
// carried forward along its track at its ground speed, for at most a few seconds, so it stands where it
// is now rather than where it was when the message went out.
// Uses the helpers of app.js (h, icon, clamp, ...) at run time; this file only defines.

const VR_EXTRAP_S = 4;          // carry an aircraft forward along its track at most this long
const VR_FADE_S = 20;           // position older than this: drawn faded
const VR_HIDE_S = 60;           // position older than this: not drawn
// From the OpenSky reserve positions come every 5 to 30 s: carried forward and drawn in full for longer.
const VR_EXTRAP_RESERVE_S = 20, VR_FADE_RESERVE_S = 35;
const vrFade = (a) => (a.src === 'OpenSky' ? VR_FADE_RESERVE_S : VR_FADE_S);
// Redraw interval while on screen. Over the whole country an airliner moves less than a pixel a second,
// so then once a second (with every new round) is enough; zoomed in on a helicopter up to ten times.
const vrFrameMs = (zoom) => clamp(Math.round(250 * 2 ** (11 - zoom)), 100, 1000);
const VR_TRAIL_MIN = 15;        // minutes of route kept for other traffic
const VR_SCHIPHOL = [52.3086, 4.7639];
const VR_NL = [[50.6, 3.0], [53.7, 7.4]];

/* ---------- maps ---------- */
// Every base map has a day and a night face. `mode` auto follows the dashboard's theme: when that turns
// dark, the night face fades in over the day face (or the day face dims) in a few seconds, at the same
// moment as the rest of the screen. OpenStreetMap's night face is the same tiles inverted into a dark
// map, so the switch costs no extra downloads.
const T = {
  osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, attr: '© <b>OpenStreetMap</b>-bijdragers' },
  s2: { url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2023_3857/default/g/{z}/{y}/{x}.jpg', max: 15, attr: 'Sentinel-2 cloudless 2023 © EOX (Copernicus)' },
  // PDOK delivers plain white tiles over sea; those are made see-through so the satellite image shows.
  foto: { url: 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg', max: 19, bounds: VR_NL, minZoom: 8, keyWhite: true, attr: '© Beeldmateriaal Nederland / PDOK' },
  brt: { url: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png', max: 19, bounds: VR_NL, attr: '© Kadaster / PDOK' },
};
const VR_BASES = {
  osm: { name: 'OpenStreetMap · volgt thema (dag/nacht)', under: null, day: T.osm, night: T.osm, invert: true, mode: 'auto' },
  osmLight: { name: 'OpenStreetMap licht', day: T.osm, mode: 'day' },
  osmDark: { name: 'OpenStreetMap donker', night: T.osm, invert: true, mode: 'night' },
  sat: { name: 'Satelliet + luchtfoto NL', under: T.s2, day: T.foto, dim: true, mode: 'auto', dark: true },
  brt: { name: 'Topografisch NL (PDOK)', under: T.osm, day: T.brt, dim: true, mode: 'auto' },
};
const VR_BASE_ALIAS = { cartoDark: 'osmDark', cartoLight: 'osmLight', carto: 'osm', foto: 'sat' }; // choices of 1.12
const vrBase = (key) => VR_BASES[VR_BASE_ALIAS[key] || key] || VR_BASES.osm;
const VR_OVERLAYS = {
  aero: { name: 'Luchtruim (VFR-kaart)', hint: 'CTR\'s, TMA\'s, verboden en beperkte gebieden van openFlightMaps' },
  wx: { name: 'Neerslagradar', hint: 'RainViewer, elke 10 minuten een nieuw beeld' },
  rings: { name: 'Afstandsringen Schiphol', hint: 'Elke 10 NM rond Schiphol' },
  legend: { name: 'Hoogtelegenda', hint: 'Kleur van de toestellen naar hoogte' },
};
const VR_SYMBOLS = {
  silhouet: { name: 'Silhouet per type', hint: 'Zoals ADS-B Exchange: vorm per toesteltype, kleur naar hoogte, donkere rand' },
  contrast: { name: 'Hoog contrast', hint: 'Witte rand en schaduw: het best zichtbaar op satelliet en donkere kaarten' },
  stip: { name: 'Radarstip met koerslijn', hint: 'Compact, zoals een radarscherm; rustig bij veel verkeer' },
};
const VR_SIZES = [{ v: 0.85, name: 'Klein' }, { v: 1, name: 'Normaal' }, { v: 1.2, name: 'Groot' }];

const VR_CATS = [
  { value: 'all', label: 'Alles', title: 'Al het vliegverkeer' },
  { value: 'mil', label: 'Militair', title: 'Militair vliegverkeer' },
  { value: 'police', label: 'Politie', title: 'Politiehelikopters (lijst onder Instellingen › Eigen eenheden)' },
  { value: 'hems', label: 'Trauma', title: 'Trauma- en ambulancehelikopters (lijst onder Instellingen › Eigen eenheden)' },
  { value: 'coastguard', label: 'Kustwacht', title: 'Kustwacht: vliegtuigen en SAR-helikopters (lijst onder Instellingen › Eigen eenheden)' },
];
const VR_GROUP_COLOR = { police: '#3d9bff', hems: '#ff4b55', coastguard: '#ffa21f' };

/* ---------- colours by altitude, after ADS-B Exchange / tar1090 ---------- */
const VR_HUE = [[0, 20], [2000, 32.5], [4000, 43], [6000, 54], [8000, 72], [9000, 85], [11000, 140], [40000, 300]];
const VR_LIGHT = [[0, 53], [20, 50], [32, 54], [40, 52], [46, 51], [50, 46], [60, 43], [80, 41], [140, 41], [180, 40], [190, 44], [198, 50], [200, 58], [255, 55], [280, 58], [290, 47], [300, 43], [360, 53]];
const vrLerp = (table, v) => {
  if (v <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i += 1) {
    const [x1, y1] = table[i], [x0, y0] = table[i - 1];
    if (v <= x1) return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0);
  }
  return table[table.length - 1][1];
};
// Rounded to steps no eye can tell apart, so symbols of the same colour share one drawing.
const vrAltColor = (alt) => {
  if (alt === 'ground') return '#8a8f98';
  if (typeof alt !== 'number') return '#a7b0bd';
  const a = Math.max(0, alt < 2000 ? Math.round(alt / 100) * 100 : Math.round(alt / 250) * 250);
  const hue = vrLerp(VR_HUE, a);
  return `hsl(${hue.toFixed(0)},88%,${vrLerp(VR_LIGHT, hue).toFixed(0)}%)`;
};

/* ---------- symbols ---------- */
// Top views, nose up, about 30 units across for an airliner. Each class keeps its own outline, so a
// helicopter, a light aircraft and a jet can be told apart at a glance.
const VR_SHAPES = {
  airliner: { s: 1, p: 'M0-15C1.4-15 2-13.5 2-11.5V-4L14 3V5.5L2 2V9.5L6 12.5V14.5L0 13-6 14.5V12.5L-2 9.5V2L-14 5.5V3L-2-4V-11.5C-2-13.5-1.4-15 0-15ZM5.3-1.6H7.6V2.6H5.3ZM-7.6-1.6H-5.3V2.6H-7.6Z' },
  heavy: { s: 1.2, p: 'M0-15C1.6-15 2.3-13.5 2.3-11V-4.5L14.5 3.5V5.8L2.3 2.3V9.5L6.5 12.6V14.6L0 13.2-6.5 14.6V12.6L-2.3 9.5V2.3L-14.5 5.8V3.5L-2.3-4.5V-11C-2.3-13.5-1.6-15 0-15ZM5-1.9H7.4V2.5H5ZM-7.4-1.9H-5V2.5H-7.4ZM9.3 0.6H11.4V4.6H9.3ZM-11.4 0.6H-9.3V4.6H-11.4Z' },
  bizjet: { s: 0.85, p: 'M0-14C1-14 1.6-12.5 1.6-10V-2L10 4V5.5L1.6 3V8H2.9V11H1.6L5 13.5V15L0 14-5 15V13.5L-1.6 11H-2.9V8H-1.6V3L-10 5.5V4L-1.6-2V-10C-1.6-12.5-1-14 0-14Z' },
  turboprop: { s: 0.9, p: 'M0-13C1.3-13 1.7-11.5 1.7-9V-4.5H15V-1.6L1.7-1V8L6 8.6V11L0.8 11.3 0 12.5-0.8 11.3-6 11V8.6L-1.7 8V-1L-15-1.6V-4.5H-1.7V-9C-1.7-11.5-1.3-13 0-13ZM4.2-8H6.6V0.5H4.2ZM-6.6-8H-4.2V0.5H-6.6Z' },
  light: { s: 0.78, p: 'M0-13C1.2-13 1.5-11.5 1.5-9V-6H13V-3H1.5L1 7 5.5 7.5V10H0.6L0 11-0.6 10H-5.5V7.5L-1 7-1.5-3H-13V-6H-1.5V-9C-1.5-11.5-1.2-13 0-13Z' },
  fastjet: { s: 0.85, p: 'M0-15C0.9-15 1.4-12 1.6-9L2-3 11 8V10L2.5 9 3 12.5 6 14.5V15.5L0 14.5-6 15.5V14.5L-3 12.5-2.5 9-11 10V8L-2-3-1.6-9C-1.4-12-0.9-15 0-15Z' },
  heli: { s: 0.95, p: 'M0-9C2.8-9 4-6.5 4-3 4 0.5 2.8 3 1.3 4L0.9 12.6H4.2V14.6H-4.2V12.6H-0.9L-1.3 4C-2.8 3-4 0.5-4-3-4-6.5-2.8-9 0-9ZM-11.3-10.3-10.3-11.3 11.3 10.3 10.3 11.3ZM10.3-11.3 11.3-10.3-10.3 11.3-11.3 10.3Z' },
};
for (const s of Object.values(VR_SHAPES)) s.path = new Path2D(s.p);
const VR_HELI_TYPES = /^(EC\d\d|AS\d\d|AS3B|H1\d\d|H160|H175|H47|H53|H60|H64|H500|A1\d\d|B06|B4\d\d|R22|R44|R66|S61|S76|S92|NH90|LYNX|PUMA|TIGR|EH10|BK17|MI8|MI17|UH1|AW09|MD52|MD60|G2CA|CABR|EXPL)$/i;
const VR_PROP_TYPES = /^(DH8|AT4|AT7|DO28|D228|D328|B350|BE20|BE9|BE30|C12|F50|JS3|JS4|SF34|SW4|PC12|C208|BN2|L410|P180|C130|A400|E120|AN26|AN32|P3|P8X|PC6|KODI|TBM)/i;
// In distress: a squawk 7500/7600/7700 that the emergency watch has confirmed (squawk.js), so a single
// garbled message never turns an aircraft red.
const vrAlert = (a) => emergency.watch.isConfirmed(a.hex);
const vrIsHeli = (a) => a.cat === 'A7' || VR_HELI_TYPES.test(a.type || '');
function vrShape(a) {
  if (vrIsHeli(a)) return 'heli';
  if (a.cat === 'A6') return 'fastjet';
  if (VR_PROP_TYPES.test(a.type || '')) return 'turboprop';
  if (a.cat === 'A5') return 'heavy';
  if (a.cat === 'A1' || a.cat === 'B1' || a.cat === 'B4') return 'light';
  if (a.cat === 'A2') return 'bizjet';
  return 'airliner';
}

// Every symbol is drawn once into a small image (per shape, colour, style and size) and then only placed
// and turned: far less work per frame than drawing each outline anew, and it allows a soft shadow.
const vrSprites = new Map();
function vrSprite(shape, fill, style, px, own, dpr) {
  const key = `${shape}|${fill}|${style}|${px.toFixed(1)}|${own ? 1 : 0}|${dpr}`;
  let sp = vrSprites.get(key);
  if (sp) return sp;
  if (vrSprites.size > 2500) vrSprites.clear();
  const def = VR_SHAPES[shape];
  const k = px / 30; // css pixels per shape unit
  const size = Math.ceil(36 * k + 10);
  const c = document.createElement('canvas');
  c.width = c.height = Math.ceil(size * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  g.translate(size / 2, size / 2);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  if (style === 'stip') {
    const r = own ? 5.6 : 4.4;
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(5,8,14,0.95)';
    g.beginPath(); g.moveTo(0, -r); g.lineTo(0, -r - 9); g.stroke();
    g.lineWidth = 1.4;
    g.strokeStyle = own ? '#ffffff' : fill;
    g.beginPath(); g.moveTo(0, -r); g.lineTo(0, -r - 8.5); g.stroke();
    g.beginPath();
    if (shape === 'heli') g.rect(-r, -r, r * 2, r * 2); else g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = own ? 2 : 1.4;
    g.strokeStyle = own ? '#ffffff' : 'rgba(5,8,14,0.95)';
    g.stroke();
  } else {
    g.scale(k, k);
    const px1 = 1 / k; // one css pixel in shape units
    if (style === 'contrast' || own) {
      g.shadowColor = 'rgba(0,0,0,0.75)';
      g.shadowBlur = 4 * dpr;
    }
    // The outline goes under the fill, so it widens the shape instead of eating into it.
    if (own) {
      g.lineWidth = 5 * px1; g.strokeStyle = 'rgba(5,8,14,0.9)'; g.stroke(def.path);
      g.shadowBlur = 0;
      g.lineWidth = 2.8 * px1; g.strokeStyle = '#ffffff'; g.stroke(def.path);
    } else if (style === 'contrast') {
      g.lineWidth = 3 * px1; g.strokeStyle = '#ffffff'; g.stroke(def.path);
      g.shadowBlur = 0;
    } else {
      g.lineWidth = 2.6 * px1; g.strokeStyle = 'rgba(5,8,14,0.92)'; g.stroke(def.path);
    }
    g.fillStyle = fill;
    g.fill(def.path);
  }
  sp = { c, size };
  vrSprites.set(key, sp);
  return sp;
}

/* ---------- projection (Web Mercator, as Leaflet's EPSG:3857 at 256 px tiles) ---------- */
const vrProj = (lat, lon, zoom) => {
  const s = 256 * 2 ** zoom, r = (clamp(lat, -85.05, 85.05) * Math.PI) / 180;
  return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
};

// Where an aircraft is now: its last position, carried forward along its track for at most a few seconds.
function vrNow(a, now) {
  if (a.lat == null) return null;
  const dt = Math.min(a.src === 'OpenSky' ? VR_EXTRAP_RESERVE_S : VR_EXTRAP_S, (now - a.posAt) / 1000);
  if (a.alt === 'ground' || !(a.gs > 3) || a.track == null || dt <= 0) return [a.lat, a.lon];
  const nm = (a.gs * dt) / 3600, tr = (a.track * Math.PI) / 180;
  return [a.lat + (nm * Math.cos(tr)) / 60, a.lon + (nm * Math.sin(tr)) / (60 * Math.cos((a.lat * Math.PI) / 180))];
}

const vrCats = (cfg) => (cfg.cats && cfg.cats.length ? cfg.cats : ['all']);
const vrMatch = (a, cats) => cats.includes('all') || cats.includes(a.group) || (cats.includes('mil') && a.mil);
const vrAltText = (a) => (a.alt === 'ground' ? 'GND' : typeof a.alt === 'number' ? `${a.alt.toLocaleString('nl-NL')} ft` : '— ft');
const vrClimb = (vs) => (vs == null || Math.abs(vs) < 300 ? '' : vs > 0 ? '▲' : '▼');

/* ---------- routes, shared by every radar on the dashboard ---------- */
// hex -> [[time ms, lat, lon, alt], ...]: what this dashboard saw; for the own aircraft completed with the
// route of the current flight from ADS-B Exchange.
const vrTrails = new Map();
const vrRouteAsk = new Map(); // hex -> { at, tries }

function vrRecord(snap) {
  const now = snap.now, live = new Set();
  for (const a of snap.ac) {
    if (a.lat == null) continue;
    live.add(a.hex);
    let t = vrTrails.get(a.hex);
    // Own aircraft on the ground: the route belongs to a flight that is over.
    if (a.group && a.alt === 'ground') { vrTrails.delete(a.hex); vrRouteAsk.delete(a.hex); continue; }
    if (!t) vrTrails.set(a.hex, (t = []));
    const last = t[t.length - 1];
    const alt = typeof a.alt === 'number' ? a.alt : null;
    if (!last || (a.posAt > last[0] && (a.posAt - last[0] >= 4000 || Math.hypot(a.lat - last[1], a.lon - last[2]) > 0.004))) t.push([a.posAt, a.lat, a.lon, alt]);
    const keep = now - (a.group ? 10 * 3600e3 : VR_TRAIL_MIN * 60000);
    let cut = 0;
    while (cut < t.length - 1 && t[cut][0] < keep) cut += 1;
    if (cut) t.splice(0, cut);
    if (a.group && typeof a.alt === 'number') vrAskRoute(a.hex, now);
  }
  for (const hex of vrTrails.keys()) if (!live.has(hex)) vrTrails.delete(hex);
}

// The flown route of an own aircraft, once per flight; again a little later while ADS-B Exchange has no
// route for it yet (just taken off).
function vrAskRoute(hex, now) {
  const ask = vrRouteAsk.get(hex) || { at: 0, tries: 0, done: false };
  if (ask.done || ask.busy || ask.tries >= 4 || now - ask.at < 90000) return;
  Object.assign(ask, { at: now, busy: true, tries: ask.tries + 1 });
  vrRouteAsk.set(hex, ask);
  window.palv.traffic.route(hex).then((pts) => {
    ask.busy = false;
    if (!Array.isArray(pts) || !pts.length) return;
    ask.done = true;
    const t = vrTrails.get(hex) || [];
    const first = t.length ? t[0][0] : Infinity;
    vrTrails.set(hex, [...pts.filter((p) => p[0] < first - 1000 && p[1] != null), ...t]);
  }).catch(() => { ask.busy = false; });
}

/* ---------- neerslagradar (RainViewer) ---------- */
const vrRain = { url: null, at: 0, busy: false };
async function vrRainUrl() {
  if (vrRain.busy || Date.now() - vrRain.at < 5 * 60000) return vrRain.url;
  vrRain.busy = true;
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', { cache: 'no-store' });
    const maps = await res.json();
    const past = maps.radar && maps.radar.past;
    if (past && past.length) vrRain.url = `${maps.host}${past[past.length - 1].path}/256/{z}/{x}/{y}/2/1_1.png`;
    vrRain.at = Date.now();
  } catch { vrRain.at = Date.now() - 4 * 60000; }
  vrRain.busy = false;
  return vrRain.url;
}

/* ---------- tiles with their white made see-through ---------- */
// Each tile is drawn into a canvas and its (near) white pixels are cleared; the layer underneath shows there.
let VrKeyed = null;
function vrKeyedTiles(url, opts) {
  if (!VrKeyed) {
    VrKeyed = L.TileLayer.extend({
      createTile(coords, done) {
        const c = document.createElement('canvas');
        c.width = c.height = 256;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(img, 0, 0, 256, 256);
            const d = g.getImageData(0, 0, 256, 256), px = d.data;
            let cleared = 0;
            for (let i = 0; i < px.length; i += 4) { const lo = Math.min(px[i], px[i + 1], px[i + 2]); if (lo > 232 && Math.max(px[i], px[i + 1], px[i + 2]) - lo < 14) { px[i + 3] = 0; cleared += 1; } }
            if (cleared) g.putImageData(d, 0, 0);
          } catch { /* not readable: shown as it is */ }
          done(null, c);
        };
        img.onerror = (e) => done(e, c);
        img.src = this.getTileUrl(coords);
        return c;
      },
    });
  }
  return new VrKeyed(url, opts);
}

/* ---------- the map ---------- */
function vrCreate(body, w) {
  const el = h('div', { class: 'vr-map no-fade' });
  body.append(el);
  const map = L.map(el, {
    zoomControl: false, attributionControl: true, zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    minZoom: 4, maxZoom: 17, worldCopyJump: false, fadeAnimation: true, inertia: true, boxZoom: false,
  });
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Inzoomen', zoomOutTitle: 'Uitzoomen' }).addTo(map);
  for (const [name, z] of [['vrUnder', 190], ['vrBase', 200], ['vrNight', 210], ['vrAero', 350], ['vrWx', 360]]) {
    map.createPane(name).style.zIndex = z;
    map.getPane(name).style.pointerEvents = 'none';
  }

  /* layers */
  const layers = { under: null, day: null, night: null, aero: null, wx: null };
  let baseKey = null, settle = null;
  const tile = (def, pane, extra = {}) => (def.keyWhite ? vrKeyedTiles : L.tileLayer)(def.url, {
    subdomains: def.sub || 'abc', maxNativeZoom: def.max, minZoom: def.minZoom || 0, maxZoom: 17, bounds: def.bounds, pane,
    attribution: def.attr, updateWhenIdle: false, keepBuffer: 3, ...extra,
  });
  const drop = (k) => { if (layers[k]) { layers[k].remove(); layers[k] = null; } };
  const isDark = () => document.documentElement.dataset.theme === 'dark';
  // Day or night face of the current map; the panes fade between them (styles.css).
  function paintNight() {
    const b = vrBase(w.cfg.base);
    const night = b.mode === 'night' || (b.mode === 'auto' && isDark());
    el.classList.toggle('night', night);
    el.classList.toggle('night-invert', !!b.invert);
    el.classList.toggle('night-dim', !!b.dim);
    el.classList.toggle('base-dark', !!b.dark || night);
    // Once the night face covers the map, the day face underneath rests: no light tiles flashing up while
    // the dark ones load during a pan.
    clearTimeout(settle);
    if (!night || !b.night) el.classList.remove('settled');
    else settle = setTimeout(() => el.classList.add('settled'), el.classList.contains('no-fade') ? 0 : 4200);
  }
  function applyLayers() {
    const key = VR_BASE_ALIAS[w.cfg.base] || w.cfg.base || 'osm';
    if (key !== baseKey) {
      baseKey = key;
      const b = vrBase(key);
      for (const k of ['under', 'day', 'night']) drop(k);
      if (b.under) layers.under = tile(b.under, 'vrUnder').addTo(map);
      if (b.day) layers.day = tile(b.day, 'vrBase').addTo(map);
      if (b.night) layers.night = tile(b.night, 'vrNight', b.day && b.night.url === b.day.url ? { attribution: '' } : {}).addTo(map);
    }
    const on = (k) => (w.cfg.overlays || []).includes(k);
    if (on('aero') && !layers.aero) layers.aero = L.tileLayer('https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest', { pane: 'vrAero', maxNativeZoom: 12, maxZoom: 17, opacity: 0.8, attribution: '© openFlightMaps' }).addTo(map);
    if (!on('aero')) drop('aero');
    if (!on('wx')) drop('wx');
    else refreshRain();
    legend.hidden = !on('legend');
    paintNight();
  }
  async function refreshRain() {
    const url = await vrRainUrl();
    if (!url || !(w.cfg.overlays || []).includes('wx')) return;
    if (layers.wx && layers.wx._url === url) return;
    const next = L.tileLayer(url, { pane: 'vrWx', maxNativeZoom: 7, maxZoom: 17, opacity: 0.6, attribution: '© RainViewer' }).addTo(map);
    if (layers.wx) { const old = layers.wx; next.once('load', () => old.remove()); setTimeout(() => old.remove(), 8000); }
    layers.wx = next;
  }
  // The theme turns: start the fade at that very moment rather than at the next round.
  const themeWatch = new MutationObserver(() => { paintNight(); metrics(); });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  // The first look is set without a fade; from then on every change fades.
  setTimeout(() => el.classList.remove('no-fade'), 1500);

  /* scale bar in nautical miles, altitude legend, status, card of the selected aircraft */
  const scale = h('div', { class: 'vr-scale' }, h('i'), h('span'));
  const legend = h('div', { class: 'vr-legend', title: 'Kleur van de toestellen naar barometrische hoogte, zoals op ADS-B Exchange. Eigen eenheden hebben hun eigen kleur.' },
    h('div', { class: 'vr-legend-bar', style: `background:linear-gradient(90deg,${[0, 500, 1000, 2000, 4000, 6000, 8000, 10000, 20000, 30000, 40000].map((a, i, all) => `${vrAltColor(a)} ${((i / (all.length - 1)) * 100).toFixed(0)}%`).join(',')})` }),
    h('div', { class: 'vr-legend-ticks' }, ['0', '1k', '4k', '8k', '20k', '40k ft'].map((t) => h('span', {}, t))));
  const status = h('div', { class: 'vr-status' });
  const card = h('div', { class: 'vr-card', hidden: true });
  el.append(h('div', { class: 'vr-corner' }, scale, legend), h('div', { class: 'vr-top' }, status), card);
  const paintScale = () => {
    const y = map.getSize().y / 2;
    const nmPer100 = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([100, y])) / 1852;
    if (!(nmPer100 > 0)) return;
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((v) => (v / nmPer100) * 100 >= 60) || 500;
    scale.firstChild.style.width = ((nice / nmPer100) * 100).toFixed(0) + 'px';
    scale.lastChild.textContent = `${String(nice).replace('.', ',')} NM`;
  };
  map.on('zoomend moveend resize', paintScale);

  // Font size and family, read once and again when they can have changed rather than every frame.
  let rem = 16, family = 'sans-serif';
  const metrics = () => {
    rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    family = getComputedStyle(document.body).fontFamily;
  };
  metrics();
  map.on('resize', metrics);

  /* aircraft canvas: a Leaflet canvas renderer, so it follows pans and zoom animations with the map */
  const renderer = L.canvas({ padding: 0.1, pane: 'overlayPane' });
  map.addLayer(renderer);
  let drawn = []; // screen spots of the aircraft drawn last, for clicks
  let selected = null, follow = false;
  let snap = null;
  const widths = new Map(); // label text -> width at the font size in use
  let widthFont = '';

  function trail(ctx, P, t, p, a, widthPx) {
    // A dark casing first, then the line in the colours of the altitudes flown: readable on any map.
    ctx.lineWidth = widthPx + 2.6;
    ctx.strokeStyle = 'rgba(5,8,14,0.55)';
    ctx.beginPath();
    let q = P(t[0][1], t[0][2]);
    ctx.moveTo(q[0], q[1]);
    for (let i = 1; i < t.length; i += 1) { q = P(t[i][1], t[i][2]); ctx.lineTo(q[0], q[1]); }
    ctx.lineTo(p[0], p[1]);
    ctx.stroke();
    ctx.lineWidth = widthPx;
    let prev = P(t[0][1], t[0][2]), color = null;
    ctx.beginPath();
    ctx.moveTo(prev[0], prev[1]);
    for (let i = 1; i <= t.length; i += 1) {
      const n = i < t.length ? P(t[i][1], t[i][2]) : p;
      const col = vrAltColor(i < t.length ? t[i][3] : a.alt);
      if (col !== color && color) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); }
      color = col;
      ctx.strokeStyle = col;
      ctx.lineTo(n[0], n[1]);
      prev = n;
    }
    ctx.stroke();
  }

  function draw() {
    const ctx = renderer._ctx, b = renderer._bounds;
    if (!ctx || !b || map._animatingZoom) return;
    const now = Date.now();
    const size = b.getSize();
    ctx.clearRect(b.min.x, b.min.y, size.x, size.y);
    drawn = [];
    const zoom = map.getZoom(), org = map.getPixelOrigin();
    const P = (lat, lon) => { const p = vrProj(lat, lon, zoom); return [p[0] - org.x, p[1] - org.y]; };
    const inView = (p, m) => p[0] > b.min.x - m && p[0] < b.max.x + m && p[1] > b.min.y - m && p[1] < b.max.y + m;
    const dpr = L.Browser.retina ? 2 : 1;

    if ((w.cfg.overlays || []).includes('rings')) {
      const c = P(...VR_SCHIPHOL);
      const pxPerNm = Math.abs(vrProj(VR_SCHIPHOL[0] + 1 / 60, VR_SCHIPHOL[1], zoom)[1] - vrProj(VR_SCHIPHOL[0], VR_SCHIPHOL[1], zoom)[1]);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,185,65,0.6)';
      ctx.fillStyle = 'rgba(255,185,65,0.9)';
      ctx.lineWidth = 1.3;
      ctx.setLineDash([6, 5]);
      ctx.font = `600 ${(0.68 * rem).toFixed(1)}px ${family}`;
      for (let nm = 10; nm <= 100; nm += 10) {
        const r = pxPerNm * nm;
        ctx.beginPath();
        ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`${nm}`, c[0] + 4, c[1] - r - 3);
      }
      ctx.restore();
    }
    if (!snap) return;

    const cats = vrCats(w.cfg);
    const list = [];
    let sel = null;
    for (const a of snap.ac) {
      // An aircraft in distress and the selected one are always on the map, whatever the categories.
      if (a.lat == null || (now - a.posAt) / 1000 > VR_HIDE_S || (!vrMatch(a, cats) && a.hex !== selected && !vrAlert(a))) continue;
      const pos = vrNow(a, now);
      const p = P(pos[0], pos[1]);
      if (a.hex === selected) sel = { a, p, pos };
      if (!inView(p, 60) && a.hex !== selected) continue;
      list.push({ a, p, pos });
    }
    // Following the selected aircraft: the map keeps it in the middle.
    if (follow && sel) {
      const c = map.latLngToLayerPoint(map.getCenter());
      const panning = map._panAnim && map._panAnim._inProgress;
      if (!panning && Math.hypot(c.x - sel.p[0], c.y - sel.p[1]) > 24) map.panTo(sel.pos, { animate: true, duration: 0.6 });
    }
    // Low-flying and own aircraft on top, as they matter most here.
    list.sort((x, y) => (!!x.a.group - !!y.a.group) || ((typeof y.a.alt === 'number' ? y.a.alt : 0) - (typeof x.a.alt === 'number' ? x.a.alt : 0)));

    // Routes: of the aircraft in the chosen categories, of the own aircraft, and of the selected one.
    // Among all traffic only the own aircraft and the selected one, or the map drowns in lines.
    const routes = !!w.cfg.routes;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const { a, p } of list) {
      const own = !!a.group, isSel = a.hex === selected;
      if (!isSel && !(routes && (own || !cats.includes('all')))) continue;
      const t = vrTrails.get(a.hex);
      if (!t || !t.length) continue;
      ctx.globalAlpha = own || isSel ? 1 : 0.85;
      trail(ctx, P, t, p, a, own || isSel ? 3.6 : 2.6);
    }
    ctx.restore();

    // Aircraft.
    const style = VR_SYMBOLS[w.cfg.sym] ? w.cfg.sym : 'silhouet';
    const base = 1.45 * rem * (+w.cfg.symSize || 1); // an airliner, in css pixels
    for (const { a, p } of list) {
      const own = !!a.group, isSel = a.hex === selected;
      const age = (now - a.posAt) / 1000;
      const alert = vrAlert(a);
      const shape = vrShape(a);
      const px = base * VR_SHAPES[shape].s * (own ? 1.25 : 1) * (a.alt === 'ground' ? 0.85 : 1);
      const sp = vrSprite(shape, own ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt), style, px, own, dpr);
      ctx.globalAlpha = age > vrFade(a) ? 0.45 : 1;
      if (isSel || alert) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], px * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = alert ? 'rgba(255,60,50,0.3)' : 'rgba(255,255,255,0.18)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = alert ? '#ff3c32' : '#ffffff';
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.rotate(((a.track ?? 0) * Math.PI) / 180);
      ctx.drawImage(sp.c, -sp.size / 2, -sp.size / 2, sp.size, sp.size);
      ctx.restore();
      drawn.push({ hex: a.hex, x: p[0], y: p[1], r: Math.max(px * 0.55, 12) });
    }
    ctx.globalAlpha = 1;

    // Labels: callsign above altitude and speed. Where they would overlap, the own and selected aircraft
    // keep theirs and the rest give way.
    if (w.cfg.labels) {
      const fs = 0.7 * rem, lh = fs * 1.2, pad = 0.28 * rem;
      const font = (weight) => `${weight} ${fs.toFixed(1)}px ${family}`;
      if (widthFont !== font(500) || widths.size > 5000) { widths.clear(); widthFont = font(500); }
      const measure = (text, weight) => {
        let v = widths.get(weight + text);
        if (v == null) { ctx.font = font(weight); v = ctx.measureText(text).width; widths.set(weight + text, v); }
        return v;
      };
      const boxes = [];
      const order = [...list].sort((x, y) => (y.a.hex === selected) - (x.a.hex === selected) || (!!y.a.group - !!x.a.group));
      ctx.textBaseline = 'top';
      for (const { a, p } of order) {
        const own = !!a.group;
        const l1 = a.flight || a.reg || a.hex.toUpperCase();
        const l2 = `${vrAltText(a)}${vrClimb(a.vs)}  ${a.gs == null ? '—' : Math.round(a.gs)} kt`;
        const w1 = measure(l1, 700), w2 = measure(l2, 500);
        const bw = Math.max(w1, w2) + pad * 2 + 3, bh = lh * 2 + pad * 1.4;
        const x = p[0] + 1.1 * rem, y = p[1] - bh / 2;
        const box = [x - 2, y - 2, x + bw + 2, y + bh + 2];
        if (!own && a.hex !== selected && boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
        boxes.push(box);
        ctx.globalAlpha = (now - a.posAt) / 1000 > vrFade(a) ? 0.5 : 1;
        ctx.fillStyle = 'rgba(7,13,24,0.86)';
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, 3);
        ctx.fill();
        ctx.fillStyle = own ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt);
        ctx.fillRect(x, y, 3, bh);
        ctx.fillStyle = '#ffffff';
        ctx.font = font(700);
        ctx.fillText(l1, x + pad + 3, y + pad * 0.7);
        ctx.fillStyle = '#c6d4e8';
        ctx.font = font(500);
        ctx.fillText(l2, x + pad + 3, y + pad * 0.7 + lh);
      }
      ctx.globalAlpha = 1;
    }
  }

  /* status pill and the card of the selected aircraft */
  function paintStatus() {
    const now = Date.now();
    let level = 'live', label = 'LIVE', detail = [];
    if (!snap) [level, label] = ['warn', 'LADEN'];
    else if (!snap.ok) [level, label] = ['bad', snap.reason && /beperken/.test(snap.reason) ? 'BRONNEN BEPERKT' : 'GEEN VERBINDING'];
    else if (snap.reserve) [level, label] = ['warn', 'RESERVE'];
    else if (now - snap.lastOk > 5000) [level, label] = ['warn', 'VERTRAAGD'];
    if (snap) {
      const cats = vrCats(w.cfg);
      let n = 0;
      for (const a of snap.ac) if (a.lat != null && (now - a.posAt) / 1000 <= VR_HIDE_S && vrMatch(a, cats)) n += 1;
      detail = [`${n} toestel${n === 1 ? '' : 'len'}`, snap.lastOk ? zuluSec(snap.lastOk) : null, snap.via ? `${snap.src || 'live'} via ${snap.via}` : snap.src].filter(Boolean);
    }
    status.className = 'vr-status ' + level;
    status.title = 'Live posities van adsb.fi (elke seconde) aangevuld met adsb.lol; leveren die allebei niets, dan springt OpenSky bij (RESERVE, elke 5 tot 30 seconden). Groen: actueel. Oranje: laden, vertraagd of reserve. Rood: geen verbinding.\nMet meerdere schermen haalt één scherm het verkeer op en krijgen de andere elke ronde direct van dat scherm door ("via ...").\nTussen twee berichten schuift een toestel maximaal 4 seconden door langs zijn koers met zijn grondsnelheid (bij OpenSky 20 seconden); een bericht ouder dan 20 seconden (bij OpenSky 35) wordt vervaagd getoond, ouder dan 60 seconden niet meer.' + (snap && snap.reason ? `\n\nNu: ${snap.reason}` : '');
    status.replaceChildren(h('span', { class: 'wxm-dot' }), h('b', {}, label), ...detail.map((d) => h('span', {}, d)));
  }
  function paintCard() {
    const a = selected && snap ? snap.ac.find((x) => x.hex === selected) : null;
    if (!a) { card.hidden = true; follow = false; return; }
    const now = Date.now();
    const unitName = UNIT_NAMES(a.hex);
    const row = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));
    card.hidden = false;
    card.style.setProperty('--vr-c', a.group ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt));
    card.replaceChildren(
      h('div', { class: 'vr-card-head' },
        h('b', {}, a.flight || a.reg || a.hex.toUpperCase()),
        h('span', {}, [a.reg || (unitName && unitName.reg), a.type || (unitName && unitName.type), a.group ? FLEET_GROUPS[a.group] : a.mil ? 'Militair' : null].filter(Boolean).join(' · ')),
        h('button', { class: 'w-tool', title: 'Sluiten', onclick: () => select(null) }, icon('close'))),
      a.desc ? h('div', { class: 'vr-card-desc' }, a.desc) : null,
      h('div', { class: 'vr-card-grid' },
        row('HOOGTE', vrAltText(a) + (a.vs != null && Math.abs(a.vs) >= 100 ? ` ${vrClimb(a.vs) || (a.vs > 0 ? '↗' : '↘')} ${Math.abs(Math.round(a.vs / 50) * 50)} ft/min` : '')),
        row('SNELHEID', a.gs == null ? '—' : `${Math.round(a.gs)} kt`),
        row('KOERS', a.track == null ? '—' : `${String(Math.round(a.track) % 360).padStart(3, '0')}°`),
        row('SQUAWK', a.squawk || '—'),
        row('HEX', a.hex.toUpperCase()),
        row('POSITIE', `${((now - a.posAt) / 1000).toFixed(1).replace('.', ',')} s oud${a.mlat ? ' · MLAT' : ''}`)),
      h('button', { class: 'btn vr-follow' + (follow ? ' on' : ''), title: 'De kaart houdt dit toestel in het midden tot je de kaart zelf verschuift of het toestel sluit', onclick: () => { follow = !follow; paintCard(); draw(); } }, icon('target'), follow ? 'Volgen staat aan' : 'Volgen'));
  }

  function select(hex) { selected = hex; follow = false; paintCard(); draw(); }
  map.on('click', (e) => {
    const p = e.layerPoint;
    let best = null;
    for (const d of drawn) { const dist = Math.hypot(d.x - p.x, d.y - p.y); if (dist <= d.r && (!best || dist < best.dist)) best = { hex: d.hex, dist }; }
    select(best ? best.hex : null);
  });
  map.on('mousemove', (e) => {
    const p = e.layerPoint;
    el.classList.toggle('pointing', drawn.some((d) => Math.hypot(d.x - p.x, d.y - p.y) <= d.r));
  });
  // Moving the map by hand ends following.
  map.on('dragstart', () => { if (follow) { follow = false; paintCard(); } });

  renderer.on('update', draw);
  return {
    map, el, applyLayers, refreshRain, paintScale,
    setSnap(s) { snap = s; paintStatus(); paintCard(); },
    // Straight to one aircraft (from the emergency alert): selected, followed, and zoomed in to it.
    focus(hex, at) {
      select(hex);
      follow = true;
      paintCard();
      if (at && at.lat != null) map.setView([at.lat, at.lon], Math.max(map.getZoom(), 9.5), { animate: true });
    },
    draw, paintStatus,
    destroy() { themeWatch.disconnect(); clearTimeout(settle); map.remove(); },
  };
}
