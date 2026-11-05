// The bases (steunpunten) a dashboard can run from: Schiphol-Oost, Volkel and Rotterdam. The chosen base
// (Instellingen › Basis) sets the station in the header, the runway use, the distance rings and the
// distances ("x NM van ..."), the first base of Zoek & Plan and the reference of the Offshore card.
// Runway geometry and field positions are public data (AIP / OurAirports). Shared by the main process
// (runway detection) and the dashboard.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BASES_API = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BASES = {
    eham: {
      id: 'eham', name: 'Schiphol-Oost', long: 'Steunpunt Schiphol-Oost', icao: 'EHAM', station: 'Schiphol', airport: 'Amsterdam Airport Schiphol',
      lat: 52.3124, lon: 4.7862, field: { lat: 52.31, lon: 4.76 }, startMin: 10, casper: true, mapK: 0.1154, tiles: 'schiphol',
      runways: [
        { name: 'Polderbaan', a: '18R', b: '36L', pa: [52.36025, 4.71183], pb: [52.32862, 4.70889] },
        { name: 'Zwanenburgbaan', a: '18C', b: '36C', pa: [52.33139, 4.74003], pb: [52.30186, 4.7375] },
        { name: 'Aalsmeerbaan', a: '18L', b: '36R', pa: [52.32123, 4.78012], pb: [52.29069, 4.77747] },
        { name: 'Kaagbaan', a: '06', b: '24', pa: [52.28792, 4.73422], pb: [52.30462, 4.77752] },
        { name: 'Buitenveldertbaan', a: '09', b: '27', pa: [52.31667, 4.74636], pb: [52.31842, 4.79689] },
        { name: 'Oostbaan', a: '04', b: '22', pa: [52.30036, 4.78348], pb: [52.31403, 4.80302] },
      ],
      // Schiphol's fixed one-way runways: no departures from 18R or 36R, no landings on 36L or 18L.
      never: { landing: ['36L', '18L'], departure: ['18R', '36R'] },
    },
    ehvk: {
      id: 'ehvk', name: 'Volkel', long: 'Steunpunt Volkel (Vliegbasis Volkel)', icao: 'EHVK', station: 'Volkel', airport: 'Vliegbasis Volkel', military: true,
      lat: 51.6572, lon: 5.7078, field: { lat: 51.6572, lon: 5.7078 }, startMin: 10, casper: false, mapK: 0.2, tiles: 'osm',
      runways: [
        { name: 'Hoofdbaan 06L/24R', a: '06L', b: '24R', pa: [51.650002, 5.68927], pb: [51.664398, 5.72637] },
        { name: 'Baan 06R/24L', a: '06R', b: '24L', pa: [51.648399, 5.69089], pb: [51.6628, 5.72796] },
      ],
      never: { landing: [], departure: [] },
    },
    ehrd: {
      id: 'ehrd', name: 'Rotterdam', long: 'Steunpunt Rotterdam (Rotterdam The Hague Airport)', icao: 'EHRD', station: 'Rotterdam', airport: 'Rotterdam The Hague Airport',
      lat: 51.9569, lon: 4.4372, field: { lat: 51.9569, lon: 4.4372 }, startMin: 10, casper: false, mapK: 0.2, tiles: 'osm',
      runways: [{ name: 'Baan 06/24', a: '06', b: '24', pa: [51.952099, 4.42824], pb: [51.962799, 4.45508] }],
      never: { landing: [], departure: [] },
    },
  };
  const DEFAULT = 'eham';
  const ORDER = ['eham', 'ehvk', 'ehrd'];
  const baseOf = (id) => BASES[String(id || '').toLowerCase()] || BASES[DEFAULT];
  // Direction of movement on a runway end (degrees true), from its geometry.
  const endHeading = (from, to) => {
    const dLat = to[0] - from[0], dLon = (to[1] - from[1]) * Math.cos((from[0] * Math.PI) / 180);
    return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
  };
  // Every runway end of a base with its heading: [{ id, hdg, name }].
  const ends = (base) => base.runways.flatMap((r) => [{ id: r.a, hdg: endHeading(r.pa, r.pb), name: r.name }, { id: r.b, hdg: endHeading(r.pb, r.pa), name: r.name }]);
  // The runway ends into the wind, best first: headwind and crosswind in kt for a wind (dir, spd).
  function intoWind(base, dir, spd) {
    if (!Number.isFinite(dir) || !Number.isFinite(spd)) return [];
    return ends(base).map((e) => { const d = ((dir - e.hdg) * Math.PI) / 180; return { ...e, head: Math.round(spd * Math.cos(d)), cross: Math.round(Math.abs(spd * Math.sin(d))) }; }).sort((a, b) => b.head - a.head || a.cross - b.cross);
  }
  return { BASES, DEFAULT, ORDER, baseOf, ends, intoWind, endHeading };
});
