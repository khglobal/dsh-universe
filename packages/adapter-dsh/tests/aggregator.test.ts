import test from 'node:test';
import assert from 'node:assert/strict';
import { conformanceProblems } from '@dsh-universe/adapter-kit';
import { createStore, errsAt, idxAt, cumAt, stateAt, floorsOf, type UEvent } from '@dsh-universe/model';
import { createAggregator, dshCategories, DSH_TOOLS } from '../src/index.ts';
import { SECRETS, T0, dayOfEvents } from './fake.ts';

const agg = () => createAggregator({ categories: dshCategories(() => ['erp']), workspaceOf: () => 'w1', now: () => T0 });

test('only allow-listed fields come out: arguments, results, prompts, replies, paths, error text and labels never do', () => {
  const a = agg();
  const out: UEvent[] = [];
  for (const { s, e } of dayOfEvents()) out.push(...a.event(s, e));
  assert.ok(out.length > 10);
  assert.deepEqual(conformanceProblems(out, SECRETS), []);
  assert.ok(!JSON.stringify(out).includes('/Users/me'), 'no paths, not even the cwd');
});

test('a DSH day becomes the right model: calls, errors, durations, tokens, waits, jobs, deliverables, subagents', () => {
  const a = agg();
  const st = createStore();
  for (const { s, e } of dayOfEvents()) st.applyAll(a.event(s, e));
  const s1 = st.agent('s1')!, kid = st.agent('s1k')!;
  const end = T0 + 3600_000;
  assert.equal(idxAt(s1, end), 3, 'bash, the ERP read and the question');
  assert.equal(errsAt(s1, end), 1);
  assert.equal(s1.ev[0].tool, 'bash');
  assert.equal(s1.ev[0].durationMs, 60_000);
  assert.equal(s1.ev[1].category, 'connector');
  assert.equal(s1.ev[1].connectorId, 'erp');
  assert.equal(cumAt(s1, end), 1500);
  assert.equal(s1.agent.model, 'deepseek-v4');
  assert.equal(s1.waits.find((w) => w.id === 'ap1')?.outcome, 'allowed');
  assert.equal(s1.waits.find((w) => w.id === 'ap1')?.askedAt, T0 + 6 * 60_000, 'the decision does not move the asked time');
  assert.equal(stateAt(s1, T0 + 6.5 * 60_000), 'waiting');
  assert.equal(stateAt(s1, T0 + 11.5 * 60_000), 'waiting', 'a question to the member is a wait');
  assert.equal(stateAt(s1, end), 'failed');
  assert.equal(s1.jobs[0].outcome, 'failed');
  assert.equal(s1.deliverables[0].count, 2);
  assert.equal(kid.agent.parentAgentId, 's1');
  assert.equal(stateAt(kid, end), 'done');
  assert.equal(floorsOf(st, 'b:s1', end, { approvals: true, schedules: true, subagents: true, jobs: true, deliverables: true, skills: true, memory: false, tokens: true, cost: false, latency: true, sessionTitles: true, actions: { openSession: true, draftFollowUp: true } })
    .find((f) => f.id === 'library')?.n, 1, 'the subagent read is on the library floor of the parent building');
});

test('turn end reasons map to done, failed and idle', () => {
  const a = agg();
  const st = createStore();
  const s = { id: 'x', header: { createdAt: T0 } };
  for (const [i, kind] of ['completed', 'aborted', 'error', 'max-tokens', 'interrupted'].entries()) {
    st.applyAll(a.event(s, { type: 'turn/start', time: T0 + i * 10 }));
    st.applyAll(a.event(s, { type: 'turn/end', time: T0 + i * 10 + 5, data: { reason: { kind } } }));
  }
  const tr = st.agent('x')!;
  assert.deepEqual([6, 16, 26, 36, 46].map((t) => stateAt(tr, T0 + t)), ['done', 'idle', 'failed', 'idle', 'idle']);
});

test('host subagent/start gives the parent; the header gives it too', () => {
  const a = agg();
  assert.deepEqual(a.subagent({ runId: 'r', provider: 'p', parentSessionId: 'p1', id: 'c1', local: true, lastAssistantMessage: [{ text: 'secret' }] }),
    [{ type: 'agent', data: { id: 'c1', parentAgentId: 'p1', kind: 'subagent' } }]);
  const [ag] = a.session({ id: 'c2', header: { createdAt: T0, parentSession: 'p1', origin: 'subagent', agentPreset: 'finance-expert' } });
  assert.equal((ag.data as { parentAgentId?: string }).parentAgentId, 'p1');
  assert.equal((ag.data as { role?: string }).role, 'finance-expert');
});

test('categories: every DSH tool has a category; unknown names are other; MCP tools find their server', () => {
  const c = dshCategories(() => ['erp', 'erp__v2']);
  for (const [name, cat] of Object.entries(DSH_TOOLS)) assert.notEqual(cat, 'other', name);
  assert.equal(c.connectorOf('mcp__erp__execute_read'), 'erp');
  assert.equal(c.connectorOf('mcp__erp__v2__list'), 'erp__v2', 'longest known server wins');
  assert.equal(c.connectorOf('mcp__other__x'), 'other');
  assert.equal(c.connectorOf('bash'), undefined);
  const a = createAggregator({ categories: c, workspaceOf: () => '', now: () => T0 });
  const [, act] = a.event({ id: 'z' }, { type: 'tool/call', time: T0, data: { callId: '1', name: 'brand_new_tool' } });
  assert.equal((act.data as { category: string }).category, 'other');
});

test('session/title: only a theme id comes out, frozen at the first title, and the stored placement has no title text', async () => {
  const { createPlacementKeeper, memoryKv } = await import('../src/index.ts');
  const table = memoryKv();
  const keeper = createPlacementKeeper({ table });
  const a = createAggregator({ categories: dshCategories(() => []), workspaceOf: () => 'w1', now: () => T0, onTheme: (id, th) => { keeper.theme(id, th); } });
  const ses = { id: 'sx', header: { createdAt: T0 } };
  keeper.observe(a.session(ses));
  const out = [
    ...a.event(ses, { type: 'session/title', time: T0 + 1, data: { title: '供应商发票三单匹配 secret-walrus', source: { kind: 'fallback' } } }),
    ...a.event(ses, { type: 'session/title', time: T0 + 2, data: { title: 'Hiring plan secret-walrus', source: { kind: 'user' } } }),
  ];
  assert.deepEqual(out, [], 'no model events carry the title');
  assert.equal(keeper.state().themes?.sx, 'finance', 'the first real title wins; a rename does not change it');
  await keeper.flush();
  const stored = JSON.stringify(await table.get('placement'));
  assert.ok(!stored.includes('secret-walrus') && !stored.includes('供应商'), stored);
  assert.ok(stored.includes('"sx":"finance"'));
});

test('exit_plan_mode: an unanswered call puts the agent in the square as "plan to approve"; the result sends it back; no plan text is kept', async () => {
  const { rally, whereabouts } = await import('@dsh-universe/model');
  const a = agg();
  const st = createStore();
  const ses = { id: 'sp', header: { createdAt: T0 } };
  const PLAN = 'PLAN-TEXT step one: migrate the secret-heron database';
  const ANSWER = 'ANSWER-TEXT yes but rename secret-heron';
  const evs = [
    a.session(ses),
    a.event(ses, { type: 'turn/start', time: T0 + 1000, data: {} }),
    a.event(ses, { type: 'plan/mode', time: T0 + 2000, data: { active: true } }),
    a.event(ses, { type: 'tool/call', time: T0 + 60_000, data: { callId: 'p1', name: 'exit_plan_mode', arguments: JSON.stringify({ plan: PLAN }) } }),
  ].flat();
  st.applyAll(evs);
  const s = st.agent('sp')!;
  assert.equal(stateAt(s, T0 + 90_000), 'waiting');
  assert.deepEqual(whereabouts(st, s, T0 + 90_000), { place: 'town', floor: 'plan' });
  assert.deepEqual(rally(st, T0 + 90_000).map((x) => x.agent.id), ['sp']);
  const after = a.event(ses, { type: 'tool/result', time: T0 + 120_000, data: { message: { toolCallId: 'p1', content: [{ type: 'text', text: ANSWER }] } } });
  st.applyAll(after);
  assert.equal(stateAt(s, T0 + 130_000), 'running');
  assert.notEqual(whereabouts(st, s, T0 + 130_000)?.place, 'town');
  const all = JSON.stringify([...evs, ...after]);
  assert.ok(!all.includes('PLAN-TEXT') && !all.includes('ANSWER-TEXT') && !all.includes('secret-heron'), all);
  assert.equal(s.ev[0].category, 'plan');
});

test('building sizes: the placement record keeps calls per floor, tokens and the end state, never titles or tools', async () => {
  const { createPlacementKeeper, memoryKv } = await import('../src/index.ts');
  const { sizesOf, readPlacement } = await import('@dsh-universe/model');
  const table = memoryKv();
  const keeper = createPlacementKeeper({ table });
  const a = agg();
  const st = createStore();
  const evs: UEvent[] = [];
  for (const { s, e } of dayOfEvents()) evs.push(...a.event(s, e));
  st.applyAll(evs);
  keeper.observe(evs);
  keeper.sizes(sizesOf(st, T0 + 3600_000));
  await keeper.flush();
  const raw = await table.get('placement');
  const text = JSON.stringify(raw);
  for (const secret of SECRETS) assert.ok(!text.includes(secret), 'no secret: ' + secret);
  assert.ok(!text.includes('bash') && !text.includes('execute_read'), 'no tool names');
  const back = readPlacement(raw);
  assert.equal(back.sizes?.s1?.state, 'failed');
  assert.ok((back.sizes?.s1?.calls.machine ?? 0) >= 1);
  assert.ok((back.sizes?.s1?.tokens ?? 0) > 0);
  assert.equal(back.sizes?.s1k, undefined, 'subagents count into their parent\'s building');
});

test('retries and plan mode: the repair log counts retries, plan mode is a flag over time; no failure text is kept', async () => {
  const { floorsOf, planModeAt } = await import('@dsh-universe/model');
  const a = agg();
  const st = createStore();
  const ses = { id: 'sr', header: { createdAt: T0 } };
  const FAIL = 'FAILURE-TEXT 529 overloaded secret-otter';
  const evs = [
    a.session(ses),
    a.event(ses, { type: 'turn/start', time: T0 + 1000, data: {} }),
    a.event(ses, { type: 'plan/mode', time: T0 + 2000, data: { active: true } }),
    a.event(ses, { type: 'llm/retry', time: T0 + 10_000, data: { retryId: 'r1', turn: 1, step: 1, provider: 'p', mode: 'normal', policyKey: 'k', retry: 1, maxRetries: 3, delayMs: 2000, failure: { message: FAIL } } }),
    a.event(ses, { type: 'llm/retry-started', time: T0 + 12_000, data: { retryId: 'r1', turn: 1, step: 1, retry: 1 } }),
    a.event(ses, { type: 'llm/retry', time: T0 + 20_000, data: { retryId: 'r2', turn: 1, step: 2, provider: 'p', mode: 'always', policyKey: 'k', retry: 2, delayMs: 4000, failure: { message: FAIL } } }),
    a.event(ses, { type: 'plan/mode', time: T0 + 30_000, data: { active: false } }),
  ].flat();
  st.applyAll(evs);
  const all = JSON.stringify(evs);
  assert.ok(!all.includes('FAILURE-TEXT') && !all.includes('secret-otter') && !all.includes('policyKey'), all);
  assert.deepEqual(conformanceProblems(evs, [FAIL]), []);
  const s = st.agent('sr')!;
  assert.deepEqual(s.retries.map((r) => [r.id, r.t - T0, r.attempt, r.startedAt && r.startedAt - T0]), [['r1', 10_000, 1, 12_000], ['r2', 20_000, 2, undefined]]);
  const caps = { approvals: true, schedules: true, subagents: true, jobs: true, deliverables: true, skills: true, memory: false, tokens: true, cost: false, latency: true, sessionTitles: true, retries: true, actions: { openSession: true, draftFollowUp: true } };
  const repair = (T: number) => floorsOf(st, 'fire', T, caps).find((f) => f.id === 'retry')!;
  assert.deepEqual([repair(T0 + 60_000).n, repair(T0 + 60_000).recovered, repair(T0 + 60_000).na], [2, 1, false]);
  assert.equal(repair(T0 + 11_000).recovered, 0, 'look-back: the wait was not over yet');
  assert.equal(floorsOf(st, 'fire', T0, { ...caps, retries: undefined }).find((f) => f.id === 'retry')!.na, true, 'a platform without retries: not provided');
  assert.equal(planModeAt(s, T0 + 1500), false);
  assert.equal(planModeAt(s, T0 + 5000), true);
  assert.equal(planModeAt(s, T0 + 31_000), false);
});

test('plugins: only what the member installed (the plugin manager\'s profile bundles), never the Host\'s own modules', async () => {
  const { memberPlugins } = await import('../src/sources.ts');
  assert.deepEqual(memberPlugins([
    { name: '@deepseek-ai/dsh-session', installed: false, enabled: true, official: true },
    { name: '@deepseek-ai/dsh-plan-mode', installed: false, enabled: true },
    { name: '@khglobal/dsh-universe', installed: true, enabled: true },
    { name: 'pdf-tools', installed: true, enabled: false },
    { installed: true }, null, 'x',
  ]), [{ id: '@khglobal/dsh-universe', enabled: true }, { id: 'pdf-tools', enabled: false }]);
});

test('plugins: the display title DSH\'s plugin list shows, and on when the host runs it (#7)', async () => {
  const { memberPlugins } = await import('../src/sources.ts');
  const bundles = [
    { name: '@khglobal/dsh-office', installed: true, enabled: true, meta: { title: { en: 'Office', zh: '办公' } } },
    // A base plugin the host loads through its own rows: not selected in the profile, but its row is live.
    { name: '@khglobal/dsh-memory', installed: true, enabled: false, rows: [{ rowId: 'mem', moduleName: '@khglobal/dsh-memory/host', entryId: 'e-mem', meta: { title: 'Memory' } }] },
    { name: '@khglobal/dsh-org-identity', installed: true, enabled: false, meta: { title: 'Org identity' } },
    { name: 'stopped-one', installed: true, enabled: false, rows: [{ rowId: 'x', moduleName: 'stopped-one', entryId: 'e-x' }] },
  ];
  const inventory = [
    { entryId: 'e-mem', moduleName: '@khglobal/dsh-memory/host', enabled: true, fiberPhase: 'active' },
    { entryId: 'e-org', moduleName: '@khglobal/dsh-org-identity', enabled: true, fiberPhase: 'active' },
    { entryId: 'e-x', moduleName: 'stopped-one', enabled: false, fiberPhase: null },
  ];
  assert.deepEqual(memberPlugins(bundles, inventory), [
    { id: '@khglobal/dsh-office', enabled: true, title: 'Office', titleZh: '办公' },
    { id: '@khglobal/dsh-memory', enabled: true, title: 'Memory' },
    { id: '@khglobal/dsh-org-identity', enabled: true, title: 'Org identity' },
    { id: 'stopped-one', enabled: false },
  ]);
  const { displayName } = await import('@dsh-universe/model');
  assert.equal(displayName({ id: '@khglobal/dsh-office', title: 'Office', titleZh: '办公' }, 'zh'), '办公');
  assert.equal(displayName({ id: '@khglobal/dsh-office', title: 'Office', titleZh: '办公' }, 'en'), 'Office');
  assert.equal(displayName({ id: 'stopped-one' }, 'zh'), 'stopped-one', 'no title: the package name');
});

test('connectors: named by the host\'s connector title, the server id only without one (#7)', async () => {
  const { createSources } = await import('../src/sources.ts');
  const { sanitize } = await import('@dsh-universe/adapter-kit');
  const mcpManager = { list: () => [
    { name: 'a_kh_erp', configured: true, status: { state: 'connected' } },
    { name: 'mine', configured: true, status: { state: 'connected' } },
    { name: 'bare', configured: true, status: { state: 'disabled' } },
  ] };
  const workdshConnectors = { list: async () => [
    { serverName: 'a_kh_erp', title: '海星ERP', titles: { zh: '海星ERP', en: 'Astero ERP' }, url: 'https://secret.example/mcp' },
    { serverName: 'mine', title: 'My CRM' },
  ] };
  const conn = (svc: object) => createSources(() => svc).read().then((evs) => evs.filter((e) => e.type === 'connector').map((e) => e.data));
  const named = await conn({ mcpManager, workdshConnectors });
  assert.deepEqual(named.map((c) => [c.id, c.title, (c as { titleZh?: string }).titleZh]), [['a_kh_erp', 'Astero ERP', '海星ERP'], ['mine', 'My CRM', undefined], ['bare', 'bare', undefined]]);
  assert.ok(!JSON.stringify(named).includes('secret.example'), 'only names are read');
  for (const c of named) assert.deepEqual(sanitize({ type: 'connector', data: c })?.data, c, 'the model keeps the names');
  const official = await conn({ mcpManager, workdshConnectors: { list: async () => { throw Error('no'); } } });
  assert.deepEqual(official.map((c) => c.title), ['a_kh_erp', 'mine', 'bare'], 'official DSH: the server id');
});
