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
import { carryOver, STANDING } from './rollover.ts';

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

/** The host's UTC offset at t, in minutes east of UTC (480 for UTC+8). */
export const utcOffsetAt = (t: number) => -new Date(t).getTimezoneOffset();
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
  // 14-day totals of the stored earlier days (today's are counted live; a day that ends while DSH runs is added).
  const earlier = new Map<string, ReturnType<typeof dayTotals>>();
  // Every session's own (agent) events seen since start, and which sessions today's log has announced: a session
  // that ended yesterday and goes on today is announced again before its first event of the day.
  const agentEvents = new Map<string, UEvent[]>();
  const todayAgents = new Set<string>();
  const noteAgent = (e: UEvent) => {
    if (e.type !== 'agent') return;
    const list = agentEvents.get(e.data.id);
    if (list) { if (list.length < 16) list.push(e); } else agentEvents.set(e.data.id, [e]);
    todayAgents.add(e.data.id);
  };
  const store = createDayStore({
    table: deps.events, now, flushMs: deps.flushMs, onError,
    // Midnight with DSH open: yesterday goes into the 14-day totals, and the new day starts with the standing things
    // and the sessions still at work or waiting (rollover.ts).
    carry: (day, prev) => {
      const evs = prev.map((x) => x.e);
      earlier.set(day, dayTotals(day, evs));
      const seed = carryOver(evs, now());
      todayAgents.clear();
      for (const e of seed) if (e.type === 'agent') todayAgents.add(e.data.id);
      return seed;
    },
  });
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
  // Stored records are checked as they are read (storage.ts storedEvent); one that still trips is skipped, never the start.
  for (const { e } of store.today().events) {
    try {
      if (e.type === 'agent' && e.data.workspaceId) agentWs.set(e.data.id, e.data.workspaceId);
      noteAgent(e);
      if (STANDING.has(e.type)) lastSource.set(e.type + ':' + ((e.data as { id?: string }).id ?? ''), JSON.stringify(e.data));
    } catch { log('storage: record skipped'); }
  }
  try { placement.observe(store.today().events.map((x) => x.e)); } catch { log('placement: observe skipped'); }

  function ingest(events: readonly UEvent[]) {
    if (stopped || !events.length) return;
    const kept: UEvent[] = [];
    store.day();   // a new day starts (and carries over) before anything is added to it
    for (const e of events) {
      // A session announced on an earlier day: its own events come first again.
      const aid = e.type === 'agent' ? undefined : (e.data as { agentId?: unknown }).agentId;
      if (typeof aid === 'string' && !todayAgents.has(aid)) {
        const chain: UEvent[] = [];
        for (let id: string | undefined = aid, k = 0; id && !todayAgents.has(id) && k < 8; k++) {
          const own = agentEvents.get(id);
          if (!own) break;
          chain.unshift(...own);
          id = own.map((x) => (x.data as { parentAgentId?: string }).parentAgentId).find((p) => !!p);
        }
        for (const x of chain) { store.append(x); kept.push(x); todayAgents.add((x.data as { id: string }).id); }
      }
      if (e.type === 'workspace' || e.type === 'schedule' || e.type === 'connector' || e.type === 'inventory') {
        const k = e.type + ':' + ((e.data as { id?: string }).id ?? '');
        const v = JSON.stringify(e.data);
        if (lastSource.get(k) === v) continue;
        lastSource.set(k, v);
      }
      if (e.type === 'agent' && e.data.workspaceId) agentWs.set(e.data.id, e.data.workspaceId);
      noteAgent(e);
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

  // The stored earlier days, read once at start.
  void (async () => {
    for (const d of store.days()) if (d !== dayOf(now()) && !earlier.has(d)) earlier.set(d, dayTotals(d, await store.readDay(d)));
  })().catch(() => undefined);

  const platform = () => dshPlatform(dshCapabilities({ schedules: sources.has('schedule') }));
  function snapshot(): SnapshotValue {
    const t = store.today();
    return {
      platform: platform(), day: t.day, seq: t.seq, events: t.events, truncated: false, full: t.full,
      placement: placement.state(), placementVersion: placement.version(),
      history: [...earlier.values()].filter((d) => d.day !== t.day).concat(dayTotals(t.day, t.events.map((x) => x.e))).sort((a, b) => a.day.localeCompare(b.day)).slice(-14),
      backfill: backfillState,
      storage: deps.storage ?? 'persistent',
      utcOffset: utcOffsetAt(now()),
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
