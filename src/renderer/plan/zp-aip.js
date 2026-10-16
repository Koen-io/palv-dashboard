'use strict';

/* ============================================================
   Zoek & Plan — de officiële AIP van LVNL: koppelingen naar de juiste pagina van de geldende cyclus.
   ============================================================ */
// LVNL publishes the eAIP and the ICAO 1:500.000 chart free to read, but forbids reproducing them in
// any form without written permission. So the tab does not turn them into map layers: it opens the
// official page itself, in the browser, for the aerodrome or airspace at hand. The eAIP has one folder
// per AIRAC cycle ("AIRAC AMDT 10-2026_2026_10_01"); the cycle in force is reckoned from the dates.
const ZP_AIP_BASE = 'https://eaip.lvnl.nl/web/eaip/';
// Aerodromes with an AD 2 chapter and heliports with an AD 3 chapter in the Dutch eAIP (AIRAC 10-2026).
const ZP_AIP_AD2 = ['EHAL', 'EHAM', 'EHBD', 'EHBK', 'EHDR', 'EHEH', 'EHGG', 'EHHO', 'EHHV', 'EHKD', 'EHLE', 'EHMM', 'EHMZ', 'EHOW', 'EHRD', 'EHSE', 'EHST', 'EHTE', 'EHTL', 'EHTW', 'EHTX'];
const ZP_AIP_AD3 = ['EHHA', 'EHHE', 'EHJR'];
// Where each kind of airspace is described.
const ZP_AIP_ENR = { FIR: '2.1', UIR: '2.1', TMA: '2.1', CTA: '2.1', ACC: '2.1', TMZ: '2.2', RMZ: '2.2', ATZ: '2.2', TIZ: '2.2', TIA: '2.2', TRP: '2.2', P: '5.1', R: '5.1', D: '5.1', TRA: '5.2', TSA: '5.2', MTA: '5.2', LOW_OVERFLIGHT: '5.2', GLIDING: '5.5', SPORT: '5.5', PROTECTED: '5.6' };
const ZP_AIP_CHART = { front: 'https://eaip.lvnl.nl/download/lvnl_icao_2026_FRONT.pdf', back: 'https://eaip.lvnl.nl/download/lvnl_icao_2026_BACK.pdf' };

// The AIRAC cycle in force at `ms`: its effective date and its number within the year.
function zpAirac(ms = Date.now()) {
  const epoch = Date.UTC(2024, 0, 25), step = 28 * 864e5;
  const n = Math.floor((ms - epoch) / step);
  const eff = new Date(epoch + n * step);
  const y = eff.getUTCFullYear();
  const first = Math.ceil((Date.UTC(y, 0, 1) - epoch) / step);
  return { eff, year: y, num: n - first + 1 };
}
function zpAipFolder(ms) {
  const a = zpAirac(ms), p = (v) => String(v).padStart(2, '0');
  const d = `${a.year}_${p(a.eff.getUTCMonth() + 1)}_${p(a.eff.getUTCDate())}`;
  return `${ZP_AIP_BASE}${encodeURIComponent(`AIRAC AMDT ${p(a.num)}-${a.year}_${d}`)}/`;
}
// The page for an aerodrome (ICAO code) or a kind of airspace; null when the Dutch AIP has none.
function zpAipUrl({ icao, airspace } = {}) {
  const page = (name) => `${zpAipFolder()}eAIP/${encodeURIComponent(`EH-${name}-en-GB.html`)}`;
  if (icao) {
    const c = String(icao).toUpperCase();
    if (ZP_AIP_AD2.includes(c)) return page(`AD 2 ${c} 1`);
    if (ZP_AIP_AD3.includes(c)) return page(`AD 3 ${c} 1`);
    return null;
  }
  if (airspace) {
    const a = airspace;
    if ((a.type === 'CTR' || a.type === 'MCTR') && a.name) { const m = /EH[A-Z]{2}/.exec(a.name); if (m && ZP_AIP_AD2.includes(m[0])) return page(`AD 2 ${m[0]} 1`); }
    if (a.country && a.country !== 'NL') return null;
    const s = ZP_AIP_ENR[a.type];
    return s ? page(`ENR ${s}`) : null;
  }
  return `${zpAipFolder()}index.html`;
}
const zpOpenAip = (url) => window.palv.app.openExternal(url).then((ok) => { if (!ok) toast('Kon de AIP niet openen', true); });
const zpAipBtn = (url, label = 'Officiële AIP (LVNL)') => (url ? zpBtn(label, () => zpOpenAip(url), { icon: 'globe', title: 'Opent de geldende eAIP van LVNL in de browser' }) : null);
