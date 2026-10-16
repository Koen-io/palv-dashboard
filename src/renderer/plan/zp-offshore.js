'use strict';

/* ============================================================
   Zoek & Plan — offshore: alle platforms in Nederland en zo veel mogelijk van de wereld, met per
   platform alle openbare gegevens, het helidek uit openAIP en de eigen dekkaart (heading, hoogte, D, t …).
   ============================================================ */
// Official sources per country (NLOG, Rijkswaterstaat, GEUS, Sodir, BOEM, EMODnet) and OpenStreetMap for
// the rest, through the main process (src/plan/platforms.js). Helideck heading and height are not openly
// published for the Dutch sector; the unit keeps them itself in the private file, one card per platform,
// which travels to its other screens and never into the public code.
const ZP_KINDS = {
  platform: { name: 'Productieplatforms', color: '#ffb02e' },
  satellite: { name: 'Satellietplatforms', color: '#ffd166' },
  substation: { name: 'Hoogspanningsstations (wind op zee)', color: '#7cc6ff' },
  fpso: { name: 'Drijvende installaties (FPSO)', color: '#ff8fab' },
  subsea: { name: 'Onderzeese installaties', color: '#8ea2bf' },
  other: { name: 'Overige installaties', color: '#c9ced6' },
  onshore: { name: 'Mijnbouwlocaties op land', color: '#a1887f' },
};
const ZP_DECK_FIELDS = [
  ['headingDeg', 'Dek heading', '°', 'Richting van de dekmarkering / obstakelvrije sector (graden, magnetisch of waar: zie bron)'],
  ['elevationFt', 'Dekhoogte', 'ft', 'Hoogte van het helidek boven zeeniveau (AMSL)'],
  ['dValue', 'D-waarde', 'm', 'Grootste toegestane D-waarde (totale lengte met draaiende rotoren)'],
  ['tValue', 't-waarde', 't', 'Maximaal toegestane massa'],
  ['sizeM', 'Dekgrootte', 'm', 'Diameter of zijde van het landingsvlak'],
  ['ofsFromDeg', 'Obstakelvrije sector vanaf', '°', 'Begin van de sector, met de klok mee (zelfde noord als de heading)'],
  ['ofsWidthDeg', 'Breedte obstakelvrije sector', '°', 'Meestal 210°'],
  ['obstacleSector', 'Sector (tekst)', '', 'Zoals in de bron vermeld, bv. 210° vanaf 315°'],
  ['freq', 'Frequentie', 'MHz', 'Radio (HLO / platform)'],
  ['callsign', 'Roepnaam', '', ''],
  ['ndb', 'NDB', '', 'Identificatie en frequentie'],
  ['fuel', 'Brandstof', '', 'Beschikbaar, soort, beperkingen'],
  ['limitations', 'Beperkingen (HLL)', '', 'Wind-/turbulentiesectoren, nachtbeperkingen, kleurcodes'],
  ['notes', 'Opmerkingen', '', ''],
  ['source', 'Bron', '', 'bv. HCA HLL Part D d.d. …, route guide operator'],
  ['checked', 'Gecontroleerd op', '', 'Datum'],
];

function zpOffshore(ctx) {
  const { map, cfg } = ctx;
  const O = cfg.offshore;
  let items = [], osm = new Map(), sources = [], areas = { farms: [], zones: [] }, farmLayer = null, err = null, loading = true;
  ctx.platforms = () => items.concat([...osm.values()]);

  async function load(force) {
    try {
      const res = await window.palv.plan.platforms({ force: !!force });
      if (res && Array.isArray(res.items)) { items = res.items; sources = res.sources || []; err = null; }
      else err = (res && res.error) || 'Platforms niet beschikbaar';
    } catch (e) { err = String(e.message || e); }
    loading = false;
    linkDecks();
    ctx.cv.request();
    ctx.emit('offshore');
  }
  async function loadAreas() {
    try { const res = await window.palv.plan.platformAreas(); if (res && res.farms) { areas = res; drawFarms(); } } catch { /* none */ }
  }
  // The rest of the world from OpenStreetMap, per area looked at.
  let osmTimer = null;
  const osmTiles = new Set();
  map.on('moveend', () => {
    clearTimeout(osmTimer);
    if (!O.on || !O.world || map.getZoom() < 6) return;
    osmTimer = setTimeout(async () => {
      const b = map.getBounds();
      const key = `${Math.floor(b.getSouth() / 5)}|${Math.floor(b.getWest() / 5)}|${Math.floor(b.getNorth() / 5)}|${Math.floor(b.getEast() / 5)}`;
      if (osmTiles.has(key)) return;
      osmTiles.add(key);
      try {
        const res = await window.palv.plan.platformsOsm([b.getSouth(), b.getWest(), b.getNorth(), b.getEast()]);
        if (res && Array.isArray(res.items)) {
          // Only what no official source already has (within 300 m).
          for (const p of res.items) if (!items.some((q) => Math.abs(q.lat - p.lat) < 0.005 && Math.abs(q.lon - p.lon) < 0.008 && PlanGeo.dist(q, p) < 300)) osm.set(p.id, p);
          linkDecks();
          ctx.cv.request();
        }
      } catch { /* nothing more there */ }
    }, 1500);
  });

  // The openAIP helideck nearest to each platform (within 600 m), for its elevation and frequencies.
  function linkDecks() {
    const decks = (ctx.aero ? ctx.aero().airports : []).filter((a) => a.type === 'heliport-offshore' || /^heliport/.test(a.type));
    for (const p of ctx.platforms()) {
      let best = null;
      for (const d of decks) {
        if (Math.abs(d.lat - p.lat) > 0.01 || Math.abs(d.lon - p.lon) > 0.016) continue;
        const dist = PlanGeo.dist(d, p);
        if (dist < 600 && (!best || dist < best.dist)) best = { d, dist };
      }
      p.oaip = best ? { ...best.d, distM: Math.round(best.dist) } : null;
    }
  }
  ctx.on('aero', () => { linkDecks(); ctx.cv.request(); });

  /* ---------- wind farms and their safety zones ---------- */
  function drawFarms() {
    if (farmLayer) { farmLayer.remove(); farmLayer = null; }
    if (!cfg.points.farms) return;
    const feats = [
      ...areas.zones.map((z) => ({ type: 'Feature', geometry: z.polygon || z.geometry, properties: { kind: 'zone' } })),
      ...areas.farms.map((f) => ({ type: 'Feature', geometry: f.polygon || f.geometry, properties: { kind: 'farm' } })),
    ].filter((f) => f.geometry);
    farmLayer = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
      renderer: ctx.vector, interactive: false,
      style: (f) => (f.properties.kind === 'zone' ? { color: '#7cc6ff', weight: 1, dashArray: '3 4', fillOpacity: 0, opacity: 0.7 } : { color: '#7cc6ff', weight: 1.4, fillColor: '#7cc6ff', fillOpacity: 0.06, opacity: 0.9 }),
    }).addTo(map);
  }

  /* ---------- drawing ---------- */
  const shown = (p) => O.on && O.kinds.includes(p.kind) && (!O.active || ['in gebruik', 'onbekend', 'gepland'].includes(p.status) || p.status == null);
  const rem = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  ctx.cv.add(40, (c) => {
    if (!O.on && !cfg.points.turbines) return;
    const { g } = c;
    const z = c.zoom;
    const font = `700 ${(0.6 * rem()).toFixed(1)}px ${getComputedStyle(document.body).fontFamily}`;
    const own = ctx.store.private.decks || {};
    const labels = [];
    for (const p of ctx.platforms()) {
      if (p.kind === 'turbine') {
        if (!cfg.points.turbines || z < 10) continue;
        const q = c.P(p.lat, p.lon); if (!c.inView(q, 10)) continue;
        zpObstacle(g, q[0], q[1], false, true);
        c.hit({ x: q[0], y: q[1], r: 7, kind: 'platform', item: p, z: 1 });
        continue;
      }
      if (!shown(p)) continue;
      const q = c.P(p.lat, p.lon);
      if (!c.inView(q, 30)) continue;
      const k = ZP_KINDS[p.kind] || ZP_KINDS.other;
      const s = z < 7 ? 3 : z < 9 ? 4.5 : 6;
      const deck = own[p.id];
      const heli = p.helideck || p.oaip || deck;
      g.lineWidth = 1.6;
      g.fillStyle = p.status === 'buiten gebruik' || p.status === 'ontmanteld' ? 'rgba(140,150,165,0.8)' : k.color;
      g.strokeStyle = '#0a0f18';
      if (p.kind === 'subsea') { g.beginPath(); g.arc(q[0], q[1], s * 0.8, 0, Math.PI * 2); g.fill(); g.stroke(); }
      else if (p.kind === 'fpso') { g.beginPath(); g.ellipse(q[0], q[1], s * 1.4, s * 0.7, 0, 0, Math.PI * 2); g.fill(); g.stroke(); }
      else { g.fillRect(q[0] - s, q[1] - s, s * 2, s * 2); g.strokeRect(q[0] - s, q[1] - s, s * 2, s * 2); }
      if (p.kind === 'substation' && s >= 4.5) { g.beginPath(); g.moveTo(q[0] + 1.5, q[1] - s + 1); g.lineTo(q[0] - 2, q[1] + 0.5); g.lineTo(q[0] + 1.5, q[1] + 0.5); g.lineTo(q[0] - 1.5, q[1] + s - 1); g.strokeStyle = '#0a0f18'; g.lineWidth = 1.3; g.stroke(); }
      // A helideck: an H beside the symbol, green when the unit has its own deck card.
      if (heli && z >= 8) {
        g.font = `800 ${(0.62 * rem()).toFixed(1)}px sans-serif`;
        zpText(g, 'H', q[0] + s + 5, q[1] - s - 2, { color: deck ? '#3ecf6e' : '#ffffff', align: 'center' });
      }
      // The deck heading as a short line, when it is known.
      if (deck && deck.headingDeg != null && z >= 10) {
        const a = PlanGeo.rad(+deck.headingDeg - (deck.headingRef === 'T' ? 0 : -ctx.mag(p.lat, p.lon)));
        g.strokeStyle = '#3ecf6e'; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(q[0], q[1]); g.lineTo(q[0] + Math.sin(a) * 18, q[1] - Math.cos(a) * 18); g.stroke();
      }
      if (O.labels && z >= 9) labels.push([p.name, q[0] + s + 4, q[1] + s + 4]);
      c.hit({ x: q[0], y: q[1], r: Math.max(8, s + 3), kind: 'platform', item: p, z: 3 });
    }
    // Labels last, and only where they do not overlap.
    const boxes = [];
    for (const [t, x, y] of labels) {
      if (boxes.some((b) => Math.abs(b[0] - x) < 70 && Math.abs(b[1] - y) < 13)) continue;
      boxes.push([x, y]);
      zpText(g, t, x, y, { font, color: '#ffe2b0' });
    }
  });

  /* ---------- the card ---------- */
  function card(p) {
    const deck = (ctx.store.private.decks || {})[p.id] || null;
    const k = ZP_KINDS[p.kind] || ZP_KINDS.other;
    const rows = [
      ['Soort', k.name.replace(/s( \(|$)/, '$1')],
      ['Status', p.status || 'onbekend'],
      p.operator ? ['Operator', p.operator] : null,
      p.waterDepthM != null ? ['Waterdiepte', `${Math.round(p.waterDepthM)} m`] : null,
      p.helideck != null ? ['Helidek', p.helideck ? 'ja' : 'nee'] : null,
      p.helideckElevationM != null ? ['Dekhoogte (bron)', `${Math.round(p.helideckElevationM)} m · ${ctx.fmt.alt(p.helideckElevationM / 0.3048)}`] : null,
      ...(p.fields || []).map(([kk, v]) => [kk, String(v)]),
      ['Bron', `${p.src}${p.updated ? ' · ' + p.updated : ''}`],
    ].filter(Boolean);
    const extra = [];
    if (p.oaip) {
      const o = p.oaip;
      extra.push(h('h4', { class: 'zp-sub' }, `Helidek volgens openAIP (${o.distM} m van de positie)`),
        h('div', { class: 'zp-rows' },
          zpRow('Naam', `${o.icao ? o.icao + ' · ' : ''}${o.name}`),
          zpRow('Dekhoogte', o.elevFt ? ctx.fmt.alt(o.elevFt) + ' AMSL' : 'onbekend (niet in openAIP)'),
          ...(o.freqs || []).map((f) => zpRow(f.type || 'Freq.', `${f.mhz.toFixed(3).replace('.', ',')} ${f.name || ''}`)),
          ...(o.runways || []).slice(0, 2).map((r) => zpRow(`Richting ${r.des}`, r.trueHdg != null ? PlanUnits.hdg(r.trueHdg) + 'T' : '—'))));
    }
    if (deck) extra.push(zpDeckWind(ctx, p, deck));
    extra.push(h('h4', { class: 'zp-sub' }, 'Eigen dekkaart'),
      deck ? h('div', { class: 'zp-rows' }, ZP_DECK_FIELDS.filter(([f]) => deck[f] != null && deck[f] !== '').map(([f, label, unit]) => zpRow(label, `${typeof deck[f] === 'number' ? deck[f].toLocaleString('nl-NL') : deck[f]}${unit && typeof deck[f] === 'number' ? (unit === '°' ? '°' : ' ' + unit) : ''}${f === 'headingDeg' ? (deck.headingRef === 'T' ? ' waar' : ' magnetisch') : ''}`)), h('small', { class: 'zp-hint' }, `Bijgewerkt ${new Date(deck.updatedAt).toLocaleString('nl-NL')}`))
        : h('p', { class: 'zp-hint' }, 'Nog geen dekgegevens. Dekheading, dekhoogte, D- en t-waarde en frequenties worden voor de Nederlandse sector niet openbaar gepubliceerd (HCA Helideck Limitations List, operator route guides). Vul ze hier in; ze gaan mee naar de andere schermen van de eenheid, nooit naar buiten.'),
      zpBtn(deck ? 'Dekkaart bewerken' : 'Dekkaart invullen', () => editDeck(p, deck), { icon: 'edit' }));
    return { title: p.name, sub: `${k.name.replace(/s( \(|$)/, '$1')} · ${p.country || ''} · ${p.src}`, color: k.color, point: p, rows, extra };
  }
  function editDeck(p, deck) {
    // A new card starts with what is public: deck height (Danish register, openAIP) and frequencies (openAIP).
    const pre = {};
    if (!deck) {
      if (p.helideckElevationM != null) { pre.elevationFt = Math.round(p.helideckElevationM / 0.3048); pre.source = `Dekhoogte: ${p.src}`; }
      else if (p.oaip && p.oaip.elevFt) { pre.elevationFt = p.oaip.elevFt; pre.source = 'Dekhoogte: openAIP'; }
      if (p.oaip && p.oaip.freqs && p.oaip.freqs.length) pre.freq = p.oaip.freqs.map((x) => x.mhz.toFixed(3)).join(' / ');
      if (p.oaip && p.oaip.icao) pre.callsign = p.oaip.icao;
    }
    const cur = deck || pre;
    const inputs = {};
    const body = h('div', { class: 'zp-deckform' },
      h('p', { class: 'zp-hint' }, `${p.name} — ${ctx.fmt.coord(p.lat, p.lon)}`),
      h('div', { class: 'row' }, field('Heading t.o.v.', zpSelect([{ value: 'M', label: 'Magnetisch noord' }, { value: 'T', label: 'Waar noord' }], cur.headingRef || 'M', (v) => { inputs.headingRef = v; }))),
      ...ZP_DECK_FIELDS.map(([f, label, unit, hint]) => {
        const inp = textInput(cur[f] ?? '', { maxlength: f === 'limitations' || f === 'notes' ? 600 : 80 });
        inputs[f] = inp;
        return field(`${label}${unit ? ' (' + unit + ')' : ''}`, inp, hint);
      }));
    openModal({
      title: 'Dekkaart', body, wide: true,
      actions: [
        deck ? { label: 'Verwijderen', danger: true, left: true, onClick: () => { ctx.put('private', 'decks', p.id, null).then(() => { ctx.cv.request(); ctx.showCard(card(p)); }); } } : null,
        { label: 'Annuleren' },
        { label: 'Opslaan', primary: true, onClick: () => {
          const item = { name: p.name, lat: p.lat, lon: p.lon, headingRef: typeof inputs.headingRef === 'string' ? inputs.headingRef : cur.headingRef || 'M' };
          for (const [f] of ZP_DECK_FIELDS) { const v = inputs[f].value.trim(); if (v) item[f] = /^-?\d+([.,]\d+)?$/.test(v) && f !== 'freq' && f !== 'checked' ? +v.replace(',', '.') : v; }
          ctx.put('private', 'decks', p.id, item).then(() => { ctx.cv.request(); ctx.showCard(card(p)); toast('Dekkaart opgeslagen'); });
        } },
      ].filter(Boolean),
    });
  }
  ctx.on('hit', ({ hit }) => {
    if (hit.kind !== 'platform') return;
    const p = hit.item;
    ctx.select({ lat: p.lat, lon: p.lon, label: p.name, kind: 'platform', item: p });
    ctx.showCard(card(p));
  });
  ctx.platformCard = card;
  ctx.on('store', () => ctx.cv.request());

  ctx.on('ready', () => { load(); loadAreas(); });
  ctx.timers.push(setInterval(() => load(), 6 * 3600e3));
  return { load, sources: () => sources, status: () => ({ loading, error: err, count: items.length, osm: osm.size }), drawFarms, card };
}

// The wind on a helideck now: at deck height, against the deck heading and the obstacle-free sector.
// A landing is planned into wind; the question is whether that approach lies within the sector, and what
// the wind components and limits of the selected helicopter say.
function zpDeckWind(ctx, p, deck) {
  const elev = +deck.elevationFt || 100;
  const w = ctx.windAt(p.lat, p.lon, Date.now(), elev);
  const rows = [];
  if (!w) return h('div', { class: 'zp-rows' }, zpRow('Wind op het dek', 'opvragen…'));
  const mag = ctx.mag(p.lat, p.lon);
  const toTrue = (d) => (deck.headingRef === 'T' ? +d : +d + mag);
  const show = (t) => ctx.fmt.course(t, p.lat, p.lon);
  rows.push(zpRow(`Wind op ${ctx.fmt.alt(elev)}`, `${ctx.fmt.wind(w.dirDeg, w.speedKt)}${w.gustKt ? ' · vlagen ' + ctx.fmt.windSpeed(w.gustKt) + ' (10 m)' : ''}`));
  // The approach into wind comes from downwind: its course is the wind direction itself.
  const into = w.dirDeg;
  rows.push(zpRow('Nadering tegen de wind in', `koers ${show(into)}`));
  const warns = [];
  if (deck.ofsFromDeg != null && deck.ofsWidthDeg != null) {
    // The helicopter approaches over the sector: the direction it comes FROM must lie inside it.
    const from = PlanGeo.norm360(into + 180), start = toTrue(deck.ofsFromDeg), off = PlanGeo.norm360(from - start);
    const inside = off <= +deck.ofsWidthDeg;
    rows.push(zpRow('Obstakelvrije sector', `${show(start)} + ${deck.ofsWidthDeg}° · nadering ${inside ? 'binnen' : 'BUITEN'} de sector`));
    if (!inside) warns.push('Een nadering recht tegen de wind in komt niet over de obstakelvrije sector: kies een andere naderingsrichting met dwarswind, of let op turbulentie achter de installatie.');
  }
  if (deck.headingDeg != null) {
    const c = PlanPerf.components(toTrue(deck.headingDeg), w.dirDeg, w.speedKt);
    rows.push(zpRow('Langs de dek-heading', `${c.head >= 0 ? 'tegenwind' : 'rugwind'} ${ctx.fmt.windSpeed(Math.abs(c.head))} · dwars ${ctx.fmt.windSpeed(Math.abs(c.cross))} van ${c.cross >= 0 ? 'rechts' : 'links'}`));
  }
  const pl = ctx.planning();
  const gust = w.gustKt || w.speedKt;
  if (pl.rotorStartStop && gust > pl.rotorStartStop) warns.push(`Wind (${Math.round(gust)} kt) boven de limiet voor rotor starten/stoppen van ${pl.rotorStartStop} kt: niet uitschakelen op het dek.`);
  // The unit's own offshore rules, as found in its manuals.
  const prof = ctx.profile();
  const rules = [...(prof.wind && Array.isArray(prof.wind.offshore) ? prof.wind.offshore : []), ...(prof.ops && Array.isArray(prof.ops.offshore) ? prof.ops.offshore : []), ...(prof.ops && Array.isArray(prof.ops.helideck) ? prof.ops.helideck : [])].filter((r) => /wind|kt|knoop|deck|dek/i.test(`${r.what} ${r.value}`)).slice(0, 8);
  return h('div', {},
    h('h4', { class: 'zp-sub' }, 'Wind op het dek (nu)'),
    h('div', { class: 'zp-rows' }, rows),
    warns.length ? h('div', { class: 'zp-warns' }, warns.map((t) => h('div', { class: 'zp-warn bad' }, icon('alert'), t))) : null,
    rules.length ? h('details', { class: 'zp-rules' }, h('summary', {}, `Offshore-regels ${prof.type} (${rules.length})`), h('div', { class: 'zp-rows' }, rules.map((r) => zpRow(r.what, String(r.value), r.src)))) : null);
}
