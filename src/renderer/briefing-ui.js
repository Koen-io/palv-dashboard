'use strict';

/* ============================================================
   Briefingmelding
   5:00 before a briefing a pop-up and an orange glow around the screen; 1:30 before the sound, a second
   pop-up and a red glow, until a minute after the start. The times come from BRIEFING (briefing.js).
   ============================================================ */
const brief = { popup: null, popupKey: null, shown: new Set(), sound: undefined, audio: null, test: null };

// The sound of this screen (briefing-geluid.* in the user data), or the built-in gong without one.
async function loadBriefingSound() {
  brief.sound = await window.palv.briefing.sound().catch(() => null);
}

function briefingSound() {
  if (isMuted()) return;
  if (brief.sound) {
    try {
      if (brief.audio) brief.audio.pause();
      brief.audio = new Audio(brief.sound);
      brief.audio.play().catch(() => gong());
      return;
    } catch { /* fall back to the gong */ }
  }
  gong();
}

// An announcement gong, four rising bell tones; deliberately unlike the emergency chime.
function gong() {
  if (isMuted()) return;
  try {
    const ctx = emergency.audio || (emergency.audio = new AudioContext());
    const t0 = ctx.currentTime + 0.03;
    [[523.25, 0], [659.25, 0.42], [783.99, 0.84], [1046.5, 1.26]].forEach(([f, dt]) => {
      for (const [mult, vol] of [[1, 0.2], [2.01, 0.06], [3.98, 0.025]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = f * mult;
        g.gain.setValueAtTime(0.0001, t0 + dt);
        g.gain.exponentialRampToValueAtTime(vol, t0 + dt + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 1.8);
        o.connect(g).connect(ctx.destination);
        o.start(t0 + dt);
        o.stop(t0 + dt + 1.85);
      }
    });
  } catch { /* no audio device */ }
}

function closeBriefingPopup() {
  if (!brief.popup) return;
  const el = brief.popup;
  brief.popup = null;
  el.classList.remove('in');
  setTimeout(() => el.remove(), 450);
}

function showBriefingPopup(cur) {
  closeBriefingPopup();
  const b = cur.b;
  const card = h('div', { class: 'bf-card ' + cur.phase },
    h('div', { class: 'bf-ring' }, h('span', { class: 'bf-count' }, BRIEFING.clock(cur.left)), h('small', {}, 'min')),
    h('div', { class: 'bf-eyebrow' }, ''),
    h('h2', { class: 'bf-title' }, `Briefing ${b.where}`),
    h('div', { class: 'bf-sub' }, h('b', {}, b.name), h('span', {}, `aanvang ${b.time} LT`)),
    h('p', { class: 'bf-note' }, 'Kan je geen briefing bijwonen? Meld je af bij Flight Ops.'),
    h('div', { class: 'bf-actions' }, h('button', { class: 'btn primary', onclick: () => closeBriefingPopup() }, icon('check'), 'Gezien')));
  const el = h('div', { class: 'bf-backdrop', onclick: (e) => { if (e.target === el) closeBriefingPopup(); } }, card);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  brief.popup = el;
  brief.popupKey = cur.key;
  paintBriefingPopup(cur);
}

function paintBriefingPopup(cur) {
  if (!brief.popup) return;
  const card = brief.popup.querySelector('.bf-card');
  card.className = 'bf-card ' + cur.phase;
  card.querySelector('.bf-count').textContent = cur.phase === 'now' ? 'NU' : BRIEFING.clock(cur.left);
  card.querySelector('.bf-ring small').textContent = cur.phase === 'now' ? '' : 'min';
  card.querySelector('.bf-ring').style.setProperty('--p', Math.max(0, Math.min(100, (1 - cur.left / BRIEFING.WARN_S) * 100)));
  card.querySelector('.bf-eyebrow').textContent = cur.phase === 'now' ? 'BRIEFING BEGINT NU' : cur.phase === 'alert' ? 'BRIEFING BEGINT ZO' : 'BRIEFING OVER 5 MINUTEN';
}

// Every second: the glow, the pop-ups at 5:00 and 1:30, and the sound at 1:30.
function briefingTick() {
  const s = state.settings;
  const cur = brief.test ? testBriefing() : s.briefingAlert ? BRIEFING.current(s.briefings) : null;
  if (!$('#bf-glow')) document.body.append(h('div', { id: 'bf-glow' }));
  document.body.classList.toggle('bf-warn', !!cur && cur.phase === 'warn');
  document.body.classList.toggle('bf-alert', !!cur && cur.phase !== 'warn');
  if (!cur) { if (brief.popup) closeBriefingPopup(); return; }
  // The popup for this briefing in this phase, once; a later phase opens it again.
  const stage = cur.phase === 'warn' ? 'warn' : 'alert';
  const id = `${cur.key}:${stage}`;
  if (!brief.shown.has(id)) {
    brief.shown.add(id);
    if (brief.shown.size > 50) brief.shown.delete(brief.shown.values().next().value);
    if (cur.phase !== 'now') {
      showBriefingPopup(cur);
      plog('info', `briefingmelding: ${cur.b.where} ${cur.b.name} ${cur.b.time} over ${BRIEFING.clock(cur.left)}`);
      // A screen that starts up later than 1:30 before the briefing stays quiet: the moment has passed.
      if (stage === 'alert' && cur.left > BRIEFING.ALERT_S - 15 && (s.briefingSound || brief.test)) briefingSound();
    }
  }
  if (brief.popup && brief.popupKey === cur.key) paintBriefingPopup(cur);
}

// From the settings: the whole sequence in 20 seconds, so it can be seen and heard without waiting.
function testBriefing() {
  const t = brief.test, el = (Date.now() - t.start) / 1000;
  if (el > 20) { brief.test = null; return null; }
  const left = el < 8 ? BRIEFING.WARN_S - el : el < 16 ? BRIEFING.ALERT_S - (el - 8) : -(el - 16);
  return { b: t.b, at: 0, left, phase: left > BRIEFING.ALERT_S ? 'warn' : left > 0 ? 'alert' : 'now', key: 'test@' + t.start };
}
function startBriefingTest() {
  closeModalTop();
  brief.test = { start: Date.now(), b: state.settings.briefings.find((b) => b.on !== false) || DEFAULT_BRIEFINGS[2] };
  briefingTick();
}
