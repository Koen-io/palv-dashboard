'use strict';

/* ============================================================
   Vluchtradar — the dashboard's own map of the live traffic
   ============================================================ */
// Map tiles through Leaflet; the aircraft, their labels and routes are drawn on one canvas over it,
// several times a second, from the feed the main process pushes every second (traffic.js). Between two
// messages an aircraft is carried forward along its track at its ground speed, for at most a few
// seconds, so it stands where it is now rather than where it was when the message went out.
// Uses the helpers of app.js (h, icon, clamp, ...) at run time; this file only defines.

const VR_EXTRAP_S = 4;          // carry an aircraft forward along its track at most this long
const VR_FADE_S = 20;           // position older than this: drawn faded
const VR_HIDE_S = 60;           // position older than this: not drawn
// Redraw interval while on screen. Over the whole country an airliner moves less than a pixel a second,
// so then once a second (with every new round) is enough; zoomed in on a helicopter up to ten times.
const vrFrameMs = (zoom) => clamp(Math.round(250 * 2 ** (11 - zoom)), 100, 1000);
const VR_TRAIL_MIN = 15;        // minutes of route kept for other traffic
const VR_SCHIPHOL = [52.3086, 4.7639];

// Base maps. `dim`: darkened while the dashboard is in its dark theme, as ADS-B Exchange does.
// `under`: drawn beneath, for the parts of the world a Dutch layer does not cover.
const VR_BASES = {
  osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, dim: true, attr: '© <b>OpenStreetMap</b>-bijdragers' },
  cartoDark: { name: 'CARTO donker', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', sub: 'abcd', max: 20, attr: '© OpenStreetMap · © CARTO' },
  cartoLight: { name: 'CARTO licht', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', sub: 'abcd', max: 20, dim: true, attr: '© OpenStreetMap · © CARTO' },
  brt: { name: 'Topografisch NL (PDOK)', url: 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png', max: 19, dim: true, under: 'cartoLight', attr: '© Kadaster / PDOK' },
  foto: { name: 'Luchtfoto NL (PDOK)', url: 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg', max: 19, under: 'cartoDark', attr: '© Beeldmateriaal Nederland / PDOK' },
};
const VR_OVERLAYS = {
  aero: { name: 'Luchtruim (VFR-kaart)', hint: 'CTR\'s, TMA\'s, verboden en beperkte gebieden van openFlightMaps', attr: 'openFlightMaps' },
  wx: { name: 'Neerslagradar', hint: 'RainViewer, elke 10 minuten een nieuw beeld', attr: 'RainViewer' },
  rings: { name: 'Afstandsringen Schiphol', hint: 'Elke 10 NM rond Schiphol' },
  legend: { name: 'Hoogtelegenda', hint: 'Kleur van de toestellen naar hoogte' },
};

const VR_CATS = [
  { value: 'all', label: 'ALLES', icon: 'plane', title: 'Al het vliegverkeer' },
  { value: 'mil', label: 'MILITAIR', icon: 'star', title: 'Militair vliegverkeer' },
  { value: 'police', label: 'POLITIE', icon: 'shield', title: 'Politiehelikopters (lijst onder Instellingen › Eigen eenheden)' },
  { value: 'hems', label: 'TRAUMA', icon: 'plus', title: 'Trauma- en ambulancehelikopters (lijst onder Instellingen › Eigen eenheden)' },
  { value: 'coastguard', label: 'KUSTWACHT', icon: 'wind', title: 'Kustwacht: vliegtuigen en SAR-helikopters (lijst onder Instellingen › Eigen eenheden)' },
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
const vrAltColor = (alt) => {
  if (alt === 'ground') return '#8a8f98';
  if (typeof alt !== 'number') return '#a7b0bd';
  const hue = vrLerp(VR_HUE, Math.max(0, alt));
  return `hsl(${hue.toFixed(0)},88%,${vrLerp(VR_LIGHT, hue).toFixed(0)}%)`;
};

/* ---------- symbols ---------- */
const VR_PLANE = new Path2D('M0-11c1.1 0 1.6 1 1.6 2.2v5.2l8.4 5.1v2.3l-8.4-2.6v5.9l2.6 2v1.8L0 19.9l-4.2 1.1v-1.8l2.6-2v-5.9l-8.4 2.6v-2.3l8.4-5.1v-5.2C-1.6-10-1.1-11 0-11Z');
const VR_HELI = new Path2D('M0-8.5c2.3 0 3.8 1.9 3.8 4.6v4.4c0 2.1-1.1 3.6-2.6 4.1v8.6h3.2v1.9h-8.8v-1.9h3.2V4.6c-1.5-.5-2.6-2-2.6-4.1v-4.4C-3.8-6.6-2.3-8.5 0-8.5Z');
const vrIsHeli = (a) => a.cat === 'A7' || /^(EC|H1|H6|A1[0-9]|A169|A189|AS|B06|B4|R22|R44|R66|S76|S92|NH90|LYNX|PUMA|CH|UH|AH|MI|KA|EH10|BK17)/i.test(a.type || '');

/* ---------- projection (Web Mercator, as Leaflet's EPSG:3857 at 256 px tiles) ---------- */
const vrProj = (lat, lon, zoom) => {
  const s = 256 * 2 ** zoom, r = (clamp(lat, -85.05, 85.05) * Math.PI) / 180;
  return [((lon + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
};

// Where an aircraft is now: its last position, carried forward along its track for at most a few seconds.
function vrNow(a, now) {
  if (a.lat == null) return null;
  const dt = Math.min(VR_EXTRAP_S, (now - a.posAt) / 1000);
  if (a.alt === 'ground' || !(a.gs > 3) || a.track == null || dt <= 0) return [a.lat, a.lon];
  const nm = (a.gs * dt) / 3600, tr = (a.track * Math.PI) / 180;
  return [a.lat + (nm * Math.cos(tr)) / 60, a.lon + (nm * Math.sin(tr)) / (60 * Math.cos((a.lat * Math.PI) / 180))];
}

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

/* ---------- the map ---------- */
// opts: { cfg, onView(view), getCats(), labels(), routes(), onSelect(), font() }
function vrCreate(body, w) {
  const el = h('div', { class: 'vr-map' });
  body.append(el);
  const map = L.map(el, {
    zoomControl: false, attributionControl: true, zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    minZoom: 4, maxZoom: 17, worldCopyJump: false, fadeAnimation: true, inertia: true, boxZoom: false,
  });
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Inzoomen', zoomOutTitle: 'Uitzoomen' }).addTo(map);
  for (const [name, z] of [['vrUnder', 190], ['vrBase', 200], ['vrAero', 350], ['vrWx', 360]]) { map.createPane(name).style.zIndex = z; map.getPane(name).style.pointerEvents = 'none'; }

  const layers = { base: null, under: null, aero: null, wx: null };
  const tile = (def, pane, extra = {}) => L.tileLayer(def.url, { subdomains: def.sub || 'abc', maxNativeZoom: def.max, maxZoom: 17, pane, attribution: def.attr, crossOrigin: false, updateWhenIdle: false, keepBuffer: 3, ...extra });
  function applyLayers() {
    const base = VR_BASES[w.cfg.base] || VR_BASES.osm;
    if (layers.base) layers.base.remove();
    if (layers.under) layers.under.remove();
    layers.base = tile(base, 'vrBase', { bounds: base.under ? [[50.6, 3.0], [53.7, 7.4]] : undefined }).addTo(map);
    layers.under = base.under ? tile(VR_BASES[base.under], 'vrUnder', { attribution: '' }).addTo(map) : null;
    const on = (k) => (w.cfg.overlays || []).includes(k);
    if (on('aero') && !layers.aero) layers.aero = L.tileLayer('https://nwy-tiles-api.prod.newaydata.com/tiles/{z}/{x}/{y}.png?path=latest/aero/latest', { pane: 'vrAero', maxNativeZoom: 12, maxZoom: 17, opacity: 0.8, attribution: '© openFlightMaps' }).addTo(map);
    if (!on('aero') && layers.aero) { layers.aero.remove(); layers.aero = null; }
    if (!on('wx') && layers.wx) { layers.wx.remove(); layers.wx = null; }
    if (on('wx')) refreshRain();
    paintDim();
    legend.hidden = !on('legend');
  }
  async function refreshRain() {
    const url = await vrRainUrl();
    if (!url || !(w.cfg.overlays || []).includes('wx')) return;
    if (layers.wx && layers.wx._url === url) return;
    const next = L.tileLayer(url, { pane: 'vrWx', maxNativeZoom: 7, maxZoom: 17, opacity: 0.6, attribution: '© RainViewer' }).addTo(map);
    if (layers.wx) { const old = layers.wx; next.once('load', () => old.remove()); setTimeout(() => old.remove(), 8000); }
    layers.wx = next;
  }
  const paintDim = () => el.classList.toggle('dim', document.documentElement.dataset.theme === 'dark' && !!(VR_BASES[w.cfg.base] || VR_BASES.osm).dim);

  // Scale bar in nautical miles and the altitude legend, bottom left.
  const scale = h('div', { class: 'vr-scale' }, h('i'), h('span'));
  const legend = h('div', { class: 'vr-legend', title: 'Kleur van de toestellen naar barometrische hoogte, zoals op ADS-B Exchange. Eigen eenheden hebben hun eigen kleur.' },
    h('div', { class: 'vr-legend-bar', style: `background:linear-gradient(90deg,${[0, 500, 1000, 2000, 4000, 6000, 8000, 10000, 20000, 30000, 40000].map((a, i, all) => `${vrAltColor(a)} ${((i / (all.length - 1)) * 100).toFixed(0)}%`).join(',')})` }),
    h('div', { class: 'vr-legend-ticks' }, ['0', '1k', '4k', '8k', '20k', '40k ft'].map((t) => h('span', {}, t))));
  const status = h('div', { class: 'vr-status' });
  const card = h('div', { class: 'vr-card', hidden: true });
  el.append(h('div', { class: 'vr-corner' }, scale, legend), status, card);
  const paintScale = () => {
    const y = map.getSize().y / 2;
    const nmPer100 = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([100, y])) / 1852;
    if (!(nmPer100 > 0)) return;
    const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find((v) => v / nmPer100 * 100 >= 60) || 500;
    scale.firstChild.style.width = ((nice / nmPer100) * 100).toFixed(0) + 'px';
    scale.lastChild.textContent = `${String(nice).replace('.', ',')} NM`;
  };
  map.on('zoomend moveend resize', paintScale);

  /* aircraft canvas: a Leaflet canvas renderer, so it follows pans and zoom animations with the map */
  const renderer = L.canvas({ padding: 0.1, pane: 'overlayPane' });
  map.addLayer(renderer);
  let drawn = []; // screen spots of the aircraft drawn last, for clicks
  let selected = null;
  let snap = null;
  const widths = new Map(); // label text -> width at the font size in use
  let widthFont = '';

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
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

    if ((w.cfg.overlays || []).includes('rings')) {
      const c = P(...VR_SCHIPHOL);
      const pxPerNm = vrProj(VR_SCHIPHOL[0] + 1 / 60, VR_SCHIPHOL[1], zoom)[1] - vrProj(VR_SCHIPHOL[0], VR_SCHIPHOL[1], zoom)[1];
      ctx.save();
      ctx.strokeStyle = 'rgba(255,185,65,0.55)';
      ctx.fillStyle = 'rgba(255,185,65,0.85)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([6, 5]);
      ctx.font = `600 ${(0.68 * rem).toFixed(1)}px ${getComputedStyle(document.body).fontFamily}`;
      for (let nm = 10; nm <= 100; nm += 10) {
        const r = Math.abs(pxPerNm) * nm;
        ctx.beginPath();
        ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillText(`${nm}`, c[0] + 4, c[1] - r - 3);
      }
      ctx.restore();
    }
    if (!snap) return;

    const cats = w.cfg.cats && w.cfg.cats.length ? w.cfg.cats : ['all'];
    const list = [];
    for (const a of snap.ac) {
      if (a.lat == null || (now - a.posAt) / 1000 > VR_HIDE_S || !vrMatch(a, cats)) continue;
      const pos = vrNow(a, now);
      const p = P(pos[0], pos[1]);
      if (!inView(p, 60) && a.hex !== selected) continue;
      list.push({ a, p, pos });
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
      const own = !!a.group;
      if (a.hex !== selected && !(routes && (own || !cats.includes('all')))) continue;
      const t = vrTrails.get(a.hex);
      if (!t || !t.length) continue;
      ctx.lineWidth = own || a.hex === selected ? 2.4 : 1.6;
      ctx.globalAlpha = own || a.hex === selected ? 0.95 : 0.7;
      let prev = P(t[0][1], t[0][2]), color = null;
      ctx.beginPath();
      ctx.moveTo(prev[0], prev[1]);
      for (let i = 1; i <= t.length; i += 1) {
        const q = i < t.length ? P(t[i][1], t[i][2]) : p;
        const col = vrAltColor(i < t.length ? t[i][3] : a.alt);
        if (col !== color && color) { ctx.stroke(); ctx.beginPath(); ctx.moveTo(prev[0], prev[1]); }
        color = col;
        ctx.strokeStyle = col;
        ctx.lineTo(q[0], q[1]);
        prev = q;
      }
      ctx.stroke();
    }
    ctx.restore();

    // Aircraft.
    const unit = 0.075 * rem; // symbol scale: about 1.7 rem across
    for (const { a, p } of list) {
      const own = !!a.group, sel = a.hex === selected;
      const age = (now - a.posAt) / 1000;
      const alert = a.emergency || /^(7500|7600|7700)$/.test(a.squawk || '');
      const s = unit * (own ? 1.3 : 1) * (vrIsHeli(a) ? 1.15 : 1);
      ctx.save();
      ctx.globalAlpha = age > VR_FADE_S ? 0.45 : 1;
      ctx.translate(p[0], p[1]);
      if (sel || own || alert) {
        ctx.beginPath();
        ctx.arc(0, 0, 15 * s, 0, Math.PI * 2);
        ctx.fillStyle = alert ? 'rgba(255,60,50,0.35)' : sel ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.12)';
        ctx.fill();
        ctx.lineWidth = sel || alert ? 2 : 1.2;
        ctx.strokeStyle = alert ? '#ff3c32' : sel ? '#ffffff' : VR_GROUP_COLOR[a.group];
        ctx.stroke();
      }
      ctx.rotate((((a.track ?? 0) * Math.PI) / 180));
      ctx.scale(s, s);
      const sym = vrIsHeli(a) ? VR_HELI : VR_PLANE;
      ctx.fillStyle = own ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt);
      ctx.strokeStyle = own ? '#ffffff' : 'rgba(8,14,24,0.9)';
      ctx.lineWidth = (own ? 1.5 : 1.1) / s * unit;
      ctx.fill(sym);
      ctx.stroke(sym);
      if (vrIsHeli(a)) {
        ctx.strokeStyle = own ? '#ffffff' : 'rgba(8,14,24,0.75)';
        ctx.lineWidth = 1.2 / s * unit;
        ctx.beginPath();
        ctx.moveTo(-9, -9); ctx.lineTo(9, 9); ctx.moveTo(9, -9); ctx.lineTo(-9, 9);
        ctx.stroke();
      }
      ctx.restore();
      drawn.push({ hex: a.hex, x: p[0], y: p[1], r: 14 * s });
    }

    // Labels: callsign above speed and altitude. Where they would overlap, the own and selected aircraft
    // keep theirs and the rest give way.
    if (w.cfg.labels) {
      const fs = 0.7 * rem, lh = fs * 1.2, pad = 0.28 * rem;
      const family = getComputedStyle(document.body).fontFamily;
      const font = (weight) => `${weight} ${fs.toFixed(1)}px ${family}`;
      if (widthFont !== font(500) || widths.size > 5000) { widths.clear(); widthFont = font(500); }
      const measure = (text, weight) => {
        let v = widths.get(weight + text);
        if (v == null) { ctx.font = font(weight); v = ctx.measureText(text).width; widths.set(weight + text, v); }
        return v;
      };
      const boxes = [];
      const order = [...list].sort((x, y) => (y.a.hex === selected) - (x.a.hex === selected) || (!!y.a.group - !!x.a.group));
      for (const { a, p } of order) {
        const own = !!a.group;
        const l1 = a.flight || a.reg || a.hex.toUpperCase();
        const l2 = `${vrAltText(a)}${vrClimb(a.vs)}  ${a.gs == null ? '—' : Math.round(a.gs)} kt`;
        const w1 = measure(l1, 700), w2 = measure(l2, 500);
        const bw = Math.max(w1, w2) + pad * 2 + 3, bh = lh * 2 + pad * 1.4;
        const x = p[0] + 1.25 * rem, y = p[1] - bh / 2;
        const box = [x - 2, y - 2, x + bw + 2, y + bh + 2];
        if (!own && a.hex !== selected && boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
        boxes.push(box);
        ctx.globalAlpha = (now - a.posAt) / 1000 > VR_FADE_S ? 0.5 : 1;
        ctx.fillStyle = 'rgba(7,13,24,0.86)';
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, 3);
        ctx.fill();
        ctx.fillStyle = own ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt);
        ctx.fillRect(x, y, 3, bh);
        ctx.textBaseline = 'top';
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
    else if (!snap.ok) [level, label] = ['bad', 'GEEN VERBINDING'];
    else if (now - snap.lastOk > 5000) [level, label] = ['warn', 'VERTRAAGD'];
    if (snap) {
      const cats = w.cfg.cats && w.cfg.cats.length ? w.cfg.cats : ['all'];
      const n = snap.ac.filter((a) => a.lat != null && (now - a.posAt) / 1000 <= VR_HIDE_S && vrMatch(a, cats)).length;
      detail = [`${n} toestel${n === 1 ? '' : 'len'}`, snap.lastOk ? `${zulu(snap.lastOk).slice(0, -1)}:${pad2(new Date(snap.lastOk).getUTCSeconds())}Z` : null, snap.src].filter(Boolean);
    }
    status.className = 'vr-status ' + level;
    status.title = 'Live posities van adsb.fi (elke seconde) aangevuld met adsb.lol. Groen: actueel. Oranje: laden of vertraagd. Rood: geen verbinding.\nTussen twee berichten schuift een toestel maximaal 4 seconden door langs zijn koers met zijn grondsnelheid; een bericht ouder dan 20 seconden wordt vervaagd getoond, ouder dan 60 seconden niet meer.';
    status.replaceChildren(h('span', { class: 'wxm-dot' }), h('b', {}, label), ...detail.map((d) => h('span', {}, d)));
  }
  function paintCard() {
    const a = selected && snap ? snap.ac.find((x) => x.hex === selected) : null;
    if (!a) { card.hidden = true; return; }
    const now = Date.now();
    const unitName = UNIT_NAMES(a.hex);
    const row = (k, v) => h('div', {}, h('span', {}, k), h('b', {}, v));
    card.hidden = false;
    card.style.setProperty('--vr-c', a.group ? VR_GROUP_COLOR[a.group] : vrAltColor(a.alt));
    card.replaceChildren(
      h('div', { class: 'vr-card-head' },
        h('b', {}, a.flight || a.reg || a.hex.toUpperCase()),
        h('span', {}, [a.reg || (unitName && unitName.reg), a.type || (unitName && unitName.type), a.group ? FLEET_GROUPS[a.group] : a.mil ? 'Militair' : null].filter(Boolean).join(' · ')),
        h('button', { class: 'w-tool', title: 'Sluiten', onclick: () => { selected = null; paintCard(); draw(); } }, icon('close'))),
      a.desc ? h('div', { class: 'vr-card-desc' }, a.desc) : null,
      h('div', { class: 'vr-card-grid' },
        row('HOOGTE', vrAltText(a) + (a.vs != null && Math.abs(a.vs) >= 100 ? ` ${vrClimb(a.vs) || (a.vs > 0 ? '↗' : '↘')} ${Math.abs(Math.round(a.vs / 50) * 50)} ft/min` : '')),
        row('SNELHEID', a.gs == null ? '—' : `${Math.round(a.gs)} kt`),
        row('KOERS', a.track == null ? '—' : `${pad2(Math.round(a.track) % 360).padStart(3, '0')}°`),
        row('SQUAWK', a.squawk || '—'),
        row('HEX', a.hex.toUpperCase()),
        row('POSITIE', `${((now - a.posAt) / 1000).toFixed(1).replace('.', ',')} s oud${a.mlat ? ' · MLAT' : ''}`)));
  }

  function select(hex) { selected = hex; paintCard(); draw(); }
  map.on('click', (e) => {
    const p = e.layerPoint;
    let best = null;
    for (const d of drawn) { const dist = Math.hypot(d.x - p.x, d.y - p.y); if (dist <= Math.max(d.r, 16) && (!best || dist < best.dist)) best = { hex: d.hex, dist }; }
    select(best ? best.hex : null);
  });
  map.on('mousemove', (e) => {
    const p = e.layerPoint;
    el.classList.toggle('pointing', drawn.some((d) => Math.hypot(d.x - p.x, d.y - p.y) <= Math.max(d.r, 16)));
  });

  renderer.on('update', draw);
  return {
    map, el, applyLayers, refreshRain, paintDim, paintScale,
    setSnap(s) { snap = s; paintStatus(); paintCard(); },
    draw, paintStatus,
    destroy() { map.remove(); },
  };
}
