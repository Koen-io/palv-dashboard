'use strict';

/* ============================================================
   Datamodel van het dashboard: standaardindeling, widgetsoorten en de migraties van oudere
   configuraties. Zonder DOM, zodat het in Node te toetsen is (`node --test`).
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const COLS = 96;
  const ROWS = 54;
  // Map views are stored for a widget body of this pixel size and scaled to the actual size, so the
  // same area stays in view on any screen resolution and in any window size.
  const REF_W = 939, REF_H = 1041;
  const VERSION = 8;

  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // Mode-S hex codes; editable under Instellingen > Eigen eenheden.
  const DEFAULT_HEX = {
    police: '484A91, 484A92, 484A93, 484A94, 484A95, 484A96, 484AC0, 484AC1, 485B2F',
    hems: '4843BB, 4843BE, 4844C2, 484B58, 4853E2, 4853F6, 4857B3, 485E49, 48605B, 48605C',
    coastguard: '485694, 4856F3, 486449, 48644A, 48644B, 485F8F',
  };

  // The kinds of widget, in the order of the Toevoegen dialog: name and standard settings. What they
  // show and how they are set up lives in widgets/*.js.
  const WIDGET_META = {
    radar: { name: 'Vluchtradar', defaults: { cats: ['all'], lat: 52.077, lon: 5.1848, zoom: 8.16, refH: REF_H, labels: false, routes: true, base: 'osm', overlays: ['legend'], sym: 'silhouet', symSize: 1 } },
    adsb: { name: 'ADS-B Exchange (website)', defaults: { mode: 'all', lat: 52.077, lon: 5.1848, zoom: 8.16, refH: REF_H, sidebar: false, trails: true, labels: false } },
    windy: { name: 'Windy weerradar', defaults: { overlay: 'radar', lat: 52.1487, lon: 5.3025, zoom: 8.353, refH: REF_H, autoplay: true } },
    web: { name: 'Website', defaults: { url: 'https://www.knmi.nl/nederland-nu/luchtvaart', refreshMin: 0 } },
    tile: { name: 'App-tegel', defaults: { kind: 'app', target: '', args: '', icon: null } },
    metar: { name: 'METAR / TAF', defaults: { icao: 'EHAM' } },
    runway: { name: 'Baangebruik Schiphol', defaults: {} },
    fleet: { name: 'In de lucht', defaults: { groups: ['police', 'hems', 'coastguard'], hide: [], ground: true } },
    note: { name: 'Notitie', defaults: { text: '' } },
    plan: { name: 'Zoek & Plan', defaults: {} },
  };

  // Briefing times from the sheet at Flight Ops; editable under Instellingen > Meldingen.
  const DEFAULT_BRIEFINGS = [
    { id: 'opco-am', where: 'Driebergen (OPCO)', name: 'Ochtend', time: '08:00', on: true },
    { id: 'fo-am', where: 'Flight Ops', name: 'Ochtend', time: '08:15', on: true },
    { id: 'fo-pm', where: 'Flight Ops', name: 'Middag', time: '14:30', on: true },
    { id: 'opco-pm', where: 'Driebergen (OPCO)', name: 'Middag', time: '15:00', on: true },
    { id: 'fo-night', where: 'Flight Ops', name: 'Nacht', time: '22:30', on: true },
    { id: 'opco-night', where: 'Driebergen (OPCO)', name: 'Nacht', time: '23:00', on: true },
  ];


  const DEFAULT_SETTINGS = {
    theme: 'auto',
    autoMode: 'sun',
    lightFrom: '07:00',
    darkFrom: '19:00',
    uiScale: 1,
    showSeconds: true,
    startFullscreen: true,
    nightlyReload: true,
    autoStart: false,
    keepAwake: true,
    oledCare: true,
    emergencyAlert: true,
    emergencySound: true,
    briefingAlert: true,
    briefingSound: true,
    briefings: DEFAULT_BRIEFINGS.map((b) => ({ ...b })),
    snap: true,
    rotate: 0,
    wxMarginFt: 200,
    wxMarginM: 1000,
    clocks: [
      { label: 'AMSTERDAM', tz: 'Europe/Amsterdam', suffix: 'LT' },
      { label: 'UTC', tz: 'UTC', suffix: 'Z' },
    ],
    hex: { ...DEFAULT_HEX },
    unitInfo: {},
  };

  function defaultState() {
    const widget = (type, x, y, w, h, z, extra = {}) => ({ id: uid(), type, x, y, w, h, z, title: WIDGET_META[type].name, ...extra, cfg: { ...WIDGET_META[type].defaults, ...(extra.cfg || {}) } });
    const tile = (x, y, title, kind, target) => ({ id: uid(), type: 'tile', x, y, w: 12, h: 9, z: 1, title, cfg: { kind, target, args: '', icon: null } });
    return {
      version: VERSION,
      settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
      activePage: 0,
      pages: [
        {
          id: uid(),
          name: 'Operationeel',
          widgets: [
            widget('radar', 0, 0, 36, 54, 1, { cfg: { cats: ['police', 'hems', 'coastguard'], labels: true } }),
            widget('windy', 36, 0, 36, 54, 2, { title: 'Weerradar' }),
            tile(72, 0, 'LVNL Baangebruik', 'url', 'https://www.lvnl.nl/omgeving/actueel-baangebruik-schiphol'),
            tile(84, 0, 'KNMI Luchtvaart', 'url', 'https://www.knmi.nl/nederland-nu/luchtvaart'),
            widget('runway', 72, 9, 24, 27, 3),
            widget('fleet', 72, 36, 24, 18, 3),
          ],
        },
        {
          id: uid(),
          name: 'Weer',
          widgets: [
            widget('windy', 0, 0, 62, 54, 1, { title: 'Weerradar' }),
            widget('metar', 62, 0, 34, 18, 1, { title: 'Schiphol', cfg: { icao: 'EHAM' } }),
            widget('metar', 62, 18, 34, 18, 1, { title: 'Rotterdam', cfg: { icao: 'EHRD' } }),
            widget('metar', 62, 36, 34, 18, 1, { title: 'Eindhoven Airport', cfg: { icao: 'EHEH' } }),
          ],
        },
        { id: uid(), name: 'Zoek & Plan', widgets: [widget('plan', 0, 0, 96, 54, 1)] },
      ],
    };
  }

  function findFreeSpot(page, w, hgt) {
    const overlaps = (x, y) => page.widgets.some((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + hgt > o.y);
    for (let y = 0; y <= ROWS - hgt; y += 1) for (let x = 0; x <= COLS - w; x += 1) if (!overlaps(x, y)) return { x, y };
    return { x: Math.round((COLS - w) / 2), y: Math.round((ROWS - hgt) / 2) };
  }

  const topZ = (page) => Math.max(0, ...page.widgets.map((o) => o.z || 1)) + 1;

  // A loaded configuration made whole: missing settings filled in, unknown widgets dropped, and older
  // versions brought up to date step by step. Returns the standard layout for anything unusable.
  function normalize(loaded) {
    const def = defaultState();
    if (!loaded || typeof loaded !== 'object' || !Array.isArray(loaded.pages) || !loaded.pages.length) return def;
    const from = loaded.version || 1;
    const fromV1 = from < 2;
    delete loaded.__restoredFrom;
    loaded.settings = { ...def.settings, ...(loaded.settings && typeof loaded.settings === 'object' ? loaded.settings : {}) };
    if (fromV1) loaded.settings.startFullscreen = true;
    loaded.version = VERSION;
    loaded.settings.hex = { ...def.settings.hex, ...(loaded.settings.hex || {}) };
    if (!loaded.settings.unitInfo || typeof loaded.settings.unitInfo !== 'object') loaded.settings.unitInfo = {};
    if (!Array.isArray(loaded.settings.briefings)) loaded.settings.briefings = def.settings.briefings;
    loaded.settings.briefings = loaded.settings.briefings.filter((b) => b && typeof b === 'object' && b.id);
    if (!Array.isArray(loaded.settings.clocks) || loaded.settings.clocks.length !== 2) loaded.settings.clocks = def.settings.clocks;
    loaded.pages = loaded.pages.filter((p) => p && typeof p === 'object');
    if (!loaded.pages.length) return def;
    for (const p of loaded.pages) {
      p.id = p.id || uid();
      p.name = String(p.name || 'Pagina');
      p.widgets = (Array.isArray(p.widgets) ? p.widgets : []).filter((w) => w && WIDGET_META[w.type]);
      for (const w of p.widgets) {
        w.id = w.id || uid();
        if (fromV1 && w.cfg && (w.type === 'adsb' || w.type === 'windy')) {
          // Widgets still on the first release's map view move to the new standard view; custom views stay exact.
          const old = w.type === 'adsb' ? 7.6 : 7;
          if (w.cfg.lat === 52.2 && w.cfg.lon === 5.3 && w.cfg.zoom === old) { delete w.cfg.lat; delete w.cfg.lon; delete w.cfg.zoom; }
          else w.cfg.refH = null;
        }
        w.cfg = { ...WIDGET_META[w.type].defaults, ...(w.cfg || {}) };
      }
    }
    if (from < 3) migrateV3(loaded);
    if (from < 4) migrateV4(loaded);
    if (from < 5) migrateV5(loaded);
    if (from < 6) migrateV6(loaded);
    if (from < 8) migrateV8(loaded);
    loaded.activePage = clamp(loaded.activePage | 0, 0, loaded.pages.length - 1);
    return loaded;
  }

  // 1.2: runway use moved from the header into a widget next to the radar, and the note on the
  // weather page made way for a station in the north of the country.
  function migrateV3(st) {
    const is = (type) => (w) => w.type === type;
    if (!st.pages.some((p) => p.widgets.some(is('runway')))) {
      const page = st.pages.find((p) => p.widgets.some(is('windy')) && p.widgets.some(is('adsb'))) || st.pages.find((p) => p.widgets.some(is('windy'))) || st.pages[0];
      // The two standard tiles go side by side, so the widget gets the full column below them.
      const stock = [[86, 0], [86, 9]].map(([x, y]) => page.widgets.find((w) => w.type === 'tile' && w.x === x && w.y === y && w.w === 10 && w.h === 9));
      if (stock[0] && stock[1]) stock.forEach((t, i) => Object.assign(t, { x: 72 + i * 12, y: 0, w: 12 }));
      const radar = page.widgets.filter(is('windy')).sort((a, b) => b.x + b.w - (a.x + a.w))[0];
      const x = radar ? radar.x + radar.w : COLS;
      let spot = null;
      if (COLS - x >= 14) {
        // Tallest free band in the column right of the radar.
        const used = Array.from({ length: ROWS }, (_, row) => page.widgets.some((o) => o.x + o.w > x && o.y <= row && o.y + o.h > row));
        let run = 0;
        for (let row = 0; row <= ROWS; row += 1) {
          if (row < ROWS && !used[row]) { run += 1; continue; }
          if (run >= 20 && (!spot || run > spot.h)) spot = { x, y: row - run, w: COLS - x, h: run };
          run = 0;
        }
      }
      if (!spot) spot = { ...findFreeSpot(page, 24, 30), w: 24, h: 30 };
      page.widgets.push({ id: uid(), type: 'runway', ...spot, z: topZ(page), title: WIDGET_META.runway.name, cfg: {} });
    }
    for (const p of st.pages) {
      const note = p.widgets.find(is('note'));
      if (!note || !p.widgets.some(is('metar'))) continue;
      if (p.widgets.some((w) => w.type === 'metar' && w.cfg.icao === 'EHGG')) p.widgets.splice(p.widgets.indexOf(note), 1);
      else Object.assign(note, { type: 'metar', title: 'Groningen Eelde', cfg: { icao: 'EHGG' } });
    }
  }

  // 1.8: new standard map views, framed for REF_W x REF_H; aircraft labels on; Eindhoven instead of
  // Groningen Eelde on the weather page.
  function migrateV4(st) {
    // Standard view and reference frame (height, width) of the previous releases.
    const OLD = { adsb: { lat: 52.021, lon: 5.349, zoom: 7.9, ref: [1096, (1096 * 704) / 815] }, windy: { lat: 52.04, lon: 5.16, zoom: 8, ref: [815, 704] } };
    for (const w of st.pages.flatMap((p) => p.widgets)) {
      const old = OLD[w.type];
      if (old && w.cfg.refH === 1096) {
        const { lat, lon, zoom } = WIDGET_META[w.type].defaults;
        if (w.cfg.lat === old.lat && w.cfg.lon === old.lon && w.cfg.zoom === old.zoom) Object.assign(w.cfg, { lat, lon, zoom });
        // A custom centre keeps the framing it had, expressed against the new reference size.
        else w.cfg.zoom = +(w.cfg.zoom + Math.log2(Math.min(REF_H / old.ref[0], REF_W / old.ref[1]))).toFixed(3);
        w.cfg.refH = REF_H;
      }
      if (w.type === 'adsb' && w.title === 'ADS-B Exchange') w.title = WIDGET_META.adsb.name;
      if (w.type === 'metar' && w.cfg.icao === 'EHGG' && w.title === 'Groningen Eelde') { w.title = 'Eindhoven Airport'; w.cfg.icao = 'EHEH'; }
    }
  }

  // 1.11: the own aircraft in the air, in the lower part of the runway column.
  function migrateV5(st) {
    if (st.pages.some((p) => p.widgets.some((w) => w.type === 'fleet'))) return;
    const page = st.pages.find((p) => p.widgets.some((w) => w.type === 'runway')) || st.pages[0];
    const rwy = page.widgets.find((w) => w.type === 'runway');
    const H = 18;
    let spot;
    if (rwy && rwy.h >= 34) {
      rwy.h -= H;
      spot = { x: rwy.x, y: rwy.y + rwy.h, w: rwy.w, h: H };
    } else spot = { ...findFreeSpot(page, 24, H), w: 24, h: H };
    page.widgets.push({ id: uid(), type: 'fleet', ...spot, z: topZ(page), title: WIDGET_META.fleet.name, cfg: { ...WIDGET_META.fleet.defaults } });
  }

  // 1.12: the ADS-B Exchange page makes way for the dashboard's own Vluchtradar, in the same place, with
  // the same view, filter, labels and routes. The old page stays available under Toevoegen.
  function migrateV6(st) {
    const CATS = { all: ['all'], mil: ['mil'], police: ['police', 'hems', 'coastguard'] };
    for (const w of st.pages.flatMap((p) => p.widgets)) {
      if (w.type !== 'adsb') continue;
      const c = w.cfg;
      w.type = 'radar';
      if (['ADS-B', 'ADS-B Exchange', 'ADS-B Exchange (website)'].includes(w.title)) w.title = WIDGET_META.radar.name;
      w.cfg = { ...WIDGET_META.radar.defaults, cats: CATS[c.mode] || ['all'], labels: !!c.labels, routes: c.trails !== false, lat: c.lat, lon: c.lon, zoom: c.zoom, refH: c.refH };
    }
  }
  // 1.14 (version 7) adds only settings with their defaults: keepAwake, oledCare, emergencyAlert, emergencySound.

  // 1.17: the new tab Zoek & Plan, one widget over the whole page, behind the existing pages.
  function migrateV8(st) {
    if (st.pages.some((p) => p.widgets.some((w) => w.type === 'plan'))) return;
    st.pages.push({ id: uid(), name: 'Zoek & Plan', widgets: [{ id: uid(), type: 'plan', x: 0, y: 0, w: COLS, h: ROWS, z: 1, title: WIDGET_META.plan.name, cfg: {} }] });
  }

  return { COLS, ROWS, REF_W, REF_H, VERSION, DEFAULT_HEX, DEFAULT_BRIEFINGS, DEFAULT_SETTINGS, WIDGET_META, uid, clamp, defaultState, normalize, findFreeSpot, topZ };
});
