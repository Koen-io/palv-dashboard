'use strict';

/* ============================================================
   Zoek & Plan — het tabblad: opbouw, gedeelde toestand en de samenhang tussen de onderdelen.
   ============================================================ */
// One plan widget fills the page. Its parts (route, tools, wind, airspace, offshore, fleet, search,
// panels) are functions in the other zp-*.js files that each get the same `ctx`:
//   ctx.w          the widget (settings in w.cfg, saved with the dashboard)
//   ctx.map, ctx.cv  the Leaflet map and the symbol canvas (zp-map.js)
//   ctx.units()    the chosen units; ctx.fmt.*  formatting in those units
//   ctx.profile()  the selected helicopter profile (public values with the unit's own laid over them)
//   ctx.on/emit    events between the parts: 'route', 'select', 'profile', 'units', 'wind', 'store', ...
//   ctx.windAt(lat, lon, ms, ft)  wind from what has been fetched (null when not known yet)
//   ctx.mag(lat, lon)  magnetic variation (WMM2025), degrees east
const ZP_LIVE = new Set(); // mounted plan widgets, for the store events from the main process

const ZP_DEFAULTS = {
  lat: 52.25, lon: 4.95, zoom: 8.3, base: 'osm', raster: [],
  units: { ...PlanUnits.DEFAULTS },
  profile: 'ec135', reg: '',
  side: true, sideTab: 'route',
  aero: { on: true, types: ['CTR', 'TMA', 'CTA', 'ATZ', 'TIZ', 'TIA', 'RMZ', 'TMZ', 'P', 'R', 'D', 'TRA', 'TSA', 'MATZ', 'HTZ'], maxFloorFt: 6000, labels: true, fill: true },
  points: { airports: true, heliports: true, hospitals: true, vrp: true, navaids: true, obstacles: false, obstacleMinFt: 300, turbines: false, farms: true },
  offshore: { on: true, kinds: ['platform', 'satellite', 'substation', 'fpso'], active: true, world: true, labels: true },
  wind: { on: false, style: 'flow', level: '975', hour: 0, barbs: false },
  wx: { metar: false, sigmet: false },
  fleet: { on: true, groups: ['police'], vectors: 2, labels: true, trails: true },
  grid: false, terminator: false, compass: true,
  rings: { stepNm: 5, count: 5 },
  route: { name: '', points: [], altFt: null, ias: null, departAt: null, fuelKg: null, weightKg: null },
  bases: null,
};

// Standard bases for "Wie is er het snelst"; editable under Opgeslagen.
const ZP_BASES_DEFAULT = [{ id: 'eham', name: 'Schiphol-Oost (basis)', lat: 52.3124, lon: 4.7862, startMin: 10 }];

function zpCfg(w) {
  const c = w.cfg;
  for (const [k, v] of Object.entries(ZP_DEFAULTS)) {
    if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(v));
    else if (v && typeof v === 'object' && !Array.isArray(v) && c[k] && typeof c[k] === 'object') c[k] = { ...JSON.parse(JSON.stringify(v)), ...c[k] };
  }
  if (!Array.isArray(c.route.points)) c.route.points = [];
  return c;
}

function zpCreate(body, w) {
  const cfg = zpCfg(w);
  const listeners = new Map();
  const ctx = {
    w, cfg, body,
    on(ev, fn) { if (!listeners.has(ev)) listeners.set(ev, new Set()); listeners.get(ev).add(fn); return () => listeners.get(ev).delete(fn); },
    emit(ev, data) { for (const fn of listeners.get(ev) || []) { try { fn(data); } catch (err) { plog('warn', `zoek & plan: ${ev} mislukt`, String(err && err.stack || err)); } } },
    save: () => save(),
    store: { private: { profiles: {}, decks: {}, keys: {} }, shared: { routes: {}, favorites: {}, bases: {} } },
    timers: [],
    cleanups: [],
  };

  /* ---------- layout ---------- */
  const mapEl = h('div', { class: 'zp-map vr-map no-fade' });
  const hud = h('div', { class: 'zp-hud' });
  const side = h('aside', { class: 'zp-side' });
  const card = h('div', { class: 'zp-card', hidden: true });
  const bar = h('div', { class: 'zp-bar' });
  const mapBox = h('div', { class: 'zp-mapbox' }, mapEl, hud, card);
  const root = h('div', { class: 'zp' }, bar, h('div', { class: 'zp-main' }, side, mapBox));
  body.append(root);
  Object.assign(ctx, { root, bar, side, mapBox, mapEl, hud, card });
  root.classList.toggle('side-off', !cfg.side);

  const map = L.map(mapEl, {
    zoomControl: false, attributionControl: true, zoomSnap: 0, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    minZoom: 2, maxZoom: 19, worldCopyJump: true, fadeAnimation: true, inertia: true, boxZoom: false, doubleClickZoom: false,
  });
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Inzoomen', zoomOutTitle: 'Uitzoomen' }).addTo(map);
  map.setView([cfg.lat, cfg.lon], cfg.zoom, { animate: false });
  ctx.map = map;
  ctx.el = mapEl;
  ctx.cv = zpCanvas(map);
  ctx.base = zpBaseLayers(ctx);
  ctx.base.apply();
  // Vector layers (airspace, route lines) on Leaflet's own canvas, so they follow zoom animations.
  ctx.vector = L.canvas({ padding: 0.3, pane: 'zpAir', tolerance: 4 });
  ctx.lines = L.canvas({ padding: 0.3, pane: 'zpLines', tolerance: 6 });
  map.on('moveend', () => {
    const c = map.getCenter();
    Object.assign(cfg, { lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), zoom: +map.getZoom().toFixed(2) });
    save();
    ctx.emit('view');
  });

  /* ---------- units and formatting ---------- */
  const U = PlanUnits;
  ctx.units = () => cfg.units;
  ctx.mag = (lat, lon) => { try { return PlanWmm.declination(lat, lon, 0, new Date()); } catch { return 0; } };
  // A course for display: magnetic or true, as chosen, with the letter that says which.
  const course = (trueDeg, lat, lon) => {
    if (trueDeg == null) return '—';
    if (cfg.units.north === 'true') return `${U.hdg(trueDeg)}T`;
    return `${U.hdg(trueDeg - ctx.mag(lat, lon))}M`;
  };
  ctx.fmt = {
    dist: (m, digits) => U.fmtDist(m, cfg.units.dist, digits),
    speed: (kt) => U.fmtSpeed(kt, cfg.units.speed),
    alt: (ft) => U.fmtAlt(ft, cfg.units.alt),
    fuel: (kg) => U.fmtFuel(kg, cfg.units.fuel, ctx.planning().density),
    wind: (dir, kt) => U.fmtWind(dir, kt, cfg.units.wind),
    windSpeed: (kt) => U.fmtWindSpeed(kt, cfg.units.wind),
    course,
    dur: U.fmtDur,
    coord: (lat, lon, style) => PlanCoords.fmt(lat, lon, style || cfg.units.coord) || PlanCoords.fmt(lat, lon, 'ddm'),
    time: (ms) => {
      if (ms == null) return '—';
      if (cfg.units.time === 'lt') return ltFmt.format(ms) + ' LT';
      return zulu(ms);
    },
  };

  /* ---------- profiles ---------- */
  ctx.profiles = () => PlanProfiles.profiles(Object.fromEntries(Object.entries(ctx.store.private.profiles || {}).map(([k, v]) => [k, v])), {});
  ctx.profile = () => { const all = ctx.profiles(); return all[cfg.profile] || all.ec135; };
  // Planning figures: the profile's, with what was set for this flight on top.
  ctx.planning = () => {
    const prof = ctx.profile();
    const p = PlanProfiles.planning(prof);
    const r = cfg.route;
    const out = {
      ...p,
      ias: r.ias || p.ias, altFt: r.altFt != null ? r.altFt : p.altFt, weightKg: r.weightKg || p.weightKg,
      fuelKg: r.fuelKg != null ? r.fuelKg : p.usableKg, flowSrc: zpSrc(prof.fuel.plan) || 'profiel',
    };
    // With the flight manual's cruise table on board, the fuel flow is read from it for this speed,
    // height and weight (ISA temperature) instead of the one planning figure.
    const tbl = prof.fuel.flowTable;
    if (Array.isArray(tbl) && tbl.length) {
      const f = PlanPerf.flowAt(tbl.filter((x) => x.kias > 0), { kias: out.ias, weightKg: out.weightKg, paFt: out.altFt });
      if (f && f.kgh > 0) { out.flowKgh = f.kgh; out.flowSrc = prof.fuel.flowTableSrc || 'verbruikstabel vlieghandboek'; }
    }
    // Final reserve and contingency by the operations manual (BOM Deel A): minutes at best range speed by
    // day, at holding speed at night, over sea and IFR; never less than the fixed figure the unit holds.
    const B = prof.fuel.bom || {}, V = PlanProfiles.v;
    const ft = ctx.flightType();
    const minutes = ft === 'vfr-dag' ? V(B.frfMinDay, 20) : ft === 'vfr-zee' ? V(B.frfMinSea, 30) : ft === 'ifr' ? V(B.frfMinIfr, 30) : V(B.frfMinNight, 30);
    const basisKias = ft === 'vfr-dag' ? V(prof.speeds.maxRange) || V(prof.speeds.cruiseEco) : V(prof.speeds.endurance);
    let basisFlow = null;
    if (Array.isArray(tbl) && tbl.length && typeof basisKias === 'number') { const f = PlanPerf.flowAt(tbl.filter((x) => x.kias > 0), { kias: basisKias, weightKg: out.weightKg, paFt: out.altFt }); basisFlow = f && f.kgh; }
    if (!(basisFlow > 0)) basisFlow = V(ft === 'vfr-dag' ? prof.fuel.flowEco : prof.fuel.flowEndurance) || out.flowKgh;
    const frf = PlanPerf.finalReserve({ minutes, flowKgh: basisFlow, fixedKg: V(B.frfKg) });
    Object.assign(out, {
      flightType: ft, frf, frfBasis: ft === 'vfr-dag' ? 'beste bereiksnelheid' : 'holdingsnelheid', frfBasisFlow: basisFlow,
      frfSrc: zpSrc(ft === 'vfr-dag' ? B.frfMinDay : B.frfMinNight) || 'Standaard planning', frfKgSrc: zpSrc(B.frfKg),
      reserveMin: minutes, reserveKg: frf.kg, contPct: V(B.contingencyPct, 5), contSrc: zpSrc(B.contingencyPct) || 'Standaard planning',
      density: r.fuelType === 'jp8' ? 0.81 : out.density,
    });
    return out;
  };
  // Day or night by the official daylight period (UDP) at departure and arrival, over sea when the route
  // goes to a platform or helideck; or as set for the flight.
  ctx.flightType = () => {
    const r = cfg.route;
    if (r.flightType && r.flightType !== 'auto') return r.flightType;
    if (r.points.some((p) => p.kind === 'platform' || p.kind === 'heliport-offshore')) return 'vfr-zee';
    const dep = r.departAt || Date.now(), eta = ctx.plan ? ctx.plan.total.etaMs : dep;
    const day = (ms) => { try { const u = ASTRO.udpToday(ms); return ms >= u.begin && ms < u.end; } catch { return true; } };
    return day(dep) && day(eta) ? 'vfr-dag' : 'vfr-nacht';
  };
  ctx.tas = (altFt, oatC) => { const pl = ctx.planning(); return PlanPerf.tasFromIas(pl.ias, altFt != null ? altFt : pl.altFt, oatC); };
  ctx.vne = (q = {}) => {
    const p = ctx.profile(), pl = ctx.planning();
    const table = p.vneTable && p.vneTable.length ? p.vneTable : null;
    const r = table ? PlanPerf.vneAt(table, { weightKg: q.weightKg || pl.weightKg, paFt: q.altFt != null ? q.altFt : pl.altFt, oatC: q.oatC }) : null;
    return r ? { ...r, src: p.vneTableSrc || 'VNE-tabel' } : { kias: PlanProfiles.v(p.speeds.vne), exact: false, src: p.speeds.vne && p.speeds.vne.src };
  };

  /* ---------- wind lookups (filled by zp-wind.js) ---------- */
  ctx.windAt = () => null;

  /* ---------- the store: private and shared files ---------- */
  ctx.loadStore = async () => {
    try { const st = await window.palv.plan.store(); if (st && st.private) { ctx.store = st; ctx.emit('store'); ctx.emit('profile'); } } catch { /* keep the empty store */ }
  };
  ctx.put = (kind, list, id, item) => window.palv.plan.put(kind, list, id, item).then((st) => { if (st && st[list] !== undefined) { ctx.store[kind] = st; ctx.emit('store'); } return st; });
  ctx.bases = () => {
    const own = Object.entries(ctx.store.shared.bases || {}).map(([id, b]) => ({ id, ...b }));
    return own.length ? own : ZP_BASES_DEFAULT;
  };

  /* ---------- selection: the point the tools work from ---------- */
  ctx.selected = null; // { lat, lon, label, kind, item }
  ctx.select = (sel) => { ctx.selected = sel; ctx.emit('select', sel); ctx.cv.request(); };

  /* ---------- hover readout ---------- */
  const readout = h('div', { class: 'zp-readout' });
  const scale = h('div', { class: 'zp-scale' }, h('div', { class: 'zp-scale-row' }, h('i'), h('span')), h('div', { class: 'zp-scale-row km' }, h('i'), h('span')));
  hud.append(h('div', { class: 'zp-corner' }, scale, readout));
  let cursor = null;
  const paintReadout = () => {
    if (!cursor) { readout.hidden = true; return; }
    readout.hidden = false;
    const parts = [h('b', {}, ctx.fmt.coord(cursor.lat, cursor.lng))];
    const from = ctx.selected;
    if (from) {
      const d = PlanGeo.dist(from, { lat: cursor.lat, lon: cursor.lng });
      parts.push(h('span', {}, `${course(PlanGeo.bearing(from, { lat: cursor.lat, lon: cursor.lng }), from.lat, from.lon)} · ${ctx.fmt.dist(d)} vanaf ${from.label || 'selectie'}`));
    }
    readout.replaceChildren(...parts);
  };
  map.on('mousemove', (e) => { cursor = e.latlng; paintReadout(); });
  map.on('mouseout', () => { cursor = null; paintReadout(); });
  const paintScale = () => {
    const y = map.getSize().y / 2;
    const mPer100 = map.distance(map.containerPointToLatLng([0, y]), map.containerPointToLatLng([100, y]));
    if (!(mPer100 > 0)) return;
    const nice = (unitM, label, row) => {
      const per100 = mPer100 / unitM;
      const v = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].find((x) => (x / per100) * 100 >= 70) || 2000;
      row.firstChild.style.width = ((v / per100) * 100).toFixed(0) + 'px';
      row.lastChild.textContent = `${String(v).replace('.', ',')} ${label}`;
    };
    const du = cfg.units.dist;
    nice(U.DIST[du].m, U.DIST[du].name, scale.children[0]);
    const other = du === 'km' ? 'nm' : 'km';
    nice(U.DIST[other].m, U.DIST[other].name, scale.children[1]);
  };
  map.on('zoomend moveend resize', paintScale);
  ctx.on('units', () => { paintScale(); paintReadout(); ctx.cv.request(); });
  ctx.on('select', paintReadout);
  paintScale();

  /* ---------- the parts ---------- */
  const parts = [zpRoute, zpTools, zpWind, zpAero, zpOffshore, zpFleet, zpExtras, zpSearch, zpPanels, zpItems];
  ctx.parts = {};
  for (const part of parts) {
    try { ctx.parts[part.name] = part(ctx) || {}; } catch (err) { plog('error', `zoek & plan: ${part.name} kon niet starten`, String(err && err.stack || err)); }
  }

  /* ---------- clicks on the map ---------- */
  // A click goes to the active tool (route, tape, rings); otherwise to the symbol under the pointer, and
  // otherwise it selects that point of the map.
  ctx.mode = 'select';
  // One tool at a time; choosing the active one again stops it (unless `force`).
  ctx.setMode = (m, force) => { const next = !force && ctx.mode === m && m !== 'select' ? 'select' : m; if (next === ctx.mode) return; ctx.mode = next; mapEl.dataset.mode = ctx.mode; ctx.emit('mode', ctx.mode); };
  mapEl.dataset.mode = 'select';
  map.on('click', (e) => {
    const p = e.containerPoint;
    const handled = { done: false };
    ctx.emit('mapclick', { e, latlng: e.latlng, x: p.x, y: p.y, handled });
    if (handled.done) return;
    const hit = ctx.cv.hitAt(p.x, p.y);
    if (hit) { ctx.emit('hit', { hit, latlng: e.latlng }); return; }
    ctx.emit('pick', { lat: e.latlng.lat, lon: e.latlng.lng, x: p.x, y: p.y });
  });
  map.on('mousemove', (e) => {
    const hit = ctx.cv.hitAt(e.containerPoint.x, e.containerPoint.y);
    mapEl.classList.toggle('pointing', !!hit);
  });
  map.on('contextmenu', (e) => ctx.emit('contextmenu', { latlng: e.latlng, x: e.containerPoint.x, y: e.containerPoint.y }));

  const onKey = (e) => {
    if (!onScreen(body) || modalOpen() || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
    if (e.key === 'Escape' && ctx.mode !== 'select') { ctx.setMode('select'); e.stopPropagation(); }
    const k = e.key.toLowerCase();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const byKey = { r: 'route', m: 'measure', g: 'rings', z: 'pattern', o: 'orbit', b: 'reach' };
    if (byKey[k]) ctx.setMode(byKey[k]);
    else if (k === 'delete' || k === 'backspace') ctx.emit('delete');
    else return;
    e.preventDefault();
  };
  window.addEventListener('keydown', onKey, true);

  ctx.loadStore();
  ZP_LIVE.add(ctx);
  ctx.emit('ready');
  return {
    ctx, map,
    fit() { map.invalidateSize(false); ctx.cv.request(); },
    destroy() {
      ZP_LIVE.delete(ctx);
      window.removeEventListener('keydown', onKey, true);
      for (const t of ctx.timers) clearInterval(t);
      for (const fn of ctx.cleanups) { try { fn(); } catch { /* gone */ } }
      ctx.base.destroy();
      map.remove();
    },
  };
}

// The files changed, here or on another screen: every plan widget takes the new contents.
window.palv.plan.onStore((msg) => {
  for (const ctx of ZP_LIVE) {
    if (!msg || !msg.kind) continue;
    ctx.store[msg.kind] = msg.data;
    ctx.emit('store');
    if (msg.kind === 'private') ctx.emit('profile');
  }
});

/* ---------- shared UI pieces ---------- */
// A small titled section with rows of key/value.
const zpRow = (k, v, title) => h('div', { class: 'zp-kv', title: title || null }, h('span', {}, k), h('b', {}, v));
const zpBtn = (label, onclick, opts = {}) => h('button', { class: 'btn zp-btn' + (opts.primary ? ' primary' : '') + (opts.cls ? ' ' + opts.cls : ''), title: opts.title || null, onclick, disabled: opts.disabled || null }, opts.icon ? icon(opts.icon) : null, label);
const zpNum = (value, onChange, attrs = {}) => {
  const el = h('input', { class: 'input zp-num', type: 'number', value: value == null ? '' : value, ...attrs });
  el.addEventListener('change', () => onChange(el.value === '' ? null : +el.value));
  return el;
};
const zpSelect = (options, value, onChange, attrs = {}) => {
  const el = h('select', { class: 'input zp-sel', ...attrs }, options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) || null }, o.label)));
  el.addEventListener('change', () => onChange(el.value));
  return el;
};
// Source of a profile value, shown in a tooltip and as a small tag.
const zpSrc = (field) => (field && field.src ? `${field.src}${field.note ? ' — ' + field.note : ''}` : '');
async function zpCopy(text) {
  try { await navigator.clipboard.writeText(text); toast('Gekopieerd: ' + text); } catch { toast('Kopiëren lukte niet', true); }
}
