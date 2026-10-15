// Logbook of the dashboard: one file per day in <userData>/logs, the last 14 days kept.
// What went wrong while nobody was watching (a source that stopped, a crash, an update) can be read
// back afterwards; on the Mac Mini that is the only way to know.
const fs = require('fs');
const path = require('path');

const KEEP_DAYS = 14;
let dir = null;
let current = { day: '', fd: null };

const pad = (n, l = 2) => String(n).padStart(l, '0');
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const stamp = (d) => `${dayOf(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

function init(logDir) {
  dir = logDir;
  try {
    fs.mkdirSync(dir, { recursive: true });
    prune();
  } catch { /* logging must never stop the dashboard */ }
}

function prune() {
  const limit = Date.now() - KEEP_DAYS * 864e5;
  for (const name of fs.readdirSync(dir)) {
    const m = /^palv-(\d{4})-(\d{2})-(\d{2})\.log$/.exec(name);
    if (m && new Date(+m[1], +m[2] - 1, +m[3]).getTime() < limit) fs.rmSync(path.join(dir, name), { force: true });
  }
}

function file(d) {
  const day = dayOf(d);
  if (current.day !== day) {
    if (current.fd != null) try { fs.closeSync(current.fd); } catch { /* already closed */ }
    current = { day, fd: fs.openSync(path.join(dir, `palv-${day}.log`), 'a') };
    try { prune(); } catch { /* next day */ }
  }
  return current.fd;
}

function write(level, scope, msg, data) {
  const d = new Date();
  let line = `${stamp(d)} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (data !== undefined) {
    let extra;
    try { extra = data instanceof Error ? data.stack || String(data) : typeof data === 'string' ? data : JSON.stringify(data); } catch { extra = String(data); }
    line += ' ' + extra;
  }
  (level === 'error' ? console.error : console.log)(line);
  if (!dir) return;
  try { fs.writeSync(file(d), line + '\n'); } catch { /* disk full or gone: keep running */ }
}

module.exports = {
  init,
  dir: () => dir,
  info: (scope, msg, data) => write('info', scope, msg, data),
  warn: (scope, msg, data) => write('warn', scope, msg, data),
  error: (scope, msg, data) => write('error', scope, msg, data),
};
