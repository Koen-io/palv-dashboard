// App tiles: open a program, a file or a website, and find the icon to show on the tile.
const { app, ipcMain, shell, dialog, nativeImage, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const isMac = process.platform === 'darwin';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const win = () => BrowserWindow.getAllWindows()[0];

async function fileIcon(file) {
  try {
    if (isMac) {
      // Quick Look hands out the full-size icon of an app bundle; getFileIcon stops at 32 pixels on macOS.
      try {
        const thumb = await nativeImage.createThumbnailFromPath(file, { width: 128, height: 128 });
        if (!thumb.isEmpty()) return thumb.toDataURL();
      } catch { /* fall through to the small icon */ }
    }
    const img = await app.getFileIcon(file, { size: isMac ? 'normal' : 'large' });
    return img.isEmpty() ? null : img.toDataURL();
  } catch {
    return null;
  }
}

// Bare program names: on Windows a command in the system folders, on macOS an app by its name.
const macAppDirs = () => ['/Applications', '/Applications/Utilities', '/System/Applications', '/System/Applications/Utilities', path.join(app.getPath('home'), 'Applications')];
const expandHome = (file) => (isMac && /^~(?=\/|$)/.test(file) ? path.join(app.getPath('home'), file.slice(1)) : file);
function resolveBare(name) {
  if (isMac) {
    const bundle = /\.app$/i.test(name) ? name : name + '.app';
    return macAppDirs().map((dir) => path.join(dir, bundle)).find((p) => fs.existsSync(p)) || name;
  }
  const winDir = process.env.WINDIR || 'C:\\Windows';
  return [path.join(winDir, 'System32', name), path.join(winDir, name)].find((p) => fs.existsSync(p)) || name;
}

// Runs a shell command and reports how it ended; `open` returns as soon as the app has been handed over.
function runShell(cmd) {
  return new Promise((resolve) => {
    let err = '';
    const child = spawn(cmd, { shell: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => resolve({ ok: false, error: String(e.message || e) }));
    child.on('close', (code) => resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim() || `Foutcode ${code}` }));
  });
}

ipcMain.handle('tile:pickFile', async () => {
  const res = await dialog.showOpenDialog(win(), isMac ? {
    title: 'Kies een programma of bestand',
    defaultPath: '/Applications',
    properties: ['openFile'],
  } : {
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
    let file = expandHome(tile.target.trim());
    if (!/[\\/]/.test(file)) file = resolveBare(file);
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
  const target = expandHome(tile.target.trim());
  if (isMac) {
    const args = (tile.args || '').trim();
    const quoted = `"${target.replace(/(["\\$`])/g, '\\$1')}"`;
    // Apps (by name or as a bundle) go through `open`, which also passes the parameters on.
    if (/\.app\/?$/i.test(target) || !target.includes('/')) return runShell(`open -a ${quoted}` + (args ? ` --args ${args}` : ''));
    if (!args) {
      const err = await shell.openPath(target);
      return err ? { ok: false, error: err } : { ok: true };
    }
    try {
      const child = spawn(`${quoted} ${args}`, { shell: true, detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }
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


module.exports = {};
