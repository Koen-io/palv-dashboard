'use strict';

/* ============================================================
   Shape recognition for "hold to snap": a hand-drawn stroke becomes a clean line, arc, polyline, arrow,
   ellipse, rectangle, polygon or star. Pure geometry without DOM, so it runs under `node --test`.
   recognize(pts, { scale, closedOnly, allow }) -> shape or null. Board units in and out; tolerances are
   screen pixels divided by `scale` (pixels per board unit). A miss (null) is better than a wrong shape.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DK_SHAPES = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEG = 180 / Math.PI, RAD = Math.PI / 180;
  const N = 128; // points after resampling (open stroke and closed loop)

  // Fit limits (errors are mean distances divided by the bounding diagonal).
  const T = {
    closeFrac: 0.15, closePx: 25, // ends this close: closed
    hookFrac: 0.05, hookPx: 12, hookMax: 0.08, hookAng: 60, // start/end hooks to cut
    cornerAng: 28, sharp: 18, // minimum turn and sharpness of a corner
    polyErr: 0.03, ellErr: 0.03, // closed fits
    lineMax: 0.075, lineRms: 0.03, arcRms: 0.05, segRms: 0.05, // open fits
    snapLine: 4, snapRot: 6, round: 0.12, // snapping
    winPx: 5, // smallest corner window (screen px), against pointer noise
  };

  /* ---------- small geometry ---------- */
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  const turn = (v1, v2) => Math.atan2(cross(v1, v2), dot(v1, v2)); // signed, + = clockwise on screen
  const mod = (a, m) => ((a % m) + m) % m;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
  const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const rp = (p) => [r4(p[0]), r4(p[1])];

  function pathLen(P, closed) {
    let l = 0;
    for (let i = 1; i < P.length; i++) l += dist(P[i - 1], P[i]);
    return closed && P.length > 1 ? l + dist(P[P.length - 1], P[0]) : l;
  }
  function bbox(P) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of P) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
    return { x0, y0, x1, y1, d: Math.hypot(x1 - x0, y1 - y0) };
  }
  // n points evenly spaced along the polyline (both ends kept).
  function resample(P, n) {
    const L = pathLen(P);
    if (!(L > 0)) return null;
    const step = L / (n - 1), out = [[P[0][0], P[0][1]]];
    let acc = 0, prev = P[0];
    for (let i = 1; i < P.length && out.length < n; i++) {
      const cur = P[i];
      let d = dist(prev, cur);
      while (acc + d >= step && out.length < n) {
        const t = (step - acc) / d, q = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
        out.push(q); prev = q; d = dist(prev, cur); acc = 0;
      }
      acc += d; prev = cur;
    }
    const last = P[P.length - 1];
    while (out.length < n) out.push([last[0], last[1]]);
    out[n - 1] = [last[0], last[1]];
    return out;
  }
  const resampleClosed = (P, n) => { const r = resample(P.concat([P[0]]), n + 1); return r && r.slice(0, n); };
  function smooth(P, closed) {
    const n = P.length;
    return P.map((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return p;
      const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
    });
  }
  function signedArea(P) {
    let s = 0;
    for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; s += a[0] * b[1] - b[0] * a[1]; }
    return s / 2; // > 0: clockwise on screen (y down)
  }
  function segX(a, b, c, d) {
    const r = sub(b, a), s = sub(d, c), den = cross(r, s);
    if (Math.abs(den) < 1e-12) return null;
    const t = cross(sub(c, a), s) / den, u = cross(sub(c, a), r) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [a[0] + t * r[0], a[1] + t * r[1]] : null;
  }
  function segDist(p, a, b) {
    const ab = sub(b, a), l2 = dot(ab, ab);
    const t = l2 > 0 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
    return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1]);
  }
  // Mean distance of the points to a polyline (closed: back to the first vertex).
  function meanDist(P, V, closed) {
    let s = 0;
    const m = closed ? V.length : V.length - 1;
    for (const p of P) {
      let best = Infinity;
      for (let i = 0; i < m; i++) best = Math.min(best, segDist(p, V[i], V[(i + 1) % V.length]));
      s += best;
    }
    return s / P.length;
  }
  // Total least squares line: centre c, unit direction d, rms and max distance.
  function lineFit(P) {
    let mx = 0, my = 0;
    for (const p of P) { mx += p[0]; my += p[1]; }
    mx /= P.length; my /= P.length;
    let sxx = 0, syy = 0, sxy = 0;
    for (const p of P) { const x = p[0] - mx, y = p[1] - my; sxx += x * x; syy += y * y; sxy += x * y; }
    const a = 0.5 * Math.atan2(2 * sxy, sxx - syy), d = [Math.cos(a), Math.sin(a)];
    let ss = 0, mxd = 0;
    for (const p of P) { const e = Math.abs(cross(d, [p[0] - mx, p[1] - my])); ss += e * e; mxd = Math.max(mxd, e); }
    return { c: [mx, my], d, rms: Math.sqrt(ss / P.length), max: mxd };
  }
  function lineX(l1, l2) {
    const den = cross(l1.d, l2.d);
    if (Math.abs(den) < 1e-9) return null;
    const t = cross(sub(l2.c, l1.c), l2.d) / den;
    return [l1.c[0] + t * l1.d[0], l1.c[1] + t * l1.d[1]];
  }
  const project = (l, p) => { const t = dot(sub(p, l.c), l.d); return [l.c[0] + t * l.d[0], l.c[1] + t * l.d[1]]; };
  const lineAngle = (l1, l2) => { const a = Math.abs(Math.atan2(cross(l1.d, l2.d), dot(l1.d, l2.d))) * DEG; return Math.min(a, 180 - a); };
  // Turn a direction onto the nearest multiple of `step` degrees when within `tol`.
  function snapDir(d, step, tol) {
    const a = Math.atan2(d[1], d[0]) * DEG, s = Math.round(a / step) * step;
    return Math.abs(a - s) <= tol ? [Math.cos(s * RAD), Math.sin(s * RAD)] : d;
  }

  /* ---------- circle and ellipse fits ---------- */
  // Algebraic fit (Kasa), refined geometrically (Landau iteration).
  function circleFit(P) {
    const n = P.length;
    let mx = 0, my = 0;
    for (const p of P) { mx += p[0]; my += p[1]; }
    mx /= n; my /= n;
    let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    for (const p of P) {
      const u = p[0] - mx, v = p[1] - my;
      suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
    }
    const det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-12) return null;
    const bx = -(suuu + suvv), by = -(svvv + svuu);
    const D = (bx * svv - by * suv) / det, E = (by * suu - bx * suv) / det;
    let c = [mx - D / 2, my - E / 2];
    for (let it = 0; it < 30; it++) {
      let r = 0, gx = 0, gy = 0;
      for (const p of P) { const d = dist(p, c) || 1e-9; r += d; gx += (c[0] - p[0]) / d; gy += (c[1] - p[1]) / d; }
      r /= n;
      const nc = [mx + r * gx / n, my + r * gy / n];
      const moved = dist(nc, c);
      c = nc;
      if (moved < 1e-7 * r) break;
    }
    let r = 0;
    for (const p of P) r += dist(p, c);
    r /= n;
    let ss = 0;
    for (const p of P) { const e = dist(p, c) - r; ss += e * e; }
    return { c, r, rms: Math.sqrt(ss / n) };
  }
  // Ellipse from the area moments of the closed loop (exact for a filled ellipse).
  function ellipseFit(P) {
    const n = P.length;
    let ox = 0, oy = 0;
    for (const p of P) { ox += p[0]; oy += p[1]; }
    ox /= n; oy /= n;
    let A = 0, cx = 0, cy = 0, ixx = 0, iyy = 0, ixy = 0;
    for (let i = 0; i < n; i++) {
      const x0 = P[i][0] - ox, y0 = P[i][1] - oy, x1 = P[(i + 1) % n][0] - ox, y1 = P[(i + 1) % n][1] - oy;
      const c = x0 * y1 - x1 * y0;
      A += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
      ixx += (x0 * x0 + x0 * x1 + x1 * x1) * c; iyy += (y0 * y0 + y0 * y1 + y1 * y1) * c;
      ixy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c;
    }
    A /= 2;
    if (Math.abs(A) < 1e-12) return null;
    cx /= 6 * A; cy /= 6 * A;
    const mxx = ixx / 12 / A - cx * cx, myy = iyy / 12 / A - cy * cy, mxy = ixy / 24 / A - cx * cy;
    const h = Math.hypot((mxx - myy) / 2, mxy), l1 = (mxx + myy) / 2 + h, l2 = (mxx + myy) / 2 - h;
    if (!(l2 > 0)) return null;
    const th = 0.5 * Math.atan2(2 * mxy, mxx - myy), a = 2 * Math.sqrt(l1), b = 2 * Math.sqrt(l2);
    const c = [cx + ox, cy + oy], cs = Math.cos(-th), sn = Math.sin(-th);
    let s = 0;
    for (const p of P) {
      const x = p[0] - c[0], y = p[1] - c[1], u = x * cs - y * sn, v = x * sn + y * cs;
      const q = Math.hypot(u / a, v / b), d = Math.hypot(u, v);
      s += q > 0 ? Math.abs(1 - 1 / q) * d : Math.min(a, b);
    }
    return { c, a, b, th, err: s / n };
  }

  /* ---------- corners ---------- */
  // Turning angle at i over w points each side. A corner turns sharply at a small and a twice larger
  // window alike (sharpness 2*t(w) - t(2w) stays high); a smooth curve doubles its turn and scores ~0.
  function findCorners(P, closed, w0, sharp) {
    const n = P.length, out = [], minA = T.cornerAng * RAD, w1 = Math.max(3, w0 || 3);
    const get = (i) => (closed ? P[mod(i, n)] : P[clamp(i, 0, n - 1)]);
    const tAt = (i, w) => {
      const a = get(i - w), b = P[i], c = get(i + w), v1 = sub(b, a), v2 = sub(c, b);
      return Math.hypot(v1[0], v1[1]) < 1e-12 || Math.hypot(v2[0], v2[1]) < 1e-12 ? 0 : turn(v1, v2);
    };
    const lo = closed ? 0 : 2, hi = closed ? n - 1 : n - 3;
    for (const w of [w1, 2 * w1]) {
      const t1 = [], t2 = [];
      for (let i = 0; i < n; i++) { t1[i] = tAt(i, w); t2[i] = tAt(i, 2 * w); }
      for (let i = lo; i <= hi; i++) {
        const a = Math.abs(t1[i]);
        if (a < minA) continue;
        let peak = true;
        for (let j = i - w; j <= i + w && peak; j++) {
          if (j === i || (!closed && (j < 0 || j >= n))) continue;
          const b = Math.abs(t1[mod(j, n)]);
          if (b > a || (b === a && j < i)) peak = false;
        }
        if (!peak) continue;
        const s = 2 * a - Math.sign(t1[i]) * t2[i];
        if (s >= (sharp || T.sharp) * RAD) out.push({ i, a: t1[i], s });
      }
    }
    out.sort((x, y) => y.s - x.s);
    const keep = [];
    for (const c of out) {
      if (keep.some((k) => { const d = Math.abs(k.i - c.i); return (closed ? Math.min(d, n - d) : d) <= w1 + 2; })) continue;
      keep.push(c);
    }
    return keep.sort((x, y) => x.i - y.i);
  }

  /* ---------- pre-processing ---------- */
  function clean(pts) {
    const out = [];
    for (const p of pts || []) {
      if (!p) continue;
      const x = Array.isArray(p) ? +p[0] : +p.x, y = Array.isArray(p) ? +p[1] : +p.y;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const q = out[out.length - 1];
      if (!q || q[0] !== x || q[1] !== y) out.push([x, y]);
    }
    return out;
  }
  // Cut a small hook at the start: the sharpest turn within the first few percent of the stroke.
  function trimStart(P, px) {
    const n = P.length, L = pathLen(P), h = L / (n - 1);
    const m = Math.max(2, Math.round(Math.min(Math.max(px(T.hookPx), T.hookFrac * L), T.hookMax * L) / h)), q = Math.max(2, Math.round(m / 2));
    let best = -1, bestA = T.hookAng * RAD;
    for (let i = 1; i <= m && i + q < n; i++) {
      const a = Math.abs(turn(sub(P[i], P[Math.max(0, i - q)]), sub(P[i + q], P[i])));
      if (a > bestA) { bestA = a; best = i; }
    }
    return best > 0 ? P.slice(best) : P;
  }
  const trimEnd = (P, px) => trimStart(P.slice().reverse(), px).reverse();

  // A closed stroke: the end crosses the start region, or comes back near it. Returns the loop without
  // the overshoot, or null. What is cut off must lie along the loop (an overshoot, a hook), not inside it.
  function findClosure(P, px) {
    const n = P.length, cum = [0];
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + dist(P[i - 1], P[i]);
    const L = cum[n - 1], D = bbox(P).d, tol = Math.max(px(T.closePx), T.closeFrac * D), maxCut = 0.3 * L;
    let he = 0, ts = n - 1;
    while (he < n - 1 && cum[he] < maxCut) he++;
    while (ts > 0 && cum[ts] > L - maxCut) ts--;
    let loop = null, a = -1, b = -1, best = Infinity;
    for (let i = 0; i < he; i++) for (let j = Math.max(ts, i + 2); j < n - 1; j++) {
      const x = segX(P[i], P[i + 1], P[j], P[j + 1]);
      if (!x) continue;
      const cost = cum[i] + L - cum[j + 1];
      if (cost < best && cost <= maxCut) { best = cost; loop = [x].concat(P.slice(i + 1, j + 1)); a = i; b = j + 1; }
    }
    if (!loop) {
      let near = Infinity;
      for (let i = 0; i < n && cum[i] <= 0.2 * L; i++) near = Math.min(near, dist(P[i], P[n - 1]));
      for (let j = n - 1; j >= 0 && cum[j] >= 0.8 * L; j--) near = Math.min(near, dist(P[j], P[0]));
      if (near > tol) return null;
      let bd = Infinity;
      for (let i = 0; i <= he; i++) for (let j = ts; j < n; j++) {
        const d = dist(P[i], P[j]);
        if (d < bd && cum[i] + L - cum[j] <= maxCut) { bd = d; a = i; b = j; }
      }
      if (a < 0 || bd > tol) return null;
      loop = P.slice(a, b + 1);
    }
    if (loop.length < 8 || bbox(loop).d < 0.5 * D) return null;
    const lim = Math.max(px(8), 0.1 * D);
    for (let i = 0; i < n; i += 2) {
      if (i > a && i < b) continue;
      let m = Infinity;
      for (const q of loop) m = Math.min(m, dist(P[i], q));
      if (m > lim) return null;
    }
    return loop;
  }
  function countCrossings(P) {
    const n = P.length;
    let c = 0;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segX(P[i], P[(i + 1) % n], P[j], P[(j + 1) % n])) c++;
    }
    return c;
  }

  /* ---------- closed shapes ---------- */
  // Polygon through the corners: a line per side (ends trimmed), vertices where neighbouring lines meet.
  function fitPolygon(P, corners, keepAll) {
    const n = P.length, D = bbox(P).d;
    let ids = corners.map((c) => c.i).sort((a, b) => a - b);
    for (let it = 0; it < 12; it++) {
      const k = ids.length;
      if (k < 3) return null;
      const lines = [];
      for (let j = 0; j < k; j++) {
        const a = ids[j], b = ids[(j + 1) % k] + (j === k - 1 ? n : 0), tr = Math.max(1, Math.round((b - a) * 0.2)), seg = [];
        for (let t = a + tr; t <= b - tr; t++) seg.push(P[t % n]);
        if (seg.length < 2) for (let t = a; t <= b; t++) seg.push(P[t % n]);
        lines.push(lineFit(seg));
      }
      let weak = -1, wa = 20;
      if (!keepAll) for (let j = 0; j < k; j++) { const a = lineAngle(lines[(j - 1 + k) % k], lines[j]); if (a < wa) { wa = a; weak = j; } }
      if (weak >= 0) { ids.splice(weak, 1); continue; }
      const V = [];
      for (let j = 0; j < k; j++) {
        const v = lineX(lines[(j - 1 + k) % k], lines[j]);
        if (!v || dist(v, P[ids[j]]) > (keepAll ? 0.4 : 0.25) * D) return null;
        V.push(v);
      }
      return { V, ids, lines, err: meanDist(P, V, true) / D };
    }
    return null;
  }
  function interior(V) {
    const k = V.length;
    return V.map((v, i) => { const a = sub(V[(i - 1 + k) % k], v), b = sub(V[(i + 1) % k], v); return Math.abs(turn(a, b)) * DEG; });
  }
  // Clockwise on screen, starting at the vertex nearest to the stroke start.
  function order(V, start) {
    let W = signedArea(V) < 0 ? V.slice().reverse() : V.slice();
    let bi = 0;
    W.forEach((v, i) => { if (dist(v, start) < dist(W[bi], start)) bi = i; });
    W = W.slice(bi).concat(W.slice(0, bi));
    return W.map(rp);
  }
  function snapPhase(ph, k) {
    const half = 180 / k, off = mod(ph + 90, half);
    if (off <= T.snapRot) return ph - off;
    if (half - off <= T.snapRot) return ph + half - off;
    return ph;
  }
  // Regular k-gon (or star) from vertices in clockwise order: centre, radius, phase.
  function regularOf(V, k) {
    const c = [V.reduce((s, v) => s + v[0], 0) / V.length, V.reduce((s, v) => s + v[1], 0) / V.length];
    const step = 360 / k, ang = V.map((v) => Math.atan2(v[1] - c[1], v[0] - c[0]) * DEG), rad = V.map((v) => dist(v, c));
    const R = rad.reduce((s, r) => s + r, 0) / V.length;
    const cv = Math.sqrt(rad.reduce((s, r) => s + (r - R) * (r - R), 0) / V.length) / R;
    let maxStep = 0, meanStep = 0, sx = 0, sy = 0;
    for (let i = 0; i < V.length; i++) {
      const e = Math.abs(mod(ang[(i + 1) % V.length] - ang[i], 360) - step);
      maxStep = Math.max(maxStep, e); meanStep += e / V.length;
      const p = (ang[i] - i * step) * RAD;
      sx += Math.cos(p); sy += Math.sin(p);
    }
    return { c, R, cv, maxStep, meanStep, phase: Math.atan2(sy, sx) * DEG };
  }
  const ngon = (c, R, ph, k) => Array.from({ length: k }, (_, i) => [c[0] + R * Math.cos((ph + (i * 360) / k) * RAD), c[1] + R * Math.sin((ph + (i * 360) / k) * RAD)]);
  function starPts(c, R, ph) {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? R * 0.382 : R, a = (ph + i * 36) * RAD;
      out.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]);
    }
    return out;
  }
  function starResult(tips, err, ctx) {
    const W = signedArea(tips) < 0 ? tips.slice().reverse() : tips;
    const g = regularOf(W, 5);
    if (g.cv > 0.28 || g.maxStep > 20) return null;
    const pts = starPts(g.c, g.R, snapPhase(g.phase, 5));
    return { kind: 'polygon', shape: 'star', name: 'ster', pts: order(pts, ctx.start), score: r4(clamp(1 - err / (2 * T.polyErr), 0, 1)) };
  }
  // A pentagram in one stroke: five sharp tips, five crossings.
  function tryPentagram(L, corners, ctx) {
    const tips = corners.filter((c) => Math.abs(c.a) > 90 * RAD);
    if (tips.length !== 5 || corners.length > 6) return null;
    const f = fitPolygon(L, tips, true);
    if (!f || f.err > T.polyErr) return null;
    // Tips in drawing order skip one each time; around the centre they are evenly spaced.
    const c = [f.V.reduce((s, v) => s + v[0], 0) / 5, f.V.reduce((s, v) => s + v[1], 0) / 5];
    const around = f.V.slice().sort((a, b) => Math.atan2(a[1] - c[1], a[0] - c[0]) - Math.atan2(b[1] - c[1], b[0] - c[0]));
    return starResult(around, f.err, ctx);
  }
  // The outline of a star: ten corners, turning alternately out (tips) and in.
  function tryStarOutline(L, corners, ctx) {
    if (corners.length !== 10) return null;
    const sg = Math.sign(signedArea(L));
    for (let i = 0; i < 10; i++) if (Math.sign(corners[i].a) === Math.sign(corners[(i + 1) % 10].a)) return null;
    const f = fitPolygon(L, corners, true);
    if (!f || f.err > T.polyErr) return null;
    const tips = f.V.filter((_, i) => Math.sign(corners[i].a) === sg);
    return tips.length === 5 ? starResult(tips, f.err, ctx) : null;
  }

  function triangle(V) {
    const A = interior(V);
    const len = (i, j) => dist(V[i], V[j]);
    if (A.every((a) => Math.abs(a - 60) <= 12)) {
      const g = regularOf(V, 3);
      return { V: ngon(g.c, Math.sqrt(3) * (len(0, 1) + len(1, 2) + len(2, 0)) / 9, snapPhase(g.phase, 3), 3), variant: 'equilateral' };
    }
    for (let i = 0; i < 3; i++) {
      const p = V[i], qa = V[(i + 2) % 3], qb = V[(i + 1) % 3], ua = unit(sub(qa, p)), ub = unit(sub(qb, p));
      const right = Math.abs(A[i] - 90) <= 8;
      const iso = Math.abs(len(i, (i + 1) % 3) - len(i, (i + 2) % 3)) / Math.max(len(i, (i + 1) % 3), len(i, (i + 2) % 3)) <= 0.08;
      if (!right && !iso) continue;
      // Symmetric about the bisector; for a right angle the legs are perpendicular.
      let b = unit([ua[0] + ub[0], ua[1] + ub[1]]);
      const half = right ? 45 * RAD : (A[i] / 2) * RAD, sgn = Math.sign(cross(b, ub)) || 1;
      let da = rot(b, -sgn * half), db = rot(b, sgn * half);
      if (right) { const s = snapDir(da, 90, T.snapRot); const d = turn(da, s); da = rot(da, d); db = rot(db, d); }
      else { const s = snapDir(b, 90, T.snapRot); const d = turn(b, s); b = s; da = rot(da, d); db = rot(db, d); }
      let la = dot(sub(qa, p), da), lb = dot(sub(qb, p), db);
      if (!right) la = lb = (la + lb) / 2;
      const W = [];
      W[i] = p; W[(i + 2) % 3] = [p[0] + la * da[0], p[1] + la * da[1]]; W[(i + 1) % 3] = [p[0] + lb * db[0], p[1] + lb * db[1]];
      return { V: W, variant: right ? 'right' : 'isosceles' };
    }
    return { V, variant: 'scalene' };
  }

  // Four corners: rectangle, diamond (rhombus with axis-aligned diagonals), parallelogram, trapezoid or
  // a general quadrilateral. Parallel sides are made exactly parallel.
  function quad(V) {
    const A = interior(V), lines = V.map((p, j) => lineFit([p, V[(j + 1) % 4]])); // lines[j]: V[j] -> V[j+1]
    const dev = A.map((a) => Math.abs(a - 90));
    if (Math.max(...dev) <= 17 && dev.reduce((t, x) => t + x, 0) / 4 <= 10) return { rect: true };
    const d1 = sub(V[2], V[0]), d2 = sub(V[3], V[1]), dl = (Math.hypot(...d1) + Math.hypot(...d2)) / 2;
    const midGap = dist([(V[0][0] + V[2][0]) / 2, (V[0][1] + V[2][1]) / 2], [(V[1][0] + V[3][0]) / 2, (V[1][1] + V[3][1]) / 2]) / dl;
    const axisOff = (d) => { const x = mod(Math.atan2(d[1], d[0]) * DEG, 90); return Math.min(x, 90 - x); };
    const perp = Math.abs(Math.abs(turn(d1, d2)) * DEG - 90);
    const s = [0, 1, 2, 3].map((j) => dist(V[j], V[(j + 1) % 4])), m = (s[0] + s[1] + s[2] + s[3]) / 4;
    if (perp <= 12 && midGap <= 0.15 && axisOff(d1) <= 10 && axisOff(d2) <= 10 && s.every((x) => Math.abs(x - m) / m <= 0.25)) {
      const c = [V.reduce((t, v) => t + v[0], 0) / 4, V.reduce((t, v) => t + v[1], 0) / 4], bb = bbox(V);
      const hw = (bb.x1 - bb.x0) / 2, hh = (bb.y1 - bb.y0) / 2;
      return { V: [[c[0], c[1] - hh], [c[0] + hw, c[1]], [c[0], c[1] + hh], [c[0] - hw, c[1]]], shape: 'diamond', name: 'ruit' };
    }
    const avg = (l1, l2) => { const e = dot(l1.d, l2.d) < 0 ? [-l2.d[0], -l2.d[1]] : l2.d; return unit([l1.d[0] + e[0], l1.d[1] + e[1]]); };
    const rebuild = (Ls) => { const W = []; for (let j = 0; j < 4; j++) { const v = lineX(Ls[(j + 3) % 4], Ls[j]); if (!v) return null; W.push(v); } return W; };
    const a02 = lineAngle(lines[0], lines[2]), a13 = lineAngle(lines[1], lines[3]);
    if (a02 <= 10 && a13 <= 10) {
      const da = avg(lines[0], lines[2]), db = avg(lines[1], lines[3]);
      const W = rebuild(lines.map((l, j) => ({ c: l.c, d: j % 2 ? db : da })));
      return W && { V: W, shape: 'parallelogram', name: 'parallellogram' };
    }
    if (Math.min(a02, a13) <= 12) {
      const o = a02 <= a13 ? 0 : 1, da = avg(lines[o], lines[o + 2]);
      const W = rebuild(lines.map((l, j) => (j % 2 === o ? { c: l.c, d: da } : l)));
      return W && { V: W, shape: 'trapezoid', name: 'trapezium' };
    }
    return { V, shape: 'quad', name: 'vierhoek' };
  }

  function rectResult(f, ctx, score) {
    // Axis from the four sides (angles taken modulo 90), sizes from the vertices in that frame.
    let sx = 0, sy = 0;
    for (let j = 0; j < 4; j++) {
      const e = sub(f.V[(j + 1) % 4], f.V[j]), l = Math.hypot(e[0], e[1]), a = Math.atan2(e[1], e[0]) * 4;
      sx += l * Math.cos(a); sy += l * Math.sin(a);
    }
    let phi = (Math.atan2(sy, sx) / 4) * DEG; // (-45, 45]
    const u = [Math.cos(phi * RAD), Math.sin(phi * RAD)], v = [-u[1], u[0]];
    const pu = f.V.map((p) => dot(p, u)).sort((a, b) => a - b), pv = f.V.map((p) => dot(p, v)).sort((a, b) => a - b);
    let w = (pu[2] + pu[3] - pu[0] - pu[1]) / 2, h = (pv[2] + pv[3] - pv[0] - pv[1]) / 2;
    const mu = (pu[0] + pu[1] + pu[2] + pu[3]) / 4, mv = (pv[0] + pv[1] + pv[2] + pv[3]) / 4;
    const c = [mu * u[0] + mv * v[0], mu * u[1] + mv * v[1]];
    const square = Math.abs(w - h) / Math.max(w, h) <= T.round;
    if (square) w = h = (w + h) / 2;
    let diamond = false;
    if (Math.abs(phi) <= T.snapRot) phi = 0;
    else if (square && 45 - Math.abs(phi) <= T.snapRot) { phi = 45; diamond = true; }
    const cs = Math.cos(phi * RAD), sn = Math.sin(phi * RAD);
    const corner = (x, y) => [c[0] + x * cs - y * sn, c[1] + x * sn + y * cs];
    const pts = [corner(-w / 2, -h / 2), corner(w / 2, -h / 2), corner(w / 2, h / 2), corner(-w / 2, h / 2)];
    const out = { kind: 'rect', cx: r4(c[0]), cy: r4(c[1]), w: r4(w), h: r4(h), rot: r4(mod(phi, 360) === 0 ? 0 : phi), square, pts: order(pts, ctx.start), score, name: diamond ? 'ruit' : square ? 'vierkant' : 'rechthoek' };
    if (diamond) out.diamond = true;
    return out;
  }

  const POLY_NAMES = { 5: ['pentagon', 'vijfhoek'], 6: ['hexagon', 'zeshoek'], 7: ['heptagon', 'zevenhoek'], 8: ['octagon', 'achthoek'] };
  function polygonResult(f, ctx) {
    const V = signedArea(f.V) < 0 ? f.V.slice().reverse() : f.V, k = V.length;
    for (let i = 0; i < k; i++) if (cross(sub(V[(i + 1) % k], V[i]), sub(V[(i + 2) % k], V[(i + 1) % k])) <= 0) return null; // not convex
    const score = r4(clamp(1 - f.err / (2 * T.polyErr), 0, 1));
    if (k === 3) {
      const t = triangle(V);
      return { kind: 'polygon', shape: 'triangle', variant: t.variant, name: 'driehoek', pts: order(t.V, ctx.start), score };
    }
    if (k === 4) {
      const q = quad(V);
      if (q.rect) return rectResult({ V }, ctx, score);
      return q.V ? { kind: 'polygon', shape: q.shape, name: q.name, pts: order(q.V, ctx.start), score } : null;
    }
    if (!POLY_NAMES[k]) return null;
    const g = regularOf(V, k);
    const step = 360 / k, regular = g.cv <= 0.15 && g.meanStep <= 0.22 * step && g.maxStep <= 0.45 * step;
    const pts = regular ? ngon(g.c, g.R, snapPhase(g.phase, k), k) : V;
    return { kind: 'polygon', shape: POLY_NAMES[k][0], name: POLY_NAMES[k][1], regular, pts: order(pts, ctx.start), score };
  }
  function ellipseResult(E, ctx) {
    let rx = E.a, ry = E.b, r = mod(E.th * DEG, 180);
    const circle = (rx - ry) / rx <= T.round;
    if (circle) { rx = ry = (rx + ry) / 2; r = 0; }
    else if (Math.min(r, 180 - r) <= T.snapRot) r = 0;
    else if (Math.abs(r - 90) <= T.snapRot) { r = 0; [rx, ry] = [ry, rx]; }
    return { kind: 'ellipse', cx: r4(E.c[0]), cy: r4(E.c[1]), rx: r4(rx), ry: r4(ry), rot: r4(r), circle, score: r4(clamp(1 - E.relErr / (2 * T.ellErr), 0, 1)), name: circle ? 'cirkel' : 'ellips' };
  }

  // A side that bends halfway hides a soft corner: add it at the sharpest turn in between.
  function addMissing(P, corners, w) {
    const n = P.length, sg = Math.sign(signedArea(P)), out = corners.slice();
    const tAt = (i) => turn(sub(P[mod(i, n)], P[mod(i - w, n)]), sub(P[mod(i + w, n)], P[mod(i, n)]));
    for (let it = 0; it < 6 && out.length <= 8; it++) {
      let added = false;
      const gap = (j) => out[(j + 1) % out.length].i + (j === out.length - 1 ? n : 0) - out[j].i;
      const gaps = out.map((_, j) => gap(j)).sort((x, y) => x - y), med = gaps[Math.floor(gaps.length / 2)];
      for (let j = 0; j < out.length && !added; j++) {
        const a = out[j].i, len = gap(j), b = a + len;
        if (len < 4 * w || len < 1.5 * med) continue;
        const p1 = P[mod(a + Math.round(len * 0.15), n)], pm = P[mod(a + Math.round(len / 2), n)], p2 = P[mod(b - Math.round(len * 0.15), n)];
        if (Math.abs(turn(sub(pm, p1), sub(p2, pm))) < 20 * RAD) continue;
        let bi = -1, ba = 0;
        for (let t = a + w; t <= b - w; t++) { const v = tAt(t) * sg; if (v > ba) { ba = v; bi = mod(t, n); } }
        if (bi < 0) continue;
        out.push({ i: bi, a: ba * sg, s: 0, added: true });
        out.sort((x, y) => x.i - y.i);
        added = true;
      }
      if (!added) break;
    }
    return out;
  }
  function classifyClosed(loop, ctx) {
    let L = resampleClosed(loop, N);
    if (!L) return null;
    L = smooth(L, true);
    const w1 = Math.max(3, Math.ceil(ctx.px(T.winPx) / (pathLen(L, true) / N)));
    const D = bbox(L).d, crossings = countCrossings(L);
    let corners = findCorners(L, true, w1);
    if (crossings >= 3) return tryPentagram(L, corners, ctx);
    if (crossings > 0) return null;
    if (corners.length === 10) { const s = tryStarOutline(L, corners, ctx); if (s) return s; }
    const E = ellipseFit(L);
    if (E) E.relErr = E.err / D;
    // A kink where the loop was joined, turning against the rest, is not a corner.
    const sgA = Math.sign(signedArea(L));
    corners = corners.filter((c) => Math.sign(c.a) === sgA || (c.i > 2 * w1 && c.i < N - 1 - 2 * w1) || corners.filter((d) => Math.sign(d.a) !== sgA).length > 1);
    if (corners.length >= 3) corners = addMissing(L, corners, w1);
    const k = corners.length;
    if (k >= 3 && k <= 10) {
      const f = fitPolygon(L, corners);
      // Many soft corners on a round shape: only a polygon when its corners are real and it fits far better.
      const found = corners.filter((c) => !c.added), sharp = found.reduce((t, c) => t + c.s, 0) / Math.max(1, found.length);
      if (f && f.err <= T.polyErr && (!E || f.err < 0.6 * E.relErr) && (k < 6 || sharp >= 25 * RAD)) {
        const r = polygonResult(f, ctx);
        if (r) return r;
      }
    }
    // A round shape has (almost) no sharp corners.
    const strong = corners.filter((c) => c.s > 60 * RAD).length;
    if (E && E.relErr <= T.ellErr && strong <= 2) return ellipseResult(E, ctx);
    return null;
  }

  /* ---------- open strokes ---------- */
  function lineResult(P, fit, ctx) {
    const d = snapDir(fit.d, 45, T.snapLine), mid = [(P[0][0] + P[P.length - 1][0]) / 2, (P[0][1] + P[P.length - 1][1]) / 2];
    const l = { c: project(fit, mid), d };
    const a = project(l, P[0]), b = project(l, P[P.length - 1]);
    return { kind: 'line', x1: r4(a[0]), y1: r4(a[1]), x2: r4(b[0]), y2: r4(b[1]) };
  }
  function arcInfo(P) {
    const f = circleFit(P);
    if (!f) return null;
    let sweep = 0, back = 0;
    for (let i = 1; i < P.length; i++) {
      const d = turn(sub(P[i - 1], f.c), sub(P[i], f.c));
      sweep += d;
      if (i > 1) back += Math.sign(d) !== Math.sign(sweep) ? 1 : 0;
    }
    return { ...f, sweep: sweep * DEG, back: back / P.length };
  }
  function arcResult(P, a, score) {
    const a0 = Math.atan2(P[0][1] - a.c[1], P[0][0] - a.c[0]), m = clamp(Math.round(Math.abs(a.sweep) / 7.5) + 1, 24, 48), pts = [];
    for (let i = 0; i < m; i++) { const t = a0 + (a.sweep * RAD * i) / (m - 1); pts.push(rp([a.c[0] + a.r * Math.cos(t), a.c[1] + a.r * Math.sin(t)])); }
    return { kind: 'arc', pts, cx: r4(a.c[0]), cy: r4(a.c[1]), r: r4(a.r), sweep: r4(a.sweep), score, name: 'boog' };
  }
  function lineOrArc(P, ctx) {
    const n = P.length, C = dist(P[0], P[n - 1]), L = pathLen(P), ln = lineFit(P), a = arcInfo(P);
    const sw = a ? Math.abs(a.sweep) : 0;
    const arcOk = a && sw >= 30 && sw <= 300 && a.back < 0.05 && a.rms <= T.arcRms * Math.min(a.r, C) + ctx.px(1);
    const lineOk = C >= 0.9 * L && ln.max <= T.lineMax * C + ctx.px(1) && ln.rms <= T.lineRms * C;
    // A wobbly line looks like a flat arc: then the arc must bend clearly more.
    if (arcOk && (!lineOk || (sw >= 40 && a.rms < 0.45 * ln.rms))) return arcResult(P, a, r4(clamp(1 - a.rms / (2 * T.arcRms * Math.min(a.r, C)), 0, 1)));
    if (lineOk) return { ...lineResult(P, ln, ctx), score: r4(clamp(1 - ln.rms / (2 * T.lineRms * C), 0, 1)), name: 'lijn' };
    return null;
  }
  function fitPolyline(P, corners, ctx) {
    const n = P.length, D = bbox(P).d;
    let ids = corners.map((c) => c.i);
    for (let it = 0; it < 8; it++) {
      if (!ids.length) return null;
      const b = [0].concat(ids, [n - 1]), lines = [];
      for (let j = 0; j + 1 < b.length; j++) {
        const len = b[j + 1] - b[j], tr = Math.max(1, Math.round(len * 0.2)), seg = [];
        for (let t = b[j] + (j > 0 ? tr : 0); t <= b[j + 1] - (j + 2 < b.length ? tr : 0); t++) seg.push(P[t]);
        if (seg.length < 2) for (let t = b[j]; t <= b[j + 1]; t++) seg.push(P[t]);
        const f = lineFit(seg), sl = dist(P[b[j]], P[b[j + 1]]);
        if (f.rms > T.segRms * sl + ctx.px(1.5)) return null;
        lines.push(f);
      }
      let weak = -1;
      for (let j = 1; j < lines.length; j++) if (lineAngle(lines[j - 1], lines[j]) < 15) weak = j - 1;
      if (weak >= 0) { ids.splice(weak, 1); continue; }
      const Ls = lines.map((l) => ({ c: l.c, d: snapDir(l.d, 45, T.snapLine) }));
      const V = [project(Ls[0], P[0])];
      for (let j = 1; j < Ls.length; j++) {
        const v = lineX(Ls[j - 1], Ls[j]);
        if (!v || dist(v, P[ids[j - 1]]) > 0.2 * D) return null;
        V.push(v);
      }
      V.push(project(Ls[Ls.length - 1], P[n - 1]));
      const err = meanDist(P, V, false) / D;
      if (err > T.polyErr) return null;
      return { kind: 'polyline', pts: V.map(rp), score: r4(clamp(1 - err / (2 * T.polyErr), 0, 1)), name: 'gebroken lijn' };
    }
    return null;
  }
  // A straight shaft to the farthest point, then a head of barbs on both sides pointing back.
  function tryArrow(P, ctx) {
    const n = P.length;
    // The tip: the first time the stroke gets (nearly) as far from the tail as it ever does.
    let far = 0, ti = 0;
    for (let i = 1; i < n; i++) far = Math.max(far, dist(P[0], P[i]));
    while (ti < n - 1 && dist(P[0], P[ti]) < 0.85 * far) ti++;
    for (;;) {
      let j = ti;
      for (let t = ti + 1; t < Math.min(n, ti + Math.ceil(n / 12)); t++) if (dist(P[0], P[t]) > dist(P[0], P[j])) j = t;
      if (j === ti) break;
      ti = j;
    }
    const tip = P[ti], S = dist(P[0], tip);
    if (S < ctx.px(30) || ti > n - 4 || ti < n * 0.4) return null;
    const shaft = P.slice(0, ti + 1), fit = lineFit(shaft);
    if (fit.max > 0.08 * S || fit.rms > 0.035 * S || pathLen(shaft) > 1.1 * S) return null;
    const head = P.slice(ti), u = unit(sub(tip, P[0])), nv = [-u[1], u[0]];
    if (pathLen(head) < 0.15 * S) return null;
    let bl = null, br = null, sl = 0, sr = 0;
    for (const q of head) {
      const r = sub(q, tip);
      if (Math.hypot(r[0], r[1]) > 0.5 * S || dot(r, u) > 0.08 * S) return null;
      const s = dot(r, nv);
      if (s > sl) { sl = s; bl = q; }
      if (-s > sr) { sr = -s; br = q; }
    }
    if (!bl || !br || Math.min(sl, sr) < Math.max(0.05 * S, ctx.px(3))) return null;
    const barb = (q) => { const r = sub(q, tip); return Math.abs(turn(r, [-u[0], -u[1]])) * DEG; };
    const al = barb(bl), ar = barb(br), ll = dist(bl, tip), lr = dist(br, tip);
    if (al < 12 || al > 70 || ar < 12 || ar > 70 || Math.max(ll, lr) / Math.min(ll, lr) > 2.5) return null;
    const l = lineResult(shaft, fit, ctx);
    return { kind: 'arrow', x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, head: r4((ll + lr) / 2), score: r4(clamp(1 - fit.rms / (0.05 * S), 0, 1)), name: 'pijl' };
  }
  function classifyOpen(P, Phead, ctx) {
    const ar = tryArrow(Phead, ctx) || tryArrow(resample(P, N).reverse(), ctx);
    if (ar) return ar;
    const win = () => Math.ceil(ctx.px(T.winPx) / (pathLen(P) / (P.length - 1)));
    let corners = findCorners(P, false, win(), T.cornerAng);
    // A corner very near an end is a hook: cut it off and look again.
    for (let it = 0; it < 2 && corners.length; it++) {
      const L = pathLen(P), zone = Math.min(Math.max(ctx.px(T.hookPx + 4), 0.07 * L), 0.1 * L) / (L / (P.length - 1));
      const a = corners[0].i <= zone ? corners[0].i : 0, b = corners[corners.length - 1].i >= P.length - 1 - zone ? corners[corners.length - 1].i : P.length - 1;
      if (a === 0 && b === P.length - 1) break;
      P = resample(P.slice(a, b + 1), N);
      corners = findCorners(P, false, win(), T.cornerAng);
    }
    if (corners.length > 5) return null;
    if (corners.length) {
      const pl = fitPolyline(P, corners, ctx);
      if (pl) return pl;
    }
    return corners.length <= 1 ? lineOrArc(P, ctx) : null;
  }

  /* ---------- entry ---------- */
  const CLOSED = { ellipse: 1, rect: 1, polygon: 1 };
  // A light moving average (5 points): the length of a trembling stroke without the tremor.
  const avg5 = (P) => P.map((_, i) => { let x = 0, y = 0, n = 0; for (let j = Math.max(0, i - 2); j <= Math.min(P.length - 1, i + 2); j += 1) { x += P[j][0]; y += P[j][1]; n += 1; } return [x / n, y / n]; });
  // How far the stroke reaches along its chord (a stroke going back and forth reaches past its ends).
  const span = (P, A, B, ch) => { const ux = (B[0] - A[0]) / ch, uy = (B[1] - A[1]) / ch; const t = P.map(([x, y]) => (x - A[0]) * ux + (y - A[1]) * uy); return Math.max(...t) - Math.min(...t); };
  function recognize(pts, opts) {
    const o = opts || {}, scale = o.scale > 0 ? +o.scale : 1, px = (v) => v / scale;
    let P = clean(pts);
    if (P.length < 4) return null;
    const bb = bbox(P);
    if (bb.d < px(12) || pathLen(P) < px(20)) return null;
    // A plainly straight stroke with fine tremor (a shaky finger): every point close to the chord and
    // hardly longer than it. Decided before the corner finder, which would read the tremor as corners.
    if (!o.closedOnly) {
      const A = P[0], B = P[P.length - 1], ch = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (ch > px(40)) {
        // Signed distance of every point to the chord: the tremor averages out (rms), a bend or an arc
        // does not (it is all to one side, and large somewhere).
        const ds = P.map(([x, y]) => ((B[0] - A[0]) * (A[1] - y) - (A[0] - x) * (B[1] - A[1])) / ch);
        const rms = Math.sqrt(ds.reduce((t, d) => t + d * d, 0) / ds.length);
        const mean = Math.abs(ds.reduce((t, d) => t + d, 0) / ds.length);
        const dev = Math.max(...ds.map(Math.abs));
        if (rms < Math.max(px(4.5), ch * 0.03) && mean < Math.max(px(2.5), ch * 0.018) && dev < Math.max(px(13), ch * 0.08) && pathLen(avg5(P)) < ch * 1.3 && span(P, A, B, ch) < ch * 1.15) {
          let ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
          const snapA = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
          if (Math.abs(ang - snapA) < (4 * Math.PI) / 180) ang = snapA;
          const res = { kind: 'line', x1: A[0], y1: A[1], x2: A[0] + ch * Math.cos(ang), y2: A[1] + ch * Math.sin(ang), score: Math.max(0, Math.min(1, 1 - rms / Math.max(px(4.5), ch * 0.03))), name: 'lijn' };
          if (!Array.isArray(o.allow) || o.allow.includes('line')) return res;
        }
      }
    }
    P = resample(P, N);
    if (!P) return null;
    P = smooth(P, false);
    const head = trimStart(P, px), both = trimEnd(head, px);
    if (both.length < 8) return null;
    const ctx = { px, start: both[0] };
    const loop = findClosure(both, px);
    let res = null;
    if (loop) res = classifyClosed(loop, ctx);
    else if (!o.closedOnly) res = classifyOpen(resample(both, N), head, ctx);
    if (!res || (o.closedOnly && !CLOSED[res.kind])) return null;
    if (Array.isArray(o.allow) && !o.allow.includes(res.kind) && !(res.shape && o.allow.includes(res.shape))) return null;
    return res;
  }

  return { recognize };
});
