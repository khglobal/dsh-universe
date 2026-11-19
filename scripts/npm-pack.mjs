// Packs @khglobal/dsh-universe for the public npm registry. Packs only; publishing is .github/workflows/npm-publish.yml.
//
// The tarball holds the minified bundle and what the DSH plugin page needs, nothing else: release/npm/package.json
// (the publish manifest; the workspace packages stay private), the two bundle files, the patch, icon, locale tables
// (with `meta.detail` naming the README for each language), the public README, three screenshots of the sample day and
// LICENSE. No sources, source maps, art package, fixtures or docs. scripts/check-tarball.mjs checks it.
//
// Versions follow the capabilities catalog (one source of truth): a public release is a member release that
// already exists there, with the same number and the same bundle bytes.
//
//   node scripts/npm-pack.mjs --version <x.y.z> --capabilities <capabilities catalog checkout> [--out <dir>]
//       Takes the bundle, patch, icon and locale tables of release x.y.z from the capabilities history (found by the
//       version in plugins/dsh-universe/package.json on origin/dev; bundle checked against its SHA256SUMS). Reads git objects only;
//       the checkout is not changed.
//   node scripts/npm-pack.mjs --local [--version 0.0.0-local] [--skip-build] [--out <dir>]
//       Packs this checkout's own build instead (CI and local checks; never published).
//
// Runs `npm pack --dry-run` (printed) and then a real pack into --out (default .tmp/npm). Prints one JSON line last:
// {tarball, version, source}.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values: opt } = parseArgs({ options: {
  version: { type: 'string' }, capabilities: { type: 'string' }, local: { type: 'boolean' },
  'skip-build': { type: 'boolean' }, out: { type: 'string' },
} });
if (!opt.local && !(opt.version && opt.capabilities)) {
  throw Error('usage: npm-pack.mjs --version <x.y.z> --capabilities <checkout> | --local [--version v] [--skip-build] [--out dir]');
}

/** Screenshots of the sample day (fixtures/dsh-sample.ts, no member data): published name → source in this repo. */
const SCREENSHOTS = { 'screenshots/city.png': 'docs/screenshots/city-day.png', 'screenshots/inside.png': 'docs/screenshots/room-market.png', 'screenshots/list.png': 'docs/screenshots/list.png' };
/** The plugin page's README for each interface language: one English README for both. */
const DETAIL = { en: 'README.md', zh: 'README.md' };
const BUNDLE = ['index.js', 'client.browser.js'];
const VENDORED = 'plugins/dsh-universe';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const git = (cwd, args) => execFileSync('git', args, { cwd, maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
const npm = (args, cwd) => {
  const r = spawnSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
  if (r.status !== 0) throw Error(`npm ${args.join(' ')} failed (${r.status})`);
  return r.stdout;
};

const manifest = JSON.parse(readFileSync(join(root, 'release/npm/package.json'), 'utf8'));
const stage = mkdtempSync(join(tmpdir(), 'dsh-universe-npm-'));
const put = (rel, data) => { mkdirSync(join(stage, rel, '..'), { recursive: true }); writeFileSync(join(stage, rel), data); };
let version, source;
try {
  // 1. The shipped pieces: from a catalog release, or from this checkout's build.
  /** @type {(rel: string) => Buffer} */
  let shipped;
  if (opt.local) {
    if (!opt['skip-build']) {
      const r = spawnSync(process.execPath, [join(root, 'scripts/build.mjs')], { stdio: 'inherit' });
      if (r.status !== 0) throw Error('build failed');
    }
    version = opt.version ?? '0.0.0-local';
    source = { kind: 'local', commit: git(root, ['rev-parse', 'HEAD']).toString().trim() };
    shipped = (rel) => readFileSync(join(root, 'plugin', rel.startsWith('bundle/') ? `dist/${rel.slice(7)}` : rel));
  } else {
    version = opt.version;
    const cap = resolve(opt.capabilities);
    if (!/^\d+\.\d+\.\d+$/u.test(version)) throw Error(`--version must be a plain x.y.z (catalog releases are): ${version}`);
    // The capabilities commit that vendored this version.
    // Merged releases only: the history of capabilities dev (origin/dev, else the checked-out HEAD).
    const ref = (() => { try { git(cap, ['rev-parse', '--verify', '-q', 'origin/dev']); return 'origin/dev'; } catch { return 'HEAD'; } })();
    const commits = git(cap, ['log', '--format=%H', ref, '--', `${VENDORED}/package.json`]).toString().trim().split('\n').filter(Boolean);
    const at = commits.find((c) => { try { return JSON.parse(git(cap, ['show', `${c}:${VENDORED}/package.json`])).version === version; } catch { return false; } });
    if (!at) throw Error(`${version} is not a release in the capabilities catalog history (${VENDORED}/package.json)`);
    const catalog = JSON.parse(git(cap, ['show', `${at}:catalog/plugins.json`]));
    const row = catalog.plugins.find((p) => p.id === manifest.name);
    if (!row?.releases?.some((r) => r.version === version)) throw Error(`${version} is vendored at ${at} but not registered in its catalog/plugins.json`);
    const vendoredPkg = JSON.parse(git(cap, ['show', `${at}:${VENDORED}/package.json`]));
    for (const k of ['exports', 'dsh', 'engines', 'icon']) {
      if (JSON.stringify(vendoredPkg[k]) !== JSON.stringify(manifest[k])) throw Error(`release ${version}: package.json "${k}" differs from release/npm/package.json; publish a newer release`);
    }
    shipped = (rel) => git(cap, ['show', `${at}:${VENDORED}/${rel}`]);
    const sums = shipped('bundle/SHA256SUMS').toString().trim().split('\n').map((l) => l.split(/\s+/u));
    for (const [sum, f] of sums) if (sha(shipped(`bundle/${f}`)) !== sum) throw Error(`release ${version}: bundle/${f} does not match its SHA256SUMS`);
    const src = JSON.parse(shipped('SOURCE.json'));
    source = { kind: 'capabilities', capabilitiesCommit: at, commit: src.commit };
  }

  // 2. Stage.
  for (const f of BUNDLE) put(`dist/${f}`, shipped(`bundle/${f}`));
  put('cordis.patch.yml', shipped('cordis.patch.yml'));
  put('icon.svg', shipped('icon.svg'));
  for (const [lang, doc] of Object.entries(DETAIL)) {
    const table = JSON.parse(shipped(`locale/${lang}.json`).toString());
    table.meta = { ...table.meta, detail: doc };
    put(`locale/${lang}.json`, JSON.stringify(table) + '\n');
  }
  for (const doc of new Set(Object.values(DETAIL))) cpSync(join(root, 'release/npm', doc), join(stage, doc));
  for (const [to, from] of Object.entries(SCREENSHOTS)) put(to, readFileSync(join(root, from)));
  put('screenshots.json', JSON.stringify(Object.keys(SCREENSHOTS), null, 2) + '\n');
  cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  put('package.json', JSON.stringify({ ...manifest, version }, null, 2) + '\n');

  // 3. Pack: dry run first (the listing npm itself reports), then the real tarball.
  console.error('[npm-pack] npm pack --dry-run:');
  npm(['pack', '--dry-run', '--ignore-scripts'], stage);
  const out = resolve(opt.out ?? join(root, '.tmp/npm'));
  mkdirSync(out, { recursive: true });
  const [packed] = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', out], stage));
  console.log(JSON.stringify({ tarball: join(out, packed.filename), version, source }));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
