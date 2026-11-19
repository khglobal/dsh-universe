// Rendered checks of the panel on the dev page (QA findings 3 and 5).
// The today bar over the city, rendered in a headless Chromium at 1920, 1440, 1024 and 390 px, in Chinese and English,
// with the neighbouring cities' "+n local" figures (dev page ?local=1, sample day): every button whole inside the
// window and inside the bar (nothing cut, nothing behind a scroller only a trackpad reaches), every figure's text
// whole (the next scheduled task's title alone may end in an ellipsis; its full text is the button's name), and no
// button under the city / list switch or the neighbouring cities' controls; no item wider than its buttons (#25); the
// "+n local" breakdown by city shows on keyboard focus and hides on Esc (#23).
// The nearby cities' settings: the click on the city that closes it does not also enter the building under it (5).
// Focus (8): inside a room the city's covered controls are out of the Tab order, Esc gives focus back to the city,
// and the notice's "Nearby cities" puts focus into the settings. The tour's building card closes with the tour (9).
// Keyboard (#19): Enter opens the centred place, a centre mark, focus back on the city after the tour, the list's
// "Go inside".
// Sound (12): a key press makes the audio context like a click; under reduced motion the button says it is unavailable.
//   --shots <dir>   save a screenshot of each case
//   --allow-skip    no Chromium: skip (and pass)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, prepare } from './city-check.mjs';

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
export const WIDTHS = [1920, 1440, 1024, 390];
export const LANGS = ['zh', 'en'];

async function check(b, base, w, lang, shots) {
  const page = await b.newPage({ viewport: { width: w, height: w < 600 ? 844 : 900 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true, noticed: ['claude', 'chatgpt', 'workbuddy'] })); } catch { /* storage off */ } });
  await page.goto(base + 'index.html?panel=1&fixed=1&local=1&lang=' + lang);
  await page.waitForFunction(() => !!globalThis.__dshuCity?.scene && document.querySelectorAll('[data-dshu-today] button[data-dshu-local]').length > 0, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const out = [];
    const ul = document.querySelector('[data-dshu-today]');
    if (!ul) return { out: ['no today bar'], n: 0 };
    const ur = ul.getBoundingClientRect();
    if (ul.scrollWidth > ul.clientWidth + 1) out.push(`the bar hides ${ul.scrollWidth - ul.clientWidth} px behind a scroller`);
    const others = [...document.querySelectorAll('[data-dshu-ctl] button, [data-dshu-nb] button')].filter((x) => !ul.contains(x)).map((x) => x.getBoundingClientRect()).filter((q) => q.width > 0);
    const btns = [...ul.querySelectorAll('button')];
    for (const el of btns) {
      const q = el.getBoundingClientRect(), name = (el.getAttribute('aria-label') || el.textContent || '').slice(0, 40);
      if (q.left < -0.5 || q.right > innerWidth + 0.5 || q.top < -0.5 || q.bottom > innerHeight + 0.5) out.push(`"${name}" leaves the window (${Math.round(q.left)}–${Math.round(q.right)})`);
      if (q.left < ur.left - 0.5 || q.right > ur.right + 0.5) out.push(`"${name}" is cut by the bar (${Math.round(q.left)}–${Math.round(q.right)} in ${Math.round(ur.left)}–${Math.round(ur.right)})`);
      const sched = el.hasAttribute('data-dshu-sched');
      if (el.scrollWidth > el.clientWidth + 1 && !(sched && el.getAttribute('aria-label'))) out.push(`"${name}" text cut (${el.scrollWidth} > ${el.clientWidth})`);
      for (const o of others) if (q.left < o.right - 1 && q.right > o.left + 1 && q.top < o.bottom - 1 && q.bottom > o.top + 1) out.push(`"${name}" under another control`);
    }
    // Each item is as wide as what it holds (#25: the scheduled task's item kept its whole title's width).
    for (const li of ul.querySelectorAll(':scope > li')) {
      if (getComputedStyle(li).position === 'absolute') continue;
      const kids = [...li.children].filter((x) => x.getClientRects().length);
      const used = kids.reduce((a, x) => a + x.getBoundingClientRect().width, 0) + Math.max(0, kids.length - 1) * (parseFloat(getComputedStyle(li).columnGap) || 0);
      const extra = li.getBoundingClientRect().width - used;
      if (extra > 2) out.push(`an item is ${Math.round(extra)} px wider than its buttons`);
    }
    return { out, n: btns.length, local: ul.querySelectorAll('button[data-dshu-local]').length, h: Math.round(ur.height) };
  });
  // The "+n local" breakdown by city shows under the bar on keyboard focus (#23: it was a mouse-only title), inside
  // the window, and Esc hides it.
  const fig = page.locator('[data-dshu-today] button[data-dshu-local]').first();
  if (await fig.count()) {
    await page.locator('[data-dshu-today] button').first().focus();
    for (let i = 0; i < 8 && !(await fig.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
    const tip = page.locator('[data-dshu-by-text]');
    const box = await tip.boundingBox().catch(() => null);
    if (!box || !(await tip.textContent())?.trim()) r.out.push('the "+n local" breakdown did not show on keyboard focus');
    else if (box.x < -0.5 || box.x + box.width > w + 0.5) r.out.push('the "+n local" breakdown leaves the window');
    const describe = await fig.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '');
    if (!describe.trim()) r.out.push('the "+n local" figure is not described by its breakdown');
    await page.keyboard.press('Escape');
    if (await tip.count()) r.out.push('Esc did not hide the "+n local" breakdown');
  }
  if (r.n < 6) r.out.push(`${r.n} buttons, expected 6`);
  if (!r.local) r.out.push('no "+n local" figure shown');
  if (shots) await page.screenshot({ path: join(shots, `todaybar-${lang}-${w}.png`), clip: { x: 0, y: 0, width: w, height: Math.min(260, w < 600 ? 300 : 200) } });
  await page.close();
  return r;
}

async function popoverClick(b, base, lang) {
  const out = [];
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true, noticed: ['claude', 'chatgpt', 'workbuddy'] })); } catch { /* storage off */ } });
  await page.goto(base + 'index.html?panel=1&fixed=1&local=1&lang=' + lang);
  await page.waitForFunction(() => !!globalThis.__dshuCity?.last);
  const id = await page.evaluate(() => { const v = globalThis.__dshuCity, p = v.scene.places.find((q) => q.tier === 'building' && q.state === 'running'); v.centreOn(p.id); return p.id; });
  await page.waitForTimeout(1200);
  const pt = await page.evaluate((id) => { const v = globalThis.__dshuCity, h = v.last.hits.find((x) => x.id === id), r = v.canvas.getBoundingClientRect(), q = v.screenOf((h.r[0] + h.r[2]) / 2, (h.r[1] + h.r[3]) / 2); return [q[0] + r.left, q[1] + r.top]; }, id);
  await page.locator('button[aria-controls="dshu-nb-settings"]').click();
  await page.waitForTimeout(200);
  if (!(await page.locator('#dshu-nb-settings').count())) out.push('the settings did not open');
  await page.mouse.click(pt[0], pt[1]);
  await page.waitForTimeout(600);
  if (await page.locator('#dshu-nb-settings').count()) out.push('a click on the city did not close the settings');
  if (await page.evaluate(() => !!globalThis.__dshuRoom)) out.push('the click that closed the settings also entered the building');
  // The next click acts as usual.
  await page.mouse.click(pt[0], pt[1]);
  await page.waitForFunction(() => !!globalThis.__dshuRoom, null, { timeout: 3000 }).catch(() => out.push('the next click did not enter the building'));
  await page.close();
  return out;
}

const PREFS = 'khglobal-dsh-universe.view';
async function open(b, base, qs, prefs, o = {}) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch { /* storage off */ } }, [PREFS, JSON.stringify(prefs)]);
  if (o.audio) await page.addInitScript(() => { const A = globalThis.AudioContext; globalThis.__made = 0; globalThis.AudioContext = class extends A { constructor(...a) { super(...a); globalThis.__made++; } }; });
  await page.goto(base + 'index.html?panel=1&fixed=1&' + qs);
  if (o.list) await page.waitForSelector('[role="list"]'); else await page.waitForFunction(() => !!globalThis.__dshuCity?.last);
  return page;
}
async function enterRunning(page) {
  const id = await page.evaluate(() => { const v = globalThis.__dshuCity, p = v.scene.places.find((q) => q.tier === 'building' && q.state === 'running'); v.centreOn(p.id); return p.id; });
  await page.waitForTimeout(900);
  const pt = await page.evaluate((id) => { const v = globalThis.__dshuCity, h = v.last.hits.find((x) => x.id === id), r = v.canvas.getBoundingClientRect(), q = v.screenOf((h.r[0] + h.r[2]) / 2, (h.r[1] + h.r[3]) / 2); return [q[0] + r.left, q[1] + r.top]; }, id);
  await page.mouse.click(pt[0], pt[1]);
  await page.waitForFunction(() => !!globalThis.__dshuRoom?.geometry?.w, null, { timeout: 4000 });
}

async function focusChecks(b, base, lang) {
  const out = [];
  let page = await open(b, base, 'lang=' + lang, { toured: true });
  await enterRunning(page);
  await page.waitForTimeout(500);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    // A focused control the member cannot see: something else is on top at its centre.
    const bad = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return '';
      const r = a.getBoundingClientRect();
      if (!r.width || !r.height) return '';
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && (top === a || a.contains(top) || top.contains(a)) ? '' : (a.getAttribute('aria-label') || a.textContent || a.tagName).slice(0, 40);
    });
    if (bad) { out.push(`Tab reached "${bad}" under the room`); break; }
  }
  await page.locator('[role="img"]').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  const where = await page.evaluate(() => [!!globalThis.__dshuRoom?.geometry && !!document.querySelector('[role="img"][aria-label]'), document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName]);
  if (where[1] !== 'application') out.push(`after Esc out of the room focus is on ${where[1]}, not the city`);
  await page.close();
  page = await open(b, base, 'local=1&lang=' + lang, { toured: true });
  const nb = page.locator('[data-dshu-notice] button').first();
  if (!(await nb.count())) out.push('no first-run notice');
  else {
    await nb.click();
    await page.waitForTimeout(300);
    if (!(await page.evaluate(() => !!document.activeElement?.closest('#dshu-nb-settings')))) out.push('the notice\'s button left focus outside the settings');
  }
  await page.close();
  // The tour to its end: its building card closes with it.
  page = await open(b, base, 'lang=' + lang, {});
  for (let i = 0; i < 8 && (await page.locator('[data-dshu-tour]').count()); i++) { await page.locator('[data-dshu-tour] button').last().click(); await page.waitForTimeout(500); }
  if (await page.locator('[data-dshu-tour]').count()) out.push('the tour did not end');
  if (await page.locator('[data-dshu-card][role="dialog"]').count()) out.push('the tour\'s building card stayed open after the tour');
  await page.close();
  return out;
}

// Keyboard (#19): a place centred by the camera opens with Enter (not a tower in front of it), a mark shows the
// centre, the tour's end gives focus back to the city, and the list's "Go inside" enters a place.
async function keyboardChecks(b, base, lang) {
  const out = [];
  let page = await open(b, base, 'lang=' + lang, { toured: true });
  const ids = await page.evaluate(() => [...new Set(globalThis.__dshuCity.last.hits.map((h) => h.id).filter((id) => !id.startsWith('agent:') && !id.startsWith('b:')))]);
  if (ids.length < 3) out.push(`only ${ids.length} public places on screen`);
  for (const id of ids) {
    await page.keyboard.press('Escape');
    await page.evaluate((id) => globalThis.__dshuCity.centreOn(id), id);
    await page.waitForTimeout(700);
    // Moved there with the keys: the ring marks what Enter opens, and Enter opens just that. A public building
    // centred on the mark is the one marked (Agent Academy and Error Recovery opened a tower in front of them);
    // a small shop may share the middle with a tower, and then the mark decides.
    await page.locator('[role="application"]').focus();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(150);
    const ringed = await page.evaluate(() => globalThis.__dshuCity.hover);
    if (!id.includes(':') && ringed !== id) out.push(`the centred ${id} is not the one marked (${ringed})`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    const got = await page.evaluate(() => globalThis.__dshuCity.hover);
    if (got !== ringed || !(await page.locator('[data-dshu-card]').count())) out.push(`Enter with ${ringed} marked opened ${got}`);
  }
  // Sent there by a today button (the next scheduled task: the station): Enter opens that place.
  await page.keyboard.press('Escape');
  await page.locator('[data-dshu-today] button[data-dshu-sched]').click();
  await page.waitForTimeout(900);
  await page.locator('[role="application"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const sent = await page.evaluate(() => globalThis.__dshuCity.hover);
  if (sent !== 'station') out.push(`Enter after the camera went to the station opened ${sent}`);
  await page.keyboard.press('Escape');
  await page.locator('[role="application"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(100);
  if (!(await page.locator('[data-dshu-centre]').count())) out.push('no centre mark while moving the city with the keyboard');
  await page.close();
  // The tour ended from the keyboard: focus on the city, not on the page's body.
  page = await open(b, base, 'lang=' + lang, {});
  for (let i = 0; i < 8 && (await page.locator('[data-dshu-tour]').count()); i++) { await page.keyboard.press('Enter'); await page.waitForTimeout(500); }
  const where = await page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName);
  if (where !== 'application') out.push(`after the tour focus is on ${where}`);
  await page.close();
  // The list's "Go inside" opens the place in the city.
  page = await open(b, base, 'lang=' + lang, { toured: true, view: 'list' }, { list: true });
  const inside = page.getByRole('button', { name: lang === 'en' ? 'Go inside' : '进楼看看' });
  if (!(await inside.count())) out.push('the list has no "Go inside"');
  else {
    await inside.last().click();
    await page.waitForFunction(() => !!globalThis.__dshuRoom?.geometry?.w, null, { timeout: 5000 }).catch(() => out.push('"Go inside" in the list did not open the place'));
  }
  await page.close();
  return out;
}

async function soundChecks(b, base, lang) {
  const out = [];
  let page = await open(b, base, 'lang=' + lang, { toured: true, sound: true }, { audio: true });
  await page.locator('[role="application"]').focus();
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(200);
  if (!(await page.evaluate(() => globalThis.__made))) out.push('a key press did not start the sound');
  await page.close();
  page = await open(b, base, 'lang=' + lang, { toured: true }, { reduced: true });
  const btn = page.locator('button[aria-describedby="dshu-snd-hint"]');
  if ((await btn.getAttribute('aria-disabled')) !== 'true') out.push('under reduced motion the sound button is not marked unavailable');
  await btn.click({ force: true });
  if ((await btn.getAttribute('aria-pressed')) === 'true') out.push('under reduced motion the sound button still toggles on');
  await page.close();
  return out;
}

async function main() {
  const b = await browser();
  if (!b) { const ok = args.includes('--allow-skip'); console.log(`panel-check: no headless Chromium available; skipped${ok ? ' (--allow-skip)' : ''}`); return ok ? 0 : 1; }
  const { srv, base } = await prepare();
  const shots = arg('--shots');
  if (shots) mkdirSync(shots, { recursive: true });
  let failed = 0;
  try {
    for (const lang of LANGS) for (const w of WIDTHS) {
      const r = await check(b, base, w, lang, shots);
      console.log(`todaybar: ${lang} ${w}px: ${r.out.length ? 'FAIL ' + r.out.join('; ') : `ok (${r.n} buttons, ${r.local} with "+n local", ${r.h} px high)`}`);
      failed += r.out.length ? 1 : 0;
    }
    for (const lang of LANGS) {
      const f = await focusChecks(b, base, lang);
      console.log(`focus: ${lang}: ${f.length ? 'FAIL ' + f.join('; ') : 'room covers the city controls; Esc back to the city; notice into the settings; tour card closes'}`);
      failed += f.length ? 1 : 0;
      const kb = await keyboardChecks(b, base, lang);
      console.log(`keyboard: ${lang}: ${kb.length ? 'FAIL ' + kb.join('; ') : 'Enter opens the centred place; centre mark; focus after the tour; list "Go inside"'}`);
      failed += kb.length ? 1 : 0;
      const sn = await soundChecks(b, base, lang);
      console.log(`sound: ${lang}: ${sn.length ? 'FAIL ' + sn.join('; ') : 'a key starts it; unavailable under reduced motion'}`);
      failed += sn.length ? 1 : 0;
      const p = await popoverClick(b, base, lang);
      console.log(`popover: ${lang}: ${p.length ? 'FAIL ' + p.join('; ') : 'the closing click stays with the popover; the next one enters the building'}`);
      failed += p.length ? 1 : 0;
    }
  } finally { await b.close(); srv.close(); }
  return failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((n) => process.exit(n ? 1 : 0), (e) => { console.error(e); process.exit(1); });
}
