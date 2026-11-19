import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.ts';
import { floorsOf } from '../src/floors.ts';
import { rng } from '../src/hash.ts';
import { CATEGORIES } from '../src/types.ts';
import { CAPS, agent, at, call, usage, M } from './helpers.ts';

test('floors of a session building match a naive count; only used floors appear', () => {
  const r = rng(3);
  const st = createStore();
  st.applyAll([agent('a', at(9)), agent('k', at(9), { parentAgentId: 'a', kind: 'subagent' })]);
  const counts: Record<string, number> = {};
  let tok = 0;
  const floor: Record<string, string> = { read: 'library', search: 'library', edit: 'workshop', exec: 'machine', delegate: 'meeting' };
  for (let i = 0; i < 200; i++) {
    const cat = (['read', 'search', 'edit', 'exec'] as const)[Math.floor(r() * 4)];
    const who = r() < 0.7 ? 'a' : 'k';
    st.apply(call(who, at(9) + i * M, cat));
    st.apply(usage(who, at(9) + i * M, 100, 10));
    counts[floor[cat]] = (counts[floor[cat]] ?? 0) + 1;
    tok += 110;
  }
  const fl = floorsOf(st, 'b:a', at(20), CAPS);
  assert.equal(fl[0].id, 'lobby');
  assert.equal(fl[0].n, 2);
  for (const id of ['library', 'workshop', 'machine']) assert.equal(fl.find((f) => f.id === id)?.n, counts[id], id);
  assert.equal(fl.find((f) => f.id === 'meeting'), undefined);
  const roof = fl.find((f) => f.id === 'roof')!;
  assert.equal(roof.n, tok);
  assert.equal(roof.unit, 'tokens');
});

test('a capability that is false marks its floor not provided', () => {
  const st = createStore();
  st.applyAll([agent('a', at(9)), call('a', at(9, 1), 'memory')]);
  assert.equal(floorsOf(st, 'library', at(10), CAPS)[0].na, true);
  assert.equal(floorsOf(st, 'library', at(10), { ...CAPS, memory: true })[0].na, false);
  assert.equal(floorsOf(st, 'station', at(10), { ...CAPS, schedules: false })[0].na, true);
  assert.equal(floorsOf(st, 'fire', at(10), CAPS).find((f) => f.id === 'retry')?.na, true);
});

test('connector floors are its tools with their call counts', () => {
  const st = createStore();
  st.applyAll([
    { type: 'connector', data: { id: 'erp', title: 'ERP', state: 'connected', tools: ['read_a', 'read_b'] } },
    agent('a', at(9)), call('a', at(9, 1), 'connector', 'read_a', { connectorId: 'erp' }), call('a', at(9, 2), 'connector', 'read_a', { connectorId: 'erp' }),
  ]);
  assert.deepEqual(floorsOf(st, 'conn:erp', at(10), CAPS).map((f) => [f.id, f.n]), [['read_a', 2], ['read_b', 0]]);
  void CATEGORIES;
});

test('town: the card count (rallyAt) equals the sum of the town floors, stops on an error included (#20)', async () => {
  const { rallyAt } = await import('../src/rally.ts');
  const { turn, wait } = await import('./helpers.ts');
  const st = createStore();
  st.applyAll([
    agent('w', at(9)), turn('w', at(9), 'start'), call('w', at(9, 1), 'read'), wait('w', 'q1', at(9, 5)),
    agent('e', at(9)), turn('e', at(9), 'start'), call('e', at(9, 1), 'exec', 'exec', { ok: false }), turn('e', at(9, 10), 'end', 'error'),
  ]);
  const T = at(9, 20);
  const card = rallyAt(st, T).length;
  const fl = floorsOf(st, 'town', T, CAPS);
  assert.equal(card, 2);
  assert.equal(fl.reduce((a, f) => a + (f.na ? 0 : f.n), 0), card);
  assert.equal(fl.find((f) => f.id === 'approval')?.n, 1);
  const post = fl.find((f) => f.id === 'post')!;
  assert.equal(post.n, 1);
  assert.equal(post.na, undefined);
  assert.deepEqual(post.agents, ['e']);
});
