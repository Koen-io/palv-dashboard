// Builds the macOS app and its .pkg installer on any platform: `npm run dist:mac`.
//
// electron-builder only makes Mac packages on a Mac, so this puts the app together by hand: the
// official Electron build for macOS is read straight from its zip (symlinks and file modes intact,
// which a Windows disk cannot hold), the dashboard is added to it, and the result is written as a
// tar archive. The installer is a flat package without payload: its postinstall script unpacks the
// app for the Mac's processor into /Applications.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const yauzl = require('yauzl');
const plist = require('plist');
const { downloadArtifact } = require('@electron/get');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const electronVersion = require('electron/package.json').version;
const APP_NAME = pkg.productName;
const BUNDLE = `${APP_NAME}.app`;
const APP_ID = pkg.build.appId;
const ARCHS = ['x64', 'arm64'];
const outDir = path.join(root, 'dist');
const MTIME = Math.floor(Date.now() / 1000);

/* ---------- reading the Electron zip ---------- */
function readZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, decodeStrings: true }, (err, zip) => {
      if (err) return reject(err);
      const entries = [];
      zip.on('error', reject);
      zip.on('end', () => resolve(entries));
      zip.on('entry', (entry) => {
        const mode = entry.externalFileAttributes >>> 16;
        const type = (mode & 0o170000) === 0o120000 ? 'link' : /\/$/.test(entry.fileName) ? 'dir' : 'file';
        if (type === 'dir') {
          entries.push({ name: entry.fileName.replace(/\/$/, ''), type, mode: 0o755 });
          return zip.readEntry();
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e) return reject(e);
          const parts = [];
          stream.on('data', (d) => parts.push(d));
          stream.on('error', reject);
          stream.on('end', () => {
            const data = Buffer.concat(parts);
            if (type === 'link') entries.push({ name: entry.fileName, type, target: data.toString('utf8') });
            else entries.push({ name: entry.fileName, type, mode: mode & 0o111 ? 0o755 : 0o644, data });
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

/* ---------- the app bundle as a list of entries ---------- */
function walk(dir, base) {
  const out = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, item.name), rel = `${base}/${item.name}`;
    if (item.isDirectory()) out.push({ name: rel, type: 'dir', mode: 0o755 }, ...walk(abs, rel));
    else out.push({ name: rel, type: 'file', mode: 0o644, data: fs.readFileSync(abs) });
  }
  return out;
}

async function bundleEntries(arch, icns) {
  const zipFile = await downloadArtifact({ version: electronVersion, platform: 'darwin', arch, artifactName: 'electron' });
  const res = `${BUNDLE}/Contents/Resources`;
  const entries = [];
  let minimumSystem = null;
  for (const e of await readZip(zipFile)) {
    if (e.name !== 'Electron.app' && !e.name.startsWith('Electron.app/')) continue; // licence and version files next to the app
    e.name = BUNDLE + e.name.slice('Electron.app'.length);
    if (e.name === `${res}/default_app.asar` || e.name === `${res}/electron.icns`) continue;
    if (e.name === `${BUNDLE}/Contents/Info.plist`) {
      const info = plist.parse(e.data.toString('utf8'));
      minimumSystem = info.LSMinimumSystemVersion;
      // The executables keep Electron's own names: the helper apps are found by that name.
      Object.assign(info, {
        CFBundleName: APP_NAME,
        CFBundleDisplayName: APP_NAME,
        CFBundleIdentifier: APP_ID,
        CFBundleShortVersionString: pkg.version,
        CFBundleVersion: pkg.version,
        CFBundleIconFile: 'icon.icns',
        LSApplicationCategoryType: 'public.app-category.utilities',
        NSHumanReadableCopyright: `${pkg.author} — ${pkg.description}`,
      });
      delete info.ElectronAsarIntegrity;
      e.data = Buffer.from(plist.build(info) + '\n', 'utf8');
    }
    entries.push(e);
  }
  if (!entries.some((e) => e.name === `${BUNDLE}/Contents/MacOS/Electron` && e.mode === 0o755)) throw new Error('Electron executable missing from the download');
  entries.push({ name: `${res}/icon.icns`, type: 'file', mode: 0o644, data: icns });

  const appDir = `${res}/app`;
  const manifest = { name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, author: pkg.author, main: pkg.main };
  entries.push(
    { name: appDir, type: 'dir', mode: 0o755 },
    { name: `${appDir}/package.json`, type: 'file', mode: 0o644, data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: `${appDir}/src`, type: 'dir', mode: 0o755 }, ...walk(path.join(root, 'src'), `${appDir}/src`),
    { name: `${appDir}/assets`, type: 'dir', mode: 0o755 }, ...walk(path.join(root, 'assets'), `${appDir}/assets`),
    { name: `${appDir}/build`, type: 'dir', mode: 0o755 },
    { name: `${appDir}/build/icon.png`, type: 'file', mode: 0o644, data: fs.readFileSync(path.join(root, 'build', 'icon.png')) },
  );
  return { entries, minimumSystem };
}

/* ---------- tar (ustar, GNU long names where needed) ---------- */
function tarHeader({ name, mode, size, type, target = '' }) {
  const b = Buffer.alloc(512);
  const octal = (value, len) => value.toString(8).padStart(len - 1, '0') + '\0';
  b.write(name, 0, 100, 'utf8');
  b.write(octal(mode, 8), 100);
  b.write(octal(0, 8), 108);           // uid root
  b.write(octal(80, 8), 116);          // gid admin
  b.write(octal(size, 12), 124);
  b.write(octal(MTIME, 12), 136);
  b.write('        ', 148);
  b.write(type, 156);
  b.write(target, 157, 100, 'utf8');
  b.write('ustar\0' + '00', 257, 'latin1');
  b.write('root', 265);
  b.write('admin', 297);
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return b;
}
const tarPad = (len) => Buffer.alloc((512 - (len % 512)) % 512);

function tarball(entries) {
  const parts = [];
  const longField = (type, value) => {
    const data = Buffer.from(value + '\0', 'utf8');
    parts.push(tarHeader({ name: '././@LongLink', mode: 0o644, size: data.length, type }), data, tarPad(data.length));
  };
  for (const e of entries) {
    const name = e.type === 'dir' ? e.name + '/' : e.name;
    if (Buffer.byteLength(name) > 100) longField('L', name);
    if (e.type === 'link' && Buffer.byteLength(e.target) > 100) longField('K', e.target);
    const short = Buffer.from(name).subarray(0, 100).toString('utf8');
    if (e.type === 'dir') parts.push(tarHeader({ name: short, mode: e.mode, size: 0, type: '5' }));
    else if (e.type === 'link') parts.push(tarHeader({ name: short, mode: 0o755, size: 0, type: '2', target: e.target }));
    else parts.push(tarHeader({ name: short, mode: e.mode, size: e.data.length, type: '0' }), e.data, tarPad(e.data.length));
  }
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts), { level: 9 });
}

/* ---------- cpio (odc), the format of a package's Scripts archive ---------- */
function cpio(files) {
  const parts = [];
  let ino = 1;
  const add = (name, mode, data) => {
    const o = (value, len) => value.toString(8).padStart(len, '0');
    const nameBuf = Buffer.from(name + '\0', 'utf8');
    parts.push(Buffer.from('070707' + o(0, 6) + o(ino++, 6) + o(mode, 6) + o(0, 6) + o(0, 6) + o(mode & 0o40000 ? 2 : 1, 6) + o(0, 6) + o(MTIME, 11) + o(nameBuf.length, 6) + o(data.length, 11), 'latin1'), nameBuf, data);
  };
  add('.', 0o40755, Buffer.alloc(0));
  for (const f of files) add('./' + f.name, 0o100000 | f.mode, f.data);
  ino = 0;
  add('TRAILER!!!', 0, Buffer.alloc(0));
  return Buffer.concat(parts);
}

/* ---------- xar, the container of a flat package ---------- */
function xar(files) {
  const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
  let offset = 20; // the heap starts with the SHA-1 of the table of contents
  const items = files.map((f, i) => {
    const sum = sha1(f.data);
    const xml = ` <file id="${i + 1}">
  <name>${f.name}</name>
  <type>file</type>
  <mode>0644</mode>
  <uid>0</uid>
  <gid>0</gid>
  <data>
   <length>${f.data.length}</length>
   <offset>${offset}</offset>
   <size>${f.data.length}</size>
   <encoding style="application/octet-stream"/>
   <extracted-checksum style="sha1">${sum}</extracted-checksum>
   <archived-checksum style="sha1">${sum}</archived-checksum>
  </data>
 </file>`;
    offset += f.data.length;
    return xml;
  });
  const toc = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<xar>
<toc>
 <checksum style="sha1">
  <offset>0</offset>
  <size>20</size>
 </checksum>
 <creation-time>${new Date(MTIME * 1000).toISOString().replace(/\.\d+Z$/, 'Z')}</creation-time>
${items.join('\n')}
</toc>
</xar>
`, 'utf8');
  const packed = zlib.deflateSync(toc, { level: 9 });
  const head = Buffer.alloc(28);
  head.writeUInt32BE(0x78617221, 0);   // 'xar!'
  head.writeUInt16BE(28, 4);
  head.writeUInt16BE(1, 6);
  head.writeBigUInt64BE(BigInt(packed.length), 8);
  head.writeBigUInt64BE(BigInt(toc.length), 16);
  head.writeUInt32BE(1, 24);           // SHA-1
  return Buffer.concat([head, packed, crypto.createHash('sha1').update(packed).digest(), ...files.map((f) => f.data)]);
}

/* ---------- installer ---------- */
const postinstall = () => `#!/bin/bash
# Installs ${APP_NAME} ${pkg.version} into /Applications.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="/Applications/${BUNDLE}"

ARCH=x64
if [ "$(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then ARCH=arm64; fi
echo "${APP_NAME} ${pkg.version}: installing the $ARCH build"

# A running copy keeps its files open; close it before it is replaced.
/usr/bin/pkill -f "$APP/Contents/" 2>/dev/null || true
sleep 1

/bin/rm -rf "$APP"
/usr/bin/tar -xzf "$HERE/app-$ARCH.tar.gz" -C /Applications
# Owned by the user at the screen, so the dashboard can update itself later without a password.
OWNER="$(/usr/bin/stat -f %Su /dev/console 2>/dev/null)"
if [ -n "$OWNER" ] && [ "$OWNER" != "root" ] && id "$OWNER" >/dev/null 2>&1; then
  /usr/sbin/chown -R "$OWNER":admin "$APP"
else
  /usr/sbin/chown -R root:admin "$APP"
fi
/bin/chmod -R u+rwX,go+rX,go-w "$APP"
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

# The app carries no developer certificate. A local (ad-hoc) signature is what Apple silicon
# requires before it runs anything, and it keeps the bundle consistent on Intel.
/usr/bin/codesign --force --deep --sign - "$APP" 2>&1 || echo "ad-hoc signing skipped"
/usr/bin/touch "$APP"

test -x "$APP/Contents/MacOS/Electron"
echo "${APP_NAME} installed in $APP"
exit 0
`;

const packageInfo = () => `<?xml version="1.0" encoding="utf-8"?>
<pkg-info overwrite-permissions="true" relocatable="false" identifier="${APP_ID}.pkg" postinstall-action="none" version="${pkg.version}" format-version="2" auth="root">
    <scripts>
        <postinstall file="./postinstall"/>
    </scripts>
</pkg-info>
`;

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const icnsFile = path.join(outDir, 'icon.icns');
  execFileSync(require('electron'), [path.join(__dirname, 'make-icns.js'), path.join(root, 'build', 'icon.png'), icnsFile], { stdio: 'inherit' });
  const icns = fs.readFileSync(icnsFile);
  fs.rmSync(icnsFile);

  const scripts = [{ name: 'postinstall', mode: 0o755, data: Buffer.from(postinstall().replace(/\r\n/g, '\n'), 'utf8') }];
  for (const arch of ARCHS) {
    const { entries, minimumSystem } = await bundleEntries(arch, icns);
    const tgz = tarball(entries);
    scripts.push({ name: `app-${arch}.tar.gz`, mode: 0o644, data: tgz });
    console.log(`${arch}: Electron ${electronVersion}, macOS ${minimumSystem}+, ${entries.length} entries, ${(tgz.length / 1e6).toFixed(1)} MB`);
    // The app on its own per processor: what the automatic update installs, and a fallback without
    // installer (unpack and drag the app to Applications).
    fs.writeFileSync(path.join(outDir, `P-ALV-Dashboard-${pkg.version}-mac-${arch}.tar.gz`), tgz);
  }

  const out = path.join(outDir, `P-ALV-Dashboard-${pkg.version}-mac.pkg`);
  fs.writeFileSync(out, xar([
    { name: 'PackageInfo', data: Buffer.from(packageInfo(), 'utf8') },
    { name: 'Scripts', data: zlib.gzipSync(cpio(scripts), { level: 1 }) },
  ]));
  console.log(`${out}: ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
}

main().catch((err) => { console.error(err); process.exit(1); });
