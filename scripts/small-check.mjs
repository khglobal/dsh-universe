// Rendered check of small windows (QA finding 10, #18) on the dev page: at 390x844, 390x700, 360x640, 320x480, 700x300 and 1440x900,
// in Chinese and English, first run (tour) and after it, legend open and closed, every zoom button is inside the window
// and under no other control (the tour's card excepted at 320x480, where the city is under 200 px tall). In a room at 390 and 320 px, a floor's tooltip does not stay open over the room once
// the floor was tapped, nor cover the floor's "On this floor now" list.
//   --shots <dir>   save a screenshot of each case
//   --allow-skip    no Chromium: skip (and pass)
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, prepare } from './city-check.mjs';

const args = process.argv.slice(2);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
export const SIZES = [[390, 844], [390, 700], [360, 640], [320, 480], [700, 300], [1440, 900]];

async function open(b, base, [w, h], lang, prefs) {
  const page = await b.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await page.addInitScript((p) => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify(p)); } catch { /* storage off */ } }, prefs);
  await page.goto(base + 'index.html?panel=1&fixed=1&lang=' + lang);
  await page.waitForFunction(() => !!globalThis.__dshuCity?.scene);
  await page.waitForTimeout(500);
  return page;
}

/** Zoom buttons outside the window or under another control. */
export const zoomProblems = () => {
  const out = [];
  // At 320x480 the city is under 200 px tall: the first-run tour's card (not modal, one tap to skip) cannot keep clear
  // of everything there, so only its overlap at larger sizes counts.
  const tourOk = innerHeight < 600 && innerWidth < 360;
  const zoom = document.querySelector('[data-dshu-zoom]');
  if (!zoom) return ['no zoom group'];
  const mine = [...zoom.querySelectorAll('button')];
  const others = [...document.querySelectorAll('button, [data-dshu-today], [data-dshu-tour], [role="status"]')]
    .filter((x) => !zoom.contains(x) && !x.closest('[inert]') && !(tourOk && x.closest('[data-dshu-tour]')) && x.getClientRects().length)
    .map((x) => [x, x.getBoundingClientRect()]).filter(([, q]) => q.width > 0 && q.height > 0);
  for (const el of mine) {
    const q = el.getBoundingClientRect(), name = el.getAttribute('aria-label');
    if (q.left < -0.5 || q.top < -0.5 || q.right > innerWidth + 0.5 || q.bottom > innerHeight + 0.5) { out.push(`"${name}" leaves the window`); continue; }
    for (const [o, r] of others) {
      if (q.left < r.right - 1 && q.right > r.left + 1 && q.top < r.bottom - 1 && q.bottom > r.top + 1) {
        // Covered: whatever is on top at the button's centre is not the button.
        const top = document.elementFromPoint((Math.max(q.left, r.left) + Math.min(q.right, r.right)) / 2, (Math.max(q.top, r.top) + Math.min(q.bottom, r.bottom)) / 2);
        out.push(`"${name}" ${top && el.contains(top) ? 'over' : 'under'} "${(o.getAttribute('aria-label') || o.textContent || o.tagName).trim().slice(0, 30)}"`);
      }
    }
  }
  return out;
};

async function main() {
  const b = await browser();
  if (!b) { const ok = args.includes('--allow-skip'); console.log(`small-check: no headless Chromium available; skipped${ok ? ' (--allow-skip)' : ''}`); return ok ? 0 : 1; }
  const { srv, base } = await prepare();
  const shots = arg('--shots');
  if (shots) mkdirSync(shots, { recursive: true });
  let failed = 0;
  try {
    for (const lang of ['en', 'zh']) for (const size of SIZES) for (const [what, prefs] of [['first run, legend open', { legend: true }], ['legend open', { toured: true, legend: true }], ['legend closed', { toured: true }]]) {
      const page = await open(b, base, size, lang, prefs);
      const out = await page.evaluate(zoomProblems);
      if (shots) await page.screenshot({ path: join(shots, `small-${lang}-${size.join('x')}-${what.replace(/\W+/g, '-')}.png`) });
      console.log(`zoom: ${lang} ${size.join('x')} ${what}: ${out.length ? 'FAIL ' + out.join('; ') : 'ok'}`);
      failed += out.length ? 1 : 0;
      await page.close();
    }
    // Rooms: a tapped floor's tooltip does not stay over the room; a keyboard focus still shows it.
    for (const lang of ['en', 'zh']) for (const [w, h] of [[390, 844], [320, 480]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(`${base}index.html?fixed=1&lang=${lang}&room=market`);
      await page.waitForFunction(() => !!globalThis.__dshuRoom?.geometry?.w, null, { timeout: 10_000 });
      const out = [];
      const floors = page.locator('button[aria-pressed][aria-label]').filter({ has: page.locator('i[aria-hidden]') });
      const n = await floors.count();
      if (n < 2) out.push(`${n} floor buttons`);
      else {
        await floors.nth(n - 1).tap();
        await page.waitForTimeout(300);
        if (await page.locator('[role="tooltip"]').count()) out.push('the tapped floor\'s tooltip stayed open over the room');
        // A touch's compatibility mouse events with no click after them (what iOS sends when a hover changes the page,
        // and why the tooltip stayed open there): no tooltip.
        await floors.nth(0).evaluate((el) => {
          for (const type of ['pointerover', 'pointerenter']) el.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', bubbles: type === 'pointerover' }));
          for (const type of ['mouseover', 'mouseenter']) el.dispatchEvent(new MouseEvent(type, { bubbles: type === 'mouseover' }));
        });
        await page.waitForTimeout(100);
        if (await page.locator('[role="tooltip"]').count()) out.push('a touch on a floor opens its tooltip (it stays: no mouse leaves)');
        if (shots) await page.screenshot({ path: join(shots, `small-room-${lang}-${w}.png`) });
        await floors.nth(0).focus();
        await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
        if (!(await page.locator('[role="tooltip"]').count())) out.push('keyboard focus on a floor shows no tooltip');
      }
      console.log(`room: ${lang} ${w}x${h}: ${out.length ? 'FAIL ' + out.join('; ') : 'ok'}`);
      failed += out.length ? 1 : 0;
      await ctx.close();
    }
  } finally { await b.close(); srv.close(); }
  return failed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main() ? 1 : 0);
