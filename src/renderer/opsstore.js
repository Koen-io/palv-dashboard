'use strict';

/* ============================================================
   De gedeelde bestanden van de eenheid in de renderer: timers, whiteboards en missies (en de routes en
   profielen van Zoek & Plan), plus het live-kanaal tussen de schermen.
   ============================================================ */
// One copy of every shared file (src/plan/store.js) for all tabs. A change made here shows at once
// (optimistically) and goes to the main process, which writes it and tells the other screens; a change
// from another screen comes in through `plan:store` and is passed to whoever listens for that kind.
// Items are { id, ...fields, updatedAt }; a removed item is simply gone from the lists.
const OPS = {
  data: { private: { profiles: {}, decks: {}, keys: {}, docs: {} }, shared: { routes: {}, favorites: {}, bases: {} }, ops: { timers: {}, presets: {} }, boards: { boards: {}, elements: {} }, missions: { missions: {}, fields: {} } },
  loaded: false,
  subs: new Map(),
  liveSubs: new Set(),
  screen: { id: null, name: '' },
  uid: () => Math.random().toString(36).slice(2, 10),

  async load() {
    try {
      const st = await window.palv.plan.store();
      for (const [k, v] of Object.entries(st || {})) if (v && typeof v === 'object') OPS.data[k] = v;
      OPS.loaded = true;
      for (const k of Object.keys(OPS.data)) OPS.emit(k);
    } catch { /* the main process is still starting; the store event comes later */ }
    try {
      const info = await window.palv.screens.info();
      const me = (info.list || []).find((s) => s.self);
      OPS.screen = { id: me ? me.id : null, name: info.name || (me && me.name) || '' };
    } catch { /* keep the empty one */ }
  },
  list(kind, list) {
    const d = OPS.data[kind] && OPS.data[kind][list];
    return d ? Object.entries(d).filter(([, it]) => it && !it.deleted).map(([id, it]) => ({ id, ...it })) : [];
  },
  get(kind, list, id) {
    const it = OPS.data[kind] && OPS.data[kind][list] && OPS.data[kind][list][id];
    return it && !it.deleted ? { id, ...it } : null;
  },
  // Set (item) or remove (null) one item: shown at once, saved and passed on in the background.
  put(kind, list, id, item) {
    const d = OPS.data[kind] && OPS.data[kind][list];
    if (!d) return Promise.resolve(null);
    const rest = { ...(item || {}) }; delete rest.id;
    if (item == null) delete d[id]; else d[id] = { ...rest, updatedAt: Date.now() };
    OPS.emit(kind, { list, id, local: true });
    return window.palv.plan.put(kind, list, id, item == null ? null : rest).catch((err) => { plog('warn', `opslaan ${kind}/${list} mislukt`, String(err)); return null; });
  },
  putMany(kind, items) {
    const kd = OPS.data[kind];
    if (!kd) return Promise.resolve(null);
    const clean = [];
    for (const { list, id, item } of items) {
      if (!kd[list] || id == null) continue;
      const rest = { ...(item || {}) }; delete rest.id;
      if (item == null) delete kd[list][id]; else kd[list][id] = { ...rest, updatedAt: Date.now() };
      clean.push({ list, id, item: item == null ? null : rest });
    }
    OPS.emit(kind, { many: true, local: true });
    return window.palv.plan.putMany(kind, clean).catch((err) => { plog('warn', `opslaan ${kind} mislukt`, String(err)); return null; });
  },
  on(kind, fn) {
    if (!OPS.subs.has(kind)) OPS.subs.set(kind, new Set());
    OPS.subs.get(kind).add(fn);
    return () => OPS.subs.get(kind).delete(fn);
  },
  emit(kind, what) { for (const fn of OPS.subs.get(kind) || []) { try { fn(what || {}); } catch (err) { plog('warn', `bijwerken ${kind} mislukt`, String(err && err.stack || err)); } } },

  /* ---------- live: volatile messages to the other screens (never stored) ---------- */
  live(msg) { return window.palv.plan.live({ ...msg, s: OPS.screen.id, n: OPS.screen.name }).catch(() => false); },
  onLive(fn) { OPS.liveSubs.add(fn); return () => OPS.liveSubs.delete(fn); },
};
window.palv.plan.onStore((msg) => {
  if (!msg || !msg.kind || !msg.data) return;
  OPS.data[msg.kind] = msg.data;
  OPS.loaded = true;
  OPS.emit(msg.kind, { remote: true });
});
window.palv.plan.onLive((msg) => { for (const fn of OPS.liveSubs) { try { fn(msg); } catch { /* one listener */ } } });
OPS.load();
