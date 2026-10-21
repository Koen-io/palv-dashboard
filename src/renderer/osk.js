'use strict';

/* ============================================================
   Schermtoetsenbord
   Verschijnt zodra een vinger (of pen) een tekstveld aanraakt, in het dashboard of in een ingesloten pagina,
   en verdwijnt als het veld de focus kwijt is. Muis en gewoon toetsenbord laten het met rust.
   Letters gaan direct het veld in; Backspace, Enter en de pijlen gaan als echte toetsaanslagen via het
   hoofdproces, zodat elk veld (ook tijd en getal) en elke pagina ze precies zo krijgt als van een toetsenbord.
   ============================================================ */

const OSK_KEY = (k, icon, cls, extra) => ({ k, icon, cls, ...extra });
const BKSP = OSK_KEY('Backspace', 'backspace', 'fn wide', { repeat: true, title: 'Wissen' });
const ENTER = OSK_KEY('Enter', 'enter', 'enter', { title: 'Enter' });
const LEFT = OSK_KEY('Left', 'left', 'fn', { repeat: true, title: 'Cursor naar links' });
const RIGHT = OSK_KEY('Right', 'right', 'fn', { repeat: true, title: 'Cursor naar rechts' });
const HIDE = OSK_KEY('Hide', 'keyboardDown', 'fn wide', { title: 'Toetsenbord verbergen' });
const SHIFT = OSK_KEY('Shift', 'shift', 'fn wide', { title: 'Hoofdletter (twee keer: vast)' });
const SPACE = OSK_KEY(' ', null, 'space', { title: 'Spatie' });
const layerKey = (to, label) => OSK_KEY('Layer', null, 'fn wider', { to, label });
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', BKSP];
const OSK_LAYOUTS = {
  abc: [
    DIGITS,
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '-'],
    { indent: true, keys: ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', ENTER] },
    [SHIFT, 'z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.', SHIFT],
    [layerKey('sym', '&123'), '@', SPACE, '/', LEFT, RIGHT, HIDE],
  ],
  sym: [
    DIGITS,
    ['!', '?', '#', '€', '%', '&', '*', '(', ')', '=', '+'],
    { indent: true, keys: [':', ';', '\'', '"', '_', '°', '<', '>', '|', ENTER] },
    ['é', 'ë', 'è', 'ï', 'ó', 'ö', 'ü', 'á', 'ç', '\\', '$'],
    [layerKey('abc', 'ABC'), '@', SPACE, '/', LEFT, RIGHT, HIDE],
  ],
  num: [
    ['7', '8', '9', BKSP],
    ['4', '5', '6', ':'],
    ['1', '2', '3', '-'],
    [',', '0', '.', ENTER],
    [layerKey('abc', 'ABC'), LEFT, RIGHT, HIDE],
  ],
};

const osk = { el: null, rows: null, label: null, open: false, target: null, layer: 'abc', shift: 0, shiftAt: 0, touchAt: 0, top: false, manualTop: null, repeat: null, guestOpen: false, queue: [], flushTimer: null };

// Fields that take typed text. Checkboxes, buttons, sliders and the like never call up the keyboard.
const OSK_TYPES = /^(text|search|email|url|tel|password|number|time|date|datetime-local|month|week)$/;
function oskEditable(el) {
  if (!el || el.disabled || el.readOnly) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && OSK_TYPES.test(el.type || 'text');
}
const oskNumeric = (el) => !!el && el.tagName === 'INPUT' && (/^(number|time|tel|date|month|week|datetime-local)$/.test(el.type) || /^(numeric|decimal)$/.test(el.inputMode));
// Plain text fields take characters straight in (any letter, also é or €); the rest gets them as key presses.
const oskTextual = (el) => !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|email|url|password|tel)$/.test(el.type || 'text')));
const oskOn = () => !!(state && state.settings.osk);

function oskBuild() {
  osk.label = h('b', {}, '');
  osk.rows = h('div', { class: 'osk-rows' });
  const panel = h('div', { class: 'osk-panel' },
    h('div', { class: 'osk-bar' },
      h('span', { class: 'osk-preview' }, icon('keyboard'), osk.label),
      h('button', { 'data-act': 'swap', title: 'Toetsenbord boven of onder in beeld' }, icon('swap'), 'Verplaatsen'),
      h('button', { 'data-act': 'hide', title: 'Toetsenbord verbergen' }, icon('chevronDown'), 'Verbergen')),
    osk.rows);
  osk.el = h('div', { id: 'osk', hidden: true, role: 'group', 'aria-label': 'Schermtoetsenbord' }, panel);
  // The field keeps the focus: nothing on the keyboard may take it. Keys act on the touch itself, not on
  // its release, so typing keeps up with the fingers.
  panel.addEventListener('mousedown', (e) => e.preventDefault());
  panel.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const act = e.target.closest('[data-act]');
    if (act) { if (act.dataset.act === 'hide') oskHide(); else oskSwap(); return; }
    const key = e.target.closest('.osk-key');
    if (!key) return;
    key.classList.add('down');
    const def = key.def;
    oskPress(def);
    clearTimeout(osk.repeat);
    if (def.repeat) {
      const again = () => { oskPress(def); osk.repeat = setTimeout(again, 55); };
      osk.repeat = setTimeout(again, 420);
    }
  });
  const release = (e) => {
    clearTimeout(osk.repeat);
    osk.repeat = null;
    if (osk.queue.length) setTimeout(oskFlush, 0);
    const key = e.target.closest && e.target.closest('.osk-key');
    if (key) key.classList.remove('down');
    else osk.rows.querySelectorAll('.osk-key.down').forEach((k) => k.classList.remove('down'));
  };
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) panel.addEventListener(ev, release);
  panel.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.append(osk.el);
}

function oskRender() {
  const upper = osk.shift > 0;
  osk.el.classList.toggle('num', osk.layer === 'num');
  osk.rows.replaceChildren(...OSK_LAYOUTS[osk.layer].map((row) => {
    const keys = Array.isArray(row) ? row : row.keys;
    return h('div', { class: 'osk-row' + (row.indent ? ' indent' : '') }, keys.map((k) => {
      const def = typeof k === 'string' ? { k, ch: true } : k;
      const text = def.ch ? (upper ? def.k.toUpperCase() : def.k) : null;
      const el = h('button', { class: 'osk-key ' + (def.cls || '') + (def.k === 'Shift' ? (osk.shift === 2 ? ' lock' : osk.shift === 1 ? ' on' : '') : ''), tabindex: '-1', 'aria-label': def.title || text || def.label || def.k },
        def.icon ? icon(def.icon) : def.label ? h('small', {}, def.label) : text);
      el.def = def;
      return el;
    }));
  }));
}

// Where the keys go: the field or embedded page that has the focus now, else the field the keyboard opened for.
function oskTarget() {
  const a = document.activeElement;
  // Touching the keyboard takes the focus from an embedded page; it goes back to it (and its field) first.
  if (a && a.tagName === 'WEBVIEW') return a;
  if (oskEditable(a)) return a;
  const t = osk.target;
  if (t && t.isConnected) { t.focus(); return t; }
  return null;
}
// An embedded page loses its focus to the touch on the keyboard only once that touch has been handled; its keys
// therefore wait for the finger to lift (or, while a key is held, a moment), then the focus goes back and they follow.
function oskSend(t, fn) {
  if (t.tagName !== 'WEBVIEW') return fn();
  osk.queue.push(fn);
  if (!osk.flushTimer) osk.flushTimer = setTimeout(oskFlush, 260);
}
function oskFlush() {
  clearTimeout(osk.flushTimer);
  osk.flushTimer = null;
  if (!osk.queue.length) return;
  const q = osk.queue.splice(0);
  const t = osk.target;
  if (!t || !t.isConnected) return;
  // Still the focused element of the dashboard, so focus() alone would do nothing: let go and take it again.
  if (document.activeElement === t) t.blur();
  t.focus();
  setTimeout(() => q.forEach((fn) => fn()), 16);
}
function oskKeys(t, events) {
  const guest = t && t.tagName === 'WEBVIEW' ? t.getWebContentsId() : 0;
  window.palv.osk.key(guest, events);
}
const oskTap = (code) => [{ type: 'keyDown', keyCode: code }, { type: 'keyUp', keyCode: code }];

function oskPress(def) {
  if (def.k === 'Hide') return oskHide();
  if (def.k === 'Layer') { osk.layer = def.to; osk.shift = 0; return oskRender(); }
  if (def.k === 'Shift') {
    const now = Date.now();
    osk.shift = osk.shift === 1 && now - osk.shiftAt < 450 ? 2 : osk.shift ? 0 : 1;
    osk.shiftAt = now;
    return oskRender();
  }
  const t = oskTarget();
  if (!t) return;
  if (def.k === 'Backspace') return oskSend(t, () => oskKeys(t, oskTap('Backspace')));
  if (def.k === 'Left' || def.k === 'Right') return oskSend(t, () => oskKeys(t, oskTap(def.k)));
  if (def.k === 'Enter') {
    // A text area gets a new line; elsewhere Enter is the key that confirms (a dialog, a search).
    if (t.tagName === 'TEXTAREA' || t.isContentEditable) document.execCommand('insertText', false, '\n');
    else oskSend(t, () => oskKeys(t, [{ type: 'keyDown', keyCode: 'Enter' }, { type: 'char', keyCode: 'Enter' }, { type: 'keyUp', keyCode: 'Enter' }]));
    return;
  }
  const ch = osk.shift ? def.k.toUpperCase() : def.k;
  if (osk.shift === 1) { osk.shift = 0; oskRender(); }
  if (t.tagName === 'WEBVIEW') oskSend(t, () => t.insertText(ch).catch(() => {}));
  else if (oskTextual(t)) document.execCommand('insertText', false, ch);
  else oskKeys(t, [{ type: 'char', keyCode: ch === ' ' ? 'Space' : ch }]);
}

// What the keyboard types into, in a few words above the keys.
function oskName(t) {
  if (!t) return 'Tik een tekstveld aan om te typen';
  if (t.tagName === 'WEBVIEW') { const w = t.closest('.widget'); const title = w && w.querySelector('.w-title'); return title && title.textContent ? title.textContent : 'Ingesloten pagina'; }
  const lab = t.closest('.field') && t.closest('.field').querySelector('label, .field-label');
  return t.getAttribute('aria-label') || (lab && lab.textContent) || t.placeholder || 'Tekstveld';
}

function oskShow(target, kind) {
  if (!oskOn()) return;
  if (!osk.el) oskBuild();
  // A new field, or within one embedded page a field of the other kind (text after a number).
  const fresh = osk.target !== target || !osk.open || (!!kind && (kind === 'num') !== (osk.layer === 'num'));
  osk.target = target || null;
  if (fresh) {
    osk.layer = kind === 'num' || oskNumeric(target) ? 'num' : 'abc';
    osk.shift = 0;
    oskRender();
  }
  osk.label.textContent = oskName(target);
  osk.el.hidden = false;
  osk.open = true;
  // Out of the way of the field: at the top of the screen when it would cover the field (unless moved by hand).
  requestAnimationFrame(() => {
    const kh = osk.el.firstChild.offsetHeight;
    let top = false;
    if (osk.manualTop != null) top = osk.manualTop;
    else if (target && target.tagName !== 'WEBVIEW' && !target.closest('.modal')) {
      const r = target.getBoundingClientRect();
      top = r.bottom > window.innerHeight - kh - 12 && r.top > kh + 12;
    }
    oskDock(top, kh);
    osk.el.classList.add('open');
  });
}
function oskDock(top, kh) {
  osk.top = top;
  osk.el.classList.toggle('top', top);
  document.documentElement.style.setProperty('--osk-h', (kh || osk.el.firstChild.offsetHeight) + 'px');
  document.body.classList.add('osk-open');
  document.body.classList.toggle('osk-top', top);
}
function oskSwap() { osk.manualTop = !osk.top; oskDock(osk.manualTop); }

function oskHide() {
  if (!osk.el || !osk.open) return;
  osk.open = false;
  osk.target = null;
  clearTimeout(osk.repeat);
  osk.el.classList.remove('open');
  document.body.classList.remove('osk-open', 'osk-top');
  document.documentElement.style.setProperty('--osk-h', '0px');
  setTimeout(() => { if (!osk.open) osk.el.hidden = true; }, 160);
  renderTitlebar();
}
function oskToggle() {
  if (osk.open) return oskHide();
  const a = document.activeElement;
  oskShow(a && (a.tagName === 'WEBVIEW' || oskEditable(a)) ? a : null);
  renderTitlebar();
}

// In touchscreen mode a button in the menu bar opens it by hand; pressing it leaves the focus where it was.
function oskButton() {
  if (!oskOn() || !TOUCH.on()) return null;
  const keep = (e) => e.preventDefault();
  return h('button', { class: 'tb-btn' + (osk.open ? ' on' : ''), title: 'Schermtoetsenbord tonen of verbergen', onpointerdown: keep, onmousedown: keep, onclick: oskToggle }, icon('keyboard'), 'Toetsenbord');
}

// Embedded pages: a small listener inside the page reports when a field there is touched or let go.
const OSK_GUEST_JS = "if (!window.__palvOsk) { window.__palvOsk = 1; let t = 0;"
  + " const ed = (el) => !!el && !el.disabled && !el.readOnly && (el.isContentEditable || el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|email|url|tel|password|number|time|date)$/i.test(el.type || 'text')));"
  + " const num = (el) => el.tagName === 'INPUT' && (/^(number|tel|time|date)$/i.test(el.type) || /^(numeric|decimal)$/.test(el.inputMode));"
  + " addEventListener('pointerdown', (e) => { t = e.pointerType === 'mouse' ? 0 : Date.now(); }, true);"
  + " addEventListener('focusin', (e) => { if (ed(e.target) && Date.now() - t < 1500) console.log('\\u0001palv-osk:' + (num(e.target) ? 'num' : 'abc')); }, true);"
  + " addEventListener('click', (e) => { if (ed(e.target) && Date.now() - t < 1500 && document.activeElement === e.target) console.log('\\u0001palv-osk:' + (num(e.target) ? 'num' : 'abc')); }, true);"
  + " addEventListener('focusout', () => { setTimeout(() => { if (document.hasFocus() && !ed(document.activeElement)) console.log('\\u0001palv-osk:close'); }, 0); }, true); }";
function oskWatchWebview(wv) {
  wv.addEventListener('dom-ready', () => { wv.executeJavaScript(OSK_GUEST_JS).catch(() => {}); });
  wv.addEventListener('console-message', (e) => {
    const m = String(e.message || '');
    if (!m.startsWith('\u0001palv-osk:')) return;
    const what = m.slice(10);
    if (what === 'close') {
      osk.guestOpen = false;
      setTimeout(() => { if (!osk.guestOpen && osk.target === wv) oskHide(); }, 150);
    } else {
      osk.guestOpen = true;
      oskShow(wv, what);
      renderTitlebar();
    }
  });
}

function oskInit() {
  // Which kind of pointer came last: only a finger or pen calls the keyboard up.
  document.addEventListener('pointerdown', (e) => { osk.touchAt = e.pointerType === 'mouse' ? 0 : Date.now(); }, true);
  const touched = () => Date.now() - osk.touchAt < 1200;
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (!oskOn() || (osk.el && osk.el.contains(t)) || t.tagName === 'WEBVIEW') return;
    if (oskEditable(t) && (touched() || osk.open)) { oskShow(t); renderTitlebar(); }
  }, true);
  // Touching a field that already has the focus (after hiding the keyboard) brings it back.
  document.addEventListener('click', (e) => {
    if (oskOn() && !osk.open && touched() && oskEditable(e.target) && document.activeElement === e.target) { oskShow(e.target); renderTitlebar(); }
  }, true);
  document.addEventListener('focusout', (e) => {
    if (!osk.open || e.target !== osk.target) return;
    setTimeout(() => {
      const a = document.activeElement;
      if (!osk.open || a === osk.target) return;
      if (oskEditable(a)) oskShow(a);
      else oskHide();
    }, 60);
  }, true);
}
