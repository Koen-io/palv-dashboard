'use strict';

/* ADS-B Exchange (website): the site itself with quick filters; kept as a fallback for the Vluchtradar. */
// Below roughly this size the ADS-B site falls back to a cramped mobile layout that no longer centres
// the map, so a smaller widget shows the normal page reduced instead.
const adsbScale = (body) => (body && body.clientWidth > 50 && body.clientHeight > 50 ? Math.min(1, body.clientWidth / 704, body.clientHeight / 815) : 1);
// A view is { lat, lon, zoom, refH }: the zoom as it shows in a body of refH high, or exact when refH is empty.
const adsbZoom = (at, body) => (at.refH && body ? at.zoom + fitDelta(body, at.refH) - Math.log2(adsbScale(body)) : at.zoom);

function adsbUrl(cfg, at, body) {
  const p = [`lat=${at.lat}`, `lon=${at.lon}`, `zoom=${adsbZoom(at, body).toFixed(2)}`];
  p.push('desktop'); // narrow widgets would otherwise get the mobile layout with an empty ad bar
  p.push('extendedLabels=1'); // label content: speed and altitude above the callsign
  if (cfg.labels) p.push('enableLabels');
  if (!cfg.sidebar) p.push('hideSideBar');
  if (cfg.mode === 'mil') p.push('mil');
  if (cfg.mode === 'police') {
    const hex = hexList('police', 'hems', 'coastguard');
    if (hex.length) p.push('icaoFilter=' + hex.join(','));
  }
  return 'https://globe.adsbexchange.com/?' + p.join('&');
}

defineWidget('adsb', {
  desc: 'De website van ADS-B Exchange met snelfilters. Vervangen door de Vluchtradar; blijft beschikbaar als reserve.',
  icon: 'plane',
  size: [54, 54],
  mount(w, body, tools) {
    const keep = keepView(w, body, {
      sample: `(() => { if (typeof OLMap === 'undefined' || typeof ol === 'undefined') return null; ${INPUT_JS} const v = OLMap.getView(), c = ol.proj.toLonLat(v.getCenter()); return { lat: c[1], lon: c[0], zoom: v.getZoom(), idle: Date.now() - window.__palvIn.t }; })()`,
      place: (at) => {
        scaleWebview(view.wv, adsbScale(body));
        return `(() => { if (typeof OLMap === 'undefined') return false; OLMap.updateSize(); const v = OLMap.getView(); v.cancelAnimations(); v.setCenter(ol.proj.fromLonLat([${+at.lon}, ${+at.lat}])); v.setZoom(${adsbZoom(at, body).toFixed(3)}); if (window.__palvIn) window.__palvIn.t = 0; return true; })()`;
      },
      expect: (at) => ({ lat: +at.lat, lon: +at.lon, zoom: adsbZoom(at, body) }),
      adopt: (s) => ({ lat: s.lat, lon: s.lon, zoom: s.zoom + Math.log2(adsbScale(body)) - fitDelta(body, REF_H), refH: REF_H }),
    });
    const view = makeWebview(body, () => adsbUrl(w.cfg, keep.current(), body));
    // In a narrow widget the site reserves an empty mobile banner strip below the map; give that space to the map.
    view.wv.addEventListener('dom-ready', () => {
      view.wv.insertCSS('#mobile_tracking_leaderboard_container{display:none!important}#layout_container,#map_container{height:100vh!important}').catch(() => {});
      for (const ms of [1500, 6000]) setTimeout(() => view.wv.isConnected && view.wv.executeJavaScript("window.dispatchEvent(new Event('resize'))").catch(() => {}), ms);
    });
    // Flown routes of the police & emergency aircraft. The site only draws the full route of an aircraft
    // that is selected (its "all tracks" option merely starts a trail at page load), so every filtered
    // aircraft that shows up gets selected, with the details panel that selecting opens kept out of sight.
    // The site never clears a selected aircraft away, so one that has gone quiet (landed, out of range) is
    // let go again: its route goes, and the aircraft follows once the site's own timeout has passed. Of the
    // route only the current flight is drawn; the site keeps up to a day of earlier flights with it.
    // And the site refreshes up to four times slower once nobody has touched the map for a few minutes,
    // which on an unattended screen leaves it behind; the dashboard counts as someone watching.
    const ROUTE_QUIET_S = 75, REAP_S = 120;
    const routesOn = () => w.cfg.mode === 'police' && !!w.cfg.trails;
    let infoCss = false;
    view.wv.addEventListener('did-navigate', () => { infoCss = false; });
    const drawRoutes = () => {
      if (!view.wv.isConnected) return;
      const routes = routesOn();
      if (routes && !infoCss) { infoCss = true; view.wv.insertCSS('#selected_infoblock{display:none!important}').catch(() => { infoCss = false; }); }
      view.wv.executeJavaScript(`(() => { try {
        if (typeof active === 'function') active();
        if (${w.cfg.mode === 'police'} && typeof reapTimeout !== 'undefined') reapTimeout = ${REAP_S};
        // How old the newest traffic data is, for the warning in the dashboard's tab bar.
        const info = { age: typeof now === 'number' && now > 0 ? Date.now() / 1000 - now : null, hidden: typeof tabHidden !== 'undefined' && !!tabHidden };
        if (!${routes}) return info;
        const planes = typeof g !== 'undefined' && g.planes ? g.planes : Planes;
        if (typeof lastLeg !== 'undefined' && !lastLeg) { try { toggles.lastLeg.toggle(); } catch (e) { lastLeg = true; } }
        if (typeof multiSelect !== 'undefined' && !multiSelect) toggleMultiSelect(true);
        const now = Date.now() / 1000;
        for (const hex of ${JSON.stringify(hexList('police', 'hems', 'coastguard'))}) {
          const p = planes[hex];
          if (!p) continue;
          const quiet = now - p.last_message_time;
          if (quiet > ${ROUTE_QUIET_S}) { if (p.selected) deselect(p); }
          else if (!p.selected) selectPlaneByHex(hex, { noDeselect: true, follow: false });
        }
        return info;
      } catch (e) { return null; } })()`).then(checkHealth, () => checkHealth(null));
    };
    // Warning in the tab bar when the map has stopped receiving traffic while it is on screen.
    const hkey = 'adsb:' + w.id;
    let lastInfo = null;
    const checkHealth = (info) => {
      if (info && info.age != null) lastInfo = { at: Date.now() - info.age * 1000 };
      if (!onScreen(body)) return report(hkey);
      if (view.failedSince) return report(hkey, 'ADS-B', false, `pagina laadt niet sinds ${zulu(view.failedSince)}`, 3 * 60000);
      if (!info || info.hidden || info.age == null) return; // not loaded yet: judged at the next round
      report(hkey, 'ADS-B', info.age < 120, `geen verkeersdata sinds ${zulu(Date.now() - info.age * 1000)}`, 60000);
    };
    // Labels with the aircraft: speed and altitude above the callsign. The site keeps its own setting
    // for this, so the switch here is laid over it again and again.
    const drawLabels = () => {
      if (!view.wv.isConnected) return;
      view.wv.executeJavaScript(`(() => { try {
        if (g.extendedLabels !== 1) { g.extendedLabels = 1; toggleExtendedLabels({ noIncrement: true }); }
        if (!!g.enableLabels !== ${!!w.cfg.labels}) toggleLabels();
      } catch (e) {} })()`).catch(() => {});
    };
    const draw = () => { drawLabels(); drawRoutes(); };
    view.wv.addEventListener('did-finish-load', () => setTimeout(draw, 2500));
    const routeTimer = setInterval(draw, 8000);
    const labels = switchTool('LABELS', 'Labels bij de toestellen tonen of verbergen: snelheid, hoogte en callsign', () => w.cfg.labels, () => { w.cfg.labels = !w.cfg.labels; save(); drawLabels(); });
    const trails = switchTool('ROUTES', 'Gevlogen route van politie & hulpdiensten tonen of verbergen', () => w.cfg.trails, () => { w.cfg.trails = !w.cfg.trails; save(); if (w.cfg.trails) drawRoutes(); else view.load(); });
    const paintTrails = () => { trails.style.display = w.cfg.mode === 'police' ? '' : 'none'; };
    paintTrails();
    tools.append(
      labels,
      trails,
      segmented(
        [
          { value: 'all', label: 'ALLES', icon: 'plane', title: 'Al het vliegverkeer' },
          { value: 'mil', label: 'MILITAIR', icon: 'star', title: 'Alleen militair vliegverkeer' },
          { value: 'police', label: 'POLITIE & HULPDIENSTEN', icon: 'shield', title: 'Politiehelikopters, traumahelikopters en Kustwacht' },
        ],
        w.cfg.mode,
        // Labels go with the filter: off among all traffic, where they would bury the map, on for the filtered views.
        (mode) => { w.cfg.mode = mode; w.cfg.labels = mode !== 'all'; save(); labels.paint(); paintTrails(); view.load(); }
      ),
      recentreTool(keep),
      reloadTool(view)
    );
    scaleWebview(view.wv, adsbScale(body));
    keep.attach(view);
    return {
      fresh: () => ({ t: lastInfo && lastInfo.at, fail: !!view.failedSince, loading: !lastInfo, warn: 15000, bad: 120000, seconds: true, label: 'Verkeer op ADS-B Exchange' }),
      destroy() { keep.stop(); clearInterval(routeTimer); view.destroy(); report(hkey); },
    };
  },
  form(cfg) {
    const lat = textInput(cfg.lat), lon = textInput(cfg.lon), zoom = textInput(cfg.zoom), def = WIDGETS.adsb.defaults;
    let sidebar = cfg.sidebar;
    return {
      el: [
        h('div', { class: 'row' }, field('Breedtegraad', lat), field('Lengtegraad', lon), field('Zoom', zoom)),
        h('div', { class: 'hint field' }, h('div', { class: 'hint' }, `Dit is de standaardweergave waar de kaart op blijft staan en waar de knop met de schietschijf naar terugkeert. Standaard is de kaart gecentreerd op Nederland (${def.lat}, ${def.lon}, zoom ${def.zoom}) en schaalt de zoom mee met de grootte van de widget. Een hoger zoomgetal zoomt verder in; een zelf ingevuld zoomgetal wordt exact aangehouden.`)),
        checkbox('Zijbalk met vliegtuiglijst tonen', sidebar, (v) => (sidebar = v)),
      ],
      read: () => { const z = parseFloat(zoom.value) || def.zoom; return { lat: parseFloat(lat.value) || def.lat, lon: parseFloat(lon.value) || def.lon, zoom: z, refH: z === cfg.zoom ? cfg.refH : null, sidebar }; },
    };
  },
});
