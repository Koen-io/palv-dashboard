// Sea state and sea water temperature: the Douglas scale, the Rijkswaterstaat answer and the Open-Meteo answer.
const test = require('node:test');
const assert = require('assert');
const sea = require('../src/sea');

const NOW = Date.parse('2026-11-05T13:50:00Z');
const meting = (iso, v, q = '00') => ({ Meetwaarde: { Waarde_Alfanumeriek: String(v), Waarde_Numeriek: v }, Tijdstip: iso, WaarnemingMetadata: { Kwaliteitswaardecode: q } });
const reeks = (code, comp, g, metingen, extra = {}) => ({ AquoMetadata: { Compartiment: { Code: comp }, Grootheid: { Code: g } }, Locatie: { Code: code, ...extra }, MetingenLijst: metingen });

test('Douglas-schaal: de grenzen van de significante golfhoogte', () => {
  assert.strictEqual(sea.seaState(0).code, 0);
  assert.strictEqual(sea.seaState(0.08).code, 1);
  assert.strictEqual(sea.seaState(0.3).code, 2);
  assert.strictEqual(sea.seaState(1.11).code, 3);
  assert.strictEqual(sea.seaState(1.25).code, 4, '1,25 m is al matig');
  assert.strictEqual(sea.seaState(2.49).code, 4);
  assert.strictEqual(sea.seaState(3.9).code, 5);
  assert.strictEqual(sea.seaState(5).code, 6);
  assert.strictEqual(sea.seaState(8).code, 7);
  assert.strictEqual(sea.seaState(12).code, 8);
  assert.strictEqual(sea.seaState(20).code, 9);
  assert.strictEqual(sea.seaState(3.9).nl, 'Ruw');
  assert.strictEqual(sea.seaState(4).nl, 'Zeer ruw', 'vanaf 4 m is het zeer ruw');
  assert.strictEqual(sea.seaState(NaN), null);
});

test('Rijkswaterstaat: per station de nieuwste bruikbare waarde, in meters, met de tijd', () => {
  const data = { Succesvol: true, WaarnemingenLijst: [
    reeks('europlatform', 'OW', 'Hm0', [meting('2026-11-05T14:40:00.000+01:00', 111)]),
    // an old series of the same quantity (the buoy of 1989) must not win
    reeks('europlatform', 'OW', 'Hm0', [meting('1989-01-01T00:00:00.000+01:00', 164)]),
    reeks('europlatform', 'OW', 'T', [meting('2026-11-05T14:30:00.000+01:00', 14.6)]),
    reeks('europlatform', 'OW', 'Tm02', [meting('2026-11-05T14:20:00.000+01:00', 4.1)]),
    reeks('europlatform', 'LT', 'WINDSHD', [meting('2026-11-05T14:20:00.000+01:00', 4.98)]),
    reeks('europlatform', 'LT', 'WINDRTG', [meting('2026-11-05T14:20:00.000+01:00', 71.6)]),
    // a missing value and a rejected one
    reeks('k13a.1', 'OW', 'Hm0', [meting('2026-11-05T14:40:00.000+01:00', -999999999), meting('2026-11-05T14:30:00.000+01:00', 173, '99'), meting('2026-11-05T14:20:00.000+01:00', 170)]),
    reeks('k13a.1', 'OW', 'T', [meting('2026-11-05T14:20:00.000+01:00', 13.9)]),
    // too old
    reeks('q1.1', 'OW', 'Hm0', [meting('2026-11-05T09:00:00.000+01:00', 80)]),
  ] };
  const obs = sea.parseRws(data, NOW);
  assert.deepStrictEqual(Object.keys(obs).sort(), ['europlatform', 'k13a.1']);
  const e = obs.europlatform;
  assert.strictEqual(e.hs, 1.11);
  assert.strictEqual(e.state, 3);
  assert.strictEqual(e.tw, 14.6);
  assert.strictEqual(e.tm02, 4.1);
  assert.strictEqual(e.windMs, 4.98);
  assert.strictEqual(e.windDir, 71.6);
  assert.strictEqual(e.hsAt, Date.parse('2026-11-05T13:40:00Z'));
  assert.strictEqual(e.name, 'Europlatform');
  assert.strictEqual(obs['k13a.1'].hs, 1.7, 'de afgekeurde en de ontbrekende waarde tellen niet');
  assert.strictEqual(obs['k13a.1'].state, 4);
});

test('Open-Meteo: het model op een punt', () => {
  const m = sea.parseOm({ latitude: 53.2, longitude: 3.2, current: { time: '2026-11-05T13:00', wave_height: 1.3, wave_period: 4.65, wave_direction: 79, swell_wave_height: 0.36, swell_wave_period: 6.1, wind_wave_height: 1.18, sea_surface_temperature: 13.9 } });
  assert.strictEqual(m.hs, 1.3);
  assert.strictEqual(m.state, 4);
  assert.strictEqual(m.sst, 13.9);
  assert.strictEqual(m.at, Date.parse('2026-11-05T13:00:00Z'));
  assert.strictEqual(sea.parseOm({}), null);
});

test('dichtstbijzijnde stations met afstand', () => {
  const obs = { europlatform: { code: 'europlatform', name: 'Europlatform', lat: 51.99781, lon: 3.275071, hs: 1.1 }, 'k13a.1': { code: 'k13a.1', name: 'K13a', lat: 53.2155, lon: 3.2217, hs: 1.7 } };
  const n = sea.nearest(obs, 53.0, 3.3, 2);
  assert.strictEqual(n[0].code, 'k13a.1');
  assert.ok(n[0].km > 20 && n[0].km < 30, `K13a op ~24 km, niet ${n[0].km}`);
  assert.strictEqual(n[1].code, 'europlatform');
});

test('de aanvraag aan Rijkswaterstaat noemt alle stations en grootheden', () => {
  const b = JSON.parse(sea.rwsBody(sea.STATIONS.map((s) => s.code)));
  assert.strictEqual(b.LocatieLijst.length, sea.STATIONS.length);
  assert.ok(b.AquoPlusWaarnemingMetadataLijst.some((q) => q.AquoMetadata.Grootheid.Code === 'Hm0' && q.AquoMetadata.Compartiment.Code === 'OW'));
  assert.ok(sea.omUrl(53.21, 3.22).includes('sea_surface_temperature'));
});

test('de service: cache, overzicht en punt met gemaakte antwoorden', async () => {
  sea._reset();
  let calls = 0;
  sea.start({ fetchJson: async (url) => {
    calls += 1;
    if (url.includes('rijkswaterstaat')) return { WaarnemingenLijst: [reeks('europlatform', 'OW', 'Hm0', [meting(new Date().toISOString(), 111)]), reeks('europlatform', 'OW', 'T', [meting(new Date().toISOString(), 14.6)]), reeks('k13a.1', 'OW', 'Hm0', [meting(new Date().toISOString(), 260)])] };
    return { latitude: 53.2, longitude: 3.2, current: { time: new Date().toISOString().slice(0, 16), wave_height: 2.4, wave_period: 5, wave_direction: 80, swell_wave_height: 0.3, swell_wave_period: 6, wind_wave_height: 2.2, sea_surface_temperature: 13.9 } };
  } });
  const o = await sea.overview('europlatform');
  assert.ok(o.ok);
  assert.strictEqual(o.ref.code, 'europlatform');
  assert.deepStrictEqual(o.range, [3, 5]);
  const p = await sea.at(53.2, 3.25);
  assert.strictEqual(p.model.state, 4);
  assert.strictEqual(p.nearest[0].code, 'k13a.1');
  await sea.overview('europlatform');
  await sea.at(53.21, 3.26);
  assert.strictEqual(calls, 2, 'tweede keer uit de cache');
});
