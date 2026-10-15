'use strict';

/* METAR / TAF of an airfield of choice. */
defineWidget('metar', {
  desc: 'Actueel luchtvaartweer en verwachting voor een vliegveld naar keuze.',
  icon: 'cloud',
  size: [30, 18],
  mount(w, body) {
    const root = h('div', { class: 'wx-widget' }, 'Laden…');
    body.append(root);
    const data = { obsTime: 0, fail: false, fetchedAt: 0 };
    const load = async () => {
      const res = await window.palv.data.metar(w.cfg.icao).catch(() => ({ ok: false, error: 'Geen verbinding' }));
      data.fail = !res.ok;
      if (res.ok) Object.assign(data, { obsTime: res.obsTime, fetchedAt: res.fetchedAt });
      if (!res.ok) {
        if (!root.dataset.ok) root.replaceChildren(h('div', { class: 'wx-head' }, h('span', { class: 'wx-icao' }, w.cfg.icao)), res.error || 'Niet beschikbaar');
        return;
      }
      root.dataset.ok = '1';
      root.replaceChildren(
        h('div', { class: 'wx-head' }, h('span', { class: 'wx-icao' }, res.icao), res.fltCat ? h('span', { class: 'cat ' + res.fltCat }, res.fltCat) : null, h('span', { class: 'wx-name' }, (res.name || '').split(',')[0])),
        (() => {
          const p = parseMetar(res.raw), ds = p.temp != null ? dewSpread(p.temp, p.dew) : null;
          return ds ? h('div', { class: 'dew wx-dew ' + ds.level, title: 'Verschil tussen temperatuur en dauwpunt. Bij 3 °C of minder is de lucht bijna verzadigd en kan mist of lage bewolking ontstaan.' },
            h('span', { class: 'dew-dot' }), `Temp ${p.temp}° · dauwpunt ${p.dew}° · Δ ${ds.spread}°`, h('span', { class: 'dew-rh' }, `RV ${ds.rh}%`), ds.word ? h('b', {}, ds.word) : null) : null;
        })(),
        h('div', {}, h('h4', {}, 'METAR'), h('pre', {}, res.raw)),
        res.taf ? h('div', {}, h('h4', {}, 'TAF'), h('pre', {}, res.taf.replace(/\s+(BECMG|TEMPO|PROB\d{2}|FM\d{6})/g, '\n  $1').replace(/\n\s+(PROB\d{2})\n\s+(TEMPO)/g, '\n  $1 $2'))) : null
      );
    };
    load();
    const timer = setInterval(load, 60000);
    return {
      fresh: () => ({ t: data.obsTime, fail: data.fail, loading: !data.obsTime && !data.fail, warn: 40 * 60000, bad: 75 * 60000, label: `METAR ${w.cfg.icao} (waarnemingstijd)`, note: `Elke minuut opgehaald${data.fetchedAt ? `, laatst ${zuluSec(data.fetchedAt)}` : ''}. Een vliegveld geeft elk half uur of elk uur een nieuwe METAR uit.` }),
      destroy: () => clearInterval(timer),
    };
  },
  form(cfg) {
    const icao = textInput(cfg.icao, { maxlength: 4, style: 'text-transform:uppercase' });
    return { el: [field('ICAO-code vliegveld', icao, 'Bijvoorbeeld EHAM, EHRD, EHGG, EHBK, EHEH, EHLE of EHKD.')], read: () => ({ icao: (icao.value.trim().toUpperCase() || 'EHAM') }) };
  },
});
