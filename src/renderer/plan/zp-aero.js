'use strict';

/* ============================================================
   Zoek & Plan — luchtvaartgegevens van openAIP: luchtruim per soort, vliegvelden en heliports,
   ziekenhuis- en offshore-helidekken, meldpunten, bakens en obstakels. Alles los aan en uit.
   ============================================================ */
// Vector data, so a click lands exactly where it is on the map at every zoom level. Europe comes per
// country (NL first, the neighbours after it in the background); elsewhere per area when looked at.
const ZP_AERO_COUNTRIES = ['NL', 'BE', 'DE', 'LU', 'GB', 'DK', 'FR'];
const ZP_AIRSPACE_GROUPS = [
  { name: 'Gecontroleerd', types: ['CTR', 'MCTR', 'TMA', 'CTA', 'ATZ', 'MATZ', 'HTZ', 'TIZ', 'TIA'] },
  { name: 'Zones', types: ['TMZ', 'RMZ', 'TRP'] },
  { name: 'Speciaal gebruik', types: ['P', 'R', 'D', 'TRA', 'TSA', 'ADIZ', 'ALERT', 'WARNING', 'PROTECTED', 'LOW_OVERFLIGHT', 'MTA', 'MTR', 'MRT', 'TFR'] },
  { name: 'Sport en recreatie', types: ['GLIDING', 'SPORT', 'VFR_SECTOR'] },
  { name: 'Sectoren en grenzen', types: ['FIR', 'UIR', 'ACC', 'FIS', 'LTA', 'UTA', 'AWY', 'OTHER'] },
];
const ZP_AERO_DASH = { TMZ: [6, 4], RMZ: [2, 4], TRP: [6, 4], FIR: [10, 4, 2, 4], UIR: [10, 4, 2, 4], ACC: [10, 4], FIS: [10, 4], GLIDING: [4, 4], SPORT: [3, 3], AWY: [8, 3], LTA: [10, 4], UTA: [10, 4] };

function zpAero(ctx) {
  const { map, cfg } = ctx;
  const A = cfg.aero, PTS = cfg.points;
  let data = { airspaces: [], airports: [], navaids: [], reportingPoints: [], obstacles: [] };
  let status = { loading: true, error: null, configured: true };
  let layer = null;
  const areaSeen = new Set();
  ctx.aero = () => data;
  const TYPES = () => ctx.aeroTypes || {};

  async function loadCountries(list) {
    try {
      const res = await window.palv.plan.aero(list);
      if (res && res.ok !== false) { merge(res); status.error = (res.errors && res.errors.length) ? res.errors.map((e) => e.message || e).join('; ') : null; }
      else status.error = (res && res.error) || 'Luchtvaartgegevens niet beschikbaar';
    } catch (err) { status.error = String(err.message || err); }
    status.loading = false;
    try { const st = await window.palv.plan.aeroStatus(); status.configured = !!(st && st.configured); } catch { /* keep */ }
    draw();
    ctx.emit('aero');
  }
  function merge(res) {
    for (const k of Object.keys(data)) {
      if (!Array.isArray(res[k])) continue;
      const seen = new Map(data[k].map((x) => [x.id, x]));
      for (const x of res[k]) seen.set(x.id, x);
      data[k] = [...seen.values()];
    }
    if (res.types) ctx.aeroTypes = res.types;
    if (res.obstacleTypes) ctx.aeroObstacleTypes = res.obstacleTypes;
  }
  // Outside the countries kept: the area in view, when the map rests there for a while.
  let areaTimer = null;
  map.on('moveend', () => {
    clearTimeout(areaTimer);
    if (!A.on || map.getZoom() < 7) return;
    areaTimer = setTimeout(async () => {
      const c = map.getCenter();
      const tile = `${Math.floor(c.lat / 5)}|${Math.floor(c.lng / 5)}`;
      if (areaSeen.has(tile) || (c.lat > 47 && c.lat < 56 && c.lng > -6 && c.lng < 15)) return;
      areaSeen.add(tile);
      const b = map.getBounds();
      try { const res = await window.palv.plan.aeroArea([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]); if (res && res.ok !== false) { merge(res); draw(); } } catch { /* stays empty there */ }
    }, 4000);
  });

  /* ---------- airspace ---------- */
  const typeInfo = (t) => (TYPES()[t] || { name: t, color: '#8a8f98' });
  const shown = (a) => A.on && A.types.includes(a.type) && (a.lower ? (a.lower.ft || 0) : 0) <= (A.maxFloorFt ?? 99999);
  function draw() {
    if (layer) { layer.remove(); layer = null; }
    if (A.on) {
      const feats = data.airspaces.filter(shown).sort((a, b) => (b.lower ? b.lower.ft : 0) - (a.lower ? a.lower.ft : 0));
      layer = L.geoJSON({ type: 'FeatureCollection', features: feats.map((a) => ({ type: 'Feature', geometry: a.geometry, properties: { id: a.id } })) }, {
        renderer: ctx.vector,
        style: (f) => {
          const a = data.airspaces.find((x) => x.id === f.properties.id);
          const t = typeInfo(a.type);
          const strong = ['CTR', 'MCTR', 'P', 'R', 'D'].includes(a.type);
          return { color: t.color, weight: strong ? 2.2 : 1.6, opacity: 0.95, dashArray: ZP_AERO_DASH[a.type] ? ZP_AERO_DASH[a.type].join(' ') : null, fillColor: t.color, fillOpacity: A.fill ? (strong ? 0.12 : 0.06) : 0, interactive: false };
        },
      }).addTo(map);
    }
    ctx.cv.request();
  }

  // All airspace over a point, low to high: what a click shows.
  const at = (lat, lon) => data.airspaces.filter((a) => a.bbox && lat >= a.bbox[0] && lat <= a.bbox[2] && lon >= a.bbox[1] && lon <= a.bbox[3] && PlanGeo.inGeometry(a.geometry, lat, lon))
    .sort((a, b) => (a.lower ? a.lower.ft : 0) - (b.lower ? b.lower.ft : 0));
  ctx.airspaceAt = at;

  /* ---------- labels and points on the canvas ---------- */
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  ctx.cv.add(25, (c) => {
    if (!A.on || !A.labels || c.zoom < 8) return;
    const { g } = c;
    const font = `700 ${(0.6 * rem()).toFixed(1)}px ${getComputedStyle(document.body).fontFamily}`;
    const b = c.bounds;
    const placed = [];
    for (const a of data.airspaces) {
      if (!shown(a) || !a.bbox || ['FIR', 'UIR', 'ACC', 'FIS', 'AWY'].includes(a.type)) continue;
      if (a.bbox[2] < b.getSouth() || a.bbox[0] > b.getNorth() || a.bbox[3] < b.getWest() || a.bbox[1] > b.getEast()) continue;
      // The label sits where the polygon is in view: the middle of its box, clamped to the screen.
      const p0 = c.P(a.bbox[2], a.bbox[1]), p1 = c.P(a.bbox[0], a.bbox[3]);
      const wpx = p1[0] - p0[0];
      if (wpx < 70 && c.zoom < 10) continue;
      let x = Math.min(Math.max((p0[0] + p1[0]) / 2, 60), c.w - 60), y = Math.min(Math.max((p0[1] + p1[1]) / 2, 30), c.h - 30);
      const ll = map.containerPointToLatLng([x, y]);
      if (!PlanGeo.inGeometry(a.geometry, ll.lat, ll.lng)) continue;
      if (placed.some((q) => Math.abs(q[0] - x) < 90 && Math.abs(q[1] - y) < 26)) continue;
      placed.push([x, y]);
      const t = typeInfo(a.type);
      const lim = `${a.lower ? a.lower.text : 'GND'} – ${a.upper ? a.upper.text : '?'}`;
      zpText(g, `${a.name}${a.icaoClass && a.icaoClass.length === 1 ? ' (' + a.icaoClass + ')' : ''}`, x, y - 6, { font, color: t.color === '#8a8f98' ? '#d0d6de' : '#ffffff', align: 'center' });
      zpText(g, lim, x, y + 7, { font: `600 ${(0.56 * rem()).toFixed(1)}px sans-serif`, color: '#c6d4e8', align: 'center' });
    }
  });

  const isHeli = (a) => /^heliport/.test(a.type || '');
  const showAirport = (a) => (a.type === 'heliport-hospital' ? PTS.hospitals : a.type === 'heliport-offshore' ? false : isHeli(a) ? PTS.heliports : a.type !== 'closed' && PTS.airports);
  ctx.cv.add(35, (c) => {
    const { g } = c;
    const z = c.zoom;
    const font = `700 ${(0.6 * rem()).toFixed(1)}px ${getComputedStyle(document.body).fontFamily}`;
    const inv = (lat, lon, m) => { const p = c.P(lat, lon); return c.inView(p, m) ? p : null; };
    // Obstacles first (lowest), then reporting points and navaids, airfields on top.
    if (PTS.obstacles && z >= 9) {
      for (const o of data.obstacles) {
        if (o.type === 'wind-turbine' && !PTS.turbines) continue;
        if ((o.heightFtAgl || 0) < (PTS.obstacleMinFt || 0) && o.heightFtAgl != null) continue;
        const p = inv(o.lat, o.lon, 10); if (!p) continue;
        zpObstacle(g, p[0], p[1], o.lighted, o.type === 'wind-turbine');
        if (z >= 11 && o.heightFtAgl) zpText(g, String(o.heightFtAgl), p[0] + 7, p[1] + 2, { font: `600 ${(0.55 * rem()).toFixed(1)}px sans-serif`, color: '#ffcf8a' });
        c.hit({ x: p[0], y: p[1], r: 7, kind: 'obstacle', item: o, z: 1 });
      }
    }
    if (PTS.vrp && z >= 8) {
      for (const r of data.reportingPoints) {
        const p = inv(r.lat, r.lon, 20); if (!p) continue;
        g.beginPath(); g.moveTo(p[0], p[1] - 6); g.lineTo(p[0] + 5.5, p[1] + 4); g.lineTo(p[0] - 5.5, p[1] + 4); g.closePath();
        g.fillStyle = r.compulsory ? '#e6f0ff' : 'rgba(0,0,0,0)'; g.fill(); g.lineWidth = 1.6; g.strokeStyle = '#2f6fd6'; g.stroke();
        if (z >= 9) zpText(g, r.name, p[0] + 8, p[1], { font, color: '#a8c8ff' });
        c.hit({ x: p[0], y: p[1], r: 8, kind: 'vrp', item: r, z: 2 });
      }
    }
    if (PTS.navaids && z >= 6) {
      for (const n of data.navaids) {
        const p = inv(n.lat, n.lon, 20); if (!p) continue;
        zpNavaid(g, p[0], p[1], n.type);
        if (z >= 8) zpText(g, `${n.ident} ${n.freq ? n.freq.replace(' MHz', '').replace(' kHz', '') : ''}`, p[0] + 10, p[1] - 8, { font, color: '#7fe3d4' });
        c.hit({ x: p[0], y: p[1], r: 9, kind: 'navaid', item: n, z: 3 });
      }
    }
    for (const a of data.airports) {
      if (!showAirport(a)) continue;
      // Big fields from far away, small strips only close by, so the map stays readable.
      const big = a.type === 'international' || a.type === 'airport-ifr', mid = a.type === 'airport' || a.type === 'military' || a.type === 'heliport-hospital';
      if (z < (big ? 5 : mid ? 7.5 : isHeli(a) ? 9 : 9.5)) continue;
      const p = inv(a.lat, a.lon, 20); if (!p) continue;
      zpAirportSymbol(g, p[0], p[1], a);
      if (z >= (big ? 7 : isHeli(a) ? 10.5 : 9.5)) zpText(g, a.icao || a.name, p[0] + 10, p[1] + 9, { font, color: a.type === 'heliport-hospital' ? '#ff9a9a' : '#e9eff8' });
      c.hit({ x: p[0], y: p[1], r: 10, kind: 'airport', item: a, z: 4 });
    }
  });

  /* ---------- clicks: details ---------- */
  ctx.on('hit', ({ hit }) => {
    const it = hit.item;
    if (hit.kind === 'airport') {
      ctx.select({ lat: it.lat, lon: it.lon, label: it.icao ? `${it.icao} ${it.name}` : it.name, kind: 'airport', item: it });
      ctx.showCard(zpAirportCard(ctx, it));
    } else if (hit.kind === 'navaid') {
      ctx.select({ lat: it.lat, lon: it.lon, label: it.ident, kind: 'navaid', item: it });
      ctx.showCard({ title: `${it.ident} · ${it.name}`, sub: `${it.type} · openAIP`, color: '#7fe3d4', point: it, rows: [['Frequentie', it.freq || '—'], ['Kanaal', it.channel || '—'], ['Bereik', it.rangeNm ? `${it.rangeNm} NM` : '—'], ['Hoogte', it.elevFt != null ? ctx.fmt.alt(it.elevFt) : '—'], ['Mag. variatie', it.magVar != null ? `${it.magVar}°` : '—']] });
    } else if (hit.kind === 'vrp') {
      ctx.select({ lat: it.lat, lon: it.lon, label: it.name, kind: 'vrp', item: it });
      ctx.showCard({ title: it.name, sub: `${it.compulsory ? 'Verplicht' : 'Op verzoek'} meldpunt (VRP)${it.airports && it.airports.length ? ' · ' + it.airports.join(', ') : ''}`, color: '#a8c8ff', point: it, rows: [] });
    } else if (hit.kind === 'obstacle') {
      ctx.select({ lat: it.lat, lon: it.lon, label: it.name || 'Obstakel', kind: 'obstacle', item: it });
      ctx.showCard({ title: it.name || 'Obstakel', sub: `${(ctx.aeroObstacleTypes && ctx.aeroObstacleTypes[it.type] && ctx.aeroObstacleTypes[it.type].name) || it.type} · openAIP`, color: '#ffcf8a', point: it, rows: [['Hoogte boven grond', it.heightFtAgl != null ? ctx.fmt.alt(it.heightFtAgl) : 'onbekend'], ['Top (AMSL)', it.topFtAmsl != null ? ctx.fmt.alt(it.topFtAmsl) : '—'], ['Verlicht', it.lighted ? 'ja' : 'onbekend']] });
    }
  });

  // A plain click on the map (no symbol): the airspace over that point goes into the point card.
  ctx.airspaceRows = (lat, lon) => at(lat, lon).filter((a) => !['FIR', 'UIR', 'ACC', 'FIS'].includes(a.type) || true).map((a) => ({
    a, color: typeInfo(a.type).color,
    text: `${a.name}`, sub: `${typeInfo(a.type).name}${a.icaoClass && a.icaoClass.length === 1 ? ' · klasse ' + a.icaoClass : ''} · ${a.lower ? a.lower.text : 'GND'} – ${a.upper ? a.upper.text : '?'}${a.freqs && a.freqs.length ? ' · ' + a.freqs.map((f) => f.mhz).join(' / ') : ''}`,
  }));

  ctx.on('ready', () => { loadCountries(['NL']).then(() => loadCountries(ZP_AERO_COUNTRIES)); });
  return { draw, status: () => status, reload: () => loadCountries(ZP_AERO_COUNTRIES), at };
}

function zpAirportCard(ctx, a) {
  const kinds = { 'heliport-hospital': 'Ziekenhuishelihaven', 'heliport-offshore': 'Offshore helidek', heliport: 'Helihaven', 'heliport-military': 'Militaire helihaven', international: 'Internationale luchthaven', 'airport-ifr': 'Luchthaven (IFR)', airport: 'Luchthaven', military: 'Militair vliegveld', airfield: 'Vliegveld', glider: 'Zweefvliegveld', ultralight: 'Ultralicht vliegveld' };
  const rows = [
    ['Soort', kinds[a.type] || a.type],
    ['Hoogte', a.elevFt != null ? ctx.fmt.alt(a.elevFt) : '—'],
    a.ppr ? ['PPR', 'Ja, toestemming vooraf'] : null,
    a.private ? ['Status', 'Privé'] : null,
    ...(a.runways || []).filter((r, i, all) => all.findIndex((x) => x.des === r.des) === i).map((r) => [`Baan ${r.des}`, `${r.trueHdg != null ? PlanUnits.hdg(r.trueHdg) + 'T · ' : ''}${r.lengthM ? r.lengthM + ' × ' + (r.widthM || '?') + ' m' : ''} ${r.surface || ''}`.trim()]),
    ...(a.freqs || []).map((f) => [f.type || 'Freq.', `${f.mhz.toFixed(3).replace('.', ',')} · ${f.name || ''}`]),
  ].filter(Boolean);
  return { title: a.icao ? `${a.icao} · ${a.name}` : a.name, sub: `${kinds[a.type] || a.type} · openAIP`, color: a.type === 'heliport-hospital' ? '#ff6b6b' : '#e9eff8', point: a, rows, airport: a.icao, extra: [zpAipBtn(zpAipUrl({ icao: a.icao }))].filter(Boolean) };
}

/* ---------- symbols ---------- */
function zpAirportSymbol(g, x, y, a) {
  const heli = /^heliport/.test(a.type || '');
  g.lineWidth = 2;
  if (heli) {
    const r = 7.5;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    g.fillStyle = a.type === 'heliport-hospital' ? '#d62828' : '#1b2a44'; g.fill();
    g.strokeStyle = '#ffffff'; g.stroke();
    g.font = `800 ${r * 1.45}px sans-serif`; g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('H', x, y + 0.5);
    return;
  }
  const mil = a.type === 'military';
  const big = a.type === 'international' || a.type === 'airport-ifr' || a.type === 'airport';
  const r = big ? 7 : 5.5;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = mil ? '#7a1f1f' : a.type === 'glider' ? '#3f6f2a' : '#123c7a'; g.fill();
  g.strokeStyle = '#ffffff'; g.stroke();
  // The longest runway as a bar through the symbol.
  const rw = (a.runways || []).reduce((m, r2) => (!m || (r2.lengthM || 0) > (m.lengthM || 0) ? r2 : m), null);
  if (rw && rw.trueHdg != null) {
    const ang = PlanGeo.rad(rw.trueHdg), L1 = r + 4;
    g.lineWidth = 3; g.strokeStyle = '#ffffff';
    g.beginPath(); g.moveTo(x - Math.sin(ang) * L1, y + Math.cos(ang) * L1); g.lineTo(x + Math.sin(ang) * L1, y - Math.cos(ang) * L1); g.stroke();
  }
}
function zpNavaid(g, x, y, type) {
  g.lineWidth = 1.6; g.strokeStyle = '#2bbfa8'; g.fillStyle = 'rgba(43,191,168,0.18)';
  if (/VOR|TACAN/.test(type)) {
    g.beginPath();
    for (let i = 0; i < 6; i += 1) { const a = (i * Math.PI) / 3; g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * 7, y + Math.sin(a) * 7); }
    g.closePath(); g.fill(); g.stroke();
    if (/DME|TAC/.test(type)) g.strokeRect(x - 8.5, y - 7.5, 17, 15);
  } else if (/NDB/.test(type)) {
    for (const r of [3, 5.5, 8]) { g.beginPath(); g.setLineDash([1.5, 2]); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([]);
  } else { g.strokeRect(x - 6, y - 6, 12, 12); }
  g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fillStyle = '#2bbfa8'; g.fill();
}
function zpObstacle(g, x, y, lit, turbine) {
  g.lineWidth = 1.6; g.strokeStyle = turbine ? '#9fd3ff' : '#ffb347'; g.lineJoin = 'round';
  if (turbine) {
    g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x, y - 2); g.stroke();
    for (let i = 0; i < 3; i += 1) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3; g.beginPath(); g.moveTo(x, y - 2); g.lineTo(x + Math.cos(a) * 5, y - 2 + Math.sin(a) * 5); g.stroke(); }
    return;
  }
  g.beginPath(); g.moveTo(x - 4.5, y + 5); g.lineTo(x, y - 6); g.lineTo(x + 4.5, y + 5); g.stroke();
  g.beginPath(); g.arc(x, y + 2.5, 1.5, 0, Math.PI * 2); g.fillStyle = g.strokeStyle; g.fill();
  if (lit) { g.beginPath(); for (let i = 0; i < 4; i += 1) { const a = -Math.PI / 2 + ((i - 1.5) * Math.PI) / 6; g.moveTo(x + Math.cos(a) * 8, y - 6 + Math.sin(a) * 8); g.lineTo(x + Math.cos(a) * 11, y - 6 + Math.sin(a) * 11); } g.stroke(); }
}
