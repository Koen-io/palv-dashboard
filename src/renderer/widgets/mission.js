'use strict';

/* Mission Planning: de SOMP van de TACSOP, digitaal en gedeeld (opbouw in ../mission.js). */
defineWidget('mission', {
  desc: 'Scheme Of Maneuver Planning volgens de TACSOP AW139: alle fases en planborden invulbaar, met een checklist die in één oogopslag laat zien of de SOMP compleet is. Gedeeld met alle schermen.',
  icon: 'shield',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    const inst = mpCreate(body, w);
    return { fresh: () => null, destroy() { inst.destroy(); } };
  },
});
