'use strict';

/* ============================================================
   Magnetische variatie (declinatie) volgens het World Magnetic Model 2025, geldig 2025.0-2030.0.
   Zonder DOM, zodat het in Node te toetsen is.
   Coefficients: WMM2025 (WMM.COF, header "2025.0 WMM-2025 11/13/2024"), NOAA NCEI / British Geological
   Survey, https://www.ncei.noaa.gov/products/world-magnetic-model. US government work, public domain.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanWmm = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const EPOCH = 2025.0, VALID_TO = 2030.0, NMAX = 12;
  // Per (n, m) in file order (n = 1..12, m = 0..n): g, h (nT), g-dot, h-dot (nT/yr).
  const COF = [
    -29351.8, 0, 12, 0, -1410.8, 4545.4, 9.7, -21.5,
    -2556.6, 0, -11.6, 0, 2951.1, -3133.6, -5.2, -27.7, 1649.3, -815.1, -8, -12.1,
    1361, 0, -1.3, 0, -2404.1, -56.6, -4.2, 4, 1243.8, 237.5, 0.4, -0.3, 453.6, -549.5, -15.6, -4.1,
    895, 0, -1.6, 0, 799.5, 278.6, -2.4, -1.1, 55.7, -133.9, -6, 4.1, -281.1, 212, 5.6, 1.6, 12.1, -375.6, -7, -4.4,
    -233.2, 0, 0.6, 0, 368.9, 45.4, 1.4, -0.5, 187.2, 220.2, 0, 2.2, -138.7, -122.9, 0.6, 0.4, -142, 43, 2.2, 1.7, 20.9, 106.1, 0.9, 1.9,
    64.4, 0, -0.2, 0, 63.8, -18.4, -0.4, 0.3, 76.9, 16.8, 0.9, -1.6, -115.7, 48.8, 1.2, -0.4, -40.9, -59.8, -0.9, 0.9, 14.9, 10.9, 0.3, 0.7, -60.7, 72.7, 0.9, 0.9,
    79.5, 0, 0, 0, -77, -48.9, -0.1, 0.6, -8.8, -14.4, -0.1, 0.5, 59.3, -1, 0.5, -0.8, 15.8, 23.4, -0.1, 0, 2.5, -7.4, -0.8, -1, -11.1, -25.1, -0.8, 0.6, 14.2, -2.3, 0.8, -0.2,
    23.2, 0, -0.1, 0, 10.8, 7.1, 0.2, -0.2, -17.5, -12.6, 0, 0.5, 2, 11.4, 0.5, -0.4, -21.7, -9.7, -0.1, 0.4, 16.9, 12.7, 0.3, -0.5, 15, 0.7, 0.2, -0.6, -16.8, -5.2, 0, 0.3, 0.9, 3.9, 0.2, 0.2,
    4.6, 0, 0, 0, 7.8, -24.8, -0.1, -0.3, 3, 12.2, 0.1, 0.3, -0.2, 8.3, 0.3, -0.3, -2.5, -3.3, -0.3, 0.3, -13.1, -5.2, 0, 0.2, 2.4, 7.2, 0.3, -0.1, 8.6, -0.6, -0.1, -0.2, -8.7, 0.8, 0.1, 0.4, -12.9, 10, -0.1, 0.1,
    -1.3, 0, 0.1, 0, -6.4, 3.3, 0, 0, 0.2, 0, 0.1, 0, 2, 2.4, 0.1, -0.2, -1, 5.3, 0, 0.1, -0.6, -9.1, -0.3, -0.1, -0.9, 0.4, 0, 0.1, 1.5, -4.2, -0.1, 0, 0.9, -3.8, -0.1, -0.1, -2.7, 0.9, 0, 0.2, -3.9, -9.1, 0, 0,
    2.9, 0, 0, 0, -1.5, 0, 0, 0, -2.5, 2.9, 0, 0.1, 2.4, -0.6, 0, 0, -0.6, 0.2, 0, 0.1, -0.1, 0.5, -0.1, 0, -0.6, -0.3, 0, 0, -0.1, -1.2, 0, 0.1, 1.1, -1.7, -0.1, 0, -1, -2.9, -0.1, 0, -0.2, -1.8, -0.1, 0, 2.6, -2.3, -0.1, 0,
    -2, 0, 0, 0, -0.2, -1.3, 0, 0, 0.3, 0.7, 0, 0, 1.2, 1, 0, -0.1, -1.3, -1.4, 0, 0.1, 0.6, 0, 0, 0, 0.6, 0.6, 0.1, 0, 0.5, -0.1, 0, 0, -0.1, 0.8, 0, 0, -0.4, 0.1, 0, 0, -0.2, -1, -0.1, 0, -1.3, 0.1, 0, 0, -0.7, 0.2, -0.1, -0.1,  ];

  // Schmidt semi-normalisation folded into the coefficients once, so the recursion below can use
  // the plain (Gauss) Legendre functions.
  const G = [], H = [], GD = [], HD = [];
  {
    let i = 0, sPrev = 1;
    for (let nn = 1; nn <= NMAX; nn++) {
      G[nn] = []; H[nn] = []; GD[nn] = []; HD[nn] = [];
      let s = sPrev * (2 * nn - 1) / nn;
      sPrev = s;
      for (let m = 0; m <= nn; m++) {
        if (m > 0) s *= Math.sqrt((nn - m + 1) * (m === 1 ? 2 : 1) / (nn + m));
        G[nn][m] = COF[i] * s; H[nn][m] = COF[i + 1] * s; GD[nn][m] = COF[i + 2] * s; HD[nn][m] = COF[i + 3] * s;
        i += 4;
      }
    }
  }

  const A = 6378.137, F = 1 / 298.257223563, E2 = F * (2 - F), RE = 6371.2;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  // Decimal year from a Date (UTC) or pass a number through.
  function decimalYear(date) {
    if (typeof date === 'number') return date;
    const d = date instanceof Date ? date : new Date(date);
    const y = d.getUTCFullYear(), start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
    return y + (d.getTime() - start) / (end - start);
  }

  // Sums the spherical harmonic series for one coefficient set; returns geocentric north/east/down (nT).
  function series(g, h, ar, P, dP, cosM, sinM, sinT) {
    let br = 0, bt = 0, bp = 0;
    let arn = ar * ar;
    for (let nn = 1; nn <= NMAX; nn++) {
      arn *= ar;
      let sr = 0, st = 0, sp = 0;
      for (let m = 0; m <= nn; m++) {
        const c = g[nn][m] * cosM[m] + h[nn][m] * sinM[m];
        sr += c * P[nn][m];
        st += c * dP[nn][m];
        sp += m * (-g[nn][m] * sinM[m] + h[nn][m] * cosM[m]) * P[nn][m];
      }
      br += arn * (nn + 1) * sr; bt -= arn * st; bp -= arn * sp; // bp: -dV/dlambda, divided by sin(theta) below
    }
    // sinT is clamped away from 0 by the caller, so the east component stays finite at the poles.
    return { x: -bt, y: bp / sinT, z: -br };
  }

  // field(lat, lon, altKm above the WGS84 ellipsoid, date) -> components in nT (geodetic north, east,
  // down), angles in degrees (declination east positive, inclination down positive) and their yearly change.
  function field(lat, lon, altKm = 0, date = new Date()) {
    const t = decimalYear(date) - EPOCH;
    const phi = lat * D2R, lam = lon * D2R;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    const rc = A / Math.sqrt(1 - E2 * sp * sp);
    const p = (rc + altKm) * cp, zz = (rc * (1 - E2) + altKm) * sp;
    const r = Math.hypot(p, zz), phiC = Math.asin(zz / r);
    const cosT = Math.sin(phiC), sinT = Math.max(1e-10, Math.cos(phiC));

    // Gauss-normalised associated Legendre functions and their colatitude derivatives.
    const P = [[1]], dP = [[0]];
    for (let nn = 1; nn <= NMAX; nn++) {
      P[nn] = []; dP[nn] = [];
      for (let m = 0; m < nn; m++) {
        const two = m <= nn - 2, k = two ? ((nn - 1) ** 2 - m * m) / ((2 * nn - 1) * (2 * nn - 3)) : 0;
        P[nn][m] = cosT * P[nn - 1][m] - (two ? k * P[nn - 2][m] : 0);
        dP[nn][m] = cosT * dP[nn - 1][m] - sinT * P[nn - 1][m] - (two ? k * dP[nn - 2][m] : 0);
      }
      P[nn][nn] = sinT * P[nn - 1][nn - 1];
      dP[nn][nn] = sinT * dP[nn - 1][nn - 1] + cosT * P[nn - 1][nn - 1];
    }
    const cosM = [], sinM = [];
    for (let m = 0; m <= NMAX; m++) { cosM[m] = Math.cos(m * lam); sinM[m] = Math.sin(m * lam); }

    const g = [], h = [];
    for (let nn = 1; nn <= NMAX; nn++) { g[nn] = G[nn].map((v, m) => v + t * GD[nn][m]); h[nn] = H[nn].map((v, m) => v + t * HD[nn][m]); }
    const ar = RE / r;
    const b = series(g, h, ar, P, dP, cosM, sinM, sinT), bd = series(GD, HD, ar, P, dP, cosM, sinM, sinT);

    // Rotate from geocentric to geodetic.
    const psi = phiC - phi, cs = Math.cos(psi), sn = Math.sin(psi);
    const rot = (v) => ({ x: v.x * cs - v.z * sn, y: v.y, z: v.x * sn + v.z * cs });
    const { x, y, z } = rot(b), d = rot(bd);
    const hh = Math.hypot(x, y), f = Math.hypot(hh, z);
    const decl = Math.atan2(y, x) * R2D, incl = Math.atan2(z, hh) * R2D;
    const hdot = (x * d.x + y * d.y) / hh;
    const res = {
      x, y, z, h: hh, f, decl, incl,
      xdot: d.x, ydot: d.y, zdot: d.z, hdot, fdot: (x * d.x + y * d.y + z * d.z) / f,
      decldot: (x * d.y - y * d.x) / (hh * hh) * R2D, incldot: (hh * d.z - z * hdot) / (f * f) * R2D,
      // Grid variation (relative to grid north of the polar stereographic grids) beyond 55 degrees only.
      gv: NaN,
    };
    if (lat >= 55) res.gv = ((decl - lon) % 360 + 540) % 360 - 180;
    else if (lat <= -55) res.gv = ((decl + lon) % 360 + 540) % 360 - 180;
    return res;
  }

  const declination = (lat, lon, altKm = 0, date = new Date()) => field(lat, lon, altKm, date).decl;
  const inclination = (lat, lon, altKm = 0, date = new Date()) => field(lat, lon, altKm, date).incl;
  const totalField = (lat, lon, altKm = 0, date = new Date()) => field(lat, lon, altKm, date).f;
  // The model is only valid for its five years; callers can show a warning outside them.
  const inRange = (date = new Date()) => { const y = decimalYear(date); return y >= EPOCH && y < VALID_TO; };

  return { EPOCH, VALID_TO, MODEL: 'WMM2025', field, declination, inclination, totalField, decimalYear, inRange };
});
