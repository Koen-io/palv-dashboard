// Zoek & Plan: what the tab keeps besides the dashboard layout, in two files in the user data folder.
// - plan-private.json: the unit's own figures from its manuals (profile values laid over the public ones),
//   the helideck list (heading, height, D/t, frequency ... per platform) and the openAIP key. Internal:
//   readable for this user only, never in the code, and only passed on to the unit's own screens.
// - plan-shared.json: saved routes, favourite places and bases.
// Both are lists of items with an `updatedAt`; between screens the newest version of each item wins and a
// deleted item stays behind as a tombstone for a while, so a deletion travels as well as a change.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = {
  private: { file: 'plan-private.json', mode: 0o600, lists: ['profiles', 'decks', 'keys'] },
  shared: { file: 'plan-shared.json', mode: 0o644, lists: ['routes', 'favorites', 'bases'] },
};
const TOMBSTONE_DAYS = 60;

let dir = null, log = { info() {}, warn() {} };
const data = {};
const listeners = new Set();

const empty = (kind) => Object.fromEntries(KINDS[kind].lists.map((l) => [l, {}]));

function load(kind) {
  const file = path.join(dir, KINDS[kind].file);
  let d = null;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first start */ }
  const out = empty(kind);
  for (const l of KINDS[kind].lists) if (d && d[l] && typeof d[l] === 'object') out[l] = d[l];
  return out;
}

function write(kind) {
  const file = path.join(dir, KINDS[kind].file), tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data[kind], null, 1), { mode: KINDS[kind].mode });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, KINDS[kind].mode); } catch { /* not on every file system */ }
}

function start(opts) {
  dir = opts.dir;
  if (opts.log) log = opts.log;
  for (const kind of Object.keys(KINDS)) { data[kind] = load(kind); prune(kind); }
}

function prune(kind) {
  const cut = Date.now() - TOMBSTONE_DAYS * 864e5;
  for (const l of KINDS[kind].lists) for (const [id, it] of Object.entries(data[kind][l])) if (it && it.deleted && it.updatedAt < cut) delete data[kind][l][id];
}

// Everything of a kind, without tombstones; `withDeleted` for passing on to another screen.
function get(kind, { withDeleted = false } = {}) {
  const d = data[kind];
  if (withDeleted) return JSON.parse(JSON.stringify(d));
  return Object.fromEntries(KINDS[kind].lists.map((l) => [l, Object.fromEntries(Object.entries(d[l]).filter(([, it]) => it && !it.deleted))]));
}

// One item set (or removed with item = null) by this screen.
function put(kind, list, id, item) {
  if (!KINDS[kind] || !KINDS[kind].lists.includes(list)) throw new Error('onbekende lijst');
  const key = String(id).slice(0, 200);
  const now = Date.now();
  data[kind][list][key] = item == null ? { deleted: true, updatedAt: now } : { ...item, updatedAt: now };
  write(kind);
  emit(kind);
  return get(kind);
}

// What another screen has: per item the newest version wins. Returns whether anything changed here.
function merge(kind, remote) {
  if (!remote || typeof remote !== 'object' || !KINDS[kind]) return false;
  let changed = false;
  for (const l of KINDS[kind].lists) {
    const theirs = remote[l];
    if (!theirs || typeof theirs !== 'object') continue;
    for (const [id, it] of Object.entries(theirs)) {
      if (!it || typeof it !== 'object' || !(it.updatedAt > 0) || it.updatedAt > Date.now() + 864e5) continue;
      const mine = data[kind][l][id];
      if (!mine || it.updatedAt > mine.updatedAt) { data[kind][l][id] = it; changed = true; }
    }
  }
  if (changed) { write(kind); emit(kind); }
  return changed;
}

// A short fingerprint of the contents, told in the status so screens only fetch from each other on a change.
function digest(kind) {
  const d = data[kind];
  const parts = [];
  for (const l of KINDS[kind].lists) for (const id of Object.keys(d[l]).sort()) parts.push(`${l}/${id}/${d[l][id].updatedAt}`);
  return crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
}
const digests = () => Object.fromEntries(Object.keys(KINDS).map((k) => [k, digest(k)]));

function emit(kind) { for (const fn of listeners) { try { fn(kind); } catch (err) { log.warn('plan', 'bijwerken mislukt', err.message); } } }
const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// Import of a profile file made from the manuals (the analysis JSON): replaces this screen's private profile.
function importProfiles(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('Geen profielbestand');
  const ids = Object.keys(obj).filter((k) => ['ec135', 'aw139'].includes(k));
  if (!ids.length) throw new Error('Het bestand bevat geen profiel voor EC135 of AW139');
  for (const id of ids) data.private.profiles[id] = { ...obj[id], updatedAt: Date.now() };
  write('private');
  emit('private');
  return ids;
}

module.exports = { start, get, put, merge, digest, digests, onChange, importProfiles, KINDS };
