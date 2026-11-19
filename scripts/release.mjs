// Cuts a member release of @khglobal/dsh-universe into the capabilities catalog (the plugin catalog and npm source).
//
// The source stays here (source-available, see LICENSE). What goes to capabilities is only the built, minified bundle, vendored
// as plugins/dsh-universe/ with a "build" that copies bundle/ into dist/. From there the capabilities pipeline is the
// same as for every other plugin: its CI verifies the package, publish.yml writes it to the company npm source and the
// server catalog on merge, the server lists it in the admin center for approval.
//
//   node scripts/release.mjs --capabilities <catalog checkout on a new branch from origin/dev>
//                            [--commit] [--pr] [--merge] [--trailer "<line>"]...
//
// Versions: the first release is plugin/package.json's version (0.1.0). After that every release is the next patch of
// the latest one in the catalog (0.1.1, 0.1.2, …), or plugin/package.json's version if that is higher (raise it there
// for a minor). A release is cut only when the shipped content differs from the vendored copy on capabilities dev, so
// running this after every merge to dev is safe. Prints one JSON line: {released, version?, pr?}.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('..', import.meta.url));
const { values: opt } = parseArgs({ options: {
  capabilities: { type: 'string' }, commit: { type: 'boolean' }, pr: { type: 'boolean' }, merge: { type: 'boolean' },
  trailer: { type: 'string', multiple: true, default: [] }, 'skip-build': { type: 'boolean' },
} });
if (!opt.capabilities) throw Error('usage: release.mjs --capabilities <capabilities catalog checkout> [--commit] [--pr] [--merge]');
const cap = opt.capabilities;
const DIR = 'plugins/dsh-universe';
const target = join(cap, DIR);

const sh = (cmd, args, cwd = root, input) => execFileSync(cmd, args, { cwd, encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'inherit'] }).trim();
const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', 2, 2] }); if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed (${r.status})`); };
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const semver = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/u.exec(v); if (!m) throw Error(`not a plain semver: ${v}`); return m.slice(1).map(Number); };
const cmp = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

// 1. Build (typecheck + minified bundle). The build refuses to write anything when the types do not check.
if (!opt['skip-build']) run(process.execPath, [join(root, 'scripts/build.mjs')], root);
const src = json(join(root, 'plugin/package.json'));
const commit = sh('git', ['rev-parse', 'HEAD']);
if (sh('git', ['status', '--porcelain', '--', 'plugin', 'packages', 'scripts', 'release', 'LICENSE', 'package.json', 'package-lock.json'])) throw Error('working tree has changes: release only from a clean checkout');

// 2. Stage the vendored package (everything but the version-dependent files).
const stage = mkdtempSync(join(tmpdir(), 'dsh-universe-release-'));
try {
  const put = (rel, data) => { mkdirSync(join(stage, rel, '..'), { recursive: true }); writeFileSync(join(stage, rel), data); };
  const bundle = ['index.js', 'client.browser.js'];
  for (const f of bundle) cpSync(join(root, 'plugin/dist', f), join(stage, 'bundle', f));
  put('bundle/SHA256SUMS', bundle.map((f) => `${sha(readFileSync(join(stage, 'bundle', f)))}  ${f}`).join('\n') + '\n');
  for (const f of ['cordis.patch.yml', 'icon.svg', 'README.md']) cpSync(join(root, 'plugin', f), join(stage, f));
  for (const f of readdirSync(join(root, 'plugin/locale'))) cpSync(join(root, 'plugin/locale', f), join(stage, 'locale', f));
  cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
  cpSync(join(root, 'release/vendor'), stage, { recursive: true });
  const manifest = (version) => ({
    name: src.name, version, license: 'SEE LICENSE IN LICENSE', description: src.description, type: 'module',
    exports: src.exports,
    files: ['dist', 'cordis.patch.yml', 'icon.svg', 'locale/*.json', 'README.md', 'CHANGELOG.md', 'LICENSE'],
    scripts: { build: 'node scripts/build.mjs', test: "node --test 'tests/*.test.mjs'" },
    engines: src.engines, peerDependencies: src.peerDependencies, peerDependenciesMeta: src.peerDependenciesMeta,
    dsh: src.dsh, icon: src.icon,
  });

  // 3. Unchanged since the last vendored release? Compare every file except the version-dependent ones.
  const VERSIONED = new Set(['package.json', 'CHANGELOG.md', 'SOURCE.json']);
  const list = (d) => existsSync(d) ? readdirSync(d, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => relative(d, join(e.parentPath, e.name))).filter((f) => !f.startsWith('dist/') && !f.startsWith('node_modules/')).sort() : [];
  const before = list(target), after = list(stage);
  const prevPkg = existsSync(join(target, 'package.json')) ? json(join(target, 'package.json')) : undefined;
  const same = prevPkg && JSON.stringify(manifest(prevPkg.version)) === JSON.stringify(prevPkg)
    && JSON.stringify(before.filter((f) => !VERSIONED.has(f))) === JSON.stringify(after)
    && after.every((f) => readFileSync(join(target, f)).equals(readFileSync(join(stage, f))));
  if (same) { console.log(JSON.stringify({ released: false, version: prevPkg.version, reason: 'unchanged' })); process.exit(0); }

  // 4. Version.
  const catalogPath = join(cap, 'catalog/plugins.json');
  const catalog = json(catalogPath);
  let row = catalog.plugins.find((p) => p.id === src.name);
  const released = (row?.releases ?? []).map((r) => r.version).filter((v) => /^\d+\.\d+\.\d+$/u.test(v)).sort(cmp);
  const latest = released.at(-1);
  let version = src.version;
  if (latest) { const [a, b, c] = semver(latest); const next = `${a}.${b}.${c + 1}`; if (cmp(version, next) < 0) version = next; }
  semver(version);

  // 5. CHANGELOG: the previous one with this release on top, listing the source commits since the last release.
  const prevSource = existsSync(join(target, 'SOURCE.json')) ? json(join(target, 'SOURCE.json')).commit : undefined;
  // The previous release's source commit may not be in this history (the public repository started from a fresh
  // history); then list only this release's own commit instead of failing.
  const known = (c) => spawnSync('git', ['cat-file', '-e', `${c}^{commit}`], { cwd: root, stdio: 'ignore' }).status === 0;
  const subjects = !prevSource ? []
    : known(prevSource)
      ? sh('git', ['log', '--first-parent', '--format=%s', `${prevSource}..${commit}`, '--', 'plugin', 'packages', 'LICENSE']).split('\n').filter(Boolean)
      : [sh('git', ['log', '-1', '--format=%s', commit])];
  const day = new Date().toISOString().slice(0, 10);
  const head = `## ${version}（${day}）\n\n` + (subjects.length ? subjects.map((s) => `- ${s}`).join('\n') : '- 第一个成员版本。') + `\n\n来源：khglobal/dsh-universe@${commit.slice(0, 12)}\n`;
  const prevLog = existsSync(join(target, 'CHANGELOG.md')) ? readFileSync(join(target, 'CHANGELOG.md'), 'utf8').replace(/^# [^\n]*\n+/u, '') : '';
  put('CHANGELOG.md', `# 更新记录\n\n${head}${prevLog ? `\n${prevLog}` : ''}`);
  put('SOURCE.json', JSON.stringify({ repository: 'khglobal/dsh-universe', commit, version }, null, 2) + '\n');
  put('package.json', JSON.stringify(manifest(version), null, 2) + '\n');

  // 6. Into capabilities: replace the vendored directory, add the catalog row the first time.
  rmSync(target, { recursive: true, force: true });
  cpSync(stage, target, { recursive: true });
  if (!row) {
    const meta = (lang) => json(join(root, `plugin/locale/${lang}.json`)).meta;
    row = { id: src.name, group: 'official', source: { type: 'capabilities' }, defaultMode: 'hidden',
      title: { zh: meta('zh').title, en: meta('en').title }, description: { zh: meta('zh').description, en: meta('en').description }, releases: [] };
    catalog.plugins.push(row);
    writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  }

  // 7. The capabilities toolchain, exactly as its CI runs it: install (adds the lockfile importer the first time),
  //    build, register the release digest, then the full single-plugin verification.
  run('corepack', ['pnpm', 'install'], cap);
  run('corepack', ['pnpm', 'run', 'build'], target);
  run(process.execPath, ['tools/catalog.mjs', 'release', DIR], cap);
  run(process.execPath, ['tools/verify-plugin.mjs', DIR], cap);
  rmSync(join(cap, 'out'), { recursive: true, force: true });

  const out = { released: true, version, commit };
  if (opt.commit || opt.pr || opt.merge) {
    // The source commit in the name keeps it unique: a leftover branch for the same version (for example from an
    // attempt that never opened its PR) must not block the push.
    const branch = `dsh-universe/${version}-${commit.slice(0, 7)}`;
    sh('git', ['checkout', '-B', branch], cap);
    sh('git', ['add', '--', DIR, 'catalog/plugins.json', 'pnpm-lock.yaml'], cap);
    const trailers = opt.trailer.length ? `\n\n${opt.trailer.join('\n')}` : '';
    sh('git', ['commit', '-q', '-F', '-'], cap, `DSH Universe ${version}：发布 khglobal/dsh-universe@${commit.slice(0, 12)} 的构建\n\n只含压缩后的构建产物（源码与美术专有，留在 dsh-universe）。由 dsh-universe 的 scripts/release.mjs 生成，不要手改 ${DIR}/。${trailers}\n`);
    if (opt.pr || opt.merge) {
      sh('git', ['push', '-q', '-u', 'origin', branch], cap);
      const body = `## 内容\n\n\`@khglobal/dsh-universe\` ${version}：khglobal/dsh-universe@${commit} 的压缩构建，由该仓库的 \`scripts/release.mjs\` 生成并登记目录。源码与美术专有，不进本仓库；\`${DIR}/\` 只有构建产物，\`build\` 脚本把 \`bundle/\` 按 SHA256SUMS 核对后复制进 \`dist/\`。\n\n${head.replace(/^## /u, '### ')}\n## 验证\n\n- \`node tools/verify-plugin.mjs ${DIR}\`：构建、测试、打包两次可复现、依赖闭包、目录摘要、安装冒烟，生成时本地全部通过。\n- 本仓库 CI 的 \`plugins\` 检查。\n` + (process.env.RELEASE_PR_FOOTER ? `\n${process.env.RELEASE_PR_FOOTER}\n` : '');
      const pr = sh('gh', ['pr', 'create', '-R', 'khglobal/astero-capabilities', '--base', 'dev', '--head', branch,
        '--title', `DSH Universe ${version}`, '--body-file', '-'], cap, body);
      out.pr = pr;
      if (opt.merge) {
        const n = pr.split('/').at(-1);
        // Wait for every check to finish green (the auto-review routine may merge it first; that is fine too).
        const view = () => JSON.parse(sh('gh', ['pr', 'view', n, '-R', 'khglobal/astero-capabilities', '--json', 'state,statusCheckRollup']));
        for (let i = 0; ; i++) {
          const v = view();
          if (v.state === 'MERGED') break;
          const checks = v.statusCheckRollup ?? [];
          const done = checks.length > 0 && checks.every((c) => (c.status ?? 'COMPLETED') === 'COMPLETED');
          if (done) {
            const bad = checks.filter((c) => !['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(c.conclusion ?? c.state));
            if (bad.length) throw Error(`checks failed on ${pr}: ${bad.map((c) => c.name ?? c.context).join(', ')}`);
            run('gh', ['pr', 'merge', n, '-R', 'khglobal/astero-capabilities', '--admin', '--squash', '--delete-branch'], cap);
            break;
          }
          if (i > 120) throw Error(`checks did not finish on ${pr}`);
          await new Promise((r) => setTimeout(r, 15000));
        }
        out.merged = true;
      }
    }
  }
  console.log(JSON.stringify(out));
} finally {
  rmSync(stage, { recursive: true, force: true });
}
