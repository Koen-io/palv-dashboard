// The state of registry from the ICAO address (vendor/icao-landen.js), for the flag in the aircraft card.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'src', 'renderer', 'vendor');
const ctx = {};
vm.runInNewContext(fs.readFileSync(path.join(dir, 'icao-landen.js'), 'utf8') + '\nthis.ICAO_LANDEN = ICAO_LANDEN;', ctx);
const table = ctx.ICAO_LANDEN;
const land = (hex) => { const x = parseInt(hex, 16); const b = table.find((r) => x >= r[0] && x <= r[1]); return b ? b[2] : null; };

test('landen: bekende adresblokken uit ICAO Annex 10', () => {
  const cases = {
    '480000': 'NL', '487fff': 'NL', '3c6444': 'DE', '44cdc1': 'BE', '3944ef': 'FR', '4ca5b3': 'IE', '4b1800': 'CH', '4d0000': 'LU',
    '400000': 'GB', '43c6f4': 'GB', '424000': 'BM', 'a12345': 'US', 'ae1234': 'US', 'c03000': 'CA', '7c4920': 'AU', 'e48000': 'BR',
    '0d0000': 'MX', '710000': 'SA', '896000': 'AE', '06a000': 'QA', '780000': 'CN', '780180': 'HK', '780108': 'MO', 'c91000': 'AD',
  };
  for (const [hex, cc] of Object.entries(cases)) assert.strictEqual(land(String(hex).padStart(6, '0')), cc, hex);
});

test('landen: niet toegewezen adressen hebben geen land', () => {
  for (const hex of ['000001', '4d0400', 'f00000', 'ffffff']) assert.strictEqual(land(hex), null, hex);
});

test('landen: kleinste blok eerst, en voor elk land een vlag', () => {
  for (let i = 1; i < table.length; i += 1) assert.ok(table[i][1] - table[i][0] >= table[i - 1][1] - table[i - 1][0], `volgorde bij ${i}`);
  for (const cc of new Set(table.map((r) => r[2]))) assert.ok(fs.existsSync(path.join(dir, 'flags', `${cc.toLowerCase()}.svg`)), `vlag ${cc}`);
});
