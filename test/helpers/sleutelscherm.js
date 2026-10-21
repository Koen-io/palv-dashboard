// One dashboard for the unit key test (sleutel.test.js), in a process of its own: the real screens.js and
// unit.js on a port of its own, a user data folder of its own, and one private route that only a
// dashboard with the key may read. The test drives it through messages.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'palv-sleutel-'));
const screens = require('../../src/main/screens');

const routes = {
  '/api/plan/sync': (req, res, caller, respond) => (caller && caller.secure
    ? respond(res, 200, 'application/json', JSON.stringify({ geheim: process.env.SCREEN_ID }))
    : respond(res, 403, 'text/plain', 'Niet toegestaan')),
};

screens.start({ userData: dir, status: () => ({ now: Date.now(), version: 'test' }), onUpdate: () => {}, test: false, share: null, routes }).then(() => {
  process.send({ ready: true, port: screens.port(), id: screens.id() });
});

process.on('message', async (m) => {
  const reply = (x) => process.send({ reply: m.ask, ...x });
  try {
    if (m.add) { screens.add(m.add); return reply({}); }
    if (m.list) return reply({ list: screens.list(), auth: screens.auth() });
    if (m.code) return reply({ code: screens.pairCode() });
    if (m.pair) { screens.pair(m.pair); return reply({ auth: screens.auth() }); }
    if (m.poll) { await screens.pollAll(); return reply({}); }
  } catch (err) { reply({ error: err.message }); }
});
