'use strict';

/* Vluchtradar: the dashboard's own live map of the air traffic (drawing in ../radar.js). */
defineWidget('radar', {
  desc: 'Eigen live vliegradar zonder reclame: al het ADS-B-verkeer op OpenStreetMap of satelliet, categorieën, labels, routes, kaartlagen en dag/nacht-kaart.',
  icon: 'plane',
  size: [54, 54],
  mount(w, body, tools) {
    const vr = vrCreate(body, w);
    // The view: the standard one from the settings, until the map is moved by hand; that view then holds,
    // through every change in size, until the button with the target puts the standard one back.
    let user = null, placing = false, refit = null;
    const fit = () => {
      if (body.clientWidth < 50 || body.clientHeight < 50) return;
      const at = user || w.cfg;
      placing = true;
      vr.map.invalidateSize(false);
      vr.map.setView([+at.lat, +at.lon], at.refH ? +at.zoom + fitDelta(body, at.refH) : +at.zoom, { animate: false });
      placing = false;
      vr.paintScale();
    };
    vr.map.on('moveend', () => {
      if (placing) return;
      const c = vr.map.getCenter();
      user = { lat: c.lat, lon: c.lng, zoom: vr.map.getZoom() - fitDelta(body, REF_H), refH: REF_H };
      trafficWatch();
    });
    const ro = new ResizeObserver(() => { clearTimeout(refit); refit = setTimeout(fit, 120); });
    ro.observe(body);
    requestAnimationFrame(fit);
    vr.applyLayers();

    // The feed covers what this map shows, while it is on screen.
    const area = () => {
      if (!onScreen(body) || body.clientWidth < 50 || !vr.map._loaded) return null;
      const b = vr.map.getBounds(), c = b.getCenter();
      return { lat: c.lat, lon: c.lng, nm: (vr.map.distance(c, b.getNorthEast()) / 1852) * 1.15 + 5 };
    };
    const hkey = 'vluchtradar:' + w.id;
    const checkHealth = () => {
      const snap = trafficFeed.snap;
      if (!onScreen(body)) return report(hkey);
      report(hkey, 'Vluchtradar', !!snap && snap.ok && Date.now() - snap.lastOk < 30000, snap && snap.lastOk ? `geen verkeersdata sinds ${zulu(snap.lastOk)}` : 'geen verbinding', 60000);
    };
    // Drawn with every new round, and in between as often as the zoom level makes movement visible.
    let shown = false, lastDraw = 0;
    const redraw = () => { lastDraw = Date.now(); vr.draw(); };
    const unwatch = watchTraffic((snap) => { vr.setSnap(snap); if (onScreen(body)) redraw(); }, area);
    const frame = setInterval(() => {
      const on = onScreen(body);
      if (on && !shown) { trafficWatch(); redraw(); } // just came into view: the feed should cover it at once
      shown = on;
      if (on && Date.now() - lastDraw >= vrFrameMs(vr.map.getZoom()) - 20) redraw();
    }, 100);
    const slow = setInterval(() => { checkHealth(); vr.paintStatus(); }, 1000);
    const rain = setInterval(() => vr.refreshRain(), 60000);

    // Title bar: categories, labels, routes, map and display, standard view, reload.
    const labels = switchTool('LABELS', 'Labels bij de toestellen tonen of verbergen: callsign, hoogte en snelheid', () => w.cfg.labels, () => { w.cfg.labels = !w.cfg.labels; save(); vr.draw(); });
    const routes = switchTool('ROUTES', 'Gevlogen routes tonen of verbergen. Bij Alles alleen van de eigen eenheden en het geselecteerde toestel.', () => w.cfg.routes, () => { w.cfg.routes = !w.cfg.routes; save(); vr.draw(); });

    // Categories: a drop-down with a tick per category. Alles stands on its own; ticking another category
    // takes Alles away, and with nothing ticked Alles returns.
    const catText = h('span');
    const paintCatBtn = () => {
      const c = vrCats(w.cfg);
      catText.textContent = c.includes('all') ? 'Alles' : VR_CATS.filter((x) => c.includes(x.value)).map((x) => x.label).join(' · ');
    };
    const setCats = (next) => {
      w.cfg.cats = next.length ? next : ['all'];
      // Labels go with the filter: off among all traffic, where they would bury the map, on for the filtered views.
      w.cfg.labels = !w.cfg.cats.includes('all');
      labels.paint();
      save();
      paintCatBtn();
      vr.setSnap(trafficFeed.snap);
      vr.draw();
    };
    const catPop = h('div', { class: 'vr-pop left', hidden: true });
    const paintCatPop = () => {
      const c = vrCats(w.cfg);
      catPop.replaceChildren(h('h4', {}, 'Tonen op de kaart'), ...VR_CATS.map((o) => h('label', { class: 'check', title: o.title },
        h('input', { type: 'checkbox', checked: c.includes(o.value), onchange: (e) => {
          let next = vrCats(w.cfg).filter((v) => v !== 'all' && v !== o.value);
          if (o.value === 'all') next = e.target.checked ? ['all'] : [];
          else if (e.target.checked) next.push(o.value);
          setCats(VR_CATS.map((x) => x.value).filter((v) => next.includes(v)));
          paintCatPop();
        } }),
        o.label, VR_GROUP_COLOR[o.value] ? h('i', { class: 'vr-dot', style: 'background:' + VR_GROUP_COLOR[o.value] }) : null)),
        h('p', {}, 'Politie, Trauma en Kustwacht volgen de lijsten onder Instellingen › Eigen eenheden. Toestellen in nood (squawk 7500, 7600, 7700) staan altijd op de kaart.'));
    };
    const catBtn = h('button', { class: 'vr-drop', title: 'Kies welke categorieën de kaart toont', onclick: () => { paintCatPop(); catPop.hidden = !catPop.hidden; pop.hidden = true; } },
      icon('shield'), catText, h('b', { style: 'display:contents', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' }));
    paintCatBtn();

    // Map, layers and how the aircraft are drawn.
    const pop = h('div', { class: 'vr-pop', hidden: true });
    const radio = (group, value, cur, label, hint, set) => h('label', { class: 'check', title: hint || null }, h('input', { type: 'radio', name: group + w.id, checked: cur === value, onchange: set }), label);
    const paintPop = () => pop.replaceChildren(
      h('h4', {}, 'Kaart'),
      ...Object.entries(VR_BASES).map(([k, d]) => radio('vrb-', k, VR_BASE_ALIAS[w.cfg.base] || w.cfg.base || 'osm', d.name, null, () => { w.cfg.base = k; save(); vr.applyLayers(); })),
      h('h4', {}, 'Lagen'),
      ...Object.entries(VR_OVERLAYS).map(([k, d]) => h('label', { class: 'check', title: d.hint }, h('input', { type: 'checkbox', checked: (w.cfg.overlays || []).includes(k), onchange: (e) => {
        const set = new Set(w.cfg.overlays || []);
        if (e.target.checked) set.add(k); else set.delete(k);
        w.cfg.overlays = [...set];
        save();
        vr.applyLayers();
        vr.draw();
      } }), d.name)),
      h('h4', {}, 'Toestellen'),
      ...Object.entries(VR_SYMBOLS).map(([k, d]) => radio('vrs-', k, VR_SYMBOLS[w.cfg.sym] ? w.cfg.sym : 'silhouet', d.name, d.hint, () => { w.cfg.sym = k; save(); vr.draw(); })),
      h('div', { class: 'row2' }, segmented(VR_SIZES.map((x) => ({ value: String(x.v), label: x.name })), String(+w.cfg.symSize || 1), (v) => { w.cfg.symSize = +v; save(); vr.draw(); })),
      h('p', {}, 'Kaarten die het thema volgen worden \'s avonds in een paar seconden vloeiend donker, tegelijk met de rest van het dashboard, en \'s ochtends weer licht.'));
    const layersBtn = h('button', { class: 'w-tool', title: 'Kaart, kaartlagen en weergave van de toestellen', onclick: () => { paintPop(); pop.hidden = !pop.hidden; catPop.hidden = true; } }, icon('layers'));
    const closePop = (e) => {
      if (!pop.hidden && !pop.contains(e.target) && !layersBtn.contains(e.target)) pop.hidden = true;
      if (!catPop.hidden && !catPop.contains(e.target) && !catBtn.contains(e.target)) catPop.hidden = true;
    };
    document.addEventListener('pointerdown', closePop, true);
    body.append(pop, catPop);
    tools.append(catBtn, labels, routes, layersBtn,
      h('button', { class: 'w-tool', title: 'Kaart terugzetten naar de standaardpositie en het standaard zoomniveau', onclick: () => { user = null; fit(); trafficWatch(); } }, icon('target')),
      h('button', { class: 'w-tool', title: 'Vluchtradar opnieuw laden: kaart, lagen en verkeer', onclick: () => { vrRain.at = 0; mountWidget(state.pages.find((p) => p.widgets.includes(w)), w); } }, icon('refresh')));
    return {
      fresh: () => {
        const snap = trafficFeed.snap;
        return { t: snap && snap.lastOk, fail: !!snap && !snap.ok, loading: !snap, warn: 5000, bad: 30000, seconds: true, label: 'Live verkeer', note: `Bron: ${(snap && snap.src) || 'adsb.fi / adsb.lol'}${snap && snap.via ? `, doorgegeven door ${snap.via}` : ''}, elke seconde opgehaald.` };
      },
      focus(hex, at) { vr.focus(hex, at); trafficWatch(); },
      destroy() {
        unwatch(); ro.disconnect(); clearTimeout(refit); clearInterval(frame); clearInterval(slow); clearInterval(rain);
        document.removeEventListener('pointerdown', closePop, true);
        vr.destroy();
        report(hkey);
      },
    };
  },
  form(cfg) {
    const lat = textInput(cfg.lat), lon = textInput(cfg.lon), zoom = textInput(cfg.zoom), def = WIDGETS.radar.defaults;
    return {
      el: [
        h('div', { class: 'row' }, field('Breedtegraad', lat), field('Lengtegraad', lon), field('Zoom', zoom)),
        h('div', { class: 'hint field' }, h('div', { class: 'hint' }, `Dit is de standaardweergave waar de knop met de schietschijf naar terugkeert. Standaard is de kaart gecentreerd op Nederland (${def.lat}, ${def.lon}, zoom ${def.zoom}) en schaalt de zoom mee met de grootte van de widget. Een hoger zoomgetal zoomt verder in; een zelf ingevuld zoomgetal wordt exact aangehouden. Kaart en kaartlagen kies je met de knop met de lagen in de titelbalk.`)),
      ],
      read: () => { const z = parseFloat(zoom.value) || def.zoom; return { lat: parseFloat(lat.value) || def.lat, lon: parseFloat(lon.value) || def.lon, zoom: z, refH: z === cfg.zoom ? cfg.refH : null }; },
    };
  },
});
