'use strict';

/* ============================================================
   COA Planner: de tekenlaag
   Tekenen op het COA-bord en op het grote schip van Teken Schip, met dezelfde gereedschappen: pen,
   markeerstift, lijn, pijl, rechthoek, ellips, tekst, iconen (met de COA-symbolen, het tactische schip en de
   helikopters bovenaan) en de gum. Elk getekend element is een eigen item in het gedeelde bestand, dus
   twee schermen tekenen tegelijk; verplaatsen, draaien en schalen gaan zoals overal (drawkit.js).
   ============================================================ */
const COA_TOOLS = {
  select: { name: 'Selecteren', icon: 'target', hint: 'Tik op een tekening om haar te kiezen en sleep haar; draai aan de ronde greep of met twee vingers, schaal aan de hoeken.' },
  pen: { name: 'Pen', icon: 'edit', hint: 'Tekenen uit de vrije hand. Druk even op een tekening om haar op te pakken.' },
  farrow: { name: 'Vrije pijl', icon: 'route', hint: 'Teken uit de vrije hand: aan het eind komt vanzelf een pijlpunt, in de richting waarin je eindigde.' },
  marker: { name: 'Markeerstift', icon: 'note', hint: 'Brede, doorzichtige streek.' },
  line: { name: 'Lijn', icon: 'min', hint: 'Sleep van A naar B; de nieuwe lijn is meteen te verslepen en te draaien.' },
  arrow: { name: 'Pijl', icon: 'arrowUp', hint: 'Sleep van A naar B: de punt komt bij B. De nieuwe pijl is meteen te verslepen en te draaien.' },
  rect: { name: 'Rechthoek', icon: 'max', hint: 'Sleep een rechthoek.' },
  ellipse: { name: 'Ellips', icon: 'globe', hint: 'Sleep een ellips of cirkel.' },
  text: { name: 'Tekst', icon: 'keyboard', hint: 'Tik waar de tekst moet komen; tik op een tekst om haar te verslepen, dubbeltik om te bewerken.' },
  icon: { name: 'Icoon', icon: 'star', hint: 'Kies een icoon onder Iconen en tik of sleep het op zijn plaats. Een geplaatst icoon pak je direct vast.' },
  eraser: { name: 'Gum', icon: 'trash', hint: 'Tik of veeg over een tekening om haar te wissen.' },
};
const COA_COLORS = ['#ff4b55', '#ff9f1c', '#ffe14d', '#3ecf6e', '#3d9bff', '#b48cff', '#ff6fd8', '#ffffff', '#0a0f18', '#00c2c7'];
const COA_WIDTHS = [3, 5, 8, 13];
// Text on the COA surfaces: 700 in the dashboard's UI font, measured the same way everywhere.
const coaMeasure = (t, s) => DK.textWidth(t, s, `700 {s}px ${COA_FONTS.ui}`);

// One drawing surface. `o`:
//   el         the layer over the picture (absolutely positioned); the drawing and the selection go in it
//   tools      the element that gets the tool panel
//   cfg, save  the settings of the tab (tool, colour, width ...) and how to keep them
//   list       'marks' (the COA board) or 'shipmarks' (Teken Schip), in OPS kind 'coa'
//   plan()     the open plan (its id ties the drawings to it)
//   W, H       the board units of the picture under it
//   pal()      the colours in use (theme, night)
//   on()       true while drawing is switched on (handles, keys)
//   keys()     true when the keyboard is meant for this surface
//   iconMax    the largest size for an icon that brings its own (a ship to draw on)
//   onChange() after a repaint of the drawing (a count elsewhere)
function coaDrawLayer(o) {
  const cfg = o.cfg;
  const svgHost = h('div', { class: 'coa-drawsvg' });
  o.el.append(svgHost);
  let marks = [], selId = null, drawing = null, drag = null, hold = null, pending = null, queued = false;
  let lastSel = null; // the selection just before the first finger came down (it may have tapped beside it)
  const pointers = new Map();
  // Undo and redo per plan (drawkit.js); the buttons in the panel and the floating pair on the surface.
  const undoBars = new Set();
  const hist = dkHistory(() => { for (const b of undoBars) { if (b.isConnected) b.paint(); else if (b.dataset.seen) undoBars.delete(b); else b.dataset.seen = '1'; } });
  const histKey = () => (o.plan() || {}).id || '-';
  const marksOf = () => { const p = o.plan(); return p ? OPS.list('coa', o.list).filter((m) => m.plan === p.id).sort((a, b) => (a.z || 0) - (b.z || 0) || a.updatedAt - b.updatedAt) : []; };
  const selEl = () => (selId && marks.find((m) => m.id === selId)) || null;
  const svg = () => svgHost.firstElementChild;
  const ctm = () => { const s = svg(); return s && s.getScreenCTM ? s.getScreenCTM() : null; };
  const k = () => { const m = ctm(); return m ? Math.hypot(m.a, m.b) || 1 : 1; };
  const toScreen = (x, y) => { const m = ctm(); if (!m) return [0, 0]; const r = o.el.getBoundingClientRect(); return [m.a * x + m.c * y + m.e - r.left, m.b * x + m.d * y + m.f - r.top]; };
  const toBoard = (cx, cy) => { const m = ctm(); if (!m) return null; const i = m.inverse(); return [i.a * cx + i.c * cy + i.e, i.b * cx + i.d * cy + i.f]; };
  const tol = () => (TOUCH.on() ? 18 : 11) / k();

  /* ---------- painting ---------- */
  function paintNow() {
    queued = false;
    marks = marksOf();
    if (selId && !marks.some((m) => m.id === selId)) selId = null;
    const Pp = o.pal();
    svgHost.innerHTML = `<svg viewBox="0 0 ${o.W} ${o.H}" preserveAspectRatio="xMidYMid meet">${marks.map((m) => coaMarkSvg(m, Pp)).join('')}${drawing ? coaMarkSvg(drawing, Pp) : ''}</svg>`;
    selUi.paint(o.on() ? selEl() : null);
    if (floatBar) floatBar.hidden = !o.on();
    for (const b of undoBars) b.paint();
    if (o.onChange) o.onChange(marks.length);
  }
  // The marks of the list as they are now, with the one being moved or turned in its new place.
  function liveSet(e) { const i = marks.findIndex((m) => m.id === e.id); if (i >= 0) marks[i] = e; }
  // A frame later, once (while dragging, many moves become one repaint): the marks as they are in memory.
  function paintLive() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      const Pp = o.pal();
      svgHost.innerHTML = `<svg viewBox="0 0 ${o.W} ${o.H}" preserveAspectRatio="xMidYMid meet">${marks.map((m) => coaMarkSvg(m, Pp)).join('')}${drawing ? coaMarkSvg(drawing, Pp) : ''}</svg>`;
      selUi.paint(o.on() ? selEl() : null);
    });
  }
  const selUi = dkSelection(o.el, {
    sel: selEl,
    toScreen,
    toBoard,
    k,
    measure: coaMeasure,
    live: (fresh) => { const e = selEl(); if (e) { Object.assign(e, fresh); paintLive(); } },
    commit: (e, before) => { commitMark(e, before); paintNow(); },
    remove: (e) => { removeMark(e); paintNow(); if (o.on()) paintTools(); },
  });
  function select(id) {
    if (selId === (id || null)) return;
    selId = id || null;
    paintNow();
    if (o.on()) paintTools();
  }

  /* ---------- saving ---------- */
  const cleanMark = (e) => { const c = { ...e }; delete c.id; delete c.updatedAt; if (c.type === 'path') c.pts = c.pts.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]); return c; };
  function commitMark(e, before) {
    const p = o.plan();
    if (!p) return;
    const id = e.id || OPS.uid();
    e.id = id; e.plan = p.id; e.by = OPS.screen.name;
    if (e.z == null) e.z = marks.length ? Math.max(...marks.map((m) => m.z || 0)) + 1 : 1;
    hist.push(p.id, [{ id, before: before ? cleanMark(before) : null, after: cleanMark(e) }]);
    OPS.put('coa', o.list, id, cleanMark(e));
  }
  function removeMark(e) { hist.push(histKey(), [{ id: e.id, before: cleanMark(e), after: null }]); OPS.put('coa', o.list, e.id, null); if (selId === e.id) selId = null; }
  // One step back (or forward with `forward`): whatever that step changed, in one write.
  function doUndo(forward) {
    const p = o.plan();
    if (!p) return;
    const items = hist.take(p.id, forward);
    if (!items) return;
    OPS.putMany('coa', items.map(({ id, item }) => ({ list: o.list, id, item: item ? { ...item, plan: p.id } : null })));
    // What came back is shown selected (one drawing), so it is clear what changed.
    const back = items.filter((x) => x.item);
    selId = back.length === 1 ? back[0].id : null;
    paintNow(); if (o.on()) paintTools();
  }
  const undoBar = (opt = {}) => { const b = dkUndoButtons({ undo: () => doUndo(false), redo: () => doUndo(true), count: () => hist.count(histKey()), ...opt }); undoBars.add(b); return b; };
  // The floating pair on the surface, unless the page puts the pair in its own toolbar (`floatUndo: false`).
  const floatBar = o.floatUndo === false ? null : undoBar({ big: true });
  if (floatBar) o.el.append(floatBar);
  function clearAll() {
    if (!marks.length) return;
    confirmDialog('Tekening wissen', `Alle ${marks.length} tekeningen ${o.list === 'shipmarks' ? 'op het schip' : 'op dit plan'} wissen, ook op de andere schermen?`, 'Wissen', () => { hist.push(histKey(), marks.map((m) => ({ id: m.id, before: cleanMark(m), after: null }))); OPS.putMany('coa', marks.map((m) => ({ list: o.list, id: m.id, item: null }))); selId = null; paintNow(); paintTools(); toast('Tekening gewist · Ongedaan maken zet alles terug'); });
  }

  /* ---------- text and labels ---------- */
  function textDialog(at, e0) {
    const ta = h('textarea', { class: 'input', rows: 3, value: e0 ? e0.text : '', placeholder: 'bv. LZ, FRIES 1, holding' });
    openModal({ title: e0 ? 'Tekst bewerken' : 'Tekst plaatsen', body: [field('Tekst', ta)], actions: [{ label: 'Annuleren' }, { label: e0 ? 'Opslaan' : 'Plaatsen', primary: true, onClick: () => {
      const t = ta.value.trim();
      if (e0) { const b = DK.copy(e0); if (!t) removeMark(e0); else { e0.text = t; commitMark(e0, b); } }
      else if (t) { const e = { type: 'text', x: at.x, y: at.y, text: t, size: cfg.fontSize, color: cfg.color, rot: 0 }; commitMark(e); selId = e.id; }
      paintNow(); if (o.on()) paintTools();
    } }] });
  }
  function labelDialog(e) {
    const inp = textInput(e.label || '', { maxlength: 16, placeholder: 'bv. LION01' });
    openModal({ title: 'Label bij het icoon', body: [field('Label', inp)], actions: [{ label: 'Annuleren' }, { label: 'Opslaan', primary: true, onClick: () => { const b = DK.copy(e); e.label = inp.value.trim() || undefined; commitMark(e, b); paintNow(); if (o.on()) paintTools(); } }] });
  }

  /* ---------- pointer handling ---------- */
  // As on the whiteboard: the selected drawing is picked up in every tool, an icon or text with the icon or
  // text tool, anything else by pressing on it and holding still; two fingers turn, scale and move it.
  const onSel = (x, y) => { const s = selEl(); return s && DK.hitOne(s, x, y, tol(), coaMeasure) ? s : null; };
  const hitMark = (x, y) => DK.hit(marks, x, y, { tol: tol(), measure: coaMeasure });
  function startMove(e, x, y) { select(e.id); drag = { mode: 'move', e0: DK.copy(e), e, x0: x, y0: y, moved: false }; o.el.style.cursor = 'grabbing'; }
  const toolCursor = () => (cfg.tool === 'select' ? 'default' : cfg.tool === 'text' ? 'text' : 'crosshair');
  o.el.addEventListener('pointerdown', (ev) => {
    if (!o.on() || !o.plan() || ev.target.closest('.dk-sel')) return;
    const pt = toBoard(ev.clientX, ev.clientY); if (!pt) return;
    ev.preventDefault();
    o.el.setPointerCapture(ev.pointerId);
    if (!pointers.size) lastSel = selId;
    pointers.set(ev.pointerId, pt);
    if (pointers.size === 2) {
      if (hold) { hold.cancel(); hold = null; }
      pending = null;
      // An icon that the first finger was about to place is not placed: two fingers turn, not place.
      if (drag && drag.mode === 'place') { drawing = null; drag = null; }
      drawing = null;
      const [a, b] = [...pointers.values()];
      const s = selEl() || (lastSel && marks.find((m) => m.id === lastSel)) || null;
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const held = drag && drag.mode === 'move' ? selEl() : null;
      // The object held by the first finger; else the selection between the fingers; else whatever lies
      // between them (two fingers around a helicopter and turn), but never the ship to draw on.
      const under = DK.hit(marks, mid[0], mid[1], { tol: 34 / k(), measure: coaMeasure });
      const target = held || (s && DK.inBox(s, mid[0], mid[1], 40 / k(), coaMeasure) ? s : null) || (under && !DK.isUnderlay(under) ? under : null);
      if (target) {
        const before = held && drag.e0 ? drag.e0 : DK.copy(target);
        selId = target.id;
        drag = { mode: 'pinch', before, st: DK.pinchStart(target, a, b), moved: false };
      } else drag = { mode: 'none' };
      paintNow();
      return;
    }
    if (pointers.size > 2) return;
    const [x, y] = pt, tool = cfg.tool;
    const target = onSel(x, y) || hitMark(x, y);
    const how = DK.grabMode(tool, target, selId);
    if (tool === 'select') { if (target) startMove(target, x, y); else select(null); return; }
    if (how === 'now') { startMove(target, x, y); if (tool === 'text' && target.type === 'text') drag.tapEdit = true; return; }
    if (tool === 'eraser') { drag = { mode: 'erase' }; const e = hitMark(x, y); if (e) { removeMark(e); paintNow(); } return; }
    if (selId) select(null);
    if (how === 'hold') {
      hold = DK.hold(ev, () => {
        hold = null;
        const e = pointers.size === 1 && marks.find((m) => m.id === target.id);
        if (!e) return;
        drawing = null; pending = null;
        startMove(e, x, y);
        selUi.pulse();
        paintNow();
      });
    }
    if (tool === 'text') { pending = { x, y }; return; }
    if (tool === 'icon') {
      const ic = wbIconById(cfg.iconId);
      if (!ic) { toast('Kies eerst een icoon onder Iconen'); return; }
      drawing = { type: 'icon', x, y, icon: ic.id, size: ic.size ? Math.min(ic.size, o.iconMax || 300) : cfg.iconSize, color: cfg.color, rot: 0 };
      // A ship to draw on goes under what is already drawn.
      if (ic.size) drawing.z = marks.length ? Math.min(...marks.map((m) => m.z || 0)) - 1 : 0;
      drag = { mode: 'place' };
      paintLive();
      return;
    }
    const base = { color: cfg.color, width: cfg.width, ...(cfg.dash && tool !== 'marker' ? { dash: true } : {}) };
    if (tool === 'pen' || tool === 'marker' || tool === 'farrow') drawing = { type: 'path', pts: [[x, y]], marker: tool === 'marker', ...(tool === 'farrow' ? { arrow: 'end' } : {}), ...base };
    else if (tool === 'line' || tool === 'arrow') drawing = { type: 'line', x1: x, y1: y, x2: x, y2: y, arrow: tool === 'arrow' ? 'end' : 'none', ...base };
    else drawing = { type: tool, x, y, w: 0, h: 0, fill: !!cfg.fill, rot: 0, ...base };
    paintLive();
  });
  o.el.addEventListener('pointermove', (ev) => {
    if (!o.on()) return;
    const pt = toBoard(ev.clientX, ev.clientY); if (!pt) return;
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, pt);
    if (hold) hold.move(ev);
    if (drag && drag.mode === 'pinch') {
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const r = DK.pinchApply(drag.st, a, b, coaMeasure);
        const e = selEl();
        if (e) { Object.assign(e, r.e); drag.moved = true; paintLive(); }
      }
      return;
    }
    if (drag && drag.mode === 'none') return;
    const [x, y] = pt;
    if (drag && drag.mode === 'erase') { const e = hitMark(x, y); if (e) { removeMark(e); paintNow(); } return; }
    if (drag && drag.mode === 'place') { if (drawing) { drawing.x = x; drawing.y = y; paintLive(); } return; }
    if (drag && drag.mode === 'move') {
      const dx = x - drag.x0, dy = y - drag.y0;
      if (!drag.moved && Math.hypot(dx, dy) * k() < 3) return;
      drag.moved = true;
      const fresh = DK.copy(drag.e0); DK.moveBy(fresh, dx, dy);
      const e = selEl() || drag.e;
      Object.assign(e, fresh); drag.e = e; liveSet(e);
      paintLive();
      return;
    }
    if (!drawing) {
      if (!drag && ev.pointerType === 'mouse' && cfg.tool !== 'eraser') { const t = onSel(x, y) || hitMark(x, y); o.el.style.cursor = t && (cfg.tool === 'select' || DK.grabMode(cfg.tool, t, selId) === 'now') ? 'move' : toolCursor(); }
      return;
    }
    if (drawing.type === 'path') { const l = drawing.pts[drawing.pts.length - 1]; if (Math.hypot(x - l[0], y - l[1]) * k() >= 1.5) drawing.pts.push([x, y]); }
    else if (drawing.type === 'line') {
      drawing.x2 = x; drawing.y2 = y;
      if (ev.shiftKey) { const a = Math.round(Math.atan2(y - drawing.y1, x - drawing.x1) / (Math.PI / 4)) * (Math.PI / 4), L = Math.hypot(x - drawing.x1, y - drawing.y1); drawing.x2 = drawing.x1 + L * Math.cos(a); drawing.y2 = drawing.y1 + L * Math.sin(a); }
    } else { drawing.w = x - drawing.x; drawing.h = y - drawing.y; if (ev.shiftKey) { const m = Math.max(Math.abs(drawing.w), Math.abs(drawing.h)); drawing.w = Math.sign(drawing.w || 1) * m; drawing.h = Math.sign(drawing.h || 1) * m; } }
    paintLive();
  });
  const endDraw = (ev) => {
    pointers.delete(ev.pointerId);
    if (hold) { hold.cancel(); hold = null; }
    if (drag && drag.mode === 'pinch') {
      if (pointers.size < 2) { const e = selEl(); if (drag.moved && e) commitMark(e, drag.before); drag = pointers.size ? { mode: 'none' } : null; paintNow(); if (o.on()) paintTools(); }
      return;
    }
    if (drag && drag.mode === 'none') { if (!pointers.size) drag = null; return; }
    if (pending) { const p = pending; pending = null; textDialog(p, null); return; }
    if (drag && drag.mode === 'place') {
      const e = drawing; drawing = null; drag = null;
      if (e) { commitMark(e); if (!DK.isUnderlay(e)) selId = e.id; }
      paintNow(); if (o.on()) paintTools();
      return;
    }
    if (drag && drag.mode === 'move') {
      const d = drag; drag = null;
      o.el.style.cursor = toolCursor();
      if (d.moved) commitMark(d.e, d.e0);
      else if (d.tapEdit) { const e = selEl(); if (e) textDialog(null, e); }
      paintNow();
      return;
    }
    drag = null;
    if (drawing) {
      const d = drawing; drawing = null;
      if (d.type !== 'path' && d.type !== 'line') { if (d.w < 0) { d.x += d.w; d.w = -d.w; } if (d.h < 0) { d.y += d.h; d.h = -d.h; } }
      const tiny = (d.type === 'line' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) * k() < 5) || ((d.type === 'rect' || d.type === 'ellipse') && (Math.abs(d.w) * k() < 5 || Math.abs(d.h) * k() < 5));
      if (!tiny) { commitMark(d); if (DK.selectAfter(d)) selId = d.id; }
      paintNow(); if (o.on()) paintTools();
    }
  };
  o.el.addEventListener('pointerup', endDraw);
  o.el.addEventListener('pointercancel', endDraw);
  o.el.addEventListener('dblclick', (ev) => {
    if (!o.on() || ev.target.closest('.dk-sel')) return;
    const pt = toBoard(ev.clientX, ev.clientY); if (!pt) return;
    const e = hitMark(pt[0], pt[1]);
    if (e && e.type === 'text') textDialog(null, e); else if (e && e.type === 'icon') labelDialog(e);
  });
  // Alt + wheel turns the selection, 5 degrees a notch (saved once the wheel rests).
  let wheelTurn = null;
  o.el.addEventListener('wheel', (ev) => {
    const s = selEl();
    if (!o.on() || !ev.altKey || !s || !DK.canRotate(s)) return;
    ev.preventDefault();
    if (!wheelTurn) wheelTurn = { before: DK.copy(s), t: null };
    Object.assign(s, DK.transform(s, { drot: ev.deltaY < 0 ? -5 : 5 }, coaMeasure));
    clearTimeout(wheelTurn.t);
    wheelTurn.t = setTimeout(() => { const e = selEl(); if (e && wheelTurn) commitMark(e, wheelTurn.before); wheelTurn = null; paintNow(); }, 450);
    paintLive();
  }, { passive: false });
  const onKey = (ev) => {
    if (!o.on() || !o.keys() || /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName)) return;
    const key = ev.key.toLowerCase();
    if ((ev.ctrlKey || ev.metaKey) && key === 'z') { ev.preventDefault(); ev.stopPropagation(); doUndo(ev.shiftKey); return; }
    if ((ev.ctrlKey || ev.metaKey) && key === 'y') { ev.preventDefault(); ev.stopPropagation(); doUndo(true); return; }
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const s = selEl();
    if (!s) return;
    if (ev.key === 'Escape') { select(null); ev.preventDefault(); ev.stopPropagation(); return; }
    if (key === 'delete' || key === 'backspace') { removeMark(s); paintNow(); paintTools(); ev.preventDefault(); ev.stopPropagation(); return; }
    const moved = dkKey(ev, s, k(), coaMeasure);
    if (moved) { const before = DK.copy(s); Object.assign(s, moved); commitMark(s, before); paintNow(); ev.preventDefault(); ev.stopPropagation(); }
  };
  window.addEventListener('keydown', onKey, true);

  /* ---------- the tool panel ---------- */
  const iconState = { query: '', cat: 'all' };
  const setTool = (t) => { cfg.tool = t; o.save(); if (t !== 'select' && selId && !DK.selectAfter(selEl())) selId = null; o.el.style.cursor = toolCursor(); paintNow(); paintTools(); };
  function turnSel(d) { const s = selEl(); if (!s) return; const b = DK.copy(s); Object.assign(s, DK.transform(s, { drot: d }, coaMeasure)); commitMark(s, b); paintNow(); paintTools(); }
  function patchSel(patch) { const s = selEl(); if (!s) return; const b = DK.copy(s); Object.assign(s, patch); commitMark(s, b); paintNow(); paintTools(); }
  function paintTools() {
    if (!o.tools) return;
    const scroll = o.tools.scrollTop;
    const tabs = segmented([{ value: 'draw', label: 'Tekenen' }, { value: 'icons', label: 'Iconen' }], cfg.toolTab, (v) => { cfg.toolTab = v; o.save(); paintTools(); });
    const s = selEl();
    let content;
    if (cfg.toolTab === 'icons') {
      content = dkIconPanel({
        state: iconState, px: 36, gridClass: 'coa-icons',
        light: () => !!(o.pal() && o.pal().bg && /^#[ef]/i.test(o.pal().bg)),
        picked: () => (cfg.tool === 'icon' ? cfg.iconId : null),
        pick: (ic) => { cfg.iconId = ic.id; cfg.tool = 'icon'; o.save(); o.el.style.cursor = toolCursor(); },
        extra: h('div', { class: 'row' }, field('Icoongrootte', zpSelect([50, 70, 90, 120, 160].map((v) => ({ value: v, label: `${v}` })), cfg.iconSize, (v) => { cfg.iconSize = +v; o.save(); if (s && s.type === 'icon' && !DK.isUnderlay(s)) patchSel({ size: +v }); }))),
      });
    } else {
      content = h('div', { class: 'zp-panel' },
        h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Gereedschap')),
          // The icon tool has no button: picking an icon under Iconen switches to it.
          h('div', { class: 'wb-tools coa-toolgrid' }, Object.entries(COA_TOOLS).filter(([key]) => key !== 'icon').map(([key, t]) => h('button', { class: 'wb-toolbtn' + (cfg.tool === key ? ' on' : ''), title: `${t.name} — ${t.hint}`, onclick: () => setTool(key) }, icon(t.icon), h('span', {}, t.name)))),
          h('p', { class: 'zp-hint' }, (COA_TOOLS[cfg.tool] || COA_TOOLS.pen).hint)),
        h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Kleur en dikte')),
          h('div', { class: 'wb-colors' }, COA_COLORS.map((c) => h('button', { class: 'wb-color' + (cfg.color === c ? ' on' : ''), style: `--c:${c}`, title: c, onclick: () => { cfg.color = c; o.save(); if (s) patchSel({ color: c }); else paintTools(); } }))),
          h('div', { class: 'wb-widths' }, COA_WIDTHS.map((wd) => h('button', { class: 'wb-width' + (cfg.width === wd ? ' on' : ''), title: `${wd}`, onclick: () => { cfg.width = wd; o.save(); if (s && (s.type === 'path' || s.type === 'line' || s.type === 'rect' || s.type === 'ellipse')) patchSel({ width: wd }); else paintTools(); } }, h('i', { style: `height:${Math.min(12, wd)}px` })))),
          dkDashPicker(DK.canDash(s) ? !!s.dash : cfg.dash, (v) => { cfg.dash = v; o.save(); if (DK.canDash(s)) patchSel({ dash: v || undefined }); else paintTools(); }),
          checkbox('Vormen vullen', !!cfg.fill, (v) => { cfg.fill = v; o.save(); if (s && (s.type === 'rect' || s.type === 'ellipse')) patchSel({ fill: v }); }),
          h('div', { class: 'row' }, field('Tekstgrootte', zpSelect([20, 26, 30, 40, 54].map((v) => ({ value: v, label: `${v}` })), cfg.fontSize, (v) => { cfg.fontSize = +v; o.save(); if (s && s.type === 'text') patchSel({ size: +v }); })))),
        s ? h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Selectie'), h('span', { class: 'zp-fold-badge' }, { path: s.arrow ? 'vrije pijl' : 'streek', line: s.arrow && s.arrow !== 'none' ? 'pijl' : 'lijn', rect: 'rechthoek', ellipse: 'ellips', text: 'tekst', icon: 'icoon' }[s.type] || s.type)),
          DK.canRotate(s) ? h('div', { class: 'zp-btnrow dk-turnrow' },
            h('button', { class: 'btn zp-btn', title: '15° linksom ([)', onclick: () => turnSel(-15) }, '↺ 15°'),
            DK.ownRot(s) ? h('button', { class: 'btn zp-btn', title: 'Recht zetten (0°)', disabled: !s.rot || null, onclick: () => patchSel({ rot: 0 }) }, icon('refresh'), s.rot ? `Recht (nu ${Math.round(s.rot)}°)` : 'Recht') : null,
            h('button', { class: 'btn zp-btn', title: '15° rechtsom (])', onclick: () => turnSel(15) }, '↻ 15°')) : null,
          h('div', { class: 'zp-btnrow' },
            s.type === 'icon' ? h('button', { class: 'btn zp-btn', onclick: () => labelDialog(s) }, icon('keyboard'), s.label ? `Label: ${s.label}` : 'Label…') : null,
            s.type === 'text' ? h('button', { class: 'btn zp-btn', onclick: () => textDialog(null, s) }, icon('edit'), 'Bewerken') : null,
            s.type === 'line' ? h('button', { class: 'btn zp-btn', title: 'Pijlpunt wisselen', onclick: () => patchSel({ arrow: s.arrow === 'end' ? 'both' : s.arrow === 'both' ? 'none' : 'end' }) }, s.arrow === 'end' ? 'Pijl: beide' : s.arrow === 'both' ? 'Geen pijl' : 'Pijlpunt') : null,
            h('button', { class: 'btn zp-btn', title: 'Bovenop leggen', onclick: () => patchSel({ z: marks.length ? Math.max(...marks.map((m) => m.z || 0)) + 1 : 1 }) }, icon('arrowUp'), 'Voor'),
            h('button', { class: 'btn zp-btn', title: 'Onderop leggen', onclick: () => patchSel({ z: marks.length ? Math.min(...marks.map((m) => m.z || 0)) - 1 : 0 }) }, icon('arrowDown'), 'Achter'),
            h('button', { class: 'btn zp-btn', title: 'Kopie ernaast', onclick: () => { const c = DK.copy(s); delete c.id; delete c.updatedAt; delete c.z; DK.moveBy(c, 24, 24); commitMark(c); selId = c.id; paintNow(); paintTools(); } }, icon('history'), 'Kopie'),
            h('button', { class: 'btn zp-btn danger', onclick: () => { removeMark(s); paintNow(); paintTools(); } }, icon('trash'), 'Verwijderen'))) : null,
        h('div', { class: 'zp-sec' }, h('div', { class: 'zp-sec-head' }, h('h3', {}, 'Tekening')),
          h('div', { class: 'dk-urrow' }, undoBar({ labels: true })),
          h('div', { class: 'zp-btnrow' },
            h('button', { class: 'btn zp-btn danger', onclick: clearAll }, icon('trash'), 'Alles wissen')),
          h('p', { class: 'zp-hint' }, o.hint || 'Iconen en tekst pak je direct vast; lijnen, pijlen en vormen door er even op te drukken. Draaien aan de ronde greep, met twee vingers of met [ en ]; schalen aan de hoeken; pijltjes verplaatsen. Dubbeltik op tekst om te bewerken, op een icoon voor een label.')));
    }
    o.tools.replaceChildren(h('div', { class: 'coa-toolhead' }, h('b', {}, o.title || 'Tekenlaag'), tabs), content);
    o.tools.scrollTop = scroll;
  }

  // For a test run (scripted over the DevTools protocol): the state of this surface.
  o.el.dkState = () => ({ selId, drag: drag && drag.mode, drawing: drawing && drawing.type, pointers: [...pointers.keys()], hold: !!hold });
  const unsub = OPS.on('coa', () => { if (drag && (drag.mode === 'move' || drag.mode === 'pinch')) return; paintNow(); if (o.on() && !(document.activeElement && o.tools && o.tools.contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) paintTools(); });
  return {
    paint: paintNow,
    paintTools,
    undoBar,
    marks: () => marks,
    clearSel: () => { selId = null; selUi.paint(null); },
    mode: () => { o.el.style.cursor = o.on() ? toolCursor() : ''; if (!o.on()) { selId = null; drawing = null; drag = null; } paintNow(); if (o.on()) paintTools(); },
    destroy() { unsub(); window.removeEventListener('keydown', onKey, true); if (hold) hold.cancel(); },
  };
}
