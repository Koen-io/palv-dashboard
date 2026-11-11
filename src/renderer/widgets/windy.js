'use strict';

/* Windy weerradar with the METAR/TAF stations, judged against the BOM minima, drawn on its map. */
// Windy only draws whole zoom levels (labels and base map drop out in between), so the remainder is
// made up by scaling the embedded page itself.
function windyFit(at, body) {
  if (!at.refH) return { zoom: clamp(Math.round(at.zoom), 3, 11), scale: 1 };
  const ideal = at.zoom + fitDelta(body, at.refH);
  // Leaning towards the higher level: a slightly reduced page stays sharper than an enlarged one.
  const zoom = clamp(Math.round(ideal + 0.25), 3, 11);
  return { zoom, scale: clamp(2 ** (ideal - zoom), 0.4, 2) };
}

function windyUrl(cfg, at, body) {
  const q = new URLSearchParams({
    type: 'map', location: 'coordinates', metricRain: 'mm', metricTemp: '°C', metricWind: 'kt',
    zoom: String(windyFit(at, body).zoom), overlay: cfg.overlay, product: cfg.overlay === 'radar' ? 'radar' : 'ecmwf', level: 'surface',
    lat: String(at.lat), lon: String(at.lon),
  });
  return 'https://embed.windy.com/embed.html?' + q.toString();
}

/* ---------- weather stations on the radar (METAR/TAF against the BOM minima) ---------- */
// Which stations show at which zoom: the main fields always, the other fields and the stations just
// across the border one step in, everything else (platforms, small stations) one step further.
const WX_TIER1 = ['EHAM', 'EHRD', 'EHGG', 'EHEH', 'EHBK', 'EHLE', 'EHKD', 'EHLW'];
const WX_TIER2 = ['EHVK', 'EHGR', 'EHWO', 'EHDL', 'EHVL', 'EHFS', 'EBAW', 'EBBR', 'EBLG', 'EDDL', 'EDDK', 'EDLN', 'EDLV', 'EDWE', 'ETNG', 'ETNN'];
const wxTier = (icao) => (WX_TIER1.includes(icao) ? 1 : WX_TIER2.includes(icao) ? 2 : 3);

const WX_GLYPH = { green: '<path d="M4.4 8.3 7 10.8l4.6-5.4"/>', amber: '<path d="M8 4v5M8 11.7v.3"/>', red: '<path d="m5 5 6 6M11 5l-6 6"/>', none: '<path d="M5 8h6"/>' };
const WX_LABEL = { green: 'Binnen limieten', red: 'Buiten limieten', none: 'Geen oordeel' };
const wxArrow = (tr) => (tr.dir ? `<svg class="pw-arr ${tr.dir < 0 ? 'down' : 'up'} ${tr.kind}" viewBox="0 0 12 14"><path d="M6 1.2 11 7.2H7.8v5.6H4.2V7.2H1Z"/></svg>` : '');

// What the label beside each dot shows; chosen per widget with the gear in the title bar.
const WX_FIELDS = {
  icao: { name: 'Stationscode', hint: 'EHAM, EHRD, …', def: true },
  name: { name: 'Naam van het station', def: false },
  wind: { name: 'Wind (richting / kt, vlagen)', def: true },
  cloud: { name: 'Wolkenbasis volgens het BOM (ft)', hint: 'De laagste laag van SCT of meer; FEW ernaast als die lager ligt', def: true },
  layers: { name: 'Alle wolkenlagen', def: false },
  vis: { name: 'Zicht (m / km)', def: true },
  wx: { name: 'Actueel weer (RA, BR, FG, …)', def: false },
  temp: { name: 'Temperatuur / dauwpunt', def: false },
  qnh: { name: 'QNH', def: false },
  trend: { name: 'Trendpijl', def: true },
  age: { name: 'Waarnemingstijd', def: false },
};
const wxFields = (cfg) => ({ ...Object.fromEntries(Object.entries(WX_FIELDS).map(([k, d]) => [k, d.def])), ...(cfg.fields || {}) });
// How the label is built and where it goes. Stacked: one value per line under the station code, so the
// label stays narrow. Place: the spot tried first; every label still moves aside rather than cover another.
const WX_LAYOUTS = [{ value: 'stack', label: 'Onder elkaar', title: 'Elke waarde op een eigen regel: smalle labels' }, { value: 'wide', label: 'Naast elkaar', title: 'De waarden op één regel naast elkaar: lage, brede labels' }];
const WX_PLACES = [
  { value: 'auto', label: 'Auto', title: 'Elk label zoekt zelf de beste vrije plek rond zijn bolletje' },
  { value: 'e', label: 'Rechts', title: 'Rechts van het bolletje, tenzij daar al een ander label staat' },
  { value: 'w', label: 'Links', title: 'Links van het bolletje, tenzij daar al een ander label staat' },
  { value: 'n', label: 'Boven', title: 'Boven het bolletje, tenzij daar al een ander label staat' },
  { value: 's', label: 'Onder', title: 'Onder het bolletje, tenzij daar al een ander label staat' },
];
const WX_SIZES = [{ value: '0.85', name: 'Klein' }, { value: '1', name: 'Normaal' }, { value: '1.25', name: 'Groot' }, { value: '1.5', name: 'Extra groot' }];
// Small line icons in front of each value, all one column wide, so the values line up under each other.
const WX_ICON = {
  cloud: '<path d="M4.6 12.5h6.9a2.9 2.9 0 0 0 .2-5.8 4 4 0 0 0-7.6.9 2.5 2.5 0 0 0 .5 4.9Z"/>',
  layers: '<path d="M8 2.2 14 5.2 8 8.2 2 5.2Z"/><path d="m2 8.4 6 3 6-3"/><path d="m2 11.4 6 3 6-3"/>',
  vis: '<path d="M1.4 8S3.8 3.6 8 3.6 14.6 8 14.6 8 12.2 12.4 8 12.4 1.4 8 1.4 8Z"/><circle cx="8" cy="8" r="2"/>',
  wx: '<path d="M5.2 3.2C3.8 5.2 3.2 6.3 3.2 7.3a2 2 0 0 0 4 0c0-1-.6-2.1-2-4.1Z"/><path d="M10.8 7.2c-1.4 2-2 3.1-2 4.1a2 2 0 0 0 4 0c0-1-.6-2.1-2-4.1Z"/>',
  temp: '<path d="M6.6 9.5V3.2a1.4 1.4 0 0 1 2.8 0v6.3a3 3 0 1 1-2.8 0Z"/><path d="M8 11.2V6.5"/>',
  qnh: '<path d="M2.4 11.6a5.6 5.6 0 1 1 11.2 0"/><path d="m8 11.6 2.6-3.2"/>',
  age: '<circle cx="8" cy="8" r="6"/><path d="M8 4.6V8l2.4 1.6"/>',
};
const wxIcon = (k) => `<svg class="pw-i" viewBox="0 0 16 16">${WX_ICON[k]}</svg>`;
// Wind: an arrow blowing along with the wind, a dashed ring when variable, a ring when calm.
function wxWindIcon(w) {
  if (!w || w.spd === 0) return '<svg class="pw-i" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.2"/></svg>';
  if (w.dir === 'VRB') return '<svg class="pw-i" viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.6" stroke-dasharray="2.2 1.8"/></svg>';
  return `<svg class="pw-i" viewBox="0 0 16 16" style="transform:rotate(${+w.dir}deg)"><path d="M8 2v11.2M4.4 9.6 8 13.4l3.6-3.8"/></svg>`;
}
function wxCloudText(m) {
  const base = WX.lowestLayer(m, false);
  const few = WX.lowestLayer(m, true);
  if (base) return `${base.cover} ${base.base}${few && few.base < base.base ? ` <i>(FEW ${few.base})</i>` : ''}`;
  if (m.vv != null) return m.vv < 0 ? 'VV' : `VV ${m.vv}`;
  if (m.cloud === 'none' || m.cloud === 'layers') return few ? `geen <i>(FEW ${few.base})</i>` : m.cavok ? 'CAVOK' : 'NSC';
  return '//';
}
const wxVisText = (m) => (m.vis == null ? '' : m.cavok ? 'CAVOK' : m.vis >= 9999 ? '≥10 km' : m.vis >= 5000 ? `${(m.vis / 1000).toFixed(m.vis % 1000 ? 1 : 0).replace('.', ',')} km` : `${m.vis} m`);
// The station's label: a head (trend, code, name) and under it one row per value, each with its icon.
// Stacked, the rows run down; wide, they run side by side on one line. The status colour runs down the
// label's edge, so a label that has moved aside still reads as belonging to its dot.
function wxMarkerHtml(st, a, f, now, layout) {
  const m = st.metar;
  const wind = WX.windText(m.wind);
  const name = f.name ? String(st.name || '').split(',')[0].replace(/\s+(Arpt|Airport)$/i, '') : '';
  const row = (k, html, title, ic) => `<span class="pw-r pw-${k}" title="${title}">${ic || wxIcon(k)}<span>${html}</span></span>`;
  const rows = [
    f.wind && wind ? row('wind', wind, 'Wind', wxWindIcon(m.wind)) : '',
    f.cloud ? row('cloud', wxCloudText(m), 'Wolkenbasis (BOM)') : '',
    f.layers && m.layers.length ? row('layers', m.layers.map((l) => `${l.cover}${String(l.base / 100).padStart(3, '0')}${l.type || ''}`).join(' '), 'Wolkenlagen') : '',
    f.vis && m.vis != null ? row('vis', wxVisText(m), 'Zicht') : '',
    f.wx && m.wx.length ? row('wx', escHtml(m.wx.join(' ')), 'Actueel weer') : '',
    f.temp && m.temp != null ? row('temp', `${m.temp}°/${m.dew == null ? '—' : m.dew + '°'}`, 'Temperatuur / dauwpunt') : '',
    f.qnh && m.qnh ? row('qnh', `Q${m.qnh}`, 'QNH') : '',
    f.age ? row('age', `${zulu(st.obsTime)} · ${Math.max(0, Math.round((now - st.obsTime) / 60000))} min`, 'Waarnemingstijd') : '',
  ].filter(Boolean).join('');
  const trend = f.trend ? wxArrow(a.trend) : '';
  const head = (f.icao ? `<b>${escHtml(st.icao)}</b>` : '') + (name ? `<u>${escHtml(name)}</u>` : '') + (a.aw139 ? '<em>AW139</em>' : '');
  const lab = head || rows ? `<span class="pw-lab">${head || trend ? `<span class="pw-h">${trend}${head}</span>` : ''}${rows ? `<span class="pw-rows">${rows}</span>` : ''}</span>` : '';
  return `<div class="pw ${a.status} lay-${layout === 'wide' ? 'wide' : 'stack'}"><span class="pw-dot"><svg viewBox="0 0 16 16">${WX_GLYPH[a.status]}</svg>${a.aw139 ? '<i class="pw-plus">+</i>' : ''}</span>${lab}</div>`;
}

function wxPopupHtml(st, pid, now) {
  const m = st.metar;
  const vis = m.vis == null ? 'niet gemeten' : m.cavok ? 'CAVOK' : m.vis >= 9999 ? '≥ 10 km' : `${m.vis} m`;
  const cloud = m.layers.length ? m.layers.map((l) => `${l.cover} ${l.base} ft`).join(', ') : m.cloud === 'none' ? 'geen' : m.vv != null ? `verticaal zicht ${m.vv < 0 ? 'onbekend' : m.vv + ' ft'}` : 'niet gemeten';
  const wind = m.wind ? (m.wind.spd === 0 ? 'stil' : `${WX.windText(m.wind)} ${m.wind.unit === 'MPS' ? '' : 'kt'}`) : 'niet gemeten';
  const rows = WX.PROFILES.map((p) => {
    const r = WX.assess(p.id, st, now);
    const label = r.status === 'amber' ? (r.marginal ? 'Marginaal' : 'Verwacht buiten limieten') : r.stale ? 'Waarneming te oud' : WX_LABEL[r.status];
    return `<tr class="${r.status}${p.id === pid ? ' sel' : ''}"><td>${p.name}${p.aw139 ? ' <em>alleen AW139</em>' : ''}</td><td><i></i>${label}</td></tr>`;
  }).join('');
  const tr = WX.assess(pid, st, now).trend;
  const src = { METAR: 'METAR-trend (2 uur)', TAF: 'TAF, komende 2 uur', OBS: 'Waargenomen verloop, laatste uur' }[tr.src];
  const dir = tr.dir < 0 ? 'verslechterend' : tr.dir > 0 ? 'verbeterend' : 'geen verandering';
  const kind = tr.dir && tr.kind !== 'obs' ? (tr.kind === 'tempo' ? ', tijdelijk' : ', blijvend') : '';
  const trend = src ? `<div class="pp-t"><span>${src}</span>${wxArrow(tr)}<b>${dir}${kind}</b>${tr.text ? `<code>${escHtml(tr.text)}</code>` : ''}</div>` : '<div class="pp-t"><span>Trend</span><b>niet beschikbaar</b></div>';
  return `<div class="pp"><div class="pp-h"><b>${escHtml(st.icao)}</b><span>${escHtml(String(st.name || '').split(',')[0])}</span><i>${zulu(st.obsTime)} · ${Math.max(0, Math.round((now - st.obsTime) / 60000))} min</i></div>`
    + `<div class="pp-m"><div><span>WIND</span>${wind}</div><div><span>ZICHT</span>${vis}</div><div><span>BEWOLKING</span>${cloud}</div></div>${trend}<table>${rows}</table>`
    + `<pre>${escHtml(st.raw)}</pre>${st.tafRaw ? `<pre>${escHtml(st.tafRaw)}</pre>` : ''}</div>`;
}

// Runs inside the Windy page: keeps one Leaflet marker per station on Windy's own map, so the dots
// stay on their coordinates through every pan and zoom. Returns null while the map is not there yet.
function wxInject(p) {
  if (typeof W === 'undefined' || typeof L === 'undefined' || !W.map || !W.map.map) return null;
  const map = W.map.map;
  let S = window.__palvWx;
  if (!S || S.map !== map) {
    S = window.__palvWx = { map, mk: new Map(), scale: 1 };
    S.show = () => {
      const z = map.getZoom() + Math.log2(S.scale || 1);
      for (const m of S.mk.values()) {
        const on = S.all || m.tier === 1 || (m.tier === 2 ? z >= 7.5 : z >= 8.6);
        if (on && !map.hasLayer(m.l)) m.l.addTo(map);
        else if (!on && map.hasLayer(m.l)) map.removeLayer(m.l);
      }
      if (S.layout) S.layout();
    };
    map.on('zoomend', S.show);

    // Label placement. Every label has eight spots around its dot: beside, above, below and on the
    // diagonals. The labels are placed one by one, the main fields first and then bad weather before good;
    // each takes the spot that covers no label placed before it and no other dot, preferring the spot of
    // the setting, staying where it was when that is still free (no labels hopping about), and inside the
    // map clear of Windy's controls. Where no spot is free the label shrinks to its head (the station
    // code); where even that collides it stays out of sight until the pointer rests on the dot.
    // The offsets match the .p-* classes in WX_CSS: 15 px from the centre beside the dot, 12 on a diagonal.
    const off = (pos, w, h) => ({ e: [15, -h / 2], w: [-15 - w, -h / 2], n: [-w / 2, -15 - h], s: [-w / 2, 15], ne: [12, -12 - h], se: [12, 12], nw: [-12 - w, -12 - h], sw: [-12 - w, 12] }[pos]);
    const AUTO = ['e', 'w', 'ne', 'se', 'nw', 'sw', 'n', 's'];
    const NEAR = { e: ['ne', 'se'], w: ['nw', 'sw'], n: ['ne', 'nw'], s: ['se', 'sw'] };
    const POS = AUTO.map((p) => 'p-' + p);
    const SEV = { red: 0, amber: 1, green: 2, none: 3 };
    const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    S.layout = () => {
      S.frame = 0;
      const size = map.getSize(), sc = S.scale || 1;
      const order = NEAR[S.pos] ? [S.pos, ...NEAR[S.pos], ...AUTO.filter((p) => p !== S.pos && !NEAR[S.pos].includes(p))] : AUTO;
      const list = [];
      for (const m of S.mk.values()) {
        const el = map.hasLayer(m.l) && m.l._icon && m.l._icon.firstElementChild;
        const lab = el && el.querySelector('.pw-lab');
        if (!el) continue;
        const p = map.latLngToContainerPoint(m.l.getLatLng());
        list.push({ m, el, lab, x: p.x, y: p.y, key: m.html + '|' + S.size });
      }
      // Sizes, measured once per content: all labels at once in their short form, then all in full.
      const fresh = list.filter((it) => it.lab && it.m.szKey !== it.key);
      if (fresh.length) {
        for (const it of fresh) it.el.classList.add('min');
        for (const it of fresh) it.min = [it.lab.offsetWidth, it.lab.offsetHeight];
        for (const it of fresh) it.el.classList.remove('min');
        for (const it of fresh) { it.m.sz = { full: [it.lab.offsetWidth, it.lab.offsetHeight], min: it.min }; it.m.szKey = it.key; }
      }
      // The dots (with the AW139 plus) are kept clear by every label; the status pill at the top left,
      // Windy's zoom buttons at the top right and its timeline at the bottom are avoided where possible.
      for (const it of list) it.dot = [it.x - 13, it.y - 14, it.x + 14, it.y + 13];
      const view = [4, 4, size.x - 4, size.y - 4];
      const zones = [[0, 0, 420 / sc, 46 / sc], [size.x - 52, 0, size.x, 140], [0, size.y - 86, size.x, size.y]];
      const placed = [];
      list.sort((a, b) => a.m.tier - b.m.tier || SEV[a.m.sev] - SEV[b.m.sev] || (a.m.id < b.m.id ? -1 : 1));
      for (const it of list) {
        if (!it.lab) continue;
        let pick = null;
        for (const form of ['full', 'min']) {
          const [w, h] = it.m.sz[form];
          let best = null;
          order.forEach((pos, i) => {
            const [dx, dy] = off(pos, w, h);
            const b = [it.x + dx - 2, it.y + dy - 2, it.x + dx + w + 2, it.y + dy + h + 2];
            let hit = 0;
            for (const o of placed) hit += inter(b, o);
            for (const o of list) if (o !== it) hit += inter(b, o.dot);
            // Over the status pill or Windy's controls, or past the edge of the map, a full label counts as
            // colliding (it shrinks to its head first); its head alone may lie there when there is no other way.
            let zone = 0;
            for (const z of zones) zone += inter(b, z);
            const out = (b[2] - b[0]) * (b[3] - b[1]) - inter(b, view);
            if (form === 'full') hit += zone + out;
            const soft = out * 3 + zone * 2;
            const cost = hit * 20 + soft + i * 25 - (it.m.pos === pos && it.m.form === form ? 60 : 0);
            if (!best || cost < best.cost) best = { pos, form, b, cost, hit };
          });
          if (!best.hit || form === 'min') pick = !best.hit || it.m.tier === 1 ? best : null;
          if (!best.hit) break;
        }
        it.el.classList.remove(...POS);
        it.el.classList.toggle('min', !!pick && pick.form === 'min');
        it.el.classList.toggle('hid', !pick);
        it.m.pos = pick && pick.pos; it.m.form = pick && pick.form;
        if (!pick) continue;
        it.el.classList.add('p-' + pick.pos);
        placed.push(pick.b);
      }
    };
    S.queue = () => { if (!S.frame) S.frame = requestAnimationFrame(S.layout); };
    map.on('moveend resize viewreset', S.queue);
    // Opening a station's popup lets the map slide to make room for it. Where the map stood is kept
    // (S.back) and it returns there once the popup is closed, unless another station was opened at once.
    S.popup = () => !!(map._popup && map.hasLayer(map._popup));
    map.on('popupclose', () => setTimeout(() => {
      if (!S.back || S.popup()) return;
      const b = S.back;
      S.back = null;
      if (window.__palvIn) window.__palvIn.t = 0;
      map.setView(b.c, b.z, { animate: true, duration: 0.3 });
    }, 0));
  }
  // Windy's own "my location" dot (an estimate from the IP address, always on with the radar layer) is
  // not this dashboard's position and says nothing operational: gone, also when Windy puts it back.
  for (const d of document.querySelectorAll('.leaflet-marker-icon.mylocation, .icon-dot.mylocation, .pulsating-icon')) d.remove();
  S.scale = p.scale;
  S.all = !!p.all;
  if (S.size !== p.size) { S.size = p.size; document.documentElement.style.setProperty('--pw-size', String(p.size || 1)); }
  const seen = new Set();
  for (const s of p.stations) {
    seen.add(s.id);
    let m = S.mk.get(s.id);
    if (!m) {
      m = { l: L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'pw-icon', html: s.html, iconSize: [0, 0] }), keyboard: false, zIndexOffset: 1000 - s.tier * 100 }), html: s.html, pop: s.pop };
      m.l.on('click', () => { if (!S.popup()) S.back = { c: map.getCenter(), z: map.getZoom() }; }); // before the popup opens
      m.l.bindPopup(s.pop, { className: 'pw-pop', maxWidth: 420, minWidth: 300, closeButton: false, offset: [0, -10], autoPanPaddingTopLeft: [12, 56], autoPanPaddingBottomRight: [12, 70] });
      S.mk.set(s.id, m);
    }
    if (m.html !== s.html) m.l.setIcon(L.divIcon({ className: 'pw-icon', html: s.html, iconSize: [0, 0] }));
    if (m.pop !== s.pop) m.l.setPopupContent(s.pop);
    m.html = s.html; m.pop = s.pop; m.tier = s.tier; m.sev = s.sev; m.id = s.id;
  }
  for (const [id, m] of S.mk) if (!seen.has(id)) { map.removeLayer(m.l); S.mk.delete(id); }
  S.pos = p.pos || 'auto';
  S.show(); // and places the labels
  const info = { n: S.mk.size, radar: null, overlay: null };
  try { info.overlay = W.store.get('overlay'); const c = W.store.get('radarCalendar'); info.radar = (c && (c.refTimeTs || c.updateTs)) || null; } catch (e) {}
  return info;
}

const WX_CSS = `
.leaflet-marker-icon.mylocation,.icon-dot.mylocation,.pulsating-icon{display:none!important;visibility:hidden!important}
.pw-icon{overflow:visible!important}
.pw-icon:hover{z-index:100000!important}
.pw{position:absolute;left:0;top:0;white-space:nowrap;cursor:pointer;font:600 calc(12px * var(--pw-size, 1))/1.15 "Segoe UI",system-ui,sans-serif}
.pw-dot{position:absolute;left:-11px;top:-11px;width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1.5px rgba(4,10,20,.85),0 2px 6px rgba(0,0,0,.6);display:grid;place-items:center}
.pw-dot svg{width:14px;height:14px;fill:none;stroke:#04101e;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}
.pw.green .pw-dot{background:#2fd67b}.pw.amber .pw-dot{background:#ffb020}.pw.red .pw-dot{background:#ff4d42}.pw.none .pw-dot{background:#7c8aa0}
.pw.red .pw-dot svg,.pw.none .pw-dot svg{stroke:#fff}
.pw-plus{position:absolute;top:-8px;right:-8px;width:14px;height:14px;border-radius:50%;background:#38bdf8;color:#04101e;border:1.5px solid #04101e;font:800 12px/11px "Segoe UI",sans-serif;text-align:center;font-style:normal}
.pw-lab{--pw-c:#7c8aa0;position:absolute;left:0;top:0;display:flex;flex-direction:column;gap:.18em;padding:.36em .6em .4em .62em;border-radius:4px;background:rgba(7,13,24,.92);border:1px solid rgba(255,255,255,.18);border-left:3px solid var(--pw-c);color:#fff;letter-spacing:.02em;box-shadow:0 2px 8px rgba(0,0,0,.5);transform:translate(15px,-50%)}
.pw.green .pw-lab{--pw-c:#2fd67b}.pw.amber .pw-lab{--pw-c:#ffb020}.pw.red .pw-lab{--pw-c:#ff4d42}
.pw.p-e .pw-lab{transform:translate(15px,-50%)}.pw.p-w .pw-lab{transform:translate(calc(-100% - 15px),-50%)}
.pw.p-n .pw-lab{transform:translate(-50%,calc(-100% - 15px))}.pw.p-s .pw-lab{transform:translate(-50%,15px)}
.pw.p-ne .pw-lab{transform:translate(12px,calc(-100% - 12px))}.pw.p-se .pw-lab{transform:translate(12px,12px)}
.pw.p-nw .pw-lab{transform:translate(calc(-100% - 12px),calc(-100% - 12px))}.pw.p-sw .pw-lab{transform:translate(calc(-100% - 12px),12px)}
.pw.min .pw-rows,.pw.min .pw-h u{display:none}
.pw.hid .pw-lab{visibility:hidden}.pw.hid:hover .pw-lab{visibility:visible}
.pw-h{display:flex;align-items:center;gap:.4em;font-weight:700;letter-spacing:.05em}.pw-h u{text-decoration:none;color:#fff;font-weight:500;letter-spacing:.01em}
.pw-rows{display:flex;flex-direction:column;gap:.12em;font-weight:500;font-size:.94em;color:#dce6f5;font-variant-numeric:tabular-nums}
.pw.lay-wide .pw-rows{flex-direction:row;gap:.75em}
.pw-r{display:flex;align-items:center;gap:.38em}.pw-r i{font-style:normal;color:#ffb941}
.pw-i{width:1.05em;height:1.05em;flex:none;fill:none;stroke:#8fa6c6;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.pw-wind .pw-i{stroke:#c6d4e8}
.pw-lab em{font-style:normal;font-size:.8em;font-weight:700;color:#7dd3fc;letter-spacing:.04em}
.pw-arr{width:.85em;height:1em;flex:none;stroke-width:1.5;stroke-linejoin:round}
.pw-arr.down{transform:rotate(180deg);fill:#ff6b60;stroke:#ff6b60}.pw-arr.up{fill:#3ee08a;stroke:#3ee08a}
.pw-arr.tempo,.pw-arr.obs{fill:none}.pw-arr.obs{stroke-dasharray:2 1.6}
.pw-pop .leaflet-popup-content-wrapper{background:#0b1422;color:#e9eff8;border:1px solid #2b3d5c;border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.6);padding:0}
.pw-pop .leaflet-popup-tip{background:#0b1422;border:1px solid #2b3d5c}
.pw-pop .leaflet-popup-content{margin:0;width:auto!important}
.pp{padding:12px 14px;font:400 12px/1.4 "Segoe UI",system-ui,sans-serif;min-width:300px}
.pp-h{display:flex;align-items:baseline;gap:8px}.pp-h b{font-size:17px;letter-spacing:.05em}.pp-h span{color:#a9bad3;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pp-h i{font-style:normal;color:#a9bad3;font-variant-numeric:tabular-nums;white-space:nowrap}
.pp-m{display:flex;gap:16px;margin:10px 0;font-size:13px;font-weight:600}.pp-m span,.pp-t span{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;color:#8ea2bf}
.pp-t{margin:0 0 10px;font-size:13px}.pp-t .pw-arr{display:inline-block;margin-right:5px;vertical-align:-1px}.pp-t code{display:block;margin-top:2px;font:400 11px/1.4 Consolas,monospace;color:#a9bad3;white-space:normal}
.pp table{width:100%;border-collapse:collapse}.pp td{padding:4px 6px;border-top:1px solid #1e2c44;white-space:nowrap}.pp td:first-child{text-align:left}.pp td:last-child{text-align:right;font-weight:600}
.pp tr.sel td{background:#16233a}.pp td em{font-style:normal;font-size:10px;font-weight:700;color:#7dd3fc;margin-left:4px}
.pp td i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:#7c8aa0}
.pp tr.green td i{background:#2fd67b}.pp tr.amber td i{background:#ffb020}.pp tr.red td i{background:#ff4d42}
.pp pre{margin:10px 0 0;padding:8px;border-radius:5px;background:#060c16;color:#c6d4e8;font:400 11px/1.45 Consolas,monospace;white-space:pre-wrap;word-break:break-word;user-select:text}
`;

defineWidget('windy', {
  desc: 'Windy.com, gecentreerd op Nederland en startend op de weerradar.',
  icon: 'radar',
  size: [40, 36],
  mount(w, body, tools) {
    let scale = 1; // of the embedded page, as last set
    const fit = (at) => { const f = windyFit(at, body); scaleWebview(view.wv, (scale = f.scale)); return f; };
    const keep = keepView(w, body, {
      sample: `(() => { if (typeof W === 'undefined' || !W.map || !W.map.map) return null; ${INPUT_JS} const m = W.map.map, c = m.getCenter(); return { lat: c.lat, lon: c.lng, zoom: m.getZoom(), idle: Date.now() - window.__palvIn.t, hold: !!(window.__palvWx && window.__palvWx.back && window.__palvWx.popup()) }; })()`,
      place: (at) => `(() => { if (typeof W === 'undefined' || !W.map || !W.map.map) return false; const m = W.map.map; m.invalidateSize(false); m.setView([${+at.lat}, ${+at.lon}], ${fit(at).zoom}, { animate: false }); if (window.__palvIn) window.__palvIn.t = 0; return true; })()`,
      expect: (at) => ({ lat: +at.lat, lon: +at.lon, zoom: windyFit(at, body).zoom }),
      adopt: (s) => ({ lat: s.lat, lon: s.lon, zoom: s.zoom + Math.log2(scale) - fitDelta(body, REF_H), refH: REF_H }),
    });
    const view = makeWebview(body, () => windyUrl(w.cfg, keep.current(), body));
    // Start the radar animation, and resume it if the embed stops; Windy has no autoplay parameter.
    // Keeps pressing until the loop is really running: a press right after loading can land before the radar is ready.
    const press = () => view.wv.executeJavaScript("(() => { const b = document.querySelector('.play-pause'); if (!b) return 'none'; if (!b.classList.contains('off')) return 'playing'; b.click(); return 'pressed'; })()").catch(() => 'none');
    let tries = 0, kick = null;
    const start = () => { clearInterval(kick); tries = 0; kick = setInterval(async () => { if ((await press()) === 'playing' || ++tries > 60) clearInterval(kick); }, 700); };
    const watchdog = setInterval(() => w.cfg.autoplay && press(), 20000);
    view.wv.addEventListener('did-finish-load', () => w.cfg.autoplay && start());
    // Station layer: METAR/TAF stations drawn on Windy's own map, coloured against the chosen BOM profile.
    const status = h('div', { class: 'wxm-status' });
    body.append(status);
    let mapInfo = null, lastPush = 0;
    const paintStatus = () => {
      const now = Date.now();
      const nl = wxFeed.stations.filter((s) => s.icao.startsWith('EH'));
      const newest = nl.length ? Math.max(...nl.map((s) => s.obsTime)) : 0;
      const radar = mapInfo && mapInfo.overlay === 'radar' ? mapInfo.radar : null;
      let level = 'live', label = 'LIVE';
      if (!wxFeed.lastOk) [level, label] = wxFeed.fails ? ['bad', 'GEEN VERBINDING'] : ['warn', 'LADEN'];
      else if (now - wxFeed.lastOk > 10 * 60000) [level, label] = ['bad', 'GEEN VERBINDING'];
      else if (now - newest > 90 * 60000) [level, label] = ['bad', 'METAR VEROUDERD'];
      else if (!mapInfo) [level, label] = ['warn', 'KAART LADEN'];
      else if (now - wxFeed.lastOk > 150000) [level, label] = ['warn', 'VERBINDING HAPERT'];
      else if (now - newest > 50 * 60000) [level, label] = ['warn', 'METAR VERTRAAGD'];
      else if (radar && now - radar > 20 * 60000) [level, label] = ['warn', 'RADAR VERTRAAGD'];
      const d = new Date(wxFeed.lastOk);
      status.className = 'wxm-status ' + level;
      status.title = 'Groen: gegevens zijn actueel en worden elke minuut opgehaald. Oranje: vertraagd of nog aan het laden. Rood: geen verbinding of verouderd.\nBolletjes: groen binnen limieten, oranje marginaal of verwacht buiten limieten, rood buiten limieten, grijs geen oordeel.\nPijl: trend (dicht = blijvend, open = tijdelijk, gestippeld = waargenomen verloop). Plus: alleen AW139 (Advanced Operations).';
      status.replaceChildren(...[
        h('span', { class: 'wxm-dot' }), h('b', {}, label),
        newest ? h('span', {}, `METAR ${zulu(newest)}`) : null,
        radar ? h('span', {}, `Radar ${zulu(radar)}`) : null,
        wxFeed.lastOk ? h('span', {}, `Opgehaald ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}Z`) : null,
      ].filter(Boolean));
    };
    const push = async () => {
      if (!view.wv.isConnected) return;
      lastPush = Date.now();
      const pid = w.cfg.profile || 'mpd';
      const f = wxFields(w.cfg);
      const stations = wxFeed.stations.map((st) => {
        const a = WX.assess(pid, st, lastPush);
        return { id: st.icao, lat: st.lat, lon: st.lon, tier: wxTier(st.icao), sev: a.status, html: wxMarkerHtml(st, a, f, lastPush, w.cfg.labelLayout), pop: wxPopupHtml(st, pid, lastPush) };
      });
      try { mapInfo = await view.wv.executeJavaScript(`(${wxInject})(${JSON.stringify({ scale, stations, all: !!w.cfg.allStations, size: +w.cfg.labelSize || 1, pos: w.cfg.labelPos || 'auto' })})`); } catch { mapInfo = null; }
      paintStatus();
    };
    view.wv.addEventListener('dom-ready', () => view.wv.insertCSS(WX_CSS).catch(() => {}));
    view.wv.addEventListener('did-navigate', () => { mapInfo = null; });
    // The profile follows UDP: at each boundary it switches to the profile last used for that period.
    // A profile picked from the other period is a look ahead and holds until the next boundary.
    const group = (period, label) => h('optgroup', { label }, WX.PROFILES.filter((p) => p.period === period).map((p) => h('option', { value: p.id }, p.name + (p.aw139 ? ' — alleen AW139' : ''))));
    const prof = h('select', { class: 'input wxm-prof', onchange: () => { const p = WX.profile(prof.value); w.cfg.profile = p.id; w.cfg[p.period + 'Profile'] = p.id; save(); followUdp(); push(); } }, group('day', 'Dag — binnen UDP'), group('night', 'Nacht — buiten UDP'));
    const followUdp = () => {
      const period = udpToday().day ? 'day' : 'night';
      const switched = w.cfg.udpPeriod !== period;
      if (switched) {
        const kept = WX.profile(w.cfg.profile).period === period && w.cfg.profile;
        w.cfg.udpPeriod = period;
        w.cfg.profile = w.cfg[period + 'Profile'] || kept || (period === 'day' ? 'mpd' : 'aided');
        save();
      }
      const manual = WX.profile(w.cfg.profile).period !== period;
      prof.value = w.cfg.profile;
      prof.classList.toggle('manual', manual);
      prof.title = manual ? `Handmatig gekozen terwijl het ${period === 'day' ? 'dag' : 'nacht'} is; schakelt bij de volgende UDP-grens automatisch om.` : 'BOM-profiel waaraan de meetstations worden getoetst. Volgt automatisch dag en nacht volgens UDP.';
      return switched;
    };
    followUdp();
    const unwatch = watchWx(push);
    // Keeps trying until the map exists, then keeps ages, radar time and the status current.
    // Radar picture for the warning in the tab bar, judged only while the widget is in view.
    const hkey = 'radar:' + w.id;
    const checkHealth = () => {
      const radar = mapInfo && mapInfo.overlay === 'radar' ? mapInfo.radar : null;
      if (!onScreen(body)) report(hkey);
      else if (view.failedSince) report(hkey, 'Weerradar', false, `pagina laadt niet sinds ${zulu(view.failedSince)}`, 3 * 60000);
      else report(hkey, 'Weerradar', !radar || Date.now() - radar < 30 * 60000, radar ? `radarbeeld ${zulu(radar)}` : '', 2 * 60000);
    };
    const tick = setInterval(() => { (followUdp() || !mapInfo || Date.now() - lastPush > 15000 ? push() : paintStatus()); checkHealth(); }, 2000);
    paintStatus();
    // The gear: what the label beside each station shows, and whether every station shows at every zoom.
    const pop = h('div', { class: 'vr-pop wxm-pop', hidden: true });
    const opt = (label, control) => h('div', { class: 'wxm-opt' }, h('span', {}, label), control);
    const paintPop = () => {
      const f = wxFields(w.cfg);
      pop.replaceChildren(
        h('h4', {}, 'Labels'),
        opt('Indeling', segmented(WX_LAYOUTS, w.cfg.labelLayout === 'wide' ? 'wide' : 'stack', (v) => { w.cfg.labelLayout = v; save(); push(); })),
        opt('Plek', segmented(WX_PLACES, w.cfg.labelPos || 'auto', (v) => { w.cfg.labelPos = v; save(); push(); })),
        // Text size as the familiar row of ever larger letters; the names are in the tooltips.
        opt('Tekstgrootte', segmented(WX_SIZES.map((s, i) => ({ value: s.value, title: s.name, label: h('span', { class: 'wxm-a', style: `font-size:${(0.72 + i * 0.14).toFixed(2)}rem` }, 'A') })), String(+w.cfg.labelSize || 1), (v) => { w.cfg.labelSize = +v; save(); push(); })),
        h('p', {}, 'Labels wijken altijd uit voor elkaar en voor de bolletjes. Is er rond een bolletje geen vrije plek, dan blijft alleen de stationscode staan, of verdwijnt het label tot je met de muis op het bolletje staat.'),
        h('h4', {}, 'Bij elk meetstation'),
        ...Object.entries(WX_FIELDS).map(([k, d]) => h('label', { class: 'check', title: d.hint || null }, h('input', { type: 'checkbox', checked: !!f[k], onchange: (e) => { w.cfg.fields = { ...f, [k]: e.target.checked }; save(); push(); } }), d.name)),
        h('h4', {}, 'Stations'),
        h('label', { class: 'check', title: 'Standaard komen de kleinere stations en de platforms pas in beeld bij inzoomen' }, h('input', { type: 'checkbox', checked: !!w.cfg.allStations, onchange: (e) => { w.cfg.allStations = e.target.checked; save(); push(); } }), 'Alle stations op elk zoomniveau'),
        h('p', {}, 'De waarden komen uit de METAR van het station, elke minuut opgehaald bij aviationweather.gov; een station geeft elk half uur of elk uur een nieuwe METAR uit, bij een verandering een SPECI. Wolkenbasis volgens het BOM: de laagste laag van SCT of meer. Klik op een bolletje voor alle BOM-profielen, de trend en de METAR en TAF zelf.'));
    };
    const gear = h('button', { class: 'w-tool', title: 'Wat er bij elk meetstation staat: wolkenbasis, zicht, wind, temperatuur, QNH, trend…', onclick: () => { paintPop(); pop.hidden = !pop.hidden; } }, icon('gear'));
    const closePop = (e) => { if (!pop.hidden && !pop.contains(e.target) && !gear.contains(e.target)) pop.hidden = true; };
    document.addEventListener('pointerdown', closePop, true);
    body.append(pop);
    tools.append(prof, gear, recentreTool(keep), reloadTool(view));
    fit(keep.current());
    keep.attach(view);
    return {
      fresh: () => {
        const radar = mapInfo && mapInfo.overlay === 'radar' ? mapInfo.radar : null;
        const nl = wxFeed.stations.filter((s) => s.icao.startsWith('EH'));
        const newest = nl.length ? Math.max(...nl.map((s) => s.obsTime)) : 0;
        if (radar) return { t: radar, fail: !!view.failedSince, warn: 15 * 60000, bad: 30 * 60000, label: 'Radarbeeld', note: `Meetstations: nieuwste METAR ${newest ? zulu(newest) : '—'}, elke minuut opgehaald.` };
        return { t: newest, fail: !!view.failedSince || (wxFeed.fails > 0 && !wxFeed.lastOk), loading: !wxFeed.lastOk, warn: 40 * 60000, bad: 90 * 60000, label: 'Meetstations (nieuwste METAR)' };
      },
      destroy() { keep.stop(); unwatch(); clearInterval(tick); clearInterval(kick); clearInterval(watchdog); view.destroy(); report(hkey); document.removeEventListener('pointerdown', closePop, true); },
    };
  },
  form(cfg) {
    const overlay = h('select', { class: 'input' }, [['radar', 'Weerradar'], ['rain', 'Regen & onweer'], ['wind', 'Wind'], ['gust', 'Windstoten'], ['clouds', 'Bewolking'], ['lclouds', 'Lage bewolking'], ['cbase', 'Wolkenbasis'], ['visibility', 'Zicht'], ['temp', 'Temperatuur'], ['satellite', 'Satelliet'], ['thunder', 'Onweer']].map(([v, l]) => h('option', { value: v }, l)));
    overlay.value = cfg.overlay;
    const lat = textInput(cfg.lat), lon = textInput(cfg.lon), zoom = textInput(cfg.zoom);
    let autoplay = cfg.autoplay !== false;
    return {
      el: [field('Kaartlaag bij opstarten', overlay), h('div', { class: 'row' }, field('Breedtegraad', lat), field('Lengtegraad', lon), field('Zoom', zoom)), checkbox('Radar automatisch afspelen', autoplay, (v) => (autoplay = v))],
      // An untouched zoom keeps scaling with the widget; one filled in by hand is a whole Windy level, held exactly.
      read: () => { const def = WIDGETS.windy.defaults, z = parseFloat(zoom.value) || def.zoom, same = z === cfg.zoom; return { overlay: overlay.value, lat: parseFloat(lat.value) || def.lat, lon: parseFloat(lon.value) || def.lon, zoom: same ? z : Math.round(z), refH: same ? cfg.refH : null, autoplay }; },
    };
  },
});
