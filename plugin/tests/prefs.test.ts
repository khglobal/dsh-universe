import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PREFS, PREFS_KEY, isNight, nextLight, readPrefs, writePrefs } from '../src/client/prefs.ts';

test('prefs: the legend starts closed, the timeline open, the city shown, the sound off; storage failures fall back', () => {
  assert.deepEqual(DEFAULT_PREFS, { legend: false, dockMin: false, view: 'city', sound: false, toured: false, light: 'auto', neighbours: {} });
  assert.deepEqual(readPrefs(undefined), DEFAULT_PREFS);
  assert.deepEqual(readPrefs({ getItem: () => { throw new Error('denied'); } }), DEFAULT_PREFS);
  assert.deepEqual(readPrefs({ getItem: () => '{not json' }), DEFAULT_PREFS);
  const mem = new Map<string, string>();
  writePrefs({ legend: true, dockMin: true, view: 'list', sound: true, toured: true, light: 'night', neighbours: { 'claude-code': true, codex: false } }, { setItem: (k, v) => { mem.set(k, v); } });
  assert.deepEqual(readPrefs({ getItem: (k) => mem.get(k) ?? null }), { legend: true, dockMin: true, view: 'list', sound: true, toured: true, light: 'night', neighbours: { 'claude-code': true, codex: false } });
  assert.ok(PREFS_KEY.startsWith('khglobal-dsh-universe'));
  assert.doesNotThrow(() => writePrefs(DEFAULT_PREFS, { setItem: () => { throw new Error('full'); } }));
});

test('extensions: place views and overlays register and unregister', async () => {
  const { registerPlaceView, placeViewFor, registerOverlay, overlayFactories } = await import('../src/client/extensions.ts');
  const off = registerPlaceView({ id: 'x', matches: (id) => id.startsWith('b:'), Component: () => null });
  assert.equal(placeViewFor('b:s1')?.id, 'x');
  assert.equal(placeViewFor('town'), undefined);
  off();
  assert.equal(placeViewFor('b:s1'), undefined);
  const n = overlayFactories().length;
  const off2 = registerOverlay(() => ({ id: 'o' }));
  assert.equal(overlayFactories().length, n + 1);
  off2();
  assert.equal(overlayFactories().length, n);
});

test('layer buttons and the legend use plain names from the locale tables', async () => {
  const { zh } = await import('../src/locales/zh.ts');
  const { en } = await import('../src/locales/en.ts');
  const { LAYERS } = await import('@dsh-universe/model');
  const key: Record<string, string> = { all: 'ly.all', scheduled: 'ly.scheduled', running: 'ly.running', review: 'ly.review', errors: 'ly.errors', tokens: 'ly.tokens', calls: 'ly.calls' };
  for (const l of LAYERS) { assert.ok((zh as Record<string, string>)[key[l]], l); assert.ok((en as Record<string, string>)[key[l]], l); }
  assert.equal((zh as Record<string, string>)['ly.tokens'], 'token 用量');
  assert.equal((en as Record<string, string>)['ly.tokens'], 'Token use');
});

test('first-run tour: four steps in order, once per device, ends on done or skip, no inline text', async () => {
  const { TOUR, tourStep } = await import('../src/client/tour.ts');
  const { zh } = await import('../src/locales/zh.ts');
  const { en } = await import('../src/locales/en.ts');
  assert.deepEqual(TOUR.map((s) => s.id), ['today', 'layers', 'square', 'building']);
  for (const s of TOUR) for (const k of [s.title, s.text]) { assert.ok((zh as Record<string, string>)[k], k); assert.ok((en as Record<string, string>)[k], k); }
  assert.equal(tourStep(0, 'next'), 1);
  assert.equal(tourStep(0, 'back'), 0);
  assert.equal(tourStep(2, 'back'), 1);
  assert.equal(tourStep(TOUR.length - 1, 'next'), null, 'done after the last step');
  assert.equal(tourStep(1, 'close'), null, 'skip or Esc ends it at once');
  assert.equal(DEFAULT_PREFS.toured, false, 'shown on the first open');
  const mem = new Map<string, string>();
  writePrefs({ ...DEFAULT_PREFS, toured: true }, { setItem: (k, v) => { mem.set(k, v); } });
  assert.equal(readPrefs({ getItem: (k) => mem.get(k) ?? null }).toured, true, 'not again on this device');
  assert.equal(readPrefs({ getItem: () => { throw new Error('denied'); } }).toured, false, 'unreadable storage: shown (and dismissible)');
});

test('day and night: auto follows the host theme (dark is night); day and night override it; kept per device', () => {
  // auto
  assert.equal(isNight('auto', false), false, 'auto on a light host: day');
  assert.equal(isNight('auto', true), true, 'auto on a dark host: night');
  assert.equal(isNight(undefined, true), true, 'no choice yet is auto');
  // day
  assert.equal(isNight('day', true), false, 'day on a dark host stays day');
  assert.equal(isNight('day', false), false);
  // night
  assert.equal(isNight('night', false), true, 'night on a light host stays night');
  assert.equal(isNight('night', true), true);
  // The button cycles through the three.
  assert.deepEqual([nextLight('auto'), nextLight('day'), nextLight('night')], ['day', 'night', 'auto']);
  // Stored per device; anything unknown reads as auto.
  for (const light of ['auto', 'day', 'night'] as const) {
    const mem = new Map<string, string>();
    writePrefs({ ...DEFAULT_PREFS, light }, { setItem: (k, v) => { mem.set(k, v); } });
    assert.equal(readPrefs({ getItem: (k) => mem.get(k) ?? null }).light, light);
  }
  assert.equal(readPrefs({ getItem: () => JSON.stringify({ light: 'dusk' }) }).light, 'auto');
});
