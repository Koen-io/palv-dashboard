'use strict';

/* ============================================================
   P-ALV Dashboard — renderer
   ============================================================ */

const COLS = 96;
const ROWS = 54;
const WEB_PARTITION = 'persist:palv-web';
// The same dashboard runs on Windows and macOS; only the wording of keys and paths differs.
const IS_MAC = window.palv.platform === 'darwin';
const MOD = IS_MAC ? '⌘' : 'Ctrl+';
const FS_KEY = IS_MAC ? '⌃⌘F' : 'F11';
const APP_HINT = IS_MAC ? '/Applications/Programma.app of alleen de naam, bv. Safari' : 'C:\\Program Files\\…\\programma.exe';
// Map views are stored for a widget body of this pixel size and scaled to the actual size, so the
// same area stays in view on any screen resolution and in any window size.
const REF_W = 939, REF_H = 1041;

const $ = (sel, el = document) => el.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
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
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layout: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 10h18M10 10v10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  arrowUp: '<path d="M12 20V5M6 11l6-6 6 6"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18Z"/>',
  route: '<circle cx="6" cy="18.5" r="2.2"/><circle cx="18" cy="5.5" r="2.2"/><path d="M8.2 18.5H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.8"/>',
  wind: '<path d="M3 9h10a3 3 0 1 0-3-3M3 14h15a3 3 0 1 1-3 3M3 19h6"/>',
  target: '<circle cx="12" cy="12" r="7.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 2v4.5M12 17.5V22M2 12h4.5M17.5 12H22"/>',
};
const icon = (name, cls) =>
  h('span', { class: cls || '', style: 'display:contents', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="${cls || ''}">${ICONS[name] || ''}</svg>` }).firstChild;

/* ---------- defaults ---------- */
// Mode-S hex codes; editable under Instellingen > ADS-B filter.
const DEFAULT_HEX = {
  police: '484A91, 484A92, 484A93, 484A94, 484A95, 484A96, 484AC0, 484AC1, 485B2F',
  hems: '4843BB, 4843BE, 4844C2, 484B58, 4853E2, 4853F6, 4857B3, 485E49, 48605B, 48605C',
  coastguard: '485694, 4856F3, 486449, 48644A, 48644B, 485F8F',
};

function defaultState() {
  const tile = (x, y, title, kind, target) => ({ id: uid(), type: 'tile', x, y, w: 12, h: 9, z: 1, title, cfg: { kind, target, args: '', icon: null } });
  return {
    version: 5,
    settings: {
      theme: 'auto',
      autoMode: 'sun',
      lightFrom: '07:00',
      darkFrom: '19:00',
      uiScale: 1,
      showSeconds: true,
      startFullscreen: true,
      nightlyReload: true,
      autoStart: false,
      snap: true,
      rotate: 0,
      wxMarginFt: 200,
      wxMarginM: 1000,
      clocks: [
        { label: 'AMSTERDAM', tz: 'Europe/Amsterdam', suffix: 'LT' },
        { label: 'UTC', tz: 'UTC', suffix: 'Z' },
      ],
      hex: { ...DEFAULT_HEX },
    },
    activePage: 0,
    pages: [
      {
        id: uid(),
        name: 'Operationeel',
        widgets: [
          { id: uid(), type: 'adsb', x: 0, y: 0, w: 36, h: 54, z: 1, title: WIDGETS.adsb.name, cfg: { ...WIDGETS.adsb.defaults, mode: 'police', labels: true } },
          { id: uid(), type: 'windy', x: 36, y: 0, w: 36, h: 54, z: 2, title: 'Weerradar', cfg: { ...WIDGETS.windy.defaults } },
          tile(72, 0, 'LVNL Baangebruik', 'url', 'https://www.lvnl.nl/omgeving/actueel-baangebruik-schiphol'),
          tile(84, 0, 'KNMI Luchtvaart', 'url', 'https://www.knmi.nl/nederland-nu/luchtvaart'),
          { id: uid(), type: 'runway', x: 72, y: 9, w: 24, h: 27, z: 3, title: WIDGETS.runway.name, cfg: {} },
          { id: uid(), type: 'fleet', x: 72, y: 36, w: 24, h: 18, z: 3, title: WIDGETS.fleet.name, cfg: {} },
        ],
      },
      {
        id: uid(),
        name: 'Weer',
        widgets: [
          { id: uid(), type: 'windy', x: 0, y: 0, w: 62, h: 54, z: 1, title: 'Weerradar', cfg: { ...WIDGETS.windy.defaults } },
          { id: uid(), type: 'metar', x: 62, y: 0, w: 34, h: 18, z: 1, title: 'Schiphol', cfg: { icao: 'EHAM' } },
          { id: uid(), type: 'metar', x: 62, y: 18, w: 34, h: 18, z: 1, title: 'Rotterdam', cfg: { icao: 'EHRD' } },
          { id: uid(), type: 'metar', x: 62, y: 36, w: 34, h: 18, z: 1, title: 'Eindhoven Airport', cfg: { icao: 'EHEH' } },
        ],
      },
    ],
  };
}

/* ---------- state ---------- */
let state = null;
let editing = false;
let winState = { maximized: false, fullscreen: false };
const pageEls = new Map(); // page id -> element
const instances = new Map(); // widget id -> { el, destroy }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; window.palv.config.save(state); }, 350);
}
// A whole new configuration (import, reset): written as it is, and the dashboard starts over on it.
async function replaceConfig(cfg) {
  clearTimeout(saveTimer);
  saveTimer = null;
  await window.palv.config.save(cfg);
  location.reload();
}

function normalize(loaded) {
  const def = defaultState();
  if (!loaded || !Array.isArray(loaded.pages) || !loaded.pages.length) return def;
  const from = loaded.version || 1;
  const fromV1 = from < 2;
  loaded.settings = { ...def.settings, ...(loaded.settings || {}) };
  if (fromV1) loaded.settings.startFullscreen = true;
  loaded.version = 5;
  loaded.settings.hex = { ...def.settings.hex, ...(loaded.settings.hex || {}) };
  if (!Array.isArray(loaded.settings.clocks) || loaded.settings.clocks.length !== 2) loaded.settings.clocks = def.settings.clocks;
  for (const p of loaded.pages) {
    p.id = p.id || uid();
    p.widgets = (p.widgets || []).filter((w) => WIDGETS[w.type]);
    for (const w of p.widgets) {
      w.id = w.id || uid();
      if (fromV1 && w.cfg && (w.type === 'adsb' || w.type === 'windy')) {
        // Widgets still on the first release's map view move to the new standard view; custom views stay exact.
        const old = w.type === 'adsb' ? 7.6 : 7;
        if (w.cfg.lat === 52.2 && w.cfg.lon === 5.3 && w.cfg.zoom === old) { delete w.cfg.lat; delete w.cfg.lon; delete w.cfg.zoom; }
        else w.cfg.refH = null;
      }
      w.cfg = { ...(WIDGETS[w.type].defaults || {}), ...(w.cfg || {}) };
    }
  }
  if (from < 3) migrateV3(loaded);
  if (from < 4) migrateV4(loaded);
  if (from < 5) migrateV5(loaded);
  loaded.activePage = clamp(loaded.activePage | 0, 0, loaded.pages.length - 1);
  return loaded;
}

// 1.2: runway use moved from the header into a widget next to the radar, and the note on the
// weather page made way for a station in the north of the country.
function migrateV3(st) {
  const is = (type) => (w) => w.type === type;
  if (!st.pages.some((p) => p.widgets.some(is('runway')))) {
    const page = st.pages.find((p) => p.widgets.some(is('windy')) && p.widgets.some(is('adsb'))) || st.pages.find((p) => p.widgets.some(is('windy'))) || st.pages[0];
    // The two standard tiles go side by side, so the widget gets the full column below them.
    const stock = [[86, 0], [86, 9]].map(([x, y]) => page.widgets.find((w) => w.type === 'tile' && w.x === x && w.y === y && w.w === 10 && w.h === 9));
    if (stock[0] && stock[1]) stock.forEach((t, i) => Object.assign(t, { x: 72 + i * 12, y: 0, w: 12 }));
    const radar = page.widgets.filter(is('windy')).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
    const x = radar ? radar.x + radar.w : COLS;
    let spot = null;
    if (COLS - x >= 14) {
      // Tallest free band in the column right of the radar.
      const used = Array.from({ length: ROWS }, (_, row) => page.widgets.some((o) => o.x + o.w > x && o.y <= row && o.y + o.h > row));
      let run = 0;
      for (let row = 0; row <= ROWS; row += 1) {
        if (row < ROWS && !used[row]) { run += 1; continue; }
        if (run >= 20 && (!spot || run > spot.h)) spot = { x, y: row - run, w: COLS - x, h: run };
        run = 0;
      }
    }
    if (!spot) spot = { ...findFreeSpot(page, 24, 30), w: 24, h: 30 };
    page.widgets.push({ id: uid(), type: 'runway', ...spot, z: Math.max(0, ...page.widgets.map((o) => o.z || 1)) + 1, title: WIDGETS.runway.name, cfg: {} });
  }
  for (const p of st.pages) {
    const note = p.widgets.find(is('note'));
    if (!note || !p.widgets.some(is('metar'))) continue;
    if (p.widgets.some((w) => w.type === 'metar' && w.cfg.icao === 'EHGG')) p.widgets.splice(p.widgets.indexOf(note), 1);
    else Object.assign(note, { type: 'metar', title: 'Groningen Eelde', cfg: { icao: 'EHGG' } });
  }
}

// 1.8: new standard map views, framed for REF_W x REF_H; aircraft labels on; Eindhoven instead of
// Groningen Eelde on the weather page.
function migrateV4(st) {
  // Standard view and reference frame (height, width) of the previous releases.
  const OLD = { adsb: { lat: 52.021, lon: 5.349, zoom: 7.9, ref: [1096, (1096 * 704) / 815] }, windy: { lat: 52.04, lon: 5.16, zoom: 8, ref: [815, 704] } };
  for (const w of st.pages.flatMap((p) => p.widgets)) {
    const old = OLD[w.type];
    if (old && w.cfg.refH === 1096) {
      const { lat, lon, zoom } = WIDGETS[w.type].defaults;
      if (w.cfg.lat === old.lat && w.cfg.lon === old.lon && w.cfg.zoom === old.zoom) Object.assign(w.cfg, { lat, lon, zoom });
      // A custom centre keeps the framing it had, expressed against the new reference size.
      else w.cfg.zoom = +(w.cfg.zoom + Math.log2(Math.min(REF_H / old.ref[0], REF_W / old.ref[1]))).toFixed(3);
      w.cfg.refH = REF_H;
    }
    if (w.type === 'adsb' && w.title === 'ADS-B Exchange') w.title = WIDGETS.adsb.name;
    if (w.type === 'metar' && w.cfg.icao === 'EHGG' && w.title === 'Groningen Eelde') { w.title = 'Eindhoven Airport'; w.cfg.icao = 'EHEH'; }
  }
}

// 1.11: the own aircraft in the air, in the lower part of the runway column.
function migrateV5(st) {
  if (st.pages.some((p) => p.widgets.some((w) => w.type === 'fleet'))) return;
  const page = st.pages.find((p) => p.widgets.some((w) => w.type === 'runway')) || st.pages[0];
  const rwy = page.widgets.find((w) => w.type === 'runway');
  const H = 18;
  let spot;
  if (rwy && rwy.h >= 34) {
    rwy.h -= H;
    spot = { x: rwy.x, y: rwy.y + rwy.h, w: rwy.w, h: H };
  } else spot = { ...findFreeSpot(page, 24, H), w: 24, h: H };
  page.widgets.push({ id: uid(), type: 'fleet', ...spot, z: Math.max(0, ...page.widgets.map((o) => o.z || 1)) + 1, title: WIDGETS.fleet.name, cfg: {} });
}

/* ---------- toasts & modals ---------- */
function toast(msg, isError) {
  const el = h('div', { class: 'toast' + (isError ? ' error' : '') }, msg);
  $('#toast-root').append(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4100);
}

function openModal({ title, body, actions = [], wide, bare }) {
  const close = () => backdrop.remove();
  const foot = h('div', { class: 'modal-foot' });
  for (const a of actions) {
    foot.append(
      h('button', { class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : '') + (a.left ? ' left' : ''), onclick: () => (a.onClick ? a.onClick(close) !== false && !a.keepOpen && close() : close()) }, a.label)
    );
  }
  const modal = h(
    'div',
    { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog' },
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

/* ============================================================
   Theme (licht / donker / automatisch)
   ============================================================ */
function sunTimes(date, lat, lon) {
  // NOAA solar calculator (after Meeus), good to well within a minute; the UDP times depend on it.
  const rad = Math.PI / 180;
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const at = (ms) => {
    const T = (ms / 864e5 + 2440587.5 - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
    const om = 125.04 - 1934.136 * T;
    const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
    const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad));
    const y = Math.tan((eps / 2) * rad) ** 2;
    const eot = (4 / rad) * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad));
    const ha = Math.acos(clamp(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl), -1, 1)) / rad;
    return { rise: midnight + (720 - 4 * (lon + ha) - eot) * 60000, set: midnight + (720 - 4 * (lon - ha) - eot) * 60000 };
  };
  // Second pass with the sun's position at the moment of rising and setting itself.
  const first = at(midnight + 12 * 3600e3);
  return { rise: new Date(at(first.rise).rise), set: new Date(at(first.set).set) };
}

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
  const { rise, set } = sunTimes(now, 52.31, 4.76);
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

/* ============================================================
   Title bar
   ============================================================ */
const THEME_META = { auto: { icon: 'auto', label: 'Auto' }, light: { icon: 'sun', label: 'Licht' }, dark: { icon: 'moon', label: 'Donker' } };

function renderTitlebar() {
  const actions = $('#tb-actions');
  actions.replaceChildren(
    h('button', { class: 'tb-btn' + (editing ? ' on' : ''), title: `Indeling bewerken (${MOD}E)`, onclick: () => setEditing(!editing) }, icon('edit'), editing ? 'Gereed' : 'Bewerken'),
    h('button', { class: 'tb-btn', title: 'Widget of app-tegel toevoegen', onclick: openAddWidget }, icon('plus'), 'Toevoegen'),
    h('button', { class: 'tb-btn', title: 'Thema wisselen: automatisch / licht / donker', onclick: cycleTheme }, icon(THEME_META[state.settings.theme].icon), THEME_META[state.settings.theme].label),
    h('button', { class: 'tb-btn', title: 'Instellingen', onclick: () => openSettings() }, icon('gear'), 'Instellingen'),
    h('button', { class: 'tb-btn', title: `Volledig scherm zonder randen en menubalk (${FS_KEY})`, onclick: () => window.palv.win.setFullscreen(!winState.fullscreen) }, icon(winState.fullscreen ? 'shrink' : 'expand'), winState.fullscreen ? 'Venster' : 'Volledig scherm')
  );
  $('#tb-window').replaceChildren(
    h('button', { class: 'tb-win', title: 'Minimaliseren', onclick: () => window.palv.win.minimize() }, icon('min')),
    h('button', { class: 'tb-win', title: winState.maximized || winState.fullscreen ? 'Verkleinen' : 'Maximaliseren', onclick: () => window.palv.win.toggleMaximize() }, icon(winState.maximized || winState.fullscreen ? 'restore' : 'max')),
    h('button', { class: 'tb-win close', title: 'Afsluiten', onclick: () => window.palv.win.close() }, icon('close'))
  );
}

function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  state.settings.theme = order[(order.indexOf(state.settings.theme) + 1) % 3];
  applyTheme(true);
  renderTitlebar();
  save();
}

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

/* ============================================================
   Clocks
   ============================================================ */
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

/* ============================================================
   UDP (uniforme daglichtperiode)
   ============================================================ */
// From 15 minutes before sunrise until 15 minutes after sunset, at the national reference point
// 52°00'N 005°00'E, for today's date in the Netherlands.
const ltFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const nlDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
function udpToday(now = Date.now()) {
  const [y, m, d] = nlDateFmt.format(now).split('-').map(Number);
  const noon = Date.UTC(y, m - 1, d, 12);
  // The official KNMI table for the year when it is on board; otherwise the calculation, which stays
  // within a minute of that table.
  const row = window.SUN_TABLE[y] && window.SUN_TABLE[y][m - 1].substr((d - 1) * 8, 8);
  let rise, set;
  if (row && row.length === 8) {
    const offset = +ltFmt.format(noon).slice(0, 2) - 12; // hours ahead of UTC on this date
    const local = (hhmm) => Date.UTC(y, m - 1, d, +hhmm.slice(0, 2) - offset, +hhmm.slice(2));
    rise = local(row.slice(0, 4)); set = local(row.slice(4));
  } else {
    const sun = sunTimes(new Date(noon), 52, 5);
    const round = (t) => Math.round(t / 60000) * 60000;
    rise = round(sun.rise.getTime()); set = round(sun.set.getTime());
  }
  const begin = rise - 15 * 60000, end = set + 15 * 60000;
  return { begin, end, day: now >= begin && now < end, official: !!row, year: y };
}

function renderUdp() {
  const now = Date.now(), u = udpToday(now);
  const time = (ic, t) => h('span', { class: 'udp-t' }, icon(ic), h('b', {}, ltFmt.format(t)), h('small', {}, 'LT'), h('span', {}, zulu(t)));
  const root = $('#udp');
  root.title = 'Uniforme daglichtperiode van vandaag: van 15 minuten vóór zonsopkomst tot 15 minuten na zonsondergang (52°N 005°E). Het weerradarprofiel schakelt op deze tijden automatisch tussen dag en nacht.\n'
    + (u.official ? `Bron: KNMI-tabel zonopkomst en -ondergang ${u.year}.` : `Berekend: voor ${u.year} is geen KNMI-tabel aanwezig. De berekening kan één minuut afwijken van de officiële tabel.`);
  root.replaceChildren(
    h('span', { class: 'udp-label' }, 'UDP', u.official ? null : h('span', { class: 'udp-calc' }, 'BEREKEND ±1 MIN')),
    time('sun', u.begin),
    h('div', { class: 'udp-track' + (u.day ? ' day' : '') }, h('i', { style: `width:${(clamp((now - u.begin) / (u.end - u.begin), 0, 1) * 100).toFixed(1)}%` })),
    time('moon', u.end),
    h('span', { class: 'udp-badge ' + (u.day ? 'day' : 'night') }, u.day ? 'DAG' : 'NACHT')
  );
}

/* ============================================================
   Schiphol: METAR + actueel baangebruik (live waargenomen)
   ============================================================ */
const RUNWAYS = [
  { name: 'Polderbaan', a: '18R', b: '36L', pa: [52.36025, 4.71183], pb: [52.32862, 4.70889] },
  { name: 'Zwanenburgbaan', a: '18C', b: '36C', pa: [52.33139, 4.74003], pb: [52.30186, 4.7375] },
  { name: 'Aalsmeerbaan', a: '18L', b: '36R', pa: [52.32123, 4.78012], pb: [52.29069, 4.77747] },
  { name: 'Kaagbaan', a: '06', b: '24', pa: [52.28792, 4.73422], pb: [52.30462, 4.77752] },
  { name: 'Buitenveldertbaan', a: '09', b: '27', pa: [52.31667, 4.74636], pb: [52.31842, 4.79689] },
  { name: 'Oostbaan', a: '04', b: '22', pa: [52.30036, 4.78348], pb: [52.31403, 4.80302] },
];
// Bundled OpenStreetMap tiles around the field (assets/schiphol/<x>-<y>.png), the backdrop of the runway map.
const SCHIPHOL_TILES = { z: 13, x0: 4200, y0: 2691, cols: 8, rows: 6 };
const rwyName = (id) => { const r = RUNWAYS.find((r) => r.a === id || r.b === id); return r ? r.name : ''; };

const eham = { metar: null, metarFail: false, live: null };

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

const zulu = (ms) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}Z`; };

function metric(label, ...value) {
  return h('div', { class: 'metric' }, h('div', { class: 'metric-label' }, label), h('div', { class: 'metric-value' }, value));
}

function runwayMap(landing, departure) {
  // Web Mercator on the pixel grid of the bundled tiles, so the runways and the backdrop are one drawing
  // and stay locked together however the widget is sized.
  const CX = 60, CY = 50, K = 0.1154, T = SCHIPHOL_TILES, N = 256 * 2 ** T.z;
  const mx = (lon) => ((lon + 180) / 360) * N;
  const my = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };
  const X0 = mx(4.757), Y0 = my(52.326);
  const proj = ([lat, lon]) => [CX + (mx(lon) - X0) * K, CY + (my(lat) - Y0) * K];
  let tiles = '';
  for (let i = 0; i < T.cols; i += 1) for (let j = 0; j < T.rows; j += 1) {
    // A sliver of overlap keeps hairlines from showing between tiles at odd scales; the mask further down
    // lets the backdrop fade out before the tiles end.
    tiles += `<image href="../../assets/schiphol/${T.x0 + i}-${T.y0 + j}.png" x="${(CX + ((T.x0 + i) * 256 - X0) * K).toFixed(2)}" y="${(CY + ((T.y0 + j) * 256 - Y0) * K).toFixed(2)}" width="${(256 * K + 0.05).toFixed(2)}" height="${(256 * K + 0.05).toFixed(2)}" preserveAspectRatio="none"/>`;
  }
  const landIds = new Set(landing.map((r) => r.rwy));
  const depIds = new Set(departure.map((r) => r.rwy));
  let lines = '', arrows = '';
  const labels = [];
  const arrow = (from, to, cls) => {
    const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const hx = (a) => [to[0] - 5 * Math.cos(ang + a), to[1] - 5 * Math.sin(ang + a)];
    const [p1, p2] = [hx(0.5), hx(-0.5)];
    return `<g class="arrow ${cls}"><line x1="${from[0].toFixed(1)}" y1="${from[1].toFixed(1)}" x2="${(to[0] - 3 * Math.cos(ang)).toFixed(1)}" y2="${(to[1] - 3 * Math.sin(ang)).toFixed(1)}"/><polygon stroke="none" points="${to[0].toFixed(1)},${to[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}"/></g>`;
  };
  for (const r of RUNWAYS) {
    const A = proj(r.pa), B = proj(r.pb);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const d = [(B[0] - A[0]) / len, (B[1] - A[1]) / len]; // unit vector a -> b
    const ends = [
      { id: r.a, p: A, dir: d, far: B },
      { id: r.b, p: B, dir: [-d[0], -d[1]], far: A },
    ];
    let cls = '';
    for (const e of ends) {
      const isLand = landIds.has(e.id), isDep = depIds.has(e.id);
      if (!isLand && !isDep) continue;
      cls = cls || (isLand ? 'land' : 'dep');
      // Landing: approach arrow flying in towards the threshold. Departure: arrow leaving over the far end.
      if (isLand) arrows += arrow([e.p[0] - e.dir[0] * 15, e.p[1] - e.dir[1] * 15], [e.p[0] - e.dir[0] * 3, e.p[1] - e.dir[1] * 3], 'land');
      if (isDep) arrows += arrow([e.far[0] + e.dir[0] * 3, e.far[1] + e.dir[1] * 3], [e.far[0] + e.dir[0] * 15, e.far[1] + e.dir[1] * 15], 'dep');
    }
    for (const e of ends) {
      // Label beside the runway end, on the side facing away from the field centre.
      const active = landIds.has(e.id) || depIds.has(e.id);
      const off = active ? 8 : 5.5;
      let n = [-e.dir[1], e.dir[0]];
      if (n[0] * (e.p[0] - CX) + n[1] * (e.p[1] - CY) < 0) n = [-n[0], -n[1]];
      labels.push({ id: e.id, active, x: e.p[0] + n[0] * off + e.dir[0] * 4, y: e.p[1] + n[1] * off + e.dir[1] * 4 });
    }
    lines += `<line class="rw ${cls}" x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}"/>`;
  }
  // Runways in use always get their number; an idle number yields when it would sit under one.
  const texts = labels
    .filter((l) => l.active || !labels.some((o) => o.active && Math.hypot(o.x - l.x, o.y - l.y) < 10))
    .map((l) => `<text${l.active ? '' : ' class="idle"'} x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}">${l.id}</text>`)
    .join('');
  const svg = `<svg class="rwy-map" viewBox="16 -8 90 114" role="img" aria-label="Baangebruik op de kaart van Schiphol"><defs><radialGradient id="rwy-fade" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY}" r="84"><stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient><mask id="rwy-mask" maskUnits="userSpaceOnUse" x="-70" y="-40" width="250" height="190"><rect x="-70" y="-40" width="250" height="190" fill="url(#rwy-fade)"/></mask></defs><g class="osm" mask="url(#rwy-mask)">${tiles}</g>${lines}${arrows}${texts}</svg>`;
  return h('div', { style: 'display:contents', html: svg }).firstChild;
}

function renderEham() {
  const root = $('#eham');
  const { metar } = eham;

  /* weather */
  const wx = h('div', { class: 'eham-wx' });
  const head = h('div', { class: 'eham-head' }, h('span', { class: 'eham-id' }, 'EHAM'), h('span', { class: 'eham-name' }, 'Schiphol'));
  if (metar) {
    const p = parseMetar(metar.raw);
    const ageMin = metar.obsTime ? (Date.now() - metar.obsTime) / 60000 : 0;
    const dotCls = eham.metarFail ? 'bad' : ageMin > 75 ? 'warn' : '';
    if (metar.fltCat) head.append(h('span', { class: 'cat ' + metar.fltCat, title: 'Vliegcategorie' }, metar.fltCat));
    head.append(h('span', { class: 'eham-age', title: eham.metarFail ? 'Verbinding mislukt — laatst bekende waarneming' : 'Tijd van waarneming' }, h('span', { class: 'dot ' + dotCls }), metar.obsTime ? `METAR ${zulu(metar.obsTime)}` : 'METAR'));

    const metrics = h('div', { class: 'eham-metrics' });
    if (p.wind) {
      const calm = p.wind.spd === 0;
      const arrow = p.wind.dir === 'VRB' || calm ? null : h('span', { style: `display:flex;transform:rotate(${(+p.wind.dir + 180) % 360}deg)`, title: `Wind uit ${p.wind.dir}°` }, icon('arrowUp', 'wind-arrow'));
      metrics.append(metric('WIND', arrow, calm ? 'Stil' : `${p.wind.dir === 'VRB' ? 'VRB' : p.wind.dir + '°'} / ${p.wind.spd}`, p.wind.gust ? h('small', {}, `G${p.wind.gust}`) : null, calm ? null : h('small', {}, p.wind.unit)));
    }
    if (p.vis != null) metrics.append(metric('ZICHT', p.cavok ? 'CAVOK' : p.vis >= 9999 ? '≥10' : p.vis >= 5000 ? (p.vis / 1000).toFixed(0) : p.vis, p.cavok ? null : h('small', {}, p.vis >= 5000 ? 'km' : 'm')));
    const cloud = p.clouds.find((c) => /BKN|OVC|VV/.test(c.cover)) || p.clouds[0];
    metrics.append(metric('WOLKEN', cloud ? `${cloud.cover} ${cloud.base}` : p.cavok ? 'Geen' : 'NSC', cloud ? h('small', {}, 'ft' + (cloud.type ? ' ' + cloud.type : '')) : null));
    if (p.temp != null) metrics.append(metric('TEMP / DAUWP', `${p.temp}° / ${p.dew}°`));
    if (p.qnh) metrics.append(metric('QNH', p.qnh, h('small', {}, 'hPa')));
    if (p.wx.length) metrics.append(metric('WEER', p.wx.join(' ')));
    wx.append(head, metrics, h('div', { class: 'eham-raw', title: metar.raw + (metar.taf ? '\n\n' + metar.taf : '') }, metar.raw.replace(/^(METAR|SPECI)\s+/, '')));
  } else {
    head.append(h('span', { class: 'eham-age' }, h('span', { class: 'dot ' + (eham.metarFail ? 'bad' : 'warn') }), eham.metarFail ? 'Geen verbinding' : 'Laden…'));
    wx.append(head, h('div', { class: 'rwy-none' }, eham.metarFail ? 'Luchtvaartweer is tijdelijk niet beschikbaar.' : 'Luchtvaartweer wordt opgehaald…'), h('div', {}));
  }

  root.replaceChildren(wx);
}

/* runways: observed from live traffic */
const runwayViews = new Set();

function renderRunwayUse(root) {
  const live = eham.live;
  const connected = live && live.ok;
  const starting = !live || (!live.lastOk && Date.now() - live.startedAt < 45000) || (connected && Date.now() - live.watchingSince < 4 * 60000);
  const land = live ? live.landing : [], dep = live ? live.departure : [];
  const col = (cls, label, items) =>
    h('div', { class: 'rwy-col' }, h('span', { class: 'rwy-kind ' + cls }, label),
      items.length
        ? items.slice(0, 3).map((r) => h('div', { class: 'rwy-item ' + r.role, title: `${r.role === 'secondary' ? 'Secundaire baan' : 'Hoofdbaan'} — ${r.count} toestel(len) in het laatste kwartier, laatste om ${zulu(r.last)}` }, h('span', { class: 'rwy-num' }, r.rwy), h('span', { class: 'rwy-name' }, rwyName(r.rwy))))
        : h('div', { class: 'rwy-item' }, h('span', { class: 'rwy-name' }, starting ? '…' : connected ? 'geen verkeer' : '—')));

  let dot = '', srcText;
  if (connected && (land.length || dep.length)) srcText = `Live waargenomen · ${zulu(live.lastOk)}`;
  else if (starting) { dot = 'warn'; srcText = 'Baangebruik wordt bepaald…'; }
  else if (connected) { dot = 'warn'; srcText = 'Geen start- of landingsverkeer'; }
  else { dot = 'bad'; srcText = live.lastOk ? `Geen verbinding · laatst ${zulu(live.lastOk)}` : 'Geen verbinding met live-bron'; }

  root.replaceChildren(
    h('div', { class: 'rwy-grid' },
      h('div', { class: 'rwy-cols' }, col('land', 'LANDEN', land), col('dep', 'STARTEN', dep)),
      runwayMap(land, dep),
      h('div', { class: 'rwy-src', title: 'Het baangebruik wordt afgeleid uit het live vliegverkeer (ADS-B): toestellen op eindnadering en net na de start, over het laatste kwartier.' }, h('span', { class: 'dot ' + dot }), srcText, h('span', { class: 'rwy-credit' }, '© OpenStreetMap')))
  );
}

async function refreshMetar() {
  const res = await window.palv.data.metar('EHAM').catch(() => ({ ok: false }));
  if (res.ok) { eham.metar = res; eham.metarFail = false; } else eham.metarFail = true;
  renderEham();
  const m = eham.metar, obsAge = m && m.obsTime ? Date.now() - m.obsTime : Infinity;
  report('metar', 'METAR Schiphol', !eham.metarFail && obsAge < 75 * 60000,
    eham.metarFail ? (m ? `geen verbinding, laatste ${zulu(m.obsTime)}` : 'geen verbinding') : `waarneming ${zulu(m.obsTime)}`, 10 * 60000);
}
async function refreshRunways() {
  const res = await window.palv.data.runways().catch(() => null);
  if (res) eham.live = res;
  else if (eham.live) eham.live.ok = false;
  for (const paint of runwayViews) paint();
  const live = eham.live;
  if (!runwayViews.size) report('runways');
  else report('runways', 'Baangebruik', !!(live && live.ok), live && live.lastOk ? `laatst ${zulu(live.lastOk)}` : 'geen verbinding', 3 * 60000);
}

/* ============================================================
   Bronbewaking: a clear warning when a source has stopped delivering
   ============================================================ */
// Every source reports whether its data is current. One that stays behind for longer than its own grace
// shows in a red warning at the right of the tab bar, with when it last delivered.
const health = new Map(); // key -> { label, detail, since, grace }
const BOOT_GRACE = 90000;
const bootAt = Date.now();
// report(key) without a label: the source no longer exists (widget removed, page out of view).
function report(key, label, ok, detail, grace = 120000) {
  if (!label || ok) { if (health.delete(key)) paintHealth(); return; }
  const cur = health.get(key);
  health.set(key, { label, detail, grace, since: cur ? cur.since : Date.now() });
  paintHealth();
}
function paintHealth() {
  const el = $('#health');
  if (!el) return;
  const now = Date.now();
  const due = now - bootAt < BOOT_GRACE ? [] : [...health.values()].filter((e) => now - e.since >= e.grace);
  const sig = due.map((e) => e.label + e.detail).join('|');
  if (sig === el.dataset.sig) return;
  el.dataset.sig = sig;
  el.hidden = !due.length;
  if (!due.length) return el.replaceChildren();
  el.title = 'Deze bronnen leveren al een tijd geen verse gegevens. Wat ze tonen kan verouderd zijn; ze worden automatisch opnieuw geprobeerd.\n\n' + due.map((e) => `${e.label}: ${e.detail}`).join('\n');
  el.replaceChildren(
    h('span', { class: 'health-icon', html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2 20h20Z"/><path d="M12 10v4.5M12 17.5v.3"/></svg>' }),
    h('b', {}, 'GEEN VERSE GEGEVENS'),
    ...due.map((e) => h('span', { class: 'health-item' }, e.label, h('small', {}, e.detail)))
  );
}

/* ---------- own aircraft in the air ---------- */
const FLEET_GROUPS = { police: 'Politie', hems: 'Trauma', coastguard: 'Kustwacht' };
const fleetFeed = { data: null, views: new Set(), timer: null };
async function refreshFleet() {
  const groups = Object.fromEntries(Object.keys(FLEET_GROUPS).map((k) => [k, hexList(k)]));
  const res = await window.palv.data.fleet(groups).catch(() => null);
  fleetFeed.data = res || (fleetFeed.data && { ...fleetFeed.data, ok: false });
  for (const paint of fleetFeed.views) paint();
  const d = fleetFeed.data;
  report('fleet', 'In de lucht', !!(d && d.ok), d && d.lastOk ? `laatst ${zulu(d.lastOk)}` : 'geen verbinding', 3 * 60000);
}
function watchFleet(paint) {
  fleetFeed.views.add(paint);
  if (!fleetFeed.timer) { fleetFeed.timer = setInterval(refreshFleet, 10000); refreshFleet(); }
  return () => {
    fleetFeed.views.delete(paint);
    if (!fleetFeed.views.size) { clearInterval(fleetFeed.timer); fleetFeed.timer = null; report('fleet'); }
  };
}

const flightTime = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}:${pad2(m % 60)}`; };

function renderFleet(root) {
  const d = fleetFeed.data, now = Date.now();
  const list = d ? d.aircraft : [];
  const rows = list.map((a) => {
    const alert = a.emergency || /^(7500|7600|7700)$/.test(a.squawk || '');
    const climb = a.vs == null || Math.abs(a.vs) < 300 ? '' : a.vs > 0 ? ' ▲' : ' ▼';
    const time = a.onGround
      ? h('div', { class: 'fl-time' }, h('span', { class: 'fl-ground' }, 'GROND'))
      : h('div', { class: 'fl-time', title: a.approx ? (a.atLeast ? 'Was al in de lucht toen het dashboard startte; vliegt minstens zo lang.' : 'Starttijd niet uit de route te halen; geteld vanaf de eerste waarneming.') : `Gestart om ${zulu(a.takeoff)}` },
        h('b', {}, (a.atLeast ? '≥ ' : a.approx ? '≈ ' : '') + flightTime(now - a.takeoff)),
        h('small', {}, a.atLeast ? 'vliegtijd' : `start ${zulu(a.takeoff)}`));
    return h('div', { class: 'fl-row ' + a.group + (a.onGround ? ' ground' : '') + (alert ? ' alert' : ''), title: `${a.reg || a.hex.toUpperCase()}${a.type ? ' · ' + a.type : ''} · ${FLEET_GROUPS[a.group] || ''}${a.squawk ? ' · squawk ' + a.squawk : ''} · ${a.ageS} s geleden` },
      h('i', { class: 'fl-bar' }),
      h('div', { class: 'fl-id' }, h('b', {}, a.flight || a.reg || a.hex.toUpperCase()), h('small', {}, [a.flight && a.reg ? a.reg : null, a.type, FLEET_GROUPS[a.group]].filter(Boolean).join(' · '))),
      alert ? h('span', { class: 'fl-sq' }, a.emergency ? a.emergency.toUpperCase() : a.squawk) : null,
      h('div', { class: 'fl-num' }, h('b', {}, a.alt == null ? '—' : a.alt.toLocaleString('nl-NL')), h('small', {}, 'ft' + climb)),
      h('div', { class: 'fl-num fl-gs' }, h('b', {}, a.gs == null ? '—' : a.gs), h('small', {}, 'kt')),
      time);
  });
  const up = list.filter((a) => !a.onGround).length;
  let dot = '', src;
  if (!d) { dot = 'warn'; src = 'Laden…'; }
  else if (!d.ok) { dot = 'bad'; src = d.lastOk ? `Geen verbinding · laatst ${zulu(d.lastOk)}` : 'Geen verbinding met live-bron'; }
  else src = `Live · ${zulu(d.lastOk)} · ${d.tracked} toestellen gevolgd`;
  root.replaceChildren(
    h('div', { class: 'fl-list' }, rows.length ? rows : h('div', { class: 'fl-empty' }, icon('shield'), h('span', {}, d ? 'Geen eigen toestellen in de lucht' : 'Gegevens worden opgehaald…'))),
    h('div', { class: 'fl-src', title: 'Politie-, trauma- en kustwachttoestellen uit de lijsten onder Instellingen › ADS-B filter. Posities van adsb.lol (reserve adsb.fi), elke 10 seconden. De starttijd komt uit de gevlogen route bij ADS-B Exchange; ≈ betekent geteld vanaf de eerste waarneming.' },
      h('span', { class: 'dot ' + dot }), src, up ? h('span', { class: 'fl-count' }, `${up} in de lucht`) : null)
  );
}

/* ============================================================
   Widgets
   ============================================================ */
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
  wv.addEventListener('did-finish-load', () => { stateEl.remove(); api.failedSince = 0; });
  wv.addEventListener('did-fail-load', (e) => {
    if (!e.isMainFrame || e.errorCode === -3) return;
    api.failedSince = api.failedSince || Date.now();
    stateEl.replaceChildren(h('div', {}, h('strong', {}, 'Kan de pagina niet laden'), 'Controleer de internetverbinding. Er wordt automatisch opnieuw geprobeerd.'));
    body.append(stateEl);
    clearTimeout(retry);
    retry = setTimeout(() => api.load(), 30000);
  });
  const api = {
    wv,
    failedSince: 0, // since when the page has not loaded, 0 while it is there
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

const hexList = (...keys) =>
  keys.flatMap((k) => String(state.settings.hex[k] || '').split(/[^0-9a-fA-F]+/)).filter((x) => /^[0-9a-fA-F]{6}$/.test(x)).map((x) => x.toLowerCase());

// Zoom offset that keeps a view framed for a body of refH high (and REF_W / REF_H as wide) in sight:
// follows whichever of height or width is tighter, so the framed area never grows or shrinks within it.
const fitDelta = (body, refH) => {
  const wid = body ? body.clientWidth : 0, hgt = body ? body.clientHeight : 0;
  return wid > 50 && hgt > 50 ? Math.log2(Math.min(hgt / refH, wid / ((refH * REF_W) / REF_H))) : 0;
};
// Show an embedded page reduced or enlarged: it gets a proportionally larger or smaller viewport to lay out in.
const scaleWebview = (wv, s) => Object.assign(wv.style, { width: 100 / s + '%', height: 100 / s + '%', transform: `scale(${s})` });

// Below roughly this size the ADS-B site falls back to a cramped mobile layout that no longer centres
// the map, so a smaller widget shows the normal page reduced instead.
const adsbScale = (body) => (body && body.clientWidth > 50 && body.clientHeight > 50 ? Math.min(1, body.clientWidth / 704, body.clientHeight / 815) : 1);
// A view is { lat, lon, zoom, refH }: the zoom as it shows in a body of refH high, or exact when refH is empty.
const adsbZoom = (at, body) => (at.refH && body ? at.zoom + fitDelta(body, at.refH) - Math.log2(adsbScale(body)) : at.zoom);

// Windy only draws whole zoom levels (labels and base map drop out in between), so the remainder is
// made up by scaling the embedded page itself.
function windyFit(at, body) {
  if (!at.refH) return { zoom: clamp(Math.round(at.zoom), 3, 11), scale: 1 };
  const ideal = at.zoom + fitDelta(body, at.refH);
  // Leaning towards the higher level: a slightly reduced page stays sharper than an enlarged one.
  const zoom = clamp(Math.round(ideal + 0.25), 3, 11);
  return { zoom, scale: clamp(2 ** (ideal - zoom), 0.4, 2) };
}

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

function windyUrl(cfg, at, body) {
  const q = new URLSearchParams({
    type: 'map', location: 'coordinates', metricRain: 'mm', metricTemp: '°C', metricWind: 'kt',
    zoom: String(windyFit(at, body).zoom), overlay: cfg.overlay, product: cfg.overlay === 'radar' ? 'radar' : 'ecmwf', level: 'surface',
    lat: String(at.lat), lon: String(at.lon),
  });
  return 'https://embed.windy.com/embed.html?' + q.toString();
}

/* ---------- weather stations on the radar (METAR/TAF against the BOM minima) ---------- */
// Which stations show at which zoom: the main fields always, the other fields and the stations just
// across the border one step in, everything else (platforms, small stations) one step further.
const WX_TIER1 = ['EHAM', 'EHRD', 'EHGG', 'EHEH', 'EHBK', 'EHLE', 'EHKD', 'EHLW'];
const WX_TIER2 = ['EHVK', 'EHGR', 'EHWO', 'EHDL', 'EHVL', 'EHFS', 'EBAW', 'EBBR', 'EBLG', 'EDDL', 'EDDK', 'EDLN', 'EDLV', 'EDWE', 'ETNG', 'ETNN'];
const wxTier = (icao) => (WX_TIER1.includes(icao) ? 1 : WX_TIER2.includes(icao) ? 2 : 3);

// One feed for all radar widgets, refreshed every minute while at least one of them is on screen.
const wxFeed = { stations: [], lastOk: 0, fails: 0, subs: new Set(), timer: null };
async function refreshWx() {
  const res = await window.palv.data.wxmap().catch(() => ({ ok: false }));
  if (res.ok) { wxFeed.stations = WX.stations(res, Date.now()); wxFeed.lastOk = res.fetchedAt; wxFeed.fails = 0; }
  else wxFeed.fails += 1;
  for (const fn of wxFeed.subs) fn();
  const nl = wxFeed.stations.filter((s) => s.icao.startsWith('EH'));
  const newest = nl.length ? Math.max(...nl.map((s) => s.obsTime)) : 0;
  const fresh = !!wxFeed.lastOk && Date.now() - wxFeed.lastOk < 3 * 60000;
  if (wxFeed.subs.size) report('wx', 'Weerstations', fresh && Date.now() - newest < 90 * 60000, !fresh ? (wxFeed.lastOk ? `laatst opgehaald ${zulu(wxFeed.lastOk)}` : 'geen verbinding') : `nieuwste METAR ${zulu(newest)}`, 7 * 60000);
}
// Margins for "marginal" from the settings into the assessment, and every radar repainted with them.
function applyWxMargins() {
  WX.margins.ft = clamp(+state.settings.wxMarginFt || 0, 0, 2000);
  WX.margins.m = clamp(+state.settings.wxMarginM || 0, 0, 5000);
  for (const fn of wxFeed.subs) fn();
}
function watchWx(fn) {
  wxFeed.subs.add(fn);
  if (!wxFeed.timer) { wxFeed.timer = setInterval(refreshWx, 60000); refreshWx(); }
  return () => { wxFeed.subs.delete(fn); if (!wxFeed.subs.size) { clearInterval(wxFeed.timer); wxFeed.timer = null; report('wx'); } };
}

const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const WX_GLYPH = { green: '<path d="M4.4 8.3 7 10.8l4.6-5.4"/>', amber: '<path d="M8 4v5M8 11.7v.3"/>', red: '<path d="m5 5 6 6M11 5l-6 6"/>', none: '<path d="M5 8h6"/>' };
const WX_LABEL = { green: 'Binnen limieten', red: 'Buiten limieten', none: 'Geen oordeel' };
const wxArrow = (tr) => (tr.dir ? `<svg class="pw-arr ${tr.dir < 0 ? 'down' : 'up'} ${tr.kind}" viewBox="0 0 12 14"><path d="M6 1.2 11 7.2H7.8v5.6H4.2V7.2H1Z"/></svg>` : '');

function wxMarkerHtml(st, a) {
  const wind = WX.windText(st.metar.wind);
  return `<div class="pw ${a.status}"><span class="pw-dot"><svg viewBox="0 0 16 16">${WX_GLYPH[a.status]}</svg>${a.aw139 ? '<i class="pw-plus">+</i>' : ''}</span><span class="pw-lab">${wxArrow(a.trend)}<b>${escHtml(st.icao)}</b>${wind ? `<span>${wind}</span>` : ''}${a.aw139 ? '<em>AW139</em>' : ''}</span></div>`;
}

function wxPopupHtml(st, pid, now) {
  const m = st.metar;
  const vis = m.vis == null ? 'niet gemeten' : m.cavok ? 'CAVOK' : m.vis >= 9999 ? '≥ 10 km' : `${m.vis} m`;
  const cloud = m.layers.length ? m.layers.map((l) => `${l.cover} ${l.base} ft`).join(', ') : m.cloud === 'none' ? 'geen' : m.vv != null ? `verticaal zicht ${m.vv < 0 ? 'onbekend' : m.vv + ' ft'}` : 'niet gemeten';
  const wind = m.wind ? (m.wind.spd === 0 ? 'stil' : `${WX.windText(m.wind)} ${m.wind.unit === 'MPS' ? '' : 'kt'}`) : 'niet gemeten';
  const rows = WX.PROFILES.map((p) => {
    const r = WX.assess(p.id, st, now);
    const label = r.status === 'amber' ? (r.marginal ? 'Marginaal' : 'Verwacht buiten limieten') : r.stale ? 'Waarneming te oud' : WX_LABEL[r.status];
    return `<tr class="${r.status}${p.id === pid ? ' sel' : ''}"><td>${p.name}${p.aw139 ? ' <em>alleen AW139</em>' : ''}</td><td><i></i>${label}</td></tr>`;
  }).join('');
  const tr = WX.assess(pid, st, now).trend;
  const src = { METAR: 'METAR-trend (2 uur)', TAF: 'TAF, komende 2 uur', OBS: 'Waargenomen verloop, laatste uur' }[tr.src];
  const dir = tr.dir < 0 ? 'verslechterend' : tr.dir > 0 ? 'verbeterend' : 'geen verandering';
  const kind = tr.dir && tr.kind !== 'obs' ? (tr.kind === 'tempo' ? ', tijdelijk' : ', blijvend') : '';
  const trend = src ? `<div class="pp-t"><span>${src}</span>${wxArrow(tr)}<b>${dir}${kind}</b>${tr.text ? `<code>${escHtml(tr.text)}</code>` : ''}</div>` : '<div class="pp-t"><span>Trend</span><b>niet beschikbaar</b></div>';
  return `<div class="pp"><div class="pp-h"><b>${escHtml(st.icao)}</b><span>${escHtml(String(st.name || '').split(',')[0])}</span><i>${zulu(st.obsTime)} · ${Math.max(0, Math.round((now - st.obsTime) / 60000))} min</i></div>`
    + `<div class="pp-m"><div><span>WIND</span>${wind}</div><div><span>ZICHT</span>${vis}</div><div><span>BEWOLKING</span>${cloud}</div></div>${trend}<table>${rows}</table>`
    + `<pre>${escHtml(st.raw)}</pre>${st.tafRaw ? `<pre>${escHtml(st.tafRaw)}</pre>` : ''}</div>`;
}

// Runs inside the Windy page: keeps one Leaflet marker per station on Windy's own map, so the dots
// stay on their coordinates through every pan and zoom. Returns null while the map is not there yet.
function wxInject(p) {
  if (typeof W === 'undefined' || typeof L === 'undefined' || !W.map || !W.map.map) return null;
  const map = W.map.map;
  let S = window.__palvWx;
  if (!S || S.map !== map) {
    S = window.__palvWx = { map, mk: new Map(), scale: 1 };
    S.show = () => {
      const z = map.getZoom() + Math.log2(S.scale || 1);
      for (const m of S.mk.values()) {
        const on = m.tier === 1 || (m.tier === 2 ? z >= 7.5 : z >= 8.6);
        if (on && !map.hasLayer(m.l)) m.l.addTo(map);
        else if (!on && map.hasLayer(m.l)) map.removeLayer(m.l);
      }
    };
    map.on('zoomend', S.show);
    // Opening a station's popup lets the map slide to make room for it. Where the map stood is kept
    // (S.back) and it returns there once the popup is closed, unless another station was opened at once.
    S.popup = () => !!(map._popup && map.hasLayer(map._popup));
    map.on('popupclose', () => setTimeout(() => {
      if (!S.back || S.popup()) return;
      const b = S.back;
      S.back = null;
      if (window.__palvIn) window.__palvIn.t = 0;
      map.setView(b.c, b.z, { animate: true, duration: 0.3 });
    }, 0));
  }
  S.scale = p.scale;
  const seen = new Set();
  for (const s of p.stations) {
    seen.add(s.id);
    let m = S.mk.get(s.id);
    if (!m) {
      m = { l: L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'pw-icon', html: s.html, iconSize: [0, 0] }), keyboard: false, zIndexOffset: 1000 - s.tier * 100 }), html: s.html, pop: s.pop };
      m.l.on('click', () => { if (!S.popup()) S.back = { c: map.getCenter(), z: map.getZoom() }; }); // before the popup opens
      m.l.bindPopup(s.pop, { className: 'pw-pop', maxWidth: 420, minWidth: 300, closeButton: false, offset: [0, -10], autoPanPaddingTopLeft: [12, 56], autoPanPaddingBottomRight: [12, 70] });
      S.mk.set(s.id, m);
    }
    if (m.html !== s.html) m.l.setIcon(L.divIcon({ className: 'pw-icon', html: s.html, iconSize: [0, 0] }));
    if (m.pop !== s.pop) m.l.setPopupContent(s.pop);
    m.html = s.html; m.pop = s.pop; m.tier = s.tier;
  }
  for (const [id, m] of S.mk) if (!seen.has(id)) { map.removeLayer(m.l); S.mk.delete(id); }
  S.show();
  const info = { n: S.mk.size, radar: null, overlay: null };
  try { info.overlay = W.store.get('overlay'); const c = W.store.get('radarCalendar'); info.radar = (c && (c.refTimeTs || c.updateTs)) || null; } catch (e) {}
  return info;
}

const WX_CSS = `
.pw-icon{overflow:visible!important}
.pw{position:absolute;left:-11px;top:-11px;display:flex;align-items:center;white-space:nowrap;cursor:pointer;font:600 12px/1 "Segoe UI",system-ui,sans-serif}
.pw-dot{position:relative;width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1.5px rgba(4,10,20,.85),0 2px 6px rgba(0,0,0,.6);display:grid;place-items:center;flex:none}
.pw-dot svg{width:14px;height:14px;fill:none;stroke:#04101e;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}
.pw.green .pw-dot{background:#2fd67b}.pw.amber .pw-dot{background:#ffb020}.pw.red .pw-dot{background:#ff4d42}.pw.none .pw-dot{background:#7c8aa0}
.pw.red .pw-dot svg,.pw.none .pw-dot svg{stroke:#fff}
.pw-plus{position:absolute;top:-8px;right:-8px;width:14px;height:14px;border-radius:50%;background:#38bdf8;color:#04101e;border:1.5px solid #04101e;font:800 12px/11px "Segoe UI",sans-serif;text-align:center;font-style:normal}
.pw-lab{display:flex;align-items:center;gap:5px;margin-left:5px;padding:4px 7px;border-radius:4px;background:rgba(7,13,24,.9);border:1px solid rgba(255,255,255,.2);color:#fff;letter-spacing:.02em;box-shadow:0 2px 6px rgba(0,0,0,.45)}
.pw-lab span{color:#c6d4e8;font-variant-numeric:tabular-nums}
.pw-lab em{font-style:normal;font-size:10px;font-weight:700;color:#7dd3fc}
.pw-arr{width:10px;height:12px;flex:none;stroke-width:1.5;stroke-linejoin:round}
.pw-arr.down{transform:rotate(180deg);fill:#ff6b60;stroke:#ff6b60}.pw-arr.up{fill:#3ee08a;stroke:#3ee08a}
.pw-arr.tempo,.pw-arr.obs{fill:none}.pw-arr.obs{stroke-dasharray:2 1.6}
.pw-pop .leaflet-popup-content-wrapper{background:#0b1422;color:#e9eff8;border:1px solid #2b3d5c;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.6);padding:0}
.pw-pop .leaflet-popup-tip{background:#0b1422;border:1px solid #2b3d5c}
.pw-pop .leaflet-popup-content{margin:0;width:auto!important}
.pp{padding:12px 14px;font:400 12px/1.4 "Segoe UI",system-ui,sans-serif;min-width:300px}
.pp-h{display:flex;align-items:baseline;gap:8px}.pp-h b{font-size:17px;letter-spacing:.05em}.pp-h span{color:#a9bad3;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pp-h i{font-style:normal;color:#a9bad3;font-variant-numeric:tabular-nums;white-space:nowrap}
.pp-m{display:flex;gap:16px;margin:10px 0;font-size:13px;font-weight:600}.pp-m span,.pp-t span{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;color:#8ea2bf}
.pp-t{margin:0 0 10px;font-size:13px}.pp-t .pw-arr{display:inline-block;margin-right:5px;vertical-align:-1px}.pp-t code{display:block;margin-top:2px;font:400 11px/1.4 Consolas,monospace;color:#a9bad3;white-space:normal}
.pp table{width:100%;border-collapse:collapse}.pp td{padding:4px 6px;border-top:1px solid #1e2c44;white-space:nowrap}.pp td:first-child{text-align:left}.pp td:last-child{text-align:right;font-weight:600}
.pp tr.sel td{background:#16233a}.pp td em{font-style:normal;font-size:10px;font-weight:700;color:#7dd3fc;margin-left:4px}
.pp td i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:#7c8aa0}
.pp tr.green td i{background:#2fd67b}.pp tr.amber td i{background:#ffb020}.pp tr.red td i{background:#ff4d42}
.pp pre{margin:10px 0 0;padding:8px;border-radius:5px;background:#060c16;color:#c6d4e8;font:400 11px/1.45 Consolas,monospace;white-space:pre-wrap;word-break:break-word;user-select:text}
`;

const normalizeUrl = (u) => { const s = String(u || '').trim(); return !s ? 'about:blank' : /^[a-z]+:\/\//i.test(s) ? s : 'https://' + s; };

const reloadTool = (view) => h('button', { class: 'w-tool', title: 'Vernieuwen', onclick: () => view.load() }, icon('refresh'));
const recentreTool = (keep) => h('button', { class: 'w-tool', title: 'Kaart terugzetten naar de standaardpositie en het standaard zoomniveau', onclick: () => keep.reset() }, icon('target'));
// On/off switch with its label for a widget's title bar; `paint` sets it to the current state.
function switchTool(label, title, isOn, onToggle) {
  const el = h('button', { class: 'switch', role: 'switch', title, onclick: () => { onToggle(); el.paint(); } }, label, h('span', { class: 'switch-track' }));
  el.paint = () => { el.classList.toggle('on', !!isOn()); el.setAttribute('aria-checked', String(!!isOn())); };
  el.paint();
  return el;
}

const WIDGETS = {
  adsb: {
    name: 'ADS-B',
    desc: 'Live vliegverkeer van ADS-B Exchange met snelfilters: alles, militair of politie & hulpdiensten.',
    icon: 'plane',
    size: [54, 54],
    defaults: { mode: 'all', lat: 52.077, lon: 5.1848, zoom: 8.16, refH: REF_H, sidebar: false, trails: true, labels: false },
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
      const checkHealth = (info) => {
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
      return { destroy() { keep.stop(); clearInterval(routeTimer); view.destroy(); report(hkey); } };
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
  },

  windy: {
    name: 'Windy weerradar',
    desc: 'Windy.com, gecentreerd op Nederland en startend op de weerradar.',
    icon: 'radar',
    size: [40, 36],
    defaults: { overlay: 'radar', lat: 52.1487, lon: 5.3025, zoom: 8.353, refH: REF_H, autoplay: true },
    mount(w, body, tools) {
      let scale = 1; // of the embedded page, as last set
      const fit = (at) => { const f = windyFit(at, body); scaleWebview(view.wv, (scale = f.scale)); return f; };
      const keep = keepView(w, body, {
        sample: `(() => { if (typeof W === 'undefined' || !W.map || !W.map.map) return null; ${INPUT_JS} const m = W.map.map, c = m.getCenter(); return { lat: c.lat, lon: c.lng, zoom: m.getZoom(), idle: Date.now() - window.__palvIn.t, hold: !!(window.__palvWx && window.__palvWx.back && window.__palvWx.popup()) }; })()`,
        place: (at) => `(() => { if (typeof W === 'undefined' || !W.map || !W.map.map) return false; const m = W.map.map; m.invalidateSize(false); m.setView([${+at.lat}, ${+at.lon}], ${fit(at).zoom}, { animate: false }); if (window.__palvIn) window.__palvIn.t = 0; return true; })()`,
        expect: (at) => ({ lat: +at.lat, lon: +at.lon, zoom: windyFit(at, body).zoom }),
        adopt: (s) => ({ lat: s.lat, lon: s.lon, zoom: s.zoom + Math.log2(scale) - fitDelta(body, REF_H), refH: REF_H }),
      });
      const view = makeWebview(body, () => windyUrl(w.cfg, keep.current(), body));
      // Start the radar animation, and resume it if the embed stops; Windy has no autoplay parameter.
      // Keeps pressing until the loop is really running: a press right after loading can land before the radar is ready.
      const press = () => view.wv.executeJavaScript("(() => { const b = document.querySelector('.play-pause'); if (!b) return 'none'; if (!b.classList.contains('off')) return 'playing'; b.click(); return 'pressed'; })()").catch(() => 'none');
      let tries = 0, kick = null;
      const start = () => { clearInterval(kick); tries = 0; kick = setInterval(async () => { if ((await press()) === 'playing' || ++tries > 60) clearInterval(kick); }, 700); };
      const watchdog = setInterval(() => w.cfg.autoplay && press(), 20000);
      view.wv.addEventListener('did-finish-load', () => w.cfg.autoplay && start());
      // Station layer: METAR/TAF stations drawn on Windy's own map, coloured against the chosen BOM profile.
      const status = h('div', { class: 'wxm-status' });
      body.append(status);
      let mapInfo = null, lastPush = 0;
      const paintStatus = () => {
        const now = Date.now();
        const nl = wxFeed.stations.filter((s) => s.icao.startsWith('EH'));
        const newest = nl.length ? Math.max(...nl.map((s) => s.obsTime)) : 0;
        const radar = mapInfo && mapInfo.overlay === 'radar' ? mapInfo.radar : null;
        let level = 'live', label = 'LIVE';
        if (!wxFeed.lastOk) [level, label] = wxFeed.fails ? ['bad', 'GEEN VERBINDING'] : ['warn', 'LADEN'];
        else if (now - wxFeed.lastOk > 10 * 60000) [level, label] = ['bad', 'GEEN VERBINDING'];
        else if (now - newest > 90 * 60000) [level, label] = ['bad', 'METAR VEROUDERD'];
        else if (!mapInfo) [level, label] = ['warn', 'KAART LADEN'];
        else if (now - wxFeed.lastOk > 150000) [level, label] = ['warn', 'VERBINDING HAPERT'];
        else if (now - newest > 50 * 60000) [level, label] = ['warn', 'METAR VERTRAAGD'];
        else if (radar && now - radar > 20 * 60000) [level, label] = ['warn', 'RADAR VERTRAAGD'];
        const d = new Date(wxFeed.lastOk);
        status.className = 'wxm-status ' + level;
        status.title = 'Groen: gegevens zijn actueel en worden elke minuut opgehaald. Oranje: vertraagd of nog aan het laden. Rood: geen verbinding of verouderd.\nBolletjes: groen binnen limieten, oranje marginaal of verwacht buiten limieten, rood buiten limieten, grijs geen oordeel.\nPijl: trend (dicht = blijvend, open = tijdelijk, gestippeld = waargenomen verloop). Plus: alleen AW139 (Advanced Operations).';
        status.replaceChildren(...[
          h('span', { class: 'wxm-dot' }), h('b', {}, label),
          newest ? h('span', {}, `METAR ${zulu(newest)}`) : null,
          radar ? h('span', {}, `Radar ${zulu(radar)}`) : null,
          wxFeed.lastOk ? h('span', {}, `Opgehaald ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`) : null,
        ].filter(Boolean));
      };
      const push = async () => {
        if (!view.wv.isConnected) return;
        lastPush = Date.now();
        const pid = w.cfg.profile || 'mpd';
        const stations = wxFeed.stations.map((st) => ({ id: st.icao, lat: st.lat, lon: st.lon, tier: wxTier(st.icao), html: wxMarkerHtml(st, WX.assess(pid, st, lastPush)), pop: wxPopupHtml(st, pid, lastPush) }));
        try { mapInfo = await view.wv.executeJavaScript(`(${wxInject})(${JSON.stringify({ scale, stations })})`); } catch { mapInfo = null; }
        paintStatus();
      };
      view.wv.addEventListener('dom-ready', () => view.wv.insertCSS(WX_CSS).catch(() => {}));
      view.wv.addEventListener('did-navigate', () => { mapInfo = null; });
      // The profile follows UDP: at each boundary it switches to the profile last used for that period.
      // A profile picked from the other period is a look ahead and holds until the next boundary.
      const group = (period, label) => h('optgroup', { label }, WX.PROFILES.filter((p) => p.period === period).map((p) => h('option', { value: p.id }, p.name + (p.aw139 ? ' — alleen AW139' : ''))));
      const prof = h('select', { class: 'input wxm-prof', onchange: () => { const p = WX.profile(prof.value); w.cfg.profile = p.id; w.cfg[p.period + 'Profile'] = p.id; save(); followUdp(); push(); } }, group('day', 'Dag — binnen UDP'), group('night', 'Nacht — buiten UDP'));
      const followUdp = () => {
        const period = udpToday().day ? 'day' : 'night';
        const switched = w.cfg.udpPeriod !== period;
        if (switched) {
          const kept = WX.profile(w.cfg.profile).period === period && w.cfg.profile;
          w.cfg.udpPeriod = period;
          w.cfg.profile = w.cfg[period + 'Profile'] || kept || (period === 'day' ? 'mpd' : 'aided');
          save();
        }
        const manual = WX.profile(w.cfg.profile).period !== period;
        prof.value = w.cfg.profile;
        prof.classList.toggle('manual', manual);
        prof.title = manual ? `Handmatig gekozen terwijl het ${period === 'day' ? 'dag' : 'nacht'} is; schakelt bij de volgende UDP-grens automatisch om.` : 'BOM-profiel waaraan de meetstations worden getoetst. Volgt automatisch dag en nacht volgens UDP.';
        return switched;
      };
      followUdp();
      const unwatch = watchWx(push);
      // Keeps trying until the map exists, then keeps ages, radar time and the status current.
      // Radar picture for the warning in the tab bar, judged only while the widget is in view.
      const hkey = 'radar:' + w.id;
      const checkHealth = () => {
        const radar = mapInfo && mapInfo.overlay === 'radar' ? mapInfo.radar : null;
        if (!onScreen(body)) report(hkey);
        else if (view.failedSince) report(hkey, 'Weerradar', false, `pagina laadt niet sinds ${zulu(view.failedSince)}`, 3 * 60000);
        else report(hkey, 'Weerradar', !radar || Date.now() - radar < 30 * 60000, radar ? `radarbeeld ${zulu(radar)}` : '', 2 * 60000);
      };
      const tick = setInterval(() => { (followUdp() || !mapInfo || Date.now() - lastPush > 15000 ? push() : paintStatus()); checkHealth(); }, 2000);
      paintStatus();
      tools.append(prof, recentreTool(keep), reloadTool(view));
      fit(keep.current());
      keep.attach(view);
      return { destroy() { keep.stop(); unwatch(); clearInterval(tick); clearInterval(kick); clearInterval(watchdog); view.destroy(); report(hkey); } };
    },
    form(cfg) {
      const overlay = h('select', { class: 'input' }, [['radar', 'Weerradar'], ['rain', 'Regen & onweer'], ['wind', 'Wind'], ['gust', 'Windstoten'], ['clouds', 'Bewolking'], ['lclouds', 'Lage bewolking'], ['cbase', 'Wolkenbasis'], ['visibility', 'Zicht'], ['temp', 'Temperatuur'], ['satellite', 'Satelliet'], ['thunder', 'Onweer']].map(([v, l]) => h('option', { value: v }, l)));
      overlay.value = cfg.overlay;
      const lat = textInput(cfg.lat), lon = textInput(cfg.lon), zoom = textInput(cfg.zoom);
      let autoplay = cfg.autoplay !== false;
      return {
        el: [field('Kaartlaag bij opstarten', overlay), h('div', { class: 'row' }, field('Breedtegraad', lat), field('Lengtegraad', lon), field('Zoom', zoom)), checkbox('Radar automatisch afspelen', autoplay, (v) => (autoplay = v))],
        // An untouched zoom keeps scaling with the widget; one filled in by hand is a whole Windy level, held exactly.
        read: () => { const def = WIDGETS.windy.defaults, z = parseFloat(zoom.value) || def.zoom, same = z === cfg.zoom; return { overlay: overlay.value, lat: parseFloat(lat.value) || def.lat, lon: parseFloat(lon.value) || def.lon, zoom: same ? z : Math.round(z), refH: same ? cfg.refH : null, autoplay }; },
      };
    },
  },

  web: {
    name: 'Website',
    desc: 'Toon een willekeurige website in een schaalbaar venster.',
    icon: 'globe',
    size: [36, 30],
    defaults: { url: 'https://www.knmi.nl/nederland-nu/luchtvaart', refreshMin: 0 },
    mount(w, body, tools) {
      const view = makeWebview(body, () => normalizeUrl(w.cfg.url));
      tools.append(reloadTool(view));
      const timer = w.cfg.refreshMin > 0 ? setInterval(() => view.load(), w.cfg.refreshMin * 60000) : null;
      return { destroy() { clearInterval(timer); view.destroy(); } };
    },
    form(cfg) {
      const url = textInput(cfg.url, { placeholder: 'https://…' }), refresh = textInput(cfg.refreshMin, { type: 'number', min: 0 });
      return {
        el: [field('Webadres', url), field('Automatisch vernieuwen (minuten)', refresh, '0 = niet automatisch vernieuwen.')],
        read: () => ({ url: url.value.trim(), refreshMin: Math.max(0, parseInt(refresh.value, 10) || 0) }),
      };
    },
  },

  tile: {
    name: 'App-tegel',
    desc: 'Snelkoppeling om een programma, bestand of website te openen.',
    icon: 'apps',
    size: [10, 9],
    chromeless: true,
    defaults: { kind: 'app', target: '', args: '', icon: null },
    mount(w, body) {
      const iconEl = h('span', { class: 'tile-icon' }, w.cfg.icon ? h('img', { src: w.cfg.icon, alt: '' }) : icon(w.cfg.kind === 'url' ? 'globe' : 'apps'));
      body.append(
        h('button', { class: 'tile-btn', title: w.cfg.target || 'Nog niet ingesteld', onclick: async () => {
          if (editing) return;
          if (!w.cfg.target) return openWidgetConfig(w);
          const res = await window.palv.tile.launch(w.cfg);
          if (!res.ok) toast(`"${w.title}" kon niet worden geopend: ${res.error}`, true);
        } }, iconEl, h('span', { class: 'tile-label' }, w.title))
      );
      if (!w.cfg.icon && w.cfg.target) {
        window.palv.tile.icon(w.cfg).then((data) => {
          if (!data || !iconEl.isConnected) return;
          w.cfg.icon = data;
          iconEl.replaceChildren(h('img', { src: data, alt: '' }));
          save();
        }).catch(() => {});
      }
      return {};
    },
    form(cfg) {
      let kind = cfg.kind, iconData = cfg.icon;
      const target = textInput(cfg.target, { placeholder: kind === 'url' ? 'https://…' : APP_HINT });
      const args = textInput(cfg.args, { placeholder: 'Optioneel' });
      const browse = h('button', { class: 'btn', onclick: async () => {
        const res = await window.palv.tile.pickFile();
        if (!res) return;
        target.value = res.path;
        iconData = res.icon;
        const title = $('#cfg-title');
        if (title && (!title.value.trim() || title.value === 'App-tegel')) title.value = res.name;
      } }, icon('folder'), 'Bladeren…');
      const argsField = field('Opstartparameters', args);
      const sync = () => { browse.style.display = argsField.style.display = kind === 'url' ? 'none' : ''; target.placeholder = kind === 'url' ? 'https://…' : APP_HINT; };
      const seg = segmented([{ value: 'app', label: 'Programma of bestand', icon: 'apps' }, { value: 'url', label: 'Website', icon: 'globe' }], kind, (v) => { kind = v; iconData = null; sync(); });
      sync();
      return {
        el: [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Soort'), seg), h('div', { class: 'row' }, field('Doel', target), browse), argsField],
        read: () => ({ kind, target: target.value.trim(), args: args.value.trim(), icon: target.value.trim() === cfg.target && kind === cfg.kind ? iconData : (iconData !== cfg.icon ? iconData : null) }),
      };
    },
  },

  metar: {
    name: 'METAR / TAF',
    desc: 'Actueel luchtvaartweer en verwachting voor een vliegveld naar keuze.',
    icon: 'cloud',
    size: [30, 18],
    defaults: { icao: 'EHAM' },
    mount(w, body) {
      const root = h('div', { class: 'wx-widget' }, 'Laden…');
      body.append(root);
      const load = async () => {
        const res = await window.palv.data.metar(w.cfg.icao).catch(() => ({ ok: false, error: 'Geen verbinding' }));
        if (!res.ok) {
          if (!root.dataset.ok) root.replaceChildren(h('div', { class: 'wx-head' }, h('span', { class: 'wx-icao' }, w.cfg.icao)), res.error || 'Niet beschikbaar');
          return;
        }
        root.dataset.ok = '1';
        root.replaceChildren(
          h('div', { class: 'wx-head' }, h('span', { class: 'wx-icao' }, res.icao), res.fltCat ? h('span', { class: 'cat ' + res.fltCat }, res.fltCat) : null, h('span', { class: 'wx-name' }, (res.name || '').split(',')[0])),
          h('div', {}, h('h4', {}, 'METAR'), h('pre', {}, res.raw)),
          res.taf ? h('div', {}, h('h4', {}, 'TAF'), h('pre', {}, res.taf.replace(/\s+(BECMG|TEMPO|PROB\d{2}|FM\d{6})/g, '\n  $1').replace(/\n\s+(PROB\d{2})\n\s+(TEMPO)/g, '\n  $1 $2'))) : null
        );
      };
      load();
      const timer = setInterval(load, 5 * 60000);
      return { destroy: () => clearInterval(timer) };
    },
    form(cfg) {
      const icao = textInput(cfg.icao, { maxlength: 4, style: 'text-transform:uppercase' });
      return { el: [field('ICAO-code vliegveld', icao, 'Bijvoorbeeld EHAM, EHRD, EHGG, EHBK, EHEH, EHLE of EHKD.')], read: () => ({ icao: (icao.value.trim().toUpperCase() || 'EHAM') }) };
    },
  },

  runway: {
    name: 'Baangebruik Schiphol',
    desc: 'Actuele start- en landingsbanen van Schiphol, live waargenomen uit het vliegverkeer.',
    icon: 'plane',
    size: [24, 36],
    mount(w, body) {
      const root = h('div', { class: 'rwy-widget' });
      body.append(root);
      const paint = () => renderRunwayUse(root);
      runwayViews.add(paint);
      paint();
      return { destroy: () => runwayViews.delete(paint) };
    },
  },

  fleet: {
    name: 'In de lucht',
    desc: 'Politie-, trauma- en kustwachttoestellen die nu vliegen, met hoogte, snelheid en vliegtijd.',
    icon: 'shield',
    size: [24, 18],
    mount(w, body) {
      const root = h('div', { class: 'fl-widget' });
      body.append(root);
      const paint = () => renderFleet(root);
      paint();
      const unwatch = watchFleet(paint);
      const tick = setInterval(paint, 20000); // flight times run on between updates
      return { destroy() { unwatch(); clearInterval(tick); } };
    },
  },

  note: {
    name: 'Notitie',
    desc: 'Vrij tekstvak voor dienstmededelingen of aantekeningen.',
    icon: 'note',
    size: [24, 18],
    defaults: { text: '' },
    mount(w, body) {
      body.append(h('textarea', { class: 'note-area', placeholder: 'Typ hier een notitie…', value: w.cfg.text, oninput: (e) => { w.cfg.text = e.target.value; save(); } }));
      return {};
    },
  },
};

/* ---------- widget frame ---------- */
function applyGeometry(el, w) {
  el.style.left = (w.x / COLS) * 100 + '%';
  el.style.top = (w.y / ROWS) * 100 + '%';
  el.style.width = (w.w / COLS) * 100 + '%';
  el.style.height = (w.h / ROWS) * 100 + '%';
  el.style.zIndex = w.z || 1;
  const size = el.querySelector('.w-edit-size');
  if (size) size.textContent = `${Math.round((w.w / COLS) * 100)} × ${Math.round((w.h / ROWS) * 100)} %`;
}

function mountWidget(page, w) {
  destroyWidget(w.id);
  const def = WIDGETS[w.type];
  const body = h('div', { class: 'w-body' });
  const tools = h('div', { class: 'w-tools' });
  const title = h('span', { class: 'w-title' }, w.title);
  const panel = h('div', { class: 'w-panel' }, def.chromeless ? null : h('div', { class: 'w-head' }, icon(def.icon, 'w-head-icon'), title, tools), body);
  // The title shows whenever it fits in full beside the controls; rather than cut off, it leaves the icon to stand for it.
  const titleFit = new ResizeObserver(() => { title.style.display = ''; if (title.scrollWidth > title.clientWidth + 1) title.style.display = 'none'; });
  titleFit.observe(panel);
  titleFit.observe(tools);
  const edit = h(
    'div',
    { class: 'w-edit' },
    h('span', { class: 'w-edit-name' }, w.title),
    h(
      'div',
      { class: 'w-edit-actions' },
      h('button', { title: 'Instellen', onclick: () => openWidgetConfig(w) }, icon('gear')),
      h('button', { class: 'danger', title: 'Verwijderen', onclick: () => removeWidget(w) }, icon('trash'))
    ),
    h('span', { class: 'w-edit-size' }),
    ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) => h('span', { class: 'handle ' + dir, 'data-dir': dir }))
  );
  const el = h('div', { class: 'widget ' + w.type, 'data-id': w.id }, panel, edit);
  edit.addEventListener('pointerdown', (e) => startDrag(e, page, w, el));
  edit.querySelectorAll('button').forEach((b) => b.addEventListener('pointerdown', (e) => e.stopPropagation()));
  applyGeometry(el, w);
  pageEls.get(page.id).append(el);
  const inst = def.mount(w, body, tools) || {};
  instances.set(w.id, { el, destroy: () => { titleFit.disconnect(); if (inst.destroy) inst.destroy(); } });
  updateEmptyState(page);
}

function destroyWidget(id) {
  const inst = instances.get(id);
  if (!inst) return;
  if (inst.destroy) inst.destroy();
  inst.el.remove();
  instances.delete(id);
}

function removeWidget(w) {
  const page = state.pages.find((p) => p.widgets.includes(w));
  confirmDialog('Widget verwijderen', `"${w.title}" van deze pagina verwijderen?`, 'Verwijderen', () => {
    destroyWidget(w.id);
    page.widgets.splice(page.widgets.indexOf(w), 1);
    updateEmptyState(page);
    save();
  });
}

function updateEmptyState(page) {
  const el = pageEls.get(page.id);
  if (!el) return;
  let empty = el.querySelector('.page-empty');
  if (page.widgets.length) { if (empty) empty.remove(); return; }
  if (empty) return;
  el.append(
    h('div', { class: 'page-empty' }, h('div', {}, h('h2', {}, 'Deze pagina is nog leeg'), h('p', {}, 'Voeg widgets en app-tegels toe en sleep ze naar de gewenste plek.'), h('button', { class: 'btn primary', onclick: openAddWidget }, icon('plus'), 'Widget toevoegen')))
  );
}

/* ---------- drag & resize ---------- */
function startDrag(e, page, w, el) {
  if (!editing || e.button !== 0) return;
  e.preventDefault();
  const dir = e.target.dataset.dir || 'move';
  const rect = pageEls.get(page.id).getBoundingClientRect();
  const cw = rect.width / COLS, ch = rect.height / ROWS;
  const start = { mx: e.clientX, my: e.clientY, x: w.x, y: w.y, w: w.w, h: w.h };
  const step = state.settings.snap ? 1 : 0.25;
  const q = (v) => Math.round(v / step) * step;
  const [minW, minH] = w.type === 'tile' ? [5, 5] : [10, 8];
  w.z = Math.max(1, ...page.widgets.map((o) => o.z || 1)) + 1;
  // Keep z-indexes compact so they never run away.
  [...page.widgets].sort((a, b) => (a.z || 1) - (b.z || 1)).forEach((o, i) => { o.z = i + 1; const inst = instances.get(o.id); if (inst) inst.el.style.zIndex = o.z; });
  el.classList.add('dragging');
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);

  const move = (ev) => {
    const dx = (ev.clientX - start.mx) / cw, dy = (ev.clientY - start.my) / ch;
    let { x, y, w: ww, h: hh } = start;
    if (dir === 'move') {
      x = clamp(q(start.x + dx), 0, COLS - ww);
      y = clamp(q(start.y + dy), 0, ROWS - hh);
    } else {
      if (dir.includes('e')) ww = clamp(q(start.w + dx), minW, COLS - start.x);
      if (dir.includes('s')) hh = clamp(q(start.h + dy), minH, ROWS - start.y);
      if (dir.includes('w')) { x = clamp(q(start.x + dx), 0, start.x + start.w - minW); ww = start.x + start.w - x; }
      if (dir.includes('n')) { y = clamp(q(start.y + dy), 0, start.y + start.h - minH); hh = start.y + start.h - y; }
    }
    Object.assign(w, { x, y, w: ww, h: hh });
    applyGeometry(el, w);
  };
  const up = () => {
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerup', up);
    target.removeEventListener('pointercancel', up);
    el.classList.remove('dragging');
    save();
  };
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerup', up);
  target.addEventListener('pointercancel', up);
}

function findFreeSpot(page, w, hgt) {
  const overlaps = (x, y) => page.widgets.some((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + hgt > o.y);
  for (let y = 0; y <= ROWS - hgt; y += 1) for (let x = 0; x <= COLS - w; x += 1) if (!overlaps(x, y)) return { x, y };
  return { x: Math.round((COLS - w) / 2), y: Math.round((ROWS - hgt) / 2) };
}

/* ---------- pages ---------- */
function ensurePage(page) {
  if (pageEls.has(page.id)) return;
  const el = h('div', { class: 'page', 'data-id': page.id });
  $('#canvas').append(el);
  pageEls.set(page.id, el);
  for (const w of page.widgets) mountWidget(page, w);
  updateEmptyState(page);
}

function setPage(i) {
  state.activePage = clamp(i, 0, state.pages.length - 1);
  const page = state.pages[state.activePage];
  ensurePage(page);
  for (const [id, el] of pageEls) el.classList.toggle('active', id === page.id);
  renderTabs();
  save();
}

function setEditing(on) {
  editing = on;
  document.body.classList.toggle('editing', on);
  const bar = $('#edit-bar');
  bar.hidden = !on;
  if (on) {
    bar.replaceChildren(
      h('b', {}, 'BEWERKMODUS'),
      h('span', {}, 'Sleep widgets om ze te verplaatsen, trek aan de punten om de grootte te wijzigen.'),
      h('button', { class: 'btn pill', onclick: openAddWidget }, icon('plus'), 'Toevoegen'),
      h('button', { class: 'btn pill primary', onclick: () => setEditing(false) }, 'Gereed')
    );
  }
  renderTitlebar();
}

/* ---------- add / configure ---------- */
function openAddWidget() {
  const page = state.pages[state.activePage];
  let close;
  const picker = h(
    'div',
    { class: 'picker' },
    Object.entries(WIDGETS).map(([type, def]) =>
      h('button', { class: 'pick', onclick: () => {
        close();
        const [w, hgt] = def.size;
        const spot = findFreeSpot(page, w, hgt);
        const widget = { id: uid(), type, ...spot, w, h: hgt, z: Math.max(0, ...page.widgets.map((o) => o.z || 1)) + 1, title: def.name, cfg: { ...(def.defaults || {}) } };
        page.widgets.push(widget);
        mountWidget(page, widget);
        setEditing(true);
        save();
        if (type === 'tile' || type === 'web' || type === 'metar') openWidgetConfig(widget);
      } }, icon(def.icon), h('b', {}, def.name), h('span', {}, def.desc))
    )
  );
  close = openModal({ title: `Toevoegen aan "${page.name}"`, body: picker, wide: true });
}

function openWidgetConfig(w) {
  const def = WIDGETS[w.type];
  const page = state.pages.find((p) => p.widgets.includes(w));
  const title = textInput(w.title, { id: 'cfg-title', maxlength: 40 });
  const form = def.form ? def.form(w.cfg) : { el: [], read: () => ({}) };
  openModal({
    title: `${def.name} instellen`,
    body: [field(def.chromeless ? 'Naam op de tegel' : 'Titel', title), ...form.el],
    actions: [
      { label: 'Annuleren' },
      { label: 'Opslaan', primary: true, onClick: () => {
        w.title = title.value.trim() || def.name;
        Object.assign(w.cfg, form.read());
        mountWidget(page, w);
        save();
      } },
    ],
  });
}

/* ============================================================
   Settings
   ============================================================ */
function openSettings(startTab) {
  const s = state.settings;
  const pane = h('div', { class: 'settings-pane' });
  const nav = h('div', { class: 'settings-nav' });
  const zones = (() => { try { return ['UTC', ...Intl.supportedValuesOf('timeZone')]; } catch { return ['UTC', 'Europe/Amsterdam']; } })();
  const changed = (fn) => (...a) => { fn(...a); save(); };

  const tabs = {
    weergave: {
      label: 'Weergave', icon: 'sun',
      build() {
        const autoBox = h('div', { style: 'display:flex;flex-direction:column;gap:0.9rem' });
        const paintAuto = () => {
          autoBox.replaceChildren();
          if (s.theme !== 'auto') return;
          const { rise, set } = sunTimes(new Date(), 52.31, 4.76);
          const hm = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
          const times = h('div', { class: 'row' },
            field('Licht vanaf', h('input', { class: 'input', type: 'time', value: s.lightFrom, onchange: changed((e) => { s.lightFrom = e.target.value; applyTheme(true); }) })),
            field('Donker vanaf', h('input', { class: 'input', type: 'time', value: s.darkFrom, onchange: changed((e) => { s.darkFrom = e.target.value; applyTheme(true); }) })));
          times.style.display = s.autoMode === 'times' ? '' : 'none';
          autoBox.append(
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Automatisch schakelen op basis van'),
              segmented([{ value: 'sun', label: 'Zonsopkomst en -ondergang' }, { value: 'times', label: 'Vaste tijden' }], s.autoMode, changed((v) => { s.autoMode = v; times.style.display = v === 'times' ? '' : 'none'; applyTheme(true); })),
              h('div', { class: 'hint' }, `Vandaag: zon op ${hm(rise)}, zon onder ${hm(set)} (Schiphol). De overgang verloopt met een vloeiende fade.`)),
            times
          );
        };
        const el = [
          h('h3', {}, 'Thema'),
          segmented([{ value: 'auto', label: 'Automatisch', icon: 'auto' }, { value: 'light', label: 'Licht', icon: 'sun' }, { value: 'dark', label: 'Donker', icon: 'moon' }], s.theme, changed((v) => { s.theme = v; applyTheme(true); renderTitlebar(); paintAuto(); })),
          autoBox,
          h('hr'),
          h('h3', {}, 'Schaal'),
          field('Grootte van tekst en bediening', (() => {
            const sel = h('select', { class: 'input', onchange: changed((e) => { s.uiScale = parseFloat(e.target.value); applyScale(); }) }, [0.8, 0.9, 1, 1.1, 1.25, 1.4].map((v) => h('option', { value: v }, `${Math.round(v * 100)} %`)));
            sel.value = String(s.uiScale);
            return sel;
          })(), 'De weergave schaalt automatisch mee met de resolutie van het scherm; hiermee stel je bij voor de kijkafstand.'),
        ];
        paintAuto();
        return el;
      },
    },
    scherm: {
      label: 'Scherm', icon: 'monitor',
      build: () => [
        h('h3', {}, 'Opstarten'),
        checkbox('Starten in volledig scherm (zonder randen en menubalk)', s.startFullscreen, changed((v) => (s.startFullscreen = v))),
        checkbox('Elke nacht om 04:00 vernieuwen (houdt het dashboard fris als het dagenlang aan staat)', s.nightlyReload, changed((v) => (s.nightlyReload = v))),
        checkbox(IS_MAC ? 'P-ALV Dashboard automatisch starten bij het inloggen op deze Mac' : 'P-ALV Dashboard automatisch starten met Windows', s.autoStart, changed(async (v) => { s.autoStart = v; await window.palv.app.setAutoStart(v); })),
        h('hr'),
        h('h3', {}, 'Pagina\'s'),
        field('Automatisch wisselen tussen pagina\'s (seconden)', h('input', { class: 'input', type: 'number', min: 0, step: 5, value: s.rotate, onchange: changed((e) => { s.rotate = Math.max(0, parseInt(e.target.value, 10) || 0); }) }), '0 = niet automatisch wisselen. Handig wanneer het dashboard onbeheerd op de tv draait.'),
        h('hr'),
        h('p', {}, `Volledig scherm: ${FS_KEY} of de knop in de menubalk. Verlaat het met Esc of ${FS_KEY}. ` + 'Beweeg in volledig scherm de muis naar de bovenrand om de menubalk tijdelijk te tonen.'),
      ],
    },
    klokken: {
      label: 'Klokken', icon: 'clock',
      build: () => [
        ...s.clocks.flatMap((c, i) => {
          const sel = h('select', { class: 'input', onchange: changed((e) => { c.tz = e.target.value; renderClocks(); }) }, zones.map((z) => h('option', { value: z }, z)));
          sel.value = c.tz;
          return [
            h('h3', {}, `Klok ${i + 1}`),
            h('div', { class: 'row' },
              field('Label', textInput(c.label, { maxlength: 16, oninput: changed((e) => { c.label = e.target.value; renderClocks(); }) })),
              field('Tijdzone', sel),
              h('div', { class: 'field', style: 'flex:0 0 5rem' }, h('label', {}, 'Achtervoegsel'), textInput(c.suffix, { maxlength: 3, oninput: changed((e) => { c.suffix = e.target.value; renderClocks(); }) }))),
            i === 0 ? h('hr') : null,
          ];
        }),
        h('hr'),
        checkbox('Seconden tonen', s.showSeconds, changed((v) => { s.showSeconds = v; tickClocks(); })),
      ],
    },
    adsb: {
      label: 'ADS-B filter', icon: 'shield',
      build: () => {
        const area = (key, label) => field(label, h('textarea', { class: 'input', value: s.hex[key], onchange: changed((e) => { s.hex[key] = e.target.value; remountType('adsb'); }) }));
        return [
          h('h3', {}, 'Filter "Politie & hulpdiensten"'),
          h('p', {}, 'De knop toont alleen de toestellen met onderstaande Mode-S hexcodes (ICAO 24-bit adres), gescheiden door komma\'s. Pas de lijsten aan wanneer de vloot wijzigt.'),
          area('police', 'Politie (PH-PXA t/m PXF, PXX, PXY, PXZ)'),
          area('hems', 'Traumahelikopters / ambulancehelikopters'),
          area('coastguard', 'Kustwacht (vliegtuigen en SAR-helikopters)'),
          h('div', {}, h('button', { class: 'btn', onclick: () => { s.hex = { ...DEFAULT_HEX }; save(); remountType('adsb'); show('adsb'); } }, icon('refresh'), 'Standaardlijsten herstellen')),
        ];
      },
    },
    weerradar: {
      label: 'Weerradar', icon: 'radar',
      build: () => {
        const num = (key, max, step) => h('input', { class: 'input', type: 'number', min: 0, max, step, value: s[key], onchange: changed((e) => { s[key] = clamp(parseInt(e.target.value, 10) || 0, 0, max); e.target.value = s[key]; applyWxMargins(); }) });
        return [
          h('h3', {}, 'Marge voor "marginaal"'),
          h('p', {}, 'Een meetstation dat binnen de BOM-limieten valt, kleurt oranje zodra de wolkenbasis of het zicht minder dan deze marge boven de limiet ligt. De limieten zelf (groen of rood) veranderen hier niet door.'),
          h('div', { class: 'row' }, field('Wolkenbasis (ft)', num('wxMarginFt', 2000, 100)), field('Zicht (m)', num('wxMarginM', 5000, 100))),
          h('div', { class: 'hint field' }, h('div', { class: 'hint' }, 'Standaard 200 ft en 1000 m. Met 0 vervalt de marge voor dat onderdeel; oranje blijft dan alleen bij een verwachte verslechtering tot onder de limiet.')),
          h('div', {}, h('button', { class: 'btn', onclick: () => { s.wxMarginFt = 200; s.wxMarginM = 1000; save(); applyWxMargins(); show('weerradar'); } }, icon('refresh'), 'Standaardmarges herstellen')),
        ];
      },
    },
    indeling: {
      label: 'Indeling', icon: 'layout',
      build: () => [
        h('h3', {}, 'Bewerken'),
        checkbox('Widgets uitlijnen op raster bij verplaatsen en schalen', s.snap, changed((v) => (s.snap = v))),
        h('hr'),
        h('h3', {}, 'Back-up'),
        h('p', {}, 'Bewaar de volledige indeling (pagina\'s, widgets, tegels en instellingen) als bestand, bijvoorbeeld om op een andere pc te gebruiken.'),
        h('div', { style: 'display:flex;gap:0.5rem;flex-wrap:wrap' },
          h('button', { class: 'btn', onclick: async () => { if (await window.palv.config.exportFile(state)) toast('Indeling geëxporteerd'); } }, 'Exporteren…'),
          h('button', { class: 'btn', onclick: async () => {
            const res = await window.palv.config.importFile();
            if (!res) return;
            if (res.error || !Array.isArray(res.pages)) return toast(res.error || 'Dit is geen geldige dashboard-indeling.', true);
            await replaceConfig(res);
          } }, 'Importeren…'),
          h('button', { class: 'btn danger', onclick: () => confirmDialog('Standaardindeling herstellen', 'Alle pagina\'s, widgets en instellingen worden teruggezet naar de standaard. Dit kan niet ongedaan worden gemaakt.', 'Herstellen', () => replaceConfig(defaultState())) }, 'Standaardindeling herstellen')),
      ],
    },
    over: {
      label: 'Over', icon: 'info',
      build: () => {
        const ver = h('span', {}, '');
        window.palv.app.version().then((v) => (ver.textContent = v));
        return [
          h('h3', {}, 'P-ALV Dashboard'),
          h('p', {}, 'Versie ', ver),
          h('hr'),
          h('h3', {}, 'Gegevensbronnen'),
          h('p', {}, 'Luchtvaartweer (METAR/TAF): aviationweather.gov — elke 2 minuten ververst; de meetstations op de weerradar elke minuut.'),
          h('p', {}, 'Meetstations op de weerradar: getoetst aan de weerminima uit de tabel van het BOM, per gekozen profiel. Groen: binnen limieten. Oranje: binnen limieten maar marginaal (minder marge dan ingesteld onder Weerradar, standaard 200 ft of 1000 m) of volgens de trend binnen 2 uur eronder. Rood: buiten limieten. Grijs: zicht of bewolking niet gemeten, of waarneming ouder dan 90 minuten. Verticaal zicht (VV) telt niet als wolkenbasis. Pijl: trend uit de METAR, anders uit de TAF, anders het waargenomen verloop. Plus: buiten Aided Nacht maar binnen Advanced Operations, alleen AW139.'),
          h('p', {}, 'UDP: 15 minuten vóór zonsopkomst tot 15 minuten na zonsondergang op 52°N 005°E, volgens de KNMI-tabellen voor 2026 en 2027. Voor latere jaren wordt gerekend (hooguit één minuut verschil met de tabel) en staat er "BEREKEND" in de balk, tot de tabel van dat jaar is toegevoegd. Het profiel op de weerradar schakelt op deze tijden automatisch tussen het laatst gebruikte dag- en nachtprofiel.'),
          h('p', {}, 'Actueel baangebruik: live waargenomen uit het vliegverkeer rond Schiphol (ADS-B-gegevens van adsb.lol, reserve adsb.fi), elke 12 seconden bijgewerkt. Te zien in de widget "Baangebruik Schiphol". Een baan wordt getoond wanneer er in het laatste kwartier toestellen op eindnadering of net na de start zijn gezien. Groene stip: actueel. Oranje: nog geen of geen verkeer. Rood: bron niet bereikbaar.'),
          h('p', {}, 'In de lucht: de toestellen uit de lijsten onder ADS-B filter, met posities van adsb.lol (reserve adsb.fi), elke 10 seconden bijgewerkt. De vliegtijd telt vanaf de start in de gevlogen route bij ADS-B Exchange; met ≈ vanaf de eerste waarneming, met ≥ als het toestel al vloog toen het dashboard startte.'),
          h('p', {}, 'Rode melding rechts in de tabbalk: een bron levert al een tijd geen verse gegevens (ADS-B langer dan 3 minuten, weerradarbeeld ouder dan een half uur, METAR Schiphol ouder dan 75 minuten of onbereikbaar). Beweeg de muis erover voor de details.'),
          h('p', {}, 'Vliegverkeer: ADS-B Exchange. Weerradar: Windy.com.'),
          h('p', {}, 'Dit dashboard is een hulpmiddel voor situationeel overzicht en vervangt geen officiële briefing- of vluchtvoorbereidingsbronnen.'),
        ];
      },
    },
  };

  const show = (key) => {
    [...nav.children].forEach((b) => b.classList.toggle('on', b.dataset.k === key));
    pane.replaceChildren(...tabs[key].build().filter(Boolean));
  };
  for (const [key, t] of Object.entries(tabs)) nav.append(h('button', { 'data-k': key, onclick: () => show(key) }, icon(t.icon), t.label));
  openModal({ title: 'Instellingen', body: h('div', { class: 'settings' }, nav, pane), wide: true, bare: true });
  show(startTab || 'weergave');
}

function remountType(type) {
  for (const p of state.pages) {
    if (!pageEls.has(p.id)) continue;
    for (const w of p.widgets) if (w.type === type) mountWidget(p, w);
  }
}

/* ============================================================
   Boot
   ============================================================ */
function onWinState(ws) {
  const entered = ws.fullscreen && !winState.fullscreen;
  winState = ws;
  document.body.classList.toggle('fullscreen', ws.fullscreen);
  document.body.classList.remove('tb-reveal');
  renderTitlebar();
  if (entered) toast(`Volledig scherm — Esc of ${FS_KEY} om te verlaten, muis naar de bovenrand voor de menubalk`);
}

// Embedded sites that stay open for days slowly fill up memory. At 04:00 local time the dashboard starts
// afresh, unless someone is busy with it; then it waits until they are done, up to 05:00.
function nightlyReload() {
  if (!state.settings.nightlyReload || editing || modalOpen()) return;
  const d = new Date();
  if (d.getHours() !== 4 || performance.now() < 3600e3) return;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; window.palv.config.saveSync(state); }
  location.reload();
}

let lastRotate = Date.now(), lastTheme = 0, lastUdp = 0;
function everySecond() {
  tickClocks();
  // By elapsed time rather than on exact seconds: a timer that runs late would otherwise skip a turn.
  const now = Date.now();
  if (now - lastTheme >= 20000) { lastTheme = now; applyTheme(true); }
  if (now - lastUdp >= 10000) { lastUdp = now; renderUdp(); }
  paintHealth();
  nightlyReload();
  const r = state.settings.rotate;
  if (r > 0 && state.pages.length > 1 && !editing && !modalOpen()) {
    if (Date.now() - lastRotate >= r * 1000) { lastRotate = Date.now(); setPage((state.activePage + 1) % state.pages.length); }
  } else lastRotate = Date.now();
}

async function boot() {
  document.body.classList.toggle('mac', IS_MAC);
  state = normalize(await window.palv.config.load());
  applyScale();
  applyTheme(false);
  onWinState(await window.palv.win.getState());
  window.palv.win.onState(onWinState);

  renderTitlebar();
  renderClocks();
  renderUdp();
  applyWxMargins();
  renderEham();
  setPage(state.activePage);

  refreshMetar();
  setInterval(refreshMetar, 120000);
  refreshRunways();
  setInterval(refreshRunways, 15000);
  setInterval(everySecond, 1000);

  window.addEventListener('resize', applyScale);
  // A change made just before closing is still waiting for its save.
  window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; window.palv.config.saveSync(state); } });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modalOpen()) $('#modal-root').lastChild.remove();
      else if (editing) setEditing(false);
      else if (winState.fullscreen) window.palv.win.setFullscreen(false);
    } else if ((IS_MAC ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'e') {
      setEditing(!editing);
    } else if ((IS_MAC ? e.metaKey : e.ctrlKey) && /^[1-9]$/.test(e.key) && +e.key <= state.pages.length) {
      setPage(+e.key - 1);
    }
  });

  // Fullscreen: reveal the menu bar while the mouse is at the top edge.
  let hideTimer = null;
  window.addEventListener('mousemove', (e) => {
    if (!winState.fullscreen) return;
    const bar = $('#titlebar');
    if (e.clientY <= 2) { clearTimeout(hideTimer); hideTimer = null; document.body.classList.add('tb-reveal'); }
    else if (e.clientY > bar.offsetHeight + 12 && document.body.classList.contains('tb-reveal') && !hideTimer) {
      hideTimer = setTimeout(() => { document.body.classList.remove('tb-reveal'); hideTimer = null; }, 500);
    }
  });
}

boot();
