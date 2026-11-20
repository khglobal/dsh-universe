// Every language has the same keys, no empty values, the same {placeholders}; "token" is never translated
// (no 令牌); English text has no CJK. Checks the interface tables (src/locales/<lang>.ts, which
// export `<lang>`) and the plugin metadata (locale/<lang>.json, `meta.*`).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LANGS = ['zh', 'en'];
const CJK = /[㐀-䶿一-鿿]/;
const holes = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v && typeof v === 'object') flatten(v, prefix + k + '.', out);
    else out[prefix + k] = v;
  }
  return out;
};

/** Problems between language tables: { [lang]: { key: value } }. */
export function compareTables(name, tables) {
  const problems = [];
  const langs = Object.keys(tables);
  const base = tables[langs[0]] ?? {};
  for (const lang of langs) {
    const t = tables[lang];
    for (const k of Object.keys(base)) if (!(k in t)) problems.push(`${name}: ${lang} is missing ${k}`);
    for (const k of Object.keys(t)) if (!(k in base)) problems.push(`${name}: ${lang} has extra ${k}`);
    for (const [k, v] of Object.entries(t)) {
      if (typeof v !== 'string' || v.trim() === '') { problems.push(`${name}: ${lang}.${k} is empty or not text`); continue; }
      if (k in base && typeof base[k] === 'string' && holes(v) !== holes(base[k])) problems.push(`${name}: ${lang}.${k} placeholders {${holes(v)}} differ from {${holes(base[k])}}`);
      if (v.includes('令牌')) problems.push(`${name}: ${lang}.${k} translates "token" (use token)`);
      if (lang === 'en' && CJK.test(v)) problems.push(`${name}: en.${k} contains CJK`);
    }
  }
  return problems;
}

export async function check(root = ROOT) {
  const problems = [];
  const src = join(root, 'src', 'locales');
  if (existsSync(src)) {
    const tables = {};
    for (const lang of LANGS) {
      const f = join(src, lang + '.ts');
      if (!existsSync(f)) { problems.push(`interface: ${lang}.ts is missing`); continue; }
      const mod = await import(pathToFileURL(f).href);
      tables[lang] = flatten(mod[lang]);
    }
    problems.push(...compareTables('interface', tables));
    const extra = readdirSync(src).filter((f) => /^[a-z]{2}(-[A-Z]{2})?\.ts$/.test(f) && !LANGS.includes(f.slice(0, -3)));
    for (const f of extra) {
      const lang = f.slice(0, -3);
      const mod = await import(pathToFileURL(join(src, f)).href);
      problems.push(...compareTables('interface', { [LANGS[0]]: tables[LANGS[0]], [lang]: flatten(mod[lang]) }));
    }
  }
  const meta = join(root, 'locale');
  if (existsSync(meta)) {
    const tables = {};
    for (const lang of LANGS) {
      const f = join(meta, lang + '.json');
      if (!existsSync(f)) { problems.push(`meta: ${lang}.json is missing`); continue; }
      tables[lang] = flatten(JSON.parse(readFileSync(f, 'utf8')));
    }
    problems.push(...compareTables('meta', tables));
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = await check();
  for (const p of problems) console.error(p);
  if (problems.length) { console.error(`check-locales: ${problems.length} problem(s)`); process.exit(1); }
  console.log('check-locales: ok');
}
