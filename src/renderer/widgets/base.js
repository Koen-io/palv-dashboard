'use strict';

/* ============================================================
   Gedeeld door de widgets: ingesloten webpagina's, kaartweergaven die op hun plek blijven, knoppen.
   Elke widget staat in een eigen bestand in deze map en meldt zich aan in WIDGETS.
   ============================================================ */
// A widget kind: { name, defaults (from model.js), desc, icon, size [w, h], chromeless?,
//   mount(w, body, tools) -> { destroy?, fresh?, focus? }, form?(cfg) -> { el, read } }.
// `fresh` returns how old the data on screen is, for the dot in the title bar (see freshBadge).
const WIDGETS = {};
const defineWidget = (type, def) => { WIDGETS[type] = { ...WIDGET_META[type], ...def }; };

// Whether a widget can be seen right now: on the active page, in a window that is not minimised.
const onScreen = (el) => el.isConnected && !!el.closest('.page.active') && document.visibilityState === 'visible';

function makeWebview(body, getUrl) {
  const wv = document.createElement('webview');
  wv.setAttribute('partition', WEB_PARTITION);
  wv.setAttribute('src', getUrl());
  const stateEl = h('div', { class: 'w-state' }, h('div', {}, h('strong', {}, 'Laden…')));
  body.append(wv, stateEl);
  let retry = null;
  let ready = false;
  wv.addEventListener('dom-ready', () => { ready = true; });
  wv.addEventListener('did-finish-load', () => { stateEl.remove(); api.failedSince = 0; api.loadedAt = Date.now(); });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    api.failedSince = api.failedSince || Date.now();
    stateEl.replaceChildren(h('div', {}, h('strong', {}, 'Kan de pagina niet laden'), 'Controleer de internetverbinding. Er wordt automatisch opnieuw geprobeerd.'));
    body.append(stateEl);
    clearTimeout(retry);
    retry = setTimeout(() => api.load(), 30000);
  });
  // The page itself crashed (the main process reloads it): shown until it is back.
  wv.addEventListener('render-process-gone', () => {
    api.failedSince = api.failedSince || Date.now();
    stateEl.replaceChildren(h('div', {}, h('strong', {}, 'Pagina wordt hersteld…'), 'De ingesloten pagina is vastgelopen en wordt automatisch opnieuw geladen.'));
    body.append(stateEl);
  });
  const api = {
    wv,
    failedSince: 0, // since when the page has not loaded, 0 while it is there
    loadedAt: 0,
    load() {
      clearTimeout(retry);
      const url = getUrl();
      if (ready) wv.loadURL(url).catch(() => {});
      else wv.setAttribute('src', url);
    },
    destroy() { clearTimeout(retry); },
  };
  return api;
}

// Zoom offset that keeps a view framed for a body of refH high (and REF_W / REF_H as wide) in sight:
// follows whichever of height or width is tighter, so the framed area never grows or shrinks within it.
const fitDelta = (body, refH) => {
  const wid = body ? body.clientWidth : 0, hgt = body ? body.clientHeight : 0;
  return wid > 50 && hgt > 50 ? Math.log2(Math.min(hgt / refH, wid / ((refH * REF_W) / REF_H))) : 0;
};
// Show an embedded page reduced or enlarged: it gets a proportionally larger or smaller viewport to lay out in.
const scaleWebview = (wv, s) => Object.assign(wv.style, { width: 100 / s + '%', height: 100 / s + '%', transform: `scale(${s})` });

// Runs inside an embedded map page: notes when the user last handled the map, so a view set by hand
// can be told from one the site wandered off to by itself.
const INPUT_JS = "if (!window.__palvIn) { window.__palvIn = { t: 0 }; for (const ev of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'touchstart', 'touchmove', 'touchend']) window.addEventListener(ev, (e) => { if (e.isTrusted && (ev !== 'pointermove' || e.buttons)) window.__palvIn.t = Date.now(); }, { capture: true, passive: true }); }";

// Holds an embedded map on its view. That is the standard view from the widget's settings, until the
// user pans or zooms the map by hand: from then on their view is the one held, up to the reset button.
// The view is re-framed after every change in size and put back whenever the map is found off it.
// `map` knows the site: sample (page script -> { lat, lon, zoom, idle, hold } or null while the map is not
// there), place(at) (page script that puts the map on a view -> true), expect(at) and adopt(sample).
function keepView(w, body, map) {
  let view = null, user = null, fitted = '', pending = null, timer = null, ro = null;
  const size = () => `${body.clientWidth}x${body.clientHeight}`;
  const shown = () => body.clientWidth > 50 && body.clientHeight > 50;
  const current = () => user || w.cfg;
  const run = (js) => (view.wv.isConnected ? view.wv.executeJavaScript(js).catch(() => null) : Promise.resolve(null));
  const place = async () => {
    const at = size();
    if (!(await run(map.place(current())))) return false;
    fitted = at;
    return true;
  };
  // When the site does not cooperate the page is simply loaded again on the view.
  const refit = async () => { if (!(await place())) view.load(); };
  const check = async () => {
    if (pending || !shown()) return;
    const at = size(), s = await run(map.sample);
    // `hold`: the site has the map elsewhere for a moment (an open popup) and brings it back itself.
    if (!s || s.hold || pending || at !== size()) return;
    if (at === fitted && s.idle < 5000) { user = map.adopt(s); return; }
    const want = map.expect(current()), px = 360 / 256 / 2 ** s.zoom; // degrees of longitude per pixel
    if (at !== fitted || Math.abs(s.zoom - want.zoom) > 0.02 || Math.abs(s.lon - want.lon) > 3 * px || Math.abs(s.lat - want.lat) > 2 * px) place();
  };
  return {
    current,
    attach(v) {
      view = v;
      let last = size();
      ro = new ResizeObserver(() => {
        const now = size();
        if (now === last || !shown()) return;
        last = now;
        clearTimeout(pending);
        pending = setTimeout(() => { pending = null; refit(); }, 250);
      });
      ro.observe(body);
      timer = setInterval(check, 1500);
    },
    reset() { user = null; return refit(); },
    stop() { ro.disconnect(); clearTimeout(pending); clearInterval(timer); },
  };
}

const normalizeUrl = (u) => { const s = String(u || '').trim(); return !s ? 'about:blank' : /^[a-z]+:\/\//i.test(s) ? s : 'https://' + s; };

const reloadTool = (view) => h('button', { class: 'w-tool', title: 'Vernieuwen', onclick: () => view.load() }, icon('refresh'));
const recentreTool = (keep) => h('button', { class: 'w-tool', title: 'Kaart terugzetten naar de standaardpositie en het standaard zoomniveau', onclick: () => keep.reset() }, icon('target'));

// Freshness of an embedded web page: when it last loaded, and red while it does not load.
const pageFresh = (view, label, refreshMin) => () => ({
  t: view.loadedAt, fail: !!view.failedSince, loading: !view.loadedAt && !view.failedSince,
  warn: refreshMin > 0 ? refreshMin * 2 * 60000 : 24 * 3600e3, bad: refreshMin > 0 ? refreshMin * 4 * 60000 : 48 * 3600e3,
  label: `${label} (laatst geladen)`,
  note: refreshMin > 0 ? `Wordt elke ${refreshMin} min opnieuw geladen.` : 'Een website ververst zijn eigen inhoud; dit is het moment waarop de pagina is geladen.',
});
