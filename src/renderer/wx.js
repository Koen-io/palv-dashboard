'use strict';

/* ============================================================
   Luchtvaartweer tegen de BOM-limieten
   Leest ruwe METAR's en TAF's en toetst ze aan de weerminima uit het Basic Operations Manual.
   Staat los van de rest van de renderer, zodat de regels apart te controleren zijn.
   ============================================================ */
(function (root) {
  // The minima table of the BOM. `any`: no cloud at all (FEW included) below this height.
  // `ceil`: cloud base, counted from 3/8 (SCT) upwards. Multi pilot Dag has its own sliding scale.
  const PROFILES = [
    { id: 'mpd', period: 'day', name: 'Multi pilot Dag' },
    { id: 'spd', period: 'day', name: 'Single pilot Dag', any: 600, vis: 3000 },
    { id: 'ferry', period: 'night', name: 'Single pilot (ferry) EC buiten UDP', any: 1200, vis: 5000 },
    { id: 'unaided', period: 'night', name: 'Unaided Nacht', ceil: 1100, vis: 3000 },
    { id: 'aided', period: 'night', name: 'Aided Nacht', ceil: 900, vis: 3000 },
    { id: 'adv', period: 'night', name: 'Aided Nacht Advanced Operations', any: 600, vis: 3000, aw139: true },
  ];
  const profile = (id) => PROFILES.find((p) => p.id === id) || PROFILES[0];

  // Margin inside which a station that is within limits is shown as marginal.
  // Adjustable under Instellingen > Weerradar.
  const margins = { ft: 200, m: 1000 };
  const TREND_WINDOW = 2 * 3600e3;
  const STALE = 90 * 60e3;
  const CLOUD_CAP = 5000;

  /* ---------- parsing ---------- */
  // Visibility, cloud and wind out of a run of METAR/TAF tokens. `cloud` is 'layers', 'none' (reported
  // free of cloud), 'unknown' (not measured, or only a vertical visibility) or null (not mentioned).
  function parseCond(tokens) {
    const c = { vis: null, cloud: null, layers: [], wind: null, vv: null, cavok: false };
    for (const t of tokens) {
      let m;
      if (t === 'RMK') break;
      if (t === 'CAVOK') { c.vis = 9999; c.cloud = 'none'; c.layers = []; c.cavok = true; }
      else if ((m = t.match(/^(\d{4})(NDV|[NESW]{1,2})?$/))) c.vis = c.vis == null ? +m[1] : Math.min(c.vis, +m[1]);
      else if ((m = t.match(/^(FEW|SCT|BKN|OVC)(\d{3})/))) { c.layers.push({ cover: m[1], base: +m[2] * 100 }); c.cloud = 'layers'; }
      else if (/^(FEW|SCT|BKN|OVC)\/\/\//.test(t) || /^\/{6,9}$/.test(t)) { if (c.cloud !== 'layers') c.cloud = 'unknown'; }
      else if (/^(NSC|NCD|SKC|CLR)$/.test(t)) { if (!c.cloud) c.cloud = 'none'; }
      else if ((m = t.match(/^VV(\d{3}|\/\/\/)$/))) { c.vv = m[1] === '///' ? -1 : +m[1] * 100; if (c.cloud !== 'layers') c.cloud = 'unknown'; }
      else if (!c.wind && (m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) c.wind = { dir: m[1], spd: +m[2], gust: m[3] ? +m[3] : null, unit: m[4] };
    }
    return c;
  }

  function parseMetar(raw) {
    const tokens = String(raw || '').trim().replace(/=$/, '').split(/\s+/).filter((t) => !/^(METAR|SPECI|COR)$/.test(t));
    const cut = tokens.findIndex((t) => /^(NOSIG|BECMG|TEMPO)$/.test(t));
    const body = cut < 0 ? tokens : tokens.slice(0, cut);
    const trendTokens = cut < 0 ? [] : tokens.slice(cut);
    const out = parseCond(body.slice(2));
    if (!out.cloud) out.cloud = 'unknown';
    out.nosig = trendTokens[0] === 'NOSIG';
    out.groups = [];
    for (const t of trendTokens) {
      if (t === 'RMK') break;
      if (t === 'BECMG' || t === 'TEMPO') out.groups.push({ kind: t === 'BECMG' ? 'becmg' : 'tempo', tokens: [] });
      else if (out.groups.length) out.groups[out.groups.length - 1].tokens.push(t);
    }
    out.trendText = trendTokens.join(' ');
    return out;
  }

  // Day and hour of a TAF period as a time, in the month that lies closest to `ref`.
  function dayHour(dd, hh, ref) {
    const d = new Date(ref);
    let best = null;
    for (const off of [-1, 0, 1]) {
      const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + off, dd, hh);
      if (best == null || Math.abs(t - ref) < Math.abs(best - ref)) best = t;
    }
    return best;
  }

  function parseTaf(raw, ref) {
    const tokens = String(raw || '').trim().replace(/=$/, '').split(/\s+/);
    const vi = tokens.findIndex((t) => /^\d{4}\/\d{4}$/.test(t));
    if (vi < 0) return null;
    const period = (t) => { const m = t.match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/); return m ? [dayHour(+m[1], +m[2], ref), dayHour(+m[3], +m[4], ref)] : null; };
    const [from, to] = period(tokens[vi]);
    const taf = { from, to, base: [], groups: [] };
    let cur = null;
    for (let i = vi + 1; i < tokens.length; i += 1) {
      const t = tokens[i];
      let m;
      if (t === 'RMK') break;
      if ((m = t.match(/^FM(\d{2})(\d{2})(\d{2})$/))) {
        cur = { kind: 'fm', from: dayHour(+m[1], +m[2], ref) + +m[3] * 60e3, to: null, tokens: [], text: [t] };
        taf.groups.push(cur);
      } else if (/^(BECMG|TEMPO|PROB\d{2})$/.test(t)) {
        // PROB30 TEMPO is one group; a bare PROB is as uncertain as a TEMPO.
        if (t === 'TEMPO' && cur && cur.prob && !cur.tokens.length && cur.from == null) { cur.text.push(t); continue; }
        cur = { kind: t === 'BECMG' ? 'becmg' : 'tempo', prob: t.startsWith('PROB'), from: null, to: null, tokens: [], text: [t] };
        taf.groups.push(cur);
      } else if (cur) {
        cur.text.push(t);
        const p = cur.from == null && cur.kind !== 'fm' ? period(t) : null;
        if (p) [cur.from, cur.to] = p;
        else cur.tokens.push(t);
      } else taf.base.push(t);
    }
    taf.groups = taf.groups.filter((g) => g.from != null);
    return taf;
  }

  /* ---------- toetsing ---------- */
  const lowest = (cond, countFew) => {
    const bases = cond.layers.filter((l) => countFew || l.cover !== 'FEW').map((l) => l.base);
    return bases.length ? Math.min(...bases) : Infinity;
  };

  // 'ok', 'out' or 'unknown'. One known value below its minimum is enough for 'out'; 'ok' needs both.
  function check(id, cond) {
    const p = profile(id);
    const cloudKnown = cond.cloud === 'layers' || cond.cloud === 'none';
    const visKnown = cond.vis != null;
    if (p.id === 'mpd') {
      const base = cloudKnown ? lowest(cond, false) : null;
      if (base != null && base < 300) return 'out';
      const need = base == null ? 1500 : base >= 500 ? 1500 : base >= 400 ? 2000 : 3000;
      if (visKnown && cond.vis < need) return 'out';
      return cloudKnown && visKnown ? 'ok' : 'unknown';
    }
    const countFew = p.any != null;
    // A layer that is known counts even when the rest of the sky is not.
    if (lowest(cond, countFew) < (countFew ? p.any : p.ceil)) return 'out';
    if (visKnown && cond.vis < p.vis) return 'out';
    return cloudKnown && visKnown ? 'ok' : 'unknown';
  }

  const degraded = (cond) => ({ ...cond, vis: cond.vis == null ? null : cond.vis - margins.m, layers: cond.layers.map((l) => ({ ...l, base: l.base - margins.ft })) });
  const marginal = (id, cond) => check(id, cond) === 'ok' && check(id, degraded(cond)) === 'out';

  // The conditions after a change group: whatever the group does not mention stays as it was.
  function apply(cond, tokens) {
    const ch = parseCond(tokens);
    return { ...cond, vis: ch.vis != null ? ch.vis : cond.vis, cloud: ch.cloud || cond.cloud, layers: ch.cloud ? ch.layers : cond.layers };
  }

  // -1 worse, +1 better, 0 no change that matters for this profile. Any worsening wins.
  function delta(id, a, b) {
    const countFew = profile(id).any != null;
    const known = (c) => c.cloud === 'layers' || c.cloud === 'none';
    const base = (c) => Math.min(lowest(c, countFew), CLOUD_CAP);
    let down = false, up = false;
    if (a.vis != null && b.vis != null) { if (b.vis < a.vis) down = true; else if (b.vis > a.vis) up = true; }
    if (known(a) && known(b)) { if (base(b) < base(a)) down = true; else if (base(b) > base(a)) up = true; }
    return down ? -1 : up ? 1 : 0;
  }

  function summarize(id, from, changes, src, text) {
    // changes: [{ kind, cond }] against `from`
    const t = { dir: 0, kind: null, src, text, willOut: false };
    for (const kind of ['becmg', 'tempo', 'obs']) {
      for (const want of [-1, 1]) {
        if (t.dir === -1 || (t.dir === 1 && want === 1)) continue;
        if (changes.some((c) => c.kind === kind && delta(id, from, c.cond) === want)) { t.dir = want; t.kind = kind; }
      }
    }
    t.willOut = changes.some((c) => c.kind !== 'obs' && check(id, c.cond) === 'out');
    return t;
  }

  // Trend for one station: the METAR trend when it has one, otherwise the TAF for the coming two
  // hours, otherwise the change against the observation of about an hour ago.
  function trend(id, st, now) {
    const m = st.metar;
    if (m.nosig || m.groups.length) {
      return summarize(id, m, m.groups.map((g) => ({ kind: g.kind, cond: apply(m, g.tokens) })), 'METAR', m.trendText);
    }
    const taf = st.taf;
    if (taf && taf.from <= now && taf.to > now) {
      let cur = parseCond(taf.base);
      for (const g of taf.groups) {
        if (g.kind === 'fm' && g.from <= now) cur = apply(cur, g.tokens);
        else if (g.kind === 'becmg' && g.to <= now) cur = apply(cur, g.tokens);
      }
      const ahead = taf.groups.filter((g) => (g.kind === 'fm' ? g.from > now && g.from <= now + TREND_WINDOW : g.from < now + TREND_WINDOW && g.to > now));
      return summarize(id, cur, ahead.map((g) => ({ kind: g.kind === 'tempo' ? 'tempo' : 'becmg', cond: apply(cur, g.tokens) })), 'TAF', ahead.map((g) => g.text.join(' ')).join(' · ') || 'geen verandering verwacht');
    }
    const prev = (st.history || []).filter((o) => { const age = st.obsTime - o.obsTime; return age >= 40 * 60e3 && age <= 80 * 60e3; })[0];
    if (prev) return summarize(id, prev.metar, [{ kind: 'obs', cond: m }], 'OBS', null);
    return { dir: 0, kind: null, src: null, text: null, willOut: false };
  }

  // Everything the map needs to know about one station under one profile.
  function assess(id, st, now) {
    const res = check(id, st.metar);
    const tr = trend(id, st, now);
    const stale = now - st.obsTime > STALE;
    let status;
    if (stale || res === 'unknown') status = 'none';
    else if (res === 'out') status = 'red';
    else status = marginal(id, st.metar) || tr.willOut ? 'amber' : 'green';
    // Outside the Aided Nacht minima but inside those for Advanced Operations: AW139 only.
    const aw139 = id === 'aided' && status === 'red' && check('adv', st.metar) === 'ok';
    return { status, result: res, stale, trend: tr, aw139, marginal: res === 'ok' && marginal(id, st.metar) };
  }

  function windText(w) {
    if (!w) return '';
    const p = (n) => String(n).padStart(2, '0');
    if (w.spd === 0) return 'CALM';
    return `${w.dir}/${p(w.spd)}${w.gust ? 'G' + p(w.gust) : ''}${w.unit === 'MPS' ? 'MPS' : ''}`;
  }

  // Raw API rows -> one entry per station with its newest observation, older ones and TAF.
  function stations(data, now) {
    const by = new Map();
    for (const r of [...data.metars].sort((a, b) => b.obsTime - a.obsTime)) {
      const o = { obsTime: r.obsTime, raw: r.raw, metar: parseMetar(r.raw) };
      const st = by.get(r.icao);
      if (st) st.history.push(o);
      else by.set(r.icao, { icao: r.icao, name: r.name, lat: r.lat, lon: r.lon, ...o, history: [], taf: null, tafRaw: null });
    }
    for (const t of data.tafs || []) {
      const st = by.get(t.icao);
      if (st && !st.taf) { st.taf = parseTaf(t.raw, now); st.tafRaw = t.raw; }
    }
    return [...by.values()];
  }

  const api = { PROFILES, margins, profile, parseCond, parseMetar, parseTaf, check, marginal, trend, assess, windText, stations };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WX = api;
})(typeof window !== 'undefined' ? window : globalThis);
