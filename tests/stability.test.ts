// A busy folder over ten minutes (0.3.2: Bo saw a lot in the Claude city "constantly changing"): short sessions
// that start and stop every few seconds (`claude -p` runs, background agents) next to one long session whose
// subagents come and go, polled the way the host and the panel do (every 2 s: new events into the placement keeper,
// then the scene at that moment). A session keeps its lot and its building for as long as it stands; its building
// changes look only when its state changes; no two buildings share ground; and in a full city a new session only
// ever takes the lot of a finished building of an earlier day, never one that stands today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cityTemplate, emptyPlacement, GROWTH, rootOf, sessionStateAt, type PlacementState, type UEvent } from '@dsh-universe/model';
import { createStore } from '@dsh-universe/model';
import { buildScene } from '@dsh-universe/renderer';
import { createPlacementKeeper, memoryKv } from '@dsh-universe/adapter-dsh';
import { createArtKit, lotEnvelope, rectsMeet } from '@dsh-universe/art';

const tags = createArtKit().buildingTags;
const names = { town: 't', station: 's', fire: 'f', school: 'k', library: 'l' };
const DAY = new Date(2026, 10, 20).getTime(), T0 = DAY + 14 * 3600_000, MIN = 60_000;

/** Ten minutes of a busy folder, as events with the time they become known (when the host would read them). */
function busyStream(): { at: number; e: UEvent }[] {
  const out: { at: number; e: UEvent }[] = [];
  const ev = (at: number, e: UEvent) => out.push({ at, e });
  ev(T0 - MIN, { type: 'workspace', data: { id: 'docs', title: 'Documents', displayPath: 'Documents' } });
  // The long session: one main agent working the whole time; a subagent every 20 s, each for 40 s.
  ev(T0, { type: 'agent', data: { id: 'long', sessionId: 'long', workspaceId: 'docs', label: '', kind: 'main', state: 'running', startedAt: T0 } });
  ev(T0, { type: 'turn', data: { t: T0, agentId: 'long', phase: 'start' } });
  for (let i = 0; i < 30; i++) {
    const t = T0 + i * 20_000, id = 'sub' + i;
    ev(t, { type: 'agent', data: { id, sessionId: 'long', parentAgentId: 'long', workspaceId: 'docs', label: '', kind: 'subagent', state: 'running', startedAt: t } });
    ev(t, { type: 'turn', data: { t, agentId: id, phase: 'start' } });
    for (let k = 0; k < 4; k++) ev(t + k * 8000, { type: 'activity', data: { id: id + ':' + k, t: t + k * 8000, agentId: id, category: k & 1 ? 'read' : 'edit', tool: 'Read', ok: true } });
    ev(t + 40_000, { type: 'turn', data: { t: t + 40_000, agentId: id, phase: 'end', reason: 'completed' } });
  }
  // Short sessions: one every 12 s, 20–50 s long, a few calls, then done (every fifth stops on an error).
  for (let i = 0; i < 50; i++) {
    const t = T0 + i * 12_000, id = 'p' + i, len = 20_000 + (i % 4) * 10_000;
    ev(t, { type: 'agent', data: { id, sessionId: id, workspaceId: 'docs', label: '', kind: 'main', state: 'running', startedAt: t } });
    ev(t, { type: 'turn', data: { t, agentId: id, phase: 'start' } });
    for (let k = 0; k < 3; k++) ev(t + k * 5000, { type: 'activity', data: { id: id + ':' + k, t: t + k * 5000, agentId: id, category: 'exec', tool: 'Bash', ok: true } });
    ev(t + len, { type: 'turn', data: { t: t + len, agentId: id, phase: 'end', reason: i % 5 === 4 ? 'error' : 'completed' } });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Runs the stream through a keeper and the scene every 2 s; returns what each session's building looked like. */
function run(prior?: PlacementState) {
  const table = memoryKv();
  if (prior) void table.put('placement', prior);
  const keeper = createPlacementKeeper({ table, dayStart: (t) => new Date(t).setHours(0, 0, 0, 0) });
  const store = createStore();
  const stream = busyStream();
  const looks = new Map<string, { lot: string; template: number; changes: number; stateChanges: number; last: string; lastState: string }>();
  const problems: string[] = [];
  return (async () => {
    await keeper.load();
    let i = 0;
    for (let T = T0 - MIN; T <= T0 + 10 * MIN; T += 2000) {
      const fresh: UEvent[] = [];
      while (i < stream.length && stream[i].at <= T) fresh.push(stream[i++].e);
      store.applyAll(fresh);
      keeper.observe(fresh);
      const placement = keeper.state();
      const scene = buildScene({ store, placement, T, templateTags: tags, names, time: 0, night: false });
      const lots = cityTemplate().blocks.flatMap((b) => b.lots);
      const lotByKey = new Map(lots.map((L) => [L.key, L]));
      const towers = scene.places.filter((p) => p.tier === 'building');
      // No two buildings on one lot, and no two buildings' ground meets.
      const keys = towers.map((p) => placement.lots[p.sessionId!]);
      if (new Set(keys).size !== keys.length) problems.push(`${T - T0}: two buildings on one lot`);
      for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++)
        if (rectsMeet(lotEnvelope(lotByKey.get(keys[a])!), lotEnvelope(lotByKey.get(keys[b])!))) problems.push(`${T - T0}: ${keys[a]} meets ${keys[b]}`);
      for (const p of towers) {
        const sid = p.sessionId!, b = p.building!, lot = placement.lots[sid];
        const root = store.agent(sid);
        const fam = store.agents().filter((s) => rootOf(store, s).agent.sessionId === sid);
        const st = root ? sessionStateAt(root, fam, T) : 'done';
        const look = JSON.stringify([b.template, b.stage, b.state]);
        const was = looks.get(sid);
        if (!was) { looks.set(sid, { lot, template: b.template, changes: 0, stateChanges: 0, last: look, lastState: st }); continue; }
        if (was.lot !== lot) problems.push(`${sid} moved from ${was.lot} to ${lot}`);
        if (was.template !== b.template) problems.push(`${sid} changed template`);
        if (was.lastState !== st) { was.stateChanges++; was.lastState = st; }
        if (was.last !== look) { was.changes++; was.last = look; }
      }
    }
    return { looks, problems, placement: keeper.state() };
  })();
}

test('a busy folder for ten minutes: every session keeps its lot and building; its look changes only with its state', async () => {
  const { looks, problems, placement } = await run();
  assert.deepEqual(problems, []);
  assert.ok(looks.size >= 40, 'the short sessions stand as buildings: ' + looks.size);
  for (const [sid, l] of looks) assert.ok(l.changes <= l.stateChanges, `${sid}: ${l.changes} changes of look for ${l.stateChanges} changes of state`);
  // The long session: its subagents came and went thirty times; its building changed look no more than its state did.
  const long = looks.get('long')!;
  assert.ok(long.changes <= long.stateChanges && long.changes <= 2, 'long: ' + JSON.stringify(long));
  // All in the folder's own blocks: one workspace, one plate.
  assert.equal(new Set(placement.claims.map((c) => c.workspaceId)).size, 1);
});

test('a full city: the busy folder renews only earlier days\' finished lots, never one standing today', async () => {
  // Every lot of the largest city taken by a finished session of yesterday.
  const lots = cityTemplate().blocks.filter((b) => b.zone === 'build').flatMap((b) => b.lots);
  const prior = emptyPlacement();
  prior.growth = GROWTH.length - 1;
  prior.growthLog = [{ t: 0, g: prior.growth }];
  const y = DAY - 86_400_000;
  cityTemplate().blocks.filter((b) => b.zone === 'build').forEach((b, i) => prior.claims.push({ block: b.key, workspaceId: 'old' + (i % 3), t: y }));
  prior.workspaces = { old0: 0, old1: 1, old2: 2 };
  prior.sizes = {};
  lots.forEach((L, i) => { prior.lots['y' + i] = L.key; prior.sizes!['y' + i] = { calls: { library: 4 }, tokens: 1000, state: 'done', started: y + i * 1000 }; });
  const { looks, problems, placement } = await run(prior);
  assert.deepEqual(problems, []);
  assert.ok(looks.size >= 40, 'today\'s sessions found lots: ' + looks.size);
  // Every lot today's sessions hold was an earlier day's; today's sessions keep theirs (checked while running above).
  const today = Object.entries(placement.lots).filter(([id]) => !id.startsWith('y'));
  assert.equal(new Set(today.map(([, k]) => k)).size, today.length);
});
