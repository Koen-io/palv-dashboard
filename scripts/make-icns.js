// Run with Electron: `electron scripts/make-icns.js <icon.png> <out.icns>`.
// Writes a macOS icon file holding the PNG in every size the Finder and the Dock ask for.
const { app, nativeImage } = require('electron');
const fs = require('fs');

const [src, out] = process.argv.slice(-2);
const TYPES = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];

app.whenReady().then(() => {
  const img = nativeImage.createFromPath(src);
  if (img.isEmpty()) throw new Error(`Cannot read ${src}`);
  const chunks = TYPES.map(([type, size]) => {
    const png = img.resize({ width: size, height: size, quality: 'best' }).toPNG();
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(out, Buffer.concat([head, body]));
  app.quit();
}).catch((err) => { console.error(err); app.exit(1); });
