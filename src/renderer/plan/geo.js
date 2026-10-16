'use strict';

/* ============================================================
   Zoek & Plan — rekenen op de aardbol: afstand, koers, punten langs een route, cirkels, en waar een
   route een luchtruim in- en uitgaat. Zonder DOM, zodat het in Node te toetsen is.
   ============================================================ */
// Great circles on a sphere of the mean earth radius. Over the distances a helicopter flies the
// difference with the ellipsoid stays below 0.5 %, the same order as any map ruler, and every figure on
// screen (route, tape, rings) uses this one model, so they always agree with each other.
// Points are { lat, lon } in degrees; distances in metres; bearings in degrees true, 0..360.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanGeo = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const R = 6371008.8;
  const NM = 1852;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const norm360 = (d) => ((d % 360) + 360) % 360;
  const norm180 = (d) => { const n = norm360(d); return n > 180 ? n - 360 : n; };

  function dist(a, b) {
    const f1 = rad(a.lat), f2 = rad(b.lat), df = f2 - f1, dl = rad(b.lon - a.lon);
    const h = Math.sin(df / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Initial true course from a to b.
  function bearing(a, b) {
    const f1 = rad(a.lat), f2 = rad(b.lat), dl = rad(b.lon - a.lon);
    const y = Math.sin(dl) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return norm360(deg(Math.atan2(y, x)));
  }

  // The point `m` metres from `a` on initial course `brg`.
  function dest(a, brg, m) {
    const d = m / R, t = rad(brg), f1 = rad(a.lat), l1 = rad(a.lon);
    const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
    const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    return { lat: deg(f2), lon: norm180(deg(l2)) };
  }

  // The point at fraction f (0..1) along the great circle from a to b.
  function interp(a, b, f) {
    const d = dist(a, b) / R;
    if (d < 1e-12) return { lat: a.lat, lon: a.lon };
    const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const f1 = rad(a.lat), l1 = rad(a.lon), f2 = rad(b.lat), l2 = rad(b.lon);
    const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
    const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
    const z = A * Math.sin(f1) + B * Math.sin(f2);
    return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
  }

  // Points along a great circle at most `stepM` apart, both ends included: for drawing a long leg as
  // the curve it really is on a Mercator map.
  function densify(a, b, stepM = 5000) {
    const n = Math.max(1, Math.ceil(dist(a, b) / stepM));
    const out = [];
    for (let i = 0; i <= n; i += 1) out.push(interp(a, b, i / n));
    return out;
  }

  // Signed distance of p from the great circle a→b (positive right of the course) and how far along
  // that course its foot lies.
  function crossAlong(a, b, p) {
    const d13 = dist(a, p) / R, t13 = rad(bearing(a, p)), t12 = rad(bearing(a, b));
    const xt = Math.asin(Math.sin(d13) * Math.sin(t13 - t12));
    const at = Math.acos(Math.max(-1, Math.min(1, Math.cos(d13) / Math.cos(xt))));
    return { cross: xt * R, along: (Math.cos(t13 - t12) < 0 ? -at : at) * R };
  }

  /* ---------- a route: a list of points with the distances along it ---------- */
  function measure(points) {
    const cum = [0];
    for (let i = 1; i < points.length; i += 1) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
    return { points, cum, total: cum[cum.length - 1] || 0 };
  }

  // Where on the route a distance from the start lies: the point, its leg and the course there.
  function pointAt(route, m) {
    const { points, cum, total } = route;
    if (points.length < 2) return points[0] ? { ...points[0], leg: 0, course: 0, m: 0 } : null;
    const at = Math.max(0, Math.min(total, m));
    let i = 1;
    while (i < cum.length - 1 && cum[i] < at) i += 1;
    const legLen = cum[i] - cum[i - 1];
    const f = legLen > 0 ? (at - cum[i - 1]) / legLen : 0;
    const p = interp(points[i - 1], points[i], f);
    const ahead = f < 0.999 ? points[i] : p;
    return { ...p, leg: i - 1, m: at, course: f < 0.999 ? bearing(p, ahead) : bearing(points[i - 1], points[i]) };
  }

  // The point of the route closest to p: its distance from the start and how far p lies off it.
  function nearest(route, p) {
    let best = null;
    const { points, cum } = route;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i], len = cum[i] - cum[i - 1];
      const ca = crossAlong(a, b, p);
      const along = Math.max(0, Math.min(len, ca.along));
      const foot = len > 0 ? interp(a, b, along / len) : a;
      const off = dist(foot, p);
      if (!best || off < best.off) best = { leg: i - 1, m: cum[i - 1] + along, off, point: foot };
    }
    return best;
  }

  // A circle of radius m around c, as a closed ring of n points (geodesic: true distance in every direction).
  function circle(c, m, n = 180) {
    const out = [];
    for (let i = 0; i <= n; i += 1) out.push(dest(c, (i * 360) / n, m));
    return out;
  }

  /* ---------- polygons (GeoJSON order: [lon, lat]) ---------- */
  function inRing(ring, lat, lon) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // A polygon is its outer ring minus its holes; a multipolygon any of its polygons.
  function inGeometry(geom, lat, lon) {
    if (!geom) return false;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    return polys.some((rings) => rings.length && inRing(rings[0], lat, lon) && !rings.slice(1).some((h) => inRing(h, lat, lon)));
  }
  function bboxOf(geom) {
    let s = 90, w = 180, n = -90, e = -180;
    const walk = (c) => { if (typeof c[0] === 'number') { s = Math.min(s, c[1]); n = Math.max(n, c[1]); w = Math.min(w, c[0]); e = Math.max(e, c[0]); } else c.forEach(walk); };
    walk(geom.coordinates);
    return [s, w, n, e];
  }

  // Where a route enters and leaves a polygon, as distances from the start: sampled every `stepM`, each
  // crossing then narrowed down to within a few metres. Returns [{ from, to }] (to may equal total).
  function crossings(route, geom, stepM = 250) {
    const out = [];
    if (!route.total) return out;
    const inside = (m) => { const p = pointAt(route, m); return inGeometry(geom, p.lat, p.lon); };
    const edge = (lo, hi, startIn) => {
      for (let k = 0; k < 24 && hi - lo > 2; k += 1) { const mid = (lo + hi) / 2; if (inside(mid) === startIn) lo = mid; else hi = mid; }
      return (lo + hi) / 2;
    };
    let prevM = 0, prevIn = inside(0), from = prevIn ? 0 : null;
    const n = Math.max(2, Math.ceil(route.total / stepM));
    for (let i = 1; i <= n; i += 1) {
      const m = (route.total * i) / n, now = inside(m);
      if (now !== prevIn) {
        const at = edge(prevM, m, prevIn);
        if (now) from = at; else { out.push({ from, to: at }); from = null; }
      }
      prevM = m; prevIn = now;
    }
    if (from != null) out.push({ from, to: route.total });
    return out;
  }

  // Box [s, w, n, e] around points, grown by `padM`.
  function bboxPoints(points, padM = 0) {
    let s = 90, w = 180, n = -90, e = -180;
    for (const p of points) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }
    if (padM) {
      const dLat = deg(padM / R), dLon = dLat / Math.max(0.05, Math.cos(rad((s + n) / 2)));
      s -= dLat; n += dLat; w -= dLon; e += dLon;
    }
    return [s, w, n, e];
  }
  const boxesOverlap = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

  return { R, NM, rad, deg, norm360, norm180, dist, bearing, dest, interp, densify, crossAlong, measure, pointAt, nearest, circle, inRing, inGeometry, bboxOf, crossings, bboxPoints, boxesOverlap };
});
