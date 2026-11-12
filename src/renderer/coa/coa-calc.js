'use strict';

/* ============================================================
   COA Planner: de rekenkern
   Schijnbare wind over het dek per Course of Approach, de wind ten opzichte van de boeg (rood/groen),
   wat de helikopter op de Assault Track voelt, de zee ten opzichte van het schip, gegist bestek naar
   H-uur, ware en magnetische graden, zon/maan als verblindingsgevaar en de hoogte-deconflictie.
   Zonder DOM, zodat het in Node te toetsen is (`node --test`).
   ============================================================ */
// Every direction in here is a true direction (°T) unless the name says otherwise. A wind direction is
// the direction the wind comes FROM, as in a METAR. A relative bearing is measured from the bow:
// positive to starboard (green), negative to port (red).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.COA_CALC = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const RAD = Math.PI / 180;
  const norm = (d) => ((d % 360) + 360) % 360;
  // -180 < x <= 180
  const signed = (d) => { const n = norm(d); return n > 180 ? n - 360 : n; };
  const num = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : +v);
  // "045": a direction as three digits, rounded (360 becomes 000).
  const deg3 = (d) => (d == null || !Number.isFinite(d) ? '---' : String(Math.round(norm(d)) % 360).padStart(3, '0'));

  /* ---------- wind over the deck ---------- */
  // The apparent wind on a ship sailing courseT at speedKt, in a true wind from windFromT at windKt.
  // Same vector sum as the original COA Planner (bereken_relatieve_wind), without its truncation.
  function apparent(courseT, speedKt, windFromT, windKt) {
    const bs = Math.max(0, +speedKt || 0), ws = Math.max(0, +windKt || 0);
    // Velocity of the air relative to the ship = wind velocity (towards) minus ship velocity.
    const wx = -ws * Math.sin(windFromT * RAD), wy = -ws * Math.cos(windFromT * RAD);
    const sx = bs * Math.sin(courseT * RAD), sy = bs * Math.cos(courseT * RAD);
    const ax = wx - sx, ay = wy - sy;
    const spd = Math.hypot(ax, ay);
    // Coming from the opposite of where the air goes; undefined in a dead calm over the deck.
    const dir = spd < 1e-9 ? null : norm(Math.atan2(ax, ay) / RAD + 180);
    return { dir, spd };
  }

  // Bow, midships or stern: the zones of the tactical picture (0–45 bow, 45–139 mid, 139–180 stern).
  const SECTORS = [{ id: 'bow', name: 'BOW', to: 45 }, { id: 'mid', name: 'MID', to: 139 }, { id: 'stern', name: 'STERN', to: 180 }];
  // A relative bearing (from the bow, signed): side, rounded degrees, sector and the text "G030" (green
  // 030, starboard) or "R030" (red, port); dead ahead "000" and dead astern "180".
  function relative(fromT, headingT) {
    if (fromT == null || headingT == null) return null;
    const r = signed(fromT - headingT);
    const a = Math.round(Math.abs(r));
    const side = a === 0 || a === 180 ? '' : r > 0 ? 'G' : 'R';
    const sector = SECTORS.find((s) => a <= s.to && !(s.id === 'mid' && a === 139)) || SECTORS[2];
    return { rel: r, abs: a, side, sector: sector.id, sectorName: sector.name, text: `${side}${String(a).padStart(3, '0')}` };
  }

  // What the helicopter feels on the assault track (heading trackT) in a wind from fromT at spd: the
  // headwind (negative: tailwind) and the crosswind, positive from the right.
  function components(fromT, spd, trackT) {
    if (fromT == null || !spd) return { head: 0, cross: 0, side: '' };
    const a = signed(fromT - trackT) * RAD;
    const head = spd * Math.cos(a), cross = spd * Math.sin(a);
    return { head, cross, side: Math.abs(cross) < 0.5 ? '' : cross > 0 ? 'R' : 'L' };
  }

  /* ---------- the four COAs ---------- */
  // COA n has the ship on AT + (n-1)·90. A boat reference course within `tol` degrees of that course is
  // what the ship really sails there, so that COA uses the BRC exactly. Ties at exactly 45° go to the
  // first COA, as in the original.
  function coas(atT, brcT, tol = 45) {
    const out = [];
    let taken = false;
    for (let i = 0; i < 4; i += 1) {
      const nominal = norm(atT + i * 90);
      const uses = brcT != null && !taken && Math.abs(signed(nominal - brcT)) <= tol;
      if (uses) taken = true;
      out.push({ n: i + 1, nominal, heading: uses ? norm(brcT) : nominal, brc: uses });
    }
    return out;
  }

  // Everything one COA card shows: the apparent wind (also with the gust), relative to the bow, what the
  // helicopter on the AT feels, where the helicopter comes from as seen from the ship, and the sea.
  function coaPicture(c, p) {
    const app = apparent(c.heading, p.bs, p.wd, p.ws);
    const gust = p.gust != null && p.gust > p.ws ? apparent(c.heading, p.bs, p.wd, p.gust) : null;
    const rel = relative(app.dir, c.heading);
    const helo = components(app.dir, app.spd, p.at);
    const heloGust = gust ? components(gust.dir, gust.spd, p.at) : null;
    // The helicopter flies the AT towards the ship: seen from the ship it comes from the reciprocal.
    const approach = relative(norm(p.at + 180), c.heading);
    const sea = p.waveDir != null ? seaRelative(p.waveDir, c.heading) : null;
    return { ...c, app, gust, rel, helo, heloGust, approach, sea };
  }

  /* ---------- the sea relative to the ship ---------- */
  // Waves from waveFromT on a ship heading headingT, in the seamanship terms: a head sea makes her pitch,
  // seas on the bow pitch and roll, a beam sea rolls, a quartering sea rolls and yaws, and a following sea
  // yaws and surges.
  function seaRelative(waveFromT, headingT) {
    const a = Math.abs(signed(waveFromT - headingT));
    if (a <= 30) return { id: 'head', name: 'Head sea', motion: 'pitching', abs: a };
    if (a <= 60) return { id: 'bow', name: 'Sea on the bow', motion: 'pitching and rolling', abs: a };
    if (a <= 120) return { id: 'beam', name: 'Beam sea', motion: 'rolling', abs: a };
    if (a <= 150) return { id: 'quarter', name: 'Quartering sea', motion: 'rolling and yawing', abs: a };
    return { id: 'following', name: 'Following sea', motion: 'yawing and surging', abs: a };
  }
  // The WMO/Douglas sea state code with its official English terms, by significant wave height (m).
  const DOUGLAS = [
    { code: 0, max: 0.05, name: 'Calm (glassy)' }, { code: 1, max: 0.1, name: 'Calm (rippled)' }, { code: 2, max: 0.5, name: 'Smooth' },
    { code: 3, max: 1.25, name: 'Slight' }, { code: 4, max: 2.5, name: 'Moderate' }, { code: 5, max: 4, name: 'Rough' },
    { code: 6, max: 6, name: 'Very rough' }, { code: 7, max: 9, name: 'High' }, { code: 8, max: 14, name: 'Very high' },
    { code: 9, max: Infinity, name: 'Phenomenal' },
  ];
  const douglas = (hs) => (!Number.isFinite(hs) || hs < 0 ? null : DOUGLAS.find((d) => hs < d.max) || DOUGLAS[9]);

  /* ---------- position ---------- */
  // Dead reckoning on a sphere: where a ship at lat/lon on courseT at speedKt is after `hours`.
  function deadReckon(lat, lon, courseT, speedKt, hours) {
    const nm = (+speedKt || 0) * hours;
    const d = (nm * 1852) / 6371008.8, b = courseT * RAD, p1 = lat * RAD, l1 = lon * RAD;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
    const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / RAD, lon: (((l2 / RAD) + 540) % 360) - 180, nm: Math.abs(nm) };
  }
  // The position the picture is worked out for: the fix, or (dead reckoning on, a course and a speed
  // known, within a day) the fix carried forward or back to the H-hour.
  function positionAt(p) {
    if (p.lat == null || p.lon == null) return null;
    const fix = { lat: p.lat, lon: p.lon, dr: false, nm: 0 };
    if (!p.dr || p.brc == null || !(p.bs > 0) || p.posAt == null || p.hhour == null) return fix;
    const hours = (p.hhour - p.posAt) / 3600000;
    if (Math.abs(hours) > 24 || Math.abs(hours) < 1 / 120) return fix;
    const q = deadReckon(p.lat, p.lon, p.brc, p.bs, hours);
    return { lat: q.lat, lon: q.lon, dr: true, nm: q.nm, hours };
  }

  /* ---------- true and magnetic ---------- */
  // Declination east positive: magnetic = true - declination.
  const toMag = (t, decl) => (t == null ? null : norm(t - (decl || 0)));
  const toTrue = (m, decl) => (m == null ? null : norm(m + (decl || 0)));

  /* ---------- sun and moon ---------- */
  // A body low ahead on the approach blinds the crew: within `half` degrees of the track and between
  // just below the horizon and `maxAlt` high.
  function glare(az, alt, trackT, { half = 30, maxAlt = 30, minAlt = -1 } = {}) {
    if (az == null || alt == null) return null;
    const off = Math.abs(signed(az - trackT));
    return { on: off <= half && alt >= minAlt && alt <= maxAlt, off, alt };
  }
  // The shadow the sun (or moon) throws: the direction it falls in and how long it is for a height of 1.
  function shadow(az, alt) {
    if (az == null || alt == null || alt <= 0.5) return null;
    return { dir: norm(az + 180), len: Math.min(8, 1 / Math.tan(alt * RAD)) };
  }
  // Light at the moment: day, twilight (civil, nautical, astronomical) or night, from the sun's height.
  function lightPhase(sunAlt) {
    if (sunAlt == null) return null;
    if (sunAlt > -0.833) return { id: 'day', name: 'Day' };
    if (sunAlt > -6) return { id: 'civil', name: 'Civil twilight' };
    if (sunAlt > -12) return { id: 'nautical', name: 'Nautical twilight' };
    if (sunAlt > -18) return { id: 'astro', name: 'Astronomical twilight' };
    return { id: 'night', name: 'Night' };
  }

  /* ---------- height deconfliction ---------- */
  const parseFt = (v) => {
    const s = String(v == null ? '' : v).trim().toUpperCase().replace(/\s+/g, '');
    if (!s) return null;
    let m = /^FL(\d{2,3})$/.exec(s);
    if (m) return +m[1] * 100;
    m = /^(\d{1,5})(FT|')?$/.exec(s.replace(/[.,](?=\d{3}(?!\d))/g, ''));
    return m ? +m[1] : null;
  };
  // Pairs of rows closer together than `sep` feet, closest first.
  function heightConflicts(rows, sep = 500) {
    const list = (rows || []).map((r, i) => ({ i, name: String((r && (r.cs || r.type)) || `Rij ${i + 1}`).trim() || `Rij ${i + 1}`, ft: parseFt(r && r.alt) })).filter((r) => r.ft != null);
    const out = [];
    for (let a = 0; a < list.length; a += 1) for (let b = a + 1; b < list.length; b += 1) {
      const d = Math.abs(list[a].ft - list[b].ft);
      if (d < sep) out.push({ a: list[a], b: list[b], diff: d });
    }
    return out.sort((x, y) => x.diff - y.diff);
  }

  return { norm, signed, num, deg3, apparent, relative, components, coas, coaPicture, seaRelative, SECTORS, DOUGLAS, douglas, deadReckon, positionAt, toMag, toTrue, glare, shadow, lightPhase, parseFt, heightConflicts };
});
