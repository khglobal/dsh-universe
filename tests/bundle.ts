// Node runs .ts but not .tsx: tests load the client through an esbuild bundle (react stays external).
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('..', import.meta.url));

export async function loadClient<T = Record<string, unknown>>(entry = 'src/client.ts'): Promise<T> {
  const out = await build({ entryPoints: [join(dir, entry)], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/server'], logLevel: 'silent' });
  const tmp = mkdtempSync(join(dir, '.test-'));
  const file = join(tmp, 'client.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  try { return (await import(pathToFileURL(file).href)) as T; } finally { rmSync(tmp, { recursive: true, force: true }); }
}
