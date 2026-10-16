'use strict';

/* ============================================================
   P-ALV Dashboard — opstarten en de klok die alles aanstuurt
   De renderer bestaat uit losse bestanden die in index.html in volgorde worden geladen:
   model.js (indeling en migraties), astro.js (zon en maan), wx.js (BOM-limieten), core.js (bouwstenen),
   state.js, header.js, feeds.js, radar.js + widgets/*.js, layout.js, settings.js, system.js en dit bestand.
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
// Asked once: should the reload not come through, it is not asked again every second.
let nightlyAsked = false;
function nightlyReload() {
  if (nightlyAsked || !state.settings.nightlyReload || editing || modalOpen() || upd.popup) return;
  const d = new Date();
  if (d.getHours() !== 4 || performance.now() < 3600e3) return;
  nightlyAsked = true;
  flushSave();
  plog('info', 'nachtelijke verversing');
  window.palv.app.reload().catch(() => location.reload());
}

let lastRotate = Date.now(), lastTheme = 0, lastUdp = 0, lastMoon = 0, lastBeat = 0;
function everySecond() {
  tickClocks();
  // By elapsed time rather than on exact seconds: a timer that runs late would otherwise skip a turn.
  const now = Date.now();
  if (now - lastTheme >= 20000) { lastTheme = now; applyTheme(true); }
  if (now - lastUdp >= 10000) { lastUdp = now; renderUdp(); }
  if (now - lastMoon >= 30000) { lastMoon = now; renderMoon(); }
  if (now - lastBeat >= 5000) { lastBeat = now; window.palv.status.heartbeat(); sendStatus(); }
  paintHealth();
  paintFreshBadges();
  oledTick();
  briefingTick();
  nightlyReload();
  const r = state.settings.rotate;
  if (r > 0 && state.pages.length > 1 && !editing && !modalOpen()) {
    if (now - lastRotate >= r * 1000) { lastRotate = now; setPage((state.activePage + 1) % state.pages.length); }
  } else lastRotate = now;
}

async function boot() {
  document.body.classList.toggle('mac', IS_MAC);
  const loaded = await window.palv.config.load();
  if (loaded && loaded.__restoredFrom) setTimeout(() => toast(`De indeling was onleesbaar; de reservekopie van ${new Date(loaded.__restoredFrom).toLocaleString('nl-NL')} is teruggezet.`, true), 1500);
  state = normalize(loaded);
  applyScale();
  applyTheme(false);
  onWinState(await window.palv.win.getState());
  window.palv.win.onState(onWinState);
  window.palv.app.keepAwake(state.settings.keepAwake !== false);
  // The start-up entry points at the program itself; renewed so it follows a new install location.
  if (state.settings.autoStart) window.palv.app.setAutoStart(true);

  renderTitlebar();
  window.palv.app.version().then((v) => { $('#tb-version').textContent = 'v' + v; });
  renderClocks();
  renderUdp();
  renderMoon();
  applyWxMargins();
  renderEham();
  setPage(state.activePage);

  refreshMetar();
  setInterval(refreshMetar, 60000);
  refreshRunways();
  setInterval(refreshRunways, 5000);
  startEmergencyWatch();
  loadBriefingSound();
  setInterval(everySecond, 1000);
  window.palv.status.heartbeat();
  sendStatus();

  // Updates and the screens overview: the main process tells when something changes.
  window.palv.update.onStatus(onUpdateStatus);
  window.palv.update.status().then(onUpdateStatus);
  window.palv.update.justUpdated().then((info) => { if (info) setTimeout(() => showUpdated(info), 2500); });
  window.palv.screens.onUpdate((list) => { screensState.list = list; paintScreens(); });
  window.palv.screens.info().then((info) => { screensState.list = info.list; renderTitlebar(); });

  window.addEventListener('resize', applyScale);
  // A change made just before closing is still waiting for its save.
  window.addEventListener('beforeunload', flushSave);

  window.addEventListener('keydown', (e) => {
    oledPointer();
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
    oledPointer();
    if (!winState.fullscreen) return;
    const bar = $('#titlebar');
    if (e.clientY <= 2) { clearTimeout(hideTimer); hideTimer = null; document.body.classList.add('tb-reveal'); }
    else if (e.clientY > bar.offsetHeight + 12 && document.body.classList.contains('tb-reveal') && !hideTimer) {
      hideTimer = setTimeout(() => { document.body.classList.remove('tb-reveal'); hideTimer = null; }, 500);
    }
  });
  window.addEventListener('pointerdown', oledPointer, true);
  oledPointer();
  plog('info', `dashboard gestart (${state.pages.length} pagina's)`);
}

boot();
