// One parser for every METAR on the dashboard (wx.js): what the header, the METAR widgets, the radar and
// Zoek & Plan read out of a report, and the cloud base as the BOM defines it.
const WX = require(require('path').join(__dirname, '..', 'src', 'renderer', 'wx.js'));
const assert = require('assert');

// The report of 23 October 14:25Z that showed "BKN 1800 ft" in the header while SCT010 was the base.
const m = WX.parseMetar('METAR EHAM 231425Z 10016G26KT 8000 -RADZ FEW008 SCT010 BKN018 11/10 Q0990 TEMPO 6000');
assert.deepEqual(m.wind, { dir: '100', spd: 16, gust: 26, unit: 'KT', vary: null });
assert.equal(m.vis, 8000);
assert.deepEqual(m.wx, ['-RADZ']);
assert.deepEqual(m.layers, [{ cover: 'FEW', base: 800, type: '' }, { cover: 'SCT', base: 1000, type: '' }, { cover: 'BKN', base: 1800, type: '' }]);
assert.equal(m.temp, 11);
assert.equal(m.dew, 10);
assert.equal(m.qnh, 990);
assert.equal(m.groups.length, 1);
// BOM note 1: the cloud base is the lowest layer of 3/8 (SCT) or more, FEW does not count...
assert.deepEqual(WX.lowestLayer(m, false), { cover: 'SCT', base: 1000, type: '' });
// ...unless the row says "geen bewolking (incl. FEW)".
assert.deepEqual(WX.lowestLayer(m, true), { cover: 'FEW', base: 800, type: '' });
// Which, that afternoon, meant: within every day profile, and at night outside SP buiten UDP (FEW 800 < 1100).
const C = (s) => WX.parseMetar('METAR XXXX 231425Z ' + s);
assert.equal(WX.PROFILES.map((p) => WX.check(p.id, m)).join(','), 'ok,ok,out,ok,ok,out');

// Other fields the header shows.
const n = C('VRB03KT 9999 NSC M02/M05 Q1031 NOSIG');
assert.deepEqual(n.wind, { dir: 'VRB', spd: 3, gust: null, unit: 'KT', vary: null });
assert.equal(n.temp, -2);
assert.equal(n.dew, -5);
assert.equal(n.qnh, 1031);
assert.equal(n.cloud, 'none');
assert.equal(WX.lowestLayer(n, true), null);
assert.equal(n.nosig, true);
const v = C('AUTO 22009KT 180V240 5000 -SHRA VCTS SCT003CB BKN004 FEW015TCU 15/// Q1004 RERA');
assert.equal(v.wind.vary, '180–240');
assert.deepEqual(v.wx, ['-SHRA', 'VCTS']);
assert.equal(v.layers[0].type, 'CB');
assert.equal(v.layers[2].type, 'TCU');
assert.equal(v.temp, 15);
assert.equal(v.dew, null);
assert.deepEqual(WX.lowestLayer(v, false), { cover: 'SCT', base: 300, type: 'CB' });
assert.deepEqual(WX.lowestLayer(v, true), { cover: 'SCT', base: 300, type: 'CB' }); // FEW lies above
// Only FEW: no BOM cloud base, but the layer is there for the "incl. FEW" rows.
const f = C('21010KT 9999 FEW005 10/08 Q1010');
assert.equal(WX.lowestLayer(f, false), null);
assert.equal(WX.lowestLayer(f, true).base, 500);
// Not measured and vertical visibility.
assert.equal(C('25031KT //// // ///////// 17/14 Q1003').cloud, 'unknown');
const vv = C('00000KT 0300 FG VV001 09/09 Q1020');
assert.equal(vv.vv, 100);
assert.equal(vv.cloud, 'unknown');
assert.deepEqual(vv.wx, ['FG']);
assert.equal(C('CAVOK 20/10 Q1015').cavok, true);
// US forms, for a field abroad in Zoek & Plan.
assert.equal(C('18005KT 10SM CLR 20/10 A2992').vis, 9999);
assert.equal(C('18005KT 1/2SM FG OVC002 10/10 A2992').vis, 805);
assert.equal(C('18005KT 10SM CLR 20/10 A2992').qnh, 1013);
// Colour states and recent weather are no present weather.
assert.deepEqual(C('21010KT 9999 BKN020 10/08 Q1010 RERA WHT BLU').wx, []);

// The BOM table (Deel A §8.2.4.1, versie 10 revisie 1): the figures of each row.
const P = Object.fromEntries(WX.PROFILES.map((p) => [p.id, p]));
assert.deepEqual([P.spd.any, P.spd.vis], [600, 3000]);
assert.deepEqual([P.unaided.ceil, P.unaided.vis], [1100, 3000]);
assert.deepEqual([P.aided.ceil, P.aided.vis], [900, 3000]);
assert.deepEqual([P.adv.any, P.adv.vis], [600, 3000]);
assert.deepEqual([P.ferry.any, P.ferry.vis], [1100, 3000]); // SP EC buiten UDP: unaided limits incl. FEW
assert.deepEqual(WX.forPeriod('day').map((p) => p.id), ['mpd', 'spd']);
assert.deepEqual(WX.forPeriod('night').map((p) => p.id), ['unaided', 'aided', 'adv', 'ferry']);
for (const p of WX.PROFILES) assert.ok(p.short && p.rule, p.id);

// One station out of the header's data: newest observation, TAF and the earlier observations.
const now = Date.UTC(2026, 9, 23, 14, 54);
const obs = Date.UTC(2026, 9, 23, 14, 25);
const hist = [{ obsTime: obs, raw: 'same time, must be dropped' }, { obsTime: obs - 60 * 60e3, raw: 'METAR EHAM 231325Z 10014KT 6000 -RA SCT008 BKN012 11/10 Q0991' }];
const st = WX.station('EHAM', 'METAR EHAM 231425Z 10016G26KT 8000 -RADZ FEW008 SCT010 BKN018 11/10 Q0990', obs, 'TAF EHAM 231130Z 2312/2418 10015G25KT 8000 -RA BKN012', hist, now, { name: 'Schiphol', lat: 52.31, lon: 4.76 });
assert.equal(st.icao, 'EHAM');
assert.equal(st.name, 'Schiphol');
assert.equal(st.history.length, 1);
assert.equal(st.taf.from, Date.UTC(2026, 9, 23, 12));
const a = WX.assess('mpd', st, now);
assert.equal(a.status, 'green');
assert.equal(a.trend.src, 'TAF');
// Without a TAF the observed change of the last hour is the trend: SCT008 -> SCT010 is better.
const o = WX.assess('mpd', WX.station('EHAM', 'METAR EHAM 231425Z 10016G26KT 8000 -RADZ FEW008 SCT010 BKN018 11/10 Q0990', obs, null, hist, now), now);
assert.equal(o.trend.src, 'OBS');
assert.equal(o.trend.dir, 1);
console.log('all ok');
