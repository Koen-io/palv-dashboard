// The shared files of the unit (timers, whiteboards, missions): several items in one write, fetching
// only what changed since a moment, merging between screens, and the migration that adds the tabs.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const freshStore = () => {
  delete require.cache[require.resolve('../src/plan/store')];
  const store = require('../src/plan/store');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palv-store-'));
  store.start({ dir });
  return { store, dir };
};

test('de drie nieuwe soorten bestaan, elk met hun lijsten', () => {
  const { store } = freshStore();
  assert.deepStrictEqual(store.KINDS.ops.lists, ['timers', 'presets']);
  assert.deepStrictEqual(store.KINDS.boards.lists, ['boards', 'elements']);
  assert.deepStrictEqual(store.KINDS.missions.lists, ['missions', 'fields']);
  assert.deepStrictEqual(store.get('boards'), { boards: {}, elements: {} });
});

test('putMany: meerdere items in één keer, in volgorde, en een verwijdering als grafsteen', () => {
  const { store, dir } = freshStore();
  store.putMany('boards', [{ list: 'boards', id: 'b1', item: { name: 'Bord' } }, { list: 'elements', id: 'e1', item: { board: 'b1', type: 'path' } }, { list: 'elements', id: 'e2', item: { board: 'b1', type: 'text' } }]);
  const got = store.get('boards');
  assert.strictEqual(got.boards.b1.name, 'Bord');
  assert.strictEqual(Object.keys(got.elements).length, 2);
  assert.ok(got.elements.e2.updatedAt > got.elements.e1.updatedAt, 'later item, later stempel');
  store.putMany('boards', [{ list: 'elements', id: 'e1', item: null }]);
  assert.strictEqual(store.get('boards').elements.e1, undefined);
  assert.strictEqual(store.get('boards', { withDeleted: true }).elements.e1.deleted, true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'palv-whiteboards.json'), 'utf8'));
  assert.strictEqual(onDisk.elements.e1.deleted, true, 'de grafsteen staat op schijf');
});

test('since: alleen wat na dat moment veranderde', async () => {
  const { store } = freshStore();
  store.put('ops', 'timers', 't1', { label: 'oud' });
  const t = store.newest('ops');
  await new Promise((r) => setTimeout(r, 5));
  store.put('ops', 'timers', 't2', { label: 'nieuw' });
  const part = store.get('ops', { withDeleted: true, since: t });
  assert.deepStrictEqual(Object.keys(part.timers), ['t2']);
  assert.deepStrictEqual(Object.keys(store.get('ops', { since: 0 }).timers).sort(), ['t1', 't2']);
});

test('merge: per item wint de nieuwste, ook voor de nieuwe soorten', () => {
  const { store } = freshStore();
  store.put('missions', 'fields', 'm1:order.order.mission', { v: 'hier' });
  const mine = store.get('missions', { withDeleted: true });
  const remote = { missions: {}, fields: { 'm1:order.order.mission': { v: 'daar', updatedAt: mine.fields['m1:order.order.mission'].updatedAt + 1000 }, 'm1:order.team.ml': { v: 'Koen', updatedAt: Date.now() } } };
  assert.strictEqual(store.merge('missions', remote), true);
  const got = store.get('missions');
  assert.strictEqual(got.fields['m1:order.order.mission'].v, 'daar');
  assert.strictEqual(got.fields['m1:order.team.ml'].v, 'Koen');
  assert.strictEqual(store.merge('missions', remote), false, 'niets nieuws de tweede keer');
});

test('migratie 9: de vijf nieuwe tabbladen achter de bestaande, elk één keer', () => {
  const model = require('../src/renderer/model.js');
  const st = model.normalize({ version: 8, pages: [{ id: 'a', name: 'Operationeel', widgets: [] }, { id: 'b', name: 'Mijn timers', widgets: [{ id: 'w', type: 'timings', x: 0, y: 0, w: 48, h: 54, z: 1, cfg: {} }] }] });
  assert.deepStrictEqual(st.pages.map((p) => p.name), ['Operationeel', 'Mijn timers', 'Mission Planning', 'Whiteboard', 'Offshore', 'COA Planner', '(De)Briefing', 'MadeSmart']);
  assert.strictEqual(st.version, model.VERSION);
  assert.strictEqual(st.settings.timings.warnMin, 5);
  const again = model.normalize(JSON.parse(JSON.stringify(st)));
  assert.strictEqual(again.pages.length, 8, 'een tweede keer verandert niets');
  const def = model.defaultState();
  assert.deepStrictEqual(def.pages.map((p) => p.name), ['Operationeel', 'Weer', 'Zoek & Plan', 'Timings', 'Mission Planning', 'Whiteboard', 'Offshore', 'COA Planner', '(De)Briefing', 'MadeSmart']);
});

test('migratie 10: het tabblad MadeSmart komt er één keer bij, achteraan, en blijft weg als het is weggehaald', () => {
  const model = require('../src/renderer/model.js');
  const st = model.normalize({ version: 9, pages: [{ id: 'a', name: 'Weer', widgets: [] }, { id: 'b', name: 'Operationeel', widgets: [] }] });
  assert.deepStrictEqual(st.pages.map((p) => p.name), ['Weer', 'Operationeel', 'MadeSmart', 'COA Planner'], 'eigen volgorde blijft, MadeSmart achteraan (zonder Offshore komt COA Planner nog daarna)');
  const w = st.pages[2].widgets[0];
  assert.deepStrictEqual([w.type, w.title, w.cfg.home, w.x, w.y, w.w, w.h], ['browser', 'MadeSmart', 'https://tracker.madesmart.nl/', 0, 0, model.COLS, model.ROWS]);
  st.pages = st.pages.filter((p) => p.name !== 'MadeSmart');
  assert.strictEqual(model.normalize(JSON.parse(JSON.stringify(st))).pages.length, 3, 'weggehaald blijft weg');
  const has = model.normalize({ version: 9, pages: [{ id: 'a', name: 'Eigen', widgets: [{ id: 'w', type: 'browser', x: 0, y: 0, w: 96, h: 54, z: 1, cfg: {} }] }] });
  assert.strictEqual(has.pages.filter((p) => p.widgets.some((x) => x.type === 'browser')).length, 1, 'al een browser: geen tweede');
});
