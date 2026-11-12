'use strict';

/* ============================================================
   COA Planner: de tekening
   Het bord met de vier COA-kaarten en het kompas in het midden, als SVG-tekst: dezelfde tekening op het
   scherm (in de kleuren van het thema) en op de A5-kniebordkaart (in drukkleuren). Ook het generieke,
   lege schip (bovenaanzicht, alleen bakboord rood en stuurboord groen, rechte spiegel) en de schaduw.
   ============================================================ */
// The board is 1300 × 1000 units. COA 1 top left, 2 top right, 3 bottom right, 4 bottom left (as in
// the original); each card has its figures on the outer side and the picture of the ship on the inner
// side, so the compass in the middle covers only empty corners.
const COA_W = 1300;
const COA_H = 1000;
const COA_CARD = { w: 640, h: 490, gap: 20, col: 250 };
const COA_RING = 118;
const COA_SHIP_K = 1.98; // ship scale: 198 units long
const COA_PAL = {
  dark: { bg: '#0b1422', card: '#0f1c2f', card2: '#132339', edge: '#24385a', grid: 'rgba(143,183,230,0.07)', text: '#e9eff8', muted: '#8ea2bf', faint: 'rgba(143,183,230,0.32)', accent: '#f59a00', wind: '#4fb3ff', twind: '#ff5a52', port: '#e0383e', stbd: '#2fb455', helo: '#ffb941', sun: '#ffd23f', moon: '#d7dde7', plate: 'rgba(8,14,24,0.86)', compass: '#0c1729', sea: "#0f2944", warn: '#ff5a52' },
  light: { bg: '#e8eef6', card: '#ffffff', card2: '#f3f7fc', edge: '#c6d2e2', grid: 'rgba(31,79,147,0.07)', text: '#0f1a2b', muted: '#5a6c86', faint: 'rgba(31,79,147,0.34)', accent: '#d97f00', wind: '#1767c2', twind: '#d0262a', port: '#d0262a', stbd: '#1f8f3e', helo: '#c77700', sun: '#e0a800', moon: '#7d8797', plate: 'rgba(255,255,255,0.92)', compass: '#f6f9fd', sea: '#e7f0fa', warn: '#d0262a' },
  print: { bg: '#ffffff', card: '#ffffff', card2: '#f6f8fb', edge: '#9aa8bb', grid: 'rgba(0,0,0,0.05)', text: '#0b1320', muted: '#4a5a70', faint: 'rgba(20,40,70,0.38)', accent: '#c46f00', wind: '#0d5fb8', twind: '#c8161c', port: '#d0262a', stbd: '#1b8a3a', helo: '#b86a00', sun: '#d39a00', moon: '#6f7887', plate: 'rgba(255,255,255,0.94)', compass: '#ffffff', sea: '#ffffff', warn: '#c8161c' },
};

// Literal font stacks (a presentation attribute cannot use var()), the same as the dashboard's own.
const COA_FONTS = { ui: "'Segoe UI Variable Text', 'Segoe UI', -apple-system, system-ui, sans-serif", display: "Bahnschrift, 'Segoe UI Variable Display', 'Segoe UI', 'DIN Alternate', sans-serif", mono: "'Cascadia Mono', Consolas, 'SF Mono', Menlo, monospace" };
const coaF = (n) => (Math.round(n * 10) / 10).toString();
const coaEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// A point at `r` from (cx, cy) in screen angle `a` (degrees, 0 up, clockwise).
const coaAt = (cx, cy, r, a) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)];
const coaText = (x, y, s, { size = 20, weight = 600, fill, anchor = 'middle', family = 'ui', base = 'central', extra = '' } = {}) =>
  `<text x="${coaF(x)}" y="${coaF(y)}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" dominant-baseline="${base}" font-family="${COA_FONTS[family] || COA_FONTS.ui}" ${extra}>${coaEsc(s)}</text>`;

/* ---------- the ship ---------- */
// Bow up, centre (0, 0), 100 long and 26 wide, a straight transom at the stern. Deliberately empty: only
// the hull, the port half red and the starboard half green, so the sides read at a glance.
const COA_HULL = 'M0 -50C6.5 -45 13 -32 13 -14L13 45Q13 49 9.5 49L-9.5 49Q-13 49 -13 45L-13 -14C-13 -32 -6.5 -45 0 -50Z';
const COA_HALF_S = 'M0 -50C6.5 -45 13 -32 13 -14L13 45Q13 49 9.5 49L0 49Z';
const COA_HALF_P = 'M0 -50C-6.5 -45 -13 -32 -13 -14L-13 45Q-13 49 -9.5 49L0 49Z';
function coaShipDefs(id, P) {
  return `<linearGradient id="${id}-gs" x1="1" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${P.stbd}" stop-opacity="0.82"/><stop offset="0.55" stop-color="${P.stbd}"/><stop offset="1" stop-color="${P.stbd}" stop-opacity="0.94"/></linearGradient>`
    + `<linearGradient id="${id}-gp" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${P.port}" stop-opacity="0.82"/><stop offset="0.55" stop-color="${P.port}"/><stop offset="1" stop-color="${P.port}" stop-opacity="0.94"/></linearGradient>`
    + `<filter id="${id}-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>`;
}
function coaShip(id) {
  return `<path d="${COA_HALF_P}" fill="url(#${id}-gp)"/><path d="${COA_HALF_S}" fill="url(#${id}-gs)"/>`
    + `<path d="${COA_HULL}" fill="none" stroke="#0b121c" stroke-width="1.5" stroke-linejoin="round"/>`;
}

/* ---------- wind barbs ---------- */
// A wind barb at (cx, cy): the staff points (screen angle a) to where the wind comes from, with the
// feathers at its end: pennant 50, full 10, half 5 knots.
function coaBarb(cx, cy, a, kt, len, color, w = 3) {
  if (kt == null) return '';
  const k = Math.round(kt / 5) * 5;
  const [ex, ey] = coaAt(cx, cy, len, a);
  let out = `<path d="M${coaF(cx)} ${coaF(cy)}L${coaF(ex)} ${coaF(ey)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  if (k === 0) return `<circle cx="${coaF(cx)}" cy="${coaF(cy)}" r="${coaF(len * 0.16)}" fill="none" stroke="${color}" stroke-width="${w}"/>`;
  let rest = k, pos = len;
  const step = len * 0.15, fl = len * 0.42;
  const feather = (r, f) => {
    const [x0, y0] = coaAt(cx, cy, r, a);
    const [x1, y1] = coaAt(x0, y0, fl * f, a + 62);
    return `<path d="M${coaF(x0)} ${coaF(y0)}L${coaF(x1)} ${coaF(y1)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  };
  while (rest >= 50) {
    const [x0, y0] = coaAt(cx, cy, pos, a), [x2, y2] = coaAt(cx, cy, pos - step * 1.4, a);
    const [x1, y1] = coaAt(x0, y0, fl, a + 62);
    out += `<path d="M${coaF(x0)} ${coaF(y0)}L${coaF(x1)} ${coaF(y1)}L${coaF(x2)} ${coaF(y2)}Z" fill="${color}"/>`;
    pos -= step * 1.8; rest -= 50;
  }
  while (rest >= 10) { out += feather(pos, 1); pos -= step; rest -= 10; }
  if (rest >= 5) out += feather(pos === len ? len - step : pos, 0.55);
  return out;
}

/* ---------- texts ---------- */
// The relative wind with its strength: "G045 - 15 kt"; dead calm over the deck has no bearing.
const coaRelText = (c) => (c.rel ? `${c.rel.text} - ${Math.round(c.app.spd)} kt` : 'Calm over deck');
// What the helicopter on the AT feels: headwind (HW) or tailwind (TW), and the crosswind (XW) with the
// side it comes from (L/R).
const coaHeloText = (hl) => `${hl.head >= 0 ? 'HW' : 'TW'} ${Math.abs(Math.round(hl.head))} kt · XW ${Math.abs(Math.round(hl.cross))} kt${hl.side ? ' ' + hl.side : ''}`;

/* ---------- one COA card ---------- */
function coaCard(vm, c, i, P, id) {
  const { w, h, gap, col } = COA_CARD;
  const left = i === 0 || i === 3, top = i < 2;
  const x0 = left ? 0 : w + gap, y0 = top ? 0 : h + gap;
  // The picture on the inner side, the figures on the outer side.
  const dx = left ? x0 + col : x0, dw = w - col;
  const cx = dx + dw / 2, cy = y0 + h / 2 + (top ? -16 : 16);
  const fx = left ? x0 : x0 + w - col;
  const up = vm.up;
  const scr = (dir) => dir - up; // screen angle of a true direction
  const hdg = scr(c.heading);
  const ref = vm.refText, dd = (t) => `${vm.fmt(t)}°${ref}`;
  const o = [];
  const strong = c.brc;
  o.push(`<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="22" fill="${P.card}" stroke="${strong ? P.accent : P.edge}" stroke-width="${strong ? 3.5 : 1.6}"/>`);
  // The figures column has its own shade.
  const fr = left ? `M${x0 + 22} ${y0}H${x0 + col}V${y0 + h}H${x0 + 22}Q${x0} ${y0 + h} ${x0} ${y0 + h - 22}V${y0 + 22}Q${x0} ${y0} ${x0 + 22} ${y0}Z`
    : `M${x0 + w - col} ${y0}H${x0 + w - 22}Q${x0 + w} ${y0} ${x0 + w} ${y0 + 22}V${y0 + h - 22}Q${x0 + w} ${y0 + h} ${x0 + w - 22} ${y0 + h}H${x0 + w - col}Z`;
  o.push(`<path d="${fr}" fill="${P.card2}"/>`, `<path d="M${left ? x0 + col : x0 + w - col} ${y0 + 18}V${y0 + h - 18}" stroke="${P.edge}" stroke-width="1"/>`);
  // Picture: faint sea grid, the ring with the course window, the tactical rays, then the ship.
  o.push(`<circle cx="${cx}" cy="${cy}" r="${COA_RING}" fill="${P.sea}"/>`);
  for (const r of [COA_RING * 0.55, COA_RING]) o.push(`<circle cx="${cx}" cy="${cy}" r="${coaF(r)}" fill="none" stroke="${P.faint}" stroke-width="${r === COA_RING ? 1.6 : 1}" ${r === COA_RING ? '' : 'stroke-dasharray="4 6"'}/>`);
  for (let a = 0; a < 360; a += 10) {
    const [ax, ay] = coaAt(cx, cy, COA_RING, hdg + a), [bx, by] = coaAt(cx, cy, COA_RING + (a % 30 ? 6 : 11), hdg + a);
    o.push(`<path d="M${coaF(ax)} ${coaF(ay)}L${coaF(bx)} ${coaF(by)}" stroke="${P.faint}" stroke-width="${a % 30 ? 1 : 1.8}"/>`);
  }
  // The window of this COA: nominal ±45°, as an arc just outside the ring with its two end courses.
  {
    const a0 = scr(c.nominal - 45), a1 = scr(c.nominal + 45), r = COA_RING + 20;
    const [sx, sy] = coaAt(cx, cy, r, a0), [ex, ey] = coaAt(cx, cy, r, a1);
    o.push(`<path d="M${coaF(sx)} ${coaF(sy)}A${r} ${r} 0 0 1 ${coaF(ex)} ${coaF(ey)}" fill="none" stroke="${P.accent}" stroke-opacity="0.55" stroke-width="5" stroke-linecap="round"/>`);
    for (const [a, t] of [[a0, c.nominal - 45], [a1, c.nominal + 45]]) { const [lx, ly] = coaAt(cx, cy, r + 26, a); o.push(coaText(lx, ly, `${vm.fmt(t)}°`, { size: 17, weight: 600, fill: P.muted, family: 'mono' })); }
  }
  // Rays from the bow, relative to the ship: 45, 90 and 139 degrees, red to port and green to starboard.
  for (const rel of [45, 90, 139]) for (const side of [1, -1]) {
    const a = hdg + side * rel, col2 = side > 0 ? P.stbd : P.port;
    const [ax, ay] = coaAt(cx, cy, 60, a), [bx, by] = coaAt(cx, cy, COA_RING - 2, a);
    o.push(`<path d="M${coaF(ax)} ${coaF(ay)}L${coaF(bx)} ${coaF(by)}" stroke="${col2}" stroke-width="2.2" stroke-opacity="0.85"/>`);
    const [lx, ly] = coaAt(cx, cy, COA_RING - 20, a + side * 9);
    o.push(coaText(lx, ly, `${rel}°`, { size: 16, weight: 800, fill: col2, family: 'mono' }));
  }
  // The heading of the ship: a dashed line ahead of the bow to the ring, and the course on it.
  {
    const [ax, ay] = coaAt(cx, cy, 50 * COA_SHIP_K + 6, hdg), [bx, by] = coaAt(cx, cy, COA_RING + 4, hdg);
    o.push(`<path d="M${coaF(ax)} ${coaF(ay)}L${coaF(bx)} ${coaF(by)}" stroke="${P.text}" stroke-width="2.4" stroke-dasharray="7 5"/>`);
    const [lx, ly] = coaAt(cx, cy, COA_RING + 38, hdg);
    o.push(`<rect x="${coaF(lx - 37)}" y="${coaF(ly - 15)}" width="74" height="30" rx="8" fill="${P.plate}" stroke="${strong ? P.accent : P.edge}" stroke-width="1.4"/>`);
    o.push(coaText(lx, ly + 1, `${vm.fmt(c.heading)}°`, { size: 21, weight: 800, fill: P.text, family: 'mono' }));
  }
  // The shadow of the ship (sun by day, a full enough moon at night), beside it and under it.
  if (vm.shadow) {
    const L = Math.min(34, 6 + vm.shadow.len * 9);
    const [sx, sy] = coaAt(0, 0, L, scr(vm.shadow.dir));
    o.push(`<g transform="translate(${coaF(cx + sx)} ${coaF(cy + sy)}) rotate(${coaF(hdg)}) scale(${COA_SHIP_K})" opacity="${vm.shadow.moon ? 0.22 : 0.5}"><path d="${COA_HULL}" fill="#000" filter="url(#${id}-blur)"/></g>`);
  }
  o.push(`<g transform="translate(${coaF(cx)} ${coaF(cy)}) rotate(${coaF(hdg)}) scale(${COA_SHIP_K})">${coaShip(id)}</g>`);
  // The helicopter on the assault track, outside the ring where it comes from, flying towards the ship.
  {
    const a = scr(vm.at + 180);
    const [hx, hy] = coaAt(cx, cy, COA_RING + 4, a), [tx, ty] = coaAt(cx, cy, COA_RING - 34, a);
    o.push(`<path d="M${coaF(hx)} ${coaF(hy)}L${coaF(tx)} ${coaF(ty)}" stroke="${P.helo}" stroke-width="3" stroke-linecap="round"/>`);
    const [p1x, p1y] = coaAt(tx, ty, 14, a + 26), [p2x, p2y] = coaAt(tx, ty, 14, a - 26);
    o.push(`<path d="M${coaF(tx)} ${coaF(ty)}L${coaF(p1x)} ${coaF(p1y)}L${coaF(p2x)} ${coaF(p2y)}Z" fill="${P.helo}"/>`);
    o.push(`<circle cx="${coaF(hx)}" cy="${coaF(hy)}" r="9" fill="${P.helo}" stroke="${P.plate}" stroke-width="2.5"/>`);
  }
  // Where the apparent wind comes from, on the ring: a blue arrowhead pointing in.
  if (c.app.dir != null) {
    const a = scr(c.app.dir);
    const [ox, oy] = coaAt(cx, cy, COA_RING + 2, a), [ix, iy] = coaAt(cx, cy, COA_RING - 26, a);
    const [q1x, q1y] = coaAt(ix, iy, 16, a + 28), [q2x, q2y] = coaAt(ix, iy, 16, a - 28);
    o.push(`<path d="M${coaF(ox)} ${coaF(oy)}L${coaF(ix)} ${coaF(iy)}" stroke="${P.wind}" stroke-width="3.2" stroke-dasharray="5 4"/>`);
    o.push(`<path d="M${coaF(ix)} ${coaF(iy)}L${coaF(q1x)} ${coaF(q1y)}L${coaF(q2x)} ${coaF(q2y)}Z" fill="${P.wind}"/>`);
    o.push(`<circle cx="${coaF(ox)}" cy="${coaF(oy)}" r="6" fill="${P.wind}"/>`);
  }

  // Figures: title, the relative wind with its dial, then the helicopter, the approach and the sea.
  const mx = fx + col / 2, lx = fx + 22;
  let y = y0 + 40;
  o.push(coaText(lx, y, `COA ${c.n}`, { size: 34, weight: 800, fill: P.text, anchor: 'start', family: 'display' }));
  if (strong) {
    o.push(`<rect x="${fx + col - 92}" y="${y - 15}" width="72" height="30" rx="15" fill="${P.accent}"/>`);
    o.push(coaText(fx + col - 56, y + 1, 'BRC', { size: 17, weight: 800, fill: '#1a1200' }));
  }
  y += 34;
  o.push(coaText(lx, y, `Ship HDG ${dd(c.heading)}`, { size: 17, weight: 600, fill: P.muted, anchor: 'start' }));
  // The dial: the relative wind as a barb in a circle, the ship's bow as a tick at the top of it.
  y += 70;
  const R = 50;
  o.push(`<circle cx="${mx}" cy="${y}" r="${R}" fill="${P.compass}" stroke="${P.wind}" stroke-width="2.2"/>`);
  {
    const [bx, by] = coaAt(mx, y, R, hdg), [cx2, cy2] = coaAt(mx, y, R - 11, hdg);
    o.push(`<path d="M${coaF(bx)} ${coaF(by)}L${coaF(cx2)} ${coaF(cy2)}" stroke="${P.text}" stroke-width="3"/>`);
    o.push(`<g transform="translate(${coaF(mx)} ${coaF(y)}) rotate(${coaF(hdg)}) scale(0.34)" opacity="0.9"><path d="${COA_HALF_P}" fill="${P.port}"/><path d="${COA_HALF_S}" fill="${P.stbd}"/><path d="${COA_HULL}" fill="none" stroke="${P.plate}" stroke-width="3"/></g>`);
  }
  if (c.app.dir != null) o.push(coaBarb(mx, y, scr(c.app.dir), c.app.spd, R - 6, P.wind, 3.2));
  y += R + 30;
  o.push(coaText(mx, y, 'REL. WIND', { size: 15, weight: 800, fill: P.muted, extra: 'letter-spacing="2"' }));
  y += 32;
  o.push(coaText(mx, y, `${c.app.dir == null ? '---' : vm.fmt(c.app.dir)}°${ref} / ${Math.round(c.app.spd)} kt`, { size: 28, weight: 800, fill: P.wind, family: 'mono' }));
  y += 34;
  // Relative to the bow, with the knots: "G045 - 15 kt" (green, starboard) or "R120 - 8 kt" (red, port).
  const rc = c.rel ? (c.rel.side === 'G' ? P.stbd : c.rel.side === 'R' ? P.port : P.text) : P.muted;
  o.push(c.rel ? coaText(mx, y, coaRelText(c), { size: 26, weight: 800, fill: rc, family: 'mono' })
    : coaText(mx, y, 'CALM OVER DECK', { size: 18, weight: 800, fill: rc, extra: 'letter-spacing="1"' }));
  if (c.gust) { y += 28; o.push(coaText(mx, y, `Gust ${Math.round(c.gust.spd)} kt`, { size: 18, weight: 700, fill: P.muted })); }
  y += 22;
  o.push(`<path d="M${fx + 20} ${y}H${fx + col - 20}" stroke="${P.edge}" stroke-width="1"/>`);
  y += 26;
  o.push(coaText(lx, y, 'HELO ON AT', { size: 14, weight: 800, fill: P.helo, anchor: 'start', extra: 'letter-spacing="1.5"' }));
  y += 28;
  o.push(coaText(lx, y, coaHeloText(c.helo), { size: 20, weight: 700, fill: P.text, anchor: 'start' }));
  y += 28;
  o.push(coaText(lx, y, `Approach from ${c.approach.text}`, { size: 19, weight: 600, fill: P.text, anchor: 'start' }));
  if (c.sea) { y += 26; o.push(coaText(lx, y, c.sea.name, { size: 19, weight: 600, fill: P.muted, anchor: 'start' })); }
  return o.join('');
}

/* ---------- the compass in the middle ---------- */
function coaCompass(vm, P) {
  const cx = COA_W / 2, cy = COA_H / 2, R = 126;
  const up = vm.up, scr = (d) => d - up;
  const o = [];
  o.push(`<circle cx="${cx}" cy="${cy}" r="${R + 14}" fill="${P.bg}" opacity="0.92"/>`);
  o.push(`<circle cx="${cx}" cy="${cy}" r="${R}" fill="${P.compass}" stroke="${P.text}" stroke-opacity="0.75" stroke-width="2.6"/>`);
  for (let a = 0; a < 360; a += 5) {
    const long = a % 30 === 0, mid = a % 10 === 0;
    const [ax, ay] = coaAt(cx, cy, R, scr(a)), [bx, by] = coaAt(cx, cy, R - (long ? 16 : mid ? 10 : 6), scr(a));
    o.push(`<path d="M${coaF(ax)} ${coaF(ay)}L${coaF(bx)} ${coaF(by)}" stroke="${P.text}" stroke-opacity="${long ? 0.8 : 0.4}" stroke-width="${long ? 2 : 1}"/>`);
  }
  // Sun and moon (worked out first: a cardinal letter right where a body's plate goes is left out).
  const bodies = [];
  if (vm.sun) bodies.push({ k: 'sun', az: vm.sun.az, alt: vm.sun.alt, glare: vm.glareSun });
  if (vm.moon) bodies.push({ k: 'moon', az: vm.moon.az, alt: vm.moon.alt, glare: vm.glareMoon, frac: vm.moon.fraction });
  const near = (a, b, d) => Math.abs(((a - b + 540) % 360) - 180) < d;
  for (const [a, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
    if (bodies.some((b) => near(b.az, a, 16))) continue;
    const [lx, ly] = coaAt(cx, cy, R - 30, scr(a));
    o.push(coaText(lx, ly, t, { size: t === 'N' ? 26 : 18, weight: 800, fill: t === 'N' ? P.text : P.muted, family: 'display' }));
  }
  // North arrow.
  {
    const [tx, ty] = coaAt(cx, cy, R - 46, scr(0)), [l1x, l1y] = coaAt(cx, cy, 14, scr(0) - 90), [l2x, l2y] = coaAt(cx, cy, 14, scr(0) + 90);
    o.push(`<path d="M${coaF(tx)} ${coaF(ty)}L${coaF(l1x)} ${coaF(l1y)}L${coaF(l2x)} ${coaF(l2y)}Z" fill="${P.text}" opacity="0.9"/>`);
  }
  // The assault track: the helicopter coming in from the reciprocal, through the centre.
  {
    const [ax, ay] = coaAt(cx, cy, R - 4, scr(vm.at + 180)), [bx, by] = coaAt(cx, cy, R - 4, scr(vm.at));
    o.push(`<path d="M${coaF(ax)} ${coaF(ay)}L${coaF(bx)} ${coaF(by)}" stroke="${P.helo}" stroke-width="2.6" stroke-dasharray="9 6" opacity="0.9"/>`);
    const [p1x, p1y] = coaAt(bx, by, 16, scr(vm.at) + 180 + 26), [p2x, p2y] = coaAt(bx, by, 16, scr(vm.at) + 180 - 26);
    o.push(`<path d="M${coaF(bx)} ${coaF(by)}L${coaF(p1x)} ${coaF(p1y)}L${coaF(p2x)} ${coaF(p2y)}Z" fill="${P.helo}"/>`);
  }
  // Sun and moon on the rim, each with its height in a plate right against it (inside the rim), edged in
  // its own colour; red when it blinds on the approach. Two bodies close together: the second plate one
  // step further in, so they never cover each other.
  if (bodies.length === 2 && near(bodies[0].az, bodies[1].az, 30)) bodies[1].inner = true;
  for (const b of bodies) {
    const sa = scr(b.az);
    const [bx, by] = coaAt(cx, cy, R, sa);
    const below = b.alt < 0;
    const rb = b.k === 'sun' ? 13 : 12;
    if (b.glare) o.push(`<circle cx="${coaF(bx)}" cy="${coaF(by)}" r="21" fill="none" stroke="${P.warn}" stroke-width="3"/>`);
    // The plate: 54 x 24, its edge 5 units from the disc whatever the angle.
    const pw = 54, ph = 24;
    const ext = Math.abs(Math.sin((sa * Math.PI) / 180)) * (pw / 2) + Math.abs(Math.cos((sa * Math.PI) / 180)) * (ph / 2);
    const [tx, ty] = coaAt(cx, cy, R - rb - 5 - ext - (b.inner ? 2 * ext + 6 : 0), sa);
    const edge = b.glare ? P.warn : b.k === 'sun' ? P.sun : P.moon;
    o.push(`<rect x="${coaF(tx - pw / 2)}" y="${coaF(ty - ph / 2)}" width="${pw}" height="${ph}" rx="7" fill="${P.plate}" stroke="${edge}" stroke-width="2"/>`);
    o.push(coaText(tx, ty + 1, `${Math.round(b.alt)}°`, { size: 17, weight: 800, fill: b.glare ? P.warn : below ? P.muted : P.text, family: 'mono' }));
    if (b.k === 'sun') o.push(`<circle cx="${coaF(bx)}" cy="${coaF(by)}" r="${rb}" fill="${P.sun}" stroke="${P.plate}" stroke-width="2.5" opacity="${below ? 0.45 : 1}"/>`);
    else {
      o.push(`<circle cx="${coaF(bx)}" cy="${coaF(by)}" r="${rb}" fill="${P.moon}" stroke="${P.plate}" stroke-width="2.5" opacity="${below ? 0.45 : 1}"/>`);
      // The dark part of the disc, roughly as it shows.
      const f = b.frac == null ? 1 : b.frac;
      if (f < 0.97) o.push(`<ellipse cx="${coaF(bx + (vm.moon.waxing ? -1 : 1) * 12 * f)}" cy="${coaF(by)}" rx="${coaF(Math.max(1, 12 * (1 - f)))}" ry="12" fill="${P.compass}" opacity="${below ? 0.45 : 0.9}"/>`);
    }
  }
  // The true wind: a red barb from the centre towards where it comes from.
  if (vm.ws != null) o.push(coaBarb(cx, cy, scr(vm.wd), vm.ws, R - 22, P.twind, 4));
  o.push(`<circle cx="${cx}" cy="${cy}" r="5" fill="${P.text}"/>`);
  // Plates above and below the rim: the AT and the true wind.
  o.push(`<rect x="${cx - 86}" y="${cy - R - 50}" width="172" height="38" rx="12" fill="${P.plate}" stroke="${P.helo}" stroke-width="2"/>`);
  o.push(coaText(cx, cy - R - 30, `AT ${vm.fmt(vm.at)}°${vm.refText}`, { size: 23, weight: 800, fill: P.text, family: 'mono' }));
  const wv = `${vm.fmt(vm.wd)}°${vm.refText}/${Math.round(vm.ws)}${vm.gust ? 'G' + Math.round(vm.gust) : ''}kt`;
  const ww = 34 + wv.length * 12.4;
  o.push(`<rect x="${coaF(cx - ww / 2)}" y="${cy + R + 12}" width="${coaF(ww)}" height="38" rx="12" fill="${P.plate}" stroke="${P.twind}" stroke-width="2"/>`);
  o.push(coaText(cx, cy + R + 32, wv, { size: 21, weight: 800, fill: P.twind, family: 'mono' }));
  return o.join('');
}

// The whole board as SVG markup. `vm` is the worked-out picture (see coaModel in coa.js), `P` a palette.
function coaBoardSvg(vm, P, { id = 'coa', cls = '' } = {}) {
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${COA_W} ${COA_H}" class="${cls}" preserveAspectRatio="xMidYMid meet">`];
  o.push(`<defs>${coaShipDefs(id, P)}</defs>`);
  vm.coas.forEach((c, i) => o.push(coaCard(vm, c, i, P, id)));
  o.push(coaCompass(vm, P));
  if (vm.night) o.push(`<rect x="0" y="0" width="${COA_W}" height="${COA_H}" fill="none"/>`);
  o.push('</svg>');
  return o.join('');
}

/* ---------- the height cross-section ---------- */
// A side view of the airspace over the ship: each aircraft as a line at its height with its separation
// band (half the minimum above and below), so two bands that overlap are a conflict (red). The sea and the
// ship at the bottom, the height scale on the left. The same picture on the screen and on the A5 card.
function coaHeightSvg(rows, sep, bad, P, { w = 320, h = 168 } = {}) {
  const C = typeof COA_CALC !== 'undefined' ? COA_CALC : null;
  const ftOf = (v) => (C ? C.parseFt(v) : Number.isFinite(+v) ? +v : null);
  const list = (rows || []).map((r, i) => ({ i, ft: ftOf(r && r.alt), name: String((r && (r.cs || r.type)) || `Rij ${i + 1}`).trim().slice(0, 10) })).filter((r) => r.ft != null);
  if (!list.length) return '';
  const x0 = 42, x1 = w - 8, y0 = 10, y1 = h - 26;
  const maxFt = Math.max(...list.map((r) => r.ft));
  const step = maxFt + sep <= 1500 ? 250 : maxFt + sep <= 3000 ? 500 : maxFt + sep <= 8000 ? 1000 : 2000;
  const top = Math.max(1000, Math.ceil((maxFt + sep / 2 + step / 2) / step) * step);
  const Y = (ft) => y1 - (Math.max(0, ft) / top) * (y1 - y0);
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" font-family="${COA_FONTS.ui}">`];
  o.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="8" fill="${P.card}"/>`);
  // Height scale with grid lines.
  for (let ft = 0; ft <= top; ft += step) {
    const y = Y(ft);
    o.push(`<path d="M${x0} ${coaF(y)}H${x1}" stroke="${P.faint}" stroke-width="${ft ? 0.8 : 0}" ${ft ? 'stroke-dasharray="3 4"' : ''}/>`);
    if (ft) o.push(coaText(x0 - 6, y, ft >= 1000 && ft % 1000 === 0 ? `${ft / 1000}k` : String(ft), { size: 10, weight: 700, fill: P.muted, anchor: 'end', family: 'mono' }));
  }
  o.push(coaText(8, y0 + 2, 'ft', { size: 10, weight: 800, fill: P.muted, anchor: 'start' }));
  // The sea and the ship (side view, red and green halves) at the bottom.
  o.push(`<path d="M0 ${y1}H${w}V${h - 8}Q${w} ${h} ${w - 8} ${h}H8Q0 ${h} 0 ${h - 8}Z" fill="${P.wind}" fill-opacity="0.16"/>`);
  o.push(`<path d="M0 ${y1}H${w}" stroke="${P.wind}" stroke-width="1.6"/>`);
  const sx = (x0 + x1) / 2;
  o.push(`<path d="M${sx - 26} ${y1 - 7}H${sx}V${y1 + 5}H${sx - 21}Z" fill="${P.port}"/><path d="M${sx} ${y1 - 7}H${sx + 30}L${sx + 23} ${y1 + 5}H${sx}Z" fill="${P.stbd}"/>`);
  o.push(coaText(x0, h - 12, 'SFC / ship', { size: 10, weight: 700, fill: P.muted, anchor: 'start' }));
  o.push(coaText(x1, h - 12, `min. ${sep} ft`, { size: 10, weight: 700, fill: P.muted, anchor: 'end' }));
  // Bands first, then the lines, then the labels (moved apart where they would overlap, with a leader).
  const items = list.map((r) => ({ ...r, y: Y(r.ft), bad: bad && bad.has(r.i) })).sort((a, b) => a.y - b.y);
  for (const r of items) {
    const ya = Y(r.ft + sep / 2), yb = Y(r.ft - sep / 2);
    o.push(`<rect x="${x0}" y="${coaF(ya)}" width="${x1 - x0}" height="${coaF(Math.max(1, yb - ya))}" fill="${r.bad ? P.warn : P.wind}" fill-opacity="${r.bad ? 0.2 : 0.1}"/>`);
  }
  for (const r of items) o.push(`<path d="M${x0} ${coaF(r.y)}H${x1}" stroke="${r.bad ? P.warn : P.wind}" stroke-width="2.4" stroke-linecap="round"/>`);
  const gap = 14;
  for (let k = 0; k < items.length; k += 1) items[k].ly = Math.max(items[k].y, k ? items[k - 1].ly + gap : y0 + 6);
  for (let k = items.length - 1; k >= 0; k -= 1) items[k].ly = Math.min(items[k].ly, k < items.length - 1 ? items[k + 1].ly - gap : y1 - 8);
  for (const r of items) {
    const label = `${r.name} ${r.ft}`;
    const lw = 12 + label.length * 6.1, lx = x0 + 6;
    if (Math.abs(r.ly - r.y) > 1) o.push(`<path d="M${coaF(lx + lw)} ${coaF(r.ly)}L${coaF(lx + lw + 10)} ${coaF(r.y)}" stroke="${r.bad ? P.warn : P.muted}" stroke-width="1"/>`);
    o.push(`<rect x="${coaF(lx)}" y="${coaF(r.ly - 7)}" width="${coaF(lw)}" height="14" rx="4" fill="${P.plate}" stroke="${r.bad ? P.warn : P.edge}" stroke-width="1"/>`);
    o.push(coaText(lx + 6, r.ly + 0.5, r.name, { size: 10, weight: 800, fill: r.bad ? P.warn : P.text, anchor: 'start' }));
    o.push(coaText(lx + lw - 5, r.ly + 0.5, String(r.ft), { size: 10, weight: 800, fill: r.bad ? P.warn : P.wind, anchor: 'end', family: 'mono' }));
  }
  o.push('</svg>');
  return o.join('');
}

/* ---------- drawings on the board ---------- */
// The elements drawn on top (see the drawing layer in coa.js), as SVG: path (pts, color, width, marker),
// line (x1 y1 x2 y2, arrow, dash), rect and ellipse (x y w h, fill), text (x y text size), icon (x y icon size).
function coaMarkSvg(e, P) {
  const col = e.color || P.text, wd = e.width || 4;
  const ff = COA_FONTS.ui;
  if (e.type === 'path') {
    const pts = e.pts || [];
    if (!pts.length) return '';
    let d = `M${coaF(pts[0][0])} ${coaF(pts[0][1])}`;
    if (pts.length < 3) d += pts.slice(1).map((p) => `L${coaF(p[0])} ${coaF(p[1])}`).join('') + (pts.length === 1 ? `l0.1 0` : '');
    else { for (let i = 1; i < pts.length - 1; i += 1) { const a = pts[i], b = pts[i + 1]; d += `Q${coaF(a[0])} ${coaF(a[1])} ${coaF((a[0] + b[0]) / 2)} ${coaF((a[1] + b[1]) / 2)}`; } const l = pts[pts.length - 1]; d += `L${coaF(l[0])} ${coaF(l[1])}`; }
    return `<path d="${d}" fill="none" stroke="${col}" stroke-width="${coaF(e.marker ? wd * 3 : wd)}" stroke-opacity="${e.marker ? 0.4 : 1}" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  if (e.type === 'line') {
    let out = `<path d="M${coaF(e.x1)} ${coaF(e.y1)}L${coaF(e.x2)} ${coaF(e.y2)}" stroke="${col}" stroke-width="${wd}" stroke-linecap="round" ${e.dash ? `stroke-dasharray="${wd * 3} ${wd * 2}"` : ''}/>`;
    const head = (fx, fy, tx, ty) => { const a = Math.atan2(ty - fy, tx - fx), L = Math.max(14, wd * 3.6); return `<path d="M${coaF(tx)} ${coaF(ty)}L${coaF(tx - L * Math.cos(a - 0.45))} ${coaF(ty - L * Math.sin(a - 0.45))}L${coaF(tx - L * Math.cos(a + 0.45))} ${coaF(ty - L * Math.sin(a + 0.45))}Z" fill="${col}"/>`; };
    if (e.arrow === 'end' || e.arrow === 'both') out += head(e.x1, e.y1, e.x2, e.y2);
    if (e.arrow === 'both') out += head(e.x2, e.y2, e.x1, e.y1);
    return out;
  }
  if (e.type === 'rect' || e.type === 'ellipse') {
    const x = Math.min(e.x, e.x + e.w), y = Math.min(e.y, e.y + e.h), w = Math.abs(e.w), hh = Math.abs(e.h);
    const fill = e.fill ? `fill="${col}" fill-opacity="0.25"` : 'fill="none"';
    return e.type === 'rect' ? `<rect x="${coaF(x)}" y="${coaF(y)}" width="${coaF(w)}" height="${coaF(hh)}" rx="6" ${fill} stroke="${col}" stroke-width="${wd}"/>`
      : `<ellipse cx="${coaF(x + w / 2)}" cy="${coaF(y + hh / 2)}" rx="${coaF(w / 2)}" ry="${coaF(hh / 2)}" ${fill} stroke="${col}" stroke-width="${wd}"/>`;
  }
  if (e.type === 'text') {
    const lines = String(e.text || '').split('\n');
    return lines.map((l, i) => `<text x="${coaF(e.x)}" y="${coaF(e.y + (i + 0.8) * e.size * 1.25)}" font-size="${e.size}" font-weight="700" font-family="${ff}" fill="${col}" stroke="${P.plate}" stroke-width="${coaF(e.size * 0.16)}" paint-order="stroke" stroke-linejoin="round">${coaEsc(l)}</text>`).join('');
  }
  if (e.type === 'icon' && typeof wbIconById === 'function') {
    const ic = wbIconById(e.icon);
    if (!ic) return '';
    const s = e.size || 80;
    return `<g${e.rot ? ` transform="rotate(${coaF(e.rot)} ${coaF(e.x)} ${coaF(e.y)})"` : ''} color="${col}" style="color:${col}"><svg x="${coaF(e.x - s / 2)}" y="${coaF(e.y - s / 2)}" width="${s}" height="${s}" viewBox="0 0 64 64" overflow="visible">${ic.svg}</svg></g>`
      + (e.label ? `<text x="${coaF(e.x)}" y="${coaF(e.y + s / 2 + 18)}" font-size="18" font-weight="800" text-anchor="middle" font-family="${ff}" fill="${col}" stroke="${P.plate}" stroke-width="3" paint-order="stroke">${coaEsc(e.label)}</text>` : '');
  }
  return '';
}
