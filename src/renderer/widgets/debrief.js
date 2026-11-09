'use strict';

/* (De)Briefing: de briefing- en debriefingchecklist van de eenheid, als afbeelding of pdf, met twee
   knoppen bovenin. De documenten staan in het profielbestand van de eenheid en gaan naar alle schermen.
   Kiezen en verwijderen kan alleen onder Instellingen › (De)Briefing, niet op het tabblad zelf. */
const DB_SLOTS = { briefing: { name: 'Briefing', icon: 'note' }, debriefing: { name: 'Debriefing', icon: 'check' } };

defineWidget('debrief', {
  desc: 'De briefing- en debriefingchecklist van de eenheid in beeld, met een knop voor elk; afbeelding of pdf, gedeeld met alle schermen.',
  icon: 'note',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    const cfg = w.cfg;
    if (!DB_SLOTS[cfg.slot]) cfg.slot = 'debriefing';
    const root = h('div', { class: 'db' });
    const bar = h('div', { class: 'zp-bar db-bar' });
    const stage = h('div', { class: 'db-stage' });
    root.append(bar, stage);
    body.append(root);
    const doc = () => OPS.get('private', 'docs', cfg.slot);
    const seg = segmented(Object.entries(DB_SLOTS).map(([k, d]) => ({ value: k, label: d.name, icon: d.icon })), cfg.slot, (v) => { cfg.slot = v; save(); paint(); });
    seg.classList.add('db-seg');
    const info = h('span', { class: 'db-info' });
    const fitBtn = h('button', { class: 'btn zp-btn', title: 'Passend in beeld', onclick: () => fit() }, icon('target'), 'Passend');
    bar.append(h('span', { class: 'mp-title' }, icon('note'), '(DE)BRIEFING'), seg, info, h('span', { class: 'zp-spacer' }), fitBtn);

    // The image viewer: fit to the stage, zoom with the wheel or two fingers, drag to pan.
    let view = { k: 1, x: 0, y: 0 }, img = null, nat = null;
    const apply = () => { if (img) img.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`; };
    function fit() {
      if (!img || !nat) return;
      const W = stage.clientWidth, H = stage.clientHeight;
      view.k = Math.min((W - 24) / nat[0], (H - 24) / nat[1]);
      view.x = (W - nat[0] * view.k) / 2; view.y = (H - nat[1] * view.k) / 2;
      apply();
    }
    const pointers = new Map();
    let drag = null, pinch = null;
    stage.addEventListener('wheel', (e) => { if (!img) return; e.preventDefault(); const r = stage.getBoundingClientRect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const k = clamp(view.k * f, 0.1, 8); view.x = sx - ((sx - view.x) / view.k) * k; view.y = sy - ((sy - view.y) / view.k) * k; view.k = k; apply(); }, { passive: false });
    stage.addEventListener('pointerdown', (e) => { if (!img) return; stage.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]); if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), c: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], view: { ...view } }; drag = null; } else drag = { x: e.clientX, y: e.clientY, view: { ...view } }; });
    stage.addEventListener('pointermove', (e) => {
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && pointers.size >= 2) { const [a, b] = [...pointers.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]), c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; const r = stage.getBoundingClientRect(); const k = clamp(pinch.view.k * (d / (pinch.d || 1)), 0.1, 8); const wx = (pinch.c[0] - r.left - pinch.view.x) / pinch.view.k, wy = (pinch.c[1] - r.top - pinch.view.y) / pinch.view.k; view = { k, x: c[0] - r.left - wx * k, y: c[1] - r.top - wy * k }; apply(); return; }
      if (drag) { view.x = drag.view.x + (e.clientX - drag.x); view.y = drag.view.y + (e.clientY - drag.y); apply(); }
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; if (!pointers.size) drag = null; };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('dblclick', fit);

    let shownKey = '';
    async function paint() {
      seg.setValue(cfg.slot);
      const d = doc();
      fitBtn.disabled = !d || d.type === 'application/pdf';
      info.textContent = d ? `${d.name} · ${(d.size / 1024).toFixed(0)} kB` : '';
      const key = d ? `${cfg.slot}:${d.updatedAt}` : cfg.slot;
      if (key === shownKey) return;
      shownKey = key;
      img = null; nat = null;
      if (!d) { stage.replaceChildren(h('div', { class: 'db-empty' }, icon(DB_SLOTS[cfg.slot].icon), h('b', {}, `Nog geen ${DB_SLOTS[cfg.slot].name.toLowerCase()}document`), h('span', {}, 'Het document wordt geladen onder Instellingen › (De)Briefing en komt dan op alle schermen van de eenheid.'))); return; }
      if (d.type === 'application/pdf') {
        const r = await window.palv.docs.file(cfg.slot);
        if (!r || !r.ok) { stage.replaceChildren(h('div', { class: 'db-empty' }, h('b', {}, 'Pdf niet te openen'), h('span', {}, (r && r.error) || ''))); return; }
        const wv = document.createElement('webview');
        wv.setAttribute('partition', WEB_PARTITION);
        wv.setAttribute('src', 'file:///' + r.path.replace(/\\/g, '/') + '#toolbar=0&view=FitH');
        wv.className = 'db-pdf';
        stage.replaceChildren(wv);
        return;
      }
      img = h('img', { class: 'db-img', src: `data:${d.type};base64,${d.data}`, alt: d.name, draggable: 'false' });
      img.addEventListener('load', () => { nat = [img.naturalWidth, img.naturalHeight]; fit(); });
      stage.replaceChildren(img);
    }
    const unsub = OPS.on('private', paint);
    const ro = new ResizeObserver(() => { if (img && nat) fit(); });
    ro.observe(stage);
    paint();
    return { fresh: () => null, destroy() { unsub(); ro.disconnect(); } };
  },
});
