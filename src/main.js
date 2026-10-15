const { app, BrowserWindow, ipcMain, shell, dialog, session, Menu, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('./main/log');
const config = require('./main/config');
const watchdog = require('./main/watchdog');
const updater = require('./main/updater');
const screens = require('./main/screens');
const data = require('./main/data');
require('./main/tiles');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const WEB_PARTITION = 'persist:palv-web';
const isMac = process.platform === 'darwin';
const pkg = require('../package.json');

// The Mac build is not signed with a developer certificate; without this macOS asks for the login
// keychain password every time the app has been replaced by a newer version.
if (isMac) app.commandLine.appendSwitch('use-mock-keychain');

let win = null;

// Dev helper: `electron . --shot=out.png [--shot-delay=8000] [--shot-js="..."] [--shot-size=1920x1080] [--shot-resize=1100x640]`
// renders a screenshot and quits; --shot-resize changes the window size halfway, to check that the layout follows.
// --user-data=<map> runs on a separate configuration, so a test never touches the real one.
const argValue = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const shotPath = argValue('shot');
const shotSize = (name, fallback) => { const m = /^(\d+)x(\d+)$/.exec(argValue(name) || ''); return m ? [+m[1], +m[2]] : fallback; };
if (argValue('user-data')) app.setPath('userData', path.resolve(argValue('user-data')));

if (!shotPath && !app.requestSingleInstanceLock()) {
  app.quit();
}

log.init(path.join(app.getPath('userData'), 'logs'));
config.init(app.getPath('userData'));
log.info('app', `P-ALV Dashboard ${app.getVersion()} start (${process.platform} ${process.arch}, Electron ${process.versions.electron})`);
process.on('uncaughtException', (err) => log.error('app', 'onverwachte fout in het hoofdproces', err));
process.on('unhandledRejection', (err) => log.error('app', 'onafgehandelde fout in het hoofdproces', err));

// A new app version: the configuration as it was is kept once, before the new version touches it.
try {
  const marker = path.join(app.getPath('userData'), 'last-version.txt');
  const last = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : null;
  if (last !== app.getVersion()) {
    if (last) { config.backup('update'); log.info('app', `bijgewerkt van ${last} naar ${app.getVersion()}`); }
    fs.writeFileSync(marker, app.getVersion(), 'utf8');
  } else config.backup('start');
} catch (err) { log.warn('app', 'versiecontrole mislukt', err.message); }

function sendWinState(known = {}) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('win:state', {
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen(),
    ...known,
  });
}

// macOS keeps its menu bar at the top of the screen and routes Cmd+Q, Cmd+C/V and the like through it.
function buildMenu() {
  if (!isMac) return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about', label: 'Over P-ALV Dashboard' },
      { type: 'separator' },
      { role: 'hide', label: 'Verberg P-ALV Dashboard' },
      { role: 'hideOthers', label: 'Verberg andere' },
      { role: 'unhide', label: 'Toon alles' },
      { type: 'separator' },
      { role: 'quit', label: 'Stop P-ALV Dashboard' },
    ] },
    { label: 'Wijzig', submenu: [
      { role: 'undo', label: 'Herstel' },
      { role: 'redo', label: 'Opnieuw' },
      { type: 'separator' },
      { role: 'cut', label: 'Knip' },
      { role: 'copy', label: 'Kopieer' },
      { role: 'paste', label: 'Plak' },
      { role: 'selectAll', label: 'Selecteer alles' },
    ] },
    { label: 'Weergave', submenu: [
      { label: 'Volledig scherm', accelerator: 'Ctrl+Cmd+F', click: () => win && win.setFullScreen(!win.isFullScreen()) },
    ] },
    { label: 'Venster', submenu: [
      { role: 'minimize', label: 'Minimaliseer' },
      { role: 'zoom', label: 'Vergroot/verklein' },
    ] },
  ]));
}

function createWindow() {
  const cfg = config.read();
  // Fullscreen is the standard; configs from the first release are migrated to it by the renderer.
  const startFullscreen = !cfg || (cfg.version || 1) < 2 || !!(cfg.settings && cfg.settings.startFullscreen);

  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1024,
    minHeight: 576,
    frame: false,
    show: false,
    backgroundColor: '#0b1320',
    title: 'P-ALV Dashboard',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    fullscreen: startFullscreen && !shotPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      spellcheck: false,
      // An unattended screen behind another window must keep its live feeds and timers running.
      backgroundThrottling: false,
    },
  });

  buildMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    if (shotPath) {
      win.setContentSize(...shotSize('shot-size', [1920, 1080]));
      win.show();
    } else {
      if (!startFullscreen) win.maximize();
      win.show();
    }
    sendWinState();
  });

  for (const ev of ['maximize', 'unmaximize']) win.on(ev, () => sendWinState());
  // On a frameless window isFullScreen() can still report the old state while these events fire,
  // which left the menu bar hidden after leaving fullscreen. The event itself is the truth;
  // a second reading shortly after settles the maximized state.
  for (const [ev, fullscreen] of [['enter-full-screen', true], ['leave-full-screen', false]]) {
    win.on(ev, () => {
      sendWinState({ fullscreen });
      setTimeout(() => sendWinState(), 400);
    });
  }

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      win.setFullScreen(!win.isFullScreen());
      event.preventDefault();
    } else if ((input.key === 'F12' && input.control && input.shift) || (isMac && input.meta && input.alt && input.code === 'KeyI')) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // The dashboard itself never navigates away or opens windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  win.on('closed', () => {
    win = null;
  });

  if (shotPath) {
    const delay = Number(argValue('shot-delay') || 9000);
    const js = process.env.PALV_SHOT_JS || argValue('shot-js');
    const resize = shotSize('shot-resize', null);
    if (resize) setTimeout(() => win.setContentSize(...resize), delay / 2);
    win.webContents.once('did-finish-load', async () => {
      if (js) {
        try {
          await win.webContents.executeJavaScript(js, true);
        } catch (err) {
          console.error('shot-js failed:', err);
        }
      }
      // Preview profile only: decline the embedded sites' cookie banners so they don't cover the screenshot.
      setTimeout(() => {
        const { webContents } = require('electron');
        for (const wc of webContents.getAllWebContents()) {
          if (wc.getType() !== 'webview') continue;
          for (const frame of wc.mainFrame.framesInSubtree) {
            frame.executeJavaScript("[...document.querySelectorAll('button')].find((b) => /alles afwijzen|reject all/i.test(b.textContent))?.click()").catch(() => {});
          }
        }
      }, Math.max(1000, delay - 7000));
      setTimeout(async () => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shotPath, img.toPNG());
        app.quit();
      }, delay);
    });
  }
}


// Embedded sites (webviews) are sandboxed guests: no node, no popups, no device permissions.
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    params.partition = WEB_PARTITION;
  });
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    watchdog.guardWebview(contents);
  }
});

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  const webSession = session.fromPartition(WEB_PARTITION);
  webSession.setUserAgent(UA);
  webSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));

  // OpenStreetMap asks every application that uses its tiles to identify itself.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://tile.openstreetmap.org/*'] }, (details, cb) => {
    details.requestHeaders['User-Agent'] = `P-ALV-Dashboard/${app.getVersion()} (Electron desktop dashboard)`;
    cb({ requestHeaders: details.requestHeaders });
  });

  watchdog.start();
  createWindow();
  watchdog.attach(win);
  data.start(() => win);
  if (shotPath) return;
  updater.start({ repository: pkg.palv && pkg.palv.updateRepo, onStatus: (s) => send('update:status', s) });
  screens.start({ userData: app.getPath('userData'), status: screenStatus, onUpdate: (list) => send('screens:update', list) });
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => log.info('app', 'afgesloten'));

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

/* ---------- window controls ---------- */
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:toggleMaximize', () => {
  if (!win) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  else if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('win:close', () => win && win.close());
ipcMain.on('win:setFullscreen', (_e, on) => win && win.setFullScreen(!!on));
ipcMain.handle('win:getState', () => ({
  maximized: !!win && win.isMaximized(),
  fullscreen: !!win && win.isFullScreen(),
}));

/* ---------- config ---------- */
ipcMain.handle('config:load', () => {
  const cfg = config.read();
  const restored = config.takeRestored();
  return cfg && restored ? { ...cfg, __restoredFrom: restored } : cfg;
});
ipcMain.handle('config:save', (_e, cfg) => {
  config.write(cfg);
  return true;
});
// Last write on the way out: the renderer's debounced save would not get there in time.
ipcMain.on('config:saveSync', (e, cfg) => {
  try { config.write(cfg); e.returnValue = true; } catch (err) { log.error('config', 'opslaan bij afsluiten mislukt', err); e.returnValue = false; }
});
ipcMain.handle('config:backup', (_e, reason) => config.backup(['import', 'reset', 'restore'].includes(reason) ? reason : 'import'));
ipcMain.handle('config:backups', () => config.list());
ipcMain.handle('config:loadBackup', (_e, name) => config.load(String(name)));
ipcMain.handle('config:openBackups', () => shell.openPath(config.backupDir()));
ipcMain.handle('config:export', async (_e, cfg) => {
  const res = await dialog.showSaveDialog(win, {
    title: 'Dashboard-indeling exporteren',
    defaultPath: 'palv-dashboard-indeling.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (res.canceled || !res.filePath) return false;
  fs.writeFileSync(res.filePath, JSON.stringify(cfg, null, 2), 'utf8');
  return true;
});
ipcMain.handle('config:import', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Dashboard-indeling importeren',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  try {
    return config.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
  } catch {
    return { error: 'Dit bestand is geen leesbare dashboard-indeling.' };
  }
});

/* ---------- app ---------- */
ipcMain.handle('app:setAutoStart', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('app:version', () => app.getVersion());
ipcMain.handle('app:keepAwake', (_e, on) => watchdog.keepAwake(!!on && !shotPath));
ipcMain.handle('app:health', () => ({ ...watchdog.stats, awake: watchdog.awake() }));
ipcMain.handle('app:openLogs', () => shell.openPath(log.dir()));
// Only the status pages of other dashboards: http on a private or Tailscale address.
ipcMain.handle('app:openExternal', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'http:' && screens.isPrivate(u.hostname)) return shell.openExternal(u.toString());
  } catch { /* not a url */ }
  return false;
});
ipcMain.on('log', (_e, level, msg, detail) => {
  const fn = { info: log.info, warn: log.warn, error: log.error }[level] || log.info;
  fn('dashboard', String(msg).slice(0, 500), detail == null ? undefined : String(detail).slice(0, 2000));
});

/* ---------- updates ---------- */
ipcMain.handle('update:status', () => updater.status());
ipcMain.handle('update:check', () => updater.check(true));
ipcMain.handle('update:install', () => updater.install());
ipcMain.handle('update:justUpdated', () => updater.justUpdated());

/* ---------- status for the screens overview ---------- */
let rendererInfo = {};
ipcMain.on('status:heartbeat', () => watchdog.heartbeat());
ipcMain.on('status:report', (_e, info) => { rendererInfo = info && typeof info === 'object' ? info : {}; });

function screenStatus() {
  const st = watchdog.stats;
  const displays = screen.getAllDisplays();
  const u = updater.status();
  return {
    version: app.getVersion(),
    hostname: os.hostname(),
    platform: isMac ? `macOS ${process.getSystemVersion()}` : `Windows ${process.getSystemVersion()}`,
    arch: process.arch,
    now: Date.now(),
    startedAt: st.startedAt,
    window: win && !win.isDestroyed() ? { visible: win.isVisible(), minimized: win.isMinimized(), fullscreen: win.isFullScreen(), focused: win.isFocused() } : null,
    displays: displays.length,
    displayList: displays.map((d) => `${d.size.width}×${d.size.height}${d.internal ? ' intern' : ''}`),
    renderer: { heartbeat: st.heartbeat, alive: !!st.heartbeat && Date.now() - st.heartbeat < 20000, reloads: st.reloads, crashes: st.crashes, webviewCrashes: st.webviewCrashes },
    awake: watchdog.awake(),
    locked: st.locked,
    idleSeconds: powerMonitor.getSystemIdleTime(),
    page: rendererInfo.page || null,
    health: Array.isArray(rendererInfo.health) ? rendererInfo.health.slice(0, 10) : [],
    emergencies: Array.isArray(rendererInfo.emergencies) ? rendererInfo.emergencies.slice(0, 5) : [],
    update: { state: u.state, latest: u.latest },
  };
}
ipcMain.handle('screens:info', () => ({ name: screens.name(), port: screens.port(), addresses: screens.addresses(), list: screens.list() }));
ipcMain.handle('screens:add', (_e, address) => screens.add(address));
ipcMain.handle('screens:remove', (_e, id) => screens.remove(String(id)));
ipcMain.handle('screens:rename', (_e, name) => screens.rename(name));
