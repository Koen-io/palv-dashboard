'use strict';

/* ============================================================
   Kop van het dashboard: menubalk, thema, paginatabs, klokken, UDP, maan en Schiphol.
   ============================================================ */

/* ---------- theme (licht / donker / automatisch) ---------- */
function resolveTheme() {
  const s = state.settings;
  if (s.theme !== 'auto') return s.theme;
  const now = new Date();
  if (s.autoMode === 'times') {
    const mins = now.getHours() * 60 + now.getMinutes();
    const toMin = (t) => { const [a, b] = String(t).split(':').map(Number); return (a || 0) * 60 + (b || 0); };
    const from = toMin(s.lightFrom), to = toMin(s.darkFrom);
    return from <= to ? (mins >= from && mins < to ? 'light' : 'dark') : (mins >= to && mins < from ? 'dark' : 'light');
  }
  const { rise, set } = ASTRO.sunTimes(now, 52.31, 4.76);
  return now >= rise && now < set ? 'light' : 'dark';
}

let fadeTimer = null;
function applyTheme(animate) {
  const root = document.documentElement;
  const next = resolveTheme();
  if (root.dataset.theme === next) return;
  if (animate) {
    root.classList.add('theme-fade');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 1700);
  }
  root.dataset.theme = next;
}

function applyScale() {
  // Follows the tighter of height and width, so the header also fits in a narrow window.
  const px = clamp(Math.min(window.innerHeight / 1080, window.innerWidth / 1920) * 16 * (state.settings.uiScale || 1), 8, 40);
  document.documentElement.style.fontSize = px.toFixed(2) + 'px';
}

/* ---------- title bar ---------- */
const THEME_META = { auto: { icon: 'auto', label: 'Auto' }, light: { icon: 'sun', label: 'Licht' }, dark: { icon: 'moon', label: 'Donker' } };

function renderTitlebar() {
  const actions = $('#tb-actions');
  actions.replaceChildren(...[
    screensButton(),
    updateButton(),
    h('button', { class: 'tb-btn' + (editing ? ' on' : ''), title: `Indeling bewerken (${MOD}E)`, onclick: () => setEditing(!editing) }, icon('edit'), editing ? 'Gereed' : 'Bewerken'),
    h('button', { class: 'tb-btn', title: 'Widget of app-tegel toevoegen', onclick: openAddWidget }, icon('plus'), 'Toevoegen'),
    h('button', { class: 'tb-btn', title: 'Thema wisselen: automatisch / licht / donker', onclick: cycleTheme }, icon(THEME_META[state.settings.theme].icon), THEME_META[state.settings.theme].label),
    muteButton(),
    oskButton(),
    h('button', { class: 'tb-btn', title: 'Instellingen', onclick: () => openSettings() }, icon('gear'), 'Instellingen'),
    h('button', { class: 'tb-btn', title: `Volledig scherm zonder randen en menubalk (${FS_KEY})`, onclick: () => window.palv.win.setFullscreen(!winState.fullscreen) }, icon(winState.fullscreen ? 'shrink' : 'expand'), winState.fullscreen ? 'Venster' : 'Volledig scherm'),
  ].filter(Boolean));
  $('#tb-window').replaceChildren(
    h('button', { class: 'tb-win', title: 'Minimaliseren', onclick: () => window.palv.win.minimize() }, icon('min')),
    h('button', { class: 'tb-win', title: winState.maximized || winState.fullscreen ? 'Verkleinen' : 'Maximaliseren', onclick: () => window.palv.win.toggleMaximize() }, icon(winState.maximized || winState.fullscreen ? 'restore' : 'max')),
    h('button', { class: 'tb-win close', title: 'Afsluiten', onclick: () => window.palv.win.close() }, icon('close'))
  );
}

/* ---------- de pc vergrendelen ---------- */
// The lock beside the name in the header (always in sight, also full screen): one click when you walk away.
// With a Schermslot code set it draws a Windows-style lock screen over the work monitor while the dashboard
// keeps running on the second screen; with two monitors absent, or no code yet, it falls back to Windows+L or
// opens the settings. Only on Windows; on the Mac it is not shown.
let screenLockBound = false;
function renderLockButton() {
  const btn = $('#hd-lock');
  if (!btn || window.palv.platform !== 'win32') return;
  if (!screenLockBound) {
    screenLockBound = true;
    window.palv.screenLock.onState(() => { /* state changes are reflected on the next render */ });
  }
  btn.title = 'Scherm vergrendelen: een vergrendelscherm over het werkscherm, met een eigen toegangscode. Het dashboard blijft op het tweede scherm doorlopen. Zonder tweede scherm vergrendelt het Windows zelf (Windows+L). Code instellen onder Instellingen › Scherm › Schermslot.';
  btn.setAttribute('aria-label', 'Scherm vergrendelen');
  const idle = () => { btn.classList.remove('locking'); btn.disabled = false; btn.replaceChildren(icon('unlock')); };
  btn.onclick = async () => {
    if (btn.disabled) return;
    const st = await window.palv.screenLock.status().catch(() => null);
    if (!st || !st.hasPin) {
      toast('Stel eerst een toegangscode in onder Instellingen › Scherm › Schermslot.', true);
      openSettings('scherm');
      return;
    }
    btn.disabled = true;
    btn.classList.add('locking');
    btn.replaceChildren(icon('lock'));
    await new Promise((r) => setTimeout(r, 280));
    const res = await window.palv.screenLock.lock().catch((e) => ({ ok: false, reason: String(e && e.message) }));
    if (res && res.ok) { idle(); return; }
    // Geen tweede scherm om het dashboard op te laten staan: dan vergrendelt Windows zelf.
    if (res && res.reason === 'single-screen') {
      const w = await window.palv.app.lockScreen().catch(() => ({ ok: false }));
      if (!w || !w.ok) toast('Vergrendelen lukte niet. Gebruik Windows+L.', true);
    } else {
      toast('Vergrendelen lukte niet.', true);
    }
    idle();
  };
  idle();
  btn.hidden = false;
}

/* ---------- dempen ---------- */
// One switch for every sound of this screen: the emergency chime, the briefing sound and the embedded pages.
// The pop-ups, the glow and the red alert bar stay; only the sound goes. Kept with the other settings.
const isMuted = () => !!(state && state.settings.muted);
function muteButton() {
  const m = isMuted();
  return h('button', {
    class: 'tb-btn tb-mute' + (m ? ' muted' : ''), 'aria-pressed': String(m), onclick: () => setMuted(!m),
    title: m ? 'Gedempt: het dashboard maakt geen geluid. Tik om het geluid weer aan te zetten.' : 'Alle geluiden van dit dashboard dempen: noodsquawk, briefing en ingesloten pagina\'s. Meldingen blijven zichtbaar.',
  }, icon(m ? 'volumeOff' : 'volume'), m ? 'Gedempt' : 'Geluid');
}
function setMuted(on, quiet) {
  state.settings.muted = !!on;
  applyMuted();
  renderTitlebar();
  save();
  plog('info', on ? 'geluid gedempt' : 'geluid weer aan');
  if (!quiet) toast(on ? 'Gedempt — meldingen blijven zichtbaar, maar zonder geluid' : 'Geluid staat weer aan');
}
function applyMuted() {
  const m = isMuted();
  window.palv.app.setMuted(m).catch(() => {});
  if (m && brief.audio) brief.audio.pause();
  const flag = $('#mute-flag');
  if (flag && !flag.firstChild) flag.append(icon('volumeOff'), 'GEDEMPT');
  if (flag) flag.hidden = !m;
}
// The test buttons in the settings say why they stay silent rather than seeming broken.
function soundTest(play) {
  if (isMuted()) toast('Het dashboard is gedempt. Zet het geluid aan met de knop in de menubalk om te testen.', true);
  else play();
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % 3];
  applyTheme(true);
  renderTitlebar();
  save();
}

/* ---------- page tabs ---------- */
function renderTabs() {
  const nav = $('#page-tabs');
  nav.replaceChildren();
  state.pages.forEach((p, i) => {
    const active = i === state.activePage;
    nav.append(
      h(
        'button',
        {
          class: 'tab' + (active ? ' active' : ''), role: 'tab', 'aria-selected': String(active), 'data-i': i,
          title: editing ? `${p.name}: slepen om te verplaatsen` : i < 9 ? `${p.name} (${MOD}${i + 1})` : p.name,
          onclick: () => { if (tabDrag.justDropped) return; setPage(i); }, ondblclick: () => renamePage(i),
          onpointerdown: (e) => tabDragStart(e, i),
        },
        h('span', { class: 'tab-grip', 'aria-hidden': 'true' }, icon('grip')),
        // A page that is one tool (the Browser) carries its icon before the name.
        (() => { const ic = p.widgets.length === 1 && WIDGETS[p.widgets[0].type] && WIDGETS[p.widgets[0].type].tabIcon; return ic ? icon(ic, 'tab-ic') : null; })(),
        p.name,
        // A page with the Timings tab shows the nearest running timer in its tab; nothing when none runs.
        typeof timingsTabBadge === 'function' ? timingsTabBadge(p) : null,
        h('span', { class: 'tab-tool', title: 'Naam wijzigen', onclick: (e) => { e.stopPropagation(); renamePage(i); } }, icon('edit')),
        state.pages.length > 1 ? h('span', { class: 'tab-tool danger', title: 'Pagina verwijderen', onclick: (e) => { e.stopPropagation(); deletePage(i); } }, icon('close')) : null
      )
    );
  });
  nav.append(h('button', { class: 'tab tab-add', title: 'Pagina toevoegen', 'aria-label': 'Pagina toevoegen', onclick: addPage }, icon('plus')));
}

// In the edit mode the tabs can be dragged into another order, with the mouse or a finger. The others
// make room as the tab passes them; on release the order is saved in this screen's own layout.
const tabDrag = { justDropped: false };
function tabDragStart(e, from) {
  if (!editing || e.button !== 0 || e.target.closest('.tab-tool')) return;
  const tab = e.currentTarget;
  const nav = $('#page-tabs');
  const tabs = [...nav.querySelectorAll('.tab:not(.tab-add)')];
  const x0 = e.clientX;
  let started = false, to = from, rects = null, width = 0;
  const move = (ev) => {
    const dx = ev.clientX - x0;
    if (!started) {
      if (Math.abs(dx) < 6) return;
      started = true;
      rects = tabs.map((t) => t.getBoundingClientRect());
      const gap = tabs.length > 1 ? Math.max(0, rects[Math.min(1, tabs.length - 1)].left - rects[0].right) : 0;
      width = rects[from].width + gap;
      nav.classList.add('tab-sorting');
      tab.classList.add('tab-dragging');
      try { tab.setPointerCapture(ev.pointerId); } catch { /* already gone */ }
    }
    // Kept within the row of tabs.
    const lo = rects[0].left - rects[from].left, hi = rects[rects.length - 1].right - rects[from].right;
    const d = clamp(dx, lo, hi);
    tab.style.transform = `translateX(${d}px)`;
    const mid = rects[from].left + rects[from].width / 2 + d;
    to = from;
    rects.forEach((r, j) => {
      const c = r.left + r.width / 2;
      if (j < from && mid < c) to = Math.min(to, j);
      if (j > from && mid > c) to = Math.max(to, j);
    });
    tabs.forEach((t, j) => {
      if (j === from) return;
      const shift = from < to && j > from && j <= to ? -width : from > to && j < from && j >= to ? width : 0;
      t.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  };
  const end = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    if (!started) return;
    // The click that follows the release is not a page change.
    tabDrag.justDropped = true;
    setTimeout(() => { tabDrag.justDropped = false; }, 0);
    nav.classList.remove('tab-sorting');
    if (to !== from) {
      const activeId = state.pages[state.activePage].id;
      const [p] = state.pages.splice(from, 1);
      state.pages.splice(to, 0, p);
      state.activePage = state.pages.findIndex((x) => x.id === activeId);
      plog('info', `tabblad "${p.name}" verplaatst naar plek ${to + 1}`);
      save();
    }
    renderTabs();
    const moved = $('#page-tabs').querySelector(`.tab[data-i="${to}"]`);
    if (moved) { moved.classList.add('tab-dropped'); setTimeout(() => moved.classList.remove('tab-dropped'), 450); }
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function pageNameDialog(title, value, onOk) {
  const input = textInput(value, { maxlength: 28, placeholder: 'Naam van de pagina' });
  const ok = (close) => {
    const name = input.value.trim();
    if (!name) return false;
    onOk(name);
    if (close) close();
  };
  const close = openModal({ title, body: field('Naam', input), actions: [{ label: 'Annuleren' }, { label: 'Opslaan', primary: true, onClick: () => ok() }] });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && ok(close));
  input.select();
}

function addPage() {
  pageNameDialog('Nieuwe pagina', '', (name) => {
    state.pages.push({ id: uid(), name, widgets: [] });
    setPage(state.pages.length - 1);
    setEditing(true);
    save();
  });
}
function renamePage(i) {
  pageNameDialog('Pagina hernoemen', state.pages[i].name, (name) => {
    state.pages[i].name = name;
    renderTabs();
    save();
  });
}
function deletePage(i) {
  const p = state.pages[i];
  confirmDialog('Pagina verwijderen', `Weet je zeker dat je de pagina "${p.name}" met alle widgets wilt verwijderen?`, 'Verwijderen', () => {
    for (const w of p.widgets) destroyWidget(w.id);
    const el = pageEls.get(p.id);
    if (el) el.remove();
    pageEls.delete(p.id);
    state.pages.splice(i, 1);
    setPage(clamp(state.activePage > i ? state.activePage - 1 : state.activePage, 0, state.pages.length - 1));
    save();
  });
}

/* ---------- clocks ---------- */
let clockParts = [];
function renderClocks() {
  const root = $('#clocks');
  root.replaceChildren();
  clockParts = state.settings.clocks.map((c, i) => {
    const hm = document.createTextNode('--:--');
    const sec = h('span', { class: 'sec' });
    const date = h('span', { class: 'clock-date' });
    let timeFmt, dateFmt;
    try {
      timeFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: c.tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      dateFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: c.tz, weekday: 'short', day: '2-digit', month: 'short' });
    } catch {
      timeFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
      dateFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short' });
    }
    root.append(
      h(
        'div',
        { class: 'clock' + (i === 1 ? ' utc' : '') },
        h('div', { class: 'clock-top' }, h('span', { class: 'clock-label' }, c.label), date),
        h('div', { class: 'clock-time' }, hm, sec, c.suffix ? h('span', { class: 'sfx' }, c.suffix) : null)
      )
    );
    return { hm, sec, date, timeFmt, dateFmt };
  });
  tickClocks();
}
function tickClocks() {
  const now = new Date();
  for (const c of clockParts) {
    const [hh, mm, ss] = c.timeFmt.format(now).split(':');
    c.hm.nodeValue = `${hh}:${mm}`;
    c.sec.textContent = state.settings.showSeconds ? `:${ss}` : '';
    c.date.textContent = c.dateFmt.format(now).replace(/\./g, '');
  }
}

/* ---------- UDP (uniforme daglichtperiode) ---------- */
const udpToday = (now = Date.now()) => ASTRO.udpToday(now, window.SUN_TABLE);

// One time in the UDP and moon strips: icon, local time, and the same in Zulu.
const stripTime = (ic, t, title) => h('span', { class: 'udp-t', title: title || null }, ic, h('b', {}, t ? ltFmt.format(t) : '--:--'), h('small', {}, 'LT'), h('span', {}, t ? zulu(t) : ''));

function renderUdp() {
  const now = Date.now(), u = udpToday(now);
  const root = $('#udp');
  root.title = 'Uniforme daglichtperiode van vandaag: van 15 minuten vóór zonsopkomst tot 15 minuten na zonsondergang (52°N 005°E). Het weerradarprofiel schakelt op deze tijden automatisch tussen dag en nacht.\n'
    + (u.official ? `Bron: KNMI-tabel zonopkomst en -ondergang ${u.year}.` : `Berekend: voor ${u.year} is geen KNMI-tabel aanwezig. De berekening kan één minuut afwijken van de officiële tabel.`);
  root.replaceChildren(
    h('span', { class: 'udp-label' }, 'UDP', u.official ? null : h('span', { class: 'udp-calc' }, 'BEREKEND ±1 MIN')),
    stripTime(icon('sun'), u.begin),
    h('div', { class: 'udp-track' + (u.day ? ' day' : '') }, h('i', { style: `width:${(clamp((now - u.begin) / (u.end - u.begin), 0, 1) * 100).toFixed(1)}%` })),
    stripTime(icon('moon'), u.end),
    h('span', { class: 'udp-badge ' + (u.day ? 'day' : 'night') }, u.day ? 'DAG' : 'NACHT')
  );
  fitStrip(root, 3);
  notePeriod(now);
}

/* ---------- moon: phase, rise and set, light on the ground ---------- */
// The disc as it looks in the sky now: the lit part from the phase, turned so that the bright side
// faces where it faces above the horizon. Drawn on a radius of 1.
function moonSvg(m, cls) {
  const f = m.fraction;
  const rx = Math.abs(1 - 2 * f).toFixed(4);
  const lit = f < 0.003 ? '' : f > 0.997
    ? '<circle r="1" class="mo-lit"/>'
    : `<path class="mo-lit" d="M0,-1 A1,1 0 0 1 0,1 A${rx},1 0 0 ${f > 0.5 ? 1 : 0} 0,-1 Z"/>`;
  // Drawing has the lit side to the right (90° clockwise from up); the bright limb angle runs
  // counter-clockwise from up, so the drawing is turned by -(angle + 90°).
  const rot = (-(m.limbAngle + 90)).toFixed(1);
  return h('span', { class: cls || 'mo-disc', html: `<svg viewBox="-1.25 -1.25 2.5 2.5" aria-hidden="true"><defs><radialGradient id="mo-g" cx="-0.25" cy="-0.3" r="1.35" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fffbea"/><stop offset="0.65" stop-color="#e9e2c8"/><stop offset="1" stop-color="#bdb59b"/></radialGradient></defs><circle r="1.16" class="mo-halo" opacity="${(0.15 + 0.5 * f).toFixed(2)}"/><circle r="1" class="mo-dark"/><g transform="rotate(${rot})">${lit}</g><circle r="1" class="mo-rim"/></svg>` });
}

// Light level on a logarithmic scale from 0.1 mlx (overcast starlight) to 100 klx (bright sun).
const luxLevel = (lux) => clamp((Math.log10(Math.max(lux, 1e-4)) + 4) / 9, 0, 1);
const luxBand = (lux) => (lux >= 400 ? 'day' : lux >= 3 ? 'dusk' : lux >= 0.05 ? 'moonlit' : lux >= 0.003 ? 'dim' : 'dark');
const LUX_WORD = { day: 'Daglicht', dusk: 'Schemering', moonlit: 'Maanlicht', dim: 'Weinig licht', dark: 'Zeer donker' };

let moonCache = { at: 0, pass: null, full: null, nw: null };
function renderMoon() {
  const now = Date.now();
  // Rise and set, and the next full and new moon, change slowly: computed every 10 minutes.
  if (!moonCache.pass || now - moonCache.at > 10 * 60000 || (moonCache.pass.set && now > moonCache.pass.set) || (moonCache.pass.rise && !moonCache.pass.up && now > moonCache.pass.rise)) {
    moonCache = { at: now, pass: ASTRO.moonPass(now), full: ASTRO.nextPhase(180, now), nw: ASTRO.nextPhase(0, now) };
  }
  const m = ASTRO.moon(now), L = ASTRO.light(now), p = moonCache.pass;
  const lux = ASTRO.formatLux(L.lux), band = luxBand(L.lux);
  const pct = Math.round(m.fraction * 100);
  const day = (t) => (t ? ltDateFmt.format(t).replace(/\./g, '') : '—');
  const up = m.alt >= 0;
  const az = Math.round(m.az) % 360, alt = m.alt;
  const azTxt = az.toString().padStart(3, '0');
  const altTxt = `${alt >= 0 ? '+' : '−'}${Math.abs(alt).toFixed(1).replace('.', ',')}°`;
  const root = $('#moon');
  root.classList.toggle('up', up);
  // One strip: phase and lit part, where it stands (azimuth and elevation), the light on the ground. Rise
  // and set, the next full and new moon and the sums behind the light level are in the tooltip.
  root.title = `Maan: ${m.phaseName.toLowerCase()}, ${pct} % verlicht (${ltFmt.format(now)} LT, gezien vanaf 52°N 005°E).
`
    + `Azimut ${azTxt}° ten opzichte van het ware noorden: de maan staat in het ${windName(m.az)}. Elevatie ${altTxt} (schijnbaar, met refractie; negatief is onder de horizon).
`
    + `${p.up ? 'Op sinds' : 'Komt op'} ${p.rise ? ltFmt.format(p.rise) + ' LT (' + zulu(p.rise) + ')' : '—'}, ${p.up ? 'gaat onder' : 'daarna onder'} ${p.set ? ltFmt.format(p.set) + ' LT (' + zulu(p.set) + ')' : '—'}.
`
    + `Volgende volle maan: ${day(moonCache.full)}${moonCache.full ? ' ' + ltFmt.format(moonCache.full) : ''} · nieuwe maan: ${day(moonCache.nw)}${moonCache.nw ? ' ' + ltFmt.format(moonCache.nw) : ''}.

`
    + `Verlichtingssterkte op de grond, geschat voor een onbewolkte hemel zonder lichtvervuiling: ${lux.value} ${lux.unit} (${LUX_WORD[band].toLowerCase()}).
`
    + `Zon ${L.sunAlt.toFixed(1)}° → ${ASTRO.formatLux(L.sky).value} ${ASTRO.formatLux(L.sky).unit} · maan → ${L.moon > 0 ? ASTRO.formatLux(L.moon).value + ' ' + ASTRO.formatLux(L.moon).unit : 'onder de horizon'}.
`
    + 'Bewolking en stadslicht kunnen de werkelijke waarde sterk veranderen. Maanstand berekend met de maantheorie van Meeus (azimut op 0,1°, elevatie op 0,2° nauwkeurig).';
  root.replaceChildren(
    h('span', { class: 'udp-label' }, 'MAAN'),
    h('span', { class: 'mo-phase' }, moonSvg(m), h('span', { class: 'mo-pct' }, h('span', { class: 'mo-num' }, h('b', {}, pct), h('small', {}, '%')), h('em', {}, m.phaseName))),
    h('span', { class: 'mp-sep' }),
    compassSvg(m.az),
    h('span', { class: 'mp-val', title: 'Azimut: richting van de maan ten opzichte van het ware noorden' }, h('small', {}, 'AZ'), h('b', {}, `${azTxt}°`), h('em', {}, windName(m.az))),
    h('span', { class: 'mp-val', title: 'Elevatie: hoogte van de maan boven de horizon' }, h('small', {}, 'ELEV'), h('span', { class: 'mp-arr', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 20h18"/><path d="M3 20A12 12 0 0 1 21 20" stroke-dasharray="2.5 2.2"/><path d="M12 20L${(12 + 9 * Math.cos((Math.PI * (180 - clamp(alt, -10, 90))) / 180)).toFixed(1)} ${(20 - 9 * Math.sin((Math.PI * Math.max(alt, 2)) / 180)).toFixed(1)}"/></svg>` }), h('b', {}, altTxt)),
    h('span', { class: 'mo-gap' }),
    h('span', { class: 'lux ' + band, title: `Licht op de grond: ${LUX_WORD[band].toLowerCase()}` },
      h('span', { class: 'lux-meter' }, h('i', { style: `width:${(luxLevel(L.lux) * 100).toFixed(1)}%` })),
      h('b', {}, lux.value), h('small', {}, lux.unit)),
    h('span', { class: 'udp-badge ' + (up ? 'day' : 'night'), title: up ? 'De maan staat boven de horizon' : 'De maan staat onder de horizon' },
      h('span', { class: 'b-long' }, up ? 'BOVEN HORIZON' : 'ONDER HORIZON'), h('span', { class: 'b-short' }, up ? 'BOVEN' : 'ONDER'))
  );
  fitStrip(root, 8);
}

// Takes parts out of a header strip, least important first (the .fit-N classes in system.css), until
// its content fits its width. Again after every redraw and whenever the strip changes size.
const fitWatch = new ResizeObserver((entries) => { for (const e of entries) fitStrip(e.target, +e.target.dataset.fitMax); });
function fitStrip(el, max) {
  if (el.dataset.fitMax !== String(max)) { el.dataset.fitMax = max; fitWatch.observe(el); }
  let n = 0;
  const set = () => { for (let i = 1; i <= max; i += 1) el.classList.toggle('fit-' + i, i <= n); };
  set();
  while (n < max && el.scrollWidth > el.clientWidth + 1) { n += 1; set(); }
}

/* ---------- moon position: azimuth and elevation, for 52°N 005°E ---------- */
const WINDS16 = ['N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO', 'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'];
const windName = (az) => WINDS16[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
// A small compass rose with the needle on the moon's azimuth: where along the horizon to look.
const compassSvg = (az) => h('span', { class: 'mp-rose', html: `<svg viewBox="-12 -12 24 24" aria-hidden="true"><circle r="10.5" class="mp-rose-ring"/><path d="M0-10.5v2.2M0 8.3v2.2M-10.5 0h2.2M8.3 0h2.2" class="mp-rose-ticks"/><text x="0" y="-5.6" class="mp-rose-n">N</text><g transform="rotate(${az.toFixed(1)})"><path d="M0-9.2 2.4 0H-2.4Z" class="mp-rose-needle"/><path d="M0 9.2 2.4 0H-2.4Z" class="mp-rose-tail"/></g><circle r="1.3" class="mp-rose-hub"/></svg>` });

/* ---------- the base: METAR in the header ---------- */
// The METAR is read by WX.parseMetar (wx.js), the same parser that judges the stations on the radar, so
// the header can never tell a different story than the station layer. Earlier observations are kept for
// the observed trend when the METAR carries no trend and there is no TAF.
// `eham` is the station block of the base the dashboard runs from (Schiphol, Volkel or Rotterdam): the name
// stayed from the days it was Schiphol only.
const eham = { metar: null, metarFail: false, fetchedAt: 0, live: null, history: [], period: null, icao: null };
const EHAM_POS = () => { const b = activeBase(); return { name: b.station, lat: b.field.lat, lon: b.field.lon }; };
const HISTORY_KEEP = 3 * 3600e3;

// Day inside the UDP, night outside it: which rows of the BOM table apply right now.
const bomPeriod = (now = Date.now()) => (udpToday(now).day ? 'day' : 'night');
// Whoever shows a BOM verdict repaints when the period flips, without waiting for the next fetch.
const periodWatchers = new Set();
function notePeriod(now) {
  const period = bomPeriod(now);
  if (eham.period === period) return;
  const first = eham.period == null;
  eham.period = period;
  if (first) return;
  if (eham.metar) renderEham();
  for (const fn of periodWatchers) { try { fn(period); } catch { /* one widget must not stop the others */ } }
}

const STATUS_WORD = { green: 'binnen de minima', red: 'buiten de minima' };
function statusWord(a) {
  if (a.status === 'amber') return a.marginal ? 'binnen de minima, maar marginaal (minder marge dan ingesteld onder Instellingen › Weerradar)' : 'binnen de minima, maar volgens de trend binnen 2 uur eronder';
  if (a.status === 'none') return a.stale ? 'geen oordeel: waarneming ouder dan 90 minuten' : 'geen oordeel: zicht of bewolking niet gemeten';
  return STATUS_WORD[a.status];
}

// The verdict of every BOM profile of the current period for one station, as chips: green within the
// minima, orange marginal or expected below within two hours, red outside, grey no verdict. A plus on
// Aided Nacht: outside its minima but inside those of Advanced Operations, AW139 only.
function bomChips(st, now = Date.now()) {
  const period = bomPeriod(now);
  const u = udpToday(now);
  const root = h('span', { class: 'bom', title: `Toetsing aan de BOM-tabel (Deel A §8.2.4.1) voor ${period === 'day' ? 'overdag: binnen de UDP' : '’s nachts: buiten de UDP'} (${ltFmt.format(u.begin)}–${ltFmt.format(u.end)} LT). Schakelt op de UDP-grenzen vanzelf om.\nWolkenbasis volgens het BOM is een laag van 3/8 (SCT) of meer; bij de rijen "geen bewolking (incl. FEW)" telt FEW mee.` },
    h('span', { class: 'bom-label' }, period === 'day' ? 'BOM DAG' : 'BOM NACHT'));
  for (const p of WX.forPeriod(period)) {
    const a = WX.assess(p.id, st, now);
    const tr = a.trend && a.trend.text ? `\nTrend (${a.trend.src}): ${a.trend.text}` : '';
    root.append(h('span', { class: 'bom-chip ' + a.status, title: `${p.name}: ${statusWord(a)}.\nBOM: ${p.rule}.${a.aw139 ? '\nBuiten Aided Nacht, maar binnen Advanced Operations: alleen AW139.' : ''}${tr}` },
      h('i'), p.short, a.aw139 ? h('em', {}, '+') : null));
  }
  return root;
}

// What the cloud box shows: the BOM cloud base (the lowest layer of SCT or more) as the big figure, and
// every reported layer in a line under it. A FEW layer below that base is marked: it is no cloud base by
// note 1, but it does count for Single pilot EC and Advanced Operations.
function cloudSummary(p) {
  const base = WX.lowestLayer(p, false);
  const out = { value: '', unit: null, layers: [], title: 'Wolkenbasis volgens het BOM (note 1): de laagste laag met een bedekking van 3/8 (SCT) of meer. FEW telt niet als wolkenbasis, behalve bij Single pilot EC en Advanced Operations ("geen bewolking incl. FEW").' };
  if (base) { out.value = `${base.cover} ${base.base}`; out.unit = 'ft' + (base.type ? ' ' + base.type : ''); }
  else if (p.vv != null) { out.value = p.vv < 0 ? 'VV' : `VV ${p.vv}`; out.unit = p.vv < 0 ? null : 'ft'; out.title += '\nAlleen een verticaal zicht gemeld: geen wolkenbasis, de bewolking is onbekend.'; }
  else if (p.cloud === 'none' || p.cloud === 'layers') { out.value = 'Geen'; out.title += p.cloud === 'layers' ? '\nAlleen FEW gemeld: volgens het BOM geen wolkenbasis.' : '\nGeen bewolking gemeld (' + (p.cavok ? 'CAVOK' : 'NSC/NCD') + ').'; }
  else { out.value = 'Niet gemeten'; out.title += '\nDe bewolking is niet gemeten (//////).'; }
  for (const l of [...p.layers].sort((a, b) => a.base - b.base)) out.layers.push({ text: `${l.cover} ${l.base}${l.type ? ' ' + l.type : ''}`, few: l.cover === 'FEW' && (!base || l.base < base.base) });
  return out;
}
function layersLine(c) {
  if (!c.layers.length) return null;
  return h('div', { class: 'layers', title: 'Alle gemelde wolkenlagen, laagste eerst. Oranje: een FEW-laag onder de wolkenbasis; die telt bij Single pilot EC en Advanced Operations wél mee ("geen bewolking incl. FEW").' },
    ...c.layers.flatMap((l, i) => [i ? h('span', { class: 'layers-sep' }, '·') : null, h('span', { class: l.few ? 'few' : '' }, l.text)]));
}
// Visibility as the pilots read it: metres up to 5 km, then kilometres with a decimal when not whole,
// so 7500 m never becomes "8 km".
function visText(vis) {
  if (vis >= 9999) return '≥10';
  if (vis >= 5000) return vis % 1000 ? (vis / 1000).toFixed(1).replace('.', ',') : String(vis / 1000);
  return String(vis);
}

// Spread between temperature and dew point, and the relative humidity it means (Magnus). At a spread
// of 3 °C or less the air is close to saturation: mist, fog or low cloud can form, above all when it
// cools down in the evening and at night.
function dewSpread(temp, dew) {
  if (temp == null || dew == null) return null;
  const spread = temp - dew;
  const es = (t) => Math.exp((17.625 * t) / (243.04 + t));
  const rh = clamp(Math.round((100 * es(dew)) / es(temp)), 0, 100);
  const level = spread <= 1 ? 'bad' : spread <= 3 ? 'warn' : 'ok';
  return { spread, rh, level, word: spread <= 1 ? 'MIST/LAGE BEWOLKING' : spread <= 3 ? 'KANS OP MIST' : '' };
}

function metric(label, ...value) {
  return h('div', { class: 'metric' }, h('div', { class: 'metric-label' }, label), h('div', { class: 'metric-value' }, value));
}

// Present weather in words, for the tooltips (the codes stay on screen: that is what the crew reads).
const WX_WORDS = { '+': 'zware', '-': 'lichte', VC: 'in de omgeving', MI: 'dunne', BC: 'banken', PR: 'gedeeltelijk', DR: 'laag opwaaiend', BL: 'opwaaiend', SH: 'buien', TS: 'onweer', FZ: 'onderkoeld', DZ: 'motregen', RA: 'regen', SN: 'sneeuw', SG: 'motsneeuw', PL: 'ijsregen', GR: 'hagel', GS: 'korrelhagel', UP: 'onbekende neerslag', BR: 'nevel', FG: 'mist', FU: 'rook', VA: 'vulkanische as', DU: 'stof', SA: 'zand', HZ: 'heiigheid', PO: 'stofhozen', SQ: 'windstoot', FC: 'windhoos', SS: 'zandstorm', DS: 'stofstorm' };
const wxWords = (code) => (code.match(/^\+|^-|[A-Z]{2}/g) || []).map((k) => WX_WORDS[k] || k).join(' ');

// The metrics of one METAR (wind, visibility with the present weather, the BOM cloud base with every
// layer, temperature with the dew-point spread, QNH), as in the header and in every METAR widget.
function metarMetrics(p, cls) {
  const metrics = h('div', { class: cls });
  if (p.wind) {
    const calm = p.wind.spd === 0;
    const arrow = p.wind.dir === 'VRB' || calm ? null : h('span', { style: `display:flex;transform:rotate(${(+p.wind.dir + 180) % 360}deg)`, title: `Wind uit ${p.wind.dir}°${p.wind.vary ? `, variërend ${p.wind.vary}°` : ''}` }, icon('arrowUp', 'wind-arrow'));
    const box = metric('WIND', arrow, calm ? 'Stil' : `${p.wind.dir === 'VRB' ? 'VRB' : p.wind.dir + '°'} / ${p.wind.spd}`, p.wind.gust ? h('small', {}, `G${p.wind.gust}`) : null, calm ? null : h('small', {}, p.wind.unit === 'MPS' ? 'm/s' : 'kt'));
    box.title = calm ? 'Windstil' : `Wind uit ${p.wind.dir === 'VRB' ? 'variabele richting' : p.wind.dir + '°'}${p.wind.vary ? ` (variërend ${p.wind.vary}°)` : ''}, ${p.wind.spd} ${p.wind.unit === 'MPS' ? 'm/s' : 'kt'}${p.wind.gust ? `, vlagen tot ${p.wind.gust}` : ''}.`;
    metrics.append(box);
  }
  const wxLine = p.wx.length ? h('div', { class: 'layers wxline', title: 'Actueel weer: ' + p.wx.map(wxWords).join(', ') + '.' }, p.wx.join(' ')) : null;
  if (p.vis != null) {
    const box = metric('ZICHT', p.cavok ? 'CAVOK' : visText(p.vis), p.cavok ? null : h('small', {}, p.vis >= 5000 ? 'km' : 'm'));
    box.classList.add('metric-cloud');
    box.title = p.cavok ? 'CAVOK: zicht 10 km of meer, geen bewolking onder 5000 ft en geen significant weer.' : `Heersend zicht ${p.vis >= 9999 ? '10 km of meer' : p.vis + ' m'}.`;
    if (wxLine) box.append(wxLine);
    metrics.append(box);
  } else if (wxLine) metrics.append(metric('WEER', p.wx.join(' ')));
  const cs = cloudSummary(p);
  const cloudBox = metric('WOLKENBASIS', cs.value, cs.unit ? h('small', {}, cs.unit) : null);
  cloudBox.classList.add('metric-cloud');
  cloudBox.title = cs.title;
  const ll = layersLine(cs);
  if (ll) cloudBox.append(ll);
  metrics.append(cloudBox);
  if (p.temp != null && p.dew != null) {
    const ds = dewSpread(p.temp, p.dew);
    const box = metric('TEMP / DAUWP', `${p.temp}° / ${p.dew}°`);
    box.classList.add('metric-dew');
    box.append(h('div', { class: 'dew ' + ds.level, title: `Verschil tussen temperatuur en dauwpunt: ${ds.spread}°C, relatieve vochtigheid ${ds.rh} %.\nBij 3 °C of minder is de lucht bijna verzadigd en kan mist of lage bewolking ontstaan, vooral bij afkoeling ’s avonds en ’s nachts.` },
      h('span', { class: 'dew-dot' }), `Δ ${ds.spread}°`, h('span', { class: 'dew-rh' }, `RV ${ds.rh}%`), ds.word ? h('b', {}, ds.word) : null));
    metrics.append(box);
  } else if (p.temp != null) metrics.append(metric('TEMP', `${p.temp}°`));
  if (p.qnh) { const box = metric('QNH', p.qnh, h('small', {}, 'hPa')); box.title = 'QNH: luchtdruk herleid tot zeeniveau.'; metrics.append(box); }
  return metrics;
}

/* ---------- North Sea: sea state and sea water temperature in the header ---------- */
// Observations of Rijkswaterstaat's measuring stations on the Dutch part of the North Sea (significant
// wave height Hm0, mean period Tm02, water temperature), fetched by the main process (src/sea.js) every
// five minutes. The sea state is the Douglas number for the significant wave height. One station is the
// reference in the header (Instellingen › Weerradar); the others are in the tooltip.
const sea = { data: null, fail: false, at: 0 };
const SEA_NAMES = ['Spiegelglad', 'Vlak', 'Kalm', 'Licht', 'Matig', 'Ruw', 'Zeer ruw', 'Hoog', 'Zeer hoog', 'Buitengewoon'];
const SEA_HS = ['0 m', '0–0,1 m', '0,1–0,5 m', '0,5–1,25 m', '1,25–2,5 m', '2,5–4 m', '4–6 m', '6–9 m', '9–14 m', '> 14 m'];
const nlNum = (v, d = 1) => (v == null ? '—' : (+v).toFixed(d).replace('.', ','));
// The wave glyph: the higher the sea state, the taller and steeper the crests.
function waveSvg(state) {
  const s = clamp(state == null ? 2 : state, 0, 9);
  const a = 1.5 + s * 1.1; // amplitude
  const d = `M2 ${16 + a / 2}c4 0 4-${a} 8-${a}s4 ${a} 8 ${a} 4-${a} 8-${a} 4 ${a} 8 ${a}`;
  return h('span', { class: 'sea-wave', html: `<svg viewBox="0 0 36 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" transform="translate(0 5)" fill="none" stroke="currentColor" stroke-width="1.6" stroke-opacity="0.45" stroke-linecap="round" stroke-linejoin="round"/></svg>` });
}
// The North Sea strip, the third under UDP and Maan and built the same way: label, sea state, wave height
// and period, water temperature, and at the right the station and time of the observation.
function renderSea() {
  const row = $('#sea');
  if (!row) return;
  row.replaceChildren();
  row.classList.remove('stale');
  const d = sea.data;
  const ref = d && d.ref;
  if (!ref) {
    row.title = '';
    row.append(h('span', { class: 'udp-label' }, 'NOORDZEE'), h('span', { class: 'sea-none' }, sea.fail ? 'Sea state en zeewatertemperatuur tijdelijk niet beschikbaar (Rijkswaterstaat)' : 'Sea state en zeewatertemperatuur worden opgehaald…'));
    return;
  }
  const st = ref.state, now = Date.now();
  const age = ref.hsAt ? Math.round((now - ref.hsAt) / 60000) : null;
  const stale = age != null && age > 90;
  row.classList.toggle('stale', stale);
  const lines = d.stations.filter((s) => s.hs != null || s.tw != null).map((s) => `${s.name.padEnd(22)} ${s.state != null ? 'sea state ' + s.state : '         '}${s.hs != null ? ` · Hs ${nlNum(s.hs, 2)} m` : ''}${s.tm02 != null ? ` · Tm ${nlNum(s.tm02)} s` : ''}${s.tw != null ? ` · water ${nlNum(s.tw)} °C` : ''}${s.windMs != null ? ` · wind ${Math.round(s.windDir || 0).toString().padStart(3, '0')}°/${Math.round(s.windMs * 1.94384)} kt` : ''} · ${zulu(s.at)}`);
  row.title = `Sea state (Douglas-schaal) en zeewatertemperatuur, gemeten door Rijkswaterstaat op ${ref.name}${age != null ? `, waarneming ${zulu(ref.hsAt)} (${age} min oud)` : ''}.\n`
    + (st != null ? `Sea state ${st} = ${SEA_NAMES[st].toLowerCase()}: significante golfhoogte ${SEA_HS[st]}.\n` : '')
    + (d.range ? `Alle Noordzeestations nu: sea state ${d.range[0]}${d.range[1] !== d.range[0] ? '–' + d.range[1] : ''}.\n` : '')
    + 'Referentiestation te kiezen onder Instellingen › Weerradar.\n\n' + lines.join('\n');
  row.append(
    h('span', { class: 'udp-label' }, 'NOORDZEE'),
    h('span', { class: 'sea-state s' + (st == null ? 'x' : Math.min(st, 6)) }, waveSvg(st), h('b', {}, st == null ? '—' : String(st)), h('span', { class: 'sea-words' }, h('em', {}, 'SEA STATE'), h('u', {}, st == null ? 'onbekend' : SEA_NAMES[st]))),
    h('span', { class: 'mp-sep' }),
    h('span', { class: 'sea-kv', title: `Significante golfhoogte Hs (Hm0) en gemiddelde golfperiode Tm02${ref.tmax != null ? `; maximale periode ${nlNum(ref.tmax)} s` : ''}` }, h('small', {}, 'Hs'), h('b', {}, nlNum(ref.hs, ref.hs != null && ref.hs < 1 ? 2 : 1)), h('small', {}, 'm'), ref.tm02 != null ? h('i', {}, `${nlNum(ref.tm02)} s`) : null),
    h('span', { class: 'mp-sep' }),
    h('span', { class: 'sea-kv', title: 'Zeewatertemperatuur aan het oppervlak' }, h('small', {}, 'ZEEWATER'), h('b', {}, nlNum(ref.tw)), h('small', {}, '°C')),
    h('span', { class: 'mo-gap' }),
    h('span', { class: 'sea-src' },
      h('span', {}, `${ref.name} ${ref.hsAt ? zulu(ref.hsAt) : ref.at ? zulu(ref.at) : ''}${stale ? ' · VEROUDERD' : ''}`),
      d.range && d.range[1] !== d.range[0] ? h('span', { class: 'sea-sector' }, ` · sector ${d.range[0]}–${d.range[1]}`) : null)
  );
  fitStrip(row, 5);
}
async function refreshSea() {
  const res = await window.palv.data.seaOverview(state.settings.seaStation || 'europlatform').catch(() => ({ ok: false }));
  if (res && res.ok) { sea.data = res; sea.fail = false; sea.at = Date.now(); } else sea.fail = true;
  const ok = !!(sea.data && sea.data.ref && sea.data.ref.hsAt && Date.now() - sea.data.ref.hsAt < 3 * 3600e3);
  report('sea', 'Sea state Noordzee', ok || !sea.fail, sea.fail ? 'Rijkswaterstaat geeft geen antwoord' : sea.data && sea.data.ref ? `waarneming ${zulu(sea.data.ref.hsAt || sea.data.ref.at)}` : '', 20 * 60000);
  renderSea();
}

let ehamBadge = null;
function renderEham() {
  const root = $('#eham');
  const { metar } = eham;
  const wx = h('div', { class: 'eham-wx' });
  const B = activeBase();
  const head = h('div', { class: 'eham-head' }, h('span', { class: 'eham-id' }, B.icao), h('span', { class: 'eham-name' }, B.station));
  if (ehamBadge) ehamBadge.dispose();
  ehamBadge = freshBadge(() => ({
    t: eham.metar && eham.metar.obsTime, warn: 40 * 60000, bad: 75 * 60000, fail: eham.metarFail, loading: !eham.metar,
    label: `METAR ${B.station} (waarnemingstijd)`, note: `Elke minuut opgehaald bij aviationweather.gov${eham.fetchedAt ? `, laatst ${zuluSec(eham.fetchedAt)}` : ''}. ${B.station} geeft elk half uur een nieuwe METAR uit${B.military ? ' (militair veld: buiten de openingstijden soms geen METAR)' : ''}.`,
  }));
  ehamBadge.classList.add('hd');
  if (metar) {
    const now = Date.now();
    const st = WX.station(B.icao, metar.raw, metar.obsTime, metar.taf, eham.history, now, EHAM_POS());
    const p = st.metar;
    if (metar.fltCat) head.append(h('span', { class: 'cat ' + metar.fltCat, title: 'Vliegcategorie volgens de Amerikaanse indeling van aviationweather.gov (plafond BKN/OVC en zicht). Zegt niets over de BOM-minima: zie de toetsing ernaast.' }, metar.fltCat));
    head.append(bomChips(st, now), ehamBadge);

    const metrics = metarMetrics(p, 'eham-metrics');
    wx.append(head, metrics, h('div', { class: 'eham-raw', title: metar.raw + (metar.taf ? '\n\n' + metar.taf : '') }, metar.raw.replace(/^(METAR|SPECI)\s+/, '')));
  } else {
    head.append(ehamBadge);
    wx.append(head, h('div', { class: 'rwy-none' }, eham.metarFail ? 'Luchtvaartweer is tijdelijk niet beschikbaar.' : 'Luchtvaartweer wordt opgehaald…'), h('div', {}));
  }
  root.replaceChildren(wx);
}

// Keeps the last hours of observations of one field, one per observation time, newest first.
function rememberObs(history, res) {
  if (!res.obsTime || !res.raw || history.some((o) => o.obsTime === res.obsTime)) return;
  history.push({ obsTime: res.obsTime, raw: res.raw });
  history.sort((a, b) => b.obsTime - a.obsTime);
  const cut = Date.now() - HISTORY_KEEP;
  while (history.length && history[history.length - 1].obsTime < cut) history.pop();
}

async function refreshMetar() {
  const B = activeBase();
  if (eham.icao !== B.icao) { eham.icao = B.icao; eham.metar = null; eham.history.length = 0; }
  const res = await window.palv.data.metar(B.icao).catch(() => ({ ok: false }));
  if (activeBase().icao !== B.icao) return; // the base changed meanwhile: the new one fetches itself
  if (res.ok) { eham.metar = res; eham.metarFail = false; eham.fetchedAt = res.fetchedAt; rememberObs(eham.history, res); } else eham.metarFail = true;
  renderEham();
  const m = eham.metar, obsAge = m && m.obsTime ? Date.now() - m.obsTime : Infinity;
  report('metar', `METAR ${B.station}`, !eham.metarFail && obsAge < 75 * 60000,
    eham.metarFail ? (m ? `geen verbinding, laatste ${zulu(m.obsTime)}` : 'geen verbinding') : `waarneming ${zulu(m.obsTime)}`, 10 * 60000);
}

/* ---------- the header's own layout: adjustable in edit mode ---------- */
// Every part of the header has a size (the whole part, its boxes and text together, via CSS zoom) and a
// size for its figures (the clock, the times, the METAR values). Only in edit mode a small panel shows on
// each part; outside it the header stays as it is. Kept per screen with the other settings.
const HD_PARTS = { brand: 'Logo en naam', clocks: 'Klokken', sun: 'UDP', moon: 'Maan', metar: 'METAR', sea: 'Noordzee' };
const HD_LIM = { z: [0.6, 1.8], t: [0.6, 1.8] };
function hdCfg() {
  const s = state.settings;
  if (!s.header || typeof s.header !== 'object') s.header = { z: {}, t: {} };
  if (!s.header.z || typeof s.header.z !== 'object') s.header.z = {};
  if (!s.header.t || typeof s.header.t !== 'object') s.header.t = {};
  return s.header;
}
const hdVal = (kind, k) => { const v = +hdCfg()[kind][k]; return Number.isFinite(v) && v > 0 ? clamp(v, ...HD_LIM[kind]) : 1; };
function applyHeaderLayout() {
  const hd = $('#header');
  if (!hd) return;
  for (const k of Object.keys(HD_PARTS)) { hd.style.setProperty('--z-' + k, String(hdVal('z', k))); hd.style.setProperty('--t-' + k, String(hdVal('t', k))); }
  renderHeaderTune();
}
function setHeaderVal(kind, k, v) {
  const val = Math.round(clamp(v, ...HD_LIM[kind]) * 100) / 100;
  if (val === 1) delete hdCfg()[kind][k]; else hdCfg()[kind][k] = val;
  applyHeaderLayout();
  save();
}
function renderHeaderTune() {
  const bar = $('#hd-tune-bar');
  if (!bar) return;
  for (const el of document.querySelectorAll('#header .hd-mark')) el.classList.remove('hd-mark');
  bar.hidden = !editing;
  if (!editing) { bar.replaceChildren(); return; }
  const row = (k, kind, label) => {
    const v = hdVal(kind, k), step = 0.05;
    return h('div', { class: 'hd-tune-row' },
      h('span', { class: 'hd-tune-l' }, label),
      h('button', { type: 'button', title: `${HD_PARTS[k]}: ${kind === 'z' ? 'blok' : 'tekst'} kleiner`, disabled: v <= HD_LIM[kind][0], onclick: () => setHeaderVal(kind, k, v - step) }, '−'),
      h('b', { title: 'Tik: terug naar 100 %', onclick: () => setHeaderVal(kind, k, 1) }, `${Math.round(v * 100)}%`),
      h('button', { type: 'button', title: `${HD_PARTS[k]}: ${kind === 'z' ? 'blok' : 'tekst'} groter`, disabled: v >= HD_LIM[kind][1], onclick: () => setHeaderVal(kind, k, v + step) }, '+'));
  };
  bar.replaceChildren(
    h('div', { class: 'hd-tune-title' }, h('b', {}, 'KOP AANPASSEN'), h('span', {}, 'Blok: het hele onderdeel. Tekst: de grote cijfers erin.')),
    ...Object.keys(HD_PARTS).map((k) => h('div', { class: 'hd-tune-part', onmouseenter: () => hdMark(k, true), onmouseleave: () => hdMark(k, false) },
      h('div', { class: 'hd-tune-name' }, HD_PARTS[k]), row(k, 'z', 'Blok'), row(k, 't', 'Tekst'))),
    h('button', { type: 'button', class: 'hd-tune-reset', title: 'Alle onderdelen van de kop terug naar de standaardgrootte', onclick: () => { state.settings.header = { z: {}, t: {} }; applyHeaderLayout(); save(); toast('Kop terug naar de standaardgrootte'); } }, icon('restore'), 'Alles 100 %'));
}
// Hovering a group in the bar lights up its part in the header.
function hdMark(k, on) {
  const el = document.querySelector(`#header .hd-part[data-part="${k}"]`);
  if (el) el.classList.toggle('hd-mark', on);
}

/* ---------- Werkplek: the base, chosen in the tab bar ---------- */
// The same choice as Instellingen › Basis, at the far right of the tab bar, so the crew can switch the
// dashboard to Schiphol-Oost, Volkel or Rotterdam in one tap. applyBase (settings.js) does the work.
let wpOpen = null;
const wpShort = (b) => (b.id === 'eham' ? 'Schiphol' : b.name);
function renderWorkplace() {
  const root = $('#workplace');
  if (!root) return;
  const B = activeBase();
  const btn = h('button', { type: 'button', class: 'wp-btn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', title: `Werkplek van dit dashboard: ${B.long}.\nKies een andere basis: het weer in de kop, het baangebruik, de ringen, de afstanden en Zoek & Plan wisselen mee.`, onclick: (e) => { e.stopPropagation(); toggleWorkplace(btn); } },
    h('span', { class: 'wp-label' }, 'WERKPLEK'),
    h('span', { class: 'wp-val' }, h('i', { class: 'wp-dot' }), wpShort(B), h('small', {}, B.icao)),
    h('span', { class: 'wp-caret', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>' }));
  root.replaceChildren(btn);
}
function closeWorkplace() {
  if (!wpOpen) return;
  wpOpen.remove(); wpOpen = null;
  const b = $('#workplace .wp-btn');
  if (b) { b.setAttribute('aria-expanded', 'false'); b.classList.remove('open'); }
  document.removeEventListener('pointerdown', wpOutside, true);
  document.removeEventListener('keydown', wpKey, true);
}
function wpOutside(e) { if (wpOpen && !wpOpen.contains(e.target) && !e.target.closest('#workplace')) closeWorkplace(); }
function wpKey(e) { if (e.key === 'Escape' && wpOpen) { e.stopPropagation(); e.preventDefault(); closeWorkplace(); } }
function toggleWorkplace(btn) {
  if (wpOpen) return closeWorkplace();
  const cur = activeBase().id;
  const menu = h('div', { class: 'wp-menu', role: 'listbox', 'aria-label': 'Werkplek kiezen' },
    h('div', { class: 'wp-menu-head' }, 'Werkplek kiezen'),
    ...BASES_API.ORDER.map((id) => {
      const b = BASES_API.BASES[id], on = id === cur;
      return h('button', { type: 'button', role: 'option', 'aria-selected': String(on), class: 'wp-opt' + (on ? ' on' : ''), onclick: () => { closeWorkplace(); if (!on) applyBase(id); } },
        h('span', { class: 'wp-opt-ic' }, icon(on ? 'check' : 'target')),
        h('span', { class: 'wp-opt-txt' }, h('b', {}, wpShort(b)), h('small', {}, b.long.replace(/^Steunpunt /, ''))),
        h('span', { class: 'wp-opt-icao' }, b.icao));
    }),
    h('div', { class: 'wp-menu-foot' }, 'Het weer in de kop, het baangebruik, de ringen, de afstanden en Zoek & Plan wisselen mee.'));
  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  menu.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  wpOpen = menu;
  btn.setAttribute('aria-expanded', 'true'); btn.classList.add('open');
  document.addEventListener('pointerdown', wpOutside, true);
  document.addEventListener('keydown', wpKey, true);
}
