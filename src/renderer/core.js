'use strict';

/* ============================================================
   P-ALV Dashboard — gedeelde bouwstenen van de renderer
   DOM-helper, iconen, meldingen, dialogen, formuliervelden, tijdnotatie en de versheidsbolletjes.
   ============================================================ */

const WEB_PARTITION = 'persist:palv-web';
// The same dashboard runs on Windows and macOS; only the wording of keys and paths differs.
const IS_MAC = window.palv.platform === 'darwin';
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const FS_KEY = IS_MAC ? '⌃⌘F' : 'F11';
const APP_HINT = IS_MAC ? '/Applications/Programma.app of alleen de naam, bv. Safari' : 'C:\\Program Files\\…\\programma.exe';

const $ = (sel, el = document) => el.querySelector(sel);
const pad2 = (n) => String(n).padStart(2, '0');

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ---------- icons (24px stroke set) ---------- */
const ICONS = {
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  auto: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18" /><path d="M12 3a9 9 0 0 1 0 18Z" fill="currentColor"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  shrink: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  min: '<path d="M5 12h14"/>',
  max: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  restore: '<rect x="4" y="8" width="12" height="12" rx="1"/><path d="M8 8V4h12v12h-4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plane: '<path d="M10.5 3.5a1.5 1.5 0 0 1 3 0V9l8 5v2l-8-2.5V19l2.5 2v1.5L12 21.5l-4 1V21l2.5-2v-5.5L2.5 16v-2l8-5Z"/>',
  radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12 18.5 5.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5Z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  apps: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  note: '<path d="M5 4h14v11l-5 5H5Z"/><path d="M14 20v-5h5M8 9h8M8 13h4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  shield: '<path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6Z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1L3.2 9.4l6.1-.8Z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
  screens: '<rect x="2" y="5" width="12" height="9" rx="1.2"/><rect x="10" y="9" width="12" height="9" rx="1.2"/><path d="M6 18h4M16 21h2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M10 10v10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  arrowUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z"/>',
  route: '<circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="5.5" r="2.2"/><path d="M8.2 18.5H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8"/>',
  wind: '<path d="M3 9h10a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h6"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2v4.5M12 17.5V22M2 12h4.5M17.5 12H22"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4.5M12 17.5v.3"/>',
  system: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9zM9 1.5V4M15 1.5V4M9 20v2.5M15 20v2.5M1.5 9H4M1.5 15H4M20 9h2.5M20 15h2.5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7.5V12l3 2"/>',
};
const icon = (name, cls) =>
  h('span', { class: cls || '', style: 'display:contents', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls || ''}">${ICONS[name] || ''}</svg>` }).firstChild;

/* ---------- time ---------- */
const zulu = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`; };
const zuluSec = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`; };
const ltFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const ltDateFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', weekday: 'short', day: 'numeric', month: 'short' });
// "3 s", "12 min", "1 u 05", "2 d 4 u": how long ago, short enough for a title bar.
function ageText(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  if (hh < 48) return `${hh} u ${pad2(m % 60)}`;
  return `${Math.floor(hh / 24)} d ${hh % 24} u`;
}
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------- freshness: how old the data on screen is ---------- */
// A small pill with a green, orange or red dot and the time and age of what a widget shows. Each widget
// that shows data hands over a function that tells, at any moment:
//   { t: time of the data (ms) or 0, warn: age (ms) from which it turns orange, bad: age for red,
//     fail: true when the source cannot be reached, label: what is being timed, seconds: show seconds,
//     note: extra line for the tooltip }
// The pill is repainted every second by the dashboard's clock, so the age runs on by itself.
const freshBadges = new Set();
function freshBadge(spec) {
  const dot = h('i', { class: 'fr-dot' });
  const text = h('span', { class: 'fr-text' });
  const el = h('span', { class: 'fresh', role: 'status' }, dot, text);
  el.paint = () => {
    let s;
    try { s = spec(); } catch { s = null; }
    if (!s) { el.hidden = true; return; }
    el.hidden = false;
    const now = Date.now();
    const age = s.t ? now - s.t : Infinity;
    // No data yet: orange while loading, red when the source cannot be reached. A source that fails while
    // the last data is still recent is orange, and red once that data is too old.
    const level = !s.t ? (s.loading && !s.fail ? 'warn' : 'bad')
      : age >= s.bad ? 'bad'
        : s.fail || age >= s.warn ? 'warn' : 'ok';
    el.className = 'fresh ' + level;
    const time = s.t ? (s.seconds ? zuluSec(s.t) : zulu(s.t)) : '';
    text.textContent = !s.t ? (s.loading ? 'Laden…' : 'Geen gegevens') : `${time} · ${ageText(age)}`;
    const word = { ok: 'Actueel', warn: s.fail ? 'Verbinding hapert' : 'Vertraagd', bad: s.fail ? 'Geen verbinding' : 'Verouderd' }[level];
    el.title = `${word} — ${s.label || 'gegevens'}${s.t ? ` van ${time} (${ageText(age)} oud)` : ''}.\n`
      + `Groen tot ${ageText(s.warn)}, oranje tot ${ageText(s.bad)}, daarna rood.${s.note ? '\n' + s.note : ''}`;
  };
  el.paint();
  freshBadges.add(el);
  el.dispose = () => freshBadges.delete(el);
  return el;
}
function paintFreshBadges() {
  for (const el of freshBadges) {
    if (!el.isConnected) continue;
    el.paint();
  }
}

/* ---------- toasts & modals ---------- */
function toast(msg, isError) {
  const el = h('div', { class: 'toast' + (isError ? ' error' : '') }, msg);
  $('#toast-root').append(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4100);
}

function openModal({ title, body, actions = [], wide, bare, cls }) {
  const close = () => backdrop.remove();
  const foot = h('div', { class: 'modal-foot' });
  for (const a of actions) {
    foot.append(
      h('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '') + (a.left ? ' left' : ''), onclick: () => (a.onClick ? a.onClick(close) !== false && !a.keepOpen && close() : close()) }, a.label)
    );
  }
  const modal = h(
    'div',
    { class: 'modal' + (wide ? ' wide' : '') + (cls ? ' ' + cls : ''), role: 'dialog' },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'w-tool', title: 'Sluiten', onclick: close }, icon('close'))),
    bare ? body : h('div', { class: 'modal-body' }, body),
    actions.length ? foot : null
  );
  const backdrop = h('div', { class: 'modal-backdrop', onmousedown: (e) => e.target === backdrop && close() }, modal);
  $('#modal-root').append(backdrop);
  const first = modal.querySelector('input, select, textarea');
  if (first) first.focus();
  return close;
}
const modalOpen = () => !!$('#modal-root').firstChild;

function confirmDialog(title, text, yesLabel, onYes) {
  openModal({
    title,
    body: h('p', { style: 'margin:0;line-height:1.5' }, text),
    actions: [{ label: 'Annuleren' }, { label: yesLabel, danger: true, onClick: onYes }],
  });
}

const field = (label, input, hint) => h('div', { class: 'field' }, h('label', {}, label), input, hint ? h('div', { class: 'hint' }, hint) : null);
const textInput = (value, attrs = {}) => h('input', { class: 'input', type: 'text', value: value ?? '', ...attrs });
const checkbox = (label, checked, onChange) => h('label', { class: 'check' }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), label);

function segmented(options, value, onChange) {
  const el = h('div', { class: 'seg' });
  const paint = (v) => [...el.children].forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  for (const o of options) {
    el.append(
      h('button', { 'data-v': o.value, title: o.title || null, onclick: () => { paint(o.value); onChange(o.value); } }, o.icon ? icon(o.icon) : null, o.label)
    );
  }
  paint(value);
  el.setValue = paint;
  return el;
}

// On/off switch with its label for a widget's title bar; `paint` sets it to the current state.
function switchTool(label, title, isOn, onToggle) {
  const el = h('button', { class: 'switch', role: 'switch', title, onclick: () => { onToggle(); el.paint(); } }, label, h('span', { class: 'switch-track' }));
  el.paint = () => { el.classList.toggle('on', !!isOn()); el.setAttribute('aria-checked', String(!!isOn())); };
  el.paint();
  return el;
}

/* ---------- logbook ---------- */
// Errors in the dashboard go to the logbook on disk, next to those of the main process.
const plog = (level, msg, data) => { try { window.palv.log(level, msg, data); } catch { /* not essential */ } };
window.addEventListener('error', (e) => plog('error', `scriptfout: ${e.message}`, `${e.filename || ''}:${e.lineno || ''}`));
window.addEventListener('unhandledrejection', (e) => plog('error', 'onafgehandelde fout', String((e.reason && (e.reason.stack || e.reason.message)) || e.reason)));
