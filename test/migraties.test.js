// The layout model and the migrations of older configurations: `node --test test/`.
const test = require('node:test');
const assert = require('assert');
const M = require('../src/renderer/model.js');

const clone = (x) => JSON.parse(JSON.stringify(x));
const types = (page) => page.widgets.map((w) => w.type).sort();

test('standaardindeling blijft zichzelf na normaliseren', () => {
  const def = M.defaultState();
  const out = M.normalize(clone(def));
  assert.strictEqual(out.version, M.VERSION);
  assert.deepStrictEqual(out.pages.map((p) => p.name), ['Operationeel', 'Weer']);
  assert.deepStrictEqual(types(out.pages[0]), ['fleet', 'radar', 'runway', 'tile', 'tile', 'windy']);
  assert.strictEqual(out.settings.keepAwake, true);
  assert.strictEqual(out.settings.oledCare, true);
  assert.strictEqual(out.settings.emergencyAlert, true);
});

test('onbruikbare invoer geeft de standaardindeling', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { pages: [] }, { pages: 'nee' }, { pages: [null, 7] }]) {
    const out = M.normalize(clone(bad === undefined ? null : bad));
    assert.strictEqual(out.pages.length, 2, JSON.stringify(bad));
  }
});

test('onbekende widgets verdwijnen, ontbrekende instellingen worden aangevuld', () => {
  const cfg = { version: 6, activePage: 9, settings: { theme: 'dark' }, pages: [{ name: 'A', widgets: [{ type: 'radar', x: 0, y: 0, w: 10, h: 10 }, { type: 'bestaat-niet' }, null] }] };
  const out = M.normalize(cfg);
  assert.deepStrictEqual(types(out.pages[0]), ['radar']);
  assert.strictEqual(out.settings.theme, 'dark', 'eigen keuze blijft');
  assert.strictEqual(out.settings.keepAwake, true, 'nieuwe instelling krijgt standaard');
  assert.strictEqual(out.activePage, 0, 'actieve pagina binnen bereik');
  assert.ok(out.pages[0].widgets[0].id, 'widget krijgt een id');
  assert.deepStrictEqual(out.pages[0].widgets[0].cfg.cats, ['all'], 'standaardinstellingen van de widget');
});

test('1.11 → nu: ADS-B Exchange wordt Vluchtradar met hetzelfde filter, In de lucht komt erbij', () => {
  const v4 = {
    version: 4,
    settings: {},
    pages: [{
      name: 'Operationeel',
      widgets: [
        { id: 'a', type: 'adsb', x: 0, y: 0, w: 36, h: 54, title: 'ADS-B Exchange', cfg: { mode: 'police', labels: true, trails: false, lat: 52, lon: 5, zoom: 8, refH: M.REF_H } },
        { id: 'w', type: 'windy', x: 36, y: 0, w: 36, h: 54, cfg: {} },
        { id: 'r', type: 'runway', x: 72, y: 9, w: 24, h: 45, cfg: {} },
      ],
    }],
  };
  const out = M.normalize(v4);
  const radar = out.pages[0].widgets.find((w) => w.id === 'a');
  assert.strictEqual(radar.type, 'radar');
  assert.strictEqual(radar.title, 'Vluchtradar');
  assert.deepStrictEqual(radar.cfg.cats, ['police', 'hems', 'coastguard']);
  assert.strictEqual(radar.cfg.routes, false);
  assert.strictEqual(radar.cfg.labels, true);
  const rwy = out.pages[0].widgets.find((w) => w.id === 'r');
  const fleet = out.pages[0].widgets.find((w) => w.type === 'fleet');
  assert.ok(fleet, 'In de lucht toegevoegd');
  assert.strictEqual(rwy.h, 27, 'baangebruik maakt plaats');
  assert.deepStrictEqual([fleet.x, fleet.y, fleet.w, fleet.h], [72, 36, 24, 18]);
});

test('1.0 → nu: oude standaardkaart naar de nieuwe, volledig scherm aan, baangebruik erbij', () => {
  const v1 = { pages: [{ name: 'P', widgets: [{ type: 'windy', x: 0, y: 0, w: 60, h: 54, cfg: { lat: 52.2, lon: 5.3, zoom: 7 } }] }], settings: { startFullscreen: false } };
  const out = M.normalize(v1);
  const w = out.pages[0].widgets.find((x) => x.type === 'windy');
  assert.strictEqual(w.cfg.lat, M.WIDGET_META.windy.defaults.lat);
  assert.strictEqual(out.settings.startFullscreen, true);
  assert.ok(out.pages[0].widgets.some((x) => x.type === 'runway'));
  assert.ok(out.pages[0].widgets.some((x) => x.type === 'fleet'));
});

test('migreren is idempotent', () => {
  const v4 = { version: 4, pages: [{ name: 'X', widgets: [{ type: 'adsb', x: 0, y: 0, w: 30, h: 30, cfg: { mode: 'mil' } }] }] };
  const once = M.normalize(v4);
  const twice = M.normalize(clone(once));
  assert.deepStrictEqual(twice, once);
});

test('vrije plek zoeken', () => {
  const page = { widgets: [{ x: 0, y: 0, w: 48, h: 54 }] };
  assert.deepStrictEqual(M.findFreeSpot(page, 24, 18), { x: 48, y: 0 });
});
