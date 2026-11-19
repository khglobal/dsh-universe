import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.ts';
import { dayKey, dayStart } from '../src/history.ts';
import { daySpan, waitBands } from '../src/timeline.ts';
import { listGroups } from '../src/list.ts';
import { runningRoots, sessionStateAt, todayAt } from '../src/today.ts';
import { agent, at, call, turn, usage, wait, H, M } from './helpers.ts';

// A day that starts at at(0) (midnight). The session `a` was carried over from yesterday whole: its subagent `k`
// finished yesterday, and yesterday it made failed calls and used tokens.
function carried() {
  const st = createStore();
  st.applyAll([
    agent('a', at(0) - 3 * H), turn('a', at(0) - 3 * H, 'start'),
    call('a', at(0) - 2 * H, 'exec', 'exec', { ok: false }), call('a', at(0) - H, 'exec', 'exec', { ok: false }),
    usage('a', at(0) - H, 1_000_000, 900_000),
    agent('k', at(0) - 2 * H, { parentAgentId: 'a', kind: 'subagent', state: 'done', endedAt: at(0) - 30 * M }),
    call('a', at(0, 5), 'edit', 'edit', { ok: false }), usage('a', at(0, 5), 100, 20),
  ]);
  return st;
}

test('today counts only from the start of the day; carried-over sessions keep everything else (#26)', () => {
  const st = carried(), T = at(0, 10), from = at(0);
  const all = todayAt(st, T, 'c');
  assert.equal(all.errors, 3);
  const today = todayAt(st, T, 'c', undefined, undefined, from);
  assert.equal(today.errors, 1);
  assert.equal(today.tokens, 120);
  assert.equal(today.running, 1, 'the carried-over session still runs');
  // Just after midnight with nothing done yet: zero.
  const early = todayAt(st, at(0, 0, 8), 'c', undefined, undefined, from);
  assert.equal(early.errors, 0);
  assert.equal(early.tokens, 0);
  assert.deepEqual(early.items.tok, []);
  assert.deepEqual(early.items.err, []);
  // The subagent that finished yesterday is not "finished today"; without a day start it still is.
  assert.deepEqual(listGroups(st, T, 'c', undefined, undefined, from).find((g) => g.id === 'done')!.rows.map((s) => s.agent.id), []);
  assert.deepEqual(listGroups(st, T, 'c').find((g) => g.id === 'done')!.rows.map((s) => s.agent.id), ['k']);
});

test('a session counted as running has the running building state (#27)', () => {
  const st = createStore();
  st.applyAll([
    agent('a', at(9)), turn('a', at(9), 'start'), turn('a', at(9, 5), 'end', 'completed'),
    agent('k', at(9, 1), { parentAgentId: 'a', kind: 'subagent' }), turn('k', at(9, 1), 'start'),
    agent('w', at(9)), turn('w', at(9), 'start'), agent('wk', at(9, 1), { parentAgentId: 'w', kind: 'subagent' }), turn('wk', at(9, 1), 'start'), wait('w', 'x', at(9, 3)),
  ]);
  const T = at(9, 10), fam = (id: string) => st.agents().filter((s) => s.agent.id === id || s.agent.parentAgentId === id);
  assert.ok(runningRoots(st, T).has('a'));
  assert.equal(sessionStateAt(st.agent('a')!, fam('a'), T), 'running');
  assert.equal(sessionStateAt(st.agent('w')!, fam('w'), T), 'waiting', 'waiting for the member wins');
  st.apply(turn('k', at(9, 20), 'end', 'completed'));
  assert.equal(sessionStateAt(st.agent('a')!, fam('a'), at(9, 30)), 'done');
  assert.ok(!runningRoots(st, at(9, 30)).has('a'));
});

test('host day boundaries with a fixed UTC offset do not depend on the viewer (#21)', () => {
  // 2026-11-18 17:30 UTC is 2026-11-19 01:30 in UTC+8 and 09:30 in UTC-8.
  const t = Date.UTC(2026, 10, 18, 17, 30);
  assert.equal(dayKey(t, 480), '2026-11-19');
  assert.equal(dayStart(t, 480), Date.UTC(2026, 10, 18, 16));
  assert.equal(dayKey(t, -480), '2026-11-18');
  assert.equal(dayStart(t, -480), Date.UTC(2026, 10, 18, 8));
  assert.equal(dayStart(t, 330), Date.UTC(2026, 10, 18, 18, 30) - 24 * H);
  const st = createStore();
  const [a] = daySpan(st, t, 480);
  assert.ok(a >= dayStart(t, 480) && a <= t, 'the axis starts within the host day');
  st.applyAll([agent('a', t - 3 * H), turn('a', t - 3 * H, 'start'), wait('a', 'q', t - 2 * H)]);
  assert.equal(waitBands(st, t, 480)[0].from, dayStart(t, 480), 'a wait from before the host midnight is cut there');
});
