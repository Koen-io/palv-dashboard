'use strict';

/* App-tegel: a shortcut that opens a program, a file or a website. */
defineWidget('tile', {
  desc: 'Snelkoppeling om een programma, bestand of website te openen.',
  icon: 'apps',
  size: [10, 9],
  chromeless: true,
  mount(w, body) {
    const iconEl = h('span', { class: 'tile-icon' }, w.cfg.icon ? h('img', { src: w.cfg.icon, alt: '' }) : icon(w.cfg.kind === 'url' ? 'globe' : 'apps'));
    body.append(
      h('button', { class: 'tile-btn', title: w.cfg.target || 'Nog niet ingesteld', onclick: async () => {
        if (editing) return;
        if (!w.cfg.target) return openWidgetConfig(w);
        const res = await window.palv.tile.launch(w.cfg);
        if (!res.ok) toast(`"${w.title}" kon niet worden geopend: ${res.error}`, true);
      } }, iconEl, h('span', { class: 'tile-label' }, w.title))
    );
    if (!w.cfg.icon && w.cfg.target) {
      window.palv.tile.icon(w.cfg).then((data) => {
        if (!data || !iconEl.isConnected) return;
        w.cfg.icon = data;
        iconEl.replaceChildren(h('img', { src: data, alt: '' }));
        save();
      }).catch(() => {});
    }
    return {};
  },
  form(cfg) {
    let kind = cfg.kind, iconData = cfg.icon;
    const target = textInput(cfg.target, { placeholder: kind === 'url' ? 'https://…' : APP_HINT });
    const args = textInput(cfg.args, { placeholder: 'Optioneel' });
    const browse = h('button', { class: 'btn', onclick: async () => {
      const res = await window.palv.tile.pickFile();
      if (!res) return;
      target.value = res.path;
      iconData = res.icon;
      const title = $('#cfg-title');
      if (title && (!title.value.trim() || title.value === 'App-tegel')) title.value = res.name;
    } }, icon('folder'), 'Bladeren…');
    const argsField = field('Opstartparameters', args);
    const sync = () => { browse.style.display = argsField.style.display = kind === 'url' ? 'none' : ''; target.placeholder = kind === 'url' ? 'https://…' : APP_HINT; };
    const seg = segmented([{ value: 'app', label: 'Programma of bestand', icon: 'apps' }, { value: 'url', label: 'Website', icon: 'globe' }], kind, (v) => { kind = v; iconData = null; sync(); });
    sync();
    return {
      el: [h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Soort'), seg), h('div', { class: 'row' }, field('Doel', target), browse), argsField],
      read: () => ({ kind, target: target.value.trim(), args: args.value.trim(), icon: target.value.trim() === cfg.target && kind === cfg.kind ? iconData : (iconData !== cfg.icon ? iconData : null) }),
    };
  },
});
