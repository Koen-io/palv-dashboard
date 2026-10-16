// Code checks: `npm run lint` (also runs before every build).
// The renderer is a set of plain scripts that share their top-level names (index.html loads them in
// order). Those names are collected from the files themselves, so a typo in a name is still caught.
const fs = require('fs');
const path = require('path');
const js = require('@eslint/js');
const globals = require('globals');

const rendererDir = path.join(__dirname, 'src', 'renderer');
const rendererFiles = [
  ...fs.readdirSync(rendererDir).filter((f) => f.endsWith('.js')).map((f) => path.join(rendererDir, f)),
  ...['widgets', 'plan'].flatMap((d) => fs.readdirSync(path.join(rendererDir, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(rendererDir, d, f))),
];
const shared = {};
for (const file of rendererFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) shared[m[1] || m[2]] = 'writable';
}
// Set on window by model.js, astro.js, wx.js, squawk.js and suntable.js, and by Leaflet.
for (const name of Object.keys(require('./src/renderer/model.js'))) shared[name] = 'readonly';
Object.assign(shared, { ASTRO: 'readonly', WX: 'readonly', SQUAWK: 'readonly', SUN_TABLE: 'readonly', PLACES: 'readonly', L: 'readonly' });
// Zoek & Plan: the pure modules in plan/ hang one namespace each on window (and are required by the tests).
Object.assign(shared, { PlanGeo: 'readonly', PlanCoords: 'readonly', PlanWmm: 'readonly', PlanPerf: 'readonly', PlanUnits: 'readonly', PlanProfiles: 'readonly' });

module.exports = [
  { ignores: ['src/renderer/vendor/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['src/renderer/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...shared } },
    rules: {
      // Top-level names are shared between the scripts; only local leftovers count as unused.
      'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  {
    // Runs inside embedded pages (Windy, ADS-B Exchange), where these are the sites' own globals.
    files: ['src/renderer/widgets/windy.js', 'src/renderer/widgets/adsb.js'],
    languageOptions: { globals: { W: 'readonly', OLMap: 'readonly', ol: 'readonly' } },
  },
];
