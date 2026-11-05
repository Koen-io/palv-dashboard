'use strict';

/* ============================================================
   Timings: timers, wekkers en positietimers voor een missie of dienst, gedeeld tussen alle schermen.
   De motor (elke seconde), de meldingen en geluiden, de L-uur-ketting uit de TACSOP, de tabbladbadge
   en de opbouw van het tabblad. De widgets zelf staan in widgets/timings.js en widgets/nextevent.js.
   ============================================================ */
// A timer is one item in the shared file (OPS, kind 'ops', list 'timers'):
//   { label, kind: 'timer' | 'alarm' | 'geo', cat, note, message,
//     durationMs, startedAt, elapsedMs           (timer: counts down from durationMs; paused when startedAt is null)
//     at                                         (alarm: a moment)
//     geo: { hex, name, lat, lon, label, radiusNm, mode: 'enter' | 'leave' }   (position: an own aircraft reaching a point)
//     warnMin, sound, warnSound, popup, repeat   (how it tells: a warning this many minutes ahead, the sounds, a pop-up)
//     firedAt, ackedAt, chain, order, by, createdAt }
// Every screen judges every timer by the clock (and the live traffic for a position timer); whoever
// confirms a finished timer writes ackedAt, and that silences every screen.
const TM_CATS = {
  mission: { name: 'Missie', color: '#ff9f1c' },
  duty: { name: 'Dienst', color: '#3d9bff' },
  fuel: { name: 'Brandstof', color: '#ff4b55' },
  brief: { name: 'Briefing', color: '#b48cff' },
  crew: { name: 'Bemanning', color: '#3ecf6e' },
  other: { name: 'Overig', color: '#8ea2bf' },
};
const TM_KINDS = { timer: { name: 'Timer', icon: 'clock', hint: 'Telt af vanaf een duur' }, alarm: { name: 'Wekker', icon: 'alert', hint: 'Gaat af op een tijdstip' }, geo: { name: 'Positie', icon: 'plane', hint: 'Gaat af als een eigen toestel een punt bereikt (of verlaat)' } };
const TM_SOUNDS = { none: 'Geen geluid', chime: 'Gong (twee tonen)', bell: 'Belletje', alarm: 'Alarm (aanhoudend)', siren: 'Sirene', beep: 'Piepjes', tick: 'Tik', horn: 'Hoorn', briefing: 'Briefinggeluid van dit scherm' };
// The ingress standard of the TACSOP: the calls from the holding to the landing point, before L-hour.
const TM_LHOUR = [
  { min: 30, label: 'Holding bereikt', note: 'Vanaf elk punt in de holding binnen 5 minuten op het doel' },
  { min: 5, label: 'Holding verlaten · 5 minutes to L-hour', note: 'Daling naar 200 ft AGL, 70 kt grondsnelheid' },
  { min: 3, label: '1LEAD · LEAD IN', note: 'EPS-helikopter voorop; ML roept 5-2-1 naar CP op C2000' },
  { min: 2, label: '1GATE · 2 minuten', note: '200 ft AGL, 70 kt; ML roept 2 minuten naar OC' },
  { min: 1, label: '1 minuut', note: 'ML roept 1 minuut naar OC' },
  { min: 0, label: 'L-uur · HAMMER', note: 'Eerste trooping-helikopter wheels on ground / rope on ground' },
];
// Quick timers: one tap, from the add button.
const TM_QUICK = [
  { label: 'Playtime', min: 30, cat: 'fuel', hint: 'Tijd boven het doel met de brandstof aan boord' },
  { label: 'Bingo fuel', min: 45, cat: 'fuel', hint: 'Terug naar het tankpunt' },
  { label: 'Rotor running', min: 15, cat: 'crew', hint: 'Wachten op het platform met draaiende rotor' },
  { label: 'Einde dienst', min: 60, cat: 'duty', hint: 'Bemanningsduur' },
  { label: 'Hand over / take over', min: 20, cat: 'crew', hint: 'HOTO van toestel en bemanning' },
  { label: 'Laatste intel-update', min: 10, cat: 'mission', hint: 'Status op het doel, weer, go/no-go met CP/LSO' },
];

const tm = { handled: new Map(), alerts: new Map(), audio: null, bar: null, popup: null, lastSound: 0, badges: new Set(), snoozeLocal: new Map(), unwatch: null, snap: null, last: null };

/* ---------- time maths ---------- */
const tmNow = () => Date.now();
// Milliseconds left (negative when past), or null when the timer is not running.
function tmRemaining(t, now = tmNow()) {
  if (t.kind === 'timer') {
    if (t.startedAt == null && !t.elapsedMs) return null;
    const elapsed = (t.elapsedMs || 0) + (t.startedAt != null ? now - t.startedAt : 0);
    return t.durationMs - elapsed;
  }
  if (t.kind === 'alarm') return t.at ? t.at - now : null;
  if (t.kind === 'geo') { const g = tmGeoState(t, now); return g && g.etaMs != null ? g.etaMs : null; }
  return null;
}
// The moment it goes off, when known.
function tmDue(t, now = tmNow()) {
  if (t.kind === 'alarm') return t.at || null;
  if (t.kind === 'timer') { const r = tmRemaining(t, now); return r == null || t.startedAt == null ? null : now + r; }
  if (t.kind === 'geo') { const r = tmRemaining(t, now); return r == null ? null : now + r; }
  return null;
}
const tmRunning = (t) => !t.ackedAt && !t.firedAt && (t.kind === 'alarm' ? !!t.at : t.kind === 'timer' ? t.startedAt != null : t.kind === 'geo' ? !!(t.geo && t.geo.hex) : false);
const tmPaused = (t) => t.kind === 'timer' && t.startedAt == null && (t.elapsedMs || 0) > 0 && !t.firedAt;
const tmFinished = (t) => !!t.firedAt;
function tmClock(ms, { seconds = true, sign = false } = {}) {
  if (ms == null) return '—';
  const neg = ms < 0;
  const s = Math.max(0, Math.round(Math.abs(ms) / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const txt = hh > 0 ? `${hh}:${pad2(mm)}${seconds ? ':' + pad2(ss) : ''}` : `${mm}:${pad2(ss)}`;
  return (neg && sign ? '-' : '') + txt;
}
const tmTimeText = (ms) => (ms == null ? '—' : `${ltFmt.format(ms)} LT · ${zulu(ms)}`);

/* ---------- position timers: an own aircraft and a point ---------- */
function tmAircraft(hex) {
  const snap = trafficFeed.snap;
  if (!snap || !snap.ac) return null;
  return snap.ac.find((a) => a.hex === hex) || null;
}
function tmGeoState(t, now = tmNow()) {
  const g = t.geo;
  if (!g || !g.hex || g.lat == null) return null;
  const a = tmAircraft(g.hex);
  if (!a || a.lat == null) return { a: null, distM: null, etaMs: null, inside: null, text: 'Toestel niet in beeld' };
  const pos = typeof vrNow === 'function' ? vrNow(a, now) : [a.lat, a.lon];
  const here = { lat: pos[0], lon: pos[1] };
  const distM = PlanGeo.dist(here, g);
  const radiusM = (g.radiusNm || 1) * 1852;
  const inside = distM <= radiusM;
  let etaMs = null;
  if (a.gs > 5 && a.track != null && a.alt !== 'ground') {
    const brg = PlanGeo.bearing(here, g);
    const closing = a.gs * Math.cos(((a.track - brg) * Math.PI) / 180) * 0.514444; // m/s towards the point
    const want = g.mode === 'leave' ? -(radiusM - distM) : distM - radiusM; // metres still to go
    if (g.mode === 'leave' ? closing < -0.5 : closing > 0.5) etaMs = Math.max(0, (want / Math.abs(closing)) * 1000);
  }
  const fired = g.mode === 'leave' ? !inside && t.geoArmed : inside;
  const old = (now - a.posAt) / 1000 > 60;
  return { a, distM, etaMs: old ? null : etaMs, inside, fired: !old && fired, old, text: old ? 'Positie verouderd' : null };
}

/* ---------- sounds ---------- */
function tmAudioCtx() { try { return tm.audio || (tm.audio = new AudioContext()); } catch { return null; } }
function tmTone(ctx, t0, freq, dur, { type = 'sine', gain = 0.25, slideTo = null } = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}
// The sounds, made on the spot. `volume` 0..1 from the settings.
function tmPlay(name) {
  if (!name || name === 'none' || isMuted()) return;
  if (name === 'briefing') { if (typeof briefingSound === 'function') briefingSound(); return; }
  const ctx = tmAudioCtx();
  if (!ctx) return;
  const v = clamp(+(state.settings.timings || {}).volume || 0.8, 0, 1);
  const t0 = ctx.currentTime + 0.02;
  const T = (dt, f, d, o = {}) => tmTone(ctx, t0 + dt, f, d, { ...o, gain: (o.gain || 0.25) * v });
  switch (name) {
    case 'chime': T(0, 880, 0.5); T(0.35, 660, 0.7); T(0.9, 880, 0.5); T(1.25, 660, 0.9); break;
    case 'bell': T(0, 1320, 0.9, { gain: 0.2 }); T(0, 1980, 0.5, { gain: 0.08 }); T(0, 2640, 0.3, { gain: 0.05 }); break;
    case 'alarm': for (let i = 0; i < 6; i += 1) T(i * 0.3, i % 2 ? 1000 : 780, 0.22, { type: 'square', gain: 0.12 }); break;
    case 'siren': T(0, 500, 0.8, { type: 'sawtooth', gain: 0.1, slideTo: 1100 }); T(0.8, 1100, 0.8, { type: 'sawtooth', gain: 0.1, slideTo: 500 }); T(1.6, 500, 0.8, { type: 'sawtooth', gain: 0.1, slideTo: 1100 }); break;
    case 'beep': for (let i = 0; i < 3; i += 1) T(i * 0.18, 1400, 0.09, { type: 'square', gain: 0.12 }); break;
    case 'tick': T(0, 2000, 0.05, { type: 'square', gain: 0.1 }); break;
    case 'horn': T(0, 220, 0.9, { type: 'sawtooth', gain: 0.14 }); T(0, 277, 0.9, { type: 'sawtooth', gain: 0.1 }); break;
    default: T(0, 880, 0.4);
  }
}

/* ---------- the engine: every second ---------- */
function tmTimers() { return OPS.list('ops', 'timers'); }
function tmSave(t) { const { id, ...rest } = t; return OPS.put('ops', 'timers', id, rest); }
function tmSettings() { return state.settings.timings || (state.settings.timings = { sound: 'alarm', warnSound: 'chime', warnMin: 5, popup: true, volume: 0.8, repeatS: 20 }); }

function timingsTick() {
  if (!OPS.loaded || !state) return;
  const now = tmNow();
  const s = tmSettings();
  const list = tmTimers();
  for (const t of list) {
    if (t.ackedAt) continue;
    const key = `${t.id}@${t.at || t.startedAt || t.createdAt || 0}`;
    let h = tm.handled.get(key);
    if (!h) { h = { warned: false, fired: false, lastSound: 0 }; tm.handled.set(key, h); }
    // Position timers: judged on the live traffic.
    if (t.kind === 'geo') {
      const g = tmGeoState(t, now);
      if (!g) continue;
      // Leaving: only after the aircraft was seen inside first.
      if (t.geo.mode === 'leave' && g.inside && !t.geoArmed) { t.geoArmed = true; tmSave(t); }
      if (g.fired && !t.firedAt) { t.firedAt = now; tmSave(t); plog('info', `positietimer "${t.label}" afgegaan: ${t.geo.name || t.geo.hex} ${t.geo.mode === 'leave' ? 'verlaat' : 'bereikt'} ${t.geo.label || 'punt'}`); }
      else if (!t.firedAt && g.etaMs != null && t.warnMin > 0 && g.etaMs <= t.warnMin * 60000 && !h.warned) { h.warned = true; tmWarn(t, g.etaMs); }
    } else {
      const left = tmRemaining(t, now);
      if (left == null) continue;
      if (left <= 0 && !t.firedAt && tmRunning(t)) { t.firedAt = now; tmSave(t); plog('info', `${TM_KINDS[t.kind].name.toLowerCase()} "${t.label}" afgegaan`); }
      else if (left > 0 && t.warnMin > 0 && left <= t.warnMin * 60000 && !h.warned && tmRunning(t)) { h.warned = true; tmWarn(t, left); }
    }
    if (t.firedAt && !t.ackedAt) {
      if (!h.fired) { h.fired = true; h.lastSound = now; tmPlay(t.sound || s.sound); }
      else if (now - h.lastSound >= (s.repeatS || 20) * 1000 && now - t.firedAt < 15 * 60000 && (t.sound || s.sound) !== 'none') { h.lastSound = now; tmPlay(t.sound || s.sound); }
    }
  }
  // Handled entries of timers that are gone.
  if (tm.handled.size > 200) for (const k of [...tm.handled.keys()].slice(0, 100)) tm.handled.delete(k);
  tmPaintAlerts(list, now);
  for (const el of tm.badges) if (el.isConnected) el.paint(list, now);
  for (const fn of tm.watchers) { try { fn(list, now); } catch { /* one tab */ } }
}
tm.watchers = new Set();
const tmWatch = (fn) => { tm.watchers.add(fn); return () => tm.watchers.delete(fn); };

function tmWarn(t, leftMs) {
  const s = tmSettings();
  tmPlay(t.warnSound || s.warnSound);
  toast(`${t.label}: nog ${tmClock(leftMs, { seconds: false })} min`);
  tm.alerts.set(`warn:${t.id}`, { t, kind: 'warn', until: tmNow() + 60000 });
}

/* ---------- the alert bar and pop-up ---------- */
function tmPaintAlerts(list, now) {
  let bar = $('#timing-alert');
  if (!bar) {
    bar = h('div', { id: 'timing-alert', role: 'alert', hidden: true });
    $('#emergency').after(bar);
    document.body.append(h('div', { id: 'tm-glow', 'aria-hidden': 'true' }));
  }
  const fired = list.filter((t) => t.firedAt && !t.ackedAt && now - t.firedAt < 6 * 3600e3).sort((a, b) => b.firedAt - a.firedAt);
  const warns = [...tm.alerts.values()].filter((w) => w.until > now && !fired.some((t) => t.id === w.t.id));
  for (const [k, w] of tm.alerts) if (w.until <= now) tm.alerts.delete(k);
  const sig = fired.map((t) => t.id + t.firedAt).join('|') + '#' + warns.map((w) => w.t.id).join('|');
  document.body.classList.toggle('tm-fired', fired.length > 0);
  document.body.classList.toggle('tm-warn', !fired.length && warns.length > 0);
  if (bar.dataset.sig === sig) { tmPaintPopup(fired, now); return; }
  bar.dataset.sig = sig;
  bar.hidden = !fired.length && !warns.length;
  bar.className = fired.length ? 'fired' : 'warn';
  bar.replaceChildren(
    ...fired.map((t) => h('div', { class: 'tm-row' },
      h('span', { class: 'tm-row-ic' }, icon(TM_KINDS[t.kind] ? TM_KINDS[t.kind].icon : 'clock')),
      h('div', { class: 'tm-row-main' },
        h('b', {}, t.label),
        h('span', {}, [t.message, `afgegaan ${ltFmt.format(t.firedAt)} LT`, t.kind === 'geo' && t.geo ? `${t.geo.name || t.geo.hex} ${t.geo.mode === 'leave' ? 'verliet' : 'bereikte'} ${t.geo.label || 'het punt'}` : null].filter(Boolean).join(' · '))),
      t.kind === 'alarm' ? h('button', { class: 'em-btn ghost', title: 'Vijf minuten later opnieuw', onclick: () => tmSnooze(t, 5) }, icon('clock'), '+5 min') : null,
      h('button', { class: 'em-btn', title: 'Bevestigen: de melding en het geluid stoppen op alle schermen', onclick: () => tmAck(t) }, icon('check'), 'Bevestigen'))),
    ...warns.map((w) => h('div', { class: 'tm-row' },
      h('span', { class: 'tm-row-ic' }, icon('clock')),
      h('div', { class: 'tm-row-main' }, h('b', {}, w.t.label), h('span', {}, `nog ${tmClock(tmRemaining(w.t, now), { seconds: false })} · ${tmTimeText(tmDue(w.t, now))}`)),
      h('button', { class: 'em-btn ghost', onclick: () => { tm.alerts.delete(`warn:${w.t.id}`); tmPaintAlerts(tmTimers(), tmNow()); } }, icon('check'), 'OK'))));
  tmPaintPopup(fired, now);
}
// The full-screen pop-up for a finished timer that asked for one: the label large, the time since, one button.
function tmPaintPopup(fired, now) {
  const s = tmSettings();
  const want = fired.filter((t) => t.popup != null ? t.popup : s.popup);
  const t = want[0];
  if (!t) { if (tm.popup) { tm.popup.remove(); tm.popup = null; } return; }
  if (tm.popup && tm.popup.dataset.id === t.id) { const el = tm.popup.querySelector('.tm-pop-since'); if (el) el.textContent = `${tmClock(now - t.firedAt)} geleden`; return; }
  if (tm.popup) tm.popup.remove();
  const cat = TM_CATS[t.cat] || TM_CATS.other;
  tm.popup = h('div', { class: 'tm-pop-back', 'data-id': t.id },
    h('div', { class: 'tm-pop', style: `--tm-c:${cat.color}` },
      h('div', { class: 'tm-pop-eyebrow' }, icon(TM_KINDS[t.kind].icon), `${TM_KINDS[t.kind].name.toUpperCase()} · ${cat.name.toUpperCase()}`),
      h('h2', {}, t.label),
      t.message ? h('p', { class: 'tm-pop-msg' }, t.message) : null,
      h('div', { class: 'tm-pop-time' }, h('b', {}, ltFmt.format(t.firedAt)), h('small', {}, 'LT'), h('span', { class: 'tm-pop-since' }, `${tmClock(now - t.firedAt)} geleden`)),
      t.note ? h('p', { class: 'tm-pop-note' }, t.note) : null,
      h('div', { class: 'tm-pop-actions' },
        t.kind === 'alarm' ? h('button', { class: 'btn', onclick: () => tmSnooze(t, 5) }, icon('clock'), 'Over 5 minuten opnieuw') : null,
        h('button', { class: 'btn primary', onclick: () => tmAck(t) }, icon('check'), 'Bevestigen'))));
  document.body.append(tm.popup);
}
function tmAck(t) { t.ackedAt = tmNow(); tmSave(t); plog('info', `timer "${t.label}" bevestigd`); }
function tmSnooze(t, min) { t.at = tmNow() + min * 60000; t.firedAt = null; t.ackedAt = null; tmSave(t); toast(`${t.label}: over ${min} minuten opnieuw`); }

/* ---------- the tab badge ---------- */
// In the tab of a page with the Timings tab: the nearest running timer and the number running; nothing when none.
function timingsTabBadge(page) {
  if (!page.widgets.some((w) => w.type === 'timings')) return null;
  const el = h('span', { class: 'tab-badge', hidden: true });
  el.paint = (list, now) => {
    const fired = list.filter((t) => t.firedAt && !t.ackedAt);
    const running = list.filter((t) => tmRunning(t)).map((t) => ({ t, left: tmRemaining(t, now) })).filter((x) => x.left != null && x.left > 0).sort((a, b) => a.left - b.left);
    el.hidden = !fired.length && !running.length;
    el.classList.toggle('fired', fired.length > 0);
    el.classList.toggle('soon', !fired.length && running.length > 0 && running[0].left < 60000);
    if (fired.length) { el.textContent = `${fired.length} AFGEGAAN`; el.title = fired.map((t) => t.label).join(', '); return; }
    if (running.length) { el.textContent = `${tmClock(running[0].left, { seconds: running[0].left < 3600e3 })}${running.length > 1 ? ' · ' + running.length : ''}`; el.title = `${running[0].t.label}${running.length > 1 ? ` en ${running.length - 1} andere` : ''}`; }
  };
  tm.badges.add(el);
  if (OPS.loaded) el.paint(tmTimers(), tmNow());
  return el;
}

/* ---------- making and editing ---------- */
function tmNew(kind, extra = {}) {
  const s = tmSettings();
  return { label: '', kind, cat: 'mission', note: '', message: '', durationMs: 10 * 60000, startedAt: null, elapsedMs: 0, at: null, geo: null, warnMin: s.warnMin, sound: null, warnSound: null, popup: null, firedAt: null, ackedAt: null, createdAt: tmNow(), by: OPS.screen.name, ...extra };
}
function tmAdd(t, { start = true } = {}) {
  const id = OPS.uid();
  const it = { ...t, order: tmNow() };
  if (start && it.kind === 'timer' && it.startedAt == null) it.startedAt = tmNow();
  OPS.put('ops', 'timers', id, it);
  return { id, ...it };
}
function tmStartPause(t) {
  if (t.kind !== 'timer') return;
  if (t.firedAt) { t.firedAt = null; t.ackedAt = null; t.elapsedMs = 0; t.startedAt = tmNow(); }
  else if (t.startedAt != null) { t.elapsedMs = (t.elapsedMs || 0) + (tmNow() - t.startedAt); t.startedAt = null; }
  else t.startedAt = tmNow();
  tmSave(t);
}
function tmReset(t) {
  if (t.kind === 'timer') { t.elapsedMs = 0; t.startedAt = null; }
  t.firedAt = null; t.ackedAt = null; t.geoArmed = false;
  tmSave(t);
}
function tmAdjust(t, min) {
  if (t.kind === 'timer') t.durationMs = Math.max(60000, t.durationMs + min * 60000);
  else if (t.kind === 'alarm' && t.at) t.at += min * 60000;
  if (t.firedAt && tmRemaining(t) > 0) { t.firedAt = null; t.ackedAt = null; }
  tmSave(t);
}

// The dialog for a new or existing timer: what it is, when, how it tells.
function tmEditDialog(t0, onDone) {
  const t = { ...tmNew('timer'), ...(t0 || {}) };
  const isNew = !t0 || !t0.id;
  const s = tmSettings();
  const label = textInput(t.label, { maxlength: 60, placeholder: 'bv. Playtime, Bingo fuel, Holding verlaten' });
  const note = textInput(t.note || '', { maxlength: 160, placeholder: 'Toelichting op de kaart (optioneel)' });
  const message = textInput(t.message || '', { maxlength: 160, placeholder: 'Tekst van de melding als hij afgaat (optioneel)' });
  const catSel = h('select', { class: 'input' }, Object.entries(TM_CATS).map(([k, c]) => h('option', { value: k, selected: t.cat === k || null }, c.name)));
  const warn = h('input', { class: 'input', type: 'number', min: 0, max: 180, step: 1, value: t.warnMin ?? s.warnMin });
  const soundSel = (cur, def) => h('select', { class: 'input' }, [h('option', { value: '', selected: cur == null || null }, `Standaard (${TM_SOUNDS[def] || def})`), ...Object.entries(TM_SOUNDS).map(([k, n]) => h('option', { value: k, selected: cur === k || null }, n))]);
  const sound = soundSel(t.sound, s.sound), warnSound = soundSel(t.warnSound, s.warnSound);
  const popupSel = h('select', { class: 'input' }, [['', `Standaard (${s.popup ? 'pop-up' : 'alleen balk'})`], ['yes', 'Pop-up over het hele scherm'], ['no', 'Alleen de balk bovenaan']].map(([v, n]) => h('option', { value: v, selected: (t.popup == null ? '' : t.popup ? 'yes' : 'no') === v || null }, n)));
  // Duration (timer), moment (alarm) or aircraft and point (position).
  const hh = h('input', { class: 'input', type: 'number', min: 0, max: 99, value: Math.floor(t.durationMs / 3600e3) }), mm = h('input', { class: 'input', type: 'number', min: 0, max: 59, value: Math.floor((t.durationMs % 3600e3) / 60000) }), ss = h('input', { class: 'input', type: 'number', min: 0, max: 59, value: Math.floor((t.durationMs % 60000) / 1000) });
  const atMs = t.at || tmNow() + 30 * 60000;
  const atDate = new Date(atMs);
  const dateIn = h('input', { class: 'input', type: 'date', value: `${atDate.getFullYear()}-${pad2(atDate.getMonth() + 1)}-${pad2(atDate.getDate())}` });
  const timeIn = h('input', { class: 'input', type: 'time', value: `${pad2(atDate.getHours())}:${pad2(atDate.getMinutes())}` });
  const tzSeg = segmented([{ value: 'lt', label: 'LT' }, { value: 'utc', label: 'UTC' }], 'lt', (v) => { tz = v; });
  let tz = 'lt';
  const geo = t.geo || { hex: '', name: '', lat: null, lon: null, label: '', radiusNm: 1, mode: 'enter' };
  const own = (trafficFeed.snap && trafficFeed.snap.ac ? trafficFeed.snap.ac : []).filter((a) => a.group);
  const acSel = h('select', { class: 'input' }, [h('option', { value: '' }, own.length ? 'Kies een eigen toestel' : 'Geen eigen toestel in beeld'), ...own.map((a) => { const nm = UNIT_NAMES(a.hex) || {}; return h('option', { value: a.hex, selected: geo.hex === a.hex || null }, `${a.flight || a.reg || nm.reg || a.hex.toUpperCase()} · ${nm.reg || a.reg || ''} ${nm.type || a.type || ''} · ${FLEET_GROUPS[a.group] || ''}`); })]);
  const pointQ = textInput(geo.label || '', { placeholder: 'Plaats, platform, vliegveld of coördinaat zoeken…' });
  const pointRes = h('div', { class: 'zp-results tm-res', hidden: true });
  const pointPick = h('div', { class: 'tm-point' });
  const radius = h('input', { class: 'input', type: 'number', min: 0.1, max: 50, step: 0.1, value: geo.radiusNm || 1 });
  const paintPoint = () => {
    pointPick.classList.toggle('set', geo.lat != null);
    pointPick.replaceChildren(icon(geo.lat != null ? 'target' : 'globe'),
      geo.lat != null ? h('div', {}, h('b', {}, geo.label || 'Gekozen punt'), h('small', {}, `${PlanCoords.fmt(geo.lat, geo.lon, 'ddm')} · straal ${String(parseFloat(radius.value) || 1).replace('.', ',')} NM`)) : h('div', {}, h('b', {}, 'Nog geen punt gekozen'), h('small', {}, 'Zoek hierboven, of wijs het punt aan op de kaart.')),
      h('button', { class: 'btn zp-btn' + (geo.lat != null ? '' : ' primary'), title: 'Het punt op de kaart aanwijzen', onclick: () => tmPointOnMap(geo, () => { pointQ.value = geo.label || ''; paintPoint(); }) }, icon('globe'), geo.lat != null ? 'Op de kaart' : 'Kies op de kaart'));
  };
  radius.addEventListener('input', () => { geo.radiusNm = clamp(parseFloat(radius.value) || 1, 0.1, 50); paintPoint(); });
  paintPoint();
  let seq = 0;
  pointQ.addEventListener('input', async () => {
    const q = pointQ.value.trim();
    const my = ++seq;
    if (q.length < 2) { pointRes.hidden = true; return; }
    const coord = PlanCoords.parse ? PlanCoords.parse(q) : null;
    let items = [];
    if (coord) items.push({ label: PlanCoords.fmt(coord.lat, coord.lon, 'ddm'), sub: 'Coördinaat', lat: coord.lat, lon: coord.lon });
    try { const r = await window.palv.plan.suggest(q, { limit: 8 }); if (my !== seq) return; if (r && Array.isArray(r.items)) items = items.concat(r.items); } catch { /* none */ }
    // Favourites and bases of Zoek & Plan with the same name.
    for (const f of OPS.list('shared', 'favorites')) if (String(f.name).toLowerCase().includes(q.toLowerCase())) items.unshift({ label: f.name, sub: 'Favoriet', lat: f.lat, lon: f.lon });
    pointRes.replaceChildren(...items.slice(0, 10).map((it) => h('div', { class: 'zp-res', onclick: async () => {
      let pt = it;
      if (pt.lat == null && pt.id) { try { pt = await window.palv.plan.resolve(pt.id); } catch { pt = null; } }
      if (!pt || pt.lat == null) return toast('Geen positie voor dit punt', true);
      geo.lat = +pt.lat; geo.lon = +pt.lon; geo.label = String(it.label || pt.label || '').split(',')[0].slice(0, 40);
      pointQ.value = geo.label; pointRes.hidden = true;
      paintPoint();
    } }, icon('target'), h('div', {}, h('b', {}, it.label), h('small', {}, it.sub || '')))));
    pointRes.hidden = !items.length;
  });
  const modeSeg = segmented([{ value: 'enter', label: 'Bereikt het punt' }, { value: 'leave', label: 'Verlaat het gebied' }], geo.mode || 'enter', (v) => { geo.mode = v; });
  const kindBox = h('div', { class: 'tm-kindbox' });
  const paintKind = () => {
    kindBox.replaceChildren(...(t.kind === 'timer' ? [h('div', { class: 'row tm-dur' }, field('Uren', hh), field('Minuten', mm), field('Seconden', ss)), h('div', { class: 'tm-quick' }, [1, 2, 5, 10, 15, 30, 45, 60, 90, 120].map((m) => h('button', { class: 'btn', onclick: () => { hh.value = Math.floor(m / 60); mm.value = m % 60; ss.value = 0; } }, `${m} min`)))]
      : t.kind === 'alarm' ? [h('div', { class: 'row' }, field('Datum', dateIn), field('Tijd', timeIn), h('div', { class: 'field', style: 'flex:0 0 auto' }, h('label', {}, 'Tijdzone'), tzSeg)), h('div', { class: 'tm-quick' }, [5, 10, 15, 30, 60].map((m) => h('button', { class: 'btn', onclick: () => { const d = new Date(tmNow() + m * 60000); tz = 'lt'; tzSeg.setValue('lt'); dateIn.value = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; timeIn.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; } }, `over ${m} min`)))]
      : [field('Eigen toestel', acSel, 'Alleen toestellen die nu op de live-bron te zien zijn (Politie, Trauma, Kustwacht).'), h('div', { class: 'field', style: 'position:relative' }, h('label', {}, 'Punt'), pointQ, pointRes, pointPick), h('div', { class: 'row' }, field('Straal (NM)', radius, 'Afgegaan zodra het toestel binnen deze afstand van het punt is'), h('div', { class: 'field' }, h('label', {}, 'Wanneer'), modeSeg))]));
  };
  const kindSeg = segmented(Object.entries(TM_KINDS).map(([k, d]) => ({ value: k, label: d.name, icon: d.icon, title: d.hint })), t.kind, (v) => { t.kind = v; paintKind(); });
  paintKind();
  const body = [
    h('div', { class: 'row' }, field('Naam', label), h('div', { class: 'field', style: 'flex:0 0 11rem' }, h('label', {}, 'Categorie'), catSel)),
    h('div', { class: 'field' }, h('label', {}, 'Soort'), kindSeg),
    kindBox,
    h('hr'),
    h('div', { class: 'row' }, field('Waarschuwing vooraf (minuten)', warn, '0 = geen waarschuwing vooraf'), field('Geluid vooraf', warnSound)),
    h('div', { class: 'row' }, field('Geluid als hij afgaat', sound), field('Melding', popupSel)),
    field('Tekst van de melding', message), field('Toelichting', note),
    h('div', { class: 'hint' }, 'De timer staat op alle schermen van de eenheid en gaat overal tegelijk af; Bevestigen op één scherm stopt hem overal.'),
  ];
  openModal({
    title: isNew ? 'Nieuwe timing' : 'Timing bewerken', body, wide: true,
    actions: [
      !isNew ? { label: 'Verwijderen', danger: true, left: true, onClick: () => OPS.put('ops', 'timers', t0.id, null) } : null,
      { label: 'Annuleren' },
      { label: isNew ? (t.kind === 'timer' ? 'Starten' : 'Zetten') : 'Opslaan', primary: true, onClick: () => {
        t.label = label.value.trim() || (t.kind === 'geo' ? geo.label || 'Positie' : TM_KINDS[t.kind].name);
        t.cat = catSel.value; t.note = note.value.trim(); t.message = message.value.trim();
        t.warnMin = clamp(parseInt(warn.value, 10) || 0, 0, 180);
        t.sound = sound.value || null; t.warnSound = warnSound.value || null; t.popup = popupSel.value === '' ? null : popupSel.value === 'yes';
        if (t.kind === 'timer') {
          const d = ((+hh.value || 0) * 3600 + (+mm.value || 0) * 60 + (+ss.value || 0)) * 1000;
          if (d < 1000) { toast('Vul een duur in', true); return false; }
          if (d !== t.durationMs) { t.durationMs = d; if (!isNew) { t.elapsedMs = 0; t.startedAt = t.startedAt != null ? tmNow() : null; t.firedAt = null; t.ackedAt = null; } }
        } else if (t.kind === 'alarm') {
          const [y, mo, d] = dateIn.value.split('-').map(Number), [H, M] = timeIn.value.split(':').map(Number);
          if (!y || Number.isNaN(H)) { toast('Vul datum en tijd in', true); return false; }
          t.at = tz === 'utc' ? Date.UTC(y, mo - 1, d, H, M) : new Date(y, mo - 1, d, H, M).getTime();
          if (t.at <= tmNow()) { toast('Dat tijdstip is al voorbij', true); return false; }
          t.firedAt = null; t.ackedAt = null;
        } else {
          if (!acSel.value) { toast('Kies een eigen toestel', true); return false; }
          if (geo.lat == null) { toast('Kies een punt', true); return false; }
          const a = own.find((x) => x.hex === acSel.value), nm = a ? UNIT_NAMES(a.hex) || {} : {};
          t.geo = { ...geo, hex: acSel.value, name: a ? a.flight || a.reg || nm.reg || a.hex.toUpperCase() : acSel.value, radiusNm: clamp(parseFloat(radius.value) || 1, 0.1, 50) };
          t.geoArmed = false; t.firedAt = null; t.ackedAt = null;
        }
        if (isNew) tmAdd(t); else tmSave({ ...t, id: t0.id });
        if (onDone) onDone();
      } },
    ].filter(Boolean),
  });
  label.focus();
}

// The point of a position timer, chosen on a map: tap where it must be, the ring shows the radius, and
// the nearest place (or the coordinate) becomes the label. `geo` is filled in and `onPick` called.
function tmPointOnMap(geo, onPick) {
  const mapEl = h('div', { class: 'wb-pickmap' });
  const stageEl = h('div', { class: 'wb-pickstage tm-pickstage' }, mapEl);
  const info = h('div', { class: 'wb-pickinfo' });
  const q = h('input', { class: 'zp-q', type: 'search', placeholder: 'Plaats, platform, vliegveld, favoriet of coördinaat…' });
  const res = h('div', { class: 'zp-results', hidden: true });
  const s = tmSettings();
  const picks = { base: s.pickBase || 'osm', raster: s.pickSea ? ['seamark'] : [] };
  const fake = { cfg: picks };
  let map = null, base = null, ro = null, mo = null, seq = 0, marker = null, ring = null;
  let pick = geo.lat != null ? { lat: geo.lat, lon: geo.lon, label: geo.label || '' } : null;
  const radiusNm = () => clamp(parseFloat(geo.radiusNm) || 1, 0.1, 50);
  const bases = [{ value: 'osm', label: 'Kaart' }, { value: 'sat', label: 'Satelliet' }, { value: 'brt', label: 'Topo NL' }, { value: 'vfr', label: 'VFR' }];
  const baseSeg = segmented(bases, bases.some((b) => b.value === picks.base) ? picks.base : 'osm', (v) => { picks.base = v; s.pickBase = v; save(); if (base) base.apply(); });
  const seaChk = checkbox('Zeekaart', !!s.pickSea, (v) => { s.pickSea = v; picks.raster = v ? ['seamark'] : []; save(); if (base) base.applyRaster(); });
  const pinIcon = () => L.divIcon({ className: 'tm-pin', html: '<svg viewBox="0 0 24 24" fill="none" stroke="#ffd21f" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4" fill="#ffd21f" fill-opacity="0.35"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></svg>', iconSize: [26, 26], iconAnchor: [13, 13] });
  // The nearest place as a name, with the coordinate as the fallback; a better name may come in later.
  const describe = (lat, lon) => {
    const n = typeof PLACES !== 'undefined' && PLACES.near ? PLACES.near(lat, lon) : null;
    if (n) return n.above ? n.name : `${n.km.toFixed(n.km < 10 ? 1 : 0).replace('.', ',')} km ${n.dir} van ${n.name}`;
    return PlanCoords.fmt(lat, lon, 'ddm');
  };
  const paintInfo = () => {
    if (!pick) { info.replaceChildren(h('b', {}, 'Tik op de kaart'), h('span', {}, 'om het punt te kiezen')); return; }
    info.replaceChildren(h('b', {}, PlanCoords.fmt(pick.lat, pick.lon, 'ddm')), h('span', {}, `${pick.label} · straal ${String(radiusNm()).replace('.', ',')} NM`));
  };
  const setPick = (lat, lon, label) => {
    pick = { lat: +lat.toFixed(6), lon: +lon.toFixed(6), label: (label || describe(lat, lon)).slice(0, 40) };
    if (map) {
      if (!marker) marker = L.marker([pick.lat, pick.lon], { icon: pinIcon(), keyboard: false, interactive: false }).addTo(map); else marker.setLatLng([pick.lat, pick.lon]);
      if (!ring) ring = L.circle([pick.lat, pick.lon], { radius: radiusNm() * 1852, color: '#ffd21f', weight: 2, dashArray: '6 5', fillColor: '#ffd21f', fillOpacity: 0.1, interactive: false }).addTo(map); else { ring.setLatLng([pick.lat, pick.lon]); ring.setRadius(radiusNm() * 1852); }
    }
    paintInfo();
    if (!label) { const my = ++seq; window.palv.plan.reverse(pick.lat, pick.lon).then((r) => { if (my !== seq || !pick || !r || r.ok === false || !r.label || !(r.distance < 2500)) return; const n = PLACES.near(pick.lat, pick.lon); if (n && n.above) return; pick.label = String(r.label).split(',')[0].slice(0, 40); paintInfo(); }).catch(() => {}); }
  };
  q.addEventListener('input', async () => {
    const str = q.value.trim(); const my = ++seq;
    if (str.length < 2) { res.hidden = true; return; }
    const coord = PlanCoords.parse ? PlanCoords.parse(str) : null;
    let items = [];
    if (coord) items.push({ label: PlanCoords.fmt(coord.lat, coord.lon, 'ddm'), sub: 'Coördinaat', lat: coord.lat, lon: coord.lon });
    for (const f of OPS.list('shared', 'favorites')) if (String(f.name).toLowerCase().includes(str.toLowerCase())) items.push({ label: f.name, sub: 'Favoriet', lat: f.lat, lon: f.lon });
    try { const r = await window.palv.plan.suggest(str, { limit: 8 }); if (my !== seq) return; if (r && Array.isArray(r.items)) items = items.concat(r.items); } catch { /* none */ }
    res.replaceChildren(...items.slice(0, 10).map((it) => h('div', { class: 'zp-res', onclick: async () => {
      let pt = it;
      if (pt.lat == null && pt.id) { try { pt = await window.palv.plan.resolve(pt.id); } catch { pt = null; } }
      if (!pt || pt.lat == null) return toast('Geen positie voor dit punt', true);
      res.hidden = true; q.value = String(it.label || '').split(',')[0];
      setPick(+pt.lat, +pt.lon, String(it.label || pt.label || '').split(',')[0]);
      if (map) map.setView([+pt.lat, +pt.lon], Math.max(map.getZoom(), 11));
    } }, icon('target'), h('div', {}, h('b', {}, it.label), h('small', {}, it.sub || '')))));
    res.hidden = !items.length;
  });
  q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const first = res.querySelector('.zp-res'); if (first) first.click(); } ev.stopPropagation(); });
  const cleanup = () => { if (ro) ro.disconnect(); if (mo) mo.disconnect(); if (base) base.destroy(); if (map) { map.remove(); map = null; } };
  const close = openModal({
    title: 'Punt op de kaart', wide: true, cls: 'wb-mapmodal tm-pickmodal',
    body: [
      h('div', { class: 'wb-pickbar' }, h('div', { class: 'zp-search wb-picksearch' }, icon('search'), q, res), baseSeg, seaChk, h('span', { class: 'zp-spacer' }), info),
      stageEl,
      h('p', { class: 'zp-hint' }, 'Tik of klik op de kaart waar de timer op moet reageren; de gele ring is de straal. Slepen verschuift de kaart, het wiel of de knoppen zoomen.'),
    ],
    actions: [{ label: 'Annuleren', onClick: cleanup }, { label: 'Dit punt kiezen', primary: true, onClick: () => { if (!pick) { toast('Tik eerst op de kaart', true); return false; } geo.lat = pick.lat; geo.lon = pick.lon; geo.label = pick.label; cleanup(); if (onPick) onPick(); } }],
  });
  const backdrop = mapEl.closest('.modal-backdrop');
  mo = new MutationObserver(() => { if (backdrop && !backdrop.isConnected) cleanup(); });
  mo.observe($('#modal-root'), { childList: true });
  setTimeout(() => {
    const last = pick ? { lat: pick.lat, lon: pick.lon, zoom: 11 } : s.pickView || { lat: 52.3, lon: 4.75, zoom: 8 };
    map = L.map(mapEl, { zoomControl: true, attributionControl: true, zoomSnap: 0, zoomDelta: 0.5, minZoom: 3, maxZoom: 19, fadeAnimation: false, inertia: true, doubleClickZoom: false });
    map.attributionControl.setPrefix(false);
    map.setView([last.lat, last.lon], last.zoom, { animate: false });
    base = zpBaseLayers({ map, el: mapEl, w: fake });
    base.apply();
    map.on('click', (e) => { setPick(e.latlng.lat, e.latlng.lng); });
    map.on('moveend zoomend', () => { const c = map.getCenter(); s.pickView = { lat: +c.lat.toFixed(5), lon: +c.lng.toFixed(5), zoom: +map.getZoom().toFixed(2) }; save(); });
    ro = new ResizeObserver(() => map.invalidateSize(false));
    ro.observe(stageEl);
    if (pick) setPick(pick.lat, pick.lon, pick.label);
    paintInfo();
  }, 30);
  void close;
}

// A position timer in one tap: the dialog opens on Positie, with the own aircraft that is flying now
// (or the only one in view) already chosen, so only the point and the radius are left to fill in.
function tmPositionQuick() {
  const own = (trafficFeed.snap && trafficFeed.snap.ac ? trafficFeed.snap.ac : []).filter((a) => a.group);
  const flying = own.filter((a) => a.alt == null || a.alt > 100 || (a.gs || 0) > 30);
  const pick = flying.length === 1 ? flying[0] : own.length === 1 ? own[0] : flying.find((a) => a.group === 'police') || null;
  tmEditDialog({ ...tmNew('geo'), label: '', geo: { hex: pick ? pick.hex : '', name: '', lat: null, lon: null, label: '', radiusNm: 1, mode: 'enter' } });
}

// L-hour: the TACSOP ingress chain as one set of alarms.
function tmLhourDialog() {
  const d = new Date(tmNow() + 60 * 60000);
  const timeIn = h('input', { class: 'input', type: 'time', value: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` });
  const dateIn = h('input', { class: 'input', type: 'date', value: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` });
  const name = textInput('', { maxlength: 30, placeholder: 'bv. Operatie X' });
  const checks = TM_LHOUR.map((e) => ({ e, box: h('input', { type: 'checkbox', checked: true }) }));
  const extra = textInput('', { placeholder: 'Eigen punten: bv. -45 Step, -10 Lights out (minuten voor L-uur, komma\'s ertussen)' });
  openModal({
    title: 'L-uur ketting (TACSOP ingress)', wide: true,
    body: [
      h('p', { class: 'hint' }, 'L-uur is het moment dat de eerste trooping-helikopter wheels on ground (of rope on ground) is. De standaardpunten van de ingress worden als wekkers gezet, elk met een minuut waarschuwing vooraf; alle schermen tellen mee.'),
      h('div', { class: 'row' }, field('Naam van de missie', name), field('Datum', dateIn), field('L-uur (LT)', timeIn)),
      h('div', { class: 'tm-lhour' }, checks.map(({ e, box }) => h('label', { class: 'check' }, box, h('b', {}, e.min ? `L-${e.min}` : 'L'), h('span', {}, e.label), h('small', {}, e.note)))),
      field('Extra punten', extra),
    ],
    actions: [{ label: 'Annuleren' }, { label: 'Wekkers zetten', primary: true, onClick: () => {
      const [y, mo, dd] = dateIn.value.split('-').map(Number), [H, M] = timeIn.value.split(':').map(Number);
      const L = new Date(y, mo - 1, dd, H, M).getTime();
      if (!(L > tmNow())) { toast('L-uur moet in de toekomst liggen', true); return false; }
      const chain = OPS.uid();
      const items = [];
      const prefix = name.value.trim() ? name.value.trim() + ' · ' : '';
      for (const { e, box } of checks) if (box.checked) items.push({ min: e.min, label: e.label, note: e.note });
      for (const part of extra.value.split(',')) { const m = /^\s*-?(\d+)\s+(.+?)\s*$/.exec(part); if (m) items.push({ min: +m[1], label: m[2], note: '' }); }
      const puts = items.map((it, i) => ({ list: 'timers', id: OPS.uid(), item: { ...tmNew('alarm', { label: `${prefix}${it.min ? `L-${it.min} ` : 'L '}${it.label}`, note: it.note, cat: 'mission', at: L - it.min * 60000, warnMin: 1, chain, order: tmNow() + i, popup: it.min === 0 ? true : null }) } }));
      OPS.putMany('ops', puts);
      toast(`${puts.length} wekkers gezet rond L-uur ${timeIn.value} LT`);
    } }],
  });
}

/* ---------- the tab ---------- */
const TM_SORTS = { remaining: 'Resterende tijd', time: 'Tijdstip', label: 'Naam', cat: 'Categorie', created: 'Aangemaakt' };
function tmCreate(body, w) {
  const cfg = w.cfg;
  const root = h('div', { class: 'tm' });
  const bar = h('div', { class: 'zp-bar tm-bar' });
  const grid = h('div', { class: 'tm-grid' });
  const side = h('aside', { class: 'tm-side' });
  const main = h('div', { class: 'tm-main' }, grid);
  root.append(bar, h('div', { class: 'tm-body' }, main, side));
  body.append(root);
  root.classList.toggle('side-off', cfg.side === false);

  // Toolbar: add, L-hour, quick timers, sort, filter.
  const addBtn = h('button', { class: 'btn zp-btn primary', title: 'Nieuwe timer, wekker of positietimer', onclick: () => tmEditDialog(null) }, icon('plus'), 'Nieuw');
  const quickPop = h('div', { class: 'vr-pop left tm-quickpop', hidden: true });
  const paintQuick = () => quickPop.replaceChildren(h('h4', {}, 'Snel'),
    h('div', { class: 'tm-quick' }, [5, 10, 15, 30, 45, 60].map((m) => h('button', { class: 'btn', onclick: () => { tmAdd(tmNew('timer', { label: `${m} min`, durationMs: m * 60000, cat: 'other' })); quickPop.hidden = true; } }, `${m} min`))),
    h('h4', {}, 'Voorkeuzes'),
    ...TM_QUICK.map((q) => h('button', { class: 'zp-linkbtn', title: q.hint, onclick: () => { tmEditDialog({ ...tmNew('timer', { label: q.label, durationMs: q.min * 60000, cat: q.cat, note: q.hint }) }); quickPop.hidden = true; } }, h('b', {}, q.label), h('small', {}, `${q.min} min · ${TM_CATS[q.cat].name} · ${q.hint}`))),
    h('button', { class: 'zp-linkbtn', onclick: () => { tmLhourDialog(); quickPop.hidden = true; } }, h('b', {}, 'L-uur ketting'), h('small', {}, 'Holding, 5-3-2-1 en HAMMER volgens de TACSOP-ingress')));
  const quickBtn = h('button', { class: 'btn zp-btn', title: 'Snelle timers en voorkeuzes', onclick: () => { paintQuick(); quickPop.hidden = !quickPop.hidden; } }, icon('history'), 'Snel');
  const posBtn = h('button', { class: 'btn zp-btn', title: 'Een positietimer voor de kist: gaat af als het toestel een punt bereikt of een gebied verlaat', onclick: () => tmPositionQuick() }, icon('plane'), 'Positie');
  const lBtn = h('button', { class: 'btn zp-btn', title: 'Wekkers rond L-uur volgens de TACSOP', onclick: tmLhourDialog }, icon('target'), 'L-uur');
  const sortSel = h('select', { class: 'input zp-sel', title: 'Sorteren', onchange: () => { cfg.sort = sortSel.value; save(); paint(); } }, Object.entries(TM_SORTS).map(([k, n]) => h('option', { value: k, selected: cfg.sort === k || null }, n)));
  const filterSeg = segmented([{ value: 'all', label: 'Alles' }, { value: 'running', label: 'Lopend' }, { value: 'done', label: 'Afgegaan' }, ...Object.entries(TM_CATS).map(([k, c]) => ({ value: 'cat:' + k, label: c.name }))], cfg.filter || 'all', (v) => { cfg.filter = v; save(); paint(); });
  const clearBtn = h('button', { class: 'btn zp-btn', title: 'Alle bevestigde en afgelopen timers opruimen', onclick: () => {
    const old = tmTimers().filter((t) => t.ackedAt);
    if (!old.length) return toast('Niets op te ruimen');
    confirmDialog('Opruimen', `${old.length} bevestigde timer(s) verwijderen, ook op de andere schermen?`, 'Opruimen', () => OPS.putMany('ops', old.map((t) => ({ list: 'timers', id: t.id, item: null }))));
  } }, icon('trash'), 'Opruimen');
  const settingsBtn = h('button', { class: 'btn zp-btn', title: 'Geluiden en standaardwaarden', onclick: () => tmSettingsDialog() }, icon('gear'), 'Geluiden');
  const sideBtn = h('button', { class: 'btn zp-btn', title: 'Tijdlijn tonen of verbergen', onclick: () => { cfg.side = cfg.side === false; root.classList.toggle('side-off', cfg.side === false); save(); } }, icon('layout'), 'Tijdlijn');
  bar.append(addBtn, quickBtn, posBtn, lBtn, h('span', { class: 'zp-spacer' }), filterSeg, sortSel, clearBtn, settingsBtn, sideBtn);
  main.append(quickPop);
  const closePop = (e) => { if (!quickPop.hidden && !quickPop.contains(e.target) && !quickBtn.contains(e.target)) quickPop.hidden = true; };
  document.addEventListener('pointerdown', closePop, true);

  // Cards: built when the list changes, the numbers repainted every second.
  const cards = new Map(); // id -> { el, paint }
  function card(t) {
    const cat = TM_CATS[t.cat] || TM_CATS.other;
    const kind = TM_KINDS[t.kind] || TM_KINDS.timer;
    const big = h('div', { class: 'tm-big' });
    const sub = h('div', { class: 'tm-sub' });
    const ring = h('svg', { class: 'tm-ring', viewBox: '0 0 36 36' });
    ring.innerHTML = '<circle class="tm-ring-bg" cx="18" cy="18" r="15.9"/><circle class="tm-ring-fg" cx="18" cy="18" r="15.9" stroke-dasharray="100 100"/>';
    const fg = ring.lastChild;
    const chip = h('span', { class: 'tm-state' });
    const geoBox = t.kind === 'geo' ? h('div', { class: 'tm-geo' }) : null;
    const actions = h('div', { class: 'tm-actions' });
    const paintActions = () => {
      actions.replaceChildren(
        t.firedAt && !t.ackedAt ? h('button', { class: 'btn primary', onclick: () => tmAck(t) }, icon('check'), 'Bevestigen') : null,
        t.kind === 'timer' ? h('button', { class: 'btn', title: t.startedAt != null ? 'Pauzeren' : 'Starten', onclick: () => tmStartPause(t) }, icon(t.startedAt != null ? 'min' : 'right'), t.startedAt != null ? 'Pauze' : t.firedAt ? 'Opnieuw' : 'Start') : null,
        t.kind !== 'geo' ? h('button', { class: 'btn', title: 'Een minuut erbij', onclick: () => tmAdjust(t, 1) }, '+1') : null,
        t.kind !== 'geo' ? h('button', { class: 'btn', title: 'Vijf minuten erbij', onclick: () => tmAdjust(t, 5) }, '+5') : null,
        h('button', { class: 'btn', title: 'Terugzetten', onclick: () => tmReset(t) }, icon('refresh')),
        h('button', { class: 'btn', title: 'Bewerken', onclick: () => tmEditDialog(t) }, icon('edit')),
        h('button', { class: 'btn danger', title: 'Verwijderen', onclick: () => confirmDialog('Timing verwijderen', `"${t.label}" verwijderen, ook op de andere schermen?`, 'Verwijderen', () => OPS.put('ops', 'timers', t.id, null)) }, icon('trash')));
    };
    const el = h('div', { class: `tm-card ${t.kind}`, style: `--tm-c:${cat.color}`, 'data-id': t.id },
      h('div', { class: 'tm-card-head' }, h('span', { class: 'tm-kind', title: kind.name }, icon(kind.icon)), h('b', { class: 'tm-label' }, t.label), h('span', { class: 'tm-cat' }, cat.name), chip),
      h('div', { class: 'tm-card-mid' }, h('div', { class: 'tm-ringbox' }, ring, big), h('div', { class: 'tm-info' }, sub, geoBox, t.note ? h('p', { class: 'tm-note' }, t.note) : null, t.message ? h('p', { class: 'tm-msg' }, icon('alert'), t.message) : null)),
      actions);
    paintActions();
    const paint = (now) => {
      const left = tmRemaining(t, now);
      const due = tmDue(t, now);
      let cls = 'idle', word = 'Niet gestart';
      if (t.ackedAt) { cls = 'acked'; word = `Bevestigd ${ltFmt.format(t.ackedAt)}`; }
      else if (t.firedAt) { cls = 'fired'; word = 'AFGEGAAN'; }
      else if (tmPaused(t)) { cls = 'paused'; word = 'Gepauzeerd'; }
      else if (tmRunning(t)) { cls = left != null && left <= (t.warnMin || 0) * 60000 ? 'soon' : 'running'; word = t.kind === 'geo' ? 'Bewaakt' : 'Loopt'; }
      el.dataset.state = cls;
      chip.textContent = word;
      big.textContent = t.firedAt ? (t.ackedAt ? tmClock(0) : '-' + tmClock(now - t.firedAt)) : tmClock(left, { seconds: left == null || Math.abs(left) < 3600e3 * 10 });
      const total = t.kind === 'timer' ? t.durationMs : t.kind === 'alarm' && t.at ? Math.max(1, t.at - (t.createdAt || t.at - 3600e3)) : null;
      const frac = total && left != null ? clamp(left / total, 0, 1) : t.firedAt ? 0 : 1;
      fg.setAttribute('stroke-dasharray', `${(frac * 100).toFixed(1)} 100`);
      sub.replaceChildren(...[
        due ? h('span', {}, `${t.kind === 'alarm' ? 'Om' : 'Eindigt'} ${tmTimeText(due)}`) : t.kind === 'timer' ? h('span', {}, `Duur ${tmClock(t.durationMs)}`) : null,
        t.warnMin ? h('span', {}, `Waarschuwing ${t.warnMin} min vooraf`) : null,
        t.by ? h('span', {}, `Gezet op ${t.by}${t.createdAt ? ' · ' + ltFmt.format(t.createdAt) : ''}`) : null].filter(Boolean));
      if (geoBox) {
        const g = tmGeoState(t, now);
        geoBox.replaceChildren(
          h('b', {}, `${t.geo.name || t.geo.hex} → ${t.geo.label || 'punt'}`),
          h('span', {}, `${t.geo.mode === 'leave' ? 'Verlaat' : 'Bereikt'} binnen ${t.geo.radiusNm} NM · ${PlanCoords.fmt(t.geo.lat, t.geo.lon, 'ddm')}`),
          g && g.a ? h('span', {}, `Nu ${PlanUnits.fmtDist(g.distM, 'nm')} · ${g.a.gs != null ? Math.round(g.a.gs) + ' kt' : '—'} · ${vrAltText(g.a)}${g.etaMs != null ? ` · ETA ${tmClock(g.etaMs)}` : g.a.gs > 5 ? ' · vliegt er niet heen' : ''}`) : h('span', { class: 'warn' }, g && g.text ? g.text : 'Toestel niet in beeld'));
      }
    };
    return { el, paint, paintActions, t };
  }
  function visible(list) {
    const f = cfg.filter || 'all';
    let out = list.filter((t) => f === 'all' ? true : f === 'running' ? tmRunning(t) || tmPaused(t) : f === 'done' ? !!t.firedAt : f.startsWith('cat:') ? t.cat === f.slice(4) : true);
    const now = tmNow();
    const by = cfg.sort || 'remaining';
    const key = (t) => {
      if (by === 'label') return [String(t.label).toLowerCase()];
      if (by === 'cat') return [t.cat, String(t.label).toLowerCase()];
      if (by === 'created') return [-(t.createdAt || 0)];
      if (by === 'time') { const d = tmDue(t, now); return [d == null ? Infinity : d]; }
      const r = tmRemaining(t, now);
      // Fired first, then by time left, paused and idle at the end.
      return [t.firedAt && !t.ackedAt ? -1 : t.ackedAt ? 3 : tmRunning(t) ? 0 : tmPaused(t) ? 1 : 2, r == null ? Infinity : r];
    };
    out.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i += 1) { if (ka[i] < kb[i]) return -1; if (ka[i] > kb[i]) return 1; } return 0; });
    return out;
  }
  let lastSig = '';
  function paint() {
    const list = visible(tmTimers());
    const now = tmNow();
    const sig = list.map((t) => `${t.id}:${t.updatedAt}:${t.firedAt}:${t.ackedAt}:${t.startedAt}`).join('|') + cfg.sort + cfg.filter;
    if (sig !== lastSig) {
      lastSig = sig;
      const keep = new Set();
      const els = list.map((t) => { let c = cards.get(t.id); if (!c || c.t.updatedAt !== t.updatedAt) { c = card(t); cards.set(t.id, c); } keep.add(t.id); return c.el; });
      for (const id of [...cards.keys()]) if (!keep.has(id)) cards.delete(id);
      grid.replaceChildren(...els);
      if (!els.length) grid.append(h('div', { class: 'tm-empty' }, icon('clock'), h('b', {}, tmTimers().length ? 'Niets in deze selectie' : 'Nog geen timers'), h('span', {}, 'Zet een timer, wekker of positietimer met Nieuw, of kies een snelle timer of de L-uur ketting.')));
    }
    for (const c of cards.values()) if (c.el.isConnected) c.paint(now);
    paintSide(now);
  }
  // Side: the timeline of what comes, in order, and what went.
  function paintSide(now) {
    const list = tmTimers();
    const coming = list.filter((t) => !t.firedAt && tmRunning(t)).map((t) => ({ t, due: tmDue(t, now), left: tmRemaining(t, now) })).filter((x) => x.due != null).sort((a, b) => a.due - b.due);
    const past = list.filter((t) => t.firedAt).sort((a, b) => b.firedAt - a.firedAt).slice(0, 12);
    const sig = coming.map((x) => x.t.id + Math.round(x.left / 1000)).join() + '#' + past.map((x) => x.id + x.ackedAt).join();
    if (side.dataset.sig === sig) return;
    side.dataset.sig = sig;
    side.replaceChildren(
      h('div', { class: 'tm-side-head' }, h('b', {}, 'TIJDLIJN'), h('span', {}, `${ltFmt.format(now)} LT · ${zulu(now)}`)),
      h('div', { class: 'tm-tl' }, coming.length ? coming.map(({ t, due, left }) => h('div', { class: 'tm-tl-row' + (left < 60000 ? ' soon' : ''), style: `--tm-c:${(TM_CATS[t.cat] || TM_CATS.other).color}`, onclick: () => { const c = cards.get(t.id); if (c) c.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } },
        h('b', {}, ltFmt.format(due)), h('span', { class: 'tm-tl-left' }, tmClock(left, { seconds: left < 3600e3 })), h('span', { class: 'tm-tl-label' }, t.label))) : h('p', { class: 'zp-hint' }, 'Niets gepland.')),
      ...(past.length ? [h('div', { class: 'tm-side-head' }, h('b', {}, 'AFGEGAAN')),
        h('div', { class: 'tm-tl past' }, past.map((t) => h('div', { class: 'tm-tl-row' + (t.ackedAt ? '' : ' fired'), style: `--tm-c:${(TM_CATS[t.cat] || TM_CATS.other).color}` }, h('b', {}, ltFmt.format(t.firedAt)), h('span', { class: 'tm-tl-left' }, t.ackedAt ? 'bevestigd' : 'open'), h('span', { class: 'tm-tl-label' }, t.label))))] : []));
  }
  const unsub = OPS.on('ops', () => { lastSig = ''; paint(); });
  const unwatch = tmWatch(() => { if (onScreen(body)) paint(); });
  paint();
  return { paint, destroy() { unsub(); unwatch(); document.removeEventListener('pointerdown', closePop, true); } };
}

// Instellingen: the standard sounds and warning, kept with this screen's settings.
function tmSettingsDialog() {
  const s = tmSettings();
  const sel = (key) => { const el = h('select', { class: 'input' }, Object.entries(TM_SOUNDS).map(([k, n]) => h('option', { value: k, selected: s[key] === k || null }, n))); el.onchange = () => { s[key] = el.value; save(); }; return el; };
  const sound = sel('sound'), warnSound = sel('warnSound');
  const warn = h('input', { class: 'input', type: 'number', min: 0, max: 180, value: s.warnMin, onchange: (e) => { s.warnMin = clamp(parseInt(e.target.value, 10) || 0, 0, 180); save(); } });
  const vol = h('input', { class: 'input', type: 'range', min: 0, max: 1, step: 0.05, value: s.volume ?? 0.8, oninput: (e) => { s.volume = +e.target.value; save(); } });
  const rep = h('input', { class: 'input', type: 'number', min: 5, max: 300, value: s.repeatS || 20, onchange: (e) => { s.repeatS = clamp(parseInt(e.target.value, 10) || 20, 5, 300); save(); } });
  openModal({
    title: 'Timings: geluiden en standaardwaarden', wide: true,
    body: [
      h('p', { class: 'hint' }, 'Standaard voor een nieuwe timing op dit scherm; per timing zijn ze aan te passen. Het geluid klinkt op elk scherm dat de timer heeft, tot iemand hem bevestigt (hooguit 15 minuten).'),
      h('div', { class: 'row' }, field('Geluid als een timing afgaat', sound), h('div', { class: 'field', style: 'flex:0 0 auto;align-self:flex-end' }, h('button', { class: 'btn', onclick: () => soundTest(() => tmPlay(sound.value)) }, icon('volume'), 'Test'))),
      h('div', { class: 'row' }, field('Geluid bij de waarschuwing vooraf', warnSound), h('div', { class: 'field', style: 'flex:0 0 auto;align-self:flex-end' }, h('button', { class: 'btn', onclick: () => soundTest(() => tmPlay(warnSound.value)) }, icon('volume'), 'Test'))),
      h('div', { class: 'row' }, field('Waarschuwing vooraf (minuten)', warn), field('Herhaal het geluid elke (seconden)', rep)),
      field('Volume', vol),
      checkbox('Pop-up over het hele scherm als een timing afgaat (anders alleen de balk bovenaan)', !!s.popup, (v) => { s.popup = v; save(); }),
      h('div', { class: 'hint' }, 'Het briefinggeluid is het eigen geluid van dit scherm onder Instellingen › Meldingen.'),
    ],
    actions: [{ label: 'Sluiten', primary: true }],
  });
}

/* ---------- Next event ---------- */
// The nearest coming timing (optionally of one category) as countdown, time, or both.
function tmNextEvent(list, now, cat) {
  const coming = list.filter((t) => !t.ackedAt && (t.firedAt || tmRunning(t)) && (cat === 'all' || !cat || t.cat === cat)).map((t) => ({ t, due: t.firedAt ? t.firedAt : tmDue(t, now), left: t.firedAt ? 0 : tmRemaining(t, now) })).filter((x) => x.due != null);
  coming.sort((a, b) => (a.t.firedAt ? -1 : 0) - (b.t.firedAt ? -1 : 0) || a.due - b.due);
  return coming[0] || null;
}
