'use strict';

/* METAR / TAF of an airfield of choice: the station is picked in the title bar, out of every station in
   and around the Netherlands that reports aviation weather. The body shows the same metrics, cloud base
   and BOM verdict as the Schiphol block in the header. */

// The Dutch stations as the crew knows them. Everything else that reports in the area (the live feed of
// the weather radar) is added by its own name, so a new station appears on its own.
const NL_STATIONS = [
  ['EHAM', 'Schiphol', 'civ'], ['EHRD', 'Rotterdam The Hague', 'civ'], ['EHEH', 'Eindhoven', 'civ'], ['EHGG', 'Groningen Eelde', 'civ'], ['EHBK', 'Maastricht Aachen', 'civ'], ['EHLE', 'Lelystad', 'civ'],
  ['EHKD', 'De Kooy', 'mil'], ['EHLW', 'Leeuwarden', 'mil'], ['EHVK', 'Volkel', 'mil'], ['EHGR', 'Gilze-Rijen', 'mil'], ['EHWO', 'Woensdrecht', 'mil'], ['EHDL', 'Deelen', 'mil'],
  ['EHVL', 'Vlieland', 'other'], ['EHFS', 'Vlissingen', 'other'],
  ['EHSA', 'Euro Platform', 'sea'], ['EHSC', 'Lichteiland Goeree', 'sea'], ['EHPG', 'P11-B platform', 'sea'], ['EHJR', 'K14-A platform', 'sea'], ['EHKV', 'K14-FA-1C platform', 'sea'], ['EHMG', 'L9-FF-1 platform', 'sea'], ['EHMA', 'AWG-1 platform', 'sea'],
  ['EHQS', 'Hollandse Kust Zuid heliport', 'sea'], ['EHQN', 'Hollandse Kust Noord heliport', 'sea'], ['EHQW', 'Hollandse Kust West heliport', 'sea'], ['EHSG', 'Borssele heliport', 'sea'],
];
const STATION_GROUPS = { civ: 'Luchthavens', mil: 'Militaire vliegbases', other: 'Overige stations', sea: 'Noordzee: platforms en windparken', abroad: 'Buurlanden' };
const COUNTRY = { EB: 'België', ED: 'Duitsland', ET: 'Duitsland', EK: 'Denemarken', EG: 'Verenigd Koninkrijk', LF: 'Frankrijk', EL: 'Luxemburg' };
// "Amsterdam/Schiphol Arpt, NH, NL" -> "Amsterdam/Schiphol"; "K14-A Sea, , NL" -> "K14-A platform".
function feedName(st) {
  const base = String(st.name || '').split(',')[0].replace(/\s+(Arpt|Airport|Intl|Island)$/i, '').trim();
  return /\sSea$/.test(base) ? base.replace(/\sSea$/, '') + ' platform' : base || st.icao;
}
// Every station to choose from, grouped: the known Dutch ones in their order, then whatever else the feed
// has seen, Dutch stations under "Overige", the rest per neighbouring country.
function stationChoices() {
  const known = new Map(NL_STATIONS.map(([icao, name, group]) => [icao, { icao, name, group }]));
  const list = [...known.values()];
  for (const st of [...wxFeed.stations].sort((a, b) => a.icao.localeCompare(b.icao))) {
    if (known.has(st.icao)) continue;
    const abroad = !st.icao.startsWith('EH');
    const group = abroad ? 'abroad' : /heliport|platform/i.test(feedName(st)) ? 'sea' : 'other';
    list.push({ icao: st.icao, name: feedName(st) + (abroad && COUNTRY[st.icao.slice(0, 2)] ? ` (${COUNTRY[st.icao.slice(0, 2)]})` : ''), group });
  }
  return list;
}
const stationName = (icao) => { const c = stationChoices().find((s) => s.icao === icao); return c ? c.name : icao; };

defineWidget('metar', {
  desc: 'Actueel luchtvaartweer en verwachting van een station naar keuze: alle luchthavens, vliegbases en Noordzeestations van Nederland.',
  icon: 'cloud',
  size: [30, 18],
  mount(w, body, tools) {
    const root = h('div', { class: 'wx-widget' }, h('div', { class: 'wx-wait' }, 'Luchtvaartweer wordt opgehaald…'));
    body.append(root);
    const data = { obsTime: 0, fail: false, fetchedAt: 0, res: null, history: [], seq: 0 };

    /* ---------- station picker in the title bar ---------- */
    const sel = h('select', { class: 'input wx-pick', title: 'Weerstation kiezen: alle stations in en om Nederland die luchtvaartweer (METAR) uitgeven' });
    let filled = '';
    const fillPicker = () => {
      const choices = stationChoices();
      const key = choices.map((c) => c.icao).join(',') + '|' + w.cfg.icao;
      if (key === filled) return;
      filled = key;
      const groups = new Map();
      for (const c of choices) { if (!groups.has(c.group)) groups.set(c.group, []); groups.get(c.group).push(c); }
      // A station typed by hand that the feed does not know (abroad, say) stays selectable.
      if (!choices.some((c) => c.icao === w.cfg.icao)) groups.set('cfg', [{ icao: w.cfg.icao, name: w.cfg.icao, group: 'cfg' }]);
      sel.replaceChildren(...[...groups].map(([g, items]) => h('optgroup', { label: STATION_GROUPS[g] || 'Ingesteld' }, items.map((c) => h('option', { value: c.icao }, `${c.icao} · ${c.name}`)))));
      sel.value = w.cfg.icao;
    };
    sel.addEventListener('change', () => {
      const icao = sel.value;
      if (!icao || icao === w.cfg.icao) return;
      w.cfg.icao = icao;
      w.title = stationName(icao);
      const frame = body.closest('.widget');
      for (const q of ['.w-title', '.w-edit-name']) { const el = frame && frame.querySelector(q); if (el) el.textContent = w.title; }
      save();
      plog('info', `METAR-widget op ${icao} (${w.title}) gezet`);
      Object.assign(data, { obsTime: 0, fail: false, res: null });
      data.history.length = 0;
      delete root.dataset.ok;
      root.replaceChildren(h('div', { class: 'wx-wait' }, `${icao} wordt opgehaald…`));
      load();
    });
    tools.append(sel);
    fillPicker();
    const unwatch = watchWx(fillPicker);

    /* ---------- body ---------- */
    const paint = () => {
      const res = data.res;
      if (!res) return;
      const now = Date.now();
      const st = WX.station(res.icao, res.raw, res.obsTime, res.taf, data.history, now, { name: res.name });
      const p = st.metar;
      root.replaceChildren(
        h('div', { class: 'wx-top' },
          h('span', { class: 'wx-icao' }, res.icao),
          res.fltCat ? h('span', { class: 'cat ' + res.fltCat, title: 'Vliegcategorie volgens de Amerikaanse indeling van aviationweather.gov (plafond BKN/OVC en zicht). Zegt niets over de BOM-minima: zie de toetsing ernaast.' }, res.fltCat) : null,
          h('span', { class: 'wx-name' }, feedName({ icao: res.icao, name: res.name })),
          h('div', { class: 'wx-bom' }, bomChips(st, now))),
        metarMetrics(p, 'wx-metrics'),
        h('div', { class: 'wx-raw' }, h('h4', {}, 'METAR'), h('pre', {}, res.raw)),
        res.taf ? h('div', { class: 'wx-raw' }, h('h4', {}, 'TAF'), h('pre', {}, res.taf.replace(/\s+(BECMG|TEMPO|PROB\d{2}|FM\d{6})/g, '\n  $1').replace(/\n\s+(PROB\d{2})\n\s+(TEMPO)/g, '\n  $1 $2'))) : h('div', { class: 'wx-raw' }, h('h4', {}, 'TAF'), h('p', { class: 'wx-none' }, 'Dit station geeft geen TAF uit.'))
      );
    };
    const load = async () => {
      const seq = ++data.seq;
      const icao = w.cfg.icao;
      const res = await window.palv.data.metar(icao).catch(() => ({ ok: false, error: 'Geen verbinding' }));
      if (seq !== data.seq) return; // the station was changed while this answer was on its way
      data.fail = !res.ok;
      if (res.ok) Object.assign(data, { obsTime: res.obsTime, fetchedAt: res.fetchedAt });
      if (!res.ok) {
        if (!root.dataset.ok) root.replaceChildren(h('div', { class: 'wx-wait' }, h('b', {}, icao), res.error || 'Niet beschikbaar'));
        return;
      }
      root.dataset.ok = '1';
      data.res = res;
      rememberObs(data.history, res);
      paint();
    };
    load();
    const timer = setInterval(load, 60000);
    // A new BOM period (day or night by the UDP) shows at once, not at the next fetch.
    periodWatchers.add(paint);
    return {
      fresh: () => ({ t: data.obsTime, fail: data.fail, loading: !data.obsTime && !data.fail, warn: 40 * 60000, bad: 75 * 60000, label: `METAR ${w.cfg.icao} (waarnemingstijd)`, note: `Elke minuut opgehaald${data.fetchedAt ? `, laatst ${zuluSec(data.fetchedAt)}` : ''}. Een vliegveld geeft elk half uur of elk uur een nieuwe METAR uit.` }),
      destroy: () => { clearInterval(timer); periodWatchers.delete(paint); unwatch(); },
    };
  },
  form(cfg) {
    const icao = textInput(cfg.icao, { maxlength: 4, style: 'text-transform:uppercase' });
    return { el: [field('ICAO-code station', icao, 'De Nederlandse stations kies je ook in de titelbalk van de widget. Hier kan elke ICAO-code ter wereld, bijvoorbeeld EBBR of EDDL.')], read: () => ({ icao: (icao.value.trim().toUpperCase() || 'EHAM') }) };
  },
});
