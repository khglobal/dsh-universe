// Fails when the committed build is not the build of this source. The repository root is the installable plugin and
// a `github:` install builds nothing (DSH's pnpm takes the files as committed), so dist/index.js and
// dist/client.browser.js are committed; esbuild is pinned and the build is reproducible.
//
//   node scripts/check-build.mjs          rebuilds (scripts/build.mjs), then compares dist/ with the committed copy
//   node scripts/check-build.mjs --no-build   compares only (after a build that already ran, as `npm run check` does)
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
if (!process.argv.includes('--no-build')) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('build.mjs', import.meta.url))], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
const changed = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'dist'], { cwd: root, encoding: 'utf8' }).trim();
if (changed) {
  console.error(`check-build: dist/ does not match the source:\n${changed}\nRun \`npm run build\` and commit dist/ with the change.`);
  process.exit(1);
}
console.log('check-build: committed dist/ matches the source');
