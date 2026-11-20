// Fails when interface text is written into code instead of the locale tables (no hard-coded zh/en text).
// Checks every .ts/.tsx under packages/*/src and src, except the locale tables themselves:
//  1. any string, template or JSX text containing CJK characters;
//  2. in .tsx files: JSX text with letters, and string-literal values of text-bearing attributes
//     (aria-label, aria-description, title, placeholder, alt, label).
// Comments are not text. Files that hold matching data rather than interface text are allowed by name below.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** Matching data, not interface text. Each entry needs a reason. */
export const ALLOWED_FILES = new Map([
  ['packages/model/src/theme-keywords.ts', 'local word list for the weakest theme signal'],
]);
const TEXT_ATTRS = new Set(['aria-label', 'aria-description', 'aria-roledescription', 'title', 'placeholder', 'alt', 'label']);
const CJK = /[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/;
const LETTERS = /[A-Za-z]/;

export function isLocaleFile(rel) {
  return /(^|\/)locales?\//.test(rel);
}

/** Problems in one source file: [{ line, text, why }]. */
export function scanSource(fileName, text) {
  const problems = [];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const tsx = fileName.endsWith('.tsx');
  const report = (node, value, why) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    problems.push({ line: line + 1, text: value.trim().slice(0, 60), why });
  };
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (CJK.test(node.text)) report(node, node.text, 'CJK text in code');
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join('');
      if (CJK.test(parts)) report(node, parts, 'CJK text in code');
    } else if (ts.isJsxText(node)) {
      const v = node.getText(sf);
      if (CJK.test(v)) report(node, v, 'CJK text in JSX');
      else if (tsx && LETTERS.test(v)) report(node, v, 'text in JSX: use t()');
    } else if (tsx && ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf);
      const init = node.initializer;
      const lit = init && (ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) ? init.expression : undefined);
      if (TEXT_ATTRS.has(name) && lit && LETTERS.test(lit.text)) report(node, lit.text, `literal ${name}: use t()`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { if (f !== 'node_modules' && f !== 'dist') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

export function sourceFiles(root = ROOT) {
  const dirs = [join(root, 'src')];
  const pk = join(root, 'packages');
  if (existsSync(pk)) for (const p of readdirSync(pk)) dirs.push(join(pk, p, 'src'));
  return dirs.flatMap((d) => walk(d));
}

export function check(root = ROOT) {
  const out = [];
  for (const file of sourceFiles(root)) {
    const rel = relative(root, file).split(sep).join('/');
    if (isLocaleFile(rel) || ALLOWED_FILES.has(rel)) continue;
    for (const p of scanSource(file, readFileSync(file, 'utf8'))) out.push({ file: rel, ...p });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = check();
  for (const p of problems) console.error(`${p.file}:${p.line}: ${p.why}: ${JSON.stringify(p.text)}`);
  if (problems.length) { console.error(`check-no-inline-text: ${problems.length} problem(s)`); process.exit(1); }
  console.log(`check-no-inline-text: ${sourceFiles().length} files clean`);
}
