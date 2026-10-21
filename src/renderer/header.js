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
        { class: 'tab' + (active ? ' active' : ''), role: 'tab', 'aria-selected': String(active), title: i < 9 ? `${p.name} (${MOD}${i + 1})` : p.name, onclick: () => setPage(i), ondblclick: () => renamePage(i) },
        p.name,
        h('span', { class: 'tab-tool', title: 'Naam wijzigen', onclick: (e) => { e.stopPropagation(); renamePage(i); } }, icon('edit')),
        state.pages.length > 1 ? h('span', { class: 'tab-tool danger', title: 'Pagina verwijderen', onclick: (e) => { e.stopPropagation(); deletePage(i); } }, icon('close')) : null
      )
    );
  });
  nav.append(h('button', { class: 'tab tab-add', title: 'Pagina toevoegen', 'aria-label': 'Pagina toevoegen', onclick: addPage }, icon('plus')));
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
  const progress = p.up && p.rise && p.set ? clamp((now - p.rise) / (p.set - p.rise), 0, 1) : 0;
  const day = (t) => (t ? ltDateFmt.format(t).replace(/\./g, '') : '—');
  const root = $('#moon');
  root.title = `Maan: ${m.phaseName.toLowerCase()}, ${pct} % verlicht, ${m.alt >= 0 ? `${m.alt.toFixed(0)}° boven` : `${(-m.alt).toFixed(0)}° onder`} de horizon (52°N 005°E).\n`
    + `${p.up ? 'Op sinds' : 'Komt op'} ${p.rise ? ltFmt.format(p.rise) + ' LT' : '—'}, ${p.up ? 'gaat onder' : 'daarna onder'} ${p.set ? ltFmt.format(p.set) + ' LT' : '—'}.\n`
    + `Volgende volle maan: ${day(moonCache.full)}${moonCache.full ? ' ' + ltFmt.format(moonCache.full) : ''} · nieuwe maan: ${day(moonCache.nw)}${moonCache.nw ? ' ' + ltFmt.format(moonCache.nw) : ''}.\n\n`
    + `Verlichtingssterkte op de grond, geschat voor een onbewolkte hemel zonder lichtvervuiling: ${lux.value} ${lux.unit} (${LUX_WORD[band].toLowerCase()}).\n`
    + `Zon ${L.sunAlt.toFixed(1)}° → ${ASTRO.formatLux(L.sky).value} ${ASTRO.formatLux(L.sky).unit} · maan → ${L.moon > 0 ? ASTRO.formatLux(L.moon).value + ' ' + ASTRO.formatLux(L.moon).unit : 'onder de horizon'}.\n`
    + 'Bewolking en stadslicht kunnen de werkelijke waarde sterk veranderen.';
  root.replaceChildren(
    h('span', { class: 'udp-label' }, 'MAAN'),
    h('span', { class: 'mo-phase' }, moonSvg(m), h('span', { class: 'mo-pct' }, h('span', { class: 'mo-num' }, h('b', {}, pct), h('small', {}, '%')), h('em', {}, m.phaseName))),
    stripTime(h('span', { class: 'mo-ic', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 9V3M9 6l3-3 3 3"/></svg>' }), p.rise, p.up ? 'Maan opgekomen' : 'Maan komt op'),
    h('div', { class: 'udp-track mo-track' + (p.up ? ' up' : '') }, h('i', { style: `width:${(progress * 100).toFixed(1)}%` })),
    stripTime(h('span', { class: 'mo-ic', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18h18"/><path d="M7 18a5 5 0 0 1 10 0"/><path d="M12 3v6M9 6l3 3 3-3"/></svg>' }), p.set, 'Maan gaat onder'),
    h('span', { class: 'lux ' + band },
      h('span', { class: 'lux-meter' }, h('i', { style: `width:${(luxLevel(L.lux) * 100).toFixed(1)}%` })),
      h('b', {}, lux.value), h('small', {}, lux.unit))
  );
}

/* ---------- Schiphol: METAR in the header ---------- */
const eham = { metar: null, metarFail: false, fetchedAt: 0, live: null };

function parseMetar(raw) {
  const out = { wind: null, vis: null, clouds: [], wx: [], temp: null, dew: null, qnh: null };
  const tokens = raw.replace(/^(METAR|SPECI)\s+/, '').split(/\s+/);
  for (const t of tokens.slice(2)) {
    let m;
    if (/^(NOSIG|BECMG|TEMPO|RMK)$/.test(t)) break;
    if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) out.wind = { dir: m[1], spd: +m[2], gust: m[3] ? +m[3] : null, unit: m[4] === 'KT' ? 'kt' : 'm/s' };
    else if ((m = t.match(/^(\d{3})V(\d{3})$/))) { if (out.wind) out.wind.vary = `${m[1]}–${m[2]}`; }
    else if (t === 'CAVOK') { out.vis = 9999; out.cavok = true; }
    else if (/^\d{4}$/.test(t) && out.vis == null) out.vis = +t;
    else if ((m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})(CB|TCU)?$/))) out.clouds.push({ cover: m[1], base: +m[2] * 100, type: m[3] || '' });
    else if ((m = t.match(/^(M?\d{2})\/(M?\d{2})$/))) { out.temp = +m[1].replace('M', '-'); out.dew = +m[2].replace('M', '-'); }
    else if ((m = t.match(/^Q(\d{4})$/))) out.qnh = +m[1];
    else if (/^(\+|-|VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS){1,3}$/.test(t)) out.wx.push(t);
  }
  return out;
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
  return { spread, rh, level, word: spread <= 1 ? 'MIST/LAGE BEWOLKING WAARSCHIJNLIJK' : spread <= 3 ? 'KANS OP MIST' : '' };
}

function metric(label, ...value) {
  return h('div', { class: 'metric' }, h('div', { class: 'metric-label' }, label), h('div', { class: 'metric-value' }, value));
}

let ehamBadge = null;
function renderEham() {
  const root = $('#eham');
  const { metar } = eham;
  const wx = h('div', { class: 'eham-wx' });
  const head = h('div', { class: 'eham-head' }, h('span', { class: 'eham-id' }, 'EHAM'), h('span', { class: 'eham-name' }, 'Schiphol'));
  if (ehamBadge) ehamBadge.dispose();
  ehamBadge = freshBadge(() => ({
    t: eham.metar && eham.metar.obsTime, warn: 40 * 60000, bad: 75 * 60000, fail: eham.metarFail, loading: !eham.metar,
    label: 'METAR Schiphol (waarnemingstijd)', note: `Elke minuut opgehaald bij aviationweather.gov${eham.fetchedAt ? `, laatst ${zuluSec(eham.fetchedAt)}` : ''}. Schiphol geeft elk half uur een nieuwe METAR uit.`,
  }));
  ehamBadge.classList.add('hd');
  if (metar) {
    const p = parseMetar(metar.raw);
    if (metar.fltCat) head.append(h('span', { class: 'cat ' + metar.fltCat, title: 'Vliegcategorie' }, metar.fltCat));
    head.append(ehamBadge);

    const metrics = h('div', { class: 'eham-metrics' });
    if (p.wind) {
      const calm = p.wind.spd === 0;
      const arrow = p.wind.dir === 'VRB' || calm ? null : h('span', { style: `display:flex;transform:rotate(${(+p.wind.dir + 180) % 360}deg)`, title: `Wind uit ${p.wind.dir}°` }, icon('arrowUp', 'wind-arrow'));
      metrics.append(metric('WIND', arrow, calm ? 'Stil' : `${p.wind.dir === 'VRB' ? 'VRB' : p.wind.dir + '°'} / ${p.wind.spd}`, p.wind.gust ? h('small', {}, `G${p.wind.gust}`) : null, calm ? null : h('small', {}, p.wind.unit)));
    }
    if (p.vis != null) metrics.append(metric('ZICHT', p.cavok ? 'CAVOK' : p.vis >= 9999 ? '≥10' : p.vis >= 5000 ? (p.vis / 1000).toFixed(0) : p.vis, p.cavok ? null : h('small', {}, p.vis >= 5000 ? 'km' : 'm')));
    const cloud = p.clouds.find((c) => /BKN|OVC|VV/.test(c.cover)) || p.clouds[0];
    metrics.append(metric('WOLKEN', cloud ? `${cloud.cover} ${cloud.base}` : p.cavok ? 'Geen' : 'NSC', cloud ? h('small', {}, 'ft' + (cloud.type ? ' ' + cloud.type : '')) : null));
    if (p.temp != null) {
      const ds = dewSpread(p.temp, p.dew);
      const box = metric('TEMP / DAUWP', `${p.temp}° / ${p.dew}°`);
      box.classList.add('metric-dew');
      box.append(h('div', { class: 'dew ' + ds.level, title: `Verschil tussen temperatuur en dauwpunt: ${ds.spread}°C, relatieve vochtigheid ${ds.rh} %.\nBij 3 °C of minder is de lucht bijna verzadigd en kan mist of lage bewolking ontstaan, vooral bij afkoeling ’s avonds en ’s nachts.` },
        h('span', { class: 'dew-dot' }), `Δ ${ds.spread}°`, h('span', { class: 'dew-rh' }, `RV ${ds.rh}%`), ds.word ? h('b', {}, ds.word) : null));
      metrics.append(box);
    }
    if (p.qnh) metrics.append(metric('QNH', p.qnh, h('small', {}, 'hPa')));
    if (p.wx.length) metrics.append(metric('WEER', p.wx.join(' ')));
    wx.append(head, metrics, h('div', { class: 'eham-raw', title: metar.raw + (metar.taf ? '\n\n' + metar.taf : '') }, metar.raw.replace(/^(METAR|SPECI)\s+/, '')));
  } else {
    head.append(ehamBadge);
    wx.append(head, h('div', { class: 'rwy-none' }, eham.metarFail ? 'Luchtvaartweer is tijdelijk niet beschikbaar.' : 'Luchtvaartweer wordt opgehaald…'), h('div', {}));
  }
  root.replaceChildren(wx);
}

async function refreshMetar() {
  const res = await window.palv.data.metar('EHAM').catch(() => ({ ok: false }));
  if (res.ok) { eham.metar = res; eham.metarFail = false; eham.fetchedAt = res.fetchedAt; } else eham.metarFail = true;
  renderEham();
  const m = eham.metar, obsAge = m && m.obsTime ? Date.now() - m.obsTime : Infinity;
  report('metar', 'METAR Schiphol', !eham.metarFail && obsAge < 75 * 60000,
    eham.metarFail ? (m ? `geen verbinding, laatste ${zulu(m.obsTime)}` : 'geen verbinding') : `waarneming ${zulu(m.obsTime)}`, 10 * 60000);
}
