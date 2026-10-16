// Plaatsen: above which Dutch place a position lies, offline from vendor/places-nl.js.
const test = require('node:test');
const assert = require('assert');
globalThis.window = globalThis;
require('../src/renderer/vendor/places-nl.js');
const PLACES = require('../src/renderer/places.js');
delete globalThis.window;

test('boven een woonplaats', () => {
  assert.deepStrictEqual(PLACES.near(52.0907, 5.1214), { name: 'Utrecht', above: true }); // Domtoren
  assert.strictEqual(PLACES.near(52.3731, 4.8926).name, 'Amsterdam'); // Dam
  assert.strictEqual(PLACES.near(52.3086, 4.7639).name, 'Schiphol');
  assert.strictEqual(PLACES.where(PLACES.near(52.0907, 5.1214)), 'boven Utrecht');
});

test('buiten een woonplaats: afstand en richting van de dichtstbijzijnde', () => {
  const n = PLACES.near(52.9, 4.4); // Noordzee, west van Den Helder
  assert.strictEqual(n.above, false);
  assert.ok(n.km > 5 && n.km < 40, `afstand ${n.km}`);
  assert.match(n.dir, /^(W|NW|ZW)$/);
  assert.match(PLACES.where(n), /^\d+ km (W|NW|ZW) van /);
});

test('ver weg of zonder positie: niets', () => {
  assert.strictEqual(PLACES.near(40, -30), null);
  assert.strictEqual(PLACES.near(null, 5), null);
  assert.strictEqual(PLACES.where(null), '');
});
