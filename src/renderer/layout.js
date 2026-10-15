'use strict';

/* ============================================================
   Indeling: widgetframes, slepen en schalen, pagina's, toevoegen en instellen.
   ============================================================ */

function applyGeometry(el, w) {
  el.style.left = (w.x / COLS) * 100 + '%';
  el.style.top = (w.y / ROWS) * 100 + '%';
  el.style.width = (w.w / COLS) * 100 + '%';
  el.style.height = (w.h / ROWS) * 100 + '%';
  el.style.zIndex = w.z || 1;
  const size = el.querySelector('.w-edit-size');
  if (size) size.textContent = `${Math.round((w.w / COLS) * 100)} × ${Math.round((w.h / ROWS) * 100)} %`;
}

function mountWidget(page, w) {
  destroyWidget(w.id);
  const def = WIDGETS[w.type];
  const body = h('div', { class: 'w-body' });
  const tools = h('div', { class: 'w-tools' });
  const title = h('span', { class: 'w-title' }, w.title);
  const age = h('span', { class: 'w-age' });
  const panel = h('div', { class: 'w-panel' }, def.chromeless ? null : h('div', { class: 'w-head' }, icon(def.icon, 'w-head-icon'), title, age, tools), body);
  // The title shows whenever it fits in full beside the controls; rather than cut off, it leaves the icon to stand for it.
  const titleFit = new ResizeObserver(() => { title.style.display = ''; if (title.scrollWidth > title.clientWidth + 1) title.style.display = 'none'; });
  titleFit.observe(panel);
  titleFit.observe(tools);
  const edit = h(
    'div',
    { class: 'w-edit' },
    h('span', { class: 'w-edit-name' }, w.title),
    h(
      'div',
      { class: 'w-edit-actions' },
      h('button', { title: 'Instellen', onclick: () => openWidgetConfig(w) }, icon('gear')),
      h('button', { class: 'danger', title: 'Verwijderen', onclick: () => removeWidget(w) }, icon('trash'))
    ),
    h('span', { class: 'w-edit-size' }),
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) => h('span', { class: 'handle ' + dir, 'data-dir': dir }))
  );
  const el = h('div', { class: 'widget ' + w.type, 'data-id': w.id }, panel, edit);
  edit.addEventListener('pointerdown', (e) => startDrag(e, page, w, el));
  edit.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => e.stopPropagation()));
  applyGeometry(el, w);
  pageEls.get(page.id).append(el);
  let inst = {};
  try {
    inst = def.mount(w, body, tools) || {};
  } catch (err) {
    plog('error', `widget "${w.title}" kon niet starten`, String(err && err.stack || err));
    body.append(h('div', { class: 'w-state' }, h('div', {}, h('strong', {}, 'Deze widget kon niet starten'), 'Probeer hem te vernieuwen of opnieuw toe te voegen.')));
  }
  // How old the data is: a dot with time and age in the title bar, for every widget that shows data.
  const badge = inst.fresh && !def.chromeless ? freshBadge(inst.fresh) : null;
  if (badge) age.append(badge);
  instances.set(w.id, { el, focus: inst.focus, destroy: () => { titleFit.disconnect(); if (badge) badge.dispose(); if (inst.destroy) inst.destroy(); } });
  updateEmptyState(page);
}

function destroyWidget(id) {
  const inst = instances.get(id);
  if (!inst) return;
  try { if (inst.destroy) inst.destroy(); } catch (err) { plog('warn', 'widget opruimen mislukt', String(err)); }
  inst.el.remove();
  instances.delete(id);
}

function removeWidget(w) {
  const page = state.pages.find((p) => p.widgets.includes(w));
  confirmDialog('Widget verwijderen', `"${w.title}" van deze pagina verwijderen?`, 'Verwijderen', () => {
    destroyWidget(w.id);
    page.widgets.splice(page.widgets.indexOf(w), 1);
    updateEmptyState(page);
    save();
  });
}

function updateEmptyState(page) {
  const el = pageEls.get(page.id);
  if (!el) return;
  let empty = el.querySelector('.page-empty');
  if (page.widgets.length) { if (empty) empty.remove(); return; }
  if (empty) return;
  el.append(
    h('div', { class: 'page-empty' }, h('div', {}, h('h2', {}, 'Deze pagina is nog leeg'), h('p', {}, 'Voeg widgets en app-tegels toe en sleep ze naar de gewenste plek.'), h('button', { class: 'btn primary', onclick: openAddWidget }, icon('plus'), 'Widget toevoegen')))
  );
}

function remountType(type) {
  for (const p of state.pages) {
    if (!pageEls.has(p.id)) continue;
    for (const w of p.widgets) if (w.type === type) mountWidget(p, w);
  }
}

/* ---------- drag & resize ---------- */
function startDrag(e, page, w, el) {
  if (!editing || e.button !== 0) return;
  e.preventDefault();
  const dir = e.target.dataset.dir || 'move';
  const rect = pageEls.get(page.id).getBoundingClientRect();
  const cw = rect.width / COLS, ch = rect.height / ROWS;
  const start = { mx: e.clientX, my: e.clientY, x: w.x, y: w.y, w: w.w, h: w.h };
  const step = state.settings.snap ? 1 : 0.25;
  const q = (v) => Math.round(v / step) * step;
  const [minW, minH] = w.type === 'tile' ? [5, 5] : [10, 8];
  w.z = Math.max(1, ...page.widgets.map((o) => o.z || 1)) + 1;
  // Keep z-indexes compact so they never run away.
  [...page.widgets].sort((a, b) => (a.z || 1) - (b.z || 1)).forEach((o, i) => { o.z = i + 1; const inst = instances.get(o.id); if (inst) inst.el.style.zIndex = o.z; });
  el.classList.add('dragging');
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);

  const move = (ev) => {
    const dx = (ev.clientX - start.mx) / cw, dy = (ev.clientY - start.my) / ch;
    let { x, y, w: ww, h: hh } = start;
    if (dir === 'move') {
      x = clamp(q(start.x + dx), 0, COLS - ww);
      y = clamp(q(start.y + dy), 0, ROWS - hh);
    } else {
      if (dir.includes('e')) ww = clamp(q(start.w + dx), minW, COLS - start.x);
      if (dir.includes('s')) hh = clamp(q(start.h + dy), minH, ROWS - start.y);
      if (dir.includes('w')) { x = clamp(q(start.x + dx), 0, start.x + start.w - minW); ww = start.x + start.w - x; }
      if (dir.includes('n')) { y = clamp(q(start.y + dy), 0, start.y + start.h - minH); hh = start.y + start.h - y; }
    }
    Object.assign(w, { x, y, w: ww, h: hh });
    applyGeometry(el, w);
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    el.classList.remove('dragging');
    save();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

/* ---------- pages ---------- */
function ensurePage(page) {
  if (pageEls.has(page.id)) return;
  const el = h('div', { class: 'page', 'data-id': page.id });
  $('#canvas').append(el);
  pageEls.set(page.id, el);
  for (const w of page.widgets) mountWidget(page, w);
  updateEmptyState(page);
}

function setPage(i) {
  state.activePage = clamp(i, 0, state.pages.length - 1);
  const page = state.pages[state.activePage];
  ensurePage(page);
  for (const [id, el] of pageEls) el.classList.toggle('active', id === page.id);
  renderTabs();
  save();
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  const bar = $('#edit-bar');
  bar.hidden = !on;
  if (on) {
    bar.replaceChildren(
      h('b', {}, 'BEWERKMODUS'),
      h('span', {}, 'Sleep widgets om ze te verplaatsen, trek aan de punten om de grootte te wijzigen.'),
      h('button', { class: 'btn pill', onclick: openAddWidget }, icon('plus'), 'Toevoegen'),
      h('button', { class: 'btn pill primary', onclick: () => setEditing(false) }, 'Gereed')
    );
  }
  renderTitlebar();
}

/* ---------- add / configure ---------- */
function openAddWidget() {
  const page = state.pages[state.activePage];
  let close;
  const picker = h(
    'div',
    { class: 'picker' },
    Object.keys(WIDGET_META).filter((type) => WIDGETS[type]).map((type) => {
      const def = WIDGETS[type];
      return h('button', { class: 'pick', onclick: () => {
        close();
        const [w, hgt] = def.size;
        const spot = findFreeSpot(page, w, hgt);
        const widget = { id: uid(), type, ...spot, w, h: hgt, z: topZ(page), title: def.name, cfg: JSON.parse(JSON.stringify(def.defaults || {})) };
        page.widgets.push(widget);
        mountWidget(page, widget);
        setEditing(true);
        save();
        if (type === 'tile' || type === 'web' || type === 'metar') openWidgetConfig(widget);
      } }, icon(def.icon), h('b', {}, def.name), h('span', {}, def.desc));
    })
  );
  close = openModal({ title: `Toevoegen aan "${page.name}"`, body: picker, wide: true });
}

function openWidgetConfig(w) {
  const def = WIDGETS[w.type];
  const page = state.pages.find((p) => p.widgets.includes(w));
  const title = textInput(w.title, { id: 'cfg-title', maxlength: 40 });
  const form = def.form ? def.form(w.cfg) : { el: [], read: () => ({}) };
  openModal({
    title: `${def.name} instellen`,
    body: [field(def.chromeless ? 'Naam op de tegel' : 'Titel', title), ...form.el],
    actions: [
      { label: 'Annuleren' },
      { label: 'Opslaan', primary: true, onClick: () => {
        w.title = title.value.trim() || def.name;
        Object.assign(w.cfg, form.read());
        mountWidget(page, w);
        save();
      } },
    ],
  });
}
