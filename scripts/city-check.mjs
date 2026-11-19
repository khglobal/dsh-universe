// Headless browser checks of the city (needs playwright-core and a Chromium; without one it fails unless --allow-skip):
//   --golden            compare fixed-time screenshots with fixtures/golden/*.png (--update rewrites them); runs --crisp
//   --crisp             whole-pixel scaling, smoothing off, the backing store at the screen's ratio and no blended
//                       edges (EDGE_BLEND_MAX), in a browser; the rooms' counterpart is room-check.mjs --crisp
//   --light             the day/night button: auto, day, night, kept per device, keyboard, rooms follow (in --golden)
//   --perf              frame times and sprite memory at 100 buildings / 30 running / 10 events a second
//   --shots <dir>       save the screenshots for review (centre, whole, night, empty; with --layers the six data views)
// Everything is built into .dev/ (ignored) and served on 127.0.0.1; nothing leaves the machine.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const dev = join(root, '.dev');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

export async function browser() {
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { return null; }
  const exe = process.env.CHROME_PATH;
  // `--gpu`: use the machine's GPU (Metal through ANGLE on macOS) instead of the software rasteriser.
  const gpu = process.argv.includes('--gpu') ? ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader=false'] : [];
  try { return await chromium.launch({ ...(exe ? { executablePath: exe } : {}), args: gpu }); } catch { return null; }
}

export async function prepare() {
  const r = spawnSync(process.execPath, [join(root, 'scripts/dev.mjs'), '--build-only'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('dev build failed');
  await build({ entryPoints: [join(root, 'scripts/city/bench.ts')], bundle: true, outfile: join(dev, 'bench.js'), format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'warning' });
  writeFileSync(join(dev, 'bench.html'), '<!doctype html><meta charset="utf-8"><body style="margin:0;overflow:hidden"><canvas id="cv" style="width:100vw;height:100vh;display:block;image-rendering:pixelated"></canvas><script type="module" src="bench.js"></script>');
  const srv = createServer((q, res) => {
    const f = (q.url ?? '/').split('?')[0].slice(1) || 'index.html';
    const p = join(dev, f);
    if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8' });
    res.end(readFileSync(p));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { srv, base: `http://127.0.0.1:${srv.address().port}/` };
}

/**
 * Installed in a page (addInitScript): `__edgeBlend(data, W, H, [x0, y0, x1, y1], skip)` reads RGBA device pixels and
 * returns the share of edge pixels that are in-between colours: a pixel where the colour changes (left/right or
 * up/down neighbours differ) that matches neither neighbour and lies between them on every channel. Pixel art scaled
 * by a whole number has none (every edge pixel is one side or the other); a picture resampled with smoothing, scaled
 * by a fraction or drawn with antialiasing has many. `skip(x, y)` leaves out the text layer.
 */
export function installEdgeBlend() {
  globalThis.__edgeBlend = (d, W, H, rect, skip = () => false) => {
    const [x0, y0, x1, y1] = rect.map(Math.round);
    let edges = 0, blended = 0;
    const between = (i, a, b) => { let off = 0; for (let k = 0; k < 3; k++) { const p = d[i + k], lo = Math.min(d[a + k], d[b + k]), hi = Math.max(d[a + k], d[b + k]); if (p < lo - 2 || p > hi + 2) return false; off += Math.min(Math.abs(p - d[a + k]), Math.abs(p - d[b + k])); } return off > 12 && Math.abs(p0(i) - p0(a)) + Math.abs(p0(i) - p0(b)) > 0; };
    const p0 = (i) => d[i] + d[i + 1] * 256 + d[i + 2] * 65536;
    const same = (i, j) => d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2];
    for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
      if (skip(x, y)) continue;
      const i = (y * W + x) * 4;
      for (const [a, b] of [[i - 4, i + 4], [i - W * 4, i + W * 4]]) {
        if (same(a, b) || (same(i, a) && same(i, b))) continue;
        edges++;
        if (!same(i, a) && !same(i, b) && between(i, a, b)) blended++;
      }
    }
    return { edges, blended, share: edges ? blended / edges : 0 };
  };
}
/** The most in-between edge pixels a crisp view may have (overlay glyphs and icons, a few tenths of a percent). */
export const EDGE_BLEND_MAX = 0.01;

/** The fixed views: the sample day of 2026-11-18 at 15:44:46, reduced motion (a still picture). */
export const VIEWS = [
  { name: 'centre-light', qs: 'panel=1&fixed=1' },
  { name: 'centre-dark', qs: 'panel=1&fixed=1&theme=dark' },
  { name: 'whole-light', qs: 'panel=1&fixed=1&whole=1' },
  { name: 'whole-dark', qs: 'panel=1&fixed=1&whole=1&theme=dark' },
  { name: 'empty-light', qs: 'panel=1&fixed=1&empty=1' },
  // The first-run tour, its first step (a fresh device).
  { name: 'tour-light', qs: 'panel=1&fixed=1', tour: true },
  // The six data views (phase 5), light and dark: chosen with the real toolbar button (index into model LAYERS).
  ...['scheduled', 'running', 'review', 'errors', 'tokens', 'calls'].flatMap((l, i) => [
    { name: 'layer-' + l + '-light', qs: 'panel=1&fixed=1', layer: i + 1 },
    { name: 'layer-' + l + '-dark', qs: 'panel=1&fixed=1&theme=dark', layer: i + 1 },
  ]),
];

async function shoot(b, base, v, opts = {}) {
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', (r) => { if (!r.url().startsWith(base)) errors.push('network: ' + r.url()); });
  // Data views: the leak check reads the frame back and reports colour outside the subjects.
  if (v.layer) await page.addInitScript(() => { globalThis.__dshuLeakCheck = true; });
  // The first-run tour shows on a fresh device; every view but the tour's own is taken as a returning member.
  if (!v.tour) await page.addInitScript(() => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true })); } catch { /* storage off */ } });
  await page.goto(base + 'index.html?' + v.qs);
  await page.waitForFunction(() => !!globalThis.__dshuCity?.scene);
  if (v.qs.includes('whole=1')) await page.evaluate(() => globalThis.__dshuCity.whole());
  if (v.layer) await page.getByRole('group', { name: /^(只看|Show)$/ }).getByRole('button').nth(v.layer).click();
  await page.waitForTimeout(1300);
  const png = await page.screenshot(opts.clip ? { clip: opts.clip } : {});
  const leaks = v.layer ? await page.evaluate(() => globalThis.__dshuLeaks ?? { count: -1, at: [] }) : undefined;
  await page.close();
  return { png, errors, leaks };
}

/**
 * Crispness in a real browser: at each device pixel ratio and zoom level, and after the ratio changes
 * under the page (a window moved between screens), the backing store is the element times the ratio, the art buffer
 * is drawn at a whole scale and offset with smoothing off, the canvas is `image-rendering: pixelated`, and the city
 * reads back in whole art-pixel blocks outside the text layer's signs.
 */
async function crisp(b, base) {
  const problems = [];
  let worst = 0;
  for (const dpr of [1, 1.5, 2, 2.2]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true })); } catch { /* storage off */ } });
    await page.addInitScript(installEdgeBlend);
    await page.goto(base + 'index.html?panel=1&fixed=1');
    await page.waitForFunction(() => !!globalThis.__dshuCity?.scene);
    const check = async (what) => { const r = await page.evaluate(([what, max]) => {
      const v = globalThis.__dshuCity, cv = v.canvas, r = cv.getBoundingClientRect(), out = [];
      v.paint();
      const b = v.blit, want = [Math.round(r.width * devicePixelRatio), Math.round(r.height * devicePixelRatio)];
      if (cv.width !== want[0] || cv.height !== want[1]) out.push(`${what}: backing ${cv.width}×${cv.height}, element × ratio ${want.join('×')}`);
      if (!Number.isInteger(b.sc) || b.sc < 1 || ![b.x, b.y, b.w, b.h].every(Number.isInteger) || b.w !== b.bw * b.sc) out.push(`${what}: blit ${JSON.stringify(b)}`);
      if (b.smoothing) out.push(`${what}: image smoothing on`);
      if (getComputedStyle(cv).imageRendering !== 'pixelated') out.push(`${what}: image-rendering ${getComputedStyle(cv).imageRendering}`);
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, W = cv.width, H = cv.height, sc = b.sc;
      const ox = ((b.x % sc) + sc) % sc, oy = ((b.y % sc) + sc) % sc, signs = v.signRects ?? [];
      let bad = 0, n = 0;
      for (let y = oy; y < H; y += 3) for (let x = ox; x < W; x += 3) {
        if (signs.some((s) => x >= s[0] - 2 && x < s[2] + 2 && y >= s[1] - 2 && y < s[3] + 2)) continue;
        const bx = x - (x - ox) % sc, by = y - (y - oy) % sc, i = (y * W + x) * 4, j = (by * W + bx) * 4; n++;
        if (d[i] !== d[j] || d[i + 1] !== d[j + 1] || d[i + 2] !== d[j + 2]) bad++;
      }
      // Overlay text (clock faces, small markers) is a few hundred pixels; a resampled or smoothed city is ~30 %.
      if (bad / n > 0.005) out.push(`${what}: ${(bad / n * 100).toFixed(2)}% of the city off the art-pixel grid`);
      const e = globalThis.__edgeBlend(d, W, H, [0, 0, W, H], (x, y) => signs.some((s) => x >= s[0] - 2 && x < s[2] + 2 && y >= s[1] - 2 && y < s[3] + 2));
      if (e.share > max) out.push(`${what}: ${(e.share * 100).toFixed(2)}% of the city's edge pixels are blended (most ${max * 100}%)`);
      return { out, share: e.share };
    }, [what, EDGE_BLEND_MAX]); worst = Math.max(worst, r.share); return r.out; };
    for (const zi of [3, 4]) { await page.evaluate((zi) => { const v = globalThis.__dshuCity; v.cam = { x: 0, y: 232, zi }; }, zi); problems.push(...await check(`dpr ${dpr} zoom ${[0.25, 0.5, 1, 2, 3, 4][zi]}`)); }
    // The window moves to a screen of another ratio: same CSS size, so only the ratio watch can refit.
    const other = dpr === 2 ? 1 : 2;
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: other, mobile: false });
    await page.waitForFunction((o) => globalThis.devicePixelRatio === o, other);
    // Some headless browsers send no resize or resolution event: the once-a-second look refits it.
    await page.waitForTimeout(1300);
    problems.push(...await check(`dpr ${dpr} → ${other}`));
    await ctx.close();
  }
  console.log(`crisp: city edge pixels blended at most ${(worst * 100).toFixed(3)}% (limit ${EDGE_BLEND_MAX * 100}%)`);
  return problems;
}

/**
 * The day/night button: auto follows the host theme (dark is night), day and night override it, the choice is kept
 * per device, the button cycles auto → day → night by keyboard, and a room entered follows the city.
 */
async function lightCheck(b, base) {
  const problems = [];
  const cases = [['auto', '', false], ['auto', '&theme=dark', true], ['day', '&theme=dark', false], ['night', '', true]];
  for (const [light, theme, night] of cases) {
    const page = await b.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.addInitScript((light) => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true, light })); } catch { /* storage off */ } }, light);
    await page.goto(base + 'index.html?panel=1&fixed=1' + theme);
    await page.waitForFunction(() => !!globalThis.__dshuCity?.scene);
    await page.waitForTimeout(300);
    const dark = await page.evaluate(() => globalThis.__dshuCity.dark);
    if (dark !== night) problems.push(`${light}${theme}: city night ${dark}, expected ${night}`);
    if (light === 'night') {
      // A room follows the city's night; then the button (keyboard) goes on to auto, which on a light host is day.
      const at = await page.evaluate(() => { const v = globalThis.__dshuCity, h = v.last.hits.find((x) => x.id.startsWith('b:')); v.centreOn(h.id); return h.id; });
      await page.waitForTimeout(300);
      const pt = await page.evaluate((id) => { const v = globalThis.__dshuCity, h = v.last.hits.find((x) => x.id === id), r = v.canvas.getBoundingClientRect(), q = v.screenOf((h.r[0] + h.r[2]) / 2, (h.r[1] + h.r[3]) / 2); return [q[0] + r.left, q[1] + r.top]; }, at);
      await page.mouse.click(pt[0], pt[1]);
      await page.waitForFunction(() => !!globalThis.__dshuRoom?.geometry?.w, null, { timeout: 4000 }).catch(() => problems.push('night: no room opened'));
      const roomDark = await page.evaluate(() => globalThis.__dshuRoom?.dark);
      if (roomDark !== true) problems.push(`night: room dark ${roomDark}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      await page.locator('[data-dshu-light]').focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const after = await page.evaluate(() => [document.querySelector('[data-dshu-light]')?.getAttribute('data-dshu-light'), globalThis.__dshuCity.dark, JSON.parse(localStorage.getItem('khglobal-dsh-universe.view') ?? '{}').light]);
      if (after[0] !== 'auto' || after[1] !== false || after[2] !== 'auto') problems.push('night → Enter: ' + JSON.stringify(after));
    }
    await page.close();
  }
  return problems;
}

async function diff(b, base, a, c) {
  const page = await b.newPage();
  await page.goto(base + 'index.html?panel=1&fixed=1&empty=1');
  const r = await page.evaluate(async ([x, y]) => {
    const load = async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const cv = new OffscreenCanvas(im.width, im.height); const g = cv.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height); };
    const A = await load(x), B = await load(y);
    if (A.width !== B.width || A.height !== B.height) return { size: true, changed: 1 };
    let n = 0;
    for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 24) n++;
    return { size: false, changed: n / (A.width * A.height) };
  }, [a.toString('base64'), c.toString('base64')]);
  await page.close();
  return r;
}

async function main() {
  const b = await browser();
  // Without a Chromium nothing was checked: that fails, unless the caller says skipping is fine (`--allow-skip`, CI).
  if (!b) {
    const ok = process.argv.includes('--allow-skip');
    console.log(`city-check: no headless Chromium available; skipped${ok ? ' (--allow-skip)' : ' (pass --allow-skip to accept)'}`);
    return ok ? 0 : 1;
  }
  const { srv, base } = await prepare();
  let failed = 0;
  try {
    if (has('--golden') || has('--crisp')) {
      const p = await crisp(b, base);
      for (const x of p) console.error('crisp:', x);
      console.log(p.length ? `crisp: ${p.length} problem(s)` : 'crisp: whole pixels, smoothing off, at every ratio and after a ratio change');
      failed += p.length;
    }
    if (has('--golden') || has('--light')) {
      const p = await lightCheck(b, base);
      for (const x of p) console.error('light:', x);
      console.log(p.length ? `light: ${p.length} problem(s)` : 'light: auto, day and night, kept, by keyboard, rooms follow');
      failed += p.length;
    }
    if (has('--golden')) {
      const dir = join(root, 'fixtures/golden');
      mkdirSync(dir, { recursive: true });
      // The browser the goldens were taken with (text and antialiasing differ between builds): a difference then says
      // which build to use (the one playwright-core installs: `npx playwright-core install chromium-headless-shell`).
      const made = existsSync(join(dir, 'BROWSER')) ? readFileSync(join(dir, 'BROWSER'), 'utf8').trim() : '';
      const now = 'chromium ' + b.version() + ' ' + process.platform;
      if (has('--update')) writeFileSync(join(dir, 'BROWSER'), now + '\n');
      else if (made && made !== now) console.log(`golden: taken with ${made}; this is ${now} (a difference may be the browser's)`);
      for (const v of VIEWS) {
        const { png, errors, leaks } = await shoot(b, base, v);
        if (errors.length) { console.error(v.name, errors); failed++; }
        // Every coloured pixel of a data view is a subject, the square or interface; anything else is a leak.
        if (leaks && leaks.count !== 0) { console.error(`leaks: ${v.name}: ${leaks.count} coloured pixel(s) outside the layer's subjects`, leaks.at); failed++; }
        else if (leaks) console.log(`leaks: ${v.name} none`);
        const file = join(dir, v.name + '.png');
        if (has('--update') || !existsSync(file)) { writeFileSync(file, png); console.log('golden: wrote', v.name); continue; }
        const d = await diff(b, base, readFileSync(file), png);
        const ok = !d.size && d.changed <= 0.0005;
        console.log(`golden: ${v.name} ${ok ? 'ok' : 'DIFFERENT'} (${(d.changed * 100).toFixed(2)}% pixels)`);
        if (!ok) { failed++; writeFileSync(join(dev, v.name + '.actual.png'), png); }
      }
    }
    const shots = arg('--shots');
    if (shots) {
      mkdirSync(shots, { recursive: true });
      const list = has('--layers') ? VIEWS.filter((v) => v.layer).map((v) => [v.name, v]) : [['centre', VIEWS[0]], ['whole', VIEWS[2]], ['night', VIEWS[1]], ['empty', VIEWS[4]]];
      for (const [n, v] of list) { const { png } = await shoot(b, base, v); writeFileSync(join(shots, (arg('--prefix') ?? 'dshu-p2-') + n + '.png'), png); console.log('shot:', n); }
    }
    if (has('--perf')) {
      for (const [dpr, whole] of [[1, false], [2, false], [1, true]]) {
        const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dpr });
        await page.goto(base + 'bench.html' + (whole ? '?whole=1' : ''));
        await page.waitForFunction(() => !!globalThis.__bench);
        await page.waitForTimeout(1500);
        await page.evaluate(() => globalThis.__bench.reset());
        await page.waitForTimeout(6000);
        const r = await page.evaluate(() => globalThis.__bench.report());
        const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
        if (dpr === 1 && !whole) console.log('perf: renderer', gl);
        const heap = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);
        console.log(`perf: dpr ${dpr}${whole ? ' whole city' : ''}: ${r.buildings} buildings, ${r.running} running, ${r.events} events, ${r.cars} cars; frames ${r.frames}, p50 ${r.p50.toFixed(2)} ms, p95 ${r.p95.toFixed(2)} ms, max ${r.max.toFixed(2)} ms (mean: scene ${r.parts.scene.toFixed(1)}, art ${r.parts.art.toFixed(1)}, scale ${r.parts.blit.toFixed(1)}, text ${r.parts.text.toFixed(1)}); sprites ${r.memory.sprites}, ${(r.memory.bytes / 1048576).toFixed(1)} MB (${r.memory.draws} draws, ${r.memory.evictions} evicted); JS heap ${heap} MB`);
        await page.close();
      }
    }
  } finally { await b.close(); srv.close(); }
  return failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((n) => process.exit(n ? 1 : 0), (e) => { console.error(e); process.exit(1); });
}
