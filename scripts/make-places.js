// Builds src/renderer/vendor/places-nl.js: every Dutch woonplaats (PDOK Locatieserver, BAG, CC0) with
// its centre and a simplified outline, so the In de lucht widget can tell above which place a unit flies
// without asking anything online. Run again (`node scripts/make-places.js`) when places change.
const fs = require('fs');
const path = require('path');

const URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=*:*&fq=type:woonplaats&fl=woonplaatsnaam,centroide_ll,geometrie_ll&sort=id%20asc';
const ROWS = 100;
const TOL = 0.002;   // simplification in degrees (about 150-200 m)
const out = path.join(__dirname, '..', 'src', 'renderer', 'vendor', 'places-nl.js');

// Douglas-Peucker on [lon, lat] points.
function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    let max = 0, at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const d = len ? Math.abs(dy * px - dx * py + bx * ay - by * ax) / len : Math.hypot(px - ax, py - ay);
      if (d > max) { max = d; at = i; }
    }
    if (max > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  return pts.filter((p, i) => keep[i]);
}
const r3 = (v) => Math.round(v * 1000) / 1000;

(async () => {
  const places = [];
  for (let start = 0; ; start += ROWS) {
    const res = await fetch(`${URL}&rows=${ROWS}&start=${start}`);
    if (!res.ok) throw new Error(`PDOK HTTP ${res.status}`);
    const { response } = await res.json();
    for (const d of response.docs) {
      const c = /POINT\(([\d.]+) ([\d.]+)\)/.exec(d.centroide_ll || '');
      if (!c) continue;
      // Only the first ring of each polygon is the outline; split polygons on their own.
      const rings = String(d.geometrie_ll || '').replace(/^MULTIPOLYGON\s*\(/, '').replace(/^POLYGON\s*/, '')
        .split(/\)\)\s*,\s*\(\(/).map((poly) => poly.replace(/^\(+/, '').split(/\)\s*,\s*\(/)[0].replace(/\)+$/, ''))
        .map((ring) => ring.split(',').map((xy) => xy.trim().split(/\s+/).map(Number)).filter((xy) => xy.length === 2 && xy.every(Number.isFinite)))
        .filter((ring) => ring.length >= 4)
        .map((ring) => simplify(ring, TOL).map(([x, y]) => [r3(x), r3(y)]))
        .filter((ring) => ring.length >= 3)
        .map((ring) => ring.flat());
      places.push([d.woonplaatsnaam, r3(+c[2]), r3(+c[1]), rings]);
    }
    process.stdout.write(`\r${places.length} / ${response.numFound}`);
    if (start + ROWS >= response.numFound) break;
  }
  places.sort((a, b) => a[0].localeCompare(b[0], 'nl'));
  fs.writeFileSync(out, `// Dutch woonplaatsen: [name, lat, lon, outlines as flat [lon, lat, ...] rings], simplified.\n// Source: PDOK Locatieserver (BAG, CC0). Made by scripts/make-places.js on ${new Date().toISOString().slice(0, 10)}.\nwindow.PLACES_NL = ${JSON.stringify(places)};\n`);
  console.log(`\n${out}: ${(fs.statSync(out).size / 1024).toFixed(0)} kB`);
})().catch((e) => { console.error(e.message); process.exit(1); });
