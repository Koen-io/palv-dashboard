'use strict';

/* ============================================================
   Plaatsen
   Above which Dutch place a position lies, or how far and in which direction from the nearest one:
   offline, from the woonplaatsen in vendor/places-nl.js (PDOK, made by scripts/make-places.js).
   ============================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PLACES = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const KM_LAT = 111.2;
  const NEAR_KM = 60;   // places whose centre is further away are not considered for "x km from"
  const WINDS = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'];
  let index = null;

  // Each outline with its bounding box, made once on first use.
  function build() {
    index = (root.PLACES_NL || []).map(([name, lat, lon, rings]) => ({
      name, lat, lon,
      rings: rings.map((r) => {
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); }
        return { r, x0, x1, y0, y1 };
      }),
    }));
  }

  function inside(r, lon, lat) {
    let hit = false;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }

  // Shortest distance in km from the point to the outline (flat projection around the point).
  function edgeKm(r, lon, lat, kx) {
    let best = Infinity;
    for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
      const ax = (r[j] - lon) * kx, ay = (r[j + 1] - lat) * KM_LAT, bx = (r[i] - lon) * kx, by = (r[i + 1] - lat) * KM_LAT;
      const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }

  // { name, above: true } over a place; otherwise { name, km, dir } with the direction of the point
  // seen from the centre of the nearest place. null when no place is near (far out at sea, abroad).
  function near(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!index) build();
    const kx = KM_LAT * Math.cos((lat * Math.PI) / 180);
    let best = null;
    for (const p of index) {
      if (Math.abs(p.lat - lat) * KM_LAT > NEAR_KM || Math.abs(p.lon - lon) * kx > NEAR_KM) continue;
      for (const g of p.rings) {
        if (lon >= g.x0 && lon <= g.x1 && lat >= g.y0 && lat <= g.y1 && inside(g.r, lon, lat)) return { name: p.name, above: true };
        const km = edgeKm(g.r, lon, lat, kx);
        if (!best || km < best.km) best = { p, km };
      }
    }
    if (!best) return null;
    const brg = (Math.atan2((lon - best.p.lon) * kx, (lat - best.p.lat) * KM_LAT) * 180) / Math.PI;
    return { name: best.p.name, above: false, km: best.km, dir: WINDS[Math.round(((brg + 360) % 360) / 45) % 8] };
  }

  // "boven Houten", "3 km NO van Houten".
  const where = (n) => (!n ? '' : n.above ? `boven ${n.name}` : `${Math.max(1, Math.round(n.km))} km ${n.dir} van ${n.name}`);

  return { near, where };
});
