// The OpenSky reserve: every request costs 1 credit, the daily budget is never exceeded, and its
// state vectors merge with the ADS-B sources. `node --test test/opensky.test.js`.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const opensky = require('../src/opensky');
const traffic = require('../src/traffic');

const HOUR = 3600e3;
const DAY0 = Date.UTC(2026, 9, 15, 0, 0, 0);

function fakeApi({ remaining = 3999, status = 200, retryAfter = null } = {}) {
  const calls = [];
  const api = async (url) => {
    calls.push(url);
    if (url.includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 1800 }) };
    const headers = new Map([['x-rate-limit-remaining', String(remaining)]]);
    if (retryAfter != null) headers.set('x-rate-limit-retry-after-seconds', String(retryAfter));
    if (remaining > 0) remaining -= 1;
    return {
      ok: status === 200, status,
      headers: { get: (k) => headers.get(k.toLowerCase()) ?? null },
      json: async () => ({ time: 1792095588, states: [['484506', 'ZXP01   ', 'Kingdom of the Netherlands', 1792095587, 1792095588, 4.8, 52.3, 300, false, 56.6, 90, 2.5, null, 320, '7700', false, 0, 8]] }),
    };
  };
  api.calls = calls;
  return api;
}
function fresh(api) {
  opensky.reset();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osky-'));
  opensky.start({ dir, fetch: api });
  opensky.setKey('id', 'secret');
  return dir;
}

test('every area is cut down to at most 1 credit', () => {
  for (const lat of [50, 52.3, 54]) {
    for (const nm of [20, 60, 117, 150, 250, 1000]) {
      const b = opensky.box({ lat, lon: 4.8, nm });
      assert.ok(opensky.sqdeg(b) <= 25, `${lat} ${nm} NM gives ${opensky.sqdeg(b)}`);
      assert.ok(b.lamin < lat && b.lamax > lat);
    }
  }
  assert.ok(opensky.sqdeg(opensky.box(null)) <= 25, 'the Netherlands box costs 1 credit');
  // A small area stays as asked.
  const s = opensky.box({ lat: 52.3, lon: 4.8, nm: 30 });
  assert.ok(Math.abs((s.lamax - s.lamin) - 1) < 0.02);
});

test('state vectors in the shape of the aggregators', () => {
  const d = opensky.toAdsb({ time: 100, states: [['484506', 'ZXP01   ', 'NL', 98, 99, 4.8, 52.3, 304.8, false, 51.4444, 90, 5.08, null, 320, '7700', false, 2, 8]] });
  const a = d.ac[0];
  assert.strictEqual(d.now, 100);
  assert.strictEqual(a.hex, '484506');
  assert.strictEqual(a.alt_baro, 1000);
  assert.ok(Math.abs(a.gs - 100) < 0.1);
  assert.strictEqual(a.baro_rate, 1000);
  assert.strictEqual(a.emergency, 'general');
  assert.strictEqual(a.category, 'A7');
  assert.deepStrictEqual(a.mlat, ['lat', 'lon']);
  assert.strictEqual(a.seen, 1);
  assert.strictEqual(a.seen_pos, 2);
  assert.strictEqual(opensky.toAdsb({ time: 1, states: [['a', '', '', 1, 1, 4, 52, null, true]] }).ac[0].alt_baro, 'ground');
});

test('one credit per request, counted and paced', async () => {
  const api = fakeApi();
  fresh(api);
  const t = DAY0 + 6 * HOUR;
  const d = await opensky.fetchArea({ lat: 52.3, lon: 4.8, nm: 250 }, t);
  assert.ok(d && d.ac.length === 1);
  const st = opensky.status(t);
  assert.strictEqual(st.usedToday, 1);
  assert.strictEqual(st.remaining, 3999);
  // Not again straight away: the gap is the rest of the day over the credits left, at double pace.
  assert.strictEqual(await opensky.fetchArea(null, t + 1000), null);
  const gap = opensky.gap(t);
  assert.ok(gap >= 5000 && Math.abs(gap - (18 * HOUR) / (opensky.budget(t) * 2)) < 1);
  assert.strictEqual(opensky.budget(t), Math.min(3999 - opensky.RESERVE, opensky.LOCAL_MAX - 1));
  assert.ok(await opensky.fetchArea(null, t + gap + 1));
  assert.ok(!api.calls.some((u) => u.includes('icao24')), 'never by transponder code alone');
});

test('stops at the reserve on the account', async () => {
  const api = fakeApi({ remaining: opensky.RESERVE });
  fresh(api);
  const t = DAY0 + 10 * HOUR;
  assert.ok(await opensky.fetchArea(null, t));
  assert.strictEqual(opensky.budget(t), 0);
  assert.strictEqual(opensky.gap(t), Infinity);
  const n = api.calls.length;
  for (let i = 1; i < 50; i += 1) await opensky.fetchArea(null, t + i * 60000);
  assert.strictEqual(api.calls.length, n, 'nothing sent below the reserve');
  // The next UTC day it may ask again.
  assert.ok(opensky.ready(DAY0 + 24 * HOUR + 1000));
});

test('never more than its own day count, also after a restart', async () => {
  const api = fakeApi({ remaining: 3999 });
  const dir = fresh(api);
  fs.writeFileSync(path.join(dir, 'opensky.json'), JSON.stringify({ clientId: 'id', clientSecret: 'secret', ledger: { day: '2026-10-15', used: opensky.LOCAL_MAX, remaining: null, remainingAt: 0 } }));
  opensky.reset();
  opensky.start({ dir, fetch: api });
  assert.strictEqual(opensky.status(DAY0 + HOUR).configured, true);
  assert.strictEqual(opensky.budget(DAY0 + HOUR), 0);
  assert.strictEqual(await opensky.fetchArea(null, DAY0 + HOUR), null);
  assert.strictEqual(api.calls.length, 0);
});

test('a whole day of outage stays within the budget', async () => {
  const api = fakeApi({ remaining: 4000 });
  fresh(api);
  let sent = 0;
  for (let t = DAY0; t < DAY0 + 24 * HOUR; t += 1000) if (await opensky.fetchArea(null, t)) sent += 1;
  assert.ok(sent <= 4000 - opensky.RESERVE, `${sent} requests`);
  assert.ok(sent > 3000, `uses the reserve well: ${sent}`);
});

test('two screens on one key stay within the budget together', async () => {
  // Both see the same account balance; simulate by alternating and sharing the remaining count.
  let remaining = 4000;
  const shared = async (url) => {
    if (url.includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'tok', expires_in: 1800 }) };
    remaining -= 1;
    return { ok: true, status: 200, headers: { get: (k) => (k.toLowerCase() === 'x-rate-limit-remaining' ? String(remaining) : null) }, json: async () => ({ time: 1, states: [] }) };
  };
  fresh(shared);
  for (let t = DAY0; t < DAY0 + 24 * HOUR; t += 2500) await opensky.fetchArea(null, t);
  assert.ok(remaining >= opensky.RESERVE - 1, `left ${remaining}`);
});

test('an empty account rests as OpenSky asks', async () => {
  const api = fakeApi({ remaining: 0, status: 429, retryAfter: 7200 });
  fresh(api);
  const t = DAY0 + 3 * HOUR;
  assert.strictEqual(await opensky.fetchArea(null, t), null);
  assert.ok(opensky.status(t).pausedUntil >= t + 7200e3 - 1000);
  assert.strictEqual(opensky.budget(t), 0);
});

test('OpenSky data keeps what the ADS-B sources knew', () => {
  const NOW = 1792100000000;
  traffic.merge({ now: NOW, ac: [{ hex: '484507', r: 'PH-PXB', t: 'A139', category: 'A7', dbFlags: 1, alt_baro: 1000, lat: 52, lon: 5, seen: 0, seen_pos: 0 }] }, 'adsb.fi');
  traffic.merge(opensky.toAdsb({ time: NOW / 1000 + 10, states: [['484507', 'ZXP02', 'NL', NOW / 1000 + 10, NOW / 1000 + 10, 5.01, 52.01, 330, false, 50, 90, 0, null, 340, '0020', false, 0, 0]] }), 'OpenSky');
  const r = traffic.records().get('484507');
  assert.strictEqual(r.src, 'OpenSky');
  assert.strictEqual(r.lat, 52.01);
  assert.strictEqual(r.reg, 'PH-PXB');
  assert.strictEqual(r.type, 'A139');
  assert.strictEqual(r.cat, 'A7');
  assert.strictEqual(r.mil, true);
});

test('the feed calls in OpenSky only after 5 s without ADS-B, and spares adsb.lol', async () => {
  const api = fakeApi({ remaining: 3999 });
  fresh(api);
  const asked = { fi: [], lol: [] };
  traffic.start(async (url) => {
    (url.includes('adsb.fi') ? asked.fi : asked.lol).push(Date.now());
    throw new Error('HTTP 500');
  }, () => {});
  const area = { lat: 52.3, lon: 4.8, nm: 100 };
  const t0 = Date.now();
  traffic.watch({ area, groups: {} });
  const renew = setInterval(() => traffic.watch({ area, groups: {} }), 2000);
  await new Promise((r) => setTimeout(r, 4000));
  assert.strictEqual(api.calls.filter((u) => u.includes('states')).length, 0, 'not within the first seconds');
  await new Promise((r) => setTimeout(r, 4500));
  clearInterval(renew);
  traffic.stop();
  const states = api.calls.filter((u) => u.includes('states'));
  assert.ok(states.length >= 1 && states.length <= 2, `OpenSky asked ${states.length}×`);
  const snap = traffic.snapshot();
  assert.strictEqual(snap.src, 'OpenSky');
  assert.strictEqual(snap.reserve, true);
  for (let i = 1; i < asked.lol.length; i += 1) assert.ok(asked.lol[i] - asked.lol[i - 1] >= 4900, 'adsb.lol at most every 5 s');
  assert.ok(asked.fi.length >= 6 && asked.fi.length <= 9, `adsb.fi ${asked.fi.length}× in ${(Date.now() - t0) / 1000} s`);
});
