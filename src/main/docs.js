// (De)Briefing: the briefing and debriefing documents of the unit, as an image or a PDF, kept in the
// unit's private file (plan-private.json, list 'docs'), so every screen of the unit gets them and
// nothing of it is ever in the code or the repository. A PDF is written to the user data folder for
// the built-in viewer; an image goes to the dashboard as it is.
const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog } = require('electron');

const MAX = 12 * 1024 * 1024;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', pdf: 'application/pdf' };
const SLOTS = ['briefing', 'debriefing'];

let store = null, getWin = () => null, poke = () => {};

function start(opts) {
  ({ store, getWin, poke } = opts);
  const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  ipcMain.handle('docs:pick', safe(async (_e, slot) => {
    if (!SLOTS.includes(slot)) throw new Error('Onbekend document');
    const res = await dialog.showOpenDialog(getWin(), { title: `${slot === 'briefing' ? 'Briefing' : 'Debriefing'}: afbeelding of pdf kiezen`, filters: [{ name: 'Afbeelding of PDF', extensions: Object.keys(TYPES) }], properties: ['openFile'] });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    const src = res.filePaths[0], ext = path.extname(src).slice(1).toLowerCase();
    if (!TYPES[ext]) throw new Error('Kies een png, jpg, webp of pdf');
    const size = fs.statSync(src).size;
    if (size > MAX) throw new Error('Dit bestand is groter dan 12 MB');
    const item = { name: path.basename(src), type: TYPES[ext], size, data: fs.readFileSync(src).toString('base64'), by: require('os').hostname() };
    store.put('private', 'docs', slot, item);
    poke();
    return { ok: true, name: item.name, type: item.type, size };
  }));
  ipcMain.handle('docs:remove', safe((_e, slot) => { if (!SLOTS.includes(slot)) throw new Error('Onbekend document'); store.put('private', 'docs', slot, null); poke(); return { ok: true }; }));
  // A PDF as a file for the viewer: written once per version of the document.
  ipcMain.handle('docs:file', safe((_e, slot) => {
    const d = store.get('private').docs[slot];
    if (!d || !d.data) throw new Error('Geen document');
    const dir = path.join(app.getPath('userData'), 'docs');
    fs.mkdirSync(dir, { recursive: true });
    const ext = Object.keys(TYPES).find((k) => TYPES[k] === d.type) || 'bin';
    const file = path.join(dir, `${slot}-${d.updatedAt || 0}.${ext}`);
    if (!fs.existsSync(file)) {
      for (const old of fs.readdirSync(dir)) if (old.startsWith(slot + '-')) fs.rmSync(path.join(dir, old), { force: true });
      fs.writeFileSync(file, Buffer.from(d.data, 'base64'));
    }
    return { ok: true, path: file, type: d.type };
  }));
}

module.exports = { start, SLOTS };
