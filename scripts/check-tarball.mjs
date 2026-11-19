// Audits the public npm tarball of @khglobal/dsh-universe before it can be published (CI and npm-publish.yml).
//
//   node scripts/check-tarball.mjs <package.tgz> [--json]
//
// Lists every file with its size, then fails (exit 1) on anything outside the exact allowlist below: sources (.ts,
// .tsx), source maps, the art package, fixtures, docs, tests, dotfiles, install scripts or dependencies.
// The bundle is scanned for URLs, internal hostnames, private addresses, local paths and token shapes; the only
// product-specific name allowed in the bundle is one optional host service name (see DOCUMENTED).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** Exactly what the package may contain (paths inside the tarball's `package/`). */
export const ALLOWED = [
  'package.json', 'LICENSE', 'README.md', 'icon.svg', 'cordis.patch.yml',
  'locale/en.json', 'locale/zh.json', 'dist/index.js', 'dist/client.browser.js',
  'screenshots.json', 'screenshots/city.png', 'screenshots/inside.png', 'screenshots/list.png',
];
/** Upper bounds, so a stray asset or an unminified build cannot slip in under an allowed name. */
const MAX_BYTES = { 'dist/index.js': 200_000, 'dist/client.browser.js': 1_500_000, png: 400_000, other: 64_000, total: 3_000_000 };
/** Never in the tarball, whatever the allowlist says (kept separate so the reason is clear). */
const FORBIDDEN = [
  [/\.(ts|tsx|mts|cts)$/u, 'TypeScript source'], [/\.map$/u, 'source map'], [/(^|\/)src\//u, 'source directory'],
  [/(^|\/)(packages|art)\//u, 'workspace or art package'], [/(^|\/)fixtures?\//u, 'fixture'],
  [/(^|\/)docs\//u, 'docs'], [/(^|\/)tests?\//u, 'tests'], [/(^|\/)\./u, 'dotfile'], [/(^|\/)node_modules\//u, 'node_modules'],
];
/** Optional host service names the bundle may contain (session draft signal). */
const DOCUMENTED = ['workdshSessionDrafts'];
/** Patterns that must not appear in any shipped text file (READMEs, manifest, locale tables and the bundle). */
const SECRETS = [
  [/\bhttps?:\/\/(?!www\.w3\.org\/)[^\s"'`)]+/gu, 'URL'],
  [/\b[a-z0-9-]+\.(?:asterosuite\.com|kh\.holdings|kh\.limited)\b|\basterosuite\b|\bkh\.holdings\b/giu, 'KH-internal hostname'],
  [/\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/gu, 'private IP address'],
  [/\b(?:localhost|127\.0\.0\.1)\b/gu, 'loopback address'],
  [/(?:\/Users\/|\/home\/[a-z]|[A-Z]:\\\\Users)/gu, 'local path'],
  [/\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}|\bnpm_[A-Za-z0-9]{30,}|\bsk-[A-Za-z0-9]{20,}|\bAKIA[0-9A-Z]{16}\b|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bxox[bpas]-[A-Za-z0-9-]{10,}/gu, 'token or key'],
  [/sourceMappingURL/gu, 'source map reference'],
  [/\bworkdsh[A-Za-z]*|\bastero[A-Za-z]*/giu, 'host product name'],
  // The dev page's check globals (window.__dshuCity, __dshuRoom, __dshuLeakCheck) are compiled out of the shipped bundle.
  [/__dshu[A-Za-z]*/gu, 'dev-only debug global', 'js'],
];

/** The files of a .tgz: name (without `package/`) and size. Plain ustar, as npm writes it. */
export function listTarball(bytes) {
  const tar = gunzipSync(bytes), files = [];
  let longName;
  for (let off = 0; off + 512 <= tar.length;) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/su, '');
    const size = parseInt(str(124, 136).trim() || '0', 8), type = str(156, 157) || '0';
    const body = tar.subarray(off + 512, off + 512 + size);
    let name = longName ?? [str(345, 500), str(0, 100)].filter(Boolean).join('/');
    longName = undefined;
    if (type === 'L') longName = body.toString('utf8').replace(/\0.*$/su, '');
    else if (type === 'x') { const m = /\d+ path=([^\n]*)\n/u.exec(body.toString('utf8')); if (m) longName = m[1]; }
    else if (type === '0' || type === '') files.push({ path: name.replace(/^package\//u, ''), size, body });
    else if (type !== '5') files.push({ path: name.replace(/^package\//u, ''), size, body, odd: `entry type ${type}` });
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Every problem with the tarball's contents; empty means it may be published. */
export function audit(files, { license } = {}) {
  const problems = [], seen = new Set(files.map((f) => f.path));
  for (const f of files) {
    if (f.odd) problems.push(`${f.path}: ${f.odd} (only regular files may ship)`);
    for (const [re, why] of FORBIDDEN) if (re.test(f.path)) problems.push(`${f.path}: ${why} must not ship`);
    if (!ALLOWED.includes(f.path)) problems.push(`${f.path}: not in the allowlist (scripts/check-tarball.mjs)`);
    const cap = MAX_BYTES[f.path] ?? (f.path.endsWith('.png') ? MAX_BYTES.png : MAX_BYTES.other);
    if (f.size > cap) problems.push(`${f.path}: ${f.size} bytes, over the ${cap}-byte cap`);
    if (/\.(js|json|yml|md|svg)$/u.test(f.path)) {
      const text = f.body.toString('utf8');
      for (const [re, why, only] of SECRETS) {
        if (only === 'js' && !f.path.endsWith('.js')) continue;
        for (const m of text.matchAll(re)) {
          if (DOCUMENTED.includes(m[0])) continue;
          // The READMEs and manifest may link the npm page, the badge and the repository (and its README GIFs, kept out
          // of the tarball); the code may not.
          if (why === 'URL' && /\.(md|json)$/u.test(f.path) && /^https:\/\/(www\.npmjs\.com|github\.com\/khglobal\/dsh-universe|raw\.githubusercontent\.com\/khglobal\/dsh-universe\/|dsh-plugin\.org|registry\.npmjs\.org)\b/u.test(m[0])) continue;
          problems.push(`${f.path}: ${why} "${m[0].slice(0, 60)}"`);
        }
      }
    }
  }
  for (const p of ALLOWED) if (!seen.has(p)) problems.push(`${p}: missing`);
  const total = files.reduce((s, f) => s + f.size, 0);
  if (total > MAX_BYTES.total) problems.push(`total ${total} bytes, over the ${MAX_BYTES.total}-byte cap`);

  const pkgFile = files.find((f) => f.path === 'package.json');
  if (pkgFile) {
    const pkg = JSON.parse(pkgFile.body.toString('utf8'));
    if (pkg.private) problems.push('package.json: "private" is set');
    if (pkg.license !== 'SEE LICENSE IN LICENSE') problems.push(`package.json: license is ${JSON.stringify(pkg.license)}, expected "SEE LICENSE IN LICENSE"`);
    if (pkg.publishConfig?.access !== 'public') problems.push('package.json: publishConfig.access is not "public"');
    if (pkg.scripts && Object.keys(pkg.scripts).length) problems.push(`package.json: scripts must be empty (${Object.keys(pkg.scripts).join(', ')})`);
    for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'bundleDependencies', 'bundledDependencies']) {
      if (pkg[k] && Object.keys(pkg[k]).length) problems.push(`package.json: ${k} must be empty`);
    }
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/u.test(pkg.version ?? '')) problems.push(`package.json: version ${pkg.version} is not semver`);
    if (!pkg.keywords?.includes('dsh-plugin')) problems.push('package.json: keyword dsh-plugin missing');
    if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml' || !pkg.dsh?.client) problems.push('package.json: dsh.bundle.patch / dsh.client missing');
    if (!pkg.engines?.dsh) problems.push('package.json: engines.dsh missing');
  }
  const lic = files.find((f) => f.path === 'LICENSE');
  if (lic && license !== undefined && !lic.body.equals(license)) problems.push('LICENSE: differs from the repository LICENSE');
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const tgz = process.argv[2];
  if (!tgz) throw Error('usage: check-tarball.mjs <package.tgz> [--json]');
  const files = listTarball(readFileSync(tgz));
  const problems = audit(files, { license: readFileSync(new URL('../LICENSE', import.meta.url)) });
  const total = files.reduce((s, f) => s + f.size, 0);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ tarball: tgz, packed: readFileSync(tgz).length, unpacked: total, files: files.map(({ path, size }) => ({ path, size })), problems }));
  } else {
    for (const f of [...files].sort((a, b) => a.path.localeCompare(b.path))) console.log(`${String(f.size).padStart(9)}  ${f.path}`);
    console.log(`${String(total).padStart(9)}  total, ${files.length} files (tarball ${readFileSync(tgz).length} bytes)`);
    for (const p of problems) console.log(`check-tarball: ${p}`);
    console.log(problems.length ? `check-tarball: ${problems.length} problem(s); do not publish` : 'check-tarball: ok');
  }
  process.exit(problems.length ? 1 : 0);
}
