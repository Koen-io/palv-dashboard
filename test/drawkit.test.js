'use strict';

// Tekenkit (src/renderer/drawkit.js): the geometry every drawing surface shares — moving, turning and
// scaling elements, two fingers on an object, the hit test, and which press picks an object up — plus the
// COA symbols of the TACSOP (wb-icons-coa.js). The renderer scripts share their top-level names, so they
// are run here in one context with the few browser helpers they need stubbed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const R = path.join(__dirname, '..', 'src', 'renderer');
const ctx = { console, Math, JSON, setTimeout, clearTimeout, document: { createElement: () => ({ getContext: () => ({ font: '', measureText: (t) => ({ width: String(t).length * 10 }) }) }) } };
vm.createContext(ctx);
for (const f of ['whiteboard/wb-icons.js', 'whiteboard/wb-icons-air.js', 'whiteboard/wb-icons-tac.js', 'whiteboard/wb-icons-coa.js', 'drawkit.js']) vm.runInContext(fs.readFileSync(path.join(R, f), 'utf8'), ctx, { filename: f });
const run = (src) => vm.runInContext(src, ctx);
const DK = run('DK');
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('tekenkit: verplaatsen, draaien en schalen van een icoon', () => {
  const ic = { type: 'icon', icon: 'aw139', x: 100, y: 50, size: 80, rot: 0 };
  const t = DK.transform(ic, { drot: 30, f: 1.5, dx: 10, dy: -5 });
  assert.strictEqual(t.rot, 30);
  assert.strictEqual(t.size, 120);
  assert.deepStrictEqual(JSON.parse(JSON.stringify([t.x, t.y])), [110, 45]);
  assert.strictEqual(ic.rot, 0, 'het origineel blijft ongemoeid');
  // Turning lands on a multiple of 45 degrees when it is close, and goes in steps of 15 with Shift.
  assert.strictEqual(DK.transform(ic, { drot: 43 }).rot, 45);
  assert.strictEqual(DK.transform(ic, { drot: 52 }).rot, 52);
  assert.strictEqual(DK.transform(ic, { drot: 52, fine: true }).rot, 45);
  assert.strictEqual(DK.transform({ ...ic, rot: 350 }, { drot: 20 }).rot, 10, 'over de 360 heen');
});

test('tekenkit: een lijn draait met haar punten, een kaart draait nooit', () => {
  const ln = { type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, width: 4 };
  const t = DK.transform(ln, { drot: 90 });
  close(t.x1, 50, 1e-9, 'x1'); close(t.y1, -50, 1e-9, 'y1'); close(t.x2, 50, 1e-9, 'x2'); close(t.y2, 50, 1e-9, 'y2');
  assert.strictEqual(t.rot, 0);
  const map = { type: 'map', x: 0, y: 0, w: 100, h: 50, zoom: 12 };
  assert.strictEqual(DK.transform(map, { drot: 30 }).rot, undefined);
  assert.strictEqual(DK.canRotate(map), false);
});

test('tekenkit: twee vingers draaien, schalen (na een dode zone) en verplaatsen', () => {
  const ic = { type: 'icon', icon: 'aw139', x: 0, y: 0, size: 100, rot: 10 };
  const st = DK.pinchStart(ic, [-50, 0], [50, 0]);
  // A quarter turn clockwise (y down), same spread: only the turn.
  let r = DK.pinchApply(st, [0, -50], [0, 50]);
  assert.strictEqual(r.e.rot, 100);
  assert.strictEqual(r.e.size, 100, 'gelijke spreiding: niet schalen');
  // A little wider (within the dead zone): still no scaling.
  r = DK.pinchApply(st, [-52, 0], [52, 0]);
  assert.strictEqual(r.e.size, 100);
  // Twice as wide and moved 20 to the right: scaled (less the dead zone) and moved.
  r = DK.pinchApply(st, [-80, 0], [120, 0]);
  close(r.e.size, 100 * Math.exp(Math.log(2) - 0.06), 1e-6, 'schaal');
  assert.deepStrictEqual([r.e.x, r.e.y].map(Number), [20, 0]);
});

test('tekenkit: raken, met de draaiing van het element', () => {
  const rect = { type: 'rect', x: 0, y: 0, w: 200, h: 20, fill: true, rot: 90 };
  // Turned a quarter about its centre (100, 10): it now stands upright from y -90 to 110.
  assert.ok(DK.hitOne(rect, 100, 100, 1));
  assert.ok(!DK.hitOne(rect, 180, 10, 1));
  const open = { type: 'rect', x: 0, y: 0, w: 100, h: 100, fill: false };
  assert.ok(DK.hitOne(open, 1, 50, 4), 'op de rand');
  assert.ok(!DK.hitOne(open, 50, 50, 4), 'binnen een lege rechthoek is niets');
  const list = [{ type: 'map', lock: true, x: 0, y: 0, w: 500, h: 500, id: 'm' }, { type: 'icon', icon: 'aw139', x: 50, y: 50, size: 40, id: 'i' }];
  assert.strictEqual(DK.hit(list, 50, 50).id, 'i');
  assert.strictEqual(DK.hit(list, 300, 300), null, 'een vergrendelde kaart is ondergrond');
});

test('tekenkit: wat een druk op een object doet, per gereedschap', () => {
  const ic = { type: 'icon', icon: 'aw139', id: 'a' }, ship = { type: 'icon', icon: 'coaship', id: 's' }, ln = { type: 'line', id: 'l' };
  assert.strictEqual(DK.grabMode('select', ln, null), 'now');
  assert.strictEqual(DK.grabMode('pen', ln, 'l'), 'now', 'de selectie pak je in elk gereedschap');
  assert.strictEqual(DK.grabMode('pen', ln, null), 'hold', 'met de pen: even vasthouden');
  assert.strictEqual(DK.grabMode('icon', ic, null), 'now', 'met het icoongereedschap: een icoon direct');
  assert.strictEqual(DK.grabMode('eraser', ic, 'a'), null);
  assert.strictEqual(DK.grabMode('pen', ship, null), null, 'op het schip teken je, je pakt het niet op');
  assert.strictEqual(DK.grabMode('select', ship, null), 'now');
  assert.ok(DK.isUnderlay(ship) && !DK.isUnderlay(ic));
});

test('COA-symbolen: alle 14 uit de TACSOP, plus het tactische schip, bovenaan bij de snelle iconen', () => {
  const ids = JSON.parse(run('JSON.stringify(COA_SYMBOLS.map((s) => s[0]))'));
  assert.strictEqual(ids.length, 14);
  assert.strictEqual(new Set(ids).size, 14);
  for (const id of ids) {
    const ic = run(`wbIconById(${JSON.stringify(id)})`);
    assert.ok(ic && ic.cat === 'coa', id);
    assert.ok(/currentColor/.test(ic.svg) && !/#[0-9a-f]{3,6}/i.test(ic.svg), `${id} volgt de kleur van de pen`);
  }
  // Fastrope on the left is the mirror image of the one on the right.
  assert.ok(run(`wbIconById('coa_ah_lf').svg`).includes('matrix(-1 0 0 1 64 0)'));
  const quick = JSON.parse(run('JSON.stringify(dkQuickIcons().map((i) => i.id))'));
  assert.deepStrictEqual(quick.slice(0, 2), ['coaship', 'shipsectors']);
  assert.deepStrictEqual(quick.slice(2, 16), ids);
  assert.ok(quick.includes('aw139') && quick.includes('ec135'), 'de helikopters staan erbij');
  assert.ok(quick.indexOf('aw139') < quick.indexOf('aw139s'), 'bovenaanzicht voor zijaanzicht');
});

test('tekenkit: de punt van een vrije pijl wijst in de laatste tekenrichting', () => {
  // A hook: first to the right, then down; the head must point down (90 degrees), not to the right.
  const pts = [[0, 0], [50, 0], [100, 0], [100, 20], [100, 40], [100, 60], [100.4, 61]];
  const hd = DK.pathHead(pts, 4);
  assert.deepStrictEqual([hd.x, hd.y].map(Number), [100.4, 61]);
  close((hd.a * 180) / Math.PI, 90, 2, 'richting');
  assert.strictEqual(DK.pathHead([[5, 5]], 4), null);
  assert.ok(DK.selectAfter({ type: 'path', arrow: 'end' }) && !DK.selectAfter({ type: 'path' }));
});

test('tekenkit: ongedaan maken en opnieuw, per bord, tot 1000 stappen', () => {
  const H = run('dkHistory()');
  H.push('b1', [{ id: 'a', before: null, after: { x: 1 } }]);
  H.push('b1', [{ id: 'a', before: { x: 1 }, after: { x: 2 } }]);
  H.push('b2', [{ id: 'z', before: null, after: { x: 9 } }]);
  assert.strictEqual(H.count('b1').undo, 2);
  assert.strictEqual(JSON.stringify(H.take('b1', false)), JSON.stringify([{ id: 'a', item: { x: 1 } }]));
  assert.strictEqual(JSON.stringify(H.take('b1', false)), JSON.stringify([{ id: 'a', item: null }]));
  assert.strictEqual(H.take('b1', false), null, 'niets meer terug');
  assert.strictEqual(JSON.stringify(H.take('b1', true)), JSON.stringify([{ id: 'a', item: { x: 1 } }]));
  assert.strictEqual(H.count('b2').undo, 1, 'een ander bord houdt zijn eigen geschiedenis');
  H.push('b1', [{ id: 'q', before: null, after: {} }]);
  assert.strictEqual(H.count('b1').redo, 0, 'een nieuwe stap wist het opnieuw-doen');
  // Clearing a board is one step for all its elements.
  H.push('b1', [{ id: 'a', before: { x: 1 }, after: null }, { id: 'q', before: {}, after: null }]);
  assert.strictEqual(H.take('b1', false).length, 2);
  for (let i = 0; i < 1200; i += 1) H.push('big', [{ id: String(i), before: null, after: {} }]);
  assert.strictEqual(H.count('big').undo, 1000);
});

test('tekenkit: stippellijn voor streken, lijnen en vormen, nooit voor de markeerstift', () => {
  assert.ok(DK.canDash({ type: 'path', pts: [] }));
  assert.ok(!DK.canDash({ type: 'path', marker: true, pts: [] }), 'markeerstift niet');
  for (const type of ['line', 'rect', 'ellipse']) assert.ok(DK.canDash({ type }), type);
  for (const type of ['text', 'icon', 'map']) assert.ok(!DK.canDash({ type }), type);
  assert.strictEqual(JSON.stringify(DK.dashArray(4)), '[8,12]');
});
