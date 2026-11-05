// Locks on a whiteboard or mission: the PIN, the sealing of the shared items, and what each screen sees.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const locks = require('../src/plan/locks');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palv-slot-'));
locks.load(dir);

test('pincode: 6 tot 12 cijfers, sleutel alleen uit de juiste pincode', () => {
  assert.throws(() => locks.create('1234', 'te kort'), /6 tot 12/);
  assert.throws(() => locks.create('abcdef', 'letters'), /6 tot 12/);
  const lock = locks.create('240681', 'verjaardag', 'PC-QRA');
  assert.ok(lock.id && lock.salt && lock.check);
  assert.strictEqual(lock.hint, 'verjaardag');
  assert.strictEqual(lock.by, 'PC-QRA');
  assert.ok(locks.has(lock.id), 'de maker heeft de sleutel');
  locks.forget(lock.id);
  assert.ok(!locks.has(lock.id));
  assert.strictEqual(locks.open(lock, '000000'), false, 'verkeerde pincode');
  assert.ok(!locks.has(lock.id));
  assert.strictEqual(locks.open(lock, '240681'), true);
  assert.ok(locks.has(lock.id));
});

test('de sleutels overleven een herstart via het lokale bestand, met alleen-eigenaar-rechten', () => {
  const lock = locks.create('112233', 'test');
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'palv-locks.json'), 'utf8'));
  assert.ok(d.keys[lock.id], 'sleutel in het bestand');
  assert.ok(!JSON.stringify(d).includes('112233'), 'de pincode zelf staat er niet in');
  locks._keys.clear();
  locks.load(dir);
  assert.ok(locks.has(lock.id));
});

test('te vaak fout: even wachten', () => {
  const lock = locks.create('999999', 'x');
  locks.forget(lock.id);
  for (let i = 0; i < 5; i += 1) assert.strictEqual(locks.open(lock, '111111'), false);
  assert.throws(() => locks.open(lock, '999999'), /wacht/);
  locks._fails.delete(lock.id);
  assert.strictEqual(locks.open(lock, '999999'), true);
});

test('een element van een vergrendeld bord gaat verzegeld de gedeelde bestanden in en komt hier open terug', () => {
  const lock = locks.create('654321', 'hint');
  const data = { boards: { b1: { name: 'Operatie X', bg: 'white', lock, thumb: 'data:image/jpeg;base64,AAA', updatedAt: 1 } }, elements: {} };
  const el = { board: 'b1', type: 'text', text: 'Geheim doel', x: 10, y: 20, size: 18 };
  const stored = locks.toStore('boards', 'elements', 'e1', el, data);
  assert.strictEqual(stored.board, 'b1', 'het bord blijft leesbaar');
  assert.strictEqual(stored.lockId, lock.id);
  assert.ok(stored.enc && !('text' in stored) && !('type' in stored), 'inhoud alleen als ciphertext');
  assert.ok(!stored.enc.includes('Geheim'));
  const seen = locks.toView('boards', 'elements', 'e1', stored);
  assert.strictEqual(seen.text, 'Geheim doel');
  assert.strictEqual(seen.type, 'text');
  assert.ok(!seen.enc);
  // the board itself: the thumbnail is sealed, the name is not
  const b = locks.toStore('boards', 'boards', 'b1', data.boards.b1, data);
  assert.strictEqual(b.name, 'Operatie X');
  assert.ok(!('thumb' in b) && b.enc);
  const bv = locks.toView('boards', 'boards', 'b1', b);
  assert.strictEqual(bv.thumb, 'data:image/jpeg;base64,AAA');
  assert.strictEqual(bv.lockOpen, true);
  // another screen (no key): only that it is locked
  locks.forget(lock.id);
  const other = locks.toView('boards', 'elements', 'e1', stored);
  assert.strictEqual(other.locked, true);
  assert.ok(!('text' in other));
  assert.strictEqual(locks.toView('boards', 'boards', 'b1', b).lockOpen, false);
  assert.throws(() => locks.toStore('boards', 'elements', 'e2', { board: 'b1', type: 'rect' }, data), /Vergrendeld/);
  // a sealed element under another lock's key cannot be read (the lock id is bound in)
  assert.strictEqual(locks.open(lock, '654321'), true);
  const other2 = locks.create('654321', 'zelfde pincode, ander slot');
  assert.strictEqual(locks.toView('boards', 'elements', 'e1', { ...stored, lockId: other2.id }).locked, true, 'ander slot: niet te openen');
});

test('missievelden: verzegeld per veld, de missie zelf blijft leesbaar', () => {
  const lock = locks.create('778899', 'm');
  const data = { missions: { m1: { name: 'Bijstand', status: 'planning', lock } }, fields: {} };
  const f = locks.toStore('missions', 'fields', 'm1:order.order.mission', { v: 'Arrestatie in Almere', by: 'PC' }, data);
  assert.ok(f.enc && !('v' in f));
  assert.strictEqual(locks.toView('missions', 'fields', 'm1:order.order.mission', f).v, 'Arrestatie in Almere');
  const plain = locks.toStore('missions', 'fields', 'm2:order.order.mission', { v: 'open' }, data);
  assert.strictEqual(plain.v, 'open', 'een andere missie zonder slot blijft gewoon');
  const m = locks.toStore('missions', 'missions', 'm1', data.missions.m1, data);
  assert.strictEqual(m.name, 'Bijstand');
  assert.strictEqual(m.status, 'planning');
});

test('vergrendelen en ontgrendelen herschrijft alles van het bord', () => {
  const lock = locks.create('135791', 'r');
  const raw = { boards: { b1: { name: 'B', bg: 'white' }, b2: { name: 'ander' } }, elements: { e1: { board: 'b1', type: 'rect', x: 1, y: 2, w: 3, h: 4, updatedAt: 5 }, e2: { board: 'b2', type: 'rect', x: 0, y: 0, w: 1, h: 1 }, e3: { board: 'b1', deleted: true, updatedAt: 6 } } };
  const sealedItems = locks.rewrite('boards', 'b1', raw, lock);
  assert.deepStrictEqual(sealedItems.map((x) => x.id), ['e1'], 'alleen de levende elementen van b1');
  assert.ok(sealedItems[0].item.enc && sealedItems[0].item.board === 'b1');
  const after = { ...raw, boards: { ...raw.boards, b1: { ...raw.boards.b1, lock } }, elements: { ...raw.elements, e1: sealedItems[0].item } };
  const opened = locks.rewrite('boards', 'b1', after, null);
  assert.strictEqual(opened[0].item.type, 'rect');
  assert.strictEqual(opened[0].item.w, 3);
  assert.ok(!opened[0].item.enc && !opened[0].item.lockId);
  const v = locks.view('boards', after);
  assert.strictEqual(v.elements.e1.type, 'rect');
  assert.strictEqual(v.boards.b1.lockOpen, true);
  locks.forget(lock.id);
  assert.strictEqual(locks.view('boards', after).elements.e1.locked, true);
  assert.throws(() => locks.rewrite('boards', 'b1', after, null), /andere sleutel/);
});
