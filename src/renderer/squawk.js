'use strict';

/* ============================================================
   Noodsquawk: wanneer een toestel echt in nood is
   Los van de rest van de renderer, zodat het apart te toetsen is (`node --test`).

   De open ADS-B-bronnen geven af en toe een losse, verminkte melding door: één bericht met squawk 7700
   of een "noodtoestand" (nordo, downed ...) in de ADS-B-status, terwijl er niets aan de hand is. Eén
   zo'n bericht mag nooit een melding geven. Daarom:
   - alleen de squawk (Mode A) telt: 7500, 7600 of 7700. De losse noodstatus uit ADS-B wordt niet
     gebruikt; in de praktijk zendt een toestel in nood ook de squawk uit, en de valse meldingen van
     16 oktober 2026 kwamen juist allemaal van die status;
   - de code moet minstens 30 seconden en in minstens 5 verschillende berichten gezien zijn, zonder dat
     er tussendoor een gewone squawk kwam. Een gewone squawk zet de telling terug op nul;
   - het toestel vliegt (niet op de grond) en de positie is hooguit een minuut oud;
   - de melding bovenin geldt alleen binnen FIR Amsterdam (het Nederlandse luchtruim). Een bevestigd
     toestel daarbuiten wordt alleen op de Vluchtradar rood gemaakt;
   - de melding verdwijnt na twee berichten met een gewone squawk, of als het toestel een minuut
     niets meer van zich laat horen.
   ============================================================ */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SQUAWK = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const MEANING = { 7500: 'Kaping / wederrechtelijke inmenging', 7600: 'Radioverbinding verloren', 7700: 'Noodsituatie' };
  const CONFIRM_MS = 30000;  // zo lang moet de code al gezien zijn
  const CONFIRM_MSGS = 5;    // in zoveel verschillende berichten
  const CLEAR_MSGS = 2;      // zoveel berichten met een gewone squawk beëindigen een melding
  const POS_MAX_MS = 60000;  // oudere posities tellen niet
  const GONE_MS = 60000;     // zo lang niets gehoord: weg

  // FIR Amsterdam volgens de AIP Nederland, ENR 2.1 (AIRAC AMDT 10-2026). De land- en zeegrens met
  // Duitsland en België volgt de grens zoals de AIP die noemt, hier met tussenpunten op een paar km nauwkeurig.
  const FIR = [
    [55.0, 5.0], [55.0, 6.5], [53.6667, 6.5], [53.5667, 6.6], [53.5167, 6.6667], [53.5, 6.75], [53.5, 6.8167],
    [53.4667, 6.8667], [53.4, 6.95], [53.3333, 7.0], [53.3167, 7.0333], [53.3, 7.2], [53.2167, 7.2167],
    // langs de Nederlands-Duitse grens
    [53.0, 7.2], [52.85, 7.07], [52.64, 7.05], [52.45, 7.03], [52.38, 7.07], [52.24, 7.06], [52.1, 6.75],
    [51.97, 6.83], [51.85, 6.38], [51.87, 6.1], [51.85, 5.97], [51.73, 5.95], [51.55, 6.1], [51.4, 6.22],
    [51.18, 6.08], [51.06, 5.87], [50.97, 6.03], [50.83, 6.03], [50.75, 6.0167],
    // langs de Nederlands-Belgische grens
    [50.76, 5.69], [51.0, 5.77], [51.15, 5.85], [51.22, 5.53], [51.3, 5.24], [51.43, 5.0], [51.48, 4.8],
    [51.45, 4.6], [51.48, 4.38], [51.36, 4.25], [51.27, 3.95], [51.21, 3.6], [51.28, 3.38], [51.3667, 3.3667],
    // over zee terug naar het begin
    [51.5, 2.0],
  ];

  function inFir(lat, lon) {
    let inside = false;
    for (let i = 0, j = FIR.length - 1; i < FIR.length; j = i++) {
      const [yi, xi] = FIR[i], [yj, xj] = FIR[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const emergencyCode = (sq) => (/^(7500|7600|7700)$/.test(sq || '') ? sq : null);
  // A squawk that says "nothing wrong": four octal digits that are not an emergency code. No squawk at all
  // (not received yet, or a source that does not know it) says nothing either way.
  const normalCode = (sq) => /^[0-7]{4}$/.test(sq || '') && !emergencyCode(sq);

  // One watch for the whole dashboard: feed it every round of the traffic feed, it keeps per aircraft
  // how long and how often the code has been seen.
  function createWatch() {
    const track = new Map(); // hex -> { code, firstAt, hits, lastMsg, clear, confirmed, since, a }

    function update(list, now) {
      const started = [], ended = [];
      const present = new Set();
      for (const a of list || []) {
        if (!a || !a.hex) continue;
        present.add(a.hex);
        let t = track.get(a.hex);
        const msgAt = a.msgAt || 0;
        if (t && msgAt <= t.lastMsg) { t.a = a; continue; } // nothing new from this aircraft
        const code = emergencyCode(a.squawk);
        const usable = a.alt !== 'ground' && a.lat != null && a.lon != null && now - (a.posAt || 0) <= POS_MAX_MS;
        if (code && usable) {
          if (!t || t.code !== code) {
            if (t && t.confirmed) ended.push(t);
            t = { code, firstAt: msgAt, hits: 0, lastMsg: 0, clear: 0, confirmed: false, since: null, a };
            track.set(a.hex, t);
          }
          t.hits += 1;
          t.clear = 0;
          t.lastMsg = msgAt;
          t.a = a;
          if (!t.confirmed && t.hits >= CONFIRM_MSGS && msgAt - t.firstAt >= CONFIRM_MS) {
            t.confirmed = true;
            t.since = now;
            started.push(t);
          }
        } else if (t) {
          t.lastMsg = msgAt;
          t.a = a;
          if (normalCode(a.squawk)) {
            // A normal squawk: a candidate is dropped at once, a confirmed alert after a second one.
            t.clear += 1;
            if (!t.confirmed || t.clear >= CLEAR_MSGS) {
              if (t.confirmed) ended.push(t);
              track.delete(a.hex);
            }
          }
        }
      }
      for (const [hex, t] of track) {
        if (present.has(hex) && now - t.lastMsg <= GONE_MS) continue;
        if (t.confirmed) ended.push(t);
        track.delete(hex);
      }
      return { started, ended };
    }

    // Confirmed alerts: all of them (for the radar) or only those inside FIR Amsterdam (for the alert bar).
    function active({ firOnly = false } = {}) {
      const out = [];
      for (const [hex, t] of track) {
        if (!t.confirmed) continue;
        const inside = inFir(t.a.lat, t.a.lon);
        if (firOnly && !inside) continue;
        out.push({ hex, code: t.code, meaning: MEANING[t.code], since: t.since, a: t.a, inFir: inside });
      }
      return out;
    }

    const isConfirmed = (hex) => !!(track.get(hex) && track.get(hex).confirmed);
    const clear = () => track.clear();
    return { update, active, isConfirmed, clear };
  }

  return { createWatch, inFir, emergencyCode, MEANING, FIR, CONFIRM_MS, CONFIRM_MSGS, CLEAR_MSGS };
});
