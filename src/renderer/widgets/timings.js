'use strict';

/* Timings: timers, wekkers en positietimers van de eenheid, op alle schermen tegelijk (opbouw in ../timings.js). */
defineWidget('timings', {
  desc: 'Timers, wekkers en positietimers voor een missie of dienst, met waarschuwing vooraf, geluid en pop-up; gedeeld met alle schermen. Met de L-uur ketting uit de TACSOP.',
  icon: 'clock',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    const inst = tmCreate(body, w);
    return { fresh: () => null, destroy() { inst.destroy(); } };
  },
});
