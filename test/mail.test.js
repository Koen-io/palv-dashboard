// 1.51: het e-mailsjabloon (handtekening, melding, disclaimer, ontsnappen van invoer) en het verzegelen
// van het wachtwoord zoals scripts/mail-wachtwoord.js het doet.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const t = require('../src/main/mail-template');

const sample = () => t.build({
  module: 'COA PLANNER', title: 'Plan <b>1</b>', subtitle: 'H-hour 131430Z NOV 26', message: 'regel 1\nregel 2 & <script>', by: 'J. de Vries',
  sections: [{ heading: 'Overzicht', rows: [['AT', '270°T'], ['Leeg', ''], ['Positie', 'N51', true]] }],
  table: { cols: ['COA', 'HDG'], rows: [[{ v: 'COA 1', badge: 'BRC' }, '270°']], highlight: [0] },
  warnings: ['APPROACH INTO SUN', ''], attachments: [{ name: 'a.pdf', size: 2048 }], screen: 'PC', sentAt: Date.parse('2026-11-13T13:12:00Z'),
});

test('het bericht draagt de melding, de disclaimer en de handtekening', () => {
  const { html, text } = sample();
  assert.match(html, /Automatisch gegenereerd bericht/);
  assert.match(html, /kan niet worden geantwoord/);
  assert.match(html, /uitsluitend bestemd voor de geadresseerde/);
  assert.match(html, /onmiddellijk en blijvend te verwijderen/);
  assert.match(html, /cid:palv-logo/);
  assert.match(html, /P-ALV DASHBOARD/);
  assert.match(html, /131312Z NOV 26/);
  assert.match(text, /NIET BEANTWOORDEN/);
  assert.match(text, /uitsluitend bestemd voor de geadresseerde/);
  assert.match(text, /a\.pdf/);
});

test('invoer wordt ontsnapt en lege velden blijven weg', () => {
  const { html } = sample();
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('Plan &lt;b&gt;1&lt;/b&gt;'));
  assert.ok(html.includes('regel 1<br>regel 2'));
  assert.ok(!/>Leeg</.test(html));
  assert.ok(html.includes('BRC'));
});

test('het verzegelde wachtwoord van het script opent met de afgeleide eenheidssleutel', () => {
  const unitKey = crypto.randomBytes(32);
  const k = Buffer.from(crypto.hkdfSync('sha256', unitKey, Buffer.alloc(0), 'palv-mail-v1', 32));
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv, { authTagLength: 16 });
  c.setAAD(Buffer.from('palv-mail'));
  const ct = Buffer.concat([c.update('geheim wachtwoord'), c.final(), c.getAuthTag()]);
  const unit = require('../src/main/unit');
  unit._set(unitKey);
  assert.ok(unit.derive('palv-mail-v1').equals(k));
  const d = crypto.createDecipheriv('aes-256-gcm', unit.derive('palv-mail-v1'), iv, { authTagLength: 16 });
  d.setAAD(Buffer.from('palv-mail'));
  d.setAuthTag(ct.subarray(ct.length - 16));
  assert.strictEqual(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]).toString(), 'geheim wachtwoord');
});
