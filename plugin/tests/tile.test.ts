import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '@dsh-universe/model';
import { createStubKit } from '@dsh-universe/renderer';
import { dshSample } from '../../fixtures/dsh-sample.ts';

const fx = dshSample(new Date(2026, 10, 18).getTime());

/** A recording 2D canvas (node has none). */
function fakeCanvas() {
  const log: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get(_t, k: string) { return (...a: unknown[]) => { log.push(k + '(' + a.length + ')'); }; },
    set(_t, k: string, v: unknown) { log.push(k + '=' + String(v)); return true; },
  });
  return { canvas: { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement, log };
}

test('tile: each declared size has its own layout', async () => {
  const { layoutOf } = await import('../src/client/tile-city.ts');
  assert.equal(layoutOf({ w: 4, h: 2 }), 'wide');
  assert.equal(layoutOf({ w: 2, h: 2 }), 'square');
  assert.equal(layoutOf({ w: 4, h: 1 }), 'strip');
});

test('tile: the mini city is one still picture at device resolution, with no text in it', async () => {
  const { paintTileCity } = await import('../src/client/tile-city.ts');
  const store = createStore(); store.applyAll(fx.events);
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return fakeCanvas().canvas.getContext('2d'); } };
  try {
    const { canvas, log } = fakeCanvas();
    paintTileCity(canvas, createStubKit(() => ({ canvas: { width: 1, height: 1 } as never, ctx: fakeCanvas().canvas.getContext('2d') as never })), { store, placement: fx.placement!, T: fx.now, dark: false, w: 220, h: 172, dpr: 2 });
    assert.deepEqual([canvas.width, canvas.height], [440, 344]);
    assert.ok(log.some((l) => l.startsWith('drawImage(')), 'the city is put down');
    assert.ok(!log.some((l) => /^(fillText|strokeText)/.test(l)), 'no text in the picture');
    assert.ok(log.includes('imageSmoothingEnabled=false'), 'crisp at a device pixel ratio of 2');
  } finally { delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas; }
});

test('tile: the 4×1 strip keeps the balloon in the picture, its top 4 px inside the frame', async () => {
  const { tileCamY, balloonTop, BALLOON_INSET } = await import('../src/client/tile-city.ts');
  const { scaleOf } = await import('@dsh-universe/renderer');
  for (const [h, dpr] of [[72, 1], [72, 2], [64, 2], [172, 2], [172, 1]] as const) {
    const y = tileCamY(3, h, dpr), sc = scaleOf({ x: 0, y: 0, zi: 1 }, { w: 1, h, dpr });
    const top = (h * dpr / 2 + (balloonTop() - y) * sc) / dpr;   // CSS pixels from the frame's top
    assert.ok(top >= BALLOON_INSET && top < BALLOON_INSET + 1 || y === 250, `h ${h} dpr ${dpr}: balloon top at ${top}`);
    assert.ok(top >= BALLOON_INSET, 'never cut');
  }
  assert.ok(tileCamY(3, 72, 2) < 250, 'the strip moves the picture up');
  assert.equal(tileCamY(3, 400, 2), 250, 'a tall frame keeps the usual framing');
});

test('tile: the local figures stay apart from DSH\'s own and only count what was read', async () => {
  const { tileFigures, TILE_LOCAL_MS } = await import('../src/client/tile-city.ts');
  const d = { need: 1, running: 2, errors: 3, tokens: 4000 };
  assert.deepEqual(tileFigures(d, []), { ...d, local: { running: 0, errors: 0, tokens: 0 } });
  const f = tileFigures(d, [
    { id: 'claude-code', running: 1, errors: 0, tokens: 1200 },
    { id: 'codex', running: 2, errors: 1, tokens: Number.NaN },
  ]);
  assert.deepEqual(f, { need: 1, running: 2, errors: 3, tokens: 4000, local: { running: 3, errors: 1, tokens: 1200 } });
  assert.ok(TILE_LOCAL_MS >= 30_000, 'the tile asks gently, not at the panel\'s 3 s');
});
