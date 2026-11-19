// Installs a packed tarball into official DeepSeek Harness the way a public user does, with nothing else, and checks
// the plugin in a headless browser. Not part of CI (it downloads DSH from npm and needs a Chromium).
//
//   node scripts/official-dsh-check.mjs <package.tgz> [--dsh 0.2.2-rc.2] [--keep]
//
// Isolation: DSH runs with a temporary HOME and DSH_HOME, and its Documents directory (where it creates the default
// workspace; on macOS it otherwise asks the system and ignores HOME) is set to a temporary folder by a --patch overlay.
// Nothing is read from or written to the real ~/.dsh or ~/Documents/deepseek-harness; no native picker is opened.
// No optional host service, workbench or other plugin is present: this is the "official DSH only" case.
//
// Steps: npm install @deepseek-ai/dsh@<version>; `dsh plugin --profile web add file:<tgz>`; boot the web profile on
// 127.0.0.1; open DSH Universe from the sidebar (city and list), then its page under Plugins (README and screenshots).
// Fails on any console error or warning, page error, failed or non-local request, or a host log line about the plugin.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { stopAndRemove, stopChild } from './stop-and-remove.mjs';

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { dsh: { type: 'string', default: '0.2.2-rc.2' }, keep: { type: 'boolean' } } });
const tgz = positionals[0] && resolve(positionals[0]);
if (!tgz) throw Error('usage: official-dsh-check.mjs <package.tgz> [--dsh <version>] [--keep]');

const T = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-official-')));
const home = join(T, 'home'), docs = join(T, 'Documents'), app = join(T, 'app');
for (const d of [home, docs, app]) mkdirSync(d, { recursive: true });
const env = { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), npm_config_cache: join(T, 'npm-cache') };
const problems = [];
const step = (m) => console.log(`[official-dsh] ${m}`);
let server;
try {
  step(`installing @deepseek-ai/dsh@${opt.dsh} into ${app}`);
  writeFileSync(join(app, 'package.json'), '{"name":"official-dsh-check","private":true}\n');
  const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', `@deepseek-ai/dsh@${opt.dsh}`], { cwd: app, env, stdio: 'inherit' });
  if (npm.status !== 0) throw Error('npm install of DSH failed');
  const dsh = join(app, 'node_modules/.bin/dsh');

  const overlay = join(T, 'isolate.yml');
  writeFileSync(overlay, `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(docs)}\n`);

  step(`dsh plugin --profile web add file:${tgz}`);
  const add = spawnSync(dsh, ['plugin', '--profile', 'web', 'add', `file:${tgz}`], { cwd: T, env, stdio: 'inherit' });
  if (add.status !== 0) throw Error('dsh plugin add failed');

  step('booting the web profile');
  let log = '';
  server = spawn(dsh, ['--profile', 'web', '--patch', overlay, '--no-open', '--host', '127.0.0.1', '--port', '0'], { cwd: T, env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (b) => { log += b; });
  server.stderr.on('data', (b) => { log += b; });
  const url = await new Promise((ok, fail) => {
    const t0 = Date.now();
    const tick = setInterval(() => {
      const m = /http:\/\/127\.0\.0\.1:\d+\/\S*/u.exec(log);
      if (m) { clearInterval(tick); ok(m[0]); } else if (Date.now() - t0 > 90_000 || server.exitCode !== null) { clearInterval(tick); fail(Error(`web profile did not start:\n${log}`)); }
    }, 250);
  });

  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const origin = new URL(url).host;
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
    page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
    page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/u.test(u.protocol) && u.host !== origin) problems.push(`non-local request: ${r.url()}`); });

    await page.goto(url);
    // First run shows DSH's preview notice; close it (its only button) before using the sidebar.
    const notice = page.getByRole('button', { name: 'Continue' });
    await notice.waitFor({ timeout: 20_000 }).then(() => notice.click()).catch(() => {});
    // DSH's own first-run dialogs (no model is set up here: "Get started") come and go; close any before each click.
    const mask = page.locator('[role=presentation] [aria-hidden=true]');
    const clear = async () => { for (let i = 0; i < 20 && await mask.count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } };
    await clear();

    step('opening DSH Universe from the sidebar');
    await clear();
    await page.getByText('DSH Universe', { exact: true }).first().click();
    await page.waitForTimeout(5000);
    const canvases = await page.locator('canvas').count();
    if (canvases < 1) problems.push('the city canvas did not appear');
    const text = await page.evaluate(() => document.body.innerText);
    for (const want of ['need you', 'City', 'List', 'Everything']) if (!text.includes(want)) problems.push(`panel text "${want}" missing`);
    await page.screenshot({ path: join(T, 'city.png') });
    await clear();
    await page.getByRole('button', { name: 'List' }).first().click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(T, 'list.png') });

    step('opening its page under Plugins');
    await clear();
    await page.getByText('Plugins', { exact: true }).first().click();
    await page.waitForTimeout(2500);
    await clear();
    await page.getByText('DSH Universe').last().click();
    await page.waitForTimeout(4000);
    const images = await page.evaluate(() => [...document.images].filter((i) => i.src.includes('screenshots')).map((i) => ({ src: i.src, w: i.naturalWidth })));
    if (images.length !== 3 || images.some((i) => i.w === 0)) problems.push(`README screenshots: ${JSON.stringify(images)}`);
    await page.screenshot({ path: join(T, 'detail.png'), fullPage: true });
  } finally {
    await browser.close();
  }

  // Isolation held, and the host said nothing about the plugin.
  const ws = JSON.parse(readFileSync(join(home, '.dsh/storages/workspace.json'), 'utf8'));
  for (const w of Object.values(ws.tables?.workspaces ?? {})) if (!w.path.startsWith(docs)) problems.push(`workspace outside the temp Documents: ${w.path}`);
  for (const line of log.split('\n')) if (/universe|error|warn/iu.test(line) && !line.startsWith('dsh web:')) problems.push(`host log: ${line}`);
  step(`host log:\n${log.trim()}`);
} finally {
  // Wait for the server to exit before removing the folder it writes to (ENOTEMPTY otherwise).
  if (opt.keep) { await stopChild(server); step(`kept ${T} (screenshots city.png, list.png, detail.png)`); }
  else await stopAndRemove(server, T);
}
for (const p of problems) console.log(`[official-dsh] problem: ${p}`);
console.log(problems.length ? `[official-dsh] ${problems.length} problem(s)` : `[official-dsh] ok: official DSH ${opt.dsh} only, installed from ${tgz}`);
process.exit(problems.length ? 1 : 0);
