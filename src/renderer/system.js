'use strict';

/* ============================================================
   Systeem: OLED-bescherming, updates, schermoverzicht en de hartslag naar het hoofdproces.
   ============================================================ */

/* ---------- OLED care: no pixel lights the same way for hours ---------- */
// The whole dashboard drifts very slowly along a small orbit (at most 3 px from its place, one step a
// minute, each step taking 20 seconds), so the fixed lines and letters of the header never burn in.
// Too slow and too small to notice. The mouse pointer hides after a few seconds without movement, and at
// night a barely visible veil takes 4 % off the brightness of everything.
const ORBIT = (() => {
  // A spiral through the 7 x 7 grid around the origin, so neighbouring steps are always 1 px apart.
  const pts = [[0, 0]];
  let x = 0, y = 0, len = 1, dir = 0;
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  while (pts.length < 49) {
    for (let k = 0; k < 2 && pts.length < 49; k += 1) {
      for (let i = 0; i < len && pts.length < 49; i += 1) { x += D[dir][0]; y += D[dir][1]; pts.push([x, y]); }
      dir = (dir + 1) % 4;
    }
    len += 1;
  }
  return pts.concat(pts.slice(1, -1).reverse()); // there and back again, without jumps
})();
const oled = { step: 0, last: 0, cursorTimer: null };
function oledTick() {
  const app = $('#app');
  const on = state.settings.oledCare;
  document.body.classList.toggle('oled', !!on);
  if (!on) { app.style.transform = ''; document.body.classList.remove('oled-night', 'cursor-hidden'); return; }
  const now = Date.now();
  if (now - oled.last >= 60000) {
    oled.last = now;
    oled.step = (oled.step + 1) % ORBIT.length;
    const [dx, dy] = ORBIT[oled.step];
    app.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : '';
  }
  document.body.classList.toggle('oled-night', !udpToday(now).day && document.documentElement.dataset.theme === 'dark');
}
function oledPointer() {
  document.body.classList.remove('cursor-hidden');
  clearTimeout(oled.cursorTimer);
  if (state && state.settings.oledCare) oled.cursorTimer = setTimeout(() => { if (!editing && !modalOpen()) document.body.classList.add('cursor-hidden'); }, 4000);
}

/* ============================================================
   Updates
   ============================================================ */
const upd = { st: null, snoozeUntil: 0, countdown: null, popup: null, shownFor: null };
const MB = (b) => (b / 1048576).toLocaleString('nl-NL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function updateButton() {
  const s = upd.st;
  if (!s || !['downloading', 'ready', 'installing'].includes(s.state)) return null;
  const pct = Math.round((s.progress || 0) * 100);
  const label = s.state === 'downloading' ? `Update ${s.latest} · ${pct}%` : s.state === 'ready' ? `Update ${s.latest} klaar` : 'Installeren…';
  return h('button', { class: 'tb-btn tb-update ' + s.state, title: 'Nieuwe versie van het dashboard', onclick: () => (s.state === 'ready' ? showUpdateReady(true) : openSettings('systeem')) },
    h('span', { class: 'tbu-ring', style: `--p:${pct}` }), icon('download'), label);
}

// Release notes from GitHub as plain lines and bullets; never as HTML.
function notesList(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#{1,6}\s*$/.test(l));
  if (!lines.length) return null;
  const list = h('ul', { class: 'up-notes' });
  for (const l of lines.slice(0, 14)) {
    const head = /^#{1,6}\s+(.*)$/.exec(l);
    if (head) list.append(h('li', { class: 'head' }, head[1].replace(/\*\*/g, '')));
    else list.append(h('li', {}, l.replace(/^[-*•]\s+/, '').replace(/\*\*/g, '').replace(/`/g, '')));
  }
  return list;
}

function updateShell(cls, content) {
  closeUpdatePopup();
  const card = h('div', { class: 'up-card ' + cls }, content);
  const el = h('div', { class: 'up-backdrop' }, card);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  upd.popup = el;
  return el;
}
function closeUpdatePopup() {
  clearInterval(upd.countdown);
  upd.countdown = null;
  if (!upd.popup) return;
  const el = upd.popup;
  upd.popup = null;
  el.classList.remove('in');
  setTimeout(() => el.remove(), 450);
}

const upLogo = (extra) => h('div', { class: 'up-logo' + (extra ? ' ' + extra : '') },
  h('span', { class: 'up-orbit o1' }), h('span', { class: 'up-orbit o2' }), h('span', { class: 'up-orbit o3' }),
  h('img', { src: '../../assets/logo.png', alt: '' }));

// A new version is downloaded and checked: it installs itself after a countdown. Nobody needs to be there;
// someone who is busy can put it off for an hour.
const COUNTDOWN_S = 20;
function showUpdateReady(manual) {
  const s = upd.st;
  if (!s || s.state !== 'ready') return;
  if (!manual && Date.now() < upd.snoozeUntil) return;
  if (upd.popup && upd.shownFor === s.latest) return;
  upd.shownFor = s.latest;
  let left = COUNTDOWN_S;
  const num = h('b', { class: 'up-count-num' }, left);
  const ring = h('span', { class: 'up-count', style: `--p:0` }, num, h('small', {}, 'sec'));
  const status = h('p', { class: 'up-status' }, 'Het dashboard wordt automatisch bijgewerkt en start daarna vanzelf opnieuw.');
  const now = h('button', { class: 'btn primary up-go', onclick: () => go() }, icon('download'), 'Nu installeren');
  const later = h('button', { class: 'btn', onclick: () => { upd.snoozeUntil = Date.now() + 3600e3; plog('info', `update ${s.latest} een uur uitgesteld`); closeUpdatePopup(); } }, icon('clock'), 'Over 1 uur');
  updateShell('ready', [
    upLogo(),
    h('div', { class: 'up-eyebrow' }, 'NIEUWE VERSIE'),
    h('h2', { class: 'up-title' }, 'P-ALV Dashboard ', h('span', {}, s.latest)),
    h('div', { class: 'up-versions' }, h('span', {}, 'v' + s.current), h('i', { class: 'up-arrow' }), h('span', { class: 'new' }, 'v' + s.latest)),
    notesList(s.notes),
    h('div', { class: 'up-foot' }, ring, status, h('div', { class: 'up-actions' }, later, now)),
  ]);
  const go = () => {
    clearInterval(upd.countdown);
    upd.countdown = null;
    flushSave();
    ring.classList.add('done');
    num.textContent = '';
    status.textContent = 'Installeren… het dashboard sluit en start zo opnieuw.';
    now.disabled = later.disabled = true;
    upd.popup.querySelector('.up-card').classList.add('installing');
    setTimeout(() => window.palv.update.install(), 900);
  };
  upd.countdown = setInterval(() => {
    // Someone working on the layout or in a dialog: the countdown waits for them.
    if (editing || modalOpen()) { status.textContent = 'Wacht tot je klaar bent met bewerken…'; return; }
    left -= 1;
    num.textContent = Math.max(0, left);
    ring.style.setProperty('--p', ((COUNTDOWN_S - left) / COUNTDOWN_S) * 100);
    status.textContent = 'Het dashboard wordt automatisch bijgewerkt en start daarna vanzelf opnieuw.';
    if (left <= 0) go();
  }, 1000);
}

// After a restart on the new version: what changed, for a little while.
function showUpdated(info) {
  const close = h('button', { class: 'btn primary', onclick: () => closeUpdatePopup() }, 'Sluiten');
  updateShell('done', [
    h('div', { class: 'up-check' }, h('span', { html: '<svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="23"/><path d="M15 27.5 22.5 35 37.5 19"/></svg>' })),
    h('div', { class: 'up-eyebrow' }, 'BIJGEWERKT'),
    h('h2', { class: 'up-title' }, 'Nu op versie ', h('span', {}, info.to)),
    info.from ? h('div', { class: 'up-versions' }, h('span', {}, 'v' + info.from), h('i', { class: 'up-arrow' }), h('span', { class: 'new' }, 'v' + info.to)) : null,
    notesList(info.notes),
    h('div', { class: 'up-foot' }, h('p', { class: 'up-status' }, 'Dit venster sluit vanzelf.'), h('div', { class: 'up-actions' }, close)),
  ]);
  setTimeout(() => { if (upd.popup && upd.popup.querySelector('.up-card.done')) closeUpdatePopup(); }, 30000);
}

function onUpdateStatus(s) {
  const prev = upd.st;
  upd.st = s;
  if (!prev || prev.state !== s.state || s.state === 'downloading') renderTitlebar();
  if (s.state === 'ready') showUpdateReady(false);
  const pane = document.querySelector('.sys-update');
  if (pane && pane.paint) pane.paint();
}

/* ============================================================
   Schermoverzicht
   ============================================================ */
const screensState = { list: [] };

// Running, running with something to look at, or not running.
function judgeScreen(s) {
  if (!s.online) return { level: 'bad', label: 'NIET ACTIEF', issues: [`Niet bereikbaar${s.error ? ` (${s.error})` : ''} · laatst gezien ${s.lastSeen ? ageText(Date.now() - s.lastSeen) + ' geleden' : 'nooit'}`] };
  const w = [];
  if (!s.renderer || !s.renderer.alive) w.push('Dashboard reageert niet');
  if (s.window && !s.window.visible) w.push('Venster verborgen');
  if (s.window && s.window.minimized) w.push('Venster geminimaliseerd');
  if (s.displays === 0) w.push('Geen beeldscherm aangesloten');
  if (s.locked) w.push('Computer vergrendeld');
  if (s.health && s.health.length) w.push('Geen verse gegevens: ' + s.health.join(', '));
  if (s.lock === 'anders') w.push('Andere eenheidssleutel: koppel dit scherm met de koppelcode');
  if (s.lock === 'fout') w.push(`Beveiligde verbinding mislukt (poort ${(+s.port || 47800) + 1} niet bereikbaar?)`);
  return w.length ? { level: 'warn', label: 'DRAAIT · LET OP', issues: w } : { level: 'ok', label: 'DRAAIT', issues: [] };
}

function screensButton() {
  const list = screensState.list;
  if (list.length < 2) return null;
  const counts = list.map(judgeScreen);
  const up = counts.filter((c) => c.level !== 'bad').length;
  const level = counts.some((c) => c.level === 'bad') ? 'bad' : counts.some((c) => c.level === 'warn') ? 'warn' : 'ok';
  return h('button', { class: 'tb-btn tb-screens ' + level, title: 'Schermoverzicht: welke dashboards draaien', onclick: openScreens }, h('i', { class: 'fr-dot' }), icon('screens'), `${up}/${list.length}`);
}

const LOCK_TEXT = {
  ok: 'Beveiligd met de eenheidssleutel',
  oud: 'Oudere versie, nog niet beveiligd',
  wacht: 'Wacht op de eenheidssleutel',
  geen: 'Dit scherm wacht nog op de sleutel',
  anders: 'Andere eenheidssleutel',
  fout: 'Beveiligde verbinding mislukt',
};

// The unit key: every dashboard of the unit holds the same one; everything between them is encrypted with it.
function unitKeyPane() {
  const box = h('div', { class: 'sc-key' });
  const code = textInput('', { placeholder: 'XXXX-XXXX-XXXX-…', spellcheck: 'false', autocomplete: 'off' });
  const head = h('div', { class: 'sc-key-head' });
  // Repainted with every round of the overview; the rest stays, so typing a code is never interrupted.
  const paintHead = () => {
    const a = (screensState.list.find((s) => s.self) || {}).auth || {};
    head.replaceChildren(h('span', { class: 'sc-key-icon ' + (a.fp ? 'ok' : 'wait') }, icon('shield')),
      h('div', {}, h('b', {}, a.fp ? 'Eenheidssleutel actief' : 'Nog geen eenheidssleutel'),
        h('small', {}, a.fp ? `Vingerafdruk ${a.fp.toUpperCase().match(/.{1,4}/g).join('-')} · al het verkeer tussen de dashboards is versleuteld` : 'Wordt vanzelf gemaakt of opgehaald bij een scherm van de eenheid')));
  };
  const paint = () => {
    paintHead();
    const shown = h('div', { class: 'sc-code', hidden: true });
    const show = h('button', { class: 'btn', onclick: async () => {
      if (!shown.hidden) { shown.hidden = true; show.lastChild.textContent = 'Koppelcode tonen'; return; }
      const c = await window.palv.screens.pairCode();
      if (!c) return toast('Dit scherm heeft nog geen eenheidssleutel', true);
      shown.replaceChildren(h('code', {}, c), h('button', { class: 'btn', onclick: async () => { try { await navigator.clipboard.writeText(c); toast('Koppelcode gekopieerd'); } catch { toast('Kopiëren lukte niet; selecteer de code', true); } } }, 'Kopiëren'));
      shown.hidden = false;
      show.lastChild.textContent = 'Koppelcode verbergen';
    } }, icon('shield'), h('span', {}, 'Koppelcode tonen'));
    const pairNow = async () => {
      try {
        await window.palv.screens.pair(code.value);
        code.value = '';
        toast('Gekoppeld: dit scherm gebruikt nu de eenheidssleutel');
        setTimeout(async () => { screensState.list = (await window.palv.screens.info()).list; paintScreens(); }, 1500);
      } catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
    };
    code.onkeydown = (e) => e.key === 'Enter' && pairNow();
    box.replaceChildren(
      head,
      h('p', { class: 'sc-intro' }, 'Schermen van de eenheid krijgen de sleutel vanzelf. Een nieuw scherm koppel je één keer: toon hier de koppelcode en voer die in op het nieuwe scherm. De code is geheim: wie hem heeft, hoort bij de eenheid.'),
      h('div', { class: 'row' },
        field('Koppelcode invoeren', code, 'De koppelcode van een ander scherm van de eenheid.'),
        h('div', { class: 'field', style: 'flex:0 0 auto;align-self:flex-start;margin-top:1.45rem' }, h('button', { class: 'btn primary', onclick: pairNow }, 'Koppelen'))),
      h('div', {}, show),
      shown);
  };
  box.paint = paintHead;
  paint();
  return box;
}

function screenCard(s) {
  const j = judgeScreen(s);
  const row = (k, v) => (v == null || v === '' ? null : h('div', {}, h('span', {}, k), h('b', {}, v)));
  return h('div', { class: 'sc-card ' + j.level },
    h('div', { class: 'sc-top' },
      h('span', { class: 'sc-pulse' }),
      h('div', { class: 'sc-name' }, h('b', {}, s.name || s.address), h('small', {}, s.self ? 'Dit scherm' : `${s.address}:${s.port}`)),
      h('span', { class: 'sc-badge' }, j.label)),
    h('div', { class: 'sc-grid' },
      row('Versie', s.version ? 'v' + s.version + (s.update && s.update.latest && s.update.latest !== s.version && s.update.state !== 'current' ? ` → v${s.update.latest}` : '') : null),
      row('Systeem', s.platform ? `${s.platform}${s.hostname ? ' · ' + s.hostname : ''}` : null),
      s.online ? row('Draait sinds', s.startedAt ? ageText(s.now - s.startedAt) : null) : row('Laatst gezien', s.lastSeen ? ageText(Date.now() - s.lastSeen) + ' geleden' : 'nooit'),
      s.online && s.window ? row('Venster', (s.window.fullscreen ? 'Volledig scherm' : s.window.minimized ? 'Geminimaliseerd' : 'Venster') + (s.page ? ` · ${s.page}` : '')) : null,
      s.online && s.displays != null ? row('Beeldschermen', `${s.displays}${s.displayList && s.displayList.length ? ' · ' + s.displayList.join(', ') : ''}`) : null,
      s.online && s.renderer ? row('Hartslag', s.renderer.heartbeat ? ageText(s.now - s.renderer.heartbeat) + ' geleden' : '—') : null,
      s.online && s.awake != null ? row('Slaapstand', s.awake ? 'Geblokkeerd (scherm blijft aan)' : 'Toegestaan') : null,
      s.online && s.lock ? row('Verbinding', LOCK_TEXT[s.lock] || s.lock) : null),
    j.issues.length ? h('div', { class: 'sc-issues' }, j.issues.map((i) => h('div', {}, icon('alert'), i))) : null,
    !s.self ? h('button', { class: 'w-tool sc-remove', title: 'Uit de lijst verwijderen', onclick: async () => { screensState.list = await window.palv.screens.remove(s.id || `${s.address}:${s.port}`); paintScreens(); } }, icon('trash')) : null);
}

function paintScreens() {
  renderTitlebar();
  const root = document.querySelector('.sc-list');
  if (root) root.replaceChildren(...screensState.list.map(screenCard));
  const key = document.querySelector('.sc-key');
  if (key && key.paint) key.paint();
}

async function openScreens() {
  const info = await window.palv.screens.info();
  screensState.list = info.list;
  const name = textInput(info.name, { maxlength: 40 });
  const addr = textInput('', { placeholder: 'bijv. 100.101.102.103 of mac-mini.local' });
  const add = async () => {
    try { screensState.list = await window.palv.screens.add(addr.value); addr.value = ''; paintScreens(); toast('Scherm toegevoegd; het wordt nu gezocht'); } catch (err) { toast(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true); }
  };
  addr.addEventListener('keydown', (e) => e.key === 'Enter' && add());
  const urls = info.addresses.map((a) => `http://${a}:${info.port}/`);
  openModal({
    title: 'Schermoverzicht',
    wide: true,
    cls: 'screens-modal',
    body: [
      h('p', { class: 'sc-intro' }, 'Alle P-ALV Dashboards die elkaar kunnen bereiken, met of ze draaien. Schermen op hetzelfde netwerk vinden elkaar vanzelf; een scherm via Tailscale of elders voeg je één keer toe met zijn adres. Elke 10 seconden bijgewerkt.'),
      h('div', { class: 'sc-list' }, screensState.list.map(screenCard)),
      h('hr'),
      h('div', { class: 'row' },
        field('Naam van dit scherm', name, 'Zo heet dit scherm bij de andere dashboards.'),
        h('div', { class: 'field', style: 'flex:0 0 auto;align-self:flex-start;margin-top:1.45rem' }, h('button', { class: 'btn', onclick: async () => { await window.palv.screens.rename(name.value); toast('Naam opgeslagen'); } }, 'Naam opslaan'))),
      h('div', { class: 'row' },
        field('Scherm toevoegen via adres', addr, 'IP-adres of naam, eventueel met :poort (standaard 47800).'),
        h('div', { class: 'field', style: 'flex:0 0 auto;align-self:flex-start;margin-top:1.45rem' }, h('button', { class: 'btn primary', onclick: add }, icon('plus'), 'Toevoegen'))),
      h('hr'),
      unitKeyPane(),
      h('div', { class: 'hint' }, 'Statuspagina voor een browser (ook op een telefoon in hetzelfde netwerk of via Tailscale): ',
        ...urls.flatMap((u, i) => [i ? ' · ' : '', h('a', { href: '#', onclick: (e) => { e.preventDefault(); window.palv.app.openExternal(u); } }, u)])),
    ],
  });
}

/* ---------- heartbeat and status for the screens overview ---------- */
function sendStatus() {
  const page = state && state.pages[state.activePage];
  window.palv.status.report({
    page: page ? page.name : null,
    editing,
    theme: document.documentElement.dataset.theme,
    health: dueSources().map((e) => e.label),
    emergencies: emergency.watch.active({ firOnly: true }).map((e) => `${e.code} ${emName(e.a)}`),
  });
}
