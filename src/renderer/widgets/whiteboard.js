'use strict';

/* Whiteboard: tekenen, tekst en operationele iconen, live gedeeld met alle schermen (opbouw in ../whiteboard/wb.js). */
defineWidget('whiteboard', {
  desc: 'Snel aantekeningen maken met pen, markeerstift, vormen, pijlen, tekst en een bibliotheek met operationele iconen (helikopters, voertuigen, vaartuigen, platforms, tactische symbolen). Werkt op het touchscreen, zoomt met twee vingers, en elk bord staat live op alle schermen.',
  icon: 'note',
  size: [96, 54],
  chromeless: true,
  mount(w, body) {
    const inst = wbCreate(body, w);
    return { fresh: () => null, destroy() { inst.destroy(); } };
  },
});
