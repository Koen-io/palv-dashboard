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
