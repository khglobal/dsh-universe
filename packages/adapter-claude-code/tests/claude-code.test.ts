import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformanceProblems } from '@dsh-universe/adapter-kit';
import { createStore, cumAt, errsAt, idxAt, stateAt, type UEvent } from '@dsh-universe/model';
import { MARKERS, CUSTOM_TITLE, appendClaudeTurn, seedLocalStores } from '../../../fixtures/local-stores.ts';
import { createClaudeCodeAdapter } from '../src/index.ts';

const noon = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); };

async function withStore(fn: (home: string, now: number) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'dshu-cc-'));
  try { const now = noon(); seedLocalStores(home, now, { codex: false }); await fn(home, now); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('claude code: metadata only; no marker from any content field reaches the output', async () => {
  await withStore(async (home, now) => {
    const a = createClaudeCodeAdapter({ home, now: () => now });
    assert.equal((await a.detect()).present, true);
    const snap = await a.snapshot('');
    assert.ok(snap.events.length > 40);
    assert.deepEqual(conformanceProblems(snap.events, [...MARKERS, '/work/']), []);
    const text = JSON.stringify(snap);
    for (const m of MARKERS) assert.ok(!text.includes(m), m);
    assert.ok(text.includes(CUSTOM_TITLE), 'the title the member set is the one text kept');
    await a.stop();
  });
});

test('claude code: sessions, subagents, calls, errors, tokens, waits and state', async () => {
  await withStore(async (home, now) => {
    const a = createClaudeCodeAdapter({ home, now: () => now });
    const snap = await a.snapshot('');
    const st = createStore();
    st.applyAll(snap.events);
    const roots = st.agents().filter((s) => !s.agent.parentAgentId);
    assert.equal(roots.length, 5, "today's five sessions; the older one only counts in the totals");
    assert.ok(st.agents().every((s) => s.agent.engine === 'claude-code'));
    const s1 = st.agent('c0ffee01-0000-4000-8000-000000000001')!;
    assert.equal(s1.agent.label, CUSTOM_TITLE);
    assert.equal(idxAt(s1, now), 6);
    assert.equal(errsAt(s1, now), 1);
    assert.equal(s1.ev[0].tool, 'Read');
    assert.equal(s1.ev[0].category, 'read');
    assert.ok((s1.ev[0].durationMs ?? 0) > 0);
    assert.equal(s1.usage.length, 7, 'a response written as three lines counts once');
    assert.equal(cumAt(s1, now), [0, 1, 2, 3, 4, 5].reduce((n, i) => n + 1200 + i * 300 + 300 + i * 40, 0) + 1400);
    assert.equal(stateAt(s1, now), 'done');
    const sub = st.agents().find((s) => s.agent.parentAgentId === s1.agent.id)!;
    assert.equal(sub.agent.role, 'Explore');
    assert.equal(sub.agent.kind, 'subagent');
    assert.equal(idxAt(sub, now), 3);
    const s3 = st.agent('c0ffee01-0000-4000-8000-000000000003')!;
    assert.equal(stateAt(s3, now), 'failed');
    assert.equal(s3.retries.length, 1);
    const s2 = st.agent('c0ffee01-0000-4000-8000-000000000002')!;
    assert.equal(stateAt(s2, now), 'running');
    assert.equal(s2.ev.find((e) => e.tool === 'mcp__linear__get_issue')?.connectorId, 'linear');
    const ws = st.workspaces();
    assert.deepEqual(ws.map((w) => w.title).sort(), ['billing-api', 'demo-app', 'docs-site']);
    assert.ok(ws.every((w) => /^p:[0-9a-f]{16}$/.test(w.id)));
    assert.ok(!st.agents().some((s) => s.usage.some((u) => u.model === '<synthetic>')), "Claude Code's own error notices are not a model");
    assert.equal(snap.history?.reduce((n, d) => n + d.sessions, 0), 6);
    assert.equal(snap.history?.find((d) => d.sessions === 5)?.failed, 1);
    await a.stop();
  });
});

test('claude code: incremental, live and bounded', async () => {
  await withStore(async (home, now) => {
    const a = createClaudeCodeAdapter({ home, now: () => now });
    await a.snapshot('');
    const n0 = a.events().length;
    const got: UEvent[] = [];
    const off = a.subscribe((e) => got.push(e));
    const dir = join(home, '.claude', 'projects', readdirSync(join(home, '.claude', 'projects')).find((d) => d.endsWith('demo-app'))!);
    appendClaudeTurn(join(dir, 'c0ffee01-0000-4000-8000-000000000002.jsonl'), 'c0ffee01-0000-4000-8000-000000000002', now - 1000, 'Grep');
    for (let i = 0; i < 60 && !got.some((e) => e.type === 'activity'); i++) await new Promise((r) => setTimeout(r, 100));
    off();
    const acts = got.filter((e) => e.type === 'activity');
    assert.equal(acts.length, 1, 'only the appended call is read, nothing earlier again');
    assert.equal(a.events().length, n0 + got.length);
    await a.stop();
  });
});
