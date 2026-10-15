// Publishes the built version as a GitHub release, from which every dashboard updates itself:
// `npm run release` after `npm run dist` and `npm run dist:mac`.
// Uploads the Windows installer, the Mac installer and the Mac update archives, with SHA256SUMS.txt
// (the dashboards check every download against it) and the notes of this version from CHANGELOG.md.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const v = pkg.version;
const tag = `v${v}`;
const repo = pkg.palv.updateRepo;
const dist = path.join(root, 'dist');
const GH = process.platform === 'win32' && fs.existsSync('C:\\Program Files\\GitHub CLI\\gh.exe') ? 'C:\\Program Files\\GitHub CLI\\gh.exe' : 'gh';

const files = [
  `P-ALV-Dashboard-Setup-${v}.exe`,
  `P-ALV-Dashboard-${v}-mac.pkg`,
  `P-ALV-Dashboard-${v}-mac-x64.tar.gz`,
  `P-ALV-Dashboard-${v}-mac-arm64.tar.gz`,
].map((f) => path.join(dist, f));
const missing = files.filter((f) => !fs.existsSync(f));
if (missing.length) {
  console.error('Eerst bouwen (npm run dist && npm run dist:mac); ontbreekt:\n  ' + missing.join('\n  '));
  process.exit(1);
}

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sums = path.join(dist, 'SHA256SUMS.txt');
fs.writeFileSync(sums, files.map((f) => `${sha(f)}  ${path.basename(f)}`).join('\n') + '\n');

// The section of this version from the changelog, without its heading.
const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const m = new RegExp(`^## ${v.replace(/\./g, '\\.')}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(log);
if (!m) {
  console.error(`Geen sectie "## ${v}" in CHANGELOG.md`);
  process.exit(1);
}
const notes = path.join(dist, `release-notes-${v}.md`);
fs.writeFileSync(notes, m[1].trim() + '\n');

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', tag]);
run(GH, ['release', 'create', tag, ...files, sums, '--repo', repo, '--title', `P-ALV Dashboard ${v}`, '--notes-file', notes, '--latest']);
console.log(`\nRelease ${tag} gepubliceerd op https://github.com/${repo}/releases/tag/${tag}`);
