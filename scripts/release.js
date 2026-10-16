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

// The notes for the update pop-up: the section of this version from the changelog, and those of any
// versions in between that were never published (each under its own heading then), so no change is
// left out. The dashboards show at most 4000 characters of it.
const log = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const sections = [...log.matchAll(/^## (\d+\.\d+\.\d+)\s*$([\s\S]*?)(?=^## |(?![\s\S]))/gm)].map((x) => ({ v: x[1], text: x[2].trim() }));
const cmp = (x, y) => { const a = x.split('.').map(Number), b = y.split('.').map(Number); for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
if (!sections.some((x) => x.v === v)) {
  console.error(`Geen sectie "## ${v}" in CHANGELOG.md`);
  process.exit(1);
}
let published = null;
try { published = execFileSync(GH, ['release', 'view', '--repo', repo, '--json', 'tagName', '-q', '.tagName'], { cwd: root, encoding: 'utf8' }).trim().replace(/^v/, ''); } catch { /* no release yet */ }
const unpublished = sections.filter((x) => cmp(x.v, v) <= 0 && (!published || cmp(x.v, published) > 0));
const body = unpublished.length > 1 ? unpublished.map((x) => `## ${x.v}\n\n${x.text}`).join('\n\n') : unpublished[0].text;
if (body.length > 4000) console.warn(`Let op: de notities zijn ${body.length} tekens; de pop-up toont er 4000.`);
const notes = path.join(dist, `release-notes-${v}.md`);
fs.writeFileSync(notes, body + '\n');
// Tags of versions in between that were only made locally go along, so the history on GitHub is whole.
const tags = unpublished.map((x) => `v${x.v}`).filter((t) => { try { execFileSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${t}`], { cwd: root, stdio: 'ignore' }); return true; } catch { return false; } });
console.log(`Notities voor ${unpublished.map((x) => x.v).join(', ')} (laatst gepubliceerd: ${published || 'geen'})`);

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
run('git', ['push', 'origin', 'main']);
run('git', ['push', 'origin', ...new Set([...tags, tag])]);
run(GH, ['release', 'create', tag, ...files, sums, '--repo', repo, '--title', `P-ALV Dashboard ${v}`, '--notes-file', notes, '--latest']);
console.log(`\nRelease ${tag} gepubliceerd op https://github.com/${repo}/releases/tag/${tag}`);
