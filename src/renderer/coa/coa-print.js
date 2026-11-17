'use strict';

/* ============================================================
   COA Planner: de kniebordkaart (A5 staand, twee bladen)
   Blad 1: de schipgegevens bovenaan en de vier COA's zo groot als het blad toelaat, elk met het
   nummer groot in de hoek en de cijfers onder het schip. Blad 2: het hele bord met de tekening, de
   tabel, zon en maan, de zee en de hoogtes. Drie indelingen (COA_PRINT_LAYOUTS); dezelfde HTML gaat naar
   de printer, de PDF en de afbeelding in de e-mail.
   ============================================================ */
const COA_PRINT_LAYOUTS = {
  a: { name: 'Raster', hint: 'Vier grote kaarten 2 × 2, in kleur' },
  b: { name: 'Raster met kompas', hint: 'Kompas met AT, wind, zon en maan in de kop; kaarten iets lager' },
  c: { name: 'Hoog contrast', hint: 'Zwart-wit met dikke lijnen en de grootste cijfers; alleen bakboord/stuurboord in kleur' },
};
const COA_MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

// High contrast: black on white, sides still red and green, the wind black.
const coaPalContrast = () => ({ ...COA_PAL.print, edge: '#0b1320', card2: '#ffffff', muted: '#2a3442', faint: 'rgba(0,0,0,0.45)', wind: '#0b1320', helo: '#8a4b00', accent: '#c46f00', sea: '#ffffff' });

// One COA as a card for page 1: w × h units. The picture (ship, COA window, helicopter, barb and what was
// drawn on the ship) takes most of it; the figures are a compact block under it.
function coaPrintCard(vm, c, P, id, { w = 600, h = 745, style = 'a' } = {}) {
  const hc = style === 'c';
  const fig = h - (hc ? 128 : 118); // where the figures start
  // The ship as large as the card allows: the ring with its plates is about 350 units across.
  const s = Math.min(1.72, (fig - 30) / 350, (w - 16) / 352);
  const picY = 4 + (fig - 22) / 2;
  const ref = vm.refText;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet"><defs>${coaShipDefs(id, P)}</defs>`];
  o.push(`<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="24" fill="${P.card}" stroke="${P.edge}" stroke-width="${hc ? 4 : 2.4}"/>`);
  // Kept free: the corner with the number (and the BRC tag), in the picture's own units.
  const loc = (x0, y0, x1, y1) => ({ x0: (x0 - w / 2) / s, y0: (y0 - picY) / s, x1: (x1 - w / 2) / s, y1: (y1 - picY) / s });
  const avoid = [loc(0, 0, hc ? 128 : 104, hc ? 100 : 92), ...(c.brc ? [loc(w - 104, 0, w, 56)] : [])];
  // The relative-wind plate always left-bottom of the picture, in the picture's own units.
  const plateAt = { x: (16 - w / 2) / s, y: (fig - 10 - picY) / s };
  o.push(`<g transform="translate(${w / 2} ${picY}) scale(${coaF(s)})">${coaPic(vm, c, P, id, 0, 0, { box: { x0: (-w / 2 + 8) / s, y0: (-picY + 8) / s, x1: (w / 2 - 8) / s, y1: (fig - 4 - picY) / s }, k: hc ? 0.95 : 0.9, avoid, plateAt, pk: 0.78 })}</g>`);
  // The number, large in the top left corner.
  if (hc) {
    o.push(`<path d="M1.5 25.5Q1.5 1.5 25.5 1.5H124V96H1.5Z" fill="#0b1320"/>`);
    o.push(coaText(16, 24, 'COA', { size: 18, weight: 800, fill: '#ffffff', anchor: 'start', extra: 'letter-spacing="3"' }));
    o.push(coaText(16, 66, String(c.n), { size: 62, weight: 800, fill: '#ffffff', anchor: 'start', family: 'display' }));
  } else {
    o.push(coaText(22, 28, 'COA', { size: 20, weight: 800, fill: P.muted, anchor: 'start', extra: 'letter-spacing="3"' }));
    o.push(coaText(20, 72, String(c.n), { size: 66, weight: 800, fill: P.text, anchor: 'start', family: 'display' }));
  }
  if (c.brc) {
    o.push(`<rect x="${w - 96}" y="16" width="76" height="30" rx="15" fill="none" stroke="${P.accent}" stroke-width="2.6"/>`);
    o.push(coaText(w - 58, 32, 'BRC', { size: 17, weight: 800, fill: P.accent }));
  }
  // The figures: one line with the relative wind, then two rows of two.
  const line = hc ? 2.2 : 1.2;
  o.push(`<path d="M20 ${fig}H${w - 20}" stroke="${P.edge}" stroke-width="${line}"/>`);
  const rc = c.rel ? (c.rel.side === 'G' ? P.stbd : c.rel.side === 'R' ? P.port : P.text) : P.muted;
  const vs = hc ? 25 : 23, ls = hc ? 13 : 12;
  let y = fig + 26;
  o.push(coaText(24, y, 'REL WIND', { size: ls, weight: 800, fill: P.muted, anchor: 'start', extra: 'letter-spacing="1.5"' }));
  o.push(coaText(118, y, c.rel ? coaRelText(c) : 'CALM', { size: vs + 2, weight: 800, fill: rc, anchor: 'start', family: 'mono' }));
  o.push(coaText(w - 22, y, `${c.app.dir == null ? '---' : vm.fmt(c.app.dir)}°${ref}/${Math.round(c.app.spd)}${c.gust ? 'G' + Math.round(c.gust.spd) : ''}`, { size: vs - 4, weight: 700, fill: hc ? P.text : P.wind, anchor: 'end', family: 'mono' }));
  const ac = c.approach.side === 'G' ? P.stbd : c.approach.side === 'R' ? P.port : P.text;
  const hl = c.helo;
  const cells = [
    ['HDG', `${vm.fmt(c.heading)}°${ref}`, P.text, 'mono'],
    ['APPR', c.approach.text, ac, 'mono'],
    ['HELO', `${hl.head >= 0 ? 'HW' : 'TW'}${Math.abs(Math.round(hl.head))} XW${Math.abs(Math.round(hl.cross))}${hl.side}`, P.text, 'mono'],
    ['SEA', c.sea ? c.sea.name.replace(' on the ', ' on ') : '—', P.text, 'ui'],
  ];
  cells.forEach(([k2, v2, col, fam], i) => {
    const x = i % 2 ? w / 2 + 12 : 24, yy = y + 32 + Math.floor(i / 2) * 30;
    o.push(coaText(x, yy, k2, { size: ls, weight: 800, fill: P.muted, anchor: 'start', extra: 'letter-spacing="1.5"' }));
    o.push(coaText(x + 62, yy, v2, { size: fam === 'ui' ? vs - 3 : vs - 1, weight: 800, fill: col, anchor: 'start', family: fam }));
  });
  o.push(`<path d="M${w / 2} ${y + 20}V${h - 14}" stroke="${P.edge}" stroke-width="${hc ? 1.6 : 0.9}"/>`);
  if (coaIsExpected(vm, c)) o.push(coaExpectFrame(0, 0, w, h, P, { sw: hc ? 14 : 12, k: 1.2, rx: 24 }));
  o.push('</svg>');
  return o.join('');
}

// The whole card: two A5 portrait pages. `d` = { vm, P (the plan), marks, layout, how }.
function coaPrintHtml({ vm: v, P, marks, layout = 'a' }) {
  const L = COA_PRINT_LAYOUTS[layout] ? layout : 'a';
  const hc = L === 'c';
  const Pp = hc ? coaPalContrast() : COA_PAL.print;
  const e = escHtml;
  const d = new Date(P.hhour || Date.now());
  const dtg = `${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z ${COA_MON[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  const R = v.refText;
  const pos = v.pos ? `${PlanCoords.fmt(v.pos.lat, v.pos.lon, 'ddm')}${v.pos.dr ? ' (DR at H)' : ''}` : '—';
  const wv = `${v.fmt(v.wd)}°${R}/${Math.round(v.ws)}${v.gust ? 'G' + Math.round(v.gust) : ''}`;
  const src = P.windSrc || {};
  const wsrc = src.kind === 'model' ? `fcst H ${src.at ? zulu(src.at).replace(':', '') : ''}` : src.kind === 'ship' ? `at ship ${src.at ? zulu(src.at).replace(':', '') : ''}` : src.kind === 'metar' ? `METAR ${src.label || ''}` : 'manual';
  const meta = [
    ['Assault Track', `${v.fmt(v.at)}°${R}`], ['Boat Ref Course', v.brc ? `${v.fmt(v.brc.heading)}°${R}` : '—'], ['Boat Speed', `${Math.round(+P.bs)} kt`], ['W/V · ' + wsrc, wv],
    ['Ship position' + (P.posLabel ? ' · ' + P.posLabel : ''), pos, 2], ['H-hour', `${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z`], ['Ref', `°${R}${R === 'M' ? ` ${Math.abs(v.decl).toFixed(1)}${v.decl >= 0 ? 'E' : 'W'}` : ''}`],
  ].map(([k, val, span]) => `<div${span ? ` style="grid-column: span ${span}"` : ''}><small>${e(k)}</small><b>${e(val)}</b></div>`).join('');
  const cardH = L === 'b' ? 668 : 745;
  const cards = v.coas.map((c) => `<div class="cd">${coaPrintCard(v, c, Pp, `p${L}${c.n}`, { h: cardH, style: L })}</div>`).join('');
  const compass = L === 'b' ? `<div class="cmp"><svg viewBox="500 318 300 364" xmlns="http://www.w3.org/2000/svg">${coaCompass(v, Pp)}</svg></div>` : '';
  const warn = [v.glareSun ? 'APPROACH INTO SUN' : '', v.glareMoon ? 'APPROACH INTO MOON (NVG)' : ''].filter(Boolean).join(' · ');

  // Page 2: the whole board with the drawing, the table and the rest.
  const board = coaBoardSvg(v, Pp, { id: 'pb' + L }).replace('</svg>', `${(marks || []).map((m) => coaMarkSvg(m, Pp)).join('')}</svg>`);
  const heloShort = (hl) => `${hl.head >= 0 ? 'HW' : 'TW'}${Math.abs(Math.round(hl.head))} XW${Math.abs(Math.round(hl.cross))}${hl.side}`;
  const rows = v.coas.map((c) => `<tr class="${coaIsExpected(v, c) ? 'exp' : ''}"><td><b>COA ${c.n}</b>${c.brc ? ' <i>BRC</i>' : ''}</td><td>${v.fmt(c.heading)}°</td><td><b>${c.app.dir == null ? '---' : v.fmt(c.app.dir)}° / ${Math.round(c.app.spd)}</b>${c.gust ? ` (G${Math.round(c.gust.spd)})` : ''}</td><td class="${c.rel && c.rel.side === 'G' ? 'g' : c.rel && c.rel.side === 'R' ? 'r' : ''}"><b>${e(coaRelText(c))}</b></td><td>${heloShort(c.helo)}</td><td class="${c.approach.side === 'G' ? 'g' : c.approach.side === 'R' ? 'r' : ''}"><b>${c.approach.text}</b></td><td>${c.sea ? e(c.sea.name) : '—'}</td></tr>`).join('');
  const m = P._sea && P._sea.model, ds = m && m.hs != null ? COA_CALC.douglas(m.hs) : null;
  const srel = m && m.dir != null ? COA_CALC.seaRelative(m.dir, v.brc ? v.brc.heading : v.at) : null;
  const sea = m ? `Sea state <b>${ds ? ds.code + ' ' + ds.name : '–'}</b> · Hs ${m.hs != null ? m.hs.toFixed(1) + ' m' : '–'} · Tm ${m.period != null ? m.period.toFixed(0) + ' s' : '–'} · waves from ${m.dir != null ? v.fmt(m.dir) + '°' : '–'}${srel ? ` · ${v.brc ? 'on BRC' : 'on COA 1'}: ${srel.name.toLowerCase()}, ${srel.motion}` : ''}${m.sst != null ? ' · SST ' + m.sst.toFixed(0) + ' °C' : ''}` : 'Sea: no data';
  const lx = ASTRO.formatLux(v.light.lux);
  const el = (a) => `${Math.round(a)}°`;
  const sm = `<table class="sm"><thead><tr><th></th><th>At H ${zulu(v.tAstro).replace(':', '')}</th><th>Now ${zulu(v.now.t).replace(':', '')}</th></tr></thead><tbody>`
    + `<tr><td><b>Sun</b></td><td>${v.fmt(v.sun.az)}° · elev ${el(v.sun.alt)}</td><td>${v.fmt(v.now.sun.az)}° · elev ${el(v.now.sun.alt)}</td></tr>`
    + `<tr><td><b>Moon</b></td><td>${v.fmt(v.moon.az)}° · elev ${el(v.moon.alt)} · ${Math.round(v.moon.fraction * 100)}%</td><td>${v.fmt(v.now.moon.az)}° · elev ${el(v.now.moon.alt)} · ${Math.round(v.now.moon.fraction * 100)}%</td></tr>`
    + `<tr><td><b>Light</b></td><td>${e(v.phase ? v.phase.name : '')} · ${lx.value} ${lx.unit}</td><td>${e(COA_CALC.lightPhase(v.now.sun.alt).name)}</td></tr></tbody></table>`;
  const conf = COA_CALC.heightConflicts(P.heights, +P.sep || 500);
  const bad = new Set(conf.flatMap((c) => [c.a.i, c.b.i]));
  const hrows = P.heights.filter((r) => r.cs || r.type || r.alt || r.role);
  const xsec = P.heights.some((r) => COA_CALC.parseFt(r.alt) != null) ? coaHeightSvg(P.heights, +P.sep || 500, bad, Pp, { w: 300, h: 150 }) : '';
  const ht = (hrows.length ? P.heights.map((r, i) => (r.cs || r.type || r.alt || r.role ? `<tr class="${bad.has(i) ? 'bad' : ''}"><td>${e(r.cs || '')}</td><td>${e(r.type || '')}</td><td><b>${e(r.alt || '')}</b></td><td>${e(r.role || '')}</td></tr>` : '')).join('') : '') + Array.from({ length: Math.max(0, 4 - hrows.length) }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');
  const foot = (n) => `<div class="ft"><span>Rel. wind = apparent wind over deck · G stbd, R port · Approach = side of the ship flown towards · HW/TW, XW L/R in kt</span><span>${n}/2 · ${e(OS_SCREEN_NAME())} · ${zulu(Date.now())}</span></div>`;
  const ink = hc ? '#000' : '#0b1320';
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A5 portrait; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', -apple-system, sans-serif; color: ${ink}; font-size: 7.4pt; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pg { width: 134mm; height: 209mm; padding: 7mm 0 6mm; margin: 0 auto; display: flex; flex-direction: column; overflow: hidden; }
.pg + .pg { break-before: page; page-break-before: always; }
.hd { flex: none; display: flex; align-items: baseline; justify-content: space-between; border-bottom: ${hc ? '2.4pt' : '1.6pt'} solid ${ink}; padding-bottom: 1mm; }
.hd h1 { font: 800 13pt Bahnschrift, 'Segoe UI', sans-serif; letter-spacing: 0.08em; margin: 0; }
.hd span { font-size: 9pt; font-weight: 800; }
.top { flex: none; display: flex; gap: 2mm; margin: 1.4mm 0 1.6mm; align-items: stretch; }
.meta { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.8mm 1.4mm; align-content: start; }
.meta div { border: ${hc ? '0.9pt solid #000' : '0.5pt solid #9aa8bb'}; border-radius: 1.2mm; padding: 0.7mm 1.3mm; }
.meta small { display: block; color: ${hc ? '#000' : '#4a5a70'}; font-size: 5.6pt; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta b { font-size: ${hc ? '10pt' : '9.4pt'}; font-family: Consolas, monospace; white-space: nowrap; }
.cmp { flex: none; width: 27mm; }
.cmp svg { width: 100%; height: 100%; display: block; }
.grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; gap: 1.6mm; }
.cd { min-height: 0; display: flex; }
.cd svg { width: 100%; height: 100%; display: block; }
.warn { flex: none; margin-top: 1.2mm; background: #c8161c; color: #fff; font-weight: 800; padding: 0.8mm 1.4mm; border-radius: 1mm; letter-spacing: 0.04em; font-size: 8pt; }
.board svg { width: 134mm; height: 103mm; display: block; margin-top: 1.2mm; }
table { width: 100%; border-collapse: collapse; margin-top: 1.2mm; }
th { background: ${hc ? '#fff' : '#e6ebf2'}; font-size: 6pt; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.6mm 0.8mm; border: ${hc ? '0.8pt solid #000' : '0.4pt solid #9aa8bb'}; text-align: left; }
td { border: ${hc ? '0.8pt solid #000' : '0.4pt solid #9aa8bb'}; padding: 0.7mm 0.8mm; font-family: Consolas, monospace; font-size: 7pt; }
tr.exp td { background: #fff3df; }
tr.bad td { background: #ffe3e3; }
td i { font-style: normal; background: #c46f00; color: #fff; border-radius: 1mm; padding: 0 0.8mm; font-size: 5.6pt; font-family: 'Segoe UI', sans-serif; font-weight: 800; }
td.g b { color: #1b8a3a; } td.r b { color: #c8161c; }
.ln { margin-top: 1.2mm; font-size: 7.2pt; }
.two { display: grid; grid-template-columns: 1fr 44mm; gap: 2mm; align-items: start; }
.xs svg { width: 44mm; height: auto; display: block; margin-top: 1.2mm; border: 0.4pt solid #9aa8bb; border-radius: 1mm; }
.sm td { font-family: 'Segoe UI', sans-serif; }
.ft { flex: none; margin-top: auto; padding-top: 1mm; color: ${hc ? '#000' : '#4a5a70'}; font-size: 5.6pt; display: flex; justify-content: space-between; gap: 2mm; }
</style></head><body>
<div class="pg">
<div class="hd"><h1>COA PLANNER</h1><span>${e(P.name)} · ${dtg}</span></div>
<div class="top"><div class="meta">${meta}</div>${compass}</div>
<div class="grid">${cards}</div>
${warn ? `<div class="warn">${warn}</div>` : ''}
${foot(1)}
</div>
<div class="pg">
<div class="hd"><h1>COA PLANNER · DETAIL</h1><span>${e(P.name)} · ${dtg}</span></div>
<div class="board">${board}</div>
<table><thead><tr><th>COA</th><th>Ship HDG</th><th>Rel. wind °/kt</th><th>Rel. bearing</th><th>Helo on AT</th><th>Approach</th><th>Sea</th></tr></thead><tbody>${rows}</tbody></table>
${sm}
<div class="ln">${sea}</div>
${warn ? `<div class="warn">${warn}</div>` : ''}
<div class="${xsec ? 'two' : ''}"><table><thead><tr><th style="width:24%">Callsign</th><th style="width:22%">Type</th><th style="width:18%">Alt ft</th><th>Task</th></tr></thead><tbody>${ht}</tbody></table>${xsec ? `<div class="xs">${xsec}</div>` : ''}</div>
${conf.length ? `<div class="warn">HEIGHT CONFLICT: ${conf.slice(0, 3).map((c) => `${e(c.a.name)} ↔ ${e(c.b.name)} ${c.diff} ft`).join(' · ')} (min. ${+P.sep || 500} ft)</div>` : ''}
${foot(2)}
</div>
</body></html>`;
}
const OS_SCREEN_NAME = () => (typeof OPS !== 'undefined' && OPS.screen && OPS.screen.name) || 'P-ALV Dashboard';
