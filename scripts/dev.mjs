// Mock-data dev mode: bundles plugin/src/dev/main.tsx with the sample day and serves it on localhost.
// Output goes to .dev/ in the repository (ignored by git). `--build-only` writes the files and exits.
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, '.dev');
mkdirSync(out, { recursive: true });
await build({ entryPoints: [join(root, 'plugin/src/dev/main.tsx')], bundle: true, outfile: join(out, 'main.js'), format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"development"', __DSHU_DEV__: 'true' } });
writeFileSync(join(out, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DSH Universe dev</title><body style="margin:0"><div id="tiles" style="padding:16px"></div><div id="panel" style="height:80vh"></div><script type="module" src="main.js"></script>');
if (process.argv.includes('--build-only')) { console.log('dev: built .dev/'); process.exit(0); }
const port = Number(process.env.PORT ?? 5174);
createServer((req, res) => {
  const file = req.url?.startsWith('/main.js') ? 'main.js' : 'index.html';
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(readFileSync(join(out, file)));
}).listen(port, '127.0.0.1', () => console.log(`dev: http://127.0.0.1:${port}/  (?lang=en, ?theme=dark)`));
