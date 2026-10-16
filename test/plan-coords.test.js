// Coordinates for Zoek & Plan: RD, UTM/MGRS, formatting and parsing. `node --test test/plan-coords.test.js`.
const test = require('node:test');
const assert = require('node:assert');
const C = require('../src/renderer/plan/coords.js');

// Ground truth from the PDOK Locatieserver (free search, fl=centroide_ll,centroide_rd), October 2026:
// [name, lon, lat, RD x, RD y]. PDOK uses the full RDNAPTRANS transformation.
const PDOK = [
  ['Dam, Amsterdam', 4.89304433, 52.37297089, 121347.914, 487347.519],
  ['Grote Markt, Groningen', 6.56765154, 53.21837551, 233848.484, 581952.671],
  ['Markt, Maastricht', 5.6912069, 50.85092856, 176409.79, 317943.803],
  ['Bellamypark, Vlissingen', 3.57343275, 51.44168835, 28905.68, 385189.635],
  ['Beatrixstraat 1A, Den Helder', 4.76093745, 52.95762399, 112914.961, 552471.124],
  ['Langestraat, Enschede', 6.89688903, 52.21922134, 258160.566, 471200.172],
  ['Coolsingel 40, Rotterdam', 4.47920127, 51.92272076, 92539.395, 437527.922],
  ['Markt, Eindhoven', 5.47828559, 51.43926077, 161333.052, 383355.229],
  ['Cadzand', 3.41235085, 51.36898822, 17489.964, 377394.693],
  ['Waalkade, Nijmegen', 5.86517695, 51.84969226, 187933.3, 429121.315],
  ['Reeweg, Schiermonnikoog', 6.16351092, 53.47252419, 206549.449, 609870.216],
  ['Gemeente Vaals', 5.97584744, 50.77433492, 196523.917, 309545.216],
  ['Burgemeester Venemastraat 11A, Winschoten', 7.03548984, 53.14100126, 265291.713, 573957.056],
];
const metres = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lon - b.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));

test('RD <-> WGS84 against PDOK within 1.5 m', () => {
  for (const [name, lon, lat, x, y] of PDOK) {
    const rd = C.toRD(lat, lon);
    assert.ok(Math.hypot(rd.x - x, rd.y - y) < 1.5, `toRD ${name}: ${rd.x}, ${rd.y}`);
    const ll = C.fromRD(x, y);
    assert.ok(metres(ll, { lat, lon }) < 1.5, `fromRD ${name}: ${ll.lat}, ${ll.lon}`);
    const back = C.toRD(ll.lat, ll.lon);
    assert.ok(Math.hypot(back.x - x, back.y - y) < 0.5, `round trip ${name}`);
  }
  // The origin of the formulas (Onze Lieve Vrouwetoren, Amersfoort) maps exactly.
  const o = C.toRD(52.15517440, 5.38720621);
  assert.ok(Math.abs(o.x - 155000) < 1e-6 && Math.abs(o.y - 463000) < 1e-6);
});

// Independent check: Snyder's Transverse Mercator series (USGS PP 1395, eq. 8-9/8-10), cm-accurate near
// the central meridian, against the Krüger n-series in coords.js.
function snyder(lat, lon, zone) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9996;
  const phi = lat * Math.PI / 180, l0 = (zone * 6 - 183) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2), T = Math.tan(phi) ** 2, Cc = ep2 * Math.cos(phi) ** 2;
  const A = (lon * Math.PI / 180 - l0) * Math.cos(phi);
  const e4 = e2 * e2, e6 = e4 * e2;
  const M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi) - 35 * e6 / 3072 * Math.sin(6 * phi));
  const x = k0 * N * (A + (1 - T + Cc) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * Cc - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * Cc + 4 * Cc * Cc) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * Cc - 330 * ep2) * A ** 6 / 720));
  return { e: 500000 + x, n: y + (lat < 0 ? 10000000 : 0) };
}

test('UTM: agrees with an independent series and round-trips', () => {
  const pts = [[52.30861, 4.76389], [53.2, 6.5], [50.85, 5.69], [0.5, 2], [-33.8688, 151.2093], [-54.8, -68.3], [64.1, -21.9], [35.68, 139.77], [40.7, -74.0], [83.5, -30], [-79.9, 166.7], [1e-9, 3]];
  for (const [lat, lon] of pts) {
    const u = C.toUTM(lat, lon), s = snyder(lat, lon, u.zone);
    assert.ok(Math.abs(u.e - s.e) < 0.05 && Math.abs(u.n - s.n) < 0.05, `${lat},${lon}: ${u.e} ${u.n} vs ${s.e} ${s.n}`);
    const back = C.fromUTM(u.zone, u.hemi, u.e, u.n);
    assert.ok(Math.abs(back.lat - lat) < 1e-9 && Math.abs(back.lon - lon) < 1e-9, `back ${lat},${lon}`);
    assert.deepStrictEqual(C.fromUTM(u), back);
  }
  // Well-known: the equator on the Greenwich meridian is 31N 166021.443 0.
  const z = C.toUTM(0, 0);
  assert.strictEqual(z.zone, 31); assert.strictEqual(z.band, 'N'); assert.strictEqual(z.hemi, 'N');
  assert.ok(Math.abs(z.e - 166021.4431) < 0.001 && Math.abs(z.n) < 1e-6);
  // Central meridian: easting exactly 500000.
  assert.ok(Math.abs(C.toUTM(52, 3).e - 500000) < 1e-6);
  assert.strictEqual(C.toUTM(-12, -77).hemi, 'S');
  assert.strictEqual(C.toUTM(85, 0), null);
  assert.strictEqual(C.toUTM(-80.5, 0), null);
});

test('UTM zones: Norway, Svalbard, bands and the antimeridian', () => {
  const zb = (lat, lon) => { const u = C.toUTM(lat, lon); return `${u.zone}${u.band}`; };
  assert.strictEqual(zb(52.3, 4.76), '31U');
  assert.strictEqual(zb(52.3, 6.1), '32U');
  assert.strictEqual(zb(60, 5), '32V', 'Bergen: Norway exception');
  assert.strictEqual(zb(60, 2.9), '31V');
  assert.strictEqual(zb(55.9, 5), '31U');
  assert.strictEqual(zb(78, 8), '31X');
  assert.strictEqual(zb(78, 15), '33X', 'Longyearbyen: Svalbard exception');
  assert.strictEqual(zb(78, 25), '35X');
  assert.strictEqual(zb(78, 40), '37X');
  assert.strictEqual(zb(71.9, 15), '33W');
  assert.strictEqual(zb(84, 0), '31X');
  assert.strictEqual(zb(-80, 0), '31C');
  assert.strictEqual(zb(10, 180), '1P');
  assert.strictEqual(zb(10, -180), '1P');
  assert.strictEqual(zb(10, 179.9), '60P');
});

test('MGRS: reference values, precision and round trips', () => {
  assert.strictEqual(C.toMGRS(0, 0), '31N AA 66021 00000');
  // Eiffel Tower, as in the Movable Type geodesy reference (31U DQ 48251 11932).
  assert.strictEqual(C.toMGRS(48.8582, 2.2945), '31U DQ 48251 11932');
  assert.strictEqual(C.toMGRS(48.8582, 2.2945, 3), '31U DQ 482 119');
  assert.strictEqual(C.toMGRS(48.8582, 2.2945, 1), '31U DQ 4 1');
  assert.strictEqual(C.toMGRS(48.8582, 2.2945, 0), '31U DQ');
  assert.strictEqual(C.toMGRS(60, 5).slice(0, 6), '32V KM');
  assert.strictEqual(C.toMGRS(78, 15).slice(0, 6), '33X WG');
  assert.strictEqual(C.toMGRS(-33.8688, 151.2093).slice(0, 6), '56H LH');
  assert.strictEqual(C.toMGRS(85, 10), null);
  assert.strictEqual(C.toMGRS(-81, 10), null);
  // Single-digit zones are padded.
  assert.match(C.toMGRS(21.3, -157.9), /^04Q /);

  const pts = [[52.30861, 4.76389], [53.47, 6.16], [50.77, 5.98], [-33.87, 151.21], [-54.8, -68.3], [60, 5], [78, 15], [83.9, 20], [-79.9, -60], [0.001, 0.001], [-0.001, -0.001], [7.5, -1.2], [-41.29, 174.78], [25.03, 121.56]];
  for (const [lat, lon] of pts) {
    const m = C.toMGRS(lat, lon);
    const p = C.fromMGRS(m);
    // Truncated to 1 m and decoded to the square's centre: within 0.71 m.
    assert.ok(metres(p, { lat, lon }) < 0.75, `${lat},${lon} -> ${m} -> ${p.lat},${p.lon}`);
  }
});

test('MGRS parsing is tolerant', () => {
  const ref = C.fromMGRS('31U DQ 48251 11932');
  assert.ok(metres(ref, { lat: 48.8582, lon: 2.2945 }) < 1.5);
  for (const s of ['31UDQ4825111932', '31u dq 48251 11932', ' 31U DQ4825111932 ', '31U  DQ  48251  11932']) assert.deepStrictEqual(C.fromMGRS(s), ref, s);
  // Fewer digits: the centre of the 10 m / 1 km / 100 km square.
  assert.ok(metres(C.fromMGRS('31U DQ 4825 1193'), ref) < 10);
  assert.ok(metres(C.fromMGRS('31U DQ 48 11'), ref) < 1000);
  assert.ok(metres(C.fromMGRS('31U DQ'), { lat: 48.8582, lon: 2.2945 }) < 75000);
  assert.ok(metres(C.fromMGRS('4QFJ12345678'), { lat: 21.4, lon: -157.9 }) < 20000);
  assert.strictEqual(C.fromMGRS('31U DQ 4825 11932'), null, 'unequal halves');
  assert.strictEqual(C.fromMGRS('31U DQ 482511193'), null, 'odd digit count');
  assert.strictEqual(C.fromMGRS('61U DQ 48251 11932'), null);
  assert.strictEqual(C.fromMGRS('31I DQ 48251 11932'), null);
  assert.strictEqual(C.fromMGRS('31U SQ 48251 11932'), null, 'column letter not used in zone 31');
  assert.strictEqual(C.fromMGRS('Amsterdam'), null);
  assert.strictEqual(C.fromMGRS(''), null);
  assert.strictEqual(C.fromMGRS(null), null);
});

test('fmt: all styles, display and copy', () => {
  const lat = 52.30861, lon = 4.76389;
  assert.strictEqual(C.fmt(lat, lon, 'dd'), '52,30861°N 4,76389°E');
  assert.strictEqual(C.fmt(lat, lon), '52,30861°N 4,76389°E');
  assert.strictEqual(C.fmt(lat, lon, 'dd', { copy: true }), '52.30861°N 4.76389°E');
  assert.strictEqual(C.fmt(lat, lon, 'dms'), '52°18\'31,0"N 004°45\'50,0"E');
  assert.strictEqual(C.fmt(lat, lon, 'dms', { copy: true }), '52°18\'31.0"N 004°45\'50.0"E');
  assert.strictEqual(C.fmt(lat, lon, 'ddm'), 'N52°18,517\' E004°45,833\'');
  assert.strictEqual(C.fmt(lat, lon, 'ddm', { copy: true }), 'N52°18.517\' E004°45.833\'');
  assert.strictEqual(C.fmt(lat, lon, 'avi'), 'N52 18.52 E004 45.83');
  assert.strictEqual(C.fmt(lat, lon, 'mgrs'), '31U FT 20252 96828');
  assert.strictEqual(C.fmt(lat, lon, 'mgrs', { digits: 4 }), '31U FT 2025 9682');
  assert.strictEqual(C.fmt(lat, lon, 'utm'), '31U 620253 5796829');
  const [, , , x, y] = PDOK[0];
  const dam = C.fromRD(x, y);
  assert.strictEqual(C.fmt(dam.lat, dam.lon, 'rd'), 'RD 121348 487348');
  // South/west, rounding that carries into the next minute and degree.
  assert.strictEqual(C.fmt(-33.99999, -70.999999, 'dms'), '34°00\'00,0"S 071°00\'00,0"W');
  assert.strictEqual(C.fmt(-33.99999, -70.999999, 'ddm', { copy: true }), 'S33°59.999\' W071°00.000\'');
  assert.strictEqual(C.fmt(-33.99999, -70.999999, 'avi'), 'S34 00.00 W071 00.00');
  assert.strictEqual(C.fmt(0, 0, 'dd'), '0,00000°N 0,00000°E');
  assert.strictEqual(C.fmt(52.5, 179.9999999, 'dms'), '52°30\'00,0"N 180°00\'00,0"E');
  // Outside the RD area / polar MGRS.
  assert.strictEqual(C.fmt(40, -74, 'rd'), null);
  assert.strictEqual(C.fmt(88, 0, 'mgrs'), null);
  assert.strictEqual(C.fmt(NaN, 4, 'dd'), '');
});

test('fmt output parses back to the same place', () => {
  const pts = [[52.30861, 4.76389], [-33.8688, 151.2093], [51.44, 3.57], [40.7128, -74.006], [-0.5, -0.5]];
  for (const [lat, lon] of pts) {
    for (const [style, tol] of [['dd', 1.2], ['dms', 2], ['ddm', 1.2], ['avi', 10], ['mgrs', 0.75], ['rd', 1.5]]) {
      for (const copy of [false, true]) {
        const s = C.fmt(lat, lon, style, { copy });
        if (s == null) continue;
        const p = C.parse(s);
        assert.ok(p, `${style}: ${s}`);
        assert.ok(metres(p, { lat, lon }) < tol, `${style}: ${s} -> ${p.lat},${p.lon}`);
      }
    }
  }
});

test('parse: decimal degrees with dots and Dutch commas', () => {
  const ok = (s, lat, lon, format = 'dd') => {
    const p = C.parse(s);
    assert.ok(p, `no result for ${s}`);
    assert.ok(Math.abs(p.lat - lat) < 1e-9 && Math.abs(p.lon - lon) < 1e-9, `${s}: ${p.lat},${p.lon}`);
    assert.strictEqual(p.format, format, s);
  };
  ok('52.3086, 4.7639', 52.3086, 4.7639);
  ok('52.3086 4.7639', 52.3086, 4.7639);
  ok('52.3086,4.7639', 52.3086, 4.7639);
  ok('52,3086 4,7639', 52.3086, 4.7639);
  ok('52,3086, 4,7639', 52.3086, 4.7639);
  ok('52,3086,4,7639', 52.3086, 4.7639);
  ok('52,3086; 4,7639', 52.3086, 4.7639);
  ok('52.3086/4.7639', 52.3086, 4.7639);
  ok('  52.3086 ,  4.7639  ', 52.3086, 4.7639);
  ok('-33.5, -70.25', -33.5, -70.25);
  ok('+52.5 +4.5', 52.5, 4.5);
  ok('52.3086° 4.7639°', 52.3086, 4.7639);
  ok('-52.5° -4,5°', -52.5, -4.5);
  ok('52.3086N 4.7639W', 52.3086, -4.7639);
  ok('N52.3086 E4.7639', 52.3086, 4.7639);
  ok('S 33,5 W 70,25', -33.5, -70.25);
  ok('N52 E4', 52, 4);
});

test('parse: degrees-minutes(-seconds), packed and spaced', () => {
  const dms = 52 + 18 / 60 + 31 / 3600, dmsLon = 4 + 45 / 60 + 50 / 3600;
  const ok = (s, lat, lon, format) => {
    const p = C.parse(s);
    assert.ok(p, `no result for ${s}`);
    assert.ok(Math.abs(p.lat - lat) < 1e-9 && Math.abs(p.lon - lon) < 1e-9, `${s}: ${p.lat},${p.lon}`);
    if (format) assert.strictEqual(p.format, format, s);
  };
  ok('N52°18.517 E4°45.833', 52 + 18.517 / 60, 4 + 45.833 / 60, 'ddm');
  ok('N52°18,517\' E004°45,833\'', 52 + 18.517 / 60, 4 + 45.833 / 60, 'ddm');
  ok('n52 18.52 e004 45.83', 52 + 18.52 / 60, 4 + 45.83 / 60, 'ddm');
  ok('N5218.5 E00445.8', 52 + 18.5 / 60, 4 + 45.8 / 60, 'ddm');
  ok('N5218.5, E00445.8', 52 + 18.5 / 60, 4 + 45.8 / 60, 'ddm');
  ok('5218.5N 00445.8E', 52 + 18.5 / 60, 4 + 45.8 / 60, 'ddm');
  ok('52°18\'31"N 4°45\'50"E', dms, dmsLon, 'dms');
  ok('52°18\'31"N, 4°45\'50"E', dms, dmsLon, 'dms');
  ok('52°18′31″N 4°45′50″E', dms, dmsLon, 'dms');
  ok('52º18’31”N 4º45’50”E', dms, dmsLon, 'dms');
  ok('52°18\'31\'\'N 4°45\'50\'\'E', dms, dmsLon, 'dms');
  ok('52°18\'31,5"N 4°45\'50,5"E', dms + 0.5 / 3600, dmsLon + 0.5 / 3600, 'dms');
  ok('521831N 0044550E', dms, dmsLon, 'dms');
  ok('N521831 E0044550', dms, dmsLon, 'dms');
  ok('521831.5N 0044550.5E', dms + 0.5 / 3600, dmsLon + 0.5 / 3600, 'dms');
  ok('52 18 31 N 4 45 50 E', dms, dmsLon, 'dms');
  ok('52 18 31 S 4 45 50 W', -dms, -dmsLon, 'dms');
  ok('N 52 18 31 W 4 45 50', dms, -dmsLon, 'dms');
  ok('E4°45\'50" N52°18\'31"', dms, dmsLon, 'dms');
  ok('52°18\'31"N 4°45\'50"O', dms, dmsLon, 'dms');
  ok('52°18\'31"Z 4°45\'50"W', -dms, -dmsLon, 'dms');
  ok('52°18\'31" 4°45\'50"', dms, dmsLon, 'dms');
  ok('-52°18\'31" -4°45\'50"', -dms, -dmsLon, 'dms');
  ok('523000S 1763000W', -52.5, -176.5, 'dms');
});

test('parse: RD', () => {
  const near = (s, lat, lon) => {
    const p = C.parse(s);
    assert.ok(p, `no result for ${s}`);
    assert.strictEqual(p.format, 'rd', s);
    assert.ok(metres(p, { lat, lon }) < 1.5, `${s}: ${p.lat},${p.lon}`);
  };
  for (const [name, lon, lat, x, y] of PDOK) {
    near(`RD ${Math.round(x)} ${Math.round(y)}`, lat, lon);
    near(`${Math.round(x)} ${Math.round(y)}`, lat, lon);
    near(`${x}, ${y}`, lat, lon);
    assert.ok(name);
  }
  const [, lon, lat] = PDOK[0];
  near('RD 121348 487348', lat, lon);
  near('rd: 121348, 487348', lat, lon);
  near('RD121348/487348', lat, lon);
  near('RD 121.348 487.348', lat, lon);
  near('RD 121348 487348 m', lat, lon);
  near('487348 121348', lat, lon);
  assert.strictEqual(C.parse('RD 900000 487000'), null);
  assert.strictEqual(C.parse('121348 700000'), null, 'y outside the RD range');
  assert.strictEqual(C.parse('400000 487000'), null, 'x outside the RD range');
});

test('parse: MGRS', () => {
  for (const s of ['31UFU1234567890', '31U FU 12345 67890', '31u fu 12345 67890', '31U FU 1234 6789']) {
    const p = C.parse(s);
    assert.ok(p, s);
    assert.strictEqual(p.format, 'mgrs');
    assert.ok(metres(p, C.fromMGRS('31U FU 12345 67890')) < 15, s);
  }
});

test('parse: not a coordinate', () => {
  const no = ['', '   ', 'Amsterdam', 'Dam 1 Amsterdam', 'Den Helder', 'Schiphol', 'EHAM', 'Vlissingen', 'Nieuwe Werk',
    'Sneek', 'Oost', 'West', 'NEW', 'N', 'Zwolle', 'Maastricht Aachen', '1012 AB', '1012AB Amsterdam', '3011 AD',
    'A4', 'A12 afrit 5', 'N201', 'N 201', '52', '52 4', '52,4', '12345', '2026-10-16', '10:30', '06-12345678',
    'Kanaalweg 1-3', 'Ring A10 52', '91.0, 4.0', '52.3 181.2', 'N52 61 E4', 'N52 18 E4 61', 'N 52 S 4', 'E4 W5',
    '52°18\'31"N', 'N52 18 31 12 E4', '0044550 521831', '52.3086 4.7639 12.5', null, undefined, 42];
  for (const s of no) assert.strictEqual(C.parse(s), null, JSON.stringify(s));
});
