// The Browser tab (Windows): a private browser in the dashboard, built on the Chromium of the dashboard
// itself, with the protection of Mullvad Browser and Brave where Chromium allows it:
//
// - Tor for all traffic of the tab (standard), or Direct; with Tor there is no way past it: when Tor is not
//   there, nothing loads (kill switch). DNS goes through Tor as well.
// - Nothing is kept: the session lives in memory only; a new identity (or another connection) starts a
//   fresh one and wipes the old, and Tor takes new routes.
// - Trackers, ads and cookie walls blocked with the filter lists of uBlock Origin and EasyList (Ghostery's
//   engine); cookies of other sites never sent or stored; https only.
// - Fingerprinting: fixed common values and a little noise per site (browser-guard.js), UTC and en-US
//   as in Mullvad Browser, letterboxing (in the tab), WebRTC never past the proxy.
// - No camera, microphone, location, notifications, USB or Bluetooth; never this computer or the local
//   network; no spell checking (that would load dictionaries from Google).
//
// Per site the shield can be lowered (blocking and noise off) for a page that does not work; only for
// this session, nothing is written down.
const { app, session, ipcMain, webContents, Menu, clipboard, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const log = require('./log');
const tor = require('./tor');
const core = require('../privbrowser-core');
const { BROWSER } = require('../ua');
// The same Chrome on Windows as everywhere, with the version of the engine itself (as Chrome reports it:
// only the major number), so the name and what the page can see of the engine never disagree.
const UA = BROWSER.replace(/Chrome\/[\d.]+/,`Chrome/${String(process.versions.chrome || '').split('.')[0] || '140'}.0.0.0`);

const PREFIX = 'palv-priv-';
const DEAD_PROXY = 'socks5://127.0.0.1:9'; // nothing listens there: the kill switch while Tor is not up

let getWin = () => null;
let tldts = null;
let blocker = null;
let blockerPreload = null;
const st = {
  mode: 'tor', // 'tor' | 'direct'
  gen: 1,
  seed: crypto.randomBytes(4).readUInt32LE(0),
  shieldOff: new Set(), // sites (eTLD+1) with the shield down, this session only
  httpOk: new Set(), // hosts that may be opened over plain http, this session only
  blocked: new Map(), // webContents id -> number of blocked requests on the current page
  configured: new WeakSet(),
};

const partition = () => `${PREFIX}${st.mode}-${st.gen}`;
const isBrowserSession = (ses) => !!ses && ses.__palvPriv === true;
const siteOf = (url) => {
  try {
    const u = new URL(url);
    return (tldts && tldts.getDomain(u.hostname)) || u.hostname;
  } catch { return ''; }
};
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
const send = (channel, data) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(channel, data); };
const shieldOn = (topUrl) => !st.shieldOff.has(siteOf(topUrl));

function statusOut() {
  return { mode: st.mode, partition: partition(), tor: tor.status(), torAvailable: tor.available(), blocker: !!blocker };
}
function pushStatus() { send('privbrowser:status', statusOut()); }

/* ---------- the session ---------- */
function proxyFor(mode) {
  if (mode === 'direct') return { mode: 'direct' };
  const port = tor.status().state === 'ready' ? tor.status().socksPort : 0;
  // <-loopback>: also this computer's own addresses go to the proxy, never past it.
  return { mode: 'fixed_servers', proxyRules: port ? `socks5://127.0.0.1:${port}` : DEAD_PROXY, proxyBypassRules: '<-loopback>' };
}

function topUrlOf(details) {
  if (details.resourceType === 'mainFrame') return details.url;
  const wc = details.webContents;
  try { return wc && !wc.isDestroyed() ? wc.getURL() : ''; } catch { return ''; }
}
const isThirdParty = (details) => {
  if (details.resourceType === 'mainFrame') return false;
  const top = topUrlOf(details);
  return !!top && siteOf(details.url) !== siteOf(top);
};
const countBlocked = (details) => {
  const id = details.webContentsId;
  if (!id) return;
  const n = (st.blocked.get(id) || 0) + 1;
  st.blocked.set(id, n);
  if (n === 1 || n % 5 === 0) send('privbrowser:blocked', { id, count: n });
};

// A few upgrades in a row to the same host that come back as http: the site sends https back to http.
const upgrades = new Map();

function configureSession(ses, mode) {
  ses.__palvPriv = true;
  ses.setUserAgent(UA, 'en-US,en;q=0.9');
  ses.setProxy(proxyFor(mode)).catch(() => {});
  ses.setSpellCheckerEnabled(false);
  ses.setSSLConfig({ minVersion: 'tls1.2' });
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock']);
  ses.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  ses.setDevicePermissionHandler(() => false);
  if (ses.setDisplayMediaRequestHandler) ses.setDisplayMediaRequestHandler((_req, cb) => cb({}));
  try { ses.setBluetoothPairingHandler && ses.setBluetoothPairingHandler((_d, cb) => cb({ confirmed: false })); } catch { /* not on this platform */ }

  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'privbrowser-guard.js') });
  if (blockerPreload) ses.registerPreloadScript({ type: 'frame', filePath: blockerPreload });

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, cb) => {
    let u;
    try { u = new URL(details.url); } catch { return cb({}); }
    if (u.protocol === 'devtools:' || u.protocol === 'chrome-extension:' || u.protocol === 'data:' || u.protocol === 'blob:') return cb({});
    if (u.protocol === 'file:' || u.protocol === 'chrome:') return cb({ cancel: true });
    if (/^(https?|wss?):$/.test(u.protocol) && core.isLocalHost(u.hostname)) {
      if (details.resourceType === 'mainFrame') send('privbrowser:refused', { id: details.webContentsId, url: details.url, why: 'local' });
      return cb({ cancel: true });
    }
    if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
      const up = core.httpsUpgrade(details.url, st.httpOk);
      if (up) {
        const host = u.hostname, now = Date.now();
        const rec = upgrades.get(host) || { n: 0, t: now };
        if (now - rec.t > 8000) { rec.n = 0; rec.t = now; }
        rec.n += 1;
        upgrades.set(host, rec);
        if (rec.n <= 3) return cb({ redirectURL: up });
        // The site keeps sending back to http: not opened, the tab offers it with a warning.
        if (details.resourceType === 'mainFrame') send('privbrowser:refused', { id: details.webContentsId, url: details.url, why: 'http' });
        return cb({ cancel: true });
      }
    }
    if (!blocker || details.resourceType === 'mainFrame' || !shieldOn(topUrlOf(details))) return cb({});
    blocker.onBeforeRequest(details, (res) => {
      if (res && (res.cancel || res.redirectURL)) countBlocked(details);
      cb(res || {});
    });
  });

  ses.webRequest.onBeforeSendHeaders({ urls: ['<all_urls>'] }, (details, cb) => {
    const headers = details.requestHeaders;
    if (isThirdParty(details) && shieldOn(topUrlOf(details))) {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'cookie') delete headers[k];
    }
    cb({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived({ urls: ['<all_urls>'] }, (details, cb) => {
    const headers = details.responseHeaders || {};
    const on = shieldOn(topUrlOf(details));
    let changed = false;
    if (on && isThirdParty(details)) {
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'set-cookie') { delete headers[k]; changed = true; }
    }
    if (!blocker || !on || (details.resourceType !== 'mainFrame' && details.resourceType !== 'subFrame')) return cb(changed ? { responseHeaders: headers } : {});
    blocker.onHeadersReceived({ ...details, responseHeaders: headers }, (res) => cb(res && res.responseHeaders ? res : changed ? { responseHeaders: headers } : {}));
  });

  ses.on('will-download', (_e, item) => download(item));
}

function sessionFor(part) {
  const ses = session.fromPartition(part);
  if (!isBrowserSession(ses)) {
    const mode = part.startsWith(`${PREFIX}direct-`) ? 'direct' : 'tor';
    configureSession(ses, mode);
    log.info('privbrowser', `nieuwe sessie (${mode === 'tor' ? 'via Tor' : 'direct'})`);
  }
  return ses;
}

// Wipes a session that is no longer used: cookies, storage, cache, everything.
function wipe(part) {
  const ses = session.fromPartition(part);
  Promise.all([ses.clearStorageData(), ses.clearCache(), ses.clearAuthCache(), ses.clearHostResolverCache()]).catch(() => {});
}

/* ---------- downloads: straight into Downloads, the tab shows them ---------- */
let dlId = 0;
function download(item) {
  const id = ++dlId;
  const dir = app.getPath('downloads');
  const name = item.getFilename().replace(/[<>:"/\\|?*]/g, '_') || 'download';
  const ext = path.extname(name), stem = path.basename(name, ext);
  let file = path.join(dir, name);
  for (let i = 1; fs.existsSync(file) && i < 1000; i += 1) file = path.join(dir, `${stem} (${i})${ext}`);
  item.setSavePath(file);
  const out = (state) => send('privbrowser:download', { id, name: path.basename(file), file, state, received: item.getReceivedBytes(), total: item.getTotalBytes() });
  out('progressing');
  let last = 0;
  item.on('updated', (_e, state) => { if (Date.now() - last > 400) { last = Date.now(); out(state); } });
  item.once('done', (_e, state) => { out(state); log.info('privbrowser', `download ${state}`); });
  downloads.set(id, { item, file });
}
const downloads = new Map();

/* ---------- each page of the tab ---------- */
function adopt(contents) {
  if (st.configured.has(contents)) return;
  st.configured.add(contents);
  contents.setWebRTCIPHandlingPolicy(st.mode === 'tor' ? 'disable_non_proxied_udp' : 'default_public_interface_only');
  emulate(contents);
  // Links that open a new window or tab: a tab of our own; a real pop-up (window.open with a size) a
  // window of its own in the same session, so logins in a pop-up keep working.
  contents.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window') {
      return { action: 'allow', overrideBrowserWindowOptions: { parent: getWin() || undefined, width: 720, height: 760, autoHideMenuBar: true, backgroundColor: '#ffffff', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false } } };
    }
    send('privbrowser:open', { url, from: contents.id, background: disposition === 'background-tab' });
    return { action: 'deny' };
  });
  contents.on('did-start-navigation', (e) => { if (e.isMainFrame && !e.isSameDocument) { st.blocked.set(contents.id, 0); send('privbrowser:blocked', { id: contents.id, count: 0 }); } });
  contents.on('context-menu', (_e, p) => contextMenu(contents, p));
  contents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase(), ctrl = input.control || input.meta;
    const ours = (ctrl && ['t', 'w', 'l', 'f', 'r', 'n', 'tab', '=', '+', '-', '0', 'p', 'd', 'h', 'j'].includes(k)) || k === 'f5' || k === 'f6' || (input.alt && (k === 'arrowleft' || k === 'arrowright' || k === 'home'));
    if (!ours) return;
    e.preventDefault();
    send('privbrowser:key', { id: contents.id, key: k, ctrl, shift: input.shift, alt: input.alt });
  });
}

// Time zone and language as in Mullvad Browser (UTC, en-US), for the page, its frames and its workers,
// through Chromium's own emulation. Kept across navigations by Chromium.
function emulate(contents) {
  const dbg = contents.debugger;
  try { dbg.attach('1.3'); } catch { return; }
  const set = (sessionId) => {
    for (const [m, p] of [['Emulation.setTimezoneOverride', { timezoneId: 'UTC' }], ['Emulation.setLocaleOverride', { locale: 'en-US' }]]) {
      dbg.sendCommand(m, p, sessionId).catch(() => {});
    }
  };
  set();
  dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
  dbg.on('message', (_e, method, params) => {
    if (method === 'Target.attachedToTarget' && params && params.sessionId) {
      set(params.sessionId);
      dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, params.sessionId).catch(() => {});
    }
  });
  dbg.on('detach', () => { /* the page closed */ });
}

function contextMenu(contents, p) {
  const T = [];
  const sep = () => { if (T.length && T[T.length - 1].type !== 'separator') T.push({ type: 'separator' }); };
  const host = contents.hostWebContents || contents;
  if (p.linkURL && /^https?:/i.test(p.linkURL)) {
    T.push({ label: 'Link openen in nieuw tabblad', click: () => send('privbrowser:open', { url: p.linkURL, from: contents.id, background: true }) });
    T.push({ label: 'Link kopiëren', click: () => clipboard.writeText(p.linkURL) });
    sep();
  }
  if (p.mediaType === 'image' && p.srcURL) {
    if (/^https?:/i.test(p.srcURL)) T.push({ label: 'Afbeelding openen in nieuw tabblad', click: () => send('privbrowser:open', { url: p.srcURL, from: contents.id, background: true }) });
    T.push({ label: 'Afbeelding opslaan', click: () => contents.downloadURL(p.srcURL) });
    T.push({ label: 'Afbeelding kopiëren', click: () => contents.copyImageAt(p.x, p.y) });
    sep();
  }
  if (p.isEditable) {
    T.push({ label: 'Ongedaan maken', role: 'undo', enabled: p.editFlags.canUndo });
    sep();
    T.push({ label: 'Knippen', role: 'cut', enabled: p.editFlags.canCut });
    T.push({ label: 'Kopiëren', role: 'copy', enabled: p.editFlags.canCopy });
    T.push({ label: 'Plakken', role: 'paste', enabled: p.editFlags.canPaste });
    T.push({ label: 'Alles selecteren', role: 'selectAll' });
    sep();
  } else if (p.selectionText) {
    const text = p.selectionText.trim().replace(/\s+/g, ' ');
    T.push({ label: 'Kopiëren', role: 'copy' });
    T.push({ label: `Zoeken naar "${text.length > 30 ? text.slice(0, 30) + '…' : text}"`, click: () => send('privbrowser:open', { search: text, from: contents.id }) });
    sep();
  }
  T.push({ label: 'Terug', enabled: contents.navigationHistory.canGoBack(), click: () => contents.navigationHistory.goBack() });
  T.push({ label: 'Vooruit', enabled: contents.navigationHistory.canGoForward(), click: () => contents.navigationHistory.goForward() });
  T.push({ label: 'Opnieuw laden', click: () => contents.reload() });
  sep();
  T.push({ label: 'Pagina opslaan als pdf', click: () => send('privbrowser:key', { id: contents.id, key: 'pdf' }) });
  T.push({ label: 'Afdrukken…', click: () => contents.print() });
  const w = BrowserWindow.fromWebContents(host) || getWin();
  Menu.buildFromTemplate(T).popup({ window: w || undefined });
}

/* ---------- the blocker: lists of uBlock Origin and EasyList ---------- */
async function loadBlocker() {
  try {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const cache = path.join(app.getPath('userData'), 'privbrowser-blocker.bin');
    // Fresh lists every three days; in between from the copy on disk (only lists, never anything visited).
    try { if (Date.now() - fs.statSync(cache).mtimeMs > 3 * 864e5) fs.rmSync(cache, { force: true }); } catch { /* none yet */ }
    const b = await ElectronBlocker.fromPrebuiltFull(fetch, { path: cache, read: fs.promises.readFile, write: fs.promises.writeFile });
    blocker = b;
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', (event, url, msg) => {
      if (!isBrowserSession(event.sender.session) || !shieldOn(event.sender.getURL())) return undefined;
      return b.onInjectCosmeticFilters(event, url, msg);
    });
    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', (event) => b.onIsMutationObserverEnabled(event));
    log.info('privbrowser', 'blokkeerlijsten geladen');
    pushStatus();
  } catch (err) {
    log.warn('privbrowser', 'blokkeerlijsten niet geladen; opnieuw over 10 minuten', { fout: err.message });
    setTimeout(loadBlocker, 600000);
  }
}

/* ---------- start ---------- */
function start(opts) {
  getWin = opts.getWin;
  if (process.platform !== 'win32') return;
  tldts = require('tldts');
  try { blockerPreload = require.resolve('@ghostery/adblocker-electron-preload'); } catch { blockerPreload = null; }
  loadBlocker();

  // When Tor comes up or goes, every session of the tab follows: the proxy is Tor or nothing.
  tor.onStatus((s) => {
    if (st.mode === 'tor') session.fromPartition(partition()).setProxy(proxyFor('tor')).catch(() => {});
    send('privbrowser:status', { ...statusOut(), tor: s });
  });

  ipcMain.handle('privbrowser:status', () => statusOut());
  ipcMain.handle('privbrowser:open', (_e, { mode, bridges }) => {
    if (mode === 'direct' || mode === 'tor') {
      if (mode !== st.mode) { const old = partition(); st.mode = mode; st.gen += 1; wipe(old); }
    }
    sessionFor(partition());
    if (st.mode === 'tor') tor.start({ bridges });
    return statusOut();
  });
  // A new identity: a fresh session (the old one wiped), a new seed for the noise, the shields back up,
  // and new Tor routes.
  ipcMain.handle('privbrowser:newIdentity', async () => {
    const old = partition();
    st.gen += 1;
    st.seed = crypto.randomBytes(4).readUInt32LE(0);
    st.shieldOff.clear();
    st.httpOk.clear();
    wipe(old);
    sessionFor(partition());
    if (st.mode === 'tor') await tor.newIdentity();
    log.info('privbrowser', 'nieuwe identiteit');
    return statusOut();
  });
  ipcMain.handle('privbrowser:setBridges', (_e, kind) => { tor.setBridges(kind); return statusOut(); });
  ipcMain.handle('privbrowser:shield', (_e, url, on) => {
    const site = siteOf(url);
    if (!site) return true;
    if (on) st.shieldOff.delete(site); else st.shieldOff.add(site);
    return !st.shieldOff.has(site);
  });
  ipcMain.handle('privbrowser:shieldState', (_e, url) => !st.shieldOff.has(siteOf(url)));
  ipcMain.handle('privbrowser:allowHttp', (_e, url) => { const h = hostOf(url); if (h) { st.httpOk.add(h); upgrades.delete(h); } return true; });
  ipcMain.handle('privbrowser:showDownload', (_e, id) => { const d = downloads.get(id); if (d) require('electron').shell.showItemInFolder(d.file); });
  ipcMain.handle('privbrowser:openDownloads', () => require('electron').shell.openPath(app.getPath('downloads')));
  ipcMain.handle('privbrowser:cancelDownload', (_e, id) => { const d = downloads.get(id); if (d) d.item.cancel(); });
  ipcMain.handle('privbrowser:savePdf', async (_e, guestId) => {
    const wc = webContents.fromId(guestId);
    if (!wc || !isBrowserSession(wc.session)) return null;
    const data = await wc.printToPDF({ printBackground: true });
    const title = (wc.getTitle() || 'pagina').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80);
    let file = path.join(app.getPath('downloads'), `${title}.pdf`);
    for (let i = 1; fs.existsSync(file); i += 1) file = path.join(app.getPath('downloads'), `${title} (${i}).pdf`);
    fs.writeFileSync(file, data);
    return path.basename(file);
  });
  // The dashboard's own helpers in a page of the tab (the on-screen keyboard): in an isolated world, out of
  // sight of the page. Only into a page of the tab in the window that asks.
  ipcMain.handle('privbrowser:isolated', (e, guestId, code) => {
    const wc = webContents.fromId(guestId);
    if (!wc || wc.isDestroyed() || !isBrowserSession(wc.session) || wc.hostWebContents !== e.sender || typeof code !== 'string') return false;
    return wc.executeJavaScriptInIsolatedWorld(1001, [{ code }]).then(() => true, () => false);
  });
  // The guard in every frame asks for its seed: per session and per site, and whether the shield is up.
  ipcMain.on('palv-priv:guard', (e, top, href) => {
    const ses = e.sender && e.sender.session;
    if (!isBrowserSession(ses)) { e.returnValue = { on: false }; return; }
    const site = siteOf(top) || siteOf(href);
    e.returnValue = { on: !st.shieldOff.has(site), seed: core.hash32(`${st.seed}|${st.gen}|${site}`), thirdParty: !!site && siteOf(href) !== site && /^https?:/.test(href) };
  });

  app.on('before-quit', () => tor.stop());
}

// Called for every new web page (main.js): the pages of the tab get the care above.
function owns(contents) {
  try { return isBrowserSession(contents.session); } catch { return false; }
}

module.exports = { start, adopt, owns, PREFIX, sessionFor };
