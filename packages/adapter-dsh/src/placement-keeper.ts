// The host keeps the city's placement (session id → lot) so a building never moves, also after a restart.
// DSH has no other place for it (storageDomain is per host, so desktop and cloud each keep
// their own city).
import { type BuildingSize, cityTemplate, emptyPlacement, freezeTheme, place, readPlacement, type PlacementState, type ThemeId, type UEvent } from '@dsh-universe/model';
import type { KvLike } from './kv.ts';

export const PLACEMENT_KEY = 'placement';

export interface PlacementKeeper {
  load(): Promise<void>;
  /** Feeds model events; root agents get a lot. Returns whether the placement changed. */
  observe(events: readonly UEvent[]): boolean;
  /** A session's theme from its first real title; the first one is kept for good. Returns whether it changed. */
  theme(sessionId: string, theme: ThemeId): boolean;
  /** Records the sizes of today's buildings (no version bump: clients draw today's from the events). */
  sizes(sizes: Record<string, BuildingSize>): void;
  state(): PlacementState;
  /** Bumps when the placement changes. */
  version(): number;
  flush(): Promise<void>;
}

/** `key`: where the placement is kept (an adjacent city keeps its own under its own key). */
export function createPlacementKeeper(o: { table: KvLike; onError?: (e: unknown) => void; key?: string }): PlacementKeeper {
  const KEY = o.key ?? PLACEMENT_KEY;
  const template = cityTemplate();
  let state = emptyPlacement();
  let version = 0;
  let dirty = false;
  const pending = new Map<string, { workspaceId: string; startedAt: number; root: boolean }>();
  return {
    async load() {
      try { state = readPlacement(await o.table.get(KEY)); } catch (e) { o.onError?.(e); }
    },
    observe(events) {
      for (const e of events) {
        if (e.type !== 'agent') continue;
        const d = e.data;
        const p = pending.get(d.id) ?? { workspaceId: '', startedAt: Number.NaN, root: true };
        if (d.workspaceId) p.workspaceId = d.workspaceId;
        if (typeof d.startedAt === 'number') p.startedAt = d.startedAt;
        if (d.parentAgentId || d.kind === 'subagent') p.root = false;
        pending.set(d.id, p);
      }
      const arrivals = [...pending].filter(([id, p]) => p.root && Number.isFinite(p.startedAt) && state.lots[id] === undefined)
        .map(([sessionId, p]) => ({ sessionId, workspaceId: p.workspaceId || 'default', startedAt: p.startedAt }));
      if (!arrivals.length) return false;
      const r = place(template, state, arrivals);
      if (!r.placed.length && r.state.growth === state.growth) return false;
      state = r.state;
      version++;
      dirty = true;
      return true;
    },
    theme(sessionId, theme) {
      const p = pending.get(sessionId);
      if (p && !p.root) return false;
      const next = freezeTheme(state, sessionId, theme);
      if (next === state) return false;
      state = next;
      version++;
      dirty = true;
      return true;
    },
    sizes(sizes) {
      const next = { ...state.sizes };
      let changed = false;
      for (const [id, z] of Object.entries(sizes)) {
        if (state.lots[id] === undefined) continue;
        if (JSON.stringify(next[id]) === JSON.stringify(z)) continue;
        next[id] = z; changed = true;
      }
      if (!changed) return;
      state = { ...state, sizes: next };
      dirty = true;
    },
    state: () => state,
    version: () => version,
    async flush() {
      if (!dirty) return;
      dirty = false;
      try { await o.table.put(KEY, state); } catch (e) { dirty = true; o.onError?.(e); }
    },
  };
}
