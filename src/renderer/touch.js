'use strict';

/* ============================================================
   Touchscreenmodus
   Grotere knoppen en aanraakvlakken (touch.css), uitleg bij lang indrukken, en in volledig scherm een greep
   bovenaan voor de menubalk. Op een scherm met touchscreen staat de modus bij de eerste start vanzelf aan;
   daarna geldt wat er gekozen is, bewaard met de andere instellingen.
   ============================================================ */

const TOUCH = { on: () => !!(state && state.settings.touchMode) };
// How a right click is said: on a touchscreen it is a long press.
const RCLICK = () => (TOUCH.on() ? 'houd lang ingedrukt' : 'rechtsklik');

function applyTouch() {
  document.body.classList.toggle('touch', TOUCH.on());
  renderTitlebar();
}

/* ---------- long press: the tooltip a mouse would give ---------- */
const tip = { el: null, timer: null, hide: null, start: null, swallow: null };
function hideTouchTip() {
  clearTimeout(tip.timer);
  tip.timer = null;
  if (tip.el) { tip.el.remove(); tip.el = null; }
}
function showTouchTip(el) {
  hideTouchTip();
  const text = el.getAttribute('title');
  if (!text) return;
  const b = h('div', { class: 'touch-tip', role: 'tooltip' }, text);
  document.body.append(b);
  const r = el.getBoundingClientRect(), bw = b.offsetWidth, bh = b.offsetHeight;
  const left = clamp(r.left + r.width / 2 - bw / 2, 8, window.innerWidth - bw - 8);
  const top = r.top - bh - 10 >= 8 ? r.top - bh - 10 : Math.min(r.bottom + 10, window.innerHeight - bh - 8);
  Object.assign(b.style, { left: left + 'px', top: top + 'px' });
  tip.el = b;
  clearTimeout(tip.hide);
  tip.hide = setTimeout(hideTouchTip, 4500);
}

/* ---------- fullscreen: the menu bar without a mouse ---------- */
let barTimer = null;
const revealBar = () => {
  if (!winState.fullscreen) return;
  document.body.classList.add('tb-reveal');
  clearTimeout(barTimer);
  barTimer = setTimeout(() => document.body.classList.remove('tb-reveal'), 8000);
};
const concealBar = () => { clearTimeout(barTimer); document.body.classList.remove('tb-reveal'); };

function initTouch() {
  // First start on this screen: on when it has a touchscreen. Stored at once, so a later choice is kept.
  if (state.settings.touchMode == null) {
    state.settings.touchMode = navigator.maxTouchPoints > 0;
    save();
    plog('info', `touchscreenmodus bij eerste start ${state.settings.touchMode ? 'aan' : 'uit'} (${navigator.maxTouchPoints} aanraakpunten)`);
  }
  document.body.classList.toggle('touch', TOUCH.on());

  const grip = h('button', { id: 'tb-grip', 'aria-label': 'Menubalk tonen', title: 'Menubalk tonen' }, icon('chevronDown'), 'MENU');
  grip.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); revealBar(); });
  document.body.append(grip);

  document.addEventListener('pointerdown', (e) => {
    hideTouchTip();
    if (e.pointerType === 'mouse' || !TOUCH.on()) return;
    // The menu bar: a touch on it keeps it out, a touch elsewhere puts it away; a swipe down from the top edge brings it.
    if (winState.fullscreen) {
      if (e.target.closest('#titlebar')) revealBar();
      else if (document.body.classList.contains('tb-reveal')) concealBar();
    }
    tip.start = { x: e.clientX, y: e.clientY, edge: e.clientY <= 24 };
    // On a map a long press is the right click: remove a route point, the menu of a spot on the map.
    const mapEl = e.target.closest && e.target.closest('.leaflet-container');
    if (mapEl && !e.target.closest('.leaflet-control')) {
      const { clientX, clientY } = e, on = e.target;
      tip.timer = setTimeout(() => {
        tip.timer = null;
        // The release is part of the press: it must not also count as a tap (that would set a new route point).
        tip.swallow = document.documentElement;
        setTimeout(() => { if (tip.swallow === document.documentElement) tip.swallow = null; }, 1500);
        const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY, button: 2 });
        ev.palvLongPress = true;
        on.dispatchEvent(ev);
      }, 560);
      return;
    }
    const el = e.target.closest && e.target.closest('[title]');
    if (!el || el.closest('#osk') || el.closest('.w-edit') || !el.getAttribute('title')) return;
    tip.timer = setTimeout(() => {
      tip.timer = null;
      showTouchTip(el);
      // The press was for the explanation, not for the button.
      tip.swallow = el;
      setTimeout(() => { if (tip.swallow === el) tip.swallow = null; }, 1500);
    }, 520);
  }, true);
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || !tip.start) return;
    const dx = e.clientX - tip.start.x, dy = e.clientY - tip.start.y;
    if (tip.timer && Math.hypot(dx, dy) > 10) { clearTimeout(tip.timer); tip.timer = null; }
    if (tip.start.edge && dy > 40 && TOUCH.on()) { tip.start.edge = false; revealBar(); }
  }, true);
  // The browser's own long-press menu event on a map would come on top of ours: only ours counts there.
  document.addEventListener('contextmenu', (e) => {
    if (!e.palvLongPress && TOUCH.on() && e.target.closest && e.target.closest('.leaflet-container') && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  // A touch on an embedded page (Windy, a website) never reaches the dashboard itself; it does take the focus.
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'WEBVIEW' && TOUCH.on() && winState.fullscreen && Date.now() - osk.touchAt > 1500) concealBar();
  }, true);
  // The click of a long press follows its release at once; a tap after that is a tap again.
  const end = () => { clearTimeout(tip.timer); tip.timer = null; tip.start = null; const sw = tip.swallow; if (sw) setTimeout(() => { if (tip.swallow === sw) tip.swallow = null; }, 350); };
  document.addEventListener('pointerup', end, true);
  document.addEventListener('pointercancel', end, true);
  document.addEventListener('click', (e) => {
    if (tip.swallow && tip.swallow.contains(e.target)) { e.preventDefault(); e.stopPropagation(); tip.swallow = null; }
  }, true);
}
