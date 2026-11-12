'use strict';

// COA Planner: the calculation core. The reference numbers come from the original tool (app.py on PC QRA)
// and the screenshots of the iOS app (which rounds; the original truncates with int()).
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/renderer/coa/coa-calc.js');

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const angClose = (a, b, tol, msg) => assert.ok(Math.abs(C.signed(a - b)) <= tol, `${msg}: ${a} vs ${b}`);

// The formula of the original, line by line (bereken_relatieve_wind).
function original(course, bs, wd, ws) {
  const r = (d) => (d * Math.PI) / 180;
  const sx = bs * Math.sin(r(course)), sy = bs * Math.cos(r(course));
  const wx = ws * Math.sin(r(wd - 180)), wy = ws * Math.cos(r(wd - 180));
  const ax = wx - sx, ay = wy - sy;
  return { dir: ((Math.atan2(ax, ay) * 180) / Math.PI + 180 + 360) % 360, spd: Math.hypot(ax, ay) };
}

test('schijnbare wind gelijk aan het origineel over een raster van invoer', () => {
  for (let course = 0; course < 360; course += 23) for (const bs of [0, 4, 10, 25]) for (let wd = 0; wd < 360; wd += 37) for (const ws of [0, 3, 15, 40]) {
    const a = C.apparent(course, bs, wd, ws), o = original(course, bs, wd, ws);
    close(a.spd, o.spd, 1e-9, `snelheid ${course}/${bs}/${wd}/${ws}`);
    if (o.spd > 1e-6) angClose(a.dir, o.dir, 1e-9, `richting ${course}/${bs}/${wd}/${ws}`);
  }
});

test('iPad-screenshot: AT 10, 10 kt, wind 000/10, BRC 221', () => {
  const list = C.coas(10, 221);
  assert.deepStrictEqual(list.map((c) => c.heading), [10, 100, 221, 280], 'COA 3 vaart exact de BRC');
  assert.deepStrictEqual(list.map((c) => c.brc), [false, false, true, false]);
  const want = [[5, 20], [50, 13], [291, 7], [320, 15]];
  list.forEach((c, i) => {
    const a = C.apparent(c.heading, 10, 0, 10);
    assert.strictEqual(Math.round(a.dir), want[i][0], `COA ${i + 1} richting`);
    assert.strictEqual(Math.round(a.spd), want[i][1], `COA ${i + 1} snelheid`);
  });
});

test('iPhone-screenshot: AT 45, 10 kt, wind 020/10, BRC 123', () => {
  const list = C.coas(45, 123);
  assert.deepStrictEqual(list.map((c) => c.heading), [45, 123, 225, 315]);
  const want = [[33, 20], [72, 12], [303, 4], [348, 17]];
  list.forEach((c, i) => {
    const a = C.apparent(c.heading, 10, 20, 10);
    assert.strictEqual(Math.round(a.dir), want[i][0], `COA ${i + 1} richting`);
    assert.strictEqual(Math.round(a.spd), want[i][1], `COA ${i + 1} snelheid`);
  });
});

test('COA-venster: ±45° om de COA-koers, één COA neemt de BRC', () => {
  assert.deepStrictEqual(C.coas(0, null).map((c) => c.heading), [0, 90, 180, 270]);
  assert.deepStrictEqual(C.coas(0, 45).map((c) => c.brc), [true, false, false, false], 'precies 45° hoort bij de eerste');
  assert.deepStrictEqual(C.coas(0, 46).map((c) => c.heading), [0, 46, 180, 270]);
  assert.deepStrictEqual(C.coas(350, 20).map((c) => c.heading), [20, 80, 170, 260], 'over noord heen');
  assert.strictEqual(C.coas(0, 359.4)[0].heading, 359.4, 'exacte koers, niet afgerond');
});

test('relatieve wind: rood/groen en de sectoren BOW, MID en STERN (139 voor de AW139)', () => {
  assert.strictEqual(C.relative(30, 0).text, 'G030');
  assert.strictEqual(C.relative(330, 0).text, 'R030');
  assert.strictEqual(C.relative(0, 0).text, '000');
  assert.strictEqual(C.relative(180, 0).text, '180');
  assert.strictEqual(C.relative(45, 0).sector, 'bow');
  assert.strictEqual(C.relative(46, 0).sector, 'mid');
  assert.strictEqual(C.relative(138, 0).sector, 'mid');
  assert.strictEqual(C.relative(139, 0).sector, 'stern');
  assert.strictEqual(C.relative(10, 350).text, 'G020', 'over noord heen');
});

test('helikopter op de AT: kopwind en zijwind van rechts of links', () => {
  const a = C.components(30, 20, 0);
  close(a.head, 17.32, 0.01, 'kopwind'); close(a.cross, 10, 0.01, 'zijwind'); assert.strictEqual(a.side, 'R');
  assert.strictEqual(C.components(330, 20, 0).side, 'L');
  assert.ok(C.components(180, 10, 0).head < -9.9, 'staartwind is negatief');
});

test('nadering gezien vanaf het schip en de zee ten opzichte van de koers', () => {
  const p = C.coaPicture({ n: 1, nominal: 0, heading: 0, brc: false }, { at: 0, bs: 10, wd: 0, ws: 10, gust: 18, waveDir: 90 });
  assert.strictEqual(p.approach.text, '180', 'heli op AT 000 komt van achteren');
  assert.strictEqual(p.approach.sector, 'stern');
  assert.strictEqual(p.sea.id, 'beam');
  assert.ok(p.gust.spd > p.app.spd);
  assert.strictEqual(C.seaRelative(10, 0).id, 'head');
  assert.strictEqual(C.seaRelative(170, 0).id, 'following');
});

test('gegist bestek: 60 NM naar het noorden is 1 graad', () => {
  const q = C.deadReckon(52, 4, 0, 10, 6);
  close(q.lat, 53, 0.005, 'breedte'); close(q.lon, 4, 1e-9, 'lengte'); close(q.nm, 60, 1e-9, 'afstand');
  const back = C.deadReckon(52, 4, 90, 12, -1);
  assert.ok(back.lon < 4, 'terugrekenen naar een H-uur in het verleden');
  const pos = C.positionAt({ lat: 52, lon: 4, dr: true, brc: 0, bs: 10, posAt: 0, hhour: 3 * 3600000 });
  assert.ok(pos.dr && Math.abs(pos.lat - 52.5) < 0.005);
  assert.strictEqual(C.positionAt({ lat: 52, lon: 4, dr: true, brc: null, bs: 10, posAt: 0, hhour: 3600000 }).dr, false, 'zonder koers geen gegist bestek');
  assert.strictEqual(C.positionAt({ lat: 52, lon: 4, dr: false, brc: 0, bs: 10, posAt: 0, hhour: 3600000 }).dr, false);
});

test('ware en magnetische graden', () => {
  assert.strictEqual(C.toMag(45, 2.5), 42.5);
  assert.strictEqual(C.toTrue(42.5, 2.5), 45);
  assert.strictEqual(C.toMag(1, 2), 359);
  assert.strictEqual(C.deg3(359.6), '000');
  assert.strictEqual(C.deg3(4.4), '004');
});

test('zon en maan: verblinding op de nadering, schaduw en licht', () => {
  assert.strictEqual(C.glare(100, 10, 80).on, true);
  assert.strictEqual(C.glare(100, 10, 40).on, false, 'te ver naast de track');
  assert.strictEqual(C.glare(100, 45, 100).on, false, 'te hoog');
  assert.strictEqual(C.shadow(180, -2), null, 'geen schaduw onder de horizon');
  assert.strictEqual(C.shadow(90, 45).dir, 270);
  close(C.shadow(90, 45).len, 1, 1e-9, 'lengte bij 45°');
  assert.strictEqual(C.lightPhase(5).id, 'day');
  assert.strictEqual(C.lightPhase(-8).id, 'nautical');
  assert.strictEqual(C.lightPhase(-20).id, 'night');
});

test('hoogte-deconflictie', () => {
  assert.strictEqual(C.parseFt('1500'), 1500);
  assert.strictEqual(C.parseFt('1.500 ft'), 1500);
  assert.strictEqual(C.parseFt('FL045'), 4500);
  assert.strictEqual(C.parseFt(''), null);
  const c = C.heightConflicts([{ cs: 'LION01', alt: '1000' }, { cs: 'LION02', alt: '1300' }, { cs: 'UAV', alt: '3000' }, { cs: '', alt: '' }], 500);
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].diff, 300);
  assert.strictEqual(c[0].a.name, 'LION01');
  assert.strictEqual(C.heightConflicts([{ alt: 1000 }, { alt: 1500 }], 500).length, 0, 'precies de scheiding is genoeg');
});

test('Douglas-zeegang', () => {
  assert.strictEqual(C.douglas(0.8).code, 3);
  assert.strictEqual(C.douglas(2.5).code, 5);
  assert.strictEqual(C.douglas(null), null);
});

test('migratie 12: het tabblad COA Planner komt na Offshore, één keer, en blijft weg als het is weggehaald', () => {
  const model = require('../src/renderer/model.js');
  const v11 = () => ({ version: 11, activePage: 2, settings: {}, pages: [{ id: 'a', name: 'Operationeel', widgets: [] }, { id: 'o', name: 'Offshore', widgets: [{ id: 'w', type: 'offshore', x: 0, y: 0, w: 96, h: 54, z: 1, cfg: {} }] }, { id: 'm', name: 'MadeSmart', widgets: [{ id: 'b', type: 'browser', x: 0, y: 0, w: 96, h: 54, z: 1, cfg: {} }] }] });
  const st = model.normalize(v11());
  assert.deepStrictEqual(st.pages.map((p) => p.name), ['Operationeel', 'Offshore', 'COA Planner', 'MadeSmart']);
  assert.strictEqual(st.activePage, 3, 'de pagina die open stond blijft open');
  const w = st.pages[2].widgets[0];
  assert.deepStrictEqual([w.type, w.x, w.y, w.w, w.h], ['coa', 0, 0, model.COLS, model.ROWS]);
  assert.strictEqual(model.normalize(JSON.parse(JSON.stringify(st))).pages.filter((p) => p.name === 'COA Planner').length, 1, 'een tweede keer niet nog eens');
  const removed = { ...st, pages: st.pages.filter((p) => p.name !== 'COA Planner') };
  assert.ok(!model.normalize(JSON.parse(JSON.stringify(removed))).pages.some((p) => p.name === 'COA Planner'), 'weggehaald blijft weg');
});

test('gedeelde bestanden: de COA-plannen gaan mee tussen de schermen', () => {
  const store = require('../src/plan/store.js');
  assert.deepStrictEqual(store.KINDS.coa.lists, ['plans', 'marks']);
});

test('zee t.o.v. het schip en sea state in de Engelse zeemanstermen', () => {
  assert.deepStrictEqual([0, 45, 90, 135, 180].map((a) => C.seaRelative(a, 0).name), ['Head sea', 'Sea on the bow', 'Beam sea', 'Quartering sea', 'Following sea']);
  assert.strictEqual(C.seaRelative(0, 0).motion, 'pitching');
  assert.strictEqual(C.seaRelative(180, 0).motion, 'yawing and surging');
  assert.strictEqual(C.douglas(1.0).name, 'Slight');
  assert.strictEqual(C.douglas(3.0).name, 'Rough');
  assert.strictEqual(C.douglas(20).name, 'Phenomenal');
});
