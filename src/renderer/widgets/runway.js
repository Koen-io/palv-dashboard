'use strict';

/* Baangebruik Schiphol: runways in use, per flight from Casper (BAS flight tracker), live ADS-B as fallback. */
const RUNWAYS = [
  { name: 'Polderbaan', a: '18R', b: '36L', pa: [52.36025, 4.71183], pb: [52.32862, 4.70889] },
  { name: 'Zwanenburgbaan', a: '18C', b: '36C', pa: [52.33139, 4.74003], pb: [52.30186, 4.7375] },
  { name: 'Aalsmeerbaan', a: '18L', b: '36R', pa: [52.32123, 4.78012], pb: [52.29069, 4.77747] },
  { name: 'Kaagbaan', a: '06', b: '24', pa: [52.28792, 4.73422], pb: [52.30462, 4.77752] },
  { name: 'Buitenveldertbaan', a: '09', b: '27', pa: [52.31667, 4.74636], pb: [52.31842, 4.79689] },
  { name: 'Oostbaan', a: '04', b: '22', pa: [52.30036, 4.78348], pb: [52.31403, 4.80302] },
];
// Bundled OpenStreetMap tiles around the field (assets/schiphol/<x>-<y>.png), the backdrop of the runway map.
const SCHIPHOL_TILES = { z: 13, x0: 4200, y0: 2691, cols: 8, rows: 6 };
const rwyName = (id) => { const r = RUNWAYS.find((r) => r.a === id || r.b === id); return r ? r.name : ''; };

function runwayMap(landing, departure) {
  // Web Mercator on the pixel grid of the bundled tiles, so the runways and the backdrop are one drawing
  // and stay locked together however the widget is sized.
  const CX = 60, CY = 50, K = 0.1154, T = SCHIPHOL_TILES, N = 256 * 2 ** T.z;
  const mx = (lon) => ((lon + 180) / 360) * N;
  const my = (lat) => { const r = (lat * Math.PI) / 180; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N; };
  const X0 = mx(4.757), Y0 = my(52.326);
  const proj = ([lat, lon]) => [CX + (mx(lon) - X0) * K, CY + (my(lat) - Y0) * K];
  let tiles = '';
  for (let i = 0; i < T.cols; i += 1) for (let j = 0; j < T.rows; j += 1) {
    // A sliver of overlap keeps hairlines from showing between tiles at odd scales; the mask further down
    // lets the backdrop fade out before the tiles end.
    tiles += `<image href="../../assets/schiphol/${T.x0 + i}-${T.y0 + j}.png" x="${(CX + ((T.x0 + i) * 256 - X0) * K).toFixed(2)}" y="${(CY + ((T.y0 + j) * 256 - Y0) * K).toFixed(2)}" width="${(256 * K + 0.05).toFixed(2)}" height="${(256 * K + 0.05).toFixed(2)}" preserveAspectRatio="none"/>`;
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
  const svg = `<svg class="rwy-map" viewBox="16 -8 90 114" role="img" aria-label="Baangebruik op de kaart van Schiphol"><defs><radialGradient id="rwy-fade" gradientUnits="userSpaceOnUse" cx="${CX}" cy="${CY}" r="84"><stop offset="0.55" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient><mask id="rwy-mask" maskUnits="userSpaceOnUse" x="-70" y="-40" width="250" height="190"><rect x="-70" y="-40" width="250" height="190" fill="url(#rwy-fade)"/></mask></defs><g class="osm" mask="url(#rwy-mask)">${tiles}</g>${lines}${arrows}${texts}</svg>`;
  return h('div', { style: 'display:contents', html: svg }).firstChild;
}

function renderRunwayUse(root) {
  const live = eham.live;
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
  else if (starting) { dot = 'warn'; srcText = 'Baangebruik wordt bepaald…'; }
  else if (connected) { dot = 'warn'; srcText = 'Geen start- of landingsverkeer'; }
  else { dot = 'bad'; srcText = live.lastOk ? `Geen verbinding · laatst ${zulu(live.lastOk)}` : 'Geen verbinding met live-bron'; }

  root.replaceChildren(
    h('div', { class: 'rwy-grid' },
      h('div', { class: 'rwy-cols' }, col('land', 'LANDEN', land), col('dep', 'STARTEN', dep)),
      runwayMap(land, dep),
      h('div', { class: 'rwy-src', title: viaCasper
        ? 'Per vlucht de start- of landingsbaan volgens de radar, uit de flighttracker van het Bewoners Aanspreekpunt Schiphol (Casper), over het laatste kwartier. Valt die bron weg, dan neemt het live vliegverkeer (ADS-B) het over.'
        : 'Afgeleid uit het live vliegverkeer (ADS-B): toestellen op eindnadering en net na de start, over het laatste kwartier. De flighttracker van het BAS (Casper) is nu niet bereikbaar.' }, h('span', { class: 'dot ' + dot }), srcText, h('span', { class: 'rwy-credit' }, '© OpenStreetMap')))
  );
}

defineWidget('runway', {
  desc: 'Actuele start- en landingsbanen van Schiphol, per vlucht volgens de radar (BAS-flighttracker), met live ADS-B als terugval.',
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
