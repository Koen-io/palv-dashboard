'use strict';

/* Zoek & Plan: navigatie en planning voor EC135 en AW139 op één kaart (opbouw in ../plan/zp*.js). */
defineWidget('plan', {
  desc: 'Navigatie en vluchtplanning voor EC135 en AW139: zoeken met aanvullen, route met wind en brandstof, meetlint, afstandsringen, luchtruim, platforms, live vloot, zoekpatronen en briefing.',
  icon: 'route',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    const zp = zpCreate(body, w);
    const ro = new ResizeObserver(() => zp.fit());
    ro.observe(body);
    return {
      fresh: () => null,
      destroy() { ro.disconnect(); zp.destroy(); },
    };
  },
});
