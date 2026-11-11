// The Browser tab: what the address bar makes of what is typed, letterboxing, the addresses that are
// never opened, https only, Tor's settings and log, and the tab in the layout (Windows yes, Mac no).
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/privbrowser-core');
const model = require('../src/renderer/model');

test('adresbalk: adressen worden geopend, de rest wordt gezocht', () => {
  assert.equal(core.toUrl('nos.nl', 'ddg'), 'https://nos.nl/');
  assert.equal(core.toUrl('https://www.knmi.nl/nederland-nu', 'ddg'), 'https://www.knmi.nl/nederland-nu');
  assert.equal(core.toUrl('sub.example.co.uk/pad?x=1', 'ddg'), 'https://sub.example.co.uk/pad?x=1');
  assert.equal(core.toUrl('duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion', 'ddg'), 'https://duckduckgogg42xjoc72x3sjasowoarfbgcmvfimaftt6twagswzczad.onion/');
  assert.equal(core.toUrl('weer schiphol', 'ddg'), 'https://duckduckgo.com/?q=weer%20schiphol');
  assert.equal(core.toUrl('EHAM', 'startpage'), 'https://www.startpage.com/do/search?q=EHAM');
  assert.equal(core.toUrl('3.14', 'ddg'), 'https://duckduckgo.com/?q=3.14');
  assert.equal(core.toUrl('', 'ddg'), null);
  // Never a script or a local file from the address bar: those are searched for as text.
  assert.match(core.toUrl('javascript:alert(1)', 'ddg'), /^https:\/\/duckduckgo\.com\/\?q=javascript/);
  assert.match(core.toUrl('file:///C:/Windows', 'ddg'), /^https:\/\/duckduckgo\.com\/\?q=/);
});

test('letterboxing: stappen van 200 bij 100, kleine schermen blijven heel', () => {
  assert.deepEqual(core.letterbox(1913, 987), { w: 1800, h: 900 });
  assert.deepEqual(core.letterbox(1600, 800), { w: 1600, h: 800 });
  assert.deepEqual(core.letterbox(350, 250), { w: 350, h: 250 });
  assert.deepEqual(core.letterbox(1913, 987, false), { w: 1913, h: 987 });
});

test('nooit deze computer of het lokale netwerk', () => {
  for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.1.1', '100.64.0.1', '[::1]', 'fd00::1', 'fe80::1', 'printer', 'nas.local', 'router.lan', 'x.localhost', '0.0.0.0']) {
    assert.equal(core.isLocalHost(h), true, h);
  }
  for (const h of ['nos.nl', '8.8.8.8', '172.32.0.1', '2a00:1450::1', 'example.onion']) assert.equal(core.isLocalHost(h), false, h);
});

test('alleen https, behalve .onion en wat uitdrukkelijk mag', () => {
  assert.equal(core.httpsUpgrade('http://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(core.httpsUpgrade('http://example.com:80/'), 'https://example.com/');
  assert.equal(core.httpsUpgrade('https://example.com/'), null);
  assert.equal(core.httpsUpgrade('http://abc.onion/'), null);
  assert.equal(core.httpsUpgrade('http://oud.example/', new Set(['oud.example'])), null);
});

test('ruis: per site en sessie hetzelfde, anders verschillend', () => {
  assert.equal(core.hash32('1|1|nos.nl'), core.hash32('1|1|nos.nl'));
  assert.notEqual(core.hash32('1|1|nos.nl'), core.hash32('1|1|knmi.nl'));
  assert.notEqual(core.hash32('1|1|nos.nl'), core.hash32('2|1|nos.nl'));
});

test('Tor: eigen poorten, alleen client, bruggen naar keuze', () => {
  const pt = { bridges: { obfs4: ['obfs4 1.2.3.4:443 AAA cert=x iat-mode=0', 'obfs4 5.6.7.8:80 BBB cert=y iat-mode=0'], snowflake: ['snowflake 192.0.2.3:80 CCC url=https://x/'] } };
  const base = { dataDir: 'D', geoip: 'G', geoip6: 'G6', ctlFile: 'C', cookieFile: 'K', lyrebird: 'L.exe', pt };
  const plain = core.torrc({ ...base, bridges: 'off' });
  assert.match(plain, /^SocksPort 127\.0\.0\.1:auto$/m);
  assert.match(plain, /^ControlPort 127\.0\.0\.1:auto$/m);
  assert.match(plain, /^ClientOnly 1$/m);
  assert.doesNotMatch(plain, /UseBridges/);
  const o = core.torrc({ ...base, bridges: 'obfs4' });
  assert.match(o, /^UseBridges 1$/m);
  assert.match(o, /^ClientTransportPlugin meek_lite,obfs4 exec L\.exe$/m);
  assert.equal(o.match(/^Bridge obfs4 /gm).length, 2);
  const s = core.torrc({ ...base, bridges: 'snowflake' });
  assert.match(s, /^ClientTransportPlugin snowflake exec L\.exe$/m);
  assert.match(s, /^Bridge snowflake /m);
});

test('Tor: voortgang, poort en waarschuwingen uit het logboek', () => {
  assert.deepEqual(core.torLine('Nov 09 15:07:46.000 [notice] Bootstrapped 45% (requesting_descriptors): Asking for relay descriptors'), { progress: 45, tag: 'requesting_descriptors', summary: 'Asking for relay descriptors' });
  assert.deepEqual(core.torLine('Nov 09 15:07:44.682 [notice] Socks listener listening on port 53585.'), { socksPort: 53585 });
  assert.equal(core.torLine('Nov 09 15:07:44.682 [warn] Problem bootstrapping.').warn, 'Problem bootstrapping.');
  assert.equal(core.torLine('Nov 09 15:07:44.682 [notice] Tor 0.4.9 opening log file.'), null);
});

test('tabblad Browser: op Windows erbij naast MadeSmart, op de Mac niet', () => {
  const win = model.defaultState({ privbrowser: true });
  assert.equal(win.pages.at(-1).name, 'Browser');
  assert.equal(win.pages.at(-1).widgets[0].type, 'privbrowser');
  assert.ok(!model.defaultState({ privbrowser: false }).pages.some((p) => p.name === 'Browser'));

  // An older layout (version 10, with MadeSmart) gets the tab on Windows, once; MadeSmart stays.
  const old = () => ({ version: 10, settings: {}, pages: [{ id: 'a', name: 'Operationeel', widgets: [] }, { id: 'm', name: 'MadeSmart', widgets: [{ id: 'b', type: 'browser', x: 0, y: 0, w: 96, h: 54, z: 1, cfg: {} }] }] });
  const up = model.normalize(old(), { privbrowser: true });
  assert.equal(up.pages.filter((p) => p.widgets.some((w) => w.type === 'privbrowser')).length, 1);
  assert.deepEqual(up.pages.map((p) => p.name), ['Operationeel', 'MadeSmart', 'Browser', 'COA Planner']);
  assert.equal(up.settings.privbrowser.mode, 'tor');
  assert.ok(Array.isArray(up.settings.privbrowser.favorites));
  // Removed by hand afterwards: it stays away.
  const removed = { ...up, pages: up.pages.filter((p) => p.name !== 'Browser') };
  assert.ok(!model.normalize(JSON.parse(JSON.stringify(removed)), { privbrowser: true }).pages.some((p) => p.name === 'Browser'));
  // The Mac never has it, also not from an imported Windows layout.
  const mac = model.normalize(JSON.parse(JSON.stringify(up)), { privbrowser: false });
  assert.ok(!mac.pages.some((p) => p.widgets.some((w) => w.type === 'privbrowser')));
  assert.ok(mac.pages.some((p) => p.name === 'MadeSmart'), 'MadeSmart blijft op de Mac');
  assert.ok(!mac.pages.some((p) => p.name === 'Browser'));
});
