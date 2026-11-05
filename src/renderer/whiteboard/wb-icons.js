'use strict';

/* ============================================================
   Whiteboard — de iconenbibliotheek: de registratie, de tekenhulpen en de stijl die alle iconen delen.
   De iconen zelf staan per categorie in wb-icons-*.js (luchtvaart, voertuigen en personen, vaartuigen,
   vaartuigen van boven, offshore en infra, tactisch/natuur/markeringen); index.html laadt die na dit
   bestand. Elk icoon is een vector (SVG, 64 × 64) die in elke kleur en op elke grootte scherp blijft.
   ============================================================ */
const WB_CATS = { air: 'Luchtvaart', veh: 'Voertuigen', sea: 'Vaartuigen', seatop: 'Vaartuigen (bovenaanzicht)', off: 'Offshore', per: 'Personen', inf: 'Gebouwen en infra', nat: 'Natuur en dieren', tac: 'Tactisch', mrk: 'Markeringen' };
// Every icon: id, name, category, keywords, and the SVG inside a 64 × 64 box. Strokes use currentColor
// and fills use currentColor with a fill-opacity, so one icon draws in any pen colour on any background.
// `extra`: size (a standard size on the board, for a diagram used as a base) and own (keeps its own colours).
const WB_ICONS = [];
const wbIcon = (id, name, cat, svg, kw = '', extra = {}) => WB_ICONS.push({ id, name, cat, kw: (name + ' ' + kw).toLowerCase(), svg, ...extra });
// Ids of earlier versions (1.28/1.29 had a simple and a detailed set) still on saved boards: each points to
// the icon of today, so an old board draws as it did.
const WB_ICON_ALIAS = {};
const wbAlias = (oldId, id) => { WB_ICON_ALIAS[oldId] = id; };

/* ---------- the shared style ----------
   One line weight for the outline of a shape (WB_S), a lighter one for the detail inside it (WB_D), and
   fills in three steps: body 0.25, glass and dark parts 0.55, solid parts (wheels, hubs, rotor blades) 0.95.
   Everything must still read at 40 px: no detail finer than one unit apart, at most three fill levels. */
const WB_S = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const WB_D = 'fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"';
const WB_FILL = { body: 'fill="currentColor" fill-opacity="0.25"', glass: 'fill="currentColor" fill-opacity="0.55"', solid: 'fill="currentColor" fill-opacity="0.95"' };
const WB_T = (x, y, txt, size = 14, weight = 700) => `<text x="${x}" y="${y}" font-family="Bahnschrift,Segoe UI,Arial,sans-serif" font-weight="${weight}" font-size="${size}" text-anchor="middle" fill="currentColor" stroke="none">${txt}</text>`;
// Water under a side view of a vessel: three gentle waves along the foot of the box.
const WB_WAVES = '<path d="M4 58c6-4 10-4 16 0 6-4 10-4 16 0 6-4 10-4 16 0" stroke-width="1.6"/>';

/* ---------- drawing helpers ---------- */
// Rotor blades: n tapered blades about the hub (cx, cy), radius r, root width w, the first one pointing
// up (`a0` turns the whole set, in degrees). Drawn solid, with a faint disc so the swept area shows.
function wbBlades(n, cx, cy, r, w = 2.6, a0 = 0) {
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (a0 * Math.PI) / 180 + (i * 2 * Math.PI) / n, c = Math.cos(a), s = Math.sin(a);
    const px = -s, py = c; // perpendicular
    const tip = 0.45;
    d += `M${(cx + px * w / 2).toFixed(1)} ${(cy + py * w / 2).toFixed(1)}L${(cx + c * r + px * w * tip / 2).toFixed(1)} ${(cy + s * r + py * w * tip / 2).toFixed(1)}L${(cx + c * r - px * w * tip / 2).toFixed(1)} ${(cy + s * r - py * w * tip / 2).toFixed(1)}L${(cx - px * w / 2).toFixed(1)} ${(cy - py * w / 2).toFixed(1)}Z`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" fill-opacity="0.06" stroke="currentColor" stroke-width="0.5" stroke-opacity="0.35"/><path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="0.7" fill-opacity="0.92"/><circle cx="${cx}" cy="${cy}" r="${(w * 0.95).toFixed(1)}" fill="currentColor"/>`;
}
// A hull from above: stern flat at the bottom, pointed bow at the top; w = half beam, from y0 to y1.
const wbHull = (w, y0 = 6, y1 = 58, fo = 0.25, bowRound = 0.35) => `<path d="M32 ${y0}C${32 + w * 0.6} ${y0 + (y1 - y0) * bowRound * 0.6} ${32 + w} ${y0 + (y1 - y0) * bowRound} ${32 + w} ${y0 + (y1 - y0) * 0.5}V${y1 - 3}q0 3-3 3H${35 - w}q-3 0-3-3V${y0 + (y1 - y0) * 0.5}C${32 - w} ${y0 + (y1 - y0) * bowRound} ${32 - w * 0.6} ${y0 + (y1 - y0) * bowRound * 0.6} 32 ${y0}Z" fill="currentColor" fill-opacity="${fo}"/>`;
// A wheel seen from the side: tyre, rim and hub.
const wbWheel = (cx, cy, r = 5) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" fill-opacity="0.95"/><circle cx="${cx}" cy="${cy}" r="${(r * 0.45).toFixed(1)}" fill="#000" fill-opacity="0.35" stroke="none"/>`;
// A row of windows (side view): n panes of width w from x, at height y, each h high.
const wbWindows = (x, y, n, w = 4, hgt = 4, gap = 1.6) => Array.from({ length: n }, (_, i) => `<rect x="${(x + i * (w + gap)).toFixed(1)}" y="${y}" width="${w}" height="${hgt}" rx="0.8" ${WB_FILL.glass} stroke="none"/>`).join('');

/* ---------- lookup and rendering ---------- */
const wbIconById = (id) => WB_ICONS.find((i) => i.id === id) || (WB_ICON_ALIAS[id] ? WB_ICONS.find((i) => i.id === WB_ICON_ALIAS[id]) : null) || null;
// Full SVG markup of one icon in one colour, for the library panel and the canvas.
const wbIconSvg = (ic, color = '#ffffff', size = 64) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" style="color:${color}">${ic.svg}</svg>`;
// Bitmaps of icons for the canvas, one per icon, colour and size; made on first use.
const wbIconCache = new Map();
function wbIconImage(id, color, px) {
  const key = `${id}|${color}|${px}`;
  let hit = wbIconCache.get(key);
  if (hit) return hit;
  const ic = wbIconById(id);
  if (!ic) return null;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(wbIconSvg(ic, color, px));
  hit = { img, ready: false };
  img.onload = () => { hit.ready = true; if (wbIconCache.onReady) wbIconCache.onReady(); };
  wbIconCache.set(key, hit);
  if (wbIconCache.size > 600) wbIconCache.delete(wbIconCache.keys().next().value);
  return hit;
}
