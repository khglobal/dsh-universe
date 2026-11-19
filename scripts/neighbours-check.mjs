// The adjacent cities in official DeepSeek Harness, the way a member meets them. Not part of CI (it downloads DSH
// from npm and needs a Chromium).
//
//   node scripts/neighbours-check.mjs <package.tgz> [--dsh 0.2.2-rc.2] [--shots <prefix>] [--keep]
//
// DSH runs with a temporary HOME seeded with made-up Claude Code, Claude app, Codex and WorkBuddy stores
// (fixtures/local-stores.ts: the real layouts, a marker string in every content field). In English and in Chinese:
// - with no click, the three vendor cities are there (Claude: Claude Code and the Claude app; ChatGPT: Codex;
//   WorkBuddy): a one-line notice once, a chip per city ("Claude · n running"), and the Today bar's figures with
//   "+n local";
// - a chip goes to its city, which has its data views (no schedule view: none of them has schedules) and its list,
//   where each Claude session says which product it is from; a building can be entered;
//   zooming out past the widest view shows the cities with their signs;
// - "Nearby cities" has one switch per source under its city; turning Codex and the Claude app off persists across
//   a reload (the ChatGPT city goes, the Claude city stays with Claude Code; the notice does not come back);
// - no marker is anywhere in the page, nor in anything the page sent or received.
// Then the stores are moved away (a cloud workspace has none): no notice, no chips, no settings, silent.
// `--width 390` and `--dark` check a narrow panel and the dark theme. Screenshots: <prefix>-<name>-<lang>.png.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const { values: opt, positionals } = parseArgs({ allowPositionals: true, options: { dsh: { type: 'string', default: '0.2.2-rc.2' }, shots: { type: 'string' }, keep: { type: 'boolean' }, width: { type: 'string', default: '1400' }, dark: { type: 'boolean' }, at: { type: 'string' } } });
const tgz = positionals[0] && resolve(positionals[0]);
if (!tgz) throw Error('usage: neighbours-check.mjs <package.tgz> [--dsh <version>] [--shots <prefix>] [--keep]');
const { MARKERS, CUSTOM_TITLE, seedLocalStores } = await import('../fixtures/local-stores.ts');
const { claudeAppDir } = await import('../packages/adapter-claude-app/src/index.ts');
const CITIES = ['claude', 'chatgpt', 'workbuddy'];
const NAMES = { claude: 'Claude', chatgpt: 'ChatGPT', workbuddy: 'WorkBuddy' };

const T = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-neighbours-')));
const home = join(T, 'home'), docs = join(T, 'Documents'), app = join(T, 'app');
for (const d of [home, docs, app]) mkdirSync(d, { recursive: true });
// `--at HH:MM`: DSH and the page run with their clocks set to that time today (the fixture's day is laid out over
// working hours, so a run just after midnight would find every session still in the future).
let shift = 0;
if (opt.at) { const [h, m] = opt.at.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); shift = d.getTime() - Date.now(); }
seedLocalStores(home, Date.now() + shift);
const clockMod = join(T, 'clock.mjs');
writeFileSync(clockMod, `const off = ${shift}; if (off) { const R = Date; class D extends R { constructor(...a) { if (a.length) super(...a); else super(R.now() + off); } static now() { return R.now() + off; } } globalThis.Date = D; }\n`);
const env = { ...process.env, HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), npm_config_cache: join(T, 'npm-cache') };
const serverEnv = shift ? { ...env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(clockMod).href}`.trim() } : env;
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
  server = spawn(dsh, ['--profile', 'web', '--patch', overlay, '--no-open', '--host', '127.0.0.1', '--port', '0'], { cwd: T, env: serverEnv, stdio: ['ignore', 'pipe', 'pipe'] });
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
      en: { found: 'found on this device', settings: 'Nearby cities', list: 'List', city: 'City', errors: 'Errors', sched: 'Scheduled', local: 'local', app: 'Claude app', cli: 'Claude Code' },
      zh: { found: '找到了', settings: '相邻城市', list: '清单', city: '城市', errors: '出错', sched: '定时任务', local: '本机', app: 'Claude 应用', cli: 'Claude Code' },
    };
    const newContext = async (lang) => {
      const ctx = await browser.newContext({ viewport: { width: Number(opt.width), height: Number(opt.width) < 600 ? 844 : 900 }, locale: lang === 'zh' ? 'zh-CN' : 'en-US', colorScheme: opt.dark ? 'dark' : 'light' });
      if (shift) await ctx.clock.setSystemTime(Date.now() + shift);
      // The first-run tour was seen (it would cover the city); nothing else is preset.
      await ctx.addInitScript(() => { try { const k = 'khglobal-dsh-universe.view'; if (!localStorage.getItem(k)) localStorage.setItem(k, JSON.stringify({ toured: true })); } catch { /* no storage */ } });
      // The ambience's oscillators, by pitch (to check each city plays its own bus).
      await ctx.addInitScript(() => {
        const C = window.AudioContext; if (!C) return;
        const made = (window.__dshuOsc = []);
        const orig = C.prototype.createOscillator;
        C.prototype.createOscillator = function () { const o = orig.call(this); const s = o.start.bind(o); o.start = (t) => { made.push({ f: o.frequency.value, at: performance.now(), state: this.state }); return s(t); }; return o; };
      });
      return ctx;
    };
    const open = async (lang, ctx) => {
      ctx ??= await newContext(lang);
      const page = await ctx.newPage();
      const wire = [];   // everything the page sent and received (to check no marker passes)
      const reads = [];  // adjacent-city reads asked of the host
      const note = (s) => { if (typeof s !== 'string') s = String(s); wire.push(s); if (/"n\.(snapshot|since|summary)"/.test(s)) reads.push(s.slice(0, 400)); };
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
      // A narrow window hides DSH's sidebar behind its menu button.
      const entry = page.getByText('DSH Universe', { exact: true }).first();
      if (!(await entry.isVisible().catch(() => false))) {
        // DSH's own first-run dialog can come up a moment late: let it, and close it.
        await page.waitForTimeout(1500); await notice.click({ timeout: 2000 }).catch(() => {}); await clear();
        const labels = await page.locator('button').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim()).filter(Boolean).slice(0, 40));
        console.log('[neighbours] sidebar hidden; buttons: ' + JSON.stringify(labels));
        if (opt.shots) await page.screenshot({ path: `${opt.shots}-narrow-start-${lang}.png` });
        await page.getByRole('button', { name: /^(Open sidebar|打开侧边栏|展开侧边栏|显示侧边栏)$/ }).first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(800);
      }
      await entry.click();
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
    // axe-core over one part of the page: serious and critical findings are problems.
    const AXE = readFileSync(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');
    const axe = async (page, sel, where) => {
      await page.addScriptTag({ content: AXE }).catch(() => {});
      const v = await page.evaluate(async (s) => { const el = document.querySelector(s); if (!el) return ['missing']; const r = await window.axe.run(el, { resultTypes: ['violations'] }); return r.violations.filter((x) => x.impact === 'serious' || x.impact === 'critical').map((x) => x.id + ' ×' + x.nodes.length); }, sel);
      for (const x of v) problems.push(`${where}: axe ${x}`);
    };
    const leaks = (where, s) => { for (const m of MARKERS) if (s.includes(m)) problems.push(`${where}: marker ${m} leaked`); if (s.includes('/work/')) problems.push(`${where}: a path leaked`); };

    for (const lang of ['en', 'zh']) {
      const W = L[lang];
      step(`${lang}: no click: cities, chips and figures`);
      const ctx = await newContext(lang);
      const { page, wire, reads, clear, firstPaint } = await open(lang, ctx);
      step(`${lang}: the DSH city was up in ${firstPaint} ms`);
      const noticeIds = await page.locator('[data-dshu-notice]').getAttribute('data-dshu-notice').catch(() => null);
      if (noticeIds !== CITIES.join(' ')) problems.push(`${lang}: the one-line notice should name the three cities (${noticeIds})`);
      const noticeText = await page.locator('[data-dshu-notice]').innerText().catch(() => '');
      if (!noticeText.includes(W.found) || !CITIES.every((c) => noticeText.includes(NAMES[c]))) problems.push(`${lang}: notice text "${noticeText}"`);
      if ((await chipIds(page)).join() !== CITIES.join()) problems.push(`${lang}: chips ${(await chipIds(page)).join()}`);
      const chipText = await page.locator('[data-dshu-chips]').innerText().catch(() => '');
      for (const c of CITIES) if (!new RegExp(NAMES[c] + ' · \\d').test(chipText)) problems.push(`${lang}: chip text "${chipText}" has no ${NAMES[c]} count`);
      const locals = await page.locator('[data-dshu-today] [data-dshu-local]').allInnerTexts();
      if (!locals.length || !locals.every((x) => x.includes(W.local))) problems.push(`${lang}: the Today bar does not add local sessions (${locals.join(' | ')})`);
      if (!reads.length) problems.push(`${lang}: on by default, yet nothing was read`);
      await shot(page, 'auto', lang);

      step(`${lang}: a chip goes to its city`);
      for (const id of CITIES) {
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
        if (!['demo-app', 'billing-api', 'market-report'].some((f) => ltext.includes(f))) problems.push(`${lang}: ${id}: no folder-named sessions in the list`);
        if (id === 'claude' && !(ltext.includes(W.app) && ltext.includes(W.cli) && ltext.includes('Cowork'))) problems.push(`${lang}: the Claude list does not tag Claude app and Claude Code sessions`);
        if (id === 'workbuddy' && !ltext.includes('market-report')) problems.push(`${lang}: no WorkBuddy session named by folder`);
        await shot(page, id + '-list', lang);
        await page.getByRole('button', { name: W.city, exact: true }).first().click();
        await page.waitForTimeout(1500);
        if (id !== 'chatgpt') {
          // A building's card (with its product tag), then inside: its rooms, then back.
          await clear();
          // The Cowork / market-report building, or in a narrow view whichever session building is on screen.
          let plate = page.locator('button[aria-haspopup=dialog]', { hasText: id === 'claude' ? 'Cowork' : 'market-report' }).first();
          if (!(await plate.isVisible().catch(() => false))) plate = page.locator('button[aria-haspopup=dialog]', { hasText: / · \d\d-\d\d/ }).first();
          let wentIn = false;
          if (await plate.isVisible().catch(() => false)) await plate.click();
          else {
            // No name plate on screen (a narrow view): tap the city until a session's building answers.
            const box = await page.locator('[role=application]').first().boundingBox();
            let found = false;
            for (let i = 0; box && i < 48 && !found; i++) {
              // Only the open middle of the city (clear of the toolbar, chips, zoom column and notices).
              await page.mouse.click(box.x + box.width * (0.08 + 0.7 * ((i % 6) / 5)), box.y + box.height * (0.38 + 0.25 * (Math.floor(i / 6) / 7)));
              await page.waitForTimeout(250);
              // A click on a building goes straight inside: back out, and open its card from its name instead.
              const inside = await page.getByRole('button', { name: /^(Back to the city|返回城市)$/ }).count();
              const txt = (await page.locator('[data-dshu-card]').count()) ? await page.locator('[data-dshu-card]').first().innerText({ timeout: 1000 }).catch(() => '') : '';
              if (/\d\d-\d\d/.test(txt) || inside) { found = true; wentIn = !!inside; } else await page.keyboard.press('Escape');
            }
            if (!found) problems.push(`${lang}: ${id}: no session building to open`);
          }
          await page.waitForTimeout(800);
          const card = wentIn ? '' : await page.locator('[data-dshu-card]').first().innerText({ timeout: 3000 }).catch(() => '');
          if (!wentIn && !(id === 'claude' ? card.includes(W.app) || card.includes(W.cli) : card.includes('WorkBuddy'))) problems.push(`${lang}: ${id}: the card does not say which product (${card.replace(/\s+/g, ' ').slice(0, 80)})`);
          if (!wentIn) {
            await shot(page, id + '-card', lang);
            await page.locator('[data-dshu-card] button', { hasText: lang === 'zh' ? '进楼看看' : 'Go inside' }).click({ timeout: 5000 }).catch(() => problems.push(`${lang}: ${id}: no way inside`));
          }
          await page.waitForTimeout(2500);
          await shot(page, id + '-inside', lang);
          await page.keyboard.press('Escape');
          await page.waitForTimeout(1200);
        }
        await clear(); await page.locator('[data-dshu-chip="dsh"]').click();
        await page.waitForTimeout(1500);
      }

      step(`${lang}: the ambience plays each city's own sound once Sound is on`);
      {
        await clear();
        const soundBtn = page.getByRole('button', { name: lang === 'zh' ? '环境音' : 'Sound', exact: true }).first();
        const before = await page.evaluate(() => window.__dshuOsc.length);
        if (before) problems.push(`${lang}: sound before the member turned it on`);
        await soundBtn.click();
        const PITCH = { dsh: 170, claude: 150, chatgpt: 190, workbuddy: 210 };
        const heard = async (city) => page.evaluate((f) => window.__dshuOsc.some((o) => Math.abs(o.f - f) < 1 && o.state === 'running'), PITCH[city] / 2);
        await page.waitForTimeout(1500);
        if (!(await heard('dsh'))) problems.push(`${lang}: no DSH ambience`);
        for (const id of CITIES) {
          await clear(); await page.locator(`[data-dshu-chip="${id}"]`).click();
          await page.waitForTimeout(2500);
          if (!(await heard(id))) problems.push(`${lang}: ${id}: no ambience in the city`);
        }
        await clear(); await page.locator('[data-dshu-chip="dsh"]').click();
        await page.waitForTimeout(800);
        await soundBtn.click();
      }

      step(`${lang}: zoomed out past the widest view`);
      await zoomOutFar(page);
      if (!(await page.locator('[data-dshu-region]').count())) problems.push(`${lang}: zooming out past the widest view did not show the cities`);
      await page.waitForTimeout(5000);
      const cards = await page.locator('[data-dshu-city]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dshu-city')));
      if (cards.join() !== ['dsh', ...CITIES].join()) problems.push(`${lang}: city cards ${cards.join()}`);
      await shot(page, 'region', lang);
      await axe(page, '[data-dshu-region]', `${lang} region`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(800);

      step(`${lang}: Codex and the Claude app turned off, and still off after a reload`);
      await clear(); await page.locator('[aria-controls="dshu-nb-settings"]').click();
      const groups = await page.locator('[data-dshu-nb-city]').evaluateAll((els) => els.map((e) => e.getAttribute('data-dshu-nb-city') + ':' + [...e.querySelectorAll('[data-dshu-nb-source]')].map((x) => x.getAttribute('data-dshu-nb-source')).join('+')));
      if (groups.join() !== 'claude:claude-code+claude-app,chatgpt:codex,workbuddy:workbuddy') problems.push(`${lang}: settings groups ${groups.join()}`);
      const box = (s) => page.locator(`[data-dshu-nb-source="${s}"] input[type=checkbox]`);
      for (const s of ['claude-code', 'claude-app', 'codex', 'workbuddy']) if (!(await box(s).isChecked())) problems.push(`${lang}: ${s} should be on by default`);
      await shot(page, 'settings', lang);
      await axe(page, '[data-dshu-nb-settings]', `${lang} settings`);
      // Keyboard: Tab reaches the switches, Space toggles one (and back).
      await box('workbuddy').focus();
      await page.keyboard.press('Space'); await page.waitForTimeout(200);
      if (await box('workbuddy').isChecked()) problems.push(`${lang}: Space did not toggle a switch`);
      await page.keyboard.press('Space'); await page.waitForTimeout(200);
      await box('codex').uncheck();
      await box('claude-app').uncheck();
      await page.waitForTimeout(500);
      await clear(); await page.locator('[aria-controls="dshu-nb-settings"]').click();
      await page.waitForTimeout(4000);
      if ((await chipIds(page)).join() !== 'claude,workbuddy') problems.push(`${lang}: after turning Codex and the Claude app off, chips ${(await chipIds(page)).join()}`);
      leaks(`${lang} page`, await page.content());
      leaks(`${lang} page text`, await page.evaluate(() => document.body.innerText));
      leaks(`${lang} wire`, wire.join('\n'));
      await page.close();
      const again = await open(lang, ctx);
      if ((await chipIds(again.page)).join() !== 'claude,workbuddy') problems.push(`${lang}: after a reload, chips ${(await chipIds(again.page)).join()} (Codex should stay off)`);
      if (await again.page.locator('[data-dshu-notice]').count()) problems.push(`${lang}: the notice came back after a reload`);
      if (again.reads.some((r) => r.includes('"chatgpt"'))) problems.push(`${lang}: Codex is off, yet the ChatGPT city was read`);
      if (!again.reads.some((r) => /"off":\[[^\]]*"claude-app"/.test(r))) problems.push(`${lang}: the Claude app is off, yet not left out of the Claude city`);
      await again.page.locator('[data-dshu-chip="claude"]').click().catch(() => problems.push(`${lang}: no Claude chip after the reload`));
      await again.page.waitForTimeout(3000);
      await again.page.getByRole('button', { name: W.list, exact: true }).first().click();
      await again.page.waitForTimeout(1500);
      const t2 = await again.page.evaluate(() => document.body.innerText);
      if (t2.includes('Cowork') || t2.includes(W.app)) problems.push(`${lang}: the Claude app is off, yet its sessions are shown`);
      if (!t2.includes(CUSTOM_TITLE)) problems.push(`${lang}: Claude Code sessions are gone with the app turned off`);
      await again.page.getByRole('button', { name: W.city, exact: true }).first().click();
      await again.page.waitForTimeout(800);
      await shot(again.page, 'off-persisted', lang);
      leaks(`${lang} wire (reload)`, again.wire.join('\n'));
      await ctx.close();
    }

    step('no stores (as in a cloud workspace): silent');
    renameSync(join(home, '.claude'), join(home, '.claude-away'));
    renameSync(join(home, '.codex'), join(home, '.codex-away'));
    renameSync(join(home, '.workbuddy'), join(home, '.workbuddy-away'));
    renameSync(claudeAppDir(home), claudeAppDir(home) + '-away');
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
console.log(problems.length ? `[neighbours] ${problems.length} problem(s)` : `[neighbours] ok: official DSH ${opt.dsh}, Claude, ChatGPT and WorkBuddy cities on by default in en and zh, chips, per-source switches, off persists, nothing leaked`);
process.exit(problems.length ? 1 : 0);
