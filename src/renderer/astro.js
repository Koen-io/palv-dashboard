'use strict';

/* ============================================================
   Zon, maan en licht
   Zonsopkomst en -ondergang (UDP), de stand en fase van de maan, maanop en -onder, en de geschatte
   verlichtingssterkte op de grond in lux. Los van de rest van de renderer, zodat het apart te toetsen is
   (`node --test`).
   ============================================================ */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ASTRO = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  const RAD = Math.PI / 180;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const norm = (deg) => ((deg % 360) + 360) % 360;
  // Reference point of the UDP and of the moon times: 52°00'N 005°00'E.
  const REF = { lat: 52, lon: 5 };

  /* ---------- sun ---------- */
  // NOAA solar calculator (after Meeus), good to well within a minute; the UDP times depend on it.
  function sunTimes(date, lat, lon) {
    const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    const at = (ms) => {
      const T = (ms / 864e5 + 2440587.5 - 2451545) / 36525;
      const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
      const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
      const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
      const C = Math.sin(M * RAD) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * RAD) * 0.000289;
      const om = 125.04 - 1934.136 * T;
      const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * RAD);
      const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * RAD);
      const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lam * RAD));
      const y = Math.tan((eps / 2) * RAD) ** 2;
      const eot = (4 / RAD) * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD) - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
      const ha = Math.acos(clamp(Math.cos(90.833 * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl), -1, 1)) / RAD;
      return { rise: midnight + (720 - 4 * (lon + ha) - eot) * 60000, set: midnight + (720 - 4 * (lon - ha) - eot) * 60000 };
    };
    // Second pass with the sun's position at the moment of rising and setting itself.
    const first = at(midnight + 12 * 3600e3);
    return { rise: new Date(at(first.rise).rise), set: new Date(at(first.set).set) };
  }

  /* ---------- UDP (uniforme daglichtperiode) ---------- */
  // From 15 minutes before sunrise until 15 minutes after sunset, at 52°00'N 005°00'E, for today's
  // date in the Netherlands. The official KNMI table for the year when it is on board; otherwise the
  // calculation, which stays within a minute of that table.
  const ltFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const nlDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' });
  function udpToday(now = Date.now(), table = root.SUN_TABLE || {}) {
    const [y, m, d] = nlDateFmt.format(now).split('-').map(Number);
    const noon = Date.UTC(y, m - 1, d, 12);
    const row = table[y] && table[y][m - 1].substr((d - 1) * 8, 8);
    let rise, set;
    if (row && row.length === 8) {
      const offset = +ltFmt.format(noon).slice(0, 2) - 12; // hours ahead of UTC on this date
      const local = (hhmm) => Date.UTC(y, m - 1, d, +hhmm.slice(0, 2) - offset, +hhmm.slice(2));
      rise = local(row.slice(0, 4)); set = local(row.slice(4));
    } else {
      const sun = sunTimes(new Date(noon), REF.lat, REF.lon);
      const round = (t) => Math.round(t / 60000) * 60000;
      rise = round(sun.rise.getTime()); set = round(sun.set.getTime());
    }
    const begin = rise - 15 * 60000, end = set + 15 * 60000;
    return { begin, end, day: now >= begin && now < end, official: !!row, year: y };
  }

  /* ---------- positions ---------- */
  const daysJ2000 = (ms) => ms / 864e5 + 2440587.5 - 2451545;
  const obliquity = (d) => (23.4393 - 3.563e-7 * d) * RAD;

  // Apparent ecliptic longitude of the sun (degrees) and its distance (km).
  function sunEcliptic(ms) {
    const d = daysJ2000(ms);
    const M = norm(357.5291 + 0.98560028 * d) * RAD;
    const C = 1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M);
    const lon = norm(280.4665 + 0.98564736 * d + C);
    const r = 149598023 * (1.00014 - 0.01671 * Math.cos(M) - 0.00014 * Math.cos(2 * M));
    return { lon, lat: 0, r };
  }

  // The moon after Meeus, chapter 47, with the main periodic terms: a few hundredths of a degree,
  // which puts moonrise and moonset within a minute or two.
  function moonEcliptic(ms) {
    const T = daysJ2000(ms) / 36525;
    const Lp = norm(218.3164477 + 481267.88123421 * T);
    const D = norm(297.8501921 + 445267.1114034 * T) * RAD;
    const M = norm(357.5291092 + 35999.0502909 * T) * RAD;
    const Mp = norm(134.9633964 + 477198.8675055 * T) * RAD;
    const F = norm(93.2720950 + 483202.0175233 * T) * RAD;
    const lon = Lp
      + 6.288774 * Math.sin(Mp) + 1.274027 * Math.sin(2 * D - Mp) + 0.658314 * Math.sin(2 * D)
      + 0.213618 * Math.sin(2 * Mp) - 0.185116 * Math.sin(M) - 0.114332 * Math.sin(2 * F)
      + 0.058793 * Math.sin(2 * D - 2 * Mp) + 0.057066 * Math.sin(2 * D - M - Mp) + 0.053322 * Math.sin(2 * D + Mp)
      + 0.045758 * Math.sin(2 * D - M) - 0.040923 * Math.sin(M - Mp) - 0.034720 * Math.sin(D)
      - 0.030383 * Math.sin(M + Mp) + 0.015327 * Math.sin(2 * D - 2 * F) - 0.012528 * Math.sin(Mp + 2 * F)
      + 0.010980 * Math.sin(Mp - 2 * F) + 0.010675 * Math.sin(4 * D - Mp) + 0.010034 * Math.sin(3 * Mp);
    const lat = 5.128122 * Math.sin(F) + 0.280602 * Math.sin(Mp + F) + 0.277693 * Math.sin(Mp - F)
      + 0.173237 * Math.sin(2 * D - F) + 0.055413 * Math.sin(2 * D - Mp + F) + 0.046271 * Math.sin(2 * D - Mp - F)
      + 0.032573 * Math.sin(2 * D + F) + 0.017198 * Math.sin(2 * Mp + F);
    const r = 385000.56 - 20905.355 * Math.cos(Mp) - 3699.111 * Math.cos(2 * D - Mp) - 2955.968 * Math.cos(2 * D) - 569.925 * Math.cos(2 * Mp);
    return { lon: norm(lon), lat, r };
  }

  function equatorial(ecl, ms) {
    const e = obliquity(daysJ2000(ms)), l = ecl.lon * RAD, b = ecl.lat * RAD;
    const ra = Math.atan2(Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e), Math.cos(l));
    const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
    return { ra, dec };
  }

  // Altitude and azimuth (degrees) of a body seen from lat/lon; `parallax` in degrees for the moon.
  function horizontal(eq, ms, lat, lon, parallax = 0) {
    const d = daysJ2000(ms);
    const lst = (norm(280.46061837 + 360.98564736629 * d) + lon) * RAD;
    const H = lst - eq.ra, phi = lat * RAD;
    let alt = Math.asin(Math.sin(phi) * Math.sin(eq.dec) + Math.cos(phi) * Math.cos(eq.dec) * Math.cos(H)) / RAD;
    const az = norm(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(eq.dec) * Math.cos(phi)) / RAD + 180);
    alt -= parallax * Math.cos(alt * RAD); // topocentric
    // Parallactic angle: how the moon's disc is turned against the vertical.
    const q = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(eq.dec) - Math.sin(eq.dec) * Math.cos(H)) / RAD;
    return { alt, az, q };
  }

  // Atmospheric refraction (degrees) for an apparent altitude, after Bennett.
  const refraction = (alt) => (alt < -1.5 ? 0 : 1.02 / Math.tan((alt + 10.3 / (alt + 5.11)) * RAD) / 60);

  function sunPosition(ms, lat = REF.lat, lon = REF.lon) {
    const ecl = sunEcliptic(ms);
    const p = horizontal(equatorial(ecl, ms), ms, lat, lon);
    return { alt: p.alt + refraction(p.alt), az: p.az };
  }

  function moon(ms, lat = REF.lat, lon = REF.lon) {
    const m = moonEcliptic(ms), s = sunEcliptic(ms);
    const meq = equatorial(m, ms), seq = equatorial(s, ms);
    const parallax = Math.asin(6378.14 / m.r) / RAD;
    const pos = horizontal(meq, ms, lat, lon, parallax);
    // Phase: elongation from the sun, phase angle and the lit fraction of the disc (Meeus 48).
    const psi = Math.acos(Math.cos(m.lat * RAD) * Math.cos((m.lon - s.lon) * RAD));
    const i = Math.atan2(s.r * Math.sin(psi), m.r - s.r * Math.cos(psi));
    const fraction = (1 + Math.cos(i)) / 2;
    const elong = norm(m.lon - s.lon); // 0 new moon, 90 first quarter, 180 full, 270 last quarter
    // Position angle of the bright limb, measured from north through east, and turned to the observer's
    // vertical with the parallactic angle: the angle at which the lit side faces, as seen in the sky.
    const chi = Math.atan2(Math.cos(seq.dec) * Math.sin(seq.ra - meq.ra), Math.sin(seq.dec) * Math.cos(meq.dec) - Math.cos(seq.dec) * Math.sin(meq.dec) * Math.cos(seq.ra - meq.ra)) / RAD;
    return {
      alt: pos.alt + refraction(pos.alt), az: pos.az, distance: m.r,
      fraction, phaseAngle: i / RAD, elongation: elong, waxing: elong < 180,
      limbAngle: norm(chi - pos.q), phaseName: phaseName(elong),
    };
  }

  function phaseName(elong) {
    if (elong < 7 || elong >= 353) return 'Nieuwe maan';
    if (elong < 83) return 'Wassende sikkel';
    if (elong < 97) return 'Eerste kwartier';
    if (elong < 173) return 'Wassende maan';
    if (elong < 187) return 'Volle maan';
    if (elong < 263) return 'Afnemende maan';
    if (elong < 277) return 'Laatste kwartier';
    return 'Afnemende sikkel';
  }

  /* ---------- moonrise and moonset ---------- */
  // The moon rises or sets when its upper limb touches the horizon: apparent centre at about -0.27°
  // (semi-diameter) once refraction is in. Scanned in 10-minute steps and refined by bisection.
  const MOON_H0 = -0.27;
  function crossings(fromMs, toMs, lat = REF.lat, lon = REF.lon) {
    const out = [];
    const f = (t) => moon(t, lat, lon).alt - MOON_H0;
    const STEP = 10 * 60000;
    let t0 = fromMs, v0 = f(t0);
    for (let t1 = fromMs + STEP; t1 <= toMs + STEP / 2; t1 += STEP) {
      const v1 = f(t1);
      if ((v0 < 0) !== (v1 < 0)) {
        let a = t0, b = t1, va = v0;
        for (let k = 0; k < 14; k += 1) {
          const mid = (a + b) / 2, vm = f(mid);
          if ((va < 0) === (vm < 0)) { a = mid; va = vm; } else b = mid;
        }
        out.push({ t: Math.round((a + b) / 2), rise: v0 < 0 });
      }
      t0 = t1; v0 = v1;
    }
    return out;
  }

  // The moon's current pass: when it is up, from its last rise to its coming set; when it is down,
  // its next rise and the set after that.
  function moonPass(now = Date.now(), lat = REF.lat, lon = REF.lon) {
    const list = crossings(now - 30 * 3600e3, now + 40 * 3600e3, lat, lon);
    const up = moon(now, lat, lon).alt > MOON_H0;
    if (up) {
      const rise = [...list].reverse().find((c) => c.rise && c.t <= now);
      const set = list.find((c) => !c.rise && c.t > now);
      return { up, rise: rise ? rise.t : null, set: set ? set.t : null };
    }
    const rise = list.find((c) => c.rise && c.t > now);
    const set = rise ? list.find((c) => !c.rise && c.t > rise.t) : null;
    return { up, rise: rise ? rise.t : null, set: set ? set.t : null };
  }

  // Next moment the elongation reaches `target` (0 new, 180 full), within the coming 35 days.
  function nextPhase(target, now = Date.now()) {
    const g = (t) => { const e = norm(moonEcliptic(t).lon - sunEcliptic(t).lon - target + 180) - 180; return e; };
    let t0 = now, v0 = g(t0);
    for (let t1 = now + 6 * 3600e3; t1 < now + 35 * 864e5; t1 += 6 * 3600e3) {
      const v1 = g(t1);
      if (v0 < 0 && v1 >= 0) {
        let a = t0, b = t1;
        for (let k = 0; k < 20; k += 1) { const mid = (a + b) / 2; if (g(mid) < 0) a = mid; else b = mid; }
        return Math.round((a + b) / 2);
      }
      t0 = t1; v0 = v1;
    }
    return null;
  }

  /* ---------- illuminance ---------- */
  // Horizontal illuminance in lux from the sun and the sky, against the sun's altitude, under a clear
  // sky (after Bond & Henderson and the USNO tables). Below -18° only starlight and airglow remain.
  const SKY = [[-90, -3.22], [-18, -3.22], [-17, -3.18], [-16, -3.1], [-15, -2.95], [-14, -2.75], [-13, -2.45], [-12, -2.1], [-11, -1.65], [-10, -1.2], [-9, -0.8], [-8, -0.35], [-7, 0.1], [-6, 0.53], [-5, 0.9], [-4, 1.3], [-3, 1.8], [-2, 2.2], [-1, 2.55], [0, 2.85], [5, 3.7], [10, 4.1], [20, 4.5], [30, 4.7], [40, 4.82], [60, 4.98], [90, 5.05]];
  function skyLux(sunAlt) {
    const a = clamp(sunAlt, -90, 90);
    for (let k = 1; k < SKY.length; k += 1) {
      const [x1, y1] = SKY[k];
      if (a <= x1) {
        const [x0, y0] = SKY[k - 1];
        return 10 ** (y0 + ((a - x0) / (x1 - x0)) * (y1 - y0));
      }
    }
    return 10 ** SKY[SKY.length - 1][1];
  }

  // Moonlight on the ground: the moon's magnitude for its phase angle (Allen) and distance, dimmed by
  // the air it shines through (0.25 magnitude per air mass, a clear Dutch sky), on a horizontal surface.
  function moonLux(m) {
    if (m.alt <= 0) return 0;
    const i = Math.abs(m.phaseAngle);
    const mag = -12.73 + 0.026 * i + 4e-9 * i ** 4 + 5 * Math.log10(m.distance / 384400);
    const z = (90 - m.alt) * RAD;
    const airmass = 1 / (Math.cos(z) + 0.50572 * (96.07995 - (90 - m.alt)) ** -1.6364);
    return 10 ** (-0.4 * (mag + 14.18 + 0.25 * airmass)) * Math.sin(m.alt * RAD);
  }

  function light(ms = Date.now(), lat = REF.lat, lon = REF.lon) {
    const sun = sunPosition(ms, lat, lon), m = moon(ms, lat, lon);
    const fromSky = skyLux(sun.alt), fromMoon = moonLux(m);
    return { lux: fromSky + fromMoon, sky: fromSky, moon: fromMoon, sunAlt: sun.alt, moonAlt: m.alt };
  }

  // "45.000 lx", "3,4 lx", "230 mlx", "0,62 mlx": lux down to 1, millilux below that.
  function formatLux(lux) {
    const nl = (v, digits) => v.toLocaleString('nl-NL', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    const sig = (v) => (v >= 100 ? Math.round(v) : v >= 10 ? Math.round(v * 10) / 10 : Math.round(v * 100) / 100);
    if (lux >= 1000) return { value: nl(Math.round(lux / 100) * 100, 0), unit: 'lx' };
    if (lux >= 1) return { value: nl(sig(lux), 2), unit: 'lx' };
    return { value: nl(sig(lux * 1000), 2), unit: 'mlx' };
  }

  return { REF, sunTimes, udpToday, sunPosition, moon, moonPass, crossings, nextPhase, skyLux, moonLux, light, formatLux, phaseName };
});
