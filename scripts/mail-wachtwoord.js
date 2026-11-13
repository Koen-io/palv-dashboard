#!/usr/bin/env node
// Het afzenderadres van het dashboard koppelen (1.51), alleen uitgaand.
//
//   node scripts/mail-wachtwoord.js [--adres <e-mail>] [--dir <map>]
//
// Bedoeld voor een Gmail-adres met een app-wachtwoord (Google-account > Beveiliging > Verificatie in
// twee stappen aan > App-wachtwoorden). Een persoonlijk Outlook.com-adres werkt niet: Microsoft weigert
// SMTP met een wachtwoord en een eigen Microsoft-login vraagt een Azure-account met creditcard.
//
// Het script vraagt het adres en het app-wachtwoord (onzichtbaar getypt), test ze bij de mailserver en
// geeft het wachtwoord versleuteld met de eenheidssleutel van dit scherm (AES-256-GCM) aan het dashboard,
// via mail-setup.json in de gebruikersmap. Het dashboard neemt het binnen enkele seconden over, deelt het
// met de andere schermen van de eenheid en haalt het bestand weg. Het wachtwoord komt nergens leesbaar op
// schijf, niet in de code en niet in de repository.
// PALV_MAIL_LOG=<bestand>: schrijft wat er op het scherm komt ook naar een bestand (het wachtwoord niet).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Mailservers per domein: SMTP met een (app-)wachtwoord.
const SERVERS = {
  'gmail.com': { host: 'smtp.gmail.com', port: 465, hint: 'het app-wachtwoord van 16 tekens (niet het gewone Gmail-wachtwoord)' },
  'googlemail.com': { host: 'smtp.gmail.com', port: 465, hint: 'het app-wachtwoord van 16 tekens (niet het gewone Gmail-wachtwoord)' },
  'gmx.com': { host: 'mail.gmx.com', port: 587, hint: 'het wachtwoord (zet in GMX eerst POP3/IMAP-toegang aan)' },
  'gmx.net': { host: 'mail.gmx.net', port: 587, hint: 'het wachtwoord (zet in GMX eerst POP3/IMAP-toegang aan)' },
  'yahoo.com': { host: 'smtp.mail.yahoo.com', port: 465, hint: 'het app-wachtwoord van Yahoo' },
};
const NOPE = /@(outlook|hotmail|live|msn)\.[a-z.]+$/i;

if (process.env.PALV_MAIL_LOG) {
  for (const s of [process.stdout, process.stderr]) {
    const w = s.write.bind(s);
    s.write = (c, ...r) => { try { fs.appendFileSync(process.env.PALV_MAIL_LOG, String(c)); } catch { /* no log */ } return w(c, ...r); };
  }
}
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };

function userDir() {
  if (arg('--dir')) return arg('--dir');
  if (process.platform === 'win32') return path.join(process.env.APPDATA, 'P-ALV Dashboard');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'P-ALV Dashboard');
  return path.join(os.homedir(), '.config', 'P-ALV Dashboard');
}

function sealKey(dir) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, 'unit-key.json'), 'utf8'));
  const k = Buffer.from(String(d.key || ''), 'base64url');
  if (k.length !== 32) throw new Error('geen eenheidssleutel');
  return Buffer.from(crypto.hkdfSync('sha256', k, Buffer.alloc(0), 'palv-mail-v1', 32));
}
function seal(plain, k) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv, { authTagLength: 16 });
  c.setAAD(Buffer.from('palv-mail'));
  const ct = Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final(), c.getAuthTag()]);
  return { v: 1, iv: iv.toString('base64url'), ct: ct.toString('base64url') };
}

// One line from the keyboard; `hidden`: nothing of it is shown, not even stars.
function ask(q, hidden = false) {
  return new Promise((resolve, reject) => {
    const inp = process.stdin;
    process.stdout.write(q);
    inp.setEncoding('utf8');
    if (hidden && inp.isTTY) inp.setRawMode(true);
    inp.resume();
    let s = '';
    const done = (v) => { if (hidden && inp.isTTY) inp.setRawMode(false); inp.pause(); inp.off('data', on); if (hidden) process.stdout.write('\n'); resolve(v); };
    const on = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') return done(hidden ? s : s.trim());
        if (c === '\u0003') { if (hidden && inp.isTTY) inp.setRawMode(false); process.stdout.write('\n'); return reject(new Error('afgebroken')); }
        if (c === '\u007f' || c === '\b') { s = s.slice(0, -1); if (!hidden) process.stdout.write('\b \b'); } else if (c >= ' ') s += c;
      }
    };
    inp.on('data', on);
  });
}

(async () => {
  const dir = userDir();
  console.log('\n  P-ALV Dashboard  ·  afzenderadres voor e-mail koppelen');
  console.log(`  Map: ${dir}\n`);
  let k;
  try { k = sealKey(dir); } catch { console.error('  Dit scherm heeft (nog) geen eenheidssleutel. Start het dashboard eerst een keer.'); process.exit(1); }
  const user = String(arg('--adres') || await ask('  Afzenderadres (bijv. palv.dashboard@gmail.com): ')).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(user)) { console.error('  Dit is geen geldig e-mailadres.'); process.exit(1); }
  if (NOPE.test(user)) { console.error('  Een Outlook-, Hotmail- of Live-adres werkt niet: Microsoft staat mailen met een wachtwoord niet toe.'); process.exit(3); }
  const srv = SERVERS[user.split('@')[1]];
  if (!srv) { console.error(`  Voor ${user.split('@')[1]} is geen mailserver bekend. Gebruik een Gmail-adres.`); process.exit(1); }
  const raw = await ask(`  Voer ${srv.hint} in (je ziet niets terwijl je typt): `, true);
  const pw = srv.host === 'smtp.gmail.com' ? raw.replace(/\s+/g, '') : raw; // Google shows it in groups of four
  if (!pw) { console.error('  Geen wachtwoord ingevoerd.'); process.exit(1); }
  process.stdout.write(`  Testen bij ${srv.host} ... `);
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({ host: srv.host, port: srv.port, secure: srv.port === 465, requireTLS: srv.port !== 465, tls: { minVersion: 'TLSv1.2' }, auth: { user, pass: pw }, connectionTimeout: 20000 });
  try {
    await t.verify();
    console.log('gelukt.');
  } catch (err) {
    const m = String(err.response || err.message || err);
    console.log('mislukt.\n');
    if (/534|5\.7\.9|application-specific/i.test(m)) console.error('  Gmail vraagt een app-wachtwoord: zet verificatie in twee stappen aan en maak een app-wachtwoord.');
    else if (/535|5\.7\.8|username and password/i.test(m)) console.error('  Het adres of het (app-)wachtwoord klopt niet.');
    console.error(`  Antwoord van de server: ${m.slice(0, 220)}`);
    process.exit(2);
  } finally { t.close(); }
  const file = path.join(dir, 'mail-setup.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify({ v: 1, auth: 'smtp', user, host: srv.host, port: srv.port, secret: seal(pw, k), at: Date.now(), by: os.hostname(), tested: true }), { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
  console.log('\n  Gekoppeld en versleuteld opgeslagen met de eenheidssleutel. Het dashboard neemt het binnen');
  console.log('  enkele seconden over en deelt het met de andere schermen. Je kunt dit venster sluiten.\n');
})().catch((err) => { console.error(`\n  Fout: ${err.message}`); process.exit(1); });
