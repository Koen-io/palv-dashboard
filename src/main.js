const { app, BrowserWindow, ipcMain, shell, dialog, session, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const runways = require('./runways');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const APP_UA = 'P-ALV-Dashboard/1.0 (desktop dashboard)';
const WEB_PARTITION = 'persist:palv-web';

let win = null;
const configPath = () => path.join(app.getPath('userData'), 'config.json');

// Dev helper: `electron . --shot=out.png [--shot-delay=8000] [--shot-js="..."] [--shot-size=1920x1080] [--shot-resize=1100x640]`
// renders a screenshot and quits; --shot-resize changes the window size halfway, to check that the layout follows.
const argValue = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const shotPath = argValue('shot');
const shotSize = (name, fallback) => { const m = /^(\d+)x(\d+)$/.exec(argValue(name) || ''); return m ? [+m[1], +m[2]] : fallback; };

if (!shotPath && !app.requestSingleInstanceLock()) {
  app.quit();
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return null;
  }
}

function writeConfig(cfg) {
  const file = configPath();
  const tmp = file + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function sendWinState(known = {}) {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('win:state', {
    maximized: win.isMaximized(),
    fullscreen: win.isFullScreen(),
    ...known,
  });
}

function createWindow() {
  const cfg = readConfig();
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
    },
  });

  Menu.setApplicationMenu(null);
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
    } else if (input.key === 'F12' && input.control && input.shift) {
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

  createWindow();
});

app.on('window-all-closed', () => app.quit());

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
ipcMain.handle('config:load', () => readConfig());
ipcMain.handle('config:save', (_e, cfg) => {
  writeConfig(cfg);
  return true;
});
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
    return JSON.parse(fs.readFileSync(res.filePaths[0], 'utf8'));
  } catch {
    return { error: 'Dit bestand kon niet worden gelezen.' };
  }
});
ipcMain.handle('app:setAutoStart', (_e, on) => {
  app.setLoginItemSettings({ openAtLogin: !!on });
  return app.getLoginItemSettings().openAtLogin;
});
ipcMain.handle('app:version', () => app.getVersion());

/* ---------- app tiles ---------- */
async function fileIcon(file) {
  try {
    const img = await app.getFileIcon(file, { size: 'large' });
    return img.isEmpty() ? null : img.toDataURL();
  } catch {
    return null;
  }
}

ipcMain.handle('tile:pickFile', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Kies een programma of bestand',
    properties: ['openFile'],
    filters: [
      { name: 'Programma\'s en snelkoppelingen', extensions: ['exe', 'lnk', 'bat', 'cmd', 'url'] },
      { name: 'Alle bestanden', extensions: ['*'] },
    ],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  return { path: file, name: path.basename(file, path.extname(file)), icon: await fileIcon(file) };
});

// Icon for a tile: the program's own icon, or the site's favicon for web tiles.
ipcMain.handle('tile:icon', async (_e, tile) => {
  if (!tile || !tile.target) return null;
  try {
    if (tile.kind === 'url') {
      const url = new URL(/^[a-z]+:\/\//i.test(tile.target) ? tile.target : 'https://' + tile.target);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const res = await fetch(url.origin + '/favicon.ico', { headers: { 'User-Agent': UA }, signal: ctl.signal });
        const type = (res.headers.get('content-type') || '').split(';')[0];
        if (!res.ok || !/^image\//.test(type)) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        if (!buf.length || buf.length > 300000) return null;
        return `data:${type};base64,${buf.toString('base64')}`;
      } finally {
        clearTimeout(timer);
      }
    }
    let file = tile.target.trim();
    if (!/[\\/]/.test(file)) {
      const winDir = process.env.WINDIR || 'C:\\Windows';
      file = [path.join(winDir, 'System32', file), path.join(winDir, file)].find((p) => fs.existsSync(p)) || file;
    }
    return fs.existsSync(file) ? await fileIcon(file) : null;
  } catch {
    return null;
  }
});

ipcMain.handle('tile:launch', async (_e, tile) => {
  if (!tile || !tile.target) return { ok: false, error: 'Geen doel ingesteld.' };
  if (tile.kind === 'url') {
    let url;
    try {
      url = new URL(/^[a-z]+:\/\//i.test(tile.target) ? tile.target : 'https://' + tile.target);
    } catch {
      return { ok: false, error: 'Ongeldig webadres.' };
    }
    if (!['http:', 'https:'].includes(url.protocol)) return { ok: false, error: 'Alleen http(s)-adressen zijn toegestaan.' };
    await shell.openExternal(url.toString());
    return { ok: true };
  }
  const target = tile.target.trim();
  if (tile.args && tile.args.trim()) {
    try {
      const child = spawn(`"${target}" ${tile.args}`, { shell: true, detached: true, stdio: 'ignore', windowsHide: false });
      child.on('error', () => {});
      child.unref();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }
  // Bare command names (calc.exe, explorer.exe) resolve through PATH; full paths open with their default handler.
  if (!/[\\/]/.test(target)) {
    const child = spawn(target, { shell: true, detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return { ok: true };
  }
  const err = await shell.openPath(target);
  return err ? { ok: false, error: err } : { ok: true };
});

/* ---------- aviation data ---------- */
async function fetchText(url, timeoutMs = 20000, ua = UA) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': ua, 'Cache-Control': 'no-cache' }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

ipcMain.handle('data:metar', async (_e, icao) => {
  const id = String(icao || 'EHAM').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  try {
    const text = await fetchText(`https://aviationweather.gov/api/data/metar?ids=${id}&format=json&taf=true`);
    const list = text.trim() ? JSON.parse(text) : [];
    if (!list.length) return { ok: false, error: `Geen METAR beschikbaar voor ${id}` };
    const m = list[0];
    return {
      ok: true,
      icao: m.icaoId,
      name: m.name,
      raw: m.rawOb,
      taf: m.rawTaf || null,
      obsTime: m.obsTime ? m.obsTime * 1000 : null,
      fltCat: m.fltCat || null,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

// Every METAR and TAF in and around the Netherlands in one go, for the station layer on the weather
// radar. The source refreshes once a minute; all widgets share one answer in between.
const WX_BBOX = '50.6,3.0,53.8,7.4';
let wxCache = null, wxPending = null;
async function loadWxMap() {
  const list = async (path) => { const text = await fetchText(`https://aviationweather.gov/api/data/${path}&bbox=${WX_BBOX}&format=json`); return text.trim() ? JSON.parse(text) : []; };
  const [metars, tafs] = await Promise.all([list('metar?hours=2'), list('taf?').catch(() => null)]);
  if (!metars.length) throw new Error('Geen METAR-gegevens ontvangen');
  return {
    ok: true,
    metars: metars.filter((m) => m.rawOb && m.obsTime && m.lat != null).map((m) => ({ icao: m.icaoId, name: m.name, lat: m.lat, lon: m.lon, raw: m.rawOb, obsTime: m.obsTime * 1000 })),
    tafs: (tafs || []).filter((t) => t.rawTAF).map((t) => ({ icao: t.icaoId, raw: t.rawTAF })),
    tafOk: !!tafs,
    fetchedAt: Date.now(),
  };
}
ipcMain.handle('data:wxmap', async () => {
  if (wxCache && Date.now() - wxCache.fetchedAt < 45000) return wxCache;
  if (!wxPending) {
    wxPending = loadWxMap()
      .then((res) => (wxCache = res))
      .catch((err) => ({ ok: false, error: String(err.message || err) }))
      .finally(() => { wxPending = null; });
  }
  return wxPending;
});

// Runways actually in use, observed from live ADS-B traffic around the field.
ipcMain.handle('data:runways', () => {
  runways.start(async (url) => JSON.parse(await fetchText(url, 8000, APP_UA)));
  return runways.snapshot();
});
