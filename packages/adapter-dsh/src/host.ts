// Wires the DSH adapter inside the plugin's Host: listens to session events, keeps today's model events in
// day storage, keeps the placement, refreshes the other sources and answers the two routes. Event handling is a
// constant-time append; any failure stops only this aggregator, never the host.
import { createStore, sizesOf, type UEvent } from '@dsh-universe/model';
import { createAggregator, type SessionEventLike, type SessionLike } from './aggregator.ts';
import { backfill, type SessionQueryLike } from './backfill.ts';
import { dshCategories } from './categories.ts';
import { dayTotals } from './history.ts';
import type { KvLike } from './kv.ts';
import { createPlacementKeeper } from './placement-keeper.ts';
import { dshCapabilities, dshPlatform } from './platform.ts';
import { createHandler, type NeighbourRoutes, type SinceValue, type SnapshotValue } from './routes.ts';
import { createSources, type SourceServices } from './sources.ts';
import { createDayStore, dayOf } from './storage.ts';

export interface HostDeps {
  /** cordis `ctx.on`: returns a disposer. */
  on(name: string, listener: (...args: unknown[]) => void): () => void;
  /** Optional services by name (`workspaceRegistry`, `schedule`, `mcpManager`, `pluginInventory`, `pluginManager`, `sessionQuery`). */
  service(name: string): unknown;
  events: KvLike;
  places: KvLike;
  now?: () => number;
  log?: (m: string) => void;
  refreshMs?: number;
  flushMs?: number;
  /** 'memory' when the storage domain could not be opened (the panel says so calmly). */
  storage?: 'persistent' | 'memory';
  /** Skip the start-up backfill (tests). */
  noBackfill?: boolean;
  /** How long the backfill waits for the workspace registry (DSH registers it after this plugin starts). */
  registryWaitMs?: number;
  /** The adjacent cities' routes (Claude Code, Codex on this device). */
  neighbours?: NeighbourRoutes;
}

export interface DshHost {
  handler: (request: Request) => Promise<Response>;
  snapshot(): SnapshotValue;
  since(seq: number, limit: number, placementVersion: number): SinceValue;
  /** Resolves when the start-up backfill is over. */
  ready: Promise<void>;
  refresh(): Promise<void>;
  dispose(): Promise<void>;
}

const localMidnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

export async function startDshHost(deps: HostDeps): Promise<DshHost> {
  const now = deps.now ?? Date.now;
  const log = deps.log ?? (() => {});
  const onError = (e: unknown) => log('storage: ' + (e instanceof Error ? e.name : 'error'));
  const svc = (name: string) => { try { return deps.service(name) ?? undefined; } catch { return undefined; } };
  const sources = createSources(() => ({
    workspaceRegistry: svc('workspaceRegistry') as SourceServices['workspaceRegistry'],
    schedule: svc('schedule') as SourceServices['schedule'],
    mcpManager: svc('mcpManager') as SourceServices['mcpManager'],
    pluginInventory: svc('pluginInventory') as SourceServices['pluginInventory'],
    pluginManager: svc('pluginManager') as SourceServices['pluginManager'],
  }), log);
  const store = createDayStore({ table: deps.events, now, flushMs: deps.flushMs, onError });
  const placement = createPlacementKeeper({ table: deps.places, onError });
  const aggregator = createAggregator({
    categories: dshCategories(() => sources.mcpServers()), workspaceOf: (id, cwd) => sources.workspaceOf(id, cwd), now,
    onTheme: (id, theme) => { if (placement.theme(id, theme)) void placement.flush(); },
  });
  await store.load();
  await placement.load();

  // Sources are re-read often; only changes are stored.
  const lastSource = new Map<string, string>();
  const agentWs = new Map<string, string>();
  let stopped = false;
  for (const { e } of store.today().events) {
    if (e.type === 'agent' && e.data.workspaceId) agentWs.set(e.data.id, e.data.workspaceId);
    if (e.type !== 'agent' && e.type !== 'activity' && e.type !== 'usage' && e.type !== 'turn' && e.type !== 'approval' && e.type !== 'job' && e.type !== 'deliverable' && e.type !== 'retry' && e.type !== 'planmode') {
      lastSource.set(e.type + ':' + ((e.data as { id?: string }).id ?? ''), JSON.stringify(e.data));
    }
  }
  placement.observe(store.today().events.map((x) => x.e));

  function ingest(events: readonly UEvent[]) {
    if (stopped || !events.length) return;
    const kept: UEvent[] = [];
    for (const e of events) {
      if (e.type === 'workspace' || e.type === 'schedule' || e.type === 'connector' || e.type === 'inventory') {
        const k = e.type + ':' + ((e.data as { id?: string }).id ?? '');
        const v = JSON.stringify(e.data);
        if (lastSource.get(k) === v) continue;
        lastSource.set(k, v);
      }
      if (e.type === 'agent' && e.data.workspaceId) agentWs.set(e.data.id, e.data.workspaceId);
      store.append(e);
      kept.push(e);
    }
    if (placement.observe(kept)) void placement.flush();
  }
  const guard = <A extends unknown[]>(name: string, fn: (...a: A) => void) => (...a: A) => {
    try { fn(...a); } catch { log(name + ': event skipped'); }
  };

  async function refresh() {
    const evs = await sources.read();
    // Sessions whose workspace became known since they appeared.
    const late: UEvent[] = [];
    for (const e of store.today().events) {
      if (e.e.type === 'agent' && !agentWs.get(e.e.data.id)) {
        const w = sources.workspaceOf(e.e.data.id);
        if (w) { agentWs.set(e.e.data.id, w); late.push({ type: 'agent', data: { id: e.e.data.id, workspaceId: w } } as UEvent); }
      }
    }
    ingest([...evs, ...late]);
  }

  const offs: (() => void)[] = [];
  const on = (name: string, fn: (...a: unknown[]) => void) => { try { offs.push(deps.on(name, guard(name, fn))); } catch { log(name + ': not available'); } };
  // A root session is placed at its first event, not at creation: DSH creates one when the member clicks New Session,
  // and an abandoned blank one would otherwise hold a lot for good and count as running.
  // aggregator.event() emits the agent (with the header's createdAt) the first time it sees the session.
  on('session/created', (s) => {
    const h = (s as SessionLike).header;
    if (h?.parentSession || h?.origin === 'subagent') ingest(aggregator.session(s as SessionLike));
  });
  on('session/event', (s, ev) => ingest(aggregator.event(s as SessionLike, ev as SessionEventLike)));
  on('subagent/start', (info) => ingest(aggregator.subagent(info)));
  on('subagent/end', (info) => ingest(aggregator.subagentEnd(info)));
  on('schedule/changed', () => { void refresh(); });
  on('mcp-manager/status', () => { void refresh(); });
  on('plugin-manager/changed', () => { void refresh(); });

  await refresh().catch(() => log('sources: refresh failed'));
  // Building sizes go into the placement record now and then, so earlier days look as they ended (sizes only).
  let sizedSeq = -1;
  const keepSizes = () => {
    const t = store.today();
    if (t.seq === sizedSeq) return;
    sizedSeq = t.seq;
    const st = createStore();
    st.applyAll(t.events.map((x) => x.e));
    placement.sizes(sizesOf(st, now()));
  };
  const timer = setInterval(() => { void refresh().catch(() => undefined); try { keepSizes(); } catch { /* sizes are best effort */ } void placement.flush(); }, deps.refreshMs ?? 30_000);
  (timer as { unref?: () => void }).unref?.();
  void store.prune();

  let backfillState: SnapshotValue['backfill'] = deps.noBackfill ? 'none' : 'pending';
  const ready = deps.noBackfill ? Promise.resolve() : (async () => {
    try {
      // On DSH 0.2.2-rc.2 the workspace registry is not readable yet when this plugin starts;
      // backfilled sessions would all land in the default district. Wait a little for it.
      for (let waited = 0; !sources.knowsWorkspaces() && waited < (deps.registryWaitMs ?? 5000) && !stopped; waited += 250) {
        await new Promise((r) => setTimeout(r, 250));
        await refresh().catch(() => undefined);
      }
      const r = await backfill({ query: svc('sessionQuery') as SessionQueryLike | undefined, aggregator, dayStart: localMidnight(now()), now });
      // Backfill events first in time. After a restart the backfill re-derives what today's log already holds (same
      // session log, same conversion, same JSON); those are not stored again, or every restart would add a copy of
      // the day. Anything that differs is kept, and the store merges it as before.
      const stored = new Set(store.today().events.map((x) => JSON.stringify(x.e)));
      ingest(r.events.filter((e) => !stored.has(JSON.stringify(e))));
      backfillState = r.sessions === 0 && !r.complete ? 'none' : r.complete ? 'done' : 'partial';
    } catch { backfillState = 'partial'; log('backfill: stopped'); }
  })();

  // 14-day totals of the stored earlier days, read once (today's are counted live).
  const earlier = new Map<string, ReturnType<typeof dayTotals>>();
  void (async () => {
    for (const d of store.days()) if (d !== dayOf(now())) earlier.set(d, dayTotals(d, await store.readDay(d)));
  })().catch(() => undefined);

  const platform = () => dshPlatform(dshCapabilities({ schedules: sources.has('schedule') }));
  function snapshot(): SnapshotValue {
    const t = store.today();
    return {
      platform: platform(), day: t.day, seq: t.seq, events: t.events, truncated: false, full: t.full,
      placement: placement.state(), placementVersion: placement.version(),
      history: [...earlier.values(), dayTotals(t.day, t.events.map((x) => x.e))].sort((a, b) => a.day.localeCompare(b.day)).slice(-14),
      backfill: backfillState,
      storage: deps.storage ?? 'persistent',
    };
  }
  function since(seq: number, limit: number, pv: number): SinceValue {
    const r = store.since(seq, limit);
    return { day: store.today().day, ...r, placementVersion: placement.version(), ...(pv !== placement.version() ? { placement: placement.state() } : {}) };
  }

  return {
    handler: createHandler({ snapshot, since, ...(deps.neighbours ? { neighbours: deps.neighbours } : {}) }),
    snapshot, since, ready, refresh,
    async dispose() {
      stopped = true;
      clearInterval(timer);
      for (const off of offs) { try { off(); } catch { /* already gone */ } }
      await store.dispose();
      try { keepSizes(); } catch { /* best effort */ }
      await placement.flush();
    },
  };
}
