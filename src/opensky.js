// OpenSky Network as the reserve tank of the live traffic feed (traffic.js). It is only asked when
// adsb.fi and adsb.lol have both brought nothing fresh for a few seconds, and it never goes over the
// daily budget of the account: 4000 credits for every dashboard that uses the same key together.
//
// How the budget is kept, whatever happens:
// - every request costs exactly 1 credit: the area is cut down to at most 24 square degrees (OpenSky
//   charges 1 credit up to 25), and the aircraft are never asked for by transponder code alone, which
//   costs 4;
// - OpenSky tells with every answer how many credits the account has left today. The pace follows that
//   number, so dashboards sharing the key slow each other down instead of adding up;
// - at 300 credits left it stops until the next day;
// - and each dashboard keeps its own count per UTC day on disk, at most 3600, also across restarts.
// Going over would cost no money (OpenSky then refuses until the next day), but the reserve would be gone.
//
// The key (client id and secret) lives in opensky.json in the user data folder, never in the code or in
// the dashboard layout, so it is not exported, backed up or shown on the screens overview.
const fs = require('fs');
const path = require('path');

const API = 'https://opensky-network.org/api/states/all';
const TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const DAY_LIMIT = 4000;     // credits per day of a standard account
const RESERVE = 300;        // never below this many credits left on the account
const LOCAL_MAX = 3600;     // and at most this many from this dashboard per UTC day
const MIN_GAP_MS = 5000;    // OpenSky refreshes every 5 s; asking more often brings nothing new
const PACE = 2;             // spend the credits left at twice the even pace (see gap)
const MAX_SQDEG = 24;       // 1 credit up to 25 square degrees; a margin for rounding
const TIMEOUT_MS = 8000;
// The Netherlands and a margin (18.7 square degrees) when no map tells its area.
const NL = { lamin: 50.6, lomin: 2.0, lamax: 54.0, lomax: 7.5 };

let file = null, fetchFn = null;
let log = { info() {}, warn() {} };
let creds = null;                      // { clientId, clientSecret }
let token = null, tokenUntil = 0;
let ledger = { day: null, used: 0, remaining: null, remainingAt: 0 };
let last = 0, pauseUntil = 0, busy = false, lastError = null, lastOkAt = 0;

const utcDay = (t) => new Date(t).toISOString().slice(0, 10);
const nextUtcMidnight = (t) => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

// The bounding box of a map area, cut down so it costs 1 credit.
function box(area) {
  if (!area || !Number.isFinite(area.lat) || !Number.isFinite(area.lon) || !(area.nm > 0)) return { ...NL };
  const cos = Math.cos((area.lat * Math.PI) / 180);
  let nm = area.nm;
  const sq = (n) => (2 * n / 60) * (2 * n / (60 * cos));
  if (sq(nm) > MAX_SQDEG) nm *= Math.sqrt(MAX_SQDEG / sq(nm));
  const dLat = nm / 60, dLon = nm / (60 * cos);
  const r = (v) => Math.round(v * 100) / 100;
  return { lamin: r(area.lat - dLat), lomin: r(area.lon - dLon), lamax: r(area.lat + dLat), lomax: r(area.lon + dLon) };
}
const sqdeg = (b) => (b.lamax - b.lamin) * (b.lomax - b.lomin);

// OpenSky's state vectors in the shape of the ADS-B aggregators, for traffic.merge.
const EMERGENCY = { 7500: 'unlawful', 7600: 'nordo', 7700: 'general' };
function category(c) {
  if (c >= 2 && c <= 8) return 'A' + (c - 1);
  if (c >= 9 && c <= 15) return 'B' + (c - 8);
  if (c >= 16 && c <= 20) return 'C' + (c - 15);
  return null;
}
function toAdsb(data) {
  const t = data.time;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const ac = (data.states || []).map((s) => {
    const alt = n(s[7]), geo = n(s[13]);
    return {
      hex: String(s[0] || '').toLowerCase(),
      flight: s[1] || '',
      lat: n(s[6]), lon: n(s[5]),
      alt_baro: s[8] ? 'ground' : alt == null ? null : Math.round(alt * 3.28084),
      alt_geom: geo == null ? null : Math.round(geo * 3.28084),
      gs: n(s[9]) == null ? null : s[9] * 1.943844,
      track: n(s[10]),
      baro_rate: n(s[11]) == null ? null : Math.round(s[11] * 196.85),
      squawk: s[14] || null,
      emergency: EMERGENCY[s[14]] || null,
      category: category(s[17]),
      mlat: s[16] === 2 ? ['lat', 'lon'] : [],
      seen: s[4] ? Math.max(0, t - s[4]) : 0,
      seen_pos: s[3] ? Math.max(0, t - s[3]) : undefined,
    };
  });
  return { now: t, ac };
}

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    creds = d.clientId && d.clientSecret ? { clientId: String(d.clientId), clientSecret: String(d.clientSecret) } : null;
    if (d.ledger) ledger = { ...ledger, ...d.ledger };
  } catch { /* no key yet */ }
}
function persist() {
  if (!file) return;
  const tmp = file + '.tmp';
  try {
    // Readable for this user only: it holds the secret.
    fs.writeFileSync(tmp, JSON.stringify({ ...(creds || {}), ledger }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (err) { log.warn('opensky', 'teller niet opgeslagen: ' + err.message); }
}

function rollDay(now) {
  const day = utcDay(now);
  if (ledger.day !== day) ledger = { day, used: 0, remaining: null, remainingAt: 0 };
}

// Credits this dashboard may still spend today: the smallest of what the account has left above the
// reserve and what is left of its own day count.
function budget(now = Date.now()) {
  rollDay(now);
  const account = ledger.remaining == null ? DAY_LIMIT - RESERVE : ledger.remaining - RESERVE;
  return Math.max(0, Math.min(account, LOCAL_MAX - ledger.used));
}

// Time between two requests: the credits left spread over the rest of the UTC day at twice the even
// pace, never under 5 s. A short outage is bridged quickly; in a long one the gap grows as the credits
// shrink, and since it is always reckoned from what is left the budget can never run out before
// midnight. Early in the day that is about every 12 s, later on faster when credits are left over.
function gap(now = Date.now()) {
  const left = budget(now);
  if (left <= 0) return Infinity;
  return Math.max(MIN_GAP_MS, (nextUtcMidnight(now) - now) / (left * PACE));
}

const configured = () => !!creds;
const ready = (now = Date.now()) => !!creds && !!fetchFn && !busy && now >= pauseUntil && now - last >= gap(now);

async function getToken(now) {
  if (token && now < tokenUntil) return token;
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: creds.clientId, client_secret: creds.clientSecret });
  const res = await fetchFn(TOKEN_URL, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  if (!res.ok) throw new Error(res.status === 400 || res.status === 401 ? 'sleutel geweigerd (controleer client id en secret)' : `aanmelden mislukt (HTTP ${res.status})`);
  const d = await res.json();
  token = d.access_token;
  tokenUntil = now + Math.max(60, (d.expires_in || 1800) - 60) * 1000;
  return token;
}

// One request for the area; null when it may not be asked now or did not answer usefully.
async function fetchArea(area, now = Date.now()) {
  if (!ready(now)) return null;
  const b = box(area);
  if (sqdeg(b) > 25) return null; // would cost more than 1 credit: never sent
  busy = true;
  last = now;
  try {
    const url = `${API}?lamin=${b.lamin}&lomin=${b.lomin}&lamax=${b.lamax}&lomax=${b.lomax}&extended=1`;
    let res;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const tok = await getToken(Date.now());
      // Counted before it is sent: a request that goes wrong halfway may still have cost a credit.
      rollDay(Date.now());
      ledger.used += 1;
      persist();
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
      try {
        res = await fetchFn(url, { headers: { Authorization: `Bearer ${tok}` }, signal: ctl.signal });
      } finally { clearTimeout(timer); }
      if (res.status !== 401) break;
      token = null; // expired: a new token, once
    }
    const rem = parseInt(res.headers.get('x-rate-limit-remaining'), 10);
    if (Number.isFinite(rem)) { ledger.remaining = rem; ledger.remainingAt = Date.now(); persist(); }
    if (res.status === 429) {
      // The account is out of credits: rest as long as OpenSky says, at least ten minutes.
      const wait = parseInt(res.headers.get('x-rate-limit-retry-after-seconds'), 10);
      pauseUntil = Date.now() + Math.max(600, Number.isFinite(wait) ? wait : 3600) * 1000;
      ledger.remaining = 0;
      persist();
      throw new Error('dagbudget op (HTTP 429)');
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || !Number.isFinite(data.time)) throw new Error('onbruikbaar antwoord');
    if (lastError) log.info('opensky', 'OpenSky levert weer');
    lastError = null;
    lastOkAt = Date.now();
    return toAdsb(data);
  } catch (err) {
    const msg = String((err && err.name === 'AbortError' ? 'geen antwoord' : err && err.message) || err);
    if (msg !== lastError) log.warn('opensky', 'OpenSky: ' + msg);
    lastError = msg;
    if (/sleutel geweigerd/.test(msg)) pauseUntil = Date.now() + 30 * 60000;
    return null;
  } finally {
    busy = false;
  }
}

function start({ dir, fetch: f, logger } = {}) {
  if (logger) log = logger;
  fetchFn = f || globalThis.fetch;
  if (dir) { file = path.join(dir, 'opensky.json'); load(); }
}

// The key from the settings; empty values remove it.
function setKey(clientId, clientSecret) {
  clientId = String(clientId || '').trim();
  clientSecret = String(clientSecret || '').trim();
  creds = clientId && clientSecret ? { clientId, clientSecret } : null;
  token = null; pauseUntil = 0; lastError = null;
  persist();
  return status();
}

// What the settings and the status line show; never the secret itself.
function status(now = Date.now()) {
  rollDay(now);
  const g = gap(now);
  return {
    configured: !!creds,
    clientId: creds ? creds.clientId : '',
    usedToday: ledger.used,
    remaining: ledger.remaining,
    budget: budget(now),
    gapS: Number.isFinite(g) ? Math.round(g / 1000) : null,
    pausedUntil: pauseUntil > now ? pauseUntil : null,
    lastOkAt,
    lastError,
  };
}

// For tests: forget everything held in memory.
function reset() {
  creds = null; token = null; tokenUntil = 0; file = null;
  ledger = { day: null, used: 0, remaining: null, remainingAt: 0 };
  last = 0; pauseUntil = 0; busy = false; lastError = null; lastOkAt = 0;
}

module.exports = { start, setKey, status, configured, ready, fetchArea, box, sqdeg, toAdsb, budget, gap, reset, RESERVE, LOCAL_MAX };
