// Automatic updates from the GitHub releases of the dashboard.
// Every 30 minutes the latest release is looked up. A newer version is downloaded in the background,
// checked against the SHA-256 in the release's SHA256SUMS.txt, and installed after a short countdown
// in the dashboard: on Windows the installer runs silently for the current user and starts the new
// version; on macOS the new app bundle is unpacked and put in place of the old one by a small script
// that waits for this app to close and then starts the new one.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const log = require('./log');

const CHECK_EVERY_MS = 30 * 60000;
const FIRST_CHECK_MS = 90 * 1000;
const isMac = process.platform === 'darwin';

let repo = null;
let send = () => {};
let etag = null, cachedRelease = null;
let timer = null;
const st = { state: 'idle', current: null, latest: null, notes: '', publishedAt: null, lastCheck: 0, lastError: null, progress: 0, received: 0, total: 0, speed: 0, file: null, repo: null };

const dir = () => path.join(app.getPath('userData'), 'updates');
const stateFile = () => path.join(app.getPath('userData'), 'update-state.json');

// "1.13.0" < "1.14.0" < "1.14.1"; pre-release suffixes are not used.
function newer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

function set(patch) {
  Object.assign(st, patch);
  send(status());
}
const status = () => ({ ...st, current: st.current || app.getVersion() });

// The file this machine installs from a release.
function pickAsset(assets) {
  if (isMac) {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return assets.find((a) => new RegExp(`-mac-${arch}\\.tar\\.gz$`).test(a.name));
  }
  return assets.find((a) => /^P-ALV-Dashboard-Setup-.*\.exe$/.test(a.name));
}

async function request(url, opts = {}, timeoutMs = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal, headers: { 'User-Agent': `P-ALV-Dashboard/${app.getVersion()}`, ...(opts.headers || {}) } });
  } finally {
    clearTimeout(t);
  }
}

async function latestRelease() {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (etag && cachedRelease) headers['If-None-Match'] = etag; // a 304 does not count against the rate limit
  const res = await request(`https://api.github.com/repos/${repo}/releases/latest`, { headers });
  if (res.status === 304 && cachedRelease) return cachedRelease;
  if (res.status === 404) throw new Error('Nog geen release gepubliceerd');
  if (res.status === 403 || res.status === 429) throw new Error('GitHub vraagt even te wachten (limiet bereikt)');
  if (!res.ok) throw new Error(`GitHub antwoordde ${res.status}`);
  etag = res.headers.get('etag');
  cachedRelease = await res.json();
  return cachedRelease;
}

async function sumsFor(release, name) {
  const asset = release.assets.find((a) => a.name === 'SHA256SUMS.txt');
  if (!asset) {
    // GitHub records the digest of every uploaded asset itself; use it when the list is missing.
    const own = release.assets.find((a) => a.name === name);
    const m = own && /^sha256:([0-9a-f]{64})$/.exec(own.digest || '');
    if (m) return m[1];
    throw new Error('Release zonder controlegetallen (SHA256SUMS.txt)');
  }
  const res = await request(asset.browser_download_url);
  if (!res.ok) throw new Error(`Controlegetallen niet op te halen (${res.status})`);
  const line = (await res.text()).split(/\r?\n/).find((l) => l.trim().endsWith(' ' + name) || l.trim().endsWith('*' + name));
  const m = line && /^([0-9a-f]{64})/i.exec(line.trim());
  if (!m) throw new Error(`Geen controlegetal voor ${name}`);
  return m[1].toLowerCase();
}

async function download(asset, sha) {
  fs.mkdirSync(dir(), { recursive: true });
  const target = path.join(dir(), asset.name);
  // Already there and intact (an earlier round): use it.
  if (fs.existsSync(target) && hashFile(target) === sha) return target;
  for (const f of fs.readdirSync(dir())) if (f !== asset.name) fs.rmSync(path.join(dir(), f), { force: true, recursive: true });
  const part = target + '.partial';
  const res = await request(asset.browser_download_url, {}, 30 * 60000);
  if (!res.ok || !res.body) throw new Error(`Download mislukt (${res.status})`);
  const total = +res.headers.get('content-length') || asset.size || 0;
  const out = fs.createWriteStream(part);
  const hash = crypto.createHash('sha256');
  let received = 0, lastSend = 0, windowStart = Date.now(), windowBytes = 0, speed = 0;
  set({ state: 'downloading', progress: 0, received: 0, total, speed: 0 });
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      received += chunk.length;
      windowBytes += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const now = Date.now();
      if (now - windowStart >= 1000) { speed = windowBytes / ((now - windowStart) / 1000); windowStart = now; windowBytes = 0; }
      if (now - lastSend > 250) { lastSend = now; set({ progress: total ? received / total : 0, received, speed }); }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  const got = hash.digest('hex');
  if (got !== sha) {
    fs.rmSync(part, { force: true });
    throw new Error('Controlegetal klopt niet; de download wordt niet gebruikt');
  }
  fs.renameSync(part, target);
  set({ progress: 1, received, total: received });
  return target;
}

function hashFile(file) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

let busy = false;
async function check(manual = false) {
  if (!repo) { set({ state: 'off', lastError: 'Geen GitHub-repository ingesteld' }); return status(); }
  if (busy || st.state === 'ready' || st.state === 'installing') return status();
  busy = true;
  set({ state: 'checking', lastError: null });
  try {
    const rel = await latestRelease();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    set({ latest, notes: String(rel.body || '').slice(0, 4000), publishedAt: rel.published_at || null, lastCheck: Date.now() });
    if (!newer(latest, st.current)) {
      set({ state: 'current' });
      if (manual) log.info('update', `gecontroleerd: ${st.current} is de nieuwste versie`);
      return status();
    }
    const asset = pickAsset(rel.assets || []);
    if (!asset) throw new Error(`Release ${latest} heeft geen installatiebestand voor deze computer`);
    log.info('update', `nieuwe versie ${latest} gevonden, downloaden: ${asset.name}`);
    const sha = await sumsFor(rel, asset.name);
    const file = await download(asset, sha);
    log.info('update', `versie ${latest} gedownload en gecontroleerd (SHA-256 ${sha.slice(0, 12)}…)`);
    set({ state: 'ready', file });
  } catch (err) {
    const msg = err.name === 'AbortError' ? 'Geen verbinding met GitHub (time-out)' : String(err.message || err);
    log.warn('update', 'controle of download mislukt', msg);
    set({ state: 'error', lastError: msg, lastCheck: Date.now() });
  } finally {
    busy = false;
  }
  return status();
}

function remember() {
  try { fs.writeFileSync(stateFile(), JSON.stringify({ from: st.current, to: st.latest, notes: st.notes, at: Date.now() }), 'utf8'); } catch { /* not essential */ }
}

// After a restart on the new version: what to tell the user, once.
function justUpdated() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    fs.rmSync(stateFile(), { force: true });
    if (s && s.to === app.getVersion() && Date.now() - s.at < 24 * 3600e3) return s;
  } catch { /* nothing to tell */ }
  return null;
}

function installWindows(file) {
  // The per-user installer needs no administrator rights. /S: silent; --updated: keeps shortcuts;
  // --force-run: starts the dashboard again when done.
  const child = spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

function installMac(file) {
  // The running bundle (…/P-ALV Dashboard.app/Contents/MacOS/Electron).
  const bundle = path.resolve(process.execPath, '..', '..', '..');
  if (!/\.app$/.test(bundle)) throw new Error('Geen app-bundel gevonden om te vervangen');
  const parent = path.dirname(bundle);
  const stage = fs.mkdtempSync(path.join(parent, '.palv-update-'));
  execFileSync('/usr/bin/tar', ['-xzf', file, '-C', stage]);
  const fresh = path.join(stage, path.basename(bundle));
  if (!fs.existsSync(path.join(fresh, 'Contents', 'MacOS', 'Electron'))) throw new Error('Het updatebestand bevat geen app');
  const old = path.join(os.tmpdir(), `palv-old-${Date.now()}.app`);
  const script = path.join(os.tmpdir(), 'palv-update.sh');
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  fs.writeFileSync(script, `#!/bin/bash
# Puts the new P-ALV Dashboard in place once the running one has closed, then starts it.
for i in $(seq 1 60); do kill -0 ${process.pid} 2>/dev/null || break; sleep 0.5; done
mv ${q(bundle)} ${q(old)} || exit 1
if ! mv ${q(fresh)} ${q(bundle)}; then mv ${q(old)} ${q(bundle)}; open ${q(bundle)}; exit 1; fi
rmdir ${q(stage)} 2>/dev/null
/usr/bin/xattr -dr com.apple.quarantine ${q(bundle)} 2>/dev/null
/usr/bin/codesign --force --deep --sign - ${q(bundle)} >/dev/null 2>&1
/usr/bin/touch ${q(bundle)}
open ${q(bundle)}
rm -rf ${q(old)}
`, { mode: 0o755 });
  const child = spawn('/bin/bash', [script], { detached: true, stdio: 'ignore' });
  child.unref();
}

let installing = false;
function install() {
  if (installing || st.state !== 'ready' || !st.file) return false;
  installing = true;
  set({ state: 'installing' });
  log.info('update', `installeren van versie ${st.latest}`);
  try {
    remember();
    if (isMac) installMac(st.file);
    else installWindows(st.file);
  } catch (err) {
    installing = false;
    log.error('update', 'installeren mislukt', err);
    set({ state: 'error', lastError: 'Installeren mislukt: ' + (err.message || err) });
    return false;
  }
  setTimeout(() => { app.isQuitting = true; app.quit(); }, 600);
  return true;
}

function start({ repository, onStatus }) {
  repo = repository || null;
  send = onStatus || (() => {});
  st.current = app.getVersion();
  st.repo = repo;
  if (!repo) { st.state = 'off'; return; }
  setTimeout(() => check(), FIRST_CHECK_MS);
  timer = setInterval(() => check(), CHECK_EVERY_MS);
}

module.exports = { start, check, install, status, justUpdated, newer, stop: () => clearInterval(timer) };
