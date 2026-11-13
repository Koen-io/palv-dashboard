'use strict';

/* ============================================================
   COA Planner: de wind boven een schip voor vier Courses of Approach, snel en gedeeld
   Invoer links (groot en met de vinger te bedienen), het bord in het midden (coa-board.js), rechts de
   zee en het weer op de positie van het schip, zon en maan, en de hoogte-deconflictie. Een plan staat
   op alle schermen; erop tekenen kan met de schuif Tekenen; afdrukken en delen altijd op A5 staand.
   ============================================================ */
// A plan is one item (OPS kind 'coa', list 'plans'); every drawing on it is an item of its own in
// 'marks' ({ plan, type, ... } in board units), so two screens can draw on one plan at once; what is drawn
// on the large ship of Teken Schip goes in 'shipmarks' the same way (1.49).
// Directions are stored true (°T); the plan's `ref` only says how they are shown and typed.
const COA_SEPS = [200, 300, 500, 1000];

function coaCfg(w) {
  const c = w.cfg;
  for (const [k, v] of Object.entries({ planId: null, draw: false, tool: 'pen', color: '#ff4b55', width: 5, fill: false, fontSize: 30, iconSize: 90, iconId: 'aw139', night: false, toolTab: 'draw' })) if (c[k] === undefined) c[k] = v;
  return c;
}
const coaPlans = () => OPS.list('coa', 'plans').sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
const coaBaseRow = () => ({ cs: '', type: '', alt: '', role: '' });
function coaNewPlan(name) {
  const id = OPS.uid();
  const b = activeBase();
  const now = Date.now();
  OPS.put('coa', 'plans', id, {
    name, createdAt: now, by: OPS.screen.name, missionId: null, ref: 'T', up: 'at',
    at: 0, brc: null, bs: 10, wd: 0, ws: 10, gust: null,
    hhour: Math.ceil(now / 300000) * 300000,
    lat: null, lon: null, posAt: null, posLabel: '', mmsi: null, dr: false,
    windSrc: { kind: 'manual' }, heights: [coaBaseRow(), coaBaseRow(), coaBaseRow()], sep: 500,
    baseLat: b.lat, baseLon: b.lon,
  });
  return id;
}

// Everything the board and the panels show, worked out from a plan. `offMin` is the time slider.
function coaModel(p, offMin = 0) {
  const C = COA_CALC;
  const base = activeBase();
  const pos = C.positionAt(p);
  const lat = pos ? pos.lat : base.lat, lon = pos ? pos.lon : base.lon;
  const at = C.norm(+p.at || 0), wd = C.norm(+p.wd || 0), ws = Math.max(0, +p.ws || 0);
  const gust = p.gust != null && +p.gust > ws ? +p.gust : null;
  const tAstro = (p.hhour || Date.now()) + offMin * 60000;
  let decl = 0;
  try { decl = PlanWmm.declination(lat, lon, 0, new Date(p.hhour || Date.now())); } catch { decl = 0; }
  const ref = p.ref === 'M' ? 'M' : 'T';
  const disp = (t) => (t == null ? null : ref === 'M' ? C.toMag(t, decl) : C.norm(t));
  const sea = p._sea && p._sea.model ? p._sea.model : null;
  const coas = C.coas(at, p.brc == null ? null : C.norm(+p.brc)).map((c) => C.coaPicture(c, { at, bs: +p.bs || 0, wd, ws, gust, waveDir: sea && sea.dir != null ? sea.dir : null }));
  const sun = ASTRO.sunPosition(tAstro, lat, lon), moon = ASTRO.moon(tAstro, lat, lon), light = ASTRO.light(tAstro, lat, lon);
  const dark = sun.alt < -6;
  const glareSun = sun.alt > -1 ? C.glare(sun.az, sun.alt, at) : null;
  const glareMoon = dark && moon.alt > -1 ? C.glare(moon.az, moon.alt, at, { maxAlt: 35 }) : null;
  let shadow = C.shadow(sun.az, sun.alt);
  if (!shadow && dark && moon.fraction > 0.35) { const m = C.shadow(moon.az, moon.alt); if (m) shadow = { ...m, moon: true }; }
  const brc = p.brc == null ? null : coas.find((c) => c.brc) || null;
  return {
    p, base, pos, lat, lon, at, wd, ws, gust, decl, ref, refText: ref, up: p.up === 'n' ? 0 : at,
    fmt: (t) => C.deg3(disp(t)), disp, coas, brc, sun, moon, light, phase: C.lightPhase(sun.alt), dark,
    glareSun: !!(glareSun && glareSun.on), glareMoon: !!(glareMoon && glareMoon.on), shadow, tAstro, offMin, sea,
    // What was drawn on the ship in Teken Schip: it goes along on the ship of all four COAs.
    shipMarks: p.id ? OPS.list('coa', 'shipmarks').filter((m) => m.plan === p.id).sort((a, b) => (a.z || 0) - (b.z || 0) || a.updatedAt - b.updatedAt) : [],
  };
}

function coaCreate(body, w) {
  const cfg = coaCfg(w);
  const C = COA_CALC;
  const root = h('div', { class: 'coa' });
  const bar = h('div', { class: 'zp-bar coa-bar' });
  const tools = h('aside', { class: 'coa-tools' });
  const input = h('aside', { class: 'coa-in' });
  const boardEl = h('div', { class: 'coa-board' });
  const drawEl = h('div', { class: 'coa-draw' });
  const stage = h('div', { class: 'coa-stage' }, boardEl, drawEl);
  const info = h('aside', { class: 'coa-info' });
  root.append(bar, h('div', { class: 'coa-body' }, tools, input, stage, info));
  body.append(root);
  const timers = [], cleanups = [];
  let P = null;                 // working copy of the open plan
  let lastEdit = 0, saveTimer = null, offMin = 0, vm = null;
  const plan = () => (cfg.planId ? OPS.get('coa', 'plans', cfg.planId) : null);

  /* ---------- the plan: open, edit, save ---------- */
  function ensurePlan() {
    if (cfg.planId && plan()) return true;
    if (!OPS.loaded) return false;
    const list = coaPlans();
    cfg.planId = list.length ? list[0].id : coaNewPlan('COA-planning 1');
    save();
    return true;
  }
  function load() {
    const it = plan();
    const keep = P && P._sea !== undefined && P.id === (it && it.id) ? { _sea: P._sea, _wind: P._wind } : {};
    P = it ? { ...it, ...keep } : null;
    if (P && !Array.isArray(P.heights)) P.heights = [coaBaseRow(), coaBaseRow(), coaBaseRow()];
  }
  // A change: shown at once, saved shortly after (one write for a run of taps on a stepper).
  function set(patch, { repaintInputs = true, info: withInfo = true } = {}) {
    if (!P) return;
    Object.assign(P, patch);
    lastEdit = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 350);
    paint({ inputs: repaintInputs, info: withInfo });
    if ('lat' in patch || 'lon' in patch || 'hhour' in patch || 'dr' in patch || 'brc' in patch || 'bs' in patch) fetchSoon();
  }
  // Writes the working copy, but only when this screen changed something since the last write: a copy that
  // is merely open must never overwrite what another screen saved in the meantime.
  function flush() {
    if (!saveTimer) return;
    clearTimeout(saveTimer); saveTimer = null;
    if (!P || !P.id) return;
    const out = { ...P }; delete out.id; delete out.updatedAt; delete out._sea; delete out._wind;
    OPS.put('coa', 'plans', P.id, out);
  }
  const unsub = OPS.on('coa', (what) => {
    if (what && what.local) return;
    if (!ensurePlan()) return;
    // Someone else changed the plan: take it over, unless this screen is in the middle of an edit.
    if (Date.now() - lastEdit > 1500 || !P || P.id !== cfg.planId) { load(); paint({ inputs: true }); }
    else paintBar();
    paintMarks();
  });
  cleanups.push(unsub);

  /* ---------- toolbar ---------- */
  const sel = h('select', { class: 'input zp-sel coa-sel', title: 'Plan kiezen', onchange: () => { flush(); cfg.planId = sel.value || null; save(); layer.clearSel(); load(); paint({ inputs: true }); fetchSoon(true); } });
  const refSeg = segmented([{ value: 'T', label: '°T', title: 'Ware graden (true)' }, { value: 'M', label: '°M', title: 'Magnetische graden: met de variatie op de positie (WMM2025)' }], 'T', (v) => set({ ref: v }));
  const upSeg = segmented([{ value: 'at', label: 'AT boven', title: 'De Assault Track wijst omhoog: de heli komt van onderen' }, { value: 'n', label: 'N boven', title: 'Noord boven' }], 'at', (v) => set({ up: v }));
  const nightBtn = h('button', { class: 'btn zp-btn', title: 'Nachtstand: gedimd en rood, voor de cockpit en onder NVG', onclick: () => { cfg.night = !cfg.night; save(); root.classList.toggle('night', cfg.night); nightBtn.classList.toggle('on', cfg.night); } }, icon('moon'), 'Nacht');
  const drawSw = switchTool('Tekenen', 'Tekenen op de COA-planning aan of uit: de tekengereedschappen staan dan links', () => cfg.draw, () => { cfg.draw = !cfg.draw; save(); paintMode(); });
  const newBtn = h('button', { class: 'btn zp-btn primary', title: 'Een nieuw plan', onclick: () => {
    const n = coaPlans().length + 1;
    pageNameDialog('Nieuw COA-plan', `COA-planning ${n}`, (name) => { flush(); cfg.planId = coaNewPlan(name); save(); load(); paint({ inputs: true }); });
  } }, icon('plus'), 'Nieuw');
  const renBtn = h('button', { class: 'btn zp-btn', title: 'Naam wijzigen', onclick: () => { if (P) pageNameDialog('Plan hernoemen', P.name, (n) => set({ name: n })); } }, icon('edit'));
  const delBtn = h('button', { class: 'btn zp-btn danger', title: 'Plan verwijderen (ook op de andere schermen)', onclick: () => {
    if (!P) return;
    confirmDialog('Plan verwijderen', `"${P.name}" met alle tekeningen verwijderen, ook op de andere schermen?`, 'Verwijderen', () => {
      const id = P.id;
      OPS.putMany('coa', [{ list: 'plans', id, item: null }, ...['marks', 'shipmarks'].flatMap((l) => OPS.list('coa', l).filter((m) => m.plan === id).map((m) => ({ list: l, id: m.id, item: null })))]);
      cfg.planId = null; save(); P = null; ensurePlan(); load(); paint({ inputs: true });
    });
  } }, icon('trash'));
  const shipBtn = h('button', { class: 'btn zp-btn coa-shipbtn', title: 'Teken Schip: teken het schip één keer groot (opbouw, dek …); het gaat als miniatuur mee in alle vier de COA’s', onclick: () => shipDialog() }, icon('edit'), 'Teken Schip', h('span', { class: 'coa-shipn', hidden: true }));
  const missionBtn = h('button', { class: 'btn zp-btn', title: 'W/V, zon en maan en de ingress naar een missie in Mission Planning', onclick: () => missionDialog() }, icon('shield'), 'Naar missie');
  const pdfBtn = h('button', { class: 'btn zp-btn', title: 'De kniebordkaart als PDF (A5 staand)', onclick: () => exportA5('pdf') }, icon('download'), 'PDF A5');
  const printBtn = h('button', { class: 'btn zp-btn primary', title: 'Afdrukken op A5 staand, voor het kniebord', onclick: () => exportA5('print') }, icon('note'), 'Afdrukken A5');
  bar.append(h('span', { class: 'mp-title coa-title' }, icon('target'), 'COA PLANNER'), sel, newBtn, renBtn, delBtn,
    h('span', { class: 'coa-barsep' }), refSeg, upSeg, nightBtn, drawSw, shipBtn, h('span', { class: 'zp-spacer' }), missionBtn, pdfBtn, printBtn);
  function paintBar() {
    const list = coaPlans();
    sel.replaceChildren(...list.map((p) => h('option', { value: p.id, selected: p.id === cfg.planId || null }, p.name)));
    sel.value = cfg.planId || '';
    if (P) { refSeg.setValue(P.ref === 'M' ? 'M' : 'T'); upSeg.setValue(P.up === 'n' ? 'n' : 'at'); }
    nightBtn.classList.toggle('on', !!cfg.night);
    drawSw.paint();
    // How many drawings the ship of this plan has.
    const n = P ? OPS.list('coa', 'shipmarks').filter((m) => m.plan === P.id).length : 0;
    const badge = shipBtn.querySelector('.coa-shipn');
    badge.hidden = !n; badge.textContent = String(n);
  }
  root.classList.toggle('night', !!cfg.night);

  /* ---------- inputs ---------- */
  // A stepper: − value +, large enough for a finger; holding a button repeats, the value can be typed.
  function stepper({ label, unit, get, put, step = 1, wrap = false, min = 0, max = 999, optional = false, title }) {
    const inp = h('input', { class: 'input coa-num', type: 'text', inputmode: 'numeric', title: title || label });
    const show = () => { const v = get(); inp.value = v == null ? '' : wrap ? C.deg3(v) : String(Math.round(v)); inp.placeholder = optional ? '—' : ''; };
    const commit = (v) => { if (v == null) { if (optional) put(null); show(); return; } if (wrap) v = C.norm(Math.round(v)); else v = clamp(Math.round(v), min, max); put(v); show(); };
    const bump = (d) => { const v = get(); commit(v == null ? (wrap ? 0 : min) : wrap ? Math.round(v / step) * step + d : v + d); };
    let rep = null;
    const hold = (d) => (ev) => {
      ev.preventDefault();
      bump(d);
      let n = 0;
      const tick = () => { n += 1; bump(d * (n > 14 ? 2 : 1)); rep = setTimeout(tick, n > 6 ? 70 : 140); };
      rep = setTimeout(tick, 420);
    };
    const stop = () => { clearTimeout(rep); rep = null; };
    const btn = (d, txt) => h('button', { class: 'coa-stepbtn', tabindex: '-1', onpointerdown: hold(d), onpointerup: stop, onpointerleave: stop, onpointercancel: stop, oncontextmenu: (e) => e.preventDefault() }, txt);
    inp.addEventListener('change', () => { const s = inp.value.trim().replace(',', '.'); commit(s === '' ? null : Number.isFinite(+s) ? +s : get()); });
    inp.addEventListener('focus', () => inp.select());
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); else if (e.key === 'ArrowUp') { e.preventDefault(); bump(step); } else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-step); } e.stopPropagation(); });
    const el = h('div', { class: 'coa-step' + (optional ? ' optional' : '') }, h('label', {}, label), btn(-step, '−'), h('span', { class: 'coa-numbox' }, inp, h('small', {}, unit)), btn(step, '+'),
      optional ? h('button', { class: 'coa-clear', title: `${label} wissen`, onclick: () => { put(null); show(); } }, icon('close')) : null);
    el.show = show;
    show();
    return el;
  }
  const dispOf = (t) => (vm ? vm.disp(t) : t);
  const trueOf = (v) => (v == null ? null : P && P.ref === 'M' ? C.toTrue(v, vm ? vm.decl : 0) : C.norm(v));
  const refU = () => `°${P && P.ref === 'M' ? 'M' : 'T'}`;
  const steppers = [];
  const S = (o) => { const s = stepper(o); steppers.push(s); return s; };
  const atIn = S({ label: 'Assault Track', unit: '°', wrap: true, step: 5, get: () => (P ? dispOf(P.at) : null), put: (v) => set({ at: trueOf(v) }, { repaintInputs: false }), title: 'De koers die de heli naar het schip vliegt' });
  const brcIn = S({ label: 'Boat Ref Course', unit: '°', wrap: true, step: 5, optional: true, get: () => (P && P.brc != null ? dispOf(P.brc) : null), put: (v) => set({ brc: v == null ? null : trueOf(v) }, { repaintInputs: false }), title: 'De koers die het schip werkelijk vaart (optioneel)' });
  const bsIn = S({ label: 'Boat Speed', unit: 'kt', step: 1, max: 60, get: () => (P ? +P.bs : null), put: (v) => set({ bs: v }, { repaintInputs: false }) });
  const manual = { kind: 'manual' };
  const wdIn = S({ label: 'Windrichting', unit: '°', wrap: true, step: 10, get: () => (P ? dispOf(P.wd) : null), put: (v) => set({ wd: trueOf(v), windSrc: manual }, { repaintInputs: false }) });
  const wsIn = S({ label: 'Windsnelheid', unit: 'kt', step: 1, max: 150, get: () => (P ? +P.ws : null), put: (v) => set({ ws: v, windSrc: manual }, { repaintInputs: false }) });
  const gustIn = S({ label: 'Windstoten', unit: 'kt', step: 1, max: 150, optional: true, get: () => (P && P.gust != null ? +P.gust : null), put: (v) => set({ gust: v, windSrc: manual }, { repaintInputs: false }) });
  const windSrcEl = h('div', { class: 'coa-src' });
  // The two steps before anything is typed: 1. the ship (position, and from AIS its course and speed),
  // 2. the weather at that position on the H-hour.
  const stepBtn = (n, title, sub, onclick) => {
    const el = h('button', { class: 'coa-stepcta', onclick }, h('span', { class: 'coa-stepn' }, String(n)), h('span', { class: 'coa-steptxt' }, h('b', {}, `${n}. ${title}`), h('small', {}, sub)), icon('right'));
    el.setNum = (done) => { el.classList.toggle('done', done); el.querySelector('.coa-stepn').replaceChildren(done ? icon('check') : String(n)); };
    return el;
  };
  const posBtn = stepBtn(1, 'Kies schip', 'Positie, koers en vaart (AIS)', () => pickPosition());
  const wxBtn = stepBtn(2, 'Weer overnemen', 'Wind op de positie op het H-uur', () => windFromModel(true));
  const wxEl = h('div', { class: 'coa-pos coa-wxstate' });
  const posEl = h('div', { class: 'coa-pos' });
  const drChk = h('input', { type: 'checkbox', onchange: (e) => set({ dr: e.target.checked }) });
  const dateIn = h('input', { class: 'input coa-date', type: 'date', title: 'Datum H-uur (UTC)' });
  const timeIn = h('input', { class: 'input coa-time', type: 'time', title: 'Tijd H-uur (UTC)' });
  const setH = () => { const d = dateIn.value, t = timeIn.value; if (!d || !t) return; const ms = Date.parse(`${d}T${t}:00Z`); if (Number.isFinite(ms)) set({ hhour: ms }); };
  dateIn.addEventListener('change', setH); timeIn.addEventListener('change', setH);
  const nowBtn = h('button', { class: 'btn zp-btn coa-now', title: 'H-uur op nu', onclick: () => set({ hhour: Math.round(Date.now() / 60000) * 60000 }) }, 'Nu');
  const slider = h('input', { class: 'coa-slider', type: 'range', min: '-720', max: '720', step: '10', value: '0', title: 'Tijdschuif: zon en maan rond het H-uur' });
  const sliderLbl = h('span', { class: 'coa-sliderlbl' });
  slider.addEventListener('input', () => { offMin = +slider.value; paint({ inputs: false }); });
  const sliderReset = h('button', { class: 'coa-clear', title: 'Terug naar het H-uur', onclick: () => { offMin = 0; slider.value = '0'; paint({ inputs: false }); } }, icon('refresh'));
  const metarBtn = h('button', { class: 'btn zp-btn', title: 'De wind uit de laatste METAR van de basis', onclick: () => windFromMetar() }, icon('cloud'), 'METAR');
  const sec = (title, ...kids) => h('section', { class: 'coa-sec' }, h('h3', {}, title), ...kids);
  input.append(
    h('section', { class: 'coa-sec coa-steps' }, h('h3', {}, 'In twee stappen'),
      posBtn, posEl, h('label', { class: 'check coa-dr' }, drChk, 'Gegist bestek naar het H-uur'),
      wxBtn, wxEl),
    sec('Koers en vaart', atIn, brcIn, bsIn),
    sec('Wind', wdIn, wsIn, gustIn, h('div', { class: 'coa-srcrow' }, windSrcEl, metarBtn)),
    sec('H-uur (UTC)', h('div', { class: 'coa-hrow' }, dateIn, timeIn, nowBtn), h('div', { class: 'coa-srow' }, icon('sun'), slider, sliderReset), sliderLbl),
  );
  function paintInputs() {
    if (!P) return;
    for (const s of steppers) s.show();
    for (const s of [atIn, brcIn, wdIn]) s.querySelector('small').textContent = refU();
    const d = new Date(P.hhour || Date.now());
    dateIn.value = d.toISOString().slice(0, 10);
    timeIn.value = d.toISOString().slice(11, 16);
    drChk.checked = !!P.dr;
  }
  function paintSide() {
    if (!P || !vm) return;
    const src = P.windSrc || manual;
    const age = wxAge();
    const old = age && age.old ? ` · ${ageText(age.ms)} oud` : '';
    windSrcEl.textContent = src.kind === 'model' ? `Open-Meteo op positie${src.at ? ' · ' + zulu(src.at) : ''}${old}` : src.kind === 'metar' ? `METAR ${src.label || ''}${src.at ? ' · ' + zulu(src.at) : ''}${old}` : 'Handmatig ingevuld';
    windSrcEl.className = 'coa-src ' + src.kind + (old ? ' old' : '');
    const has = P.lat != null;
    posBtn.setNum(has);
    wxBtn.setNum(has && src.kind === 'model');
    wxBtn.disabled = !has;
    wxEl.replaceChildren(!has ? h('small', {}, 'Eerst stap 1: het schip.')
      : src.kind === 'model' ? h('small', { class: old ? 'coa-old' : '' }, `Overgenomen: ${vm.fmt(P.wd)}°${vm.refText} / ${Math.round(+P.ws)}${P.gust ? 'G' + Math.round(+P.gust) : ''} kt${src.at ? ' · verwachting ' + zulu(src.at) : ''}${old}`)
        : h('small', {}, src.kind === 'metar' ? `Nu: wind uit de METAR van ${src.label || 'de basis'}` : 'Nu: wind met de hand ingevuld'));
    posEl.replaceChildren(
      has ? h('b', {}, PlanCoords.fmt(P.lat, P.lon, 'ddm')) : h('b', { class: 'muted' }, 'Nog geen positie gekozen'),
      h('small', {}, has ? `${P.posLabel || 'Gekozen punt'}${P.posAt ? ' · fix ' + zulu(P.posAt) : ''}` : `Zon en maan voor ${vm.base.name}`),
      vm.pos && vm.pos.dr ? h('small', { class: 'coa-drinfo' }, `Op H: ${PlanCoords.fmt(vm.pos.lat, vm.pos.lon, 'ddm')} (${vm.pos.nm.toFixed(1).replace('.', ',')} NM ${vm.pos.hours >= 0 ? 'vooruit' : 'terug'} gegist)`) : null);
    drChk.disabled = !has;
    const t = vm.tAstro;
    sliderLbl.textContent = offMin ? `Zon/maan op H${offMin > 0 ? '+' : '−'}${pad2(Math.floor(Math.abs(offMin) / 60))}:${pad2(Math.abs(offMin) % 60)} · ${zulu(t)}` : `Zon/maan op het H-uur · ${zulu(t)}`;
    sliderReset.hidden = !offMin;
  }

  /* ---------- the board ---------- */
  const pal = () => COA_PAL[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'];
  function paintBoard() {
    if (!vm) { boardEl.replaceChildren(h('div', { class: 'w-state' }, h('div', {}, h('strong', {}, 'Laden…')))); return; }
    boardEl.innerHTML = coaBoardSvg(vm, pal(), { id: 'coa-' + w.id, cls: 'coa-svg' });
  }
  // Setting the wind with a finger in the compass (not while drawing): the angle from the centre.
  boardEl.addEventListener('pointerdown', (ev) => {
    if (cfg.draw || !vm) return;
    const svg = boardEl.querySelector('svg');
    const pt = svgPoint(svg, ev);
    if (!pt || Math.hypot(pt.x - COA_W / 2, pt.y - COA_H / 2) > 128) return;
    ev.preventDefault();
    boardEl.setPointerCapture(ev.pointerId);
    const apply = (e) => {
      const q = svgPoint(svg, e);
      if (!q || Math.hypot(q.x - COA_W / 2, q.y - COA_H / 2) < 12) return;
      const a = (Math.atan2(q.x - COA_W / 2, -(q.y - COA_H / 2)) * 180) / Math.PI;
      let t = C.norm(a + vm.up);
      // Snap to 5 degrees in the chosen reference.
      const d = Math.round(dispOf(t) / 5) * 5;
      t = trueOf(d);
      if (Math.round(t) !== Math.round(P.wd)) set({ wd: t, windSrc: manual });
    };
    apply(ev);
    const move = (e) => apply(e);
    const up = () => { boardEl.removeEventListener('pointermove', move); boardEl.removeEventListener('pointerup', up); boardEl.removeEventListener('pointercancel', up); };
    boardEl.addEventListener('pointermove', move); boardEl.addEventListener('pointerup', up); boardEl.addEventListener('pointercancel', up);
  });
  function svgPoint(svg, ev) {
    if (!svg) return null;
    const m = svg.getScreenCTM();
    if (!m) return null;
    const pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    return pt.matrixTransform(m.inverse());
  }

  /* ---------- the right column ---------- */
  const seps = (rows) => rows.filter(Boolean);
  function card(cls, title, badge, ...kids) { return h('section', { class: 'coa-card ' + cls }, h('header', {}, h('h3', {}, title), badge || null), ...seps(kids)); }
  const kv = (k, v, cls) => h('div', { class: 'coa-kv' + (cls ? ' ' + cls : '') }, h('span', {}, k), h('b', {}, v));
  function brcCard() {
    if (!vm.brc) return card('coa-brc muted', 'Boat Reference Course', null, h('p', { class: 'coa-hint' }, 'Vul de werkelijke koers van het schip in (of kies het schip op de kaart): de COA die daarbij hoort rekent dan met die exacte koers en is oranje omrand.'));
    const c = vm.brc;
    const rc = c.rel ? (c.rel.side === 'G' ? 'g' : c.rel.side === 'R' ? 'r' : '') : '';
    return card('coa-brc', `Op BRC · COA ${c.n}`, h('span', { class: 'coa-badge' }, `${vm.fmt(c.heading)}°${vm.refText} · ${Math.round(+P.bs)} kt`),
      h('div', { class: 'coa-big' }, h('span', { class: 'coa-wind' }, `${c.app.dir == null ? '---' : vm.fmt(c.app.dir)}°${vm.refText} / ${Math.round(c.app.spd)} kt`), h('span', { class: 'coa-rel ' + rc + (c.rel ? '' : ' calm') }, coaRelText(c))),
      h('div', { class: 'coa-line' }, `Helo on AT: ${coaHeloText(c.helo)}${c.gust ? ` · gust ${Math.round(c.gust.spd)} kt` : ''} · approach from ${c.approach.text}`));
  }
  function seaCard() {
    const sea = P._sea, wind = P._wind;
    const where = vm.pos ? (vm.pos.dr ? 'op de gegiste positie' : 'op de positie') : null;
    if (!vm.pos) return card('coa-seacard', 'Zee en weer', null, h('p', { class: 'coa-hint' }, 'Kies de positie van het schip: dan staan hier de sea state, de golven ten opzichte van het schip, de zeewatertemperatuur en de verwachte wind met windstoten op het H-uur.'));
    if (!sea && !wind) return card('coa-seacard', 'Zee en weer', h('span', { class: 'coa-badge muted' }, 'laden…'), h('p', { class: 'coa-hint' }, `Gegevens ${where} worden opgehaald…`));
    const m = sea && sea.model;
    const ds = m && m.hs != null ? C.douglas(m.hs) : null;
    const rel = m && m.dir != null ? C.seaRelative(m.dir, vm.brc ? vm.brc.heading : vm.at) : null;
    const tile = h('div', { class: 'coa-ss' + (ds ? ' ss' + Math.min(9, ds.code) : '') }, h('small', {}, 'SEA STATE'), h('b', {}, ds ? String(ds.code) : '–'), h('span', {}, ds ? ds.name : 'unknown'));
    const rows = h('div', { class: 'coa-kvs' },
      m ? kv('Sig. wave height (Hs)', m.hs != null ? `${m.hs.toFixed(1)} m` : '–') : null,
      m ? kv('Mean wave period (Tm)', m.period != null ? `${m.period.toFixed(1)} s` : '–') : null,
      m && m.dir != null ? kv('Waves from', `${vm.fmt(m.dir)}°${vm.refText}`) : null,
      rel ? kv(vm.brc ? `Ship on BRC` : 'Ship on COA 1', `${rel.name}`, 'em') : null,
      rel ? kv('Ship motion', rel.motion.replace(/^./, (x) => x.toUpperCase()), 'em') : null,
      m && m.swell != null ? kv('Swell', `${m.swell.toFixed(1)} m${m.swellPeriod ? ` · ${Math.round(m.swellPeriod)} s` : ''}`) : null,
      m && m.sst != null ? kv('Sea temp (SST)', `${m.sst.toFixed(1)} °C`) : null);
    const wrow = wind && wind.ok ? h('div', { class: 'coa-wx' }, icon('wind'), h('div', {},
      h('b', {}, `${vm.fmt(wind.dirDeg)}°${vm.refText} / ${Math.round(wind.speedKt)}${wind.gustKt != null ? 'G' + Math.round(wind.gustKt) : ''} kt`),
      h('small', {}, `Forecast for H (${zulu(wind.validTime)}), Open-Meteo`)),
      h('button', { class: 'btn zp-btn', title: 'Deze wind in de COA Planner zetten (stap 2)', onclick: () => windFromModel(true) }, 'Overnemen'))
      : wind && !wind.ok ? h('p', { class: 'coa-hint' }, `Wind: ${wind.error || 'niet beschikbaar'}`) : null;
    const near = sea && Array.isArray(sea.nearest) && sea.nearest.length ? h('p', { class: 'coa-hint' }, 'Dichtstbij gemeten: ' + sea.nearest.slice(0, 2).map((o) => `${o.name} ${o.hs != null ? o.hs.toFixed(1).replace('.', ',') + ' m' : ''} (${Math.round(o.km)} km)`).join(' · ')) : null;
    return card('coa-seacard', 'Zee en weer', h('span', { class: 'coa-badge' }, where), h('div', { class: 'coa-searow' }, tile, rows), wrow, near,
      sea && sea.modelError ? h('p', { class: 'coa-hint' }, `Golfmodel: ${sea.modelError}`) : null);
  }
  function astroCard() {
    const s = vm.sun, m = vm.moon, lx = ASTRO.formatLux(vm.light.lux);
    const warn = [];
    if (vm.glareSun) warn.push(h('div', { class: 'coa-warn' }, icon('alert'), h('span', {}, h('b', {}, 'Approach into sun'), ` · elevation ${Math.round(s.alt)}°, ${Math.round(Math.abs(C.signed(s.az - vm.at)))}° off the AT`)));
    if (vm.glareMoon) warn.push(h('div', { class: 'coa-warn' }, icon('alert'), h('span', {}, h('b', {}, 'Approach into moon (NVG)'), ` · elevation ${Math.round(m.alt)}°, ${Math.round(m.fraction * 100)}% illuminated, ${Math.round(Math.abs(C.signed(m.az - vm.at)))}° off the AT`)));
    return card('coa-astro', 'Zon en maan', h('span', { class: 'coa-badge' + (vm.dark ? ' night' : '') }, vm.phase ? vm.phase.name : ''),
      h('div', { class: 'coa-bodies' },
        h('div', { class: 'coa-body2 coa-b-sun' + (s.alt < 0 ? ' coa-down' : '') }, h('i'), h('div', {}, h('small', {}, 'SUN'), h('b', {}, `${vm.fmt(s.az)}°${vm.refText}`), h('span', {}, `elev ${Math.round(s.alt)}°`))),
        h('div', { class: 'coa-body2 coa-b-moon' + (m.alt < 0 ? ' coa-down' : '') }, h('i', { style: `--f:${m.fraction.toFixed(2)}` }), h('div', {}, h('small', {}, 'MOON'), h('b', {}, `${vm.fmt(m.az)}°${vm.refText}`), h('span', {}, `elev ${Math.round(m.alt)}° · ${Math.round(m.fraction * 100)}%`))),
        h('div', { class: 'coa-body2 coa-b-lux' }, h('i'), h('div', {}, h('small', {}, 'LIGHT'), h('b', {}, `${lx.value} ${lx.unit}`), h('span', {}, m.phaseName)))),
      ...warn,
      vm.shadow ? h('p', { class: 'coa-hint' }, `Schaduw ${vm.shadow.moon ? 'van de maan ' : ''}valt naar ${vm.fmt(vm.shadow.dir)}°${vm.refText}, ${vm.shadow.len < 1 ? 'kort' : vm.shadow.len < 2.5 ? 'middellang' : 'lang'} (getekend naast elk schip).`) : null,
      h('p', { class: 'coa-hint' }, `${offMin ? 'Tijdschuif ' : ''}${zulu(vm.tAstro)} · ${vm.ref === 'M' ? `variatie ${Math.abs(vm.decl).toFixed(1).replace('.', ',')}°${vm.decl >= 0 ? 'E' : 'W'} · ` : ''}${vm.pos ? 'op de positie van het schip' : 'voor ' + vm.base.name}`));
  }
  // The heights card. Typing in it never repaints the whole column (the focus would be lost); a change
  // repaints only what depends on it: the red rows, the cross-section and the conflicts.
  function heightsCard() {
    const sep = () => +P.sep || 500;
    const put = (i, k, v) => {
      const list = P.heights.map((r) => ({ ...r }));
      if (!list[i]) return;
      list[i][k] = v;
      set({ heights: list }, { repaintInputs: false, info: false });
      live();
    };
    const trs = P.heights.map((r, i) => h('tr', {},
      ...['cs', 'type', 'alt', 'role'].map((k) => h('td', {}, h('input', { class: 'input', value: r[k] || '', inputmode: k === 'alt' ? 'numeric' : null, placeholder: { cs: 'LION01', type: 'AW139', alt: '1500', role: 'sniper' }[k],
        title: k === 'alt' ? 'Hoogte in ft (bv. 1500, 1.500 of FL045)' : null, onchange: (e) => put(i, k, e.target.value.trim()), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } }))),
      h('td', {}, h('button', { class: 'w-tool', title: 'Rij verwijderen', onclick: () => set({ heights: P.heights.filter((_, j) => j !== i) }) }, icon('close')))));
    const tbl = h('table', { class: 'coa-ht' }, h('thead', {}, h('tr', {}, h('th', {}, 'Callsign'), h('th', {}, 'Type'), h('th', {}, 'Alt ft'), h('th', {}, 'Task'), h('th'))), h('tbody', {}, trs));
    const xs = h('div', { class: 'coa-xsec' });
    const confEl = h('div', { class: 'coa-conf' });
    function live() {
      const rows = P.heights, conf = C.heightConflicts(rows, sep());
      const bad = new Set(conf.flatMap((c) => [c.a.i, c.b.i]));
      trs.forEach((tr, i) => tr.classList.toggle('bad', bad.has(i)));
      const n = rows.filter((r) => C.parseFt(r.alt) != null).length;
      xs.innerHTML = n ? coaHeightSvg(rows, sep(), bad, COA_PAL[document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'], { w: Math.max(240, Math.round(info.clientWidth - 34)), h: 168 }) : '';
      xs.hidden = !n;
      confEl.replaceChildren(...(conf.length ? conf.slice(0, 4).map((c) => h('div', { class: 'coa-warn' }, icon('alert'), h('span', {}, h('b', {}, `${c.a.name} ↔ ${c.b.name}`), ` · ${c.diff} ft verschil (minder dan ${sep()} ft)`)))
        : n >= 2 ? [h('div', { class: 'coa-ok' }, icon('check'), h('span', {}, `Gedeconflicteerd: alle ${n} minstens ${sep()} ft uit elkaar`))]
          : [h('p', { class: 'coa-hint' }, 'Vul bij twee of meer toestellen een hoogte in (ft, of FL): de doorsnede en de deconflictie verschijnen hier meteen.')]));
    }
    live();
    return card('coa-heights', 'Hoogtes · deconflictie', h('span', { class: 'coa-seps' }, 'min.', zpSelect(COA_SEPS.map((v) => ({ value: v, label: `${v} ft` })), sep(), (v) => set({ sep: +v }))),
      tbl,
      h('div', { class: 'coa-btnrow' }, h('button', { class: 'btn zp-btn', onclick: () => set({ heights: [...P.heights, coaBaseRow()] }) }, icon('plus'), 'Rij')),
      xs, confEl);
  }
  function paintInfo() {
    if (!P || !vm) { info.replaceChildren(); return; }
    const sc = info.scrollTop;
    info.replaceChildren(brcCard(), seaCard(), astroCard(), heightsCard());
    info.scrollTop = sc;
  }

  /* ---------- wind and sea for the position ---------- */
  let fetchTimer = null, fetchKey = '';
  function fetchSoon(force) {
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(() => fetchData(force), force ? 50 : 900);
  }
  async function fetchData(force) {
    if (!P || P.lat == null) { checkWxAge(); return; }
    const pos = C.positionAt(P) || { lat: P.lat, lon: P.lon };
    const hour = Math.floor((P.hhour || Date.now()) / 3600000);
    // Rounded as the sources round it: a few hundred metres more never asks again.
    const key = `${P.id}|${pos.lat.toFixed(2)}|${pos.lon.toFixed(2)}|${hour}`;
    if (!force && key === fetchKey) return;
    fetchKey = key;
    const id = P.id;
    const [sea, wind] = await Promise.all([
      window.palv.data.seaAt(pos.lat, pos.lon).catch(() => null),
      window.palv.plan.windPoints([{ lat: pos.lat, lon: pos.lon, time: P.hhour || Date.now(), ftAmsl: 0 }]).then((r) => (r && Array.isArray(r.list) ? r.list[0] : null)).catch(() => null),
    ]);
    if (!P || P.id !== id) return;
    P._sea = sea; P._wind = wind;
    // A plan whose wind came from the model follows the model; a wind typed by hand stays.
    if (wind && wind.ok && P.windSrc && P.windSrc.kind === 'model') windFromModel(false);
    else paint({ inputs: false });
    checkWxAge();
  }
  function windFromModel(ask) {
    const wd = P && P._wind;
    if (!wd || !wd.ok) {
      if (ask) { if (P && P.lat == null) toast('Kies eerst de positie van het schip', true); else { toast('De wind op de positie wordt opgehaald…'); fetchSoon(true); P.windSrc = { kind: 'model' }; } }
      return;
    }
    set({ wd: C.norm(wd.dirDeg), ws: Math.round(wd.speedKt), gust: wd.gustKt != null && wd.gustKt > wd.speedKt + 2 ? Math.round(wd.gustKt) : null, windSrc: { kind: 'model', at: wd.validTime, fetched: wd.fetchedAt || Date.now() } });
    if (ask) toast(`Weer overgenomen: ${vm.fmt(P.wd)}°${vm.refText} / ${Math.round(+P.ws)}${P.gust ? 'G' + Math.round(+P.gust) : ''} kt op de positie`);
  }
  function windFromMetar() {
    const icao = activeBase().icao;
    const st = wxFeed.stations.find((s) => s.icao === icao);
    const wnd = st && st.metar && st.metar.wind;
    if (!wnd) return toast(`Geen METAR-wind van ${icao} beschikbaar`, true);
    if (wnd.dir === 'VRB') return toast(`${icao}: wind variabel (VRB ${wnd.spd} kt); vul de richting zelf in`, true);
    const k = wnd.unit === 'MPS' ? 1.943844 : 1;
    set({ wd: C.norm(+wnd.dir), ws: Math.round(wnd.spd * k), gust: wnd.gust ? Math.round(wnd.gust * k) : null, windSrc: { kind: 'metar', label: icao, at: st.obsTime || null } });
    checkWxAge();
  }
  // How old the weather in the plan is: a METAR by its observation time (old after an hour), a model wind
  // by when it was fetched (old after three hours; while online it is refreshed every time it is opened).
  const WX_OLD = { metar: 60 * 60000, model: 3 * 3600000 };
  function wxAge() {
    const src = P && P.windSrc;
    if (!src) return null;
    const t = src.kind === 'metar' ? src.at : src.kind === 'model' ? src.fetched : null;
    if (!t) return null;
    const ms = Date.now() - t;
    return { t, ms, old: ms > WX_OLD[src.kind], what: src.kind === 'metar' ? `de METAR van ${src.label || 'de basis'}` : 'de Open-Meteo-verwachting op de positie', kind: src.kind };
  }
  // Old weather gets a pop-up once per plan and per data time, and only while the tab is in view.
  const wxWarned = new Set();
  let wxPending = false;
  function checkWxAge() {
    const a = wxAge();
    if (!a || !a.old) { wxPending = false; return; }
    const key = `${P.id}|${a.kind}|${a.t}`;
    if (wxWarned.has(key)) return;
    if (!onScreen(body) || document.querySelector('.modal-backdrop')) { wxPending = true; return; }
    wxPending = false;
    wxWarned.add(key);
    const d = new Date(a.t);
    const when = `${zulu(a.t)}${new Date().toISOString().slice(0, 10) !== d.toISOString().slice(0, 10) ? ' op ' + d.toISOString().slice(0, 10).split('-').reverse().join('-') : ''}`;
    openModal({
      title: 'Weerdata is ouder', cls: 'coa-oldmodal',
      body: [
        h('div', { class: 'coa-warn coa-oldwarn' }, icon('alert'), h('span', {}, h('b', {}, `${ageText(a.ms)} oud`), ` · de wind in dit plan komt uit ${a.what} van ${when}.`)),
        h('p', { class: 'coa-hint' }, a.kind === 'metar' ? 'Een METAR is een waarneming op de basis, niet een verwachting op de positie van het schip. Neem bij voorkeur het weer op de positie over (stap 2), of controleer de wind voordat je de COA gebruikt.'
          : 'Nieuwe gegevens konden niet worden opgehaald (geen verbinding?). Controleer de wind voordat je de COA gebruikt, of probeer het opnieuw.'),
      ],
      actions: [{ label: 'Begrepen' }, { label: P.lat != null ? 'Weer opnieuw ophalen' : 'METAR opnieuw', primary: true, onClick: () => { if (P.lat != null) { P.windSrc = { kind: 'model' }; fetchSoon(true); toast('Het weer op de positie wordt opgehaald…'); } else windFromMetar(); } }],
    });
  }
  const unwatchWx = watchWx(() => {});
  cleanups.push(unwatchWx);

  /* ---------- choosing the ship's position on a map ---------- */
  function pickPosition() {
    if (!P) return;
    const mapEl = h('div', { class: 'coa-pickmap zp-map vr-map' });
    const card2 = h('div', { class: 'coa-pickcard' });
    const q = h('input', { class: 'zp-q', type: 'search', placeholder: 'Zoek een plaats, platform of coördinaat (bv. 52 18.8N 004 48.4E)…' });
    const res = h('div', { class: 'zp-results', hidden: true });
    const aisLbl = h('span', { class: 'coa-aislbl' });
    const fake = { cfg: { base: 'osm', raster: ['seamark'] } };
    let map = null, cv = null, base = null, ro = null, mo = null, aisTimer = null, seq = 0;
    const ships = new Map(); let rev = 0;
    let pick = P.lat != null ? { kind: 'point', lat: P.lat, lon: P.lon, label: P.posLabel || '' } : null;
    if (P.mmsi) pick = { kind: 'ship', mmsi: P.mmsi, lat: P.lat, lon: P.lon };
    const shipOf = (mmsi) => ships.get(mmsi);
    const now = () => Date.now();
    const where = (v) => (typeof osNow === 'function' ? osNow(v, now()) : v.lat == null ? null : [v.lat, v.lon]);
    function paintCard() {
      if (!pick) { card2.replaceChildren(h('p', { class: 'coa-hint' }, 'Tik op een schip (AIS) om zijn positie, koers en snelheid over te nemen, of tik op het water voor alleen een positie.')); return; }
      if (pick.kind === 'ship') {
        const v = shipOf(pick.mmsi);
        if (!v) { card2.replaceChildren(h('b', {}, `MMSI ${pick.mmsi}`), h('p', { class: 'coa-hint' }, 'Wachten op een AIS-bericht van dit schip…')); return; }
        const p = where(v) || [v.lat, v.lon];
        const age = v.posAt ? now() - v.posAt : null;
        card2.replaceChildren(
          h('div', { class: 'coa-pickhead' }, h('b', {}, osName(v)), h('small', {}, `${typeof osTypeText === 'function' ? osTypeText(v) : ''}${v.mmsi ? ' · MMSI ' + v.mmsi : ''}`)),
          h('div', { class: 'coa-kvs' },
            kv('Positie', PlanCoords.fmt(p[0], p[1], 'ddm')),
            kv('Koers (COG)', v.cog != null ? `${C.deg3(v.cog)}°T` : '–'),
            kv('Heading', v.hdg != null && v.hdg < 360 ? `${C.deg3(v.hdg)}°T` : '–'),
            kv('Snelheid (SOG)', v.sog != null ? `${v.sog.toFixed(1).replace('.', ',')} kt` : '–'),
            age != null ? kv('AIS-positie', `${ageText(age)} oud`) : null),
          h('p', { class: 'coa-hint' }, 'Overnemen zet de positie, de Boat Reference Course (COG) en de bootsnelheid (SOG) in het plan.'));
        return;
      }
      card2.replaceChildren(h('div', { class: 'coa-pickhead' }, h('b', {}, PlanCoords.fmt(pick.lat, pick.lon, 'ddm')), h('small', {}, pick.label || 'Gekozen punt')), h('p', { class: 'coa-hint' }, 'Overnemen zet alleen de positie; koers en snelheid blijven zoals ze zijn.'));
    }
    async function pollAis() {
      try {
        const r = await window.palv.ais.snap(rev);
        if (!r || !r.ok) { aisLbl.textContent = 'AIS niet beschikbaar'; return; }
        for (const v of r.vessels) ships.set(v.mmsi, v);
        for (const m of r.gone || []) ships.delete(m);
        rev = r.rev;
        aisLbl.textContent = `${ships.size} schepen (AIS)`;
        if (cv) cv.request();
        if (pick && pick.kind === 'ship') paintCard();
      } catch { aisLbl.textContent = 'AIS niet beschikbaar'; }
    }
    q.addEventListener('input', async () => {
      const s = q.value.trim(); const my = ++seq;
      if (s.length < 2) { res.hidden = true; return; }
      const coord = PlanCoords.parse ? PlanCoords.parse(s) : null;
      let items = [];
      if (coord) items.push({ label: PlanCoords.fmt(coord.lat, coord.lon, 'ddm'), sub: 'Coördinaat', lat: coord.lat, lon: coord.lon, exact: true });
      const low = s.toLowerCase();
      for (const v of ships.values()) if (v.name && v.name.toLowerCase().includes(low) && items.length < 6) { const p = where(v); if (p) items.push({ label: v.name, sub: `Schip · MMSI ${v.mmsi}`, lat: p[0], lon: p[1], mmsi: v.mmsi }); }
      try { const r = await window.palv.plan.suggest(s, { limit: 6 }); if (my !== seq) return; if (r && Array.isArray(r.items)) items = items.concat(r.items); } catch { /* none */ }
      res.replaceChildren(...items.slice(0, 10).map((it) => h('div', { class: 'zp-res', onclick: async () => {
        let pt = it;
        if (pt.lat == null && pt.id) { try { pt = await window.palv.plan.resolve(pt.id); } catch { pt = null; } }
        if (!pt || pt.lat == null) return toast('Geen positie voor dit punt', true);
        res.hidden = true; q.value = String(it.label || '').split(',')[0];
        if (it.mmsi) pick = { kind: 'ship', mmsi: it.mmsi, lat: +pt.lat, lon: +pt.lon };
        else if (it.exact) pick = { kind: 'point', lat: +pt.lat, lon: +pt.lon, label: 'Ingevoerde coördinaat' };
        if (map) map.setView([+pt.lat, +pt.lon], Math.max(map.getZoom(), 11));
        paintCard(); if (cv) cv.request();
      } }, icon(it.mmsi ? 'target' : 'globe'), h('div', {}, h('b', {}, it.label), h('small', {}, it.sub || '')))));
      res.hidden = !items.length;
    });
    q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const first = res.querySelector('.zp-res'); if (first) first.click(); } ev.stopPropagation(); });
    const baseSeg = segmented([{ value: 'osm', label: 'Kaart' }, { value: 'sat', label: 'Satelliet' }, { value: 'osmDark', label: 'Donker' }], 'osm', (v) => { fake.cfg.base = v; if (base) base.apply(); });
    const cleanup = () => { clearInterval(aisTimer); if (ro) ro.disconnect(); if (mo) mo.disconnect(); if (base) base.destroy(); if (map) { map.remove(); map = null; } };
    const take = () => {
      if (!pick) { toast('Tik eerst een schip of een punt op de kaart aan', true); return false; }
      if (pick.kind === 'ship') {
        const v = shipOf(pick.mmsi);
        const p = v ? where(v) : [pick.lat, pick.lon];
        if (!p) return false;
        const patch = { lat: +p[0].toFixed(5), lon: +p[1].toFixed(5), posAt: Date.now(), posLabel: v ? osName(v) : `MMSI ${pick.mmsi}`, mmsi: pick.mmsi };
        if (v && v.cog != null && v.sog > 0.5) patch.brc = C.norm(Math.round(v.cog));
        if (v && v.sog != null) patch.bs = Math.round(v.sog);
        set(patch);
      } else set({ lat: +pick.lat.toFixed(5), lon: +pick.lon.toFixed(5), posAt: Date.now(), posLabel: pick.label || 'Gekozen punt', mmsi: null });
      fetchSoon(true);
      cleanup();
      return true;
    };
    openModal({
      title: 'Kies positie schip', wide: true, cls: 'coa-mapmodal',
      body: [
        h('div', { class: 'coa-pickbar' }, h('div', { class: 'zp-search coa-picksearch' }, icon('search'), q, res), baseSeg, aisLbl),
        h('div', { class: 'coa-pickstage' }, mapEl, card2),
        h('p', { class: 'coa-hint coa-privacy' }, icon('shield'), 'Je keuze blijft binnen de eigen schermen: de AIS-gegevens komen uit de eigen stream en er gaat niets over het gekozen schip naar buiten. Alleen de kaarttegels worden opgehaald, en de wind- en zee-data met een afgeronde positie (vakken van ongeveer 5 km), zoals op de Offshore-kaart.'),
      ],
      actions: [{ label: 'Annuleren', onClick: cleanup }, { label: 'Overnemen', primary: true, onClick: () => take() }],
    });
    const backdrop = mapEl.closest('.modal-backdrop');
    mo = new MutationObserver(() => { if (backdrop && !backdrop.isConnected) cleanup(); });
    mo.observe($('#modal-root'), { childList: true });
    paintCard();
    setTimeout(() => {
      const start = P.lat != null ? [P.lat, P.lon, 10] : [53.2, 4.3, 7.4];
      map = L.map(mapEl, { zoomControl: true, attributionControl: true, zoomSnap: 0, zoomDelta: 0.5, minZoom: 3, maxZoom: 18, fadeAnimation: false, inertia: true, doubleClickZoom: false });
      map.attributionControl.setPrefix(false);
      map.setView([start[0], start[1]], start[2], { animate: false });
      const ctx = { map, el: mapEl, w: fake, cfg: fake.cfg };
      base = zpBaseLayers(ctx);
      base.apply();
      cv = zpCanvas(map);
      const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      cv.add(40, (c) => {
        const { g } = c;
        const t = now();
        for (const v of ships.values()) {
          if (v.cls === 'aton') continue;
          const p = where(v); if (!p || !c.near(p[0], p[1], 0.2)) continue;
          const q2 = c.P(p[0], p[1]); if (!c.inView(q2, 20)) continue;
          const chosen = pick && pick.kind === 'ship' && pick.mmsi === v.mmsi;
          const px = chosen ? 11 : c.zoom >= 10 ? 8 : 6;
          const moving = v.sog > 0.5 && v.cog != null;
          g.save(); g.translate(q2[0], q2[1]);
          if (moving) { g.rotate(((v.hdg != null && v.hdg < 360 ? v.hdg : v.cog) * Math.PI) / 180); g.beginPath(); g.moveTo(0, -px); g.lineTo(px * 0.55, px * 0.7); g.lineTo(0, px * 0.4); g.lineTo(-px * 0.55, px * 0.7); g.closePath(); }
          else { g.beginPath(); g.arc(0, 0, px * 0.5, 0, Math.PI * 2); }
          g.fillStyle = chosen ? '#f59a00' : typeof osGroup === 'function' && OS_GROUPS[osGroup(v)] ? OS_GROUPS[osGroup(v)].color : '#7cc6ff';
          g.fill(); g.lineWidth = chosen ? 2.5 : 1.1; g.strokeStyle = chosen ? '#fff' : '#0a0f18'; g.stroke();
          g.restore();
          if (moving && c.zoom >= 9) { const f = PlanGeo.dest({ lat: p[0], lon: p[1] }, v.cog, v.sog * 1852 * 0.1); const e = c.P(f.lat, f.lon); g.strokeStyle = chosen ? '#f59a00' : 'rgba(124,198,255,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(q2[0], q2[1]); g.lineTo(e[0], e[1]); g.stroke(); }
          if (chosen || (c.zoom >= 11 && v.name)) zpText(g, osName(v), q2[0] + 12, q2[1], { font: `700 ${(0.62 * rem()).toFixed(1)}px ${getComputedStyle(document.body).fontFamily}`, color: chosen ? '#ffb941' : '#e9eff8' });
          c.hit({ x: q2[0], y: q2[1], r: 14, kind: 'ship', item: v, z: chosen ? 3 : 2 });
          void t;
        }
        // The chosen point.
        if (pick && pick.kind === 'point') {
          const q3 = c.P(pick.lat, pick.lon);
          g.strokeStyle = '#f59a00'; g.lineWidth = 2.5;
          g.beginPath(); g.arc(q3[0], q3[1], 12, 0, Math.PI * 2); g.moveTo(q3[0] - 20, q3[1]); g.lineTo(q3[0] - 6, q3[1]); g.moveTo(q3[0] + 6, q3[1]); g.lineTo(q3[0] + 20, q3[1]); g.moveTo(q3[0], q3[1] - 20); g.lineTo(q3[0], q3[1] - 6); g.moveTo(q3[0], q3[1] + 6); g.lineTo(q3[0], q3[1] + 20); g.stroke();
        }
      });
      map.on('click', (e) => {
        const hit = cv.hitAt(e.containerPoint.x, e.containerPoint.y, (s) => s.kind === 'ship');
        if (hit) pick = { kind: 'ship', mmsi: hit.item.mmsi, lat: hit.item.lat, lon: hit.item.lon };
        else pick = { kind: 'point', lat: e.latlng.lat, lon: e.latlng.lng, label: 'Gekozen punt' };
        paintCard(); cv.request();
      });
      ro = new ResizeObserver(() => map && map.invalidateSize(false));
      ro.observe(mapEl);
      pollAis();
      aisTimer = setInterval(pollAis, 2000);
    }, 30);
  }

  /* ---------- drawing on the plan (coa-draw.js) ---------- */
  const layer = coaDrawLayer({
    el: drawEl, tools, cfg, save, list: 'marks', plan: () => P, W: COA_W, H: COA_H, pal,
    on: () => !!cfg.draw, keys: () => onScreen(body) && !modalOpen(), iconMax: 300, title: 'Tekenlaag',
    hint: 'De tekening hoort bij dit plan, staat op alle schermen en komt mee op de A5-afdruk. Iconen en tekst pak je direct vast; lijnen, pijlen en vormen door er even op te drukken. Draaien aan de ronde greep, met twee vingers of met [ en ]; schalen aan de hoeken.',
  });
  cleanups.push(() => layer.destroy());
  const paintMarks = () => layer.paint();
  function paintMode() {
    root.classList.toggle('drawing', !!cfg.draw);
    drawSw.paint();
    if (!cfg.draw) tools.replaceChildren();
    layer.mode();
  }

  /* ---------- Teken Schip: the ship large, to draw the plan on ---------- */
  // The ship of the board, seen from above and lying down (bow right, stern left), as large as the screen
  // allows and sharp at any size (vector). On the left the whole drawing kit; what is drawn belongs to the
  // plan (OPS 'coa' / 'shipmarks'), is on every screen at once, and prints on A5 landscape.
  const SHIP_W = COA_SHEET.w, SHIP_H = COA_SHEET.h;
  function shipDialog() {
    if (!P) return toast('Even geduld: het plan wordt geladen');
    flush();
    const sideEl = h('aside', { class: 'coa-tools coa-shiptools' });
    const picEl = h('div', { class: 'coa-shippic' });
    const drawLayerEl = h('div', { class: 'coa-shipdraw' });
    const stageEl = h('div', { class: 'coa-shipstage' }, picEl, drawLayerEl);
    let guides = cfg.shipGuides !== false;
    const guideBtn = h('button', { class: 'btn zp-btn' + (guides ? ' on' : ''), title: 'De peilingen 45°, 90° en 139° vanaf de boeg en de hartlijn aan of uit', onclick: () => { guides = !guides; cfg.shipGuides = guides; save(); guideBtn.classList.toggle('on', guides); paintPic(); } }, icon('target'), 'Hulplijnen');
    const countEl = h('span', { class: 'coa-shipcount' });
    const head = h('div', { class: 'coa-shipbar' },
      h('span', { class: 'coa-shipname' }, h('b', {}, P.name), h('small', {}, 'Teken het schip één keer (opbouw, dek, kraan …): het gaat als miniatuur mee in alle vier de COA’s en op de A5-kaart')),
      countEl, h('span', { class: 'zp-spacer' }), guideBtn,
      h('button', { class: 'btn zp-btn', title: 'Als PDF (A5 liggend)', onclick: () => shipExport('pdf') }, icon('download'), 'PDF A5'),
      h('button', { class: 'btn zp-btn', title: 'Afdrukken op A5 liggend', onclick: () => shipExport('print') }, icon('note'), 'Afdrukken'));
    const paintPic = () => { picEl.innerHTML = coaShipSheetSvg(pal(), { guides, id: 'ship-' + w.id }); };
    paintPic();
    let shipLayer = null, backdrop = null, boardTimer = null;
    const close = openModal({ title: 'Teken Schip', wide: true, cls: 'coa-shipmodal', bare: true, body: h('div', { class: 'coa-shipbody' }, sideEl, h('div', { class: 'coa-shipmain' }, head, stageEl)) });
    backdrop = sideEl.closest('.modal-backdrop');
    shipLayer = coaDrawLayer({
      el: drawLayerEl, tools: sideEl, cfg, save, list: 'shipmarks', plan: () => P, W: SHIP_W, H: SHIP_H, pal,
      on: () => true, keys: () => !!backdrop && $('#modal-root').lastElementChild === backdrop, iconMax: 420, title: 'Teken Schip',
      hint: 'Wat je op en direct rond de romp tekent (opbouw, dek, kraan) gaat als miniatuur mee op het schip in alle vier de COA’s en op de A5-kaart; het draait mee met de koers per COA. Pijlen en helikopters verder van het schip blijven alleen op dit blad. Staat op alle schermen; los af te drukken op A5 liggend. Iconen en tekst pak je direct vast; lijnen, pijlen en vormen door er even op te drukken. Draaien aan de ronde greep, met twee vingers of met [ en ]; schalen aan de hoeken.',
      onChange: (n) => {
        countEl.textContent = n ? `${n} ${n === 1 ? 'tekening' : 'tekeningen'}` : 'nog leeg';
        // The four COA cards behind the dialog follow the drawing (a moment later, once for a run of changes).
        clearTimeout(boardTimer); boardTimer = setTimeout(() => { if (P) { vm = coaModel(P, offMin); paintBoard(); } }, 150);
      },
    });
    shipLayer.mode();
    // Theme switched while open: the ship follows. Closed (cross, backdrop, Escape): everything goes.
    const tw = new MutationObserver(() => { paintPic(); shipLayer.paint(); });
    tw.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const ro = new ResizeObserver(() => shipLayer.paint());
    ro.observe(stageEl);
    const gone = new MutationObserver(() => { if (backdrop && !backdrop.isConnected) { shipLayer.destroy(); tw.disconnect(); ro.disconnect(); gone.disconnect(); paintBar(); } });
    gone.observe($('#modal-root'), { childList: true });
    void close;
    function shipExport(how) {
      const Pp = COA_PAL.print;
      const svg = coaShipSheetSvg(Pp, { guides, id: 'pship', print: true }).replace('</svg>', `${shipLayer.marks().map((m) => coaMarkSvg(m, Pp)).join('')}</svg>`);
      const d = new Date(P.hhour || Date.now());
      const dtg = `${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z`;
      const v = vm;
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A5 landscape; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', -apple-system, sans-serif; color: #0b1320; }
.pg { width: 190mm; margin: ${how === 'print' ? '6mm' : '0'} auto 0; }
.hd { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1.4pt solid #0b1320; padding-bottom: 1mm; }
.hd h1 { font: 800 11pt Bahnschrift, 'Segoe UI', sans-serif; letter-spacing: 0.08em; margin: 0; }
.hd span { font-size: 7.6pt; font-weight: 700; }
svg { width: 190mm; height: 106.9mm; display: block; margin-top: 1.5mm; }
.ft { margin-top: 1mm; color: #4a5a70; font-size: 6pt; display: flex; justify-content: space-between; }
</style></head><body><div class="pg"><div class="hd"><h1>SHIP · ${escHtml(P.name)}</h1><span>${v ? `AT ${v.fmt(v.at)}°${v.refText} · ` : ''}${dtg}</span></div>${svg}<div class="ft"><span>Top view, bow right · port red, starboard green${guides ? ' · rel. bearings 45/90/139°' : ''}</span><span>P-ALV Dashboard · ${escHtml(OPS.screen.name || '')} · ${zulu(Date.now())}</span></div></div></body></html>`;
      const name = `Schip ${P.name}`.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
      const job = how === 'print' ? window.palv.plan.printA5({ html, landscape: true }) : window.palv.plan.printPdf({ html, name, pageSize: 'A5', landscape: true });
      job.then((r) => { if (r && r.ok) toast(how === 'print' ? 'Naar de printer gestuurd (A5 liggend)' : 'Opgeslagen als PDF (A5 liggend)'); else if (r && r.error) toast(r.error, true); }).catch((err) => toast(String(err.message || err), true));
    }
  }

  /* ---------- to a mission ---------- */
  function missionDialog() {
    if (!P || !vm) return;
    const list = typeof mpMissions === 'function' ? mpMissions().filter((m) => m.status !== 'archived') : [];
    if (!list.length) return toast('Er is nog geen missie in Mission Planning', true);
    const s = h('select', { class: 'input' }, list.map((m) => h('option', { value: m.id, selected: m.id === P.missionId || null }, m.name)));
    const wv = `${vm.fmt(vm.wd)}°${vm.refText}/${Math.round(vm.ws)}${vm.gust ? 'G' + Math.round(vm.gust) : ''} kt`;
    const sunMoon = `Sun ${vm.fmt(vm.sun.az)}°${vm.refText} ${Math.round(vm.sun.alt)}° · Moon ${vm.fmt(vm.moon.az)}°${vm.refText} ${Math.round(vm.moon.alt)}° ${Math.round(vm.moon.fraction * 100)}%${vm.glareSun ? ' · APPROACH INTO SUN' : ''}${vm.glareMoon ? ' · APPROACH INTO MOON (NVG)' : ''}`;
    const c = vm.brc || vm.coas[0];
    const ingress = `AT ${vm.fmt(vm.at)}°${vm.refText} · COA ${c.n} schip ${vm.fmt(c.heading)}°${vm.refText}: rel. wind ${c.rel ? c.rel.text : '---'} / ${Math.round(c.app.spd)} kt`;
    openModal({
      title: 'Naar missie', body: [
        field('Missie', s),
        h('p', { class: 'coa-hint' }, 'Dit wordt ingevuld onder Fase 1 › Pilot Flying / FL (bestaande tekst wordt overschreven):'),
        h('div', { class: 'coa-kvs' }, kv('W/V', wv), kv('Sun / Moon', sunMoon), kv('Suggested ingress HDG', ingress)),
      ],
      actions: [{ label: 'Annuleren' }, { label: 'Invullen', primary: true, onClick: () => {
        const mid = s.value;
        mpSet(mid, 'phase1', 'pf', 'wv', wv);
        mpSet(mid, 'phase1', 'pf', 'sunmoon', sunMoon);
        mpSet(mid, 'phase1', 'pf', 'ingress_hdg', ingress);
        set({ missionId: mid });
        toast(`Ingevuld in "${(list.find((m) => m.id === mid) || {}).name}"`);
      } }],
    });
  }

  /* ---------- A5 portrait: print and PDF ---------- */
  function a5Html(how) {
    const Pp = COA_PAL.print;
    const v = vm;
    const svg = coaBoardSvg(v, Pp, { id: 'p' }).replace('</svg>', `${layer.marks().map((m) => coaMarkSvg(m, Pp)).join('')}</svg>`);
    const e = escHtml;
    const d = new Date(P.hhour || Date.now());
    const dtg = `${pad2(d.getUTCDate())}${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z ${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
    const R = v.refText;
    const pos = v.pos ? `${PlanCoords.fmt(v.pos.lat, v.pos.lon, 'ddm')}${v.pos.dr ? ' (DR at H)' : ''}` : '—';
    const heloShort = (hl) => `${hl.head >= 0 ? 'HW' : 'TW'}${Math.abs(Math.round(hl.head))} XW${Math.abs(Math.round(hl.cross))}${hl.side}`;
    const rows = v.coas.map((c) => `<tr class="${c.brc ? 'brc' : ''}"><td><b>COA ${c.n}</b>${c.brc ? ' <i>BRC</i>' : ''}</td><td>${v.fmt(c.heading)}°</td><td><b>${c.app.dir == null ? '---' : v.fmt(c.app.dir)}° / ${Math.round(c.app.spd)}</b>${c.gust ? ` (G${Math.round(c.gust.spd)})` : ''}</td><td class="${c.rel && c.rel.side === 'G' ? 'g' : c.rel && c.rel.side === 'R' ? 'r' : ''}"><b>${e(coaRelText(c))}</b></td><td>${heloShort(c.helo)}</td><td>${c.approach.text}</td><td>${c.sea ? e(c.sea.name) : '—'}</td></tr>`).join('');
    const m = P._sea && P._sea.model, ds = m && m.hs != null ? COA_CALC.douglas(m.hs) : null;
    const srel = m && m.dir != null ? COA_CALC.seaRelative(m.dir, v.brc ? v.brc.heading : v.at) : null;
    const sea = m ? `Sea state <b>${ds ? ds.code + ' ' + ds.name : '–'}</b> · Hs ${m.hs != null ? m.hs.toFixed(1) + ' m' : '–'} · Tm ${m.period != null ? m.period.toFixed(0) + ' s' : '–'} · waves from ${m.dir != null ? v.fmt(m.dir) + '°' : '–'}${srel ? ` · ${v.brc ? 'on BRC' : 'on COA 1'}: ${srel.name.toLowerCase()}, ${srel.motion}` : ''}${m.sst != null ? ' · SST ' + m.sst.toFixed(0) + ' °C' : ''}` : 'Sea: no data';
    const warn = [v.glareSun ? 'APPROACH INTO SUN' : '', v.glareMoon ? 'APPROACH INTO MOON (NVG)' : ''].filter(Boolean).join(' · ');
    const lx = ASTRO.formatLux(v.light.lux);
    const sm = `Sun <b>${v.fmt(v.sun.az)}°</b> elev ${Math.round(v.sun.alt)}° · Moon <b>${v.fmt(v.moon.az)}°</b> elev ${Math.round(v.moon.alt)}° ${Math.round(v.moon.fraction * 100)}% · ${e(v.phase ? v.phase.name : '')} · ${lx.value} ${lx.unit}`;
    const conf = COA_CALC.heightConflicts(P.heights, +P.sep || 500);
    const bad = new Set(conf.flatMap((c) => [c.a.i, c.b.i]));
    const hrows = P.heights.filter((r) => r.cs || r.type || r.alt || r.role);
    const xsec = P.heights.some((r) => COA_CALC.parseFt(r.alt) != null) ? coaHeightSvg(P.heights, +P.sep || 500, bad, Pp, { w: 300, h: 150 }) : '';
    const ht = (hrows.length ? P.heights.map((r, i) => (r.cs || r.type || r.alt || r.role ? `<tr class="${bad.has(i) ? 'bad' : ''}"><td>${e(r.cs || '')}</td><td>${e(r.type || '')}</td><td><b>${e(r.alt || '')}</b></td><td>${e(r.role || '')}</td></tr>` : '')).join('') : '') + Array.from({ length: Math.max(0, 4 - hrows.length) }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td></tr>').join('');
    return `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: A5 portrait; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Segoe UI', -apple-system, sans-serif; color: #0b1320; font-size: 7.4pt; }
.pg { width: 132mm; padding: 0; }
.hd { display: flex; align-items: baseline; justify-content: space-between; border-bottom: 1.6pt solid #0b1320; padding-bottom: 1.2mm; }
.hd h1 { font: 800 12pt Bahnschrift, 'Segoe UI', sans-serif; letter-spacing: 0.08em; margin: 0; }
.hd span { font-size: 8pt; font-weight: 700; }
.meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6mm 2mm; margin: 1.4mm 0 1mm; }
.meta div { border: 0.4pt solid #9aa8bb; border-radius: 1mm; padding: 0.6mm 1.2mm; }
.meta small { display: block; color: #4a5a70; font-size: 5.6pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
.meta b { font-size: 8.2pt; font-family: Consolas, monospace; }
.board svg { width: 132mm; height: 101.5mm; display: block; }
table { width: 100%; border-collapse: collapse; margin-top: 1.2mm; }
th { background: #e6ebf2; font-size: 6pt; text-transform: uppercase; letter-spacing: 0.04em; padding: 0.6mm 0.8mm; border: 0.4pt solid #9aa8bb; text-align: left; }
td { border: 0.4pt solid #9aa8bb; padding: 0.7mm 0.8mm; font-family: Consolas, monospace; font-size: 7pt; }
tr.brc td { background: #fff3df; }
tr.bad td { background: #ffe3e3; }
td i { font-style: normal; background: #c46f00; color: #fff; border-radius: 1mm; padding: 0 0.8mm; font-size: 5.6pt; font-family: 'Segoe UI', sans-serif; font-weight: 800; }
td.g b { color: #1b8a3a; } td.r b { color: #c8161c; }
.ln { margin-top: 1.2mm; font-size: 7.2pt; }
.warn { margin-top: 1mm; background: #c8161c; color: #fff; font-weight: 800; padding: 0.8mm 1.4mm; border-radius: 1mm; letter-spacing: 0.04em; }
.two { display: grid; grid-template-columns: 1fr 44mm; gap: 2mm; align-items: start; }
.two table { margin-top: 1.2mm; }
.xs svg { width: 44mm; height: auto; display: block; margin-top: 1.2mm; border: 0.4pt solid #9aa8bb; border-radius: 1mm; }
.ft { margin-top: 1.2mm; color: #4a5a70; font-size: 5.6pt; display: flex; justify-content: space-between; }
.ref { font-weight: 800; }
</style></head><body><div class="pg" style="margin: ${how === 'print' ? '7mm' : '0'} auto 0">
<div class="hd"><h1>COA PLANNER</h1><span>${e(P.name)} · ${dtg}</span></div>
<div class="meta">
<div><small>Assault Track</small><b>${v.fmt(v.at)}°${R}</b></div>
<div><small>Boat Ref Course</small><b>${v.brc ? v.fmt(v.brc.heading) + '°' + R : '—'}</b></div>
<div><small>Boat Speed</small><b>${Math.round(+P.bs)} kt</b></div>
<div><small>W/V</small><b>${v.fmt(v.wd)}°${R}/${Math.round(v.ws)}${v.gust ? 'G' + Math.round(v.gust) : ''}</b></div>
<div style="grid-column: span 2"><small>Ship position${P.posLabel ? ' · ' + e(P.posLabel) : ''}</small><b>${e(pos)}</b></div>
<div><small>H-hour</small><b>${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}Z</b></div>
<div><small>Reference</small><b class="ref">°${R}${R === 'M' ? ` var ${Math.abs(v.decl).toFixed(1)}${v.decl >= 0 ? 'E' : 'W'}` : ''}</b></div>
</div>
<div class="board">${svg}</div>
<table><thead><tr><th>COA</th><th>Ship HDG</th><th>Rel. wind °/kt</th><th>Rel. bearing</th><th>Helo on AT</th><th>Approach</th><th>Sea</th></tr></thead><tbody>${rows}</tbody></table>
<div class="ln">${sm}</div>
<div class="ln">${sea}</div>
${warn ? `<div class="warn">${warn}</div>` : ''}
<div class="${xsec ? 'two' : ''}"><table><thead><tr><th style="width:24%">Callsign</th><th style="width:22%">Type</th><th style="width:18%">Alt ft</th><th>Task</th></tr></thead><tbody>${ht}</tbody></table>${xsec ? `<div class="xs">${xsec}</div>` : ''}</div>
${conf.length ? `<div class="warn">HEIGHT CONFLICT: ${conf.slice(0, 3).map((c) => `${e(c.a.name)} ↔ ${e(c.b.name)} ${c.diff} ft`).join(' · ')} (min. ${+P.sep || 500} ft)</div>` : ''}
<div class="ft"><span>HW/TW head-/tailwind · XW crosswind from L/R (kt) · Rel. wind = apparent wind over deck · G stbd, R port</span><span>P-ALV Dashboard · ${e(OPS.screen.name || '')} · ${zulu(Date.now())}</span></div>
</div></body></html>`;
  }
  async function exportA5(how) {
    if (!P || !vm) return;
    flush();
    const html = a5Html(how);
    const name = `COA ${P.name}`.replace(/[\\/:*?"<>|]+/g, ' ').trim() + '.pdf';
    try {
      const r = how === 'print' ? await window.palv.plan.printA5({ html }) : await window.palv.plan.printPdf({ html, name, pageSize: 'A5' });
      if (r && r.ok) toast(how === 'print' ? 'Naar de printer gestuurd (A5 staand)' : 'Kniebordkaart opgeslagen (A5 staand)');
      else if (r && r.error) toast(r.error, true);
    } catch (err) { toast(String(err.message || err), true); }
  }

  /* ---------- painting ---------- */
  function paint({ inputs = true, info: withInfo = true } = {}) {
    if (!P) { if (!ensurePlan()) { paintBoard(); return; } load(); }
    if (!P) return;
    vm = coaModel(P, offMin);
    paintBar();
    if (inputs) paintInputs();
    paintSide();
    paintBoard();
    // While a field in the right column has the focus (typing, the on-screen keyboard on it), the column
    // is left alone and repainted once the focus leaves it.
    const ae = document.activeElement;
    const typing = info.contains(ae) && ae.tagName === 'INPUT' || info.contains(ae) && ae.tagName === 'TEXTAREA';
    if (withInfo && !typing) paintInfo();
    else if (withInfo) infoStale = true;
  }
  let infoStale = false;
  info.addEventListener('focusout', (e) => { if (infoStale && !(e.relatedTarget && info.contains(e.relatedTarget) && /^(INPUT|TEXTAREA)$/.test(e.relatedTarget.tagName))) { infoStale = false; setTimeout(() => { const ae = document.activeElement; if (!(info.contains(ae) && /^(INPUT|TEXTAREA)$/.test(ae.tagName))) paintInfo(); }, 0); } });
  const themeWatch = new MutationObserver(() => { paintBoard(); paintMarks(); });
  themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  cleanups.push(() => themeWatch.disconnect());
  // The sun and moon move on; while the tab is in view the picture follows each minute.
  timers.push(setInterval(() => { if (onScreen(body) && P) { paint({ inputs: false }); checkWxAge(); } }, 60000));
  // Coming back to the tab with a warning still waiting: show it then.
  timers.push(setInterval(() => { if (wxPending && P && onScreen(body)) checkWxAge(); }, 2000));

  if (ensurePlan()) { load(); }
  paint({ inputs: true });
  paintMode();
  fetchSoon(true);
  // The shared files can arrive after the tab is built.
  if (!OPS.loaded) { const off = OPS.on('coa', () => { if (P) return; if (ensurePlan()) { load(); paint({ inputs: true }); paintMode(); fetchSoon(true); } }); cleanups.push(off); }

  return {
    destroy() { flush(); for (const t of timers) clearInterval(t); clearTimeout(fetchTimer); for (const f of cleanups) { try { f(); } catch { /* gone */ } } },
  };
}
