'use strict';

/* Offshore: platforms, windparken, grenzen, kust en live AIS op één kaart (opbouw in ../offshore/os.js). */
defineWidget('offshore', {
  desc: 'De offshore-operatie op één kaart: alle platforms en windparken, helidekken, EEZ en 12-mijlsgrens, pijpleidingen en kabels, zeekaart, KNRM-stations, de eigen vloot, de Noordzee-weerstations en live AIS met scheepsdata, past tracks en foto\'s.',
  icon: 'globe',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    const inst = osCreate(body, w);
    return { fresh: () => null, destroy() { inst.destroy(); } };
  },
});
