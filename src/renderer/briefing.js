'use strict';

/* ============================================================
   Briefings
   Which briefing is coming up and how close it is: from 5 minutes before (orange) and from 1:30 before
   (red, with the sound) until a minute after the start. Times are local time of this computer.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BRIEFING = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const WARN_S = 300;   // the first pop-up and the orange glow
  const ALERT_S = 90;   // the sound, the second pop-up and the red glow
  const AFTER_S = 60;   // "begint nu" stays this long

  const parse = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m && +m[1] < 24 && +m[2] < 60 ? [+m[1], +m[2]] : null; };

  // The briefing in its window right now, the nearest start first: { b, at, left (s), phase, key }
  // with phase 'warn' (5:00 to 1:30), 'alert' (1:30 to the start) or 'now' (the first minute after it).
  function current(list, now = Date.now()) {
    let best = null;
    for (const b of list || []) {
      const hm = b && b.on !== false && parse(b.time);
      if (!hm) continue;
      for (const dayShift of [-1, 0, 1]) {
        const d = new Date(now);
        d.setDate(d.getDate() + dayShift);
        d.setHours(hm[0], hm[1], 0, 0);
        const left = (d.getTime() - now) / 1000;
        if (left > WARN_S || left <= -AFTER_S) continue;
        if (best && Math.abs(best.left) <= Math.abs(left)) continue;
        const phase = left > ALERT_S ? 'warn' : left > 0 ? 'alert' : 'now';
        best = { b, at: d.getTime(), left, phase, key: `${b.id}@${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` };
      }
    }
    return best;
  }

  // 4:59, 1:30, 0:07.
  const clock = (s) => { const n = Math.max(0, Math.ceil(s)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };

  return { WARN_S, ALERT_S, AFTER_S, parse, current, clock };
});
