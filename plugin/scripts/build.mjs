// Builds the plugin: the Host as one ESM file (dist/index.js) and the Client as the lazy CommonJS factory that
// DSH's module loader expects (dist/client.browser.js). Workspace packages are bundled in; react and the host's
// shared modules stay external. Type errors stop the build (nothing half-built reaches a running client).
// Both files are minified with no source maps or legal comments: the source (and the art in it) is proprietary, so
// only the built bundle ships (scripts/release.mjs). esbuild is pinned, so the same source gives the same bytes.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rename, rm, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const dir = fileURLToPath(new URL('..', import.meta.url));
const root = join(dir, '..');
const ID = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name;

const tsc = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', join(root, 'tsconfig.json'), '--noEmit'], { stdio: 'inherit' });
if (tsc.status !== 0) throw Error('[build] typecheck failed; nothing written');

// __DSHU_DEV__ false drops the debug globals the check scripts use on the dev page (window.__dshuCity, __dshuRoom).
const shipped = { minify: true, sourcemap: false, legalComments: 'none', charset: 'ascii', define: { __DSHU_DEV__: 'false' } };
const staging = await mkdtemp(join(dir, '.build-'));
try {
  await build({
    entryPoints: [join(dir, 'src/index.ts')], bundle: true, format: 'esm', platform: 'node', target: 'node22',
    outfile: join(staging, 'index.js'), logLevel: 'warning', ...shipped,
  });
  const client = await build({
    entryPoints: [join(dir, 'src/client.ts')], bundle: true, write: false, format: 'cjs', platform: 'browser', target: 'es2022',
    external: ['react', 'react/jsx-runtime', 'react-dom'], jsx: 'automatic', logLevel: 'warning', ...shipped,
  });
  await writeFile(join(staging, 'client.browser.js'),
    `window.__ModuleLoader__.load({id: ${JSON.stringify(ID)}, factory: function(require) {\nconst module = { exports: {} };\n${client.outputFiles[0].text}\nreturn module.exports;\n}});\n`);
  const out = join(dir, 'dist');
  const had = await lstat(out).catch(() => undefined);
  if (had) await rm(out, { recursive: true, force: true });
  await rename(staging, out);
  console.log('[build] plugin/dist written');
} finally {
  await rm(staging, { recursive: true, force: true });
}
