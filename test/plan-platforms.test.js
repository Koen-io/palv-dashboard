// Offshore platforms for the planning map: the parsers of every source (trimmed real answers), the ZIP
// reader, status normalisation, the datum corrections, merging across sources, and the disk cache with
// its background refresh. Nothing touches the network. `node --test test/plan-platforms.test.js`.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const p = require('../src/plan/platforms');

const FIX = path.join(__dirname, 'fixtures', 'plan-platforms');
const raw = (f) => fs.readFileSync(path.join(FIX, f));
const json = (f) => JSON.parse(raw(f).toString('utf8'));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'plan-platforms-'));
const quiet = { info() {}, warn() {} };
const byId = (list, id) => list.find((x) => x.id === id);
const field = (x, label) => { const f = x.fields.find((r) => r[0] === label); return f ? f[1] : undefined; };
const zipText = (f) => [...p.unzip(raw(f)).values()][0].toString('latin1');
const boemText = () => ({ mast: zipText('boem-platmast.zip'), loc: zipText('boem-platloc.zip'), stru: zipText('boem-platstru.zip'), comp: zipText('boem-compall.zip') });
const KEYS = ['id', 'name', 'lat', 'lon', 'country', 'offshore', 'kind', 'status', 'operator', 'waterDepthM', 'helideck', 'helideckElevationM', 'src', 'srcUrl', 'updated', 'fields'];

test('status normalisation into the Dutch set', () => {
  const cases = {
    USE: 'in gebruik', ABN: 'ontmanteld', REM: 'verwijderd', NUS: 'buiten gebruik', 'In use': 'in gebruik', Operational: 'in gebruik', active: 'in gebruik',
    'IN SERVICE': 'in gebruik', 'In gebruik': 'in gebruik', 'Not in use': 'buiten gebruik', 'SHUT DOWN': 'buiten gebruik', 'Closed down': 'buiten gebruik',
    'LAID UP': 'buiten gebruik', Decommissioned: 'ontmanteld', 'ABANDONED IN PLACE': 'ontmanteld', ABANDONED: 'ontmanteld', 'PARTLY REMOVED': 'ontmanteld',
    Removed: 'verwijderd', 'DISPOSAL COMPLETED': 'verwijderd', FUTURE: 'gepland', Toekomstig: 'gepland', 'In ontwikkeling': 'gepland', 'In ontwerp': 'gepland',
    'Under construction': 'gepland', INSTALLATION: 'gepland', FABRICATION: 'gepland', '': 'onbekend', null: 'onbekend', 'whatever': 'onbekend',
  };
  for (const [k, v] of Object.entries(cases)) assert.strictEqual(p.normStatus(k === 'null' ? null : k), v, k);
});

test('names compare without case, brackets, "platform" and leading zeros', () => {
  assert.strictEqual(p.normName('K09ab-B'), p.normName('K9ab-B'));
  assert.strictEqual(p.normName('Grove (United Kingdom)'), p.normName('GROVE PLATFORM'));
  assert.strictEqual(p.normName('Kårstø'), 'KARSTO');
});

test('unzip reads deflated (real archive) and stored entries, refuses junk', () => {
  const files = p.unzip(raw('boem-platmast.zip'));
  assert.deepStrictEqual([...files.keys()], ['platmast.DAT']);
  assert.match(files.get('platmast.DAT').toString('latin1'), /^ {5}183NYYY/m);
  // A stored (method 0) archive with one entry, built by hand.
  const data = Buffer.from('hallo platform');
  const name = Buffer.from('a.txt');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
  const body = Buffer.concat([local, name, data]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(body.length, 16);
  const zip = Buffer.concat([body, central, name, end]);
  assert.strictEqual(p.unzip(zip).get('a.txt').toString(), 'hallo platform');
  assert.throws(() => p.unzip(Buffer.from('dit is geen zip')), /zip/);
});

test('NLOG: offshore and onshore, kinds, statuses, UK facilities', () => {
  const list = p.parseNlog(json('nlog.json'));
  assert.strictEqual(list.length, 12);
  for (const x of list) assert.deepStrictEqual(Object.keys(x), KEYS);
  const a = byId(list, 'nlog:L13-FE-1');
  assert.deepStrictEqual([a.kind, a.offshore, a.status, a.country, a.src], ['platform', true, 'in gebruik', 'NL', 'NLOG']);
  assert.ok(Math.abs(a.lat - 53.313144) < 1e-6 && Math.abs(a.lon - 4.24674) < 1e-6);
  assert.strictEqual(field(a, 'Type'), 'Productieplatform');
  assert.match(field(a, 'Putten'), /^L13-FE-101, L13-FE-102/);
  const slo = byId(list, 'nlog:SLO');
  assert.deepStrictEqual([slo.kind, slo.offshore, slo.status], ['onshore', false, 'ontmanteld']);
  assert.strictEqual(byId(list, 'nlog:LWO').offshore, false, 'onshore satellite');
  assert.strictEqual(byId(list, 'nlog:HAG-GT').kind, 'onshore');
  assert.deepStrictEqual([byId(list, 'nlog:L14-S1').kind, byId(list, 'nlog:L14-S1').status], ['subsea', 'verwijderd']);
  assert.strictEqual(byId(list, 'nlog:Sidetap K12A').kind, 'subsea');
  assert.strictEqual(byId(list, 'nlog:F2-A-Hanze TMLS').kind, 'other');
  assert.strictEqual(byId(list, 'nlog:ZDW').offshore, true, 'Zuidwal in the Wadden Sea is a platform');
  assert.strictEqual(byId(list, 'nlog:Grove').country, 'GB');
  assert.strictEqual(byId(list, 'nlog:Chiswick').status, 'onbekend');
});

test('Rijkswaterstaat: turbines, substations (HKZ duplicates dropped), farm areas', () => {
  const list = p.parseRws(json('rws-turbines.json'));
  const subs = list.filter((x) => x.kind === 'substation');
  assert.deepStrictEqual(subs.map((x) => x.name).sort(), ['HKZ Alpha', 'HKZ Beta', 'Nederwiek 1']);
  assert.strictEqual(subs.find((x) => x.name === 'Nederwiek 1').status, 'gepland');
  assert.strictEqual(subs.find((x) => x.name === 'HKZ Beta').operator, 'TenneT');
  const t = byId(list, 'rws:1');
  assert.deepStrictEqual([t.kind, t.name, t.operator, t.country], ['turbine', 'Luchterduinen 30', 'Q10 Offshore Wind BV', 'NL']);
  const a = p.parseRwsAreas(json('rws-farms.json'), json('rws-zones.json'));
  assert.strictEqual(a.farms.length, 2);
  assert.deepStrictEqual([a.farms[0].name, a.farms[0].status, a.farms[0].owner, a.farms[0].polygon.type], ['Borssele Kavel II', 'in gebruik', 'Ørsted', 'Polygon']);
  assert.strictEqual(a.farms[1].status, 'gepland');
  assert.strictEqual(a.farms[1].owner, null);
  assert.deepStrictEqual([a.zones[0].name, a.zones[0].kind, a.zones[0].bufferM], ['Borssele Alpha', 'substation', 500]);
});

test('EMODnet: ED50 positions corrected for NL/NO/DK/IE, British and Italian ones kept', () => {
  const list = p.parseEmodnet(json('emodnet.json'));
  const nlog = byId(p.parseNlog(json('nlog.json')), 'nlog:L13-FE-1');
  const e = byId(list, 'emodnet:118117761');
  const rawPos = json('emodnet.json').features.find((f) => f.properties.name === 'L13-FE-1').geometry.coordinates;
  assert.ok(p.distM(rawPos[1], rawPos[0], nlog.lat, nlog.lon) > 100, 'the raw position is about 120 m off');
  assert.ok(p.distM(e.lat, e.lon, nlog.lat, nlog.lon) < 10, 'corrected within a few metres');
  const sod = byId(p.parseSodir(json('sodir.json').features), 'sodir:271245');
  assert.ok(p.distM(byId(list, 'emodnet:271245').lat, byId(list, 'emodnet:271245').lon, sod.lat, sod.lon) < 10);
  const argo = list.find((x) => x.name === 'ARGO 1');
  const argoRaw = json('emodnet.json').features.find((f) => f.properties.name === 'ARGO 1').geometry.coordinates;
  assert.deepStrictEqual([argo.lat, argo.lon, argo.country, argo.kind, argo.waterDepthM], [argoRaw[1], argoRaw[0], 'IT', 'subsea', 560]);
  const grove = list.find((x) => x.name === 'GROVE PLATFORM');
  const nsta = p.parseNsta(json('nsta.json').features).find((x) => x.name === 'GROVE PLATFORM');
  assert.ok(p.distM(grove.lat, grove.lon, nsta.lat, nsta.lon) < 2, 'British positions are WGS84 already');
  assert.strictEqual(field(e, 'Gewicht bovenbouw (t)'), 9550);
  assert.strictEqual(field(e, 'Constructie'), 'Vast, staal');
  // Without NAD27 data at hand: the Gulf fit moves a point about 26 m north.
  const [la] = p.nad27GulfToWgs84(27, -91);
  assert.ok(Math.abs((la - 27) * 111320 - 27.6) < 2);
});

test('GEUS: helideck and highest point from both layers', () => {
  const list = p.parseGeus(raw('geus-platform.xml').toString('utf8'), raw('geus-flight.xml').toString('utf8'));
  assert.strictEqual(list.length, 3);
  const sa = byId(list, 'geus:308');
  assert.deepStrictEqual([sa.name, sa.helideck, sa.helideckElevationM, sa.waterDepthM, sa.operator, sa.country], ['SYD ARNE', true, 51.3, 60, 'INEOS E&P A/S', 'DK']);
  assert.strictEqual(field(sa, 'Hoogste punt (m)'), 119.5);
  assert.strictEqual(field(sa, 'Luchtvaartobstakels'), 'Flare Tower 119,5 m; helideck 51,3 m');
  const dagmar = byId(list, 'geus:302');
  assert.strictEqual(dagmar.helideck, null);
  assert.strictEqual(field(dagmar, 'Hoogste punt (m)'), 36.4);
  assert.strictEqual(byId(list, 'geus:458').status, 'verwijderd');
});

test('Sodir: fixed facilities only, kinds, fact page', () => {
  const list = p.parseSodir(json('sodir.json').features);
  assert.ok(!list.some((x) => /BUCENTAUR/.test(x.name)), 'a vessel is not a platform');
  const a = byId(list, 'sodir:271245');
  assert.deepStrictEqual([a.kind, a.status, a.waterDepthM, a.operator, a.country], ['platform', 'in gebruik', 109, 'Equinor Energy AS', 'NO']);
  assert.strictEqual(a.srcUrl, 'https://factpages.sodir.no/facility/pageview/fixed/all/271245');
  assert.strictEqual(field(a, 'Hoort bij'), 'OSEBERG (field)');
  assert.match(field(a, 'In gebruik sinds'), /^1988-12-0[12]$/);
  assert.strictEqual(list.find((x) => /OSEBERG SØR/.test(x.name)).kind, 'subsea');
  const k = list.find((x) => x.name === 'KÅRSTØ');
  assert.deepStrictEqual([k.kind, k.offshore], ['onshore', false]);
});

test('NSTA: kinds and statuses', () => {
  const list = p.parseNsta(json('nsta.json').features);
  const k = Object.fromEntries(list.map((x) => [x.name, x.kind]));
  assert.deepStrictEqual(k, { ANASURIA: 'fpso', 'GROVE PLATFORM': 'platform', 'BACTON GAS TERMINAL': 'onshore' });
  assert.strictEqual(list.find((x) => x.name === 'BACTON GAS TERMINAL').operator, null, '"unknown" is no operator');
  assert.strictEqual(list[0].country, 'GB');
});

test('BOEM: fixed-width files from the ZIPs, removed structures left out, heliport and operator', () => {
  const list = p.parseBoem(boemText());
  assert.deepStrictEqual(list.map((x) => x.id).sort(), ['boem:10170-1', 'boem:183-1']);
  const h = byId(list, 'boem:183-1');
  assert.deepStrictEqual([h.name, h.helideck, h.waterDepthM, h.operator, h.kind, h.country], ['AC 25 A (Hoover)', true, 1470.7, 'Exxon Mobil Corporation', 'platform', 'US']);
  assert.strictEqual(field(h, 'Type'), 'Spar');
  assert.strictEqual(field(h, 'Geïnstalleerd'), '2000-04-25');
  assert.strictEqual(field(h, '24 uur bemand'), 'ja');
  // NAD27 26.93905139 / -94.68872137 moved to WGS84: about 30 m north, 18 m west.
  assert.ok(Math.abs((h.lat - 26.93905139) * 111320 - 30.6) < 2);
  assert.ok(h.lon < -94.68872137);
  assert.strictEqual(byId(list, 'boem:10170-1').helideck, false);
  assert.strictEqual(p.boemCompanies(boemText().comp).get('00730'), 'Walter Oil & Gas Corporation');
});

test('Overpass: nodes and ways, helipad, substation', () => {
  const list = p.parseOverpass(json('overpass.json'));
  assert.deepStrictEqual(list.map((x) => x.id), ['osm:node/1042060069', 'osm:way/30660203', 'osm:node/1138058093']);
  assert.deepStrictEqual([list[0].name, list[0].helideck, list[0].operator], ['Petrobras XV', true, 'Petrobras']);
  assert.deepStrictEqual([list[1].lat, list[1].lon, list[1].helideck], [40.261121, 49.773129, null]);
  assert.strictEqual(list[2].kind, 'substation');
  assert.strictEqual(field(list[2], 'Spanning (V)'), '110000;30000');
});

const allSources = () => ({
  nlog: p.parseNlog(json('nlog.json')), rws: p.parseRws(json('rws-turbines.json')),
  geus: p.parseGeus(raw('geus-platform.xml').toString('utf8'), raw('geus-flight.xml').toString('utf8')),
  nsta: p.parseNsta(json('nsta.json').features), sodir: p.parseSodir(json('sodir.json').features), boem: p.parseBoem(boemText()),
  emodnet: p.parseEmodnet(json('emodnet.json')),
});

test('merging: national source wins, EMODnet attributes merged by name or position', () => {
  const by = allSources();
  const m = p.mergeAll(by);
  const ids = m.map((x) => x.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'unique ids');
  // NLOG keeps its position and gets EMODnet's attributes.
  const a = byId(m, 'nlog:L13-FE-1');
  assert.deepStrictEqual([a.lat, a.lon, a.waterDepthM], [53.313144, 4.24674, 26]);
  assert.strictEqual(field(a, 'Gewicht onderbouw (t)'), 7117);
  assert.match(field(a, 'Ook in bron'), /EMODnet/);
  assert.ok(!byId(m, 'emodnet:118117761'));
  // EMODnet's K12-G has no NLOG record in the fixture: it stays, at the corrected position.
  assert.ok(byId(m, 'emodnet:118117713'));
  // GB: NSTA takes NLOG's Grove and EMODnet's.
  assert.ok(!byId(m, 'nlog:Grove'));
  assert.match(field(byId(m, 'nsta:700002621'), 'Ook in bron'), /NLOG \(Grove\).*EMODnet/);
  // Denmark by name (Syd Arne) and by position (EMODnet "Tyra EF" is GEUS "TYRA EAST F").
  assert.match(field(byId(m, 'geus:308'), 'Ook in bron'), /DK47/);
  assert.strictEqual(byId(m, 'geus:308').operator, 'INEOS E&P A/S', 'the national operator stays');
  assert.match(field(byId(m, 'geus:458'), 'Ook in bron'), /DK32/);
  assert.ok(!m.some((x) => x.src === 'EMODnet' && x.country === 'DK'));
  // Norway.
  assert.ok(!byId(m, 'emodnet:271245'));
  // Countries without a national source come from EMODnet.
  assert.deepStrictEqual(m.filter((x) => x.src === 'EMODnet').map((x) => x.name).sort(), ['ANDREW', 'ARGO 1', 'K12-G', 'Kinsale Head Alpha']);
  // Turbines are never merged, and the inputs are not changed.
  assert.strictEqual(m.filter((x) => x.kind === 'turbine').length, 2);
  assert.ok(!by.nlog.find((x) => x.id === 'nlog:L13-FE-1').fields.some((f) => f[0] === 'Ook in bron'));
  // A failed national source: EMODnet fills in for it.
  const m2 = p.mergeAll({ ...by, nlog: [] });
  assert.ok(byId(m2, 'emodnet:118117761'));
});

// ---------- cache and refresh, with a fake network ----------

function fakeNet({ fail = new Set(), hang = null } = {}) {
  const calls = [];
  let release = null;
  const gate = hang ? new Promise((r) => { release = r; }) : null;
  const route = (url) => {
    if (url.includes('GDW_NG_FACILITY')) return ['nlog', 'nlog.json'];
    if (url.includes('windparken_turbines')) return ['rws', 'rws-turbines.json'];
    if (url.includes('veiligheidszones')) return ['areas', 'rws-zones.json'];
    if (url.includes('vergunde_windparken')) return ['areas', 'rws-farms.json'];
    if (url.includes('emodnet')) return ['emodnet', 'emodnet.json'];
    if (url.includes('ens_platform')) return ['geus', 'geus-platform.xml'];
    if (url.includes('ens_flight_safety')) return ['geus', 'geus-flight.xml'];
    if (url.includes('sodir')) return ['sodir', 'sodir.json'];
    if (url.includes('arcgis.com')) return ['nsta', 'nsta.json'];
    if (url.includes('platmast')) return ['boem', 'boem-platmast.zip'];
    if (url.includes('platloc')) return ['boem', 'boem-platloc.zip'];
    if (url.includes('platstru')) return ['boem', 'boem-platstru.zip'];
    if (url.includes('compall')) return ['boem', 'boem-compall.zip'];
    throw new Error('onbekende url ' + url);
  };
  const serve = async (url, opts) => {
    const [key, f] = route(url);
    calls.push({ key, url, opts });
    if (fail.has(key)) throw new Error('HTTP 503');
    if (hang === key) await gate;
    return raw(f);
  };
  return {
    calls, release: () => release && release(),
    fetchText: async (url, opts) => (await serve(url, opts)).toString('utf8'),
    fetchBuffer: async (url, opts) => serve(url, opts),
    count: (key) => calls.filter((c) => c.key === key).length,
  };
}

test('list(): first fetch, served from disk, background refresh, failing source keeps its items', async () => {
  const dir = tmp();
  let clock = Date.UTC(2026, 9, 16, 10);
  const now = () => clock;
  let net = fakeNet();
  p.start({ dir, ...net, log: quiet, now });
  const r1 = await p.list();
  assert.strictEqual(r1.ok, true);
  assert.deepStrictEqual(r1.sources.map((s) => s.key), ['nlog', 'rws', 'geus', 'nsta', 'sodir', 'boem', 'emodnet']);
  assert.ok(r1.sources.every((s) => s.ok && s.count > 0 && s.fetchedAt && s.licence && s.url), JSON.stringify(r1.sources));
  assert.ok(net.calls.every((c) => /P-ALV-Dashboard/.test(c.opts.headers['User-Agent'])));
  const n1 = r1.items.length;
  assert.ok(fs.existsSync(path.join(dir, 'plan-platforms.json')));
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.tmp')));

  // A new start (the app restarted) answers from disk without asking anyone.
  net = fakeNet({ fail: new Set(['nlog', 'rws', 'geus', 'nsta', 'sodir', 'boem', 'emodnet']) });
  p.start({ dir, ...net, log: quiet, now });
  const r2 = await p.list();
  assert.strictEqual(r2.items.length, n1);
  assert.strictEqual(net.calls.length, 0);

  // Eight days later: the cached list comes back at once, the refresh runs behind it.
  clock += 8 * 86400000;
  net = fakeNet({ fail: new Set(['nlog']) });
  p.start({ dir, ...net, log: quiet, now });
  const r3 = await p.list();
  assert.strictEqual(r3.items.length, n1, 'answered from the cache');
  await p.idle();
  const r4 = await p.list();
  const nlog = r4.sources.find((s) => s.key === 'nlog');
  assert.deepStrictEqual([nlog.ok, nlog.error, nlog.count], [false, 'HTTP 503', 12]);
  assert.strictEqual(nlog.fetchedAt, r1.sources[0].fetchedAt, 'still the old data');
  assert.ok(byId(r4.items, 'nlog:L13-FE-1'), 'the failed source keeps its items');
  assert.strictEqual(r4.sources.find((s) => s.key === 'rws').fetchedAt, new Date(clock).toISOString());
  // The failed source is not asked again right away; force asks everyone.
  const before = net.count('nlog');
  await p.list(); await p.idle();
  assert.strictEqual(net.count('nlog'), before);
  clock += 7 * 3600000;
  net.calls.length = 0;
  await p.list({ force: true });
  assert.ok(['nlog', 'rws', 'geus', 'nsta', 'sodir', 'boem', 'emodnet'].every((k) => net.count(k) > 0));
  // The cache file stays small.
  assert.ok(fs.statSync(path.join(dir, 'plan-platforms.json')).size < 100000);
});

test('list(): the first fetch does not wait for a hanging source', async () => {
  const dir = tmp();
  const net = fakeNet({ hang: 'emodnet' });
  p.start({ dir, ...net, log: quiet, firstWaitMs: 50 });
  const r = await p.list();
  assert.strictEqual(r.ok, true);
  const em = r.sources.find((s) => s.key === 'emodnet');
  assert.deepStrictEqual([em.busy, em.count], [true, 0]);
  assert.ok(byId(r.items, 'nlog:L13-FE-1'));
  net.release();
  await p.idle();
  const r2 = await p.list();
  assert.ok(r2.sources.find((s) => s.key === 'emodnet').ok);
  assert.ok(byId(r2.items, 'emodnet:118117713'));
});

test('areas(): wind farm outlines and safety zones, cached', async () => {
  const dir = tmp();
  let net = fakeNet();
  p.start({ dir, ...net, log: quiet });
  const a = await p.areas();
  assert.deepStrictEqual([a.ok, a.farms.length, a.zones.length], [true, 2, 1]);
  net = fakeNet({ fail: new Set(['areas']) });
  p.start({ dir, ...net, log: quiet });
  const b = await p.areas();
  assert.strictEqual(b.farms.length, 2);
  assert.strictEqual(net.calls.length, 0);
});

test('osm(): tiles via Overpass with fallback servers, cached, official platforms left out, world query', async () => {
  const dir = tmp();
  const calls = [];
  const answer = json('overpass.json');
  // One extra platform 40 m from NLOG's L13-FE-1: NLOG already has it.
  answer.elements.push({ type: 'node', id: 99, lat: 53.3135, lon: 4.2470, tags: { man_made: 'offshore_platform', name: 'L13-FE-1' } });
  const fetchText = async (url, opts) => {
    if (url.includes('overpass')) {
      calls.push({ url, body: decodeURIComponent(String(opts.body).slice(5)), opts });
      if (url.includes('overpass-api.de')) throw new Error('HTTP 504');
      return JSON.stringify(answer);
    }
    return fakeNet().fetchText(url, opts);
  };
  p.start({ dir, fetchText, fetchBuffer: fakeNet().fetchBuffer, log: quiet, osmGapMs: 0 });
  await p.list();
  const r = await p.osm([52, 3, 55, 7]);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.items.map((x) => x.name), ['Alpha Ventus'], 'only what is in the box and not official');
  assert.strictEqual(calls.length, 2 * 2, '2 tiles, each tried at overpass-api.de first');
  assert.match(calls[1].url, /kumi/);
  assert.match(calls[1].body, /\["man_made"="offshore_platform"\]\(50,0,55,5\)/);
  assert.strictEqual(calls[0].opts.method, 'POST');
  assert.match(calls[0].opts.headers['User-Agent'], /P-ALV-Dashboard/);
  // Asked again: from the tile cache, also after a restart.
  p.start({ dir, fetchText, fetchBuffer: fakeNet().fetchBuffer, log: quiet, osmGapMs: 0 });
  await p.osm([52, 3, 55, 7]);
  assert.strictEqual(calls.length, 4);
  // A large area takes the world query, which then serves every box.
  const big = await p.osm([-40, -60, 60, 60]);
  assert.strictEqual(calls.length, 6);
  assert.doesNotMatch(calls[5].body, /\(-?\d/, 'no bounding box');
  assert.deepStrictEqual(big.items.map((x) => x.name).sort(), ['Alpha Ventus', 'Neft Platforması', 'Petrobras XV']);
  const w = await p.osmWorld();
  assert.deepStrictEqual([w.ok, w.count], [true, 4]);
  await p.osm([39, 49, 41, 51]);
  assert.strictEqual(calls.length, 6);
  assert.deepStrictEqual((await p.osm(['x'])).ok, false);
});
