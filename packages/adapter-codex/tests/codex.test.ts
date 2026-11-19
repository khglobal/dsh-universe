import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformanceProblems } from '@dsh-universe/adapter-kit';
import { createStore, cumAt, errsAt, idxAt, stateAt } from '@dsh-universe/model';
import { MARKERS, seedLocalStores } from '../../../fixtures/local-stores.ts';
import { createCodexAdapter, CODEX_TOOLS } from '../src/index.ts';

const noon = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); };
async function withStore(fn: (home: string, now: number) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'dshu-cx-'));
  try { const now = noon(); seedLocalStores(home, now, { claude: false }); await fn(home, now); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('codex: metadata only; no marker from any content field reaches the output', async () => {
  await withStore(async (home, now) => {
    const a = createCodexAdapter({ home, now: () => now });
    assert.equal((await a.detect()).present, true);
    const snap = await a.snapshot('');
    assert.ok(snap.events.length > 20);
    assert.deepEqual(conformanceProblems(snap.events, [...MARKERS, '/work/']), []);
    const text = JSON.stringify(snap);
    for (const m of MARKERS) assert.ok(!text.includes(m), m);
    await a.stop();
  });
});

test('codex: threads, spawned subagents, calls, exit codes, tokens and state', async () => {
  await withStore(async (home, now) => {
    const a = createCodexAdapter({ home, now: () => now });
    const snap = await a.snapshot('');
    const st = createStore();
    st.applyAll(snap.events);
    assert.equal(st.agents().filter((s) => !s.agent.parentAgentId).length, 3);
    assert.ok(st.agents().every((s) => s.agent.engine === 'codex' && s.agent.label === ''), 'no titles: named by folder and day');
    const t1 = st.agent('0a11ce00-0000-4000-8000-000000000001')!;
    assert.equal(idxAt(t1, now), 4);
    assert.equal(errsAt(t1, now), 1, 'a non-zero exit code is a failed call');
    assert.deepEqual(t1.ev.map((e) => e.category), ['exec', 'exec', 'edit', 'exec']);
    assert.equal(t1.agent.model, 'gpt-5-codex');
    assert.equal(cumAt(t1, now), [0, 1, 2, 3].reduce((n, i) => n + (3000 + i * 500 - 1500) + 250, 0));
    assert.equal(stateAt(t1, now), 'done');
    assert.equal(stateAt(st.agent('0a11ce00-0000-4000-8000-000000000003')!, now), 'failed');
    assert.equal(stateAt(st.agent('0a11ce00-0000-4000-8000-000000000002')!, now), 'running');
    const kid = st.agent('0a11ce00-0000-4000-8000-000000000004')!;
    assert.equal(kid.agent.parentAgentId, '0a11ce00-0000-4000-8000-000000000002');
    assert.equal(kid.agent.role, 'worker');
    assert.equal(st.agent('0a11ce00-0000-4000-8000-000000000002')!.ev.find((e) => e.tool === 'linear__get_issue')?.connectorId, 'linear');
    assert.equal(snap.history?.reduce((n, d) => n + d.sessions, 0), 4);
    await a.stop();
  });
});

test('codex: MCP names are connectors, built-in tools are not', () => {
  assert.equal(CODEX_TOOLS.connectorOf('github__search'), 'github');
  assert.equal(CODEX_TOOLS.connectorOf('shell'), undefined);
  assert.equal(CODEX_TOOLS.connectorOf('apply_patch'), undefined);
});

test('codex: absent store is silent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshu-none-'));
  try {
    const a = createCodexAdapter({ home });
    assert.equal((await a.detect()).present, false);
    assert.equal((await a.snapshot('')).events.length, 0);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
