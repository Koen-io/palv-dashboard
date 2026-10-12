const fs = require('fs');
const assert = require('assert');
const dir = require('path').join(__dirname, '..', 'src', 'renderer');
const window = {};
new Function('window', fs.readFileSync(dir + '/suntable.js', 'utf8'))(window);
const src = fs.readFileSync(dir + '/app.js', 'utf8');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const code = src.slice(src.indexOf('function sunTimes('), src.indexOf('function resolveTheme(')) + src.slice(src.indexOf('const ltFmt ='), src.indexOf('function renderUdp('));
const udpToday = new Function('window', 'clamp', code + '; return udpToday;')(window, clamp);
const z = (ms) => new Date(ms).toISOString().slice(0, 16);
const U = (iso) => { const u = udpToday(Date.parse(iso)); return `${z(u.begin)} ${z(u.end)} ${u.day ? 'dag' : 'nacht'} ${u.official ? 'tabel' : 'berekend'}`; };
assert.equal(U('2026-10-09T12:00Z'), '2026-10-09T05:39 2026-10-09T17:14 dag tabel');   // table 0754 1859 MEZT
assert.equal(U('2026-10-09T05:38:59Z'), '2026-10-09T05:39 2026-10-09T17:14 nacht tabel');
assert.equal(U('2026-10-09T05:39:00Z'), '2026-10-09T05:39 2026-10-09T17:14 dag tabel');
assert.equal(U('2026-10-09T17:14:00Z'), '2026-10-09T05:39 2026-10-09T17:14 nacht tabel');
assert.equal(U('2026-10-09T22:30Z'), '2026-10-10T05:41 2026-10-10T17:12 nacht tabel'); // 00:30 LT on the 10th: 0756 1857
assert.equal(U('2026-03-29T12:00Z'), '2026-03-29T05:07 2026-03-29T18:24 dag tabel');   // first summer-time day 0722 2009
assert.equal(U('2026-10-25T12:00Z'), '2026-10-25T06:07 2026-10-25T16:40 dag tabel');   // first winter-time day 0722 1725
assert.equal(U('2026-12-31T23:30Z'), '2027-01-01T07:33 2027-01-01T15:54 nacht tabel'); // 2027: 0848 1639 MET
assert.equal(U('2027-10-31T12:00Z'), '2027-10-31T06:17 2027-10-31T16:29 dag tabel');   // 0732 1714 MET
assert.equal(U('2027-02-28T12:00Z'), '2027-02-28T06:14 2027-02-28T17:32 dag tabel');   // 0729 1817
console.log('2028-02-29:', U('2028-02-29T12:00Z'));
console.log('2028-06-21:', U('2028-06-21T12:00Z'));
console.log('ok');
