'use strict';

/* Baangebruik: the runways in use at the base the dashboard runs from (Instellingen › Basis). Schiphol:
   per flight from Casper (BAS flight tracker), live ADS-B as fallback; Volkel and Rotterdam: live ADS-B,
   with the runway into the wind from the METAR of the field. Runway geometry: src/bases.js. */
// Bundled OpenStreetMap tiles around Schiphol (assets/schiphol/<x>-<y>.png); the other fields draw their
// backdrop from the dashboard's own tile store (palvtile://osm), zoom 13 as well.
const SCHIPHOL_TILES = { z: 13, x0: 4200, y0: 2691, cols: 8, rows: 6 };
const rwyName = (id) => { const r = activeBase().runways.find((r) => r.a === id || r.b === id); return r ? r.name : ''; };

function runwayMap(landing, departure) {
  // Web Mercator on the pixel grid of the zoom-13 tiles, so the runways and the backdrop are one drawing
  // and stay locked together however the widget is sized.
  const B = activeBase(), RUNWAYS = B.runways;
  const CX = 60, CY = 50, K = B.mapK || 0.2, Z = 13, N = 256 * 2 ** Z, FADE_R = 84;
  const mx = (lon) => ((lon + 180) / 360) * N;
  const my = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };
  const centre = B.id === 'eham' ? [52.326, 4.757] : [B.field.lat, B.field.lon];
  const X0 = mx(centre[1]), Y0 = my(centre[0]);
  const proj = ([lat, lon]) => [CX + (mx(lon) - X0) * K, CY + (my(lat) - Y0) * K];
  let tiles = '';
  const tile = (x, y, href) => `<image href="${href}" x="${(CX + (x * 256 - X0) * K).toFixed(2)}" y="${(CY + (y * 256 - Y0) * K).toFixed(2)}" width="${(256 * K + 0.05).toFixed(2)}" height="${(256 * K + 0.05).toFixed(2)}" preserveAspectRatio="none"/>`;
  if (B.tiles === 'schiphol') {
    const T = SCHIPHOL_TILES;
    // A sliver of overlap keeps hairlines from showing between tiles at odd scales; the mask further down
    // lets the backdrop fade out before the tiles end.
    for (let i = 0; i < T.cols; i += 1) for (let j = 0; j < T.rows; j += 1) tiles += tile(T.x0 + i, T.y0 + j, `../../assets/schiphol/${T.x0 + i}-${T.y0 + j}.png`);
  } else {
    // The tiles under the whole fade (a circle of FADE_R around the centre, as wide as Schiphol's bundled
    // tiles reach), from the tile store: the backdrop then fades out softly instead of stopping at the frame.
    const tx0 = Math.floor((X0 + (CX - FADE_R - CX) / K) / 256), tx1 = Math.floor((X0 + (CX + FADE_R - CX) / K) / 256);
    const ty0 = Math.floor((Y0 + (CY - FADE_R - CY) / K) / 256), ty1 = Math.floor((Y0 + (CY + FADE_R - CY) / K) / 256);
    for (let x = tx0; x <= tx1; x += 1) for (let y = ty0; y <= ty1; y += 1) tiles += tile(x, y, `palvtile://osm/${Z}/${x}/${y}`);
  }
  const landIds = new Set(landing.map((r) => r.rwy));
  const depIds = new Set(departure.map((r) => r.rwy));
  let lines = '', arrows = '';
  const labels = [];
  const arrow = (from, to, cls) => {
    const ang = Math.atan2(to[1] - from[1], to[0] - from[0]);
    const hx = (a) => [to[0] - 5 * Math.cos(ang + a), to[1] - 5 * Math.sin(ang + a)];
    const [p1, p2] = [hx(0.5), hx(-0.5)];
    return `<g class="arrow ${cls}"><line x1="${from[0].toFixed(1)}" y1="${from[1].toFixed(1)}" x2="${(to[0] - 3 * Math.cos(ang)).toFixed(1)}" y2="${(to[1] - 3 * Math.sin(ang)).toFixed(1)}"/><polygon stroke="none" points="${to[0].toFixed(1)},${to[1].toFixed(1)} ${p1[0].toFixed(1)},${p1[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}"/></g>`;
  };
  for (const r of RUNWAYS) {
    const A = proj(r.pa), B = proj(r.pb);
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const d = [(B[0] - A[0]) / len, (B[1] - A[1]) / len]; // unit vector a -> b
    const ends = [
      { id: r.a, p: A, dir: d, far: B },
      { id: r.b, p: B, dir: [-d[0], -d[1]], far: A },
    ];
    let cls = '';
    for (const e of ends) {
      const isLand = landIds.has(e.id), isDep = depIds.has(e.id);
      if (!isLand && !isDep) continue;
      cls = cls || (isLand ? 'land' : 'dep');
      // Landing: approach arrow flying in towards the threshold. Departure: arrow leaving over the far end.
      if (isLand) arrows += arrow([e.p[0] - e.dir[0] * 15, e.p[1] - e.dir[1] * 15], [e.p[0] - e.dir[0] * 3, e.p[1] - e.dir[1] * 3], 'land');
      if (isDep) arrows += arrow([e.far[0] + e.dir[0] * 3, e.far[1] + e.dir[1] * 3], [e.far[0] + e.dir[0] * 15, e.far[1] + e.dir[1] * 15], 'dep');
    }
    for (const e of ends) {
      // Label beside the runway end, on the side facing away from the field centre.
      const active = landIds.has(e.id) || depIds.has(e.id);
      const off = active ? 8 : 5.5;
      let n = [-e.dir[1], e.dir[0]];
      if (n[0] * (e.p[0] - CX) + n[1] * (e.p[1] - CY) < 0) n = [-n[0], -n[1]];
      labels.push({ id: e.id, active, x: e.p[0] + n[0] * off + e.dir[0] * 4, y: e.p[1] + n[1] * off + e.dir[1] * 4 });
    }
    lines += `<line class="rw ${cls}" x1="${A[0].toFixed(1)}" y1="${A[1].toFixed(1)}" x2="${B[0].toFixed(1)}" y2="${B[1].toFixed(1)}"/>`;
  }
  // Runways in use always get their number; an idle number yields when it would sit under one.
  const texts = labels
    .filter((l) => l.active || !labels.some((o) => o.active && Math.hypot(o.x - l.x, o.y - l.y) < 10))
    .map((l) => `<text${l.active ? '' : ' class="idle"'} x="${l.x.toFixed(1)}" y="${l.y.toFixed(1)}">${l.id}</text>`)
    .join('');
  const svg = `<svg class="rwy-map" viewBox="16 -8 90 114" role="img" aria-label="Baangebruik op de kaart van ${B.airport}"><defs><radialGradient id="rwy-fade" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY}" r="${FADE_R}"><stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient><mask id="rwy-mask" maskUnits="userSpaceOnUse" x="-70" y="-40" width="250" height="190"><rect x="-70" y="-40" width="250" height="190" fill="url(#rwy-fade)"/></mask></defs><g class="osm" mask="url(#rwy-mask)">${tiles}</g>${lines}${arrows}${texts}</svg>`;
  return h('div', { style: 'display:contents', html: svg }).firstChild;
}

// The runway ends into the wind, from the METAR of the field in the header: what the tower will most
// likely use, next to what is actually observed.
function runwayWind() {
  const B = activeBase(), m = eham.metar;
  if (!m || !m.raw || eham.icao !== B.icao) return null;
  let wind = null;
  try { wind = WX.station(B.icao, m.raw, m.obsTime, null, [], Date.now(), { name: B.station, lat: B.field.lat, lon: B.field.lon }).metar.wind; } catch { return null; }
  if (!wind) return null;
  if (wind.dir === 'VRB' || !(wind.spd > 0)) return h('div', { class: 'rwy-wind', title: 'Wind volgens de METAR van het veld' }, h('span', {}, 'WIND'), h('b', {}, wind.spd > 0 ? `variabel ${wind.spd} kt` : 'stil'), h('i', {}, 'geen voorkeursbaan'));
  const ends = BASES_API.intoWind(B, +wind.dir, wind.spd);
  if (!ends.length) return null;
  // Every runway end that is within a few knots of the best headwind (parallel runways at Volkel, say).
  const best = ends.filter((e) => e.head >= ends[0].head - 2);
  return h('div', { class: 'rwy-wind', title: `Wind ${String(wind.dir).padStart(3, '0')}° / ${wind.spd} kt${wind.gust ? ` (vlagen ${wind.gust})` : ''} uit de METAR: de baan met de meeste tegenwind. Zegt niets over wat de toren werkelijk gebruikt; dat staat links.` },
    h('span', {}, 'IN DE WIND'), h('b', {}, best.map((e) => e.id).join(' / ')), h('i', {}, `${String(wind.dir).padStart(3, '0')}°/${wind.spd} kt · tegenwind ${ends[0].head} kt${ends[0].cross ? `, dwars ${ends[0].cross} kt` : ''}`));
}

function renderRunwayUse(root) {
  const live = eham.live;
  const B = activeBase();
  const connected = live && live.ok;
  const starting = !live || (!live.lastOk && Date.now() - live.startedAt < 45000) || (connected && Date.now() - live.watchingSince < 4 * 60000);
  const land = live ? live.landing : [], dep = live ? live.departure : [];
  const col = (cls, label, items) =>
    h('div', { class: 'rwy-col' }, h('span', { class: 'rwy-kind ' + cls }, label),
      items.length
        ? items.slice(0, 3).map((r) => h('div', { class: 'rwy-item ' + r.role, title: `${r.role === 'secondary' ? 'Secundaire baan' : 'Hoofdbaan'} — ${r.count} vlucht(en) in het laatste kwartier${live.source === 'casper' ? ' (inclusief toestellen die nu voor deze baan in de rij staan of naderen)' : ''}, laatste om ${zulu(r.last)}` }, h('span', { class: 'rwy-num' }, r.rwy), h('span', { class: 'rwy-name' }, rwyName(r.rwy))))
        : h('div', { class: 'rwy-item' }, h('span', { class: 'rwy-name' }, starting ? '…' : connected ? 'geen verkeer' : '—')));

  let dot = '', srcText;
  const viaCasper = live && live.source === 'casper';
  if (connected && (land.length || dep.length)) srcText = viaCasper ? `Schiphol-radar (BAS) · ${zulu(live.lastOk)}` : `Live waargenomen (ADS-B) · ${zulu(live.lastOk)}`;
  else if (!B.casper && connected && B.military) { dot = 'warn'; srcText = 'Geen start- of landingsverkeer gezien (militair verkeer zendt vaak geen ADS-B)'; }
  else if (starting) { dot = 'warn'; srcText = 'Baangebruik wordt bepaald…'; }
  else if (connected) { dot = 'warn'; srcText = 'Geen start- of landingsverkeer'; }
  else { dot = 'bad'; srcText = live.lastOk ? `Geen verbinding · laatst ${zulu(live.lastOk)}` : 'Geen verbinding met live-bron'; }

  root.replaceChildren(
    h('div', { class: 'rwy-grid' },
      h('div', { class: 'rwy-cols' }, col('land', 'LANDEN', land), col('dep', 'STARTEN', dep)),
      runwayMap(land, dep),
      h('div', { class: 'rwy-src', title: viaCasper
        ? 'Per vlucht de start- of landingsbaan volgens de radar, uit de flighttracker van het Bewoners Aanspreekpunt Schiphol (Casper), over het laatste kwartier. Valt die bron weg, dan neemt het live vliegverkeer (ADS-B) het over.'
        : `Afgeleid uit het live vliegverkeer (ADS-B) rond ${B.airport}: toestellen op eindnadering en net na de start, over het laatste kwartier.${B.casper ? ' De flighttracker van het BAS (Casper) is nu niet bereikbaar.' : ''}` }, runwayWind(), h('span', { class: 'dot ' + dot }), srcText, h('span', { class: 'rwy-credit' }, '© OpenStreetMap')))
  );
}

defineWidget('runway', {
  desc: 'Actuele start- en landingsbanen van de basis (Instellingen › Basis): Schiphol per vlucht volgens de radar (BAS-flighttracker) met live ADS-B als terugval; Volkel en Rotterdam uit het live verkeer, met de baan in de wind uit de METAR.',
  icon: 'plane',
  size: [24, 36],
  mount(w, body) {
    const root = h('div', { class: 'rwy-widget' });
    body.append(root);
    const paint = () => renderRunwayUse(root);
    runwayViews.add(paint);
    paint();
    return {
      fresh: () => {
        const live = eham.live;
        return { t: live && live.lastOk, fail: !!live && !live.ok, loading: !live, warn: live && live.source === 'casper' ? 100000 : 30000, bad: live && live.source === 'casper' ? 240000 : 120000, seconds: true, label: 'Baangebruik (laatste waarneming)', note: live && live.source === 'casper' ? 'Per vlucht uit de BAS-flighttracker (Casper), elke minuut opgehaald.' : 'Afgeleid uit het live vliegverkeer rond Schiphol, elke 12 seconden opgehaald.' };
      },
      destroy: () => runwayViews.delete(paint),
    };
  },
});
