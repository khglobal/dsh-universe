// Runs delegated to Claude Code and Codex (official dsh-subagent-claude-code / dsh-subagent-codex 0.2.2-rc.2):
// what DSH exposes about them becomes an engine agent in the parent's building; the task and the answer never do.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conformanceProblems } from '@dsh-universe/adapter-kit';
import { createStore, stateAt, type UEvent } from '@dsh-universe/model';
import { createAggregator, dshCategories, engineOfProvider } from '../src/index.ts';

const T0 = new Date(2026, 10, 19, 9, 0).getTime();
const TASK = 'SECRET-TASK-DESCRIPTION refactor the payroll module';
const ANSWER = 'SECRET-ENGINE-ANSWER the module is done';
const ARGS = 'SECRET-ARGS {"prompt":"do it"}';
const ses = { id: 'p1', header: { createdAt: T0, cwd: '/Users/me/secret-project' } };
const ev = (type: string, min: number, data: unknown, seq = min) => ({ type, seq, time: T0 + min * 60_000, data });

function run(now = T0 + 30 * 60_000) {
  const a = createAggregator({ categories: dshCategories(), workspaceOf: () => 'w1', now: () => now });
  const out: UEvent[] = [];
  out.push(...a.event(ses, ev('turn/start', 0, {})));
  // Claude Code: the call, the catalog entry naming the child, then a successful result.
  out.push(...a.event(ses, ev('tool/call', 1, { name: 'subagent_claude_code', callId: 'c1', arguments: ARGS, description: TASK })));
  out.push(...a.event(ses, ev('subagent/catalog', 1, { version: 3, childId: 'cc-run', childCreatedAt: T0 + 61_000, mode: 'external', label: TASK, name: 'claude-1' })));
  out.push(...a.event(ses, ev('tool/result', 9, { message: { toolCallId: 'c1', content: [{ type: 'text', text: ANSWER }] } })));
  // Codex: a run that fails.
  out.push(...a.event(ses, ev('tool/call', 10, { name: 'subagent_codex', callId: 'c2', arguments: ARGS })));
  out.push(...a.event(ses, ev('subagent/catalog', 10, { version: 3, childId: 'cx-run', childCreatedAt: T0 + 600_000, mode: 'external', label: TASK, name: 'codex-1' })));
  out.push(...a.event(ses, ev('tool/result', 12, { message: { toolCallId: 'c2', isError: true, content: [{ type: 'text', text: ANSWER }] } })));
  // A third run still going, seen through the host lifecycle events only.
  out.push(...a.subagent({ runId: 'r3', provider: 'claude-code', parentSessionId: 'p1', id: 'cc-live', local: false }));
  return { a, out };
}

test('engine runs: one agent per run in the parent building, with its engine, start, end and outcome', () => {
  const { out } = run();
  const st = createStore();
  st.applyAll(out);
  const cc = st.agent('cc-run')!, cx = st.agent('cx-run')!, live = st.agent('cc-live')!;
  assert.equal(cc.agent.engine, 'claude-code');
  assert.equal(cc.agent.parentAgentId, 'p1');
  assert.equal(cc.agent.kind, 'subagent');
  assert.equal(cc.agent.workspaceId, 'w1');
  assert.equal(cc.agent.startedAt, T0 + 61_000);
  assert.equal(stateAt(cc, T0 + 5 * 60_000), 'running');
  assert.equal(stateAt(cc, T0 + 20 * 60_000), 'done');
  assert.equal(cx.agent.engine, 'codex');
  assert.equal(stateAt(cx, T0 + 20 * 60_000), 'failed', 'a failed call is a failed run');
  assert.equal(live.agent.engine, 'claude-code');
  assert.equal(stateAt(live, T0 + 40 * 60_000), 'running');
  // The delegation itself is a call of the parent, counted under delegate, with its error flag.
  const p = st.agent('p1')!;
  assert.deepEqual(p.ev.map((e) => [e.tool, e.category, e.ok]), [['subagent_claude_code', 'delegate', true], ['subagent_codex', 'delegate', false]]);
});

test('engine runs: the host end event settles a run once; its answer is never read', () => {
  const { a, out } = run();
  const end = a.subagentEnd({ runId: 'r3', provider: 'claude-code', parentSessionId: 'p1', id: 'cc-live', local: false, stopReason: 'error', lastAssistantMessage: [{ type: 'text', text: ANSWER }] });
  assert.equal(end.length, 1);
  assert.deepEqual(a.subagentEnd({ id: 'cc-live', local: false, stopReason: 'completed' }), [], 'only once');
  assert.deepEqual(a.subagentEnd({ id: 'local-kid', local: true, stopReason: 'completed' }), [], 'local subagents end through their own session');
  const st = createStore();
  st.applyAll([...out, ...end]);
  assert.equal(stateAt(st.agent('cc-live')!, T0 + 40 * 60_000), 'failed');
  assert.deepEqual(conformanceProblems([...out, ...end], [TASK, ANSWER, ARGS, 'secret-project', '/Users/me']), []);
});

test('engine runs: provider names map to engines; a local child keeps the old partial update', () => {
  assert.equal(engineOfProvider('claude-code'), 'claude-code');
  assert.equal(engineOfProvider('my-codex'), 'codex');
  assert.equal(engineOfProvider('spawn'), undefined);
  const a = createAggregator({ categories: dshCategories(), workspaceOf: () => 'w1', now: () => T0 });
  assert.deepEqual(a.subagent({ id: 'k', parentSessionId: 'p1', provider: 'spawn', local: true }), [{ type: 'agent', data: { id: 'k', parentAgentId: 'p1', kind: 'subagent' } }]);
  // An external run of an unknown provider is still a subagent, without an engine.
  const [e] = a.subagent({ id: 'x', parentSessionId: 'p1', provider: 'acp', local: false });
  assert.equal(e.type, 'agent');
  assert.equal((e.data as { engine?: string }).engine, undefined);
});
