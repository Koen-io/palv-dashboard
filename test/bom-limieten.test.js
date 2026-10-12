const WX = require(require('path').join(__dirname, '..', 'src', 'renderer', 'wx.js'));
const assert = require('assert');
const now = Date.UTC(2026, 9, 9, 11, 36);
const obs = Date.UTC(2026, 9, 9, 11, 25);
const C = (s) => WX.parseMetar('METAR XXXX 091125Z ' + s);
const all = (s) => WX.PROFILES.map((p) => WX.check(p.id, C(s))).join(',');

// table rows
assert.equal(all('21010KT 1500 BKN005'), 'ok,out,out,out,out,out');
assert.equal(all('21010KT 1400 BKN005'), 'out,out,out,out,out,out');
assert.equal(all('21010KT 1900 BKN004'), 'out,out,out,out,out,out');
assert.equal(all('21010KT 2000 BKN004'), 'ok,out,out,out,out,out');
assert.equal(all('21010KT 2900 BKN003'), 'out,out,out,out,out,out');
assert.equal(all('21010KT 3000 BKN003'), 'ok,out,out,out,out,out');
assert.equal(all('21010KT 9999 BKN002'), 'out,out,out,out,out,out');
assert.equal(all('21010KT 3000 FEW002 BKN011'), 'ok,out,out,ok,ok,out'); // FEW only counts for the "incl. few" rows
assert.equal(all('21010KT 3000 BKN006'), 'ok,ok,out,out,out,ok');
assert.equal(all('21010KT 3000 FEW005'), 'ok,out,out,ok,ok,out');
assert.equal(all('21010KT 5000 SCT012'), 'ok,ok,ok,ok,ok,ok');
assert.equal(all('21010KT 4900 SCT012'), 'ok,ok,out,ok,ok,ok');
assert.equal(all('21010KT 9999 FEW011'), 'ok,ok,out,ok,ok,ok');
assert.equal(all('21010KT 9999 SCT010'), 'ok,ok,out,out,ok,ok');
assert.equal(all('21010KT 9999 SCT009'), 'ok,ok,out,out,ok,ok');
assert.equal(all('21010KT 9999 SCT008'), 'ok,ok,out,out,out,ok');
assert.equal(all('21010KT CAVOK'), 'ok,ok,ok,ok,ok,ok');
assert.equal(all('21010KT 9999 NCD'), 'ok,ok,ok,ok,ok,ok');
assert.equal(all('25031KT //// // /////////'), 'unknown,unknown,unknown,unknown,unknown,unknown');
assert.equal(all('23032KT 9999 /////////'), 'unknown,unknown,unknown,unknown,unknown,unknown');
assert.equal(all('23032KT 0800 /////////'), 'out,out,out,out,out,out');
assert.equal(all('00000KT 0300 FG VV001'), 'out,out,out,out,out,out');
assert.equal(all('00000KT 4000 VV002'), 'unknown,unknown,out,unknown,unknown,unknown'); // VV is not a cloud base
assert.equal(all('26019KT 9999 FEW009/// SCT011/// BKN015///'), 'ok,ok,out,ok,ok,ok');
assert.equal(all('21010KT 6000 2000SW BKN020'), 'ok,out,out,out,out,out'); // lowest visibility counts

const st = (raw, taf, hist) => {
  const d = { metars: [{ icao: 'XXXX', name: 'x', lat: 0, lon: 0, raw, obsTime: obs }, ...(hist || []).map(([r, min]) => ({ icao: 'XXXX', raw: r, obsTime: obs - min * 60e3 }))], tafs: taf ? [{ icao: 'XXXX', raw: taf }] : [] };
  return WX.stations(d, now)[0];
};
const A = (id, ...a) => { const r = WX.assess(id, st(...a), now); return `${r.status} ${r.trend.dir} ${r.trend.kind} ${r.trend.src}${r.aw139 ? ' +' : ''}`; };

// real observations of 9 Oct
const EHAM = 'METAR EHAM 091125Z 21012KT 9999 -DZRA FEW006 BKN011 BKN015 16/15 Q1007 BECMG 24016G26KT TEMPO 4000 DZ';
assert.equal(A('mpd', EHAM), 'green -1 tempo METAR');
assert.equal(A('unaided', EHAM), 'amber -1 tempo METAR'); // BKN011: within 200 ft of 1100
assert.equal(A('ferry', EHAM), 'red -1 tempo METAR');
const EHLW = 'METAR EHLW 091125Z AUTO 22009KT 180V240 5000 -SHRA SCT003 BKN004 BKN006 FEW015CB 15/15 Q1004 RERA REDZ YLO TEMPO 2500 DZRA SCT002 BKN003 OVC005 BECMG 25015G25KT BKN008 OVC012';
assert.equal(A('mpd', EHLW), 'amber -1 tempo METAR'); // 300 ft with 5000 m is in, TEMPO SCT002 is out
assert.equal(A('aided', EHLW), 'red -1 tempo METAR');
assert.equal(A('mpd', 'METAR EHGR 091125Z AUTO 21011KT 140V260 9999 BKN004 OVC005 13/12 Q1010 REDZ YLO NOSIG'), 'amber 0 null METAR'); // 400 ft: within 200 ft of 300
assert.equal(A('mpd', 'METAR EHGG 091125Z AUTO 21015KT 170V240 9999 -RADZ FEW004 BKN005 OVC006 12/12 Q1005 BECMG BKN007 TEMPO 6000'), 'green -1 tempo METAR');
assert.equal(A('aided', 'METAR EHGG 091125Z AUTO 21015KT 9999 BKN007 12/12 Q1005 BECMG BKN012'), 'red 1 becmg METAR +');
assert.equal(A('aided', 'METAR EHGG 091125Z AUTO 21015KT 9999 FEW004 BKN007 12/12 Q1005 NOSIG'), 'red 0 null METAR');
assert.equal(A('mpd', 'METAR EHJR 091125Z AUTO 25031KT //// // ///////// 17/14 Q1003 RE// W18/H27'), 'none 0 null null');

// TAF as trend source, valid 0912/1018, now 11:36 -> TAF not yet valid -> falls through to observations
const EHKD_TAF = 'TAF EHKD 090850Z 0909/0921 26020G30KT 5000 -RADZ BKN008 OVC012 TEMPO 0909/0912 3000 DZRA SCT004 BKN006 BECMG 0913/0915 SCT012 BKN015 TEMPO 0918/0920 4500 -SHRA SCT010 BKN012 SCT015CB';
const EHKD = 'METAR EHKD 091125Z AUTO 26019KT 230V300 9999 FEW009/// SCT011/// BKN015/// 17/16 Q1005 WHT';
assert.equal(A('mpd', EHKD, EHKD_TAF), 'green -1 tempo TAF'); // TEMPO 0909/0912 still running; BECMG 0913/0915 starts in window (better) -> worse wins
const t = WX.parseTaf('TAF EHAM 091106Z 0912/1018 25017G27KT 9999 -RA BKN018 TEMPO 0912/0918 6000 RADZ SCT012 BKN014 PROB40 TEMPO 0915/0918 6000 RA BKN015 SCT018TCU BECMG 0919/0921 28015KT SCT025 PROB30 TEMPO 1015/1018 27022G33KT 4000 TSRA SCT018CB BKN025', now);
assert.equal(t.groups.length, 4);
assert.equal(new Date(t.to).toISOString(), '2026-10-10T18:00:00.000Z');
assert.deepEqual(t.groups.map((g) => g.kind + new Date(g.from).getUTCHours()), ['tempo12', 'tempo15', 'becmg19', 'tempo15']);
assert.equal(t.groups[1].tokens[0], '6000');
// month rollover
assert.equal(new Date(WX.parseTaf('TAF EHAM 311700Z 3118/0124 25017KT 9999 BKN018', Date.UTC(2026, 9, 31, 20)).to).toISOString(), '2026-11-02T00:00:00.000Z');
// FM group
const fm = st('METAR XXXX 091125Z 21010KT 9999 BKN020 10/10 Q1000', 'TAF XXXX 090500Z 0906/0918 21010KT 9999 BKN020 FM091230 21010KT 2000 BR BKN003');
assert.equal((() => { const r = WX.assess('mpd', fm, now); return `${r.status} ${r.trend.dir} ${r.trend.kind} ${r.trend.src}`; })(), 'amber -1 becmg TAF');
// observed trend
assert.equal(A('mpd', 'METAR XXXX 091125Z 21010KT 9000 BKN013 10/10 Q1000', null, [['METAR XXXX 091055Z 21010KT 6000 BKN010 10/10 Q1000', 30], ['METAR XXXX 091025Z 21010KT 3700 BKN011 10/10 Q1000', 60]]), 'green 1 obs OBS');
// stale
assert.equal(WX.assess('mpd', st(EHAM), now + 100 * 60e3).status, 'none');
assert.equal(WX.windText(C('21012G26KT 9999 NSC').wind), '210/12G26');
assert.equal(WX.windText(C('VRB03KT 9999 NSC').wind), 'VRB/03');
assert.equal(WX.windText(C('00000KT 9999 NSC').wind), 'CALM');
console.log('all ok');
