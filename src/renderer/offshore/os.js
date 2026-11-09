'use strict';

/* ============================================================
   Offshore: één kaart met alles van de offshore-operatie: platforms (olie, gas, wind), windparken en
   veiligheidszones, helidekken, EEZ en 12-mijlsgrens, pijpleidingen en kabels, scheepsdichtheid,
   zeekaart, KNRM-stations, vuurtorens en havens, de eigen vloot, de Noordzee-weerstations, en live AIS
   met alle schepen: koers, snelheid, past track, scheepsdata en foto's.
   ============================================================ */
const OS_WMS = {
  eez: { name: 'EEZ en 12-mijlsgrens (Marine Regions)', url: 'https://geo.vliz.be/geoserver/MarineRegions/wms', layers: 'eez_boundaries,eez_12nm', attr: '© Marine Regions (VLIZ)', opacity: 0.4, z: 'zpRaster' },
  pipelines: { name: 'Pijpleidingen (EMODnet)', url: 'https://ows.emodnet-humanactivities.eu/wms', layers: 'pipelines', attr: '© EMODnet Human Activities', opacity: 0.8, z: 'zpRaster' },
  cables: { name: 'Kabels: stroom en telecom (EMODnet)', url: 'https://ows.emodnet-humanactivities.eu/wms', layers: 'powercables,telecablesactual', attr: '© EMODnet Human Activities', opacity: 0.8, z: 'zpRaster' },
  density: { name: 'Scheepsdichtheid, jaargemiddelde (EMODnet)', url: 'https://ows.emodnet-humanactivities.eu/wms', layers: 'vesseldensity_allavg', attr: '© EMODnet Human Activities', opacity: 0.55, z: 'zpUnder2' },
  military: { name: 'Militaire oefengebieden (EMODnet)', url: 'https://ows.emodnet-humanactivities.eu/wms', layers: 'militaryareaspoly', attr: '© EMODnet Human Activities', opacity: 0.5, z: 'zpRaster' },
  natura: { name: 'Natura 2000 (EMODnet)', url: 'https://ows.emodnet-humanactivities.eu/wms', layers: 'natura2000areas', attr: '© EMODnet Human Activities', opacity: 0.45, z: 'zpRaster' },
};
const OS_PLACE_KINDS = { lifeboat: { name: 'KNRM-reddingstations', color: '#ff9f1c' }, coastguard: { name: 'Kustwachtposten', color: '#b48cff' }, lighthouse: { name: 'Vuurtorens en grote lichten', color: '#ffe14d' }, harbour: { name: 'Havens en marina\'s', color: '#7cc6ff' }, hospital: { name: 'Ziekenhuizen (spoed)', color: '#ff4b55' }, helipad: { name: 'Helipads', color: '#3ecf6e' } };
const OS_LAYER_DEFAULTS = { platforms: true, farms: true, turbines: false, helidecks: true, wx: true, fleet: true, ships: true, tracks: true, labels: true, places: true, eez: true, pipelines: false, cables: false, density: false, military: false, natura: false, seamark: true };

function osCfg(w) {
  const c = w.cfg;
  for (const [k, v] of Object.entries(WIDGET_META.offshore.defaults)) if (c[k] === undefined) c[k] = JSON.parse(JSON.stringify(v));
  c.layers = { ...OS_LAYER_DEFAULTS, ...(c.layers || {}) };
  if (!Array.isArray(c.shipTypes) || !c.shipTypes.length) c.shipTypes = ['all'];
  if (!Array.isArray(c.pins)) c.pins = [];
  if (!c.places || typeof c.places !== 'object') c.places = Object.fromEntries(Object.keys(OS_PLACE_KINDS).map((k) => [k, k !== 'helipad' && k !== 'hospital']));
  if (!Array.isArray(c.raster)) c.raster = ['seamark'];
  return c;
}

function osCreate(body, w) {
  const cfg = osCfg(w);
  const L_ = cfg.layers;
  const root = h('div', { class: 'os' });
  const bar = h('div', { class: 'zp-bar os-bar' });
  const side = h('aside', { class: 'os-side' });
  const mapEl = h('div', { class: 'zp-map vr-map no-fade' });
  const hud = h('div', { class: 'zp-hud' });
  const card = h('div', { class: 'zp-card os-card', hidden: true });
  const mapBox = h('div', { class: 'zp-mapbox' }, mapEl, hud, card);
  root.append(bar, h('div', { class: 'os-body' }, side, mapBox));
  body.append(root);
  root.classList.toggle('side-off', !cfg.side);
  const timers = [], cleanups = [];

  /* ---------- the map ---------- */
  const map = L.map(mapEl, { zoomControl: false, attributionControl: true, zoomSnap: 0, zoomDelta: 0.5, scrollWheelZoom: false, smoothWheel: true, minZoom: 3, maxZoom: 18, fadeAnimation: true, inertia: true, boxZoom: false, doubleClickZoom: false });
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Inzoomen', zoomOutTitle: 'Uitzoomen' }).addTo(map);
  map.setView([cfg.lat, cfg.lon], cfg.zoom, { animate: false });
  const ctx = { map, el: mapEl, w, cfg, body };
  ctx.cv = zpCanvas(map);
  ctx.base = zpBaseLayers(ctx);
  ctx.base.apply();
  map.createPane('zpUnder2').style.zIndex = 195;
  map.getPane('zpUnder2').style.pointerEvents = 'none';
  ctx.vector = L.canvas({ padding: 0.3, pane: 'zpAir', tolerance: 4 });
  map.on('moveend', () => { const c = map.getCenter(); Object.assign(cfg, { lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), zoom: +map.getZoom().toFixed(2) }); save(); });
  const wms = {};
  function applyWms() {
    for (const [k, d] of Object.entries(OS_WMS)) {
      const on = !!L_[k];
      if (on && !wms[k]) wms[k] = L.tileLayer.wms(d.url, { layers: d.layers, format: 'image/png', transparent: true, version: '1.3.0', pane: d.z === 'zpUnder2' ? 'zpUnder2' : 'zpRaster', opacity: d.opacity, attribution: d.attr, maxZoom: 19, tileSize: 512, zoomOffset: -1 }).addTo(map);
      else if (!on && wms[k]) { wms[k].remove(); delete wms[k]; }
    }
    cfg.raster = L_.seamark ? [...new Set([...(cfg.raster || []).filter((x) => x !== 'seamark'), 'seamark'])] : (cfg.raster || []).filter((x) => x !== 'seamark');
    ctx.base.applyRaster();
  }
  applyWms();

  /* ---------- data ---------- */
  const D = { platforms: [], areas: { farms: [], zones: [] }, farmLayer: null, places: [], decks: [], ships: new Map(), shipsRev: 0, aisStatus: null, track: null, trackFor: null, snap: null, lastAis: 0, aisFail: 0, photo: null };
  let sel = null; // { kind: 'ship' | 'platform' | 'place' | 'aircraft' | 'point', item, lat, lon }
  let follow = null; // mmsi the map follows
  async function loadPlatforms(force) {
    try { const r = await window.palv.plan.platforms({ force: !!force }); if (r && Array.isArray(r.items)) D.platforms = r.items.filter((p) => p.offshore !== false && p.kind !== 'onshore'); } catch { /* keep */ }
    try { const r = await window.palv.plan.platformAreas(); if (r && r.farms) { D.areas = r; drawFarms(); } } catch { /* none */ }
    ctx.cv.request(); paintSoon();
  }
  async function loadPlaces(force) {
    try { const r = await window.palv.offshore.places(!!force); if (r && Array.isArray(r.items)) D.places = r.items; } catch { /* none */ }
    ctx.cv.request();
  }
  async function loadDecks() {
    try { const r = await window.palv.plan.aero(['NL', 'BE', 'DE', 'GB', 'DK']); if (r && Array.isArray(r.airports)) D.decks = r.airports.filter((a) => a.type === 'heliport-offshore'); } catch { /* no openAIP key */ }
    ctx.cv.request();
  }
  function drawFarms() {
    if (D.farmLayer) { D.farmLayer.remove(); D.farmLayer = null; }
    if (!L_.farms) return;
    const feats = [...D.areas.zones.map((z) => ({ type: 'Feature', geometry: z.polygon || z.geometry, properties: { kind: 'zone', name: z.name } })), ...D.areas.farms.map((f) => ({ type: 'Feature', geometry: f.polygon || f.geometry, properties: { kind: 'farm', name: f.name } }))].filter((f) => f.geometry);
    D.farmLayer = L.geoJSON({ type: 'FeatureCollection', features: feats }, { renderer: ctx.vector, interactive: false, style: (f) => (f.properties.kind === 'zone' ? { color: '#7cc6ff', weight: 1, dashArray: '3 4', fillOpacity: 0, opacity: 0.7 } : { color: '#7cc6ff', weight: 1.4, fillColor: '#7cc6ff', fillOpacity: 0.07, opacity: 0.9 }) }).addTo(map);
  }
  // AIS: every two seconds what changed, while the tab is in view.
  async function pollAis() {
    if (!onScreen(body) || !L_.ships) return;
    try {
      const r = await window.palv.ais.snap(D.shipsRev);
      if (!r || !r.ok) { D.aisFail += 1; return; }
      D.aisStatus = r.status; D.lastAis = r.lastMsg || 0; D.aisFail = 0;
      for (const v of r.vessels) D.ships.set(v.mmsi, v);
      for (const mmsi of r.gone || []) D.ships.delete(mmsi);
      D.shipsRev = r.rev;
      if (sel && sel.kind === 'ship') { const v = D.ships.get(sel.item.mmsi); if (v) { sel.item = v; if (r.vessels.some((x) => x.mmsi === v.mmsi)) paintCard(); } }
      if (follow) { const v = D.ships.get(follow); const p = v && osNow(v, Date.now()); if (p) map.panTo(p, { animate: true, duration: 0.6 }); }
      if (r.vessels.length || (r.gone && r.gone.length)) ctx.cv.request();
      paintStatus();
      // The list in the panel: at most every ten seconds from the stream (a search or sort repaints at once).
      if (cfg.sideTab === 'ships' && Date.now() - lastListPaint > 10000) paintSoon();
    } catch { D.aisFail += 1; }
  }
  let lastListPaint = 0;
  const unwatchTraffic = watchTraffic((s) => { D.snap = s; if (L_.fleet && onScreen(body)) ctx.cv.request(); }, () => (L_.fleet && onScreen(body) && map._loaded ? (() => { const b = map.getBounds(), c = b.getCenter(); return { lat: c.lat, lon: c.lng, nm: Math.min(250, (map.distance(c, b.getNorthEast()) / 1852) * 1.1 + 5) }; })() : null));
  cleanups.push(unwatchTraffic);
  const unwatchWx = watchWx(() => { if (L_.wx) ctx.cv.request(); });
  cleanups.push(unwatchWx);

  /* ---------- drawing ---------- */
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const fam = () => getComputedStyle(document.body).fontFamily;
  const shown = (v) => { if (!L_.ships) return false; if (!(cfg.shipTypes.includes('all') || cfg.shipTypes.includes(osGroup(v)))) return false; if (cfg.minSog > 0 && !(v.sog >= cfg.minSog) && v.cls !== 'aton') return false; return true; };
  // Ship outline, bow up: a pointed hull for a moving vessel, a dot for one at rest.
  function shipShape(g, x, y, hdg, px, color, moving, pinned, selected) {
    g.save(); g.translate(x, y);
    if (moving) { g.rotate(((hdg || 0) * Math.PI) / 180); g.beginPath(); g.moveTo(0, -px); g.lineTo(px * 0.55, px * 0.7); g.lineTo(0, px * 0.4); g.lineTo(-px * 0.55, px * 0.7); g.closePath(); }
    else { g.beginPath(); g.arc(0, 0, px * 0.5, 0, Math.PI * 2); }
    g.fillStyle = color; g.fill();
    g.lineWidth = selected ? 2.5 : 1.2; g.strokeStyle = selected ? '#ffffff' : pinned ? '#ffffff' : '#0a0f18'; g.stroke();
    g.restore();
  }
  ctx.cv.add(30, (c) => {
    const { g } = c, z = c.zoom;
    const font = `700 ${(0.6 * rem()).toFixed(1)}px ${fam()}`;
    // Places (coast) and helidecks.
    if (L_.places) for (const p of D.places) {
      if (!cfg.places[p.kind] || z < 7) continue;
      const q = c.P(p.lat, p.lon); if (!c.inView(q, 20)) continue;
      const k = OS_PLACE_KINDS[p.kind];
      g.fillStyle = k.color; g.strokeStyle = '#0a0f18'; g.lineWidth = 1.2;
      g.beginPath();
      if (p.kind === 'lighthouse') { g.moveTo(q[0], q[1] - 6); g.lineTo(q[0] + 5, q[1] + 5); g.lineTo(q[0] - 5, q[1] + 5); g.closePath(); }
      else if (p.kind === 'lifeboat') { g.rect(q[0] - 5, q[1] - 5, 10, 10); }
      else g.arc(q[0], q[1], 4.5, 0, Math.PI * 2);
      g.fill(); g.stroke();
      if (L_.labels && z >= 9 && p.name) zpText(g, p.name, q[0] + 8, q[1], { font, color: '#e9eff8' });
      c.hit({ x: q[0], y: q[1], r: 8, kind: 'place', item: p, z: 2 });
    }
    if (L_.helidecks) for (const d of D.decks) {
      const q = c.P(d.lat, d.lon); if (!c.inView(q, 20) || z < 7) continue;
      g.font = `800 ${(0.62 * rem()).toFixed(1)}px sans-serif`;
      zpText(g, 'H', q[0], q[1], { color: '#3ecf6e', align: 'center' });
      c.hit({ x: q[0], y: q[1], r: 8, kind: 'deck', item: d, z: 2 });
    }
    // Platforms.
    if (L_.platforms) {
      const labels = [];
      for (const p of D.platforms) {
        if (p.kind === 'turbine') { if (!L_.turbines || z < 10) continue; const q = c.P(p.lat, p.lon); if (!c.inView(q, 10)) continue; zpObstacle(g, q[0], q[1], false, true); c.hit({ x: q[0], y: q[1], r: 7, kind: 'platform', item: p, z: 1 }); continue; }
        if (p.kind === 'onshore') continue;
        const q = c.P(p.lat, p.lon); if (!c.inView(q, 30)) continue;
        const k = ZP_KINDS[p.kind] || ZP_KINDS.other;
        const s = z < 7 ? 3 : z < 9 ? 4.5 : 6;
        g.lineWidth = 1.6; g.strokeStyle = '#0a0f18';
        g.fillStyle = p.status === 'buiten gebruik' || p.status === 'ontmanteld' ? 'rgba(140,150,165,0.8)' : k.color;
        if (p.kind === 'subsea') { g.beginPath(); g.arc(q[0], q[1], s * 0.8, 0, Math.PI * 2); g.fill(); g.stroke(); }
        else if (p.kind === 'fpso') { g.beginPath(); g.ellipse(q[0], q[1], s * 1.4, s * 0.7, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
        else { g.fillRect(q[0] - s, q[1] - s, s * 2, s * 2); g.strokeRect(q[0] - s, q[1] - s, s * 2, s * 2); }
        if (p.helideck && z >= 8) { g.font = `800 ${(0.6 * rem()).toFixed(1)}px sans-serif`; zpText(g, 'H', q[0] + s + 5, q[1] - s - 2, { color: '#fff', align: 'center' }); }
        if (L_.labels && z >= 8.5) labels.push([p.name, q[0] + s + 4, q[1] + s + 4]);
        c.hit({ x: q[0], y: q[1], r: Math.max(8, s + 3), kind: 'platform', item: p, z: 3 });
      }
      const boxes = [];
      for (const [t, x, y] of labels) { if (boxes.some((b) => Math.abs(b[0] - x) < 70 && Math.abs(b[1] - y) < 13)) continue; boxes.push([x, y]); zpText(g, t, x, y, { font, color: '#ffe2b0' }); }
    }
    // Weather stations at sea and along the coast, judged against the BOM profile of the moment.
    if (L_.wx && z >= 6) {
      const pid = bomPeriod() === 'day' ? 'mpd' : 'aided';
      for (const st of wxFeed.stations) {
        if (!/^EH/.test(st.icao) && z < 8) continue;
        const q = c.P(st.lat, st.lon); if (!c.inView(q, 20)) continue;
        const a = WX.assess(pid, st, Date.now());
        g.beginPath(); g.arc(q[0], q[1], 6, 0, Math.PI * 2);
        g.fillStyle = { green: '#2fd67b', amber: '#ffb020', red: '#ff4d42', none: '#7c8aa0' }[a.status]; g.fill();
        g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
        if (z >= 8) zpText(g, `${st.icao} ${WX.windText(st.metar.wind)}`, q[0] + 9, q[1], { font, color: '#fff' });
        c.hit({ x: q[0], y: q[1], r: 9, kind: 'wx', item: st, z: 4 });
      }
    }
  });
  // Ships, their tracks, then the own fleet on top.
  ctx.cv.add(60, (c) => {
    const { g } = c, z = c.zoom, now = Date.now();
    const font = `700 ${(0.62 * rem()).toFixed(1)}px ${fam()}`;
    if (L_.tracks && D.track && D.track.length > 1 && sel && sel.kind === 'ship' && D.trackFor === sel.item.mmsi) {
      g.lineWidth = 2.2; g.strokeStyle = OS_GROUPS[osGroup(sel.item)].color + 'bb'; g.setLineDash([]);
      g.beginPath();
      D.track.forEach((t, i) => { const q = c.P(t[1], t[2]); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
      const last = osNow(sel.item, now); if (last) { const q = c.P(last[0], last[1]); g.lineTo(q[0], q[1]); }
      g.stroke();
      if (z >= 9) for (const t of D.track) { if ((t[0] / 60000) % 15 > 1) continue; const q = c.P(t[1], t[2]); g.beginPath(); g.arc(q[0], q[1], 2.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); }
    }
    if (L_.ships) {
      const px = z < 7 ? 3.5 : z < 9 ? 5 : z < 11 ? 7 : 9;
      const labels = [];
      let n = 0;
      // Dead reckoning only when it can be seen: below zoom 8 three minutes of sailing is under a pixel.
      const reckon = z >= 8;
      const margin = 20 * 360 / (256 * 2 ** z); // 20 px in degrees of longitude
      for (const v of D.ships.values()) {
        if (v.lat == null || !c.near(v.lat, v.lon, margin) || !shown(v)) continue;
        const pos = reckon ? osNow(v, now) : [v.lat, v.lon]; if (!pos) continue;
        const q = c.P(pos[0], pos[1]); if (!c.inView(q, 20)) continue;
        n += 1;
        const grp = osGroup(v), col = OS_GROUPS[grp].color;
        const moving = v.sog > 0.5 && (v.hdg != null || v.cog != null);
        const old = now - v.posAt > 15 * 60000;
        g.globalAlpha = old ? 0.45 : 1;
        if (v.cls === 'aton') { g.beginPath(); g.moveTo(q[0], q[1] - px); g.lineTo(q[0] + px * 0.8, q[1] + px * 0.6); g.lineTo(q[0] - px * 0.8, q[1] + px * 0.6); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = 1; g.strokeStyle = '#0a0f18'; g.stroke(); }
        else {
          // The course line: where it is in 6 minutes.
          if (moving && z >= 8 && v.cog != null) { const far = PlanGeo.dest({ lat: pos[0], lon: pos[1] }, v.cog, v.sog * 1852 * 0.1); const fq = c.P(far.lat, far.lon); g.lineWidth = 1.2; g.strokeStyle = col; g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(fq[0], fq[1]); g.stroke(); }
          shipShape(g, q[0], q[1], v.hdg != null ? v.hdg : v.cog, px, col, moving, cfg.pins.includes(v.mmsi), sel && sel.kind === 'ship' && sel.item.mmsi === v.mmsi);
        }
        g.globalAlpha = 1;
        if (L_.labels && (z >= 10 || cfg.pins.includes(v.mmsi) || (sel && sel.kind === 'ship' && sel.item.mmsi === v.mmsi))) labels.push([osName(v), q[0] + px + 3, q[1], col]);
        c.hit({ x: q[0], y: q[1], r: Math.max(8, px + 3), kind: 'ship', item: v, z: 6 });
      }
      const boxes = [];
      for (const [t, x, y, col] of labels) { if (boxes.some((b) => Math.abs(b[0] - x) < 80 && Math.abs(b[1] - y) < 12)) continue; boxes.push([x, y]); zpText(g, t, x, y, { font, color: '#fff', halo: 'rgba(5,9,16,0.9)' }); void col; }
      D.shown = n;
    }
    if (L_.fleet && D.snap) {
      const dpr = window.devicePixelRatio > 1 ? 2 : 1;
      for (const a of D.snap.ac) {
        if (a.lat == null || !a.group || (now - a.posAt) / 1000 > VR_HIDE_S) continue;
        const pos = vrNow(a, now);
        const q = c.P(pos[0], pos[1]); if (!c.inView(q, 60)) continue;
        const t = vrTrails.get(a.hex);
        if (t && t.length > 1) { g.lineWidth = 2; g.strokeStyle = (VR_GROUP_COLOR[a.group] || '#c6d4e8') + 'aa'; g.beginPath(); t.forEach((p, i) => { const pp = c.P(p[1], p[2]); if (i) g.lineTo(pp[0], pp[1]); else g.moveTo(pp[0], pp[1]); }); g.lineTo(q[0], q[1]); g.stroke(); }
        const shape = vrShape(a), px = 1.45 * rem() * VR_SHAPES[shape].s * 1.25;
        const sp = vrSprite(shape, VR_GROUP_COLOR[a.group], 'contrast', px, true, dpr);
        g.save(); g.translate(q[0], q[1]); g.rotate(((a.track ?? 0) * Math.PI) / 180); g.drawImage(sp.c, -sp.size / 2, -sp.size / 2, sp.size, sp.size); g.restore();
        const nm = UNIT_NAMES(a.hex);
        zpTag(g, [a.flight || a.reg || (nm && nm.reg) || a.hex.toUpperCase(), `${vrAltText(a)} · ${a.gs == null ? '—' : Math.round(a.gs) + ' kt'}`], q[0] + px * 0.6, q[1], { font, accent: VR_GROUP_COLOR[a.group] });
        c.hit({ x: q[0], y: q[1], r: Math.max(12, px * 0.5), kind: 'aircraft', item: a, z: 8 });
      }
    }
    // The selection: a blue pulsing circle around it, like a GPS position (a marker over the canvas, so
    // it pulses by CSS without redrawing the map), moved along with the ship's dead reckoning.
    const live = sel && sel.lat != null ? (sel.kind === 'ship' ? osNow(sel.item, now) : sel.kind === 'aircraft' ? vrNow(sel.item, now) : [sel.lat, sel.lon]) : null;
    placePulse(live, sel && sel.kind);
  });
  const pulse = zpPulse(map);
  const placePulse = (at, kind) => pulse.place(at, kind);
  cleanups.push(() => pulse.remove());
  // The picture moves with the dead reckoning: every second when zoomed in, slower when a second of
  // sailing is less than a pixel; the own fleet (fast) keeps its second while in view.
  let lastTick = 0;
  timers.push(setInterval(() => {
    if (!onScreen(body) || !(L_.ships || L_.fleet)) return;
    const z = map.getZoom();
    const fleetNear = L_.fleet && D.snap && D.snap.ac.some((a) => a.group && a.lat != null);
    const every = fleetNear ? 1000 : z >= 11 ? 1000 : z >= 9 ? 2500 : 6000;
    if (Date.now() - lastTick >= every - 50) { lastTick = Date.now(); ctx.cv.request(); }
  }, 1000));
  timers.push(setInterval(pollAis, 2000));
  timers.push(setInterval(() => loadPlatforms(), 6 * 3600e3));

  /* ---------- clicks ---------- */
  map.on('click', (e) => {
    const p = e.containerPoint;
    const hit = ctx.cv.hitAt(p.x, p.y);
    if (hit) { select(hit.kind, hit.item); return; }
    select('point', { lat: e.latlng.lat, lon: e.latlng.lng });
  });
  // Hovering: judged at most once per frame, not per mouse event.
  let hoverAt = null;
  map.on('mousemove', (e) => { const first = !hoverAt; hoverAt = e.containerPoint; if (first) requestAnimationFrame(() => { const p = hoverAt; hoverAt = null; if (p) mapEl.classList.toggle('pointing', !!ctx.cv.hitAt(p.x, p.y)); }); });
  async function select(kind, item) {
    follow = null;
    if (kind === 'ship') { sel = { kind, item, lat: item.lat, lon: item.lon }; D.photo = null; paintCard(); loadTrack(item.mmsi); loadPhoto(item); }
    else if (kind === 'aircraft') { const pos = vrNow(item, Date.now()); sel = { kind, item, lat: pos[0], lon: pos[1] }; paintCard(); }
    else { sel = { kind, item, lat: item.lat, lon: item.lon }; paintCard(); }
    ctx.cv.request();
    if (cfg.sideTab === 'ships') paintSoon();
    if (sel && sel.lat != null) loadSea(sel.lat, sel.lon, kind === 'point' ? null : kind === 'ship' ? osName(item) : item.name || item.icao || null);
  }

  /* ---------- sea state and water temperature at the chosen spot, in the bar ---------- */
  // The wave model of Open-Meteo at the point itself and the nearest Rijkswaterstaat observation beside it,
  // so the figure at the spot and the measured one a few miles away can be compared.
  const seaBox = h('div', { class: 'os-sea' });
  const SEA_WORDS = ['Spiegelglad', 'Vlak', 'Kalm', 'Licht', 'Matig', 'Ruw', 'Zeer ruw', 'Hoog', 'Zeer hoog', 'Buitengewoon'];
  const nl1 = (v, d = 1) => (v == null ? '—' : (+v).toFixed(d).replace('.', ','));
  let seaSeq = 0, seaAt = null;
  const paintSeaEmpty = (txt) => { seaBox.className = 'os-sea'; seaBox.title = ''; seaBox.replaceChildren(h('span', { class: 'os-sea-hint' }, icon('target'), txt)); };
  paintSeaEmpty('Tik op de kaart voor de sea state en de zeewatertemperatuur op die plek');
  async function loadSea(lat, lon, name) {
    const my = ++seaSeq;
    seaAt = { lat, lon, name };
    seaBox.replaceChildren(h('span', { class: 'os-sea-hint' }, icon('refresh'), `Sea state op ${name || PlanCoords.fmt(lat, lon, 'ddm')} ophalen…`));
    let r = null;
    try { r = await window.palv.data.seaAt(lat, lon); } catch { r = null; }
    if (my !== seaSeq) return;
    if (!r || !r.ok || (!r.model && !(r.nearest && r.nearest.length))) return paintSeaEmpty(`Geen zeedata voor ${name || PlanCoords.fmt(lat, lon, 'ddm')}${r && r.modelError ? ` (${r.modelError})` : ''}`);
    const m = r.model, n = r.nearest && r.nearest[0];
    // On land Open-Meteo gives nothing: then only the nearest station tells.
    const st = m && m.state != null ? m.state : n ? n.state : null;
    const hs = m && m.hs != null ? m.hs : n ? n.hs : null;
    const sst = m && m.sst != null ? m.sst : n && n.tw != null ? n.tw : null;
    seaBox.className = 'os-sea s' + (st == null ? 'x' : Math.min(st, 6));
    seaBox.title = `${name || 'Punt'} ${PlanCoords.fmt(lat, lon, 'ddm')}\n`
      + (m ? `Golfmodel (Open-Meteo, ${m.at ? zulu(m.at) : ''}): significante golfhoogte ${nl1(m.hs, 2)} m, periode ${nl1(m.period)} s, richting ${m.dir == null ? '—' : Math.round(m.dir) + '°'}; deining ${nl1(m.swell, 2)} m / ${nl1(m.swellPeriod)} s, windgolven ${nl1(m.windWave, 2)} m; zeewater ${nl1(m.sst)} °C.\n` : 'Geen modelwaarde op dit punt (land of buiten het model).\n')
      + (r.nearest || []).map((x) => `${x.name} (${nl1(x.km, 0)} km): ${x.hs != null ? `Hs ${nl1(x.hs, 2)} m, sea state ${x.state}` : 'geen golfmeting'}${x.tm02 != null ? `, Tm ${nl1(x.tm02)} s` : ''}${x.tw != null ? `, water ${nl1(x.tw)} °C` : ''} · ${zulu(x.at)}`).join('\n')
      + '\n\nSea state volgens de Douglas-schaal; de meting van Rijkswaterstaat is leidend, het model vult de plek zelf in.';
    seaBox.replaceChildren(
      h('span', { class: 'os-sea-where' }, icon('target'), h('b', {}, name || PlanCoords.fmt(lat, lon, 'ddm'))),
      h('span', { class: 'os-sea-state' }, waveSvg(st), h('b', {}, st == null ? '—' : String(st)), h('span', { class: 'os-sea-words' }, h('em', {}, 'SEA STATE'), h('u', {}, st == null ? 'onbekend' : SEA_WORDS[st]))),
      h('span', { class: 'os-sea-kv' }, h('small', {}, 'Hs'), h('b', {}, nl1(hs, hs != null && hs < 1 ? 2 : 1)), h('small', {}, 'm'), m && m.period != null ? h('i', {}, `${nl1(m.period)} s`) : null, m && m.dir != null ? h('i', {}, `uit ${Math.round(m.dir).toString().padStart(3, '0')}°`) : null),
      h('span', { class: 'os-sea-sep' }),
      h('span', { class: 'os-sea-kv' }, h('small', {}, 'ZEEWATER'), h('b', {}, nl1(sst)), h('small', {}, '°C')),
      n ? h('span', { class: 'os-sea-sep' }) : null,
      n ? h('span', { class: 'os-sea-obs', title: 'Dichtstbijzijnde meetstation van Rijkswaterstaat' }, h('small', {}, 'GEMETEN'), h('b', {}, `${n.name} · ${nl1(n.km, 0)} km`), h('i', {}, `${n.hs != null ? `Hs ${nl1(n.hs, 2)} m` : ''}${n.tw != null ? ` · ${nl1(n.tw)} °C` : ''} · ${zulu(n.hsAt || n.at)}`)) : null,
      h('span', { class: 'os-sea-src' }, m ? 'model op dit punt' : 'alleen meting'));
  }
  timers.push(setInterval(() => { if (seaAt && onScreen(body)) loadSea(seaAt.lat, seaAt.lon, seaAt.name); }, 10 * 60000));
  async function loadTrack(mmsi) {
    D.trackFor = mmsi; D.track = null;
    try { const t = await window.palv.ais.track(mmsi); if (D.trackFor === mmsi) { D.track = t; ctx.cv.request(); } } catch { /* none */ }
  }
  async function loadPhoto(v) {
    const key = v.mmsi;
    try { const r = await window.palv.ais.photo({ imo: v.imo, name: v.name, mmsi: v.mmsi }); if (sel && sel.kind === 'ship' && sel.item.mmsi === key) { D.photo = r; paintCard(); } } catch { /* none */ }
  }

  /* ---------- the card ---------- */
  const fmtPos = (lat, lon) => PlanCoords.fmt(lat, lon, 'ddm');
  const fromRef = (lat, lon) => {
    // Distance and bearing from the nearest own aircraft, and from the first base.
    const out = [];
    const B = activeBase();
    const own = OPS.get('shared', 'bases', B.id);
    const base = { name: B.name, lat: own ? own.lat : B.lat, lon: own ? own.lon : B.lon };
    out.push(zpRow(`Vanaf ${base.name}`, `${PlanUnits.hdg(PlanGeo.bearing(base, { lat, lon }))} · ${PlanUnits.fmtDist(PlanGeo.dist(base, { lat, lon }), 'nm')}`));
    if (D.snap) for (const a of D.snap.ac) { if (!a.group || a.lat == null) continue; const pos = vrNow(a, Date.now()); const here = { lat: pos[0], lon: pos[1] }; const nm = UNIT_NAMES(a.hex) || {}; out.push(zpRow(`Vanaf ${a.flight || a.reg || nm.reg || a.hex.toUpperCase()}`, `${PlanUnits.hdg(PlanGeo.bearing(here, { lat, lon }))} · ${PlanUnits.fmtDist(PlanGeo.dist(here, { lat, lon }), 'nm')}${a.gs > 20 ? ` · ${PlanUnits.fmtDur((PlanGeo.dist(here, { lat, lon }) / 1852 / a.gs) * 60)}` : ''}`)); }
    return out;
  };
  function paintCard() {
    if (!sel) { card.hidden = true; return; }
    card.hidden = false;
    const now = Date.now();
    let title = '', sub = '', color = '#ffb941', rows = [], extra = [], actions = [];
    const close = h('button', { class: 'w-tool', title: 'Sluiten', onclick: () => { sel = null; follow = null; card.hidden = true; ctx.cv.request(); } }, icon('close'));
    if (sel.kind === 'ship') {
      const v = sel.item, grp = osGroup(v), country = osCountry(v.mmsi), size = osSize(v), pos = osNow(v, now);
      title = osName(v); sub = `${osTypeText(v)} · ${OS_GROUPS[grp].name}`; color = OS_GROUPS[grp].color;
      rows = [
        ['MMSI', v.mmsi], v.imo ? ['IMO', String(v.imo)] : null, v.callsign ? ['Roepnaam', v.callsign] : null,
        country ? ['Vlag', country.name] : null,
        ['Status', osNavText(v.nav)],
        ['Snelheid', v.sog == null ? '—' : `${v.sog.toFixed(1)} kt`], ['Koers / heading', `${v.cog == null ? '—' : Math.round(v.cog) + '°'} / ${v.hdg == null ? '—' : Math.round(v.hdg) + '°'}${v.rot ? ` · ROT ${v.rot > 0 ? 'SB' : 'BB'}` : ''}`],
        ['Positie', pos ? fmtPos(pos[0], pos[1]) : '—'], ['Laatste bericht', `${ageText(now - v.posAt)} geleden${v.src ? ' · ' + v.src : ''}`],
        size ? ['Afmetingen', `${size.len} × ${size.beam} m`] : null, v.draught ? ['Diepgang', `${v.draught.toFixed(1)} m`] : null,
        v.dest ? ['Bestemming', v.dest] : null, v.eta ? ['ETA', osEtaText(v.eta)] : null, ['AIS-klasse', v.cls || '—'],
      ].filter(Boolean);
      const ph = D.photo;
      const photoBox = h('div', { class: 'os-photo' }, ph && ph.img ? h('a', { href: '#', title: ph.img.title, onclick: (e) => { e.preventDefault(); } }, h('img', { src: ph.img.url, alt: '' })) : h('div', { class: 'os-photo-none' }, ph ? 'Geen foto gevonden op Wikimedia Commons' : 'Foto zoeken…'));
      if (ph && ph.img) photoBox.append(h('small', {}, `${ph.img.author ? ph.img.author + ' · ' : ''}${ph.img.licence || ''} · Wikimedia Commons${ph.how ? ' (' + ph.how + ')' : ''}`));
      extra = [country ? h('div', { class: 'os-flagrow' }, h('span', { class: 'vr-flag', style: `background-image:url("vendor/flags/${country.cc.toLowerCase()}.svg")` }), h('b', {}, country.name), h('i', {}, country.cc)) : null, photoBox, h('div', { class: 'zp-rows' }, fromRef(pos ? pos[0] : v.lat, pos ? pos[1] : v.lon))];
      const pinned = cfg.pins.includes(v.mmsi);
      actions = [
        zpBtn(follow === v.mmsi ? 'Volgt' : 'Volgen', () => { follow = follow === v.mmsi ? null : v.mmsi; paintCard(); }, { icon: 'target', cls: follow === v.mmsi ? 'on' : '' }),
        zpBtn(pinned ? 'Gemarkeerd' : 'Markeren', () => { cfg.pins = pinned ? cfg.pins.filter((m) => m !== v.mmsi) : [...cfg.pins, v.mmsi]; save(); paintCard(); ctx.cv.request(); paintSoon(); }, { icon: 'star', cls: pinned ? 'on' : '', title: 'Gemarkeerde schepen staan bovenaan de lijst en houden hun naam op de kaart' }),
        zpBtn('Centreren', () => { const p = osNow(v, Date.now()); if (p) map.setView(p, Math.max(map.getZoom(), 11)); }, { icon: 'globe' }),
        zpBtn('Kopieer positie', () => zpCopy(fmtPos(v.lat, v.lon)), { icon: 'note' }),
      ];
    } else if (sel.kind === 'platform') {
      const p = sel.item, k = ZP_KINDS[p.kind] || ZP_KINDS.other;
      title = p.name; sub = `${k.name.replace(/s( \(|$)/, '$1')} · ${p.country || ''} · ${p.src}`; color = k.color;
      rows = [['Status', p.status || 'onbekend'], p.operator ? ['Operator', p.operator] : null, p.waterDepthM != null ? ['Waterdiepte', `${Math.round(p.waterDepthM)} m`] : null, p.helideck != null ? ['Helidek', p.helideck ? 'ja' : 'nee'] : null, p.helideckElevationM != null ? ['Dekhoogte', `${Math.round(p.helideckElevationM / 0.3048)} ft`] : null, ['Positie', fmtPos(p.lat, p.lon)], ...(p.fields || []).slice(0, 10).map(([kk, v]) => [kk, String(v)])].filter(Boolean);
      const deck = OPS.get('private', 'decks', p.id);
      if (deck) extra.push(h('div', { class: 'zp-rows' }, h('h4', { class: 'zp-sub' }, 'Eigen dekkaart'), ZP_DECK_FIELDS.filter(([f]) => deck[f] != null && deck[f] !== '').map(([f, label, unit]) => zpRow(label, `${deck[f]}${unit && typeof deck[f] === 'number' ? (unit === '°' ? '°' : ' ' + unit) : ''}`))));
      extra.push(h('div', { class: 'zp-rows' }, fromRef(p.lat, p.lon)), nearShips(p.lat, p.lon));
      actions = [zpBtn('Centreren', () => map.setView([p.lat, p.lon], Math.max(map.getZoom(), 11)), { icon: 'globe' }), zpBtn('Kopieer positie', () => zpCopy(fmtPos(p.lat, p.lon)), { icon: 'note' }), zpBtn('Dekkaart in Zoek & Plan', () => { const i = state.pages.findIndex((pg) => pg.widgets.some((x) => x.type === 'plan')); if (i >= 0) setPage(i); }, { icon: 'route' })];
    } else if (sel.kind === 'place') {
      const p = sel.item, k = OS_PLACE_KINDS[p.kind];
      title = p.name || k.name; sub = `${k.name} · OpenStreetMap`; color = k.color;
      rows = [p.operator ? ['Beheerder', p.operator] : null, p.phone ? ['Telefoon', p.phone] : null, p.light ? ['Lichtkarakter', `${p.light}${p.range ? ' · ' + p.range + ' NM' : ''}`] : null, p.height ? ['Hoogte', `${p.height} m`] : null, p.category ? ['Soort', p.category] : null, ['Positie', fmtPos(p.lat, p.lon)]].filter(Boolean);
      extra = [h('div', { class: 'zp-rows' }, fromRef(p.lat, p.lon))];
      actions = [zpBtn('Centreren', () => map.setView([p.lat, p.lon], Math.max(map.getZoom(), 12)), { icon: 'globe' })];
    } else if (sel.kind === 'deck') {
      const d = sel.item;
      title = `${d.icao ? d.icao + ' · ' : ''}${d.name}`; sub = 'Helidek offshore · openAIP'; color = '#3ecf6e';
      rows = [['Dekhoogte', d.elevFt ? `${d.elevFt} ft AMSL` : 'onbekend'], ...(d.freqs || []).map((f) => [f.type || 'Freq.', `${f.mhz.toFixed(3)} ${f.name || ''}`]), ['Positie', fmtPos(d.lat, d.lon)]];
      extra = [h('div', { class: 'zp-rows' }, fromRef(d.lat, d.lon))];
    } else if (sel.kind === 'wx') {
      const st = sel.item, m = st.metar;
      title = st.icao; sub = String(st.name || '').split(',')[0]; color = '#8fd3ff';
      rows = [['Wind', m.wind ? `${WX.windText(m.wind)} kt` : '—'], ['Zicht', m.vis == null ? '—' : m.cavok ? 'CAVOK' : m.vis >= 9999 ? '≥ 10 km' : `${m.vis} m`], ['Bewolking', m.layers.length ? m.layers.map((l) => `${l.cover} ${l.base}`).join(', ') : m.cloud === 'none' ? 'geen' : '—'], ['Temp / dauwpunt', m.temp != null ? `${m.temp}° / ${m.dew ?? '—'}°` : '—'], ['QNH', m.qnh || '—'], ['Waarneming', `${zulu(st.obsTime)} · ${ageText(now - st.obsTime)} oud`]];
      extra = [h('pre', { class: 'os-raw' }, st.raw)];
    } else if (sel.kind === 'aircraft') {
      const a = sel.item, nm = UNIT_NAMES(a.hex) || {}, pos = vrNow(a, now);
      title = a.flight || a.reg || nm.reg || a.hex.toUpperCase(); sub = [a.reg || nm.reg, a.type || nm.type, FLEET_GROUPS[a.group]].filter(Boolean).join(' · '); color = VR_GROUP_COLOR[a.group];
      rows = [['Hoogte', vrAltText(a)], ['Snelheid', a.gs == null ? '—' : `${Math.round(a.gs)} kt`], ['Koers', a.track == null ? '—' : `${Math.round(a.track)}°`], ['Positie', fmtPos(pos[0], pos[1])]];
      extra = [nearShips(pos[0], pos[1])];
    } else {
      title = fmtPos(sel.lat, sel.lon); sub = 'Punt op de kaart'; rows = [];
      extra = [h('div', { class: 'zp-rows' }, fromRef(sel.lat, sel.lon)), nearShips(sel.lat, sel.lon), nearPlatforms(sel.lat, sel.lon)];
      actions = [zpBtn('Kopieer positie', () => zpCopy(fmtPos(sel.lat, sel.lon)), { icon: 'note' })];
    }
    card.style.setProperty('--zp-c', color);
    const bodyEl = card.querySelector('.zp-card-body');
    const top = bodyEl ? bodyEl.scrollTop : 0;
    card.replaceChildren(
      h('div', { class: 'zp-card-head' }, h('div', {}, h('b', {}, title), h('small', {}, sub)), close),
      h('div', { class: 'zp-card-body' }, rows.length ? h('div', { class: 'zp-rows' }, rows.map(([k, v]) => zpRow(k, v))) : null, ...extra.filter(Boolean)),
      actions.length ? h('div', { class: 'zp-card-actions' }, actions) : null);
    const nb = card.querySelector('.zp-card-body'); if (nb) nb.scrollTop = top;
  }
  // The nearest ships to a point, for a platform or a spot on the map.
  function nearShips(lat, lon) {
    const now = Date.now();
    const list = [...D.ships.values()].filter((v) => v.cls !== 'aton' && shown(v)).map((v) => { const p = osNow(v, now); return p ? { v, d: PlanGeo.dist({ lat, lon }, { lat: p[0], lon: p[1] }), b: PlanGeo.bearing({ lat, lon }, { lat: p[0], lon: p[1] }) } : null; }).filter(Boolean).sort((a, b) => a.d - b.d).slice(0, 6);
    if (!list.length) return null;
    return h('div', { class: 'zp-rows' }, h('h4', { class: 'zp-sub' }, 'Dichtstbijzijnde schepen'), list.map(({ v, d, b }) => h('button', { class: 'zp-linkbtn os-near', onclick: () => select('ship', v) }, h('b', {}, osName(v)), h('small', {}, `${PlanUnits.fmtDist(d, 'nm')} · ${PlanUnits.hdg(b)}° · ${osTypeText(v)} · ${v.sog == null ? '—' : v.sog.toFixed(1) + ' kt'}`))));
  }
  function nearPlatforms(lat, lon) {
    const list = D.platforms.filter((p) => p.kind !== 'turbine' && p.kind !== 'onshore').map((p) => ({ p, d: PlanGeo.dist({ lat, lon }, p), b: PlanGeo.bearing({ lat, lon }, p) })).sort((a, b) => a.d - b.d).slice(0, 5);
    if (!list.length) return null;
    return h('div', { class: 'zp-rows' }, h('h4', { class: 'zp-sub' }, 'Dichtstbijzijnde platforms'), list.map(({ p, d, b }) => h('button', { class: 'zp-linkbtn os-near', onclick: () => select('platform', p) }, h('b', {}, p.name), h('small', {}, `${PlanUnits.fmtDist(d, 'nm')} · ${PlanUnits.hdg(b)}° · ${(ZP_KINDS[p.kind] || ZP_KINDS.other).name}`))));
  }

  /* ---------- hud: the AIS status ---------- */
  const status = h('div', { class: 'wxm-status os-status' });
  hud.append(h('div', { class: 'vr-top' }, status));
  function paintStatus() {
    const s = D.aisStatus, now = Date.now();
    let level = 'bad', label = 'AIS: GEEN SLEUTEL', note = 'Vul de aisstream.io-sleutel in onder Instellingen › Offshore (gratis account).';
    if (!L_.ships) { level = 'warn'; label = 'AIS UIT'; note = 'Schepen staan uit onder Lagen.'; }
    else if (s && s.on) {
      if (s.connected && now - D.lastAis < 30000) { level = 'live'; label = s.role === 'follow' ? `AIS VIA ${String(s.via || '').toUpperCase()}` : 'AIS LIVE'; note = `${s.count} schepen in het register, ${s.perMin || 0} berichten per minuut.`; }
      else if (s.connected) { level = 'warn'; label = 'AIS STIL'; note = 'Verbonden, maar even geen berichten.'; }
      else { level = 'bad'; label = 'AIS GEEN VERBINDING'; note = s.lastErr || 'Verbinden met aisstream.io…'; }
    } else if (s && s.role === 'follow') { level = 'warn'; label = `AIS VIA ${String(s.via || '').toUpperCase()}`; note = 'Wacht op het scherm dat de schepen ophaalt.'; }
    status.className = 'wxm-status os-status ' + level;
    status.title = note;
    status.replaceChildren(...[h('span', { class: 'wxm-dot' }), h('b', {}, label), s && s.on ? h('span', {}, `${D.shown || 0} in beeld · ${s.count || 0} totaal`) : null, D.lastAis ? h('span', {}, `laatste ${zuluSec(D.lastAis)}`) : null].filter(Boolean));
    const hkey = 'ais:' + w.id;
    if (!onScreen(body) || !L_.ships || !(s && s.on)) report(hkey);
    else report(hkey, 'AIS schepen', level === 'live', note, 3 * 60000);
  }
  timers.push(setInterval(() => { if (onScreen(body)) paintStatus(); }, 5000));

  /* ---------- toolbar and side panel ---------- */
  const OS_TABS = [{ id: 'ships', name: 'Schepen', icon: 'globe' }, { id: 'layers', name: 'Lagen', icon: 'layers' }, { id: 'platforms', name: 'Platforms', icon: 'system' }];
  if (!OS_TABS.some((t) => t.id === cfg.sideTab)) cfg.sideTab = 'ships';
  const tabs = h('div', { class: 'zp-tabs os-tabs' });
  const content = h('div', { class: 'zp-side-body' });
  const sideBtn = h('button', { class: 'zp-side-toggle', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>', onclick: () => { cfg.side = !cfg.side; root.classList.toggle('side-off', !cfg.side); save(); setTimeout(() => map.invalidateSize(), 220); } });
  side.append(tabs, content, sideBtn);
  const paintTabs = () => tabs.replaceChildren(...OS_TABS.map((t) => h('button', { class: 'zp-tab' + (cfg.sideTab === t.id ? ' on' : ''), onclick: () => { cfg.sideTab = t.id; save(); paintTabs(); paintSide(); } }, icon(t.icon), h('span', {}, t.name))));
  paintTabs();
  let pending = false;
  const paintSoon = () => { if (!pending) { pending = true; requestAnimationFrame(paintSide); } };
  let shipQ = '', shipSort = 'name', platQ = '';
  function paintSide() {
    pending = false;
    if (content.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    lastListPaint = Date.now();
    const scroll = content.scrollTop;
    content.replaceChildren(cfg.sideTab === 'layers' ? layersPanel() : cfg.sideTab === 'platforms' ? platformsPanel() : shipsPanel());
    content.scrollTop = scroll;
  }
  function shipsPanel() {
    const now = Date.now();
    const q = h('input', { class: 'input zp-profq', type: 'search', placeholder: 'Zoek schip: naam, MMSI, IMO, roepnaam, bestemming…', value: shipQ });
    const list = h('div', { class: 'os-ships' });
    const count = h('small', { class: 'zp-hint' });
    const c = map.getCenter();
    const refresh = () => {
      let all = [...D.ships.values()].filter((v) => v.lat != null && shown(v));
      all = osSearch(all, shipQ);
      const key = (v) => { if (shipSort === 'speed') return -(v.sog || 0); if (shipSort === 'dist') return PlanGeo.dist({ lat: c.lat, lon: c.lng }, v); if (shipSort === 'recent') return -(v.posAt || 0); return osName(v).toLowerCase(); };
      all.sort((a, b) => (cfg.pins.includes(b.mmsi) - cfg.pins.includes(a.mmsi)) || (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
      count.textContent = `${all.length} schepen${shipQ ? ' gevonden' : ''} · ${D.ships.size} in het register`;
      list.replaceChildren(...all.slice(0, 300).map((v) => { const grp = osGroup(v), country = osCountry(v.mmsi); return h('button', { class: 'os-ship' + (sel && sel.kind === 'ship' && sel.item.mmsi === v.mmsi ? ' on' : ''), style: `--c:${OS_GROUPS[grp].color}`, onclick: () => { select('ship', v); const p = osNow(v, now); if (p) map.panTo(p); } },
        h('i', { class: 'zp-dot' }), country ? h('span', { class: 'os-flag', style: `background-image:url("vendor/flags/${country.cc.toLowerCase()}.svg")`, title: country.name }) : h('span', { class: 'os-flag' }),
        h('div', {}, h('b', {}, (cfg.pins.includes(v.mmsi) ? '★ ' : '') + osName(v)), h('small', {}, `${osTypeText(v)} · ${v.sog == null ? '—' : v.sog.toFixed(1) + ' kt'}${v.cog != null ? ' · ' + Math.round(v.cog) + '°' : ''}${v.dest ? ' → ' + v.dest : ''}`)),
        h('span', { class: 'os-ship-d' }, PlanUnits.fmtDist(PlanGeo.dist({ lat: c.lat, lon: c.lng }, v), 'nm'))); }));
      if (!all.length) list.append(h('p', { class: 'zp-hint' }, D.ships.size ? 'Niets gevonden.' : 'Nog geen schepen: zie de AIS-status op de kaart.'));
    };
    q.addEventListener('input', () => { shipQ = q.value; refresh(); });
    const sortSel = zpSelect([{ value: 'name', label: 'Op naam' }, { value: 'dist', label: 'Op afstand tot het midden' }, { value: 'speed', label: 'Op snelheid' }, { value: 'recent', label: 'Op laatste bericht' }], shipSort, (v) => { shipSort = v; refresh(); });
    const typeChips = h('div', { class: 'wb-cats' }, h('button', { class: 'wb-cat' + (cfg.shipTypes.includes('all') ? ' on' : ''), onclick: () => { cfg.shipTypes = ['all']; save(); ctx.cv.request(); paintSoon(); } }, 'Alles'), ...Object.entries(OS_GROUPS).map(([k, gr]) => h('button', { class: 'wb-cat' + (cfg.shipTypes.includes(k) ? ' on' : ''), style: `--c:${gr.color}`, onclick: () => { const on = cfg.shipTypes.includes(k); let next = cfg.shipTypes.filter((x) => x !== 'all' && x !== k); if (!on) next.push(k); cfg.shipTypes = next.length ? next : ['all']; save(); ctx.cv.request(); paintSoon(); } }, h('i', { class: 'zp-dot', style: `background:${gr.color}` }), gr.name)));
    refresh();
    return h('div', { class: 'zp-panel' }, h('div', { class: 'zp-profsearch' }, icon('globe'), q), typeChips, h('div', { class: 'row' }, field('Sorteren', sortSel), field('Minimale snelheid', zpSelect([0, 0.5, 2, 5, 10, 15].map((s) => ({ value: s, label: s ? `≥ ${s} kt` : 'Alles' })), cfg.minSog || 0, (v) => { cfg.minSog = +v; save(); ctx.cv.request(); paintSoon(); }))), count, list);
  }
  function layersPanel() {
    const chk = (label, get, set, hint) => h('label', { class: 'check', title: hint || null }, h('input', { type: 'checkbox', checked: !!get(), onchange: (e) => set(e.target.checked) }), label);
    const lay = (k, label, after, hint) => chk(label, () => L_[k], (v) => { L_[k] = v; save(); if (after) after(); ctx.cv.request(); paintStatus(); }, hint);
    const groups = {};
    for (const [k, b] of Object.entries(ZP_BASES)) (groups[b.group] = groups[b.group] || []).push([k, b]);
    return h('div', { class: 'zp-panel' },
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Ondergrond')), ...Object.entries(groups).map(([gname, lst]) => h('div', { class: 'zp-tgroup' }, h('b', {}, gname), ...lst.map(([k, b]) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'osbase' + w.id, checked: cfg.base === k, onchange: () => { cfg.base = k; save(); ctx.base.apply(); } }), b.name))))),
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Offshore')),
        lay('platforms', 'Platforms (olie, gas, wind-trafo, FPSO)'), lay('turbines', 'Windturbines (vanaf zoom 10)'), lay('farms', 'Windparken en veiligheidszones', drawFarms), lay('helidecks', 'Helidekken (openAIP)'),
        lay('seamark', 'Zeekaart: betonning, vaargeulen, TSS (OpenSeaMap)', applyWms), lay('eez', OS_WMS.eez.name, applyWms), lay('pipelines', OS_WMS.pipelines.name, applyWms), lay('cables', OS_WMS.cables.name, applyWms), lay('density', OS_WMS.density.name, applyWms), lay('military', OS_WMS.military.name, applyWms), lay('natura', OS_WMS.natura.name, applyWms)),
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Kust')),
        lay('places', 'Kustpunten (OpenStreetMap)'), ...Object.entries(OS_PLACE_KINDS).map(([k, d]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: !!cfg.places[k], onchange: (e) => { cfg.places[k] = e.target.checked; save(); ctx.cv.request(); } }), h('i', { class: 'zp-dot', style: `background:${d.color}` }), d.name))),
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Live')),
        lay('ships', 'Schepen (AIS)'), lay('tracks', 'Past track van het gekozen schip'), lay('fleet', 'Eigen vloot', trafficWatch), lay('wx', 'Weerstations tegen het BOM (dag: Multi pilot, nacht: Aided)'), lay('labels', 'Namen op de kaart'),
        h('p', { class: 'zp-hint' }, 'De AIS-sleutel staat onder Instellingen › Offshore.')),
      h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Gegevens')),
        h('div', { class: 'zp-btnrow' }, zpBtn('Platforms opnieuw ophalen', () => loadPlatforms(true), { icon: 'refresh' }), zpBtn('Kustpunten opnieuw', () => loadPlaces(true), { icon: 'refresh' })),
        h('p', { class: 'zp-hint' }, 'Hulpmiddel voor situationeel overzicht; geen navigatiebron. AIS-posities kunnen tot enkele minuten oud zijn en worden tussen twee berichten langs de koers doorgetrokken.')));
  }
  function platformsPanel() {
    const q = h('input', { class: 'input zp-profq', type: 'search', placeholder: 'Zoek platform: K14-A, L9, Hollandse Kust…', value: platQ });
    const list = h('div', { class: 'os-ships' });
    const c = map.getCenter();
    const refresh = () => {
      const words = platQ.toLowerCase().split(/\s+/).filter(Boolean);
      const all = D.platforms.filter((p) => p.kind !== 'turbine' && p.kind !== 'onshore' && words.every((wd) => `${p.name} ${p.operator || ''} ${p.country || ''} ${p.kind}`.toLowerCase().includes(wd))).map((p) => ({ p, d: PlanGeo.dist({ lat: c.lat, lon: c.lng }, p) })).sort((a, b) => a.d - b.d).slice(0, 200);
      list.replaceChildren(...all.map(({ p, d }) => h('button', { class: 'os-ship' + (sel && sel.kind === 'platform' && sel.item.id === p.id ? ' on' : ''), style: `--c:${(ZP_KINDS[p.kind] || ZP_KINDS.other).color}`, onclick: () => { select('platform', p); map.panTo([p.lat, p.lon]); } },
        h('i', { class: 'zp-dot sq' }), h('div', {}, h('b', {}, p.name), h('small', {}, `${(ZP_KINDS[p.kind] || ZP_KINDS.other).name} · ${p.status || ''}${p.helideck ? ' · helidek' : ''}${p.operator ? ' · ' + p.operator : ''}`)), h('span', { class: 'os-ship-d' }, PlanUnits.fmtDist(d, 'nm')))));
      if (!all.length) list.append(h('p', { class: 'zp-hint' }, D.platforms.length ? 'Niets gevonden.' : 'Platforms worden geladen…'));
    };
    q.addEventListener('input', () => { platQ = q.value; refresh(); });
    refresh();
    return h('div', { class: 'zp-panel' }, h('div', { class: 'zp-profsearch' }, icon('system'), q), h('small', { class: 'zp-hint' }, `${D.platforms.filter((p) => p.kind !== 'turbine').length} installaties, dichtstbijzijnde eerst`), list);
  }
  const title = h('span', { class: 'mp-title' }, icon('globe'), 'OFFSHORE');
  const baseSeg = segmented([{ value: 'osm', label: 'Kaart' }, { value: 'sat', label: 'Satelliet' }, { value: 'none', label: 'Donker' }], ['osm', 'sat', 'none'].includes(cfg.base) ? cfg.base : 'osm', (v) => { cfg.base = v; save(); ctx.base.apply(); });
  const homeBtn = h('button', { class: 'btn zp-btn', title: 'Nederlandse sector in beeld', onclick: () => map.setView([53.35, 4.1], 7.2) }, icon('target'), 'NL-sector');
  bar.append(title, baseSeg, homeBtn, seaBox, h('span', { class: 'zp-spacer' }));

  /* ---------- start ---------- */
  loadPlatforms(); loadPlaces(); loadDecks(); pollAis(); paintStatus(); paintSide();
  const unsubPriv = OPS.on('private', () => { if (sel && sel.kind === 'platform') paintCard(); });
  cleanups.push(unsubPriv);
  const ro = new ResizeObserver(() => { map.invalidateSize(false); ctx.cv.request(); });
  ro.observe(body);
  return {
    destroy() { ro.disconnect(); for (const t of timers) clearInterval(t); for (const fn of cleanups) { try { fn(); } catch { /* gone */ } } report('ais:' + w.id); ctx.base.destroy(); map.remove(); },
  };
}
