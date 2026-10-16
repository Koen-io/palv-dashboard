'use strict';

/* ============================================================
   Zoek & Plan — wind: stromingslijnen zoals op Windy, kleurvlak, windveren en pijlen, met hoogte en
   tijd te kiezen; en de wind op elk punt van een route op het moment dat je er bent.
   ============================================================ */
// The field comes from Open-Meteo through the main process (src/plan/wind.js): a grid over the area in
// view for five levels and the next 13 hours at once, so changing level or hour costs nothing. Point
// winds (routes, tools) are asked for in batches and kept per 0.05°, hour and 250 ft.
const ZP_WIND_LEVELS = [
  { key: '10m', name: 'Grond (10 m)', ft: 33 },
  { key: '975', name: '≈1.000 ft (975 hPa)', ft: 1060 },
  { key: '950', name: '≈1.800 ft (950 hPa)', ft: 1770 },
  { key: '900', name: '≈3.200 ft (900 hPa)', ft: 3240 },
  { key: '850', name: '≈4.800 ft (850 hPa)', ft: 4780 },
];
// Colour by speed in knots, after the usual wind maps.
const ZP_WIND_COLORS = [[0, [98, 113, 183]], [5, [57, 97, 159]], [10, [74, 148, 169]], [15, [77, 141, 123]], [20, [83, 165, 83]], [25, [53, 159, 53]], [30, [167, 157, 81]], [35, [159, 127, 58]], [40, [161, 108, 92]], [50, [129, 58, 78]], [60, [175, 80, 136]], [70, [117, 74, 147]], [90, [109, 97, 163]]];
function zpWindRgb(kt) {
  const t = ZP_WIND_COLORS;
  if (kt <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i += 1) {
    if (kt <= t[i][0]) { const f = (kt - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return t[i - 1][1].map((c, k) => Math.round(c + (t[i][1][k] - c) * f)); }
  }
  return t[t.length - 1][1];
}
// Brighter colours for the moving lines, which have to stand out on any map.
const zpFlowColor = (kt) => { const c = zpWindRgb(kt).map((v) => Math.min(255, Math.round(v * 1.45 + 40))); return `rgb(${c[0]},${c[1]},${c[2]})`; };
// On a light map the lines go darker instead.
const zpFlowDark = (kt) => { const c = zpWindRgb(kt).map((v) => Math.round(v * 0.62)); return `rgb(${c[0]},${c[1]},${c[2]})`; };

const zpWindPoints = new Map(); // key -> { dirDeg, speedKt, gustKt, tempC, at }
const zpWindMiss = new Map();   // key -> time of a failed ask

function zpWind(ctx) {
  const { map, cfg, mapEl } = ctx;
  const W = cfg.wind;
  let grid = null, gridErr = null, loading = false, reqId = 0, retryTimer = null;

  /* ---------- point winds ---------- */
  const key = (lat, lon, ms, ft) => `${Math.round(lat / 0.05)}|${Math.round(lon / 0.05)}|${Math.floor(ms / 3600e3)}|${Math.round(Math.max(0, ft) / 250)}`;
  let queue = new Map(), flushTimer = null, waiters = [];
  function queuePoint(lat, lon, ms, ft) {
    const k = key(lat, lon, ms, ft);
    if (zpWindPoints.has(k) || queue.has(k)) return;
    const miss = zpWindMiss.get(k);
    if (miss && Date.now() - miss < 120000) return;
    queue.set(k, { lat: Math.round(lat / 0.05) * 0.05, lon: Math.round(lon / 0.05) * 0.05, time: Math.floor(ms / 3600e3) * 3600e3 + 1800e3, ftAmsl: Math.round(Math.max(0, ft) / 250) * 250 });
    clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, 250);
  }
  async function flush() {
    const batch = [...queue.entries()].slice(0, 200);
    for (const [k] of batch) queue.delete(k);
    if (!batch.length) return;
    let got = false;
    try {
      const res = await window.palv.plan.windPoints(batch.map(([, q]) => q));
      const list = res && Array.isArray(res.list) ? res.list : [];
      batch.forEach(([k], i) => {
        const r = list[i];
        if (r && r.ok && r.speedKt != null) { zpWindPoints.set(k, { dirDeg: r.dirDeg, speedKt: r.speedKt, gustKt: r.gustKt, tempC: r.tempC, at: Date.now(), src: r.source }); got = true; }
        else zpWindMiss.set(k, Date.now());
      });
      if (res && res.error) gridErr = res.error;
    } catch { for (const [k] of batch) zpWindMiss.set(k, Date.now()); }
    if (zpWindPoints.size > 20000) for (const k of [...zpWindPoints.keys()].slice(0, 5000)) zpWindPoints.delete(k);
    if (queue.size) flushTimer = setTimeout(flush, 300);
    const ws = waiters.splice(0);
    for (const fn of ws) fn(got);
    if (got) ctx.emit('wind');
  }

  // Wind at a point, height and time: from the point lookups, else from the field on screen at a level
  // close enough, else asked for (null now; the parts are told when it has come).
  ctx.windAt = (lat, lon, ms = Date.now(), ft = 1000) => {
    const hit = zpWindPoints.get(key(lat, lon, ms, ft));
    if (hit) return hit;
    const fromGrid = gridAt(lat, lon, ft, ms);
    queuePoint(lat, lon, ms, ft);
    return fromGrid;
  };
  // Ask everything a route needs in one go; resolves true when new winds came in.
  function ensureRoute(points, ft, departMs, durMin) {
    if (points.length < 2) return Promise.resolve(false);
    const route = PlanGeo.measure(points);
    const n = Math.min(60, Math.max(2, Math.ceil(route.total / (5 * 1852))));
    const before = queue.size;
    for (let i = 0; i <= n; i += 1) {
      const p = PlanGeo.pointAt(route, (route.total * i) / n);
      const ms = departMs + ((durMin || 0) * 60000 * i) / n;
      if (!zpWindPoints.has(key(p.lat, p.lon, ms, ft))) queuePoint(p.lat, p.lon, ms, ft);
    }
    if (queue.size === before && !flushTimer) return Promise.resolve(false);
    return new Promise((resolve) => waiters.push(resolve));
  }

  /* ---------- the field ---------- */
  function gridAt(lat, lon, ft, ms) {
    const g = grid;
    if (!g || !g.ok && !g.stale) return null;
    const lv = ZP_WIND_LEVELS.find((l) => l.key === g.level);
    if (ft != null && lv && Math.abs(lv.ft - ft) > 900) return null;
    if (ms != null && g.validTime && Math.abs(ms - g.validTime) > 2 * 3600e3) return null;
    const uv = sample(g, lat, lon);
    if (!uv) return null;
    return { dirDeg: PlanGeo.norm360(PlanGeo.deg(Math.atan2(-uv[0], -uv[1]))), speedKt: Math.hypot(uv[0], uv[1]), grid: true };
  }
  // Bilinear u/v (kt) from the grid; rows run north to south.
  function sample(g, lat, lon) {
    const fx = (lon - g.lo1) / g.dx, fy = (g.la1 - lat) / g.dy;
    if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) return null;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(g.nx - 1, x0 + 1), y1 = Math.min(g.ny - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
    const at = (arr, x, y) => arr[y * g.nx + x];
    const bil = (arr) => {
      const a = at(arr, x0, y0), b = at(arr, x1, y0), c = at(arr, x0, y1), d = at(arr, x1, y1);
      if ([a, b, c, d].some((v) => v == null)) return null;
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };
    const u = bil(g.u), v = bil(g.v);
    return u == null || v == null ? null : [u, v];
  }

  async function load() {
    if (!W.on) return;
    const b = map.getBounds().pad(0.15);
    const bbox = [Math.max(-85, b.getSouth()), Math.max(-180, b.getWest()), Math.min(85, b.getNorth()), Math.min(180, b.getEast())];
    const id = ++reqId;
    loading = true; paintLegend();
    try {
      const res = await window.palv.plan.windGrid({ bbox, level: W.level, hour: W.hour || 0 });
      if (id !== reqId) return;
      if (res && (res.ok || res.stale) && res.u) { grid = res; gridErr = res.ok ? null : res.error; }
      else gridErr = (res && res.error) || 'Geen windgegevens';
    } catch (err) { gridErr = String(err.message || err); }
    loading = false;
    // A passing refusal (busy server, no connection): try again in a minute, as long as the layer is on.
    if (gridErr && !(grid && grid.ok && grid.bbox && grid.la1 >= bbox[2] - 1 && grid.lo1 <= bbox[1] + 1)) { clearTimeout(retryTimer); retryTimer = setTimeout(() => { if (W.on) load(); }, 60000); }
    buildField();
    paintLegend();
    ctx.cv.request();
    ctx.emit('wind');
  }
  let loadTimer = null;
  const loadSoon = () => { clearTimeout(loadTimer); loadTimer = setTimeout(load, 500); };
  map.on('moveend', () => { if (W.on) loadSoon(); });
  ctx.timers.push(setInterval(() => { if (W.on && onScreen(ctx.body)) load(); }, 15 * 60000));

  /* ---------- particles ---------- */
  const { cv: flow, place: placeFlow } = zpPaneCanvas(map, 'zpFlow', 395, 'zp-flow');
  let field = null, particles = [], anim = null, lastFrame = 0, dpr = 1;
  // Velocity on a coarse screen grid (every 16 px), rebuilt after every move: particles read from it.
  function buildField() {
    if (!grid || !W.on) { field = null; return; }
    const s = map.getSize(), step = 16;
    const nx = Math.ceil(s.x / step) + 1, ny = Math.ceil(s.y / step) + 1;
    const vx = new Float32Array(nx * ny), vy = new Float32Array(nx * ny), sp = new Float32Array(nx * ny);
    const ok = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) {
      const ll = map.containerPointToLatLng([i * step, j * step]);
      const uv = sample(grid, ll.lat, ll.lng);
      if (!uv) continue;
      const k = j * nx + i;
      vx[k] = uv[0]; vy[k] = -uv[1]; sp[k] = Math.hypot(uv[0], uv[1]); ok[k] = 1;
    }
    field = { nx, ny, step, vx, vy, sp, ok, w: s.x, h: s.y };
    placeFlow(); placeColour();
    paintColour();
    resetParticles();
  }
  const fieldAt = (x, y) => {
    const f = field;
    const fx = x / f.step, fy = y / f.step, i = Math.floor(fx), j = Math.floor(fy);
    if (i < 0 || j < 0 || i >= f.nx - 1 || j >= f.ny - 1) return null;
    const k = j * f.nx + i;
    if (!f.ok[k] || !f.ok[k + 1] || !f.ok[k + f.nx] || !f.ok[k + f.nx + 1]) return null;
    const tx = fx - i, ty = fy - j;
    const mix = (a) => (a[k] * (1 - tx) + a[k + 1] * tx) * (1 - ty) + (a[k + f.nx] * (1 - tx) + a[k + f.nx + 1] * tx) * ty;
    return [mix(f.vx), mix(f.vy), mix(f.sp)];
  };
  function resetParticles() {
    if (!field) { particles = []; return; }
    // Fewer lines close in, where one wind covers the whole screen and the map underneath matters more.
    const z = map.getZoom();
    const n = Math.round(Math.min(5000, (field.w * field.h) / 420) * (z >= 11 ? 0.35 : z >= 9 ? 0.6 : 1));
    particles = Array.from({ length: n }, () => ({ x: Math.random() * field.w, y: Math.random() * field.h, age: Math.floor(Math.random() * 90) }));
    sizeFlow();
  }
  function sizeFlow() {
    const s = map.getSize();
    dpr = window.devicePixelRatio || 1;
    flow.width = Math.round(s.x * dpr); flow.height = Math.round(s.y * dpr);
    flow.style.width = s.x + 'px'; flow.style.height = s.y + 'px';
  }
  function frame(t) {
    anim = requestAnimationFrame(frame);
    if (!field || !W.on || (W.style !== 'flow' && W.style !== 'both') || !onScreen(ctx.body) || moving) return;
    if (t - lastFrame < 33) return; // ~30 frames a second is smooth enough and half the work
    lastFrame = t;
    const g = flow.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Fade what was drawn: the lines leave a short tail.
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = 'rgba(0,0,0,0.9)';
    g.fillRect(0, 0, field.w, field.h);
    g.globalCompositeOperation = 'source-over';
    g.lineWidth = map.getZoom() >= 10 ? 1.2 : 1.5; g.lineCap = 'round';
    const k = 0.09; // pixels per frame per knot: speed shown in proportion, the same at every zoom
    const buckets = new Map();
    const dark = mapEl.classList.contains('night') || mapEl.classList.contains('base-dark');
    for (const p of particles) {
      const v = fieldAt(p.x, p.y);
      if (!v || p.age > 100) { p.x = Math.random() * field.w; p.y = Math.random() * field.h; p.age = 0; continue; }
      const nx = p.x + v[0] * k, ny = p.y + v[1] * k;
      const c = dark ? zpFlowColor(Math.round(v[2] / 5) * 5) : zpFlowDark(Math.round(v[2] / 5) * 5);
      if (!buckets.has(c)) buckets.set(c, []);
      buckets.get(c).push(p.x, p.y, nx, ny);
      p.x = nx; p.y = ny; p.age += 1;
    }
    for (const [c, segs] of buckets) {
      g.strokeStyle = c;
      g.beginPath();
      for (let i = 0; i < segs.length; i += 4) { g.moveTo(segs[i], segs[i + 1]); g.lineTo(segs[i + 2], segs[i + 3]); }
      g.stroke();
    }
  }
  let moving = false;
  const clearFlow = () => { const g = flow.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, flow.width, flow.height); };
  map.on('movestart zoomstart', () => { moving = true; clearFlow(); colour.hidden = true; });
  map.on('moveend', () => { moving = false; buildField(); colour.hidden = !(W.on && (W.style === 'field' || W.style === 'both')); });
  map.on('resize', () => { sizeFlow(); buildField(); });
  anim = requestAnimationFrame(frame);
  ctx.cleanups.push(() => cancelAnimationFrame(anim));

  /* ---------- colour field ---------- */
  const { cv: colour, place: placeColour } = zpPaneCanvas(map, 'zpColour', 320, 'zp-wcolour');
  function paintColour() {
    const on = W.on && (W.style === 'field' || W.style === 'both') && field;
    colour.hidden = !on;
    if (!on) return;
    const f = field, img = new ImageData(f.nx, f.ny);
    for (let k = 0; k < f.nx * f.ny; k += 1) {
      if (!f.ok[k]) continue;
      const c = zpWindRgb(f.sp[k]);
      img.data.set([c[0], c[1], c[2], 255], k * 4);
    }
    colour.width = f.nx; colour.height = f.ny;
    colour.getContext('2d').putImageData(img, 0, 0);
    colour.style.width = (f.nx * f.step) + 'px'; colour.style.height = (f.ny * f.step) + 'px';
  }

  /* ---------- barbs and arrows ---------- */
  ctx.cv.add(30, (c) => {
    if (!W.on || !W.barbs || !grid) return;
    const { g } = c;
    const spacing = 64;
    for (let y = spacing / 2; y < c.h; y += spacing) for (let x = spacing / 2; x < c.w; x += spacing) {
      const ll = map.containerPointToLatLng([x, y]);
      const uv = sample(grid, ll.lat, ll.lng);
      if (!uv) continue;
      zpBarb(g, x, y, PlanGeo.deg(Math.atan2(-uv[0], -uv[1])), Math.hypot(uv[0], uv[1]));
    }
  });

  /* ---------- legend, level and time ---------- */
  const legend = h('div', { class: 'zp-wlegend', hidden: true });
  ctx.hud.append(legend);
  let here = null;
  map.on('mousemove', (e) => { if (!W.on || !grid) return; here = gridAt(e.latlng.lat, e.latlng.lng); paintHere(); });
  const hereEl = h('div', { class: 'zp-where' });
  const paintHere = () => { hereEl.textContent = here ? `Wind hier: ${ctx.fmt.wind(here.dirDeg, here.speedKt)}` : ''; };
  function paintLegend() {
    legend.hidden = !W.on;
    if (!W.on) return;
    const stops = [0, 10, 20, 30, 40, 50, 60];
    const times = grid && grid.times ? grid.times : [];
    const slider = h('input', { type: 'range', min: 0, max: Math.max(0, Math.min(12, times.length - 1 || 12)), step: 1, value: W.hour || 0, class: 'zp-wslider' });
    slider.addEventListener('input', () => { W.hour = +slider.value; ctx.save(); timeLbl.textContent = tLabel(); load(); });
    const tLabel = () => {
      const t = times[W.hour || 0] || (grid && grid.validTime);
      return t ? `${W.hour ? '+' + W.hour + ' u · ' : 'Nu · '}${ctx.fmt.time(t)}` : W.hour ? `+${W.hour} u` : 'Nu';
    };
    const timeLbl = h('b', {}, tLabel());
    const status = loading ? 'Laden…' : gridErr ? gridErr : grid ? `${grid.model || 'Open-Meteo'} · opgehaald ${zulu(grid.fetchedAt)}${grid.via ? ' via ' + grid.via : ''}` : '';
    legend.replaceChildren(
      h('div', { class: 'zp-wl-head' }, icon('wind'),
        zpSelect(ZP_WIND_LEVELS.map((l) => ({ value: l.key, label: l.name })), W.level, (v) => { W.level = v; ctx.save(); load(); }),
        h('button', { class: 'w-tool', title: 'Windlaag uitzetten', onclick: () => { W.on = false; ctx.save(); apply(); ctx.emit('layers'); } }, icon('close'))),
      h('div', { class: 'zp-wl-time' }, timeLbl, slider),
      h('div', { class: 'zp-wl-bar', style: `background:linear-gradient(90deg,${stops.map((s, i) => `rgb(${zpWindRgb(s).join(',')}) ${((i / (stops.length - 1)) * 100).toFixed(0)}%`).join(',')})` }),
      h('div', { class: 'zp-wl-ticks' }, stops.map((s) => h('span', {}, cfg.units.wind === 'kt' ? String(s) : String(Math.round(PlanUnits.windIn(s, cfg.units.wind))))), h('span', {}, PlanUnits.WIND[cfg.units.wind].name)),
      hereEl,
      h('div', { class: 'zp-wl-src' + (gridErr ? ' bad' : '') }, status));
  }

  function apply() {
    if (!W.on) { grid = null; field = null; particles = []; clearFlow(); colour.hidden = true; paintLegend(); ctx.cv.request(); return; }
    paintLegend();
    load();
  }
  ctx.on('units', paintLegend);
  ctx.on('ready', apply);
  return { apply, load, ensureRoute, get grid() { return grid; }, levels: ZP_WIND_LEVELS };
}

// A wind barb as on aviation charts: the staff points into the wind, half barb 5 kt, full 10, flag 50.
function zpBarb(g, x, y, dirFrom, kt) {
  const a = PlanGeo.rad(dirFrom);
  const L = 22, ux = Math.sin(a), uy = -Math.cos(a); // towards where the wind comes from
  g.lineCap = 'round'; g.lineJoin = 'round';
  const stroke = (w, col) => {
    g.lineWidth = w; g.strokeStyle = col; g.fillStyle = col;
    if (kt < 2.5) { g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.stroke(); return; }
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + ux * L, y + uy * L); g.stroke();
    let left = Math.round(kt / 5) * 5, pos = L;
    const px = -uy, py = ux; // perpendicular, barbs to the left of the staff (northern hemisphere convention)
    while (left >= 50) {
      const bx = x + ux * pos, by = y + uy * pos;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * 9 - ux * 3, by + py * 9 - uy * 3); g.lineTo(bx - ux * 6, by - uy * 6); g.closePath(); g.fill();
      pos -= 7; left -= 50;
    }
    while (left >= 10) { const bx = x + ux * pos, by = y + uy * pos; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * 10 + ux * 3, by + py * 10 + uy * 3); g.stroke(); pos -= 4; left -= 10; }
    if (left >= 5) { if (pos === L) pos -= 4; const bx = x + ux * pos, by = y + uy * pos; g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + px * 5 + ux * 1.5, by + py * 5 + uy * 1.5); g.stroke(); }
  };
  stroke(3.6, 'rgba(5,9,16,0.8)');
  stroke(1.6, '#ffffff');
}
