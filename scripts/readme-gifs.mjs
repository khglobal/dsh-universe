// The README GIFs (docs/screenshots/city.gif, docs/screenshots/indoor.gif): the real panel, recorded frame by frame in
// headless Chromium on the English sample day with a short scripted stretch of made-up work (scripts/gifs/page.tsx).
// Playwright's fake clock, paused and stepped by the script, drives the page (timers, animation frames,
// performance.now), so every run plays the same script at the same moments (a car or the train can land a frame
// apart, as React's renders are not on the fake clock). A drawn cursor shows where the script points and clicks. Frames are 1:1 screen pixels (dpr 1, no scaling),
// turned into a GIF with one shared palette and no dithering (FFmpeg), then optimised with gifsicle when it is there.
// Needs playwright-core, a Chromium (CHROME_PATH, e.g. the Playwright cache's chrome-headless-shell) and ffmpeg
// (FFMPEG, default `ffmpeg`). Mock data only; nothing leaves the machine.
//   node scripts/readme-gifs.mjs [--only city|indoor] [--out docs/screenshots] [--frames <dir>]
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { browser } from './city-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const out = arg('--out', join(root, 'docs/screenshots'));
const only = arg('--only');
const framesDir = arg('--frames', join(tmpdir(), 'dshu-gif-frames'));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const FPS = 12.5;            // 8 cs a frame: GIF delays are whole hundredths of a second
const STEP = 1000 / FPS;
const W = 1200, H = 720;

// ---------- the page ----------

const dev = join(root, '.dev/gifs');
mkdirSync(dev, { recursive: true });
await build({ entryPoints: [join(root, 'scripts/gifs/page.tsx')], bundle: true, outfile: join(dev, 'page.js'), format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"' } });
writeFileSync(join(dev, 'index.html'), '<!doctype html><meta charset="utf-8"><title>DSH Universe</title><body><script type="module" src="page.js"></script>');
const srv = createServer((q, res) => {
  const f = (q.url ?? '/').split('?')[0].slice(1) || 'index.html';
  const p = join(dev, f);
  if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
  res.end(readFileSync(p));
});
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${srv.address().port}/`;

// ---------- the cursor (drawn into the page: a headless screenshot has no pointer) ----------

const CURSOR = () => {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;pointer-events:none;z-index:2147483647;transform:translate(-100px,-100px)';
  el.innerHTML = '<div style="position:absolute;left:-13px;top:-13px;width:26px;height:26px;border-radius:50%;border:3px solid #2F6BDE;opacity:0;box-sizing:border-box"></div>'
    + '<svg width="22" height="30" viewBox="0 0 22 30" style="position:absolute;left:-2px;top:-1px" shape-rendering="crispEdges"><path d="M2 1 L2 24 L8 18 L12 28 L16 26 L12 17 L20 17 Z" fill="#fff" stroke="#141A30" stroke-width="2" stroke-linejoin="round"/></svg>';
  const ring = el.firstChild;
  addEventListener('mousemove', (e) => { el.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; }, true);
  addEventListener('mousedown', () => { ring.style.opacity = '1'; setTimeout(() => { ring.style.opacity = '0'; }, 320); }, true);
  addEventListener('DOMContentLoaded', () => document.body.append(el));
};

// ---------- the scripts ----------

const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
/** Cursor moves and clicks over the recording: [from s, to s, from point, to point] glides and [at s, 'click'] taps. */
function cursorAt(cues, s) {
  let pos;
  for (const c of cues) if (c.move) { const [a, b, p, q] = c.move; if (s >= a) { const k = ease(Math.min(1, (s - a) / (b - a))); pos = [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]; } }
  return pos;
}

/** Centre of the first element matching a role and name. */
async function centre(page, role, name) {
  const b = await page.getByRole(role, { name }).first().boundingBox();
  return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
}

const SCENES = {
  // The city: a new session goes up in Sales, agents walk to Review Square to ask, roads fill, the 15:45 scheduled run
  // comes in by train; then the Errors view: Error Recovery's engine drives out to the new building's fire.
  city: {
    lead: 6.6, seconds: 9.6,
    async setup(page) {
      // The camera a little left of home: the Sales district, Error Recovery, the Scheduler and the square in view.
      await page.evaluate(() => { const v = globalThis.__dshuCity; v.moveTo({ ...v.cam, x: v.cam.x - 100, y: v.cam.y + 6 }); });
      const errors = await centre(page, 'button', /^Errors$/), all = await centre(page, 'button', /^Everything$/);
      // The cursor rests on the empty end of the today bar (nothing to hover there), so the loop starts and ends alike.
      const rest = [1045, 28], g1 = [196, 470];
      return [
        { move: [0, 0.01, rest, rest] },
        { move: [3.4, 4.5, rest, errors] }, { at: 4.7, click: true },
        { move: [5.2, 6.0, errors, g1] },
        { move: [7.1, 7.8, g1, all] }, { at: 7.95, click: true },
        { move: [8.3, 9.5, all, rest] },
      ];
    },
  },
  // Inside the bid team's building (a lead agent and three subagents): the cursor opens the call tape, the error
  // beacon and the job printer, changes floor and comes back, while the agents move between desks as their tools change.
  indoor: {
    lead: 2, seconds: 10,
    async setup(page) {
      await page.evaluate(() => globalThis.__dshuCity.centreOn('b:s7'));
      await page.clock.runFor(600);
      const [x, y] = await page.evaluate(() => {
        const v = globalThis.__dshuCity, t = v.last.tops.get('b:s7'), r = v.canvas.getBoundingClientRect();
        const q = v.screenOf(t[0], t[1]); return [q[0] + r.left, q[1] + r.top + 40];
      });
      await page.mouse.click(x, y);
      await page.clock.runFor(800);
      const props = {
        tape: await centre(page, 'button', /^Call tape:/), beacon: await centre(page, 'button', /^Error beacon:/),
        printers: await centre(page, 'button', /^Job printers:/),
      };
      const lib = await centre(page, 'button', /^Floor 2: /), shop = await centre(page, 'button', /^Floor 3: /);
      // Stay on the library (the room otherwise follows the floor with most people as they move).
      await page.mouse.click(...lib); await page.clock.runFor(300);
      const rest = [1060, 540];
      return [
        { move: [0, 0.01, rest, rest] },
        { move: [0.4, 1.2, rest, props.tape] }, { at: 1.35, click: true },
        { move: [2.3, 2.8, props.tape, props.beacon] }, { at: 2.95, click: true },
        { move: [3.8, 4.5, props.beacon, props.printers] }, { at: 4.65, click: true },
        { at: 5.6, key: 'Escape' },
        { move: [5.7, 6.4, props.printers, shop] }, { at: 6.55, click: true },
        { move: [6.8, 7.5, shop, [1000, 600]] },
        { move: [8.1, 8.6, [1000, 600], lib] }, { at: 8.75, click: true },
        { move: [9.0, 9.9, lib, rest] },
      ];
    },
  },
};

async function record(b, name, sc) {
  const dir = join(framesDir, name);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const page = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, colorScheme: 'light', reducedMotion: 'no-preference' });
  page.on('pageerror', (e) => console.error(name, String(e)));
  // Fake time that only moves when the script moves it (installed clocks otherwise also run on with real time).
  const t0 = new Date(2026, 10, 18, 15, 44, 46).getTime();
  await page.clock.install({ time: t0 });
  await page.clock.pauseAt(t0 + 1000);
  // A returning member (no first-run tour) on the day light.
  await page.addInitScript(() => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true, light: 'day' })); } catch { /* storage off */ } });
  await page.addInitScript(CURSOR);
  await page.goto(`${base}index.html?scene=${name}&lead=${sc.lead}`);
  await page.clock.runFor(800);
  await page.waitForFunction(() => !!globalThis.__dshuCity?.scene);
  const cues = await sc.setup(page);
  // Warm up to the recording's first moment (the page's clock started at load).
  const ran = await page.evaluate(() => performance.now());
  await page.clock.runFor(Math.max(0, Math.round(sc.lead * 1000 - ran)));
  const n = Math.round(sc.seconds * FPS);
  const clicks = cues.filter((c) => c.click).map((c) => ({ ...c })), keys = cues.filter((c) => c.key).map((c) => ({ ...c }));
  for (let i = 0; i < n; i++) {
    const s = i / FPS;
    const pos = cursorAt(cues, s);
    if (pos) await page.mouse.move(Math.round(pos[0]), Math.round(pos[1]));
    for (const c of clicks) if (!c.done && s >= c.at) { c.done = true; await page.mouse.down(); await page.mouse.up(); }
    for (const c of keys) if (!c.done && s >= c.at) { c.done = true; await page.keyboard.press(c.key); }
    await page.clock.runFor(STEP);
    await page.screenshot({ path: join(dir, String(i).padStart(4, '0') + '.png') });
  }
  await page.close();
  return dir;
}

function encode(dir, file) {
  const run = (cmd, a) => { const r = spawnSync(cmd, a, { stdio: ['ignore', 'ignore', 'inherit'] }); if (r.status !== 0) throw new Error(cmd + ' failed'); };
  const pal = join(dir, 'palette.png');
  // One palette for the whole GIF from every frame; no dithering, so the pixel art keeps hard edges.
  run(FFMPEG, ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-vf', 'palettegen=max_colors=256:stats_mode=full:reserve_transparent=0', pal]);
  run(FFMPEG, ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-i', pal, '-lavfi', 'paletteuse=dither=none:diff_mode=rectangle', '-loop', '0', file]);
  if (spawnSync('gifsicle', ['--version']).status === 0) run('gifsicle', ['-O3', '--batch', file]);
  console.log('gif:', file, (statSync(file).size / 1e6).toFixed(2), 'MB');
}

const b = await browser();
if (!b) { console.error('readme-gifs: no headless Chromium (set CHROME_PATH)'); process.exit(1); }
try {
  mkdirSync(out, { recursive: true });
  for (const [name, sc] of Object.entries(SCENES)) {
    if (only && only !== name) continue;
    const dir = await record(b, name, sc);
    encode(dir, join(out, name + '.gif'));
  }
} finally { await b.close(); srv.close(); }
