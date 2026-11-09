'use strict';

/* Browser: a web environment of the unit (MadeSmart Tracker) in its own tab, with the controls of an
   ordinary browser: back, forward, reload, home, the address with its padlock, zoom and downloads.
   Its own session (BROWSER_PARTITION): the sign-in stays on this screen and is never shared with the
   other embedded sites. Pop-ups of the site open as their own window in the same session; downloads go
   to the Downloads folder (main.js). */
const BR_ZOOMS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const brDownloads = { last: null, subs: new Set(), wired: false };

defineWidget('browser', {
  desc: 'Een website met eigen inlogsessie en de knoppen van een browser: terug, vooruit, vernieuwen, startpagina, zoom en downloads. Standaard MadeSmart Tracker.',
  icon: 'globe',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    const cfg = w.cfg;
    const home = () => normalizeUrl(cfg.home);
    const root = h('div', { class: 'br' });
    const stage = h('div', { class: 'br-stage' });
    const progress = h('div', { class: 'br-progress' });
    const B = (ic, title, onclick) => h('button', { class: 'br-btn', title, 'aria-label': title, onclick }, icon(ic));
    const back = B('left', 'Terug', () => wv.goBack());
    const fwd = B('right', 'Vooruit', () => wv.goForward());
    const reload = B('refresh', 'Vernieuwen', () => (loading ? wv.stop() : wv.reload()));
    const homeBtn = B('home', 'Startpagina', () => go(home()));
    const pad = h('span', { class: 'br-pad' });
    const addr = h('input', { class: 'br-addr', type: 'text', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Adres' });
    const addrBox = h('label', { class: 'br-addrbox' }, pad, addr);
    const zoomTxt = h('button', { class: 'br-zoomtxt', title: 'Zoom terug naar 100%', onclick: () => setZoom(1) });
    const zoomOut = B('min', 'Kleiner', () => stepZoom(-1));
    const zoomIn = B('plus', 'Groter', () => stepZoom(1));
    const dl = h('button', { class: 'br-dl', hidden: true });
    const bar = h('div', { class: 'br-bar' },
      h('span', { class: 'br-title' }, icon('globe'), (w.title || 'Browser').toUpperCase()),
      h('span', { class: 'br-nav' }, back, fwd, reload, homeBtn), addrBox,
      h('span', { class: 'br-zoom' }, zoomOut, zoomTxt, zoomIn), dl, progress);
    root.append(bar, stage);
    body.append(root);

    const view = makeWebview(stage, home, { partition: BROWSER_PARTITION });
    const wv = view.wv;
    let loading = false, ready = false, typing = false;

    function go(url) { wv.loadURL(url).catch(() => {}); }
    // What is typed: an address (with or without https://); anything else is not sent anywhere.
    addr.addEventListener('focus', () => { typing = true; if (addr.dataset.full && addr.dataset.full !== 'about:blank') addr.value = addr.dataset.full; addr.select(); });
    addr.addEventListener('blur', () => { typing = false; paintAddr(); });
    addr.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { addr.blur(); return; }
      if (e.key !== 'Enter') return;
      const v = addr.value.trim();
      if (!v) return;
      if (/\s/.test(v) || !/[.:]/.test(v)) { toast('Typ een webadres, bijvoorbeeld tracker.madesmart.nl', true); return; }
      go(normalizeUrl(v));
      addr.blur();
    });

    function paintAddr() {
      let url = '';
      try { url = wv.getURL(); } catch { /* not attached yet */ }
      let u = null;
      try { u = new URL(url); } catch { /* about:blank */ }
      const secure = !!u && u.protocol === 'https:';
      pad.replaceChildren(icon(secure ? 'lock' : 'alert'));
      pad.className = 'br-pad ' + (secure ? 'ok' : 'warn');
      pad.title = secure ? `Beveiligde verbinding met ${u.host}` : 'Geen beveiligde verbinding';
      // At rest the host and path; the whole address while typing in it.
      if (!typing) addr.value = u ? (u.host + u.pathname).replace(/\/$/, '') : '';
      addr.dataset.full = url;
      if (!typing) addrBox.dataset.host = u ? u.host : '';
    }
    function paintNav() {
      if (!ready) return;
      back.disabled = !wv.canGoBack();
      fwd.disabled = !wv.canGoForward();
      reload.replaceChildren(icon(loading ? 'close' : 'refresh'));
      reload.title = loading ? 'Laden stoppen' : 'Vernieuwen';
    }
    function setZoom(z) {
      cfg.zoom = clamp(+z || 1, 0.5, 2);
      if (ready) wv.setZoomFactor(cfg.zoom);
      zoomTxt.textContent = `${Math.round(cfg.zoom * 100)}%`;
      zoomTxt.classList.toggle('off', cfg.zoom !== 1);
      save();
    }
    function stepZoom(d) {
      const i = BR_ZOOMS.findIndex((z) => z >= cfg.zoom - 0.001);
      setZoom(BR_ZOOMS[clamp((i < 0 ? BR_ZOOMS.length - 1 : i) + d, 0, BR_ZOOMS.length - 1)]);
    }
    zoomTxt.textContent = `${Math.round((cfg.zoom || 1) * 100)}%`;
    zoomTxt.classList.toggle('off', (cfg.zoom || 1) !== 1);

    wv.addEventListener('dom-ready', () => { ready = true; wv.setZoomFactor(cfg.zoom || 1); paintNav(); paintAddr(); });
    wv.addEventListener('did-start-loading', () => { loading = true; root.classList.add('loading'); paintNav(); });
    wv.addEventListener('did-stop-loading', () => { loading = false; root.classList.remove('loading'); paintNav(); paintAddr(); });
    for (const ev of ['did-navigate', 'did-navigate-in-page', 'did-redirect-navigation']) wv.addEventListener(ev, () => { paintNav(); paintAddr(); });
    wv.addEventListener('page-title-updated', (e) => { addrBox.title = e.title || ''; });

    // Downloads: the last one in the bar; a click shows it in its folder.
    const paintDl = (d) => {
      if (!d) return;
      dl.hidden = false;
      dl.className = 'br-dl ' + d.state;
      dl.replaceChildren(icon(d.state === 'completed' ? 'check' : d.state === 'started' ? 'download' : 'alert'), h('span', {}, d.name));
      dl.title = d.state === 'completed' ? `Opgeslagen in Downloads: ${d.name}. Klik om de map te openen.` : d.state === 'started' ? `Bezig met downloaden: ${d.name}` : `Download mislukt: ${d.name}`;
      dl.onclick = () => { if (d.path) window.palv.browser.showDownload(d.path); };
    };
    if (!brDownloads.wired) {
      brDownloads.wired = true;
      window.palv.browser.onDownload((d) => {
        brDownloads.last = d;
        if (d.state === 'completed') toast(`Gedownload naar Downloads: ${d.name}`);
        else if (d.state !== 'started') toast(`Download mislukt: ${d.name}`, true);
        for (const fn of brDownloads.subs) fn(d);
      });
    }
    brDownloads.subs.add(paintDl);
    paintDl(brDownloads.last);
    paintAddr();

    return {
      fresh: pageFresh(view, w.title || 'Browser', 0),
      destroy() { brDownloads.subs.delete(paintDl); view.destroy(); },
    };
  },
  form(cfg) {
    const url = textInput(cfg.home, { placeholder: 'https://tracker.madesmart.nl' });
    return {
      el: [field('Startpagina', url, 'De pagina waarmee de browser opent en waar de knop Startpagina naartoe gaat. De inlogsessie blijft alleen op dit scherm.')],
      read: () => ({ home: url.value.trim() || 'https://tracker.madesmart.nl/', zoom: cfg.zoom || 1 }),
    };
  },
});
