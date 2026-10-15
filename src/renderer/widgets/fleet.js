'use strict';

/* In de lucht: the own units that are flying now, live, every second. */
const fleetViews = new Set();
function fleetHealth() {
  if (!fleetViews.size) return report('fleet');
  const d = trafficFeed.snap && trafficFeed.snap.fleet;
  report('fleet', 'In de lucht', !!(d && d.ok), d && d.lastOk ? `laatst ${zulu(d.lastOk)}` : 'geen verbinding', 2 * 60000);
}

const flightTime = (ms) => { const m = Math.max(0, Math.floor(ms / 60000)); return `${Math.floor(m / 60)}:${pad2(m % 60)}`; };
// Which own units a widget shows: per category, and per unit within it.
const fleetGroupsOf = (cfg) => (Array.isArray(cfg.groups) ? cfg.groups : Object.keys(FLEET_GROUPS));
const fleetShows = (cfg, a) => fleetGroupsOf(cfg).includes(a.group) && !(cfg.hide || []).includes(a.hex) && (cfg.ground !== false || !a.onGround);

function renderFleet(root, w) {
  const d = trafficFeed.snap && trafficFeed.snap.fleet, now = Date.now();
  const list = d ? d.aircraft.filter((a) => fleetShows(w.cfg, a)) : [];
  // The rows are only rebuilt when something in them changes; the line below them follows every second.
  const sig = JSON.stringify([!!d, list.map((a) => [a.hex, a.flight, a.alt, a.gs, a.vs != null && Math.abs(a.vs) >= 300 ? Math.sign(a.vs) : 0, a.onGround, a.squawk, a.emergency, a.takeoff, a.approx, a.atLeast]), Math.floor(now / 60000)]);
  if (root.dataset.sig !== sig || !root.firstChild) {
    root.dataset.sig = sig;
    const rows = list.map((a) => {
      const alert = a.emergency || /^(7500|7600|7700)$/.test(a.squawk || '');
      const climb = a.vs == null || Math.abs(a.vs) < 300 ? '' : a.vs > 0 ? ' ▲' : ' ▼';
      const unit = UNIT_NAMES(a.hex);
      const reg = a.reg || (unit && unit.reg), type = a.type || (unit && unit.type);
      const time = a.onGround
        ? h('div', { class: 'fl-time' }, h('span', { class: 'fl-ground' }, 'GROND'))
        : h('div', { class: 'fl-time', title: a.approx ? (a.atLeast ? 'Was al in de lucht toen het dashboard startte; vliegt minstens zo lang.' : 'Starttijd niet uit de route te halen; geteld vanaf de eerste waarneming.') : `Gestart om ${zulu(a.takeoff)}` },
          h('b', {}, (a.atLeast ? '≥ ' : a.approx ? '≈ ' : '') + flightTime(now - a.takeoff)),
          h('small', {}, a.atLeast ? 'vliegtijd' : `start ${zulu(a.takeoff)}`));
      return h('div', { class: 'fl-row ' + a.group + (a.onGround ? ' ground' : '') + (alert ? ' alert' : ''), 'data-hex': a.hex },
        h('i', { class: 'fl-bar' }),
        h('div', { class: 'fl-id' }, h('b', {}, a.flight || reg || a.hex.toUpperCase()), h('small', {}, [a.flight && reg ? reg : null, type, FLEET_GROUPS[a.group]].filter(Boolean).join(' · '))),
        alert ? h('span', { class: 'fl-sq' }, a.emergency ? a.emergency.toUpperCase() : a.squawk) : null,
        h('div', { class: 'fl-num' }, h('b', {}, a.alt == null ? '—' : a.alt.toLocaleString('nl-NL')), h('small', {}, 'ft' + climb)),
        h('div', { class: 'fl-num fl-gs' }, h('b', {}, a.gs == null ? '—' : a.gs), h('small', {}, 'kt')),
        time);
    });
    root.replaceChildren(
      h('div', { class: 'fl-list' }, rows.length ? rows : h('div', { class: 'fl-empty' }, icon('shield'), h('span', {}, d ? 'Geen eigen toestellen in de lucht' : 'Gegevens worden opgehaald…'))),
      h('div', { class: 'fl-src', title: 'Eigen eenheden uit de lijsten onder Instellingen › Eigen eenheden; kies met het tandwiel welke deze widget toont. Dezelfde live gegevens als de Vluchtradar: adsb.fi elke seconde, aangevuld met adsb.lol. De starttijd komt uit de gevlogen route bij ADS-B Exchange; ≈ betekent geteld vanaf de eerste waarneming.' }, h('span', { class: 'dot' }), h('span', { class: 'fl-src-text' }), h('span', { class: 'fl-count' }))
    );
  }
  // Every second: the age of each row's message, and whether the feed itself is live.
  for (const row of root.querySelectorAll('.fl-row')) {
    const a = list.find((x) => x.hex === row.dataset.hex);
    if (!a) continue;
    const unit = UNIT_NAMES(a.hex);
    row.title = `${a.reg || (unit && unit.reg) || a.hex.toUpperCase()}${a.type ? ' · ' + a.type : ''} · ${FLEET_GROUPS[a.group] || ''}${a.squawk ? ' · squawk ' + a.squawk : ''} · laatste bericht ${Math.max(0, (now - a.msgAt) / 1000).toFixed(1).replace('.', ',')} s geleden via ${a.src || '—'}`;
    row.classList.toggle('stale', now - a.msgAt > 20000);
  }
  const dot = root.querySelector('.fl-src .dot'), text = root.querySelector('.fl-src-text'), count = root.querySelector('.fl-count');
  if (!dot) return;
  const up = list.filter((a) => !a.onGround).length;
  const followed = Object.keys(FLEET_GROUPS).filter((g) => fleetGroupsOf(w.cfg).includes(g)).flatMap((g) => hexList(g)).filter((x) => !(w.cfg.hide || []).includes(x)).length;
  if (!d) { dot.className = 'dot warn'; text.textContent = 'Laden…'; }
  else if (!d.ok) { dot.className = 'dot bad'; text.textContent = d.lastOk ? `Geen verbinding · laatst ${zulu(d.lastOk)}` : 'Geen verbinding met live-bron'; }
  else { dot.className = 'dot' + (now - d.lastOk > 5000 ? ' warn' : ''); text.textContent = `Live · ${zuluSec(d.lastOk)} · ${followed} eenheden gevolgd`; }
  count.textContent = up ? `${up} in de lucht` : '';
}

defineWidget('fleet', {
  desc: 'Eigen eenheden die nu vliegen (politie, trauma, kustwacht), met hoogte, snelheid en vliegtijd — live, elke seconde.',
  icon: 'shield',
  size: [24, 18],
  mount(w, body, tools) {
    const root = h('div', { class: 'fl-widget' });
    body.append(root);
    const paint = () => { renderFleet(root, w); fleetHealth(); };
    fleetViews.add(paint);
    paint();
    const unwatch = watchTraffic(paint);
    const tick = setInterval(paint, 1000); // ages and flight times run on between rounds
    tools.append(h('button', { class: 'w-tool', title: 'Instellingen: kies welke eigen eenheden deze widget toont', onclick: () => openWidgetConfig(w) }, icon('gear')));
    return {
      fresh: () => {
        const d = trafficFeed.snap && trafficFeed.snap.fleet;
        return { t: d && d.lastOk, fail: !!d && !d.ok, loading: !d, warn: 5000, bad: 30000, seconds: true, label: 'Live posities eigen eenheden' };
      },
      destroy() { unwatch(); clearInterval(tick); fleetViews.delete(paint); fleetHealth(); },
    };
  },
  // Categories with their units: a category switched off hides all of its units, a unit switched off
  // only itself. The lists themselves are kept under Instellingen > Eigen eenheden.
  form(cfg) {
    const groups = new Set(fleetGroupsOf(cfg)), hide = new Set(cfg.hide || []);
    let ground = cfg.ground !== false;
    const sections = Object.entries(FLEET_GROUPS).map(([key, label]) => {
      const units = hexList(key);
      const boxes = units.map((hex) => {
        const n = UNIT_NAMES(hex);
        const box = h('input', { type: 'checkbox', checked: !hide.has(hex), onchange: (e) => { e.target.checked ? hide.delete(hex) : hide.add(hex); paint(); } });
        return { hex, box, el: h('label', { class: 'check fl-unit' }, box, h('b', {}, n ? n.reg : hex.toUpperCase()), h('span', {}, n ? [n.type, hex.toUpperCase()].filter(Boolean).join(' · ') : 'registratie nog onbekend')) };
      });
      const all = h('input', { type: 'checkbox', onchange: (e) => {
        if (e.target.checked) { groups.add(key); units.forEach((x) => hide.delete(x)); } else groups.delete(key);
        paint();
      } });
      const list = h('div', { class: 'fl-units' }, boxes.length ? boxes.map((b) => b.el) : h('span', { class: 'hint' }, 'Geen eenheden in deze lijst.'));
      const paint = () => {
        const on = groups.has(key), shown = units.filter((x) => !hide.has(x)).length;
        all.checked = on && shown > 0;
        all.indeterminate = on && shown > 0 && shown < units.length;
        list.classList.toggle('off', !on);
        boxes.forEach((b) => { b.box.checked = !hide.has(b.hex); b.box.disabled = !on; });
      };
      paint();
      return h('div', { class: 'fl-cat ' + key }, h('label', { class: 'check fl-cat-head' }, all, h('i', { class: 'fl-bar' }), label, h('small', {}, `${units.length} eenheden`)), list);
    });
    return {
      el: [
        h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Eenheden in deze widget'), h('div', { class: 'fl-cats' }, sections),
          h('div', { class: 'hint' }, 'Vink een categorie of losse eenheden aan of uit. De lijsten met Mode-S-codes zelf beheer je onder Instellingen › Eigen eenheden.')),
        checkbox('Ook eenheden op de grond tonen (nog gezien na de landing)', ground, (v) => (ground = v)),
      ],
      read: () => ({ groups: Object.keys(FLEET_GROUPS).filter((k) => groups.has(k)), hide: [...hide], ground }),
    };
  },
});
