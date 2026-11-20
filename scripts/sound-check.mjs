// The ambient sound, rendered (not just started): each city's graph is rendered offline in a headless Chromium and its
// loudness measured, overall and above 200 Hz (what a laptop speaker plays). Fails when a city that is busy, with the
// Sound switch on, is too quiet to hear, or when a quiet city is not quieter than a busy one. Then the real panel (the
// dev page, the sample day): with the switch on and a key pressed, what reaches the speakers is measured with an
// analyser on the audio output, and must be audible too.
//   --allow-skip    no Chromium: skip (and pass)
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { browser, prepare } from './city-check.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = join(root, '.dev', 'sound');
/** Quietest acceptable level of a city at work (dBFS RMS above 200 Hz): background music level, not a whisper. */
export const AUDIBLE_DB = -40;
const BUSY = { running: 3, errors: 1, traffic: 12, waiting: 0 };
const CASES = [
  // [name, levels, mix, expect audible]
  ['claude city, sessions running', { claude: BUSY }, { claude: 1 }, true],
  ['claude city, running only (no calls lately)', { claude: { running: 2, errors: 0, traffic: 0, waiting: 0 } }, { claude: 1 }, true],
  ['chatgpt city, sessions running', { chatgpt: BUSY }, { chatgpt: 1 }, true],
  ['workbuddy city, sessions running', { workbuddy: BUSY }, { workbuddy: 1 }, true],
  ['dsh city, running and waiting', { dsh: { ...BUSY, waiting: 2 } }, { dsh: 1 }, true],
  ['dsh city, running only', { dsh: { running: 2, errors: 0, traffic: 5, waiting: 0 } }, { dsh: 1 }, true],
  ['claude city, nothing running', { claude: { running: 0, errors: 0, traffic: 0, waiting: 0 } }, { claude: 1 }, false],
];

async function main() {
  const b = await browser();
  if (!b) { const ok = process.argv.includes('--allow-skip'); console.log(`sound-check: no headless Chromium; skipped${ok ? ' (--allow-skip)' : ''}`); return ok ? 0 : 1; }
  mkdirSync(dir, { recursive: true });
  await build({ entryPoints: [join(root, 'scripts/sound/render-page.ts')], bundle: true, outfile: join(dir, 'page.js'), format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'warning', define: { 'process.env.NODE_ENV': '"production"', __DSHU_DEV__: 'true' } });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="page.js"></script>');
  const srv = createServer((q, res) => { const f = (q.url ?? '/').split('?')[0].slice(1) || 'index.html'; try { const body = readFileSync(join(dir, f)); res.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); res.end(body); } catch { res.writeHead(404); res.end(); } }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.on('listening', r));
  let failed = 0;
  try {
    const page = await b.newPage();
    page.on('pageerror', (e) => { console.log('sound-check: page error ' + e.message); failed++; });
    await page.goto(`http://127.0.0.1:${srv.address().port}/`);
    await page.waitForFunction(() => globalThis.__ready);
    const res = {};
    for (const [name, levels, mix, audible] of CASES) {
      const r = await page.evaluate(([l, m]) => globalThis.__render(l, m), [levels, mix]);
      res[name] = r;
      const ok = audible ? r.hpDb >= AUDIBLE_DB : r.hpDb < AUDIBLE_DB - 6;
      console.log(`sound: ${name.padEnd(44)} ${r.db.toFixed(1).padStart(6)} dBFS, above 200 Hz ${r.hpDb.toFixed(1).padStart(6)} dBFS: ${ok ? 'ok' : 'FAIL (' + (audible ? 'too quiet to hear' : 'should be near silent') + ')'}`);
      failed += ok ? 0 : 1;
    }
    failed += await live(b);
  } finally { await b.close(); srv.close(); }
  return failed;
}

/** The panel as a member has it: Sound on, a key pressed, the output tapped with an analyser for two seconds. */
async function live(b) {
  const { srv, base } = await prepare();
  let failed = 0;
  try {
    for (const lang of ['zh', 'en']) {
      const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
      await ctx.addInitScript(() => {
        try { localStorage.setItem('khglobal-dsh-universe.view', JSON.stringify({ toured: true, sound: true })); } catch { /* none */ }
        const connect = AudioNode.prototype.connect;
        AudioNode.prototype.connect = function (dest, ...rest) {
          if (dest instanceof AudioDestinationNode) {
            const an = (this.context.__tap ??= Object.assign(this.context.createAnalyser(), { fftSize: 32768 }));
            connect.call(this, an);
            globalThis.__tap = an;
          }
          return connect.call(this, dest, ...rest);
        };
      });
      const page = await ctx.newPage();
      await page.goto(base + 'index.html?panel=1&clock=run&lang=' + lang);
      await page.waitForFunction(() => !!globalThis.__dshuCity?.scene);
      await page.locator('[role="application"]').focus();
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(2500);
      const db = await page.evaluate(async () => {
        const an = globalThis.__tap; if (!an) return null;
        // Above 200 Hz (one-pole high-pass, as in the offline render): what a laptop speaker plays.
        let sum = 0, n = 0;
        const al = 1 / (1 + 2 * Math.PI * 200 / an.context.sampleRate);
        for (let k = 0; k < 8; k++) {
          const x = new Float32Array(an.fftSize); an.getFloatTimeDomainData(x);
          let y = 0, px = 0;
          x.forEach((v, i) => { y = al * (y + v - px); px = v; if (i > 2048) { sum += y * y; n++; } });
          await new Promise((r) => setTimeout(r, 250));
        }
        return 10 * Math.log10(sum / n + 1e-20);
      });
      const ok = db !== null && db >= AUDIBLE_DB;
      console.log(`sound: panel (${lang}), Sound on, a key pressed: ${db === null ? 'nothing reached the output' : db.toFixed(1) + ' dBFS above 200 Hz at the output'}: ${ok ? 'ok' : 'FAIL'}`);
      failed += ok ? 0 : 1;
      await ctx.close();
    }
  } finally { srv.close(); }
  return failed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(await main() ? 1 : 0);
