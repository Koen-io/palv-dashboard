// Builds src/renderer/vendor/icao-landen.js and the flag set from VRS standing-data (CC0) + six ICAO blocks.
// node scripts/maak-landen.js <code-blocks.csv> <flag-icons/flags/4x3> src/renderer/vendor/icao-landen.js src/renderer/vendor/flags
const fs = require('fs'), path = require('path');
const [vrsFile, flagDir, outJs, outFlags] = process.argv.slice(2);
const rows = fs.readFileSync(vrsFile, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
const blocks = [];
for (const c of rows) {
  const cc = c[6].replace(/"/g, '').trim();
  if (!/^[A-Z]{2}$/.test(cc) || cc === 'ZZ' || cc.startsWith('X')) continue;
  blocks.push([parseInt(c[0], 16), parseInt(c[1], 16), cc]);
}
// Newer ICAO allocations not (yet) in VRS, as in tar1090's table from Annex 10.
for (const [s, e, cc] of [[0xC91000, 0xC917FF, 'AD'], [0xC92000, 0xC927FF, 'DM'], [0xC93000, 0xC937FF, 'KN'], [0xC94000, 0xC947FF, 'SS'], [0xC95000, 0xC957FF, 'TL'], [0xC97000, 0xC977FF, 'TV']]) {
  if (blocks.some((b) => b[0] <= e && b[1] >= s)) throw new Error('overlap ' + cc);
  blocks.push([s, e, cc]);
}
// Same country inside a block of the same country adds nothing (military sub-blocks): leave out.
const smallest = (x, skip) => { let best = null; for (const b of blocks) if (b !== skip && x >= b[0] && x <= b[1] && (!best || b[1] - b[0] < best[1] - best[0])) best = b; return best; };
const kept = blocks.filter((b) => { const outer = smallest(b[0], b); return !(outer && outer[2] === b[2] && outer[1] - outer[0] > b[1] - b[0]); });
kept.sort((a, b) => (a[1] - a[0]) - (b[1] - b[0]) || a[0] - b[0]);
const codes = [...new Set(kept.map((b) => b[2]))].sort();
const missing = codes.filter((cc) => !fs.existsSync(path.join(flagDir, cc.toLowerCase() + '.svg')));
if (missing.length) throw new Error('geen vlag voor ' + missing.join(' '));
fs.mkdirSync(outFlags, { recursive: true });
for (const cc of codes) fs.copyFileSync(path.join(flagDir, cc.toLowerCase() + '.svg'), path.join(outFlags, cc.toLowerCase() + '.svg'));
const body = kept.map((b) => `[0x${b[0].toString(16).toUpperCase().padStart(6, '0')},0x${b[1].toString(16).toUpperCase().padStart(6, '0')},'${b[2]}']`).join(',\n');
fs.writeFileSync(outJs, `'use strict';\n\n// ICAO 24-bit aircraft addresses by state of registry, smallest blocks first: the first block that holds an\n// address is the most precise one (a territory inside the block of its state, Hong Kong inside China).\n// From the VRS standing data (github.com/vradarserver/standing-data, code-blocks, CC0), which follows the\n// allocation table of ICAO Annex 10 Vol III and the UK CAA's sub-allocations, with six newer ICAO\n// allocations (Andorra, Dominica, Saint Kitts and Nevis, South Sudan, Timor-Leste, Tuvalu) added.\n// Built by scripts/maak-landen.js; the flags beside it in vendor/flags are flag-icons (MIT).\nconst ICAO_LANDEN = [\n${body},\n];\n`);
console.log('blokken', kept.length, 'van', blocks.length, 'landen', codes.length);
