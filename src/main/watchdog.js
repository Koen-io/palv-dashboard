// Keeps an unattended screen alive: the display never goes to sleep, and a dashboard that crashes or
// hangs is brought back by itself. Embedded sites that crash are reloaded on their own. The renderer
// sends a heartbeat every few seconds; one that stays silent while the window is up counts as a hang.
const { app, powerSaveBlocker, powerMonitor } = require('electron');
const log = require('./log');

const HANG_MS = 20000;        // "unresponsive" this long: start the page afresh
const SILENT_MS = 60000;      // no heartbeat this long: same
const LOOP_WINDOW_MS = 10 * 60000;
const LOOP_MAX = 4;           // more crashes than this in the window: wait longer before the next try

const stats = { startedAt: Date.now(), heartbeat: 0, crashes: 0, hangs: 0, reloads: 0, webviewCrashes: 0, lastCrash: null, locked: false, suspended: false };
let blocker = null;
let win = null;
let crashTimes = [];
let hangTimer = null;

function keepAwake(on) {
  if (on && (blocker == null || !powerSaveBlocker.isStarted(blocker))) {
    blocker = powerSaveBlocker.start('prevent-display-sleep');
    log.info('watchdog', 'scherm blijft aan (slaapstand en schermbeveiliging geblokkeerd)');
  } else if (!on && blocker != null && powerSaveBlocker.isStarted(blocker)) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
    log.info('watchdog', 'slaapstand van het scherm weer toegestaan');
  }
  return blocker != null;
}

function reload(reason) {
  if (!win || win.isDestroyed()) return;
  const now = Date.now();
  crashTimes = crashTimes.filter((t) => now - t < LOOP_WINDOW_MS).concat(now);
  const delay = crashTimes.length > LOOP_MAX ? 60000 : 2000;
  stats.reloads += 1;
  log.warn('watchdog', `dashboard wordt opnieuw gestart over ${delay / 1000} s: ${reason}`);
  setTimeout(() => {
    if (!win || win.isDestroyed()) return;
    stats.heartbeat = 0;
    win.webContents.reload();
  }, delay);
}

function attach(window) {
  win = window;
  const wc = win.webContents;
  wc.on('render-process-gone', (_e, details) => {
    stats.crashes += 1;
    stats.lastCrash = { at: Date.now(), reason: details.reason, exitCode: details.exitCode };
    log.error('watchdog', 'dashboard-proces beëindigd', details);
    if (details.reason !== 'clean-exit') reload('proces ' + details.reason);
  });
  wc.on('unresponsive', () => {
    log.warn('watchdog', 'dashboard reageert niet');
    clearTimeout(hangTimer);
    hangTimer = setTimeout(() => {
      stats.hangs += 1;
      log.error('watchdog', `dashboard reageert al ${HANG_MS / 1000} s niet`);
      try { wc.forcefullyCrashRenderer(); } catch { /* already gone */ }
      reload('vastgelopen');
    }, HANG_MS);
  });
  wc.on('responsive', () => { clearTimeout(hangTimer); hangTimer = null; });
  wc.on('did-fail-load', (_e, code, desc, url, isMain) => { if (isMain) log.error('watchdog', `dashboard laadt niet: ${desc} (${code})`, url); });

  // A renderer that is up but whose script has stopped (an endless loop) still sends no heartbeat.
  setInterval(() => {
    if (!win || win.isDestroyed() || !stats.heartbeat) return;
    if (Date.now() - stats.heartbeat > SILENT_MS) {
      stats.hangs += 1;
      log.error('watchdog', `geen hartslag van het dashboard sinds ${Math.round((Date.now() - stats.heartbeat) / 1000)} s`);
      stats.heartbeat = 0;
      reload('geen hartslag');
    }
  }, 5000);
}

// Embedded sites (Windy, websites): a crashed or hung one is loaded again, the dashboard carries on.
function guardWebview(contents) {
  let hang = null;
  contents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    stats.webviewCrashes += 1;
    log.warn('watchdog', `ingesloten pagina gecrasht (${details.reason})`, contents.getURL().slice(0, 120));
    setTimeout(() => { if (!contents.isDestroyed()) contents.reload(); }, 3000);
  });
  contents.on('unresponsive', () => {
    clearTimeout(hang);
    hang = setTimeout(() => {
      if (contents.isDestroyed()) return;
      log.warn('watchdog', 'ingesloten pagina reageert niet meer, wordt herladen', contents.getURL().slice(0, 120));
      try { contents.forcefullyCrashRenderer(); } catch { /* gone */ }
      setTimeout(() => { if (!contents.isDestroyed()) contents.reload(); }, 1000);
    }, HANG_MS);
  });
  contents.on('responsive', () => clearTimeout(hang));
}

function start() {
  app.on('child-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') log.warn('watchdog', `hulpproces ${details.type} beëindigd (${details.reason})`, details.name || '');
  });
  powerMonitor.on('lock-screen', () => { stats.locked = true; log.info('watchdog', 'scherm vergrendeld'); });
  powerMonitor.on('unlock-screen', () => { stats.locked = false; log.info('watchdog', 'scherm ontgrendeld'); });
  powerMonitor.on('suspend', () => { stats.suspended = true; log.warn('watchdog', 'computer gaat in slaapstand'); });
  powerMonitor.on('resume', () => {
    stats.suspended = false;
    log.info('watchdog', 'computer uit slaapstand');
    // Timers and connections are stale after a sleep: start the page afresh.
    if (win && !win.isDestroyed()) setTimeout(() => win.webContents.reload(), 3000);
  });
}

function heartbeat() { stats.heartbeat = Date.now(); }

module.exports = { start, attach, guardWebview, keepAwake, heartbeat, stats, awake: () => blocker != null && powerSaveBlocker.isStarted(blocker) };
