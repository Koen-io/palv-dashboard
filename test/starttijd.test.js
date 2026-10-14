// Start of the flight in progress, read from an ADS-B Exchange route: `node test/starttijd.test.js`.
const assert = require('assert');
const { takeoffFromTrace } = require('../src/fleet');

const T0 = 1791900000; // seconds
const pt = (s, alt, flags = 0) => [s, 52, 5, alt, 100, 0, flags];
const trace = (points) => ({ timestamp: T0, trace: points });
const at = (s) => (T0 + s) * 1000;

// Earlier flight, a stop on the ground, then the current flight from 4000 s.
const day = trace([pt(0, 'ground', 2), pt(60, 500), pt(1800, 800), pt(2400, 'ground'), pt(3900, 'ground', 2), pt(4000, 300), pt(4600, 1200)]);
assert.strictEqual(takeoffFromTrace([day], at(4630)), at(4000), 'current flight starts after the stop');

// A long gap without a ground point: the flight after the gap is the current one.
const gap = trace([pt(0, 900), pt(500, 1000), pt(2000, 700), pt(2300, 900)]);
assert.strictEqual(takeoffFromTrace([gap], at(2330)), at(2000), 'gap of 25 minutes splits the flights');

// The route ends on the ground: no flight in progress.
assert.strictEqual(takeoffFromTrace([trace([pt(0, 500), pt(300, 'ground')])], at(320)), null);

// The route has not caught up with the current flight yet.
assert.strictEqual(takeoffFromTrace([trace([pt(0, 500), pt(300, 600)])], at(300 + 1200)), null);

// Recent and full route together, as the site serves them.
const full = trace([pt(0, 'ground', 2), pt(100, 400), pt(500, 1200), pt(900, 1500)]);
const recent = trace([pt(950, 1500), pt(1000, 1400)]);
assert.strictEqual(takeoffFromTrace([recent, full], at(1010)), at(100), 'recent and full are merged');

console.log('starttijd: alle gevallen goed');
