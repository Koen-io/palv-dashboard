'use strict';

/* ============================================================
   Zoek & Plan — extra's: coördinatenraster, dag/nachtgrens, weerstations tegen de BOM-minima,
   SIGMET's, de routebriefing met verticaal profiel, en exporteren (GPX, KML, kniebord-PDF, tekst).
   ============================================================ */
function zpExtras(ctx) {
  const { map, cfg } = ctx;
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const fam = () => getComputedStyle(document.body).fontFamily;

  /* ---------- graticule ---------- */
  ctx.cv.add(10, (c) => {
    if (!cfg.grid) return;
    const { g } = c;
    const b = c.bounds;
    const span = b.getEast() - b.getWest();
    const step = [1 / 60, 2 / 60, 5 / 60, 10 / 60, 15 / 60, 30 / 60, 1, 2, 5, 10, 15, 30].find((s) => span / s <= 14) || 30;
    const lbl = (v, pos) => { const a = Math.abs(v), d = Math.floor(a + 1e-9), m = Math.round((a - d) * 60); return `${d}°${m ? String(m).padStart(2, '0') + "'" : ''}${v >= 0 ? pos[0] : pos[1]}`; };
    g.lineWidth = 1; g.strokeStyle = 'rgba(200,214,232,0.35)';
    const font = `600 ${(0.58 * rem()).toFixed(1)}px ${fam()}`;
    for (let lon = Math.ceil(b.getWest() / step) * step; lon <= b.getEast(); lon += step) {
      const p0 = c.P(b.getNorth(), lon), p1 = c.P(b.getSouth(), lon);
      g.beginPath(); g.moveTo(p0[0], 0); g.lineTo(p1[0], c.h); g.stroke();
      zpText(g, lbl(lon, 'EW'), p0[0] + 3, c.h - 30, { font, color: '#c6d4e8' });
    }
    for (let lat = Math.ceil(b.getSouth() / step) * step; lat <= b.getNorth(); lat += step) {
      const p = c.P(lat, b.getWest());
      g.beginPath(); g.moveTo(0, p[1]); g.lineTo(c.w, p[1]); g.stroke();
      zpText(g, lbl(lat, 'NS'), 6, p[1] - 7, { font, color: '#c6d4e8' });
    }
  });

  /* ---------- day and night ---------- */
  // The terminator: where the sun is on the horizon now; the night side shaded, civil twilight lighter.
  function subsolar(ms) {
    const d = ms / 864e5 - 10957.5; // days from J2000
    const L = PlanGeo.rad((280.46 + 0.9856474 * d) % 360), g2 = PlanGeo.rad((357.528 + 0.9856003 * d) % 360);
    const lam = L + PlanGeo.rad(1.915) * Math.sin(g2) + PlanGeo.rad(0.02) * Math.sin(2 * g2);
    const eps = PlanGeo.rad(23.439 - 4e-7 * d);
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    return { lat: PlanGeo.deg(dec), lon: PlanGeo.norm180(PlanGeo.deg(ra) - gmst * 15) };
  }
  ctx.cv.add(5, (c) => {
    if (!cfg.terminator) return;
    const { g } = c;
    const s = subsolar(Date.now());
    // Night = farther than 90° (+6° for twilight) from the subsolar point.
    for (const [extra, alpha] of [[0, 0.16], [6, 0.14]]) {
      const ring = PlanGeo.circle({ lat: -s.lat, lon: PlanGeo.norm180(s.lon + 180) }, (90 - extra) * 111194.9, 240);
      g.beginPath();
      ring.forEach((p, i) => { const q = c.P(p.lat, p.lon); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
      g.closePath();
      g.fillStyle = `rgba(4,10,28,${alpha})`; g.fill();
    }
  });
  ctx.timers.push(setInterval(() => { if (cfg.terminator) ctx.cv.request(); }, 60000));

  /* ---------- weather stations against the BOM minima ---------- */
  let wx = null, wxAt = 0, sig = [], sigLayer = null;
  async function loadWx() {
    if (!cfg.wx.metar) return;
    const b = map.getBounds().pad(0.2);
    try {
      const res = await window.palv.plan.wx([Math.max(-89, b.getSouth()), Math.max(-180, b.getWest()), Math.min(89, b.getNorth()), Math.min(180, b.getEast())]);
      if (res && res.ok) { wx = WX.stations(res, Date.now()); wxAt = res.fetchedAt; ctx.cv.request(); ctx.emit('wx'); }
    } catch { /* keep the last */ }
  }
  async function loadSig() {
    if (!cfg.wx.sigmet) { if (sigLayer) { sigLayer.remove(); sigLayer = null; } return; }
    try { const res = await window.palv.plan.sigmets(); if (Array.isArray(res)) { sig = res; drawSig(); ctx.emit('wx'); } } catch { /* keep */ }
  }
  function drawSig() {
    if (sigLayer) { sigLayer.remove(); sigLayer = null; }
    if (!cfg.wx.sigmet) return;
    const feats = sig.filter((s) => s.coords && s.coords.length > 2 && s.to > Date.now()).map((s) => ({ type: 'Feature', properties: { id: s.id }, geometry: { type: 'Polygon', coordinates: [s.coords.concat([s.coords[0]])] } }));
    sigLayer = L.geoJSON({ type: 'FeatureCollection', features: feats }, { renderer: ctx.vector, interactive: false, style: () => ({ color: '#ff3d7f', weight: 2, dashArray: '8 4', fillColor: '#ff3d7f', fillOpacity: 0.08 }) }).addTo(map);
  }
  const wxProfile = () => cfg.wx.profile || 'mpd';
  ctx.cv.add(38, (c) => {
    if (!cfg.wx.metar || !wx) return;
    const { g } = c;
    const now = Date.now();
    const font = `700 ${(0.58 * rem()).toFixed(1)}px ${fam()}`;
    const colors = { green: '#3ecf6e', amber: '#ffb020', red: '#ff5148', none: '#8a8f98' };
    for (const st of wx) {
      const p = c.P(st.lat, st.lon);
      if (!c.inView(p, 20)) continue;
      const a = WX.assess(wxProfile(), st, now);
      g.beginPath(); g.arc(p[0], p[1], 6.5, 0, Math.PI * 2); g.fillStyle = colors[a.status]; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0a0f18'; g.stroke();
      if (c.zoom >= 7) zpText(g, st.icao, p[0], p[1] + 13, { font, color: '#e9eff8', align: 'center' });
      c.hit({ x: p[0], y: p[1], r: 9, kind: 'metar', item: { st, a }, z: 6 });
    }
  });
  ctx.on('hit', ({ hit }) => {
    if (hit.kind !== 'metar') return;
    const { st, a } = hit.item;
    ctx.select({ lat: st.lat, lon: st.lon, label: st.icao, kind: 'metar', item: st });
    ctx.showCard({
      title: `${st.icao} · ${st.name || ''}`, sub: `${WX.profile(wxProfile()).name}: ${{ green: 'binnen de minima', amber: 'krap of verslechterend', red: 'buiten de minima', none: 'geen oordeel (verouderd of onbekend)' }[a.status]}`,
      color: { green: '#3ecf6e', amber: '#ffb020', red: '#ff5148', none: '#8a8f98' }[a.status], point: st,
      rows: [['METAR', st.raw], ['Waarneming', `${zulu(st.obsTime)} · ${ageText(Date.now() - st.obsTime)} oud`], ['TAF', st.tafRaw || '—']], mono: true,
    });
  });
  map.on('moveend', () => { if (cfg.wx.metar && Date.now() - wxAt > 2000) { clearTimeout(ctx._wxT); ctx._wxT = setTimeout(loadWx, 800); } });
  ctx.timers.push(setInterval(() => { if (onScreen(ctx.body)) { loadWx(); loadSig(); } }, 5 * 60000));
  const applyWx = () => { if (cfg.wx.metar) loadWx(); else { wx = null; ctx.cv.request(); } loadSig(); };
  ctx.on('ready', applyWx);

  /* ---------- briefing ---------- */
  // What the route crosses: airspace with its limits and frequencies, SIGMETs, weather stations near the
  // route, light at departure and arrival, fuel and the warnings.
  function briefing() {
    const plan = ctx.plan;
    const pts = cfg.route.points;
    if (!plan || pts.length < 2) return h('p', { class: 'zp-hint' }, 'Maak eerst een route (tab Route): de briefing toont dan welk luchtruim je doorkruist, het weer langs de route, licht bij vertrek en aankomst, brandstof en de waarschuwingen.');
    const route = PlanGeo.measure(pts);
    const box = PlanGeo.bboxPoints(pts, 5000);
    const alt = plan.planning.altFt;
    const crossed = [];
    for (const a of (ctx.aero ? ctx.aero().airspaces : [])) {
      if (!a.bbox || !PlanGeo.boxesOverlap(a.bbox, box) || ['FIR', 'UIR', 'ACC', 'FIS', 'AWY'].includes(a.type)) continue;
      const parts = PlanGeo.crossings(route, a.geometry, 300);
      if (!parts.length) continue;
      const lo = a.lower ? a.lower.ft : 0, hi = a.upper ? a.upper.ft : 99999;
      for (const p of parts) crossed.push({ a, from: p.from, to: p.to, inside: alt >= lo && alt <= hi });
    }
    crossed.sort((x, y) => x.from - y.from);
    const T = ctx.aeroTypes || {};
    const tbl = h('table', { class: 'zp-navlog brief' },
      h('thead', {}, h('tr', {}, ['Luchtruim', 'Grenzen', 'Van – tot', 'Op jouw hoogte'].map((t) => h('th', {}, t)))),
      h('tbody', {}, crossed.length ? crossed.map((x) => h('tr', { class: x.inside ? 'hot' : '' },
        h('td', {}, h('i', { class: 'zp-dot', style: `background:${(T[x.a.type] || {}).color || '#888'}` }), h('b', {}, x.a.name), h('small', {}, `${(T[x.a.type] || {}).name || x.a.type}${x.a.icaoClass && x.a.icaoClass.length === 1 ? ' · klasse ' + x.a.icaoClass : ''}${x.a.freqs && x.a.freqs.length ? ' · ' + x.a.freqs.map((f) => f.mhz.toFixed(3).replace('.', ',')).join(' / ') : ''}`)),
        h('td', {}, `${x.a.lower ? x.a.lower.text : 'GND'} – ${x.a.upper ? x.a.upper.text : '?'}`),
        h('td', {}, `${ctx.fmt.dist(x.from)} – ${ctx.fmt.dist(x.to)}`, h('small', {}, `${ctx.fmt.dur(PlanPerf.sampleAt(plan, x.from).tMin)} na vertrek`)),
        h('td', {}, x.inside ? 'Ja: binnen' : x.a.lower && alt < x.a.lower.ft ? 'Onder' : 'Boven', zpAipUrl({ airspace: x.a }) ? h('button', { class: 'w-tool', title: 'Officiële AIP (LVNL)', onclick: () => zpOpenAip(zpAipUrl({ airspace: x.a })) }, icon('globe')) : null))) : h('tr', {}, h('td', { colspan: 4 }, 'Geen luchtruim gevonden (laad de luchtvaartgegevens of controleer de AIP).'))));

    // Light: sunset and the end of civil twilight at departure and arrival.
    const light = (p, ms) => {
      const st = ASTRO.sunTimes(new Date(ms), p.lat, p.lon);
      const alt0 = ASTRO.sunPosition(ms, p.lat, p.lon).alt;
      return `${alt0 > 0 ? 'dag' : alt0 > -6 ? 'schemering' : 'nacht'} · op ${zulu(st.rise.getTime())} · onder ${zulu(st.set.getTime())}`;
    };
    const near = [];
    if (wx) for (const st of wx) {
      const n = PlanGeo.nearest(route, st);
      if (n && n.off < 15 * 1852) near.push({ st, n, a: WX.assess(wxProfile(), st, Date.now()) });
    }
    near.sort((x, y) => x.n.m - y.n.m);
    const sigHits = (sig || []).filter((s) => s.coords && s.to > Date.now() && PlanGeo.crossings(route, { type: 'Polygon', coordinates: [s.coords.concat([s.coords[0]])] }, 1000).length);
    const warns = zpRouteWarnings(ctx, plan);
    return h('div', { class: 'zp-panel' },
      // What goes along to the aircraft first: one big button for the kneeboard, the files next to it.
      h('div', { class: 'zp-sec zp-export' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Exporteren')),
        h('div', { class: 'zp-export-grid' },
          zpBtn('Kniebord (PDF)', () => exportPdf(), { icon: 'download', primary: true, cls: 'zp-export-main', title: 'Navigatielog met brandstof en waarschuwingen op één A4, om te printen of op de EFB' }),
          zpBtn('GPX', () => exportGpx(), { icon: 'route', title: 'GPX-route voor tablet of GPS (ForeFlight, SkyDemon, Garmin)' }),
          zpBtn('KML', () => exportKml(), { icon: 'globe', title: 'Route voor Google Earth' }),
          zpBtn('Navlog', () => zpCopy(navText()), { icon: 'note', title: 'Navigatielog als tekst naar het klembord kopiëren' }))),
      h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Samenvatting')),
        h('div', { class: 'zp-totals' },
          zpRow('Route', `${pts[0].name} → ${pts[pts.length - 1].name} · ${ctx.fmt.dist(plan.total.distM)}`),
          zpRow('Profiel', `${ctx.profile().name}${cfg.reg ? ' · ' + cfg.reg : ''} · ${plan.planning.ias} KIAS (${Math.round(plan.tasKt)} KTAS) op ${ctx.fmt.alt(alt)}`),
          zpRow('Vertrek', `${ctx.fmt.time(plan.departMs)} · ${light(pts[0], plan.departMs)}`),
          zpRow('Aankomst', `${ctx.fmt.time(plan.total.etaMs)} · ${light(pts[pts.length - 1], plan.total.etaMs)}`),
          zpRow('Vliegtijd / verbruik', `${ctx.fmt.dur(plan.total.timeMin, true)} · ${ctx.fmt.fuel(plan.total.fuelKg)}`),
          zpRow('Brandstof na landing', plan.total.landingFuelKg == null ? '—' : ctx.fmt.fuel(plan.total.landingFuelKg)),
          zpRow('PNR / PSR', `${plan.pnr && plan.pnr.beyond ? ctx.fmt.dist(plan.pnr.m) : 'n.v.t.'} / ${plan.psr && plan.psr.beyond ? ctx.fmt.dist(plan.psr.m) : 'n.v.t.'}`))),
      warns.length ? h('div', { class: 'zp-warns' }, warns) : h('div', { class: 'zp-warn ok' }, icon('check'), 'Geen waarschuwingen voor snelheid, gewicht, brandstof en wind.'),
      // Both folded in to start with: with many layers they are long, and they are there when wanted.
      zpFold('brief-vprof', 'Verticaal profiel', () => zpProfileCanvas(ctx, plan, crossed)),
      zpFold('brief-air', 'Luchtruim langs de route', () => [tbl,
        h('p', { class: 'zp-hint' }, 'Bron openAIP. Niet voor navigatie: controleer altijd de AIP, NOTAM\'s en actuele activatie van TRA/TSA en EHR/EHD-gebieden.'),
        h('div', { class: 'zp-btnrow' }, zpAipBtn(zpAipUrl(), 'eAIP Nederland (geldende cyclus)'), zpBtn('ICAO-kaart 1:500.000', () => zpOpenAip(ZP_AIP_CHART.front), { icon: 'globe', title: 'Officiële VFR-kaart van LVNL (PDF, voorzijde)' }))], { badge: crossed.length }),
      h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Weer langs de route'), switchTool('STATIONS', 'Weerstations op de kaart', () => cfg.wx.metar, () => { cfg.wx.metar = !cfg.wx.metar; ctx.save(); applyWx(); ctx.emit('layers'); })),
        !cfg.wx.metar ? h('p', { class: 'zp-hint' }, 'Zet de weerstations aan om METAR en TAF langs de route te zien, getoetst aan de BOM-minima (profiel zoals op de weerradar).')
          : near.length ? h('div', { class: 'zp-metars' }, near.map(({ st, n, a }) => h('div', { class: 'zp-metar ' + a.status }, h('b', {}, `${st.icao} · ${ctx.fmt.dist(n.m)} langs de route, ${ctx.fmt.dist(n.off)} ernaast`), h('code', {}, st.raw), st.tafRaw ? h('code', { class: 'taf' }, st.tafRaw) : null)))
            : h('p', { class: 'zp-hint' }, 'Geen weerstations binnen 15 NM van de route.'),
        sigHits.length ? h('div', { class: 'zp-warns' }, sigHits.map((s) => h('div', { class: 'zp-warn bad' }, icon('alert'), `SIGMET ${s.fir || ''} ${s.hazard || ''} ${s.qualifier || ''} tot ${zulu(s.to)}`))) : null));
  }

  /* ---------- exports ---------- */
  const safeName = () => (cfg.route.name || `route-${cfg.route.points[0].name}-${cfg.route.points[cfg.route.points.length - 1].name}`).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'route';
  const xml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  async function exportGpx() {
    const p = cfg.route.points;
    const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="P-ALV Dashboard" xmlns="http://www.topografix.com/GPX/1/1">\n<rte><name>${xml(cfg.route.name || safeName())}</name>\n${p.map((w) => `<rtept lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}"><name>${xml(w.name)}</name></rtept>`).join('\n')}\n</rte>\n</gpx>\n`;
    const r = await window.palv.plan.saveText({ title: 'Route als GPX opslaan', name: safeName() + '.gpx', ext: 'gpx', content: gpx });
    if (r && r.ok) toast('GPX opgeslagen');
  }
  async function exportKml() {
    const p = cfg.route.points;
    const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${xml(cfg.route.name || safeName())}</name>\n<Style id="r"><LineStyle><color>ff1c9fff</color><width>4</width></LineStyle></Style>\n<Placemark><name>Route</name><styleUrl>#r</styleUrl><LineString><tessellate>1</tessellate><coordinates>${p.map((w) => `${w.lon.toFixed(6)},${w.lat.toFixed(6)},0`).join(' ')}</coordinates></LineString></Placemark>\n${p.map((w) => `<Placemark><name>${xml(w.name)}</name><Point><coordinates>${w.lon.toFixed(6)},${w.lat.toFixed(6)},0</coordinates></Point></Placemark>`).join('\n')}\n</Document></kml>\n`;
    const r = await window.palv.plan.saveText({ title: 'Route als KML opslaan', name: safeName() + '.kml', ext: 'kml', content: kml });
    if (r && r.ok) toast('KML opgeslagen');
  }
  function navText() {
    const plan = ctx.plan;
    const lines = [`${cfg.route.name || 'Route'} — ${ctx.profile().name} ${plan.planning.ias} KIAS / ${Math.round(plan.tasKt)} KTAS, ${ctx.fmt.alt(plan.planning.altFt)}, vertrek ${ctx.fmt.time(plan.departMs)}`];
    for (const l of plan.legs) {
      const mid = PlanGeo.interp(l.from, l.to, 0.5);
      lines.push(`${l.from.name} → ${l.to.name}: ${ctx.fmt.course(l.tc, mid.lat, mid.lon)} ${ctx.fmt.dist(l.distM)} · wind ${l.wind ? ctx.fmt.wind(l.wind.dirDeg, l.wind.speedKt) : '—'} · kop ${l.th == null ? '—' : ctx.fmt.course(l.th, mid.lat, mid.lon)} · GS ${Math.round(l.gs)} kt · ${ctx.fmt.dur(l.eteMin)} · ETA ${ctx.fmt.time(l.etaMs)} · rest ${l.fuelRemKg == null ? '—' : ctx.fmt.fuel(l.fuelRemKg)}`);
    }
    lines.push(`Totaal ${ctx.fmt.dist(plan.total.distM)}, ${ctx.fmt.dur(plan.total.timeMin, true)}, verbruik ${ctx.fmt.fuel(plan.total.fuelKg)}, na landing ${plan.total.landingFuelKg == null ? '—' : ctx.fmt.fuel(plan.total.landingFuelKg)}`);
    return lines.join('\n');
  }
  async function exportPdf() {
    const plan = ctx.plan;
    const p = cfg.route.points;
    const e = escHtml;
    const rows = plan.legs.map((l) => {
      const mid = PlanGeo.interp(l.from, l.to, 0.5);
      return `<tr><td><b>${e(l.to.name)}</b><br><small>${e(ctx.fmt.coord(l.to.lat, l.to.lon, 'ddm'))}</small></td><td>${e(ctx.fmt.course(l.tc, mid.lat, mid.lon))}</td><td>${e(ctx.fmt.dist(l.distM))}</td><td>${l.wind ? e(ctx.fmt.wind(l.wind.dirDeg, l.wind.speedKt)) : '—'}</td><td>${l.th == null ? '!' : e(ctx.fmt.course(l.th, mid.lat, mid.lon))}</td><td>${Math.round(l.gs)}</td><td>${e(ctx.fmt.dur(l.eteMin))}</td><td>${e(ctx.fmt.time(l.etaMs))}</td><td>${l.fuelRemKg == null ? '—' : e(ctx.fmt.fuel(l.fuelRemKg))}</td><td class="w"></td></tr>`;
    }).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{font:10px/1.35 "Segoe UI",Arial,sans-serif;color:#000;margin:0}h1{font-size:14px;margin:0 0 2px}h2{font-size:11px;margin:8px 0 3px;border-bottom:1px solid #000}
      .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:2px 10px;margin:4px 0}table{width:100%;border-collapse:collapse}th,td{border:1px solid #444;padding:2px 3px;text-align:left;vertical-align:top}th{background:#ddd;font-size:9px}
      td.w{width:42px}small{color:#333}.warn{border:1.5px solid #000;padding:3px;margin:3px 0;font-weight:700}.foot{margin-top:6px;font-size:8px;color:#333}
    </style></head><body>
      <h1>${e(cfg.route.name || 'Navigatielog')} — ${e(p[0].name)} → ${e(p[p.length - 1].name)}</h1>
      <div class="meta"><div>Profiel: <b>${e(ctx.profile().name)}${cfg.reg ? ' ' + e(cfg.reg) : ''}</b></div><div>IAS/TAS: <b>${plan.planning.ias} / ${Math.round(plan.tasKt)} kt</b></div><div>Hoogte: <b>${e(ctx.fmt.alt(plan.planning.altFt))}</b></div>
      <div>Vertrek: <b>${e(ctx.fmt.time(plan.departMs))}</b></div><div>Aankomst: <b>${e(ctx.fmt.time(plan.total.etaMs))}</b></div><div>Vliegtijd: <b>${e(ctx.fmt.dur(plan.total.timeMin, true))}</b></div>
      <div>Afstand: <b>${e(ctx.fmt.dist(plan.total.distM))}</b></div><div>Verbruik: <b>${e(ctx.fmt.fuel(plan.total.fuelKg))}</b></div><div>Na landing: <b>${plan.total.landingFuelKg == null ? '—' : e(ctx.fmt.fuel(plan.total.landingFuelKg))}</b></div>
      <div>PNR: <b>${plan.pnr && plan.pnr.beyond ? e(ctx.fmt.dist(plan.pnr.m)) : 'n.v.t.'}</b></div><div>PSR: <b>${plan.psr && plan.psr.beyond ? e(ctx.fmt.dist(plan.psr.m)) : 'n.v.t.'}</b></div><div>Verbruik/u: <b>${Math.round(plan.planning.flowKgh)} kg</b></div></div>
      ${zpRouteWarnings(ctx, plan).map((w) => `<div class="warn">${e(w.textContent)}</div>`).join('')}
      ${plan.fuel ? `<h2>Brandstof (BOM Deel A)</h2><table><tr><th>Start/taxi</th><th>Trip</th><th>Cont. ${plan.planning.contPct}%</th><th>Uitwijk${plan.fuel.alternate ? ' ' + e(plan.fuel.alternate.name) : ''}</th><th>Eindres. ${plan.planning.reserveMin} min</th><th>Extra</th><th>Benodigd</th><th>Aan boord</th><th>${plan.fuel.marginKg >= 0 ? 'Over' : 'Tekort'}</th></tr><tr>${[plan.fuel.taxiKg, plan.fuel.tripKg, plan.fuel.contingencyKg, plan.fuel.alternateKg, plan.fuel.finalReserveKg, plan.fuel.extraKg, plan.fuel.requiredKg, plan.fuel.onBoardKg, Math.abs(plan.fuel.marginKg)].map((v) => `<td>${e(ctx.fmt.fuel(v))}</td>`).join('')}</tr></table>` : ''}
      <h2>Navigatielog</h2><table><thead><tr><th>Naar</th><th>${cfg.units.north === 'true' ? 'TC' : 'MC'}</th><th>Afst.</th><th>Wind</th><th>Kop</th><th>GS</th><th>ETE</th><th>ETA</th><th>Rest</th><th>ATA</th></tr></thead><tbody>${rows}</tbody></table>
      <h2>Vertrek</h2><div>${e(p[0].name)} · ${e(ctx.fmt.coord(p[0].lat, p[0].lon, 'ddm'))} · ${e(ctx.fmt.coord(p[0].lat, p[0].lon, 'rd') || '')}</div>
      <div class="foot">Gemaakt met P-ALV Dashboard ${e(document.getElementById('tb-version').textContent)} op ${e(new Date().toLocaleString('nl-NL'))} · wind Open-Meteo · luchtruim openAIP · magnetische variatie WMM2025. Niet voor navigatie zonder controle van AIP, NOTAM en actuele weerberichten.</div>
    </body></html>`;
    const r = await window.palv.plan.printPdf({ html, name: safeName() + '.pdf' });
    if (r && r.ok) toast('Kniebordkaart opgeslagen');
    else if (r && r.error) toast('PDF maken mislukt: ' + r.error, true);
  }

  ctx.on('layers', () => { applyWx(); ctx.cv.request(); });
  return { briefing, applyWx, exportPdf, exportGpx, exportKml, navText };
}

// The route from the side: the planned height against the airspace it passes under, in and over.
function zpProfileCanvas(ctx, plan, crossed) {
  const cv = h('canvas', { class: 'zp-vprof' });
  requestAnimationFrame(() => {
    const W = cv.clientWidth || 420, H = 170, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const total = plan.total.distM, alt = plan.planning.altFt;
    const top = Math.max(3000, Math.ceil((alt * 1.6) / 1000) * 1000);
    const L0 = 44, B0 = H - 22, X = (m) => L0 + ((W - L0 - 8) * m) / total, Y = (ft) => B0 - ((B0 - 8) * Math.min(ft, top)) / top;
    const css = getComputedStyle(document.documentElement);
    g.fillStyle = css.getPropertyValue('--surface-2'); g.fillRect(0, 0, W, H);
    g.font = '10px sans-serif'; g.fillStyle = css.getPropertyValue('--muted'); g.strokeStyle = css.getPropertyValue('--border');
    for (let ft = 0; ft <= top; ft += top <= 3000 ? 500 : 1000) { g.beginPath(); g.moveTo(L0, Y(ft)); g.lineTo(W - 8, Y(ft)); g.stroke(); g.fillText(String(ft), 4, Y(ft) + 3); }
    const T = ctx.aeroTypes || {};
    for (const x of crossed) {
      const lo = x.a.lower ? x.a.lower.ft : 0, hi = x.a.upper ? x.a.upper.ft : top;
      if (lo > top) continue;
      const col = (T[x.a.type] || {}).color || '#888';
      g.fillStyle = col + '33'; g.strokeStyle = col; g.lineWidth = 1.2;
      g.fillRect(X(x.from), Y(hi), X(x.to) - X(x.from), Y(lo) - Y(hi)); g.strokeRect(X(x.from), Y(hi), X(x.to) - X(x.from), Y(lo) - Y(hi));
      const nm = x.a.name.slice(0, 18);
      if (g.measureText(nm).width < X(x.to) - X(x.from) - 4) { g.fillStyle = col; g.fillText(nm, X(x.from) + 3, Math.max(14, Y(hi) + 11)); }
    }
    g.strokeStyle = ZP_ROUTE_COLOR; g.lineWidth = 3;
    g.beginPath(); g.moveTo(X(0), Y(0)); g.lineTo(X(Math.min(total * 0.04, 2000)), Y(alt)); g.lineTo(X(total - Math.min(total * 0.04, 2000)), Y(alt)); g.lineTo(X(total), Y(0)); g.stroke();
    g.fillStyle = css.getPropertyValue('--muted');
    for (const leg of plan.legs) { g.fillRect(X(leg.cumM) - 0.5, B0, 1, 5); }
    g.fillText('0', L0, H - 6);
    g.textAlign = 'right'; g.fillText(PlanUnits.fmtDist(total, ctx.cfg.units.dist), W - 8, H - 6);
  });
  return cv;
}
