'use strict';

/* ============================================================
   Zoek & Plan — wat je op de kaart hebt gezet: de lijst "Op de kaart" linksonder (in volgorde van
   maken), een prullenbakje bij elk object op de kaart, ongedaan maken, en de instructiebalk van het
   gereedschap dat aan staat.
   ============================================================ */
function zpItems(ctx) {
  const { map, cfg } = ctx;
  let undo = null, undoTimer = null, hotTimer = null, open = cfg.itemsOpen !== false;

  // Everything placed: the route and what the tools made, newest first.
  function all() {
    const out = ctx.parts.zpTools && ctx.parts.zpTools.items ? ctx.parts.zpTools.items() : [];
    const r = cfg.route;
    if (r.points.length) {
      const m = PlanGeo.measure(r.points);
      const snap = JSON.parse(JSON.stringify({ points: r.points, name: r.name }));
      out.push({
        id: 'route', kind: 'route', at: r.at || 0, tool: { name: 'Route', icon: 'route', color: ZP_ROUTE_COLOR },
        label: r.name || `Route ${r.points[0].name}${r.points.length > 1 ? ' → ' + r.points[r.points.length - 1].name : ''}`,
        sub: `${r.points.length} punt${r.points.length === 1 ? '' : 'en'}${m.total ? ' · ' + ctx.fmt.dist(m.total) : ''}${ctx.plan ? ' · ' + ctx.fmt.dur(ctx.plan.total.timeMin) : ''}`,
        anchor: r.points[r.points.length - 1], points: r.points,
        remove: () => ctx.parts.zpRoute.clear(),
        restore: () => ctx.parts.zpRoute.setPoints(snap.points, { name: snap.name }),
      });
    }
    return out.sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  ctx.items = all;

  ctx.removeItem = (it) => {
    it.remove();
    if (it.restore) {
      undo = { label: it.label, restore: it.restore };
      clearTimeout(undoTimer);
      undoTimer = setTimeout(() => { undo = null; paint(); }, 12000);
    }
    paint();
  };
  // Show it: the map goes there, it lights up for a moment, and the panel opens on its tool.
  ctx.focusItem = (it) => {
    const pts = (it.points || []).filter((p) => p && p.lat != null);
    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lon])).pad(0.25), { animate: true, maxZoom: 14 });
    else if (it.anchor) map.setView([it.anchor.lat, it.anchor.lon], Math.max(map.getZoom(), 11), { animate: true });
    ctx.hot = it.id;
    clearTimeout(hotTimer);
    hotTimer = setTimeout(() => { ctx.hot = null; ctx.cv.request(); paint(); }, 3500);
    cfg.sideTab = it.kind === 'route' ? 'route' : 'tools';
    ctx.save();
    if (ctx.parts.zpPanels) ctx.parts.zpPanels.showTab(cfg.sideTab);
    ctx.cv.request();
    paint();
  };
  // A click on a placed object on the map (centre of the rings, point A of a tape, datum of a pattern).
  ctx.on('hit', ({ hit }) => {
    if (hit.kind !== 'item') return;
    const it = all().find((x) => x.id === hit.item.id);
    if (it) ctx.focusItem(it);
  });

  /* ---------- the list ---------- */
  const box = h('div', { class: 'zp-items' });
  ctx.hud.querySelector('.zp-corner').prepend(box);
  function paint() {
    const list = all();
    box.hidden = !list.length && !undo;
    if (box.hidden) return;
    const head = h('div', { class: 'zp-items-head' },
      h('button', { class: 'zp-items-toggle', title: open ? 'Lijst inklappen' : 'Lijst uitklappen', onclick: () => { open = !open; cfg.itemsOpen = open; ctx.save(); paint(); } },
        icon('layers'), h('b', {}, 'Op de kaart'), h('span', { class: 'zp-count' }, String(list.length)), h('i', { class: 'zp-chev' + (open ? ' up' : '') })),
      undo ? h('button', { class: 'zp-undo', title: `"${undo.label}" terugzetten`, onclick: () => { const u = undo; undo = null; u.restore(); paint(); } }, icon('history'), 'Ongedaan maken') : null,
      open && list.length > 1 ? h('button', { class: 'w-tool', title: 'Alles van de kaart halen', onclick: () => confirmDialog('Alles wissen', `Alle ${list.length} objecten van de kaart halen (route, meetlinten, ringen en gereedschap)?`, 'Alles wissen', () => { for (const it of all()) it.remove(); undo = null; paint(); }) }, icon('trash')) : null);
    const rows = open ? list.map((it) => h('div', { class: 'zp-item' + (ctx.hot === it.id ? ' hot' : ''), style: `--zp-c:${it.tool.color}` },
      h('button', { class: 'zp-item-main', title: 'Toon op de kaart', onclick: () => ctx.focusItem(it) }, h('span', { class: 'zp-item-ic' }, icon(it.tool.icon)), h('span', {}, h('b', {}, it.label), h('small', {}, it.sub))),
      h('button', { class: 'w-tool zp-bin', title: `${it.label} verwijderen`, onclick: () => ctx.removeItem(it) }, icon('trash')))) : [];
    box.replaceChildren(head, ...rows);
  }

  /* ---------- bins on the map ---------- */
  const bins = L.layerGroup().addTo(map);
  function paintBins() {
    bins.clearLayers();
    for (const it of all()) {
      if (!it.anchor) continue;
      const m = L.marker([it.anchor.lat, it.anchor.lon], {
        icon: L.divIcon({ className: 'zp-mapbin', html: `<span style="--zp-c:${it.tool.color}" title="${escHtml(it.label)} verwijderen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS.trash}</svg></span>`, iconSize: [26, 26], iconAnchor: [-10, 36] }),
        keyboard: false, zIndexOffset: 1200,
      }).addTo(bins);
      m.on('click', (e) => { L.DomEvent.stopPropagation(e); ctx.removeItem(it); });
    }
  }

  /* ---------- the instruction bar of the active tool ---------- */
  const bar = h('div', { class: 'zp-modebar', hidden: true });
  ctx.mapBox.append(bar);
  function paintMode() {
    const m = ctx.mode;
    const tl = m === 'route' ? { name: 'Route bouwen', icon: 'route', color: ZP_ROUTE_COLOR, click: 'Klik op de kaart om punten toe te voegen. Sleep een punt om het te verplaatsen, sleep een + om ertussen te voegen, ' + RCLICK() + ' om te verwijderen.' } : ZP_TOOLS[m];
    bar.hidden = !tl;
    if (!tl) return;
    bar.style.setProperty('--zp-c', tl.color);
    bar.replaceChildren(icon(tl.icon), h('b', {}, tl.name), h('span', {}, tl.click), h('button', { class: 'btn zp-btn', onclick: () => ctx.setMode('select') }, icon('check'), 'Klaar (Esc)'));
  }

  const refresh = () => { paint(); paintBins(); };
  for (const ev of ['items', 'route', 'plan', 'units', 'tools']) ctx.on(ev, refresh);
  ctx.on('mode', paintMode);
  ctx.on('ready', () => { refresh(); paintMode(); });
  return { paint: refresh };
}
