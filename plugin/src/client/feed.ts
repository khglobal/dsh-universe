// The client's copy of today: a snapshot, then whatever came after, every couple of seconds while someone looks.
// Framework-neutral (React reads it through useSyncExternalStore).
import { createStore, type PlacementState, type Store, type UDay, type UPlatform } from '@dsh-universe/model';
import type { Api } from './api.ts';

export interface FeedState {
  phase: 'loading' | 'ready' | 'error';
  store: Store;
  platform?: UPlatform;
  day: string;
  seq: number;
  placement?: PlacementState;
  placementVersion: number;
  history: UDay[];
  backfill: 'pending' | 'done' | 'partial' | 'none';
  /** The host keeps today in memory only (its storage could not be opened). */
  memoryOnly: boolean;
  full: boolean;
  /** Bumps on every change. */
  version: number;
}

export interface Feed {
  get(): FeedState;
  subscribe(fn: () => void): () => void;
  retry(): void;
  dispose(): void;
}

/**
 * `appendOnly`: the host only ever appends (an adjacent city): while its first read is still going, the feed keeps
 * asking for what came after instead of reloading the whole day.
 */
export function createFeed(api: Api, o: { intervalMs?: number; appendOnly?: boolean } = {}): Feed {
  let st: FeedState = { phase: 'loading', store: createStore(), day: '', seq: 0, placementVersion: -1, history: [], backfill: 'pending', full: false, memoryOnly: false, version: 0 };
  const subs = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let busy = false, disposed = false, started = false;
  const emit = (patch: Partial<FeedState>) => { st = { ...st, ...patch, version: st.version + 1 }; for (const f of subs) f(); };

  async function load() {
    const r = await api.snapshot();
    if (disposed) return;
    if (!r.ok) { emit({ phase: 'error' }); return; }
    const v = r.value;
    const store = createStore();
    store.applyAll(v.events.map((x) => x.e));
    emit({ phase: 'ready', store, platform: v.platform, day: v.day, seq: v.seq, placement: v.placement, placementVersion: v.placementVersion, history: v.history, backfill: v.backfill, full: v.full, memoryOnly: v.storage === 'memory' });
  }
  async function poll() {
    if (busy || disposed) return;
    busy = true;
    try {
      if (st.phase !== 'ready' || (st.backfill === 'pending' && !o.appendOnly)) { await load(); return; }
      const r = await api.since(st.seq, st.placementVersion);
      if (disposed) return;
      if (!r.ok) { emit({ phase: 'error' }); return; }
      const v = r.value;
      if (v.day !== st.day) { await load(); return; }
      const bf = v.backfill && v.backfill !== st.backfill ? { backfill: v.backfill } : {};
      if (!v.events.length && !v.placement && !bf.backfill) return;
      for (const x of v.events) st.store.apply(x.e);
      emit({ seq: v.seq, ...bf, ...(v.placement ? { placement: v.placement, placementVersion: v.placementVersion } : {}) });
      if (v.more) { busy = false; return poll(); }
    } finally { busy = false; }
  }
  function loop() {
    if (disposed || !subs.size) { started = false; return; }
    timer = setTimeout(() => { void poll().finally(loop); }, o.intervalMs ?? 2000);
  }

  return {
    get: () => st,
    subscribe(fn) {
      subs.add(fn);
      if (!started) { started = true; void poll().finally(loop); }
      return () => { subs.delete(fn); if (!subs.size && timer) { clearTimeout(timer); timer = undefined; started = false; } };
    },
    retry() { emit({ phase: 'loading' }); void load(); },
    dispose() { disposed = true; if (timer) clearTimeout(timer); subs.clear(); },
  };
}

/** A feed over fixed data (mock-data dev mode and tests): the host's routes answered from memory. */
export function fixtureApi(f: { platform: UPlatform; day: string; events: import('@dsh-universe/model').UEvent[]; placement?: PlacementState; history?: UDay[] }): Api {
  const events = f.events.map((e, i) => ({ seq: i + 1, e }));
  return {
    snapshot: async () => ({ ok: true, value: { platform: f.platform, day: f.day, seq: events.length, events, truncated: false, full: false, placement: f.placement ?? { version: 1, growth: 0, growthLog: [], claims: [], lots: {}, workspaces: {} }, placementVersion: 0, history: f.history ?? [], backfill: 'done' } }),
    since: async (seq) => ({ ok: true, value: { day: f.day, seq: Math.max(seq, events.length), events: [], more: false, placementVersion: 0 } }),
  };
}
