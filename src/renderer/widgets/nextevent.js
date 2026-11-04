'use strict';

/* Next event: de eerstvolgende timing (uit het tabblad Timings) als aftelling en/of tijdstip. */
defineWidget('nextevent', {
  desc: 'De eerstvolgende timer of wekker uit Timings: aftelling, tijdstip of allebei. Leeg zolang er niets loopt.',
  icon: 'clock',
  size: [24, 14],
  mount(w, body, tools) {
    const root = h('div', { class: 'ne' });
    body.append(root);
    const modeSeg = segmented([{ value: 'countdown', label: 'Aftelling' }, { value: 'time', label: 'Tijd' }, { value: 'both', label: 'Beide' }], w.cfg.mode || 'both', (v) => { w.cfg.mode = v; save(); paint(true); });
    tools.append(modeSeg);
    let sig = '';
    const paint = (force) => {
      const now = tmNow();
      const next = OPS.loaded ? tmNextEvent(tmTimers(), now, w.cfg.category || 'all') : null;
      const mode = w.cfg.mode || 'both';
      const s = next ? `${next.t.id}:${next.t.firedAt}:${Math.round((next.left || 0) / 1000)}:${mode}` : 'none';
      if (!force && s === sig) return;
      sig = s;
      if (!next) { root.replaceChildren(h('div', { class: 'ne-empty' }, icon('clock'), h('span', {}, 'Geen lopende timings'))); root.dataset.state = 'none'; return; }
      const { t, due, left } = next;
      const cat = TM_CATS[t.cat] || TM_CATS.other;
      root.style.setProperty('--tm-c', cat.color);
      root.dataset.state = t.firedAt ? 'fired' : left < 60000 ? 'soon' : 'running';
      root.replaceChildren(
        h('div', { class: 'ne-head' }, h('span', { class: 'ne-cat' }, cat.name), h('b', { class: 'ne-label' }, t.label), t.firedAt ? h('span', { class: 'ne-fired' }, 'AFGEGAAN') : null),
        h('div', { class: 'ne-body' },
          mode !== 'time' ? h('div', { class: 'ne-count' }, t.firedAt ? '-' + tmClock(now - t.firedAt) : tmClock(left, { seconds: left < 3600e3 * 10 })) : null,
          mode !== 'countdown' ? h('div', { class: 'ne-time' }, h('b', {}, ltFmt.format(due)), h('small', {}, 'LT'), h('span', {}, zulu(due))) : null),
        t.message || t.note ? h('div', { class: 'ne-note' }, t.message || t.note) : null,
        t.firedAt ? h('button', { class: 'btn primary ne-ack', onclick: () => tmAck(t) }, icon('check'), 'Bevestigen') : null);
    };
    const unsub = OPS.on('ops', () => paint(true));
    const unwatch = tmWatch(() => { if (onScreen(body)) paint(false); });
    paint(true);
    return { fresh: () => null, destroy() { unsub(); unwatch(); } };
  },
  form(cfg) {
    const cat = h('select', { class: 'input' }, [h('option', { value: 'all' }, 'Alle categorieën'), ...Object.entries(TM_CATS).map(([k, c]) => h('option', { value: k, selected: cfg.category === k || null }, c.name))]);
    cat.value = cfg.category || 'all';
    return { el: [field('Categorie', cat, 'Alleen timings van deze categorie tellen mee voor deze widget.')], read: () => ({ category: cat.value }) };
  },
});
