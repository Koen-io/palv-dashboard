'use strict';
// Het Schermslot: een schermvullend vergrendelvenster in de stijl van het Windows-vergrendelscherm, zodat
// een onbeheerde pc dicht is terwijl het dashboard op een tweede scherm gewoon zichtbaar blijft. Het slot
// dekt elk scherm waarop het dashboard NIET staat (op een pc met twee schermen dus het werkscherm) met een
// venster bovenop alles — ook over de taakbalk — en vraagt een toegangscode om er weer uit te komen.
//
// Eerlijk over wat dit wel en niet is: dit is een slot ván de applicatie, geen Windows-aanmelding. De
// toegangscode is een eigen code van het dashboard (scrypt + AES-256-GCM, lokaal in palv-screenlock.json,
// alleen voor deze gebruiker leesbaar) en nooit het Windows-wachtwoord van het account. Het houdt een
// gescreende collega die even wegloopt netjes buiten: Alt+Tab, de Windows-toets en Alt+F4 worden geblokkeerd
// en achterliggende vensters zijn niet te bereiken. Wat geen enkel programma kan afvangen is Ctrl+Alt+Del
// (en daarmee Taakbeheer); dat blijft de grens van een slot op dit niveau.
const { BrowserWindow, ipcMain, screen, globalShortcut, powerMonitor } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const V = 1;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const CHECK_TEXT = 'palv-screenlock-v1';
const AAD = 'screenlock';
const MAXLEN = 64; // het wachtwoord mag tekst zijn (letters, cijfers, tekens), 1 tot 64 tekens
const FAILS_BEFORE_WAIT = 5, WAIT_MS = 30000;
// De toetsen die een onbeheerde pc anders langs het slot zouden laten: wisselen van venster, de Windows-toets
// en het afsluiten van het venster. Ctrl+Alt+Del is bewust afwezig: dat kan niet en pretenderen we niet.
const BLOCK_KEYS = [
  'Alt+Tab', 'Alt+Shift+Tab', 'Super', 'Super+Tab', 'Super+D', 'Super+E', 'Super+R',
  'Alt+F4', 'Alt+Escape', 'Ctrl+Escape', 'Ctrl+W', 'Ctrl+F4', 'Super+M', 'Super+Down',
];

let dir = null, getWin = () => null;
let log = { info() {}, warn() {} };
let state = null;            // { salt, check, name, idleMin, lockSingle } of null
let winsLocked = [];         // de vergrendelvensters die nu open staan
let fails = { n: 0, until: 0 };
let assets = null;           // { wallpaper, accent, avatar }, één keer opgehaald
let idleTimer = null, topTimer = null;

const file = () => path.join(dir, 'palv-screenlock.json');
const derive = (pin, salt) => crypto.scryptSync(String(pin), salt, 32, SCRYPT);
const validPin = (pin) => typeof pin === 'string' && pin.length >= 1 && pin.length <= MAXLEN;

function sealWith(key, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(AAD));
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}
function openWith(key, enc) {
  try {
    const buf = Buffer.from(String(enc), 'base64');
    if (buf.length < 12 + 16) return null;
    const iv = buf.subarray(0, 12), tag = buf.subarray(buf.length - 16), ct = buf.subarray(12, buf.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(Buffer.from(AAD));
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
  } catch { return null; }
}

function read() {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (d && d.v === V && d.salt && d.check) return d;
  } catch { /* nog niets */ }
  return null;
}
function writeState(st) {
  state = st;
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: V, ...st }, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file());
  try { fs.chmodSync(file(), 0o600); } catch { /* niet op elk bestandssysteem */ }
}

/* ---------- de echte achtergrond, accentkleur en avatar van deze pc ---------- */
// Alles wat het vergrendelscherm 1-op-1 op dat van Windows laat lijken, één keer opgehaald en bewaard.

const regQuery = (key, value) => {
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], { windowsHide: true, timeout: 4000 }).toString();
    const m = out.match(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+REG_\\w+\\s+(.+?)\\s*$', 'm'));
    return m ? m[1].trim() : null;
  } catch { return null; }
};

// De afmetingen van een JPEG uit de kop lezen (om liggende van staande Spotlight-beelden te onderscheiden).
function jpegSize(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) { i += 1; continue; }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// Het beeld dat Windows achter het vergrendelscherm toont, in deze volgorde: een door beleid ingesteld
// vergrendelbeeld, het nieuwste liggende Windows Spotlight-beeld, anders de bureaubladachtergrond.
function backgroundPath() {
  const csp = regQuery('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PersonalizationCSP', 'LockScreenImagePath');
  if (csp && fs.existsSync(csp)) return csp;
  try {
    const spot = path.join(process.env.LOCALAPPDATA || '', 'Packages', 'Microsoft.Windows.ContentDeliveryManager_cw5n1h2txyewy', 'LocalState', 'Assets');
    if (fs.existsSync(spot)) {
      const cands = fs.readdirSync(spot).map((f) => path.join(spot, f))
        .map((p) => { try { const st = fs.statSync(p); return st.isFile() && st.size > 100 * 1024 ? { p, t: st.mtimeMs } : null; } catch { return null; } })
        .filter(Boolean).sort((a, b) => b.t - a.t).slice(0, 12);
      for (const c of cands) {
        try { const d = jpegSize(fs.readFileSync(c.p)); if (d && d.w > d.h && d.w >= 1280) return c.p; } catch { /* volgende */ }
      }
    }
  } catch { /* geen Spotlight: dan de bureaubladachtergrond */ }
  const wp = regQuery('HKCU\\Control Panel\\Desktop', 'WallPaper');
  if (wp && fs.existsSync(wp)) return wp;
  const t = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
  return fs.existsSync(t) ? t : null;
}

function imageDataUrl(p) {
  try {
    if (!p || !fs.existsSync(p)) return '';
    const buf = fs.readFileSync(p);
    if (!buf.length || buf.length >= 16 * 1024 * 1024) return '';
    const png = buf[0] === 0x89 && buf[1] === 0x50;
    return `data:image/${png ? 'png' : 'jpeg'};base64,${buf.toString('base64')}`;
  } catch { return ''; }
}

// De accentkleur van Windows (DWM, opgeslagen als 0xAABBGGRR) als #rrggbb, voor het veld en de knop.
function accentColor() {
  const raw = regQuery('HKCU\\SOFTWARE\\Microsoft\\Windows\\DWM', 'AccentColor');
  if (!raw) return null;
  const v = parseInt(raw, 16);
  if (!Number.isFinite(v)) return null;
  const r = v & 0xff, g = (v >> 8) & 0xff, b = (v >> 16) & 0xff;
  return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
}

// De echte accountfoto van de gebruiker, als die er is; anders tekent het vergrendelscherm de standaardtegel.
function avatarDataUrl() {
  try {
    const d = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'AccountPictures');
    if (!fs.existsSync(d)) return '';
    const imgs = fs.readdirSync(d).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => path.join(d, f))
      .map((p) => { try { return { p, s: fs.statSync(p).size }; } catch { return null; } }).filter(Boolean).sort((a, b) => b.s - a.s);
    return imgs.length ? imageDataUrl(imgs[0].p) : '';
  } catch { return ''; }
}

function readAssets() {
  if (assets) return assets;
  assets = { wallpaper: imageDataUrl(backgroundPath()), accent: accentColor() || '#4cc2ff', avatar: avatarDataUrl() };
  return assets;
}

/* ---------- opstarten ---------- */
function init(opts) {
  dir = opts.dir;
  getWin = opts.getWin || getWin;
  if (opts.log) log = opts.log;
  state = read();
  startIdle();
}

const hasPin = () => !!state;
const isLocked = () => winsLocked.length > 0;

// De naam onder de avatar: de ingestelde naam, anders de Windows-gebruikersnaam (TFO).
function displayName() {
  if (state && state.name) return state.name;
  try { return require('os').userInfo().username || 'Gebruiker'; } catch { return 'Gebruiker'; }
}

function status() {
  return { hasPin: hasPin(), locked: isLocked(), name: displayName(), idleMin: (state && state.idleMin) || 0, lockSingle: !!(state && state.lockSingle), platform: process.platform };
}

/* ---------- de toegangscode ---------- */
function setPin(oldPin, newPin) {
  if (!validPin(newPin)) return { error: 'Geef een wachtwoord op (1 tot 64 tekens).' };
  if (state) {
    const key = derive(oldPin, Buffer.from(state.salt, 'base64'));
    if (openWith(key, state.check) !== CHECK_TEXT) return { error: 'De huidige toegangscode klopt niet.' };
  }
  const salt = crypto.randomBytes(16);
  const key = derive(newPin, salt);
  writeState({ salt: salt.toString('base64'), check: sealWith(key, CHECK_TEXT), name: (state && state.name) || '', idleMin: (state && state.idleMin) || 0, lockSingle: !!(state && state.lockSingle) });
  fails = { n: 0, until: 0 };
  log.info('schermslot', state ? 'toegangscode gewijzigd' : 'toegangscode ingesteld');
  startIdle();
  return { ok: true };
}
function removePin(pin) {
  if (!state) return { ok: true };
  const key = derive(pin, Buffer.from(state.salt, 'base64'));
  if (openWith(key, state.check) !== CHECK_TEXT) return { error: 'De toegangscode klopt niet.' };
  try { fs.rmSync(file(), { force: true }); } catch { /* al weg */ }
  state = null;
  stopIdle();
  log.info('schermslot', 'toegangscode verwijderd');
  return { ok: true };
}
function setOptions(opts) {
  if (!state) return { error: 'Stel eerst een toegangscode in.' };
  if (typeof opts.name === 'string') state.name = opts.name.slice(0, 40);
  if (Number.isFinite(opts.idleMin)) state.idleMin = Math.max(0, Math.min(240, Math.round(opts.idleMin)));
  if (typeof opts.lockSingle === 'boolean') state.lockSingle = opts.lockSingle;
  writeState(state);
  startIdle();
  return { ok: true };
}

function verify(pin) {
  if (!state) return { ok: false };
  if (fails.until > Date.now()) return { ok: false, wait: Math.ceil((fails.until - Date.now()) / 1000) };
  if (!validPin(pin)) { return { ok: false }; }
  const key = derive(pin, Buffer.from(state.salt, 'base64'));
  if (openWith(key, state.check) !== CHECK_TEXT) {
    fails.n += 1;
    if (fails.n >= FAILS_BEFORE_WAIT) fails.until = Date.now() + WAIT_MS;
    log.warn('schermslot', `verkeerde toegangscode (${fails.n}×)`);
    return { ok: false, wait: fails.until > Date.now() ? Math.ceil((fails.until - Date.now()) / 1000) : 0 };
  }
  fails = { n: 0, until: 0 };
  unlock();
  return { ok: true };
}

/* ---------- vergrendelen en ontgrendelen ---------- */
// Overlappend oppervlak van twee rechthoeken (0 = ze raken elkaar niet).
function rectOverlap(a, b) {
  const w = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return w * h;
}
// Welke schermen het slot afdekt: alleen de schermen waar het dashboardvenster GEEN enkele pixel op staat.
// Zo blijft het dashboardscherm (op QRA het touchscreen) volledig onaangeroerd en gaat het slot uitsluitend
// over het werkscherm. Is er geen vrij scherm (één monitor, of het dashboard beslaat alles), dan vergrendelt
// het niets — tenzij 'ook met één scherm' bewust aan staat; dan dekt het alle schermen af.
function targetDisplays() {
  const all = screen.getAllDisplays();
  const win = getWin();
  let wb = null;
  try { if (win && !win.isDestroyed()) wb = win.getBounds(); } catch { /* geen venster */ }
  if (wb) {
    const safe = all.filter((d) => rectOverlap(wb, d.bounds) === 0);
    if (safe.length) return safe;
  }
  return (state && state.lockSingle) ? all : [];
}

function lock() {
  if (process.platform !== 'win32') return { ok: false, reason: 'unsupported' };
  if (!state) return { ok: false, reason: 'no-pin' };
  if (isLocked()) return { ok: true };
  const displays = targetDisplays();
  if (!displays.length) return { ok: false, reason: 'single-screen' };

  for (const d of displays) {
    // Precies dit ene scherm afdekken via de exacte schermgrens (inclusief de taakbalk) en het hoogste
    // venstervlak ('screen-saver'). Bewust GEEN OS-volledig-scherm/kiosk in de constructor: dat springt op
    // Windows soms naar het primaire scherm, en dat zou het dashboardscherm kunnen raken.
    const w = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, show: false,
      skipTaskbar: true, movable: false, minimizable: false, maximizable: false, closable: false,
      resizable: false, backgroundColor: '#0a0a0a', title: 'Vergrendeld',
      webPreferences: {
        preload: path.join(__dirname, '..', 'lock', 'lock-preload.js'),
        contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false,
      },
    });
    w._lockBounds = d.bounds;
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.loadFile(path.join(__dirname, '..', 'lock', 'lock.html'));
    // Geen weg eromheen: niets opent een nieuw venster en het slot navigeert nergens heen.
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    w.once('ready-to-show', () => { w.setBounds(d.bounds); w.show(); w.moveTop(); });
    winsLocked.push(w);
  }
  // Het eerste venster krijgt de aandacht, zodat de code meteen te typen is.
  try { winsLocked[0].focus(); } catch { /* komt vanzelf */ }

  for (const k of BLOCK_KEYS) { try { globalShortcut.register(k, () => {}); } catch { /* niet elke combinatie bestaat */ } }
  // Bovenop blijven, ook als een ander venster zich naar voren dringt — zonder de toetsaandacht van het
  // dashboard op het andere scherm te stelen, want dat moet bruikbaar blijven.
  clearInterval(topTimer);
  topTimer = setInterval(() => {
    for (const w of winsLocked) {
      try {
        if (w.isDestroyed()) continue;
        const b = w.getBounds(), t = w._lockBounds;
        if (b.x !== t.x || b.y !== t.y || b.width !== t.width || b.height !== t.height) w.setBounds(t);
        w.moveTop();
      } catch { /* venster is weg */ }
    }
  }, 1500);
  log.info('schermslot', `vergrendeld (${winsLocked.length} scherm${winsLocked.length === 1 ? '' : 'en'})`);
  broadcast();
  return { ok: true };
}

function unlock() {
  if (!isLocked()) return;
  clearInterval(topTimer); topTimer = null;
  for (const k of BLOCK_KEYS) { try { globalShortcut.unregister(k); } catch { /* was al weg */ } }
  const list = winsLocked; winsLocked = [];
  for (const w of list) { try { if (!w.isDestroyed()) { w.setClosable(true); w.destroy(); } } catch { /* al weg */ } }
  log.info('schermslot', 'ontgrendeld');
  broadcast();
}

function broadcast() {
  const win = getWin();
  if (win && !win.isDestroyed()) win.webContents.send('screenlock:state', status());
}

/* ---------- vanzelf vergrendelen bij inactiviteit ---------- */
function startIdle() {
  stopIdle();
  if (!state || !state.idleMin) return;
  idleTimer = setInterval(() => {
    if (!state || !state.idleMin || isLocked() || process.platform !== 'win32') return;
    let idle = 0;
    try { idle = powerMonitor.getSystemIdleTime(); } catch { return; }
    if (idle >= state.idleMin * 60) lock();
  }, 15000);
}
function stopIdle() { clearInterval(idleTimer); idleTimer = null; }

/* ---------- IPC ---------- */
function register() {
  ipcMain.handle('screenlock:status', () => status());
  ipcMain.handle('screenlock:setPin', (_e, oldPin, newPin) => setPin(oldPin, newPin));
  ipcMain.handle('screenlock:removePin', (_e, pin) => removePin(pin));
  ipcMain.handle('screenlock:setOptions', (_e, opts) => setOptions(opts || {}));
  ipcMain.handle('screenlock:lock', () => lock());
  // Door het vergrendelvenster zelf:
  ipcMain.handle('screenlock:boot', () => ({ name: displayName(), ...readAssets() }));
  ipcMain.handle('screenlock:verify', (_e, pin) => verify(pin));
}

module.exports = { init, register, isLocked, hasPin, lock, unlock, status };
