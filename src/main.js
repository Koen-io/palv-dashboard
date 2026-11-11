const { app, BrowserWindow, ipcMain, shell, dialog, session, Menu, screen, powerMonitor, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('./main/log');
const config = require('./main/config');
const watchdog = require('./main/watchdog');
const updater = require('./main/updater');
const screens = require('./main/screens');
const data = require('./main/data');
const share = require('./share');
const traffic = require('./traffic');
const plan = require('./main/plan');
const ais = require('./ais');
const offshore = require('./offshore');
const docs = require('./main/docs');
const privBrowser = require('./main/privbrowser');
const screenlock = require('./main/screenlock');
require('./main/tiles');

const { BROWSER: UA, APP: APP_UA } = require('./ua');
const WEB_PARTITION = 'persist:palv-web';
// The Browser widget (MadeSmart and other secure web environments): its own session, apart from the
// embedded sites, so its sign-in and cookies are never shared with them.
const BROWSER_PARTITION = 'persist:palv-browser';
const isMac = process.platform === 'darwin';
const pkg = require('../package.json');
// Where the updates come from; also when a build left it out of its package.json.
const UPDATE_REPO = (pkg.palv && pkg.palv.updateRepo) || 'Koen-io/palv-dashboard';

// The Mac build is not signed with a developer certificate; without this macOS asks for the login
// keychain password every time the app has been replaced by a newer version.
if (isMac) app.commandLine.appendSwitch('use-mock-keychain');
// The map tiles of Zoek & Plan come through a scheme of their own, which must be known before the app is ready.
plan.registerScheme();
// What the window itself sends (map tiles, radar images) goes as the Chrome it is: Electron adds the name
// and version of the dashboard and its own version, which are taken out.
{
  const platform = (/\(([^)]+)\)/.exec(app.userAgentFallback) || [])[1];
  app.userAgentFallback = platform ? `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36` : UA;
}

let win = null;
let quitting = false;

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
    fullscreen: isFull(),
    ...known,
  });
}

/* ---------- fullscreen ---------- */
// macOS's own fullscreen keeps the system menu bar, which slides down over the dashboard's title bar as soon
// as the mouse comes near the top of the screen. On a Mac the window therefore covers the whole screen
// itself, above the menu bar and the Dock, as a presentation does. Only while the dashboard is the active
// app: when another app (or a dialog) comes forward the window steps back to the normal level, and it
// covers everything again when it is clicked. Windows keeps its own fullscreen.
let macFull = false, macBefore = null;
const isFull = () => !!win && !win.isDestroyed() && (isMac ? macFull : win.isFullScreen());

function macCover() {
  if (!macFull || !win || win.isDestroyed()) return;
  const d = screen.getDisplayMatching(win.getBounds());
  win.setBounds(d.bounds);
  if (win.isFocused()) win.setAlwaysOnTop(true, 'status');
}

function setFull(on) {
  if (!win || win.isDestroyed()) return;
  if (!isMac) { win.setFullScreen(on); return; }
  if (on === macFull) return;
  if (on) {
    if (win.isFullScreen()) win.setFullScreen(false);
    macBefore = { bounds: win.getBounds(), maximized: win.isMaximized() };
    macFull = true;
    macCover();
    log.info('app', 'volledig scherm (over de menubalk heen)');
  } else {
    macFull = false;
    win.setAlwaysOnTop(false);
    if (macBefore && !macBefore.maximized) win.setBounds(macBefore.bounds);
    else win.maximize();
  }
  sendWinState({ fullscreen: on });
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
      { label: 'Volledig scherm', accelerator: 'Ctrl+Cmd+F', click: () => setFull(!isFull()) },
    ] },
    { label: 'Venster', submenu: [
      { role: 'minimize', label: 'Minimaliseer' },
      { role: 'zoom', label: 'Vergroot/verklein' },
    ] },
  ]));
}

// Het dashboard onthoudt op welk scherm het staat en komt daar na een herstart, update of herinstallatie
// vanzelf weer terug. De schermen worden van links naar rechts genummerd; het nummer staat in
// window-display.json in de userData (los van de dashboard-indeling, blijft dus bij een herinstallatie staan)
// en wordt bijgewerkt zodra het venster naar een ander scherm wordt verplaatst. Alleen bij meer dan één scherm.
const winPosFile = () => path.join(app.getPath('userData'), 'window-display.json');
const displaysLR = () => screen.getAllDisplays().slice().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
function savedDisplay() {
  if (shotPath) return null;
  try {
    const d = JSON.parse(fs.readFileSync(winPosFile(), 'utf8'));
    const list = displaysLR();
    if (Number.isInteger(d.index) && list.length > 1 && d.index >= 0 && d.index < list.length) return list[d.index];
  } catch { /* nog niet bewaard */ }
  return null;
}
let saveIdxTimer = null;
function saveDisplayIndex() {
  clearTimeout(saveIdxTimer);
  saveIdxTimer = setTimeout(() => {
    if (!win || win.isDestroyed() || screen.getAllDisplays().length < 2) return;
    try {
      const d = screen.getDisplayMatching(win.getBounds());
      const i = displaysLR().findIndex((x) => x.id === d.id);
      if (i >= 0) fs.writeFileSync(winPosFile(), JSON.stringify({ index: i }));
    } catch { /* schrijven mislukte: de volgende verplaatsing probeert het opnieuw */ }
  }, 600);
}

function createWindow() {
  const cfg = config.read();
  // Fullscreen is the standard; configs from the first release are migrated to it by the renderer.
  const startFullscreen = !cfg || (cfg.version || 1) < 2 || !!(cfg.settings && cfg.settings.startFullscreen);
  // Het onthouden scherm: als het er is, wordt het venster daar neergezet (en daarna pas volledig scherm).
  const target = savedDisplay();

  win = new BrowserWindow({
    x: target ? target.bounds.x : undefined,
    y: target ? target.bounds.y : undefined,
    width: target ? Math.min(1600, target.bounds.width) : 1600,
    height: target ? Math.min(900, target.bounds.height) : 900,
    minWidth: 1024,
    minHeight: 576,
    frame: false,
    show: false,
    backgroundColor: '#0b1320',
    title: 'P-ALV Dashboard',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // Bij een onthouden scherm eerst daar neerzetten en pas na het tonen volledig scherm maken, zodat het
    // op dat scherm blijft; anders meteen volledig scherm (de bestaande werkwijze).
    fullscreen: !target && startFullscreen && !shotPath && !isMac,
    // macOS: the window may cover the menu bar in fullscreen (setFull).
    enableLargerThanScreen: isMac,
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
    } else if (target) {
      // Op het onthouden scherm neerzetten en daar pas volledig scherm maken, zodat het op dat scherm blijft.
      win.setBounds(target.bounds);
      if (!startFullscreen) win.maximize();
      win.show();
      if (startFullscreen) { if (isMac) setFull(true); else win.setFullScreen(true); }
    } else {
      if (!startFullscreen) win.maximize();
      win.show();
      if (startFullscreen && isMac) setFull(true);
    }
    sendWinState();
  });
  // Onthouden op welk scherm het dashboard staat zodra het wordt verplaatst (ook tussen schermen bij volledig scherm).
  win.on('move', saveDisplayIndex);
  win.on('enter-full-screen', saveDisplayIndex);

  for (const ev of ['maximize', 'unmaximize']) win.on(ev, () => sendWinState());
  if (isMac) {
    // Covering the menu bar only while the dashboard is the active app (setFull).
    win.on('focus', () => { if (macFull) win.setAlwaysOnTop(true, 'status'); });
    win.on('blur', () => { if (macFull) win.setAlwaysOnTop(false); });
    screen.on('display-metrics-changed', macCover);
    screen.on('display-added', macCover);
    screen.on('display-removed', macCover);
  }
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
      setFull(!isFull());
      event.preventDefault();
    } else if ((input.key === 'F12' && input.control && input.shift) || (isMac && input.meta && input.alt && input.code === 'KeyI')) {
      win.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // The dashboard itself never navigates away or opens windows.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Zolang het Schermslot aan staat, moet het dashboard op het tweede scherm zichtbaar blijven: het venster
  // mag dan niet dicht (ook niet met Alt+F4), want dat zou het slot wegnemen.
  win.on('close', (e) => { if (!quitting && screenlock.isLocked()) e.preventDefault(); });

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
    // The private Browser tab (Windows, src/main/privbrowser.js): its own private session in memory, sandboxed, with the PDF viewer.
    if (process.platform === 'win32' && /^palv-priv-(tor|direct)-\d+$/.test(params.partition || '')) {
      privBrowser.sessionFor(params.partition);
      Object.assign(webPreferences, { sandbox: true, nodeIntegrationInSubFrames: false, spellcheck: false, plugins: true, webSecurity: true, allowRunningInsecureContent: false, navigateOnDragDrop: false, safeDialogs: true });
      return;
    }
    params.partition = params.partition === BROWSER_PARTITION ? BROWSER_PARTITION : WEB_PARTITION;
  });
  // Dempen: a page embedded later stays silent too.
  if (muted) contents.setAudioMuted(true);
  if (privBrowser.owns(contents)) {
    privBrowser.adopt(contents);
    if (contents.getType() === 'webview') watchdog.guardWebview(contents);
  } else if (contents.getType() === 'webview' || contents.getType() === 'window') {
    // The Browser: a site may open its own windows (a document, a report, a sign-in) in the same
    // session; everything else embedded opens nothing.
    if (browserSession && contents.session === browserSession) browserContents(contents);
    else if (contents.getType() === 'webview') contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    if (contents.getType() === 'webview') watchdog.guardWebview(contents);
  }
});

/* ---------- the Browser widget ---------- */
let browserSession = null;
const browserDownloads = new Set();
function browserContents(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (!/^(https?:|blob:|about:blank)/i.test(url)) return { action: 'deny' };
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        width: 1200, height: 860, parent: win || undefined, autoHideMenuBar: true, backgroundColor: '#ffffff',
        icon: path.join(__dirname, '..', 'build', 'icon.png'),
        webPreferences: { partition: BROWSER_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
      },
    };
  });
  // Right-click: the usual browser menu (copy, paste, links), in Dutch.
  contents.on('context-menu', (_e, p) => {
    const items = [];
    if (p.linkURL && /^https?:/i.test(p.linkURL)) items.push({ label: 'Link kopiëren', click: () => require('electron').clipboard.writeText(p.linkURL) }, { type: 'separator' });
    if (p.isEditable) items.push({ label: 'Knippen', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Kopiëren', role: 'copy', enabled: p.editFlags.canCopy }, { label: 'Plakken', role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: 'Alles selecteren', role: 'selectAll' });
    else if (p.selectionText) items.push({ label: 'Kopiëren', role: 'copy' });
    if (!p.isEditable) {
      if (items.length) items.push({ type: 'separator' });
      const nav = contents.navigationHistory;
      items.push(
        { label: 'Terug', enabled: nav ? nav.canGoBack() : contents.canGoBack(), click: () => (nav ? nav.goBack() : contents.goBack()) },
        { label: 'Vooruit', enabled: nav ? nav.canGoForward() : contents.canGoForward(), click: () => (nav ? nav.goForward() : contents.goForward()) },
        { label: 'Vernieuwen', click: () => contents.reload() },
      );
      if (p.mediaType === 'image' && p.srcURL) items.push({ type: 'separator' }, { label: 'Afbeelding kopiëren', click: () => contents.copyImageAt(p.x, p.y) });
    }
    Menu.buildFromTemplate(items).popup();
  });
}
function setupBrowserSession() {
  browserSession = session.fromPartition(BROWSER_PARTITION);
  browserSession.setUserAgent(UA);
  browserSession.setSpellCheckerEnabled(false);
  // Copying from the site and full screen (a map, a video); no camera, microphone, location or notifications.
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'clipboard-read']);
  browserSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  browserSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  // Downloads go straight to the Downloads folder (never a dialog behind a full-screen dashboard).
  browserSession.on('will-download', (_e, item) => {
    const dir = app.getPath('downloads');
    const base = [...(item.getFilename() || 'download')].map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? '_' : c)).join('');
    const ext = path.extname(base), stem = path.basename(base, ext);
    let file = path.join(dir, base);
    for (let n = 1; fs.existsSync(file); n += 1) file = path.join(dir, `${stem} (${n})${ext}`);
    item.setSavePath(file);
    send('browser:download', { name: path.basename(file), state: 'started' });
    item.once('done', (_ev, state) => {
      if (state === 'completed') browserDownloads.add(file);
      log[state === 'completed' ? 'info' : 'warn']('browser', `download ${state === 'completed' ? 'opgeslagen' : state}: ${path.basename(file)}`);
      send('browser:download', { name: path.basename(file), path: state === 'completed' ? file : null, state });
    });
  });
}
// Only files this browser downloaded itself are shown.
ipcMain.handle('browser:showDownload', (_e, file) => { if (browserDownloads.has(file)) shell.showItemInFolder(file); });

app.on('second-instance', (_e, argv) => {
  // De snelkoppeling "Lock PC" op het bureaublad start de app met --lock-screen; de draaiende app vangt dat
  // hier op en zet het Schermslot aan (in plaats van het dashboard naar voren te halen).
  if (Array.isArray(argv) && argv.includes('--lock-screen')) { screenlock.lock(); return; }
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  const webSession = session.fromPartition(WEB_PARTITION);
  webSession.setUserAgent(UA);
  webSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'fullscreen'));
  setupBrowserSession();

  // OpenStreetMap asks programs that use its tiles to say they are one (not a browser): the neutral name
  // of ua.js, which does not tell who is asking.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: ['https://tile.openstreetmap.org/*'] }, (details, cb) => {
    details.requestHeaders['User-Agent'] = APP_UA;
    cb({ requestHeaders: details.requestHeaders });
  });

  watchdog.start();
  privBrowser.start({ getWin: () => win });
  createWindow();
  watchdog.attach(win);
  data.start(() => win);
  const planOut = plan.start({ screens, share, getWin: () => win, test: !!shotPath });
  const planStore = require('./plan/store');
  const lg = { info: (s, m) => log.info(s, m), warn: (s, m) => log.warn(s, m) };
  screenlock.init({ dir: app.getPath('userData'), getWin: () => win, log: { info: (s, m) => log.info(s, m), warn: (s, m) => log.warn(s, m) } });
  screenlock.register();
  const aisOut = ais.start({ dir: app.getPath('userData'), screens, share, store: planStore, peerGet: plan.peerGet, request: screens.request, log: lg });
  offshore.start({ dir: app.getPath('userData'), fetchText: plan.fetchText, log: lg, ais, store: planStore, poke: plan.pokePeers });
  docs.start({ store: planStore, getWin: () => win, poke: plan.pokePeers });
  // Screenshots leave updates and the screens overview out, unless asked for (--shot-full).
  if (shotPath && !process.argv.includes('--shot-full')) return;
  if (!shotPath) updater.start({ repository: UPDATE_REPO, onStatus: (s) => send('update:status', s) });
  screens.start({ userData: app.getPath('userData'), status: screenStatus, onUpdate: (list) => send('screens:update', list), test: !!shotPath, share, routes: { ...planOut.routes, ...aisOut.routes } });
  // A test window never fetches for others nor follows them: it keeps to itself.
  share.start({
    traffic, peers: screens.peers, disabled: !!shotPath, request: screens.request,
    self: () => ({ id: screens.id(), name: screens.name(), port: screens.port() }),
    log: { info: (s, m) => log.info(s, m), warn: (s, m) => log.warn(s, m) },
  });
});

app.on('window-all-closed', () => app.quit());
// Bij een echte afsluiting (ook een update-herstart) mag het dashboardvenster wél dicht, ook als het
// Schermslot nog aan stond: `quitting` zet de blokkade in de close-handler opzij.
app.on('before-quit', () => { quitting = true; ais.stop(); log.info('app', 'afgesloten'); });

const send = (channel, payload) => { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); };

/* ---------- window controls ---------- */
ipcMain.on('win:minimize', () => { if (win && !screenlock.isLocked()) win.minimize(); });
ipcMain.on('win:toggleMaximize', () => {
  if (!win) return;
  if (isFull()) setFull(false);
  else if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on('win:close', () => { if (win && !screenlock.isLocked()) win.close(); });
ipcMain.on('win:setFullscreen', (_e, on) => setFull(!!on));
ipcMain.handle('win:getState', () => ({
  maximized: !!win && win.isMaximized(),
  fullscreen: isFull(),
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

/* ---------- briefing sound ---------- */
// The sound before a briefing: briefing-geluid.<ext> in the user data of this screen, chosen in the
// settings or put there by hand. It is never part of the app or the repository.
const SOUND_TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac' };
const SOUND_MAX = 8 * 1024 * 1024;
const soundFile = () => Object.keys(SOUND_TYPES).map((ext) => path.join(app.getPath('userData'), 'briefing-geluid.' + ext)).find((f) => fs.existsSync(f)) || null;
const soundInfo = () => { const f = soundFile(); return f ? { name: path.basename(f), size: fs.statSync(f).size } : null; };
ipcMain.handle('briefing:sound', () => {
  const f = soundFile();
  if (!f || fs.statSync(f).size > SOUND_MAX) return null;
  return `data:${SOUND_TYPES[path.extname(f).slice(1).toLowerCase()]};base64,${fs.readFileSync(f).toString('base64')}`;
});
ipcMain.handle('briefing:soundInfo', () => soundInfo());
ipcMain.handle('briefing:chooseSound', async () => {
  const res = await dialog.showOpenDialog(win, { title: 'Geluid voor de briefings kiezen', filters: [{ name: 'Geluid', extensions: Object.keys(SOUND_TYPES) }], properties: ['openFile'] });
  if (res.canceled || !res.filePaths[0]) return soundInfo();
  const src = res.filePaths[0], ext = path.extname(src).slice(1).toLowerCase();
  if (!SOUND_TYPES[ext]) return { error: 'Kies een mp3-, wav-, ogg-, m4a- of aac-bestand.' };
  if (fs.statSync(src).size > SOUND_MAX) return { error: 'Dit bestand is groter dan 8 MB.' };
  for (const e of Object.keys(SOUND_TYPES)) fs.rmSync(path.join(app.getPath('userData'), 'briefing-geluid.' + e), { force: true });
  fs.copyFileSync(src, path.join(app.getPath('userData'), 'briefing-geluid.' + ext));
  log.info('app', `briefinggeluid gekozen: ${path.basename(src)}`);
  return soundInfo();
});
ipcMain.handle('briefing:clearSound', () => {
  for (const e of Object.keys(SOUND_TYPES)) fs.rmSync(path.join(app.getPath('userData'), 'briefing-geluid.' + e), { force: true });
  return null;
});

/* ---------- app ---------- */
ipcMain.handle('app:setAutoStart', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('app:version', () => app.getVersion());

// The lock in the title bar: Windows locks the workstation (as Windows+L), after which the sign-in
// screen asks for the password or PIN. Confirmed by Windows itself (the lock-screen event); without
// it the answer is false and the dashboard says so. Not on the Mac, where the button is not shown.
ipcMain.handle('app:lockScreen', () => new Promise((resolve) => {
  if (process.platform !== 'win32') return resolve({ ok: false, reason: 'unsupported' });
  let done = false;
  const finish = (ok, reason) => {
    if (done) return;
    done = true;
    powerMonitor.removeListener('lock-screen', onLock);
    clearTimeout(timer);
    log[ok ? 'info' : 'warn']('app', ok ? 'pc vergrendeld vanaf het dashboard' : `vergrendelen mislukt: ${reason}`);
    resolve({ ok, reason });
  };
  const onLock = () => finish(true);
  powerMonitor.on('lock-screen', onLock);
  const timer = setTimeout(() => finish(false, 'Windows meldde geen vergrendeling'), 5000);
  const rundll = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe');
  require('child_process').execFile(rundll, ['user32.dll,LockWorkStation'], { windowsHide: true, timeout: 5000 }, (err) => { if (err) finish(false, err.message); });
}));
ipcMain.handle('app:keepAwake', (_e, on) => watchdog.keepAwake(!!on && !shotPath));
ipcMain.handle('app:health', () => ({ ...watchdog.stats, awake: watchdog.awake() }));
ipcMain.handle('app:openLogs', () => shell.openPath(log.dir()));
// Dempen in the menu bar: the dashboard itself and every embedded page, at once and for pages opened later.
let muted = false;
ipcMain.handle('app:setMuted', (_e, on) => {
  muted = !!on;
  for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.setAudioMuted(muted);
  return muted;
});
// The on-screen keyboard types as a real keyboard would: into the dashboard itself, or into the embedded
// page that has the focus. Only into the window that asks, or one of its own webviews.
ipcMain.on('osk:key', (e, guestId, events) => {
  let target = e.sender;
  if (guestId) {
    const wc = webContents.fromId(guestId);
    if (!wc || wc.isDestroyed() || wc.getType() !== 'webview' || wc.hostWebContents !== e.sender) return;
    target = wc;
  }
  if (!Array.isArray(events)) return;
  for (const ev of events.slice(0, 8)) {
    if (!ev || !['keyDown', 'char', 'keyUp'].includes(ev.type) || typeof ev.keyCode !== 'string' || ev.keyCode.length > 12) continue;
    target.sendInputEvent({ type: ev.type, keyCode: ev.keyCode, modifiers: ev.shift ? ['shift'] : [] });
  }
});
// The nightly fresh start. Done from here: location.reload() in the page counts as navigating away,
// which will-navigate blocks for the dashboard window.
ipcMain.handle('app:reload', (e) => { setTimeout(() => { if (!e.sender.isDestroyed()) e.sender.reloadIgnoringCache(); }, 200); });
// Only the status pages of other dashboards (http on a private or Tailscale address) and the official
// AIP of LVNL (Zoek & Plan), in the browser.
ipcMain.handle('app:openExternal', (_e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'http:' && screens.isPrivate(u.hostname)) return shell.openExternal(u.toString());
    if (u.protocol === 'https:' && /^(eaip\.lvnl\.nl|www\.lvnl\.nl)$/.test(u.hostname)) return shell.openExternal(u.toString()).then(() => true);
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

// The name the computer goes by: on a Mac its own name (os.hostname() there can be a provider's
// network name), elsewhere the host name.
let compName = null;
function computerName() {
  if (compName) return compName;
  compName = os.hostname();
  if (isMac) { try { compName = require('child_process').execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 3000 }).trim() || compName; } catch { /* keep the host name */ } }
  return compName;
}

function screenStatus() {
  const st = watchdog.stats;
  const displays = screen.getAllDisplays();
  const u = updater.status();
  return {
    version: app.getVersion(),
    hostname: computerName(),
    platform: isMac ? `macOS ${process.getSystemVersion()}` : `Windows ${process.getSystemVersion()}`,
    arch: process.arch,
    now: Date.now(),
    startedAt: st.startedAt,
    window: win && !win.isDestroyed() ? { visible: win.isVisible(), minimized: win.isMinimized(), fullscreen: isFull(), focused: win.isFocused() } : null,
    displays: displays.length,
    displayList: displays.map((d) => `${d.size.width}×${d.size.height}${d.internal ? ' intern' : ''}`),
    // De schermen van links naar rechts, met welke het primaire is en op welke het dashboard staat — om de
    // indeling en de plek van het dashboard te kunnen nalezen (bijvoorbeeld voor het Schermslot).
    screenLayout: (() => {
      const prim = screen.getPrimaryDisplay().id;
      const wb = win && !win.isDestroyed() ? win.getBounds() : null;
      const dashId = wb ? screen.getDisplayMatching(wb).id : null;
      return displaysLR().map((d, i) => ({ i, size: `${d.size.width}x${d.size.height}`, pos: `${d.bounds.x},${d.bounds.y}`, scale: d.scaleFactor, primary: d.id === prim, internal: !!d.internal, dashboard: d.id === dashId }));
    })(),
    renderer: { heartbeat: st.heartbeat, alive: !!st.heartbeat && Date.now() - st.heartbeat < 20000, reloads: st.reloads, crashes: st.crashes, webviewCrashes: st.webviewCrashes },
    awake: watchdog.awake(),
    locked: st.locked,
    idleSeconds: powerMonitor.getSystemIdleTime(),
    page: rendererInfo.page || null,
    health: Array.isArray(rendererInfo.health) ? rendererInfo.health.slice(0, 10) : [],
    emergencies: Array.isArray(rendererInfo.emergencies) ? rendererInfo.emergencies.slice(0, 5) : [],
    update: { state: u.state, latest: u.latest },
    // Who fetches the live traffic, and who receives it from whom (share.js).
    share: share.info(),
    // Fingerprints of the Zoek & Plan files, so the screens only fetch them from each other on a change.
    plan: plan.status(),
    // Ships: whether this screen keeps the AIS stream open, so the other screens can take them from it.
    ais: ais.status(),
  };
}
ipcMain.handle('screens:info', () => ({ name: screens.name(), port: screens.port(), addresses: screens.addresses(), list: screens.list() }));
ipcMain.handle('screens:add', (_e, address) => screens.add(address));
ipcMain.handle('screens:remove', (_e, id) => screens.remove(String(id)));
ipcMain.handle('screens:rename', (_e, name) => screens.rename(name));
ipcMain.handle('screens:pairCode', () => screens.pairCode());
ipcMain.handle('screens:pair', (_e, code) => screens.pair(String(code || '')));
