// The dashboard's own Tor, for the Browser tab (Windows): tor.exe from the Tor Expert Bundle, started on
// first use, on ports of its own and with a data folder of its own, so it never touches a Tor Browser
// that may also be on the pc. Ends with the dashboard (__OwningControllerProcess).
//
// status: { state: 'off' | 'starting' | 'ready' | 'error', progress 0-100, summary, socksPort, bridges }
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const log = require('./log');
const core = require('../privbrowser-core');

const status = { state: 'off', progress: 0, summary: '', socksPort: 0, bridges: 'off', error: '' };
let child = null;
let listeners = [];
let restartTimer = null;
let restarts = 0;
let wanted = false;
let bridges = 'off';

// In the installed app next to the other resources; while developing in build/tor (scripts/haal-tor.js).
const base = () => (app.isPackaged ? path.join(process.resourcesPath, 'tor') : path.join(__dirname, '..', '..', 'build', 'tor'));
const dataDir = () => path.join(app.getPath('userData'), 'tor');
const available = () => process.platform === 'win32' && fs.existsSync(path.join(base(), 'tor.exe'));

function emit(patch) {
  Object.assign(status, patch);
  for (const cb of listeners) { try { cb({ ...status }); } catch { /* a closed window */ } }
}

function start(opts = {}) {
  if (opts.bridges) bridges = opts.bridges;
  wanted = true;
  if (child) return { ...status };
  if (!available()) {
    emit({ state: 'error', error: 'Tor ontbreekt in deze installatie.' });
    return { ...status };
  }
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true });
  const ctlFile = path.join(dir, 'control-port.txt');
  const cookieFile = path.join(dir, 'control-cookie');
  for (const f of [ctlFile, cookieFile]) fs.rmSync(f, { force: true });
  let pt = null;
  try { pt = JSON.parse(fs.readFileSync(path.join(base(), 'pt', 'pt_config.json'), 'utf8')); } catch { /* no bridges then */ }
  const rc = path.join(dir, 'torrc');
  fs.writeFileSync(rc, core.torrc({
    dataDir: dir, geoip: path.join(base(), 'geoip'), geoip6: path.join(base(), 'geoip6'), ctlFile, cookieFile,
    bridges, lyrebird: path.join(base(), 'pt', 'lyrebird.exe'), pt,
  }));
  // An empty defaults file: nothing from a torrc elsewhere on the pc comes in.
  fs.writeFileSync(path.join(dir, 'torrc-defaults-none'), '');
  emit({ state: 'starting', progress: 0, summary: 'Tor starten', socksPort: 0, bridges, error: '' });
  log.info('tor', `Tor starten${bridges !== 'off' ? ` met bruggen (${bridges})` : ''}`);
  const proc = spawn(path.join(base(), 'tor.exe'), ['-f', rc, '--defaults-torrc', path.join(dir, 'torrc-defaults-none'), '__OwningControllerProcess', String(process.pid)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child = proc;
  let buf = '';
  let lastWarn = '';
  const onData = (d) => {
    buf += d.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const r = core.torLine(line);
      if (!r || child !== proc) continue;
      if (r.socksPort) emit({ socksPort: r.socksPort });
      else if (r.progress != null) {
        if (r.progress === 100) { restarts = 0; log.info('tor', 'Tor verbonden'); }
        emit({ state: r.progress === 100 ? 'ready' : 'starting', progress: r.progress, summary: r.summary });
      } else if (r.warn) {
        lastWarn = r.warn;
        if (r.level === 'err') log.warn('tor', r.warn);
      }
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  proc.on('error', (err) => { log.error('tor', 'Tor kon niet starten', err); });
  proc.on('exit', (code) => {
    if (child !== proc) return;
    child = null;
    if (!wanted) { emit({ state: 'off', progress: 0, socksPort: 0 }); return; }
    // Stopped by itself: again after a pause that grows with every failure, at most a minute.
    restarts += 1;
    const wait = Math.min(60000, 2000 * 2 ** Math.min(5, restarts - 1));
    log.warn('tor', `Tor gestopt (code ${code}); over ${Math.round(wait / 1000)} s opnieuw`, lastWarn ? { laatste: lastWarn } : undefined);
    emit({ state: 'error', socksPort: 0, error: lastWarn || `Tor stopte (code ${code}).` });
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => { if (wanted && !child) start(); }, wait);
  });
  return { ...status };
}

function stop() {
  wanted = false;
  clearTimeout(restartTimer);
  if (child) { try { child.kill(); } catch { /* already gone */ } }
  child = null;
  emit({ state: 'off', progress: 0, socksPort: 0, summary: '' });
}

// Other bridges (or none): Tor starts again with them.
function setBridges(kind) {
  const k = ['off', 'snowflake', 'obfs4', 'meek'].includes(kind) ? kind : 'off';
  if (k === bridges && child) return { ...status };
  bridges = k;
  if (!wanted) { emit({ bridges }); return { ...status }; }
  const was = child;
  child = null;
  if (was) { try { was.kill(); } catch { /* already gone */ } }
  return start();
}

// New circuits for everything from now on (as "New identity" in Tor Browser), through the control port.
function newIdentity() {
  return new Promise((resolve) => {
    const dir = dataDir();
    let port, cookie;
    try {
      port = /PORT=127\.0\.0\.1:(\d+)/.exec(fs.readFileSync(path.join(dir, 'control-port.txt'), 'utf8'))[1];
      cookie = fs.readFileSync(path.join(dir, 'control-cookie')).toString('hex');
    } catch { return resolve(false); }
    const sock = net.connect({ host: '127.0.0.1', port: +port });
    let out = '';
    const done = (ok) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(5000, () => done(false));
    sock.on('error', () => done(false));
    sock.on('data', (d) => {
      out += d.toString();
      const lines = out.split('\r\n').filter(Boolean);
      if (lines.some((l) => /^[45]\d\d/.test(l))) return done(false);
      if (lines.length >= 2 && lines.slice(0, 2).every((l) => l.startsWith('250'))) done(true);
    });
    sock.write(`AUTHENTICATE ${cookie}\r\nSIGNAL NEWNYM\r\nQUIT\r\n`);
  });
}

const onStatus = (cb) => { listeners.push(cb); return () => { listeners = listeners.filter((x) => x !== cb); }; };

module.exports = { start, stop, setBridges, newIdentity, onStatus, available, status: () => ({ ...status }) };
