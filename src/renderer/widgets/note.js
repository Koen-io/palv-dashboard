'use strict';

/* Notitie: free text for announcements and notes. */
defineWidget('note', {
  desc: 'Vrij tekstvak voor dienstmededelingen of aantekeningen.',
  icon: 'note',
  size: [24, 18],
  mount(w, body) {
    body.append(h('textarea', { class: 'note-area', placeholder: 'Typ hier een notitie…', value: w.cfg.text, oninput: (e) => { w.cfg.text = e.target.value; save(); } }));
    return {};
  },
});
