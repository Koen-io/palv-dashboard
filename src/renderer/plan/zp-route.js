'use strict';

/* ============================================================
   Zoek & Plan — de route: punten zetten, slepen en invoegen, het navigatielog met wind per stuk,
   en wat je leest als je met de muis over de route gaat.
   ============================================================ */
const ZP_ROUTE_COLOR = '#ff9f1c';

function zpRoute(ctx) {
  const { map, cfg } = ctx;
  const route = cfg.route;
  let plan = null, measured = null, hover = null, pnr = null, psr = null, selectedWp = -1;
  const markers = [], ghosts = [];
  let line = null, casing = null;
  const uidWp = () => Math.random().toString(36).slice(2, 9);

  const pts = () => route.points;
  const changed = (why) => { ctx.save(); recompute(); draw(); ctx.emit('route', why); };

  /* ---------- names for new points ---------- */
  async function nameFor(wp) {
    try {
      const r = await window.palv.plan.reverse(wp.lat, wp.lon);
      if (r && r.label && !wp.named) { wp.name = r.label.split(',')[0].slice(0, 40); wp.sub = r.sub || ''; ctx.save(); draw(); ctx.emit('route', 'name'); }
    } catch { /* stays WP n */ }
  }

  function add(p, at = pts().length, opts = {}) {
    const wp = { id: uidWp(), lat: +p.lat, lon: +p.lon, name: p.name || `WP${pts().length + 1}`, named: !!p.name, kind: p.kind || null };
    pts().splice(at, 0, wp);
    if (!p.name && !opts.noName) nameFor(wp);
    changed('add');
    return wp;
  }
  function remove(i) { if (i < 0 || i >= pts().length) return; pts().splice(i, 1); selectedWp = -1; changed('remove'); }
  function move(i, latlng) { const wp = pts()[i]; if (!wp) return; wp.lat = latlng.lat; wp.lon = latlng.lng; changed('move'); }
  function clear() { route.points = []; route.name = ''; selectedWp = -1; changed('clear'); }
  function reverse() { route.points.reverse(); changed('reverse'); }
  function setPoints(list, meta = {}) {
    route.points = list.map((p, i) => ({ id: uidWp(), lat: p.lat, lon: p.lon, name: p.name || `WP${i + 1}`, named: true, kind: p.kind || null }));
    Object.assign(route, meta);
    selectedWp = -1;
    changed('set');
    if (route.points.length > 1) map.fitBounds(L.latLngBounds(route.points.map((p) => [p.lat, p.lon])).pad(0.2), { animate: true });
  }

  /* ---------- computing ---------- */
  function recompute() {
    const pl = ctx.planning();
    measured = pts().length > 1 ? PlanGeo.measure(pts()) : null;
    if (!measured) { plan = null; pnr = psr = null; ctx.plan = null; ctx.emit('plan', null); return; }
    const departMs = route.departAt || Date.now();
    const tas = ctx.tas(pl.altFt);
    plan = PlanPerf.planRoute({
      points: pts(), tasKt: tas, altFt: pl.altFt, departMs, fuelKg: pl.fuelKg, taxiKg: pl.taxiKg, reserveKg: pl.reserveKg,
      flowKgh: pl.flowKgh, windAt: (lat, lon, ms) => ctx.windAt(lat, lon, ms, pl.altFt), magVar: ctx.mag,
    });
    plan.tasKt = tas; plan.departMs = departMs; plan.planning = pl;
    // Point of no return to the start, and point of safe return keeping the final reserve.
    const home = pts()[0];
    const q = { home, tasKt: tas, flowKgh: pl.flowKgh, windAt: (lat, lon, ms) => ctx.windAt(lat, lon, ms, pl.altFt), departMs };
    pnr = PlanPerf.pointOfReturn(plan, { ...q, keepKg: 0 });
    psr = PlanPerf.pointOfReturn(plan, { ...q, keepKg: pl.reserveKg });
    plan.pnr = pnr; plan.psr = psr;
    ctx.plan = plan;
    ctx.emit('plan', plan);
    // Wind along the route: what is not known yet is asked for; the route is reckoned again when it comes.
    if (ctx.parts.zpWind) ctx.parts.zpWind.ensureRoute(pts(), pl.altFt, departMs, plan.total.timeMin).then((got) => { if (got) { recompute(); draw(); } });
  }

  /* ---------- drawing ---------- */
  const wpIcon = (i, wp) => L.divIcon({
    className: 'zp-wp' + (i === 0 ? ' start' : i === pts().length - 1 && pts().length > 1 ? ' end' : '') + (i === selectedWp ? ' sel' : ''),
    html: `<b>${i === 0 ? 'A' : i === pts().length - 1 && pts().length > 1 ? 'B' : i}</b>`, iconSize: [22, 22], iconAnchor: [11, 11],
  });
  function draw() {
    for (const m of markers.splice(0)) m.remove();
    for (const m of ghosts.splice(0)) m.remove();
    if (line) { line.remove(); casing.remove(); line = casing = null; }
    const list = pts();
    if (list.length > 1) {
      const geo = [];
      for (let i = 1; i < list.length; i += 1) for (const p of PlanGeo.densify(list[i - 1], list[i], 4000)) geo.push([p.lat, p.lon]);
      casing = L.polyline(geo, { renderer: ctx.lines, color: '#0a0f18', weight: 7.5, opacity: 0.7, interactive: false }).addTo(map);
      line = L.polyline(geo, { renderer: ctx.lines, color: ZP_ROUTE_COLOR, weight: 3.6, opacity: 1, interactive: false }).addTo(map);
    }
    list.forEach((wp, i) => {
      const m = L.marker([wp.lat, wp.lon], { icon: wpIcon(i, wp), draggable: true, autoPan: true, keyboard: false, zIndexOffset: 1000, title: `${wp.name} — sleep om te verplaatsen, rechtsklik om te verwijderen` }).addTo(map);
      m.on('drag', (e) => { wp.lat = e.latlng.lat; wp.lon = e.latlng.lng; recompute(); redrawLine(); ctx.cv.request(); });
      m.on('dragend', (e) => { wp.named = false; move(i, e.target.getLatLng()); nameFor(wp); });
      m.on('click', (e) => { L.DomEvent.stopPropagation(e); selectedWp = i; ctx.select({ lat: wp.lat, lon: wp.lon, label: wp.name, kind: 'wp', item: wp }); draw(); ctx.emit('route', 'select'); });
      m.on('contextmenu', (e) => { L.DomEvent.stopPropagation(e); remove(i); });
      markers.push(m);
    });
    // Handles in the middle of every leg: drag one to put a point in between.
    if (ctx.mode === 'route') {
      for (let i = 1; i < list.length; i += 1) {
        const mid = PlanGeo.interp(list[i - 1], list[i], 0.5);
        const g = L.marker([mid.lat, mid.lon], { icon: L.divIcon({ className: 'zp-ghost', html: '+', iconSize: [16, 16], iconAnchor: [8, 8] }), draggable: true, keyboard: false, zIndexOffset: 900, title: 'Sleep om hier een punt in te voegen' }).addTo(map);
        g.on('dragend', (e) => add({ lat: e.target.getLatLng().lat, lon: e.target.getLatLng().lng }, i));
        ghosts.push(g);
      }
    }
    ctx.cv.request();
  }
  function redrawLine() {
    if (!line) return;
    const list = pts(), geo = [];
    for (let i = 1; i < list.length; i += 1) for (const p of PlanGeo.densify(list[i - 1], list[i], 4000)) geo.push([p.lat, p.lon]);
    line.setLatLngs(geo); casing.setLatLngs(geo);
  }

  // Leg labels, PNR/PSR and the hover card on the symbol canvas.
  ctx.cv.add(60, (c) => {
    if (!plan || !measured) return;
    const { g } = c;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const font = `600 ${(0.66 * rem).toFixed(1)}px ${getComputedStyle(document.body).fontFamily}`;
    // Leg labels where there is room for them.
    for (const leg of plan.legs) {
      const a = c.P(leg.from.lat, leg.from.lon), b = c.P(leg.to.lat, leg.to.lon);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 140) continue;
      const mid = PlanGeo.interp(leg.from, leg.to, 0.5), p = c.P(mid.lat, mid.lon);
      if (!c.inView(p)) continue;
      const crs = ctx.fmt.course(leg.tc, mid.lat, mid.lon);
      zpTag(g, [`${crs}  ${ctx.fmt.dist(leg.distM)}`, `${ctx.fmt.dur(leg.eteMin)} · GS ${Math.round(leg.gs)} kt`], p[0] + 10, p[1] + 16, { font, accent: ZP_ROUTE_COLOR });
    }
    for (const [pt, label, color] of [[psr, 'PSR', '#ffd23f'], [pnr, 'PNR', '#ff4b55']]) {
      if (!pt || !pt.beyond) continue;
      const p = c.P(pt.lat, pt.lon);
      g.beginPath(); g.arc(p[0], p[1], 6, 0, Math.PI * 2); g.fillStyle = color; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0a0f18'; g.stroke();
      zpText(g, label, p[0], p[1] - 14, { font: `800 ${(0.7 * rem).toFixed(1)}px sans-serif`, color, align: 'center' });
      c.hit({ x: p[0], y: p[1], r: 9, kind: 'pnr', item: { label, pt }, z: 5 });
    }
    if (hover) {
      const p = c.P(hover.lat, hover.lon);
      g.beginPath(); g.arc(p[0], p[1], 5.5, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = ZP_ROUTE_COLOR; g.stroke();
      const lines = hoverLines(hover);
      const right = p[0] < c.w - 260;
      zpTag(g, lines, right ? p[0] + 14 : p[0] - 14, Math.min(Math.max(p[1], 90), c.h - 90), { font, accent: ZP_ROUTE_COLOR, align: right ? 'left' : 'right' });
    }
  });

  function hoverLines(hv) {
    const s = PlanPerf.sampleAt(plan, hv.m);
    const total = plan.total;
    const at = PlanGeo.pointAt(measured, hv.m);
    const wnd = ctx.windAt(at.lat, at.lon, plan.departMs + s.tMin * 60000, plan.planning.altFt);
    const out = [
      { text: `${ctx.fmt.dist(hv.m)} vanaf ${pts()[0].name}`, font: `700 ${parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.7}px sans-serif` },
      `${ctx.fmt.dist(total.distM - hv.m)} tot ${pts()[pts().length - 1].name}`,
      `${ctx.fmt.dur(s.tMin)} gevlogen · nog ${ctx.fmt.dur(total.timeMin - s.tMin)} · ETA hier ${ctx.fmt.time(plan.departMs + s.tMin * 60000)}`,
      `Koers ${ctx.fmt.course(at.course, at.lat, at.lon)} · GS ${s.gs ? Math.round(s.gs) : '—'} kt`,
    ];
    if (wnd) {
      const comp = PlanPerf.components(at.course, wnd.dirDeg, wnd.speedKt);
      out.push({ text: `Wind ${ctx.fmt.wind(wnd.dirDeg, wnd.speedKt)} op ${ctx.fmt.alt(plan.planning.altFt)}`, color: '#8fd3ff' });
      out.push({ text: `${comp.head >= 0 ? 'Tegenwind' : 'Rugwind'} ${ctx.fmt.windSpeed(Math.abs(comp.head))} · dwars ${ctx.fmt.windSpeed(Math.abs(comp.cross))} van ${comp.cross >= 0 ? 'rechts' : 'links'}`, color: '#8fd3ff' });
    } else out.push({ text: 'Wind: nog niet bekend (windlaag of internet)', color: '#8ea2bf' });
    if (s.fuelKg != null) out.push({ text: `Brandstof hier ${ctx.fmt.fuel(s.fuelKg)}`, color: s.fuelKg < plan.planning.reserveKg ? '#ff6b62' : '#c6d4e8' });
    out.push({ text: ctx.fmt.coord(at.lat, at.lon), color: '#8ea2bf' });
    return out;
  }

  map.on('mousemove', (e) => {
    if (!measured || !plan) { if (hover) { hover = null; ctx.cv.request(); } return; }
    const ll = { lat: e.latlng.lat, lon: e.latlng.lng };
    const n = PlanGeo.nearest(measured, ll);
    const px = n ? map.latLngToContainerPoint([n.point.lat, n.point.lon]).distanceTo(e.containerPoint) : Infinity;
    const next = px < 12 ? { m: n.m, lat: n.point.lat, lon: n.point.lon } : null;
    if (next || hover) { hover = next; ctx.cv.request(); }
  });
  map.on('mouseout', () => { if (hover) { hover = null; ctx.cv.request(); } });

  /* ---------- clicks ---------- */
  ctx.on('mapclick', ({ latlng, handled }) => {
    if (ctx.mode !== 'route') return;
    handled.done = true;
    add({ lat: latlng.lat, lon: latlng.lng });
  });
  ctx.on('delete', () => { if (selectedWp >= 0) remove(selectedWp); });
  ctx.on('mode', () => draw());
  ctx.on('profile', () => { recompute(); draw(); });
  ctx.on('units', () => draw());
  ctx.on('wind', () => { recompute(); ctx.cv.request(); });
  ctx.on('ready', () => { recompute(); draw(); });
  const tick = setInterval(() => { if (!route.departAt && plan) { recompute(); ctx.cv.request(); } }, 60000);
  ctx.timers.push(tick);

  /* ---------- the panel: points and navigation log ---------- */
  function panel() {
    const pl = ctx.planning(), list = pts();
    const head = h('div', { class: 'zp-sec' },
      h('div', { class: 'zp-sec-head' }, h('h3', {}, route.name || 'Route'),
        h('div', { class: 'zp-sec-tools' },
          zpBtn('', () => ctx.setMode('route'), { icon: 'route', title: 'Routemodus (R): klik op de kaart om punten toe te voegen', cls: ctx.mode === 'route' ? 'on' : '' }),
          zpBtn('', reverse, { icon: 'refresh', title: 'Route omdraaien', disabled: list.length < 2 }),
          zpBtn('', () => list.length && confirmDialog('Route wissen', 'Alle routepunten verwijderen?', 'Wissen', clear), { icon: 'trash', title: 'Route wissen', disabled: !list.length }))),
      list.length ? null : h('p', { class: 'zp-hint' }, 'Klik op ', h('b', {}, 'Route'), ' (of druk R) en klik op de kaart om punten te zetten. Sleep een punt om het te verplaatsen, sleep een + om een punt in te voegen, rechtsklik om te verwijderen. Zoekresultaten en platforms kun je ook direct aan de route toevoegen.'));
    // Flight settings for this route.
    const settings = h('div', { class: 'zp-grid4' },
      field('Hoogte', zpNum(route.altFt != null ? Math.round(PlanUnits.altIn(route.altFt, cfg.units.alt)) : '', (v) => { route.altFt = v == null ? null : PlanUnits.altFt(v, cfg.units.alt); changed('alt'); }, { placeholder: String(Math.round(PlanUnits.altIn(PlanProfiles.planning(ctx.profile()).altFt, cfg.units.alt))), step: 100 }), PlanUnits.ALT[cfg.units.alt].name),
      field('IAS', zpNum(route.ias || '', (v) => { route.ias = v; changed('ias'); }, { placeholder: String(PlanProfiles.planning(ctx.profile()).ias), step: 5 }), `kt · TAS ${Math.round(ctx.tas(pl.altFt))} kt`),
      field('Brandstof', zpNum(route.fuelKg != null ? Math.round(PlanUnits.fuelIn(route.fuelKg, cfg.units.fuel, pl.density)) : '', (v) => { route.fuelKg = v == null ? null : PlanUnits.fuelKg(v, cfg.units.fuel, pl.density); changed('fuel'); }, { placeholder: String(Math.round(PlanUnits.fuelIn(pl.usableKg, cfg.units.fuel, pl.density))), step: 10 }), `${PlanUnits.FUEL[cfg.units.fuel].name} aan boord bij opstarten`),
      field('Vertrek', zpDepart(), 'Leeg = nu'));
    const rows = [];
    if (plan) {
      plan.legs.forEach((leg, i) => {
        const mid = PlanGeo.interp(leg.from, leg.to, 0.5);
        rows.push(h('tr', { class: i + 1 === selectedWp || i === selectedWp - 1 ? 'sel' : '' },
          h('td', {}, h('b', {}, leg.to.name), h('small', {}, ctx.fmt.coord(leg.to.lat, leg.to.lon))),
          h('td', {}, ctx.fmt.course(leg.tc, mid.lat, mid.lon)),
          h('td', {}, ctx.fmt.dist(leg.distM)),
          h('td', {}, leg.wind ? ctx.fmt.wind(leg.wind.dirDeg, leg.wind.speedKt) : '—'),
          h('td', {}, leg.th == null ? '!' : `${ctx.fmt.course(leg.th, mid.lat, mid.lon)}`, h('small', {}, leg.wca == null ? 'te veel wind' : `WCA ${leg.wca >= 0 ? '+' : ''}${Math.round(leg.wca)}°`)),
          h('td', {}, `${Math.round(leg.gs)} kt`),
          h('td', {}, ctx.fmt.dur(leg.eteMin), h('small', {}, ctx.fmt.time(leg.etaMs))),
          h('td', { class: leg.fuelRemKg != null && leg.fuelRemKg < pl.reserveKg ? 'bad' : '' }, leg.fuelRemKg == null ? '—' : ctx.fmt.fuel(leg.fuelRemKg))));
      });
    }
    const table = plan ? h('table', { class: 'zp-navlog' },
      h('thead', {}, h('tr', {}, ['Naar', cfg.units.north === 'true' ? 'TC' : 'MC', 'Afst.', 'Wind', 'Kop', 'GS', 'ETE / ETA', 'Rest'].map((t) => h('th', {}, t)))),
      h('tbody', {}, rows)) : null;
    const tot = plan ? h('div', { class: 'zp-totals' },
      zpRow('Afstand', ctx.fmt.dist(plan.total.distM)),
      zpRow('Vliegtijd', ctx.fmt.dur(plan.total.timeMin, true)),
      zpRow('Aankomst', ctx.fmt.time(plan.total.etaMs)),
      zpRow('Verbruik', `${ctx.fmt.fuel(plan.total.fuelKg)} (incl. ${ctx.fmt.fuel(pl.taxiKg)} opstart/taxi)`),
      zpRow('Na landing', plan.total.landingFuelKg == null ? '—' : ctx.fmt.fuel(plan.total.landingFuelKg), `Eindreserve ${pl.reserveMin} min = ${ctx.fmt.fuel(pl.reserveKg)}`),
      zpRow('PNR', pnr ? (pnr.beyond ? `${ctx.fmt.dist(pnr.m)} · na ${ctx.fmt.dur(pnr.tMin)}` : 'Hele route binnen bereik') : '—', 'Point of no return: tot hier kun je met de brandstof aan boord nog terug naar het vertrekpunt (zonder reserve)'),
      zpRow('PSR', psr ? (psr.beyond ? `${ctx.fmt.dist(psr.m)} · na ${ctx.fmt.dur(psr.tMin)}` : 'Hele route binnen bereik') : '—', 'Point of safe return: tot hier kom je terug met de eindreserve nog aan boord'),
      zpRow('TAS / verbruik', `${Math.round(plan.tasKt)} kt · ${Math.round(pl.flowKgh)} kg/u`, 'TAS uit de IAS op hoogte (ISA); verbruik uit het profiel')) : null;
    const warn = plan ? zpRouteWarnings(ctx, plan) : [];
    // The points themselves, to rename and reorder.
    const wps = h('div', { class: 'zp-wps' }, list.map((wp, i) => {
      const nameIn = h('input', { class: 'input', value: wp.name, onchange: (e) => { wp.name = e.target.value.slice(0, 40) || `WP${i + 1}`; wp.named = true; changed('name'); } });
      return h('div', { class: 'zp-wpr' + (i === selectedWp ? ' sel' : ''), draggable: 'true',
        ondragstart: (e) => e.dataTransfer.setData('text/plain', String(i)),
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => { e.preventDefault(); const from = +e.dataTransfer.getData('text/plain'); if (from === i) return; const [m] = list.splice(from, 1); list.splice(i, 0, m); changed('order'); } },
      h('span', { class: 'zp-wpn' }, i === 0 ? 'A' : i === list.length - 1 && list.length > 1 ? 'B' : String(i)), nameIn,
      h('button', { class: 'w-tool', title: 'Inzoomen op dit punt', onclick: () => map.setView([wp.lat, wp.lon], Math.max(map.getZoom(), 11)) }, icon('target')),
      h('button', { class: 'w-tool', title: 'Verwijderen', onclick: () => remove(i) }, icon('close')));
    }));
    return h('div', { class: 'zp-panel' }, head, settings, warn.length ? h('div', { class: 'zp-warns' }, warn) : null, tot, table, list.length ? h('h4', { class: 'zp-sub' }, 'Routepunten (sleep om de volgorde te wijzigen)') : null, wps);
  }

  function zpDepart() {
    const el = h('input', { class: 'input', type: 'datetime-local', value: route.departAt ? new Date(route.departAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '' });
    el.addEventListener('change', () => { route.departAt = el.value ? new Date(el.value).getTime() : null; changed('depart'); });
    return el;
  }

  return { add, remove, clear, reverse, setPoints, panel, recompute, points: pts, get plan() { return plan; } };
}

// What the planning should warn about: VNE, fuel, too much wind, rotor start wind at the destination.
function zpRouteWarnings(ctx, plan) {
  const out = [];
  const pl = plan.planning;
  const vne = ctx.vne({ altFt: pl.altFt });
  if (vne && vne.kias && pl.ias > vne.kias) out.push(h('div', { class: 'zp-warn bad' }, icon('alert'), `Geplande IAS ${pl.ias} kt ligt boven de VNE van ${Math.round(vne.kias)} KIAS (${vne.src}).`));
  else if (vne && vne.kias && pl.ias > vne.kias - 10) out.push(h('div', { class: 'zp-warn' }, icon('alert'), `Geplande IAS ${pl.ias} kt ligt dicht bij de VNE van ${Math.round(vne.kias)} KIAS.`));
  if (pl.mtow && pl.weightKg > pl.mtow) out.push(h('div', { class: 'zp-warn bad' }, icon('alert'), `Vlieggewicht ${pl.weightKg} kg boven MTOW ${pl.mtow} kg.`));
  if (plan.impossible) out.push(h('div', { class: 'zp-warn bad' }, icon('alert'), 'Op een deel van de route is de wind te sterk om de koers te houden.'));
  if (plan.total.landingFuelKg != null && plan.total.landingFuelKg < 0) out.push(h('div', { class: 'zp-warn bad' }, icon('alert'), `Te weinig brandstof: ${ctx.fmt.fuel(-plan.total.landingFuelKg)} tekort.`));
  else if (plan.total.belowReserve) out.push(h('div', { class: 'zp-warn bad' }, icon('alert'), `Landing onder de eindreserve van ${ctx.fmt.fuel(pl.reserveKg)} (${pl.reserveMin} min).`));
  const last = plan.legs[plan.legs.length - 1];
  const wEnd = last && ctx.windAt(last.to.lat, last.to.lon, plan.total.etaMs, 33);
  if (wEnd && pl.rotorStartStop && (wEnd.gustKt || wEnd.speedKt) > pl.rotorStartStop) out.push(h('div', { class: 'zp-warn bad' }, icon('alert'), `Wind bij aankomst (${Math.round(wEnd.gustKt || wEnd.speedKt)} kt) boven de limiet voor rotor starten/stoppen (${pl.rotorStartStop} kt).`));
  return out;
}
