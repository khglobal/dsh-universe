// The nearby cities' settings popover and the legend in official DeepSeek Harness. Not part of CI (it downloads DSH
// from npm and needs a Chromium).
//
//   node scripts/popover-check.mjs <package.tgz> [--dsh 0.2.2-rc.2] [--shots <prefix>] [--keep]
//
// In English and in Chinese, in the Claude Code city, at a wide panel and at a narrow one (the toolbar wraps):
// - nothing is open on load, and the toolbar's buttons are on top (nothing covers them);
// - the settings popover closes on its button, a click elsewhere (the city sign beside it), Esc and its × button,
//   and focus goes back to its button on Esc and ×; toggling a checkbox keeps it open;
// - opened from the one-line notice, it closes the same way; after a reload it is closed and the notice is gone;
// - the legend closes on its × button and on its toolbar button.
// Screenshots: <prefix>-<name>-<lang>.png.
// DSH runs with a temporary HOME seeded with made-up Claude Code and Codex stores (fixtures/local-stores.ts).
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { dsh: { type: 'string', default: '0.2.2-rc.2' }, shots: { type: 'string' }, keep: { type: 'boolean' } } });
const tgz = positionals[0] && resolve(positionals[0]);
if (!tgz) throw Error('usage: popover-check.mjs <package.tgz> [--dsh <version>] [--shots <prefix>] [--keep]');
const { seedLocalStores } = await import('../fixtures/local-stores.ts');

const T = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-popover-')));
const home = join(T, 'home'), docs = join(T, 'Documents'), app = join(T, 'app');
for (const d of [home, docs, app]) mkdirSync(d, { recursive: true });
seedLocalStores(home, Date.now());
const env = { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), npm_config_cache: join(T, 'npm-cache') };
const problems = [];
const step = (m) => console.log(`[popover] ${m}`);
const shot = (page, name, lang) => (opt.shots ? page.screenshot({ path: `${opt.shots}-${name}-${lang}.png` }) : Promise.resolve());
let server;
try {
  step(`installing @deepseek-ai/dsh@${opt.dsh}`);
  writeFileSync(join(app, 'package.json'), '{"name":"popover-check","private":true}\n');
  if (spawnSync('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', `@deepseek-ai/dsh@${opt.dsh}`], { cwd: app, env, stdio: 'inherit' }).status !== 0) throw Error('npm install of DSH failed');
  const dsh = join(app, 'node_modules/.bin/dsh');
  const overlay = join(T, 'isolate.yml');
  writeFileSync(overlay, `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(docs)}\n`);
  if (spawnSync(dsh, ['plugin', '--profile', 'web', 'add', `file:${tgz}`], { cwd: T, env, stdio: 'inherit' }).status !== 0) throw Error('dsh plugin add failed');
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
    const L = { en: { settings: 'Nearby cities', legend: 'Legend', close: 'Close' }, zh: { settings: '相邻城市', legend: '图例', close: '关闭' } };
    for (const lang of ['en', 'zh']) {
      const W = L[lang];
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: lang === 'zh' ? 'zh-CN' : 'en-US' });
      await ctx.addInitScript(() => { try { const k = 'khglobal-dsh-universe.view'; if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ toured: true })); } catch { /* no storage */ } });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => problems.push(`${lang} page error: ${e.message}`));
      const mask = page.locator('[role=presentation] [aria-hidden=true]');
      const clear = async () => { for (let i = 0; i < 20 && await mask.count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } };
      const openPanel = async () => {
        await page.goto(url);
        const notice = page.getByRole('button', { name: /Continue|继续/ });
        await notice.waitFor({ timeout: 20_000 }).then(() => notice.click()).catch(() => {});
        await clear();
        await page.getByText('DSH Universe', { exact: true }).first().click();
        await page.locator('[data-dshu-today]').first().waitFor({ timeout: 20_000 }).catch(() => problems.push(`${lang}: the city did not come up`));
        await page.waitForTimeout(4000);
      };
      const pop = page.locator('[data-dshu-nb-settings]');
      const btn = page.locator('[aria-controls="dshu-nb-settings"]');
      const isOpen = async () => (await pop.count()) > 0;
      const focusOnBtn = () => page.evaluate(() => document.activeElement?.getAttribute('aria-controls') === 'dshu-nb-settings');
      /** The element on top at the centre of each toolbar button is that button (nothing covers it). */
      const uncovered = async (where) => {
        const covered = await page.evaluate(() => [...document.querySelectorAll('[data-dshu-today] button, [data-dshu-ctl] button')].filter((b) => {
          const r = b.getBoundingClientRect(); if (!r.width) return false;
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          // Scrolled out of a one-row bar is not covered.
          const bar = b.closest('ul, [data-dshu-layers]')?.getBoundingClientRect();
          if (bar && (x < bar.left || x > bar.right)) return false;
          const hit = document.elementFromPoint(x, y);
          return r.top >= 0 && r.bottom <= innerHeight && !(hit && (b === hit || b.contains(hit)));
        }).map((b) => b.textContent));
        if (covered.length) problems.push(`${lang} ${where}: covered toolbar buttons: ${covered.join(' | ')}`);
      };
      const expect = async (open, what) => { await page.waitForTimeout(400); if ((await isOpen()) !== open) problems.push(`${lang}: ${what}: the popover should be ${open ? 'open' : 'closed'}`); };

      step(`${lang}: first load, the notice, then the Claude Code city`);
      await openPanel();
      await expect(false, 'on load');
      if (!(await page.locator('[data-dshu-notice]').count())) problems.push(`${lang}: the first-run notice did not show`);
      await shot(page, 'load', lang);
      for (const width of [1400, 640]) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(1200);
        await uncovered(`dsh city at ${width}`);
        if (width === 640) await shot(page, 'narrow', lang);
      }
      await page.setViewportSize({ width: 1400, height: 900 });
      await page.waitForTimeout(800);
      // Opened from the notice: its own close paths work too.
      await page.locator('[data-dshu-notice] button').first().click();
      await expect(true, 'opened from the notice');
      await page.keyboard.press('Escape');
      await expect(false, 'Esc after opening from the notice');
      await page.locator('[data-dshu-chip="claude"]').click();
      await page.waitForTimeout(4000);
      if (!(await page.locator('[data-dshu-sign="claude"]').count())) problems.push(`${lang}: not in the Claude city`);

      for (const width of [1400, 640]) {
        step(`${lang}: Claude Code city at ${width} px`);
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(1200);
        await expect(false, `at ${width}, before opening`);
        await uncovered(`Claude Code city at ${width}`);
        const sfx = width === 640 ? '-narrow' : '';
        // Its button again.
        await btn.click(); await expect(true, 'opened by its button');
        await shot(page, 'open' + sfx, lang);
        await btn.click(); await expect(false, 'its button again');
        // A checkbox keeps it open (turned off and on again).
        await btn.click(); await expect(true, 'reopened');
        const box = pop.locator('input[type=checkbox]').nth(1);
        await box.uncheck(); await expect(true, 'a checkbox unticked');
        await box.check(); await expect(true, 'a checkbox ticked');
        // A click elsewhere: the city sign beside the button, which is what sits above the popover.
        await page.locator('[data-dshu-sign="claude"]').click(); await expect(false, 'a click on the city sign');
        await btn.click(); await expect(true, 'reopened');
        await page.mouse.click(width / 2, 600); await expect(false, 'a click on the city');
        // Esc, with focus back on the button.
        await btn.click(); await expect(true, 'reopened');
        await pop.locator('input[type=checkbox]').first().focus();
        await page.keyboard.press('Escape'); await expect(false, 'Esc');
        if (!(await focusOnBtn())) problems.push(`${lang} ${width}: focus did not go back to the button after Esc`);
        // The × button, with focus back on the button.
        await btn.click(); await expect(true, 'reopened');
        const x = pop.getByRole('button', { name: W.close });
        if (!(await x.isVisible())) problems.push(`${lang} ${width}: no visible × button`);
        await x.click(); await expect(false, 'the × button');
        if (!(await focusOnBtn())) problems.push(`${lang} ${width}: focus did not go back to the button after ×`);
        await shot(page, 'closed' + sfx, lang);
      }

      await page.setViewportSize({ width: 1400, height: 900 });
      await page.waitForTimeout(800);
      step(`${lang}: the legend closes on × and on its button`);
      const legendBtn = page.getByRole('button', { name: W.legend, exact: true });
      const legendX = page.locator('[data-dshu-legend-close]');
      await legendBtn.click(); await page.waitForTimeout(400);
      if (!(await legendX.count())) problems.push(`${lang}: the legend did not open`);
      await shot(page, 'legend', lang);
      await legendX.click(); await page.waitForTimeout(400);
      if (await legendX.count()) problems.push(`${lang}: the legend's × did not close it`);
      await legendBtn.click(); await page.waitForTimeout(300); await legendBtn.click(); await page.waitForTimeout(400);
      if (await legendX.count()) problems.push(`${lang}: the legend's button did not close it`);

      step(`${lang}: left open, then reloaded`);
      await btn.click(); await expect(true, 'left open');
      await openPanel();
      await expect(false, 'after a reload');
      if (await page.locator('[data-dshu-notice]').count()) problems.push(`${lang}: the notice came back after a reload`);
      if (await legendX.count()) problems.push(`${lang}: the legend opened by itself after a reload`);
      await shot(page, 'reload', lang);
      await ctx.close();
    }
  } finally { await browser.close(); }
  for (const line of log.split('\n')) if (/universe|neighbour/iu.test(line) && /error|warn/iu.test(line)) problems.push(`host log: ${line}`);
} catch (e) {
  problems.push(`stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
} finally {
  if (server && server.exitCode === null) { const gone = new Promise((r) => server.once('exit', r)); server.kill(); await Promise.race([gone, new Promise((r) => setTimeout(r, 10_000))]); }
  if (opt.keep) step(`kept ${T}`); else rmSync(T, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
for (const p of problems) console.log(`[popover] problem: ${p}`);
console.log(problems.length ? `[popover] ${problems.length} problem(s)` : `[popover] ok: official DSH ${opt.dsh}, the settings popover and the legend close every way, in en and zh, wide and narrow`);
process.exit(problems.length ? 1 : 0);
