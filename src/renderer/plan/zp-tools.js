'use strict';

/* ============================================================
   Zoek & Plan — gereedschap: meetlint A→B, afstandsringen, zoekpatronen, orbit, actieradius met wind
   en "wie is er het snelst" naar een punt.
   ============================================================ */
const ZP_PATTERNS = {
  ss: { name: 'Uitdijend vierkant (SS)', hint: 'Vanaf het datum, poten van S, S, 2S, 2S, 3S… telkens 90° gedraaid. Voor een klein gebied met een nauwkeurige laatst bekende positie.' },
  vs: { name: 'Sectorzoeken (VS)', hint: 'Drie gelijkzijdige driehoeken door het datum, 120° uit elkaar. Snel en nauwkeurig rond een goed bekend punt.' },
  cs: { name: 'Kruipende lijn (CS)', hint: 'Poten dwars op de lange as, opschuivend langs de as. Voor een langgerekt gebied, bv. langs een route of kustlijn.' },
  ps: { name: 'Parallelle banen (PS)', hint: 'Poten langs de lange as, opschuivend dwars erop. Voor een groot rechthoekig gebied.' },
};

function zpTools(ctx) {
  const { map, cfg } = ctx;
  const T = { tape: null, rings: cfg.ringSets || [], pattern: null, orbit: null, reach: null, first: null };
  cfg.ringSets = T.rings;
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const fam = () => getComputedStyle(document.body).fontFamily;

  /* ---------- tape A→B ---------- */
  let tapeLive = null;
  ctx.on('mapclick', ({ latlng, handled }) => {
    if (ctx.mode === 'measure') {
      handled.done = true;
      const p = { lat: latlng.lat, lon: latlng.lng };
      if (!T.tape || T.tape.b) T.tape = { a: p, b: null };
      else T.tape.b = p;
      tapeLive = null;
      ctx.cv.request();
      ctx.emit('tools');
    } else if (ctx.mode === 'rings') {
      handled.done = true;
      addRings({ lat: latlng.lat, lon: latlng.lng });
    }
  });
  map.on('mousemove', (e) => { if (ctx.mode === 'measure' && T.tape && !T.tape.b) { tapeLive = { lat: e.latlng.lat, lon: e.latlng.lng }; ctx.cv.request(); } });

  // Tick spacing on the tape for its length in the chosen unit.
  const tickStep = (lenUnits, pxLen) => {
    const want = lenUnits / Math.max(2, pxLen / 55);
    return [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => s >= want) || 1000;
  };
  function drawTape(c, a, b, live) {
    const { g } = c;
    const du = cfg.units.dist, unitM = PlanUnits.DIST[du].m;
    const len = PlanGeo.dist(a, b), lenU = len / unitM;
    const pa = c.P(a.lat, a.lon), pb = c.P(b.lat, b.lon), pxLen = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    // The line itself, as the great circle it is.
    const path = PlanGeo.densify(a, b, Math.max(500, len / 60)).map((p) => c.P(p.lat, p.lon));
    g.lineCap = 'round';
    g.lineWidth = 6; g.strokeStyle = 'rgba(5,9,16,0.8)';
    g.beginPath(); path.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    g.lineWidth = 2.6; g.strokeStyle = '#ffe14d'; g.setLineDash(live ? [8, 6] : []);
    g.beginPath(); path.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    g.setLineDash([]);
    // Ticks at round distances, labelled at every other one, square to the line.
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
    // The card at B: distance in both units, course both ways, time with and without wind.
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
    const box = zpTag(g, lines, pb[0] + 14, pb[1] - 4, { font: `600 ${(0.68 * rem()).toFixed(1)}px ${fam()}`, accent: '#ffe14d' });
    if (!live) c.hit({ x: box.x + box.w - 8, y: box.y + 8, r: 10, kind: 'tape-close', z: 9 });
    if (!live) { g.font = `700 ${(0.75 * rem()).toFixed(1)}px sans-serif`; g.fillStyle = '#8ea2bf'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('×', box.x + box.w - 8, box.y + 8); }
  }
  ctx.cv.add(70, (c) => {
    if (T.tape && (T.tape.b || tapeLive)) drawTape(c, T.tape.a, T.tape.b || tapeLive, !T.tape.b);
    else if (T.tape && T.tape.a) { const p = c.P(T.tape.a.lat, T.tape.a.lon); c.g.beginPath(); c.g.arc(p[0], p[1], 7, 0, Math.PI * 2); c.g.fillStyle = '#ffe14d'; c.g.fill(); }
  });

  /* ---------- range rings ---------- */
  function addRings(p) {
    if (T.rings.length >= 6) T.rings.shift();
    T.rings.push({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), label: p.label || null });
    ctx.save(); ctx.cv.request(); ctx.emit('tools');
  }
  const clearRings = () => { T.rings.splice(0); ctx.save(); ctx.cv.request(); ctx.emit('tools'); };
  ctx.cv.add(20, (c) => {
    if (!T.rings.length || cfg.ringsOff) return;
    const { g } = c;
    const du = cfg.units.dist, unitM = PlanUnits.DIST[du].m;
    const step = (cfg.rings.stepNm || 5) * unitM, n = Math.min(40, cfg.rings.count || 5);
    const font = `700 ${(0.64 * rem()).toFixed(1)}px ${fam()}`;
    T.rings.forEach((r, idx) => {
      const ctr = c.P(r.lat, r.lon);
      g.lineWidth = 1.6;
      for (let k = 1; k <= n; k += 1) {
        const ring = PlanGeo.circle(r, k * step, 120).map((p) => c.P(p.lat, p.lon));
        g.strokeStyle = 'rgba(5,9,16,0.55)'; g.lineWidth = 3.4; g.setLineDash([]);
        g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
        g.strokeStyle = k % 5 === 0 ? 'rgba(255,214,90,0.95)' : 'rgba(255,214,90,0.7)'; g.lineWidth = k % 5 === 0 ? 2 : 1.3; g.setLineDash(k % 5 === 0 ? [] : [7, 5]);
        g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
        g.setLineDash([]);
        // Labels north and east of the centre.
        for (const brg of [0, 90]) {
          const lp = PlanGeo.dest(r, brg, k * step), q = c.P(lp.lat, lp.lon);
          if (c.inView(q, 0)) zpText(g, `${String(+(k * (cfg.rings.stepNm || 5)).toFixed(2)).replace('.', ',')} ${PlanUnits.DIST[du].name}`, q[0] + 4, q[1] - 7, { font, color: '#ffd65a' });
        }
      }
      // Compass rose: a tick every 10°, the cardinal and intercardinal courses labelled (magnetic or true).
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
      c.hit({ x: ctr[0], y: ctr[1], r: 9, kind: 'rings', item: { idx }, z: 4 });
    });
  });

  /* ---------- search patterns ---------- */
  const pat = cfg.pattern || (cfg.pattern = { type: 'ss', spacingNm: 0.5, legs: 12, radiusNm: 2, lengthNm: 10, widthNm: 4, axis: 0, firstTrack: 0, right: true });
  function buildPattern() {
    const d = ctx.selected;
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
    const { g } = c;
    const p = T.pattern.pts.map((x) => c.P(x.lat, x.lon));
    g.lineWidth = 5; g.strokeStyle = 'rgba(5,9,16,0.6)'; g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke();
    g.lineWidth = 2.2; g.strokeStyle = '#d18cff'; g.setLineDash([9, 5]); g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke(); g.setLineDash([]);
    const font = `700 ${(0.6 * rem()).toFixed(1)}px ${fam()}`;
    p.forEach((q, i) => { if (i && i < p.length) { g.beginPath(); g.arc(q[0], q[1], 3.5, 0, Math.PI * 2); g.fillStyle = '#d18cff'; g.fill(); zpText(g, String(i), q[0] + 6, q[1] - 6, { font, color: '#e6c4ff' }); } });
  });

  /* ---------- orbit ---------- */
  const orb = cfg.orbit || (cfg.orbit = { radiusNm: 0.4, tas: null, bank: 30, show: 'circle' });
  function buildOrbit() {
    const d = ctx.selected;
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
    const { g } = c;
    const ring = PlanGeo.circle(T.orbit.center, T.orbit.r, 90).map((p) => c.P(p.lat, p.lon));
    g.lineWidth = 2.4; g.strokeStyle = '#4dd0e1'; g.beginPath(); ring.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    if (orb.show === 'drift' || orb.show === 'both') {
      const d = T.orbit.drift.points.map((p) => c.P(p.lat, p.lon));
      g.lineWidth = 1.6; g.strokeStyle = 'rgba(77,208,225,0.75)'; g.setLineDash([4, 4]); g.beginPath(); d.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke(); g.setLineDash([]);
    }
  });

  /* ---------- radius of action with wind ---------- */
  const rch = cfg.reach || (cfg.reach = { fuelKg: null, roundTrip: true, oneWay: true });
  function buildReach() {
    const d = ctx.selected;
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
    const { g } = c;
    const font = `700 ${(0.64 * rem()).toFixed(1)}px ${fam()}`;
    const poly = (list, color, dash, fill, label) => {
      const p = list.map((r) => c.P(r.point.lat, r.point.lon));
      g.beginPath(); p.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      g.lineWidth = 2.2; g.strokeStyle = color; g.setLineDash(dash); g.stroke(); g.setLineDash([]);
      const top = p.reduce((a, b) => (b[1] < a[1] ? b : a));
      zpText(g, label, top[0], top[1] - 10, { font, color, align: 'center' });
    };
    if (rch.oneWay) poly(T.reach.ow, '#7bd88f', [3, 5], null, `Enkele reis · ${ctx.fmt.dur(T.reach.minutes)}`);
    if (rch.roundTrip) poly(T.reach.rt, '#7bd88f', [], 'rgba(123,216,143,0.08)', 'Actieradius heen en terug');
  });

  /* ---------- who gets there first ---------- */
  function buildFirst() {
    const d = ctx.selected;
    if (!d) { T.first = null; return; }
    const out = [];
    const profiles = ctx.profiles();
    const snap = trafficFeed.snap;
    const own = (cfg.fleet.groups || ['police']);
    for (const a of (snap && snap.ac) || []) {
      if (!a.group || !own.includes(a.group) || a.lat == null || a.alt === 'ground') continue;
      const nm = UNIT_NAMES(a.hex) || {};
      const prof = /139/.test(nm.type || a.type || '') ? profiles.aw139 : /135|EC35/.test(nm.type || a.type || '') ? profiles.ec135 : null;
      const pl = prof ? PlanProfiles.planning(prof) : null;
      const tas = pl ? PlanPerf.tasFromIas(pl.ias, typeof a.alt === 'number' ? a.alt : pl.altFt) : Math.max(90, a.gs || 0);
      const alt = typeof a.alt === 'number' ? a.alt : 1000;
      const t = PlanPerf.directTime({ lat: a.lat, lon: a.lon }, d, tas, (la, lo, ms) => ctx.windAt(la, lo, ms, alt));
      out.push({ kind: 'air', name: a.flight || a.reg || nm.reg || a.hex.toUpperCase(), sub: `${nm.reg || a.reg || ''} ${nm.type || a.type || ''} · in de lucht`, from: { lat: a.lat, lon: a.lon }, tas, minutes: t, dist: PlanGeo.dist(a, d) });
    }
    for (const b of ctx.bases()) {
      for (const id of ['ec135', 'aw139']) {
        const pl = PlanProfiles.planning(profiles[id]);
        const tas = PlanPerf.tasFromIas(pl.ias, pl.altFt);
        const t = PlanPerf.directTime(b, d, tas, (la, lo, ms) => ctx.windAt(la, lo, ms, pl.altFt));
        out.push({ kind: 'base', name: `${profiles[id].name} vanaf ${b.name}`, sub: `+${b.startMin || 0} min opstarten · ${Math.round(tas)} KTAS`, from: b, tas, minutes: t == null ? null : t + (b.startMin || 0), dist: PlanGeo.dist(b, d) });
      }
    }
    out.sort((x, y) => (x.minutes ?? 1e9) - (y.minutes ?? 1e9));
    T.first = { target: d, list: out };
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

  // Rebuild what depends on the selected point when it, the profile, the units or the wind change.
  const rebuild = () => { if (cfg.toolPattern) buildPattern(); else T.pattern = null; if (cfg.toolOrbit) buildOrbit(); else T.orbit = null; if (cfg.toolReach) buildReach(); else T.reach = null; buildFirst(); ctx.cv.request(); ctx.emit('tools'); };
  for (const ev of ['select', 'profile', 'units', 'wind']) ctx.on(ev, rebuild);
  ctx.timers.push(setInterval(() => { if (cfg.firstShow || ctx.cfg.sideTab === 'fleet') { buildFirst(); ctx.cv.request(); ctx.emit('first'); } }, 5000));
  ctx.on('hit', ({ hit }) => {
    if (hit.kind === 'tape-close') { T.tape = null; ctx.cv.request(); }
    else if (hit.kind === 'rings') { T.rings.splice(hit.item.idx, 1); ctx.save(); ctx.cv.request(); }
  });

  /* ---------- panel ---------- */
  function panel() {
    const nmName = PlanUnits.DIST[cfg.units.dist].name;
    const sel = ctx.selected;
    const where = sel ? h('p', { class: 'zp-hint' }, 'Vanaf: ', h('b', {}, sel.label || ctx.fmt.coord(sel.lat, sel.lon))) : h('p', { class: 'zp-hint warn' }, 'Klik eerst een punt op de kaart (of zoek een plaats): de gereedschappen werken vanaf het geselecteerde punt.');
    const set = (obj, k, fn) => (v) => { obj[k] = v; ctx.save(); fn(); ctx.cv.request(); ctx.emit('tools'); };
    const sec = (title, on, toggle, ...content) => h('div', { class: 'zp-sec' + (on ? ' open' : '') },
      h('div', { class: 'zp-sec-head' }, h('h3', {}, title), switchTool('', on ? 'Uitzetten' : 'Aanzetten', () => on, toggle)), on ? content.flat(2) : null);

    // Tape and rings.
    const tape = h('div', { class: 'zp-sec open' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Meetlint en ringen')),
      h('div', { class: 'zp-btnrow' },
        zpBtn('Meetlint A→B', () => ctx.setMode('measure'), { icon: 'route', cls: ctx.mode === 'measure' ? 'on' : '', title: 'Meten (M): klik punt A en punt B. Kortste rechte lijn (grootcirkel) met maatstreepjes, koers heen en terug en vliegtijd.' }),
        zpBtn('Ringen plaatsen', () => ctx.setMode('rings'), { icon: 'target', cls: ctx.mode === 'rings' ? 'on' : '', title: 'Ringen (G): klik op de kaart om afstandsringen te plaatsen. Klik op het middelpunt om ze weer weg te halen.' }),
        sel ? zpBtn('Ringen hier', () => addRings(sel), { icon: 'plus' }) : null,
        T.rings.length ? zpBtn('Alle ringen weg', clearRings, { icon: 'trash' }) : null),
      h('div', { class: 'zp-grid4' },
        field('Stap', zpNum(cfg.rings.stepNm, set(cfg.rings, 'stepNm', () => {}), { step: 0.5, min: 0.1 }), nmName),
        field('Aantal', zpNum(cfg.rings.count, set(cfg.rings, 'count', () => {}), { step: 1, min: 1, max: 40 }), 'ringen'),
        field('Kompasroos', segmented([{ value: 'on', label: 'Aan' }, { value: 'off', label: 'Uit' }], cfg.compass === false ? 'off' : 'on', (v) => { cfg.compass = v === 'on'; ctx.save(); ctx.cv.request(); })),
        field('Zichtbaar', segmented([{ value: 'on', label: 'Aan' }, { value: 'off', label: 'Uit' }], cfg.ringsOff ? 'off' : 'on', (v) => { cfg.ringsOff = v === 'off'; ctx.save(); ctx.cv.request(); }))));

    // Search pattern.
    const pf = [];
    pf.push(field('Patroon', zpSelect(Object.entries(ZP_PATTERNS).map(([k, d]) => ({ value: k, label: d.name })), pat.type, set(pat, 'type', () => { buildPattern(); ctx.emit('tools'); })), ZP_PATTERNS[pat.type].hint));
    const grid = h('div', { class: 'zp-grid4' });
    if (pat.type !== 'vs') grid.append(field('Baanafstand S', zpNum(pat.spacingNm, set(pat, 'spacingNm', buildPattern), { step: 0.1, min: 0.05 }), nmName));
    if (pat.type === 'ss') grid.append(field('Poten', zpNum(pat.legs, set(pat, 'legs', buildPattern), { step: 1, min: 2, max: 60 })));
    if (pat.type === 'vs') grid.append(field('Straal', zpNum(pat.radiusNm, set(pat, 'radiusNm', buildPattern), { step: 0.5, min: 0.1 }), nmName));
    if (pat.type === 'cs' || pat.type === 'ps') grid.append(field('Lengte', zpNum(pat.lengthNm, set(pat, 'lengthNm', buildPattern), { step: 1, min: 0.5 }), nmName), field('Breedte', zpNum(pat.widthNm, set(pat, 'widthNm', buildPattern), { step: 0.5, min: 0.2 }), nmName), field('Lange as', zpNum(pat.axis, set(pat, 'axis', buildPattern), { step: 5, min: 0, max: 359 }), '° waar'));
    if (pat.type === 'ss' || pat.type === 'vs') grid.append(field('Eerste koers', zpNum(pat.firstTrack, set(pat, 'firstTrack', buildPattern), { step: 5, min: 0, max: 359 }), '° waar (vaak met de wind mee)'));
    grid.append(field('Draairichting', segmented([{ value: 'r', label: 'Rechts' }, { value: 'l', label: 'Links' }], pat.right ? 'r' : 'l', (v) => { pat.right = v === 'r'; ctx.save(); buildPattern(); ctx.cv.request(); ctx.emit('tools'); })));
    pf.push(grid);
    if (T.pattern) pf.push(h('div', { class: 'zp-totals' }, zpRow('Lengte', ctx.fmt.dist(T.pattern.lengthM)), zpRow('Duur', `${ctx.fmt.dur(T.pattern.timeMin, true)} bij ${Math.round(ctx.tas())} KTAS`), zpRow('Brandstof', ctx.fmt.fuel(T.pattern.fuelKg))),
      zpBtn('Als route gebruiken', () => ctx.parts.zpRoute.setPoints(T.pattern.pts, { name: ZP_PATTERNS[pat.type].name }), { icon: 'route', primary: true }));
    const patSec = sec('Zoekpatroon', !!cfg.toolPattern, () => { cfg.toolPattern = !cfg.toolPattern; ctx.save(); rebuild(); }, sel ? pf : where);

    // Orbit.
    const of = [];
    if (T.orbit) {
      const o = T.orbit.o;
      of.push(h('div', { class: 'zp-grid4' },
        field('Straal', zpNum(orb.radiusNm, set(orb, 'radiusNm', buildOrbit), { step: 0.05, min: 0.05 }), nmName),
        field('TAS', zpNum(orb.tas || '', set(orb, 'tas', buildOrbit), { step: 5, placeholder: String(T.orbit.tas) }), 'kt'),
        field('Helling (drift)', zpNum(orb.bank, set(orb, 'bank', buildOrbit), { step: 5, min: 5, max: 45 }), '° voor de baan met vaste helling'),
        field('Tonen', zpSelect([{ value: 'circle', label: 'Cirkel over de grond' }, { value: 'drift', label: 'Baan bij vaste helling' }, { value: 'both', label: 'Beide' }], orb.show, set(orb, 'show', () => {})))),
      h('div', { class: 'zp-totals' },
        zpRow('Wind', T.orbit.wnd ? ctx.fmt.wind(T.orbit.wnd.dirDeg, T.orbit.wnd.speedKt) : 'onbekend (zet de windlaag aan)'),
        zpRow('Helling windstil', `${Math.round(o.bankCalm)}°`),
        zpRow('Helling met wind', `${Math.round(o.bankMin)}° (tegenwind) tot ${Math.round(o.bankMax)}° (rugwind)`, 'Om de cirkel over de grond vast te houden: steilst met de wind mee, waar de grondsnelheid het hoogst is'),
        zpRow('GS', `${Math.round(o.gsMin)}–${Math.round(o.gsMax)} kt`),
        zpRow('Tijd per rondje', ctx.fmt.dur(o.minutes, true)),
        zpRow('Straal bij ' + orb.bank + '°', ctx.fmt.dist(T.orbit.drift.radiusM))));
    }
    const orbSec = sec('Orbit', !!cfg.toolOrbit, () => { cfg.toolOrbit = !cfg.toolOrbit; ctx.save(); rebuild(); }, sel ? of : where);

    // Reach.
    const rf = [];
    if (T.reach) {
      const pl = ctx.planning();
      rf.push(h('div', { class: 'zp-grid4' },
        field('Brandstof', zpNum(rch.fuelKg != null ? Math.round(PlanUnits.fuelIn(rch.fuelKg, cfg.units.fuel, pl.density)) : '', (v) => { rch.fuelKg = v == null ? null : PlanUnits.fuelKg(v, cfg.units.fuel, pl.density); ctx.save(); buildReach(); ctx.cv.request(); ctx.emit('tools'); }, { step: 10, placeholder: String(Math.round(PlanUnits.fuelIn(pl.fuelKg, cfg.units.fuel, pl.density))) }), `${PlanUnits.FUEL[cfg.units.fuel].name} aan boord`),
        field('Heen en terug', segmented([{ value: 'on', label: 'Aan' }, { value: 'off', label: 'Uit' }], rch.roundTrip ? 'on' : 'off', (v) => { rch.roundTrip = v === 'on'; ctx.save(); ctx.cv.request(); })),
        field('Enkele reis', segmented([{ value: 'on', label: 'Aan' }, { value: 'off', label: 'Uit' }], rch.oneWay ? 'on' : 'off', (v) => { rch.oneWay = v === 'on'; ctx.save(); ctx.cv.request(); }))),
      h('div', { class: 'zp-totals' },
        zpRow('Vliegtijd beschikbaar', ctx.fmt.dur(T.reach.minutes, true), `Brandstof min opstart/taxi (${ctx.fmt.fuel(pl.taxiKg)}) en eindreserve (${ctx.fmt.fuel(pl.reserveKg)}), bij ${Math.round(pl.flowKgh)} kg/u`),
        zpRow('Wind', T.reach.wnd ? ctx.fmt.wind(T.reach.wnd.dirDeg, T.reach.wnd.speedKt) : 'windstil gerekend (geen wind bekend)'),
        zpRow('Max. actieradius', ctx.fmt.dist(Math.max(...T.reach.rt.map((r) => r.m)))),
        zpRow('Min. actieradius', ctx.fmt.dist(Math.min(...T.reach.rt.map((r) => r.m))))));
    }
    const reachSec = sec('Actieradius met wind', !!cfg.toolReach, () => { cfg.toolReach = !cfg.toolReach; ctx.save(); rebuild(); }, sel ? rf : where);
    return h('div', { class: 'zp-panel' }, tape, patSec, orbSec, reachSec);
  }

  // Who gets there first, for the fleet panel.
  function firstPanel() {
    if (!ctx.selected) return h('p', { class: 'zp-hint warn' }, 'Klik een punt op de kaart (of zoek een adres): hier zie je dan welk toestel er het snelst kan zijn.');
    if (!T.first) buildFirst();
    return h('div', { class: 'zp-sec open' },
      h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Wie is er het snelst?'), switchTool('KAART', 'Lijnen naar het doel op de kaart tonen', () => cfg.firstShow, () => { cfg.firstShow = !cfg.firstShow; ctx.save(); ctx.cv.request(); })),
      h('p', { class: 'zp-hint' }, 'Naar ', h('b', {}, ctx.selected.label || ctx.fmt.coord(ctx.selected.lat, ctx.selected.lon)), ': rechtstreeks, met de wind op vlieghoogte, op de planningssnelheid van het profiel. Vanaf de basis met de opstarttijd erbij.'),
      h('div', { class: 'zp-first' }, T.first.list.map((r, i) => h('div', { class: 'zp-first-row' + (i === 0 ? ' best' : '') },
        h('span', { class: 'zp-first-n' }, String(i + 1)),
        h('div', {}, h('b', {}, r.name), h('small', {}, r.sub)),
        h('div', { class: 'zp-first-t' }, h('b', {}, r.minutes == null ? '—' : ctx.fmt.dur(r.minutes)), h('small', {}, `${ctx.fmt.dist(r.dist)} · ETA ${r.minutes == null ? '—' : ctx.fmt.time(Date.now() + r.minutes * 60000)}`))))));
  }

  return { panel, firstPanel, addRings, clearRings, state: T, setTape: (a, b) => { T.tape = { a, b }; ctx.cv.request(); } };
}
