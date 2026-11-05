// Locks on a whiteboard or a mission plan: the contents are only readable on the screen that locked them
// and on the screens where the PIN was entered. Everything that travels between the screens (the shared
// files, see store.js) carries only ciphertext for a locked board or mission; the name, the lock itself
// and the hint stay readable, so another screen can see that there is something and ask for the PIN.
//
// The key comes from the PIN with scrypt (a random salt per lock, N = 2^17: a good third of a second per
// try, so guessing offline stays slow); each item is sealed with AES-256-GCM under a fresh random nonce,
// with the lock's id as associated data, so ciphertext of one lock never opens under another. The keys of
// the locks this screen may read are kept in palv-locks.json (readable for this user only), so the board
// stays visible here after a restart. The PIN itself is never stored.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const V = 1;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const CHECK_TEXT = 'palv-lock-v1';
const PIN_RE = /^\d{6,12}$/;
const FAILS_BEFORE_WAIT = 5, WAIT_MS = 30000;

let file = null, log = { info() {}, warn() {} };
const keys = new Map();   // lockId -> Buffer (32)
const fails = new Map();  // lockId -> { n, until }

function load(dir, lg) {
  if (lg) log = lg;
  file = path.join(dir, 'palv-locks.json');
  keys.clear();
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (d && d.v === V && d.keys && typeof d.keys === 'object') for (const [id, k] of Object.entries(d.keys)) { const b = Buffer.from(String(k), 'base64url'); if (b.length === 32) keys.set(id, b); }
  } catch { /* none yet */ }
}
function save() {
  if (!file) return;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: V, keys: Object.fromEntries([...keys].map(([id, k]) => [id, k.toString('base64url')])) }, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* not on every file system */ }
}

const validPin = (pin) => PIN_RE.test(String(pin || ''));
const derive = (pin, salt) => crypto.scryptSync(String(pin), salt, 32, SCRYPT);

function sealWith(key, lockId, obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(String(lockId)));
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final()]);
  return Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}
function openWith(key, lockId, enc) {
  try {
    const buf = Buffer.from(String(enc), 'base64');
    if (buf.length < 12 + 16) return null;
    const iv = buf.subarray(0, 12), tag = buf.subarray(buf.length - 16), ct = buf.subarray(12, buf.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(Buffer.from(String(lockId)));
    d.setAuthTag(tag);
    return JSON.parse(Buffer.concat([d.update(ct), d.final()]).toString('utf8'));
  } catch { return null; }
}

/* ---------- the lock itself ---------- */
// A new lock: the public part (goes into the shared file) and the key (stays here).
function create(pin, hint, by) {
  if (!validPin(pin)) throw new Error('De pincode bestaat uit 6 tot 12 cijfers');
  const id = crypto.randomBytes(8).toString('hex');
  const salt = crypto.randomBytes(16);
  const key = derive(pin, salt);
  const lock = { id, salt: salt.toString('base64'), check: sealWith(key, id, CHECK_TEXT), hint: String(hint || '').slice(0, 120), by: String(by || '').slice(0, 60), createdAt: Date.now() };
  keys.set(id, key);
  save();
  return lock;
}
// The PIN against an existing lock: on success the key is kept here.
function open(lock, pin) {
  if (!lock || !lock.id || !lock.salt || !lock.check) throw new Error('Geen geldig slot');
  const f = fails.get(lock.id);
  if (f && f.until > Date.now()) { const s = Math.ceil((f.until - Date.now()) / 1000); throw new Error(`Te vaak een verkeerde pincode: wacht ${s} seconden`); }
  if (!validPin(pin)) throw new Error('De pincode bestaat uit 6 tot 12 cijfers');
  const key = derive(pin, Buffer.from(lock.salt, 'base64'));
  if (openWith(key, lock.id, lock.check) !== CHECK_TEXT) {
    const n = (f ? f.n : 0) + 1;
    fails.set(lock.id, { n, until: n >= FAILS_BEFORE_WAIT ? Date.now() + WAIT_MS : 0 });
    log.warn('slot', `verkeerde pincode voor slot ${lock.id} (${n}×)`);
    return false;
  }
  fails.delete(lock.id);
  keys.set(lock.id, key);
  save();
  return true;
}
const has = (lockId) => keys.has(lockId);
function forget(lockId) { if (keys.delete(lockId)) save(); }
const seal = (lockId, obj) => (keys.has(lockId) ? sealWith(keys.get(lockId), lockId, obj) : null);
const unseal = (lockId, enc) => (keys.has(lockId) ? openWith(keys.get(lockId), lockId, enc) : null);

/* ---------- the shared files: what is sealed, what is shown ---------- */
// Which lock governs an item, from the raw data of its kind: a whiteboard element belongs to its board, a
// mission field (id "<mission>:<key>") to its mission. The board or mission item carries `lock`.
function lockOf(kind, list, id, item, data) {
  if (kind === 'boards') {
    if (list === 'boards') return item && item.lock ? item.lock : null;
    if (list === 'elements') { const bid = item && item.board; const b = bid && data.boards && data.boards[bid]; return b && b.lock ? b.lock : null; }
  }
  if (kind === 'missions') {
    if (list === 'missions') return item && item.lock ? item.lock : null;
    if (list === 'fields') { const mid = String(id).split(':')[0]; const m = data.missions && data.missions[mid]; return m && m.lock ? m.lock : null; }
  }
  return null;
}
// Fields that stay readable on a sealed item: enough to know where it belongs, never what it says.
const KEEP = { 'boards/elements': ['board'], 'boards/boards': ['name', 'bg', 'createdAt', 'by', 'n', 'lock', 'order'], 'missions/fields': [], 'missions/missions': ['name', 'status', 'createdAt', 'by', 'order', 'lock', 'lhour'] };
// An item as it must be stored: sealed when its board or mission is locked. Throws when this screen has no
// key for that lock (it may not change what it cannot read). `deleted` items pass as they are.
function toStore(kind, list, id, item, data) {
  if (item == null || item.deleted) return item;
  const lock = lockOf(kind, list, id, item, data);
  if (!lock) return item;
  if (!keys.has(lock.id)) throw new Error('Vergrendeld: op dit scherm niet te bewerken zonder pincode');
  const keep = KEEP[`${kind}/${list}`] || [];
  const out = { lockId: lock.id };
  const secret = {};
  for (const [k, v] of Object.entries(item)) { if (k === 'updatedAt' || k === 'lockId' || k === 'enc') continue; if (keep.includes(k)) out[k] = v; else secret[k] = v; }
  if (Object.keys(secret).length) out.enc = seal(lock.id, secret);
  if (item.updatedAt) out.updatedAt = item.updatedAt;
  return out;
}
// An item as the dashboard sees it: opened when the key is here, otherwise only the readable fields and
// `locked: true`. A board or mission with a lock gets `lockOpen` so the tab knows whether it may draw.
function toView(kind, list, id, item) {
  if (!item || item.deleted || !item.lockId) {
    if (item && item.lock && (list === 'boards' || list === 'missions')) return { ...item, lockOpen: keys.has(item.lock.id) };
    return item;
  }
  const out = { ...item };
  delete out.enc;
  if (item.enc && keys.has(item.lockId)) {
    const secret = unseal(item.lockId, item.enc);
    if (secret && typeof secret === 'object') Object.assign(out, secret); else out.locked = true;
  } else if (item.enc) out.locked = true;
  if (out.lock) out.lockOpen = keys.has(out.lock.id);
  return out;
}
function view(kind, data) {
  if (kind !== 'boards' && kind !== 'missions' || !data) return data;
  const out = {};
  for (const [list, items] of Object.entries(data)) out[list] = Object.fromEntries(Object.entries(items || {}).map(([id, it]) => [id, toView(kind, list, id, it)]));
  return out;
}

// Everything of a board or mission as it is in the raw store, with the items that must be rewritten when a
// lock is put on (seal) or taken off (open). Returns [{ list, id, item }] ready for store.putMany.
function rewrite(kind, ownerId, data, lock) {
  const out = [];
  const lists = kind === 'boards' ? [['elements', (id, it) => it.board === ownerId]] : [['fields', (id) => String(id).startsWith(ownerId + ':')]];
  for (const [list, mine] of lists) {
    for (const [id, it] of Object.entries(data[list] || {})) {
      if (!it || it.deleted || !mine(id, it)) continue;
      const plain = toView(kind, list, id, it);
      if (plain.locked) throw new Error('Een deel van de inhoud is met een andere sleutel vergrendeld');
      const clean = { ...plain }; delete clean.lockId; delete clean.locked; delete clean.lockOpen; delete clean.updatedAt;
      if (lock) {
        const keep = KEEP[`${kind}/${list}`] || [];
        const sealed = { lockId: lock.id }; const secret = {};
        for (const [k, v] of Object.entries(clean)) { if (keep.includes(k)) sealed[k] = v; else secret[k] = v; }
        if (Object.keys(secret).length) sealed.enc = seal(lock.id, secret);
        out.push({ list, id, item: sealed });
      } else out.push({ list, id, item: clean });
    }
  }
  return out;
}

module.exports = { load, create, open, has, forget, seal, unseal, validPin, lockOf, toStore, toView, view, rewrite, KEEP, _keys: keys, _fails: fails };
