'use strict';

/* ============================================================
   Zoek & Plan — de zoekbalk: aanvullen terwijl je typt, over de hele wereld.
   ============================================================ */
// In this order: coordinates as typed (any format, also RD and MGRS), the unit's own favourites and
// helidecks, platforms by name, then the search sources of the main process (PDOK for the Netherlands
// incl. hectometre posts, OurAirports for every airfield and heliport, Photon for the rest of the world).
const ZP_KIND_ICON = { coord: 'target', favoriet: 'star', platform: 'layers', luchthaven: 'plane', heliport: 'plane', adres: 'globe', weg: 'route', postcode: 'globe', woonplaats: 'globe', gemeente: 'globe', provincie: 'globe', hectometerpaal: 'route', plaats: 'globe', poi: 'info', water: 'globe', recent: 'history' };

function zpSearch(ctx) {
  const { map, cfg } = ctx;
  const input = h('input', { class: 'zp-q', type: 'search', placeholder: 'Zoek adres, plaats, postcode, hmp, vliegveld, platform of coördinaat…', spellcheck: 'false', autocomplete: 'off' });
  const spin = h('span', { class: 'zp-spin', hidden: true });
  const list = h('div', { class: 'zp-results', hidden: true, role: 'listbox' });
  const box = h('div', { class: 'zp-search' }, icon('globe'), input, spin, list);
  ctx.bar.prepend(box);
  let items = [], active = -1, seq = 0, timer = null;
  cfg.recent = Array.isArray(cfg.recent) ? cfg.recent : [];

  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function local(q) {
    const n = norm(q), out = [];
    if (n.length < 2) return out;
    for (const [id, f] of Object.entries(ctx.store.shared.favorites || {})) if (norm(f.name).includes(n)) out.push({ id: 'fav:' + id, label: f.name, sub: 'Favoriet', kind: 'favoriet', lat: f.lat, lon: f.lon });
    for (const p of ctx.platforms ? ctx.platforms() : []) {
      if (out.length > 30) break;
      if (p.kind !== 'turbine' && norm(p.name).includes(n)) out.push({ id: 'plf:' + p.id, label: p.name, sub: `Platform · ${p.operator || ''} · ${p.country || ''} · ${p.src}`, kind: 'platform', lat: p.lat, lon: p.lon, item: p });
    }
    // Exact name first, then names that start with the query.
    return out.sort((a, b) => (norm(b.label) === n) - (norm(a.label) === n) || norm(b.label).startsWith(n) - norm(a.label).startsWith(n)).slice(0, 6);
  }
  async function run() {
    const q = input.value.trim();
    const my = ++seq;
    if (!q) { show(cfg.recent.map((r) => ({ ...r, kind: 'recent', sub: r.sub || 'Recent gezocht' }))); return; }
    const first = [];
    const co = PlanCoords.parse(q);
    if (co) first.push({ id: 'coord', label: ctx.fmt.coord(co.lat, co.lon), sub: `Coördinaat (${co.format.toUpperCase()}) · ${PlanCoords.fmt(co.lat, co.lon, 'dd')}`, kind: 'coord', lat: co.lat, lon: co.lon });
    first.push(...local(q));
    show(first, true);
    if (q.length < 2 || (co && co.format !== 'dd')) { spin.hidden = true; return; }
    spin.hidden = false;
    const c = map.getCenter();
    try {
      const res = await window.palv.plan.suggest(q, { lat: c.lat, lon: c.lng, world: true, limit: 12 });
      if (my !== seq) return;
      // Photon matches loosely (EHKD finds "Ehud" in Hebrew): a world result must contain a word of the query.
      const words = norm(q).split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
      const remote = (Array.isArray(res) ? res : []).filter((r) => r.src !== 'Photon' || !words.length || words.some((wd) => norm(`${r.label} ${r.sub}`).includes(wd.slice(0, Math.max(3, wd.length - 2)))));
      show(first.concat(remote.map((r) => ({ ...r }))));
    } catch { /* keep the local results */ }
    if (my === seq) spin.hidden = true;
  }
  function show(list2, partial) {
    items = list2;
    active = items.length ? 0 : -1;
    list.hidden = !items.length && !partial;
    list.replaceChildren(...items.map((it, i) => h('div', { class: 'zp-res' + (i === active ? ' on' : ''), role: 'option', onmousedown: (e) => { e.preventDefault(); choose(it); }, onmouseenter: () => { active = i; paint(); } },
      icon(ZP_KIND_ICON[it.kind] || 'globe'),
      h('div', {}, h('b', {}, it.label), h('small', {}, it.sub || it.kind)),
      h('button', { class: 'w-tool', title: 'Aan de route toevoegen', onmousedown: (e) => { e.preventDefault(); e.stopPropagation(); choose(it, true); } }, icon('plus')))));
    if (!items.length && partial) list.hidden = true;
  }
  const paint = () => [...list.children].forEach((el, i) => el.classList.toggle('on', i === active));
  async function choose(it, toRoute) {
    list.hidden = true;
    let p = it;
    if ((it.lat == null || it.lon == null) && it.id) {
      try { const r = await window.palv.plan.resolve(it.id); if (r && r.lat != null) p = { ...it, ...r, label: it.label }; } catch { /* none */ }
    }
    if (p.lat == null) { toast('Deze locatie kon niet worden opgehaald', true); return; }
    input.value = it.label;
    input.blur();
    // Remember it (without the coordinate case: that is in the box anyway).
    if (it.kind !== 'coord') {
      cfg.recent = [{ id: it.id, label: it.label, sub: it.sub, lat: p.lat, lon: p.lon }, ...cfg.recent.filter((r) => r.id !== it.id)].slice(0, 8);
      ctx.save();
    }
    if (toRoute) { ctx.parts.zpRoute.add({ lat: p.lat, lon: p.lon, name: it.label.split(',')[0].slice(0, 40) }); toast(`${it.label} aan de route toegevoegd`); return; }
    if (p.bbox && p.bbox.length === 4 && (p.bbox[2] - p.bbox[0] > 0.01 || p.bbox[3] - p.bbox[1] > 0.01)) map.fitBounds([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]], { maxZoom: 14, animate: true });
    else map.setView([p.lat, p.lon], Math.max(map.getZoom(), { luchthaven: 12, heliport: 14, platform: 12, woonplaats: 12, gemeente: 11 }[it.kind] || 15), { animate: true });
    if (it.kind === 'platform' && it.item) { ctx.select({ lat: p.lat, lon: p.lon, label: it.label, kind: 'platform', item: it.item }); ctx.showCard(ctx.platformCard(it.item)); return; }
    if ((it.kind === 'luchthaven' || it.kind === 'heliport') && it.code) {
      const ap = await window.palv.plan.airport(it.code).catch(() => null);
      ctx.select({ lat: p.lat, lon: p.lon, label: it.label, kind: 'airport', item: ap });
      ctx.showPoint({ lat: p.lat, lon: p.lon, label: it.label, sub: it.sub, airport: ap });
      return;
    }
    ctx.select({ lat: p.lat, lon: p.lon, label: it.label.split(',')[0], kind: it.kind });
    ctx.showPoint({ lat: p.lat, lon: p.lon, label: it.label, sub: it.sub });
  }
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 220); });
  input.addEventListener('focus', () => { if (!input.value.trim()) run(); else if (items.length) list.hidden = false; input.select(); });
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); paint(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
    else if (e.key === 'Enter') { clearTimeout(timer); if (items[active]) choose(items[active], e.shiftKey); else run(); e.preventDefault(); }
    else if (e.key === 'Escape') { list.hidden = true; input.blur(); e.stopPropagation(); }
  });
  // Ctrl+F or / jumps to the search box while the tab is on screen.
  const onKey = (e) => {
    if (!onScreen(ctx.body) || modalOpen()) return;
    if ((e.key === 'f' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName))) { e.preventDefault(); input.focus(); }
  };
  window.addEventListener('keydown', onKey);
  ctx.cleanups.push(() => window.removeEventListener('keydown', onKey));
  return { focus: () => input.focus() };
}
