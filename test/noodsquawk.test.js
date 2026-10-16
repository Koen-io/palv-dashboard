// The emergency watch: no alert from single garbled messages, only inside FIR Amsterdam: `node --test test/`.
const test = require('node:test');
const assert = require('assert');
const SQUAWK = require('../src/renderer/squawk.js');

const T0 = Date.parse('2026-10-16T10:00:00Z');
// An aircraft over Utrecht at FL300, with a message at time t.
const ac = (t, extra = {}) => ({ hex: '4ca123', flight: 'EIN67T', alt: 30000, lat: 52.1, lon: 5.1, posAt: t, msgAt: t, squawk: '7700', ...extra });

// Feed one message per `step` ms from `from` to `to`, built by `make(t)`; returns everything started/ended.
function run(watch, from, to, step, make) {
  const started = [], ended = [];
  for (let t = from; t <= to; t += step) {
    const r = watch.update([make(t)], t);
    started.push(...r.started);
    ended.push(...r.ended);
  }
  return { started, ended };
}

test('FIR Amsterdam: binnen en buiten', () => {
  assert.ok(SQUAWK.inFir(52.31, 4.76), 'Schiphol');
  assert.ok(SQUAWK.inFir(53.2, 6.57), 'Groningen');
  assert.ok(SQUAWK.inFir(50.92, 5.77), 'Beek (Maastricht)');
  assert.ok(SQUAWK.inFir(54.5, 5.5), 'Noordzee, noordelijk deel van de FIR');
  assert.ok(!SQUAWK.inFir(54.5, 4.3), 'Noordzee, net ten westen van de FIR');
  assert.ok(SQUAWK.inFir(51.45, 3.6), 'Vlissingen');
  assert.ok(!SQUAWK.inFir(51.2, 4.4), 'Antwerpen');
  assert.ok(!SQUAWK.inFir(50.85, 4.35), 'Brussel');
  assert.ok(!SQUAWK.inFir(51.23, 6.78), 'Düsseldorf');
  assert.ok(!SQUAWK.inFir(53.08, 8.8), 'Bremen');
  assert.ok(!SQUAWK.inFir(51.5, 1.0), 'Londen-kant van de Noordzee');
  assert.ok(!SQUAWK.inFir(50.3, 7.5), '160 NM ZO van Schiphol (zoals RYR5533)');
});

test('één los bericht met 7700 geeft geen melding', () => {
  const w = SQUAWK.createWatch();
  const r = run(w, T0, T0 + 60000, 1000, (t) => ac(t, { squawk: t === T0 + 5000 ? '7700' : '1000' }));
  assert.strictEqual(r.started.length, 0);
  assert.strictEqual(w.active().length, 0);
});

test('een noodstatus zonder squawk (nordo, downed, general) geeft geen melding', () => {
  const w = SQUAWK.createWatch();
  for (const em of ['nordo', 'downed', 'general', 'unlawful']) {
    const r = run(w, T0, T0 + 120000, 1000, (t) => ac(t, { squawk: '2201', emergency: em }));
    assert.strictEqual(r.started.length, 0, em);
  }
});

test('een korte reeks (onder 30 s) geeft geen melding', () => {
  const w = SQUAWK.createWatch();
  const r = run(w, T0, T0 + 90000, 1000, (t) => ac(t, { squawk: t >= T0 + 10000 && t < T0 + 35000 ? '7700' : '1000' }));
  assert.strictEqual(r.started.length, 0);
});

test('een gewone squawk tussendoor zet de telling terug', () => {
  const w = SQUAWK.createWatch();
  // 7700 for 60 s, but every 20 s a normal squawk in between.
  const r = run(w, T0, T0 + 60000, 1000, (t) => ac(t, { squawk: (t - T0) % 20000 === 0 && t > T0 ? '1000' : '7700' }));
  assert.strictEqual(r.started.length, 0);
});

test('aanhoudend 7700 boven Nederland: melding na 30 s, weg na twee gewone squawks', () => {
  const w = SQUAWK.createWatch();
  const r = run(w, T0, T0 + 40000, 1000, (t) => ac(t));
  assert.strictEqual(r.started.length, 1);
  const on = w.active({ firOnly: true });
  assert.strictEqual(on.length, 1);
  assert.strictEqual(on[0].code, '7700');
  assert.strictEqual(on[0].meaning, 'Noodsituatie');
  assert.ok(on[0].since >= T0 + 30000);
  assert.ok(w.isConfirmed('4ca123'));
  // One normal squawk is not enough, the second ends it.
  let e = w.update([ac(T0 + 41000, { squawk: '1000' })], T0 + 41000);
  assert.strictEqual(e.ended.length, 0);
  e = w.update([ac(T0 + 42000, { squawk: '1000' })], T0 + 42000);
  assert.strictEqual(e.ended.length, 1);
  assert.strictEqual(w.active().length, 0);
});

test('een bericht zonder squawk telt niet mee en beëindigt ook niets', () => {
  const w = SQUAWK.createWatch();
  run(w, T0, T0 + 40000, 1000, (t) => ac(t));
  const r = run(w, T0 + 41000, T0 + 50000, 1000, (t) => ac(t, { squawk: null }));
  assert.strictEqual(r.ended.length, 0);
  assert.ok(w.isConfirmed('4ca123'));
});

test('hetzelfde bericht telt maar één keer, ook als het vaker langskomt', () => {
  const w = SQUAWK.createWatch();
  // Eight rounds a second apart over 40 s, but the source only had three different messages.
  const r = run(w, T0, T0 + 40000, 5000, (t) => ac(t, { msgAt: T0 + Math.min(2, Math.floor((t - T0) / 15000)) * 15000 }));
  assert.strictEqual(r.started.length, 0);
});

test('buiten FIR Amsterdam: wel op de radar, niet in de meldingsbalk', () => {
  const w = SQUAWK.createWatch();
  const r = run(w, T0, T0 + 40000, 1000, (t) => ac(t, { lat: 50.3, lon: 7.5 }));
  assert.strictEqual(r.started.length, 1);
  assert.strictEqual(w.active({ firOnly: true }).length, 0);
  assert.strictEqual(w.active().length, 1);
  assert.strictEqual(w.active()[0].inFir, false);
});

test('op de grond of met een oude positie telt niet', () => {
  const w = SQUAWK.createWatch();
  assert.strictEqual(run(w, T0, T0 + 60000, 1000, (t) => ac(t, { alt: 'ground' })).started.length, 0);
  assert.strictEqual(run(w, T0, T0 + 60000, 1000, (t) => ac(t, { posAt: t - 120000 })).started.length, 0);
});

test('een toestel dat een minuut niets laat horen verdwijnt', () => {
  const w = SQUAWK.createWatch();
  run(w, T0, T0 + 40000, 1000, (t) => ac(t));
  assert.ok(w.isConfirmed('4ca123'));
  const r = w.update([], T0 + 45000);
  assert.strictEqual(r.ended.length, 1);
  assert.strictEqual(w.active().length, 0);
});

test('een andere noodcode begint opnieuw met tellen', () => {
  const w = SQUAWK.createWatch();
  run(w, T0, T0 + 40000, 1000, (t) => ac(t));
  const r = run(w, T0 + 41000, T0 + 50000, 1000, (t) => ac(t, { squawk: '7600' }));
  assert.strictEqual(r.ended.length, 1, 'de 7700-melding is weg');
  assert.ok(!w.isConfirmed('4ca123'), '7600 nog niet lang genoeg');
  run(w, T0 + 51000, T0 + 75000, 1000, (t) => ac(t, { squawk: '7600' }));
  assert.strictEqual(w.active()[0].code, '7600');
});
