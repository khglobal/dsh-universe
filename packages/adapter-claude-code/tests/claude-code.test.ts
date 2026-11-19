import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformanceProblems } from '@dsh-universe/adapter-kit';
import { createStore, cumAt, errsAt, idxAt, stateAt, type UEvent } from '@dsh-universe/model';
import { IDS, MARKERS, CUSTOM_TITLE, appendClaudeTurn, seedLocalStores } from '../../../fixtures/local-stores.ts';
import { createClaudeCodeAdapter } from '../src/index.ts';

const noon = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); };

async function withStore(fn: (home: string, now: number) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'dshu-cc-'));
  try { const now = noon(); seedLocalStores(home, now, { codex: false, claudeApp: false, workbuddy: false }); await fn(home, now); } finally { rmSync(home, { recursive: true, force: true }); }
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
    // The watcher, or at the latest the next regular pass (which lists the store again), reads it.
    for (let i = 0; i < 150 && !got.some((e) => e.type === 'activity'); i++) await new Promise((r) => setTimeout(r, 100));
    off();
    const acts = got.filter((e) => e.type === 'activity');
    assert.equal(acts.length, 1, 'only the appended call is read, nothing earlier again');
    assert.equal(a.events().length, n0 + got.length);
    await a.stop();
  });
});

test('claude code: sessions the Claude app owns are left out, so each is counted once', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshu-cc-skip-'));
  try {
    const now = noon();
    seedLocalStores(home, now, { codex: false, workbuddy: false });
    const all = createClaudeCodeAdapter({ home, now: () => now });
    const roots = (s: Awaited<ReturnType<typeof all.snapshot>>) => s.events.filter((e) => e.type === 'agent' && 'kind' in e.data && e.data.kind === 'main').map((e) => (e.data as { id: string }).id);
    const without = roots(await all.snapshot(''));
    assert.ok(without.includes(IDS.codeTab), 'the Code-tab session is in Claude Code\'s own store');
    await all.stop();
    const skip = createClaudeCodeAdapter({ home, now: () => now, skip: () => new Set([IDS.codeTab]) });
    const kept = roots(await skip.snapshot(''));
    assert.ok(!kept.includes(IDS.codeTab), 'owned by the Claude app: left out');
    assert.ok(kept.includes(IDS.adopted), 'a terminal session the app only lists stays Claude Code\'s');
    assert.equal(kept.length, without.length - 1);
    assert.ok(kept.every((id) => id.startsWith('c0ffee01')));
    await skip.stop();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('claude code: a quiet open turn ends after 10 minutes with no call open, after 30 with one (a dead CLI is not Running for long)', async () => {
  const { claudeCodeReader, STALE_MS, IDLE_STALE_MS } = await import('../src/reader.ts');
  const r = claudeCodeReader('/nonexistent');
  const ends = (now: number, calls: [string, { t: number; name: string }][]) => {
    const out: unknown[] = [];
    const st = { agentId: 'a', sessionId: 's', announced: true, turnOpen: true, lastT: 0, calls: new Map(calls), usage: new Set<string>(), ended: new Set<string>() };
    r.settle!(st as Parameters<NonNullable<typeof r.settle>>[0], { dayStart: 0, now, emit: (e) => out.push(e), mark() {}, once: () => true });
    return out.length;
  };
  assert.equal(IDLE_STALE_MS, 10 * 60_000);
  assert.equal(ends(IDLE_STALE_MS - 1, []), 0);
  assert.equal(ends(IDLE_STALE_MS + 1, []), 1, 'no call open: stopped after 10 quiet minutes');
  assert.equal(ends(IDLE_STALE_MS + 1, [['c', { t: 0, name: 'Bash' }]]), 0, 'a long command may run quietly');
  assert.equal(ends(STALE_MS + 1, [['c', { t: 0, name: 'Bash' }]]), 1);
});
