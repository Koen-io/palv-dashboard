'use strict';

/* ============================================================
   Zoek & Plan — vliegprestaties: windcorrectie, ware vliegsnelheid, VNE uit de tabel, brandstof en
   tijd langs een route, point of no return, actieradius met wind, orbit en zoekpatronen.
   Zonder DOM, zodat het in Node te toetsen is.
   ============================================================ */
// Speeds in knots, altitudes in feet, temperatures in °C, fuel in kg, time in minutes or ms, courses in
// degrees true. A route is integrated in short pieces with the wind of each piece at the moment the
// helicopter gets there, so a leg that bends (a great circle) or runs into a wind change is reckoned
// the way it will be flown.
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./geo.js') : root.PlanGeo);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanPerf = api;
})(typeof window !== 'undefined' ? window : globalThis, function (G) {
  const NM = 1852;
  const KT = NM / 3600; // m/s per knot
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, f) => a + (b - a) * f;

  /* ---------- atmosphere ---------- */
  const isaTemp = (paFt) => 15 - 1.98 * (paFt / 1000);
  const pressureRatio = (paFt) => (1 - 6.8756e-6 * paFt) ** 5.2559;
  const densityRatio = (paFt, oatC) => pressureRatio(paFt) / ((oatC + 273.15) / 288.15);
  const densityAltitude = (paFt, oatC) => 145442.16 * (1 - densityRatio(paFt, oatC) ** 0.234969);
  // CAS taken as IAS: at helicopter speeds compressibility is below one knot.
  const tasFromIas = (ias, paFt = 0, oatC = isaTemp(paFt)) => ias / Math.sqrt(densityRatio(paFt, oatC));
  const iasFromTas = (tas, paFt = 0, oatC = isaTemp(paFt)) => tas * Math.sqrt(densityRatio(paFt, oatC));

  /* ---------- wind ---------- */
  // Head- and crosswind on a track: head > 0 is headwind, cross > 0 is wind from the right.
  function components(trackDeg, windFrom, windKt) {
    const a = G.rad(windFrom - trackDeg);
    return { head: windKt * Math.cos(a), cross: windKt * Math.sin(a) };
  }
  // Heading to fly and groundspeed on a true course. null when the wind is too strong to hold the course.
  function triangle(courseDeg, tasKt, windFrom = 0, windKt = 0) {
    if (!(windKt > 0)) return { wca: 0, heading: G.norm360(courseDeg), gs: tasKt, head: 0, cross: 0 };
    const { head, cross } = components(courseDeg, windFrom, windKt);
    const s = cross / tasKt;
    if (Math.abs(s) > 1) return null;
    const wca = G.deg(Math.asin(s));
    const gs = tasKt * Math.cos(G.rad(wca)) - head;
    if (!(gs > 0)) return null;
    return { wca, heading: G.norm360(courseDeg + wca), gs, head, cross };
  }
  // Average of wind vectors (direction from, speed): winds are averaged as vectors, never as numbers.
  function meanWind(list) {
    let u = 0, v = 0, n = 0;
    for (const w of list) {
      if (!w || !(w.speedKt >= 0)) continue;
      const a = G.rad(w.dirDeg);
      u += -w.speedKt * Math.sin(a); v += -w.speedKt * Math.cos(a); n += 1;
    }
    if (!n) return null;
    u /= n; v /= n;
    return { dirDeg: G.norm360(G.deg(Math.atan2(-u, -v))), speedKt: Math.hypot(u, v) };
  }

  /* ---------- tables from the flight manual ---------- */
  // VNE: rows { weightKg (upper bound of the weight band), hpFt, oatC, kias }. Within the band that holds
  // the weight it is read bilinearly in altitude and temperature, as one reads the chart; outside the
  // chart it holds the nearest edge. Where a corner is missing the lowest neighbour counts (safe side).
  function vneAt(table, { weightKg = 0, paFt = 0, oatC = isaTemp(paFt) } = {}) {
    if (!table || !table.length) return null;
    const bands = [...new Set(table.map((r) => r.weightKg ?? Infinity))].sort((a, b) => a - b);
    const band = bands.find((b) => weightKg <= b) ?? bands[bands.length - 1];
    const rows = table.filter((r) => (r.weightKg ?? Infinity) === band);
    const hps = [...new Set(rows.map((r) => r.hpFt))].sort((a, b) => a - b);
    const oats = [...new Set(rows.map((r) => r.oatC))].sort((a, b) => a - b);
    const bracket = (list, v) => {
      if (v <= list[0]) return [list[0], list[0], 0];
      if (v >= list[list.length - 1]) return [list[list.length - 1], list[list.length - 1], 0];
      const i = list.findIndex((x) => x >= v);
      return [list[i - 1], list[i], (v - list[i - 1]) / (list[i] - list[i - 1])];
    };
    const [h0, h1, fh] = bracket(hps, paFt), [t0, t1, ft] = bracket(oats, oatC);
    const get = (hp, t) => { const r = rows.find((x) => x.hpFt === hp && x.oatC === t); return r ? r.kias : null; };
    const c = [get(h0, t0), get(h0, t1), get(h1, t0), get(h1, t1)];
    if (c.some((x) => x == null)) {
      const known = c.filter((x) => x != null);
      if (known.length) return { kias: Math.min(...known), band, exact: false };
      // Nothing around this point in the band: the lowest value at this altitude or below.
      const lower = rows.filter((r) => r.hpFt <= Math.max(paFt, hps[0])).map((r) => r.kias);
      return { kias: Math.min(...(lower.length ? lower : rows.map((r) => r.kias))), band, exact: false };
    }
    // Read beyond the edge of the chart: the edge value, flagged so the screen can say so.
    const inside = paFt >= hps[0] && paFt <= hps[hps.length - 1] && oatC >= oats[0] && oatC <= oats[oats.length - 1];
    return { kias: lerp(lerp(c[0], c[1], ft), lerp(c[2], c[3], ft), fh), band, exact: inside };
  }

  // Fuel flow: rows { kias, weightKg, hpFt, oatC?, kgh }; read linearly in speed per (weight, altitude,
  // temperature) curve, then between the nearest curves. Without a table the profile's planning figure is used.
  function flowAt(table, { kias, weightKg = 0, paFt = 0, oatC = isaTemp(paFt) } = {}, fallbackKgh = null) {
    if (!table || !table.length || kias == null) return fallbackKgh == null ? null : { kgh: fallbackKgh, src: 'planning' };
    const key = (r) => `${r.weightKg ?? 0}|${r.hpFt ?? 0}|${r.oatC ?? ''}`;
    const curves = new Map();
    for (const r of table) { const k = key(r); if (!curves.has(k)) curves.set(k, []); curves.get(k).push(r); }
    const along = (rows) => {
      const s = [...rows].sort((a, b) => a.kias - b.kias);
      if (kias <= s[0].kias) return s[0].kgh;
      if (kias >= s[s.length - 1].kias) return s[s.length - 1].kgh;
      const i = s.findIndex((r) => r.kias >= kias);
      return lerp(s[i - 1].kgh, s[i].kgh, (kias - s[i - 1].kias) / (s[i].kias - s[i - 1].kias));
    };
    const pts = [...curves.values()].map((rows) => ({ w: rows[0].weightKg ?? 0, h: rows[0].hpFt ?? 0, t: rows[0].oatC, kgh: along(rows) }));
    // Inverse-distance over weight (per 500 kg), altitude (per 2000 ft) and temperature (per 20 °C): smooth,
    // and exact on a curve.
    let num = 0, den = 0;
    for (const p of pts) {
      const d = Math.hypot((p.w - weightKg) / 500, (p.h - paFt) / 2000, p.t == null ? 0 : (p.t - oatC) / 20);
      if (d < 1e-6) return { kgh: p.kgh, src: 'tabel' };
      const wgt = 1 / d ** 2;
      num += wgt * p.kgh; den += wgt;
    }
    return { kgh: num / den, src: 'tabel' };
  }

  /* ---------- a route, flown ---------- */
  // opts: { points:[{lat,lon,name}], tasKt, altFt, departMs, fuelKg (on board at start-up), taxiKg,
  //   reserveKg, flowKgh, windAt(lat, lon, ms) -> { dirDeg, speedKt } | null, magVar(lat, lon) -> deg east,
  //   stepM (piece length, standard 2 NM) }.
  function planRoute(opts) {
    const { points = [], tasKt, departMs = Date.now(), flowKgh = 0, taxiKg = 0, reserveKg = 0 } = opts;
    const windAt = opts.windAt || (() => null);
    const magVar = opts.magVar || (() => 0);
    const stepM = opts.stepM || 2 * NM;
    const fuel0 = opts.fuelKg == null ? null : opts.fuelKg - taxiKg;
    const legs = [], samples = [{ m: 0, tMin: 0, fuelKg: fuel0, lat: points[0] && points[0].lat, lon: points[0] && points[0].lon, gs: null }];
    let m = 0, t = 0, impossible = false;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1], b = points[i];
      const len = G.dist(a, b);
      const n = Math.max(1, Math.ceil(len / stepM));
      let legT = 0;
      const winds = [];
      for (let k = 0; k < n; k += 1) {
        const p0 = G.interp(a, b, k / n), p1 = G.interp(a, b, (k + 1) / n), mid = G.interp(a, b, (k + 0.5) / n);
        const piece = len / n, course = G.bearing(p0, p1);
        const wnd = windAt(mid.lat, mid.lon, departMs + (t + legT) * 60000);
        if (wnd) winds.push(wnd);
        const tri = triangle(course, tasKt, wnd ? wnd.dirDeg : 0, wnd ? wnd.speedKt : 0);
        if (!tri) impossible = true;
        const gs = tri ? tri.gs : Math.max(1, tasKt - (wnd ? wnd.speedKt : 0));
        legT += piece / NM / gs * 60;
        samples.push({ m: m + (len * (k + 1)) / n, tMin: t + legT, fuelKg: fuel0 == null ? null : fuel0 - (flowKgh * (t + legT)) / 60, lat: p1.lat, lon: p1.lon, gs });
      }
      const mid = G.interp(a, b, 0.5);
      const tc = G.bearing(a, b);
      const wind = meanWind(winds);
      const tri = triangle(tc, tasKt, wind ? wind.dirDeg : 0, wind ? wind.speedKt : 0);
      const mv = magVar(mid.lat, mid.lon) || 0;
      const used = (flowKgh * legT) / 60;
      t += legT; m += len;
      legs.push({
        from: a, to: b, distM: len, tc, mc: G.norm360(tc - mv), magVar: mv, wind,
        wca: tri ? tri.wca : null, th: tri ? tri.heading : null, mh: tri ? G.norm360(tri.heading - mv) : null,
        gs: legT > 0 ? (len / NM) / (legT / 60) : tasKt, head: tri ? tri.head : null, cross: tri ? tri.cross : null,
        eteMin: legT, etaMs: departMs + t * 60000, fuelKg: used, fuelRemKg: fuel0 == null ? null : fuel0 - (flowKgh * t) / 60, cumM: m, cumMin: t,
      });
    }
    const landing = fuel0 == null ? null : fuel0 - (flowKgh * t) / 60;
    return {
      legs, samples, impossible,
      total: { distM: m, timeMin: t, fuelKg: (flowKgh * t) / 60 + taxiKg, landingFuelKg: landing, belowReserve: landing != null && landing < reserveKg, etaMs: departMs + t * 60000 },
    };
  }

  // Elapsed time, fuel and position at a distance along a planned route (linear between the pieces).
  function sampleAt(plan, m) {
    const s = plan.samples;
    if (!s.length) return null;
    if (m <= 0) return s[0];
    for (let i = 1; i < s.length; i += 1) {
      if (s[i].m >= m) {
        const f = (m - s[i - 1].m) / (s[i].m - s[i - 1].m || 1);
        return { m, tMin: lerp(s[i - 1].tMin, s[i].tMin, f), fuelKg: s[i].fuelKg == null ? null : lerp(s[i - 1].fuelKg, s[i].fuelKg, f), gs: s[i].gs };
      }
    }
    return s[s.length - 1];
  }

  // Time (min) to fly straight from a to b, with the wind of a few points along the way.
  function directTime(a, b, tasKt, windAt, atMs = Date.now()) {
    const len = G.dist(a, b);
    if (len < 1) return 0;
    const n = Math.max(1, Math.ceil(len / (5 * NM)));
    let t = 0;
    for (let k = 0; k < n; k += 1) {
      const p0 = G.interp(a, b, k / n), p1 = G.interp(a, b, (k + 1) / n), mid = G.interp(a, b, (k + 0.5) / n);
      const w = windAt ? windAt(mid.lat, mid.lon, atMs + t * 60000) : null;
      const tri = triangle(G.bearing(p0, p1), tasKt, w ? w.dirDeg : 0, w ? w.speedKt : 0);
      if (!tri) return null;
      t += (len / n / NM / tri.gs) * 60;
    }
    return t;
  }

  // Point of no return (back to `home` on the fuel there is, down to `keepKg`) along a planned route:
  // the furthest distance from which the way back still fits. Returns { m, lat, lon, tMin } or null
  // (the whole route is within reach: m = total, reached:false means even the start is out of reach).
  function pointOfReturn(plan, { home, tasKt, flowKgh, keepKg = 0, windAt, departMs = Date.now() }) {
    const s = plan.samples;
    if (!s.length || s[0].fuelKg == null || !(flowKgh > 0)) return null;
    const ok = (smp) => {
      const back = directTime(smp, home, tasKt, windAt, departMs + smp.tMin * 60000);
      return back != null && smp.fuelKg - (flowKgh * back) / 60 >= keepKg;
    };
    if (!ok(s[0])) return { m: 0, lat: s[0].lat, lon: s[0].lon, tMin: 0, reached: false };
    let last = s[0];
    for (let i = 1; i < s.length; i += 1) {
      if (!ok(s[i])) {
        // Narrow it down between the last good piece and this one.
        let lo = last.m, hi = s[i].m;
        const route = G.measure(plan.samples.map((x) => ({ lat: x.lat, lon: x.lon })));
        for (let k = 0; k < 16; k += 1) {
          const mid = (lo + hi) / 2, smp = sampleAt(plan, mid), p = G.pointAt(route, mid);
          if (ok({ ...smp, lat: p.lat, lon: p.lon })) lo = mid; else hi = mid;
        }
        const p = G.pointAt(route, lo), smp = sampleAt(plan, lo);
        return { m: lo, lat: p.lat, lon: p.lon, tMin: smp.tMin, reached: true, beyond: true };
      }
      last = s[i];
    }
    return { m: last.m, lat: last.lat, lon: last.lon, tMin: last.tMin, reached: true, beyond: false };
  }

  // How far one gets from `c` in every direction with `minutes` of flight: there and back (radius of
  // action) or one way, in the wind at c. Returns [{ brg, m }] every `step` degrees.
  function reach(c, { tasKt, minutes, wind, roundTrip = true, step = 5 }) {
    const out = [];
    for (let brg = 0; brg < 360; brg += step) {
      const go = triangle(brg, tasKt, wind ? wind.dirDeg : 0, wind ? wind.speedKt : 0);
      const back = triangle(brg + 180, tasKt, wind ? wind.dirDeg : 0, wind ? wind.speedKt : 0);
      let nm = 0;
      if (go && (!roundTrip || back)) nm = roundTrip ? ((minutes / 60) * go.gs * back.gs) / (go.gs + back.gs) : (minutes / 60) * go.gs;
      out.push({ brg, m: nm * NM, point: G.dest(c, brg, nm * NM) });
    }
    return out;
  }

  /* ---------- orbit ---------- */
  // Radius of a steady turn at a bank angle, and the bank needed to hold a circle over the ground in wind.
  const turnRadius = (tasKt, bankDeg) => (tasKt * KT) ** 2 / (9.80665 * Math.tan(G.rad(bankDeg)));
  const bankFor = (gsKt, radiusM) => G.deg(Math.atan((gsKt * KT) ** 2 / (9.80665 * radiusM)));
  function orbit({ tasKt, radiusM, windKt = 0 }) {
    const gsMax = tasKt + windKt, gsMin = Math.max(0, tasKt - windKt);
    const minutes = ((2 * Math.PI * radiusM) / (tasKt * KT)) / 60;
    return { radiusM, bankMax: bankFor(gsMax, radiusM), bankMin: bankFor(gsMin, radiusM), bankCalm: bankFor(tasKt, radiusM), gsMax, gsMin, minutes };
  }
  // The track over the ground of a constant-bank orbit in wind (a trochoid), for drawing.
  function driftOrbit(c, { tasKt, bankDeg, windFrom = 0, windKt = 0, turns = 3, right = true, n = 90 }) {
    const r = turnRadius(tasKt, bankDeg), omega = (tasKt * KT) / r; // rad/s
    const drift = G.rad(windFrom + 180), out = [];
    const total = turns * 2 * Math.PI;
    for (let i = 0; i <= turns * n; i += 1) {
      const th = (i / n) * 2 * Math.PI * (right ? 1 : -1), tS = Math.abs(th) / omega;
      const x = r * Math.sin(th) + windKt * KT * tS * Math.sin(drift);
      const y = r * Math.cos(th) + windKt * KT * tS * Math.cos(drift);
      const brg = G.deg(Math.atan2(x, y)), d = Math.hypot(x, y);
      out.push(G.dest(c, brg, d));
      if (Math.abs(th) > total) break;
    }
    return { radiusM: r, points: out };
  }

  /* ---------- search patterns (IAMSAR) ---------- */
  // Expanding square: from the datum, legs of S, S, 2S, 2S, 3S, ... each turned 90°.
  function expandingSquare(datum, { spacingM, legs = 12, firstTrack = 0, right = true }) {
    const pts = [{ ...datum, name: 'Datum' }];
    let p = datum, trk = firstTrack;
    for (let i = 0; i < legs; i += 1) {
      p = G.dest(p, trk, spacingM * (Math.floor(i / 2) + 1));
      pts.push({ ...p, name: `SS${i + 1}` });
      trk = G.norm360(trk + (right ? 90 : -90));
    }
    return pts;
  }
  // Sector search: three equilateral triangles of side R through the datum, radials 120° apart.
  function sectorSearch(datum, { radiusM, firstTrack = 0, right = true }) {
    const pts = [{ ...datum, name: 'Datum' }];
    const turn = right ? 1 : -1;
    for (let k = 0; k < 3; k += 1) {
      const radial = G.norm360(firstTrack + turn * k * 240);
      const out = G.dest(datum, radial, radiusM);
      const cross = G.dest(out, radial + turn * 120, radiusM);
      pts.push({ ...out, name: `VS${k * 2 + 1}` }, { ...cross, name: `VS${k * 2 + 2}` }, { ...datum, name: 'Datum' });
    }
    return pts;
  }
  // Creeping line (legs across the long axis, advancing along it) or parallel track (legs along it,
  // advancing across), over a box of `lengthM` x `widthM` centred on c with its long axis on `axis`.
  // The first leg lies S/2 inside the box.
  function ladder(c, { lengthM, widthM, spacingM, axis = 0, along = false, rightFirst = true }) {
    const across = G.norm360(axis + 90);
    const [advance, legDir, advLen, legLen] = along ? [across, axis, widthM, lengthM] : [axis, across, lengthM, widthM];
    const n = Math.max(1, Math.floor(advLen / spacingM));
    const start = G.dest(G.dest(c, advance + 180, advLen / 2 - spacingM / 2), legDir + 180, legLen / 2 - spacingM / 2);
    const pts = [];
    let base = start, dir = legDir;
    const leg = legLen - spacingM;
    for (let i = 0; i < n; i += 1) {
      const end = G.dest(base, dir, leg);
      pts.push({ ...base, name: `${along ? 'PS' : 'CS'}${i * 2 + 1}` }, { ...end, name: `${along ? 'PS' : 'CS'}${i * 2 + 2}` });
      base = G.dest(end, advance, spacingM);
      dir = G.norm360(dir + 180);
    }
    if (!rightFirst) return pts.reverse();
    return pts;
  }
  const lengthOf = (pts) => G.measure(pts).total;

  /* ---------- fuel policy ---------- */
  // The required fuel as the operations manual builds it up: start/taxi + trip + contingency (a share of
  // trip and alternate) + alternate + final reserve + extra. The final reserve is the larger of its minutes
  // at the speed the rule names and the fixed figure the operator holds, when it has one.
  function finalReserve({ minutes, flowKgh, fixedKg }) {
    const fromMin = minutes != null && flowKgh > 0 ? (minutes / 60) * flowKgh : null;
    const kg = Math.max(fromMin || 0, fixedKg || 0);
    return { kg, fromMin, fixedKg: fixedKg || null, by: fixedKg != null && fixedKg >= (fromMin || 0) ? 'fixed' : 'minutes' };
  }
  function fuelPlan({ taxiKg = 0, tripKg = 0, alternateKg = 0, contingencyPct = 0, finalReserveKg = 0, extraKg = 0, onBoardKg = null }) {
    const contingencyKg = ((tripKg + alternateKg) * contingencyPct) / 100;
    const requiredKg = taxiKg + tripKg + contingencyKg + alternateKg + finalReserveKg + extraKg;
    return { taxiKg, tripKg, contingencyKg, alternateKg, finalReserveKg, extraKg, requiredKg, onBoardKg, marginKg: onBoardKg == null ? null : onBoardKg - requiredKg };
  }

  return { NM, KT, isaTemp, pressureRatio, densityRatio, densityAltitude, tasFromIas, iasFromTas, components, triangle, meanWind, vneAt, flowAt, planRoute, sampleAt, directTime, pointOfReturn, reach, finalReserve, fuelPlan, turnRadius, bankFor, orbit, driftOrbit, expandingSquare, sectorSearch, ladder, lengthOf, clamp };
});
