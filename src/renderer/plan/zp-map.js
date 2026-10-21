'use strict';

/* ============================================================
   Zoek & Plan — de kaart: ondergronden (via de eigen tegelopslag), kaartlagen als plaatjes, en één
   tekenlaag voor alle symbolen (platforms, bakens, vliegtuigen, meetlint, ringen, windpijlen).
   ============================================================ */
// Tiles come through palvtile://<source>/z/x/y (src/main/plan.js): every tile seen stays on disk for 30
// days, so the map also works without a connection over an area looked at before.
const zpTile = (src) => `palvtile://${src}/{z}/{x}/{y}`;
const ZP_T = {
  osm: { src: 'osm', max: 19, attr: '© <b>OpenStreetMap</b>-bijdragers' },
  s2: { src: 's2', max: 15, attr: 'Sentinel-2 cloudless 2023 © EOX (Copernicus)' },
  foto: { src: 'foto', max: 19, bounds: [[50.6, 3.0], [53.7, 7.4]], minZoom: 8, keyWhite: true, attr: '© Beeldmateriaal Nederland / PDOK' },
  brt: { src: 'brt', max: 19, bounds: [[50.6, 3.0], [53.7, 7.4]], attr: '© Kadaster / PDOK' },
  brtgrijs: { src: 'brtgrijs', max: 19, bounds: [[50.6, 3.0], [53.7, 7.4]], attr: '© Kadaster / PDOK' },
  topo: { src: 'topo', max: 17, attr: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap-bijdragers' },
  ofmbase: { src: 'ofmbase', max: 12, attr: '© openFlightMaps' },
};
// Every base map has a day and a night face, as on the Vluchtradar; `auto` follows the dashboard theme.
const ZP_BASES = {
  osm: { name: 'OpenStreetMap · volgt thema', group: 'Wereld', day: ZP_T.osm, night: ZP_T.osm, invert: true, mode: 'auto' },
  osmLight: { name: 'OpenStreetMap licht', group: 'Wereld', day: ZP_T.osm, mode: 'day' },
  osmDark: { name: 'OpenStreetMap donker', group: 'Wereld', night: ZP_T.osm, invert: true, mode: 'night' },
  topo: { name: 'Topografisch wereld (OpenTopoMap)', group: 'Wereld', day: ZP_T.topo, dim: true, mode: 'auto' },
  s2: { name: 'Satelliet wereld (Sentinel-2)', group: 'Wereld', day: ZP_T.s2, dim: true, mode: 'auto', dark: true },
  sat: { name: 'Luchtfoto NL + satelliet', group: 'Nederland', under: ZP_T.s2, day: ZP_T.foto, dim: true, mode: 'auto', dark: true },
  brt: { name: 'Topografisch NL (PDOK)', group: 'Nederland', under: ZP_T.osm, day: ZP_T.brt, dim: true, mode: 'auto' },
  brtgrijs: { name: 'Topografisch NL grijs (PDOK)', group: 'Nederland', under: ZP_T.osm, day: ZP_T.brtgrijs, dim: true, mode: 'auto' },
  vfr: { name: 'VFR-luchtvaartkaart (openFlightMaps)', group: 'Luchtvaart', under: ZP_T.osm, day: ZP_T.ofmbase, dim: true, mode: 'auto', aero: true },
  none: { name: 'Geen ondergrond (donker)', group: 'Overig', mode: 'night', dark: true },
};
const ZP_RASTER = {
  ofmaero: { name: 'VFR-luchtvaartlaag (openFlightMaps)', hint: 'Luchtruim, VRP\'s, obstakels en frequenties als kaartbeeld van openFlightMaps, op elke ondergrond', url: zpTile('ofmaero'), max: 12, attr: '© openFlightMaps', opacity: 0.85 },
  seamark: { name: 'Zeekaart (OpenSeaMap)', hint: 'Betonning, vuurtorens, vaargeulen en offshore-markeringen', url: zpTile('seamark'), max: 18, attr: '© OpenSeaMap-bijdragers' },
  natura: { name: 'Natura 2000-gebieden (PDOK)', hint: 'Beschermde natuurgebieden: houd rekening met verstoring op lage hoogte', wms: 'https://service.pdok.nl/rvo/natura2000/wms/v1_0', layers: 'natura2000', attr: '© RVO / PDOK', opacity: 0.45 },
  rain: { name: 'Neerslagradar (RainViewer)', hint: 'Elke 10 minuten een nieuw beeld', attr: '© RainViewer', opacity: 0.6 },
};

/* ---------- one canvas for all symbols ---------- */
// Lies over the map in screen coordinates and is redrawn after every move; while Leaflet animates a zoom
// it is hidden and drawn again when the zoom has landed. Each drawing step may leave hit spots behind
// for clicks and hovering ({ x, y, r, kind, item, z }).
// A canvas in a map pane of its own, so it sits at the right height between Leaflet's layers (above the
// airspace and route lines, below the route markers); `place` keeps it over the visible area.
function zpPaneCanvas(map, pane, z, cls) {
  if (!map.getPane(pane)) { map.createPane(pane).style.zIndex = z; map.getPane(pane).style.pointerEvents = 'none'; }
  const cv = h('canvas', { class: cls });
  map.getPane(pane).append(cv);
  return { cv, place: () => L.DomUtil.setPosition(cv, map.containerPointToLayerPoint([0, 0])) };
}

function zpCanvas(map) {
  const { cv, place } = zpPaneCanvas(map, 'zpSym', 450, 'zp-canvas');
  const steps = [];
  let hits = [], queued = false, dpr = 1, drawnAt = null, lastDraw = 0;
  const size = () => {
    const s = map.getSize();
    dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(s.x * dpr); cv.height = Math.round(s.y * dpr);
    cv.style.width = s.x + 'px'; cv.style.height = s.y + 'px';
  };
  const draw = () => {
    queued = false;
    lastDraw = performance.now();
    drawnAt = { nw: map.containerPointToLatLng([0, 0]), zoom: map.getZoom() };
    place();
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cv.width, cv.height);
    hits = [];
    const s = map.getSize();
    const api = {
      g, w: s.x, h: s.y, zoom: map.getZoom(), bounds: map.getBounds(),
      P: (lat, lon) => { const p = map.latLngToContainerPoint([lat, lon]); return [p.x, p.y]; },
      inView: (p, m = 40) => p[0] > -m && p[1] > -m && p[0] < s.x + m && p[1] < s.y + m,
      hit: (spot) => hits.push(spot),
      // Metres to pixels around a point, for rings and radii.
      pxPerM: (lat) => { const a = map.latLngToContainerPoint([lat, 0]), b = map.latLngToContainerPoint([lat + 1 / 60, 0]); return Math.abs(b.y - a.y) / 1853.2; },
    };
    for (const st of steps) { try { g.save(); st.fn(api); } catch (err) { plog('warn', 'zoek & plan: tekenen mislukt', String(err && err.stack || err)); } finally { g.restore(); } }
  };
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(draw); } };
  size();
  map.on('resize', () => { size(); request(); });
  // While the wheel glides the zoom, the last picture is moved and scaled with the map (as Leaflet does
  // with its own canvas layers) and drawn anew only a few times per second: every symbol at every frame
  // is too much for a slower computer on a 4K screen.
  map.on('move', () => {
    if (!map._wheelZooming || !drawnAt) return request();
    L.DomUtil.setTransform(cv, map.latLngToLayerPoint(drawnAt.nw), map.getZoomScale(map.getZoom(), drawnAt.zoom));
    if (performance.now() - lastDraw > 250) request();
  });
  map.on('zoomend viewreset', request);
  map.on('zoomanim', () => cv.classList.add('zooming'));
  map.on('zoomend', () => cv.classList.remove('zooming'));
  return {
    el: cv, request, draw,
    // order: low first; steps with the same order keep the order they were added in.
    add(order, fn) { steps.push({ order, fn }); steps.sort((a, b) => a.order - b.order); request(); },
    hitAt(x, y, filter) {
      let best = null;
      for (const s of hits) {
        if (filter && !filter(s)) continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d <= (s.r || 8) && (!best || (s.z || 0) > (best.z || 0) || ((s.z || 0) === (best.z || 0) && d < best.d))) best = { ...s, d };
      }
      return best;
    },
  };
}

/* ---------- base map and raster layers ---------- */
function zpBaseLayers(ctx) {
  const { map, el, w } = ctx;
  for (const [name, z] of [['zpUnder', 190], ['zpBase', 200], ['zpNight', 210], ['zpRaster', 330], ['zpAeroRaster', 340], ['zpRain', 360], ['zpAir', 380], ['zpLines', 420]]) {
    map.createPane(name).style.zIndex = z;
    if (z < 380) map.getPane(name).style.pointerEvents = 'none';
  }
  const layers = { under: null, day: null, night: null };
  const raster = {};
  let baseKey = null, settle = null;
  const tile = (def, pane, extra = {}) => (def.keyWhite ? vrKeyedTiles : L.tileLayer)(zpTile(def.src), {
    maxNativeZoom: def.max, minZoom: def.minZoom || 0, maxZoom: 19, bounds: def.bounds, pane, attribution: def.attr,
    updateWhenIdle: false, keepBuffer: 3, crossOrigin: def.keyWhite ? 'anonymous' : undefined, ...extra,
  });
  const drop = (k) => { if (layers[k]) { layers[k].remove(); layers[k] = null; } };
  const isDark = () => document.documentElement.dataset.theme === 'dark';
  function paintNight() {
    const b = ZP_BASES[w.cfg.base] || ZP_BASES.osm;
    const night = b.mode === 'night' || (b.mode === 'auto' && isDark());
    el.classList.toggle('night', night);
    el.classList.toggle('night-invert', !!b.invert);
    el.classList.toggle('night-dim', !!b.dim);
    el.classList.toggle('base-dark', !!b.dark || night);
    clearTimeout(settle);
    if (!night || !b.night) el.classList.remove('settled');
    else settle = setTimeout(() => el.classList.add('settled'), el.classList.contains('no-fade') ? 0 : 4200);
  }
  async function applyRaster() {
    const on = (k) => (w.cfg.raster || []).includes(k) || (k === 'ofmaero' && (ZP_BASES[w.cfg.base] || {}).aero);
    for (const [k, d] of Object.entries(ZP_RASTER)) {
      if (!on(k)) { if (raster[k]) { raster[k].remove(); delete raster[k]; } continue; }
      if (raster[k] && k !== 'rain') continue;
      if (k === 'rain') {
        const url = await vrRainUrl();
        if (!url || !on('rain') || (raster.rain && raster.rain._url === url)) continue;
        const next = L.tileLayer(url, { pane: 'zpRain', maxNativeZoom: 7, maxZoom: 19, opacity: d.opacity, attribution: d.attr }).addTo(map);
        if (raster.rain) { const old = raster.rain; next.once('load', () => old.remove()); setTimeout(() => old.remove(), 8000); }
        raster.rain = next;
      } else if (d.wms) {
        raster[k] = L.tileLayer.wms(d.wms, { layers: d.layers, format: 'image/png', transparent: true, version: '1.3.0', pane: 'zpRaster', opacity: d.opacity, attribution: d.attr, maxZoom: 19 }).addTo(map);
      } else {
        raster[k] = L.tileLayer(d.url, { pane: k === 'ofmaero' ? 'zpAeroRaster' : 'zpRaster', maxNativeZoom: d.max, maxZoom: 19, opacity: d.opacity || 1, attribution: d.attr }).addTo(map);
      }
    }
  }
  function apply() {
    const key = ZP_BASES[w.cfg.base] ? w.cfg.base : 'osm';
    if (key !== baseKey) {
      baseKey = key;
      const b = ZP_BASES[key];
      for (const k of ['under', 'day', 'night']) drop(k);
      if (b.under) layers.under = tile(b.under, 'zpUnder').addTo(map);
      if (b.day) layers.day = tile(b.day, 'zpBase').addTo(map);
      if (b.night) layers.night = tile(b.night, 'zpNight', b.day && b.night.src === b.day.src ? { attribution: '' } : {}).addTo(map);
    }
    applyRaster();
    paintNight();
  }
  const themeWatch = new MutationObserver(paintNight);
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  setTimeout(() => el.classList.remove('no-fade'), 1500);
  const rainTimer = setInterval(() => { if ((w.cfg.raster || []).includes('rain')) applyRaster(); }, 60000);
  return { apply, applyRaster, destroy() { themeWatch.disconnect(); clearTimeout(settle); clearInterval(rainTimer); } };
}

/* ---------- drawing helpers ---------- */
// Text with a dark halo, readable on every map.
function zpText(g, text, x, y, { font, color = '#fff', halo = 'rgba(5,9,16,0.92)', align = 'left', base = 'middle', width = 3 } = {}) {
  if (font) g.font = font;
  g.textAlign = align; g.textBaseline = base;
  g.lineJoin = 'round';
  g.lineWidth = width; g.strokeStyle = halo; g.strokeText(text, x, y);
  g.fillStyle = color; g.fillText(text, x, y);
}
// A label in a small dark box (used on routes, tapes and cards on the map).
function zpTag(g, lines, x, y, { font, accent = '#ffb941', align = 'left', pad = 5 } = {}) {
  g.font = font;
  const px = +((/([\d.]+)px/.exec(font) || [])[1]) || 11;
  const lh = px * 1.25;
  const wid = Math.max(...lines.map((l) => g.measureText(l.text || l).width)) + pad * 2 + 3;
  const hgt = lines.length * lh + pad * 1.2;
  const x0 = align === 'center' ? x - wid / 2 : align === 'right' ? x - wid : x;
  g.fillStyle = 'rgba(7,13,24,0.9)';
  g.beginPath(); g.roundRect(x0, y - hgt / 2, wid, hgt, 4); g.fill();
  g.fillStyle = accent; g.fillRect(x0, y - hgt / 2, 3, hgt);
  g.textBaseline = 'top'; g.textAlign = 'left';
  lines.forEach((l, i) => {
    g.fillStyle = l.color || (i === 0 ? '#ffffff' : '#c6d4e8');
    if (l.font) g.font = l.font; else g.font = font;
    g.fillText(l.text || l, x0 + pad + 3, y - hgt / 2 + pad * 0.6 + i * lh);
  });
  return { x: x0, y: y - hgt / 2, w: wid, h: hgt };
}
// A short label in a dark pill with a coloured edge, set beside a point along the normal (nx, ny): the
// box carries its own background, so it reads the same on the light, dark and satellite maps.
// With avoid (a list of {x, y, w, h}) it leaves out a label that would overlap one of them, and adds its own box.
function zpPill(g, text, x, y, nx, ny, { font, accent = '#ffb941', gap = 9, avoid = null } = {}) {
  g.font = font;
  const px = +((/([\d.]+)px/.exec(font) || [])[1]) || 11;
  const w = g.measureText(text).width + px, h = px * 1.55;
  // From the point out along the normal, far enough that the nearest corner stays clear of the line.
  const d = gap + Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2;
  const cx = x + nx * d, cy = y + ny * d;
  const box = { x: cx - w / 2 - 2, y: cy - h / 2 - 2, w: w + 4, h: h + 4 };
  if (avoid) {
    if (avoid.some((r) => box.x < r.x + r.w && r.x < box.x + box.w && box.y < r.y + r.h && r.y < box.y + box.h)) return null;
    avoid.push(box);
  }
  g.beginPath(); g.roundRect(cx - w / 2, cy - h / 2, w, h, h / 2);
  g.fillStyle = 'rgba(7,13,24,0.92)'; g.fill();
  g.lineWidth = 1.6; g.strokeStyle = accent; g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#ffffff';
  g.fillText(text, cx, cy + 0.5);
  return box;
}
