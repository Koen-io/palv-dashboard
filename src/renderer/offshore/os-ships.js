'use strict';

/* ============================================================
   Offshore — schepen: de AIS-begrippen (scheepstypes, navigatiestatus, vlag uit de MMSI), het gegist
   bestek tussen twee berichten, en het zoeken en sorteren van de lijst.
   ============================================================ */
// AIS ship type codes (ITU-R M.1371) in the groups the map colours by.
const OS_GROUPS = {
  cargo: { name: 'Vracht', color: '#3ecf6e' },
  tanker: { name: 'Tankers', color: '#ff4b55' },
  passenger: { name: 'Passagiers', color: '#3d9bff' },
  fishing: { name: 'Visserij', color: '#ff9f1c' },
  hsc: { name: 'Snelle vaartuigen (HSC)', color: '#ffe14d' },
  special: { name: 'Sleep, loods, werk, offshore', color: '#00c2c7' },
  pleasure: { name: 'Zeil- en plezierjachten', color: '#ff6fd8' },
  authority: { name: 'Overheid, SAR, militair', color: '#b48cff' },
  other: { name: 'Overig en onbekend', color: '#8ea2bf' },
  aton: { name: 'Bakens (AtoN)', color: '#c9ced6' },
  base: { name: 'AIS-walstations', color: '#f2f5f9' },
};
const OS_TYPE_NAMES = { 30: 'Vissersschip', 31: 'Sleepboot', 32: 'Sleepboot (lang/breed)', 33: 'Baggerschip / onderwaterwerk', 34: 'Duikwerkzaamheden', 35: 'Militair', 36: 'Zeilschip', 37: 'Plezierjacht', 50: 'Loodsboot', 51: 'Reddingboot (SAR)', 52: 'Sleepboot', 53: 'Havendienst', 54: 'Antivervuiling', 55: 'Politie / handhaving', 56: 'Lokaal vaartuig', 57: 'Lokaal vaartuig', 58: 'Medisch transport', 59: 'Niet-strijdend (RR 18)' };
const OS_HAZ = ['', ' · gevaarlijke lading X', ' · gevaarlijke lading Y', ' · gevaarlijke lading Z', ' · gevaarlijke lading OS'];
function osGroup(v) {
  if (v.cls === 'aton') return 'aton';
  if (v.cls === 'base') return 'base';
  const t = v.type;
  if (t == null || t === 0) return 'other';
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  if (t >= 60 && t <= 69) return 'passenger';
  if (t === 30) return 'fishing';
  if (t >= 40 && t <= 49) return 'hsc';
  if (t === 36 || t === 37) return 'pleasure';
  if (t === 35 || t === 51 || t === 55) return 'authority';
  if ((t >= 31 && t <= 34) || (t >= 50 && t <= 59) || (t >= 20 && t <= 29)) return 'special';
  if (t >= 90 && t <= 99) return 'other';
  return 'other';
}
function osTypeText(v) {
  if (v.cls === 'aton') return 'Navigatiebaken (AtoN)';
  if (v.cls === 'base') return 'AIS-walstation (zender aan de wal)';
  const t = v.type;
  if (t == null || t === 0) return 'Type onbekend';
  if (OS_TYPE_NAMES[t]) return OS_TYPE_NAMES[t];
  const tens = Math.floor(t / 10), ones = t % 10;
  const base = { 2: 'Draagvleugel / WIG', 4: 'Snel vaartuig (HSC)', 6: 'Passagiersschip', 7: 'Vrachtschip', 8: 'Tanker', 9: 'Overig' }[tens];
  if (!base) return `Type ${t}`;
  return base + (OS_HAZ[ones] || '');
}
const OS_NAV = { 0: 'Varend (motor)', 1: 'Voor anker', 2: 'Niet onder controle', 3: 'Beperkt manoeuvreerbaar', 4: 'Beperkt door diepgang', 5: 'Afgemeerd', 6: 'Aan de grond', 7: 'Bezig met vissen', 8: 'Zeilend', 9: 'Gevaarlijke lading (HSC)', 10: 'Gevaarlijke lading (WIG)', 11: 'Gesleept', 12: 'Duwend', 14: 'AIS-SART / MOB / EPIRB', 15: 'Niet gedefinieerd' };
const osNavText = (n) => (n == null ? '—' : OS_NAV[n] || `Status ${n}`);
const osFlag = (mmsi) => MID_LANDEN[String(mmsi || '').slice(0, 3)] || null;
const osRegion = (() => { try { return new Intl.DisplayNames(['nl'], { type: 'region' }); } catch { return null; } })();
function osCountry(mmsi) {
  const cc = osFlag(mmsi);
  if (!cc) return null;
  let name = cc;
  try { name = (osRegion && osRegion.of(cc)) || cc; } catch { /* keep the code */ }
  return { cc, name };
}
// Where the vessel is now: along its course at its speed since the last position (dead reckoning), at most
// 10 minutes on: aisstream.io passes about one position per ship per minute, often less, so a ship would
// otherwise stand still on the map while it sails on. A ship that turns (rate of turn from AIS) follows
// the bend, at most a quarter turn. Moored, anchored or aground: where it was.
const OS_RECKON_S = 600;
// AIS rate of turn: the raw value ±(4.733·√(°/min)); ±127 means "turning, rate unknown", -128 none.
function osTurnRate(rot) {
  if (rot == null || !Number.isFinite(rot) || Math.abs(rot) >= 127) return 0;
  return (Math.sign(rot) * (rot / 4.733) ** 2) / 60; // degrees per second
}
function osNow(v, now) {
  if (v.lat == null) return null;
  const dt = Math.min(OS_RECKON_S, Math.max(0, (now - v.posAt) / 1000));
  if (!(v.sog > 0.3) || v.cog == null || dt < 2 || v.nav === 1 || v.nav === 5 || v.nav === 6 || v.cls === 'aton' || v.cls === 'base') return [v.lat, v.lon];
  const ms = v.sog * 0.514444; // metres a second
  const w = osTurnRate(v.rot);
  if (Math.abs(w) < 0.02) { const p = PlanGeo.dest({ lat: v.lat, lon: v.lon }, v.cog, ms * dt); return [p.lat, p.lon]; }
  const n = Math.min(24, Math.max(2, Math.ceil(dt / 15))), step = dt / n;
  let p = { lat: v.lat, lon: v.lon }, turned = 0;
  for (let i = 0; i < n; i += 1) {
    const before = turned;
    turned = Math.max(-90, Math.min(90, turned + w * step));
    p = PlanGeo.dest(p, (((v.cog + (before + turned) / 2) % 360) + 360) % 360, ms * step);
  }
  return [p.lat, p.lon];
}
// How sure the drawn position is: full colour up to 3 minutes after the last message, then fading to
// 0.45 at 15 minutes (and staying there).
const osFade = (v, now) => { const m = (now - (v.posAt || 0)) / 60000; return m <= 3 ? 1 : m >= 15 ? 0.45 : 1 - ((m - 3) / 12) * 0.55; };
// The sources behind the AIS status, as a line for its tooltip.
function osSourcesText(s) {
  const src = s && s.sources;
  if (!src || s.role === 'follow') return '';
  const one = (x, none) => (!x ? '' : x.connected ? `live, ${x.perMin || 0}/min` : x.on ? (x.lastErr || 'verbinden…') : none);
  return `
aisstream.io: ${one(src.aisstream, 'geen sleutel')}
Open Waters: ${one(src.openwaters, 'uit')}`;
}
const osSize = (v) => (v.a != null && v.b != null && v.a + v.b > 0 ? { len: v.a + v.b, beam: (v.c || 0) + (v.d || 0) } : null);
const osName = (v) => v.name || (v.cls === 'aton' ? `Baken ${v.mmsi}` : `MMSI ${v.mmsi}`);
// Search: name, MMSI, IMO, call sign and destination, every word must match.
function osSearch(list, q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((v) => { const hay = `${v.name || ''} ${v.mmsi} ${v.imo || ''} ${v.callsign || ''} ${v.dest || ''} ${osTypeText(v)}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
}
// The ETA pattern of AIS ("MM-DD hh:mm" UTC) as a readable text.
function osEtaText(eta) {
  const m = /^(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(eta || '');
  if (!m) return eta || '—';
  const [, mo, d, hh, mm] = m;
  if (+mo === 0 || +d === 0) return '—';
  return `${+d}-${+mo}${+hh < 24 ? ` ${hh}:${+mm < 60 ? mm : '00'}Z` : ''}`;
}
