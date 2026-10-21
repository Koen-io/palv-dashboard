// The unit key: one secret shared by all of the unit's own dashboards. Everything they send each other
// (live traffic, wind, the Zoek & Plan files) goes over TLS with this key (TLS-PSK, ECDHE-PSK with
// ChaCha20-Poly1305): both sides prove they hold the key, every byte is encrypted, and a recorded
// connection stays unreadable even if the key leaks later (a fresh ECDHE key per connection). A screen
// without the key gets nothing but the read-only status page.
//
// Without anything to set:
// - the first screen of the unit that starts this version makes the key;
// - a screen it already knew before (same id, same address) gets the key from it once, encrypted with a
//   one-off X25519 exchange, within 14 days after the key was made. Over Tailscale the address itself is
//   proof of who asks;
// - any other screen is paired once by hand: the pairing code from Instellingen > Schermen on a screen of
//   the unit, entered on the new one.
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const http = require('http');
const crypto = require('crypto');

const V = 1;
const HANDOUT_DAYS = 14;
const HANDOUT_MAX = 5;      // per screen: a screen that asks again (lost the answer) still gets it
const TLS = { ciphers: 'ECDHE-PSK-CHACHA20-POLY1305', minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' };
const IDENTITY = 'palv1';

let file = null, log = { info() {}, warn() {} };
let st = { key: null, createdAt: 0, legacy: [], given: {} };
let psk = null, fpr = null;
const listeners = new Set();

const hkdf = (key, info, len = 32) => Buffer.from(crypto.hkdfSync('sha256', key, Buffer.alloc(0), info, len));

function derive() {
  psk = st.key ? hkdf(st.key, 'palv-tls-psk-v1') : null;
  fpr = st.key ? hkdf(st.key, 'palv-fp-v1', 6).toString('hex') : null;
}

function load(dir, lg) {
  if (lg) log = lg;
  file = path.join(dir, 'unit-key.json');
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    const key = Buffer.from(String(d.key || ''), 'base64url');
    if (d.v === V && key.length === 32) st = { key, createdAt: +d.createdAt || Date.now(), legacy: Array.isArray(d.legacy) ? d.legacy : [], given: d.given || {} };
  } catch { /* none yet */ }
  derive();
}

function save() {
  if (!file) return;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ v: V, key: st.key ? st.key.toString('base64url') : null, createdAt: st.createdAt, legacy: st.legacy, given: st.given }, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch { /* not on every file system */ }
}

function set(key, createdAt, why) {
  const before = fpr;
  st.key = key;
  st.createdAt = createdAt;
  derive();
  save();
  if (before !== fpr) {
    log.info('sleutel', `eenheidssleutel ${why} (${fpr})`);
    for (const fn of listeners) { try { fn(); } catch { /* listener */ } }
  }
}

// A new key. `legacy`: the screens this one knew before, which may fetch it once by themselves.
function generate(legacy) {
  st.legacy = (legacy || []).filter((p) => p && p.id && p.address).map((p) => ({ id: String(p.id), address: String(p.address) }));
  st.given = {};
  set(crypto.randomBytes(32), Date.now(), 'gemaakt');
}

/* ---------- the pairing code ---------- */
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1: nothing to mix up when typed over
function code() {
  if (!st.key) return null;
  const data = Buffer.concat([st.key, hkdf(st.key, 'palv-code-check-v1', 2)]);
  let bits = 0, val = 0, out = '';
  for (const b of data) {
    val = ((val << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out.match(/.{1,4}/g).join('-');
}

function parseCode(text) {
  const s = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of s) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Deze koppelcode bevat een teken dat er niet in hoort');
    val = ((val << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  if (out.length < 34) throw new Error('Deze koppelcode is niet compleet');
  const key = Buffer.from(out.slice(0, 32)), check = Buffer.from(out.slice(32, 34));
  if (!hkdf(key, 'palv-code-check-v1', 2).equals(check)) throw new Error('Deze koppelcode klopt niet; controleer de tekens');
  return key;
}

function pair(text) {
  const key = parseCode(text);
  if (st.key && st.key.equals(key)) return status();
  st.legacy = []; st.given = {};
  set(key, Date.now(), 'ingevoerd');
  return status();
}

/* ---------- handing the key to a screen this one knew before ---------- */
// GET /api/pair (plain HTTP): `from` is the asking screen's id and address, `pub` its one-off X25519 key.
function handout(from, pub) {
  if (!st.key || !from || !from.id) return null;
  if (Date.now() - st.createdAt > HANDOUT_DAYS * 864e5) return null;
  const known = st.legacy.find((p) => p.id === from.id && p.address === from.address);
  if (!known || (st.given[from.id] || 0) >= HANDOUT_MAX) return null;
  let theirs;
  try { theirs = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: String(pub) }, format: 'jwk' }); } catch { return null; }
  const mine = crypto.generateKeyPairSync('x25519');
  const k = hkdf(crypto.diffieHellman({ privateKey: mine.privateKey, publicKey: theirs }), 'palv-pair-v1');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv, { authTagLength: 16 });
  c.setAAD(Buffer.from(fpr));
  const ct = Buffer.concat([c.update(st.key), c.final()]);
  st.given[from.id] = (st.given[from.id] || 0) + 1;
  save();
  log.info('sleutel', `eenheidssleutel gegeven aan ${from.name || from.id} (${from.address})`);
  return { v: V, pub: mine.publicKey.export({ format: 'jwk' }).x, iv: iv.toString('base64url'), ct: Buffer.concat([ct, c.getAuthTag()]).toString('base64url'), fp: fpr, createdAt: st.createdAt };
}

// Ask a screen of the unit for the key (plain HTTP, the answer encrypted for this request only).
function fetchFrom(peer, me) {
  const mine = crypto.generateKeyPairSync('x25519');
  const pub = mine.publicKey.export({ format: 'jwk' }).x;
  return new Promise((resolve, reject) => {
    const req = http.get({
      host: peer.address.replace(/^\[|\]$/g, ''), port: peer.port, path: '/api/pair', timeout: 5000, agent: false,
      headers: { 'X-Palv-Screen': JSON.stringify(me), 'X-Palv-Pair': pub },
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; if (buf.length > 4096) req.destroy(new Error('te groot')); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try {
          const a = JSON.parse(buf);
          const theirs = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: String(a.pub) }, format: 'jwk' });
          const k = hkdf(crypto.diffieHellman({ privateKey: mine.privateKey, publicKey: theirs }), 'palv-pair-v1');
          const blob = Buffer.from(String(a.ct), 'base64url');
          const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(String(a.iv), 'base64url'), { authTagLength: 16 });
          d.setAAD(Buffer.from(String(a.fp)));
          d.setAuthTag(blob.subarray(blob.length - 16));
          const key = Buffer.concat([d.update(blob.subarray(0, blob.length - 16)), d.final()]);
          if (key.length !== 32 || hkdf(key, 'palv-fp-v1', 6).toString('hex') !== a.fp) throw new Error('sleutel klopt niet');
          resolve({ key, createdAt: +a.createdAt || Date.now() });
        } catch (err) { reject(err); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('geen antwoord')));
    req.on('error', reject);
  });
}

async function adopt(peer, me) {
  const got = await fetchFrom(peer, me);
  set(got.key, got.createdAt, `ontvangen van ${peer.name || peer.address}`);
}

/* ---------- TLS ---------- */
const securePort = (port) => (+port || 0) + 1;

function serverOptions() {
  return { ...TLS, pskCallback: (_sock, identity) => (identity === IDENTITY && psk ? psk : null) };
}

function connect(host, port) {
  const key = psk;
  return tls.connect({
    ...TLS, host: String(host).replace(/^\[|\]$/g, ''), port,
    pskCallback: () => (key ? { psk: key, identity: IDENTITY } : null),
    checkServerIdentity: () => undefined,
  });
}

// One keep-alive agent per screen: a status round every 10 s costs no new handshake.
const agents = new Map();
function agentFor(host, port) {
  const k = `${fpr}|${host}|${port}`;
  let a = agents.get(k);
  if (!a) {
    a = new http.Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 2, timeout: 20000 });
    a.createConnection = (opts) => connect(opts.host || host, opts.port || port);
    agents.set(k, a);
  }
  return a;
}
function resetAgents() { for (const a of agents.values()) a.destroy(); agents.clear(); }

// A request to another screen of the unit, always over TLS. `o.stream`: a long-lived link of its own.
function request(peer, o, cb) {
  const host = peer.address.replace(/^\[|\]$/g, ''), port = securePort(peer.port);
  const { stream, ...rest } = o;
  const opts = { host, port, ...rest };
  if (stream) opts.createConnection = () => connect(host, port);
  else opts.agent = agentFor(host, port);
  return http.get(opts, cb);
}

function status() {
  return {
    v: V,
    fp: fpr,
    since: st.key ? st.createdAt : null,
    handout: !!st.key && Date.now() - st.createdAt < HANDOUT_DAYS * 864e5 && st.legacy.length > 0,
  };
}

const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
onChange(resetAgents);

module.exports = {
  load, generate, pair, code, parseCode, handout, adopt, fetchFrom, request, connect, serverOptions, securePort, status, onChange,
  has: () => !!st.key, fp: () => fpr, createdAt: () => st.createdAt, IDENTITY, TLS,
  _set: (key, createdAt = Date.now()) => set(key, createdAt, 'test'),
};
