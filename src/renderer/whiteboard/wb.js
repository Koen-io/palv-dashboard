'use strict';

/* ============================================================
   Whiteboard: snel aantekeningen maken, met de vinger of de muis, en meteen op alle schermen zichtbaar.
   Pen, markeerstift, lijnen en pijlen, vormen, tekst en de iconen uit wb-icons.js; een stuk kaart
   (satelliet, kaart, topografisch, luchtfoto, VFR) als ondergrond; verplaatsen, draaien en schalen;
   zoomen (ook met twee vingers); borden bewaren en laden; wie meekijkt en meetekent is te zien met
   naam en cursor.
   ============================================================ */
// A board is an item (OPS kind 'boards', list 'boards': name, bg, thumb, createdAt, by) and every element
// on it is an item of its own in 'elements' ({ board, type, ... }), so two screens can draw on one board
// at once: each stroke, shape or icon is saved the moment it is finished, and the other screens have it
// within a tenth of a second. While a stroke is still being drawn it is sent along live (never stored),
// with the cursor and the name of the screen, so the others see it grow.
// Element types: path (pts, color, width, marker), line (x1 y1 x2 y2, arrow), rect, ellipse (x y w h,
// fill), text (x y text size), icon (x y icon size), map (x y w h, lat lon zoom base seamark lock: a piece
// of map, drawn from the tile cache on every screen; one board unit is one map pixel at `zoom`).
// All in board units; `rot` in degrees about the centre.
const WB_TOOLS = {
  select: { name: 'Selecteren', icon: 'target', key: 'V', hint: 'Tik op een element om het te kiezen en sleep het; draai aan de ronde greep of met twee vingers, schaal aan de hoeken. Sleep op leeg om het bord te verschuiven.' },
  pan: { name: 'Verschuiven', icon: 'swap', key: 'H', hint: 'Sleep om het bord te verschuiven; twee vingers knijpen om te zoomen.' },
  pen: { name: 'Pen', icon: 'edit', key: 'P', hint: 'Tekenen uit de vrije hand. Druk even op een object om het op te pakken en te verslepen.' },
  farrow: { name: 'Vrije pijl', icon: 'route', key: 'F', hint: 'Teken uit de vrije hand: aan het eind komt vanzelf een pijlpunt, in de richting waarin je eindigde.' },
  marker: { name: 'Markeerstift', icon: 'note', key: 'M', hint: 'Brede, doorzichtige streek.' },
  line: { name: 'Lijn', icon: 'min', key: 'L', hint: 'Sleep van A naar B; de nieuwe lijn is meteen geselecteerd om te verslepen of te draaien.' },
  arrow: { name: 'Pijl', icon: 'arrowUp', key: 'A', hint: 'Sleep van A naar B: de punt komt bij B. De nieuwe pijl is meteen te verslepen en te draaien.' },
  rect: { name: 'Rechthoek', icon: 'max', key: 'R', hint: 'Sleep een rechthoek.' },
  ellipse: { name: 'Ellips', icon: 'globe', key: 'E', hint: 'Sleep een ellips of cirkel.' },
  text: { name: 'Tekst', icon: 'keyboard', key: 'T', hint: 'Tik waar de tekst moet komen en typ; sleep een tekst om haar te verplaatsen, tik erop om te bewerken.' },
  icon: { name: 'Icoon', icon: 'star', key: 'I', hint: 'Kies een icoon en tik of sleep het op het bord. Een geplaatst icoon pak je direct vast; draai het aan de ronde greep of met twee vingers.' },
  eraser: { name: 'Gum', icon: 'trash', key: 'X', hint: 'Tik op een element om het te verwijderen; sleep om er meer te wissen.' },
};
const WB_COLORS = ['#0a0f18', '#ffffff', '#ff4b55', '#ff9f1c', '#ffe14d', '#3ecf6e', '#3d9bff', '#b48cff', '#ff6fd8', '#8ea2bf', '#8b5a2b', '#00c2c7'];
const WB_WIDTHS = [2, 4, 7, 12];
// Backgrounds; `light` says which pen colour reads on it. White is the standard.
const WB_BG = {
  white: { name: 'Wit', fill: '#ffffff', dot: 'rgba(31,79,147,0.28)', light: true },
  light: { name: 'Lichtgrijs', fill: '#eef1f6', dot: 'rgba(31,79,147,0.25)', light: true },
  paper: { name: 'Papier', fill: '#f7f1e3', dot: 'rgba(120,90,40,0.3)', light: true },
  dark: { name: 'Donker', fill: '#0b1320', dot: 'rgba(143,183,230,0.22)' },
  black: { name: 'Zwart', fill: '#000000', dot: 'rgba(255,255,255,0.2)' },
  green: { name: 'Krijtbord', fill: '#1d3b2a', dot: 'rgba(255,255,255,0.18)' },
};
const WB_PRESENCE_MS = 9000;
// The maps a piece of the board can show: the tile sources of Zoek & Plan (kept on disk for 30 days), from
// the bottom up, each with the zoom it goes to. `pick` is the Zoek & Plan base shown while choosing.
const WB_MAPS = {
  osm: { name: 'Kaart (OpenStreetMap)', short: 'Kaart', layers: [['osm', 19]], pick: 'osmLight', attr: '© OpenStreetMap-bijdragers' },
  sat: { name: 'Satelliet + luchtfoto NL', short: 'Satelliet', layers: [['s2', 15], ['foto', 19]], pick: 'sat', attr: '© EOX (Copernicus Sentinel-2) · PDOK luchtfoto' },
  s2: { name: 'Satelliet wereld (Sentinel-2)', short: 'Satelliet wereld', layers: [['s2', 15]], pick: 's2', attr: 'Sentinel-2 cloudless © EOX' },
  brt: { name: 'Topografisch NL (PDOK)', short: 'Topo NL', layers: [['osm', 19], ['brt', 19]], pick: 'brt', attr: '© Kadaster / PDOK' },
  brtgrijs: { name: 'Topografisch NL grijs', short: 'Topo grijs', layers: [['osm', 19], ['brtgrijs', 19]], pick: 'brtgrijs', attr: '© Kadaster / PDOK' },
  topo: { name: 'Topografisch wereld (OpenTopoMap)', short: 'Topo wereld', layers: [['topo', 17]], pick: 'topo', attr: '© OpenTopoMap' },
  vfr: { name: 'VFR-luchtvaartkaart (openFlightMaps)', short: 'VFR', layers: [['ofmbase', 12], ['ofmaero', 12]], pick: 'vfr', attr: '© openFlightMaps' },
};
const WB_ASPECTS = { '16:9': 16 / 9, '4:3': 4 / 3, '1:1': 1, '3:4': 3 / 4, 'A4': 297 / 210 };

/* ---------- Web Mercator, the way the tiles are cut ---------- */
// World pixels at zoom z (fractional allowed) of a point, and back.
const wbMerc = (lat, lon, z) => { const s = 256 * 2 ** z, la = clamp(lat, -85.0511, 85.0511), sin = Math.sin((la * Math.PI) / 180); return [s * (lon / 360 + 0.5), s * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI))]; };
const wbUnmerc = (px, py, z) => { const s = 256 * 2 ** z, n = Math.PI - (2 * Math.PI * py) / s; return [(180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), (px / s - 0.5) * 360]; };
// Metres per board unit (= per pixel at the element's zoom) at a latitude.
const wbMetresPerUnit = (lat, z) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
// Tiles for the canvas: one image per source, zoom and tile, loaded once; CORS-clean through palvtile://.
const wbTileCache = new Map();
function wbTile(src, z, x, y, onReady) {
  const n = 2 ** z;
  if (y < 0 || y >= n) return null;
  const xx = ((x % n) + n) % n;
  const key = `${src}/${z}/${xx}/${y}`;
  let t = wbTileCache.get(key);
  if (t) return t;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  t = { img, ready: false, failed: false };
  img.onload = () => { t.ready = true; if (onReady) onReady(); };
  img.onerror = () => { t.failed = true; };
  img.src = `palvtile://${src}/${z}/${xx}/${y}`;
  wbTileCache.set(key, t);
  if (wbTileCache.size > 2500) wbTileCache.delete(wbTileCache.keys().next().value);
  return t;
}

function wbCfg(w) {
  const c = w.cfg;
  // Before 1.29 the board was dark and the pen white; on the white board of today a white pen is invisible.
  if (c.bg === undefined && c.color === '#ffffff') c.color = '#0a0f18';
  for (const [k, v] of Object.entries({ boardId: null, side: true, sideTab: 'draw', tool: 'pen', color: '#0a0f18', width: 4, fill: false, fontSize: 18, iconSize: 80, grid: true, views: {}, iconId: 'aw139', bg: 'white', map: { base: 'sat', seamark: false, aspect: '16:9' } })) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(v));
  if (!c.views || typeof c.views !== 'object') c.views = {};
  if (!c.map || typeof c.map !== 'object') c.map = { base: 'sat', seamark: false, aspect: '16:9' };
  if (!WB_BG[c.bg]) c.bg = 'white';
  return c;
}

function wbCreate(body, w) {
  const cfg = wbCfg(w);
  const root = h('div', { class: 'wb' });
  const bar = h('div', { class: 'zp-bar wb-bar' });
  const side = h('aside', { class: 'wb-side' });
  const stage = h('div', { class: 'wb-stage' });
  const cv = h('canvas', { class: 'wb-canvas' });
  const hud = h('div', { class: 'wb-hud' });
  stage.append(cv, hud);
  root.append(bar, h('div', { class: 'wb-body' }, side, stage));
  body.append(root);
  root.classList.toggle('side-off', !cfg.side);
  const g = cv.getContext('2d');

  /* ---------- state ---------- */
  let els = [];               // elements of this board, in drawing order
  let sel = null;             // selected element id
  let view = { x: 0, y: 0, k: 1 };
  let dpr = 1, queued = false;
  let drawing = null;         // the element being made: { e, start, lastLive, liveFrom }
  let drag = null;            // moving/rotating/scaling: { mode, e0, start, ... }
  const pointers = new Map(); // active pointers for pinch
  let pinch = null;
  const remote = new Map();   // screen id -> { name, cur, at, stroke, color }
  // Undo and redo, per board (drawkit.js), with every button that shows them.
  const undoBars = new Set();
  const hist = dkHistory(() => paintUndo());
  let textBox = null;
  let thumbTimer = null, presenceTimer = null;
  const board = () => (cfg.boardId ? OPS.get('boards', 'boards', cfg.boardId) : null);
  // Locked on another screen and no PIN entered here: nothing to see, nothing to draw.
  const lockedOut = () => { const b = board(); return !!(b && b.lock && !b.lockOpen); };
  let cover = null;
  const bgOf = () => WB_BG[(board() || {}).bg || cfg.bg] || WB_BG.white;
  const isLight = () => !!bgOf().light;
  // The grid: none, dots (the standard) or lines; before 1.49 it was on (dots) or off.
  const gridMode = () => (cfg.grid === false || cfg.grid === 'off' ? 'off' : cfg.grid === 'lines' ? 'lines' : 'dots');

  const toWorld = (sx, sy) => [(sx - view.x) / view.k, (sy - view.y) / view.k];
  const toScreen = (wx, wy) => [wx * view.k + view.x, wy * view.k + view.y];
  const saveView = () => { if (cfg.boardId) { cfg.views[cfg.boardId] = { x: Math.round(view.x), y: Math.round(view.y), k: +view.k.toFixed(4) }; save(); } };
  const loadView = () => { const v = cfg.boardId && cfg.views[cfg.boardId]; view = v ? { ...v } : { x: stage.clientWidth / 2, y: stage.clientHeight / 2, k: 1 }; };

  function reload() {
    els = cfg.boardId ? OPS.list('boards', 'elements').filter((e) => e.board === cfg.boardId && !e.locked).sort((a, b) => (a.z || 0) - (b.z || 0) || a.updatedAt - b.updatedAt) : [];
    if (sel && !els.some((e) => e.id === sel)) sel = null;
    stage.classList.toggle('light', isLight());
    const b = board();
    if (lockedOut()) { if (cover) cover.remove(); cover = lockedCover('boards', b, () => { reload(); paintBar(); paintSide(); }); stage.append(cover); if (textBox) cancelText(); drawing = null; drag = null; }
    else if (cover) { cover.remove(); cover = null; }
    request();
  }
  // There is always a board to draw on: the one of this screen, else the newest of the unit, else a new one.
  function ensureBoard() {
    if (cfg.boardId && board()) return true;
    if (!OPS.loaded) return false;
    const list = OPS.list('boards', 'boards').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (list.length) { openBoard(list[0].id); return true; }
    const id = OPS.uid();
    OPS.put('boards', 'boards', id, { name: 'Bord 1', bg: cfg.bg, createdAt: Date.now(), by: OPS.screen.name, n: 0 });
    openBoard(id);
    return true;
  }

  /* ---------- geometry (drawkit.js) ---------- */
  const rad = DK.rad;
  const box = (e) => DK.box(e, measure);
  const centre = (e) => DK.centre(e, measure);
  function measure(text, size) { g.font = `600 ${size}px ${getComputedStyle(document.body).fontFamily}`; return g.measureText(text).width; }
  // Board units a finger or the mouse may be off and still hit an element.
  const tolW = () => (TOUCH.on() ? 14 : 8) / view.k;
  // The element under a board point, topmost first. A locked map is left alone (it is an underlay), unless asked for.
  const hit = (wx, wy, { maps = false } = {}) => DK.hit(els, wx, wy, { tol: tolW(), measure, maps });
  const mapAt = (wx, wy) => { for (let i = els.length - 1; i >= 0; i -= 1) { const e = els[i]; if (e.type !== 'map') continue; const b = box(e); if (wx >= b.x && wy >= b.y && wx <= b.x + b.w && wy <= b.y + b.h) return e; } return null; };
  // Where a board point is on a map element.
  const mapLatLon = (e, wx, wy) => { const [cx, cy] = wbMerc(e.lat, e.lon, e.zoom); return wbUnmerc(cx - e.w / 2 + (wx - e.x), cy - e.h / 2 + (wy - e.y), e.zoom); };
  const moveBy = DK.moveBy;

  /* ---------- saving ---------- */
  const nextZ = () => (els.length ? Math.max(...els.map((e) => e.z || 0)) + 1 : 1);
  const lowZ = () => (els.length ? Math.min(...els.map((e) => e.z || 0)) - 1 : 0);
  const clean = (e) => { const o = { ...e }; delete o.id; delete o.updatedAt; if (o.type === 'path') o.pts = o.pts.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]); return o; };
  function commit(e, before) {
    if (!ensureBoard()) { toast('De gedeelde bestanden zijn nog niet geladen', true); return; }
    if (lockedOut()) { toast('Dit bord is vergrendeld: voer eerst de pincode in', true); return; }
    const id = e.id || OPS.uid();
    const fresh = !e.id;
    e.id = id; e.board = cfg.boardId; e.by = OPS.screen.name;
    if (e.z === 0 && fresh) e.z = lowZ(); else if (e.z == null) e.z = nextZ();
    hist.push(cfg.boardId, [{ id, before: before ? clean(before) : null, after: clean(e) }]);
    OPS.put('boards', 'elements', id, clean(e));
    scheduleThumb();
  }
  function remove(e) {
    hist.push(cfg.boardId, [{ id: e.id, before: clean(e), after: null }]);
    OPS.put('boards', 'elements', e.id, null);
    if (sel === e.id) sel = null;
    scheduleThumb();
  }
  // One step back (or forward with `forward`): whatever that step changed, in one write.
  function doUndo(forward) {
    if (!cfg.boardId || lockedOut()) return;
    if (textBox) commitText();
    const items = hist.take(cfg.boardId, forward);
    if (!items) return;
    OPS.putMany('boards', items.map(({ id, item }) => ({ list: 'elements', id, item: item ? { ...item, board: cfg.boardId } : null })));
    // What came back is shown selected (one element), so it is clear what changed.
    const back = items.filter((x) => x.item);
    sel = back.length === 1 ? back[0].id : null;
    request();
    if (cfg.sideTab === 'draw') paintSide();
    scheduleThumb();
  }
  const undoBar = (opt = {}) => { const b = dkUndoButtons({ undo: () => doUndo(false), redo: () => doUndo(true), count: () => (cfg.boardId ? hist.count(cfg.boardId) : { undo: 0, redo: 0 }), ...opt }); undoBars.add(b); return b; };
  function paintUndo() { for (const b of undoBars) { if (b.isConnected) b.paint(); else if (b.dataset.seen) undoBars.delete(b); else b.dataset.seen = '1'; } }
  // A small picture of the board for the list, after a change (2.5 s of quiet).
  function scheduleThumb() { clearTimeout(thumbTimer); thumbTimer = setTimeout(makeThumb, 2500); }
  function makeThumb() {
    const b = board();
    if (!b) return;
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const gg = c.getContext('2d');
    gg.fillStyle = bgOf().fill; gg.fillRect(0, 0, 320, 180);
    if (els.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const e of els) { const bb = box(e); x0 = Math.min(x0, bb.x); y0 = Math.min(y0, bb.y); x1 = Math.max(x1, bb.x + bb.w); y1 = Math.max(y1, bb.y + bb.h); }
      const k = Math.min(300 / Math.max(40, x1 - x0), 160 / Math.max(40, y1 - y0), 2);
      const v = { x: 160 - ((x0 + x1) / 2) * k, y: 90 - ((y0 + y1) / 2) * k, k };
      for (const e of els) drawEl(gg, e, v, false, 1);
    }
    let thumb = null;
    try { thumb = c.toDataURL('image/jpeg', 0.62); } catch { return; }
    if (thumb !== b.thumb) OPS.put('boards', 'boards', b.id, { ...b, thumb, n: els.length });
  }

  /* ---------- drawing ---------- */
  function size() {
    dpr = window.devicePixelRatio || 1;
    const r = stage.getBoundingClientRect();
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px';
  }
  const request = () => { if (!queued) { queued = true; requestAnimationFrame(paint); } };
  wbIconCache.onReady = request;
  function strokePath(gg, pts, v) {
    if (!pts.length) return;
    const P = (p) => [p[0] * v.k + v.x, p[1] * v.k + v.y];
    gg.beginPath();
    const p0 = P(pts[0]);
    gg.moveTo(p0[0], p0[1]);
    if (pts.length < 3) { for (let i = 1; i < pts.length; i += 1) { const p = P(pts[i]); gg.lineTo(p[0], p[1]); } if (pts.length === 1) gg.lineTo(p0[0] + 0.1, p0[1]); gg.stroke(); return; }
    for (let i = 1; i < pts.length - 1; i += 1) { const a = P(pts[i]), b = P(pts[i + 1]); gg.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    const last = P(pts[pts.length - 1]);
    gg.lineTo(last[0], last[1]);
    gg.stroke();
  }
  // The halo behind text and labels: dark behind a light colour, light behind a dark one, so it reads on
  // every background and on a map.
  const haloColor = (color) => { const m = /^#([0-9a-f]{6})$/i.exec(color || ''); if (!m) return isLight() ? 'rgba(10,15,24,0.85)' : 'rgba(255,255,255,0.9)'; const n = parseInt(m[1], 16); const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return lum > 0.55 ? 'rgba(10,15,24,0.85)' : 'rgba(255,255,255,0.9)'; };
  // A piece of map: the tiles of its sources at the zoom that is sharp for the view, clipped to its frame,
  // with a scale bar, a north arrow and the source. `dp` is the pixel density the tiles are picked for.
  function drawMap(gg, e, v, dp) {
    const def = WB_MAPS[e.base] || WB_MAPS.osm;
    const x0 = e.x * v.k + v.x, y0 = e.y * v.k + v.y, W = e.w * v.k, H = e.h * v.k;
    gg.save();
    gg.beginPath(); gg.rect(x0, y0, W, H); gg.clip();
    gg.fillStyle = '#9db4c8'; gg.fillRect(x0, y0, W, H);
    const [cx, cy] = wbMerc(e.lat, e.lon, e.zoom);
    const left = cx - e.w / 2, top = cy - e.h / 2;
    const layers = [...def.layers];
    if (e.seamark) layers.push(['seamark', 18]);
    for (const [src, max] of layers) {
      let zi = clamp(Math.round(e.zoom + Math.log2(v.k * dp)), 1, max);
      // Never more than ~400 tiles for one piece of map.
      while (zi > 1 && (e.w * 2 ** (zi - e.zoom) / 256) * (e.h * 2 ** (zi - e.zoom) / 256) > 400) zi -= 1;
      const f = 2 ** (zi - e.zoom);                  // tile pixels per board unit
      const L = left * f, T = top * f;
      const tx0 = Math.floor(L / 256), tx1 = Math.floor((L + e.w * f) / 256), ty0 = Math.floor(T / 256), ty1 = Math.floor((T + e.h * f) / 256);
      const tilePx = (256 / f) * v.k;
      for (let tx = tx0; tx <= tx1; tx += 1) for (let ty = ty0; ty <= ty1; ty += 1) {
        const t = wbTile(src, zi, tx, ty, request);
        if (!t || !t.ready) continue;
        const sx = x0 + ((tx * 256 - L) / f) * v.k, sy = y0 + ((ty * 256 - T) / f) * v.k;
        try { gg.drawImage(t.img, sx, sy, tilePx + 0.5, tilePx + 0.5); } catch { /* a broken tile */ }
      }
    }
    // Scale bar (a round number of metres or kilometres), north arrow, source.
    const px = Math.max(9, Math.min(13, 11 * Math.sqrt(v.k)));
    const font = `700 ${px}px ${getComputedStyle(document.body).fontFamily}`;
    if (W > 120 && H > 70) {
      const mpu = wbMetresPerUnit(e.lat, e.zoom) / v.k; // metres per screen pixel
      const want = Math.min(W / 3.5, 220);
      const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];
      let m = nice[0]; for (const n of nice) if (n / mpu <= want) m = n;
      const len = m / mpu;
      const bx = x0 + 10, by = y0 + H - 12;
      gg.lineWidth = 4; gg.strokeStyle = 'rgba(255,255,255,0.9)'; gg.beginPath(); gg.moveTo(bx, by); gg.lineTo(bx + len, by); gg.stroke();
      gg.lineWidth = 2; gg.strokeStyle = '#0a0f18'; gg.beginPath(); gg.moveTo(bx, by); gg.lineTo(bx + len, by); gg.moveTo(bx, by - 4); gg.lineTo(bx, by + 4); gg.moveTo(bx + len, by - 4); gg.lineTo(bx + len, by + 4); gg.stroke();
      const txt = m >= 1000 ? `${m / 1000} km · ${(m / 1852).toFixed(m >= 5000 ? 0 : 1)} NM` : `${m} m`;
      zpText(gg, txt, bx, by - 9, { font, color: '#fff', halo: 'rgba(5,9,16,0.9)' });
      // North arrow, top right.
      const nx = x0 + W - 16, ny = y0 + 16;
      gg.fillStyle = 'rgba(255,255,255,0.92)'; gg.strokeStyle = '#0a0f18'; gg.lineWidth = 1.2;
      gg.beginPath(); gg.moveTo(nx, ny - 11); gg.lineTo(nx + 5, ny + 7); gg.lineTo(nx, ny + 3); gg.lineTo(nx - 5, ny + 7); gg.closePath(); gg.fill(); gg.stroke();
      zpText(gg, 'N', nx, ny + 16, { font: `800 ${px}px ${getComputedStyle(document.body).fontFamily}`, color: '#fff', halo: 'rgba(5,9,16,0.9)', align: 'center' });
      zpText(gg, def.attr, x0 + W - 6, y0 + H - 7, { font: `500 ${Math.max(8, px - 3)}px ${getComputedStyle(document.body).fontFamily}`, color: 'rgba(255,255,255,0.85)', halo: 'rgba(5,9,16,0.7)', align: 'right', width: 2 });
    }
    gg.restore();
    // The frame.
    gg.lineWidth = Math.max(1, 1.5 * Math.min(1, v.k)); gg.strokeStyle = e.lock ? 'rgba(10,15,24,0.55)' : '#ffd21f';
    gg.strokeRect(x0, y0, W, H);
  }
  function drawEl(gg, e, v, ghost, dp = dpr) {
    gg.save();
    gg.globalAlpha = (e.opacity != null ? e.opacity : 1) * (ghost ? 0.7 : 1);
    gg.lineCap = 'round'; gg.lineJoin = 'round';
    gg.strokeStyle = e.color || '#fff'; gg.fillStyle = e.color || '#fff';
    const lw = Math.max(0.6, (e.width || 4) * v.k);
    if (e.rot && e.type !== 'path' && e.type !== 'line' && e.type !== 'map') { const [cx, cy] = centre(e); const [sx, sy] = [cx * v.k + v.x, cy * v.k + v.y]; gg.translate(sx, sy); gg.rotate(rad(e.rot)); gg.translate(-sx, -sy); }
    if (e.type === 'map') {
      drawMap(gg, e, v, dp);
    } else if (e.type === 'path') {
      gg.lineWidth = e.marker ? lw * 3 : lw;
      if (e.marker) gg.globalAlpha *= 0.4;
      strokePath(gg, e.pts, v);
      // A free arrow: the head at the end, in the direction the stroke ended.
      const hd = e.arrow && !e.marker && DK.pathHead(e.pts, e.width || 4);
      if (hd) { const tx = hd.x * v.k + v.x, ty = hd.y * v.k + v.y, L = Math.max(10, hd.L * v.k); gg.beginPath(); gg.moveTo(tx + Math.cos(hd.a) * lw * 0.6, ty + Math.sin(hd.a) * lw * 0.6); gg.lineTo(tx - L * Math.cos(hd.a - 0.45), ty - L * Math.sin(hd.a - 0.45)); gg.lineTo(tx - L * Math.cos(hd.a + 0.45), ty - L * Math.sin(hd.a + 0.45)); gg.closePath(); gg.fill(); }
    } else if (e.type === 'line') {
      const a = [e.x1 * v.k + v.x, e.y1 * v.k + v.y], b = [e.x2 * v.k + v.x, e.y2 * v.k + v.y];
      gg.lineWidth = lw;
      if (e.dash) gg.setLineDash([lw * 3, lw * 2]);
      gg.beginPath(); gg.moveTo(a[0], a[1]); gg.lineTo(b[0], b[1]); gg.stroke();
      gg.setLineDash([]);
      const head = (from, to) => { const ang = Math.atan2(to[1] - from[1], to[0] - from[0]), L = Math.max(10, lw * 3.5); gg.beginPath(); gg.moveTo(to[0], to[1]); gg.lineTo(to[0] - L * Math.cos(ang - 0.45), to[1] - L * Math.sin(ang - 0.45)); gg.lineTo(to[0] - L * Math.cos(ang + 0.45), to[1] - L * Math.sin(ang + 0.45)); gg.closePath(); gg.fill(); };
      if (e.arrow === 'end' || e.arrow === 'both') head(a, b);
      if (e.arrow === 'both') head(b, a);
    } else if (e.type === 'rect' || e.type === 'ellipse') {
      const b = box(e), x = b.x * v.k + v.x, y = b.y * v.k + v.y, wd = b.w * v.k, hg = b.h * v.k;
      gg.lineWidth = lw;
      gg.beginPath();
      if (e.type === 'rect') gg.roundRect(x, y, wd, hg, Math.min(6 * v.k, wd / 4, hg / 4)); else gg.ellipse(x + wd / 2, y + hg / 2, Math.max(1, wd / 2), Math.max(1, hg / 2), 0, 0, Math.PI * 2);
      if (e.fill) { gg.globalAlpha *= 0.28; gg.fill(); gg.globalAlpha = (e.opacity != null ? e.opacity : 1) * (ghost ? 0.7 : 1); }
      gg.stroke();
    } else if (e.type === 'text') {
      const px = e.size * v.k;
      gg.font = `600 ${px}px ${getComputedStyle(document.body).fontFamily}`;
      gg.textBaseline = 'top'; gg.textAlign = 'left';
      const lines = String(e.text || '').split('\n');
      lines.forEach((l, i) => { const x = e.x * v.k + v.x, y = e.y * v.k + v.y + i * px * 1.25; if (e.halo !== false) { gg.lineWidth = Math.max(2, px * 0.18); gg.strokeStyle = haloColor(e.color); gg.strokeText(l, x, y); } gg.fillText(l, x, y); });
    } else if (e.type === 'icon') {
      const px = Math.max(8, e.size * v.k);
      const im = wbIconImage(e.icon, e.color || '#fff', Math.min(2048, Math.ceil(px * dp)));
      const x = e.x * v.k + v.x, y = e.y * v.k + v.y;
      if (im && im.ready) gg.drawImage(im.img, x - px / 2, y - px / 2, px, px);
      else { gg.lineWidth = 1.5; gg.strokeRect(x - px / 2, y - px / 2, px, px); }
      // The label stays upright under the icon, however the icon is turned.
      if (e.label) { if (e.rot) { gg.restore(); gg.save(); gg.globalAlpha = (e.opacity != null ? e.opacity : 1) * (ghost ? 0.7 : 1); gg.fillStyle = e.color || '#fff'; } gg.font = `700 ${Math.max(9, e.size * 0.22 * v.k)}px ${getComputedStyle(document.body).fontFamily}`; gg.textAlign = 'center'; gg.textBaseline = 'top'; gg.lineWidth = 3; gg.strokeStyle = haloColor(e.color); gg.strokeText(e.label, x, y + px / 2 + 2); gg.fillText(e.label, x, y + px / 2 + 2); }
    }
    gg.restore();
  }
  function paint() {
    queued = false;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cv.width / dpr, H = cv.height / dpr;
    const bg = bgOf();
    g.fillStyle = bg.fill; g.fillRect(0, 0, W, H);
    // Dots every 50 units, when they are far enough apart to see.
    const gm = gridMode();
    if (gm === 'dots') {
      // Dots every 50 units, when they are far enough apart to see.
      const step = 50 * view.k;
      if (step >= 14) {
        g.fillStyle = bg.dot;
        const x0 = ((view.x % step) + step) % step, y0 = ((view.y % step) + step) % step;
        for (let x = x0; x < W; x += step) for (let y = y0; y < H; y += step) { g.beginPath(); g.arc(x, y, step > 40 ? 1.6 : 1.1, 0, Math.PI * 2); g.fill(); }
        const [ox, oy] = toScreen(0, 0);
        g.strokeStyle = bg.dot; g.lineWidth = 1; g.beginPath(); g.moveTo(ox - 12, oy); g.lineTo(ox + 12, oy); g.moveTo(ox, oy - 12); g.lineTo(ox, oy + 12); g.stroke();
      }
    } else if (gm === 'lines') {
      // Squared paper: fine lines every 50 units (when far enough apart), stronger ones every 250.
      const lines = (unit, width, alpha) => {
        const step = unit * view.k;
        if (step < 10) return;
        g.save(); g.strokeStyle = bg.dot; g.globalAlpha = alpha; g.lineWidth = width; g.beginPath();
        const x0 = ((view.x % step) + step) % step, y0 = ((view.y % step) + step) % step;
        for (let x = x0; x < W; x += step) { const px = Math.round(x) + 0.5; g.moveTo(px, 0); g.lineTo(px, H); }
        for (let y = y0; y < H; y += step) { const py = Math.round(y) + 0.5; g.moveTo(0, py); g.lineTo(W, py); }
        g.stroke(); g.restore();
      };
      lines(50, 1, 0.75);
      lines(250, 1.6, 1);
    }
    for (const e of els) drawEl(g, e, view);
    if (drawing) drawEl(g, drawing.e, view);
    // Strokes still being drawn elsewhere, and the cursors of the others.
    const now = Date.now();
    for (const [id, r] of remote) {
      if (now - r.at > WB_PRESENCE_MS) { remote.delete(id); continue; }
      if (r.stroke && r.stroke.pts.length) drawEl(g, r.stroke, view, true);
      if (r.cur) {
        const [x, y] = toScreen(r.cur[0], r.cur[1]);
        g.save();
        g.fillStyle = r.color; g.strokeStyle = '#000'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + 12, y + 5); g.lineTo(x + 5, y + 12); g.closePath(); g.fill(); g.stroke();
        g.font = `700 11px ${getComputedStyle(document.body).fontFamily}`; g.textBaseline = 'top';
        const tw = g.measureText(r.name).width + 10;
        g.fillStyle = r.color; g.beginPath(); g.roundRect(x + 12, y + 12, tw, 17, 4); g.fill();
        g.fillStyle = '#0a0f18'; g.fillText(r.name, x + 17, y + 15);
        g.restore();
      }
    }
    // The selection: a frame with grips over the canvas (drawkit.js).
    selUi.paint(selEl());
    paintHud();
  }

  /* ---------- the hud: zoom, presence, coordinates ---------- */
  const zoomLbl = h('span', { class: 'wb-zoom' });
  const presence = h('div', { class: 'wb-presence' });
  const modeHint = h('div', { class: 'wb-modehint' });
  const coordLbl = h('div', { class: 'wb-coord', hidden: true });
  hud.append(undoBar({ big: true }));
  hud.append(h('div', { class: 'wb-hud-tl' }, modeHint, presence), h('div', { class: 'wb-hud-bl' }, coordLbl), h('div', { class: 'wb-hud-br' },
    h('button', { class: 'wb-hbtn', title: 'Uitzoomen (-)', onclick: () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.25) }, '−'),
    zoomLbl,
    h('button', { class: 'wb-hbtn', title: 'Inzoomen (+)', onclick: () => zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25) }, '+'),
    h('button', { class: 'wb-hbtn', title: 'Alles in beeld (0)', onclick: fitAll }, icon('target'))));
  function paintHud() {
    zoomLbl.textContent = `${Math.round(view.k * 100)}%`;
    const now = Date.now();
    const names = [...remote.values()].filter((r) => now - r.at <= WB_PRESENCE_MS);
    const sig = names.map((r) => r.name + r.color).join('|') + (cfg.tool || '');
    if (presence.dataset.sig !== sig) {
      presence.dataset.sig = sig;
      presence.replaceChildren(...names.map((r) => h('span', { class: 'wb-who', style: `--c:${r.color}` }, h('i'), r.name)));
      presence.hidden = !names.length;
      const t = WB_TOOLS[cfg.tool];
      modeHint.replaceChildren(icon(t.icon), h('b', {}, cfg.tool === 'icon' ? (wbIconById(cfg.iconId) || {}).name || t.name : t.name), h('span', {}, t.hint));
    }
  }
  function paintCoord(wx, wy) {
    const m = wx != null && mapAt(wx, wy);
    if (!m) { if (!coordLbl.hidden) coordLbl.hidden = true; return; }
    const [lat, lon] = mapLatLon(m, wx, wy);
    coordLbl.hidden = false;
    coordLbl.textContent = `${PlanCoords.fmt(lat, lon, 'ddm')} · ${PlanCoords.fmt(lat, lon, 'dd')}`;
  }
  function zoomAt(sx, sy, f) {
    const k = clamp(view.k * f, 0.08, 12);
    const [wx, wy] = toWorld(sx, sy);
    view.k = k; view.x = sx - wx * k; view.y = sy - wy * k;
    request(); saveView();
  }
  function fitAll(list) {
    const items = Array.isArray(list) ? list : els;
    if (!items.length) { view = { x: stage.clientWidth / 2, y: stage.clientHeight / 2, k: 1 }; request(); saveView(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const e of items) { const b = box(e); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    const k = clamp(Math.min((stage.clientWidth - 80) / Math.max(50, x1 - x0), (stage.clientHeight - 80) / Math.max(50, y1 - y0)), 0.08, 4);
    view = { k, x: stage.clientWidth / 2 - ((x0 + x1) / 2) * k, y: stage.clientHeight / 2 - ((y0 + y1) / 2) * k };
    request(); saveView();
  }

  /* ---------- live: what the others see of this screen ---------- */
  let liveTimer = null, livePending = null, lastCur = null;
  function liveSend(msg) { if (!cfg.boardId) return; OPS.live({ t: 'wb', b: cfg.boardId, ...msg }); }
  function liveStroke(e, newPts, end) {
    const b = board();
    if (b && b.lock) return;
    if (!livePending) livePending = { id: e.id || (e.id = OPS.uid()), color: e.color, width: e.width, marker: !!e.marker, arrow: e.arrow || undefined, pts: [] };
    livePending.pts.push(...newPts.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]));
    if (end) { liveSend({ cur: lastCur, st: livePending, end: true }); livePending = null; clearTimeout(liveTimer); liveTimer = null; return; }
    if (!liveTimer) liveTimer = setTimeout(() => { liveTimer = null; if (livePending) { liveSend({ cur: lastCur, st: livePending }); livePending.pts = []; } }, 90);
  }
  let curTimer = null;
  function liveCursor(wx, wy) {
    lastCur = [+wx.toFixed(1), +wy.toFixed(1)];
    if (curTimer) return;
    curTimer = setTimeout(() => { curTimer = null; if (!livePending) liveSend({ cur: lastCur }); }, 150);
  }
  const unlive = OPS.onLive((m) => {
    if (!m || m.t !== 'wb' || m.b !== cfg.boardId || !m.from || m.from === OPS.screen.id) return;
    let r = remote.get(m.from);
    if (!r) { r = { name: m.fromName || m.n || 'scherm', cur: null, at: 0, stroke: null, color: WB_COLORS[2 + (remote.size % 7)] }; remote.set(m.from, r); }
    r.at = Date.now();
    if (m.n) r.name = m.n;
    if (m.cur) r.cur = m.cur;
    if (m.st) {
      if (!r.stroke || r.stroke.id !== m.st.id) r.stroke = { type: 'path', id: m.st.id, color: m.st.color, width: m.st.width, marker: m.st.marker, arrow: m.st.arrow, pts: [] };
      r.stroke.pts.push(...(m.st.pts || []));
      if (m.end) { const st = r.stroke; setTimeout(() => { if (r.stroke === st) r.stroke = null; request(); }, 1500); }
    }
    request();
  });

  /* ---------- the selection on screen (drawkit.js) ---------- */
  const selEl = () => (sel && els.find((e) => e.id === sel)) || null;
  const selUi = dkSelection(stage, {
    sel: selEl,
    toScreen: (x, y) => toScreen(x, y),
    toBoard: (cx, cy) => { const r = cv.getBoundingClientRect(); return toWorld(cx - r.left, cy - r.top); },
    k: () => view.k,
    measure,
    live: (fresh) => { const e = selEl(); if (e) { Object.assign(e, fresh); request(); } },
    commit: (e, before) => { commit(e, before); request(); },
    remove: (e) => { remove(e); request(); if (cfg.sideTab === 'draw') paintSide(); },
  });
  function select(id) {
    if (sel === (id || null)) return;
    sel = id || null;
    request();
    if (cfg.sideTab === 'draw') paintSide();
  }

  /* ---------- pointer handling ---------- */
  // Objects are picked up directly: the selected one in every tool; with the icon or text tool any icon or
  // text; with the other tools by pressing on it and holding still a moment (a quick stroke still draws).
  // Two fingers on an object turn, scale and move it; two fingers elsewhere zoom and pan the board.
  const pos = (ev) => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  let hold = null;     // a press held still on an object picks it up
  let pending = null;  // the text tool: a tap opens a text box where it was (on release)
  let lastSel = null;  // the selection just before the first finger came down (it may have tapped beside it)
  const onSel = (wx, wy) => { const s = selEl(); return s && DK.hitOne(s, wx, wy, tolW(), measure) ? s : null; };
  const toolCursor = () => (cfg.tool === 'pan' ? 'grab' : cfg.tool === 'text' ? 'text' : cfg.tool === 'select' ? 'default' : 'crosshair');
  function dropDrawing() {
    if (!drawing) return;
    if (drawing.e.type === 'path' && drawing.e.id) liveStroke(drawing.e, [], true);
    drawing = null;
  }
  function startMove(e, wx, wy) {
    select(e.id);
    drag = { mode: 'move', e0: DK.copy(e), e, start: [wx, wy], moved: false };
    cv.style.cursor = 'grabbing';
  }
  cv.addEventListener('pointerdown', (ev) => {
    if (!ensureBoard()) { toast('Even geduld: de gedeelde bestanden worden geladen'); return; }
    if (lockedOut()) return;
    cv.setPointerCapture(ev.pointerId);
    const [sx, sy] = pos(ev);
    if (!pointers.size) lastSel = sel;
    pointers.set(ev.pointerId, [sx, sy]);
    if (pointers.size === 2) {
      if (hold) { hold.cancel(); hold = null; }
      pending = null;
      // An icon that the first finger was about to place is not placed: two fingers zoom (or turn the selection).
      if (drag && drag.mode === 'place') { drawing = null; drag = null; }
      dropDrawing();
      const [a, b] = [...pointers.values()];
      const wa = toWorld(a[0], a[1]), wb = toWorld(b[0], b[1]);
      const s = selEl() || (lastSel && els.find((e) => e.id === lastSel)) || null;
      const mid = [(wa[0] + wb[0]) / 2, (wa[1] + wb[1]) / 2];
      const held = drag && drag.mode === 'move' ? els.find((e) => e.id === drag.e.id) : null;
      const target = held || (s && !(s.type === 'map' && s.lock) && DK.inBox(s, mid[0], mid[1], 30 / view.k, measure) ? s : null);
      if (target) {
        // Two fingers on an object: turn, scale and move it.
        const before = drag && drag.mode === 'move' && drag.e0 && drag.e0.id === target.id ? drag.e0 : DK.copy(target);
        select(target.id);
        drag = { mode: 'pinch', e: target, before, st: DK.pinchStart(target, wa, wb), moved: false };
        request();
        return;
      }
      // Two fingers elsewhere: pinch to zoom and pan the board.
      drag = null;
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view: { ...view } };
      request();
      return;
    }
    if (pointers.size > 2) return;
    if (ev.button === 1 || ev.button === 2 || cfg.tool === 'pan' || (ev.button === 0 && ev.shiftKey && cfg.tool !== 'select')) { drag = { mode: 'pan', start: [sx, sy], view: { ...view } }; return; }
    const [wx, wy] = toWorld(sx, sy);
    const tool = cfg.tool;
    if (textBox) commitText();
    const target = onSel(wx, wy) || hit(wx, wy);
    const how = DK.grabMode(tool, target, sel);
    if (tool === 'select') {
      if (target) startMove(target, wx, wy);
      else { select(null); drag = { mode: 'pan', start: [sx, sy], view: { ...view } }; }
      request();
      return;
    }
    if (how === 'now') { startMove(target, wx, wy); if (tool === 'text' && target.type === 'text') drag.tapEdit = true; request(); return; }
    if (tool === 'eraser') { const e = hit(wx, wy); if (e) remove(e); drag = { mode: 'erase' }; return; }
    select(null);
    if (how === 'hold') {
      hold = DK.hold(ev, () => {
        hold = null;
        if (pointers.size !== 1 || !els.some((e) => e.id === target.id)) return;
        dropDrawing(); pending = null;
        startMove(els.find((e) => e.id === target.id), wx, wy);
        selUi.pulse();
        request();
      });
    }
    if (tool === 'text') { pending = { x: wx, y: wy }; return; }
    if (tool === 'icon') {
      // The icon appears under the finger and follows it until it is let go.
      const ic = wbIconById(cfg.iconId);
      if (!ic) { toast('Kies eerst een icoon in het paneel'); return; }
      drawing = { e: { type: 'icon', icon: ic.id, x: wx, y: wy, size: ic.size || cfg.iconSize, color: cfg.color, rot: 0, z: ic.size ? 0 : undefined } };
      drag = { mode: 'place' };
      request();
      return;
    }
    const base = { color: cfg.color, width: cfg.width };
    if (tool === 'pen' || tool === 'marker' || tool === 'farrow') drawing = { e: { type: 'path', ...base, marker: tool === 'marker', ...(tool === 'farrow' ? { arrow: 'end' } : {}), pts: [[wx, wy]] }, last: [wx, wy], sent: 0 };
    else if (tool === 'line' || tool === 'arrow') drawing = { e: { type: 'line', ...base, x1: wx, y1: wy, x2: wx, y2: wy, arrow: tool === 'arrow' ? 'end' : 'none' } };
    else if (tool === 'rect' || tool === 'ellipse') drawing = { e: { type: tool, ...base, x: wx, y: wy, w: 0, h: 0, fill: !!cfg.fill, rot: 0 } };
    request();
  });
  cv.addEventListener('pointermove', (ev) => {
    const [sx, sy] = pos(ev);
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, [sx, sy]);
    if (hold) hold.move(ev);
    if (drag && drag.mode === 'pinch') {
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const r = DK.pinchApply(drag.st, toWorld(a[0], a[1]), toWorld(b[0], b[1]), measure);
        const e = els.find((x) => x.id === drag.e.id) || drag.e;
        Object.assign(e, r.e);
        drag.e = e;
        drag.moved = true;
        request();
      }
      return;
    }
    if (drag && drag.mode === 'none') return;
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const f = clamp(d / (pinch.d || 1), 0.2, 5);
      const k = clamp(pinch.view.k * f, 0.08, 12);
      // The point under the first centre stays under the current centre.
      const wx = (pinch.c[0] - pinch.view.x) / pinch.view.k, wy = (pinch.c[1] - pinch.view.y) / pinch.view.k;
      view = { k, x: c[0] - wx * k, y: c[1] - wy * k };
      request();
      return;
    }
    const [wx, wy] = toWorld(sx, sy);
    if (ev.pointerType !== 'touch' || drawing) liveCursor(wx, wy);
    paintCoord(wx, wy);
    if (drag && drag.mode === 'place') { if (drawing) { drawing.e.x = wx; drawing.e.y = wy; request(); } return; }
    if (drawing) {
      const e = drawing.e;
      if (e.type === 'path') {
        const [lx, ly] = drawing.last;
        if (Math.hypot(wx - lx, wy - ly) >= 1.2 / view.k) { e.pts.push([wx, wy]); drawing.last = [wx, wy]; liveStroke(e, [[wx, wy]], false); }
      } else if (e.type === 'line') { e.x2 = wx; e.y2 = wy; if (ev.shiftKey) { const a = Math.round(Math.atan2(wy - e.y1, wx - e.x1) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(wx - e.x1, wy - e.y1); e.x2 = e.x1 + L * Math.cos(a); e.y2 = e.y1 + L * Math.sin(a); } }
      else { e.w = wx - e.x; e.h = wy - e.y; if (ev.shiftKey) { const m = Math.max(Math.abs(e.w), Math.abs(e.h)); e.w = Math.sign(e.w || 1) * m; e.h = Math.sign(e.h || 1) * m; } }
      request();
      return;
    }
    if (!drag) {
      // The mouse over something it would pick up: the move cursor.
      if (ev.pointerType === 'mouse' && cfg.tool !== 'pan' && cfg.tool !== 'eraser') { const t = onSel(wx, wy) || hit(wx, wy); cv.style.cursor = t && (cfg.tool === 'select' || DK.grabMode(cfg.tool, t, sel) === 'now') ? 'move' : toolCursor(); }
      return;
    }
    if (drag.mode === 'pan') { view.x = drag.view.x + (sx - drag.start[0]); view.y = drag.view.y + (sy - drag.start[1]); request(); return; }
    if (drag.mode === 'erase') { const e = hit(wx, wy); if (e) remove(e); return; }
    if (drag.mode === 'move') {
      const dx = wx - drag.start[0], dy = wy - drag.start[1];
      if (!drag.moved && Math.hypot(dx, dy) * view.k < 3) return;
      drag.moved = true;
      const fresh = DK.copy(drag.e0); moveBy(fresh, dx, dy);
      // The list may have been read again meanwhile (another screen saved something): move the one shown.
      const e = els.find((x) => x.id === drag.e.id) || drag.e;
      Object.assign(e, fresh); drag.e = e;
      request();
    }
  });
  const up = (ev) => {
    pointers.delete(ev.pointerId);
    if (hold) { hold.cancel(); hold = null; }
    if (drag && drag.mode === 'pinch') {
      // One finger off: the turn is done; the other finger does nothing until it is lifted too.
      if (pointers.size < 2) { if (drag.moved) commit(drag.e, drag.before); drag = pointers.size ? { mode: 'none' } : null; request(); }
      return;
    }
    if (drag && drag.mode === 'none') { if (!pointers.size) drag = null; return; }
    if (pinch) { if (pointers.size < 2) { pinch = null; saveView(); } return; }
    if (pending) { const p = pending; pending = null; openText({ x: p.x, y: p.y }); return; }
    if (drag && drag.mode === 'place') {
      const e = drawing && drawing.e;
      drawing = null; drag = null;
      if (e) { commit(e); if (DK.isUnderlay(e)) toast('Ondergrond geplaatst: wat je nu tekent komt erbovenop'); else select(e.id); }
      request();
      return;
    }
    if (drawing) {
      const e = drawing.e;
      drawing = null;
      let done = false;
      if (e.type === 'path') { liveStroke(e, [], true); if (e.pts.length >= 1) { commit(e); done = true; } }
      else if (e.type === 'line') { if (Math.hypot(e.x2 - e.x1, e.y2 - e.y1) * view.k >= 4) { commit(e); done = true; } }
      else if (Math.abs(e.w) * view.k >= 4 || Math.abs(e.h) * view.k >= 4) { if (e.w < 0) { e.x += e.w; e.w = -e.w; } if (e.h < 0) { e.y += e.h; e.h = -e.h; } commit(e); done = true; }
      // A new line, arrow or shape is selected straight away: move it or turn it without changing tool.
      if (done && DK.selectAfter(e)) select(e.id);
      request();
      return;
    }
    if (drag) {
      if (drag.mode === 'pan') saveView();
      else if (drag.mode === 'move' && drag.moved) commit(drag.e, drag.e0);
      else if (drag.mode === 'move' && drag.tapEdit) { const e = els.find((x) => x.id === drag.e.id); if (e) openText(e); }
      drag = null;
      cv.style.cursor = toolCursor();
      request();
    }
  };
  // For a test run (scripted over the DevTools protocol): the state of the board and where a board point is.
  cv.dkState = () => ({ sel, drag: drag && drag.mode, pinch: !!pinch, pointers: pointers.size, view: { ...view } });
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('pointerleave', () => paintCoord(null));
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  // The wheel zooms; Alt + wheel turns the selection (5 degrees a notch, saved once the wheel rests).
  let wheelTurn = null;
  cv.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const s = selEl();
    if (ev.altKey && s && DK.canRotate(s)) {
      if (!wheelTurn) wheelTurn = { before: DK.copy(s), t: null };
      Object.assign(s, DK.transform(s, { drot: ev.deltaY < 0 ? -5 : 5 }, measure));
      clearTimeout(wheelTurn.t);
      wheelTurn.t = setTimeout(() => { const e = selEl(); if (e && wheelTurn) commit(e, wheelTurn.before); wheelTurn = null; request(); }, 450);
      request();
      return;
    }
    const [sx, sy] = pos(ev);
    zoomAt(sx, sy, ev.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });
  cv.addEventListener('dblclick', (ev) => { if (textBox) return; const [sx, sy] = pos(ev); const [wx, wy] = toWorld(sx, sy); const e = hit(wx, wy); if (e && e.type === 'text') openText(e); else if (e && e.type === 'icon') labelIcon(e); });

  /* ---------- text ---------- */
  function openText(e) {
    if (textBox) commitText();
    const isNew = !e.id;
    const [sx, sy] = toScreen(e.x, e.y);
    const ta = h('textarea', { class: 'wb-textbox', value: e.text || '', placeholder: 'Typ…', style: `left:${sx}px;top:${sy}px;font-size:${(e.size || cfg.fontSize) * view.k}px;color:${e.color || cfg.color}` });
    stage.append(ta);
    textBox = { ta, e, isNew };
    ta.focus();
    ta.addEventListener('keydown', (k) => { if (k.key === 'Escape') { cancelText(); } else if (k.key === 'Enter' && !k.shiftKey) { k.preventDefault(); commitText(); } k.stopPropagation(); });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; ta.style.width = Math.max(80, measure(ta.value.split('\n').reduce((a, b) => (a.length > b.length ? a : b), ''), (e.size || cfg.fontSize) * view.k) + 24) + 'px'; });
    ta.dispatchEvent(new Event('input'));
    if (isNew) { ta.addEventListener('blur', () => setTimeout(() => { if (textBox && textBox.ta === ta) commitText(); }, 150)); }
  }
  function commitText() {
    if (!textBox) return;
    const { ta, e, isNew } = textBox;
    textBox = null;
    const text = ta.value.replace(/\s+$/, '');
    ta.remove();
    if (!text) { if (!isNew) remove(e); return; }
    if (isNew) commit({ type: 'text', x: e.x, y: e.y, text, size: cfg.fontSize, color: cfg.color, rot: 0 });
    else if (text !== e.text) { const before = JSON.parse(JSON.stringify(e)); e.text = text; commit(e, before); }
    request();
  }
  function cancelText() { if (!textBox) return; textBox.ta.remove(); textBox = null; }
  function labelIcon(e) {
    const inp = textInput(e.label || '', { maxlength: 24, placeholder: 'bv. 8012, LP1, Zuid' });
    openModal({ title: 'Label bij het icoon', body: field('Tekst onder het icoon', inp), actions: [{ label: 'Annuleren' }, { label: 'Opslaan', primary: true, onClick: () => { const before = JSON.parse(JSON.stringify(e)); e.label = inp.value.trim(); commit(e, before); } }] });
    inp.select();
  }

  /* ---------- keys ---------- */
  const onKey = (ev) => {
    if (!onScreen(body) || modalOpen() || textBox || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
    const k = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); doUndo(ev.shiftKey); return; }
    if ((ev.ctrlKey || ev.metaKey) && k === 'y') { ev.preventDefault(); doUndo(true); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    // Escape: first the selection off, then back to Selecteren.
    if (ev.key === 'Escape') { if (sel) select(null); else if (cfg.tool !== 'select') setTool('select'); ev.stopPropagation(); return; }
    if ((k === 'delete' || k === 'backspace') && sel) { const e = els.find((x) => x.id === sel); if (e) remove(e); ev.preventDefault(); return; }
    // Arrow keys move the selection, [ and ] turn it (drawkit.js).
    const s = selEl(), moved = s && dkKey(ev, s, view.k, measure);
    if (moved) { const before = DK.copy(s); Object.assign(s, moved); commit(s, before); request(); ev.preventDefault(); return; }
    if (k === '+' || k === '=') zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1.25);
    else if (k === '-') zoomAt(stage.clientWidth / 2, stage.clientHeight / 2, 1 / 1.25);
    else if (k === '0') fitAll();
    else if (k === 'k') mapDialog();
    else { const t = Object.entries(WB_TOOLS).find(([, d]) => d.key.toLowerCase() === k); if (t) setTool(t[0]); else return; }
    ev.preventDefault();
  };
  window.addEventListener('keydown', onKey, true);

  /* ---------- the panel ---------- */
  const tabs = h('div', { class: 'zp-tabs wb-tabs', role: 'tablist' });
  const content = h('div', { class: 'zp-side-body' });
  const sideBtn = h('button', { class: 'zp-side-toggle', title: 'Paneel in- of uitklappen', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>', onclick: () => { cfg.side = !cfg.side; root.classList.toggle('side-off', !cfg.side); save(); setTimeout(() => { size(); request(); }, 220); } });
  side.append(tabs, content, sideBtn);
  const WB_TABS = [{ id: 'draw', name: 'Tekenen', icon: 'edit' }, { id: 'icons', name: 'Iconen', icon: 'star' }, { id: 'map', name: 'Kaart', icon: 'globe' }, { id: 'boards', name: 'Borden', icon: 'folder' }];
  if (!WB_TABS.some((t) => t.id === cfg.sideTab)) cfg.sideTab = 'draw';
  const showTab = (id) => { cfg.sideTab = id; if (!cfg.side) { cfg.side = true; root.classList.remove('side-off'); } save(); paintTabs(); paintSide(); };
  const paintTabs = () => tabs.replaceChildren(...WB_TABS.map((t) => h('button', { class: 'zp-tab' + (cfg.sideTab === t.id ? ' on' : ''), onclick: () => showTab(t.id) }, icon(t.icon), h('span', {}, t.name))));
  function setTool(t) { cfg.tool = t; save(); paintBar(); if (cfg.sideTab === 'draw') paintSide(); paintHud(); presence.dataset.sig = ''; cv.style.cursor = t === 'pan' ? 'grab' : t === 'text' ? 'text' : t === 'select' ? 'default' : 'crosshair'; request(); }
  function paintSide() {
    const scroll = content.scrollTop;
    if (cfg.sideTab === 'draw') content.replaceChildren(drawPanel());
    else if (cfg.sideTab === 'icons') content.replaceChildren(iconsPanel());
    else if (cfg.sideTab === 'map') content.replaceChildren(mapPanel());
    else content.replaceChildren(boardsPanel());
    content.scrollTop = scroll;
  }
  // The background: of the open board (shared with every screen), else the standard of this screen. The pen
  // follows: a white pen on a white board would be invisible, so black and white swap along.
  function fitPen() {
    const light = isLight();
    if (light && cfg.color === '#ffffff') cfg.color = '#0a0f18'; else if (!light && cfg.color === '#0a0f18') cfg.color = '#ffffff'; else return;
    save();
  }
  function setBg(v) {
    cfg.bg = v; save();
    const b = board();
    if (b) OPS.put('boards', 'boards', b.id, { ...b, bg: v });
    fitPen();
    stage.classList.toggle('light', isLight());
    request(); paintBar(); paintSide();
  }
  function drawPanel() {
    const chk = (label, get, set) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!get(), onchange: (e) => set(e.target.checked) }), label);
    const cur = (board() || {}).bg || cfg.bg;
    const s = sel && els.find((e) => e.id === sel);
    return h('div', { class: 'zp-panel' },
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Gereedschap')),
        h('div', { class: 'wb-tools' }, Object.entries(WB_TOOLS).map(([k, t]) => h('button', { class: 'wb-toolbtn' + (cfg.tool === k ? ' on' : ''), title: `${t.name} (${t.key}) — ${t.hint}`, onclick: () => setTool(k) }, icon(t.icon), h('span', {}, t.name)))),
        h('p', { class: 'zp-hint' }, (WB_TOOLS[cfg.tool] || WB_TOOLS.pen).hint)),
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Kleur en dikte')),
        h('div', { class: 'wb-colors' }, WB_COLORS.map((c) => h('button', { class: 'wb-color' + (cfg.color === c ? ' on' : ''), style: `--c:${c}`, title: c, onclick: () => { cfg.color = c; save(); applyToSel({ color: c }); paintSide(); paintBar(); } }))),
        h('div', { class: 'wb-widths' }, WB_WIDTHS.map((wd) => h('button', { class: 'wb-width' + (cfg.width === wd ? ' on' : ''), title: `${wd} px`, onclick: () => { cfg.width = wd; save(); applyToSel({ width: wd }); paintSide(); } }, h('i', { style: `height:${wd}px` })))),
        chk('Vormen vullen', () => cfg.fill, (v) => { cfg.fill = v; save(); applyToSel({ fill: v }); }),
        h('div', { class: 'row' }, field('Tekstgrootte', zpSelect([12, 14, 18, 24, 32, 48, 64].map((sz) => ({ value: sz, label: `${sz}` })), cfg.fontSize, (v) => { cfg.fontSize = +v; save(); applyToSel({ size: +v }, 'text'); })), field('Icoongrootte', zpSelect([40, 60, 80, 110, 150, 200].map((sz) => ({ value: sz, label: `${sz}` })), cfg.iconSize, (v) => { cfg.iconSize = +v; save(); applyToSel({ size: +v }, 'icon'); })))),
      s ? h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Selectie'), h('span', { class: 'zp-fold-badge' }, { path: s.arrow ? 'vrije pijl' : 'streek', line: s.arrow && s.arrow !== 'none' ? 'pijl' : 'lijn', rect: 'rechthoek', ellipse: 'ellips', text: 'tekst', icon: 'icoon', map: 'kaart' }[s.type] || s.type)),
        h('div', { class: 'zp-btnrow' },
          h('button', { class: 'btn zp-btn', title: 'Naar voren', onclick: () => { const b = JSON.parse(JSON.stringify(s)); s.z = nextZ(); commit(s, b); } }, icon('arrowUp'), 'Naar voren'),
          h('button', { class: 'btn zp-btn', title: 'Naar achteren', onclick: () => { const b = JSON.parse(JSON.stringify(s)); s.z = lowZ(); commit(s, b); } }, icon('arrowDown'), 'Naar achteren'),
          h('button', { class: 'btn zp-btn', title: 'Kopie ernaast', onclick: () => { const c = JSON.parse(JSON.stringify(s)); delete c.id; delete c.updatedAt; delete c.z; moveBy(c, 30 / view.k, 30 / view.k); commit(c); sel = c.id; request(); paintSide(); } }, icon('history'), 'Kopie'),
          h('button', { class: 'btn zp-btn danger', onclick: () => { remove(s); request(); paintSide(); } }, icon('trash'), 'Verwijderen')),
        s.type === 'line' ? h('div', { class: 'row' }, field('Pijlpunt', zpSelect([['none', 'Geen'], ['end', 'Aan het eind'], ['both', 'Beide kanten']].map(([v, l]) => ({ value: v, label: l })), s.arrow || 'none', (v) => applyToSel({ arrow: v }))), field('Lijnstijl', zpSelect([['solid', 'Doorgetrokken'], ['dash', 'Gestippeld']].map(([v, l]) => ({ value: v, label: l })), s.dash ? 'dash' : 'solid', (v) => applyToSel({ dash: v === 'dash' })))) : null,
        DK.canRotate(s) ? h('div', { class: 'zp-btnrow dk-turnrow' },
          h('button', { class: 'btn zp-btn', title: '15° linksom ([)', onclick: () => turnSel(-15) }, '↺ 15°'),
          DK.ownRot(s) ? h('button', { class: 'btn zp-btn', title: 'Recht zetten (0°)', disabled: !s.rot || null, onclick: () => applyToSel({ rot: 0 }) }, icon('refresh'), s.rot ? `Recht (nu ${Math.round(s.rot)}°)` : 'Recht') : null,
          h('button', { class: 'btn zp-btn', title: '15° rechtsom (])', onclick: () => turnSel(15) }, '↻ 15°')) : null,
        s.type === 'icon' ? h('div', { class: 'zp-btnrow' }, h('button', { class: 'btn zp-btn', onclick: () => labelIcon(s) }, icon('keyboard'), s.label ? `Label: ${s.label}` : 'Label…')) : null,
        s.type === 'text' ? h('div', { class: 'zp-btnrow' }, h('button', { class: 'btn zp-btn', onclick: () => openText(s) }, icon('edit'), 'Tekst bewerken')) : null,
        s.type === 'map' ? h('p', { class: 'zp-hint' }, 'Een kaart beheer je onder het tabblad Kaart: vergrendelen, dekking, centreren.') : null) : null,
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Bord')),
        field('Achtergrond', h('div', { class: 'wb-bgs' }, Object.entries(WB_BG).map(([k, d]) => h('button', { class: 'wb-bg' + (cur === k ? ' on' : ''), style: `--c:${d.fill}`, title: d.name, onclick: () => setBg(k) }, h('i'), h('span', {}, d.name))))),
        field('Raster', segmented([{ value: 'off', label: 'Geen' }, { value: 'dots', label: 'Stippen' }, { value: 'lines', label: 'Lijnen' }], gridMode(), (v) => { cfg.grid = v; save(); request(); })),
        h('div', { class: 'dk-urrow' }, undoBar({ labels: true })),
        h('div', { class: 'zp-btnrow' }, h('button', { class: 'btn zp-btn', title: 'Alles in beeld (0)', onclick: () => fitAll() }, icon('target'), 'Alles in beeld')),
        h('div', { class: 'zp-btnrow' },
          h('button', { class: 'btn zp-btn', onclick: exportPng }, icon('download'), 'Als PNG'),
          h('button', { class: 'btn zp-btn danger', onclick: () => { if (!els.length) return; confirmDialog('Bord leegmaken', `Alle ${els.length} elementen van dit bord verwijderen, ook op de andere schermen?`, 'Leegmaken', () => { hist.push(cfg.boardId, els.map((e) => ({ id: e.id, before: clean(e), after: null }))); OPS.putMany('boards', els.map((e) => ({ list: 'elements', id: e.id, item: null }))); sel = null; scheduleThumb(); toast('Bord leeggemaakt · Ongedaan maken zet alles terug'); }); } }, icon('trash'), 'Leegmaken')),
        h('p', { class: 'zp-hint' }, 'Vrije pijl (F): teken als met de pen, de punt komt vanzelf aan het eind. De rode prullenbak onder een selectie verwijdert haar. Verplaatsen zonder te wisselen: sleep een icoon of tekst direct, of druk even op een lijn, pijl of vorm en sleep. Draaien aan de ronde greep boven de selectie, met twee vingers of met [ en ]; schalen aan de hoeken. Sneltoetsen: V selecteren, H verschuiven, P pen, M markeerstift, L lijn, A pijl, R rechthoek, E ellips, T tekst, I icoon, X gum, K kaart; + − 0 zoomen; pijltjes verplaatsen de selectie; Delete verwijdert haar; Shift houdt lijnen op 45° en vormen vierkant. Dubbeltik op tekst om te bewerken, op een icoon voor een label.')));
  }
  function turnSel(d) { const e = selEl(); if (!e) return; const before = DK.copy(e); Object.assign(e, DK.transform(e, { drot: d }, measure)); commit(e, before); request(); paintSide(); }
  function applyToSel(patch, type) {
    const e = sel && els.find((x) => x.id === sel);
    if (!e || (type && e.type !== type)) return;
    const before = JSON.parse(JSON.stringify(e));
    Object.assign(e, patch);
    commit(e, before);
    request();
  }
  const iconState = { query: '', cat: 'all' };
  function iconsPanel() {
    return dkIconPanel({ state: iconState, light: isLight, picked: () => (cfg.tool === 'icon' ? cfg.iconId : null), pick: (ic) => { cfg.iconId = ic.id; save(); setTool('icon'); }, px: 40 });
  }
  /* ---------- a piece of map ---------- */
  function mapPanel() {
    const maps = els.filter((e) => e.type === 'map');
    return h('div', { class: 'zp-panel' },
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Kaart op het bord')),
        h('p', { class: 'zp-hint' }, 'Kies een stuk kaart (satelliet, kaart, topografisch, luchtfoto, VFR) en zet het op het bord als ondergrond om een ingress, een cordon of een actie op uit te tekenen met de iconen. Het stuk kaart staat vergrendeld: alles wat je tekent komt erbovenop. Beweeg de muis over de kaart voor de coördinaat.'),
        h('div', { class: 'zp-btnrow' }, h('button', { class: 'btn zp-btn primary', onclick: mapDialog }, icon('globe'), 'Kaart plaatsen… (K)'))),
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Kaarten op dit bord'), h('span', { class: 'zp-fold-badge' }, String(maps.length))),
        maps.length ? h('div', { class: 'wb-maps' }, maps.map((e) => {
          const def = WB_MAPS[e.base] || WB_MAPS.osm;
          const mpu = wbMetresPerUnit(e.lat, e.zoom);
          return h('div', { class: 'wb-mapitem' + (sel === e.id ? ' on' : '') },
            h('div', { class: 'wb-mapitem-main' }, h('b', {}, `${def.name}${e.seamark ? ' + zeekaart' : ''}`), h('small', {}, `${PlanCoords.fmt(e.lat, e.lon, 'ddm')} · ${PlanUnits.fmtDist(e.w * mpu, 'nm')} × ${PlanUnits.fmtDist(e.h * mpu, 'nm')} · zoom ${e.zoom.toFixed(1)}`)),
            h('div', { class: 'zp-btnrow' },
              h('button', { class: 'btn zp-btn', title: 'In beeld', onclick: () => { fitAll([e]); } }, icon('target'), 'In beeld'),
              h('button', { class: 'btn zp-btn' + (e.lock ? '' : ' on'), title: e.lock ? 'Ontgrendelen: de kaart is dan te selecteren, te verplaatsen en te schalen' : 'Vergrendelen: de kaart blijft liggen en alles komt erbovenop', onclick: () => { const b = JSON.parse(JSON.stringify(e)); e.lock = !e.lock; if (e.lock && sel === e.id) sel = null; else if (!e.lock) { sel = e.id; setTool('select'); } commit(e, b); request(); paintSide(); } }, icon(e.lock ? 'lock' : 'unlock'), e.lock ? 'Vergrendeld' : 'Los'),
              zpSelect([1, 0.85, 0.7, 0.5, 0.35].map((o) => ({ value: o, label: `${Math.round(o * 100)}%` })), e.opacity == null ? 1 : e.opacity, (v) => { const b = JSON.parse(JSON.stringify(e)); e.opacity = +v; commit(e, b); request(); }, { title: 'Dekking' }),
              h('button', { class: 'btn zp-btn danger', title: 'Verwijderen', onclick: () => { remove(e); request(); paintSide(); } }, icon('trash'))));
        })) : h('p', { class: 'zp-hint' }, 'Nog geen kaart op dit bord.')));
  }
  // The picker: a map to pan and zoom under a frame (or a frame to drag yourself); what is in the frame
  // goes on the board at the resolution of the map at that zoom.
  function mapDialog() {
    if (!ensureBoard()) return toast('Even geduld: de gedeelde bestanden worden geladen');
    const mcfg = cfg.map;
    const mapEl = h('div', { class: 'wb-pickmap' });
    const frame = h('div', { class: 'wb-pickframe' });
    const overlay = h('div', { class: 'wb-pickoverlay' }, frame);
    const stageEl = h('div', { class: 'wb-pickstage' }, mapEl, overlay);
    const info = h('div', { class: 'wb-pickinfo' });
    const q = h('input', { class: 'zp-q', type: 'search', placeholder: 'Plaats, platform, vliegveld, favoriet of coördinaat…' });
    const res = h('div', { class: 'zp-results', hidden: true });
    let dragFrame = false, custom = null, map = null, base = null, ro = null, mo = null, seq = 0;
    const picks = { base: mcfg.base, raster: mcfg.seamark ? ['seamark'] : [] };
    const fake = { cfg: { base: (WB_MAPS[picks.base] || WB_MAPS.osm).pick, raster: picks.raster } };
    const setBase = (k) => { picks.base = k; mcfg.base = k; fake.cfg.base = (WB_MAPS[k] || WB_MAPS.osm).pick; save(); if (base) base.apply(); };
    const baseSeg = segmented(Object.entries(WB_MAPS).map(([k, d]) => ({ value: k, label: d.short })), WB_MAPS[picks.base] ? picks.base : 'osm', setBase);
    const seaChk = checkbox('Zeekaart erover (OpenSeaMap)', !!mcfg.seamark, (v) => { mcfg.seamark = v; fake.cfg.raster = v ? ['seamark'] : []; save(); if (base) base.applyRaster(); });
    const aspectSeg = segmented([...Object.keys(WB_ASPECTS).map((k) => ({ value: k, label: k })), { value: 'free', label: 'Vrij' }], WB_ASPECTS[mcfg.aspect] || mcfg.aspect === 'free' ? mcfg.aspect : '16:9', (v) => { mcfg.aspect = v; custom = null; save(); placeFrame(); });
    const dragBtn = h('button', { class: 'btn zp-btn', title: 'Sleep zelf een kader over de kaart', onclick: () => { dragFrame = !dragFrame; dragBtn.classList.toggle('on', dragFrame); overlay.classList.toggle('arm', dragFrame); if (map) { if (dragFrame) map.dragging.disable(); else map.dragging.enable(); } } }, icon('max'), 'Kader slepen');
    // The frame: the chosen aspect, as large as fits with a margin, or the one dragged.
    function placeFrame() {
      const W = stageEl.clientWidth, H = stageEl.clientHeight;
      let r;
      if (custom) r = custom;
      else if (mcfg.aspect === 'free') r = { x: 20, y: 20, w: W - 40, h: H - 40 };
      else { const a = WB_ASPECTS[mcfg.aspect] || 16 / 9; let w = W - 60, hh = w / a; if (hh > H - 60) { hh = H - 60; w = hh * a; } r = { x: (W - w) / 2, y: (H - hh) / 2, w, h: hh }; }
      Object.assign(frame.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
      paintInfo();
    }
    const frameRect = () => ({ x: parseFloat(frame.style.left), y: parseFloat(frame.style.top), w: parseFloat(frame.style.width), h: parseFloat(frame.style.height) });
    function paintInfo() {
      if (!map) return;
      const r = frameRect(), z = map.getZoom();
      const c = map.containerPointToLatLng([r.x + r.w / 2, r.y + r.h / 2]);
      const mpu = wbMetresPerUnit(c.lat, z);
      info.replaceChildren(h('b', {}, PlanCoords.fmt(c.lat, c.lng, 'ddm')), h('span', {}, `${PlanUnits.fmtDist(r.w * mpu, 'nm')} × ${PlanUnits.fmtDist(r.h * mpu, 'nm')} · zoom ${z.toFixed(1)} · ${Math.round(r.w)} × ${Math.round(r.h)} eenheden op het bord`));
    }
    // Dragging a frame of your own.
    let dstart = null;
    overlay.addEventListener('pointerdown', (ev) => { if (!dragFrame) return; ev.preventDefault(); overlay.setPointerCapture(ev.pointerId); const b = stageEl.getBoundingClientRect(); dstart = [ev.clientX - b.left, ev.clientY - b.top]; custom = { x: dstart[0], y: dstart[1], w: 1, h: 1 }; placeFrame(); });
    overlay.addEventListener('pointermove', (ev) => { if (!dstart) return; const b = stageEl.getBoundingClientRect(); const x = clamp(ev.clientX - b.left, 0, b.width), y = clamp(ev.clientY - b.top, 0, b.height); custom = { x: Math.min(x, dstart[0]), y: Math.min(y, dstart[1]), w: Math.abs(x - dstart[0]), h: Math.abs(y - dstart[1]) }; placeFrame(); });
    const dend = () => { if (!dstart) return; dstart = null; if (custom && (custom.w < 40 || custom.h < 40)) custom = null; dragFrame = false; dragBtn.classList.remove('on'); overlay.classList.remove('arm'); if (map) map.dragging.enable(); placeFrame(); };
    overlay.addEventListener('pointerup', dend); overlay.addEventListener('pointercancel', dend);
    // Searching, as in Zoek & Plan.
    q.addEventListener('input', async () => {
      const s = q.value.trim(); const my = ++seq;
      if (s.length < 2) { res.hidden = true; return; }
      const coord = PlanCoords.parse ? PlanCoords.parse(s) : null;
      let items = [];
      if (coord) items.push({ label: PlanCoords.fmt(coord.lat, coord.lon, 'ddm'), sub: 'Coördinaat', lat: coord.lat, lon: coord.lon });
      for (const f of OPS.list('shared', 'favorites')) if (String(f.name).toLowerCase().includes(s.toLowerCase())) items.push({ label: f.name, sub: 'Favoriet', lat: f.lat, lon: f.lon });
      try { const r = await window.palv.plan.suggest(s, { limit: 8 }); if (my !== seq) return; if (r && Array.isArray(r.items)) items = items.concat(r.items); } catch { /* none */ }
      res.replaceChildren(...items.slice(0, 10).map((it) => h('div', { class: 'zp-res', onclick: async () => {
        let pt = it;
        if (pt.lat == null && pt.id) { try { pt = await window.palv.plan.resolve(pt.id); } catch { pt = null; } }
        if (!pt || pt.lat == null) return toast('Geen positie voor dit punt', true);
        res.hidden = true; q.value = String(it.label || '').split(',')[0];
        if (map) map.setView([+pt.lat, +pt.lon], Math.max(map.getZoom(), 13));
      } }, icon('target'), h('div', {}, h('b', {}, it.label), h('small', {}, it.sub || '')))));
      res.hidden = !items.length;
    });
    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const first = res.querySelector('.zp-res'); if (first) first.click(); } ev.stopPropagation(); });
    const cleanup = () => { if (ro) ro.disconnect(); if (mo) mo.disconnect(); if (base) base.destroy(); if (map) { map.remove(); map = null; } };
    const place = () => {
      if (!map) return false;
      const r = frameRect(), z = map.getZoom();
      const c = map.containerPointToLatLng([r.x + r.w / 2, r.y + r.h / 2]);
      const wdt = Math.round(r.w), hgt = Math.round(r.h);
      // Centred on what is in view, under everything else, locked.
      const [cx, cy] = toWorld(stage.clientWidth / 2, stage.clientHeight / 2);
      commit({ type: 'map', x: Math.round(cx - wdt / 2), y: Math.round(cy - hgt / 2), w: wdt, h: hgt, lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6), zoom: +z.toFixed(3), base: picks.base, seamark: !!mcfg.seamark, lock: true, opacity: 1, z: 0 });
      cleanup();
      fitAll(els.filter((e) => e.type === 'map'));
      showTab('map');
      toast('Kaart geplaatst en vergrendeld: alles wat je nu tekent komt erbovenop');
      return true;
    };
    const close = openModal({
      title: 'Een stuk kaart op het bord', wide: true, cls: 'wb-mapmodal',
      body: [
        h('div', { class: 'wb-pickbar' }, h('div', { class: 'zp-search wb-picksearch' }, icon('search'), q, res), baseSeg, seaChk),
        h('div', { class: 'wb-pickbar' }, h('span', { class: 'wb-picklbl' }, 'Kader'), aspectSeg, dragBtn, h('span', { class: 'zp-spacer' }), info),
        stageEl,
        h('p', { class: 'zp-hint' }, 'Schuif en zoom de kaart tot het gewenste gebied in het kader staat (wiel of knoppen: zoomen; slepen: verschuiven), of sleep zelf een kader. Zoom verder in voor meer detail op het bord: één eenheid op het bord is één kaartpixel op dit zoomniveau.'),
      ],
      actions: [{ label: 'Annuleren', onClick: cleanup }, { label: 'Op het bord plaatsen', primary: true, onClick: () => place() }],
    });
    // Closed another way (the cross, the backdrop): the map goes too.
    const backdrop = mapEl.closest('.modal-backdrop');
    mo = new MutationObserver(() => { if (backdrop && !backdrop.isConnected) cleanup(); });
    mo.observe($('#modal-root'), { childList: true });
    // The map, once the dialog has its size.
    setTimeout(() => {
      const last = mcfg.view || { lat: 52.3, lon: 4.75, zoom: 11 };
      map = L.map(mapEl, { zoomControl: true, attributionControl: true, zoomSnap: 0, zoomDelta: 0.5, minZoom: 3, maxZoom: 19, fadeAnimation: false, inertia: true, doubleClickZoom: true });
      map.attributionControl.setPrefix(false);
      map.setView([last.lat, last.lon], last.zoom, { animate: false });
      const ctx = { map, el: mapEl, w: fake };
      base = zpBaseLayers(ctx);
      base.apply();
      map.on('moveend zoomend', () => { const c = map.getCenter(); mcfg.view = { lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), zoom: +map.getZoom().toFixed(2) }; save(); paintInfo(); });
      map.on('move', paintInfo);
      ro = new ResizeObserver(() => { map.invalidateSize(false); placeFrame(); });
      ro.observe(stageEl);
      placeFrame();
    }, 30);
    void close;
  }
  function boardsPanel() {
    const list = OPS.list('boards', 'boards').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const newBoard = () => {
      const name = textInput('', { maxlength: 40, placeholder: 'bv. SOMP Operatie X, Briefing LZ' });
      const ok = (close) => { const n = name.value.trim(); if (!n) return false; const id = OPS.uid(); OPS.put('boards', 'boards', id, { name: n, bg: cfg.bg, createdAt: Date.now(), by: OPS.screen.name, n: 0 }); openBoard(id); if (close) close(); };
      const close = openModal({ title: 'Nieuw whiteboard', body: field('Naam', name), actions: [{ label: 'Annuleren' }, { label: 'Aanmaken', primary: true, onClick: () => ok() }] });
      name.addEventListener('keydown', (e) => e.key === 'Enter' && ok(close));
    };
    return h('div', { class: 'zp-panel' },
      h('div', { class: 'zp-btnrow' }, h('button', { class: 'btn zp-btn primary', onclick: newBoard }, icon('plus'), 'Nieuw bord')),
      h('p', { class: 'zp-hint' }, 'Elk bord staat op alle schermen van de eenheid; wat je tekent is daar direct te zien, en wie meetekent zie je met naam en cursor.'),
      h('div', { class: 'wb-boards' }, list.length ? list.map((b) => h('div', { class: 'wb-board' + (b.id === cfg.boardId ? ' on' : '') },
        h('button', { class: 'wb-board-thumb', style: `background:${(WB_BG[b.bg] || WB_BG.white).fill}`, onclick: () => openBoard(b.id) }, b.thumb ? h('img', { src: b.thumb, alt: '' }) : b.lock && !b.lockOpen ? icon('lock') : h('span', {}, 'leeg')),
        h('div', { class: 'wb-board-main' },
          h('b', {}, b.lock ? icon('lock') : null, b.name), h('small', {}, `${b.n || 0} elementen · ${new Date(b.updatedAt).toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${b.by ? ' · ' + b.by : ''}${b.lock ? (b.lockOpen ? ' · vergrendeld' : ' · vergrendeld, pincode nodig') : ''}`),
          h('div', { class: 'wb-board-acts' },
            h('button', { class: 'btn zp-btn' + (b.id === cfg.boardId ? ' on' : ''), onclick: () => openBoard(b.id) }, b.id === cfg.boardId ? 'Open' : 'Openen'),
            h('button', { class: 'w-tool', title: 'Naam wijzigen', onclick: () => pageNameDialog('Bord hernoemen', b.name, (n) => OPS.put('boards', 'boards', b.id, { ...b, name: n })) }, icon('edit')),
            h('button', { class: 'w-tool', title: 'Kopie maken', onclick: () => { const id = OPS.uid(); const items = [{ list: 'boards', id, item: { ...b, name: b.name + ' (kopie)', createdAt: Date.now(), by: OPS.screen.name } }, ...OPS.list('boards', 'elements').filter((e) => e.board === b.id).map((e) => ({ list: 'elements', id: OPS.uid(), item: { ...clean(e), board: id } }))]; OPS.putMany('boards', items); toast('Kopie gemaakt'); } }, icon('history')),
            h('button', { class: 'w-tool', title: 'Verwijderen', onclick: () => confirmDialog('Bord verwijderen', `"${b.name}" met alles erop verwijderen, ook op de andere schermen?`, 'Verwijderen', () => { OPS.putMany('boards', [{ list: 'boards', id: b.id, item: null }, ...OPS.list('boards', 'elements').filter((e) => e.board === b.id).map((e) => ({ list: 'elements', id: e.id, item: null }))]); if (cfg.boardId === b.id) { cfg.boardId = null; save(); ensureBoard(); } }) }, icon('trash')))))) : h('p', { class: 'zp-hint' }, 'Nog geen borden. Maak er een met Nieuw bord.')));
  }
  function openBoard(id) {
    if (textBox) commitText();
    cfg.boardId = id; sel = null; remote.clear();
    save();
    loadView(); reload(); fitPen(); paintBar(); paintSide(); paintUndo();
    if (id) liveSend({ cur: null });
  }
  function exportPng() {
    if (!cfg.boardId) return;
    const name = ((board() || {}).name || 'whiteboard').replace(/[^\w-]+/g, '_');
    let dataUrl;
    try { dataUrl = cv.toDataURL('image/png'); } catch { return toast('Het bord kon niet als afbeelding worden gelezen', true); }
    window.palv.plan.saveBinary({ title: 'Whiteboard opslaan als PNG', name: `${name}.png`, ext: 'png', dataUrl }).then((r) => { if (r && r.ok) toast('PNG opgeslagen'); else if (r && r.error) toast(r.error, true); });
  }

  /* ---------- the toolbar ---------- */
  const title = h('span', { class: 'wb-title' });
  const quick = h('div', { class: 'wb-quick' });
  function paintBar() {
    const b = board();
    title.replaceChildren(icon(b && b.lock ? 'lock' : 'note'), h('b', {}, b ? b.name : 'Whiteboard'), h('small', {}, !b ? 'bord wordt geopend…' : b.lock ? (b.lockOpen ? 'vergrendeld · zichtbaar op dit scherm' : 'vergrendeld · pincode nodig') : 'live op alle schermen'));
    lockBtn.paint();
    quick.replaceChildren(...['select', 'pan', 'pen', 'farrow', 'marker', 'line', 'arrow', 'rect', 'ellipse', 'text', 'icon', 'eraser'].map((k) => h('button', { class: 'btn zp-btn wb-qbtn' + (cfg.tool === k ? ' on' : ''), title: `${WB_TOOLS[k].name} (${WB_TOOLS[k].key})`, onclick: () => setTool(k) }, icon(WB_TOOLS[k].icon))),
      h('span', { class: 'wb-swatch', style: `--c:${cfg.color}`, title: 'Huidige kleur (kies in het paneel Tekenen)', onclick: () => showTab('draw') }),
      h('span', { class: 'wb-sep' }),
      undoBar());
  }
  const mapBtn = h('button', { class: 'btn zp-btn', title: 'Een stuk kaart op het bord zetten (K)', onclick: mapDialog }, icon('globe'), 'Kaart');
  const boardsBtn = h('button', { class: 'btn zp-btn', title: 'Borden: openen, nieuw, beheren', onclick: () => showTab('boards') }, icon('folder'), 'Borden');
  const lockBtn = lockButton(board, () => { const b = board(); if (b) lockDialog('boards', b, () => { reload(); paintBar(); paintSide(); }); });
  bar.append(title, h('span', { class: 'zp-spacer' }), quick, h('span', { class: 'wb-sep' }), mapBtn, boardsBtn, lockBtn);

  /* ---------- wiring ---------- */
  const ro = new ResizeObserver(() => { size(); request(); });
  ro.observe(stage);
  size();
  loadView();
  reload();
  ensureBoard();
  paintTabs(); paintBar(); paintSide();
  const unsub = OPS.on('boards', (what) => { if (!cfg.boardId || !board()) { ensureBoard(); return; } reload(); if (!(what && what.local) || cfg.sideTab === 'boards' || cfg.sideTab === 'map') { paintBar(); if (cfg.sideTab !== 'icons') paintSide(); } });
  presenceTimer = setInterval(() => { if (cfg.boardId && onScreen(body)) liveSend({ cur: lastCur }); request(); }, 2500);
  setTool(cfg.tool);
  return {
    destroy() { ro.disconnect(); unsub(); unlive(); clearInterval(presenceTimer); clearTimeout(thumbTimer); clearTimeout(liveTimer); clearTimeout(curTimer); window.removeEventListener('keydown', onKey, true); if (wbIconCache.onReady === request) wbIconCache.onReady = null; },
  };
}
