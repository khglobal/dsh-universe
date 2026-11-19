// Copy fixes from the 0.3.0 QA review (findings 14, 19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { en, zh } from '../src/locales/index.ts';
import { fill } from '../src/client/format.ts';

test('copy: English counts agree with their numbers (one failed call, one place, one car)', () => {
  assert.equal(fill(en['ls.errors'], { n: 1, p: 1, b: 0, r: 1 }), 'Errors: 1 failed call today at 1 place, 0 of them within the last 30 minutes; 1 model request retried.');
  assert.match(fill(en['ls.errors'], { n: 3, p: 2, b: 1, r: 0 }), /3 failed calls today at 2 places/);
  assert.match(fill(en['ls.calls'], { n: 1, c: 1 }), /1 call in the last 5 minutes, 1 car on/);
});

test('copy: the earlier-days heading says how many days it lists (13, today is above it)', () => {
  assert.match(en['li.days'], /13/);
  assert.match(zh['li.days'], /13/);
});

test('copy: the sound button explains itself under reduced motion, in both languages', () => {
  assert.ok(en['snd.rm'] && zh['snd.rm']);
});

test('copy: three cities found are "neighbouring cities", one is "a neighbouring city"', () => {
  assert.match(fill(en['nb.found'], { n: 3, name: 'Claude, ChatGPT and WorkBuddy' }), /shown as neighbouring cities\./);
  assert.match(fill(en['nb.found'], { n: 1, name: 'Claude' }), /shown as a neighbouring city\./);
});
