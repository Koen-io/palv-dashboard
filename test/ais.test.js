// The AIS register: messages of aisstream.io into vessels, tracks and a snapshot with only what changed.
const test = require('node:test');
const assert = require('assert');
const ais = require('../src/ais');

const pos = (mmsi, lat, lon, extra = {}) => ({ MessageType: 'PositionReport', MetaData: { MMSI: mmsi, latitude: lat, longitude: lon }, Message: { PositionReport: { Latitude: lat, Longitude: lon, Sog: 10, Cog: 90, TrueHeading: 91, RateOfTurn: 0, NavigationalStatus: 0, ...extra } } });

test('positie, statische data en klasse komen bij elkaar in één record', () => {
  ais._ingest({ MessageType: 'ShipStaticData', MetaData: { MMSI: 244010001, ShipName: 'ARCA' }, Message: { ShipStaticData: { ImoNumber: 9000001, CallSign: 'PBAB', Name: 'ARCA', Type: 52, Dimension: { A: 20, B: 10, C: 4, D: 4 }, MaximumStaticDraught: 3.5, Destination: 'DEN HELDER', Eta: { Month: 11, Day: 4, Hour: 15, Minute: 0 } } } });
  ais._ingest(pos(244010001, 52.98, 4.72));
  const v = ais.snapshot(0).vessels.find((x) => x.mmsi === '244010001');
  assert.ok(v, 'in de momentopname');
  assert.strictEqual(v.name, 'ARCA');
  assert.strictEqual(v.imo, 9000001);
  assert.strictEqual(v.type, 52);
  assert.strictEqual(v.cls, 'A');
  assert.strictEqual(v.a + v.b, 30);
  assert.strictEqual(v.eta, '11-04 15:00');
  assert.strictEqual(v.sog, 10);
  assert.strictEqual(v.hdg, 91);
});

test('een klasse-B-schip zonder statische data heeft zijn naam uit de metadata', () => {
  ais._ingest({ MessageType: 'StandardClassBPositionReport', MetaData: { MMSI: 244020002, ShipName: 'ZEEHOND', latitude: 53.1, longitude: 4.9 }, Message: { StandardClassBPositionReport: { Latitude: 53.1, Longitude: 4.9, Sog: 4.2, Cog: 180, TrueHeading: 511 } } });
  const v = ais.snapshot(0).vessels.find((x) => x.mmsi === '244020002');
  assert.strictEqual(v.name, 'ZEEHOND');
  assert.strictEqual(v.cls, 'B');
  assert.strictEqual(v.hdg, null, '511 is onbekend');
});

test('ongeldige posities en snelheden tellen niet', () => {
  ais._ingest(pos(244030003, 0, 0));
  assert.ok(!ais.snapshot(0).vessels.some((x) => x.mmsi === '244030003'), '0,0 is geen positie');
  ais._ingest(pos(244030004, 52.5, 3.5, { Sog: 102.3, Cog: 360 }));
  const v = ais.snapshot(0).vessels.find((x) => x.mmsi === '244030004');
  assert.strictEqual(v.sog, null);
  assert.strictEqual(v.cog, null);
});

test('de momentopname sinds een stand bevat alleen wat daarna veranderde; de track groeit bij beweging', () => {
  const before = ais.snapshot(0).rev;
  ais._ingest(pos(244040005, 53.0, 4.0));
  ais._ingest(pos(244040005, 53.01, 4.0));
  const s = ais.snapshot(before);
  assert.deepStrictEqual(s.vessels.map((v) => v.mmsi), ['244040005']);
  assert.strictEqual(ais.track('244040005').length, 2, 'ruim een kilometer verder: een nieuw spoorpunt');
  ais._ingest(pos(244040005, 53.01001, 4.0));
  assert.strictEqual(ais.track('244040005').length, 2, 'een meter verder binnen de minuut: geen nieuw punt');
  assert.strictEqual(ais.snapshot(s.rev).vessels.length, 1, 'wel een nieuwe stand');
});

test('bakens en basisstations krijgen hun eigen klasse', () => {
  ais._ingest({ MessageType: 'AidsToNavigationReport', MetaData: { MMSI: 992441001, latitude: 52.4, longitude: 3.9 }, Message: { AidsToNavigationReport: { Latitude: 52.4, Longitude: 3.9, Name: 'EURO PLATFORM', Type: 20 } } });
  const v = ais.snapshot(0).vessels.find((x) => x.mmsi === '992441001');
  assert.strictEqual(v.cls, 'aton');
  assert.strictEqual(v.name, 'EURO PLATFORM');
  const st = ais.status();
  assert.strictEqual(st.on, false, 'zonder sleutel geen stream');
  assert.ok(st.count >= 5);
});

/* ---------- 1.52: twee bronnen, de nieuwste positie wint ---------- */
const at = (ms) => new Date(ms).toISOString();
const posAt = (mmsi, lat, lon, t, type = 'PositionReport') => ({ MessageType: type, MetaData: { MMSI: mmsi, latitude: lat, longitude: lon, time_utc: t }, Message: { [type]: { Latitude: lat, Longitude: lon, Sog: 12, Cog: 45, TrueHeading: 45, RateOfTurn: 0, NavigationalStatus: 0 } } });

test('de tijd komt uit het bericht: aisstream- en ISO-notatie, een klok die voorloopt telt niet', () => {
  const now = Date.parse('2026-11-13T16:10:40Z');
  assert.strictEqual(ais._msgTime('2026-11-13 16:10:32.123456789 +0000 UTC', now), Date.parse('2026-11-13T16:10:32.123Z'));
  assert.strictEqual(ais._msgTime('2026-11-13T16:10:32.228800342Z', now), Date.parse('2026-11-13T16:10:32.228Z'));
  assert.strictEqual(ais._msgTime('2026-11-13T16:20:00Z', now), now, 'tien minuten in de toekomst: de aankomsttijd');
  assert.strictEqual(ais._msgTime(null, now), now);
  assert.strictEqual(ais._msgTime('onzin', now), now);
});

test('een oudere positie (andere bron, later binnen) overschrijft een nieuwere niet', () => {
  const t = Date.now();
  ais._ingest(posAt(244050001, 53.20, 4.50, at(t - 5000)));
  ais._ingest(posAt(244050001, 53.10, 4.40, at(t - 90000)), { src: 'Open Waters · AISHub' });
  let v = ais.snapshot(0).vessels.find((x) => x.mmsi === '244050001');
  assert.strictEqual(v.lat, 53.20, 'de positie van 5 s oud blijft');
  assert.strictEqual(v.src, 'aisstream');
  assert.ok(Math.abs(v.posAt - (t - 5000)) < 2, 'posAt is het moment van het bericht, niet van aankomst');
  ais._ingest(posAt(244050001, 53.21, 4.51, at(t - 1000)), { src: 'Open Waters · ontvanger', attr: 'Open Waters AIS (https://openwaters.io/ais/)' });
  v = ais.snapshot(0).vessels.find((x) => x.mmsi === '244050001');
  assert.strictEqual(v.lat, 53.21, 'nieuwer: telt, welke bron ook');
  assert.strictEqual(v.src, 'Open Waters · ontvanger');
  assert.match(v.attr, /Open Waters AIS/);
});

test('een grove satellietpositie (msg 27) wacht 10 minuten achter een precieze', () => {
  const t = Date.now();
  ais._ingest(posAt(244060001, 54.00, 3.00, at(t - 4 * 60000)));
  ais._ingest(posAt(244060001, 54.10, 3.10, at(t - 1000), 'LongRangeAisBroadcastMessage'));
  assert.strictEqual(ais.snapshot(0).vessels.find((x) => x.mmsi === '244060001').lat, 54.00);
  ais._ingest(posAt(244060002, 54.00, 3.00, at(t - 12 * 60000)));
  ais._ingest(posAt(244060002, 54.10, 3.10, at(t - 1000), 'LongRangeAisBroadcastMessage'));
  assert.strictEqual(ais.snapshot(0).vessels.find((x) => x.mmsi === '244060002').lat, 54.10, 'na 10 minuten stilte is grof beter dan niets');
});

test('een bericht van een uur oud wordt niet meer opgenomen', () => {
  ais._ingest(posAt(244070001, 53.5, 4.0, at(Date.now() - 61 * 60000)));
  assert.ok(!ais.snapshot(0).vessels.some((x) => x.mmsi === '244070001'));
});

test('Open Waters-gebeurtenissen gaan in de vorm van aisstream, met bron en naamsvermelding', () => {
  const ev = { type: 'event', time: at(Date.now() - 2000), source: 'aishub', attribution: 'Open Waters AIS (https://openwaters.io/ais/). AISHub contributors', mmsi: 244080001, msg_type: 'ShipStaticData', lat: 52.9, lon: 4.7, message: { Name: 'TEXELSTROOM', ImoNumber: 9741918, Type: 60, Dimension: { A: 100, B: 35, C: 14, D: 14 }, MaximumStaticDraught: 4.6, Destination: 'DEN HELDER' } };
  const got = ais._ow(ev);
  assert.strictEqual(got.from.src, 'Open Waters · AISHub');
  assert.strictEqual(got.msg.MessageType, 'ShipStaticData');
  assert.strictEqual(got.msg.MetaData.MMSI, 244080001);
  ais._ingest(got.msg, got.from);
  const p = ais._ow({ ...ev, msg_type: 'PositionReport', message: { Latitude: 52.95, Longitude: 4.78, Sog: 14, Cog: 200, TrueHeading: 201 } });
  ais._ingest(p.msg, p.from);
  const v = ais.snapshot(0).vessels.find((x) => x.mmsi === '244080001');
  assert.strictEqual(v.name, 'TEXELSTROOM');
  assert.strictEqual(v.draught, 4.6);
  assert.strictEqual(v.lat, 52.95);
  assert.match(v.attr, /AISHub contributors/);
  assert.strictEqual(ais._ow({ type: 'welcome', role: 'anonymous' }), null);
  assert.strictEqual(ais._ow({ type: 'event', msg_type: 'PositionReport' }), null, 'zonder MMSI niets');
});

test('walstations krijgen klasse base', () => {
  ais._ingest({ MessageType: 'BaseStationReport', MetaData: { MMSI: 2442000, latitude: 52.96, longitude: 4.77, time_utc: at(Date.now()) }, Message: { BaseStationReport: { Latitude: 52.96, Longitude: 4.77 } } });
  assert.strictEqual(ais.snapshot(0).vessels.find((x) => x.mmsi === '2442000').cls, 'base');
});

test('wachten op nieuws: het antwoord komt zodra er iets binnenkomt, of na de wachttijd', async () => {
  const rev0 = ais.snapshot(0).rev;
  const t0 = Date.now();
  const waiting = ais.snapWait(rev0, 5000);
  setTimeout(() => ais._ingest(posAt(244090001, 53.3, 4.3, at(Date.now()))), 150);
  const s = await waiting;
  assert.ok(Date.now() - t0 < 1500, 'binnen een paar honderd ms, niet pas na 5 s');
  assert.deepStrictEqual(s.vessels.map((v) => v.mmsi), ['244090001']);
  const t1 = Date.now();
  const none = await ais.snapWait(s.rev, 300);
  assert.ok(Date.now() - t1 >= 280, 'niets nieuws: na de wachttijd');
  assert.strictEqual(none.vessels.length, 0);
  assert.ok((await ais.snapWait(0, 5000)).vessels.length > 3, 'een oude stand: meteen');
});

test('het register gaat naar schijf en komt na een herstart terug', () => {
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palv-ais-'));
  try {
    ais._photo.setDir(dir);
    ais._ingest(posAt(244100001, 53.4, 4.4, at(Date.now() - 3000)), { src: 'Open Waters · ontvanger' });
    ais._live.save();
    assert.ok(fs.existsSync(path.join(dir, 'ais-live.json')));
    ais._live.clear();
    assert.ok(!ais.snapshot(0).vessels.some((x) => x.mmsi === '244100001'));
    assert.ok(ais._live.load() >= 1);
    const v = ais.snapshot(0).vessels.find((x) => x.mmsi === '244100001');
    assert.strictEqual(v.lat, 53.4);
    assert.strictEqual(v.src, 'Open Waters · ontvanger');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('de route voor andere schermen wacht op nieuws en antwoordt dan; zonder sleutel geweigerd', async () => {
  const { EventEmitter } = require('events');
  const call = (url, caller) => new Promise((resolve) => {
    const req = new EventEmitter(); req.url = url;
    const res = { writableEnded: false, destroyed: false };
    ais.routes['/api/ais/snap'](req, res, caller, (_r, code, _type, body) => { res.writableEnded = true; resolve({ code, body }); });
  });
  assert.strictEqual((await call('/api/ais/snap?since=0', null)).code, 403);
  const rev = ais.snapshot(0).rev;
  const t0 = Date.now();
  const pending = call(`/api/ais/snap?since=${rev}&wait=5000`, { id: 'x', secure: true });
  setTimeout(() => ais._ingest(posAt(244110001, 53.6, 4.6, at(Date.now()))), 200);
  const got = await pending;
  assert.strictEqual(got.code, 200);
  assert.ok(Date.now() - t0 < 1500, 'antwoord zodra er iets binnenkwam');
  assert.deepStrictEqual(JSON.parse(got.body).vessels.map((v) => v.mmsi), ['244110001']);
});
