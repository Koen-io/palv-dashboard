// What goes out of the dashboard, 1.33: nothing that names the unit, no tapped ship and no exact spot.
// Never touches the network. `node --test test/privacy.test.js`.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ua = require('../src/ua');

const SRC = path.join(__dirname, '..', 'src');
const quiet = { info() {}, warn() {} };
function sources(dir = SRC, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'vendor') sources(p, out); } else if (/\.(js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}

test('User-Agent: neutral names only, and every request takes them from ua.js', () => {
  for (const v of [ua.APP, ua.BROWSER]) assert.doesNotMatch(v, /palv|p-alv|police|politie|github|koen|dashboard/i, v);
  for (const f of sources()) {
    if (f.endsWith(`${path.sep}ua.js`)) continue;
    const text = fs.readFileSync(f, 'utf8');
    // A User-Agent written out anywhere else would bypass the one place that keeps it neutral.
    assert.doesNotMatch(text, /['"]User-Agent['"]\s*\]?\s*[:=]\s*[`'"]/, `${path.relative(SRC, f)} sets a User-Agent of its own`);
    assert.doesNotMatch(text, /const (APP_)?UA = ['"`]/, `${path.relative(SRC, f)} defines a User-Agent string of its own`);
  }
});

test('No servers in Russia', () => {
  for (const f of sources()) {
    const hosts = [...fs.readFileSync(f, 'utf8').matchAll(/(?:https?|wss?):\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    for (const h of hosts) assert.ok(!/\.(ru|su|рф)$/.test(h) && !/mail\.ru|yandex|vk\.com/.test(h), `${path.relative(SRC, f)}: ${h}`);
  }
});

test('Zoek & Plan: Photon (abroad) stays off until the unit turns it on', async () => {
  const geocode = require('../src/plan/geocode');
  const calls = [];
  const fetchJson = async (url) => { calls.push(url); if (/pdok/.test(url)) return { response: { docs: [] } }; return { features: [] }; };
  geocode.start({ fetchJson, log: quiet, autoUpdate: false });
  assert.strictEqual(geocode.world(), false, 'off by default');
  await geocode.suggest('Brussel Centraal', { lat: 52, lon: 5, world: true });
  await geocode.reverse(50.85, 4.35); // Brussels: outside the Netherlands
  assert.ok(calls.length > 0 && calls.every((u) => /api\.pdok\.nl/.test(u)), 'only PDOK was asked: ' + calls.join(' '));
  geocode.setWorld(true);
  await geocode.suggest('Brussel Noord', { lat: 52, lon: 5, world: true });
  assert.ok(calls.some((u) => /photon\.komoot\.io/.test(u)), 'Photon once it is allowed');
  geocode.setWorld(false);
  const before = calls.length;
  await geocode.suggest('Antwerpen Zuid', { lat: 52, lon: 5, world: true });
  await geocode.reverse(51.2, 4.4);
  assert.ok(calls.slice(before).every((u) => !/photon/.test(u)), 'off again: no Photon');
  geocode.stop();
});

test('Sea state: only a rounded point goes to Open-Meteo', async () => {
  const sea = require('../src/sea');
  sea._reset();
  const urls = [];
  sea.start({ fetchJson: async (url) => { urls.push(url); return { latitude: 52.1, longitude: 5, current: { time: '2026-11-09T10:00', wave_height: 1.2 } }; }, log: quiet });
  await sea.point(52.123456, 4.987654);
  assert.strictEqual(urls.length, 1);
  assert.match(urls[0], /latitude=52\.1000&longitude=5\.0000&/);
  assert.doesNotMatch(urls[0], /52\.12|4\.98/);
  await sea.point(52.11, 5.01); // same square: from the cache, nothing new goes out
  assert.strictEqual(urls.length, 1);
  assert.strictEqual(sea.snap(3.9876), 4);
});

test('Ship photos: a tap never goes outside; the background round takes every ship in turn', async () => {
  const ais = require('../src/ais');
  const P = ais._photo;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palv-privacy-'));
  P.setDir(dir);
  const out = [];
  const realFetch = global.fetch;
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  global.fetch = async (u, opts) => {
    out.push({ url: String(u), ua: opts && opts.headers && opts.headers['User-Agent'] });
    if (/commons\.wikimedia\.org/.test(String(u))) {
      return { ok: true, json: async () => ({ query: { pages: [{ title: 'File:Ship.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/960px-Ship.jpg', url: 'https://upload.wikimedia.org/x/Ship.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Ship.jpg', thumbwidth: 960, thumbheight: 640, extmetadata: { Artist: { value: '<a>Someone</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }] } }) };
    }
    return { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => JPEG };
  };
  try {
    const ship = (mmsi, imo, name) => {
      ais._ingest({ MessageType: 'PositionReport', MetaData: { MMSI: mmsi, ShipName: name }, Message: { PositionReport: { Latitude: 53, Longitude: 4, Sog: 10, Cog: 90, TrueHeading: 90 } } });
      ais._ingest({ MessageType: 'ShipStaticData', MetaData: { MMSI: mmsi }, Message: { ShipStaticData: { Name: name, ImoNumber: imo, Type: 70 } } });
    };
    ship(244000001, 9000001, 'FIRST SHIP');
    ship(244000002, 9000002, 'SECOND SHIP');

    // Tapping the second ship: nothing goes out, the card says "not yet".
    const tapped = await ais.photo({ imo: 9000002, name: 'SECOND SHIP' });
    assert.strictEqual(out.length, 0, 'a tap asks nothing outside');
    assert.strictEqual(tapped.pending, true);

    // The round does not move the tapped ship forward: the first one heard comes first.
    const next = P.nextForPhoto();
    assert.strictEqual(next.mmsi, '244000001');
    await P.fetchPhoto(next);
    assert.ok(out.length >= 2 && out.every((c) => c.ua === ua.APP), 'neutral name on every request');
    assert.ok(out.every((c) => /wikimedia\.org/.test(c.url)));

    // Now it is in the store: a tap reads it from disk, still without going out.
    const n = out.length;
    const got = await ais.photo({ imo: 9000001, name: 'FIRST SHIP' });
    assert.strictEqual(out.length, n, 'served from the store');
    assert.match(got.img.url, /^data:image\/jpeg;base64,/);
    assert.strictEqual(got.img.author, 'Someone');
    assert.strictEqual(got.img.licence, 'CC BY-SA 4.0');
    assert.ok(!('thumburl' in got.img) && !/upload\.wikimedia/.test(JSON.stringify(P.photos())), 'no outside link kept: the screen never loads the photo from Commons');

    // A screen that follows another one asks that screen, over the unit key, and nothing outside.
    const asked = [];
    P.setRole('follow', { id: 'lead', name: 'Lead', secure: true }, async (peer, p) => { asked.push(p); return P.photoForPeer(new URLSearchParams(p.split('?')[1]).get('k')); });
    const viaPeer = await ais.photo({ imo: 9000002, name: 'SECOND SHIP' });
    assert.deepStrictEqual(asked, ['/api/ais/photo?k=imo%3A9000002']);
    assert.strictEqual(viaPeer.pending, true, 'the lead has none yet either');
    assert.strictEqual(out.length, n, 'still nothing outside');
    assert.deepStrictEqual(P.photoForPeer('../../etc/passwd'), { ok: true, known: false }, 'only real keys are answered');
  } finally {
    global.fetch = realFetch;
    P.setRole('lead', null);
    ais.stop();
  }
});
