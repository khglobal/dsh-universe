// What the panel costs while nobody touches it, in a headless Chromium (needs playwright-core and a Chromium; without
// one it fails unless --allow-skip). The real panel (plugin/src/dev/main.tsx, built into .dev/) at 1440×900, dpr 2,
// motion allowed, on the sample day and on the busy day (300 sessions, ?stress=many), in each state a member leaves
// it in: the city idle, the window blurred, the page hidden, inside a building (agents working, or nobody), the list.
// For each state: frames painted per second (the city or room view's own count) and CPU of all browser processes
// (SystemInfo.getProcessInfo) as a share of one core, over --seconds (default 8) after a settling second.
//   --frozen            the page's clock stays at the sample's moment (by default it runs on, as a member's does: the
//                       per-second work of a running clock is part of what an open panel costs)
//   --gpu               the machine's GPU (Metal on macOS) instead of SwiftShader (CPU then means the real cost)
//   --json <file>       write the figures
//   --only <name,...>   only these states
//   --cpu-limit <pct>   fail when an idle state's CPU is over this share of one core (default: none; frames always)
//   --main-limit <pct>  fail when a calm, blurred or hidden state keeps the page's main thread busier than this
// Frame limits (they hold on any machine): an idle city or room paints at most AMBIENT_FPS (+ slack), a blurred
// window at most BLURRED_FPS (+ slack), a hidden page and the list nothing; a camera glide runs at full rate.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { browser, prepare } from './city-check.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const SECONDS = Number(arg('--seconds') ?? 8);
const CPU_LIMIT = arg('--cpu-limit') !== undefined ? Number(arg('--cpu-limit')) : undefined;
const MAIN_LIMIT = arg('--main-limit') !== undefined ? Number(arg('--main-limit')) : undefined;
/** Must match packages/renderer/src/pace.ts. */
export const AMBIENT_FPS = 12, CALM_FPS = 2, CALM_AFTER_MS = 10_000, BLURRED_FPS = 1;

const CLOCK = has('--frozen') ? '' : '&clock=run';
const SAMPLE = 'panel=1&fixed=1&lang=en' + CLOCK;
const BUSY = 'panel=1&fixed=1&lang=en&stress=many' + CLOCK;
/** [name, query, what to do after load, which view counts frames, frame limit [min, max] per second]. */
export const STATES = [
  ['city-sample', SAMPLE, null, 'city', [1, AMBIENT_FPS + 1.5]],
  ['city-sample-calm', SAMPLE, 'calm', 'city', [1, CALM_FPS + 1]],
  ['city-sample-blurred', SAMPLE, 'blur', 'city', [0, BLURRED_FPS + 0.5]],
  ['city-busy', BUSY, null, 'city', [1, AMBIENT_FPS + 1.5]],
  ['city-busy-calm', BUSY, 'calm', 'city', [1, CALM_FPS + 1]],
  ['city-busy-blurred', BUSY, 'blur', 'city', [0, BLURRED_FPS + 0.5]],
  ['city-busy-hidden', BUSY, 'hide', 'city', [0, 0]],
  // Moving the camera runs at the display's rate: well above the ambient cap (software rendering on a CI runner is slower).
  ['city-busy-glide', BUSY, 'glide', 'city', [has('--gpu') ? 25 : AMBIENT_FPS + 4, 1000]],
  ['room-sample-working', SAMPLE, 'room-running', 'room', [1, AMBIENT_FPS + 1.5]],
  ['room-sample-calm', SAMPLE, 'room-running+calm', 'room', [1, CALM_FPS + 1]],
  ['room-sample-nobody', SAMPLE, 'room-done', 'room', [0, AMBIENT_FPS + 1.5]],
  ['room-sample-blurred', SAMPLE, 'room-running+blur', 'room', [0, BLURRED_FPS + 0.5]],
  ['city-busy-stopped', BUSY, 'stopped', 'city', [0, 0]],
  ['list-busy', BUSY, 'list', 'city', [0, 0]],
];

async function cpuTime(cdp) {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  const by = {};
  for (const p of processInfo) by[p.type] = (by[p.type] ?? 0) + p.cpuTime;
  return Object.assign(processInfo.reduce((a, p) => a + p.cpuTime, 0), { by });
}

async function enter(page, want) {
  const ids = await page.evaluate((want) => globalThis.__dshuCity.scene.places.filter((p) => p.tier === 'building' && (want === 'running' ? p.state === 'running' : p.state === 'done')).map((p) => p.id), want);
  for (const id of ids.slice(0, 6)) {
    await page.evaluate((id) => { const v = globalThis.__dshuCity; v.moveTo({ ...v.cam, zi: 3 }); v.centreOn(id); }, id);
    await page.waitForTimeout(900);
    const pt = await page.evaluate((id) => { const v = globalThis.__dshuCity, h = v.last.hits.find((x) => x.id === id); if (!h) return undefined; const r = v.canvas.getBoundingClientRect(), q = v.screenOf((h.r[0] + h.r[2]) / 2, (h.r[1] + h.r[3]) / 2); return [q[0] + r.left, q[1] + r.top]; }, id);
    if (!pt) continue;
    await page.mouse.click(pt[0], pt[1]);
    const ok = await page.waitForFunction(() => !!globalThis.__dshuRoom?.geometry?.w, null, { timeout: 3000 }).then(() => true, () => false);
    if (ok) return;
    await page.keyboard.press('Escape');
  }
  throw new Error('could not enter a ' + want + ' building');
}

async function measure(b, state) {
  const [name, qs, act, which, [lo, hi]] = state;
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true, nbSeen: true })); } catch { /* storage off */ } });
  await page.goto(globalThis.__base + 'index.html?' + qs);
  await page.waitForFunction(() => !!globalThis.__dshuCity?.scene);
  // The first seconds draw every sprite once (a busy day's 300 towers): not what an open panel costs.
  await page.waitForTimeout(5000);
  if (act?.startsWith('room-')) await enter(page, act.includes('running') ? 'running' : 'done');
  // Left alone: no pointer, wheel or key for CALM_AFTER_MS.
  if (act?.endsWith('calm')) await page.waitForTimeout(CALM_AFTER_MS + 500);
  if (act?.endsWith('blur')) await page.evaluate(() => globalThis.dispatchEvent(new Event('blur')));
  if (act === 'hide') await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  if (act === 'stopped') await page.evaluate(() => globalThis.__dshuCity.stop());
  if (act === 'list') await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.waitForTimeout(1200);
  // A member just moved the pointer (the ambient life at its full rate), unless the state is about being left alone.
  if (!act?.endsWith('calm') && !act?.endsWith('blur') && act !== 'hide') await page.mouse.move(700, 450);
  const frames = () => page.evaluate((which) => { const v = which === 'room' ? globalThis.__dshuRoom : globalThis.__dshuCity; return v ? v.stats().frames : 0; }, which);
  const cdp = await b.newBrowserCDPSession();
  const pc = await ctx.newCDPSession(page);
  await pc.send('Performance.enable');
  const busy = async () => { const { metrics } = await pc.send('Performance.getMetrics'); const m = Object.fromEntries(metrics.map((x) => [x.name, x.value])); return [m.TaskDuration, m.ScriptDuration]; };
  // A glide: the camera is sent somewhere new every 300 ms for the whole window (a member moving around).
  let gliding;
  if (act === 'glide') { let k = 0; gliding = setInterval(() => { k++; void page.evaluate((k) => { const v = globalThis.__dshuCity; v.moveTo({ ...v.cam, x: (k % 2 ? 1 : -1) * 120, y: 232 + (k % 3) * 40 }); }, k).catch(() => {}); }, 300); }
  // The city's text layer is written again only when a sign or a still sprite in front of one changes (view.ts).
  const signs = () => page.evaluate(() => globalThis.__dshuCity?.signDraws ?? 0);
  const s0 = await signs();
  const f0 = await frames(), c0 = await cpuTime(cdp), m0 = await busy(), t0 = Date.now();
  await page.waitForTimeout(SECONDS * 1000);
  const f1 = await frames(), c1 = await cpuTime(cdp), m1 = await busy(), t1 = Date.now();
  const signDraws = which === 'city' ? (await signs()) - s0 : 0;
  if (gliding) clearInterval(gliding);
  await cdp.detach();
  await ctx.close();
  const s = (t1 - t0) / 1000;
  const types = Object.fromEntries(Object.keys(c1.by).map((k) => [k, Math.round(((c1.by[k] - (c0.by[k] ?? 0)) / s) * 1000) / 10]));
  const fps = (f1 - f0) / s, cpu = ((c1 - c0) / s) * 100, main = ((m1[0] - m0[0]) / s) * 100, script = ((m1[1] - m0[1]) / s) * 100;
  const problems = [...errors];
  if (fps < lo || fps > hi) problems.push(`${fps.toFixed(1)} frames/s, expected ${lo} to ${hi}`);
  if (which === 'city' && /calm|blur/.test(String(act)) && signDraws > 2) problems.push(`the text layer was written ${signDraws} times while nothing but the ambient life moved`);
  if (CPU_LIMIT !== undefined && act !== 'glide' && cpu > CPU_LIMIT) problems.push(`CPU ${cpu.toFixed(1)}% of a core, limit ${CPU_LIMIT}%`);
  if (MAIN_LIMIT !== undefined && /calm|blur|hide|list|nobody/.test(String(act) + name) && main > MAIN_LIMIT) problems.push(`page main thread ${main.toFixed(1)}% busy, limit ${MAIN_LIMIT}%`);
  return { name, signDraws, fps: Math.round(fps * 10) / 10, cpu: Math.round(cpu * 10) / 10, main: Math.round(main * 10) / 10, script: Math.round(script * 10) / 10, types, problems };
}

async function main() {
  const b = await browser();
  if (!b) {
    const ok = has('--allow-skip');
    console.log(`cpu-check: no headless Chromium available; skipped${ok ? ' (--allow-skip)' : ' (pass --allow-skip to accept)'}`);
    return ok ? 0 : 1;
  }
  const { srv, base } = await prepare();
  globalThis.__base = base;
  const only = arg('--only')?.split(',');
  const out = [];
  let failed = 0;
  try {
    for (const st of STATES) {
      if (only && !only.includes(st[0])) continue;
      const r = await measure(b, st);
      out.push(r);
      console.log(`cpu: ${r.name.padEnd(20)} ${String(r.fps).padStart(5)} frames/s  ${String(r.cpu).padStart(5)}% of a core (page main thread ${r.main}%, script ${r.script}%; ${Object.entries(r.types).map(([k, v]) => k + ' ' + v + '%').join(', ')})${r.problems.length ? '  FAIL: ' + r.problems.join('; ') : ''}`);
      failed += r.problems.length ? 1 : 0;
    }
  } finally { await b.close(); srv.close(); }
  const json = arg('--json');
  if (json) writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), gpu: has('--gpu'), clock: has('--frozen') ? 'frozen' : 'running', seconds: SECONDS, states: out }, null, 2) + '\n');
  return failed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((n) => process.exit(n ? 1 : 0), (e) => { console.error(e); process.exit(1); });
}
