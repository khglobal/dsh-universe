// Renders the ambience offline in a real browser (scripts/sound-check.mjs): the same graph createAmbience builds,
// stepped every 250 ms as useAmbience does, into an OfflineAudioContext. Returns loudness figures per case.
import { createAmbience, type AudioLike, type CityLevels } from '../../src/client/sound.ts';

const RATE = 48_000;
/** RMS in dBFS of a buffer, after an optional one-pole high-pass at `hp` Hz (what a laptop speaker can play). */
function rmsDb(x: Float32Array, hp = 0, from = 0): number {
  let y = 0, prevX = 0, sum = 0, n = 0;
  const a = hp ? 1 / (1 + 2 * Math.PI * hp / RATE) : 1;
  for (let i = 0; i < x.length; i++) {
    const v = hp ? (y = a * (y + x[i] - prevX), prevX = x[i], y) : x[i];
    if (i >= from) { sum += v * v; n++; }
  }
  return 10 * Math.log10(sum / Math.max(1, n) + 1e-20);
}

async function render(levels: Record<string, CityLevels>, mix: Record<string, number>, seconds = 6): Promise<{ db: number; hpDb: number }> {
  const ctx = new OfflineAudioContext(1, RATE * seconds, RATE);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const amb = createAmbience(ctx as unknown as AudioLike, rand);
  amb.set(levels, mix);
  for (let t = 0.25; t < seconds; t += 0.25) void ctx.suspend(t).then(() => { amb.step(); void ctx.resume(); });
  amb.step();
  const buf = await ctx.startRendering();
  const x = buf.getChannelData(0);
  // From the second second on (after the fade-in).
  return { db: rmsDb(x, 0, RATE * 2), hpDb: rmsDb(x, 200, RATE * 2) };
}

(globalThis as { __render?: typeof render }).__render = render;
(globalThis as { __ready?: boolean }).__ready = true;
