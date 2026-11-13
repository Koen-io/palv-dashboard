// What one screen fetched of the shared files of another, per screen and kind ("<screen>|<kind>").
// Normally only what changed after the newest item seen so far (`since`). When such a fetch comes back
// empty while the files still differ, the other screen holds items it got later from a third screen
// with an older time (a drawing made on a screen this one could not reach just then): those only come
// with a full fetch, at most once every `fullMs` per screen and kind.
function syncTracker({ fullMs = 120000, now = () => Date.now() } = {}) {
  const st = new Map(); // key → { since, stalled, fullAt }
  const of = (key) => st.get(key) || { since: 0, stalled: false, fullAt: 0 };
  return {
    since(key) {
      const s = of(key);
      return s.since && s.stalled && now() - s.fullAt > fullMs ? 0 : s.since;
    },
    // After a fetch with `since`: what came (the lists of items) and whether it changed anything here.
    done(key, since, data, changed) {
      const s = of(key);
      let newest = s.since, n = 0;
      for (const l of Object.values(data || {})) for (const it of Object.values(l || {})) { n += 1; if (it && it.updatedAt > newest && it.updatedAt < now() + 864e5) newest = it.updatedAt; }
      // Only a full fetch made because of a stall counts for the two minutes (not the very first one).
      st.set(key, { since: newest, stalled: !changed && !n && since > 0, fullAt: !since && s.stalled ? now() : s.fullAt });
    },
    forget(key) { st.delete(key); },
  };
}
module.exports = { syncTracker };
