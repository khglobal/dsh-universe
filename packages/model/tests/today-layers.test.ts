import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.ts';
import { todayAt, nextIndex } from '../src/today.ts';
import { coloredSet, LAYERS } from '../src/layers.ts';
import { createSeen, seenKey, SEEN_MAX } from '../src/seen.ts';
import { listGroups } from '../src/list.ts';
import { agent, at, call, turn, usage, wait } from './helpers.ts';

function day() {
  const st = createStore();
  st.applyAll([
    agent('run1', at(9)), call('run1', at(9, 1), 'read'), usage('run1', at(9, 1), 1000, 100),
    agent('run2', at(10)), call('run2', at(10, 1), 'exec', 'bash', { ok: false }), usage('run2', at(10, 1), 500, 50, 'm2'),
    agent('kid', at(10, 2), { parentAgentId: 'run2', kind: 'subagent' }), call('kid', at(10, 3), 'edit'),
    agent('need', at(9)), wait('need', 'w', at(10)),
    agent('done', at(8)), turn('done', at(8), 'start'), call('done', at(8, 1), 'edit'), turn('done', at(8, 30), 'end', 'completed'),
    { type: 'deliverable', data: { t: at(8, 20), agentId: 'done', count: 2 } },
    agent('quiet', at(8)), turn('quiet', at(8, 1), 'start'), turn('quiet', at(8, 2), 'end', 'completed'),
    { type: 'schedule', data: { id: 'sch1', title: 'Daily', status: 'active', nextAt: at(15, 45), runs: [] } },
    { type: 'schedule', data: { id: 'sch0', title: 'Paused', status: 'paused', nextAt: at(11), runs: [] } },
  ]);
  return st;
}

test('today: six numbers match a naive count', () => {
  const t = todayAt(day(), at(11), 'dsh');
  assert.equal(t.need, 1);
  assert.equal(t.next?.scheduleId, 'sch1');
  assert.equal(t.running, 2, 'root sessions only');
  assert.equal(t.review, 2, 'option C: every finished, unseen session, deliverables or not');
  assert.equal(t.errors, 1);
  assert.equal(t.tokens, 1650);
  assert.deepEqual(t.items.need, ['need']);
  assert.deepEqual(t.items.run, ['run1', 'run2']);
  assert.deepEqual(t.items.err, ['b:run2']);
  assert.deepEqual(t.items.tok, ['model:m1', 'model:m2']);
});

test('today: each button steps through its items in a fixed order and wraps', () => {
  assert.equal(nextIndex(-1, 3), 0);
  assert.equal(nextIndex(0, 3), 1);
  assert.equal(nextIndex(2, 3), 0);
  assert.equal(nextIndex(0, 3, -1), 2);
  assert.equal(nextIndex(-1, 0), -1);
});

test('to review: completed and unseen counts, seen does not, new calls count again', () => {
  const st = day();
  const seen = createSeen();
  assert.equal(todayAt(st, at(11), 'dsh', seen).review, 2);
  seen.mark(seenKey('dsh', 'done', 1));
  seen.mark(seenKey('dsh', 'quiet', 0));
  assert.equal(todayAt(st, at(11), 'dsh', seen).review, 0);
  st.applyAll([turn('done', at(11, 1), 'start'), call('done', at(11, 2), 'read'), turn('done', at(11, 3), 'end', 'completed')]);
  assert.equal(todayAt(st, at(12), 'dsh', seen).review, 1);
  assert.equal(todayAt(st, at(11, 2), 'dsh', seen).review, 0, 'running again is not to review until the turn completes');
});

test('to review: a draft counts even when seen; a missing or failing draft service is no draft', () => {
  const st = day();
  const seen = createSeen();
  seen.mark(seenKey('dsh', 'done', 1));
  seen.mark(seenKey('dsh', 'quiet', 0));
  const drafts = { has: (id: string) => id === 'quiet' || id === 'run1' };
  const t = todayAt(st, at(11), 'dsh', seen, drafts);
  assert.equal(t.review, 2, 'quiet (seen, with a draft) and run1 (running, with a draft)');
  assert.deepEqual(new Set(t.items.review), new Set(['quiet', 'run1']));
  assert.equal(todayAt(st, at(11), 'dsh', seen, undefined).review, 0);
  assert.doesNotThrow(() => todayAt(st, at(11), 'dsh', seen, { has() { throw new Error('gone'); } }));
  assert.equal(todayAt(st, at(11), 'dsh', seen, { has() { throw new Error('gone'); } }).review, 0);
  assert.ok(coloredSet('review', st, at(11), 'dsh', seen, drafts)!.has('b:quiet'));
  assert.ok(listGroups(st, at(11), 'dsh', seen, drafts).find((g) => g.id === 'review')!.rows.some((s) => s.agent.id === 'quiet'));
});

test('to review: the seen record holds keys only (city, session id, call count), no text', () => {
  let stored = '';
  const seen = createSeen({ read: () => stored, write: (v) => { stored = v; } });
  seen.mark(seenKey('dsh', 'done', 1));
  assert.deepEqual(JSON.parse(stored), ['dsh:done:1']);
});

test('seen: storage that throws or holds rubbish counts everything as not seen, and never throws', () => {
  const broken = createSeen({ read() { throw new Error('denied'); }, write() { throw new Error('denied'); } });
  assert.equal(broken.has('x'), false);
  assert.equal(broken.mark('x'), true);
  assert.equal(createSeen({ read: () => '{not json', write() {} }).size(), 0);
  let stored = '';
  const s = createSeen({ read: () => stored, write: (v) => { stored = v; } });
  for (let i = 0; i < SEEN_MAX + 20; i++) s.mark('k' + i);
  assert.equal(s.size(), SEEN_MAX);
  assert.equal(JSON.parse(stored).length, SEEN_MAX);
  assert.equal(s.has('k0'), false);
});

test('layers: the agents in the square keep their colour in every layer; all greys nothing', () => {
  const st = day();
  assert.equal(coloredSet('all', st, at(11), 'dsh'), null);
  for (const L of LAYERS.filter((l) => l !== 'all')) assert.ok(coloredSet(L, st, at(11), 'dsh')!.has('need'), L);
  assert.ok(coloredSet('errors', st, at(11), 'dsh')!.has('b:run2'));
  assert.ok(!coloredSet('errors', st, at(11), 'dsh')!.has('b:run1'));
  assert.ok(coloredSet('running', st, at(11), 'dsh')!.has('b:run1'));
  assert.ok(coloredSet('review', st, at(11), 'dsh')!.has('b:done'));
  assert.ok(coloredSet('tokens', st, at(11), 'dsh')!.has('model:m2'));
  assert.ok(coloredSet('calls', st, at(10, 4), 'dsh')!.has('b:run2'));
  assert.ok(!coloredSet('calls', st, at(11), 'dsh')!.has('b:run2'));
});

test('list: needs you first; subagents follow their parent', () => {
  const g = listGroups(day(), at(11), 'dsh');
  assert.equal(g[0].id, 'need');
  assert.deepEqual(g[0].rows.map((s) => s.agent.id), ['need']);
  assert.deepEqual(g.find((x) => x.id === 'running')!.rows.map((s) => s.agent.id), ['run2', 'kid', 'run1']);
  assert.deepEqual(g.find((x) => x.id === 'review')!.rows.map((s) => s.agent.id), ['done', 'quiet']);
  const seen = createSeen();
  seen.mark(seenKey('dsh', 'quiet', 0));
  assert.deepEqual(listGroups(day(), at(11), 'dsh', seen).find((x) => x.id === 'done')!.rows.map((s) => s.agent.id), ['quiet'], 'seen → back among the finished');
});

test('running: a session whose main turn ended while its subagents still work counts as running, in the bar and the list alike (QA finding 6)', async () => {
  const { createStore: cs, listGroups: lg, todayAt: ta, runningRoots } = await import('../src/index.ts');
  const st = cs();
  const T0 = new Date(2026, 10, 18, 10).getTime(), m = 60_000;
  st.applyAll([
    { type: 'agent', data: { id: 'p', sessionId: 'p', workspaceId: 'w', label: '', kind: 'main', state: 'running', startedAt: T0 } },
    { type: 'turn', data: { t: T0, agentId: 'p', phase: 'start' } },
    { type: 'turn', data: { t: T0 + 5 * m, agentId: 'p', phase: 'end', reason: 'completed' } },
    { type: 'agent', data: { id: 'k1', sessionId: 'k1', parentAgentId: 'p', workspaceId: 'w', label: '', kind: 'subagent', state: 'running', startedAt: T0 + m } },
    { type: 'turn', data: { t: T0 + m, agentId: 'k1', phase: 'start' } },
    { type: 'agent', data: { id: 'k2', sessionId: 'k2', parentAgentId: 'p', workspaceId: 'w', label: '', kind: 'subagent', state: 'running', startedAt: T0 + m } },
    { type: 'turn', data: { t: T0 + m, agentId: 'k2', phase: 'start' } },
    { type: 'agent', data: { id: 'q', sessionId: 'q', workspaceId: 'w', label: '', kind: 'main', state: 'running', startedAt: T0 } },
    { type: 'turn', data: { t: T0, agentId: 'q', phase: 'start' } },
    { type: 'turn', data: { t: T0 + 2 * m, agentId: 'q', phase: 'end', reason: 'completed' } },
  ]);
  const T = T0 + 10 * m;
  assert.deepEqual([...runningRoots(st, T)], ['p']);
  const t = ta(st, T, 'dsh');
  assert.equal(t.running, 1);
  assert.deepEqual(t.items.run, ['p']);
  const run = lg(st, T, 'dsh').find((g) => g.id === 'running')!.rows.map((s) => s.agent.id);
  assert.deepEqual(run, ['p', 'k1', 'k2'], 'the session and its working subagents, together');
  assert.ok(!lg(st, T, 'dsh').find((g) => g.id === 'done')!.rows.some((s) => s.agent.id === 'p'));
});

test('looking back (QA finding 13): the next scheduled run at T is the first run after T, not the next one from now', async () => {
  const { createStore: cs, todayAt: ta } = await import('../src/index.ts');
  const st = cs();
  const h = (x: number) => new Date(2026, 10, 18, x).getTime();
  st.applyAll([
    { type: 'schedule', data: { id: 'a', title: 'Morning report', status: 'active', nextAt: h(15) + 45 * 60_000, runs: [{ at: h(8) + 30 * 60_000 }, { at: h(9) }] } },
  ]);
  assert.equal(ta(st, h(6), 'dsh').next?.at, h(8) + 30 * 60_000, 'at 06:00 the 08:30 run was next');
  assert.equal(ta(st, h(8) + 45 * 60_000, 'dsh').next?.at, h(9));
  assert.equal(ta(st, h(12), 'dsh').next?.at, h(15) + 45 * 60_000, 'live: the planned next run');
});
