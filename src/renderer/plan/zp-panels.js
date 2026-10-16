'use strict';

/* ============================================================
   Zoek & Plan — de bediening: werkbalk, zijpaneel met tabbladen, de kaart van een aangeklikt punt,
   en de keuzes voor kaartlagen en eenheden.
   ============================================================ */
const ZP_TABS = [
  { id: 'route', name: 'Route', icon: 'route' },
  { id: 'brief', name: 'Briefing', icon: 'note' },
  { id: 'fleet', name: 'Vloot', icon: 'plane' },
  { id: 'tools', name: 'Gereedschap', icon: 'target' },
  { id: 'profile', name: 'Profiel', icon: 'shield' },
  { id: 'saved', name: 'Opgeslagen', icon: 'star' },
];

function zpPanels(ctx) {
  const { map, cfg } = ctx;

  /* ---------- toolbar ---------- */
  const profSeg = segmented([{ value: 'ec135', label: 'EC135' }, { value: 'aw139', label: 'AW139' }], cfg.profile, (v) => { cfg.profile = v; cfg.reg = ''; ctx.save(); paintReg(); ctx.emit('profile'); });
  profSeg.classList.add('zp-prof');
  profSeg.title = 'Profiel: alle berekeningen in dit tabblad (snelheden, VNE, verbruik, bereik, windlimieten) volgen het gekozen toestel';
  const regSel = h('select', { class: 'input zp-sel zp-reg', title: 'Registratie' });
  const paintReg = () => {
    const p = ctx.profile();
    regSel.replaceChildren(h('option', { value: '' }, 'Alle ' + p.type), ...(p.regs || []).map((r) => h('option', { value: r, selected: r === cfg.reg || null }, r)));
  };
  regSel.addEventListener('change', () => { cfg.reg = regSel.value; ctx.save(); ctx.emit('profile'); });
  paintReg();
  // The same tools as in the panel Gereedschap: choosing one here opens it there, and the other way round.
  const modes = segmented([
    { value: 'select', label: 'Selecteer', icon: 'target', title: 'Klik op de kaart om een punt of object te bekijken (Esc)' },
    { value: 'route', label: 'Route', icon: 'route', title: 'Route bouwen (R): klik om punten toe te voegen' },
    ...Object.entries(ZP_TOOLS).map(([k, t]) => ({ value: k, label: t.short, icon: t.icon, title: `${t.name} (${t.key}): ${t.click}` })),
  ], 'select', (v) => ctx.setMode(v, true));
  modes.classList.add('zp-modes');
  ctx.on('mode', (m) => {
    modes.setValue(m);
    // The panel follows the tool: the route to Route, every other tool to Gereedschap.
    const tab = m === 'route' ? 'route' : ZP_TOOLS[m] ? 'tools' : null;
    if (tab && cfg.sideTab !== tab) { cfg.sideTab = tab; ctx.save(); if (!cfg.side) { cfg.side = true; ctx.root.classList.remove('side-off'); setTimeout(() => map.invalidateSize(), 220); } paintTabs(); }
    paintSoon();
  });
  const distSeg = segmented([{ value: 'nm', label: 'NM' }, { value: 'km', label: 'km' }], cfg.units.dist, (v) => { cfg.units.dist = v; ctx.save(); ctx.emit('units'); paintSoon(); });
  distSeg.title = 'Afstanden in zeemijlen of kilometers (meer eenheden onder de knop Eenheden)';
  ctx.on('units', () => distSeg.setValue(cfg.units.dist === 'km' ? 'km' : 'nm'));
  const layersBtn = h('button', { class: 'btn zp-btn', title: 'Kaarten en kaartlagen' }, icon('layers'), 'Lagen');
  const unitsBtn = h('button', { class: 'btn zp-btn', title: 'Eenheden' }, icon('gear'), 'Eenheden');
  const sideBtn = h('button', { class: 'w-tool', title: 'Zijpaneel tonen of verbergen' }, icon('layout'));
  sideBtn.addEventListener('click', () => { cfg.side = !cfg.side; ctx.root.classList.toggle('side-off', !cfg.side); ctx.save(); setTimeout(() => map.invalidateSize(), 220); });
  ctx.bar.append(profSeg, regSel, modes, distSeg, h('span', { class: 'zp-spacer' }), layersBtn, unitsBtn, sideBtn);

  /* ---------- popovers ---------- */
  const pop = h('div', { class: 'zp-pop', hidden: true });
  ctx.mapBox.append(pop);
  let popKind = null;
  const openPop = (kind) => { if (popKind === kind && !pop.hidden) { pop.hidden = true; popKind = null; return; } popKind = kind; pop.hidden = false; paintPop(); };
  layersBtn.addEventListener('click', () => openPop('layers'));
  unitsBtn.addEventListener('click', () => openPop('units'));
  const closePop = (e) => { if (!pop.hidden && !pop.contains(e.target) && !layersBtn.contains(e.target) && !unitsBtn.contains(e.target)) { pop.hidden = true; popKind = null; } };
  document.addEventListener('pointerdown', closePop, true);
  ctx.cleanups.push(() => document.removeEventListener('pointerdown', closePop, true));

  const chk = (label, get, set, hint) => h('label', { class: 'check', title: hint || null }, h('input', { type: 'checkbox', checked: !!get(), onchange: (e) => set(e.target.checked) }), label);
  const changed = (what) => { ctx.save(); ctx.emit('layers', what); };
  function paintPop() {
    if (popKind === 'units') return paintUnits();
    const A = cfg.aero, P = cfg.points, O = cfg.offshore, W = cfg.wind, F = cfg.fleet;
    const T = ctx.aeroTypes || {};
    const groups = {};
    for (const [k, b] of Object.entries(ZP_BASES)) (groups[b.group] = groups[b.group] || []).push([k, b]);
    const col = (title, ...kids) => h('div', { class: 'zp-pop-col' }, h('h4', {}, title), ...kids);
    const aeroTypes = ZP_AIRSPACE_GROUPS.map((g2) => h('div', { class: 'zp-tgroup' }, h('b', {}, g2.name), ...g2.types.map((t) => {
      const info = T[t] || { name: t, color: '#888' };
      return h('label', { class: 'check', title: info.name }, h('input', { type: 'checkbox', checked: A.types.includes(t), onchange: (e) => { A.types = e.target.checked ? [...new Set([...A.types, t])] : A.types.filter((x) => x !== t); changed('aero'); ctx.parts.zpAero.draw(); } }), h('i', { class: 'zp-dot', style: `background:${info.color}` }), info.name);
    })));
    pop.replaceChildren(h('div', { class: 'zp-pop-grid' },
      col('Ondergrond', ...Object.entries(groups).map(([gname, list]) => h('div', { class: 'zp-tgroup' }, h('b', {}, gname), ...list.map(([k, b]) => h('label', { class: 'check' }, h('input', { type: 'radio', name: 'zpbase' + ctx.w.id, checked: cfg.base === k, onchange: () => { cfg.base = k; ctx.save(); ctx.base.apply(); } }), b.name)))),
        h('b', { class: 'zp-tlabel' }, 'Kaartlagen'),
        ...Object.entries(ZP_RASTER).map(([k, d]) => chk(d.name, () => (cfg.raster || []).includes(k), (on) => { cfg.raster = on ? [...new Set([...(cfg.raster || []), k])] : (cfg.raster || []).filter((x) => x !== k); ctx.save(); ctx.base.applyRaster(); }, d.hint))),
      col('Luchtruim (openAIP)',
        chk('Luchtruim tonen', () => A.on, (v) => { A.on = v; changed('aero'); ctx.parts.zpAero.draw(); }),
        chk('Vlakken inkleuren', () => A.fill, (v) => { A.fill = v; changed('aero'); ctx.parts.zpAero.draw(); }),
        chk('Namen en hoogtegrenzen', () => A.labels, (v) => { A.labels = v; changed('aero'); }),
        field('Alleen met ondergrens tot', zpSelect([1000, 2000, 3000, 4500, 6000, 10000, 19500, 99999].map((ft) => ({ value: ft, label: ft === 99999 ? 'Alles' : `${ft.toLocaleString('nl-NL')} ft` })), A.maxFloorFt ?? 99999, (v) => { A.maxFloorFt = +v; changed('aero'); ctx.parts.zpAero.draw(); })),
        ...aeroTypes),
      col('Punten',
        chk('Luchthavens en vliegvelden', () => P.airports, (v) => { P.airports = v; changed('points'); }),
        chk('Heliports', () => P.heliports, (v) => { P.heliports = v; changed('points'); }),
        chk('Ziekenhuishelipads', () => P.hospitals, (v) => { P.hospitals = v; changed('points'); }),
        chk('Meldpunten (VRP)', () => P.vrp, (v) => { P.vrp = v; changed('points'); }),
        chk('Radiobakens (VOR, NDB, DME)', () => P.navaids, (v) => { P.navaids = v; changed('points'); }),
        chk('Obstakels', () => P.obstacles, (v) => { P.obstacles = v; changed('points'); }, 'openAIP: masten, schoorstenen, gebouwen (vanaf zoom 9)'),
        field('Obstakels vanaf', zpSelect([0, 100, 200, 300, 500, 1000].map((ft) => ({ value: ft, label: `${ft} ft hoog` })), P.obstacleMinFt, (v) => { P.obstacleMinFt = +v; changed('points'); })),
        chk('Windturbines', () => P.turbines, (v) => { P.turbines = v; changed('points'); }, 'openAIP-obstakels en Rijkswaterstaat (op zee), vanaf zoom 10'),
        chk('Windparken en veiligheidszones', () => P.farms, (v) => { P.farms = v; ctx.save(); ctx.parts.zpOffshore.drawFarms(); }),
        h('b', { class: 'zp-tlabel' }, 'Offshore'),
        chk('Platforms tonen', () => O.on, (v) => { O.on = v; changed('offshore'); }),
        ...Object.entries(ZP_KINDS).map(([k, d]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: O.kinds.includes(k), onchange: (e) => { O.kinds = e.target.checked ? [...new Set([...O.kinds, k])] : O.kinds.filter((x) => x !== k); changed('offshore'); } }), h('i', { class: 'zp-dot sq', style: `background:${d.color}` }), d.name)),
        chk('Alleen in gebruik', () => O.active, (v) => { O.active = v; changed('offshore'); }),
        chk('Rest van de wereld (OpenStreetMap)', () => O.world, (v) => { O.world = v; changed('offshore'); }),
        chk('Namen', () => O.labels, (v) => { O.labels = v; changed('offshore'); })),
      col('Weer',
        chk('Wind', () => W.on, (v) => { W.on = v; ctx.save(); ctx.parts.zpWind.apply(); }),
        field('Weergave', zpSelect([{ value: 'flow', label: 'Stromingslijnen (zoals Windy)' }, { value: 'field', label: 'Kleurvlak' }, { value: 'both', label: 'Stromingslijnen + kleurvlak' }, { value: 'none', label: 'Alleen windveren' }], W.style, (v) => { W.style = v; ctx.save(); ctx.parts.zpWind.apply(); })),
        chk('Windveren', () => W.barbs, (v) => { W.barbs = v; ctx.save(); ctx.cv.request(); }),
        chk('Weerstations (METAR/TAF)', () => cfg.wx.metar, (v) => { cfg.wx.metar = v; changed('wx'); }),
        field('Toetsen aan BOM-profiel', zpSelect(WX.PROFILES.map((p) => ({ value: p.id, label: p.name })), cfg.wx.profile || 'mpd', (v) => { cfg.wx.profile = v; changed('wx'); })),
        chk('SIGMET', () => cfg.wx.sigmet, (v) => { cfg.wx.sigmet = v; changed('wx'); }),
        h('b', { class: 'zp-tlabel' }, 'Vloot'),
        chk('Live eenheden', () => F.on, (v) => { F.on = v; changed('fleet'); }),
        ...Object.entries(ZP_FLEET_GROUPS).map(([k, n]) => chk(n, () => F.groups.includes(k), (v) => { F.groups = v ? [...new Set([...F.groups, k])] : F.groups.filter((x) => x !== k); changed('fleet'); trafficWatch(); })),
        field('Vooruitprojectie', zpSelect([{ value: 0, label: 'Uit' }, { value: 1, label: '1 minuut' }, { value: 2, label: '1, 2 en 5 minuten' }, { value: 3, label: '1, 2, 5 en 10 minuten' }], F.vectors, (v) => { F.vectors = +v; changed('fleet'); })),
        chk('Labels', () => F.labels, (v) => { F.labels = v; changed('fleet'); }),
        chk('Gevlogen route', () => F.trails, (v) => { F.trails = v; changed('fleet'); }),
        h('b', { class: 'zp-tlabel' }, 'Overig'),
        chk('Coördinatenraster', () => cfg.grid, (v) => { cfg.grid = v; changed('grid'); }),
        chk('Dag/nachtgrens', () => cfg.terminator, (v) => { cfg.terminator = v; changed('terminator'); }))));
  }
  function paintUnits() {
    const U = PlanUnits, u = cfg.units;
    const set = (k) => (v) => { u[k] = v; ctx.save(); ctx.emit('units'); paintSoon(); paintUnits(); };
    const opt = (tbl) => Object.entries(tbl).map(([k, d]) => ({ value: k, label: d.label }));
    pop.replaceChildren(h('div', { class: 'zp-pop-units' },
      h('h4', {}, 'Eenheden'),
      field('Afstand', zpSelect(opt(U.DIST), u.dist, set('dist'))),
      field('Snelheid', zpSelect(opt(U.SPEED), u.speed, set('speed'))),
      field('Hoogte', zpSelect(opt(U.ALT), u.alt, set('alt'))),
      field('Brandstof', zpSelect(opt(U.FUEL), u.fuel, set('fuel'))),
      field('Windsnelheid', zpSelect(opt(U.WIND), u.wind, set('wind'))),
      field('Koersen', zpSelect([{ value: 'mag', label: 'Magnetisch (WMM2025)' }, { value: 'true', label: 'Waar noord' }], u.north, set('north')), `Magnetische variatie hier: ${(ctx.mag(map.getCenter().lat, map.getCenter().lng)).toFixed(1).replace('.', ',')}° oost`),
      field('Coördinaten', zpSelect([{ value: 'ddm', label: 'Graden, decimale minuten (N52°18,517\')' }, { value: 'dms', label: 'Graden, minuten, seconden' }, { value: 'dd', label: 'Decimale graden' }, { value: 'avi', label: 'Luchtvaart compact (N52 18.52)' }, { value: 'rd', label: 'Rijksdriehoek (RD)' }, { value: 'mgrs', label: 'MGRS' }, { value: 'utm', label: 'UTM' }], u.coord, set('coord'))),
      field('Tijd', zpSelect([{ value: 'utc', label: 'UTC (Z)' }, { value: 'lt', label: 'Lokale tijd' }], u.time, set('time'))),
      h('button', { class: 'btn', onclick: () => { cfg.units = { ...U.DEFAULTS }; ctx.save(); ctx.emit('units'); paintSoon(); paintUnits(); } }, 'Standaard luchtvaart (NM, kt, ft, kg)'),
      h('button', { class: 'zp-linkbtn zp-deep', onclick: () => { pop.hidden = true; openSettings('zoekplan'); } }, icon('gear'), 'Bronnen, sleutels, offline kaarten en profielbestand…')));
  }

  /* ---------- the card ---------- */
  const cardEl = ctx.card;
  let lastSpec = null;
  ctx.showCard = (spec) => {
    lastSpec = spec;
    if (!spec) { cardEl.hidden = true; return; }
    const p = spec.point;
    cardEl.hidden = false;
    cardEl.style.setProperty('--zp-c', spec.color || '#ffb941');
    cardEl.replaceChildren(
      h('div', { class: 'zp-card-head' }, h('div', {}, h('b', {}, spec.title), h('small', {}, spec.sub || '')), h('button', { class: 'w-tool', title: 'Sluiten', onclick: () => { cardEl.hidden = true; } }, icon('close'))),
      h('div', { class: 'zp-card-body' },
        p ? zpCoordBlock(ctx, p.lat, p.lon) : null,
        spec.rows && spec.rows.length ? h('div', { class: 'zp-rows' + (spec.mono ? ' mono' : '') }, spec.rows.map(([k, v]) => zpRow(k, v))) : null,
        ...(spec.extra || []),
        p ? zpPointExtras(ctx, p) : null),
      p ? zpPointActions(ctx, { lat: p.lat, lon: p.lon, label: spec.title }) : null);
  };
  // A plain spot on the map (or a search result): what is there.
  ctx.showPoint = async (pt) => {
    const extra = pt.airport ? [zpAirportExtra(ctx, pt.airport)] : [];
    if (pt.label) { ctx.showCard({ title: pt.label, sub: pt.sub || '', color: '#ffb941', point: pt, rows: [], extra }); return; }
    const coord = ctx.fmt.coord(pt.lat, pt.lon);
    const near = (txt) => h('div', { class: 'zp-near' }, icon('globe'), h('div', {}, h('small', {}, 'Dichtstbijzijnde adres op land'), h('b', {}, txt)));
    ctx.showCard({ title: coord, sub: 'Coördinaat · punt op de kaart', color: '#ffb941', point: pt, rows: [], extra: [near('zoeken…')] });
    try {
      const r = await window.palv.plan.reverse(pt.lat, pt.lon);
      if (!ctx.selected || ctx.selected.lat !== pt.lat || ctx.selected.lon !== pt.lon) return;
      const d = r && r.lat != null ? PlanGeo.dist(pt, r) : r && r.distance;
      const txt = r && r.label ? `${r.label}${r.sub ? ', ' + r.sub.replace(/^Adres · /, '') : ''}${d != null && d > 50 ? ` · ${ctx.fmt.dist(d)} richting ${ctx.fmt.course(PlanGeo.bearing(pt, r), pt.lat, pt.lon)}` : ''}` : 'geen adres gevonden';
      ctx.showCard({ title: coord, sub: 'Coördinaat · punt op de kaart', color: '#ffb941', point: pt, rows: [], extra: [near(txt)] });
    } catch { /* the card stays as it is */ }
  };
  // Winds and the airspace come in after the card opened: it is drawn again with them.
  let cardTimer = null;
  for (const ev of ['wind', 'aero', 'units', 'profile']) ctx.on(ev, () => { if (!lastSpec || cardEl.hidden) return; clearTimeout(cardTimer); cardTimer = setTimeout(() => { const body = cardEl.querySelector('.zp-card-body'); const top = body ? body.scrollTop : 0; ctx.showCard(lastSpec); const nb = cardEl.querySelector('.zp-card-body'); if (nb) nb.scrollTop = top; }, 300); });
  ctx.on('pick', (pt) => {
    if (ctx.mode !== 'select') return;
    ctx.select({ lat: pt.lat, lon: pt.lon, label: null, kind: 'point' });
    ctx.showPoint({ lat: pt.lat, lon: pt.lon });
  });
  // Selection marker.
  ctx.cv.add(90, (c) => {
    const s = ctx.selected;
    if (!s) return;
    const p = c.P(s.lat, s.lon), { g } = c;
    g.lineWidth = 2.5; g.strokeStyle = '#ffffff';
    g.beginPath(); g.arc(p[0], p[1], 11, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 1.5; g.strokeStyle = '#0a0f18';
    g.beginPath(); g.arc(p[0], p[1], 13, 0, Math.PI * 2); g.stroke();
    g.beginPath(); for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { g.moveTo(p[0] + dx * 14, p[1] + dy * 14); g.lineTo(p[0] + dx * 20, p[1] + dy * 20); } g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.stroke();
  });

  /* ---------- side panel ---------- */
  const tabs = h('div', { class: 'zp-tabs', role: 'tablist' });
  const content = h('div', { class: 'zp-side-body' });
  ctx.side.append(tabs, content);
  const paintTabs = () => tabs.replaceChildren(...ZP_TABS.map((t) => h('button', { class: 'zp-tab' + (cfg.sideTab === t.id ? ' on' : ''), title: t.name, onclick: () => { cfg.sideTab = t.id; ctx.save(); paintTabs(); paintSide(); } }, icon(t.icon), h('span', {}, t.name))));
  paintTabs();
  let pending = false;
  function paintSide() {
    pending = false;
    if (!ZP_TABS.some((t) => t.id === cfg.sideTab)) cfg.sideTab = 'route';
    // Never while someone is typing in the panel: it would take the field away under their fingers.
    if (ctx.side.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { pending = 'focus'; return; }
    const scroll = content.scrollTop;
    let el;
    try {
      switch (cfg.sideTab) {
        case 'route': el = ctx.parts.zpRoute.panel(); break;
        case 'brief': el = ctx.parts.zpExtras.briefing(); break;
        case 'fleet': el = fleetPanel(); break;
        case 'tools': el = ctx.parts.zpTools.panel(); break;
        case 'profile': el = zpProfilePanel(ctx); break;
        case 'saved': el = zpSavedPanel(ctx); break;
        default: el = h('div');
      }
    } catch (err) { plog('warn', 'zoek & plan: paneel mislukt', String(err && err.stack || err)); el = h('p', { class: 'zp-hint warn' }, 'Dit paneel kon niet worden getoond.'); }
    content.replaceChildren(el);
    content.scrollTop = scroll;
  }
  const paintSoon = () => { if (!pending) { pending = true; requestAnimationFrame(paintSide); } };
  ctx.side.addEventListener('focusout', () => { if (pending === 'focus') setTimeout(paintSoon, 50); });
  const paintIf = (...tabsFor) => () => { if (tabsFor.includes(cfg.sideTab)) paintSoon(); };
  ctx.on('plan', paintIf('route', 'brief'));
  ctx.on('route', paintIf('route', 'brief'));
  ctx.on('profile', () => { paintReg(); profSeg.setValue(cfg.profile); paintSoon(); });
  ctx.on('units', paintSoon);
  ctx.on('store', paintIf('saved', 'profile', 'sources'));
  ctx.on('tools', paintIf('tools'));
  ctx.on('items', paintIf('tools', 'route'));
  ctx.on('first', paintIf('fleet'));
  ctx.on('select', paintIf('tools', 'fleet'));
  ctx.on('wx', paintIf('brief'));
  ctx.on('aero', paintIf('brief', 'sources'));
  ctx.on('offshore', paintIf('sources'));
  ctx.on('layers', () => { if (!pop.hidden && popKind === 'layers') paintPop(); ctx.cv.request(); });
  ctx.on('ready', paintSide);

  function fleetPanel() {
    const snap = trafficFeed.snap;
    const own = (snap && snap.ac ? snap.ac : []).filter((a) => a.group && cfg.fleet.groups.includes(a.group) && a.lat != null);
    return h('div', { class: 'zp-panel' },
      ctx.parts.zpTools.firstPanel(),
      h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, `In de lucht (${own.filter((a) => a.alt !== 'ground').length})`)),
        own.length ? h('div', { class: 'zp-first' }, own.map((a) => {
          const nm = UNIT_NAMES(a.hex) || {};
          return h('div', { class: 'zp-first-row', onclick: () => { const pos = vrNow(a, Date.now()); map.setView(pos, Math.max(map.getZoom(), 10)); ctx.emit('hit', { hit: { kind: 'aircraft', item: a } }); } },
            h('i', { class: 'zp-dot', style: `background:${VR_GROUP_COLOR[a.group]}` }),
            h('div', {}, h('b', {}, a.flight || a.reg || nm.reg || a.hex.toUpperCase()), h('small', {}, `${nm.reg || a.reg || ''} ${nm.type || a.type || ''} · ${FLEET_GROUPS[a.group]}`)),
            h('div', { class: 'zp-first-t' }, h('b', {}, vrAltText(a)), h('small', {}, a.gs == null ? '—' : `${Math.round(a.gs)} kt · ${a.track == null ? '' : ctx.fmt.course(a.track, a.lat, a.lon)}`)));
        })) : h('p', { class: 'zp-hint' }, 'Geen eigen eenheden in de lucht (of zet de groepen aan onder Lagen › Vloot).')));
  }
  const showTab = (id) => { cfg.sideTab = id; ctx.save(); paintTabs(); paintSoon(); };
  return { paintSide: paintSoon, paintPop, showTab };
}

/* ---------- pieces of the card ---------- */
function zpCoordBlock(ctx, lat, lon) {
  const styles = [['ddm', 'DDM'], ['dms', 'DMS'], ['dd', 'DD'], ['rd', 'RD'], ['mgrs', 'MGRS']];
  return h('div', { class: 'zp-coords' }, styles.map(([s, n]) => {
    const v = PlanCoords.fmt(lat, lon, s);
    if (!v) return null;
    return h('button', { class: 'zp-coord' + (ctx.cfg.units.coord === s ? ' on' : ''), title: 'Klik om te kopiëren', onclick: () => zpCopy(PlanCoords.fmt(lat, lon, s, { copy: true }) || v) }, h('span', {}, n), h('b', {}, v));
  }));
}
function zpPointExtras(ctx, p) {
  const out = [];
  const pl = ctx.planning();
  const wGnd = ctx.windAt(p.lat, p.lon, Date.now(), 33), wAlt = ctx.windAt(p.lat, p.lon, Date.now(), pl.altFt);
  out.push(h('div', { class: 'zp-rows' },
    zpRow('Wind grond', wGnd ? `${ctx.fmt.wind(wGnd.dirDeg, wGnd.speedKt)}${wGnd.gustKt ? ' · vlagen ' + ctx.fmt.windSpeed(wGnd.gustKt) : ''}` : 'opvragen…'),
    zpRow(`Wind ${ctx.fmt.alt(pl.altFt)}`, wAlt ? ctx.fmt.wind(wAlt.dirDeg, wAlt.speedKt) : 'opvragen…'),
    wGnd && pl.rotorStartStop ? zpRow('Rotor starten/stoppen', (wGnd.gustKt || wGnd.speedKt) > pl.rotorStartStop ? `Boven de limiet van ${pl.rotorStartStop} kt` : `Binnen de limiet van ${pl.rotorStartStop} kt`) : null,
    zpRow('Magn. variatie', `${ctx.mag(p.lat, p.lon).toFixed(1).replace('.', ',')}° O`)));
  // Distance and time from the bases.
  const bases = ctx.bases();
  const tas = ctx.tas();
  out.push(h('div', { class: 'zp-rows' }, bases.map((b) => {
    const d = PlanGeo.dist(b, p), t = PlanPerf.directTime(b, p, tas, (la, lo, ms) => ctx.windAt(la, lo, ms, pl.altFt));
    return zpRow(`Vanaf ${b.name}`, `${ctx.fmt.course(PlanGeo.bearing(b, p), b.lat, b.lon)} · ${ctx.fmt.dist(d)} · ${t == null ? '—' : ctx.fmt.dur(t)} (${ctx.profile().type})`);
  })));
  // The airspace over this point.
  const rows = ctx.airspaceRows ? ctx.airspaceRows(p.lat, p.lon) : [];
  if (rows.length) out.push(h('h4', { class: 'zp-sub' }, 'Luchtruim boven dit punt'), h('div', { class: 'zp-airlist' }, rows.map((r) => { const url = zpAipUrl({ airspace: r.a }); return h('div', { class: 'zp-air' }, h('i', { class: 'zp-dot', style: `background:${r.color}` }), h('div', {}, h('b', {}, r.text), h('small', {}, r.sub)), url ? h('button', { class: 'w-tool', title: 'Officiële AIP (LVNL) voor dit luchtruim', onclick: () => zpOpenAip(url) }, icon('globe')) : null); })));
  return h('div', {}, out);
}
function zpAirportExtra(ctx, ap) {
  if (!ap) return null;
  const code = ap.icao || ap.gps_code || ap.ident;
  return h('div', { class: 'zp-rows' },
    zpAipBtn(zpAipUrl({ icao: code })),
    ap.elevation_ft != null || ap.elevFt != null ? zpRow('Hoogte', ctx.fmt.alt(ap.elevFt ?? ap.elevation_ft)) : null,
    ...(ap.runways || []).slice(0, 6).map((r) => zpRow(`Baan ${r.le_ident || r.des || ''}${r.he_ident ? '/' + r.he_ident : ''}`, `${r.length_ft ? Math.round(r.length_ft * 0.3048) + ' m' : r.lengthM ? r.lengthM + ' m' : ''} ${r.surface || ''}`.trim())),
    ...(ap.frequencies || ap.freqs || []).slice(0, 8).map((f) => zpRow(f.type || 'Freq.', `${f.frequency_mhz || f.mhz || ''} ${f.description || f.name || ''}`)));
}
function zpPointActions(ctx, p) {
  const tools = ctx.parts.zpTools, route = ctx.parts.zpRoute;
  const sel = () => ctx.select({ lat: p.lat, lon: p.lon, label: p.label, kind: ctx.selected && ctx.selected.kind });
  const name = String(p.label || 'Punt').split(',')[0].slice(0, 40);
  return h('div', { class: 'zp-card-actions' },
    zpBtn('Route +', () => { route.add({ lat: p.lat, lon: p.lon, name, kind: ctx.selected && ctx.selected.kind }); toast(`${name} aan de route toegevoegd`); }, { icon: 'plus', title: 'Achteraan aan de route toevoegen' }),
    zpBtn('Vertrek', () => { const wp = { lat: p.lat, lon: p.lon, name, kind: ctx.selected && ctx.selected.kind }; if (route.points().length) route.add(wp, 0); else route.add(wp); }, { icon: 'route', title: 'Als eerste routepunt' }),
    zpBtn('Ringen', () => tools.addRings(p), { icon: 'radar', title: 'Afstandsringen rond dit punt' }),
    zpBtn('Meten', () => { ctx.setMode('measure', true); tools.setTape({ lat: p.lat, lon: p.lon }); }, { icon: 'route', title: 'Meetlint vanaf dit punt: klik daarna punt B' }),
    zpBtn('Snelst', () => { sel(); ctx.cfg.sideTab = 'fleet'; ctx.cfg.firstShow = true; ctx.save(); ctx.parts.zpPanels.paintSide(); ctx.emit('select', ctx.selected); }, { icon: 'plane', title: 'Wie is er het snelst naar dit punt' }),
    ...['pattern', 'orbit', 'reach'].map((k) => zpBtn(ZP_TOOLS[k].short, () => { tools.place(k, { lat: p.lat, lon: p.lon, label: name }); ctx.parts.zpPanels.showTab('tools'); }, { icon: ZP_TOOLS[k].icon, title: `${ZP_TOOLS[k].name} op dit punt` })),
    zpBtn('', () => { const id = Math.random().toString(36).slice(2, 10); ctx.put('shared', 'favorites', id, { name, lat: p.lat, lon: p.lon }).then(() => toast(`${name} bij de favorieten`)); }, { icon: 'star', title: 'Als favoriet bewaren (gaat mee naar de andere schermen)' }));
}

/* ---------- profile ---------- */
let zpProfQuery = '';
function zpProfilePanel(ctx) {
  const p = ctx.profile(), pl = ctx.planning(), cfg = ctx.cfg;
  const own = ctx.store.private.profiles && ctx.store.private.profiles[p.id];
  const show = (label, f, fmt) => (f ? zpRow(label, `${fmt ? fmt(f.v) : f.v} ${f.unit || ''}`.trim(), zpSrc(f)) : null);
  const vne = ctx.vne();
  const sec = (title, ...kids) => (title === 'Deze vlucht'
    ? h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, title)), ...kids)
    : h('details', { class: 'zp-sec zp-fold' }, h('summary', { class: 'zp-sec-head' }, h('h3', {}, title), h('i', { class: 'zp-chev' })), h('div', { class: 'zp-fold-body' }, ...kids)));
  const route = cfg.route;
  const num = (v) => (typeof v === 'number' ? v.toLocaleString('nl-NL') : v);
  const ops = own && own.ops ? Object.entries(own.ops).flatMap(([k, list]) => (Array.isArray(list) ? list.map((x) => ({ k, ...x })) : [])) : [];
  const panel = h('div', { class: 'zp-panel zp-profpanel' },
    h('div', { class: 'zp-prof-head', style: `--zp-c:${p.color}` }, h('b', {}, p.name), h('span', {}, `${p.maker} · ${(p.regs || []).join(', ')}`)),
    sec('Deze vlucht',
      h('div', { class: 'zp-grid4' },
        field('Vlieggewicht', zpNum(route.weightKg || '', (v) => { route.weightKg = v; ctx.save(); ctx.emit('profile'); }, { placeholder: String(PlanProfiles.planning(p).weightKg), step: 50 }), `kg · MTOW ${num(pl.mtow) || '—'}`),
        field('IAS', zpNum(route.ias || '', (v) => { route.ias = v; ctx.save(); ctx.emit('profile'); }, { placeholder: String(PlanProfiles.planning(p).ias), step: 5 }), `kt · TAS ${Math.round(ctx.tas())} kt`),
        field('Hoogte', zpNum(route.altFt ?? '', (v) => { route.altFt = v; ctx.save(); ctx.emit('profile'); }, { placeholder: String(PlanProfiles.planning(p).altFt), step: 100 }), 'ft AMSL'),
        field('Brandstof', zpNum(route.fuelKg ?? '', (v) => { route.fuelKg = v; ctx.save(); ctx.emit('profile'); }, { placeholder: String(pl.usableKg), step: 10 }), 'kg aan boord')),
      h('div', { class: 'zp-totals' },
        zpRow('VNE nu', vne && vne.kias ? `${Math.round(vne.kias)} KIAS${vne.exact === false ? ' (rand van de tabel of zeeniveauwaarde)' : ''}` : '—', vne ? vne.src : ''),
        zpRow('Verbruik', `${Math.round(pl.flowKgh)} kg/u`, pl.flowSrc),
        zpRow('Uithoudingsvermogen', ctx.fmt.dur(((pl.fuelKg - pl.taxiKg - pl.reserveKg) / pl.flowKgh) * 60, true), `Brandstof min opstart/taxi en eindreserve (${pl.reserveMin} min)`),
        zpRow('Bereik (windstil)', ctx.fmt.dist((((pl.fuelKg - pl.taxiKg - pl.reserveKg) / pl.flowKgh) * ctx.tas()) * 1852)))),
    sec('Snelheden', ...Object.entries({ vne: 'VNE', vneOei: 'VNE één motor', vneAutorot: 'VNE autorotatie', vy: 'Vy', vtoss: 'VTOSS', cruiseFast: 'Snelle kruisvlucht', cruiseEco: 'Economische kruisvlucht', endurance: 'Max. vliegduur' }).map(([k, n]) => show(n, p.speeds[k])),
      ...(Array.isArray(p.speeds.limits) ? p.speeds.limits.map((x) => zpRow(x.what, typeof x.kias === 'number' ? `${x.kias} KIAS` : x.kias != null ? String(x.kias) : x.value || '', [x.src, x.note].filter(Boolean).join(' — '))) : [])),
    sec('Massa (standaardmassa\'s BOM)', zpMassCalc(ctx)),
    p.vneTable && p.vneTable.length ? sec('VNE-tabel', zpVneTable(p)) : null,
    sec('Wind', ...Object.entries(p.wind || {}).filter(([, f]) => f && typeof f === 'object' && 'v' in f).map(([k, f]) => show({ rotorStartStop: 'Rotor starten/stoppen', rotorStartLog: 'Registreren boven', sideward: 'Zijwaarts', rearward: 'Achterwaarts', crosswind: 'Dwarswind', tailwind: 'Staartwind', catACross: 'Cat A dwarswind', gust: 'Vlagen' }[k] || k, f)),
      ...['envelope', 'catA', 'offshore', 'other'].flatMap((k) => (Array.isArray(p.wind && p.wind[k]) ? p.wind[k].map((x) => zpRow(x.what || x.weightNote || k, x.value != null ? String(x.value) : x.kt != null ? `${x.kt} kt${x.azimuthDeg != null ? ' op ' + x.azimuthDeg + '°' : ''}` : '', x.src)) : []))),
    sec('Gewicht en brandstof', show('MTOW', p.weights.mtow, num), show('Leeg', p.weights.empty, num), show('Brandstof bruikbaar', p.fuel.usableKg, num), show('Brandstof (liter)', p.fuel.usableL, num), show('Dichtheid', p.fuel.densityKgL),
      show('Verbruik planning', p.fuel.plan), show('Opstart/taxi', p.fuel.taxi), show('Eindreserve', p.fuel.reserveMin),
      ...(Array.isArray(p.fuel.policy) ? p.fuel.policy.map((x) => zpRow(x.what, String(x.value), x.src)) : [])),
    sec('Prestaties en afmetingen', ...Object.entries(p.perf || {}).map(([k, f]) => show({ hige: 'HIGE', hoge: 'HOGE', ceiling: 'Dienstplafond', oeiCeiling: 'Plafond één motor', maxAlt: 'Max. hoogte', slope: 'Helling', rangeNm: 'Bereik', enduranceMin: 'Vliegduur', oat: 'Temperatuur' }[k] || k, f, num)),
      ...Object.entries(p.dims || {}).map(([k, f]) => show({ rotor: 'Rotordiameter', dValue: 'D-waarde', height: 'Hoogte', lengthM: 'Lengte' }[k] || k, f)),
      show('Motoren', p.engines && p.engines.type), show('Bemanning', p.crew)),
    ops.length ? sec('Operationeel (BOM, SOP, TACSOP)', h('div', { class: 'zp-rows' }, ops.map((x) => zpRow(x.what, String(x.value), x.src)))) : null);
  // Search: every row whose label or value holds all words shows, its section opens; the rest folds away.
  const q = h('input', { class: 'input zp-profq', type: 'search', placeholder: 'Zoek in het profiel: VNE, wind, hoist, brandstof, minima…', value: zpProfQuery });
  const run = () => {
    zpProfQuery = q.value;
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    let hits = 0;
    for (const d of panel.querySelectorAll('details.zp-fold')) {
      let any = false;
      for (const r of d.querySelectorAll('.zp-kv, .field, tr')) {
        const ok = !words.length || words.every((w) => r.textContent.toLowerCase().includes(w) || (r.title || '').toLowerCase().includes(w));
        r.style.display = ok ? '' : 'none';
        if (ok && words.length) any = true;
      }
      const inTitle = words.length && words.every((w) => d.querySelector('summary').textContent.toLowerCase().includes(w));
      if (inTitle) for (const r of d.querySelectorAll('.zp-kv, .field, tr')) r.style.display = '';
      d.open = !!words.length && (any || inTitle);
      d.hidden = !!words.length && !any && !inTitle;
      if (d.open) hits += 1;
    }
    found.textContent = words.length ? (hits ? `${hits} onderdel${hits === 1 ? '' : 'en'} met "${q.value}"` : `Niets gevonden voor "${q.value}"`) : '';
  };
  const found = h('small', { class: 'zp-hint' });
  q.addEventListener('input', run);
  panel.children[0].after(h('div', { class: 'zp-profsearch' }, icon('globe'), q), found);
  requestAnimationFrame(run);
  return panel;

}
function zpVneTable(p) {
  const bands = [...new Set(p.vneTable.map((r) => r.weightKg ?? Infinity))].sort((a, b) => a - b);
  return h('div', {}, bands.map((band) => {
    const rows = p.vneTable.filter((r) => (r.weightKg ?? Infinity) === band);
    const hps = [...new Set(rows.map((r) => r.hpFt))].sort((a, b) => a - b), oats = [...new Set(rows.map((r) => r.oatC))].sort((a, b) => b - a);
    return h('div', { class: 'zp-vne' }, h('b', {}, band === Infinity ? 'Alle gewichten' : `Tot ${band.toLocaleString('nl-NL')} kg`),
      h('table', { class: 'zp-navlog' }, h('thead', {}, h('tr', {}, h('th', {}, 'Hp \\ OAT'), oats.map((t) => h('th', {}, `${t}°`)))),
        h('tbody', {}, hps.map((hp) => h('tr', {}, h('td', {}, `${hp.toLocaleString('nl-NL')} ft`), oats.map((t) => { const r = rows.find((x) => x.hpFt === hp && x.oatC === t); return h('td', {}, r ? String(Math.round(r.kias)) : ''); }))))));
  }), h('small', { class: 'zp-hint' }, p.vneTableSrc || ''));
}

/* ---------- saved ---------- */
function zpSavedPanel(ctx) {
  const { cfg } = ctx;
  const sh = ctx.store.shared;
  const routes = Object.entries(sh.routes || {}).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0));
  const favs = Object.entries(sh.favorites || {}).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name)));
  const bases = Object.entries(sh.bases || {});
  const nameIn = textInput(cfg.route.name || '', { placeholder: 'Naam van de route', maxlength: 60 });
  const sel = ctx.selected;
  const go = (lat, lon, z = 12) => ctx.map.setView([lat, lon], Math.max(ctx.map.getZoom(), z));
  return h('div', { class: 'zp-panel' },
    h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Routes')),
      h('div', { class: 'zp-btnrow' }, nameIn, zpBtn('Opslaan', () => {
        if (cfg.route.points.length < 2) { toast('Een route heeft minstens twee punten', true); return; }
        const name = nameIn.value.trim() || `${cfg.route.points[0].name} – ${cfg.route.points[cfg.route.points.length - 1].name}`;
        cfg.route.name = name;
        const existing = routes.find(([, r]) => r.name === name);
        const id = existing ? existing[0] : Math.random().toString(36).slice(2, 10);
        ctx.put('shared', 'routes', id, { name, points: cfg.route.points.map(({ lat, lon, name: n }) => ({ lat, lon, name: n })), profile: cfg.profile, altFt: cfg.route.altFt, ias: cfg.route.ias }).then(() => toast(`Route "${name}" opgeslagen`));
      }, { icon: 'download', primary: true })),
      routes.length ? h('div', { class: 'zp-list' }, routes.map(([id, r]) => h('div', { class: 'zp-li' },
        h('div', {}, h('b', {}, r.name), h('small', {}, `${r.points.length} punten · ${PlanUnits.fmtDist(PlanGeo.measure(r.points).total, cfg.units.dist)} · ${(r.profile || '').toUpperCase()} · ${new Date(r.updatedAt).toLocaleDateString('nl-NL')}`)),
        zpBtn('Laden', () => { if (r.profile) cfg.profile = r.profile; ctx.parts.zpRoute.setPoints(r.points, { name: r.name, altFt: r.altFt ?? null, ias: r.ias ?? null }); ctx.emit('profile'); }),
        h('button', { class: 'w-tool', title: 'Verwijderen', onclick: () => confirmDialog('Route verwijderen', `"${r.name}" verwijderen, ook op de andere schermen?`, 'Verwijderen', () => ctx.put('shared', 'routes', id, null)) }, icon('trash'))))) : h('p', { class: 'zp-hint' }, 'Nog geen opgeslagen routes. Opgeslagen routes gaan mee naar de andere schermen.')),
    h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Favorieten')),
      favs.length ? h('div', { class: 'zp-list' }, favs.map(([id, f]) => h('div', { class: 'zp-li' },
        h('div', {}, h('b', {}, f.name), h('small', {}, ctx.fmt.coord(f.lat, f.lon))),
        zpBtn('Toon', () => { go(f.lat, f.lon, 13); ctx.select({ lat: f.lat, lon: f.lon, label: f.name, kind: 'fav' }); ctx.showPoint({ lat: f.lat, lon: f.lon, label: f.name, sub: 'Favoriet' }); }),
        h('button', { class: 'w-tool', title: 'Verwijderen', onclick: () => ctx.put('shared', 'favorites', id, null) }, icon('trash'))))) : h('p', { class: 'zp-hint' }, 'Klik een punt en kies de ster in de kaart van dat punt.')),
    h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Bases')),
      h('p', { class: 'zp-hint' }, 'Vanaf deze plekken rekent "Wie is er het snelst" en de puntkaart. Zonder eigen bases geldt Schiphol-Oost.'),
      sel ? zpBtn(`${sel.label || 'Geselecteerd punt'} als basis`, () => { const id = Math.random().toString(36).slice(2, 10); ctx.put('shared', 'bases', id, { name: String(sel.label || 'Basis').slice(0, 40), lat: sel.lat, lon: sel.lon, startMin: 10 }); }, { icon: 'plus' }) : null,
      h('div', { class: 'zp-list' }, (bases.length ? bases : ZP_BASES_DEFAULT.map((b) => [null, b])).map(([id, b]) => h('div', { class: 'zp-li' },
        h('div', {}, h('b', {}, b.name), h('small', {}, ctx.fmt.coord(b.lat, b.lon))),
        field('Opstarten', zpNum(b.startMin, (v) => { if (id) ctx.put('shared', 'bases', id, { ...b, startMin: v || 0 }); else { const nid = Math.random().toString(36).slice(2, 10); ctx.put('shared', 'bases', nid, { ...b, startMin: v || 0 }); } }, { step: 1, min: 0, max: 60 }), 'min'),
        id ? h('button', { class: 'w-tool', title: 'Verwijderen', onclick: () => ctx.put('shared', 'bases', id, null) }, icon('trash')) : null)))));
}

/* ---------- sources ---------- */
function zpSourcesPanel(ctx) {
  const el = h('div', { class: 'zp-panel' }, h('p', { class: 'zp-hint' }, 'Laden…'));
  (async () => {
    const [aero, budget, tiles] = await Promise.all([window.palv.plan.aeroStatus().catch(() => null), window.palv.plan.windBudget().catch(() => null), window.palv.plan.tileStats().catch(() => null)]);
    const off = ctx.parts.zpOffshore;
    const keyIn = textInput('', { placeholder: aero && aero.configured ? 'Sleutel is ingesteld — nieuwe invullen om te vervangen' : 'openAIP API-sleutel', type: 'password' });
    const sec = (title, ...kids) => h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, title)), ...kids);
    const b = ctx.map.getBounds();
    const prefetchSel = zpSelect(Object.entries(ZP_T).filter(([, d]) => tiles && tiles.sources[d.src] && tiles.sources[d.src].prefetch).map(([k]) => ({ value: ZP_T[k].src, label: (Object.values(ZP_BASES).find((x) => x.day && x.day.src === ZP_T[k].src) || { name: k }).name })), 'brt', () => {});
    el.replaceChildren(
      sec('Luchtvaartgegevens (openAIP)',
        h('div', { class: 'zp-rows' }, zpRow('Status', aero ? (aero.ok || (aero.configured && !aero.lastError) ? 'Werkt (sleutel ingesteld)' : aero.configured ? `Fout: ${aero.lastError}` : 'Geen sleutel ingesteld') : '—'),
          ...(aero && aero.fetchedAt ? Object.entries(aero.fetchedAt).map(([cc, t]) => zpRow(cc, `${t ? new Date(t).toLocaleString('nl-NL') : '—'}${aero.counts && aero.counts[cc] ? ` · ${aero.counts[cc].airspaces} luchtruimen, ${aero.counts[cc].airports} vliegvelden` : ''}`)) : [])),
        h('div', { class: 'zp-btnrow' }, keyIn, zpBtn('Opslaan', async () => { const r = await window.palv.plan.aeroKey(keyIn.value); if (r && r.ok) { toast('openAIP-sleutel opgeslagen'); ctx.parts.zpAero.reload(); } else toast((r && (r.lastError || r.error)) || 'Sleutel geweigerd', true); })),
        h('p', { class: 'zp-hint' }, '© openAIP (CC BY-NC 4.0). Gemeenschapsdata: niet voor navigatie, controleer de AIP. De kaartlaag "VFR-luchtvaartkaart" komt van openFlightMaps (op basis van LVNL-gegevens).')),
      sec('Officiële AIP (LVNL)',
        h('p', { class: 'zp-hint' }, `Geldende cyclus: AIRAC ${String(zpAirac().num).padStart(2, '0')}-${zpAirac().year}, van kracht sinds ${zpAirac().eff.toLocaleDateString('nl-NL', { timeZone: 'UTC' })}. LVNL staat niet toe dat de AIP of de ICAO-kaart zonder schriftelijke toestemming wordt overgenomen of omgezet; daarom opent het tabblad de officiële pagina's zelf. Bij elk vliegveld en luchtruim staat een knop naar het juiste hoofdstuk.`),
        h('div', { class: 'zp-btnrow' }, zpAipBtn(zpAipUrl(), 'eAIP Nederland'), zpBtn('ICAO-kaart voorzijde', () => zpOpenAip(ZP_AIP_CHART.front), { icon: 'globe' }), zpBtn('ICAO-kaart achterzijde', () => zpOpenAip(ZP_AIP_CHART.back), { icon: 'globe' }))),
      sec('Wind (Open-Meteo)', h('div', { class: 'zp-rows' },
        zpRow('Vandaag gebruikt', budget ? `${Math.round(budget.day)} door dit scherm${budget.others && budget.others.day ? ` + ${Math.round(budget.others.day)} door de andere schermen` : ''} · grens ${budget.dayCap} van ${budget.dayLimit}` : '—', 'Gratis tarief: 10.000 per dag, 5.000 per uur, 600 per minuut, per internetadres. Het dashboard blijft onder 70 % per dag, 60 % per uur en 50 % per minuut, alle schermen samen. Met meerdere schermen haalt één scherm de wind op voor allemaal.'),
        budget ? zpRow('Dit uur / deze minuut', `${Math.round(budget.hour + (budget.others ? budget.others.hour : 0))} van ${budget.hourCap} · ${Math.round(budget.minute + (budget.others ? budget.others.minute : 0))} van ${budget.minuteCap}`) : null,
        budget && budget.blockedUntil > Date.now() ? zpRow('Gepauzeerd tot', new Date(budget.blockedUntil).toLocaleTimeString('nl-NL')) : null,
        budget && budget.lastError ? zpRow('Laatste fout', budget.lastError) : null),
        h('p', { class: 'zp-hint' }, 'ICON (DWD) voor Europa, GFS (NOAA) elders; wind op 10 m en op 975, 950, 900 en 850 hPa, elk uur. Data CC BY 4.0.')),
      sec('Platforms', h('div', { class: 'zp-rows' }, (off.sources() || []).map((s) => zpRow(s.name, `${s.ok ? s.count + ' stuks' : 'fout: ' + (s.error || '?')}${s.fetchedAt ? ' · ' + new Date(s.fetchedAt).toLocaleDateString('nl-NL') : ''}`, `${s.licence || ''} ${s.url || ''}`)),
        zpRow('OpenStreetMap', `${off.status().osm} extra in bekeken gebieden`)),
      zpBtn('Opnieuw ophalen', () => off.load(true), { icon: 'refresh' }),
      h('p', { class: 'zp-hint' }, 'Dekheading, dekhoogte, D/t-waarde en frequenties van Nederlandse helidekken zijn niet openbaar; vul ze in via de kaart van het platform (Eigen dekkaart).')),
      sec('Kaarten offline', h('div', { class: 'zp-rows' }, zpRow('Opgeslagen tegels', tiles ? `${(tiles.bytes / 1e6).toFixed(0)} MB (elke bekeken tegel 30 dagen)` : '—')),
        h('p', { class: 'zp-hint' }, 'Sla het gebied in beeld vooraf op, tot 4 zoomniveaus dieper. OpenStreetMap staat dat niet toe; de PDOK-kaarten, satelliet en openFlightMaps wel.'),
        h('div', { class: 'zp-btnrow' }, prefetchSel, zpBtn('Gebied in beeld opslaan', async () => {
          const z = Math.round(ctx.map.getZoom());
          const r = await window.palv.plan.prefetch({ src: prefetchSel.value, bbox: [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()], zMin: z, zMax: z + 4 });
          if (r && r.total) toast(`${r.total} tegels worden opgeslagen…`); else toast((r && r.error) || 'Opslaan lukte niet', true);
        }, { icon: 'download' }))),
      sec('Overige bronnen', h('div', { class: 'zp-rows' },
        zpRow('Zoeken', 'PDOK Locatieserver (NL), Photon/OpenStreetMap (wereld), OurAirports (vliegvelden)'),
        zpRow('Magnetische variatie', 'NOAA World Magnetic Model 2025'),
        zpRow('Weer', 'aviationweather.gov (METAR, TAF, SIGMET), RainViewer (neerslag)'),
        zpRow('Live verkeer', 'adsb.fi, adsb.lol, OpenSky (zoals de Vluchtradar)'),
        zpRow('Kaarten', 'OpenStreetMap, PDOK (Kadaster, Beeldmateriaal NL, RVO), EOX Sentinel-2, OpenTopoMap, openFlightMaps, OpenSeaMap'))));
  })();
  return el;
}

// Take-off mass from the basic mass of the registration, the people on board at the standard masses of
// the BOM (Deel A 8.2.8), load and the fuel at take-off; one click makes it this flight's mass.
const ZP_STD_MASS = [
  ['police', 'Politie incl. bewapening en uitrusting', 100], ['police_vest', 'Met zwaar vest en bewapening (o.a. DSI)', 120],
  ['male', 'Passagier man', 90], ['female', 'Passagier vrouw', 80], ['child', 'Kind onder 12 jaar', 35],
];
function zpMassCalc(ctx) {
  const cfg = ctx.cfg, pl = ctx.planning(), p = ctx.profile();
  const key = cfg.reg || p.type;
  cfg.mass = cfg.mass || {};
  const m = cfg.mass[key] = cfg.mass[key] || { basic: null, count: {}, loadKg: 0 };
  const set = (fn) => (v) => { fn(v); ctx.save(); ctx.parts.zpPanels.paintSide(); };
  const people = ZP_STD_MASS.reduce((n, [k, , kg]) => n + (m.count[k] || 0) * kg, 0);
  const fuelTo = pl.fuelKg - pl.taxiKg;
  const tow = m.basic ? m.basic + people + (m.loadKg || 0) + fuelTo : null;
  return h('div', {},
    h('div', { class: 'zp-grid4' },
      field(`Basismassa ${key}`, zpNum(m.basic || '', set((v) => { m.basic = v; }), { step: 1, placeholder: 'uit de W&B' }), 'kg, leeg met vaste uitrusting (W&B-rapport)'),
      field('Lading en uitrusting', zpNum(m.loadKg || '', set((v) => { m.loadKg = v || 0; }), { step: 5, placeholder: '0' }), 'kg'),
      ...ZP_STD_MASS.map(([k, label, kg]) => field(`${label} (${kg} kg)`, zpNum(m.count[k] || '', set((v) => { m.count[k] = v || 0; }), { step: 1, min: 0, placeholder: '0' })))),
    h('div', { class: 'zp-totals' },
      zpRow('Personen', ctx.fmt.fuel(people).replace(/ (kg|lb|L)$/, ' kg')),
      zpRow('Brandstof bij de start', ctx.fmt.fuel(fuelTo)),
      zpRow('Startmassa', tow ? `${Math.round(tow).toLocaleString('nl-NL')} kg` : 'vul de basismassa in', pl.mtow ? `MTOW ${pl.mtow.toLocaleString('nl-NL')} kg` : null),
      tow && pl.mtow ? zpRow(tow <= pl.mtow ? 'Ruimte tot MTOW' : 'Boven MTOW', `${Math.round(Math.abs(pl.mtow - tow)).toLocaleString('nl-NL')} kg`) : null),
    tow ? zpBtn('Gebruik als vlieggewicht', () => { cfg.route.weightKg = Math.round(tow); ctx.save(); ctx.emit('profile'); }, { icon: 'check', primary: true }) : null,
    h('p', { class: 'zp-hint' }, 'Standaardmassa\'s volgens BOM Deel A 8.2.8: alleen als de werkelijke massa onbekend is; sommige TACSOP\'s wijken af. De officiële massa- en zwaartepuntberekening blijft Easyweigh op de EFB.'));
}
