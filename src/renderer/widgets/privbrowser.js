'use strict';

/* ============================================================
   Browser: een privébrowser als eigen tabblad (alleen Windows). Alles wat de pagina's doen gaat door
   Tor (of, bewust gekozen, direct), niets wordt bewaard, trackers en reclame worden geblokkeerd en
   vingerafdrukken krijgen vaste waarden of ruis. De techniek staat in src/main/privbrowser.js; hier de
   tabbladen, de adresbalk, het schild per site, de verbinding, nieuwe identiteit, downloads, zoeken op de
   pagina, de startpagina en letterboxing.
   ============================================================ */
const PB = { live: new Set(), status: null, wired: false, downloads: new Map() };

// One set of listeners for the whole dashboard; every open Browser tab hears them.
function pbWire() {
  if (PB.wired) return;
  PB.wired = true;
  const api = window.palv.privbrowser;
  const each = (fn) => (d) => { for (const inst of PB.live) inst[fn] && inst[fn](d); };
  api.onStatus((s) => { PB.status = s; each('onStatus')(s); });
  api.onOpen(each('onOpen'));
  api.onKey(each('onKey'));
  api.onBlocked(each('onBlocked'));
  api.onRefused(each('onRefused'));
  api.onDownload((d) => {
    PB.downloads.set(d.id, d);
    if (d.state === 'completed') toast(`Gedownload: ${d.name}`);
    else if (d.state === 'interrupted') toast(`Download mislukt: ${d.name}`, true);
    each('onDownload')(d);
  });
}

const pbSettings = () => state.settings.privbrowser;
const pbSave = (patch) => { Object.assign(state.settings.privbrowser, patch); save(); };
const PB_ERR = {
  '-105': ['Adres niet gevonden', 'Dit adres bestaat niet of is niet te bereiken. Controleer de spelling.'],
  '-106': ['Geen internet', 'Dit scherm heeft op dit moment geen internetverbinding.'],
  '-109': ['Adres onbereikbaar', 'De site is op dit moment niet te bereiken.'],
  '-118': ['Site reageert niet', 'De site gaf te lang geen antwoord. Over Tor is dat soms even zo; probeer het opnieuw.'],
  '-102': ['Verbinding geweigerd', 'De site weigert de verbinding.'],
  '-130': ['Geen verbinding met Tor', 'Tor is (nog) niet verbonden. Zonder Tor laadt er niets: zo lekt er nooit iets langs Tor heen.'],
  '-15': ['Geen verbinding met Tor', 'Tor is (nog) niet verbonden. Zonder Tor laadt er niets: zo lekt er nooit iets langs Tor heen.'],
  '-21': ['Netwerk gewijzigd', 'De netwerkverbinding veranderde tijdens het laden. Probeer het opnieuw.'],
  '-20': ['Geblokkeerd', 'Dit adres opent de browser niet.'],
  '-3': null,
};
const pbErr = (code, desc) => PB_ERR[String(code)] || (code <= -200 && code > -300
  ? ['Onveilige verbinding', `Het certificaat van deze site klopt niet (${desc}). De pagina is niet geopend: iemand kan meekijken of zich voordoen als de site.`]
  : ['Pagina niet geladen', `De pagina kon niet geladen worden (${desc || code}).`]);

if (HAS_PRIVBROWSER) defineWidget('privbrowser', {
  desc: 'Een privébrowser in het dashboard: via Tor, niets bewaard, trackers en reclame geblokkeerd, bescherming tegen vingerafdrukken.',
  icon: 'globe',
  tabIcon: 'globe',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    pbWire();
    const api = window.palv.privbrowser;
    const core = window.PRIV_CORE;
    let tabs = [];
    let active = null;
    let partition = null;
    let status = PB.status;
    let seq = 0;
    let findOpen = false;

    /* ---------- the frame ---------- */
    const tabRow = h('div', { class: 'pb-tabs', role: 'tablist' });
    const addr = h('input', { class: 'pb-addr-in', type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: 'Zoek of typ een adres', 'aria-label': 'Adres of zoekterm' });
    const addrIcon = h('span', { class: 'pb-addr-ic' });
    const btn = (ic, title, onclick, cls = '') => h('button', { class: 'pb-btn ' + cls, title, 'aria-label': title, onclick }, icon(ic));
    const back = btn('left', 'Terug (Alt+←)', () => cur()?.wv?.goBack());
    const fwd = btn('right', 'Vooruit (Alt+→)', () => cur()?.wv?.goForward());
    const reload = btn('refresh', 'Opnieuw laden (F5)', () => { const t = cur(); if (!t) return; if (t.loading && t.wv) t.wv.stop(); else reloadTab(t); });
    const home = btn('home', 'Startpagina', () => { const t = cur(); if (t) showStart(t); });
    const shieldBtn = h('button', { class: 'pb-shield', title: 'Bescherming van deze site', onclick: () => shieldMenu() }, icon('shield'), h('span', { class: 'pb-count' }));
    const connBtn = h('button', { class: 'pb-conn', title: 'Verbinding', onclick: () => connMenu() });
    const identBtn = btn('broom', 'Nieuwe identiteit: alle tabbladen dicht, alles gewist, nieuwe Tor-route', () => newIdentity(), 'pb-ident');
    const dlBtn = h('button', { class: 'pb-btn pb-dl-btn', title: 'Downloads', 'aria-label': 'Downloads', onclick: () => downloadsMenu() }, icon('download'), h('span', { class: 'pb-dl-dot', hidden: true }));
    const menuBtn = btn('dots', 'Menu', () => mainMenu());
    const bar = h('div', { class: 'pb-bar' }, back, fwd, reload, home,
      h('form', { class: 'pb-addr', onsubmit: (e) => { e.preventDefault(); go(addr.value); } }, addrIcon, addr),
      shieldBtn, connBtn, identBtn, dlBtn, menuBtn);
    const findIn = h('input', { class: 'input pb-find-in', type: 'text', placeholder: 'Zoeken op deze pagina', spellcheck: 'false' });
    const findCount = h('span', { class: 'pb-find-n' });
    const findBar = h('div', { class: 'pb-find', hidden: true }, icon('search'), findIn, findCount,
      btn('chevronDown', 'Vorige', () => findStep(false), 'pb-up'), btn('chevronDown', 'Volgende (Enter)', () => findStep(true)), btn('close', 'Sluiten (Esc)', () => closeFind()));
    const view = h('div', { class: 'pb-view' });
    const start = h('div', { class: 'pb-start' });
    const msg = h('div', { class: 'pb-msg', hidden: true });
    const torCard = h('div', { class: 'pb-tor', hidden: true });
    const stage = h('div', { class: 'pb-stage' }, view, start, msg, torCard);
    const hover = h('div', { class: 'pb-hover', hidden: true });
    const root = h('div', { class: 'pb' }, tabRow, bar, findBar, stage, hover);
    body.append(root);

    const cur = () => tabs.find((t) => t.id === active) || null;
    const byGuest = (id) => tabs.find((t) => t.guest === id);

    /* ---------- letterboxing ---------- */
    const fit = () => {
      const r = stage.getBoundingClientRect();
      const s = core.letterbox(r.width, r.height, pbSettings().letterbox);
      Object.assign(view.style, { width: s.w + 'px', height: s.h + 'px' });
      stage.classList.toggle('boxed', pbSettings().letterbox && (s.w < Math.floor(r.width) - 1 || s.h < Math.floor(r.height) - 1));
    };
    const ro = new ResizeObserver(fit);
    ro.observe(stage);

    /* ---------- tabs ---------- */
    function newTab(url, { background = false, after = null } = {}) {
      const t = { id: ++seq, wv: null, guest: 0, url: '', title: 'Nieuw tabblad', loading: false, blocked: 0, shield: true, err: null, refused: null };
      const at = after ? tabs.indexOf(after) + 1 : tabs.length;
      tabs.splice(at > 0 ? at : tabs.length, 0, t);
      if (url) navigate(t, url);
      if (!background || !active) select(t.id);
      else renderTabs();
      return t;
    }
    function makeView(t) {
      const wv = document.createElement('webview');
      wv.setAttribute('partition', partition);
      wv.setAttribute('allowpopups', '');
      wv.setAttribute('webpreferences', 'contextIsolation=yes, sandbox=yes, spellcheck=no');
      wv.className = 'pb-wv';
      t.wv = wv;
      oskWatchWebview(wv, (code) => api.isolated(wv.getWebContentsId(), code));
      wv.addEventListener('dom-ready', () => { t.guest = wv.getWebContentsId(); if (t.id === active) paintBar(); });
      wv.addEventListener('did-start-loading', () => { t.loading = true; t.err = null; paint(t); });
      wv.addEventListener('did-stop-loading', () => { t.loading = false; paint(t); });
      wv.addEventListener('page-title-updated', (e) => { t.title = e.title || t.url; renderTabs(); });
      const nav = (e) => {
        if (e.isMainFrame === false) return;
        t.url = e.url;
        // A page without a title of its own (a file, a picture, plain data) goes by its site.
        if (!e.isInPlace && (!t.title || t.title === 'Nieuw tabblad')) t.title = siteName(e.url) || t.title;
        if (t.id === active && document.activeElement !== addr) addr.value = shownUrl(t.url);
        api.shieldState(t.url).then((on) => { t.shield = on; if (t.id === active) paintBar(); });
        paint(t);
      };
      wv.addEventListener('did-navigate', nav);
      wv.addEventListener('did-navigate-in-page', nav);
      wv.addEventListener('did-fail-load', (e) => {
        if (!e.isMainFrame || e.errorCode === -3) return;
        // A refusal of our own (local network, http) is explained by onRefused.
        if (e.errorCode === -20 && t.refused) return;
        t.err = { code: e.errorCode, desc: e.errorDescription, url: e.validatedURL };
        t.loading = false;
        paint(t);
      });
      wv.addEventListener('update-target-url', (e) => {
        if (t.id !== active) return;
        hover.hidden = !e.url;
        hover.textContent = e.url ? shownUrl(e.url) : '';
      });
      wv.addEventListener('found-in-page', (e) => {
        const r = e.result;
        if (r && r.finalUpdate) findCount.textContent = r.matches ? `${r.activeMatchOrdinal} van ${r.matches}` : 'Geen resultaten';
      });
      wv.addEventListener('enter-html-full-screen', () => root.classList.add('full'));
      wv.addEventListener('leave-html-full-screen', () => root.classList.remove('full'));
      wv.addEventListener('render-process-gone', () => { t.err = { code: -1, desc: 'De pagina is vastgelopen; ze wordt opnieuw geladen.' }; paint(t); });
      view.append(wv);
      return wv;
    }
    function navigate(t, url) {
      t.err = null;
      t.refused = null;
      t.url = url;
      if (!t.wv) {
        makeView(t).setAttribute('src', url);
      } else {
        t.wv.loadURL(url).catch(() => {});
      }
      if (t.id === active) { addr.value = shownUrl(url); paint(t); }
    }
    function go(text) {
      const url = core.toUrl(text, pbSettings().engine);
      if (!url) return;
      const t = cur() || newTab();
      navigate(t, url);
      addr.blur();
      cur()?.wv?.focus();
    }
    function reloadTab(t) {
      if (t.err && t.url) { navigate(t, t.err.url || t.url); return; }
      if (t.wv) t.wv.reload();
    }
    function showStart(t) {
      if (t.wv) { t.wv.remove(); t.wv = null; t.guest = 0; }
      t.url = '';
      t.title = 'Nieuw tabblad';
      t.err = null;
      t.refused = null;
      if (t.id === active) { addr.value = ''; addr.focus(); }
      paint(t);
    }
    function select(id) {
      active = id;
      for (const t of tabs) if (t.wv) t.wv.classList.toggle('on', t.id === id);
      const t = cur();
      addr.value = t ? shownUrl(t.url) : '';
      hover.hidden = true;
      if (findOpen) closeFind();
      paint(t);
      if (t && !t.url) setTimeout(() => addr.focus(), 0);
    }
    function closeTab(t) {
      const i = tabs.indexOf(t);
      if (i < 0) return;
      if (t.wv) t.wv.remove();
      tabs.splice(i, 1);
      if (!tabs.length) newTab();
      else if (active === t.id) select(tabs[Math.min(i, tabs.length - 1)].id);
      else renderTabs();
    }
    function closeAll() {
      for (const t of tabs) if (t.wv) t.wv.remove();
      tabs = [];
      active = null;
    }

    /* ---------- painting ---------- */
    const shownUrl = (url) => (!url || url === 'about:blank' ? '' : url);
    const siteName = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
    function renderTabs() {
      tabRow.replaceChildren(...tabs.map((t) => h('div', { class: 'pb-tab' + (t.id === active ? ' on' : '') + (t.loading ? ' loading' : ''), role: 'tab', title: t.title + (t.url ? '\n' + t.url : ''), onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); closeTab(t); } }, onclick: () => select(t.id) },
        h('span', { class: 'pb-tab-ic' }, t.loading ? h('span', { class: 'pb-spin' }) : t.url ? h('span', { class: 'pb-letter' }, (siteName(t.url)[0] || '•').toUpperCase()) : icon('globe')),
        h('span', { class: 'pb-tab-t' }, t.title || siteName(t.url) || 'Nieuw tabblad'),
        h('button', { class: 'pb-tab-x', title: 'Tabblad sluiten (Ctrl+W)', onclick: (e) => { e.stopPropagation(); closeTab(t); } }, icon('close')))),
      h('button', { class: 'pb-tab-add', title: 'Nieuw tabblad (Ctrl+T)', 'aria-label': 'Nieuw tabblad', onclick: () => newTab() }, icon('plus')));
    }
    function paintBar() {
      const t = cur();
      back.disabled = !(t && t.wv && t.guest && t.wv.canGoBack());
      fwd.disabled = !(t && t.wv && t.guest && t.wv.canGoForward());
      reload.replaceChildren(icon(t && t.loading ? 'close' : 'refresh'));
      reload.title = t && t.loading ? 'Stoppen' : 'Opnieuw laden (F5)';
      let kind = 'none';
      try { const u = new URL(t && t.url); kind = u.hostname.endsWith('.onion') ? 'onion' : u.protocol === 'https:' ? 'secure' : 'insecure'; } catch { /* start page */ }
      addrIcon.className = 'pb-addr-ic ' + kind;
      addrIcon.title = { onion: 'Onion-site: versleuteld en anoniem binnen Tor', secure: 'Versleutelde verbinding (https)', insecure: 'Niet versleuteld (http): wat u hier invult kan onderweg gelezen worden', none: '' }[kind];
      addrIcon.replaceChildren(kind === 'onion' ? icon('onion') : kind === 'secure' ? icon('lock') : kind === 'insecure' ? icon('unlock') : icon('search'));
      shieldBtn.hidden = !(t && t.url);
      shieldBtn.classList.toggle('off', !!(t && !t.shield));
      shieldBtn.firstChild.replaceWith(icon(t && !t.shield ? 'shieldOff' : 'shield'));
      shieldBtn.querySelector('.pb-count').textContent = t && t.shield && t.blocked ? String(t.blocked > 99 ? '99+' : t.blocked) : '';
      shieldBtn.title = t && !t.shield ? `Bescherming staat uit voor ${siteName(t.url)}` : `Bescherming aan${t && t.blocked ? ` · ${t.blocked} trackers en advertenties geblokkeerd` : ''}`;
      paintConn();
    }
    function paintConn() {
      const s = status;
      const mode = pbSettings().mode;
      const ts = s && s.tor ? s.tor : { state: 'off' };
      let cls = 'direct', text = 'Direct';
      if (mode === 'tor') {
        cls = ts.state === 'ready' ? 'tor ok' : ts.state === 'error' ? 'tor err' : 'tor wait';
        text = ts.state === 'ready' ? 'Tor' : ts.state === 'error' ? 'Tor fout' : `Tor ${ts.progress || 0}%`;
      }
      connBtn.className = 'pb-conn ' + cls;
      connBtn.replaceChildren(icon(mode === 'tor' ? 'onion' : 'globe'), h('span', {}, text));
      connBtn.title = mode === 'tor'
        ? (ts.state === 'ready' ? 'Verbonden via Tor: sites zien niet waar u bent' : ts.state === 'error' ? `Tor: ${ts.error || 'geen verbinding'}` : `Tor maakt verbinding: ${ts.summary || ''}`)
        : 'Direct: sites zien het IP-adres van dit netwerk';
      // The card over the page while Tor is not up: nothing loads without it.
      const show = mode === 'tor' && ts.state !== 'ready';
      torCard.hidden = !show;
      if (show) {
        torCard.replaceChildren(h('div', { class: 'pb-card' },
          h('div', { class: 'pb-card-ic' }, icon('onion')),
          h('b', {}, ts.state === 'error' ? 'Tor heeft geen verbinding' : 'Verbinden met Tor…'),
          h('div', { class: 'pb-prog' }, h('i', { style: `width:${ts.state === 'error' ? 100 : ts.progress || 2}%` })),
          h('p', {}, ts.state === 'error' ? (ts.error || 'Tor stopte.') + ' Er wordt automatisch opnieuw geprobeerd.' : ts.summary || 'Tor starten'),
          h('p', { class: 'hint' }, 'Zolang Tor niet verbonden is laadt er niets: zo gaat er nooit iets langs Tor heen naar buiten.',
            ts.state === 'error' || (ts.progress || 0) < 15 ? ' Blokkeert dit netwerk Tor? Zet bruggen aan in Instellingen › Browser.' : ''),
          h('div', { class: 'pb-card-act' },
            h('button', { class: 'btn', onclick: () => setMode('direct') }, icon('globe'), 'Direct verbinden'),
            h('button', { class: 'btn', onclick: () => openSettings('privbrowser') }, icon('gear'), 'Bruggen…'))));
      }
    }
    function paint(t) {
      renderTabs();
      if (!t || t.id !== active) return;
      paintBar();
      start.hidden = !!t.url;
      if (!t.url) renderStart();
      if (t.wv) t.wv.classList.toggle('on', true);
      if (t.refused) {
        msg.hidden = false;
        const local = t.refused.why === 'local';
        msg.replaceChildren(h('div', { class: 'pb-card' },
          h('div', { class: 'pb-card-ic warn' }, icon(local ? 'shield' : 'unlock')),
          h('b', {}, local ? 'Dit adres opent de browser niet' : 'Deze site werkt alleen zonder versleuteling'),
          h('p', {}, local ? 'Adressen op deze computer en het lokale netwerk zijn afgeschermd, zodat een website nooit bij het dashboard of andere apparatuur kan.' : `${siteName(t.refused.url)} stuurt steeds terug naar een onversleutelde verbinding (http). Alles wat u daar ziet of invult kan onderweg gelezen en veranderd worden.`),
          local ? null : h('div', { class: 'pb-card-act' },
            h('button', { class: 'btn', onclick: () => t.wv && t.wv.canGoBack() ? t.wv.goBack() : showStart(t) }, icon('left'), 'Terug'),
            h('button', { class: 'btn danger', onclick: async () => { await api.allowHttp(t.refused.url); navigate(t, t.refused.url); } }, 'Toch openen via http'))));
      } else if (t.err) {
        const [title, text] = pbErr(t.err.code, t.err.desc) || ['', ''];
        msg.hidden = false;
        msg.replaceChildren(h('div', { class: 'pb-card' },
          h('div', { class: 'pb-card-ic warn' }, icon('alert')),
          h('b', {}, title), h('p', {}, text),
          t.err.url ? h('p', { class: 'hint pb-url' }, t.err.url) : null,
          h('div', { class: 'pb-card-act' }, h('button', { class: 'btn primary', onclick: () => reloadTab(t) }, icon('refresh'), 'Opnieuw proberen'))));
      } else {
        msg.hidden = true;
      }
    }

    /* ---------- start page: search and favourites, nothing loaded from outside ---------- */
    function renderStart() {
      const s = pbSettings();
      const q = h('input', { class: 'pb-start-in', type: 'text', placeholder: `Zoeken met ${(core.ENGINES[s.engine] || core.ENGINES.ddg).name}`, spellcheck: 'false' });
      const favs = s.favorites.map((f, i) => h('div', { class: 'pb-fav', title: f.url, onclick: () => go(f.url) },
        h('span', { class: 'pb-fav-l' }, (f.name[0] || '•').toUpperCase()), h('span', { class: 'pb-fav-n' }, f.name),
        h('button', { class: 'pb-fav-x', title: 'Weghalen', onclick: (e) => { e.stopPropagation(); s.favorites.splice(i, 1); save(); renderStart(); } }, icon('close'))));
      const mode = s.mode === 'tor';
      start.replaceChildren(h('div', { class: 'pb-start-in-wrap' },
        h('div', { class: 'pb-start-ic' }, icon(mode ? 'onion' : 'globe')),
        h('form', { class: 'pb-start-form', onsubmit: (e) => { e.preventDefault(); go(q.value); } }, icon('search'), q),
        h('div', { class: 'pb-favs' }, ...favs, h('div', { class: 'pb-fav add', title: 'Favoriet toevoegen', onclick: () => addFavorite() }, h('span', { class: 'pb-fav-l' }, icon('plus')), h('span', { class: 'pb-fav-n' }, 'Toevoegen'))),
        h('ul', { class: 'pb-facts' },
          h('li', {}, icon(mode ? 'onion' : 'globe'), mode ? 'Via Tor: sites zien niet waar u bent of wie u bent.' : 'Direct: sites zien het IP-adres van dit netwerk. Kies Tor voor anoniem.'),
          h('li', {}, icon('broom'), 'Niets wordt bewaard: geen geschiedenis, cookies of wachtwoorden. Nieuwe identiteit wist alles meteen.'),
          h('li', {}, icon('shield'), 'Trackers, advertenties en cookiemeldingen worden geblokkeerd, vingerafdrukken krijgen ruis.'))));
      if (cur() && !cur().url) setTimeout(() => { if (document.activeElement !== addr) q.focus(); }, 0);
    }
    function addFavorite(prefill) {
      const name = textInput(prefill ? prefill.title : '', { placeholder: 'Naam', maxlength: 24 });
      const url = textInput(prefill ? prefill.url : '', { placeholder: 'https://…' });
      openModal({
        title: 'Favoriet toevoegen',
        body: [field('Naam', name), field('Adres', url)],
        actions: [{ label: 'Annuleren' }, { label: 'Toevoegen', primary: true, onClick: () => {
          const u = core.toUrl(url.value, null);
          if (!u || !/^https?:/.test(u) || Object.values(core.ENGINES).some((e) => u.startsWith(e.url.split('%s')[0]))) { toast('Geen geldig adres', true); return false; }
          pbSettings().favorites.push({ name: name.value.trim() || siteName(u), url: u });
          save();
          const t = cur();
          if (t && !t.url) renderStart();
          toast('Favoriet toegevoegd');
          return true;
        } }],
      });
    }

    /* ---------- the shield ---------- */
    function popup(anchor, content) {
      document.querySelectorAll('.pb-pop').forEach((p) => p.remove());
      const r = anchor.getBoundingClientRect();
      const pop = h('div', { class: 'pb-pop', style: `top:${r.bottom + 6}px;right:${Math.max(8, window.innerWidth - r.right)}px` }, ...content);
      document.body.append(pop);
      const off = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); } };
      setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
      return pop;
    }
    function shieldMenu() {
      const t = cur();
      if (!t || !t.url) return;
      const site = siteName(t.url);
      const pop = popup(shieldBtn, [
        h('div', { class: 'pb-pop-h' }, icon(t.shield ? 'shield' : 'shieldOff'), h('b', {}, site)),
        h('p', {}, t.shield ? `Bescherming aan. Op deze pagina ${!t.blocked ? 'is nog niets' : t.blocked === 1 ? 'is 1 tracker of advertentie' : `zijn ${t.blocked} trackers en advertenties`} geblokkeerd; cookies van andere sites worden geweigerd en vingerafdrukken krijgen ruis.` : 'Bescherming uit voor deze site: niets geblokkeerd, geen ruis. Alleen tot de volgende nieuwe identiteit.'),
        h('button', { class: 'btn ' + (t.shield ? 'danger' : 'primary'), onclick: async () => {
          t.shield = await api.shield(t.url, !t.shield);
          pop.remove();
          t.blocked = 0;
          paintBar();
          if (t.wv) t.wv.reload();
        } }, icon(t.shield ? 'shieldOff' : 'shield'), t.shield ? 'Uitzetten voor deze site' : 'Weer aanzetten'),
        h('p', { class: 'hint' }, 'Werkt een site niet goed? Zet de bescherming dan alleen voor die site uit.'),
      ]);
      void pop;
    }

    /* ---------- the connection ---------- */
    function connMenu() {
      const s = pbSettings();
      const ts = status && status.tor ? status.tor : {};
      const pop = popup(connBtn, [
        h('div', { class: 'pb-pop-h' }, icon(s.mode === 'tor' ? 'onion' : 'globe'), h('b', {}, s.mode === 'tor' ? `Tor · ${ts.state === 'ready' ? 'verbonden' : ts.state === 'error' ? 'geen verbinding' : `${ts.progress || 0}%`}` : 'Direct')),
        h('div', { class: 'pb-choice' + (s.mode === 'tor' ? ' on' : ''), onclick: () => { pop.remove(); setMode('tor'); } },
          icon('onion'), h('div', {}, h('b', {}, 'Tor (aanbevolen)'), h('small', {}, 'Anoniem: sites zien een adres van het Tor-netwerk, niet dit netwerk. Iets trager.'))),
        h('div', { class: 'pb-choice' + (s.mode === 'direct' ? ' on' : ''), onclick: () => { pop.remove(); setMode('direct'); } },
          icon('globe'), h('div', {}, h('b', {}, 'Direct'), h('small', {}, 'Sneller, maar sites zien het IP-adres van dit netwerk. De rest van de bescherming blijft.'))),
        h('p', { class: 'hint' }, 'Wisselen sluit alle tabbladen en wist alles, zodat de twee nooit aan elkaar te koppelen zijn.'),
      ]);
      void pop;
    }
    async function setMode(mode) {
      if (mode === pbSettings().mode && partition) return;
      const run = async () => {
        pbSave({ mode });
        closeAll();
        await open();
        newTab();
        toast(mode === 'tor' ? 'Browser via Tor' : 'Browser direct verbonden');
      };
      if (!tabs.some((t) => t.url)) return run();
      confirmDialog(mode === 'tor' ? 'Verbinden via Tor' : 'Direct verbinden', `Alle tabbladen worden gesloten en alles wordt gewist.${mode === 'direct' ? ' Daarna zien sites het IP-adres van dit netwerk.' : ''}`, mode === 'tor' ? 'Via Tor' : 'Direct verbinden', run);
    }
    function newIdentity() {
      const run = async () => {
        closeAll();
        status = await api.newIdentity();
        partition = status.partition;
        newTab();
        toast('Nieuwe identiteit: alles gewist' + (pbSettings().mode === 'tor' ? ', nieuwe Tor-route' : ''));
      };
      if (!tabs.some((t) => t.url)) return run();
      confirmDialog('Nieuwe identiteit', 'Alle tabbladen worden gesloten en alles van deze sessie wordt gewist: cookies, opslag en cache. Tor kiest een nieuwe route, sites zien een ander toestel.', 'Alles wissen', run);
    }

    /* ---------- downloads ---------- */
    function downloadsMenu() {
      const list = [...PB.downloads.values()].reverse().slice(0, 8);
      const pct = (d) => (d.total ? Math.round((d.received / d.total) * 100) : 0);
      const pop = popup(dlBtn, [
        h('div', { class: 'pb-pop-h' }, icon('download'), h('b', {}, 'Downloads')),
        list.length ? h('div', { class: 'pb-dls' }, ...list.map((d) => h('div', { class: 'pb-dl' },
          h('div', { class: 'pb-dl-t' }, h('b', {}, d.name), h('small', {}, d.state === 'completed' ? 'Klaar' : d.state === 'progressing' ? `${pct(d)}%` : d.state === 'cancelled' ? 'Geannuleerd' : 'Mislukt')),
          d.state === 'progressing' ? h('button', { class: 'pb-btn', title: 'Annuleren', onclick: () => api.cancelDownload(d.id) }, icon('close'))
            : d.state === 'completed' ? h('button', { class: 'pb-btn', title: 'Tonen in de map', onclick: () => api.showDownload(d.id) }, icon('folder')) : null)))
          : h('p', {}, 'Nog niets gedownload in deze sessie.'),
        h('button', { class: 'btn', onclick: () => { api.openDownloads(); pop.remove(); } }, icon('folder'), 'Map Downloads openen'),
        h('p', { class: 'hint' }, 'Bestanden komen in de map Downloads van deze computer. Open ze niet als u ze niet vertrouwt.'),
      ]);
      dlBtn.querySelector('.pb-dl-dot').hidden = true;
    }

    /* ---------- menu ---------- */
    function mainMenu() {
      const t = cur();
      const zoom = (d) => { if (!t || !t.wv || !t.guest) return; const z = d ? Math.min(3, Math.max(0.3, t.wv.getZoomFactor() + d)) : 1; t.wv.setZoomFactor(z); };
      const item = (ic, label, fn, dis) => h('button', { class: 'pb-item', disabled: !!dis, onclick: () => { pop.remove(); fn(); } }, icon(ic), h('span', {}, label));
      const pop = popup(menuBtn, [
        item('plus', 'Nieuw tabblad (Ctrl+T)', () => newTab()),
        item('broom', 'Nieuwe identiteit', () => newIdentity()),
        h('hr'),
        h('div', { class: 'pb-zoom' }, h('span', {}, 'Zoomen'),
          h('button', { class: 'pb-btn', onclick: () => zoom(-0.1) }, '−'),
          h('button', { class: 'pb-btn', onclick: () => zoom(0) }, '100%'),
          h('button', { class: 'pb-btn', onclick: () => zoom(0.1) }, '+')),
        item('search', 'Zoeken op de pagina (Ctrl+F)', () => openFind(), !t || !t.guest),
        item('star', 'Toevoegen aan favorieten', () => addFavorite({ title: t.title, url: t.url }), !t || !t.url),
        item('download', 'Opslaan als pdf', () => savePdf(), !t || !t.guest),
        item('note', 'Afdrukken (Ctrl+P)', () => t.wv.print(), !t || !t.guest),
        h('hr'),
        item('gear', 'Instellingen van de browser', () => openSettings('privbrowser')),
      ]);
    }
    async function savePdf() {
      const t = cur();
      if (!t || !t.guest) return;
      const name = await api.savePdf(t.guest).catch(() => null);
      if (name) toast(`Opgeslagen in Downloads: ${name}`); else toast('Opslaan als pdf lukte niet', true);
    }

    /* ---------- find in page ---------- */
    function openFind() {
      const t = cur();
      if (!t || !t.guest) return;
      findOpen = true;
      findBar.hidden = false;
      findIn.select();
      findIn.focus();
    }
    function findStep(forward) {
      const t = cur();
      if (!t || !t.wv || !findIn.value) return;
      t.wv.findInPage(findIn.value, { forward, findNext: true });
    }
    function closeFind() {
      findOpen = false;
      findBar.hidden = true;
      findCount.textContent = '';
      const t = cur();
      if (t && t.wv && t.guest) t.wv.stopFindInPage('clearSelection');
    }
    findIn.addEventListener('input', () => { const t = cur(); if (t && t.wv && findIn.value) t.wv.findInPage(findIn.value); else { findCount.textContent = ''; t && t.wv && t.guest && t.wv.stopFindInPage('clearSelection'); } });
    findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findStep(!e.shiftKey); } else if (e.key === 'Escape') closeFind(); });

    /* ---------- keys ---------- */
    function key(k, { ctrl, shift, alt } = {}) {
      const t = cur();
      if (ctrl && k === 't') newTab();
      else if (ctrl && k === 'w') { if (t) closeTab(t); }
      else if ((ctrl && k === 'l') || k === 'f6') { addr.focus(); addr.select(); }
      else if (ctrl && k === 'f') openFind();
      else if ((ctrl && k === 'r') || k === 'f5') { if (t) reloadTab(t); }
      else if (ctrl && k === 'tab' && tabs.length > 1) { const i = tabs.indexOf(t); select(tabs[(i + (shift ? tabs.length - 1 : 1)) % tabs.length].id); }
      else if (ctrl && (k === '=' || k === '+')) { if (t && t.guest) t.wv.setZoomFactor(Math.min(3, t.wv.getZoomFactor() + 0.1)); }
      else if (ctrl && k === '-') { if (t && t.guest) t.wv.setZoomFactor(Math.max(0.3, t.wv.getZoomFactor() - 0.1)); }
      else if (ctrl && k === '0') { if (t && t.guest) t.wv.setZoomFactor(1); }
      else if (ctrl && k === 'p') { if (t && t.guest) t.wv.print(); }
      else if (ctrl && k === 'd') { if (t && t.url) addFavorite({ title: t.title, url: t.url }); }
      else if (k === 'pdf') savePdf();
      else if (alt && k === 'arrowleft') { if (t && t.wv) t.wv.goBack(); }
      else if (alt && k === 'arrowright') { if (t && t.wv) t.wv.goForward(); }
      else if (alt && k === 'home') { if (t) showStart(t); }
    }
    root.addEventListener('keydown', (e) => {
      if (e.target === findIn) return;
      const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
      if ((ctrl && ['t', 'w', 'l', 'f', 'r', 'tab', 'd'].includes(k)) || k === 'f5' || k === 'f6') { e.preventDefault(); key(k, { ctrl, shift: e.shiftKey, alt: e.altKey }); }
    });
    addr.addEventListener('focus', () => setTimeout(() => addr.select(), 0));
    addr.addEventListener('keydown', (e) => { if (e.key === 'Escape') { addr.value = shownUrl(cur()?.url); addr.blur(); } });

    /* ---------- from the main process ---------- */
    const inst = {
      onStatus(s) { status = s; paintConn(); const t = cur(); if (s.tor && s.tor.state === 'ready' && t && t.err && (t.err.code === -130 || t.err.code === -15)) reloadTab(t); },
      onOpen(d) {
        const from = tabs.find((t) => t.guest === d.from);
        if (!from && d.from) return;
        const url = d.search ? core.toUrl(d.search, pbSettings().engine) : d.url;
        if (url && /^https?:/i.test(url)) newTab(url, { background: !!d.background, after: from });
      },
      onKey(d) { if (byGuest(d.id)) key(d.key, d); },
      onBlocked(d) { const t = byGuest(d.id); if (!t) return; t.blocked = d.count; if (t.id === active) paintBar(); },
      onRefused(d) { const t = byGuest(d.id); if (!t) return; t.refused = d; t.err = null; t.loading = false; paint(t); },
      fit,
      setMode,
      onDownload(d) { if (d.state === 'progressing' && d.received === 0) dlBtn.querySelector('.pb-dl-dot').hidden = false; },
    };
    PB.live.add(inst);

    /* ---------- open the session ---------- */
    async function open() {
      const s = pbSettings();
      status = await api.open({ mode: s.mode, bridges: s.bridges });
      partition = status.partition;
      paintConn();
    }
    open().then(() => { if (!tabs.length) newTab(); fit(); });

    return {
      destroy() {
        PB.live.delete(inst);
        ro.disconnect();
        closeAll();
        document.querySelectorAll('.pb-pop').forEach((p) => p.remove());
      },
    };
  },
});

/* ---------- Instellingen › Browser ---------- */
function privBrowserSettingsPane() {
  const s = state.settings.privbrowser;
  const core = window.PRIV_CORE;
  const seg = (opts, value, onPick) => {
    const box = h('div', { class: 'seg' });
    const paint = (v) => box.replaceChildren(...opts.map(([k, label]) => h('button', { class: k === v ? 'on' : '', onclick: () => { onPick(k); paint(k); } }, label)));
    paint(value);
    return box;
  };
  const info = h('div', { class: 'sys-ver' });
  const paint = (st) => {
    const t = (st && st.tor) || {};
    info.replaceChildren(
      h('div', {}, h('span', {}, 'Verbinding'), h('b', {}, s.mode === 'tor' ? 'Tor' : 'Direct')),
      h('div', {}, h('span', {}, 'Tor'), h('b', {}, t.state === 'ready' ? 'verbonden' : t.state === 'starting' ? `verbinden ${t.progress || 0}% · ${t.summary || ''}` : t.state === 'error' ? `fout: ${t.error || ''}` : 'niet gestart')),
      h('div', {}, h('span', {}, 'Blokkeerlijsten'), h('b', {}, st && st.blocker ? 'geladen (uBlock Origin, EasyList, EasyPrivacy)' : 'nog niet geladen')));
  };
  window.palv.privbrowser.status().then(paint).catch(() => {});
  return [
    h('h3', {}, 'Verbinding'),
    seg([['tor', 'Tor (aanbevolen)'], ['direct', 'Direct']], s.mode, (v) => { const live = [...PB.live]; if (live.length) live[0].setMode(v); else { s.mode = v; save(); } }),
    h('p', { class: 'hint' }, 'Via Tor ziet een site een adres van het Tor-netwerk, niet dat van dit netwerk, en ziet het netwerk hier niet welke sites bezocht worden. Direct is sneller, maar sites zien het IP-adres van dit netwerk. Valt Tor weg, dan laadt er niets: er gaat nooit iets langs Tor heen.'),
    h('h3', {}, 'Bruggen'),
    seg([['off', 'Uit'], ['snowflake', 'Snowflake'], ['obfs4', 'obfs4'], ['meek', 'meek']], s.bridges, async (v) => { s.bridges = v; save(); paint(await window.palv.privbrowser.setBridges(v)); }),
    h('p', { class: 'hint' }, 'Alleen nodig als dit netwerk Tor blokkeert (Tor blijft dan op een laag percentage hangen). Bruggen verbergen dat er Tor gebruikt wordt. Probeer eerst Snowflake, anders obfs4; meek werkt bijna altijd, maar is traag.'),
    h('h3', {}, 'Zoekmachine'),
    seg(Object.entries(core.ENGINES).map(([k, e]) => [k, e.name]), s.engine, (v) => { s.engine = v; save(); }),
    h('p', { class: 'hint' }, 'Alle vier zonder account en zonder volgen. DuckDuckGo werkt het best via Tor.'),
    h('h3', {}, 'Letterboxing'),
    checkbox('Paginagrootte afronden (zoals Tor Browser en Mullvad Browser)', s.letterbox, (v) => { s.letterbox = v; save(); for (const i of PB.live) i.fit(); }),
    h('p', { class: 'hint' }, 'De pagina krijgt een vaste maat in stappen van 200 bij 100 pixels, met een rand eromheen. Zo verraadt de grootte van dit scherm niets.'),
    h('hr'),
    h('h3', {}, 'Status'),
    info,
    h('p', { class: 'hint' }, 'Wat de browser doet: alles in het geheugen, niets op schijf (geen geschiedenis, cookies of wachtwoorden); cookies van andere sites geweigerd; alleen https; trackers, advertenties en cookiemeldingen geblokkeerd met de lijsten van uBlock Origin en EasyList; tijdzone UTC en taal Engels zoals Mullvad Browser; vaste waarden en ruis voor vingerafdrukken (canvas, WebGL, audio, scherm, processor, geheugen, lettertypen niet); geen camera, microfoon, locatie of meldingen; nooit deze computer of het lokale netwerk. Downloads gaan naar de map Downloads.'),
  ];
}
