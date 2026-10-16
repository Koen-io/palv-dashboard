'use strict';

/* ============================================================
   Zoek & Plan — eenheden: omrekenen en netjes tonen, met de Nederlandse komma.
   ============================================================ */
// Internally everything is metres, knots, feet, kilograms and degrees true; only what is shown follows
// the units chosen in the tab. Standard is aviation: NM, kt, ft, kg.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanUnits = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DIST = {
    nm: { name: 'NM', label: 'Zeemijl (NM)', m: 1852 },
    km: { name: 'km', label: 'Kilometer', m: 1000 },
    sm: { name: 'SM', label: 'Landmijl (SM)', m: 1609.344 },
  };
  const SPEED = {
    kt: { name: 'kt', label: 'Knopen (kt)', kt: 1 },
    kmh: { name: 'km/u', label: 'Kilometer per uur', kt: 1 / 1.852 },
    mph: { name: 'mph', label: 'Mijl per uur', kt: 1 / 1.150779 },
    ms: { name: 'm/s', label: 'Meter per seconde', kt: 1 / 0.514444 },
  };
  const ALT = {
    ft: { name: 'ft', label: 'Voet (ft)', ft: 1 },
    m: { name: 'm', label: 'Meter', ft: 1 / 0.3048 },
  };
  const FUEL = {
    kg: { name: 'kg', label: 'Kilogram' },
    lb: { name: 'lb', label: 'Pond (lb)' },
    l: { name: 'L', label: 'Liter' },
  };
  const WIND = {
    kt: { name: 'kt', label: 'Knopen (kt)' },
    ms: { name: 'm/s', label: 'Meter per seconde' },
    kmh: { name: 'km/u', label: 'Kilometer per uur' },
    bft: { name: 'Bft', label: 'Beaufort' },
  };
  const DEFAULTS = { dist: 'nm', speed: 'kt', alt: 'ft', fuel: 'kg', wind: 'kt', north: 'mag', coord: 'ddm', time: 'utc' };
  // Upper limits of Beaufort 0..11 in knots (KNMI); 12 above.
  const BFT = [1, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63];
  const beaufort = (kt) => { const i = BFT.findIndex((v) => kt < v); return i < 0 ? 12 : i; };

  const num = (v, digits = 0) => (v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('nl-NL', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
  // Fewer decimals as the number grows: 0,42 · 4,2 · 42 · 420.
  const auto = (v) => num(v, v === 0 ? 0 : Math.abs(v) < 1 ? 2 : Math.abs(v) < 10 ? 1 : 0);

  const distIn = (m, u = 'nm') => m / (DIST[u] || DIST.nm).m;
  const distM = (v, u = 'nm') => v * (DIST[u] || DIST.nm).m;
  const fmtDist = (m, u = 'nm', digits) => (m == null ? '—' : `${digits == null ? auto(distIn(m, u)) : num(distIn(m, u), digits)} ${(DIST[u] || DIST.nm).name}`);
  const speedIn = (kt, u = 'kt') => kt / (SPEED[u] || SPEED.kt).kt;
  const speedKt = (v, u = 'kt') => v * (SPEED[u] || SPEED.kt).kt;
  const fmtSpeed = (kt, u = 'kt') => (kt == null ? '—' : `${num(speedIn(kt, u))} ${(SPEED[u] || SPEED.kt).name}`);
  const altIn = (ft, u = 'ft') => ft / (ALT[u] || ALT.ft).ft;
  const altFt = (v, u = 'ft') => v * (ALT[u] || ALT.ft).ft;
  const fmtAlt = (ft, u = 'ft') => (ft == null ? '—' : `${num(Math.round(altIn(ft, u) / (u === 'm' ? 5 : 10)) * (u === 'm' ? 5 : 10))} ${(ALT[u] || ALT.ft).name}`);
  const fuelIn = (kg, u = 'kg', density = 0.8) => (u === 'lb' ? kg * 2.20462 : u === 'l' ? kg / density : kg);
  const fuelKg = (v, u = 'kg', density = 0.8) => (u === 'lb' ? v / 2.20462 : u === 'l' ? v * density : v);
  const fmtFuel = (kg, u = 'kg', density = 0.8) => (kg == null ? '—' : `${num(fuelIn(kg, u, density))} ${(FUEL[u] || FUEL.kg).name}`);
  const windIn = (kt, u = 'kt') => (u === 'ms' ? kt * 0.514444 : u === 'kmh' ? kt * 1.852 : u === 'bft' ? beaufort(kt) : kt);
  const fmtWindSpeed = (kt, u = 'kt') => (kt == null ? '—' : u === 'bft' ? `${beaufort(kt)} Bft` : `${num(windIn(kt, u), u === 'ms' ? 1 : 0)} ${(WIND[u] || WIND.kt).name}`);
  // "270° / 15 kt": where the wind comes from, as a wind is always reported.
  const hdg = (d) => (d == null || !Number.isFinite(d) ? '—' : `${String(Math.round(((d % 360) + 360) % 360) || 360).padStart(3, '0')}°`);
  const fmtWind = (dir, kt, u = 'kt') => (kt == null ? '—' : kt < 1 ? 'Windstil' : `${hdg(dir)} / ${fmtWindSpeed(kt, u)}`);
  // Minutes as 1:05, or 45 min below an hour; `long` gives "1 u 05 min".
  function fmtDur(min, long) {
    if (min == null || !Number.isFinite(min)) return '—';
    const t = Math.round(min), hh = Math.floor(t / 60), mm = t % 60;
    if (long) return hh ? `${hh} u ${String(mm).padStart(2, '0')} min` : `${mm} min`;
    return hh ? `${hh}:${String(mm).padStart(2, '0')}` : `${mm} min`;
  }

  return { DIST, SPEED, ALT, FUEL, WIND, DEFAULTS, BFT, beaufort, num, auto, distIn, distM, fmtDist, speedIn, speedKt, fmtSpeed, altIn, altFt, fmtAlt, fuelIn, fuelKg, fmtFuel, windIn, fmtWindSpeed, fmtWind, hdg, fmtDur };
});
