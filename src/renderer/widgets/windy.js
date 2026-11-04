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
function wxCloudText(m) {
  const base = WX.lowestLayer(m, false);
  const few = WX.lowestLayer(m, true);
  if (base) return `${base.cover} ${base.base}${few && few.base < base.base ? ` <i>(FEW ${few.base})</i>` : ''}`;
  if (m.vv != null) return m.vv < 0 ? 'VV' : `VV ${m.vv}`;
  if (m.cloud === 'none' || m.cloud === 'layers') return few ? `geen <i>(FEW ${few.base})</i>` : m.cavok ? 'CAVOK' : 'NSC';
  return '//';
}
const wxVisText = (m) => (m.vis == null ? '' : m.cavok ? 'CAVOK' : m.vis >= 9999 ? '≥10 km' : m.vis >= 5000 ? `${(m.vis / 1000).toFixed(m.vis % 1000 ? 1 : 0).replace('.', ',')} km` : `${m.vis} m`);
function wxMarkerHtml(st, a, f, now) {
  const m = st.metar;
  const wind = WX.windText(m.wind);
  const line1 = [f.icao ? `<b>${escHtml(st.icao)}</b>` : '', f.name ? `<u>${escHtml(String(st.name || '').split(',')[0].replace(/\s+(Arpt|Airport)$/i, ''))}</u>` : '', f.wind && wind ? `<span>${wind}</span>` : '', a.aw139 ? '<em>AW139</em>' : ''].filter(Boolean).join('');
  const line2 = [
    f.cloud ? `<span title="Wolkenbasis (BOM)">☁ ${wxCloudText(m)}</span>` : '',
    f.layers && m.layers.length ? `<span>${m.layers.map((l) => `${l.cover}${String(l.base / 100).padStart(3, '0')}${l.type || ''}`).join(' ')}</span>` : '',
    f.vis && m.vis != null ? `<span title="Zicht">👁 ${wxVisText(m)}</span>` : '',
    f.wx && m.wx.length ? `<span>${escHtml(m.wx.join(' '))}</span>` : '',
    f.temp && m.temp != null ? `<span title="Temperatuur / dauwpunt">${m.temp}°/${m.dew == null ? '—' : m.dew + '°'}</span>` : '',
    f.qnh && m.qnh ? `<span>Q${m.qnh}</span>` : '',
    f.age ? `<span title="Waarnemingstijd">${zulu(st.obsTime)} · ${Math.max(0, Math.round((now - st.obsTime) / 60000))} min</span>` : '',
  ].filter(Boolean).join('');
  const lab = line1 || line2 ? `<span class="pw-lab${line2 ? ' two' : ''}">${f.trend ? wxArrow(a.trend) : ''}<span class="pw-l1">${line1}</span>${line2 ? `<span class="pw-l2">${line2}</span>` : ''}</span>` : '';
  return `<div class="pw ${a.status}"><span class="pw-dot"><svg viewBox="0 0 16 16">${WX_GLYPH[a.status]}</svg>${a.aw139 ? '<i class="pw-plus">+</i>' : ''}</span>${lab}</div>`;
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
    };
    map.on('zoomend', S.show);
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
    m.html = s.html; m.pop = s.pop; m.tier = s.tier;
  }
  for (const [id, m] of S.mk) if (!seen.has(id)) { map.removeLayer(m.l); S.mk.delete(id); }
  S.show();
  const info = { n: S.mk.size, radar: null, overlay: null };
  try { info.overlay = W.store.get('overlay'); const c = W.store.get('radarCalendar'); info.radar = (c && (c.refTimeTs || c.updateTs)) || null; } catch (e) {}
  return info;
}

const WX_CSS = `
.pw-icon{overflow:visible!important}
.pw{position:absolute;left:-11px;top:-11px;display:flex;align-items:center;white-space:nowrap;cursor:pointer;font:600 calc(12px * var(--pw-size, 1))/1 "Segoe UI",system-ui,sans-serif}
.pw-dot{position:relative;width:22px;height:22px;border-radius:50%;border:2px solid #fff;box-sizing:border-box;box-shadow:0 0 0 1.5px rgba(4,10,20,.85),0 2px 6px rgba(0,0,0,.6);display:grid;place-items:center;flex:none}
.pw-dot svg{width:14px;height:14px;fill:none;stroke:#04101e;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}
.pw.green .pw-dot{background:#2fd67b}.pw.amber .pw-dot{background:#ffb020}.pw.red .pw-dot{background:#ff4d42}.pw.none .pw-dot{background:#7c8aa0}
.pw.red .pw-dot svg,.pw.none .pw-dot svg{stroke:#fff}
.pw-plus{position:absolute;top:-8px;right:-8px;width:14px;height:14px;border-radius:50%;background:#38bdf8;color:#04101e;border:1.5px solid #04101e;font:800 12px/11px "Segoe UI",sans-serif;text-align:center;font-style:normal}
.pw-lab{display:flex;align-items:center;gap:5px;margin-left:5px;padding:4px 7px;border-radius:4px;background:rgba(7,13,24,.9);border:1px solid rgba(255,255,255,.2);color:#fff;letter-spacing:.02em;box-shadow:0 2px 6px rgba(0,0,0,.45)}
.pw-lab span{color:#c6d4e8;font-variant-numeric:tabular-nums}
.pw-lab.two{flex-direction:column;align-items:flex-start;gap:2px;padding:4px 7px 4px 7px;position:relative}
.pw-lab.two .pw-arr{position:absolute;left:5px;top:5px}.pw-lab.two:has(.pw-arr) .pw-l1,.pw-lab.two:has(.pw-arr) .pw-l2{padding-left:14px}
.pw-l1,.pw-l2{display:flex;align-items:center;gap:6px}.pw-l1 u{text-decoration:none;color:#fff;font-weight:500}
.pw-l2{font-weight:500;font-size:0.92em;color:#dce6f5}.pw-l2 span{color:#dce6f5}.pw-l2 i{font-style:normal;color:#ffb941}
.pw-lab em{font-style:normal;font-size:10px;font-weight:700;color:#7dd3fc}
.pw-arr{width:10px;height:12px;flex:none;stroke-width:1.5;stroke-linejoin:round}
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
      const stations = wxFeed.stations.map((st) => ({ id: st.icao, lat: st.lat, lon: st.lon, tier: wxTier(st.icao), html: wxMarkerHtml(st, WX.assess(pid, st, lastPush), f, lastPush), pop: wxPopupHtml(st, pid, lastPush) }));
      try { mapInfo = await view.wv.executeJavaScript(`(${wxInject})(${JSON.stringify({ scale, stations, all: !!w.cfg.allStations, size: +w.cfg.labelSize || 1 })})`); } catch { mapInfo = null; }
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
    const pop = h('div', { class: 'vr-pop', hidden: true });
    const paintPop = () => {
      const f = wxFields(w.cfg);
      pop.replaceChildren(
        h('h4', {}, 'Bij elk meetstation'),
        ...Object.entries(WX_FIELDS).map(([k, d]) => h('label', { class: 'check', title: d.hint || null }, h('input', { type: 'checkbox', checked: !!f[k], onchange: (e) => { w.cfg.fields = { ...f, [k]: e.target.checked }; save(); push(); } }), d.name)),
        h('h4', {}, 'Stations'),
        h('label', { class: 'check', title: 'Standaard komen de kleinere stations en de platforms pas in beeld bij inzoomen' }, h('input', { type: 'checkbox', checked: !!w.cfg.allStations, onchange: (e) => { w.cfg.allStations = e.target.checked; save(); push(); } }), 'Alle stations op elk zoomniveau'),
        h('h4', {}, 'Grootte van de labels'),
        segmented([{ value: '0.85', label: 'Klein' }, { value: '1', label: 'Normaal' }, { value: '1.25', label: 'Groot' }, { value: '1.5', label: 'Extra groot' }], String(+w.cfg.labelSize || 1), (v) => { w.cfg.labelSize = +v; save(); push(); }),
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
