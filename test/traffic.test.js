// Merging the live sources: per aircraft the newest message and the newest position win, whichever
// source brings them. `node test/traffic.test.js`.
const assert = require('assert');
const traffic = require('../src/traffic');

const NOW = 1792078000000;
const store = traffic.records();

// adsb.fi (time in ms under "ac") sees the helicopter with a position 0.5 s old.
traffic.merge({ now: NOW, ac: [{ hex: '484A91', flight: 'ZXP01 ', alt_baro: 1200, gs: 110, track: 90, lat: 52.3, lon: 4.8, seen: 0.2, seen_pos: 0.5 }] }, 'adsb.fi');
let r = store.get('484a91');
assert.strictEqual(r.flight, 'ZXP01');
assert.strictEqual(r.posAt, NOW - 500);
assert.strictEqual(r.alt, 1200);

// adsb.lol (time in seconds under "aircraft") answers later with an older position: it must not win.
traffic.merge({ now: (NOW + 1000) / 1000, aircraft: [{ hex: '484a91', alt_baro: 1150, gs: 108, track: 88, lat: 52.29, lon: 4.79, seen: 3, seen_pos: 3 }] }, 'adsb.lol');
r = store.get('484a91');
assert.strictEqual(r.lat, 52.3, 'older position from the second source is ignored');
assert.strictEqual(r.alt, 1200, 'older message from the second source is ignored');
assert.strictEqual(r.src, 'adsb.fi');

// A newer one from that source does win.
traffic.merge({ now: (NOW + 2000) / 1000, aircraft: [{ hex: '484a91', alt_baro: 1300, gs: 112, track: 91, lat: 52.301, lon: 4.81, seen: 0.1, seen_pos: 0.1, dbFlags: 1 }] }, 'adsb.lol');
r = store.get('484a91');
assert.strictEqual(r.lat, 52.301);
assert.strictEqual(r.alt, 1300);
assert.strictEqual(r.src, 'adsb.lol');
assert.strictEqual(r.mil, true, 'dbFlags bit 1 marks military');

// On the ground.
traffic.merge({ now: NOW + 3000, ac: [{ hex: '484a91', alt_baro: 'ground', gs: 0, seen: 0 }] }, 'adsb.fi');
assert.strictEqual(store.get('484a91').alt, 'ground');
assert.strictEqual(store.get('484a91').lat, 52.301, 'a message without position keeps the last position');

console.log('traffic: ok');
