import test from 'node:test';
import assert from 'node:assert/strict';
import { centrePick } from '../src/client/centre.ts';

test('centrePick: the place centred on the mark wins over a tower that reaches over it (#19)', () => {
  const academy = { id: 'school', r: [80, 80, 120, 120] as const };
  const tower = { id: 'b:s1', r: [90, 0, 130, 110] as const };   // in front, tall, its middle far above the mark
  assert.equal(centrePick([academy, tower], 100, 100), 'school');
  assert.equal(centrePick([tower, academy], 100, 100), 'school', 'draw order does not matter');
  // A small shop centred on the mark, in front of a tall building whose middle is lower down (the plugin row).
  const shop = { id: 'shop:charts', r: [672, 382, 768, 440] as const }, behind = { id: 'b:s8', r: [668, 366, 772, 536] as const };
  assert.equal(centrePick([shop, behind], 720, 422), 'shop:charts');
});

test('centrePick: people only when no place is under the mark; nothing when the mark is on empty ground', () => {
  const person = { id: 'agent:a', r: [95, 90, 105, 110] as const };
  const house = { id: 'b:s2', r: [60, 60, 140, 140] as const };
  assert.equal(centrePick([person, house], 100, 100), 'b:s2');
  assert.equal(centrePick([person], 100, 100), 'agent:a');
  assert.equal(centrePick([house], 10, 10), undefined);
});
