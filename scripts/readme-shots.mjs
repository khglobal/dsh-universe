// The README and user-guide screenshots (docs/screenshots/*.png, docs/img/guide-*.png): dev mode on the fixed sample day, English interface and English
// sample data, headless Chromium at 1440×900 and dpr 2, reduced to 1440 wide in the page. Needs playwright-core and a
// Chromium (CHROME_PATH). The PNGs it writes are full colour; reduce them to 256 colours afterwards (pngquant, or
// PIL's quantize) to keep the repository small.
//   node scripts/readme-shots.mjs [--out docs] [--lang en]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { browser, prepare } from './city-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const out = arg('--out', join(root, 'docs'));
const lang = arg('--lang', 'en');

/** The screen point of a place in the city (its hit box's centre). */
const placeAt = (p, id) => p.evaluate((id) => {
  const v = globalThis.__dshuCity, h = v.last.hits.find((x) => x.id === id), r = v.canvas.getBoundingClientRect();
  const q = v.screenOf((h.r[0] + h.r[2]) / 2, (h.r[1] + h.r[3]) / 2); return [q[0] + r.left, q[1] + r.top];
}, id);
const GUIDE = { dir: 'img', width: 1200, height: 760 };

/** name → query, viewport, stored light setting and what to do before the picture. */
const SHOTS = [
  { name: 'city-day', qs: 'panel=1' },
  { name: 'city-night', qs: 'panel=1', light: 'night' },
  { name: 'layer-errors', qs: 'panel=1', layer: 4 },
  { name: 'layer-tokens', qs: 'panel=1', layer: 5 },
  // Five more of the sample's agents wait in the square; the "need you" button goes there (its card closed).
  { name: 'square', qs: 'panel=1&waits=5', act: async (p) => { await p.getByRole('button', { name: /need you/ }).first().click(); await p.waitForTimeout(800); await p.getByRole('button', { name: /^Close$/ }).first().click(); } },
  { name: 'replay', qs: 'panel=1', act: async (p) => {
    await p.getByRole('button', { name: /^Replay today$/ }).click();
    await p.waitForFunction(() => /\b11:2\d\b/.test(document.body.innerText), null, { timeout: 120_000, polling: 50 });
  } },
  // The room pages have no panel around them: give them the panel's font (the host's in DSH).
  { name: 'room-market', qs: 'room=market', font: true },
  { name: 'room-helpdesk', qs: 'room=helpdesk', font: true },
  { name: 'list', qs: 'panel=1', width: 1008, act: async (p) => { await p.getByRole('button', { name: /^List$/ }).first().click(); } },
  // The member guide (docs/USER-GUIDE.en.md): the whole city with a building's card, Errors, the list, inside.
  { ...GUIDE, name: 'guide-city', qs: 'panel=1&whole=1', act: async (p) => {
    await p.evaluate(() => globalThis.__dshuCity.whole()); await p.waitForTimeout(500);
    const [x, y] = await placeAt(p, 'b:s11'); await p.mouse.move(x, y);
  } },
  { ...GUIDE, name: 'guide-errors', qs: 'panel=1', layer: 4 },
  { ...GUIDE, name: 'guide-list', qs: 'panel=1', act: async (p) => { await p.getByRole('button', { name: /^List$/ }).first().click(); } },
  { ...GUIDE, name: 'guide-inside', qs: 'panel=1', act: async (p) => {
    await p.evaluate(() => globalThis.__dshuCity.centreOn('b:s11')); await p.waitForTimeout(500);
    const [x, y] = await placeAt(p, 'b:s11'); await p.mouse.click(x, y);
    await p.waitForFunction(() => !!globalThis.__dshuRoom?.geometry?.w, null, { timeout: 4000 });
  } },
];

const b = await browser();
if (!b) { console.error('readme-shots: no headless Chromium (set CHROME_PATH)'); process.exit(1); }
const { srv, base } = await prepare();
try {
  for (const s of SHOTS) {
    const width = s.width ?? 1440, height = s.height ?? 900;
    const page = await b.newPage({ viewport: { width, height }, deviceScaleFactor: 2, colorScheme: 'light' });
    page.on('pageerror', (e) => console.error(s.name, String(e)));
    await page.addInitScript((light) => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true, ...(light ? { light } : {}) })); } catch { /* storage off */ } }, s.light);
    await page.goto(`${base}index.html?fixed=1&lang=${lang}&${s.qs}`);
    if (s.qs.includes('panel=1')) await page.waitForFunction(() => !!globalThis.__dshuCity?.scene);
    if (s.font) await page.addStyleTag({ content: 'body { font: 14px/1.5 system-ui, sans-serif }' });
    await page.waitForTimeout(800);
    if (s.layer) await page.getByRole('group', { name: /^(只看|Show)$/ }).getByRole('button').nth(s.layer).click();
    if (s.act) await s.act(page);
    await page.waitForTimeout(1500);
    const raw = await page.screenshot();
    // Reduce to the CSS width in the page (high-quality smoothing), so the picture stays sharp but small.
    const b64 = await page.evaluate(async ([src, w, h]) => {
      const im = new Image(); im.src = 'data:image/png;base64,' + src; await im.decode();
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const g = cv.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, w, h);
      return cv.toDataURL('image/png').split(',')[1];
    }, [raw.toString('base64'), width, height]);
    mkdirSync(join(out, s.dir ?? 'screenshots'), { recursive: true });
    writeFileSync(join(out, s.dir ?? 'screenshots', s.name + '.png'), Buffer.from(b64, 'base64'));
    console.log('shot:', s.name);
    await page.close();
  }
} finally { await b.close(); srv.close(); }
