// Idle cost (#29): the calm frame rate, and the live clock moving on without a frame of its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cityTemplate, createStore, emptyPlacement, place, type UEvent } from '@dsh-universe/model';
import { AMBIENT_FPS, CALM_FPS, BLURRED_FPS, CityView, createStubKit, drawTextLayer, frameGap, type PageState } from '../src/index.ts';
import { fakeSurface } from './fake-canvas.ts';

const DAY = new Date(2026, 10, 18).getTime();
const at = (h: number, m = 0) => DAY + (h * 60 + m) * 60_000;

test('pace: left alone the ambient life paints twice a second, between the focused and the blurred rates', () => {
  assert.equal(CALM_FPS, 2);
  assert.equal(frameGap({ urgent: false, ambient: true, reducedMotion: false, blurred: false, calm: true }), 500);
  assert.equal(frameGap({ urgent: false, ambient: true, reducedMotion: false, blurred: false }), 1000 / AMBIENT_FPS);
  assert.equal(frameGap({ urgent: false, ambient: true, reducedMotion: false, blurred: true, calm: true }), 1000 / BLURRED_FPS);
  assert.ok(BLURRED_FPS < CALM_FPS && CALM_FPS < AMBIENT_FPS);
});

/** A running city (one session at work: cranes turn, so the ambient life moves) with injected frames and clock. */
function city(calm: boolean) {
  const ev: UEvent[] = [{ type: 'workspace', data: { id: 'w1', title: 'Finance', displayPath: 'fin' } },
    { type: 'agent', data: { id: 's1', sessionId: 's1', workspaceId: 'w1', label: '', kind: 'main', state: 'running', startedAt: at(9) } },
    { type: 'turn', data: { t: at(9), agentId: 's1', phase: 'start' } }];
  for (let k = 0; k < 40; k++) ev.push({ type: 'activity', data: { id: 'a' + k, t: at(9) + k * 1000, agentId: 's1', category: 'edit', tool: 'edit' } });
  const store = createStore(); store.applyAll(ev);
  const placement = place(cityTemplate(), emptyPlacement(), [{ sessionId: 's1', workspaceId: 'w1', startedAt: at(9) }]).state;
  let now = 0;
  const frames: ((t: number) => void)[] = [], timers: { fn: () => void; at: number }[] = [];
  const page: PageState = { hidden: () => false, blurred: () => false, idleFor: () => (calm ? 60_000 : 0), subscribe: () => () => {} };
  const cv = fakeSurface(10, 10);
  const view = new CityView({
    kit: createStubKit(fakeSurface), canvas: { width: 0, height: 0, getContext: () => cv.ctx } as never, reducedMotion: () => false,
    raf: (fn) => { frames.push(fn); return frames.length; }, cancelRaf: () => {}, clock: () => now, page,
    timeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; }, clearTimeout: () => {},
    artBuffer: () => { const s = fakeSurface(2, 2); return { canvas: { width: 2, height: 2 }, ctx: s.ctx as never }; }, surfaces: fakeSurface as never,
  });
  view.resize(800, 600, 1);
  const input = (T: number) => ({ store, placement, T, live: true, templateTags: [[]], names: { town: 'T', station: 'S', fire: 'F', school: 'K', library: 'L' } });
  /** Runs the clock to `t`, firing timers and display frames as they come due. */
  const run = (t: number) => {
    while (now < t) {
      now = Math.min(t, now + 4);
      for (const x of timers.splice(0).filter((x) => { if (x.at <= now) return true; timers.push(x); return false; })) x.fn();
      if (frames.length) for (const f of frames.splice(0)) f(now);
    }
  };
  return { view, input, run, frames: () => view.stats().frames, now: () => now };
}

test('pace: the live clock moving on (same data, once a second) adds no frame to a city left alone', () => {
  const c = city(true);
  c.view.setInput(c.input(at(10)));
  c.view.start();
  c.run(2000);
  const f0 = c.frames();
  for (let s = 1; s <= 10; s++) { c.view.setInput(c.input(at(10) + s * 1000), true); c.run(2000 + s * 1000); }
  const n = c.frames() - f0;
  assert.ok(n >= 18 && n <= 21, `${n} frames in 10 s at CALM_FPS 2`);
});

test('pace: new data is painted at once even while calm', () => {
  const c = city(true);
  c.view.setInput(c.input(at(10)));
  c.view.start();
  c.run(2000);
  const f0 = c.frames();
  c.view.setInput(c.input(at(10) + 1000));
  c.run(c.now() + 20);
  assert.equal(c.frames() - f0, 1, 'one frame within 20 ms');
});

test('text layer: reports the plates it drew with their depth (names never), for cutting moving things out later', () => {
  const s = fakeSurface(800, 400);
  const plates: { r: [number, number, number, number]; depth: number }[] = [];
  drawTextLayer(s.ctx as never, [
    { x: 200, y: 200, text: 'Plate', bg: '#FFFFFF', fg: '#141A30', small: true, depth: 7 },
    { x: 500, y: 200, text: 'Name', bg: '#FFC928', fg: '#141A30', small: false, depth: 3, name: true },
  ], [], 1, 1, undefined, [], plates);
  assert.equal(plates.length, 1);
  assert.equal(plates[0].depth, 7);
  assert.ok(plates[0].r[0] < 200 && plates[0].r[2] > 200);
});
