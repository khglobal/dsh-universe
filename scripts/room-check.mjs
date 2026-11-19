// Headless browser checks of the rooms (needs playwright-core and a Chromium; skips cleanly without one; set
// CHROME_PATH if Playwright's own browser is not installed):
//   --golden            six representative rooms (every plan type), light and dark, against fixtures/golden/room-*.png
//                       (--update rewrites them). Sample day 2026-11-18 15:44:46, reduced motion: still pictures.
//   --perf              frame times of every 12×12 room while three agents work in it (the room moves)
//   --crisp             every room (all templates, each size) and the halls: each prop's pixel size matches the people's
//                       (one art pixel, not the old 2-pixel grid) and it has detail; and in the real panel at dpr 1 and
//                       2, several window sizes and after a ratio change, the room lands on whole device pixels with
//                       smoothing off, the backing store at the screen's ratio and no blended edges
//   --sheet <prefix>    contact sheets of every room template at 2 device pixels per art pixel (1:1 on a Retina
//                       screen at zoom 1): <prefix>-large.png, -medium.png, -small.png
//   --swiftshader       with --perf: no GPU at all (SwiftShader), at dpr 1 and 2; must stay under 33 ms at p95
//   --shots <dir>       screenshots for review (--prefix, default dshu-p3-): rooms, night, narrow, the 50 rooms
// The page is scripts/room/page.ts, built into .dev/ (ignored) and served on 127.0.0.1; nothing leaves the machine.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browser as anyBrowser, EDGE_BLEND_MAX, installEdgeBlend, prepare as preparePanel } from './city-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dev = join(root, '.dev');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };

/** Six rooms covering the five plan types (two of them mirrored) and all four kinds of floor. */
export const GOLDEN_ROOMS = ['market', 'archive', 'assembly', 'studio', 'helpdesk', 'salesfloor'];
/** Compact rooms and halls in the goldens: [room or hall, size]. */
export const GOLDEN_SIZES = [['market', 'small'], ['helpdesk', 'medium'], ['lobby', 'small'], ['roof', 'medium']];

async function prepare() {
  mkdirSync(dev, { recursive: true });
  await build({ entryPoints: [join(root, 'scripts/room/page.ts')], bundle: true, outfile: join(dev, 'room.js'), format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'warning' });
  writeFileSync(join(dev, 'room.html'), '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><body style="margin:0;overflow:hidden"><canvas id="cv" style="display:block;image-rendering:pixelated"></canvas><script type="module" src="room.js"></script>');
  const srv = createServer((q, res) => {
    const f = (q.url ?? '/').split('?')[0].slice(1) || 'room.html';
    const p = join(dev, f);
    if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    res.end(readFileSync(p));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { srv, base: `http://127.0.0.1:${srv.address().port}/` };
}

async function page(b, base, w = 1280, h = 760, dpr = 1) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('request', (r) => { if (!r.url().startsWith(base)) errors.push('network: ' + r.url()); });
  await p.goto(base + 'room.html');
  await p.waitForFunction(() => !!globalThis.show);
  return { p, errors };
}

/** Share of pixels that differ visibly between two PNGs (decoded in the page). */
async function diff(p, a, c) {
  return p.evaluate(async ([x, y]) => {
    const load = async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const cv = new OffscreenCanvas(im.width, im.height); const g = cv.getContext('2d'); g.drawImage(im, 0, 0); return g.getImageData(0, 0, im.width, im.height); };
    const A = await load(x), B = await load(y);
    if (A.width !== B.width || A.height !== B.height) return { size: true, changed: 1 };
    let n = 0;
    for (let i = 0; i < A.data.length; i += 4) if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 24) n++;
    return { size: false, changed: n / (A.width * A.height) };
  }, [a.toString('base64'), c.toString('base64')]);
}

/** The browser: the default one, or software only (SwiftShader, GPU off) with --swiftshader. */
async function browser() {
  if (!has('--swiftshader')) return anyBrowser();
  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch { return null; }
  const args = ['--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-rasterization', '--disable-accelerated-2d-canvas'];
  try { return await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}), args }); } catch { return null; }
}

/** Props smaller than this (art pixels) are not measured (a lamp's glow, a cable). */
const MIN_PROP = 60;
/** Shell items (floor, walls, ceiling) are not props. */
const SHELL = new Set(['', 'floor', 'top', 'wall']);

/**
 * Each prop as the room cache laid it down, against the people drawn into it. Pixel size: art on a 2-pixel grid has
 * every aligned 2×2 block one colour (`fine` 0); at one art pixel, like the people (~0.75), most blocks on its edges
 * are mixed. A prop must be at least a third of the people's. Detail: colour changes per pixel at least 0.2 for each
 * prop, and the room's median prop at least 0.7 of the people's.
 */
async function density(p) {
  const problems = [];
  const ids = await p.evaluate(() => globalThis.ROOM_IDS);
  const cases = [...ids.flatMap((room) => ['small', 'medium', 'large'].map((tier) => [room + ' ' + tier, { room, tier }])),
    ...[['b:s1', 'lobby'], ['b:s7', 'roof'], ['town', 'approval'], ['station', 'gate'], ['conn:erp', undefined]].map(([place, floor]) => [place + (floor ? ' ' + floor : ''), { place, ...(floor ? { floor } : {}) }])];
  let props = 0, worstFine = 1, worstEdges = Infinity;
  for (const [name, o] of cases) {
    const r = await p.evaluate((o) => globalThis.density(o), o);
    const peopleFine = Math.min(...r.people.map((x) => x.fine)), peopleEdges = median(r.people.map((x) => x.edges));
    const list = r.props.filter((x) => x.n >= MIN_PROP && !SHELL.has(x.tag));
    props += list.length;
    for (const x of list) {
      worstFine = Math.min(worstFine, x.fine / peopleFine); worstEdges = Math.min(worstEdges, x.edges);
      if (x.fine < peopleFine / 3) problems.push(`${name}: prop ${x.tag} is drawn at a coarser pixel than the people (2×2 blocks mixed ${(x.fine * 100).toFixed(0)}%, people ${(peopleFine * 100).toFixed(0)}%)`);
      if (x.edges < 0.2) problems.push(`${name}: prop ${x.tag} has too little detail (${x.edges.toFixed(2)} colour changes per pixel, at least 0.2)`);
    }
    const m = median(list.map((x) => x.edges));
    if (list.length && m < 0.7 * peopleEdges) problems.push(`${name}: the props have less detail than the people (median ${m.toFixed(2)} colour changes per pixel, people ${peopleEdges.toFixed(2)})`);
  }
  console.log(`crisp: ${props} props in ${cases.length} rooms and halls; finest-pixel ratio to the people at least ${worstFine.toFixed(2)} (limit 0.33), detail at least ${worstEdges.toFixed(2)} (limit 0.2)`);
  return problems;
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

/**
 * The real inside view (the panel's InteriorView in dev mode) at dpr 1 and 2, three window sizes, and after the
 * window moves to a screen of the other ratio: the backing store is the element times the ratio, the canvas is
 * `image-rendering: pixelated`, the room is drawn at a whole scale from a whole device pixel with smoothing off, and
 * almost no edge pixel of the room is an in-between colour (city-check.mjs EDGE_BLEND_MAX).
 */
async function screen(b) {
  const problems = [];
  const { srv, base } = await preparePanel();
  let worst = 0, views = 0;
  try {
    for (const dpr of [1, 2]) for (const [w, h] of [[1440, 900], [1100, 700], [390, 760]]) for (const room of ['market', 'helpdesk', 'salesfloor']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.addInitScript(installEdgeBlend);
      await page.goto(`${base}index.html?fixed=1&lang=en&room=${room}`);
      await page.waitForFunction(() => !!globalThis.__dshuRoom?.geometry?.w, null, { timeout: 10_000 });
      await page.waitForTimeout(300);
      const check = async (what) => {
        const r = await page.evaluate(([what, max]) => {
          const v = globalThis.__dshuRoom, cv = v.canvas, rc = cv.getBoundingClientRect(), out = [];
          v.paint();
          const b = v.blit, want = [Math.round(rc.width * devicePixelRatio), Math.round(rc.height * devicePixelRatio)];
          if (cv.width !== want[0] || cv.height !== want[1]) out.push(`${what}: backing ${cv.width}×${cv.height}, element × ratio ${want.join('×')}`);
          if (!Number.isInteger(b.sc) || b.sc < 1 || ![b.x, b.y, b.w, b.h].every(Number.isInteger)) out.push(`${what}: blit ${JSON.stringify(b)}`);
          if (Math.abs(v.geometry.zoom * devicePixelRatio - b.sc) > 1e-9) out.push(`${what}: zoom ${v.geometry.zoom} × ratio ${devicePixelRatio} is not the blit scale ${b.sc}`);
          if (b.smoothing) out.push(`${what}: image smoothing on`);
          if (getComputedStyle(cv).imageRendering !== 'pixelated') out.push(`${what}: image-rendering ${getComputedStyle(cv).imageRendering}`);
          const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, signs = v.signRects;
          const e = globalThis.__edgeBlend(d, cv.width, cv.height, [b.x, b.y, b.x + b.w, b.y + b.h], (x, y) => signs.some((s) => x >= s[0] - 2 && x < s[2] + 2 && y >= s[1] - 2 && y < s[3] + 2));
          if (e.share > max) out.push(`${what}: ${(e.share * 100).toFixed(2)}% of the room's edge pixels are blended (most ${max * 100}%)`);
          return { out, share: e.share };
        }, [what, EDGE_BLEND_MAX]);
        worst = Math.max(worst, r.share); views++;
        return r.out;
      };
      problems.push(...await check(`${room} ${w}×${h} dpr ${dpr}`));
      const other = dpr === 2 ? 1 : 2;
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: other, mobile: false });
      await page.waitForFunction((o) => globalThis.devicePixelRatio === o, other);
      await page.waitForTimeout(1300);
      problems.push(...await check(`${room} ${w}×${h} dpr ${dpr} → ${other}`));
      await ctx.close();
    }
  } finally { srv.close(); }
  console.log(`crisp: ${views} room views; edge pixels blended at most ${(worst * 100).toFixed(3)}% (limit ${EDGE_BLEND_MAX * 100}%)`);
  return problems;
}

async function main() {
  const b = await browser();
  // Without a Chromium nothing was checked: that fails, unless the caller says skipping is fine (`--allow-skip`, CI).
  if (!b) {
    const ok = process.argv.includes('--allow-skip');
    console.log(`room-check: no headless Chromium available; skipped${ok ? ' (--allow-skip)' : ' (pass --allow-skip to accept)'}`);
    return ok ? 0 : 1;
  }
  const { srv, base } = await prepare();
  let failed = 0;
  try {
    if (has('--golden')) {
      const dir = join(root, 'fixtures/golden');
      mkdirSync(dir, { recursive: true });
      const { p, errors } = await page(b, base);
      // The six rooms at their building's size, then compact ones (floors as big as the building).
      const cases = [...GOLDEN_ROOMS.map((room) => ['room-' + room, { room }]), ...GOLDEN_SIZES.map(([k, tier]) => ['room-' + k + '-' + tier, { [k === 'lobby' || k === 'roof' ? 'floor' : 'room']: k, tier }])];
      for (const [stem, o] of cases) for (const dark of [false, true]) {
        const name = stem + (dark ? '-dark' : '-light');
        await p.evaluate((o) => globalThis.show(o), { ...o, dark, reduced: true });
        const png = await p.screenshot();
        const file = join(dir, name + '.png');
        if (has('--update') || !existsSync(file)) { writeFileSync(file, png); console.log('golden: wrote', name); continue; }
        const d = await diff(p, readFileSync(file), png);
        const ok = !d.size && d.changed <= 0.0005;
        console.log(`golden: ${name} ${ok ? 'ok' : 'DIFFERENT'} (${(d.changed * 100).toFixed(2)}% pixels)`);
        if (!ok) { failed++; writeFileSync(join(dev, name + '.actual.png'), png); }
      }
      if (errors.length) { console.error(errors); failed++; }
      await p.close();
    }
    if (has('--perf')) for (const dpr of has('--swiftshader') ? [1, 2] : [1]) {
      const { p, errors } = await page(b, base, 1280, 760, dpr);
      const ids = await p.evaluate(() => globalThis.ROOM_IDS);
      const all = [];
      let worst = { id: '', p95: 0 };
      for (const room of ids) for (const tier of ['small', 'medium', 'large']) {
        // The busiest library of the sample day (three agents at work) furnished as this room, at each size; 16 ms frames.
        await p.evaluate(([room, dpr, tier]) => globalThis.show({ place: 'b:s7', floor: 'library', room, override: true, dpr, tier }), [room, dpr, tier]);
        await p.evaluate(() => { for (let i = 0; i < 40; i++) globalThis.frame(16); });
        const r = await p.evaluate(() => globalThis.perf(360, 1000 / 60));
        all.push(r.p95);
        if (r.p95 > worst.p95) worst = { id: room + ' ' + tier, p95: r.p95, p50: r.p50, max: r.max, roomPaints: r.roomPaints };
      }
      all.sort((x, y) => x - y);
      const q = (k) => all[Math.min(all.length - 1, Math.floor(k * all.length))];
      const gl = await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'none'; });
      console.log(`perf (${gl}): ${ids.length} rooms × 3 sizes, 1280×760, dpr ${dpr}, three agents working (the room moves): p95 per room median ${q(0.5).toFixed(2)} ms, worst ${worst.id} ${worst.p95.toFixed(2)} ms (p50 ${worst.p50.toFixed(2)}, max ${worst.max.toFixed(2)}, ${worst.roomPaints} room bands in 360 frames)`);
      const limit = has('--swiftshader') ? 33 : 8;
      if (worst.p95 >= limit) { console.error(`perf: a room is over ${limit} ms at p95`); failed++; }
      if (errors.length) { console.error(errors); failed++; }
      await p.close();
    }
    if (has('--crisp')) {
      const { p, errors } = await page(b, base);
      const pr = await density(p);
      await p.close();
      const sc = await screen(b);
      for (const x of [...pr, ...sc]) console.error('crisp:', x);
      console.log(pr.length + sc.length ? `crisp: ${pr.length + sc.length} problem(s)` : 'crisp: props at the people\'s pixel size with detail, rooms on whole device pixels without blended edges');
      failed += pr.length + sc.length;
      if (errors.length) { console.error(errors); failed++; }
    }
    const sheet = arg('--sheet');
    if (sheet) {
      const { p, errors } = await page(b, base, 2020, 2360, 2);
      const ids = await p.evaluate(() => globalThis.ROOM_IDS);
      for (const tier of ['large', 'medium', 'small']) {
        await p.evaluate(([ids, tier]) => globalThis.grid(ids, { act: true, scale: 2, tier }, 5), [ids, tier]);
        writeFileSync(`${sheet}-${tier}.png`, await (await p.$('#cv')).screenshot());
        console.log(`sheet: ${ids.length} rooms, ${tier}`);
      }
      if (errors.length) { console.error(errors); failed++; }
      await p.close();
    }
    const shots = arg('--shots');
    if (shots) {
      mkdirSync(shots, { recursive: true });
      const pre = arg('--prefix') ?? 'dshu-p3-';
      const { p, errors } = await page(b, base);
      const list = [
        ['market-busy', { room: 'market' }], ['market-night', { room: 'market', dark: true }], ['servers', { room: 'servers' }],
        ['assembly', { room: 'assembly' }], ['newsroom', { room: 'newsroom' }], ['helpdesk', { room: 'helpdesk' }],
        ['warroom-night', { room: 'warroom', dark: true }], ['lobby', { place: 'b:s1', floor: 'lobby' }], ['roof', { place: 'b:s7', floor: 'roof' }],
        ['town-approval', { place: 'town', floor: 'approval' }], ['connector-erp', { place: 'conn:erp' }], ['station-gate', { place: 'station', floor: 'gate' }],
      ];
      for (const [n, o] of list) {
        await p.evaluate((o) => globalThis.show(o), o);
        await p.evaluate(() => { for (let i = 0; i < 60; i++) globalThis.frame(16); });
        writeFileSync(join(shots, pre + n + '.png'), await p.screenshot());
        console.log('shot:', n);
      }
      await p.setViewportSize({ width: 390, height: 760 });
      await p.evaluate(() => globalThis.show({ room: 'market', w: 390, h: 760 }));
      await p.evaluate(() => { for (let i = 0; i < 60; i++) globalThis.frame(16); });
      writeFileSync(join(shots, pre + 'narrow.png'), await p.screenshot());
      const ids = await p.evaluate(() => globalThis.ROOM_IDS);
      await p.setViewportSize({ width: 2020, height: 1200 });
      for (let g = 0; g < 50; g += 25) {
        await p.evaluate(([ids]) => globalThis.grid(ids, { act: true }, 5), [ids.slice(g, g + 25)]);
        writeFileSync(join(shots, pre + 'all-' + (g / 25 + 1) + '.png'), await (await p.$('#cv')).screenshot());
      }
      console.log('shot: all 50 rooms');
      if (errors.length) { console.error(errors); failed++; }
      await p.close();
    }
  } finally { await b.close(); srv.close(); }
  return failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((n) => process.exit(n ? 1 : 0), (e) => { console.error(e); process.exit(1); });
}
