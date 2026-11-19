import test from 'node:test';
import assert from 'node:assert/strict';
import { dismissal, type Holder } from '../src/client/popover.ts';
import { readPrefs, writePrefs, DEFAULT_PREFS } from '../src/client/prefs.ts';

// Plain objects standing in for DOM nodes: each holder contains itself and the nodes listed.
const node = (name: string) => ({ name });
const holder = (...inside: object[]): Holder & object => { const h: Holder & object = { contains: (n: unknown) => n === h || inside.includes(n as object) }; return h; };
const checkbox = node('checkbox'), close = node('close'), sign = node('city sign'), canvas = node('canvas'), label = node('button label');
const panel = holder(checkbox, close), trigger = holder(label);

test('popover: Esc closes it and gives focus back to its button', () => {
  assert.deepEqual(dismissal({ type: 'keydown', key: 'Escape' }, panel, trigger), { focusTrigger: true });
  assert.equal(dismissal({ type: 'keydown', key: 'Enter' }, panel, trigger), null);
  assert.equal(dismissal({ type: 'keydown', key: 'Tab' }, panel, trigger), null);
});

test('popover: a click anywhere else closes it (the city sign beside it, the city), without moving focus', () => {
  assert.deepEqual(dismissal({ type: 'pointerdown', target: sign }, panel, trigger), { focusTrigger: false });
  assert.deepEqual(dismissal({ type: 'pointerdown', target: canvas }, panel, trigger), { focusTrigger: false });
});

test('popover: a click inside it (a checkbox) keeps it open; its button is left to toggle it', () => {
  assert.equal(dismissal({ type: 'pointerdown', target: checkbox }, panel, trigger), null);
  assert.equal(dismissal({ type: 'pointerdown', target: panel }, panel, trigger), null);
  assert.equal(dismissal({ type: 'pointerdown', target: label }, panel, trigger), null);
  assert.equal(dismissal({ type: 'pointerdown', target: trigger }, panel, trigger), null);
});

test('popover: with its elements gone (unmounted), any click closes it', () => {
  assert.deepEqual(dismissal({ type: 'pointerdown', target: checkbox }, null, null), { focusTrigger: false });
});

test('popover: no open state is ever stored, and a stray stored flag is dropped on reload', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFS, toured: true, settingsOpen: true, nbSettings: true, settings: true, popover: 'claude-code' });
  const p = readPrefs({ getItem: () => stored });
  assert.deepEqual(Object.keys(p).sort(), Object.keys(DEFAULT_PREFS).sort());
  let out = '';
  writePrefs(p, { setItem: (_k, v) => { out = v; } });
  assert.doesNotMatch(out, /settings|popover/i);
  assert.equal(JSON.parse(out).toured, true);
});
