'use strict';

/* Website: any web page in a scalable window. */
defineWidget('web', {
  desc: 'Toon een willekeurige website in een schaalbaar venster.',
  icon: 'globe',
  size: [36, 30],
  mount(w, body, tools) {
    const view = makeWebview(body, () => normalizeUrl(w.cfg.url));
    tools.append(reloadTool(view));
    const timer = w.cfg.refreshMin > 0 ? setInterval(() => view.load(), w.cfg.refreshMin * 60000) : null;
    return { fresh: pageFresh(view, 'Website', w.cfg.refreshMin), destroy() { clearInterval(timer); view.destroy(); } };
  },
  form(cfg) {
    const url = textInput(cfg.url, { placeholder: 'https://…' }), refresh = textInput(cfg.refreshMin, { type: 'number', min: 0 });
    return {
      el: [field('Webadres', url), field('Automatisch vernieuwen (minuten)', refresh, '0 = niet automatisch vernieuwen.')],
      read: () => ({ url: url.value.trim(), refreshMin: Math.max(0, parseInt(refresh.value, 10) || 0) }),
    };
  },
});
