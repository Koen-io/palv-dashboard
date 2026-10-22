'use strict';

/* ============================================================
   Zoek & Plan — gereedschap: meetlint A→B, afstandsringen, zoekpatroon, orbit en actieradius, en
   "wie is er het snelst" naar een punt.
   ============================================================ */
// Every tool is a mode of the map (one at a time, the same buttons above the map and in the panel): with
// it on, a click on the map places what the tool makes. What has been placed stays until it is thrown
// away (bin on the map, or in the list "Op de kaart"), and is kept with the dashboard layout.
const ZP_PATTERNS = {
  ss: { name: 'Uitdijend vierkant (SS)', hint: 'Vanaf het datum, poten van S, S, 2S, 2S, 3S… telkens 90° gedraaid. Voor een klein gebied met een nauwkeurige laatst bekende positie.' },
  vs: { name: 'Sectorzoeken (VS)', hint: 'Drie gelijkzijdige driehoeken door het datum, 120° uit elkaar. Snel en nauwkeurig rond een goed bekend punt.' },
  cs: { name: 'Kruipende lijn (CS)', hint: 'Poten dwars op de lange as, opschuivend langs de as. Voor een langgerekt gebied, bv. langs een route of kustlijn.' },
  ps: { name: 'Parallelle banen (PS)', hint: 'Poten langs de lange as, opschuivend dwars erop. Voor een groot rechthoekig gebied.' },
};
// The tools, in the order of the buttons; `click` says what a click on the map does in that mode.
const ZP_TOOLS = {
  measure: { name: 'Meetlint', short: 'Meten', icon: 'route', key: 'M', color: '#ffe14d', click: 'Klik punt A en daarna punt B: kortste lijn met maatstreepjes, koers heen en terug en vliegtijd.' },
  rings: { name: 'Afstandsringen', short: 'Ringen', icon: 'radar', key: 'G', color: '#ffd65a', click: 'Klik waar het middelpunt van de ringen moet komen. Elke klik plaatst een nieuwe set.' },
  pattern: { name: 'Zoekpatroon', short: 'Zoeken', icon: 'target', key: 'Z', color: '#d18cff', click: 'Klik op het datum (laatst bekende positie): het patroon komt daar te liggen.' },
  orbit: { name: 'Orbit', short: 'Orbit', icon: 'refresh', key: 'O', color: '#4dd0e1', click: 'Klik op het doel: de orbit komt eromheen.' },
  reach: { name: 'Actieradius', short: 'Bereik', icon: 'wind', key: 'B', color: '#7bd88f', click: 'Klik op het vertrekpunt: je ziet hoe ver je komt met de brandstof aan boord, met wind.' },
};

function zpTools(ctx) {
  const { map, cfg } = ctx;
  const uid = () => Math.random().toString(36).slice(2, 9);
  // Placed objects, kept in the widget settings.
  cfg.tapes = Array.isArray(cfg.tapes) ? cfg.tapes : [];
  cfg.ringSets = Array.isArray(cfg.ringSets) ? cfg.ringSets : [];
  for (const r of cfg.ringSets) { r.id = r.id || uid(); r.at = r.at || Date.now(); }
  cfg.placed = cfg.placed || {}; // pattern / orbit / reach: { id, lat, lon, label, at }
  const T = { pattern: null, orbit: null, reach: null, first: null };
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const fam = () => getComputedStyle(document.body).fontFamily;
  const changed = () => { ctx.save(); rebuild(); ctx.emit('items'); };

  /* ---------- placing by clicking ---------- */
  let tapeLive = null, tapeOpen = null; // the tape whose point B is still to come
  ctx.on('mapclick', ({ latlng, handled }) => {
    const p = { lat: +latlng.lat.toFixed(6), lon: +latlng.lng.toFixed(6) };
    if (ctx.mode === 'measure') {
      handled.done = true;
      if (!tapeOpen) {
        if (cfg.tapes.length >= 8) cfg.tapes.shift();
        tapeOpen = { id: uid(), a: p, b: null, at: Date.now() };
        cfg.tapes.push(tapeOpen);
      } else { tapeOpen.b = p; tapeOpen = null; tapeLive = null; }
      changed();
    } else if (ctx.mode === 'rings') { handled.done = true; addRings(p); }
    else if (ctx.mode === 'pattern' || ctx.mode === 'orbit' || ctx.mode === 'reach') {
      handled.done = true;
      place(ctx.mode, p);
    }
  });
  map.on('mousemove', (e) => { if (ctx.mode === 'measure' && tapeOpen) { tapeLive = { lat: e.latlng.lat, lon: e.latlng.lng }; ctx.cv.request(); } });
  // Leaving the tape mode halfway: the unfinished tape goes.
  ctx.on('mode', (m) => { if (m !== 'measure' && tapeOpen) { cfg.tapes = cfg.tapes.filter((t) => t !== tapeOpen); tapeOpen = null; tapeLive = null; changed(); } });
  // The card of the tool chosen last stays open in the panel, also after it stops (Esc) or when the tool was
  // used from a point's card without becoming the active one; one card open at a time.
  let openKind = null;
  ctx.on('mode', (m) => { if (ZP_TOOLS[m]) openKind = m; });
  const reveal = (kind) => { openKind = kind; ctx.revealTool = kind; ctx.emit('tools'); };

  function place(kind, p) {
    cfg.placed[kind] = { id: uid(), lat: p.lat, lon: p.lon, label: p.label || null, at: Date.now() };
    changed();
    ctx.emit('placed', kind);
  }
  function addRings(p) {
    if (cfg.ringSets.length >= 8) cfg.ringSets.shift();
    cfg.ringSets.push({ id: uid(), lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), label: p.label || null, at: Date.now() });
    changed();
  }
  const remove = (kind, id) => {
    if (kind === 'measure') cfg.tapes = cfg.tapes.filter((t) => t.id !== id);
    else if (kind === 'rings') cfg.ringSets = cfg.ringSets.filter((r) => r.id !== id);
    else if (cfg.placed[kind] && cfg.placed[kind].id === id) delete cfg.placed[kind];
    changed();
  };

  /* ---------- tape A→B ---------- */
  const tickStep = (lenUnits, pxLen) => {
    const want = lenUnits / Math.max(2, pxLen / 55);
    return [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => s >= want) || 1000;
  };
  function drawTape(c, a, b, live, hot) {
    const { g } = c;
    const du = cfg.units.dist, unitM = PlanUnits.DIST[du].m;
    const len = PlanGeo.dist(a, b), lenU = len / unitM;
    const pa = c.P(a.lat, a.lon), pb = c.P(b.lat, b.lon), pxLen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    const path = PlanGeo.densify(a, b, Math.max(500, len / 60)).map((p) => c.P(p.lat, p.lon));
    g.lineCap = 'round';
    g.lineWidth = hot ? 9 : 6; g.strokeStyle = hot ? 'rgba(255,255,255,0.55)' : 'rgba(5,9,16,0.8)';
    g.beginPath(); path.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    g.lineWidth = 2.6; g.strokeStyle = '#ffe14d'; g.setLineDash(live ? [8, 6] : []);
    g.beginPath(); path.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    g.setLineDash([]);
    const step = tickStep(lenU, pxLen);
    const font = `700 ${(0.62 * rem()).toFixed(1)}px ${fam()}`;
    for (let k = 1; k * step < lenU; k += 1) {
      const f = (k * step) / lenU, p = PlanGeo.interp(a, b, f), q = c.P(p.lat, p.lon);
      const p2 = PlanGeo.interp(a, b, Math.min(1, f + 0.001)), q2 = c.P(p2.lat, p2.lon);
      const ang = Math.atan2(q2[1] - q[1], q2[0] - q[0]) + Math.PI / 2, major = k % 2 === 0 || pxLen / (lenU / step) > 90;
      const L1 = major ? 9 : 5;
      g.lineWidth = 2; g.strokeStyle = '#ffe14d';
      g.beginPath(); g.moveTo(q[0] - Math.cos(ang) * L1, q[1] - Math.sin(ang) * L1); g.lineTo(q[0] + Math.cos(ang) * L1, q[1] + Math.sin(ang) * L1); g.stroke();
      if (major) zpText(g, String(+(k * step).toFixed(2)).replace('.', ','), q[0] + Math.cos(ang) * 18, q[1] + Math.sin(ang) * 18, { font, color: '#ffe14d', align: 'center' });
    }
    for (const [p, l] of [[pa, 'A'], [pb, 'B']]) {
      g.beginPath(); g.arc(p[0], p[1], 7, 0, Math.PI * 2); g.fillStyle = '#ffe14d'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0a0f18'; g.stroke();
      zpText(g, l, p[0], p[1] + 0.5, { font: `800 ${(0.62 * rem()).toFixed(1)}px sans-serif`, color: '#0a0f18', halo: 'rgba(0,0,0,0)', align: 'center' });
    }
    const brg = PlanGeo.bearing(a, b), back = PlanGeo.bearing(b, a), mid = PlanGeo.interp(a, b, 0.5);
    const tas = ctx.tas();
    const tCalm = (len / 1852 / tas) * 60;
    const tWind = PlanPerf.directTime(a, b, tas, (la, lo, ms) => ctx.windAt(la, lo, ms, ctx.planning().altFt));
    const other = du === 'km' ? 'nm' : 'km';
    const lines = [
      { text: `${ctx.fmt.dist(len)}  ·  ${PlanUnits.fmtDist(len, other)}`, font: `800 ${(0.78 * rem()).toFixed(1)}px ${fam()}` },
      `Koers ${ctx.fmt.course(brg, mid.lat, mid.lon)} · terug ${ctx.fmt.course(back, mid.lat, mid.lon)}`,
      `${ctx.profile().name} ${Math.round(tas)} KTAS: ${ctx.fmt.dur(tCalm)} windstil`,
      tWind != null && Math.abs(tWind - tCalm) > 0.05 ? { text: `met wind: ${ctx.fmt.dur(tWind)}`, color: '#8fd3ff' } : null,
    ].filter(Boolean);
    zpTag(g, lines, pb[0] + 16, pb[1] + 26, { font: `600 ${(0.68 * rem()).toFixed(1)}px ${fam()}`, accent: '#ffe14d' });
  }
  ctx.cv.add(70, (c) => {
    for (const t of cfg.tapes) {
      if (t.b) drawTape(c, t.a, t.b, false, ctx.hot === t.id);
      else if (t === tapeOpen && tapeLive) drawTape(c, t.a, tapeLive, true);
      else { const p = c.P(t.a.lat, t.a.lon); c.g.beginPath(); c.g.arc(p[0], p[1], 7, 0, Math.PI * 2); c.g.fillStyle = '#ffe14d'; c.g.fill(); }
      const p = c.P(t.a.lat, t.a.lon);
      c.hit({ x: p[0], y: p[1], r: 9, kind: 'item', item: { kind: 'measure', id: t.id }, z: 4 });
    }
  });

  /* ---------- range rings ---------- */
  ctx.cv.add(20, (c) => {
    if (!cfg.ringSets.length || cfg.ringsOff) return;
    const { g } = c;
    const du = cfg.units.dist, unitM = PlanUnits.DIST[du].m;
    const step = (cfg.rings.stepNm || 5) * unitM, n = Math.min(40, cfg.rings.count || 5);
    const font = `700 ${(0.64 * rem()).toFixed(1)}px ${fam()}`;
    for (const r of cfg.ringSets) {
      const ctr = c.P(r.lat, r.lon), hot = ctx.hot === r.id;
      for (let k = 1; k <= n; k += 1) {
        const ring = PlanGeo.circle(r, k * step, 120).map((p) => c.P(p.lat, p.lon));
        g.strokeStyle = hot ? 'rgba(255,255,255,0.5)' : 'rgba(5,9,16,0.55)'; g.lineWidth = hot ? 5 : 3.4; g.setLineDash([]);
        g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
        g.strokeStyle = k % 5 === 0 ? 'rgba(255,214,90,0.95)' : 'rgba(255,214,90,0.7)'; g.lineWidth = k % 5 === 0 ? 2 : 1.3; g.setLineDash(k % 5 === 0 ? [] : [7, 5]);
        g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
        g.setLineDash([]);
        for (const brg of [0, 90]) {
          const lp = PlanGeo.dest(r, brg, k * step), q = c.P(lp.lat, lp.lon);
          if (c.inView(q, 0)) zpText(g, `${String(+(k * (cfg.rings.stepNm || 5)).toFixed(2)).replace('.', ',')} ${PlanUnits.DIST[du].name}`, q[0] + 4, q[1] - 7, { font, color: '#ffd65a' });
        }
      }
      if (cfg.compass !== false) {
        const R = c.pxPerM(r.lat) * step * n;
        const mv = cfg.units.north === 'true' ? 0 : ctx.mag(r.lat, r.lon);
        for (let d = 0; d < 360; d += 10) {
          const a = PlanGeo.rad(d + mv) - Math.PI / 2, L1 = d % 30 === 0 ? 12 : 6;
          g.strokeStyle = 'rgba(255,214,90,0.85)'; g.lineWidth = d % 30 === 0 ? 2 : 1;
          g.beginPath(); g.moveTo(ctr[0] + Math.cos(a) * R, ctr[1] + Math.sin(a) * R); g.lineTo(ctr[0] + Math.cos(a) * (R - L1), ctr[1] + Math.sin(a) * (R - L1)); g.stroke();
          if (d % 30 === 0 && R > 120) zpText(g, String(d / 10).padStart(2, '0'), ctr[0] + Math.cos(a) * (R - 22), ctr[1] + Math.sin(a) * (R - 22), { font, color: '#ffd65a', align: 'center' });
        }
      }
      g.beginPath(); g.arc(ctr[0], ctr[1], 4.5, 0, Math.PI * 2); g.fillStyle = '#ffd65a'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0a0f18'; g.stroke();
      c.hit({ x: ctr[0], y: ctr[1], r: 9, kind: 'item', item: { kind: 'rings', id: r.id }, z: 4 });
    }
  });

  /* ---------- search pattern ---------- */
  const pat = cfg.pattern || (cfg.pattern = { type: 'ss', spacingNm: 0.5, legs: 12, radiusNm: 2, lengthNm: 10, widthNm: 4, axis: 0, firstTrack: 0, right: true });
  function buildPattern() {
    const d = cfg.placed.pattern;
    if (!d) { T.pattern = null; return; }
    const nm = PlanUnits.DIST[cfg.units.dist].m;
    let pts;
    if (pat.type === 'ss') pts = PlanPerf.expandingSquare(d, { spacingM: pat.spacingNm * nm, legs: pat.legs, firstTrack: pat.firstTrack, right: pat.right });
    else if (pat.type === 'vs') pts = PlanPerf.sectorSearch(d, { radiusM: pat.radiusNm * nm, firstTrack: pat.firstTrack, right: pat.right });
    else pts = PlanPerf.ladder(d, { lengthM: pat.lengthNm * nm, widthM: pat.widthNm * nm, spacingM: pat.spacingNm * nm, axis: pat.axis, along: pat.type === 'ps', rightFirst: pat.right });
    const pl = ctx.planning();
    const sim = PlanPerf.planRoute({ points: pts, tasKt: ctx.tas(), flowKgh: pl.flowKgh, windAt: (la, lo, ms) => ctx.windAt(la, lo, ms, pl.altFt) });
    T.pattern = { pts, lengthM: sim.total.distM, timeMin: sim.total.timeMin, fuelKg: sim.total.fuelKg };
  }
  ctx.cv.add(55, (c) => {
    if (!T.pattern) return;
    const { g } = c, hot = cfg.placed.pattern && ctx.hot === cfg.placed.pattern.id;
    const p = T.pattern.pts.map((x) => c.P(x.lat, x.lon));
    g.lineWidth = hot ? 8 : 5; g.strokeStyle = hot ? 'rgba(255,255,255,0.5)' : 'rgba(5,9,16,0.6)'; g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke();
    g.lineWidth = 2.2; g.strokeStyle = '#d18cff'; g.setLineDash([9, 5]); g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke(); g.setLineDash([]);
    const font = `700 ${(0.6 * rem()).toFixed(1)}px ${fam()}`;
    p.forEach((q, i) => { if (i) { g.beginPath(); g.arc(q[0], q[1], 3.5, 0, Math.PI * 2); g.fillStyle = '#d18cff'; g.fill(); zpText(g, String(i), q[0] + 6, q[1] - 6, { font, color: '#e6c4ff' }); } });
    const d = c.P(cfg.placed.pattern.lat, cfg.placed.pattern.lon);
    g.beginPath(); g.arc(d[0], d[1], 6, 0, Math.PI * 2); g.fillStyle = '#d18cff'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0a0f18'; g.stroke();
    c.hit({ x: d[0], y: d[1], r: 9, kind: 'item', item: { kind: 'pattern', id: cfg.placed.pattern.id }, z: 4 });
  });

  /* ---------- orbit ---------- */
  const orb = cfg.orbit || (cfg.orbit = { radiusNm: 0.4, tas: null, bank: 30, show: 'circle' });
  function buildOrbit() {
    const d = cfg.placed.orbit;
    if (!d) { T.orbit = null; return; }
    const pl = ctx.planning();
    const tas = orb.tas || Math.round(ctx.tas() * 0.7);
    const wnd = ctx.windAt(d.lat, d.lon, Date.now(), pl.altFt);
    const r = orb.radiusNm * PlanUnits.DIST[cfg.units.dist].m;
    const o = PlanPerf.orbit({ tasKt: tas, radiusM: r, windKt: wnd ? wnd.speedKt : 0 });
    const drift = PlanPerf.driftOrbit(d, { tasKt: tas, bankDeg: orb.bank, windFrom: wnd ? wnd.dirDeg : 0, windKt: wnd ? wnd.speedKt : 0, turns: 3 });
    T.orbit = { center: d, tas, wnd, o, drift, r };
  }
  ctx.cv.add(50, (c) => {
    if (!T.orbit) return;
    const { g } = c, hot = ctx.hot === cfg.placed.orbit.id;
    const ring = PlanGeo.circle(T.orbit.center, T.orbit.r, 90).map((p) => c.P(p.lat, p.lon));
    g.lineWidth = hot ? 5 : 2.4; g.strokeStyle = '#4dd0e1'; g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    if (orb.show === 'drift' || orb.show === 'both') {
      const d = T.orbit.drift.points.map((p) => c.P(p.lat, p.lon));
      g.lineWidth = 1.6; g.strokeStyle = 'rgba(77,208,225,0.75)'; g.setLineDash([4, 4]); g.beginPath(); d.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.setLineDash([]);
    }
    const q = c.P(T.orbit.center.lat, T.orbit.center.lon);
    g.beginPath(); g.arc(q[0], q[1], 5, 0, Math.PI * 2); g.fillStyle = '#4dd0e1'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0a0f18'; g.stroke();
    c.hit({ x: q[0], y: q[1], r: 9, kind: 'item', item: { kind: 'orbit', id: cfg.placed.orbit.id }, z: 4 });
  });

  /* ---------- radius of action with wind ---------- */
  const rch = cfg.reach || (cfg.reach = { fuelKg: null, roundTrip: true, oneWay: true });
  function buildReach() {
    const d = cfg.placed.reach;
    if (!d) { T.reach = null; return; }
    const pl = ctx.planning();
    const fuel = (rch.fuelKg != null ? rch.fuelKg : pl.fuelKg) - pl.taxiKg - pl.reserveKg;
    const minutes = Math.max(0, (fuel / pl.flowKgh) * 60);
    const wnd = ctx.windAt(d.lat, d.lon, Date.now(), pl.altFt);
    const tas = ctx.tas();
    T.reach = { center: d, minutes, wnd, tas, rt: PlanPerf.reach(d, { tasKt: tas, minutes, wind: wnd, roundTrip: true }), ow: PlanPerf.reach(d, { tasKt: tas, minutes, wind: wnd, roundTrip: false }) };
  }
  ctx.cv.add(15, (c) => {
    if (!T.reach) return;
    const { g } = c, hot = ctx.hot === cfg.placed.reach.id;
    const font = `700 ${(0.64 * rem()).toFixed(1)}px ${fam()}`;
    const poly = (list, color, dash, fill, label) => {
      const p = list.map((r) => c.P(r.point.lat, r.point.lon));
      g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      g.lineWidth = hot ? 4.5 : 2.2; g.strokeStyle = color; g.setLineDash(dash); g.stroke(); g.setLineDash([]);
      const top = p.reduce((a, b) => (b[1] < a[1] ? b : a));
      zpText(g, label, top[0], top[1] - 10, { font, color, align: 'center' });
    };
    if (rch.oneWay) poly(T.reach.ow, '#7bd88f', [3, 5], null, `Enkele reis · ${ctx.fmt.dur(T.reach.minutes)}`);
    if (rch.roundTrip) poly(T.reach.rt, '#7bd88f', [], 'rgba(123,216,143,0.08)', 'Actieradius heen en terug');
    const q = c.P(T.reach.center.lat, T.reach.center.lon);
    g.beginPath(); g.arc(q[0], q[1], 5, 0, Math.PI * 2); g.fillStyle = '#7bd88f'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0a0f18'; g.stroke();
    c.hit({ x: q[0], y: q[1], r: 9, kind: 'item', item: { kind: 'reach', id: cfg.placed.reach.id }, z: 4 });
  });

  /* ---------- who gets there first ---------- */
  // With or without the wind at flying height, as chosen with the switch; both times are worked out, so
  // the list can say what the wind does.
  function buildFirst() {
    const d = ctx.selected;
    if (!d) { T.first = null; return; }
    const out = [];
    const profiles = ctx.profiles();
    const snap = trafficFeed.snap;
    const useWind = cfg.firstWind !== false;
    const own = cfg.fleet.groups || ['police'];
    // The wind on the whole line at the height it is flown, at the time each piece is passed.
    const leg = (from, tas, alt, startMin) => {
      const r = PlanPerf.directLeg(from, d, tas, (la, lo, ms) => ctx.windAt(la, lo, ms, alt), Date.now() + startMin * 60000);
      const add = (m) => (m == null ? null : m + startMin);
      return { calm: add(r.calm), windy: add(r.minutes), minutes: add(useWind ? r.minutes : r.calm), wind: r.wind, head: r.head, cross: r.cross, gs: r.gs, known: r.known, course: r.course, alt };
    };
    for (const a of (snap && snap.ac) || []) {
      if (!a.group || !own.includes(a.group) || a.lat == null || a.alt === 'ground') continue;
      const nm = UNIT_NAMES(a.hex) || {};
      const prof = /139/.test(nm.type || a.type || '') ? profiles.aw139 : /135|EC35/.test(nm.type || a.type || '') ? profiles.ec135 : null;
      const pl = prof ? PlanProfiles.planning(prof) : null;
      const alt = typeof a.alt === 'number' ? a.alt : 1000;
      const tas = pl ? PlanPerf.tasFromIas(pl.ias, alt) : Math.max(90, a.gs || 0);
      out.push({ kind: 'air', name: a.flight || a.reg || nm.reg || a.hex.toUpperCase(), sub: `${nm.reg || a.reg || ''} ${nm.type || a.type || ''} · in de lucht · ${Math.round(tas)} KTAS`, from: { lat: a.lat, lon: a.lon }, tas, dist: PlanGeo.dist(a, d), ...leg({ lat: a.lat, lon: a.lon }, tas, alt, 0) });
    }
    for (const b of ctx.bases()) {
      for (const id of ['ec135', 'aw139']) {
        const pl = PlanProfiles.planning(profiles[id]);
        const tas = PlanPerf.tasFromIas(pl.ias, pl.altFt);
        const start = b.startMin || 0;
        out.push({ kind: 'base', name: `${profiles[id].name} vanaf ${b.name}`, sub: `+${start} min opstarten · ${Math.round(tas)} KTAS`, from: b, tas, dist: PlanGeo.dist(b, d), ...leg(b, tas, pl.altFt, start) });
      }
    }
    out.sort((x, y) => (x.minutes ?? 1e9) - (y.minutes ?? 1e9));
    T.first = { target: d, list: out, useWind };
  }
  ctx.cv.add(45, (c) => {
    if (!T.first || !cfg.firstShow) return;
    const { g } = c;
    const font = `700 ${(0.62 * rem()).toFixed(1)}px ${fam()}`;
    const t = c.P(T.first.target.lat, T.first.target.lon);
    T.first.list.slice(0, 5).forEach((r, i) => {
      const f = c.P(r.from.lat, r.from.lon);
      g.lineWidth = i === 0 ? 2.6 : 1.4; g.strokeStyle = i === 0 ? '#3ecf6e' : 'rgba(200,214,232,0.6)'; g.setLineDash(r.kind === 'base' ? [6, 5] : []);
      g.beginPath(); g.moveTo(f[0], f[1]); g.lineTo(t[0], t[1]); g.stroke(); g.setLineDash([]);
      const m = [(f[0] + t[0]) / 2, (f[1] + t[1]) / 2];
      if (r.minutes != null) zpText(g, `${i + 1}. ${ctx.fmt.dur(r.minutes)}`, m[0], m[1] - 8, { font, color: i === 0 ? '#3ecf6e' : '#c6d4e8', align: 'center' });
    });
  });

  const rebuild = () => { buildPattern(); buildOrbit(); buildReach(); buildFirst(); ctx.cv.request(); ctx.emit('tools'); ctx.emit('first'); };
  for (const ev of ['select', 'profile', 'units', 'wind', 'ready']) ctx.on(ev, rebuild);
  ctx.timers.push(setInterval(() => { if (cfg.firstShow || ctx.cfg.sideTab === 'fleet') { buildFirst(); ctx.cv.request(); ctx.emit('first'); } }, 5000));

  /* ---------- what is on the map, for the list and the bins ---------- */
  const fmtAt = (ms) => ctx.fmt.time(ms);
  function items() {
    const out = [];
    for (const t of cfg.tapes) {
      if (!t.b) continue;
      out.push({ id: t.id, kind: 'measure', at: t.at, label: `Meetlint ${ctx.fmt.dist(PlanGeo.dist(t.a, t.b))}`, sub: `${ctx.fmt.course(PlanGeo.bearing(t.a, t.b), t.a.lat, t.a.lon)} · ${fmtAt(t.at)}`, anchor: t.b, points: [t.a, t.b] });
    }
    for (const r of cfg.ringSets) out.push({ id: r.id, kind: 'rings', at: r.at, label: `Ringen${r.label ? ' ' + r.label : ''}`, sub: `${cfg.rings.count || 5} × ${String(cfg.rings.stepNm || 5).replace('.', ',')} ${PlanUnits.DIST[cfg.units.dist].name} · ${fmtAt(r.at)}`, anchor: r, points: [PlanGeo.dest(r, 0, (cfg.rings.stepNm || 5) * (cfg.rings.count || 5) * PlanUnits.DIST[cfg.units.dist].m), PlanGeo.dest(r, 180, (cfg.rings.stepNm || 5) * (cfg.rings.count || 5) * PlanUnits.DIST[cfg.units.dist].m)] });
    if (cfg.placed.pattern && T.pattern) out.push({ id: cfg.placed.pattern.id, kind: 'pattern', at: cfg.placed.pattern.at, label: ZP_PATTERNS[pat.type].name, sub: `${ctx.fmt.dist(T.pattern.lengthM)} · ${ctx.fmt.dur(T.pattern.timeMin)} · ${fmtAt(cfg.placed.pattern.at)}`, anchor: cfg.placed.pattern, points: T.pattern.pts });
    if (cfg.placed.orbit && T.orbit) out.push({ id: cfg.placed.orbit.id, kind: 'orbit', at: cfg.placed.orbit.at, label: `Orbit ${ctx.fmt.dist(T.orbit.r)}`, sub: `${Math.round(T.orbit.o.bankCalm)}° helling · ${fmtAt(cfg.placed.orbit.at)}`, anchor: cfg.placed.orbit, points: [PlanGeo.dest(T.orbit.center, 0, T.orbit.r * 1.5), PlanGeo.dest(T.orbit.center, 180, T.orbit.r * 1.5)] });
    if (cfg.placed.reach && T.reach) out.push({ id: cfg.placed.reach.id, kind: 'reach', at: cfg.placed.reach.at, label: 'Actieradius', sub: `${ctx.fmt.dur(T.reach.minutes)} vliegtijd · ${fmtAt(cfg.placed.reach.at)}`, anchor: cfg.placed.reach, points: T.reach.ow.map((r) => r.point) });
    return out.map((it) => ({ ...it, tool: ZP_TOOLS[it.kind], remove: () => remove(it.kind, it.id), restore: snapshot(it.kind, it.id) }));
  }
  // To bring something back right after it was thrown away.
  function snapshot(kind, id) {
    const copy = kind === 'measure' ? cfg.tapes.find((t) => t.id === id) : kind === 'rings' ? cfg.ringSets.find((r) => r.id === id) : cfg.placed[kind];
    const data = copy && JSON.parse(JSON.stringify(copy));
    return () => {
      if (!data) return;
      if (kind === 'measure') cfg.tapes.push(data); else if (kind === 'rings') cfg.ringSets.push(data); else cfg.placed[kind] = data;
      changed();
    };
  }

  /* ---------- panel ---------- */
  // One card per tool; the active one is open with what a click does and its settings, the others show
  // how many of theirs are on the map.
  function panel() {
    const nmName = PlanUnits.DIST[cfg.units.dist].name;
    const set = (obj, k) => (v) => { obj[k] = v; changed(); };
    const list = items();
    const card = (kind, body) => {
      const tl = ZP_TOOLS[kind], on = ctx.mode === kind, open = on || openKind === kind, mine = list.filter((x) => x.kind === kind);
      const kids = open ? body().filter(Boolean) : [];
      return h('div', { class: 'zp-tool' + (on ? ' on' : open ? ' open' : ''), style: `--zp-c:${tl.color}`, 'data-kind': kind },
        h('button', { class: 'zp-tool-head', title: on ? 'Klik om dit gereedschap te stoppen en in te klappen (Esc stopt alleen)' : `Kies ${tl.name.toLowerCase()} (${tl.key}): daarna klikken op de kaart`, onclick: () => { if (on) { openKind = null; ctx.setMode('select'); ctx.emit('tools'); } else ctx.setMode(kind); } },
          icon(tl.icon), h('b', {}, tl.name), mine.length ? h('span', { class: 'zp-count' }, String(mine.length)) : null, h('span', { class: 'zp-tool-state' }, on ? 'Actief' : 'Kiezen')),
        on ? h('div', { class: 'zp-tool-body' }, h('p', { class: 'zp-tool-click' }, icon('info'), tl.click), ...kids) : open && kids.length ? h('div', { class: 'zp-tool-body' }, ...kids) : null,
        mine.length ? h('div', { class: 'zp-tool-items' }, mine.map((it) => h('div', { class: 'zp-tool-item' },
          h('button', { class: 'zp-linkbtn', title: 'Toon op de kaart', onclick: () => ctx.focusItem(it) }, h('b', {}, it.label), h('small', {}, it.sub)),
          h('button', { class: 'w-tool zp-bin', title: 'Verwijderen', onclick: () => ctx.removeItem(it) }, icon('trash'))))) : null);
    };
    const measure = card('measure', () => []);
    const rings = card('rings', () => [h('div', { class: 'zp-grid4' },
      field('Stap', zpNum(cfg.rings.stepNm, set(cfg.rings, 'stepNm'), { step: 0.5, min: 0.1 }), nmName),
      field('Aantal', zpNum(cfg.rings.count, set(cfg.rings, 'count'), { step: 1, min: 1, max: 40 }), 'ringen'),
      field('Kompasroos', segmented([{ value: 'on', label: 'Aan' }, { value: 'off', label: 'Uit' }], cfg.compass === false ? 'off' : 'on', (v) => { cfg.compass = v === 'on'; changed(); })))]);
    const pattern = card('pattern', () => {
      const grid = h('div', { class: 'zp-grid4' });
      if (pat.type !== 'vs') grid.append(field('Baanafstand S', zpNum(pat.spacingNm, set(pat, 'spacingNm'), { step: 0.1, min: 0.05 }), nmName));
      if (pat.type === 'ss') grid.append(field('Poten', zpNum(pat.legs, set(pat, 'legs'), { step: 1, min: 2, max: 60 })));
      if (pat.type === 'vs') grid.append(field('Straal', zpNum(pat.radiusNm, set(pat, 'radiusNm'), { step: 0.5, min: 0.1 }), nmName));
      if (pat.type === 'cs' || pat.type === 'ps') grid.append(field('Lengte', zpNum(pat.lengthNm, set(pat, 'lengthNm'), { step: 1, min: 0.5 }), nmName), field('Breedte', zpNum(pat.widthNm, set(pat, 'widthNm'), { step: 0.5, min: 0.2 }), nmName), field('Lange as', zpNum(pat.axis, set(pat, 'axis'), { step: 5, min: 0, max: 359 }), '° waar'));
      if (pat.type === 'ss' || pat.type === 'vs') grid.append(field('Eerste koers', zpNum(pat.firstTrack, set(pat, 'firstTrack'), { step: 5, min: 0, max: 359 }), '° waar (vaak met de wind mee)'));
      grid.append(field('Draairichting', segmented([{ value: 'r', label: 'Rechts' }, { value: 'l', label: 'Links' }], pat.right ? 'r' : 'l', (v) => { pat.right = v === 'r'; changed(); })));
      return [field('Patroon', zpSelect(Object.entries(ZP_PATTERNS).map(([k, d]) => ({ value: k, label: d.name })), pat.type, set(pat, 'type')), ZP_PATTERNS[pat.type].hint), grid,
        T.pattern ? h('div', { class: 'zp-totals' }, zpRow('Lengte', ctx.fmt.dist(T.pattern.lengthM)), zpRow('Duur', `${ctx.fmt.dur(T.pattern.timeMin, true)} bij ${Math.round(ctx.tas())} KTAS`), zpRow('Brandstof', ctx.fmt.fuel(T.pattern.fuelKg))) : null,
        T.pattern ? zpBtn('Als route gebruiken', () => ctx.parts.zpRoute.setPoints(T.pattern.pts, { name: ZP_PATTERNS[pat.type].name }), { icon: 'route', primary: true }) : null];
    });
    const orbit = card('orbit', () => {
      const out = [h('div', { class: 'zp-grid4' },
        field('Straal', zpNum(orb.radiusNm, set(orb, 'radiusNm'), { step: 0.05, min: 0.05 }), nmName),
        field('TAS', zpNum(orb.tas || '', set(orb, 'tas'), { step: 5, placeholder: String(Math.round(ctx.tas() * 0.7)) }), 'kt'),
        field('Helling (drift)', zpNum(orb.bank, set(orb, 'bank'), { step: 5, min: 5, max: 45 }), '° voor de baan met vaste helling'),
        field('Tonen', zpSelect([{ value: 'circle', label: 'Cirkel over de grond' }, { value: 'drift', label: 'Baan bij vaste helling' }, { value: 'both', label: 'Beide' }], orb.show, set(orb, 'show'))))];
      if (T.orbit) {
        const o = T.orbit.o;
        out.push(h('div', { class: 'zp-totals' },
          zpRow('Wind', T.orbit.wnd ? ctx.fmt.wind(T.orbit.wnd.dirDeg, T.orbit.wnd.speedKt) : 'windstil gerekend (nog geen wind bekend)'),
          zpRow('Helling windstil', `${Math.round(o.bankCalm)}°`),
          zpRow('Helling met wind', `${Math.round(o.bankMin)}° (tegenwind) tot ${Math.round(o.bankMax)}° (rugwind)`, 'Om de cirkel over de grond vast te houden: steilst met de wind mee, waar de grondsnelheid het hoogst is'),
          zpRow('GS', `${Math.round(o.gsMin)}–${Math.round(o.gsMax)} kt`),
          zpRow('Tijd per rondje', ctx.fmt.dur(o.minutes, true)),
          zpRow(`Straal bij ${orb.bank}°`, ctx.fmt.dist(T.orbit.drift.radiusM))));
      }
      return out;
    });
    const reach = card('reach', () => {
      const pl = ctx.planning();
      const out = [h('div', { class: 'zp-grid4' },
        field('Brandstof', zpNum(rch.fuelKg != null ? Math.round(PlanUnits.fuelIn(rch.fuelKg, cfg.units.fuel, pl.density)) : '', (v) => { rch.fuelKg = v == null ? null : PlanUnits.fuelKg(v, cfg.units.fuel, pl.density); changed(); }, { step: 10, placeholder: String(Math.round(PlanUnits.fuelIn(pl.fuelKg, cfg.units.fuel, pl.density))) }), `${PlanUnits.FUEL[cfg.units.fuel].name} aan boord`)),
        // Two different lines, so one choice: "heen en terug" is how far out you can go and still get back to the
        // start; "enkele reis" is how far you get when you land somewhere else (about twice as far).
        field('Tonen', segmented([{ value: 'rt', label: 'Heen en terug' }, { value: 'ow', label: 'Enkele reis' }, { value: 'both', label: 'Beide' }],
          rch.roundTrip && rch.oneWay ? 'both' : rch.oneWay ? 'ow' : 'rt', (v) => { rch.roundTrip = v !== 'ow'; rch.oneWay = v !== 'rt'; changed(); }),
        h('span', {}, h('b', {}, 'Heen en terug'), ' (doorgetrokken lijn): zo ver kun je weg en nog terug naar het vertrekpunt. ', h('b', {}, 'Enkele reis'), ' (stippellijn): zo ver kom je als je ergens anders landt, ongeveer twee keer zo ver.'))];
      if (T.reach) {
        out.push(h('div', { class: 'zp-totals' },
          zpRow('Vliegtijd beschikbaar', ctx.fmt.dur(T.reach.minutes, true), `Brandstof min opstart/taxi (${ctx.fmt.fuel(pl.taxiKg)}) en eindreserve (${ctx.fmt.fuel(pl.reserveKg)}), bij ${Math.round(pl.flowKgh)} kg/u`),
          zpRow('Wind', T.reach.wnd ? ctx.fmt.wind(T.reach.wnd.dirDeg, T.reach.wnd.speedKt) : 'windstil gerekend (nog geen wind bekend)'),
          zpRow('Max. actieradius', ctx.fmt.dist(Math.max(...T.reach.rt.map((r) => r.m)))),
          zpRow('Min. actieradius', ctx.fmt.dist(Math.min(...T.reach.rt.map((r) => r.m))))));
      }
      return out;
    });
    return h('div', { class: 'zp-panel' }, h('p', { class: 'zp-hint' }, 'Kies een gereedschap en klik op de kaart. Er is steeds één gereedschap actief; Esc of nog een klik op de knop stopt het. Wat je plaatst blijft staan tot je het weggooit.'), measure, rings, pattern, orbit, reach);
  }

  // Who gets there first, for the fleet panel. Per unit the wind on its line (mean over the whole line, at
  // its height), what that means along the line (head- or tailwind, crosswind), the groundspeed, and the
  // time with and without wind, so the switch shows plainly what it changes.
  function firstPanel() {
    if (!ctx.selected) return h('p', { class: 'zp-hint warn' }, 'Klik een punt op de kaart (of zoek een adres): hier zie je dan welk toestel er het snelst kan zijn.');
    if (!T.first) buildFirst();
    const useWind = cfg.firstWind !== false;
    const list = T.first.list;
    const busy = ctx.windBusy();
    const known = list.length ? Math.min(...list.map((r) => r.known)) : 1;
    const status = known >= 1 ? 'Wind op vlieghoogte (Open-Meteo), langs de hele lijn en op het moment dat je er bent.'
      : busy ? 'Wind ophalen bij Open-Meteo… de tijden worden zo bijgewerkt.'
      : known > 0 ? 'Wind nog niet overal bekend: waar hij ontbreekt is windstil gerekend.'
      : 'Wind nu niet beschikbaar (Open-Meteo onbereikbaar of tegoed op): windstil gerekend. Over twee minuten opnieuw.';
    const kt = (v) => ctx.fmt.windSpeed(Math.abs(v));
    // The difference as the two shown times differ (both rounded to the minute), "< 1 min" when they round the same.
    const mins = (r) => { const d = Math.abs(Math.round(r.windy) - Math.round(r.calm)); return d < 1 ? '< 1 min' : `${d} min`; };
    // The wind block under each unit: the wind itself, what it does on this line, and the time it costs or saves.
    const windBlock = (r) => {
      if (!(r.known > 0)) return h('div', { class: 'zp-first-wind none' }, h('span', {}, busy ? 'Wind ophalen…' : 'Wind onbekend: windstil gerekend'));
      const w = r.wind;
      const along = r.head == null ? null : Math.abs(r.head) < 0.5 ? 'geen tegen- of meewind' : `${kt(r.head)} ${r.head > 0 ? 'tegenwind' : 'meewind'}`;
      const side = r.cross != null && Math.abs(r.cross) >= 3 ? `${kt(r.cross)} zijwind van ${r.cross > 0 ? 'rechts' : 'links'}` : null;
      let effect = null;
      if (r.windy == null) effect = h('span', { class: 'warn' }, 'Wind te sterk om deze koers te houden');
      else {
        const diff = r.windy - r.calm;
        effect = h('span', {}, `${useWind ? 'zonder wind' : 'met wind'} ${ctx.fmt.dur(useWind ? r.calm : r.windy)} · `, h('b', { class: Math.abs(diff) < 0.5 ? '' : diff > 0 ? 'slower' : 'faster' }, Math.abs(diff) < 0.5 ? 'wind maakt geen verschil' : `wind ${diff > 0 ? 'kost' : 'scheelt'} ${mins(r)}`));
      }
      return h('div', { class: 'zp-first-wind' + (useWind ? ' on' : '') },
        h('span', { class: 'zp-first-wdir' }, w ? h('i', { style: `transform: rotate(${Math.round(w.dirDeg + 180)}deg)`, title: 'Waar de wind naartoe waait' }, '↑') : null, h('b', {}, w ? ctx.fmt.wind(w.dirDeg, w.speedKt) : '—'), ` op ${ctx.fmt.alt(r.alt)}${r.known < 1 ? ' (deels bekend)' : ''}`),
        h('span', {}, [along, side, r.gs ? `GS ${Math.round(r.gs)} kt` : null].filter(Boolean).join(' · ')),
        effect);
    };
    return h('div', { class: 'zp-sec open' },
      h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Wie is er het snelst?'), switchTool('LIJNEN', 'Lijnen naar het doel op de kaart tonen', () => cfg.firstShow, () => { cfg.firstShow = !cfg.firstShow; ctx.save(); ctx.cv.request(); })),
      h('div', { class: 'zp-windswitch' + (useWind ? ' on' : '') },
        switchTool('WIND MEEREKENEN', 'Wind op vlieghoogte meerekenen of windstil rekenen', () => cfg.firstWind !== false, () => { cfg.firstWind = cfg.firstWind === false; ctx.save(); buildFirst(); ctx.cv.request(); ctx.emit('first'); }),
        h('span', {}, useWind ? status : 'Uit: tijden windstil gerekend, alleen afstand en snelheid. De wind staat er ter vergelijking onder.')),
      h('p', { class: 'zp-hint' }, 'Naar ', h('b', {}, ctx.selected.label || ctx.fmt.coord(ctx.selected.lat, ctx.selected.lon)), ': rechtstreeks, op de planningssnelheid van het profiel. Vanaf de basis met de opstarttijd erbij.'),
      h('div', { class: 'zp-first' }, list.map((r, i) => h('div', { class: 'zp-first-row' + (i === 0 ? ' best' : '') },
        h('span', { class: 'zp-first-n' }, String(i + 1)),
        h('div', {}, h('b', {}, r.name), h('small', {}, r.sub)),
        h('div', { class: 'zp-first-t' }, h('b', {}, r.minutes == null ? '—' : ctx.fmt.dur(r.minutes)), h('small', {}, `${ctx.fmt.dist(r.dist)} · ETA ${r.minutes == null ? '—' : ctx.fmt.time(Date.now() + r.minutes * 60000)}`), h('small', {}, useWind && r.known > 0 ? 'met wind' : 'windstil')),
        windBlock(r)))));
  }

  return { panel, firstPanel, addRings, place, reveal, items, remove, state: T, setTape: (a) => { if (cfg.tapes.length >= 8) cfg.tapes.shift(); tapeOpen = { id: uid(), a, b: null, at: Date.now() }; cfg.tapes.push(tapeOpen); changed(); } };
}
