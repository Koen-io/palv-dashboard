// Fetches Tor for the Browser tab (Windows) into build/tor, from where the installer takes it along:
// `node scripts/haal-tor.js`, run by `npm run dist` before building.
//
// The Tor Expert Bundle of the Tor Project: tor.exe, the bridges (lyrebird) and the GeoIP files.
// The download is checked against the SHA-256 below, taken from sha256sums-signed-build.txt of this
// version after its signature checked out against the Tor Browser signing key
// (EF6E286DDA85EA2A4BA7DE684E2C6E8793298290). A new version: verify the same way, then change both lines.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const VERSION = '16.0';
const SHA256 = '2ee123e9167318a3742778ff704e75f01d4780f05a14522d451fe011011077c4';
const FILE = `tor-expert-bundle-windows-x86_64-${VERSION}.tar.gz`;
const URL = `https://archive.torproject.org/tor-package-archive/torbrowser/${VERSION}/${FILE}`;

const root = path.join(__dirname, '..');
const out = path.join(root, 'build', 'tor');
const stamp = path.join(out, 'VERSION');

async function main() {
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === `${VERSION} ${SHA256}`) {
    console.log(`Tor ${VERSION} staat al klaar in build/tor`);
    return;
  }
  console.log(`Tor ${VERSION} ophalen…`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`downloaden mislukt: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash('sha256').update(data).digest('hex');
  if (got !== SHA256) throw new Error(`controlegetal klopt niet (${got}); niets uitgepakt`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'palv-tor-'));
  try {
    const tgz = path.join(tmp, FILE);
    fs.writeFileSync(tgz, data);
    const x = path.join(tmp, 'x');
    fs.mkdirSync(x);
    // Windows 10 and later have tar (bsdtar) on board; that one, not a GNU tar earlier on the path (Git Bash),
    // which reads "C:" as a remote host.
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(fs.existsSync(sysTar) ? sysTar : 'tar', ['-xzf', tgz, '-C', x], { stdio: 'inherit' });
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, 'pt'), { recursive: true });
    fs.mkdirSync(path.join(out, 'docs'), { recursive: true });
    // Only what the dashboard uses: tor itself, lyrebird for the bridges (obfs4, snowflake, meek), the GeoIP
    // files and the licences.
    const copy = (from, to) => fs.copyFileSync(path.join(x, from), path.join(out, to));
    copy('tor/tor.exe', 'tor.exe');
    copy('tor/pluggable_transports/lyrebird.exe', 'pt/lyrebird.exe');
    copy('tor/pluggable_transports/pt_config.json', 'pt/pt_config.json');
    copy('data/geoip', 'geoip');
    copy('data/geoip6', 'geoip6');
    for (const f of fs.readdirSync(path.join(x, 'docs'))) copy(`docs/${f}`, `docs/${f}`);
    fs.writeFileSync(stamp, `${VERSION} ${SHA256}\n`);
    console.log(`Tor ${VERSION} klaar in build/tor`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Tor ophalen mislukt:', err.message);
  process.exit(1);
});
