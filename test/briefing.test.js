// Briefings: which briefing is near, and in which phase (5:00 orange, 1:30 red, the first minute after).
const test = require('node:test');
const assert = require('assert');
const BRIEFING = require('../src/renderer/briefing.js');
const { DEFAULT_BRIEFINGS, normalize, defaultState } = require('../src/renderer/model.js');

const at = (hh, mm, ss = 0, day = 16) => new Date(2026, 9, day, hh, mm, ss).getTime();

test('buiten de vensters: niets', () => {
  assert.strictEqual(BRIEFING.current(DEFAULT_BRIEFINGS, at(12, 0)), null);
  assert.strictEqual(BRIEFING.current(DEFAULT_BRIEFINGS, at(14, 24, 59)), null);
  assert.strictEqual(BRIEFING.current(DEFAULT_BRIEFINGS, at(14, 31, 0)), null);
});

test('5:00 oranje, 1:30 rood, daarna een minuut "nu"', () => {
  let c = BRIEFING.current(DEFAULT_BRIEFINGS, at(14, 25, 0));
  assert.strictEqual(c.b.id, 'fo-pm'); assert.strictEqual(c.phase, 'warn'); assert.strictEqual(BRIEFING.clock(c.left), '5:00');
  c = BRIEFING.current(DEFAULT_BRIEFINGS, at(14, 28, 29));
  assert.strictEqual(c.phase, 'warn');
  c = BRIEFING.current(DEFAULT_BRIEFINGS, at(14, 28, 30));
  assert.strictEqual(c.phase, 'alert'); assert.strictEqual(BRIEFING.clock(c.left), '1:30');
  c = BRIEFING.current(DEFAULT_BRIEFINGS, at(14, 30, 20));
  assert.strictEqual(c.phase, 'now');
});

test('ochtend: OPCO 08:00 en Flight Ops 08:15 lopen niet door elkaar', () => {
  assert.strictEqual(BRIEFING.current(DEFAULT_BRIEFINGS, at(7, 57)).b.id, 'opco-am');
  assert.strictEqual(BRIEFING.current(DEFAULT_BRIEFINGS, at(8, 11)).b.id, 'fo-am');
});

test('nacht over middernacht en uitgezette briefings', () => {
  const list = [{ id: 'x', where: 'Test', name: 'Middernacht', time: '00:02', on: true }];
  assert.strictEqual(BRIEFING.current(list, at(23, 59, 0)).phase, 'warn');
  assert.strictEqual(BRIEFING.current([{ ...list[0], on: false }], at(23, 59, 0)), null);
  assert.strictEqual(BRIEFING.current([{ ...list[0], time: 'onzin' }], at(23, 59, 0)), null);
});

test('oude configuratie krijgt de standaardtijden', () => {
  const old = defaultState();
  delete old.settings.briefings; delete old.settings.briefingAlert;
  const n = normalize(old);
  assert.strictEqual(n.settings.briefings.length, 6);
  assert.strictEqual(n.settings.briefingAlert, true);
});
