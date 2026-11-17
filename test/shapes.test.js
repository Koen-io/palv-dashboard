'use strict';

// Shape recognition (src/renderer/shapes.js). Strokes are synthesised the way a hand draws them: a
// perfect outline, slightly rounded corners, a random start on the outline, either direction, smooth
// wobble of 1-4% of the size plus tremor, uneven speed, a small hook at the start and an overshoot of
// 5-15% past the start for closed shapes. Every class is drawn 100 times (three sizes, three zoom
// levels) and must be recognised at least 95% of the time; scribbles may not become closed shapes.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/renderer/shapes.js');

const RAD = Math.PI / 180;
const VERBOSE = !!process.env.SHAPES_VERBOSE;

/* ---------- stroke generator ---------- */
function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const rotP = (P, a) => P.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
const scaleP = (P, s) => P.map(([x, y]) => [x * s, y * s]);
const ell = (rx, ry, n = 360) => Array.from({ length: n }, (_, i) => [rx * Math.cos((i / n) * 2 * Math.PI), ry * Math.sin((i / n) * 2 * Math.PI)]);
const ngon = (k, R, ph = -90) => Array.from({ length: k }, (_, i) => [R * Math.cos((ph + (i * 360) / k) * RAD), R * Math.sin((ph + (i * 360) / k) * RAD)]);

// Points every `step` along a polyline (closed: back to the first point).
function densify(V, closed, step) {
  const W = closed ? V.concat([V[0]]) : V, out = [];
  for (let i = 0; i + 1 < W.length; i++) {
    const m = Math.max(1, Math.ceil(dist(W[i], W[i + 1]) / step));
    for (let j = 0; j < m; j++) out.push([W[i][0] + ((W[i + 1][0] - W[i][0]) * j) / m, W[i][1] + ((W[i + 1][1] - W[i][1]) * j) / m]);
  }
  if (!closed) out.push(W[W.length - 1]);
  return out;
}
// Round the corners: moving average over `r` (in the outline's units) of evenly spaced points.
function roundCorners(P, closed, r, step) {
  const h = Math.round(r / step);
  if (h < 1) return P;
  const n = P.length;
  return P.map((p, i) => {
    let sx = 0, sy = 0, c = 0;
    for (let j = i - h; j <= i + h; j++) {
      if (!closed && (j < 0 || j >= n)) continue;
      const q = P[((j % n) + n) % n];
      sx += q[0]; sy += q[1]; c++;
    }
    return [sx / c, sy / c];
  });
}
// One hand-drawn stroke of `outline` (size ~ `size` px), returned in board units for `scale`.
function draw(outline, o) {
  const R = o.rnd, size = o.size, step = size / 500;
  let O = densify(outline, o.closed, step);
  O = roundCorners(O, o.closed, size * (o.round != null ? o.round : R() * 0.03), step);
  if (o.dir < 0) O.reverse();
  if (o.closed) {
    const s = Math.floor(R() * O.length), ov = o.overshoot != null ? o.overshoot : 0.05 + R() * 0.1;
    O = O.slice(s).concat(O.slice(0, s));
    O = O.concat(O.slice(0, Math.round(O.length * ov) + 1));
  }
  const cum = [0];
  for (let i = 1; i < O.length; i++) cum[i] = cum[i - 1] + dist(O[i - 1], O[i]);
  // Wobble frequencies are in cycles per pi * size (once round a circle), so a line is not wavier than a circle.
  const total = cum[cum.length - 1], per = Math.PI * size;
  const amp = size * (o.jitter != null ? o.jitter : 0.01 + R() * 0.03);
  // Slow wobble carries the size-relative jitter; the faster tremor is limited by its wavelength.
  const comps = [[1 + 2 * R(), 0.4], [1 + 2 * R(), 0.4], [4 + 4 * R(), 0.2]].map(([f, w]) => {
    const a = Math.min(amp * w, f > 3 ? (0.015 * per) / f : Infinity);
    return { f, ax: a * R() * 2, ay: a * R() * 2, px: R() * 6.3, py: R() * 6.3 };
  });
  const spd = [1 + R() * 3, R() * 6.3];
  const out = [];
  let k = 0;
  for (let s = 0; s <= total; ) {
    while (k < O.length - 2 && cum[k + 1] < s) k++;
    const t = (s - cum[k]) / (cum[k + 1] - cum[k] || 1), u = s / per;
    let x = O[k][0] + t * (O[k + 1][0] - O[k][0]), y = O[k][1] + t * (O[k + 1][1] - O[k][1]);
    for (const c of comps) { x += c.ax * Math.sin(2 * Math.PI * c.f * u + c.px); y += c.ay * Math.sin(2 * Math.PI * c.f * u + c.py); }
    x += (R() - 0.5) * 0.8; y += (R() - 0.5) * 0.8;
    out.push([x, y]);
    if (R() < 0.04) out.push([x + (R() - 0.5) * 0.5, y + (R() - 0.5) * 0.5]); // a pause
    s += 1.5 * (1 + 1.5 * (0.5 + 0.5 * Math.sin(2 * Math.PI * spd[0] * u + spd[1])));
  }
  if (o.hook !== false && out.length > 3) {
    // A small curl where the finger lands, joining the stroke from the side.
    const p0 = out[0], d = [out[3][0] - p0[0], out[3][1] - p0[1]], dl = Math.hypot(d[0], d[1]) || 1, u = [d[0] / dl, d[1] / dl];
    const hl = size * (0.02 + R() * 0.02), side = R() < 0.5 ? 1 : -1, a = (100 + R() * 50) * RAD * side;
    const H = [p0[0] + hl * (u[0] * Math.cos(a) - u[1] * Math.sin(a)), p0[1] + hl * (u[0] * Math.sin(a) + u[1] * Math.cos(a))];
    const C = [p0[0] - u[0] * hl * 0.3, p0[1] - u[1] * hl * 0.3], hook = [];
    for (let i = 0; i < 6; i++) {
      const t = i / 6;
      hook.push([(1 - t) * (1 - t) * H[0] + 2 * t * (1 - t) * C[0] + t * t * p0[0], (1 - t) * (1 - t) * H[1] + 2 * t * (1 - t) * C[1] + t * t * p0[1]]);
    }
    out.unshift(...hook);
  }
  const ox = (R() - 0.5) * 1000, oy = (R() - 0.5) * 1000;
  return out.map(([x, y]) => [(x + ox) / o.scale, (y + oy) / o.scale]);
}

/* ---------- the shapes, each with its check ---------- */
const SIZES = [60, 150, 400], SCALES = [0.5, 1, 2];
const isPoly = (shape) => (r) => r && r.kind === 'polygon' && r.shape === shape;
const CLASSES = {
  circle: { closed: true, make: (R) => ell(0.5, 0.5), ok: (r) => r && r.kind === 'ellipse' && r.circle },
  ellipse: { closed: true, make: (R) => rotP(ell(0.5, 0.5 / (1.5 + R())), R() * 6.3), ok: (r) => r && r.kind === 'ellipse' && !r.circle },
  square: { closed: true, make: (R) => rotP([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], R() * 6.3), ok: (r) => r && r.kind === 'rect' && r.square },
  rect: { closed: true, make: (R) => { const h = 0.5 / (1.5 + R()); return rotP([[-0.5, -h], [0.5, -h], [0.5, h], [-0.5, h]], R() * 6.3); }, ok: (r) => r && r.kind === 'rect' && !r.square },
  triangle: {
    closed: true,
    make: (R) => { for (;;) { const P = [[R(), R()], [R(), R()], [R(), R()]]; const A = angles(P); if (Math.min(...A) >= 30 && area(P) > 0.08) return P; } },
    ok: isPoly('triangle'),
  },
  equilateral: { closed: true, make: (R) => rotP(ngon(3, 0.55), R() * 6.3), ok: (r) => isPoly('triangle')(r) && r.variant === 'equilateral' },
  diamond: { closed: true, make: (R) => rotP([[0, -0.5], [0.5 / (1.4 + 0.4 * R()), 0], [0, 0.5], [-0.5 / (1.4 + 0.4 * R()), 0]], (R() - 0.5) * 6 * RAD), ok: isPoly('diamond') },
  parallelogram: { closed: true, make: (R) => { const k = Math.tan((25 + R() * 10) * RAD) * 0.35; return rotP([[-0.5 + k, -0.35], [0.5 + k, -0.35], [0.5 - k, 0.35], [-0.5 - k, 0.35]], R() * 6.3); }, ok: isPoly('parallelogram') },
  trapezoid: { closed: true, make: (R) => { const t = 0.15 + R() * 0.1; return rotP([[-t, -0.35], [t, -0.35], [0.5, 0.35], [-0.5, 0.35]], R() * 6.3); }, ok: isPoly('trapezoid') },
  pentagon: { closed: true, make: (R) => ngon(5, 0.5, R() * 360), ok: (r) => isPoly('pentagon')(r) && r.regular },
  hexagon: { closed: true, make: (R) => ngon(6, 0.5, R() * 360), ok: (r) => isPoly('hexagon')(r) && r.regular },
  octagon: { closed: true, make: (R) => ngon(8, 0.5, R() * 360), ok: (r) => isPoly('octagon')(r) && r.regular },
  pentagram: { closed: true, round: 0.005, make: (R) => { const t = ngon(5, 0.5, R() * 360); return [0, 2, 4, 1, 3].map((i) => t[i]); }, ok: isPoly('star') },
  starOutline: { closed: true, round: 0.005, make: (R) => { const ph = R() * 360; return Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 0.5 * 0.382 : 0.5, a = (ph + i * 36) * RAD; return [r * Math.cos(a), r * Math.sin(a)]; }); }, ok: isPoly('star') },
  line: { closed: false, make: (R) => rotP([[0, 0], [1, 0]], R() * 6.3), ok: (r) => r && r.kind === 'line' },
  arc: { closed: false, make: (R) => { const sw = (45 + R() * 225) * RAD, a0 = R() * 6.3; const rr = 0.5 / Math.max(Math.sin(Math.min(sw, Math.PI) / 2), 0.4); return Array.from({ length: 200 }, (_, i) => [rr * Math.cos(a0 + (sw * i) / 199), rr * Math.sin(a0 + (sw * i) / 199)]); }, ok: (r) => r && r.kind === 'arc' },
  lShape: { closed: false, make: (R) => rotP([[0, 0], [0, 0.6 + 0.4 * R()], [0.5 + 0.5 * R(), 0.6 + 0.4 * R()]].map((p, i, a) => (i === 2 ? [p[0], a[1][1]] : p)), R() * 6.3), ok: (r) => r && r.kind === 'polyline' && r.pts.length === 3 },
  vShape: { closed: false, make: (R) => { const a = (35 + R() * 50) * RAD; return rotP([[-Math.sin(a / 2), -Math.cos(a / 2)], [0, 0], [Math.sin(a / 2), -Math.cos(a / 2)]], R() * 6.3); }, ok: (r) => r && r.kind === 'polyline' && r.pts.length === 3 },
  zigzag: { closed: false, make: (R) => { const k = 3 + Math.floor(R() * 3); return { k, P: rotP(Array.from({ length: k + 2 }, (_, i) => [i / (k + 1), i % 2 ? 0.35 : 0]), R() * 6.3) }; }, ok: (r, m) => r && r.kind === 'polyline' && r.pts.length === m.k + 2 },
  arrow: { closed: false, make: (R) => { const a = (25 + R() * 15) * RAD, b = 0.2 + R() * 0.1; return rotP([[0, 0], [1, 0], [1 - b * Math.cos(a), -b * Math.sin(a)], [1, 0], [1 - b * Math.cos(a), b * Math.sin(a)]], R() * 6.3); }, ok: (r) => r && r.kind === 'arrow' },
};
function angles(P) {
  return P.map((p, i) => {
    const a = P[(i + 2) % 3], b = P[(i + 1) % 3], u = [a[0] - p[0], a[1] - p[1]], v = [b[0] - p[0], b[1] - p[1]];
    return (Math.acos((u[0] * v[0] + u[1] * v[1]) / Math.hypot(...u) / Math.hypot(...v)) * 180) / Math.PI;
  });
}
const area = (P) => Math.abs((P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1])) / 2;

// Draw one class `n` times; returns { ok, n, fails: [{ seed, got }] }.
function run(name, n = 100, extra = {}) {
  const C = CLASSES[name], fails = [];
  let ok = 0;
  for (let seed = 1; seed <= n; seed++) {
    const R = rng(seed * 7919 + name.length * 31 + name.charCodeAt(0));
    const made = C.make(R), outline = made.P || made, size = SIZES[seed % 3], scale = SCALES[Math.floor(seed / 3) % 3];
    const pts = draw(scaleP(outline, size), { closed: C.closed, size, scale, rnd: R, dir: seed % 2 ? 1 : -1, round: C.round, ...extra });
    const r = S.recognize(pts, { scale });
    if (C.ok(r, made)) ok++;
    else fails.push({ seed, got: r ? `${r.kind}/${r.shape || ''}${r.variant ? '/' + r.variant : ''}${r.square ? '/sq' : ''}${r.circle ? '/c' : ''}${r.pts ? '/' + r.pts.length : ''}` : 'null' });
  }
  if (VERBOSE && fails.length) console.log(name, fails.slice(0, 12).map((f) => `${f.seed}:${f.got}`).join(' '));
  return { ok, n, fails };
}

/* ---------- accuracy per class ---------- */
test('vormherkenning: elke vorm in minstens 95% van 100 handgetekende varianten', (t) => {
  const rows = [];
  for (const name of Object.keys(CLASSES)) {
    const r = run(name);
    rows.push([name, r.ok / r.n]);
    t.diagnostic(`${name.padEnd(14)} ${((100 * r.ok) / r.n).toFixed(0).padStart(3)}%`);
  }
  for (const [name, acc] of rows) assert.ok(acc >= 0.95, `${name}: ${(acc * 100).toFixed(0)}%`);
});

/* ---------- negatives ---------- */
function catmull(C, per = 20) {
  const out = [];
  for (let i = 1; i + 2 < C.length; i++) {
    const [p0, p1, p2, p3] = [C[i - 1], C[i], C[i + 1], C[i + 2]];
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((d) => 0.5 * (2 * p1[d] + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3)));
    }
  }
  return out;
}
const NEG = {
  scribble: (R) => catmull(Array.from({ length: 8 + Math.floor(R() * 8) }, () => [R(), R()])),
  spiral: (R) => { const turns = 2 + R() * 1.5; return Array.from({ length: 400 }, (_, i) => { const a = (i / 399) * turns * 2 * Math.PI, r = 0.05 + (0.45 * i) / 399; return [r * Math.cos(a), r * Math.sin(a)]; }); },
  wSquiggle: (R) => Array.from({ length: 300 }, (_, i) => { const t = i / 299; return [t + 0.06 * Math.sin(t * 8 * Math.PI), 0.3 * Math.abs(Math.cos(t * 2 * Math.PI)) + 0.08 * Math.cos(t * 8 * Math.PI)]; }),
  cursive: (R) => Array.from({ length: 400 }, (_, i) => { const t = (i / 399) * (4 + R() * 2) * 2 * Math.PI; return [t / 20 - 0.12 * Math.sin(t), -0.25 * Math.cos(t)]; }),
  zigzag9: (R) => Array.from({ length: 11 }, (_, i) => [i / 10, i % 2 ? 0.3 : 0]),
};
test('vormherkenning: krabbels, spiraal, tekst en een zigzag worden geen gesloten vorm', (t) => {
  for (const [name, make] of Object.entries(NEG)) {
    let closed = 0, any = 0;
    for (let seed = 1; seed <= 100; seed++) {
      const R = rng(seed * 104729 + name.length), size = SIZES[seed % 3], scale = SCALES[Math.floor(seed / 3) % 3];
      const pts = draw(rotP(scaleP(make(R), size), R() * 6.3), { closed: false, size, scale, rnd: R, dir: seed % 2 ? 1 : -1 });
      const r = S.recognize(pts, { scale });
      if (r) any++;
      if (r && ['ellipse', 'rect', 'polygon'].includes(r.kind)) closed++;
    }
    t.diagnostic(`${name.padEnd(10)} gesloten ${closed}%, iets herkend ${any}%`);
    assert.ok(closed <= 5, `${name}: ${closed}% gesloten vormen`);
    if (name === 'spiral' || name === 'zigzag9' || name === 'scribble') assert.ok(any <= 10, `${name}: ${any}% herkend`);
  }
});

/* ---------- confusion pairs ---------- */
function once(outline, closed, seed, extra = {}) {
  const R = rng(seed), size = SIZES[seed % 3], scale = SCALES[Math.floor(seed / 3) % 3];
  return S.recognize(draw(scaleP(outline, size), { closed, size, scale, rnd: R, dir: seed % 2 ? 1 : -1, ...extra }), { scale });
}
function rate(fn) { let ok = 0; for (let seed = 1; seed <= 100; seed++) if (fn(seed)) ok++; return ok / 100; }
function roundedSquare(rr) {
  const P = [];
  for (const [cx, cy, a0] of [[0.5 - rr, 0.5 - rr, 0], [-0.5 + rr, 0.5 - rr, 90], [-0.5 + rr, -0.5 + rr, 180], [0.5 - rr, -0.5 + rr, 270]]) for (let i = 0; i <= 10; i++) { const a = (a0 + i * 9) * RAD; P.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); }
  return P;
}
test('vormherkenning: cirkel tegenover vierkant met ronde hoeken', () => {
  assert.ok(rate((s) => { const r = once(ell(0.5, 0.5), true, s); return r && r.kind === 'ellipse' && r.circle; }) >= 0.95);
  assert.ok(rate((s) => { const r = once(roundedSquare(0.15), true, s + 500, { jitter: 0.02 }); return r && r.kind === 'rect' && r.square; }) >= 0.9);
});
test('vormherkenning: ellips tegenover rechthoek met dezelfde verhouding', () => {
  assert.ok(rate((s) => { const r = once(ell(0.5, 0.3), true, s); return r && r.kind === 'ellipse' && !r.circle && Math.abs(r.rx / r.ry - 0.5 / 0.3) < 0.3; }) >= 0.95);
  assert.ok(rate((s) => { const r = once([[-0.5, -0.3], [0.5, -0.3], [0.5, 0.3], [-0.5, 0.3]], true, s); return r && r.kind === 'rect' && r.rot === 0 && Math.abs(r.w / r.h - 0.5 / 0.3) < 0.3; }) >= 0.95);
});
test('vormherkenning: driehoek tegenover boog', () => {
  const tri = ngon(3, 0.55), arc = Array.from({ length: 200 }, (_, i) => [0.5 * Math.cos((200 + (i / 199) * 230) * RAD), 0.5 * Math.sin((200 + (i / 199) * 230) * RAD)]);
  assert.ok(rate((s) => { const r = once(tri, true, s); return isPoly('triangle')(r); }) >= 0.95);
  assert.ok(rate((s) => { const r = once(arc, false, s); return r && r.kind === 'arc' && Math.abs(Math.abs(r.sweep) - 230) < 25; }) >= 0.95);
});
test('vormherkenning: rechte lijn tegenover een vlakke boog', () => {
  const flat = Array.from({ length: 200 }, (_, i) => { const a = (-30 + (i / 199) * 60) * RAD; return [Math.sin(a), -Math.cos(a)]; });
  assert.ok(rate((s) => { const r = once([[0, 0], [1, 0]], false, s, { jitter: 0.015 }); return r && r.kind === 'line'; }) >= 0.95);
  assert.ok(rate((s) => { const r = once(flat, false, s, { jitter: 0.01 }); return r && r.kind === 'arc'; }) >= 0.9);
});
test('vormherkenning: vierkant recht, vierkant op de punt (ruit)', () => {
  const sq = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  assert.ok(rate((s) => { const r = once(rotP(sq, ((s % 7) - 3) * RAD), true, s); return r && r.kind === 'rect' && r.square && r.rot === 0 && r.name === 'vierkant'; }) >= 0.95);
  assert.ok(rate((s) => { const r = once(rotP(sq, (45 + (s % 5) - 2) * RAD), true, s); return r && r.kind === 'rect' && r.square && r.rot === 45 && r.name === 'ruit'; }) >= 0.95);
});

/* ---------- exact output ---------- */
test('vormherkenning: uitvoer van schone vormen', () => {
  const sq = S.recognize(densify([[100, 100], [300, 100], [300, 300], [100, 300]], true, 1.5).concat([[100, 100], [130, 100]]), { scale: 1 });
  assert.strictEqual(sq.kind, 'rect');
  assert.deepStrictEqual([sq.cx, sq.cy, sq.w, sq.h, sq.rot, sq.square, sq.name], [200, 200, 200, 200, 0, true, 'vierkant']);
  assert.deepStrictEqual(sq.pts, [[100, 100], [300, 100], [300, 300], [100, 300]], 'met de klok mee vanaf het begin');
  const c = S.recognize(ell(80, 80).map(([x, y]) => [x + 10, y + 20]).concat([[90, 20]]), { scale: 1 });
  assert.strictEqual(c.kind, 'ellipse');
  assert.ok(c.circle && Math.abs(c.rx - 80) < 1 && Math.abs(c.cx - 10) < 0.5 && Math.abs(c.cy - 20) < 0.5);
  // Lines snap to multiples of 45 degrees within 4 degrees, and not beyond.
  const l = S.recognize(densify([[0, 0], [200, 7]], false, 1.5), { scale: 1 });
  assert.strictEqual(l.kind, 'line');
  assert.ok(Math.abs(l.y1 - l.y2) < 1e-6, 'waterpas');
  const l2 = S.recognize(densify([[0, 0], [200, 30]], false, 1.5), { scale: 1 });
  assert.ok(Math.abs(l2.y2 - l2.y1) > 20, 'schuin blijft schuin');
  // An arc: 24-48 points on the circle from start to end.
  const a = S.recognize(Array.from({ length: 300 }, (_, i) => [100 * Math.cos((i / 299) * Math.PI), 100 * Math.sin((i / 299) * Math.PI)]), { scale: 1 });
  assert.strictEqual(a.kind, 'arc');
  assert.ok(a.pts.length >= 24 && a.pts.length <= 48);
  assert.ok(dist(a.pts[0], [100, 0]) < 1 && dist(a.pts[a.pts.length - 1], [-100, 0]) < 1);
  for (const p of a.pts) assert.ok(Math.abs(Math.hypot(p[0], p[1]) - 100) < 1);
  // The star outline: ten points, alternating outer and inner radius.
  const st = S.recognize(densify([0, 2, 4, 1, 3, 0].map((i) => [100 * Math.cos((-90 + i * 72) * RAD), 100 * Math.sin((-90 + i * 72) * RAD)]), false, 1.5).concat([[20, -75]]), { scale: 1 });
  assert.strictEqual(st.shape, 'star');
  assert.strictEqual(st.pts.length, 10);
  assert.ok(Math.abs(Math.hypot(...st.pts[0]) - 100) < 3 && Math.abs(st.pts[0][0]) < 1 && st.pts[0][1] < 0, 'een punt recht omhoog');
  // Nothing from too few points or a dot.
  assert.strictEqual(S.recognize([[0, 0], [1, 1]], { scale: 1 }), null);
  assert.strictEqual(S.recognize(Array.from({ length: 50 }, (_, i) => [i % 3, i % 2]), { scale: 1 }), null);
});
test('vormherkenning: closedOnly en allow', () => {
  const line = densify([[0, 0], [200, 0]], false, 1.5), sq = densify([[0, 0], [200, 0], [200, 200], [0, 200]], true, 1.5).concat([[0, 0], [20, 0]]);
  assert.strictEqual(S.recognize(line, { scale: 1, closedOnly: true }), null);
  assert.strictEqual(S.recognize(line, { scale: 1, allow: ['ellipse'] }), null);
  assert.strictEqual(S.recognize(sq, { scale: 1, allow: ['rect'] }).kind, 'rect');
  assert.strictEqual(S.recognize(sq, { scale: 1, allow: ['line', 'ellipse'] }), null);
  // Board units: the same stroke at zoom 2 gives half the size.
  const r = S.recognize(sq.map(([x, y]) => [x / 2, y / 2]), { scale: 2 });
  assert.strictEqual(r.w, 100);
});
test('vormherkenning: snel genoeg (600 punten < 2 ms)', () => {
  const R = rng(5), pts = draw(scaleP(ngon(6, 0.5), 600), { closed: true, size: 600, scale: 1, rnd: R, dir: 1 }).slice(0, 600);
  for (let i = 0; i < 20; i++) S.recognize(pts, { scale: 1 });
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 100; i++) S.recognize(pts, { scale: 1 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 100;
  assert.ok(ms < 2, `${ms.toFixed(2)} ms`);
});

test('vormherkenning: een trillende rechte streep wordt een lijn', () => {
  const S = require('../src/renderer/shapes.js');
  const jit = (s) => ((Math.sin(s * 12.9898) * 43758.5453) % 1) * 3;
  const pts = Array.from({ length: 40 }, (_, i) => [100 + (200 * i) / 39 + jit(i), 100 + (150 * i) / 39 + jit(i + 3)]);
  const r = S.recognize(pts, { scale: 1 });
  require('node:assert').strictEqual(r && r.kind, 'line');
});

test('vormherkenning: trillende lijnen in alle richtingen en lengtes worden recht', () => {
  const S = require('../src/renderer/shapes.js');
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const [amp, L, min] of [[2, 60, 0.95], [3, 120, 0.9], [4, 120, 0.85], [4, 300, 0.95], [6, 300, 0.95]]) {
    let ok = 0;
    for (let t = 0; t < 60; t += 1) {
      const a = rnd() * Math.PI * 2, n = Math.max(12, Math.round(L / 4)), ph = rnd() * 6, f = 2 + rnd() * 4;
      const pts = Array.from({ length: n }, (_, i) => { const u = i / (n - 1); const off = amp * (0.6 * Math.sin(u * f * Math.PI * 2 + ph) + 0.8 * (rnd() * 2 - 1)); return [100 + u * L * Math.cos(a) - off * Math.sin(a), 100 + u * L * Math.sin(a) + off * Math.cos(a)]; });
      const r = S.recognize(pts, { scale: 1 });
      if (r && r.kind === 'line') ok += 1;
    }
    require('node:assert').ok(ok / 60 >= min, `trilling ${amp}px op ${L}px: ${Math.round((ok / 60) * 100)}%`);
  }
});
