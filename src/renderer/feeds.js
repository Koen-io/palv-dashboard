'use strict';

/* ============================================================
   Bronbewaking en de gedeelde live-bronnen: verkeer, weerstations, baangebruik, noodsquawks.
   ============================================================ */

/* ---------- Bronbewaking: a clear warning when a source has stopped delivering ---------- */
// Every source reports whether its data is current. One that stays behind for longer than its own grace
// shows in a red warning at the right of the tab bar, with when it last delivered. The moments a source
// drops out and comes back are written to the logbook.
const health = new Map(); // key -> { label, detail, since, grace, logged }
const BOOT_GRACE = 90000;
const bootAt = Date.now();
// report(key) without a label: the source no longer exists (widget removed, page out of view).
function report(key, label, ok, detail, grace = 120000) {
  if (!label || ok) {
    const cur = health.get(key);
    if (cur) {
      health.delete(key);
      if (cur.logged && label) plog('info', `bron weer actueel: ${cur.label}`);
      paintHealth();
    }
    return;
  }
  const cur = health.get(key);
  health.set(key, { label, detail, grace, since: cur ? cur.since : Date.now(), logged: cur ? cur.logged : false });
  paintHealth();
}
const dueSources = () => {
  const now = Date.now();
  return now - bootAt < BOOT_GRACE ? [] : [...health.values()].filter((e) => now - e.since >= e.grace);
};
function paintHealth() {
  const el = $('#health');
  if (!el) return;
  const due = dueSources();
  for (const e of due) if (!e.logged) { e.logged = true; plog('warn', `bron levert geen verse gegevens: ${e.label}`, e.detail); }
  const sig = due.map((e) => e.label + e.detail).join('|');
  if (sig === el.dataset.sig) return;
  el.dataset.sig = sig;
  el.hidden = !due.length;
  if (!due.length) return el.replaceChildren();
  el.title = 'Deze bronnen leveren al een tijd geen verse gegevens. Wat ze tonen kan verouderd zijn; ze worden automatisch opnieuw geprobeerd.\n\n' + due.map((e) => `${e.label}: ${e.detail}`).join('\n');
  el.replaceChildren(
    h('span', { class: 'health-icon' }, icon('alert')),
    h('b', {}, 'GEEN VERSE GEGEVENS'),
    ...due.map((e) => h('span', { class: 'health-item' }, e.label, h('small', {}, e.detail)))
  );
}

/* ---------- live traffic: one feed for the Vluchtradar, "In de lucht" and the emergency watch ---------- */
// The main process pushes a new round every second while someone watches. Each watcher may name an area
// (a radar on screen); the feed covers all of them, and always the own aircraft by their codes.
const trafficFeed = { snap: null, subs: new Map(), timer: null };

function trafficWatch() {
  if (!trafficFeed.subs.size) return;
  // One watcher that cannot tell its area (a map still starting) must never stop the others.
  const areas = [...trafficFeed.subs.values()].map((f) => { try { return f && f(); } catch { return null; } }).filter(Boolean);
  let area = null;
  if (areas.length) {
    const lat = areas.reduce((n, a) => n + a.lat, 0) / areas.length, lon = areas.reduce((n, a) => n + a.lon, 0) / areas.length;
    const nm = Math.max(...areas.map((a) => Math.hypot((a.lat - lat) * 60, (a.lon - lon) * 60 * Math.cos((lat * Math.PI) / 180)) + a.nm));
    area = { lat, lon, nm };
  }
  const groups = Object.fromEntries(Object.keys(FLEET_GROUPS).map((k) => [k, hexList(k)]));
  window.palv.traffic.watch({ area, groups }).catch(() => {});
}
function watchTraffic(fn, areaFn) {
  trafficFeed.subs.set(fn, areaFn || null);
  if (!trafficFeed.timer) trafficFeed.timer = setInterval(trafficWatch, 4000);
  trafficWatch();
  if (trafficFeed.snap) fn(trafficFeed.snap);
  return () => {
    trafficFeed.subs.delete(fn);
    if (trafficFeed.subs.size) trafficWatch();
    else { clearInterval(trafficFeed.timer); trafficFeed.timer = null; }
  };
}
// Registration and type of the own units as heard on the air, for the unit lists in the settings.
function learnUnits(fleet) {
  let changed = false;
  for (const a of fleet.aircraft) {
    if (!a.reg) continue;
    const cur = state.settings.unitInfo[a.hex];
    if (cur && cur.reg === a.reg && cur.type === (a.type || cur.type)) continue;
    state.settings.unitInfo[a.hex] = { reg: a.reg, type: a.type || (cur && cur.type) || null };
    changed = true;
  }
  if (changed) save();
}
window.palv.traffic.onUpdate((snap) => {
  if (!state) return; // a round from before a reload, while the dashboard is still starting
  trafficFeed.snap = snap;
  vrRecord(snap);
  if (snap.fleet) learnUnits(snap.fleet);
  for (const fn of trafficFeed.subs.keys()) fn(snap);
});

/* ---------- weather stations (METAR/TAF against the BOM minima) ---------- */
// One feed for all weather radar widgets, refreshed every minute while at least one of them is on screen.
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

/* ---------- runway use: per flight from Casper, live traffic as fallback ---------- */
const runwayViews = new Set();
async function refreshRunways() {
  // Only asked while a runway widget is on screen: Casper is then asked once a minute, otherwise not at all.
  if (!runwayViews.size) { report('runways'); return; }
  const res = await window.palv.data.runways().catch(() => null);
  if (res) eham.live = res;
  else if (eham.live) eham.live.ok = false;
  for (const paint of runwayViews) paint();
  const live = eham.live;
  if (!runwayViews.size) report('runways');
  else report('runways', 'Baangebruik', !!(live && live.ok), live && live.lastOk ? `laatst ${zulu(live.lastOk)}` : 'geen verbinding', 3 * 60000);
}

/* ============================================================
   Noodsquawk: an aircraft in distress in Dutch airspace
   ============================================================ */
// Every round of the feed goes through SQUAWK (squawk.js): only squawk 7500 (unlawful interference),
// 7600 (radio failure) or 7700 (emergency), seen for at least 30 s in several messages, counts, and the
// alert bar only shows aircraft inside FIR Amsterdam. Single garbled messages never give an alert.
// The feed always covers the whole FIR for this, also when no radar is on screen.
const NL_WATCH = { lat: 52.9, lon: 4.6, nm: 150 };
const emergency = { watch: SQUAWK.createWatch(), ack: new Map(), unwatch: null, audio: null };

function distanceFromSchiphol(a) {
  const dLat = (a.lat - 52.3086) * 60, dLon = (a.lon - 4.7639) * 60 * Math.cos((52.3 * Math.PI) / 180);
  const nm = Math.hypot(dLat, dLon);
  const brg = (Math.atan2(dLon, dLat) * 180) / Math.PI;
  const dirs = ['N', 'NO', 'O', 'ZO', 'Z', 'ZW', 'W', 'NW'];
  return { nm: Math.round(nm), dir: dirs[Math.round(((brg + 360) % 360) / 45) % 8] };
}

function emName(a) { return a.flight || a.reg || a.hex.toUpperCase(); }

function checkEmergencies(snap) {
  if (!state.settings.emergencyAlert || !snap || !snap.ac) { emergency.watch.clear(); emergency.ack.clear(); paintEmergency(); return; }
  const { started, ended } = emergency.watch.update(snap.ac, Date.now());
  let fresh = false;
  for (const t of started) {
    const where = distanceFromSchiphol(t.a), inside = SQUAWK.inFir(t.a.lat, t.a.lon);
    plog(inside ? 'warn' : 'info', `NOODSQUAWK ${t.code} (${SQUAWK.MEANING[t.code]}) bevestigd${inside ? '' : ' buiten FIR Amsterdam'}: ${emName(t.a)} ${t.a.type || ''}, ${t.a.alt} ft, ${where.nm} NM ${where.dir} van Schiphol, ${t.hits} berichten in ${Math.round((t.lastMsg - t.firstAt) / 1000)} s`);
    if (inside) fresh = true;
  }
  for (const t of ended) plog('info', `noodsquawk beëindigd: ${emName(t.a)}`);
  const shown = emergency.watch.active({ firOnly: true });
  // An acknowledged alert comes back when the code changes.
  for (const [hex, code] of emergency.ack) if (!shown.some((e) => e.hex === hex && e.code === code)) emergency.ack.delete(hex);
  if (fresh && shown.some((e) => !emergency.ack.has(e.hex)) && state.settings.emergencySound) chime();
  paintEmergency();
}

// Two soft tones, made on the spot; no sound files needed.
function chime() {
  if (isMuted()) return;
  try {
    const ctx = emergency.audio || (emergency.audio = new AudioContext());
    const t0 = ctx.currentTime + 0.02;
    [[880, 0], [660, 0.32], [880, 0.64], [660, 0.96]].forEach(([f, dt]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + dt);
      g.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.28);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + dt);
      o.stop(t0 + dt + 0.3);
    });
  } catch { /* no audio device */ }
}

function paintEmergency() {
  const root = $('#emergency');
  const list = state.settings.emergencyAlert ? emergency.watch.active({ firOnly: true }).filter((e) => !emergency.ack.has(e.hex)).map((e) => [e.hex, e]) : [];
  root.hidden = !list.length;
  document.body.classList.toggle('has-emergency', !!list.length);
  if (!list.length) return root.replaceChildren();
  const sig = JSON.stringify(list.map(([hex, e]) => [hex, e.code, e.a.alt, e.a.gs, Math.round(e.a.lat * 50), Math.round(e.a.lon * 50)]));
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  root.replaceChildren(...list.map(([hex, e]) => {
    const a = e.a, where = distanceFromSchiphol(a);
    const name = emName(a);
    return h('div', { class: 'em-row' },
      h('span', { class: 'em-icon' }, icon('alert')),
      h('span', { class: 'em-code' }, e.code),
      h('div', { class: 'em-main' },
        h('b', {}, `${e.meaning.toUpperCase()} · ${name}`),
        h('span', {}, [a.reg && a.reg !== name ? a.reg : null, a.type, a.alt != null ? `${Number(a.alt).toLocaleString('nl-NL')} ft` : null, a.gs != null ? `${Math.round(a.gs)} kt` : null, `${where.nm} NM ${where.dir} van Schiphol`, `sinds ${zulu(e.since)}`].filter(Boolean).join(' · '))),
      h('button', { class: 'em-btn', title: 'Toon het toestel op de Vluchtradar', onclick: () => showOnRadar(hex) }, icon('target'), 'Toon op radar'),
      h('button', { class: 'em-btn ghost', title: 'Melding bevestigen; komt terug als de code verandert', onclick: () => { emergency.ack.set(hex, e.code); plog('info', `noodsquawkmelding weggeklikt: ${name}`); paintEmergency(); } }, icon('check'), 'Bevestigen'));
  }));
}

// To the first page with a Vluchtradar, centred on the aircraft and selected.
function showOnRadar(hex) {
  const e = emergency.watch.active().find((x) => x.hex === hex);
  if (!e) return;
  const i = state.pages.findIndex((p) => p.widgets.some((w) => w.type === 'radar'));
  if (i < 0) return toast('Er staat geen Vluchtradar op het dashboard.', true);
  setPage(i);
  const w = state.pages[i].widgets.find((x) => x.type === 'radar');
  const inst = instances.get(w.id);
  if (inst && inst.focus) setTimeout(() => inst.focus(hex, e.a), 150);
}

function startEmergencyWatch() {
  if (emergency.unwatch) return;
  emergency.unwatch = watchTraffic(checkEmergencies, () => (state.settings.emergencyAlert ? NL_WATCH : null));
}
