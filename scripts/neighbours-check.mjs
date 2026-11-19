// The adjacent cities in official DeepSeek Harness, the way a member meets them. Not part of CI (it downloads DSH
// from npm and needs a Chromium).
//
//   node scripts/neighbours-check.mjs <package.tgz> [--dsh 0.2.2-rc.2] [--shots <prefix>] [--keep]
//
// DSH runs with a temporary HOME seeded with made-up Claude Code and Codex stores (fixtures/local-stores.ts: the real
// layouts, a marker string in every content field). In English and in Chinese:
// - with no click, both cities are there: a one-line notice once, a chip per city ("Claude Code · n running"), and
//   the Today bar's figures with "+n local";
// - a chip goes to its city, which has its data views (no schedule view: Claude Code and Codex have no schedules);
//   zooming out past the widest view shows the cities with their signs;
// - turning Codex off in "Nearby cities" persists across a reload (and the notice does not come back);
// - no marker is anywhere in the page, nor in anything the page sent or received.
// Then the stores are moved away (a cloud workspace has none): no notice, no chips, no settings, silent.
// Screenshots: <prefix>-<name>-<lang>.png.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { dsh: { type: 'string', default: '0.2.2-rc.2' }, shots: { type: 'string' }, keep: { type: 'boolean' } } });
const tgz = positionals[0] && resolve(positionals[0]);
if (!tgz) throw Error('usage: neighbours-check.mjs <package.tgz> [--dsh <version>] [--shots <prefix>] [--keep]');
const { MARKERS, CUSTOM_TITLE, seedLocalStores } = await import('../fixtures/local-stores.ts');

const T = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-neighbours-')));
const home = join(T, 'home'), docs = join(T, 'Documents'), app = join(T, 'app');
for (const d of [home, docs, app]) mkdirSync(d, { recursive: true });
seedLocalStores(home, Date.now());
const env = { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), npm_config_cache: join(T, 'npm-cache') };
const problems = [];
const step = (m) => console.log(`[neighbours] ${m}`);
const shot = (page, name, lang) => (opt.shots ? page.screenshot({ path: `${opt.shots}-${name}-${lang}.png` }) : Promise.resolve());
let server;
try {
  step(`installing @deepseek-ai/dsh@${opt.dsh}`);
  writeFileSync(join(app, 'package.json'), '{"name":"neighbours-check","private":true}\n');
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
    const L = {
      en: { found: 'found on this device', settings: 'Nearby cities', list: 'List', city: 'City', errors: 'Errors', sched: 'Scheduled', local: 'local' },
      zh: { found: '找到了', settings: '相邻城市', list: '清单', city: '城市', errors: '出错', sched: '定时任务', local: '本机' },
    };
    const newContext = async (lang) => {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: lang === 'zh' ? 'zh-CN' : 'en-US' });
      // The first-run tour was seen (it would cover the city); nothing else is preset.
      await ctx.addInitScript(() => { try { const k = 'khglobal-dsh-universe.view'; if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ toured: true })); } catch { /* no storage */ } });
      return ctx;
    };
    const open = async (lang, ctx) => {
      ctx ??= await newContext(lang);
      const page = await ctx.newPage();
      const wire = [];   // everything the page sent and received (to check no marker passes)
      const reads = [];  // adjacent-city reads asked of the host
      const note = (s) => { if (typeof s !== 'string') s = String(s); wire.push(s); if (/"n\.(snapshot|since|summary)"/.test(s)) reads.push(s.slice(0, 80)); };
      page.on('request', (r) => { const b = r.postData(); if (b) note(b); });
      page.on('response', async (r) => { try { if ((r.headers()['content-type'] ?? '').includes('json')) note(await r.text()); } catch { /* gone */ } });
      page.on('websocket', (ws) => { ws.on('framesent', (f) => note(f.payload)); ws.on('framereceived', (f) => note(f.payload)); });
      page.on('pageerror', (e) => problems.push(`${lang} page error: ${e.message}`));
      page.on('console', (m) => { if (m.type() === 'error' && /universe|dshu|neighbour/i.test(m.text())) problems.push(`${lang} console: ${m.text()}`); });
      await page.goto(url);
      const notice = page.getByRole('button', { name: /Continue|继续/ });
      await notice.waitFor({ timeout: 20_000 }).then(() => notice.click()).catch(() => {});
      const mask = page.locator('[role=presentation] [aria-hidden=true]');
      const clear = async () => { for (let i = 0; i < 20 && await mask.count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); } };
      await clear();
      const t0 = Date.now();
      await page.getByText('DSH Universe', { exact: true }).first().click();
      // The DSH city first: interactive (its canvas and Today bar) before the neighbours are read.
      await page.locator('[data-dshu-today]').first().waitFor({ timeout: 20_000 }).catch(() => problems.push(`${lang}: the DSH city did not come up`));
      const firstPaint = Date.now() - t0;
      await page.waitForTimeout(4000);
      return { ctx, page, wire, reads, clear, firstPaint };
    };
    const zoomOutFar = async (page) => {
      const mask = page.locator('[role=presentation] [aria-hidden=true]');
      for (let i = 0; i < 20 && await mask.count(); i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(500); }
      const city = page.locator('[role=application]').first();
      await city.focus().catch(() => {});
      for (let i = 0; i < 7; i++) { await page.keyboard.press('-'); await page.waitForTimeout(150); }
      await page.waitForTimeout(800);
    };
    const chipIds = (page) => page.locator('[data-dshu-chip]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dshu-chip')));
    const leaks = (where, s) => { for (const m of MARKERS) if (s.includes(m)) problems.push(`${where}: marker ${m} leaked`); if (s.includes('/work/')) problems.push(`${where}: a path leaked`); };

    for (const lang of ['en', 'zh']) {
      const W = L[lang];
      step(`${lang}: no click: cities, chips and figures`);
      const ctx = await newContext(lang);
      const { page, wire, reads, clear, firstPaint } = await open(lang, ctx);
      step(`${lang}: the DSH city was up in ${firstPaint} ms`);
      const noticeIds = await page.locator('[data-dshu-notice]').getAttribute('data-dshu-notice').catch(() => null);
      if (noticeIds !== 'claude-code codex') problems.push(`${lang}: the one-line notice should name both tools (${noticeIds})`);
      if (!(await page.evaluate(() => document.body.innerText)).includes(W.found)) problems.push(`${lang}: notice text missing`);
      if ((await chipIds(page)).join() !== 'claude-code,codex') problems.push(`${lang}: chips ${(await chipIds(page)).join()}`);
      const chipText = await page.locator('[data-dshu-chips]').innerText().catch(() => '');
      if (!/Claude Code · \d/.test(chipText) || !/Codex · \d/.test(chipText)) problems.push(`${lang}: chip text "${chipText}"`);
      const locals = await page.locator('[data-dshu-today] [data-dshu-local]').allInnerTexts();
      if (!locals.length || !locals.every((x) => x.includes(W.local))) problems.push(`${lang}: the Today bar does not add local sessions (${locals.join(' | ')})`);
      if (!reads.length) problems.push(`${lang}: on by default, yet nothing was read`);
      await shot(page, 'auto', lang);

      step(`${lang}: a chip goes to its city`);
      for (const id of ['claude-code', 'codex']) {
        await clear(); await page.locator(`[data-dshu-chip="${id}"]`).click();
        await page.waitForTimeout(4000);
        if (await page.locator(`[data-dshu-sign="${id}"]`).count() !== 1) problems.push(`${lang}: ${id}: no city sign`);
        if (!(await chipIds(page)).includes('dsh')) problems.push(`${lang}: ${id}: no chip back to DSH`);
        const layers = await page.locator('[data-dshu-layers] button').allInnerTexts();
        if (layers.some((x) => x.includes(W.sched))) problems.push(`${lang}: ${id}: the schedule view is offered without schedules`);
        await shot(page, id + '-city', lang);
        await page.locator('[data-dshu-layers] button', { hasText: W.errors }).first().click().catch(() => problems.push(`${lang}: ${id}: no errors view`));
        await page.waitForTimeout(1500);
        await shot(page, id + '-errors', lang);
        await page.locator('[data-dshu-layers] button').first().click();
        await clear(); await page.getByRole('button', { name: W.list, exact: true }).first().click();
        await page.waitForTimeout(1500);
        const ltext = await page.evaluate(() => document.body.innerText);
        if (id === 'claude-code' && !ltext.includes(CUSTOM_TITLE)) problems.push(`${lang}: the set title is not shown`);
        if (!ltext.includes('demo-app') && !ltext.includes('billing-api')) problems.push(`${lang}: ${id}: no folder-named sessions in the list`);
        await page.getByRole('button', { name: W.city, exact: true }).first().click();
        await page.waitForTimeout(1500);
        await clear(); await page.locator('[data-dshu-chip="dsh"]').click();
        await page.waitForTimeout(1500);
      }

      step(`${lang}: zoomed out past the widest view`);
      await zoomOutFar(page);
      if (!(await page.locator('[data-dshu-region]').count())) problems.push(`${lang}: zooming out past the widest view did not show the cities`);
      await page.waitForTimeout(5000);
      const cards = await page.locator('[data-dshu-city]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dshu-city')));
      if (cards.join() !== 'dsh,claude-code,codex') problems.push(`${lang}: city cards ${cards.join()}`);
      await shot(page, 'region', lang);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);

      step(`${lang}: Codex turned off, and still off after a reload`);
      await clear(); await page.locator('[aria-controls="dshu-nb-settings"]').click();
      const codexBox = page.locator('[data-dshu-nb-settings] input[type=checkbox]').nth(1);
      if (!(await codexBox.isChecked())) problems.push(`${lang}: Codex should be on by default`);
      await codexBox.uncheck();
      await shot(page, 'settings', lang);
      await clear(); await page.locator('[aria-controls="dshu-nb-settings"]').click();
      await page.waitForTimeout(800);
      if ((await chipIds(page)).join() !== 'claude-code') problems.push(`${lang}: after turning Codex off, chips ${(await chipIds(page)).join()}`);
      leaks(`${lang} page`, await page.content());
      leaks(`${lang} page text`, await page.evaluate(() => document.body.innerText));
      leaks(`${lang} wire`, wire.join('\n'));
      await page.close();
      const again = await open(lang, ctx);
      if ((await chipIds(again.page)).join() !== 'claude-code') problems.push(`${lang}: after a reload, chips ${(await chipIds(again.page)).join()} (Codex should stay off)`);
      if (await again.page.locator('[data-dshu-notice]').count()) problems.push(`${lang}: the notice came back after a reload`);
      if (again.reads.some((r) => r.includes('codex'))) problems.push(`${lang}: Codex is off, yet it was read`);
      await shot(again.page, 'off-persisted', lang);
      leaks(`${lang} wire (reload)`, again.wire.join('\n'));
      await ctx.close();
    }

    step('no stores (as in a cloud workspace): silent');
    renameSync(join(home, '.claude'), join(home, '.claude-away'));
    renameSync(join(home, '.codex'), join(home, '.codex-away'));
    const { ctx, page, reads } = await open('en');
    if (await page.locator('[data-dshu-notice]').count()) problems.push('no stores, yet a notice');
    if (await page.locator('[data-dshu-chip]').count()) problems.push('no stores, yet chips');
    if (await page.locator('[data-dshu-local]').count()) problems.push('no stores, yet local figures');
    if (reads.length) problems.push('no stores, yet the host was asked to read');
    if (await page.locator('[aria-controls="dshu-nb-settings"]').count()) problems.push('no stores, yet the settings');
    await zoomOutFar(page);
    if (await page.locator('[data-dshu-region]').count()) problems.push('no stores, yet other cities');
    await shot(page, 'silent', 'en');
    await ctx.close();
  } finally { await browser.close(); }
  for (const line of log.split('\n')) if (/universe|neighbour/iu.test(line) && /error|warn/iu.test(line)) problems.push(`host log: ${line}`);
} catch (e) {
  problems.push(`stopped: ${e instanceof Error ? e.message.split('\n')[0] : e}`);
} finally {
  if (server && server.exitCode === null) { const gone = new Promise((r) => server.once('exit', r)); server.kill(); await Promise.race([gone, new Promise((r) => setTimeout(r, 10_000))]); }
  if (opt.keep) step(`kept ${T}`); else rmSync(T, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
for (const p of problems) console.log(`[neighbours] problem: ${p}`);
console.log(problems.length ? `[neighbours] ${problems.length} problem(s)` : `[neighbours] ok: official DSH ${opt.dsh}, adjacent cities on by default in en and zh, chips, off persists, nothing leaked`);
process.exit(problems.length ? 1 : 0);
