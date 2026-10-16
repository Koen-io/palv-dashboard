'use strict';

/* ============================================================
   Coördinaten voor Zoek & Plan: RD (EPSG:28992) <-> WGS84, UTM en MGRS, weergave in de gangbare
   notaties en het herkennen van een ingetypte coördinaat. Zonder DOM, zodat het in Node te toetsen is.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PlanCoords = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  /* ---------- RD: benaderingsformules (Schreutelkamp & Strang van Hees, 2001), ~1 m binnen NL ---------- */
  const X0 = 155000, Y0 = 463000, PHI0 = 52.15517440, LAM0 = 5.38720621;
  // [p, q, coefficient]: term = c * dPhi^p * dLam^q (to RD) or c * dX^p * dY^q (from RD).
  const R = [[0, 1, 190094.945], [1, 1, -11832.228], [2, 1, -114.221], [0, 3, -32.391], [1, 0, -0.705], [3, 1, -2.340], [1, 3, -0.608], [0, 2, -0.008], [2, 3, 0.148]];
  const S = [[1, 0, 309056.544], [0, 2, 3638.893], [2, 0, 73.077], [1, 2, -157.984], [3, 0, 59.788], [0, 1, 0.433], [2, 2, -6.439], [1, 1, -0.032], [0, 4, 0.092], [1, 4, -0.054]];
  const K = [[0, 1, 3235.65389], [2, 0, -32.58297], [0, 2, -0.24750], [2, 1, -0.84978], [0, 3, -0.06550], [2, 2, -0.01709], [1, 0, -0.00738], [4, 0, 0.00530], [2, 3, -0.00039], [4, 1, 0.00033], [1, 1, -0.00012]];
  const L = [[1, 0, 5260.52916], [1, 1, 105.94684], [1, 2, 2.45656], [3, 0, -0.81885], [1, 3, 0.05594], [3, 1, -0.05607], [0, 1, 0.01199], [3, 2, -0.00256], [1, 4, 0.00128], [0, 2, 0.00022], [2, 0, -0.00022], [5, 0, 0.00026]];
  const poly = (terms, a, b) => terms.reduce((s, [p, q, c]) => s + c * a ** p * b ** q, 0);

  function toRD(lat, lon) {
    const dp = 0.36 * (lat - PHI0), dl = 0.36 * (lon - LAM0);
    return { x: X0 + poly(R, dp, dl), y: Y0 + poly(S, dp, dl) };
  }
  function fromRD(x, y) {
    const dx = (x - X0) * 1e-5, dy = (y - Y0) * 1e-5;
    return { lat: PHI0 + poly(K, dx, dy) / 3600, lon: LAM0 + poly(L, dx, dy) / 3600 };
  }
  // Area where RD is meaningful (with some sea around NL); outside it fmt('rd') gives null.
  const inRD = (x, y) => x >= -7000 && x <= 300000 && y >= 289000 && y <= 629000;

  /* ---------- UTM (WGS84), Krüger series to n^6 (Karney 2011): sub-mm within a zone ---------- */
  const A_ = 6378137, F_ = 1 / 298.257223563, K0 = 0.9996;
  const E_ = Math.sqrt(F_ * (2 - F_)), N_ = F_ / (2 - F_);
  const n = N_, n2 = n * n, n3 = n2 * n, n4 = n3 * n, n5 = n4 * n, n6 = n5 * n;
  const AA = A_ / (1 + n) * (1 + n2 / 4 + n4 / 64 + n6 / 256);
  const ALPHA = [
    n / 2 - 2 / 3 * n2 + 5 / 16 * n3 + 41 / 180 * n4 - 127 / 288 * n5 + 7891 / 37800 * n6,
    13 / 48 * n2 - 3 / 5 * n3 + 557 / 1440 * n4 + 281 / 630 * n5 - 1983433 / 1935360 * n6,
    61 / 240 * n3 - 103 / 140 * n4 + 15061 / 26880 * n5 + 167603 / 181440 * n6,
    49561 / 161280 * n4 - 179 / 168 * n5 + 6601661 / 7257600 * n6,
    34729 / 80640 * n5 - 3418889 / 1995840 * n6,
    212378941 / 319334400 * n6,
  ];
  const BETA = [
    n / 2 - 2 / 3 * n2 + 37 / 96 * n3 - 1 / 360 * n4 - 81 / 512 * n5 + 96199 / 604800 * n6,
    1 / 48 * n2 + 1 / 15 * n3 - 437 / 1440 * n4 + 46 / 105 * n5 - 1118711 / 3870720 * n6,
    17 / 480 * n3 - 37 / 840 * n4 - 209 / 4480 * n5 + 5569 / 90720 * n6,
    4397 / 161280 * n4 - 11 / 504 * n5 - 830251 / 7257600 * n6,
    4583 / 161280 * n5 - 108847 / 3991680 * n6,
    20648693 / 638668800 * n6,
  ];
  const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
  const normLon = (lon) => ((lon + 180) % 360 + 360) % 360 - 180;

  // Projects in a given zone (also outside its own 6 degrees, as MGRS decoding needs).
  function project(lat, lon, zone) {
    const phi = lat * D2R, lam = normLon(lon - (zone * 6 - 183)) * D2R;
    const tau = Math.tan(phi), sigma = Math.sinh(E_ * Math.atanh(E_ * tau / Math.sqrt(1 + tau * tau)));
    const tauP = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
    const xiP = Math.atan2(tauP, Math.cos(lam)), etaP = Math.asinh(Math.sin(lam) / Math.sqrt(tauP * tauP + Math.cos(lam) ** 2));
    let xi = xiP, eta = etaP;
    ALPHA.forEach((a, i) => { const j = 2 * (i + 1); xi += a * Math.sin(j * xiP) * Math.cosh(j * etaP); eta += a * Math.cos(j * xiP) * Math.sinh(j * etaP); });
    return { e: 500000 + K0 * AA * eta, n: K0 * AA * xi + (lat < 0 ? 10000000 : 0) };
  }

  // Standard zone incl. the Norway (32V) and Svalbard (31X/33X/35X/37X) exceptions.
  function zoneOf(lat, lon) {
    lon = normLon(lon);
    let z = Math.floor((lon + 180) / 6) + 1;
    if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;
    if (lat >= 72) {
      if (lon >= 0 && lon < 9) z = 31;
      else if (lon >= 9 && lon < 21) z = 33;
      else if (lon >= 21 && lon < 33) z = 35;
      else if (lon >= 33 && lon < 42) z = 37;
    }
    return z;
  }
  const bandOf = (lat) => BANDS[Math.min(19, Math.floor((lat + 80) / 8))];

  function toUTM(lat, lon) {
    if (!(lat >= -80 && lat <= 84) || !Number.isFinite(lon)) return null;
    const zone = zoneOf(lat, lon), p = project(lat, lon, zone);
    return { zone, band: bandOf(lat), e: p.e, n: p.n, hemi: lat < 0 ? 'S' : 'N' };
  }

  // fromUTM(zone, hemi, e, n) or fromUTM({ zone, hemi, e, n }).
  function fromUTM(zone, hemi, e, nn) {
    if (zone && typeof zone === 'object') ({ zone, hemi, e, n: nn } = zone);
    const xi = (nn - (String(hemi).toUpperCase() === 'S' ? 10000000 : 0)) / (K0 * AA), eta = (e - 500000) / (K0 * AA);
    let xiP = xi, etaP = eta;
    BETA.forEach((b, i) => { const j = 2 * (i + 1); xiP -= b * Math.sin(j * xi) * Math.cosh(j * eta); etaP -= b * Math.cos(j * xi) * Math.sinh(j * eta); });
    const tauP = Math.sin(xiP) / Math.sqrt(Math.sinh(etaP) ** 2 + Math.cos(xiP) ** 2);
    let tau = tauP, d;
    let guard = 0;
    do {
      const sigma = Math.sinh(E_ * Math.atanh(E_ * tau / Math.sqrt(1 + tau * tau)));
      const tauI = tau * Math.sqrt(1 + sigma * sigma) - sigma * Math.sqrt(1 + tau * tau);
      d = (tauP - tauI) / Math.sqrt(1 + tauI * tauI) * (1 + (1 - E_ * E_) * tau * tau) / ((1 - E_ * E_) * Math.sqrt(1 + tau * tau));
      tau += d;
    } while (Math.abs(d) > 1e-12 && ++guard < 20);
    return { lat: Math.atan(tau) * R2D, lon: normLon(Math.atan2(Math.sinh(etaP), Math.cos(xiP)) * R2D + zone * 6 - 183) };
  }

  /* ---------- MGRS ---------- */
  const COLS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
  const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

  function toMGRS(lat, lon, digits = 5) {
    const u = toUTM(lat, lon);
    if (!u) return null;
    digits = Math.max(0, Math.min(5, Math.round(digits)));
    const col = COLS[(u.zone - 1) % 3][Math.floor(u.e / 100000) - 1];
    const row = ROWS[(Math.floor(u.n / 100000) + (u.zone % 2 ? 0 : 5)) % 20];
    const div = 10 ** (5 - digits);
    // MGRS truncates (the reference is the square's south-west corner); the epsilon guards x.99999 float noise.
    const part = (v) => String(Math.floor(((v % 100000) + 1e-6) / div)).padStart(digits, '0');
    const sq = `${String(u.zone).padStart(2, '0')}${u.band} ${col}${row}`;
    return digits ? `${sq} ${part(u.e)} ${part(u.n)}` : sq;
  }

  const MGRS_RE = /^\s*(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])([A-HJ-NP-V])\s*(?:(\d{1,5})\s+(\d{1,5})|(\d{0,10}))\s*$/i;

  // Returns the centre of the square the reference denotes (so '31U FU' gives the middle of that 100 km square).
  function fromMGRS(text) {
    const m = MGRS_RE.exec(String(text || ''));
    if (!m) return null;
    const zone = +m[1], band = m[2].toUpperCase(), colL = m[3].toUpperCase(), rowL = m[4].toUpperCase();
    let es, ns;
    if (m[5] != null) { es = m[5]; ns = m[6]; if (es.length !== ns.length) return null; }
    else { const d = m[7]; if (d.length % 2) return null; es = d.slice(0, d.length / 2); ns = d.slice(d.length / 2); }
    if (zone < 1 || zone > 60) return null;
    const ci = COLS[(zone - 1) % 3].indexOf(colL);
    let ri = ROWS.indexOf(rowL);
    if (ci < 0 || ri < 0) return null;
    ri = (ri - (zone % 2 ? 0 : 5) + 20) % 20;
    const digits = es.length, unit = 10 ** (5 - digits), half = digits ? unit / 2 : 50000;
    const e = (ci + 1) * 100000 + (digits ? +es * unit : 0) + half;
    const n100 = ri * 100000 + (digits ? +ns * unit : 0) + half;
    // The row letters repeat every 2000 km: take the first repeat at or above the band's southern edge
    // (lowest on the central meridian; 500 km slack covers truncation and the 8-degree band height).
    const latBand = BANDS.indexOf(band) * 8 - 80;
    const nBand = project(latBand, zone * 6 - 183, zone).n;
    let nn = n100;
    while (nn < nBand - 500000) nn += 2000000;
    const p = fromUTM(zone, band >= 'N' ? 'N' : 'S', e, nn);
    // A letter pair that cannot lie in this band (e.g. typo) lands far outside it.
    if (p.lat < latBand - 1 || p.lat > latBand + (band === 'X' ? 12 : 8) + 1) return null;
    return p;
  }

  /* ---------- Formatting ---------- */
  const pad = (v, w) => String(v).padStart(w, '0');
  // Splits an absolute value into whole degrees and a rounded remainder, carrying 60 -> next unit.
  function split(abs, parts, dec) {
    const scale = 10 ** dec, units = parts === 2 ? 60 : 3600;
    let t = Math.round(abs * units * scale);
    const deg = Math.floor(t / (units * scale)); t -= deg * units * scale;
    if (parts === 2) return [deg, t / scale];
    const min = Math.floor(t / (60 * scale)); t -= min * 60 * scale;
    return [deg, min, t / scale];
  }

  // fmt(lat, lon, style, { copy }): display uses the Dutch decimal comma; copy:true gives dots.
  function fmt(lat, lon, style = 'dd', opts = {}) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
    const dc = (s) => (opts.copy ? s : s.replace('.', ','));
    const ns = lat < 0 ? 'S' : 'N', ew = lon < 0 ? 'W' : 'E';
    const la = Math.abs(lat), lo = Math.abs(lon);
    switch (style) {
      case 'dms': {
        const f = (v, w) => { const [d, m, s] = split(v, 3, 1); return `${pad(d, w)}°${pad(m, 2)}'${dc(s.toFixed(1).padStart(4, '0'))}"`; };
        return `${f(la, 2)}${ns} ${f(lo, 3)}${ew}`;
      }
      case 'ddm': {
        const f = (v, w) => { const [d, m] = split(v, 2, 3); return `${pad(d, w)}°${dc(m.toFixed(3).padStart(6, '0'))}'`; };
        return `${ns}${f(la, 2)} ${ew}${f(lo, 3)}`;
      }
      case 'avi': {
        // Aviation notation keeps the dot, as on charts and in flight plans.
        const f = (v, w) => { const [d, m] = split(v, 2, 2); return `${pad(d, w)} ${m.toFixed(2).padStart(5, '0')}`; };
        return `${ns}${f(la, 2)} ${ew}${f(lo, 3)}`;
      }
      case 'rd': {
        const r = toRD(lat, lon);
        return inRD(r.x, r.y) ? `RD ${Math.round(r.x)} ${Math.round(r.y)}` : null;
      }
      case 'mgrs': return toMGRS(lat, lon, opts.digits == null ? 5 : opts.digits);
      case 'utm': {
        const u = toUTM(lat, lon);
        return u ? `${u.zone}${u.band} ${Math.round(u.e)} ${Math.round(u.n)}` : null;
      }
      default: return `${dc(la.toFixed(5))}°${ns} ${dc(lo.toFixed(5))}°${ew}`;
    }
  }

  /* ---------- Parsing ---------- */
  const NUM = /^[+-]?\d+(?:[.,]\d+)?$/;
  const num = (s) => parseFloat(s.replace(',', '.'));
  const okLL = (lat, lon) => Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const HEMI = { N: 'N', S: 'S', Z: 'S', E: 'E', O: 'E', W: 'W' }; // O/Z: Dutch oost/zuid

  // One component from its numbers. A single number may be packed: DDMM(.m) / DDMMSS(.s), DDDMM / DDDMMSS.
  function component(nums, isLon) {
    let parts = nums.map((t) => t.v);
    let kind = ['dd', 'ddm', 'dms'][parts.length - 1];
    if (parts.length === 1) {
      const intLen = nums[0].raw.replace(/^[+-]/, '').split(/[.,]/)[0].length, w = isLon ? 3 : 2;
      const s = nums[0].raw.replace(/^[+-]/, '').replace(',', '.');
      if (intLen === w + 2 || intLen === 4) { const dl = intLen - 2; parts = [+s.slice(0, dl), +s.slice(dl)]; kind = 'ddm'; }
      else if (intLen === w + 4 || intLen === 6) { const dl = intLen - 4; parts = [+s.slice(0, dl), +s.slice(dl, dl + 2), +s.slice(dl + 2)]; kind = 'dms'; }
      else if (intLen > w) return null;
    }
    if (parts.length > 3) return null;
    for (let i = 1; i < parts.length; i++) if (parts[i] >= 60) return null;
    for (let i = 0; i < parts.length - 1; i++) if (!Number.isInteger(parts[i])) return null;
    const v = parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600;
    return { v, kind };
  }

  function tokens(s) {
    const out = [];
    const re = /([+-]?\d+(?:[.,]\d+)?)\s*([°'"])?|([NSEWOZ])|([,;/])|(\s+)|(.)/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[1]) out.push({ t: 'num', raw: m[1], v: num(m[1].replace(/^[+-]/, '')), neg: m[1][0] === '-', sym: m[2] || '' });
      else if (m[3]) out.push({ t: 'hemi', v: HEMI[m[3]] });
      else if (m[6]) return null;
    }
    return out;
  }

  // Groups like N52 18.5 / 52 18 31 N: a letter before or after its numbers.
  function parseHemi(toks) {
    const groups = [];
    let cur = { hemi: null, nums: [] };
    for (const t of toks) {
      if (t.t === 'num') { if (t.neg) return null; cur.nums.push(t); continue; }
      if (cur.nums.length && !cur.hemi) { cur.hemi = t.v; groups.push(cur); cur = { hemi: null, nums: [] }; }
      else if (!cur.nums.length && !cur.hemi) cur.hemi = t.v;
      else if (cur.hemi && cur.nums.length) { groups.push(cur); cur = { hemi: t.v, nums: [] }; }
      else return null;
    }
    if (cur.hemi && cur.nums.length) groups.push(cur);
    else if (cur.hemi || cur.nums.length) return null;
    if (groups.length !== 2) return null;
    const latG = groups.find((g) => g.hemi === 'N' || g.hemi === 'S'), lonG = groups.find((g) => g.hemi === 'E' || g.hemi === 'W');
    if (!latG || !lonG) return null;
    const a = component(latG.nums, false), b = component(lonG.nums, true);
    if (!a || !b) return null;
    const lat = a.v * (latG.hemi === 'S' ? -1 : 1), lon = b.v * (lonG.hemi === 'W' ? -1 : 1);
    return okLL(lat, lon) ? { lat, lon, format: a.kind === b.kind ? a.kind : 'dms' } : null;
  }

  // 52°18'31" 4°45'50" (no letters): a number with a degree sign starts each half; '-' for S/W.
  function parseSymbols(toks) {
    const groups = [];
    for (const t of toks) {
      if (t.t !== 'num') return null;
      if (t.sym === '°') groups.push({ neg: t.neg, nums: [t] });
      else if (!groups.length || t.neg) return null;
      else groups[groups.length - 1].nums.push(t);
    }
    if (groups.length !== 2) return null;
    const a = component(groups[0].nums, false), b = component(groups[1].nums, true);
    if (!a || !b) return null;
    const lat = a.v * (groups[0].neg ? -1 : 1), lon = b.v * (groups[1].neg ? -1 : 1);
    return okLL(lat, lon) ? { lat, lon, format: a.kind === b.kind ? a.kind : 'dms' } : null;
  }

  // Two plain numbers, with a dot or a Dutch comma as decimal sign.
  function plainPair(s) {
    const t = s.replace(/°/g, ' ').trim();
    const tries = [];
    if (/[;/\t]/.test(t)) tries.push(t.split(/\s*[;/\t]\s*/));
    tries.push(t.split(/\s*,\s+/), t.split(/\s+/));
    if (!/\s/.test(t)) {
      const c = t.split(',');
      if (c.length === 2 && /\./.test(t)) tries.push(c);
      if (c.length === 4) tries.push([`${c[0]}.${c[1]}`, `${c[2]}.${c[3]}`]);
    }
    for (const p of tries) if (p.length === 2 && NUM.test(p[0]) && NUM.test(p[1])) return [p[0], p[1]];
    return null;
  }

  function parse(text) {
    if (typeof text !== 'string') return null;
    const s = text.trim().toUpperCase().replace(/[′’‘`´]/g, "'").replace(/[″”“]|''/g, '"').replace(/º|˚/g, '°').replace(/[−–]/g, '-');
    if (!s || s.length > 80) return null;

    if (MGRS_RE.test(s)) { const p = fromMGRS(s); return p ? { ...p, format: 'mgrs' } : null; }

    const rd = /^RD\s*:?\s*(\d+(?:[.,]\d+)?)\s*[,;/\s]\s*(\d+(?:[.,]\d+)?)\s*(?:M)?$/.exec(s);
    if (rd) {
      // 'RD 121.234 487.567' (km, or metres with a thousands dot) means the same metres either way.
      let x = num(rd[1]), y = num(rd[2]);
      if (x < 1000 && y < 1000) { x *= 1000; y *= 1000; }
      if (x < -50000 || x > 350000 || y < 250000 || y > 700000) return null;
      return { ...fromRD(x, y), format: 'rd' };
    }

    const toks = tokens(s);
    if (!toks) return null;
    if (toks.some((t) => t.t === 'hemi')) return parseHemi(toks);
    if (toks.some((t) => t.sym)) return parseSymbols(toks);

    const pair = plainPair(s);
    if (!pair) return null;
    const [a, b] = pair.map(num);
    if (pair.some((p) => /[.,]/.test(p)) && okLL(a, b)) return { lat: a, lon: b, format: 'dd' };
    // Two bare numbers in the RD ranges (leading zeros suggest a packed lat/lon, not RD).
    if (pair.some((p) => /^0\d/.test(p) || p[0] === '-')) return null;
    const isX = (v) => v >= 0 && v <= 300000, isY = (v) => v >= 289000 && v <= 629000;
    if (isX(a) && isY(b)) return { ...fromRD(a, b), format: 'rd' };
    if (isY(a) && isX(b)) return { ...fromRD(b, a), format: 'rd' };
    return null;
  }

  return { toRD, fromRD, toUTM, fromUTM, toMGRS, fromMGRS, fmt, parse };
});
