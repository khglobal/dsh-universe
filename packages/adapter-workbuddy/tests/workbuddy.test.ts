// WorkBuddy's sessions: metadata only, with a marker in every content field of its store (messages, reasoning, tool
// arguments and results, error text, generated titles, the database, tasks, traces, settings).
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformanceProblems } from '@dsh-universe/adapter-kit';
import { createStore, cumAt, errsAt, idxAt, stateAt, type UEvent } from '@dsh-universe/model';
import { IDS, MARKERS, seedLocalStores } from '../../../fixtures/local-stores.ts';
import { createWorkBuddyAdapter, msTimeOf } from '../src/index.ts';

const noon = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); };
async function withStore(fn: (home: string, now: number) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'dshu-wb-'));
  try { const now = noon(); seedLocalStores(home, now, { claude: false, codex: false, claudeApp: false }); await fn(home, now); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('workbuddy: metadata only; no marker from any content field reaches the output', async () => {
  await withStore(async (home, now) => {
    const a = createWorkBuddyAdapter({ home, now: () => now });
    assert.equal((await a.detect()).present, true);
    const snap = await a.snapshot('');
    assert.ok(snap.events.length > 20);
    assert.deepEqual(conformanceProblems(snap.events, [...MARKERS, '/Users/', home]), []);
    await a.stop();
  });
});

test('workbuddy: sessions, subagents, calls, failures, tokens, models and state', async () => {
  await withStore(async (home, now) => {
    const a = createWorkBuddyAdapter({ home, now: () => now });
    const snap = await a.snapshot('');
    const st = createStore();
    st.applyAll(snap.events);
    const roots = st.agents().filter((s) => !s.agent.parentAgentId);
    assert.deepEqual(roots.map((s) => s.agent.id).sort(), [...IDS.workbuddy].sort(), "today's three sessions; the older one only counts in the totals");
    assert.ok(st.agents().every((s) => s.agent.engine === 'workbuddy'));
    const w1 = st.agent(IDS.workbuddy[0])!;
    assert.equal(idxAt(w1, now), 5);
    assert.equal(errsAt(w1, now), 2, 'a non-zero exit code and an error result');
    assert.equal(w1.ev[0].tool, 'Read');
    assert.equal(w1.ev[0].category, 'read');
    assert.equal(w1.agent.model, 'glm-5.2');
    assert.equal(stateAt(w1, now), 'done');
    assert.equal(cumAt(w1, now), [0, 1, 2, 3, 4, 9].reduce((n, i) => n + 3000 + i * 500 + 300 + i * 20, 0), 'prompt tokens less the cached part, plus output');
    const sub = st.agents().find((s) => s.agent.parentAgentId === w1.agent.id)!;
    assert.equal(sub.agent.role, 'Explore');
    assert.equal(sub.agent.kind, 'subagent');
    assert.equal(idxAt(sub, now), 2);
    const w2 = st.agent(IDS.workbuddy[1])!;
    assert.equal(stateAt(w2, now), 'running');
    assert.equal(w2.agent.model, 'kimi-k3-1');
    assert.equal(w2.ev.find((e) => e.tool === 'mcp__tapd__list')?.connectorId, 'tapd');
    assert.equal(stateAt(st.agent(IDS.workbuddy[2])!, now), 'failed');
    assert.deepEqual(st.workspaces().map((w) => w.title).sort(), ['docs-site', 'market-report']);
    assert.equal(snap.history?.reduce((n, d) => n + d.sessions, 0), 4);
    assert.equal(snap.history?.find((d) => d.sessions === 3)?.failed, 1);
    await a.stop();
  });
});

test('workbuddy: a finished reply ends the turn once quiet; appended lines are read once', async () => {
  await withStore(async (home, now) => {
    let clock = now;
    const a = createWorkBuddyAdapter({ home, now: () => clock });
    await a.snapshot('');
    const got: UEvent[] = [];
    const off = a.subscribe((e) => got.push(e));
    const dir = join(home, '.workbuddy', 'projects', readdirSync(join(home, '.workbuddy', 'projects')).find((d) => d.endsWith('docs-site'))!);
    const f = join(dir, IDS.workbuddy[2] + '.jsonl');
    const t = now - 60_000;
    appendFileSync(f, JSON.stringify({ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'LEAKMARK-prompt-a1' }], sessionId: IDS.workbuddy[2], timestamp: t }) + '\n');
    appendFileSync(f, JSON.stringify({ type: 'function_call', callId: 'live1', name: 'Grep', arguments: 'LEAKMARK-wbargs-k7', providerData: { model: 'glm-5.2', messageId: 'live' }, sessionId: IDS.workbuddy[2], timestamp: t + 1000 }) + '\n');
    appendFileSync(f, JSON.stringify({ type: 'function_call_result', callId: 'live1', status: 'completed', providerData: { toolResult: { content: ['LEAKMARK-toolresult-e5'] } }, sessionId: IDS.workbuddy[2], timestamp: t + 2000 }) + '\n');
    appendFileSync(f, JSON.stringify({ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'LEAKMARK-reply-b2' }], providerData: { messageId: 'live2' }, sessionId: IDS.workbuddy[2], timestamp: t + 3000 }) + '\n');
    for (let i = 0; i < 150 && !got.some((e) => e.type === 'turn' && e.data.phase === 'end'); i++) await new Promise((r) => setTimeout(r, 100));
    off();
    assert.equal(got.filter((e) => e.type === 'activity').length, 2, 'the new call, started and finished; nothing earlier again');
    const end = got.find((e) => e.type === 'turn' && e.data.phase === 'end');
    assert.ok(end && end.type === 'turn' && end.data.reason === 'completed' && end.data.t === t + 3000);
    assert.deepEqual(conformanceProblems(got, MARKERS), []);
    clock = now;
    await a.stop();
  });
});

test('workbuddy: times are read without parsing a line', () => {
  assert.equal(msTimeOf('{"type":"message","timestamp":1788331307666,"x":1}'), 1788331307666);
  assert.equal(msTimeOf('{"type":"message","timestamp":"2026"}'), undefined);
});
