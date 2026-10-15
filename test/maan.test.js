// Moon phase, moonrise and moonset, and the light level on the ground: `node --test test/`.
const test = require('node:test');
const assert = require('assert');
const ASTRO = require('../src/renderer/astro.js');

const at = (iso) => Date.parse(iso);

test('fase op bekende momenten (volle maan, nieuwe maan, eerste kwartier)', () => {
  assert.ok(ASTRO.moon(at('2024-04-23T23:49Z')).fraction > 0.995, 'volle maan 23 april 2024');
  assert.ok(ASTRO.moon(at('2025-03-14T06:55Z')).fraction > 0.995, 'volle maan 14 maart 2025');
  assert.ok(ASTRO.moon(at('2024-04-08T18:21Z')).fraction < 0.005, 'nieuwe maan 8 april 2024 (zonsverduistering)');
  const q = ASTRO.moon(at('2024-04-15T19:13Z'));
  assert.ok(Math.abs(q.fraction - 0.5) < 0.03, `eerste kwartier: ${q.fraction}`);
  assert.strictEqual(q.waxing, true);
  assert.strictEqual(q.phaseName, 'Eerste kwartier');
  assert.strictEqual(ASTRO.moon(at('2024-04-23T23:49Z')).phaseName, 'Volle maan');
});

test('volgende volle en nieuwe maan binnen een half uur van de tabel', () => {
  const full = ASTRO.nextPhase(180, at('2024-04-20T00:00Z'));
  assert.ok(Math.abs(full - at('2024-04-23T23:49Z')) < 30 * 60000, new Date(full).toISOString());
  const nw = ASTRO.nextPhase(0, at('2024-04-01T00:00Z'));
  assert.ok(Math.abs(nw - at('2024-04-08T18:21Z')) < 30 * 60000, new Date(nw).toISOString());
});

test('maanop en maanonder: afwisselend, op de horizon, en de huidige doorgang klopt', () => {
  const from = at('2026-10-15T00:00Z');
  const list = ASTRO.crossings(from, from + 3 * 864e5);
  assert.ok(list.length >= 4 && list.length <= 7, `aantal: ${list.length}`);
  for (let i = 1; i < list.length; i += 1) assert.notStrictEqual(list[i].rise, list[i - 1].rise, 'op en onder wisselen elkaar af');
  for (const c of list) assert.ok(Math.abs(ASTRO.moon(c.t).alt + 0.27) < 0.05, 'op de horizon');
  for (const now of [from + 3600e3, from + 12 * 3600e3, from + 30 * 3600e3]) {
    const p = ASTRO.moonPass(now);
    if (p.up) assert.ok(p.rise <= now && now < p.set);
    else assert.ok(now < p.rise && p.rise < p.set);
  }
});

test('lichtniveau op de grond', () => {
  const day = ASTRO.light(at('2026-06-21T11:40Z'));
  assert.ok(day.lux > 50000 && day.lux < 130000, `zomermiddag: ${day.lux}`);
  // Full moon high in the sky at midnight in winter: a few tenths of a lux at most.
  const full = ASTRO.light(at('2025-12-04T23:30Z'));
  assert.ok(full.moon > 0.08 && full.moon < 0.35, `volle maan: ${full.moon}`);
  // New moon, deep night: only starlight and airglow, under a millilux.
  const dark = ASTRO.light(at('2024-04-08T23:30Z'));
  assert.ok(dark.lux > 0.0003 && dark.lux < 0.001, `maanloos: ${dark.lux}`);
  assert.ok(ASTRO.skyLux(-6) > 2 && ASTRO.skyLux(-6) < 5, 'einde burgerlijke schemering ca. 3,4 lx');
});

test('notatie in lux en millilux', () => {
  assert.deepStrictEqual(ASTRO.formatLux(47812), { value: '47.800', unit: 'lx' });
  assert.deepStrictEqual(ASTRO.formatLux(3.456), { value: '3,46', unit: 'lx' });
  assert.deepStrictEqual(ASTRO.formatLux(0.745), { value: '745', unit: 'mlx' });
  assert.deepStrictEqual(ASTRO.formatLux(0.00475), { value: '4,75', unit: 'mlx' });
  assert.deepStrictEqual(ASTRO.formatLux(0.0006), { value: '0,6', unit: 'mlx' });
});
