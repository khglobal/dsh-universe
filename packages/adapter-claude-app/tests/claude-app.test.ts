// The Claude app's agent sessions: Cowork transcripts and the Code tab's own sessions, metadata only; a marker in every
// content field of the app's folder (session metadata, audit log, outputs, browser storage, token files) must never
// reach the output.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conformanceProblems } from '@dsh-universe/adapter-kit';
import { createStore, errsAt, idxAt, stateAt } from '@dsh-universe/model';
import { IDS, MARKERS, seedLocalStores } from '../../../fixtures/local-stores.ts';
import { COWORK_WORKSPACE, claudeAppDir, codeTabSessions, createClaudeAppAdapter } from '../src/index.ts';

const noon = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); };

async function withStore(fn: (home: string, now: number) => Promise<void>, o: Parameters<typeof seedLocalStores>[2] = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dshu-app-'));
  try { const now = noon(); seedLocalStores(home, now, { codex: false, workbuddy: false, ...o }); await fn(home, now); } finally { rmSync(home, { recursive: true, force: true }); }
}

test('claude app: metadata only; no marker from the app folder reaches the output', async () => {
  await withStore(async (home, now) => {
    const a = createClaudeAppAdapter({ home, now: () => now });
    assert.equal((await a.detect()).present, true);
    const snap = await a.snapshot('');
    assert.ok(snap.events.length > 20);
    assert.deepEqual(conformanceProblems(snap.events, [...MARKERS, '/work/', '/Users/', home]), []);
    await a.stop();
  });
});

test('claude app: Cowork and Code-tab sessions with their calls, tokens, subagents and state', async () => {
  await withStore(async (home, now) => {
    const a = createClaudeAppAdapter({ home, now: () => now });
    const snap = await a.snapshot('');
    const st = createStore();
    st.applyAll(snap.events);
    const roots = st.agents().filter((s) => !s.agent.parentAgentId);
    assert.deepEqual(roots.map((s) => s.agent.id).sort(), [IDS.codeTab, ...IDS.cowork].sort(), 'Cowork sessions and the Code tab\'s own session; not the terminal session the app only lists');
    assert.ok(st.agents().every((s) => s.agent.engine === 'claude-app'));
    const cw = st.agent(IDS.cowork[0])!;
    assert.equal(cw.agent.workspaceId, COWORK_WORKSPACE.id);
    assert.equal(cw.agent.model, 'claude-sonnet-4-5');
    assert.equal(idxAt(cw, now), 3);
    assert.equal(cw.ev.find((e) => e.tool === 'mcp__notion__search')?.connectorId, 'notion');
    assert.equal(stateAt(cw, now), 'done');
    const sub = st.agents().find((s) => s.agent.parentAgentId === IDS.cowork[0])!;
    assert.equal(sub.agent.role, 'Explore');
    assert.equal(stateAt(st.agent(IDS.cowork[1])!, now), 'running');
    assert.equal(errsAt(st.agent(IDS.cowork[1])!, now), 1);
    const tab = st.agent(IDS.codeTab)!;
    assert.equal(st.workspaces().find((w) => w.id === tab.agent.workspaceId)?.title, 'demo-app', 'a Code-tab session stands in its project\'s district');
    assert.equal(tab.agent.label, '', 'no generated title');
    assert.ok(st.workspaces().some((w) => w.title === COWORK_WORKSPACE.title));
    await a.stop();
  });
});

test('claude app: only the Code tab\'s own sessions are claimed; absent folders are silent', async () => {
  await withStore(async (home) => {
    const owned = await codeTabSessions(claudeAppDir(home))();
    assert.deepEqual([...owned], [IDS.codeTab]);
  });
  const empty = mkdtempSync(join(tmpdir(), 'dshu-app0-'));
  try {
    const a = createClaudeAppAdapter({ home: empty });
    assert.equal((await a.detect()).present, false);
    assert.equal((await a.snapshot('')).events.length, 0);
    await a.stop();
  } finally { rmSync(empty, { recursive: true, force: true }); }
});
