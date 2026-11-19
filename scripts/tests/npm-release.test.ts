import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
// @ts-expect-error plain .mjs script without declarations
import { ALLOWED, audit, listTarball } from '../check-tarball.mjs';

type File = { path: string; size: number; body: Buffer };
const root = new URL('../../', import.meta.url);
const json = (rel: string) => JSON.parse(readFileSync(new URL(rel, root), 'utf8'));
const npmPkg = json('release/npm/package.json');
const LICENSE = readFileSync(new URL('LICENSE', root));

test('publish manifest: public, source-available, and the same plugin contract as plugin/package.json', () => {
  const plugin = json('plugin/package.json');
  assert.equal(npmPkg.name, plugin.name);
  assert.equal(npmPkg.private, undefined);
  assert.equal(npmPkg.license, 'SEE LICENSE IN LICENSE');
  assert.equal(npmPkg.publishConfig.access, 'public');
  for (const k of ['exports', 'dsh', 'engines', 'peerDependencies', 'peerDependenciesMeta', 'icon']) {
    assert.deepEqual(npmPkg[k], plugin[k], `release/npm/package.json "${k}" must match plugin/package.json`);
  }
  for (const k of ['dsh', 'dsh-plugin', 'deepseek-harness']) assert.ok(npmPkg.keywords.includes(k), k);
  assert.equal(npmPkg.scripts, undefined);
  assert.equal(npmPkg.dependencies, undefined);
  // Every allowed file is covered by "files" (package.json, README and LICENSE are always packed).
  for (const f of ALLOWED as string[]) {
    assert.ok(f === 'package.json' || npmPkg.files.some((p: string) => f === p || f.startsWith(`${p}/`)), `${f} not in files`);
  }
});

test('the workspace and its packages stay private', () => {
  assert.equal(json('package.json').private, true);
  assert.equal(json('plugin/package.json').private, true);
  for (const p of ['model', 'art', 'renderer', 'adapter-kit', 'adapter-dsh']) assert.equal(json(`packages/${p}/package.json`).private, true, p);
});

const text = (path: string, s: string): File => ({ path, size: Buffer.byteLength(s), body: Buffer.from(s) });
function clean(): File[] {
  return (ALLOWED as string[]).map((p) => {
    if (p === 'package.json') return text(p, JSON.stringify({ ...npmPkg, version: '1.2.3' }));
    if (p === 'LICENSE') return { path: p, size: LICENSE.length, body: LICENSE };
    if (p === 'dist/client.browser.js') return text(p, 'var U1="workdshSessionDrafts";var s="http://www.w3.org/2000/svg";');
    return text(p, 'x');
  });
}
const swap = (files: File[], path: string, body: string) => files.map((f) => (f.path === path ? text(path, body) : f));

test('check-tarball: the expected file set passes', () => {
  assert.deepEqual(audit(clean(), { license: LICENSE }), []);
});

test('check-tarball: sources, maps, art, fixtures, docs and stray files fail', () => {
  for (const extra of ['src/index.ts', 'dist/index.js.map', 'packages/art/src/kit.ts', 'fixtures/dsh-sample.ts', 'docs/img/guide-city.png',
    'mockups/index.html', 'art/sprites.png', 'tests/a.test.mjs', '.npmrc', 'CHANGELOG.md']) {
    const problems = audit([...clean(), text(extra, 'x')], { license: LICENSE }) as string[];
    assert.ok(problems.some((p) => p.startsWith(`${extra}:`)), `${extra}: ${problems.join('; ')}`);
  }
  assert.ok((audit(clean().filter((f) => f.path !== 'dist/index.js'), { license: LICENSE }) as string[]).includes('dist/index.js: missing'));
});

test('check-tarball: URLs, internal hosts, addresses, paths, tokens and map references in the bundle fail', () => {
  for (const bad of ['fetch("https://example.com/x")', 'h="x.asterosuite.com"', 'ip="10.20.30.40"', 'u="http://localhost:3000"',
    'p="/Users/someone/x"', 't="ghp_abcdefghijklmnopqrstuvwxyz0123"', '//# sourceMappingURL=client.js.map', 's="asteroWorkbench"']) {
    const problems = audit(swap(clean(), 'dist/index.js', bad), { license: LICENSE }) as string[];
    assert.ok(problems.some((p) => p.startsWith('dist/index.js:')), `${bad}: ${problems.join('; ')}`);
  }
  // The READMEs may link the npm page; they may not carry an internal host or a host product name.
  assert.deepEqual(audit(swap(clean(), 'README.md', 'See https://www.npmjs.com/package/@khglobal/dsh-universe'), { license: LICENSE }), []);
  assert.deepEqual(audit(swap(clean(), 'README.md', '![City](https://raw.githubusercontent.com/khglobal/dsh-universe/dev/docs/screenshots/city.gif)'), { license: LICENSE }), []);
  assert.ok((audit(swap(clean(), 'README.md', '![x](https://raw.githubusercontent.com/someone/else/main/x.gif)'), { license: LICENSE }) as string[]).length > 0);
  assert.ok((audit(swap(clean(), 'README.md', 'In Astero Agent.'), { license: LICENSE }) as string[]).length > 0);
  assert.ok((audit(swap(clean(), 'README.md', 'see https://x.asterosuite.com/npm/'), { license: LICENSE }) as string[]).length > 0);
});

test('check-tarball: manifest and licence rules', () => {
  const withPkg = (patch: Record<string, unknown>) => swap(clean(), 'package.json', JSON.stringify({ ...npmPkg, version: '1.2.3', ...patch }));
  const has = (files: File[], s: string) => (audit(files, { license: LICENSE }) as string[]).some((p) => p.includes(s));
  assert.ok(has(withPkg({ private: true }), '"private" is set'));
  assert.ok(has(withPkg({ license: 'MIT' }), 'license is'));
  assert.ok(has(withPkg({ scripts: { postinstall: 'node x' } }), 'scripts must be empty'));
  assert.ok(has(withPkg({ dependencies: { leftpad: '1.0.0' } }), 'dependencies must be empty'));
  assert.ok(has(swap(clean(), 'LICENSE', 'MIT License'), 'LICENSE: differs'));
});

test('check-tarball: reads an npm-style .tgz (name, size and bytes of every file)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tarball-test-'));
  try {
    for (const [p, s] of [['package/package.json', '{}'], ['package/dist/index.js', 'export{}'], ['package/screenshots/city.png', 'png']]) {
      mkdirSync(dirname(join(dir, p)), { recursive: true });
      writeFileSync(join(dir, p), s);
    }
    execFileSync('tar', ['-czf', join(dir, 'p.tgz'), '-C', dir, 'package'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
    const files = (listTarball(readFileSync(join(dir, 'p.tgz'))) as File[]).map((f) => [f.path, f.size, f.body.toString()]);
    assert.deepEqual(files.sort(), [['dist/index.js', 8, 'export{}'], ['package.json', 2, '{}'], ['screenshots/city.png', 3, 'png']]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
