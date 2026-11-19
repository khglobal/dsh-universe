// Midnight with DSH left open (QA finding 2) and damaged stored records (finding 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stateAt, createStore, type UEvent } from '@dsh-universe/model';
import { carryOver, createDayStore, memoryKv, startDshHost, storedEvent } from '../src/index.ts';
import { SECRETS } from './fake.ts';

const local = (h: number, m = 0, day = 18) => new Date(2026, 10, day, h, m).getTime();

function fakeCtx(services: Record<string, unknown> = {}) {
  const listeners = new Map<string, ((...a: unknown[]) => void)[]>();
  return {
    on(name: string, fn: (...a: unknown[]) => void) { listeners.set(name, [...(listeners.get(name) ?? []), fn]); return () => listeners.set(name, (listeners.get(name) ?? []).filter((f) => f !== fn)); },
    emit(name: string, ...a: unknown[]) { for (const f of listeners.get(name) ?? []) f(...a); },
    service: (n: string) => services[n],
  };
}
const services = () => ({
  workspaceRegistry: { list: () => [{ id: 'w1', path: '/Users/me/work/finance', title: 'Finance', sessionIds: ['run', 'wait', 'done', 'late'] }] },
  schedule: { list: async () => ({ items: [{ id: 'a1', title: 'Daily stock alert', prompt: SECRETS[2], status: 'active', scheduledAt: '2026-11-19T07:45:00Z', kind: 'daily' }] }) },
  mcpManager: { list: () => [{ name: 'erp', configured: true, status: { state: 'connected', toolCount: 4 } }] },
  pluginInventory: { list: async () => ({ entries: [{ entryId: 'e', moduleName: 'pdf-tools', enabled: true }] }) },
});
const ses = (id: string, t: number) => ({ id, header: { createdAt: t, cwd: '/Users/me/work/finance' } });
let n = 0;
const ev = (type: string, time: number, data: unknown = {}) => ({ type, seq: ++n, time, data });

test('carryOver: standing things (latest of each) and every open family with all its events; closed sessions stay', () => {
  const T = local(23, 59);
  const evs: UEvent[] = [
    { type: 'workspace', data: { id: 'w1', title: 'Old name', displayPath: 'w1' } },
    { type: 'workspace', data: { id: 'w1', title: 'Finance', displayPath: 'w1' } },
    { type: 'connector', data: { id: 'erp', title: 'ERP', state: 'connected' } },
    { type: 'agent', data: { id: 'r', sessionId: 'r', workspaceId: 'w1', label: '', kind: 'main', state: 'running', startedAt: local(22) } },
    { type: 'turn', data: { t: local(22), agentId: 'r', phase: 'start' } },
    { type: 'activity', data: { t: local(22, 5), agentId: 'r', category: 'read', tool: 'read' } },
    // A main turn that ended while a subagent still works: the family is open (finding 6).
    { type: 'agent', data: { id: 'p', sessionId: 'p', workspaceId: 'w1', label: '', kind: 'main', state: 'running', startedAt: local(21) } },
    { type: 'turn', data: { t: local(21), agentId: 'p', phase: 'start' } },
    { type: 'turn', data: { t: local(21, 30), agentId: 'p', phase: 'end', reason: 'completed' } },
    { type: 'agent', data: { id: 'pk', sessionId: 'pk', parentAgentId: 'p', workspaceId: 'w1', label: '', kind: 'subagent', state: 'running', startedAt: local(21, 10) } },
    { type: 'turn', data: { t: local(21, 10), agentId: 'pk', phase: 'start' } },
    { type: 'agent', data: { id: 'w', sessionId: 'w', workspaceId: 'w1', label: '', kind: 'main', state: 'running', startedAt: local(20) } },
    { type: 'approval', data: { id: 'ap', agentId: 'w', kind: 'approval', askedAt: local(23) } },
    { type: 'agent', data: { id: 'd', sessionId: 'd', workspaceId: 'w1', label: '', kind: 'main', state: 'running', startedAt: local(9) } },
    { type: 'turn', data: { t: local(9), agentId: 'd', phase: 'start' } },
    { type: 'turn', data: { t: local(10), agentId: 'd', phase: 'end', reason: 'completed' } },
  ];
  const out = carryOver(evs, T);
  assert.deepEqual(out.filter((e) => e.type === 'workspace').map((e) => (e.data as { title: string }).title), ['Finance']);
  assert.equal(out.filter((e) => e.type === 'connector').length, 1);
  const ids = new Set(out.filter((e) => e.type === 'agent').map((e) => (e.data as { id: string }).id));
  assert.deepEqual([...ids].sort(), ['p', 'pk', 'r', 'w']);
  const st = createStore(); st.applyAll(out);
  assert.equal(stateAt(st.agent('r')!, T + 120_000), 'running');
  assert.equal(stateAt(st.agent('w')!, T + 120_000), 'waiting');
  assert.equal(out.filter((e) => e.type === 'activity').length, 1, 'the open session keeps its calls');
});

test('host across midnight (fake clock): running and waiting sessions, workspaces, schedules, connectors and plugins carry over; yesterday joins the history', async () => {
  let now = local(23, 56);
  const ctx = fakeCtx(services());
  const events = memoryKv(), places = memoryKv();
  const host = await startDshHost({ on: ctx.on, service: ctx.service, events, places, now: () => now, noBackfill: true, flushMs: 0, refreshMs: 1e9 });
  const run = ses('run', local(23, 50)), wait = ses('wait', local(23, 40)), done = ses('done', local(9));
  ctx.emit('session/event', done, ev('turn/start', local(9), { turn: 'd1' }));
  ctx.emit('session/event', done, ev('turn/end', local(9, 30), { turn: 'd1', reason: { kind: 'completed' } }));
  ctx.emit('session/event', run, ev('turn/start', local(23, 50), { turn: 't1' }));
  ctx.emit('session/event', run, ev('tool/call', local(23, 51), { callId: 'c1', name: 'read', arguments: '{}' }));
  ctx.emit('session/event', wait, ev('turn/start', local(23, 40), { turn: 'w1' }));
  ctx.emit('session/event', wait, ev('approval/asked', local(23, 41), { id: 'ap1', toolName: 'mcp__erp__execute_write', callId: 'c3' }));
  const before = host.snapshot();
  const day0 = before.day;
  // Past midnight: the client asks for what came after; the host rolls over.
  now = local(0, 2, 19);
  const since = host.since(before.seq, 1000, before.placementVersion);
  const snap = host.snapshot();
  assert.notEqual(snap.day, day0, 'a new day');
  assert.equal(snap.utcOffset, -new Date(now).getTimezoneOffset(), 'the host tells its UTC offset (its day and clock)');
  assert.equal(since.day, snap.day);
  const evs = snap.events.map((x) => x.e);
  const types = new Set(evs.map((e) => e.type));
  for (const t of ['workspace', 'schedule', 'connector', 'inventory']) assert.ok(types.has(t as never), t + ' carried over');
  const st = createStore(); st.applyAll(evs);
  const agents = new Set(st.agents().map((s) => s.agent.sessionId));
  assert.ok(agents.has('run') && agents.has('wait'), 'open sessions carried over: ' + [...agents]);
  assert.ok(!agents.has('done'), 'a session done before midnight stays in yesterday');
  assert.equal(stateAt(st.agent('run')!, now), 'running');
  assert.equal(stateAt(st.agent('wait')!, now), 'waiting');
  assert.deepEqual(snap.history.map((d) => d.day), [day0, snap.day], 'yesterday is in the 14-day history');
  assert.ok(snap.history[0].sessions >= 3, JSON.stringify(snap.history[0]));
  // The session that ended yesterday goes on today: it is announced again before its first event of the day.
  ctx.emit('session/event', done, ev('turn/start', local(0, 5, 19), { turn: 'd2' }));
  const st2 = createStore(); st2.applyAll(host.snapshot().events.map((x) => x.e));
  assert.ok(st2.agent('done'), 'resumed session has its agent today');
  assert.equal(stateAt(st2.agent('done')!, local(0, 6, 19)), 'running');
  // Sources unchanged since before midnight are not stored twice in the new day.
  const count = host.snapshot().events.length;
  await host.refresh();
  assert.equal(host.snapshot().events.length, count);
  // A restart after midnight reads the new day back with what carried over.
  await host.dispose();
  const again = await startDshHost({ on: fakeCtx(services()).on, service: (n) => (services() as Record<string, unknown>)[n], events, places, now: () => now, noBackfill: true, flushMs: 0, refreshMs: 1e9 });
  const st3 = createStore(); st3.applyAll(again.snapshot().events.map((x) => x.e));
  assert.ok(st3.agent('run') && st3.agent('wait'));
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(again.snapshot().history.some((d) => d.day === day0), 'yesterday read back after a restart');
  await again.dispose();
});

test('storage: damaged records are skipped (null, missing data, wrong types) and the day is repaired; negative counts read as 0', async () => {
  assert.equal(storedEvent(null, 0), undefined);
  assert.equal(storedEvent({ seq: 1, e: { type: 'agent' } }, 0), undefined);
  assert.equal(storedEvent({ seq: 1, e: { type: 'agent', data: { label: 'x' } } }, 0), undefined, 'an agent needs its id');
  assert.equal(storedEvent({ seq: 'x', e: { type: 'turn', data: { t: 1, agentId: 'a', phase: 'start' } } }, 0), undefined);
  assert.equal(storedEvent({ seq: 1, e: { type: 'turn', data: { t: 1, agentId: 'a', phase: 'start' } } }, 1), undefined, 'numbers only go up');
  assert.equal((storedEvent({ seq: 2, e: { type: 'usage', data: { t: 1, agentId: 'a', model: 'm', input: -5, output: 3 } } }, 0)!.e.data as { input: number }).input, 0);
  const kv = memoryKv();
  const now = () => local(12);
  const s = createDayStore({ table: kv, now, flushMs: 0 });
  await s.load();
  s.append({ type: 'agent', data: { id: 'a', sessionId: 'a', workspaceId: 'w1', label: '', kind: 'main', state: 'running', startedAt: local(11) } });
  s.append({ type: 'turn', data: { t: local(11), agentId: 'a', phase: 'start' } });
  await s.flush();
  const k = [...kv.keys!()].find((x) => x.startsWith('day:'))!;
  const chunk = (await kv.get(k)) as unknown[];
  await kv.put(k, [chunk[0], null, { seq: 7, e: { type: 'agent' } }, { seq: 8 }, chunk[1]]);
  const errors: string[] = [];
  const again = createDayStore({ table: kv, now, flushMs: 0, onError: (e) => errors.push(String((e as Error).name)) });
  await again.load();
  assert.equal(again.today().events.length, 2);
  assert.deepEqual(errors, ['DamagedRecords']);
  await again.flush();
  assert.equal(((await kv.get(k)) as unknown[]).length, 2, 'the damaged chunk was written again without the bad records');
});

test('host: a damaged record in today\'s storage does not stop the start', async () => {
  const kv = memoryKv();
  const now = () => local(12);
  const s = createDayStore({ table: kv, now, flushMs: 0 });
  await s.load();
  s.append({ type: 'agent', data: { id: 'a', sessionId: 'a', workspaceId: 'w1', label: '', kind: 'main', state: 'running', startedAt: local(11) } });
  await s.flush();
  const k = [...kv.keys!()].find((x) => x.startsWith('day:'))!;
  await kv.put(k, [...((await kv.get(k)) as unknown[]), null, { seq: 9, e: { type: 'agent' } }, { seq: 10, e: { type: 'agent', data: null } }]);
  const host = await startDshHost({ on: fakeCtx().on, service: () => undefined, events: kv, places: memoryKv(), now, noBackfill: true, flushMs: 0, refreshMs: 1e9 });
  assert.equal(host.snapshot().events.length, 1);
  await host.dispose();
});

test('after midnight: the carried-over session keeps its building, but today counts only what came after midnight (#26)', async () => {
  const { dayStart, todayAt, floorsOf } = await import('@dsh-universe/model');
  const evs: UEvent[] = [
    { type: 'agent', data: { id: 'r', sessionId: 'r', workspaceId: 'w1', label: '', kind: 'main', state: 'running', startedAt: local(22) } },
    { type: 'turn', data: { t: local(22), agentId: 'r', phase: 'start' } },
    { type: 'activity', data: { t: local(22, 5), agentId: 'r', category: 'exec', tool: 'bash', ok: false } },
    { type: 'usage', data: { t: local(22, 5), agentId: 'r', model: 'm1', input: 1_000_000, output: 900_000 } },
  ];
  const midnight = local(0, 0, 19);
  const st = createStore();
  st.applyAll(carryOver(evs, midnight + 8_000));
  const T = midnight + 8_000, from = dayStart(T, -new Date(T).getTimezoneOffset());
  assert.equal(from, midnight);
  const d = todayAt(st, T, 'c', undefined, undefined, from);
  assert.equal(d.errors, 0);
  assert.equal(d.tokens, 0);
  assert.equal(d.running, 1);
  // What is drawn is unchanged: the building's floors still hold yesterday's calls and tokens.
  const fl = floorsOf(st, 'b:r', T, { approvals: true, schedules: true, subagents: true, jobs: true, deliverables: true, skills: true, memory: true, tokens: true, cost: false, latency: true, sessionTitles: true, actions: { openSession: true, draftFollowUp: true } });
  assert.equal(fl.find((f) => f.id === 'machine')?.n, 1);
  assert.equal(fl.find((f) => f.id === 'roof')?.n, 1_900_000);
});
