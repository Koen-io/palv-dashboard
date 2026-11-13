'use strict';

/* ============================================================
   Tekenkit: wat alle tekenvlakken van het dashboard delen — het Whiteboard, de tekenlaag van de COA
   Planner en Teken Schip. De maat en ligging van elk getekend element, verplaatsen, draaien en schalen,
   het selectiekader met de draaigreep en de schaalgrepen, draaien en schalen met twee vingers, een
   object oppakken door erop te drukken en vast te houden, en het iconenpaneel met de snelle iconen bovenaan.
   ============================================================ */
// Elements are in board units: path (pts, width, marker), line (x1 y1 x2 y2, arrow, dash), rect and
// ellipse (x y w h, fill), text (x y text size), icon (x y icon size) and map (x y w h, whiteboard only).
// `rot` (degrees, clockwise) turns an element about the centre of its box; lines and strokes get their
// points turned instead (their `rot` stays 0) and a map always stays north-up.

const DK_SNAP = 4;          // a turn this close to a multiple of 45 degrees lands on it
const DK_HOLD_MS = 420;     // a press held this long on an object picks it up, whatever the tool
const DK_HOLD_SLOP = 8;     // screen pixels a finger may wander during that press
const DK_PINCH_DEAD = 0.06; // two fingers: this much (log) change in spread before the object starts to scale

const DK = {
  rad: (d) => (d * Math.PI) / 180,
  copy: (e) => JSON.parse(JSON.stringify(e)),
  // Turned about its own centre with `rot`, or with its points (lines, strokes); a map is never turned.
  ownRot: (e) => !!e && e.type !== 'path' && e.type !== 'line' && e.type !== 'map',
  canRotate: (e) => !!e && e.type !== 'map',
  // A large icon used as a base (an icon with its own standard size) or a map: drawn on, not picked up by accident.
  isUnderlay(e) {
    if (!e) return false;
    if (e.type === 'map') return true;
    if (e.type !== 'icon' || typeof wbIconById !== 'function') return false;
    const ic = wbIconById(e.icon);
    return !!(ic && ic.size);
  },
  // Width of a line of text (canvas measure, the same on the screen, in the hit test and on paper).
  measureCanvas: null,
  textWidth(text, size, font = '700 {s}px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif') {
    if (!DK.measureCanvas) DK.measureCanvas = document.createElement('canvas').getContext('2d');
    DK.measureCanvas.font = font.replace('{s}', size);
    return DK.measureCanvas.measureText(String(text)).width;
  },

  /* ---------- geometry ---------- */
  box(e, measure = DK.textWidth) {
    if (e.type === 'path') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of e.pts || []) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
      if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
      const p = ((e.width || 4) * (e.marker ? 3 : 1)) / 2;
      return { x: x0 - p, y: y0 - p, w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p };
    }
    if (e.type === 'line') { const x = Math.min(e.x1, e.x2), y = Math.min(e.y1, e.y2); return { x, y, w: Math.abs(e.x2 - e.x1), h: Math.abs(e.y2 - e.y1) }; }
    if (e.type === 'text') { const lines = String(e.text || '').split('\n'); const w = Math.max(...lines.map((l) => measure(l, e.size))); return { x: e.x, y: e.y, w, h: lines.length * e.size * 1.25 }; }
    if (e.type === 'icon') { const s = e.size || 80; return { x: e.x - s / 2, y: e.y - s / 2, w: s, h: s }; }
    return { x: Math.min(e.x, e.x + e.w), y: Math.min(e.y, e.y + e.h), w: Math.abs(e.w), h: Math.abs(e.h) };
  },
  centre(e, measure) { const b = DK.box(e, measure); return [b.x + b.w / 2, b.y + b.h / 2]; },
  // A board point in the element's own frame (its rotation about its centre undone).
  local(e, x, y, measure) {
    if (!e.rot || !DK.ownRot(e)) return [x, y];
    const [cx, cy] = DK.centre(e, measure), a = -DK.rad(e.rot), dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
  },
  segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0; return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); },
  // Is a board point on this element? `tol` in board units.
  hitOne(e, x, y, tol, measure) {
    const [lx, ly] = DK.local(e, x, y, measure);
    const b = DK.box(e, measure);
    if (lx < b.x - tol || ly < b.y - tol || lx > b.x + b.w + tol || ly > b.y + b.h + tol) return false;
    if (e.type === 'path') {
      const r = (e.width || 4) * (e.marker ? 1.5 : 0.5) + tol, p = e.pts || [];
      for (let j = 1; j < p.length; j += 1) if (DK.segDist(lx, ly, p[j - 1][0], p[j - 1][1], p[j][0], p[j][1]) <= r) return true;
      return p.length === 1 && Math.hypot(lx - p[0][0], ly - p[0][1]) <= r;
    }
    if (e.type === 'line') return DK.segDist(lx, ly, e.x1, e.y1, e.x2, e.y2) <= (e.width || 4) / 2 + tol;
    if (e.type === 'ellipse' && !e.fill) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rx = b.w / 2 || 1, ry = b.h / 2 || 1; const d = Math.hypot((lx - cx) / rx, (ly - cy) / ry); return Math.abs(d - 1) * Math.min(rx, ry) <= (e.width || 4) / 2 + tol; }
    if (e.type === 'rect' && !e.fill) return !(lx > b.x + tol && ly > b.y + tol && lx < b.x + b.w - tol && ly < b.y + b.h - tol);
    return true;
  },
  // The topmost element under a board point; a locked map is an underlay and left alone, unless asked for.
  hit(list, x, y, { tol = 8, measure, maps = false } = {}) {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const e = list[i];
      if (e.type === 'map' && e.lock && !maps) continue;
      if (DK.hitOne(e, x, y, tol, measure)) return e;
    }
    return null;
  },
  // Inside the box of an element (generous: for two fingers on a selection).
  inBox(e, x, y, pad, measure) { const [lx, ly] = DK.local(e, x, y, measure); const b = DK.box(e, measure); return lx >= b.x - pad && ly >= b.y - pad && lx <= b.x + b.w + pad && ly <= b.y + b.h + pad; },
  moveBy(e, dx, dy) {
    if (e.type === 'path') e.pts = e.pts.map(([x, y]) => [x + dx, y + dy]);
    else if (e.type === 'line') { e.x1 += dx; e.y1 += dy; e.x2 += dx; e.y2 += dy; }
    else { e.x += dx; e.y += dy; }
  },
  scaleBy(e, f, cx, cy) {
    const s = (x, y) => [cx + (x - cx) * f, cy + (y - cy) * f];
    if (e.type === 'path') { e.pts = e.pts.map(([x, y]) => s(x, y)); e.width = Math.max(0.5, (e.width || 4) * f); }
    else if (e.type === 'line') { [e.x1, e.y1] = s(e.x1, e.y1); [e.x2, e.y2] = s(e.x2, e.y2); e.width = Math.max(0.5, (e.width || 4) * f); }
    else if (e.type === 'text') { [e.x, e.y] = s(e.x, e.y); e.size = Math.max(6, e.size * f); }
    else if (e.type === 'icon') { [e.x, e.y] = s(e.x, e.y); e.size = Math.max(12, (e.size || 80) * f); }
    else if (e.type === 'map') { [e.x, e.y] = s(e.x, e.y); e.w *= f; e.h *= f; e.zoom = Math.max(2, Math.min(20, e.zoom + Math.log2(f))); } // same area, finer tiles
    else { [e.x, e.y] = s(e.x, e.y); e.w *= f; e.h *= f; e.width = Math.max(0.5, (e.width || 4) * f); }
  },
  // Turn to `deg`: own rotation, or the points of a line or stroke turned about the centre.
  rotateTo(e, deg, measure) {
    if (!DK.canRotate(e)) return;
    if (DK.ownRot(e)) { e.rot = ((Math.round(deg * 10) / 10 % 360) + 360) % 360; return; }
    const [cx, cy] = DK.centre(e, measure), a = DK.rad(deg - (e.rot || 0));
    const r = (x, y) => { const dx = x - cx, dy = y - cy; return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)]; };
    if (e.type === 'path') e.pts = e.pts.map(([x, y]) => r(x, y)); else { [e.x1, e.y1] = r(e.x1, e.y1); [e.x2, e.y2] = r(e.x2, e.y2); }
    e.rot = 0;
  },
  // A turn of `d` degrees, landing on a multiple of 45 when close (or on 15-degree steps with `fine`).
  snap(d, fine) {
    if (fine) return Math.round(d / 15) * 15;
    const n = Math.round(d / 45) * 45;
    return Math.abs(d - n) <= DK_SNAP ? n : d;
  },
  // A fresh copy of e0, turned by `drot`, scaled by `f` about its centre and moved by (dx, dy).
  transform(e0, { drot = 0, f = 1, dx = 0, dy = 0, fine = false } = {}, measure) {
    const e = DK.copy(e0);
    if (drot && DK.canRotate(e)) {
      if (DK.ownRot(e)) DK.rotateTo(e, DK.snap((e0.rot || 0) + drot, fine), measure);
      else DK.rotateTo(e, fine ? DK.snap(drot, true) : drot, measure);
    }
    if (f !== 1) { const [cx, cy] = DK.centre(e, measure); DK.scaleBy(e, f, cx, cy); }
    if (dx || dy) DK.moveBy(e, dx, dy);
    return e;
  },
  // Two fingers on an object: the turn of the line between them turns it, their spread scales it (after a
  // small dead zone, so turning does not also scale by accident), and their midpoint moves it.
  pinchStart(e0, a, b) { return { e0: DK.copy(e0), a0: Math.atan2(b[1] - a[1], b[0] - a[0]), d0: Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, m0: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; },
  pinchApply(st, a, b, measure) {
    let drot = ((Math.atan2(b[1] - a[1], b[0] - a[0]) - st.a0) * 180) / Math.PI;
    drot = ((drot + 540) % 360) - 180;
    const lf = Math.log(Math.max(1e-3, Math.hypot(b[0] - a[0], b[1] - a[1]) / st.d0));
    const f = Math.exp(Math.sign(lf) * Math.max(0, Math.abs(lf) - DK_PINCH_DEAD));
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return { e: DK.transform(st.e0, { drot, f: Math.max(0.1, Math.min(20, f)), dx: m[0] - st.m0[0], dy: m[1] - st.m0[1] }, measure), drot };
  },

  /* ---------- picking up an object, whatever the tool ---------- */
  // What a press on element `e` does with `tool`: 'now' (pick it up straight away), 'hold' (only after a
  // press held still) or null (the tool does its own thing). Strokes are drawn freely over everything;
  // the selected object, and with the icon or text tool any icon or text, is picked up at once. An
  // underlay (a ship to draw on, a map) only moves when it is selected first: drawing on it is the point.
  grabMode(tool, e, selId) {
    if (!e || tool === 'eraser' || tool === 'pan') return null;
    if (tool === 'select' || e.id === selId) return 'now';
    if (DK.isUnderlay(e)) return null;
    if (tool === 'icon' || (tool === 'text' && e.type === 'text')) return 'now';
    return 'hold';
  },
  // A press held still: `fire` after DK_HOLD_MS unless the pointer moved more than the slop first.
  hold(ev, fire) {
    const x0 = ev.clientX, y0 = ev.clientY;
    let t = setTimeout(() => { t = null; fire(); }, DK_HOLD_MS);
    return {
      move(e2) { if (t && Math.hypot(e2.clientX - x0, e2.clientY - y0) > DK_HOLD_SLOP) { clearTimeout(t); t = null; } },
      cancel() { if (t) clearTimeout(t); t = null; },
      get armed() { return !!t; },
    };
  },
  // Tools after which the new element is selected, so it can be moved and turned straight away.
  // A dashed line (`dash`): strokes, lines, arrows and the outline of shapes; never the marker.
  canDash: (e) => !!e && ((e.type === 'path' && !e.marker) || e.type === 'line' || e.type === 'rect' || e.type === 'ellipse'),
  // The dash pattern for a stroke this wide (round caps make the dashes a width longer and the gaps shorter).
  dashArray: (wd) => [wd * 2, wd * 3],
  selectAfter: (e) => !!e && (e.type === 'line' || e.type === 'rect' || e.type === 'ellipse' || e.type === 'icon' || e.type === 'text' || (e.type === 'path' && !!e.arrow)),
  // The head of a free arrow (a stroke with `arrow`): at its last point, pointing the way the stroke went at
  // the end. The direction is taken over the last stretch of at least a few line widths, so the jitter of
  // the final pixels of a hand-drawn line does not turn the head. Returns { x, y, a, L } or null.
  pathHead(pts, width = 4) {
    if (!pts || pts.length < 2) return null;
    const [x, y] = pts[pts.length - 1];
    const need = Math.max(8, width * 4);
    let i = pts.length - 2;
    while (i > 0 && Math.hypot(x - pts[i][0], y - pts[i][1]) < need) i -= 1;
    const [px, py] = pts[i];
    if (Math.hypot(x - px, y - py) < 0.5) return null;
    return { x, y, a: Math.atan2(y - py, x - px), L: Math.max(12, width * 3.6) };
  },
};

/* ---------- the selection: frame, turning handle, scaling handles ---------- */
// A frame over the drawing surface (a DOM layer in `host`, so it looks and feels the same on the canvas of
// the whiteboard and on the SVG of the COA Planner), turned with the element. The round handle just above
// it turns the element (Shift: steps of 15 degrees; it lands on multiples of 45; a double tap puts it
// straight again), the four corners scale it about its centre. A second finger that comes down while a
// grip is held turns the gesture into the two-finger one (turn, scale and move with both). `a` is the surface:
//   sel()                 the selected element (the live object) or null
//   toScreen(x, y)        a board point in pixels within `host`
//   toBoard(cx, cy)       a point on the screen (client pixels) in board units
//   k()                   pixels per board unit
//   measure               text width in board units (optional)
//   live(e)               show `e` (a fresh copy) in place of the selected element, without saving
//   commit(e, before)     save the result of a turn or scale
//   remove(e)             delete it (the bin under the frame)
function dkSelection(host, a) {
  const el = h('div', { class: 'dk-sel', hidden: true });
  const frame = h('div', { class: 'dk-frame' });
  const stem = h('div', { class: 'dk-stem' });
  const rot = h('button', { class: 'dk-rot', type: 'button', title: 'Draaien (Shift: stappen van 15°; dubbeltik: recht)', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.5 3.5v5h-5"/></svg>' });
  const corners = ['nw', 'ne', 'se', 'sw'].map((c) => h('div', { class: `dk-h dk-${c}`, 'data-c': c }));
  // Below the frame, opposite the turning grip (so the two never meet, however it is turned): delete.
  const del = h('button', { class: 'dk-del', type: 'button', title: 'Verwijderen (Delete)', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/></svg>' });
  el.append(frame, stem, rot, ...corners, del);
  const badge = h('div', { class: 'dk-badge', hidden: true });
  host.append(el, badge);
  let g = null;      // a turn or scale in progress: { kind, e0, c, a0, d0, id }
  let over = null;   // a frame to show instead (a line being turned): { e0, drot }
  let last = null;
  const measure = a.measure;

  function paint(e) {
    last = e || null;
    if (!e) { el.hidden = true; badge.hidden = true; return; }
    let fe = e, r = DK.ownRot(e) ? e.rot || 0 : 0;
    if (over && over.e0 && over.e0.id === e.id && !DK.ownRot(e)) { fe = over.e0; r = over.drot; }
    const b = DK.box(fe, measure), k = a.k();
    const [sx, sy] = a.toScreen(b.x + b.w / 2, b.y + b.h / 2);
    const pad = 7;
    const w = Math.max(30, b.w * k + pad * 2), hh = Math.max(30, b.h * k + pad * 2);
    el.hidden = false;
    el.style.left = `${sx - w / 2}px`; el.style.top = `${sy - hh / 2}px`;
    el.style.width = `${w}px`; el.style.height = `${hh}px`;
    el.style.transform = r ? `rotate(${r}deg)` : '';
    rot.hidden = !DK.canRotate(e);
    stem.hidden = rot.hidden;
    del.hidden = !a.remove;
    // The bin stays upright, whatever way the frame is turned.
    del.firstElementChild.style.transform = r ? `rotate(${-r}deg)` : '';
    el.classList.toggle('busy', !!g);
    if (g && g.kind === 'rot') {
      // The angle beside the handle (not turned with the frame, so it stays readable).
      const ang = DK.ownRot(e) ? e.rot || 0 : over ? over.drot : 0;
      const off = hh / 2 + (TOUCH.on() ? 62 : 52);
      const ra = DK.rad(r);
      badge.hidden = false;
      badge.textContent = `${String(Math.round(((ang % 360) + 360) % 360)).padStart(3, '0')}°`;
      badge.style.left = `${sx + off * Math.sin(ra)}px`; badge.style.top = `${sy - off * Math.cos(ra)}px`;
    } else badge.hidden = true;
  }
  const pt = (ev) => { const r = host.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  function begin(ev, kind) {
    const e = a.sel();
    if (!e || ev.button > 0) return;
    ev.preventDefault(); ev.stopPropagation();
    ev.currentTarget.setPointerCapture(ev.pointerId);
    const [cx, cy] = DK.centre(e, measure), c = a.toScreen(cx, cy), p = pt(ev);
    g = { kind, e0: DK.copy(e), c, a0: Math.atan2(p[1] - c[1], p[0] - c[0]), d0: Math.hypot(p[0] - c[0], p[1] - c[1]) || 1, id: ev.pointerId, moved: false, node: ev.currentTarget, last: [ev.clientX, ev.clientY], pinch: null };
    paint(e);
  }
  function move(ev) {
    if (!g) return;
    if (g.pinch) {
      if (!g.pinch.has(ev.pointerId)) return;
      g.pinch.set(ev.pointerId, [ev.clientX, ev.clientY]);
      const [p1, p2] = [...g.pinch.values()];
      const r = DK.pinchApply(g.st, a.toBoard(p1[0], p1[1]), a.toBoard(p2[0], p2[1]), measure);
      g.moved = true;
      a.live(r.e);
      return;
    }
    if (ev.pointerId !== g.id) return;
    g.last = [ev.clientX, ev.clientY];
    const p = pt(ev);
    let fresh;
    if (g.kind === 'rot') {
      let drot = ((Math.atan2(p[1] - g.c[1], p[0] - g.c[0]) - g.a0) * 180) / Math.PI;
      drot = ((drot + 540) % 360) - 180;
      fresh = DK.transform(g.e0, { drot, fine: ev.shiftKey }, measure);
      if (!DK.ownRot(g.e0)) over = { e0: g.e0, drot: ev.shiftKey ? DK.snap(drot, true) : drot };
    } else {
      const f = Math.max(0.08, Math.min(25, Math.hypot(p[0] - g.c[0], p[1] - g.c[1]) / g.d0));
      fresh = DK.transform(g.e0, { f }, measure);
    }
    g.moved = true;
    a.live(fresh);
  }
  function end(ev) {
    if (!g || (g.pinch ? !g.pinch.has(ev.pointerId) : ev.pointerId !== g.id)) return;
    const done = g; g = null; over = null;
    const e = a.sel();
    if (done.moved && e) a.commit(e, done.e0);
    paint(a.sel());
  }
  for (const n of [rot, ...corners]) {
    n.addEventListener('pointerdown', (ev) => begin(ev, n === rot ? 'rot' : 'scale'));
    n.addEventListener('pointermove', move);
    n.addEventListener('pointerup', end);
    n.addEventListener('pointercancel', end);
  }
  rot.addEventListener('dblclick', (ev) => { ev.stopPropagation(); const e = a.sel(); if (!e || !DK.ownRot(e) || !e.rot) return; const before = DK.copy(e); a.live(DK.transform(e, { drot: -e.rot }, measure)); a.commit(a.sel(), before); paint(a.sel()); });
  el.addEventListener('contextmenu', (ev) => ev.preventDefault());
  del.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
  del.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); const e = a.sel(); if (e && a.remove) a.remove(e); });
  // A second finger while a grip is held (often one finger lands on a grip when two go round an object):
  // from where the grip started, both fingers now turn, scale and move the selection.
  host.addEventListener('pointerdown', (ev) => {
    if (!g || g.pinch || ev.pointerId === g.id || ev.pointerType !== 'touch' || !a.toBoard) return;
    const e = a.sel();
    if (!e) return;
    ev.preventDefault(); ev.stopPropagation();
    over = null;
    const start = DK.copy(g.e0);
    a.live(start);
    try { g.node.setPointerCapture(ev.pointerId); } catch { /* gone already */ }
    g.pinch = new Map([[g.id, g.last], [ev.pointerId, [ev.clientX, ev.clientY]]]);
    g.kind = 'pinch';
    g.st = DK.pinchStart(start, a.toBoard(g.last[0], g.last[1]), a.toBoard(ev.clientX, ev.clientY));
  }, true);
  return {
    el,
    paint,
    repaint: () => paint(last && a.sel()),
    busy: () => !!g,
    // A gesture elsewhere (two fingers) that turns a line or stroke: show its frame turned with it.
    hold(e0, drot) { over = e0 ? { e0, drot } : null; },
    // A short pulse: the object has been picked up by a press held still.
    pulse() { el.classList.remove('dk-pulse'); void el.offsetWidth; el.classList.add('dk-pulse'); },
  };
}

/* ---------- keys on a selection ---------- */
// Arrow keys move the selection (Shift: ten times as far), [ and ] turn it by 15 degrees (Shift: 1).
// Returns a patch to apply, or null when the key is not one of these.
function dkKey(ev, e, k, measure) {
  if (!e) return null;
  const step = (ev.shiftKey ? 10 : 1) / Math.max(0.05, k);
  const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[ev.key];
  if (mv) return DK.transform(e, { dx: mv[0], dy: mv[1] }, measure);
  if ((ev.key === '[' || ev.key === ']') && DK.canRotate(e)) return DK.transform(e, { drot: (ev.key === ']' ? 1 : -1) * (ev.shiftKey ? 1 : 15) }, measure);
  return null;
}

/* ---------- the icon panel ---------- */
// The quick icons at the top of every icon panel: the ships to draw on, the COA symbols and the helicopters.
const DK_QUICK_HEAD = ['coaship', 'shipsectors'];
function dkQuickIcons() {
  if (typeof WB_ICONS === 'undefined') return [];
  const seen = new Set();
  const out = [];
  const add = (ic) => { if (ic && !seen.has(ic.id)) { seen.add(ic.id); out.push(ic); } };
  for (const id of DK_QUICK_HEAD) add(wbIconById(id));
  for (const ic of WB_ICONS) if (ic.cat === 'coa') add(ic);
  // Helicopters: from above first (police types first), then from the side.
  const helis = WB_ICONS.filter((ic) => ic.cat === 'air' && /helikopter/.test(ic.kw));
  const rank = (ic) => (/zijaanzicht/.test(ic.kw) ? 10 : 0) + (/politie/.test(ic.kw) ? 0 : 1);
  for (const ic of helis.sort((x, y) => rank(x) - rank(y))) add(ic);
  return out;
}
// The panel: search, the quick icons, the categories and the grid. `o`:
//   state      { query, cat } kept by the caller between repaints
//   picked()   the id of the icon in use, or null
//   pick(ic)   an icon is chosen
//   light()    true on a light surface (for the icons with their own colours)
//   px         size of a picture in the grid
//   extra      nodes below the grid (a size picker)
function dkIconPanel(o) {
  const st = o.state;
  const q = h('input', { class: 'input zp-profq', type: 'search', placeholder: 'Zoek: AW139, sniper, fastrope, schip…', value: st.query || '' });
  const quick = h('div', { class: 'wb-icons dk-quick' });
  const quickSec = h('div', { class: 'dk-quicksec' }, h('div', { class: 'dk-quickhead' }, h('b', {}, 'Snel'), h('small', {}, 'Schip, COA-symbolen en helikopters')), quick);
  const grid = h('div', { class: 'wb-icons' + (o.gridClass ? ' ' + o.gridClass : '') });
  const cats = h('div', { class: 'wb-cats' });
  const count = h('p', { class: 'zp-hint' });
  const picOf = (ic) => h('span', { class: 'wb-iconpic', html: wbIconSvg(ic, ic.own ? (o.light() ? '#0a0f18' : '#e9eff8') : 'currentColor', o.px || 40) });
  const label = (ic) => ic.name.replace(/\s*\((bovenaanzicht|zijaanzicht)?,?\s*(detail)?\)$/i, '').replace(/^Assault helo · /, 'AH · ').replace(/^Sniper helo · /, 'SH · ');
  const btn = (ic) => h('button', { class: 'wb-iconbtn' + (o.picked() === ic.id ? ' on' : '') + (ic.cat === 'coa' ? ' dk-sym' : ''), title: `${ic.name}${WB_CATS[ic.cat] ? ' · ' + WB_CATS[ic.cat] : ''}`, onclick: () => { o.pick(ic); paint(); } }, picOf(ic), h('small', {}, label(ic)));
  const quickList = dkQuickIcons();
  const quickIds = new Set(quickList.map((ic) => ic.id));
  function paint() {
    const words = String(st.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const searching = words.length > 0;
    quickSec.hidden = searching;
    if (!searching) quick.replaceChildren(...quickList.map(btn));
    const cat = st.cat || 'all';
    const list = WB_ICONS.filter((ic) => (searching || cat === 'all' ? true : ic.cat === cat) && words.every((wd) => ic.kw.includes(wd)) && (searching || cat !== 'all' || !quickIds.has(ic.id)));
    grid.replaceChildren(...list.map(btn));
    if (!list.length) grid.append(h('p', { class: 'zp-hint' }, 'Geen icoon gevonden.'));
    count.textContent = searching ? `${list.length} van ${WB_ICONS.length} iconen gevonden.` : `${WB_ICONS.length} iconen · in de kleur van de pen. Tik een icoon en tik of sleep op het bord; een geplaatst icoon pak je direct vast, draai je aan de ronde greep of met twee vingers, en dubbeltik geeft een label.`;
    cats.hidden = searching;
    cats.replaceChildren(h('button', { class: 'wb-cat' + (cat === 'all' ? ' on' : ''), onclick: () => { st.cat = 'all'; paint(); } }, 'Alles'), ...Object.entries(WB_CATS).map(([k, n]) => h('button', { class: 'wb-cat' + (cat === k ? ' on' : ''), onclick: () => { st.cat = k; paint(); } }, n)));
  }
  q.addEventListener('input', () => { st.query = q.value; paint(); });
  paint();
  return h('div', { class: 'zp-panel dk-iconpanel' }, h('div', { class: 'zp-profsearch' }, icon('search'), q), quickSec, cats, count, grid, o.extra || null);
}

/* ---------- undo and redo ---------- */
// Every step on a drawing surface can be taken back and done again: drawing, moving, turning, scaling,
// colours, deleting and clearing (one step for the lot). Kept per board or plan (`key`), so switching to
// another board and back keeps its history, the last DK_HISTORY steps each (hours of work).
const DK_HISTORY = 1000;
const DK_UNDO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const DK_REDO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>';
// A step is a list of { id, before, after } (null = not there). `onChange` after every change, for the buttons.
function dkHistory(onChange) {
  const all = new Map();
  const of = (key) => { if (!all.has(key)) all.set(key, { undo: [], redo: [] }); return all.get(key); };
  const changed = () => { if (onChange) onChange(); };
  return {
    push(key, items) {
      if (!items.length) return;
      const s = of(key);
      s.undo.push(items);
      if (s.undo.length > DK_HISTORY) s.undo.shift();
      s.redo.length = 0;
      changed();
    },
    // The items to write for one step back (or forward): [{ id, item }] with item null for a removal.
    take(key, forward) {
      const s = of(key), from = forward ? s.redo : s.undo, to = forward ? s.undo : s.redo;
      const step = from.pop();
      if (!step) return null;
      to.push(step);
      changed();
      return step.map((x) => ({ id: x.id, item: forward ? x.after : x.before }));
    },
    count(key) { const s = of(key); return { undo: s.undo.length, redo: s.redo.length }; },
  };
}
// The two buttons (a bent arrow back, a bent arrow forward). `big` for the floating pair on the surface.
function dkUndoButtons({ undo, redo, count, big = false, labels = false }) {
  const mk = (svg, label, title, fn) => h('button', { class: 'dk-ur' + (big ? ' big' : '') + (labels ? ' lab' : ''), type: 'button', title, onclick: (ev) => { ev.stopPropagation(); fn(); } }, h('span', { class: 'dk-ur-ic', html: svg }), labels ? h('span', {}, label) : null);
  const u = mk(DK_UNDO_SVG, 'Ongedaan', 'Ongedaan maken (Ctrl+Z)', undo);
  const r = mk(DK_REDO_SVG, 'Opnieuw', 'Opnieuw (Ctrl+Y)', redo);
  const el = h('div', { class: 'dk-urbar' + (big ? ' big' : '') }, u, r);
  el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  el.paint = () => {
    const c = count();
    u.disabled = !c.undo; r.disabled = !c.redo;
    u.title = c.undo ? `Ongedaan maken (Ctrl+Z) · nog ${c.undo} ${c.undo === 1 ? 'stap' : 'stappen'} terug` : 'Niets om ongedaan te maken';
    r.title = c.redo ? `Opnieuw (Ctrl+Y) · ${c.redo} ${c.redo === 1 ? 'stap' : 'stappen'} vooruit` : 'Niets om opnieuw te doen';
  };
  el.paint();
  return el;
}

// Solid or dashed, as two buttons with a picture of the line (like the widths). `cur` true = dashed.
function dkDashPicker(cur, onPick) {
  const mk = (dash, title) => h('button', { class: 'wb-width dk-dash' + (!!cur === dash ? ' on' : ''), type: 'button', title, onclick: () => onPick(dash) },
    h('span', { html: `<svg viewBox="0 0 60 8" preserveAspectRatio="none"><path d="M4 4H56" stroke="currentColor" stroke-width="4" stroke-linecap="round" ${dash ? 'stroke-dasharray="7 9"' : ''}/></svg>` }), h('small', {}, dash ? 'Stippellijn' : 'Doorgetrokken'));
  return h('div', { class: 'wb-widths dk-dashes' }, mk(false, 'Doorgetrokken lijn'), mk(true, 'Stippellijn: voor pen, vrije pijl, lijn, pijl, rechthoek en ellips'));
}

// A grip on the right edge of a side panel: drag it to make the panel wider or narrower (the width is kept
// by `set`), double-tap for the standard width again. It goes in the flex row right after the panel.
function dkPanelGrip(panel, { get, set, min = 170, max = 460 }) {
  const grip = h('div', { class: 'dk-grip', role: 'separator', 'aria-orientation': 'vertical', title: 'Sleep om het paneel breder of smaller te maken · dubbeltik: standaardbreedte' }, h('i'));
  const apply = (w) => { panel.style.width = w ? `${w}px` : ''; };
  apply(get());
  let st = null;
  grip.addEventListener('pointerdown', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    grip.setPointerCapture(ev.pointerId);
    st = { x: ev.clientX, w: panel.getBoundingClientRect().width, cur: null };
    grip.classList.add('busy');
  });
  grip.addEventListener('pointermove', (ev) => {
    if (!st) return;
    st.cur = Math.round(Math.max(min, Math.min(max, window.innerWidth * 0.45, st.w + ev.clientX - st.x)));
    apply(st.cur);
  });
  const end = () => { if (!st) return; if (st.cur) set(st.cur); st = null; grip.classList.remove('busy'); };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('dblclick', () => { set(null); apply(null); });
  return grip;
}
