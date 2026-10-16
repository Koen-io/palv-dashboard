// Zoek & Plan: the search box (PDOK, Photon, OurAirports). Never touches the network: every answer comes
// from test/fixtures/plan-geocode. `node --test test/plan-geocode.test.js`.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const geocode = require('../src/plan/geocode');

const FIX = path.join(__dirname, 'fixtures', 'plan-geocode');
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));
const csv = (n) => fs.readFileSync(path.join(FIX, n), 'utf8');
const quiet = { info() {}, warn() {} };
const UTRECHT = { lat: 52.09, lon: 5.12 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'palv-geocode-'));

// A fake fetchJson that answers by URL and records every request.
function fake(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(url);
    for (const [re, answer] of routes) if (re.test(url)) return typeof answer === 'function' ? answer(url, opts) : answer;
    throw new Error('HTTP 404 ' + url);
  };
  fn.calls = calls;
  fn.count = (re) => calls.filter((u) => re.test(u)).length;
  return fn;
}

// Writes the fixture CSVs as a downloaded OurAirports folder and builds the index there.
async function withAirports(dir, extra = {}) {
  const fetchText = async (url) => csv(url.split('/').pop());
  geocode.start({ dir, fetchJson: extra.fetchJson || fake([]), fetchText, log: quiet, autoUpdate: false });
  await geocode.refreshAirports();
}

test('CSV: quoted commas, doubled quotes, line breaks and CRLF', () => {
  const rows = geocode.parseCsv('a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"line\none",\n3,,"end"\n');
  assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'he said "hi"'], ['2', 'line\none', ''], ['3', '', 'end']]);
  assert.deepStrictEqual(geocode.parseCsv('x,y'), [['x', 'y']], 'no final newline');
  assert.deepStrictEqual(geocode.parseCsv('"a\r\nb",c\n\n'), [['a\r\nb', 'c']], 'CRLF inside quotes stays, blank line skipped');
  const objs = geocode.csvObjects(csv('airports.csv'));
  assert.strictEqual(objs.length, 50);
  const eham = objs.find((o) => o.ident === 'EHAM');
  assert.strictEqual(eham.name, 'Amsterdam Airport Schiphol');
  assert.strictEqual(eham.iata_code, 'AMS');
  const fs_ = objs.find((o) => o.ident === 'EHFS');
  assert.strictEqual(fs_.keywords, 'KNMI, weather station, EHFS, not an airport', 'quoted field with commas');
});

test('PDOK suggest: labels and second lines per type', () => {
  const items = geocode.parsePdok(fixture('pdok-suggest.json'));
  const by = Object.fromEntries(items.map((i) => [i.kind + ':' + i.label, i]));
  assert.strictEqual(by['provincie:Utrecht'].sub, 'Provincie');
  assert.strictEqual(by['gemeente:Utrecht'].sub, 'Gemeente');
  const wpl = by['woonplaats:Utrecht'];
  assert.strictEqual(wpl.sub, 'Woonplaats · Utrecht', 'municipality equal to the place is left out');
  assert.strictEqual(wpl.id, 'pdok:wpl-d7676180b7f172bcb7356429b19563a5');
  assert.strictEqual(wpl.lat, 52.0886922);
  assert.strictEqual(wpl.lon, 5.09520363);
  assert.strictEqual(wpl.src, 'PDOK');
  assert.strictEqual(by['weg:Domplein'].sub, 'Weg · Utrecht');
  assert.strictEqual(by['adres:Domplein 21B'].sub, 'Adres · Utrecht');
  assert.strictEqual(by['postcode:3512JD'].sub, 'Postcode · Domplein, Utrecht');
  assert.strictEqual(by['provincie:Gelderland'].icon, 'boundary');
});

test('hectometre posts: what is typed and how it is asked', async () => {
  assert.deepStrictEqual(geocode.parseHmp('A2 hmp 45,3'), { road: 'A2', hm: '453', letter: '', exact: true });
  assert.deepStrictEqual(geocode.parseHmp('a2 45.3'), { road: 'A2', hm: '453', letter: '', exact: true });
  assert.deepStrictEqual(geocode.parseHmp('N201 km 20,7'), { road: 'N201', hm: '207', letter: '', exact: true });
  assert.deepStrictEqual(geocode.parseHmp('A2-453'), { road: 'A2', hm: '453', letter: '', exact: true });
  assert.deepStrictEqual(geocode.parseHmp('A13 hm 11,3 b'), { road: 'A13', hm: '113', letter: 'b', exact: true });
  assert.deepStrictEqual(geocode.parseHmp('A2 hmp 45'), { road: 'A2', hm: '45', letter: '', exact: false });
  for (const q of ['A2', 'Kerkstraat 12', 'Utrecht', '3512JE', 'A2 hmp']) assert.strictEqual(geocode.parseHmp(q), null, q);

  const fetchJson = fake([[/\/free\?.*hectometerpaal/, fixture('pdok-free-hmp.json')]]);
  geocode.start({ fetchJson, log: quiet, autoUpdate: false });
  const one = await geocode.suggest('A2 hmp 45,3', UTRECHT);
  assert.strictEqual(fetchJson.count(/identificatie%3AA2-453\*/), 1);
  assert.strictEqual(fetchJson.count(/photon/), 0, 'a post is never asked of Photon');
  assert.deepStrictEqual(one.map((i) => i.label), ['A2 hmp 45,3'], 'the wildcard matches are filtered to the post');
  assert.strictEqual(one[0].kind, 'hectometerpaal');
  assert.strictEqual(one[0].sub, 'Hectometerpaal · A2');
  assert.strictEqual(one[0].lat, 52.21093383);
  const km = await geocode.suggest('A2 hmp 45', UTRECHT);
  assert.deepStrictEqual(km.map((i) => i.label), ['A2 hmp 45,0', 'A2 hmp 45,3', 'A2 hmp 45,9'], 'all posts of km 45, in order');
});

test('Photon: kinds, labels and the extent as [s, w, n, e]', () => {
  const [city, district, state] = geocode.parsePhoton(fixture('photon-utrecht.json'));
  assert.strictEqual(city.id, 'photon:R419203');
  assert.strictEqual(city.kind, 'plaats');
  assert.strictEqual(city.label, 'Utrecht');
  assert.strictEqual(city.sub, 'Plaats · Nederland', 'province equal to the name is left out');
  assert.deepStrictEqual(city.bbox, [52.026282, 4.970096, 52.1420506, 5.195155]);
  assert.strictEqual(city.src, 'Photon');
  assert.strictEqual(district.kind, 'regio');
  assert.strictEqual(state.kind, 'regio');
  const s = geocode.parsePhoton(fixture('photon-schiphol.json'));
  assert.strictEqual(s[0].kind, 'plaats', 'hamlet');
  assert.strictEqual(s[1].kind, 'poi', 'motorway junction');
  assert.strictEqual(s[3].label, 'Schiphol Airport');
  assert.strictEqual(s[3].sub, 'Locatie · Vertrekpassage, Haarlemmermeer · Netherlands');
  assert.strictEqual(s[3].bbox, null);
  const lake = geocode.parsePhoton(fixture('photon-lake.json'));
  assert.strictEqual(lake[0].kind, 'poi', 'a commercial area');
  assert.strictEqual(lake[0].sub, 'Locatie · Tolochenaz · Schweiz/Suisse/Svizzera/Svizra');
  assert.strictEqual(lake[1].kind, 'plaats', 'a town');
  assert.strictEqual(lake[1].sub, 'Plaats · Walworth · United States', 'no town: the county');
});

test('airports: index, code and name search, ranking, details', async () => {
  const dir = tmp();
  await withAirports(dir);
  const st = geocode.status();
  assert.strictEqual(st.airports.count, 50);
  assert.ok(st.airports.updated);
  for (const f of ['airports.csv', 'runways.csv', 'airport-frequencies.csv', 'countries.csv', 'index.json', 'details.json', 'meta.json']) assert.ok(fs.existsSync(path.join(dir, 'ourairports', f)), f);

  const ids = (q, o = {}) => geocode.searchAirports(q, { bias: UTRECHT, ...o }).map((i) => i.id);
  assert.strictEqual(ids('EHAM')[0], 'apt:EHAM', 'ICAO');
  assert.strictEqual(ids('eham')[0], 'apt:EHAM', 'case does not matter');
  assert.strictEqual(ids('AMS')[0], 'apt:EHAM', 'IATA');
  assert.strictEqual(ids('RTM')[0], 'apt:EHRD');
  assert.strictEqual(ids('EH0010')[0], 'apt:NL-0006', 'Dutch hospital code from the keywords');
  assert.strictEqual(ids('NL-0015')[0], 'apt:NL-0015', 'OurAirports ident');
  assert.strictEqual(ids('EHR')[0], 'apt:EHRD', 'code prefix');
  const rot = ids('rotterdam');
  assert.strictEqual(rot[0], 'apt:EHRD', 'the airport above the heliports of the same town');
  assert.ok(rot.includes('apt:NL-0017'));
  assert.ok(!rot.includes('apt:NL-0020'), 'closed heliport left out');
  assert.ok(ids('rotterdam', { closed: true }).includes('apt:NL-0020'), 'unless asked');
  assert.strictEqual(ids('monchengladbach')[0], 'apt:EDLN', 'accents ignored');
  assert.strictEqual(ids('Mönchen')[0], 'apt:EDLN');
  assert.strictEqual(ids('heliport')[0], 'apt:NL-0015', 'among equals the nearest wins (UMC Utrecht)');
  assert.strictEqual(geocode.searchAirports('heliport', { bias: { lat: 53.2, lon: 6.6 } })[0].id, 'apt:NL-0006', 'and near Groningen the Groningen one');
  const lon = ids('london');
  assert.deepStrictEqual(lon.slice(0, 2).sort(), ['apt:EGKK', 'apt:EGLL'], 'large airports above medium (London City)');
  assert.strictEqual(lon[2], 'apt:EGLC');
  assert.deepStrictEqual(ids('x'), [], 'one letter is too vague');

  const it = geocode.searchAirports('EHRD')[0];
  assert.strictEqual(it.kind, 'luchthaven');
  assert.strictEqual(it.sub, 'EHRD / RTM · Luchthaven · Rotterdam · Netherlands');
  assert.strictEqual(geocode.searchAirports('EHHA')[0].kind, 'heliport');
  assert.strictEqual(geocode.searchAirports('EHTE')[0].kind, 'vliegveld');

  const a = geocode.airport('EHAM');
  assert.strictEqual(a.iata, 'AMS');
  assert.strictEqual(a.elevation_ft, -11);
  assert.strictEqual(a.countryName, 'Netherlands');
  assert.strictEqual(a.scheduled, true);
  assert.strictEqual(a.runways.length, 6);
  assert.ok(a.runways.some((r) => r.ident === '18R/36L'));
  assert.ok(a.frequencies.some((f) => f.type === 'APP' && f.mhz === 119.055));
  assert.strictEqual(geocode.airport('apt:ehrd').ident, 'EHRD');
  assert.strictEqual(geocode.airport('RTM').ident, 'EHRD', 'by IATA too');
  assert.deepStrictEqual(geocode.airport('EHGG').runways, [], 'no details in the fixture');
  assert.strictEqual(geocode.airport('XXXX'), null);

  // A restart reads the index from disk, without downloading.
  geocode.start({ dir, fetchJson: fake([]), fetchText: async () => { throw new Error('no network in tests'); }, log: quiet, autoUpdate: false });
  assert.strictEqual(geocode.status().airports.count, 50);
  assert.strictEqual(geocode.airport('EHAM').runways.length, 6);
});

test('airports: the monthly check sends the validators and keeps the index on 304', async () => {
  const dir = tmp();
  const seen = [];
  const fetchText = async (url, opts) => {
    seen.push({ url, headers: opts.headers });
    if (opts.headers['If-None-Match']) return { status: 304, text: '' };
    return { status: 200, text: csv(url.split('/').pop()), etag: '"v1"', lastModified: 'Fri, 16 Oct 2026 01:54:04 GMT' };
  };
  geocode.start({ dir, fetchJson: fake([]), fetchText, log: quiet, autoUpdate: false });
  assert.strictEqual(await geocode.refreshAirports(), true);
  assert.strictEqual(seen.length, 4);
  assert.strictEqual(seen[0].headers['User-Agent'], 'P-ALV-Dashboard/1.17 (desktop dashboard)');
  assert.strictEqual(await geocode.refreshAirports(), false, 'nothing changed');
  assert.strictEqual(seen.length, 8);
  assert.strictEqual(seen[4].headers['If-None-Match'], '"v1"');
  assert.strictEqual(seen[4].headers['If-Modified-Since'], 'Fri, 16 Oct 2026 01:54:04 GMT');
  assert.strictEqual(geocode.status().airports.count, 50);
  // A failed download keeps what there is and is reported.
  geocode.start({ dir, fetchJson: fake([]), fetchText: async () => { throw new Error('HTTP 503'); }, log: quiet, autoUpdate: false });
  assert.strictEqual(await geocode.refreshAirports({ force: true }), false);
  assert.strictEqual(geocode.status().airports.error, 'HTTP 503');
  assert.strictEqual(geocode.status().airports.count, 50);
});

test('merge: Photon duplicates of PDOK places and of airports are dropped', () => {
  const pdok = geocode.parsePdok(fixture('pdok-suggest.json'));
  const photon = geocode.parsePhoton(fixture('photon-utrecht.json'));
  const out = geocode.merge({ pdok, photon }, 20);
  assert.strictEqual(out.filter((i) => i.src === 'Photon').length, 0, 'city, district and province of Utrecht are all known to PDOK');
  assert.strictEqual(out[0].src, 'PDOK');

  const P = (over) => ({ id: 'pdok:1', label: 'Kerkstraat 1', sub: '', kind: 'adres', lat: 52.0, lon: 5.0, src: 'PDOK', ...over });
  const F = (over) => ({ id: 'photon:N1', label: 'Kerkstraat 1', sub: '', kind: 'adres', lat: 52.001, lon: 5.0, src: 'Photon', ...over });
  assert.deepStrictEqual(geocode.merge({ pdok: [P()], photon: [F()] }).map((i) => i.id), ['pdok:1'], '111 m apart: the same');
  assert.deepStrictEqual(geocode.merge({ pdok: [P()], photon: [F({ lat: 52.004 })] }).map((i) => i.id), ['pdok:1', 'photon:N1'], '445 m: another');
  assert.deepStrictEqual(geocode.merge({ pdok: [P()], photon: [F({ label: 'Café de Kerk', kind: 'poi', lat: 52.0005 })] }).length, 2, 'a different place nearby stays');
  const apt = { id: 'apt:EHAM', label: 'Amsterdam Airport Schiphol', kind: 'luchthaven', lat: 52.3086, lon: 4.76389, src: 'OurAirports', score: 117 };
  const ph = { id: 'photon:W1', label: 'Luchthaven Schiphol', kind: 'luchthaven', lat: 52.31, lon: 4.765, src: 'Photon' };
  const m = geocode.merge({ airports: [apt], photon: [ph] });
  assert.deepStrictEqual(m.map((i) => i.id), ['apt:EHAM']);
  assert.strictEqual(m[0].score, undefined, 'ranking scores are not passed on');
  assert.strictEqual(geocode.merge({ pdok: [P(), P({ id: 'pdok:2' }), P({ id: 'pdok:3' })] }, 2).length, 2, 'limit');
});

test('suggest: sources, gating of Photon, caching and failure of one source', async () => {
  const dir = tmp();
  const routes = [
    [/locatieserver.*\/suggest\?q=utrecht/, fixture('pdok-suggest.json')],
    [/locatieserver.*\/suggest\?q=schiphol/, { response: { docs: [] } }],
    [/locatieserver.*\/suggest/, { response: { docs: [] } }],
    [/photon\.komoot\.io\/api\/\?q=schiphol/, fixture('photon-schiphol.json')],
    [/photon\.komoot\.io\/api\/\?q=utrecht/, fixture('photon-utrecht.json')],
  ];
  const fetchJson = fake(routes);
  await withAirports(dir, { fetchJson });

  // Enough from PDOK and world search off: Photon is not asked.
  let r = await geocode.suggest('utrecht', { ...UTRECHT, limit: 12 });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(fetchJson.count(/photon/), 0);
  assert.ok(r.length >= 7);
  assert.ok(fetchJson.calls[0].includes('&lat=52.09000&lon=5.12000'), 'biased to the map');
  assert.ok(decodeURIComponent(fetchJson.calls[0]).includes('fq=type:(provincie OR gemeente OR woonplaats OR weg OR postcode OR adres)'));
  assert.ok(r.some((i) => i.id === 'apt:NL-0015'), 'the UMC Utrecht heliport is among the results');

  // With world search on Photon is asked too; its Utrecht duplicates are dropped.
  r = await geocode.suggest('utrecht', { ...UTRECHT, world: true });
  assert.strictEqual(fetchJson.count(/photon/), 1);
  assert.ok(fetchJson.calls.some((u) => /photon.*lat=52\.0900&lon=5\.1200/.test(u)));
  assert.strictEqual(r.filter((i) => i.src === 'Photon').length, 0);

  // PDOK has nothing: Photon is asked even with world search off; the airport comes along.
  r = await geocode.suggest('schiphol', UTRECHT);
  assert.strictEqual(fetchJson.count(/photon.*q=schiphol/), 1);
  assert.strictEqual(r[0].id, 'apt:EHAM');
  assert.ok(r.some((i) => i.id === 'photon:R1883613'));
  // Asked again: from the day cache, also after a restart (saved on disk).
  await geocode.suggest('Schiphol', UTRECHT);
  assert.strictEqual(fetchJson.count(/photon.*q=schiphol/), 1, 'cached');
  geocode.saveCaches();
  const again = fake(routes);
  geocode.start({ dir, fetchJson: again, log: quiet, autoUpdate: false });
  r = await geocode.suggest('schiphol', UTRECHT);
  assert.strictEqual(again.count(/photon/), 0, 'cache read back from disk');
  assert.ok(r.some((i) => i.src === 'Photon'));
  assert.strictEqual(geocode.status().photon.cached, 2);

  // Short queries and exact airport codes do not bother Photon.
  await geocode.suggest('ze', UTRECHT);
  await geocode.suggest('EHRD', UTRECHT);
  assert.strictEqual(again.count(/photon/), 0);
  assert.strictEqual((await geocode.suggest('   ', UTRECHT)).length, 0);
});

test('suggest never throws: a failing source is reported, the others still answer', async () => {
  const dir = tmp();
  const fetchJson = fake([
    [/locatieserver/, () => { throw new Error('HTTP 503'); }],
    [/photon/, () => { throw new Error('HTTP 429'); }],
  ]);
  await withAirports(dir, { fetchJson });
  let r = await geocode.suggest('rotterdam', UTRECHT);
  assert.strictEqual(r[0].id, 'apt:EHRD');
  assert.deepStrictEqual(r.errors.map((e) => e.src).sort(), ['PDOK', 'Photon']);
  assert.ok(r.errors.find((e) => e.src === 'PDOK').message.includes('503'));
  assert.ok(geocode.status().photon.paused, 'Photon rests after a 429');
  r = await geocode.suggest('rotterdamse', UTRECHT);
  assert.strictEqual(fetchJson.count(/photon/), 1, 'and is not asked while resting');
  assert.deepStrictEqual(r.errors.map((e) => e.src), ['PDOK']);
});

test('resolve: PDOK lookup with bbox and RD, cached; airports and Photon from memory', async () => {
  const dir = tmp();
  const fetchJson = fake([
    [/\/lookup\?id=wpl-d7676180b7f172bcb7356429b19563a5/, fixture('pdok-lookup.json')],
    [/\/lookup/, { response: { numFound: 0, docs: [] } }],
    [/locatieserver.*\/suggest/, { response: { docs: [] } }],
    [/photon/, fixture('photon-schiphol.json')],
  ]);
  await withAirports(dir, { fetchJson });
  const v = await geocode.resolve('pdok:wpl-d7676180b7f172bcb7356429b19563a5');
  assert.strictEqual(v.label, 'Utrecht');
  assert.strictEqual(v.lat, 52.0886922);
  assert.strictEqual(v.lon, 5.09520363);
  assert.deepStrictEqual(v.bbox, [52.0416, 5.01514, 52.12099, 5.17065]);
  assert.deepStrictEqual(v.rd, { x: 134987.52, y: 455643.648 });
  await geocode.resolve('pdok:wpl-d7676180b7f172bcb7356429b19563a5');
  assert.strictEqual(fetchJson.count(/\/lookup/), 1, 'cached');
  assert.strictEqual(await geocode.resolve('pdok:adr-unknown'), null);

  const e = await geocode.resolve('apt:EHRD');
  assert.strictEqual(e.label, 'Rotterdam The Hague Airport');
  assert.strictEqual(e.lat, 51.9569);
  await geocode.suggest('schiphol plaza', UTRECHT);
  const p = await geocode.resolve('photon:R1883613');
  assert.deepStrictEqual(p.bbox, [52.2829353, 4.7059217, 52.3680121, 4.8170755]);
  assert.strictEqual(await geocode.resolve('photon:N0'), null);
});

test('reverse: PDOK in the Netherlands, Photon elsewhere and when PDOK is far off', async () => {
  const fetchJson = fake([
    [/locatieserver.*\/reverse\?lat=52\.0907/, fixture('pdok-reverse.json')],
    [/locatieserver.*\/reverse/, fixture('pdok-reverse-far.json')],
    [/photon\.komoot\.io\/reverse\?lat=50\.85/, fixture('photon-reverse.json')],
    [/photon\.komoot\.io\/reverse/, () => { throw new Error('HTTP 502'); }],
  ]);
  geocode.start({ fetchJson, log: quiet, autoUpdate: false });
  const nl = await geocode.reverse(52.0907, 5.1214);
  assert.deepStrictEqual({ label: nl.label, sub: nl.sub, src: nl.src, distance: nl.distance }, { label: 'Domplein 21', sub: 'Adres · 3512JE Utrecht', src: 'PDOK', distance: 10 });
  await geocode.reverse(52.09071, 5.12141);
  assert.strictEqual(fetchJson.count(/reverse/), 1, 'cached per ~10 m');

  const be = await geocode.reverse(50.85, 4.35);
  assert.strictEqual(be.src, 'Photon');
  assert.strictEqual(fetchJson.count(/locatieserver.*reverse/), 1, 'outside the Netherlands PDOK is not asked');
  assert.strictEqual(be.label, 'Guichet logement - Huisvestingsloket');
  assert.ok(be.sub.endsWith('België / Belgique / Belgien'));

  // Near the border: PDOK's nearest address is 48 km away and Photon fails: PDOK, with the distance.
  const border = await geocode.reverse(51.3, 3.5);
  assert.strictEqual(border.src, 'PDOK');
  assert.strictEqual(border.label, 'Gentsevaart 74');
  assert.ok(border.sub.endsWith('48,6 km'), border.sub);
});
