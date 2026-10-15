// The dashboard's configuration file, with automatic backups.
// config.json is written atomically (temp file, flushed to disk, then renamed), so a power cut never
// leaves half a file. Before it changes, the previous version is kept in backups/ at most once an hour,
// and always before an import, a reset or a new app version. When config.json cannot be read, the
// newest backup that can is put back in its place.
const fs = require('fs');
const path = require('path');
const log = require('./log');

const KEEP = 30;
const EVERY_MS = 60 * 60000;
let dir = null;
let lastBackup = 0;
let restored = null; // time of the backup put back at this start, told to the dashboard once

const file = () => path.join(dir, 'config.json');
const backupDir = () => path.join(dir, 'backups');
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}`;
const REASONS = { auto: 'Automatisch', start: 'Bij het opstarten', import: 'Voor een import', reset: 'Voor het herstellen van de standaard', restore: 'Voor het terugzetten van een reservekopie', update: 'Voor een nieuwe versie', broken: 'Onleesbaar bestand' };

function init(userData) {
  dir = userData;
  fs.mkdirSync(backupDir(), { recursive: true });
  const list = backups();
  lastBackup = list.length ? list[0].time : 0;
}

function parse(text) {
  const cfg = JSON.parse(text);
  if (!cfg || typeof cfg !== 'object' || !Array.isArray(cfg.pages)) throw new Error('geen dashboard-indeling');
  return cfg;
}

function read() {
  let text;
  try {
    text = fs.readFileSync(file(), 'utf8');
  } catch {
    return null; // first start
  }
  try {
    return parse(text);
  } catch (err) {
    log.error('config', 'config.json is onleesbaar', err.message);
    const broken = path.join(backupDir(), `config-${stamp()}-broken.json`);
    try { fs.copyFileSync(file(), broken); } catch { /* keep going */ }
    for (const b of backups()) {
      if (b.reason === 'broken') continue;
      try {
        const cfg = parse(fs.readFileSync(b.path, 'utf8'));
        writeAtomic(cfg);
        log.warn('config', `reservekopie ${b.name} teruggezet`);
        restored = b.time;
        return cfg;
      } catch { /* try the next one */ }
    }
    return null;
  }
}

function writeAtomic(cfg) {
  const tmp = file() + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(cfg, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file());
}

// Keeps the version on disk before it is replaced; `reason` other than auto always makes one.
function backup(reason = 'auto') {
  if (!fs.existsSync(file())) return null;
  if (reason === 'auto' && Date.now() - lastBackup < EVERY_MS) return null;
  try {
    const text = fs.readFileSync(file(), 'utf8');
    const newest = backups()[0];
    // Nothing changed since the newest copy: no new one (a start, an hourly round).
    if ((reason === 'auto' || reason === 'start') && newest && fs.readFileSync(newest.path, 'utf8') === text) { lastBackup = Date.now(); return null; }
    const name = `config-${stamp()}-${reason}.json`;
    fs.writeFileSync(path.join(backupDir(), name), text, 'utf8');
    lastBackup = Date.now();
    prune();
    return name;
  } catch (err) {
    log.warn('config', 'reservekopie mislukt', err.message);
    return null;
  }
}

function write(cfg) {
  backup('auto');
  writeAtomic(cfg);
}

function prune() {
  const list = backups();
  for (const b of list.slice(KEEP)) fs.rmSync(b.path, { force: true });
}

function backups() {
  let names = [];
  try { names = fs.readdirSync(backupDir()); } catch { return []; }
  return names
    .map((name) => {
      const m = /^config-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(\d{3})?-([a-z]+)\.json$/.exec(name);
      if (!m) return null;
      const time = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +(m[7] || 0)).getTime();
      return { name, path: path.join(backupDir(), name), time, reason: m[8], label: REASONS[m[8]] || m[8] };
    })
    .filter(Boolean)
    .sort((a, b) => b.time - a.time);
}

// What the settings show: when, why, and how many pages and widgets the copy holds.
function list() {
  return backups().map((b) => {
    let pages = null, widgets = null;
    try {
      const cfg = JSON.parse(fs.readFileSync(b.path, 'utf8'));
      pages = cfg.pages.length;
      widgets = cfg.pages.reduce((n, p) => n + (p.widgets || []).length, 0);
    } catch { /* shown without counts */ }
    return { name: b.name, time: b.time, reason: b.reason, label: b.label, pages, widgets };
  });
}

function load(name) {
  const b = backups().find((x) => x.name === name);
  if (!b) throw new Error('Reservekopie niet gevonden');
  return parse(fs.readFileSync(b.path, 'utf8'));
}

// The time of a backup that was put back because config.json was unreadable, once.
function takeRestored() { const t = restored; restored = null; return t; }

module.exports = { init, read, takeRestored, write, backup, list, load, backupDir, parse };
