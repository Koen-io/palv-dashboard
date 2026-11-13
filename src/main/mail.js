// E-mail from the dashboard (1.51): every screen of the unit sends from one address of its own, outgoing
// only (nothing is ever read from the mailbox).
//
// Which address: the one linked with scripts/mail-wachtwoord.js, a Gmail address with an app password
// (Google allows sending from a program over SMTP with one). A personal Outlook.com address does not work:
// Microsoft refuses SMTP with a password ("SmtpClientAuthentication is disabled for the Mailbox") and its
// own sign-in needs an Azure account with a credit card.
//
// The account and its secret:
// - kept once for the whole unit in its private shared file (plan-private.json, list 'keys', item 'mail':
//   { user, host, port, secret }), so every screen that holds the unit key can send, nothing to set per screen;
// - the app password is sealed with AES-256-GCM under a key derived from the unit key
//   (unit.derive('palv-mail-v1')): never in plain text on disk, never to the renderer, never in the code or
//   the repository. A screen without the unit key cannot open it;
// - the script asks for it in a terminal (hidden input), tests it and leaves it sealed in mail-setup.json in
//   the user data folder; this module takes it over within a few seconds, shares it with the other screens
//   and removes the file.
//
// The message itself is built by mail-template.js; the attachments (PDF, PNG) are rendered here from the
// HTML the tab passes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, ipcMain, BrowserWindow, nativeImage } = require('electron');
const unit = require('./unit');
const template = require('./mail-template');

const INFO = 'palv-mail-v1';
const AAD = Buffer.from('palv-mail');
const MAX_TO = 20;
const MAX_BYTES = 20 * 1024 * 1024;   // Gmail takes 25 MB per message, base64 included
const RECENT = 12;

let store = null, poke = () => {}, log = { info() {}, warn() {} }, screenName = () => '', dir = null, test = false;
let lastSend = 0, sending = 0;

/* ---------- sealing ---------- */
function key() { const k = unit.derive(INFO); if (!k) throw new Error('Dit scherm heeft de eenheidssleutel nog niet'); return k; }
function seal(plain, k = key()) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv, { authTagLength: 16 });
  c.setAAD(AAD);
  const ct = Buffer.concat([c.update(Buffer.from(String(plain), 'utf8')), c.final(), c.getAuthTag()]);
  return { v: 1, iv: iv.toString('base64url'), ct: ct.toString('base64url') };
}
function open(box, k = key()) {
  const blob = Buffer.from(String(box.ct), 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(String(box.iv), 'base64url'), { authTagLength: 16 });
  d.setAAD(AAD);
  d.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([d.update(blob.subarray(0, blob.length - 16)), d.final()]).toString('utf8');
}

/* ---------- the account ---------- */
const account = () => { const a = store.get('private').keys.mail; return a && !a.deleted && a.secret ? a : null; };

function status() {
  const a = account();
  let usable = false;
  if (a) { try { open(a.secret); usable = true; } catch { usable = false; } }
  return {
    address: a ? a.user : null,
    configured: !!a,
    usable,
    auth: a ? a.auth : null,
    setAt: a ? a.setAt || a.updatedAt : null,
    by: a ? a.by || null : null,
    lastOk: a ? a.lastOk || null : null,
    problem: a && !usable ? 'Het wachtwoord is versleuteld met een andere eenheidssleutel; koppel het adres opnieuw' : (a && a.problem) || null,
  };
}

// mail-setup.json from scripts/mail-wachtwoord.js: { v, user, auth, secret: sealed, fp, at, by }.
function pickup() {
  const file = path.join(dir, 'mail-setup.json');
  if (!fs.existsSync(file)) return;
  let d = null;
  try { d = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return; }
  try {
    if (!d || !d.secret) throw new Error('leeg');
    open(d.secret); // proves it was sealed with this unit's key
    if (d.auth !== 'smtp' || !EMAIL.test(String(d.user || '')) || !/^[a-z0-9.-]+$/i.test(String(d.host || ''))) throw new Error('onvolledig');
    store.put('private', 'keys', 'mail', { user: String(d.user).toLowerCase(), auth: 'smtp', host: String(d.host), port: +d.port || 465, secret: d.secret, setAt: +d.at || Date.now(), by: String(d.by || '').slice(0, 60), lastOk: d.tested ? Date.now() : null, problem: null });
    poke();
    log.info('mail', `afzenderadres ${d.user} gekoppeld en gedeeld met de eenheid`);
  } catch (err) {
    log.warn('mail', `mail-setup.json niet te gebruiken: ${err.message}`);
  }
  try { fs.rmSync(file, { force: true }); } catch { /* next round */ }
}

/* ---------- sending over SMTP ---------- */
async function transport(a) {
  const nodemailer = require('nodemailer');
  const port = +a.port || 465;
  return nodemailer.createTransport({
    host: a.host, port, secure: port === 465, requireTLS: port !== 465, tls: { minVersion: 'TLSv1.2', servername: a.host },
    auth: { user: a.user, pass: open(a.secret) }, connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 60000,
  });
}

// What the mail server answers, in words a crew member understands.
function explain(err) {
  const m = String((err && (err.response || err.message)) || err);
  if (/534|5\.7\.9|application-specific password/i.test(m)) return 'Gmail vraagt een app-wachtwoord in plaats van het gewone wachtwoord. Koppel het adres opnieuw met een app-wachtwoord.';
  if (/535|5\.7\.8|5\.7\.139|authentication|invalid login|username and password/i.test(m)) return 'De mailserver weigert het wachtwoord (ingetrokken of gewijzigd). Koppel het adres opnieuw met scripts/mail-wachtwoord.js.';
  if (/550 5\.4\.5|daily.*limit|quota|rate limit|421 4\.7/i.test(m)) return 'De mailserver vraagt even te wachten of het daglimiet is bereikt. Probeer het later opnieuw.';
  if (/5\.1\.[0-9]|recipient|mailbox unavailable|no such user/i.test(m)) return `Een ontvangeradres wordt geweigerd: ${m.slice(0, 160)}`;
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|timeout|EAI_AGAIN|ESOCKET/i.test(m)) return 'Geen verbinding met de mailserver. Controleer de internetverbinding en probeer het opnieuw.';
  return m.slice(0, 240);
}

/* ---------- attachments ---------- */
let logoCache = null;
function logo() {
  if (logoCache) return logoCache;
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'logo.png'));
  // 2x the size it is shown at (62 px), so it is sharp on a phone too, and small enough for every message.
  logoCache = nativeImage.createFromBuffer(src).resize({ width: 124, height: 124, quality: 'best' }).toPNG();
  return logoCache;
}

async function withPage(html, opts, fn) {
  const w = new BrowserWindow({ show: false, width: opts.width || 900, height: opts.height || 1200, backgroundColor: '#ffffff', webPreferences: { offscreen: true, javascript: true, sandbox: true, zoomFactor: opts.zoom || 1 } });
  try {
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    w.webContents.on('will-navigate', (e) => e.preventDefault());
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    return await fn(w);
  } finally { w.destroy(); }
}

const pdf = (f) => withPage(f.html, {}, (w) => w.webContents.printToPDF({ pageSize: f.pageSize === 'A4' ? 'A4' : 'A5', landscape: !!f.landscape, printBackground: true, margins: { marginType: 'custom', top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 } }));

// An image of the same page: laid out at its print width, captured at 2x and trimmed to the content.
async function png(f) {
  const cssW = Math.max(320, Math.min(1400, +f.width || 560));
  const zoom = 2;
  return withPage(f.html, { width: cssW * zoom, height: 1200, zoom }, async (w) => {
    await w.webContents.executeJavaScript(`document.documentElement.style.background='#fff';document.body.style.background='#fff';document.body.style.padding='${f.pad || 16}px';document.body.style.width='${cssW - 2 * (f.pad || 16)}px';0`);
    const hgt = await w.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
    w.setContentSize(cssW * zoom, Math.min(6000, hgt * zoom));
    await new Promise((r) => setTimeout(r, 250));
    const img = await w.webContents.capturePage();
    const sz = img.getSize();
    const out = sz.width !== cssW * zoom ? img.resize({ width: cssW * zoom, quality: 'best' }) : img;
    return out.toPNG();
  });
}

async function render(f) {
  const name = String(f.name || 'bijlage').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 120);
  if (f.format === 'pdf') return { filename: `${name}.pdf`, content: await pdf(f), contentType: 'application/pdf', label: f.label || 'PDF' };
  if (f.format === 'png') return { filename: `${name}.png`, content: await png(f), contentType: 'image/png', label: f.label || 'Afbeelding' };
  throw new Error(`Formaat ${f.format} wordt hier nog niet gemaakt`);
}

/* ---------- recipients ---------- */
const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const clean = (list) => [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim().toLowerCase()).filter(Boolean))];
function recent() { const r = store.get('private').settings['mail-recent']; return r && Array.isArray(r.list) ? r.list.slice(0, RECENT) : []; }
function remember(list) {
  const next = [...new Set([...list, ...recent()])].slice(0, RECENT);
  store.put('private', 'settings', 'mail-recent', { list: next });
  poke();
}

/* ---------- sending ---------- */
// job: { to, cc, subject, by, message, content (mail-template), files: [{ format, name, html, pageSize, landscape, width, label }] }
async function send(job) {
  const to = clean(job.to), cc = clean(job.cc);
  if (!to.length) throw new Error('Vul ten minste één ontvanger in');
  const bad = [...to, ...cc].filter((x) => !EMAIL.test(x));
  if (bad.length) throw new Error(`Dit is geen geldig e-mailadres: ${bad[0]}`);
  if (to.length + cc.length > MAX_TO) throw new Error(`Maximaal ${MAX_TO} ontvangers per bericht`);
  if (sending) throw new Error('Er wordt al een e-mail verzonden; een ogenblik');
  if (Date.now() - lastSend < 3000) throw new Error('Even wachten: er is net een e-mail verzonden');
  sending++;
  try {
    const files = [];
    for (const f of (Array.isArray(job.files) ? job.files : []).slice(0, 6)) files.push(await render(f));
    const bytes = files.reduce((s, f) => s + f.content.length, 0);
    if (bytes * 1.37 > MAX_BYTES) throw new Error('De bijlagen zijn samen te groot voor één e-mail');
    const sentAt = Date.now();
    const c = job.content || {};
    const by = String(job.by || '').trim().slice(0, 80);
    const msg = String(job.message || '').slice(0, 4000);
    const built = template.build({ ...c, by, message: msg, screen: screenName(), sentAt, attachments: files.map((f) => ({ name: f.filename, size: f.content.length, label: f.label })) });
    const subject = String(job.subject || c.title || 'Bericht').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
    const mail = {
      to, cc: cc.length ? cc : undefined,
      subject: `[P-ALV] ${subject}`,
      text: built.text,
      html: built.html,
      attachments: [{ filename: 'palv-logo.png', content: logo(), cid: 'palv-logo', contentType: 'image/png', contentDisposition: 'inline' }, ...files.map((f) => ({ filename: f.filename, content: f.content, contentType: f.contentType }))],
      // An automatic message: out-of-office replies and the like are not sent back to it.
      headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All', 'X-Mailer': 'P-ALV Dashboard' },
    };
    if (test && process.env.PALV_MAIL_DRY) {
      fs.writeFileSync(process.env.PALV_MAIL_DRY, built.html);
      for (const f of files) fs.writeFileSync(`${process.env.PALV_MAIL_DRY}.${f.filename}`, f.content);
      return { ok: true, dry: true, to, cc, files: files.map((f) => f.filename) };
    }
    const a = account();
    if (!a) throw new Error('Er is nog geen afzenderadres gekoppeld. Koppel het met scripts/mail-wachtwoord.js.');
    mail.from = { name: template.FROM_NAME, address: a.user };
    const t = await transport(a);
    try {
      const info = await t.sendMail(mail);
      lastSend = Date.now();
      log.info('mail', `verzonden: "${subject}" aan ${to.length + cc.length} ontvanger(s), ${files.length} bijlage(n)`);
      store.put('private', 'keys', 'mail', { ...account(), lastOk: Date.now(), problem: null });
      remember([...to, ...cc]);
      return { ok: true, to, cc, files: files.map((f) => f.filename), id: info.messageId, at: lastSend };
    } catch (err) {
      log.warn('mail', `verzenden mislukt: ${String(err.response || err.message || err).slice(0, 200)}`);
      throw new Error(explain(err));
    } finally { t.close(); }
  } finally { sending--; }
}

/* ---------- start ---------- */
function start(opts) {
  ({ store, poke, log, screenName } = opts);
  test = !!opts.test;
  dir = app.getPath('userData');
  // In a test window the screens (and with them the unit key) are not started: the key is still needed here.
  if (!unit.has()) unit.load(dir, log);
  const safe = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { return { ok: false, error: String((err && err.message) || err) }; } };
  ipcMain.handle('mail:status', () => ({ ...status(), recent: recent() }));
  ipcMain.handle('mail:send', safe((_e, job) => send(job && typeof job === 'object' ? job : {})));
  ipcMain.handle('mail:preview', safe((_e, content) => ({ ok: true, html: template.build({ ...(content || {}), screen: screenName(), sentAt: Date.now() }).html.replace(/cid:palv-logo/g, `data:image/png;base64,${logo().toString('base64')}`) })));
  ipcMain.handle('mail:forgetRecent', safe((_e, addr) => { store.put('private', 'settings', 'mail-recent', { list: recent().filter((x) => x !== String(addr).toLowerCase()) }); poke(); return { ok: true }; }));
  pickup();
  setInterval(pickup, 3000).unref();
}

module.exports = { start, status, send, seal, open, explain, INFO, AAD, EMAIL };
