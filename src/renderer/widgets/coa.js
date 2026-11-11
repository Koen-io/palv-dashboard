'use strict';

/* COA Planner: de wind boven een schip voor vier Courses of Approach (opbouw in ../coa/coa.js). */
defineWidget('coa', {
  desc: 'Snel en precies de relatieve wind boven een schip voor de vier Courses of Approach rond de Assault Track: in ware en magnetische graden en rood/groen vanaf de boeg, met wat de heli op de AT voelt, de zee en het weer op de positie van het schip, zon en maan (ook als verblinding op de nadering), de hoogte-deconflictie, tekenen op de planning en een A5-kniebordkaart. Gedeeld met alle schermen.',
  icon: 'target',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    const inst = coaCreate(body, w);
    return { fresh: () => null, destroy() { inst.destroy(); } };
  },
});
