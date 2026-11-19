// Two routes for the client: `snapshot` (all of today) and `since` (everything after a number).
// Inputs are checked, sizes are bounded, unknown methods answer `unsupported`, and errors never carry details.
// Wire format, as the other workbench plugins use it: POST { type: 'client-request', rpcId, payload: { method,
// payload } } → { type: 'server-response', rpcId, result }; the client calls connection.rpc.call('/api', ROUTE, …).
import { PLUGIN_SLUG } from './identity.ts';
import type { PlacementState, SeqEvent, UDay, UPlatform } from '@dsh-universe/model';

export const ROUTE = PLUGIN_SLUG;
export const ROUTE_PATH = '/api/' + ROUTE;
export const LIMITS = { bodyBytes: 4096, sinceMax: 2000, snapshotMax: 100_000 };

export type Result<T> = { ok: true; value: T } | { ok: false; reason: 'invalid' | 'unsupported' | 'unavailable' | 'limit' };

export interface SnapshotValue {
  platform: UPlatform; day: string; seq: number; events: SeqEvent[]; truncated: boolean; full: boolean;
  placement: PlacementState; placementVersion: number; history: UDay[]; backfill: 'pending' | 'done' | 'partial' | 'none';
  /** 'memory': the host's storage could not be opened; today is kept in memory only (lost on restart). */
  storage?: 'persistent' | 'memory';
  /** The host's UTC offset now, in minutes east of UTC (480: UTC+8): the client draws the host's day and clock. */
  utcOffset?: number;
}
export interface SinceValue { day: string; seq: number; events: SeqEvent[]; more: boolean; placement?: PlacementState; placementVersion: number; /** Adjacent cities: whether the first read of the store is still going. */ backfill?: SnapshotValue['backfill'] }

/**
 * The adjacent cities, one per vendor: Claude (Claude Code and the Claude desktop app), ChatGPT (Codex) and
 * WorkBuddy. Each is built from one or more sources on this device, shown whenever a source's store is found unless
 * the member turned that source off. Read only while the panel looks at them.
 */
export const NEIGHBOURS = ['claude', 'chatgpt', 'workbuddy'] as const;
export type NeighbourId = typeof NEIGHBOURS[number];
export const isNeighbour = (v: unknown): v is NeighbourId => (NEIGHBOURS as readonly unknown[]).includes(v);
/** The session stores on this device, each with its own switch (ids kept from 0.2: a choice made then carries over). */
export const SOURCES = ['claude-code', 'claude-app', 'codex', 'workbuddy'] as const;
export type SourceId = typeof SOURCES[number];
export const isSource = (v: unknown): v is SourceId => (SOURCES as readonly unknown[]).includes(v);
/** Which sources make up each city, in the order their switches are listed. */
export const CITY_SOURCES: Readonly<Record<NeighbourId, readonly SourceId[]>> = { claude: ['claude-code', 'claude-app'], chatgpt: ['codex'], workbuddy: ['workbuddy'] };
export const cityOfSource = (s: SourceId): NeighbourId => (NEIGHBOURS.find((c) => CITY_SOURCES[c].includes(s)))!;
/** The 0.2 city ids (one per source then): their lots and figures belong to these cities now. */
export const LEGACY_CITY: Readonly<Record<string, NeighbourId>> = { 'claude-code': 'claude', codex: 'chatgpt' };
const sourceList = (v: unknown): SourceId[] | undefined => (v === undefined ? [] : Array.isArray(v) && v.length <= SOURCES.length && v.every(isSource) ? [...new Set(v as SourceId[])] : undefined);
export interface NeighbourRoutes {
  /** Which sources have a session store on this device (folder presence only; nothing is read). */
  detect(): { id: SourceId; present: boolean }[];
  /** `off`: the sources the member turned off (left out of the city). */
  snapshot(id: NeighbourId, off?: readonly SourceId[]): SnapshotValue | Promise<SnapshotValue>;
  since(id: NeighbourId, seq: number, limit: number, placementVersion: number, off?: readonly SourceId[]): SinceValue | Promise<SinceValue>;
  /** Today's figures of each city asked for (this starts its reading; the panel asks only for cities turned on). */
  summary(ids: readonly NeighbourId[], off?: readonly SourceId[]): NeighbourSummary[] | Promise<NeighbourSummary[]>;
  /** A source turned off: stop reading it and forget what was read. */
  stop(id: SourceId): void | Promise<void>;
}
/**
 * An adjacent city's figures now, as its own Today bar counts them: sessions running, failed calls, tokens.
 * `ready`: the first read of its stores is done (until then the figures are what was read so far).
 */
export interface NeighbourSummary { id: NeighbourId; ready: boolean; running: number; errors: number; tokens: number }

export interface RouteDeps {
  snapshot(): SnapshotValue | Promise<SnapshotValue>;
  since(seq: number, limit: number, placementVersion: number): SinceValue | Promise<SinceValue>;
  neighbours?: NeighbourRoutes;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (reason: 'invalid' | 'unsupported' | 'unavailable' | 'limit'): Result<never> => ({ ok: false, reason });
const reply = (rpcId: unknown, result: unknown, status = 200) =>
  new Response(JSON.stringify({ type: 'server-response', rpcId: rpcId ?? null, result }), { status, headers: { 'content-type': 'application/json' } });

export async function dispatch(deps: RouteDeps, method: string, payload: unknown): Promise<Result<unknown>> {
  switch (method) {
    case 'snapshot': {
      if (payload !== undefined && !isRec(payload)) return fail('invalid');
      const v = await deps.snapshot();
      if (v.events.length > LIMITS.snapshotMax) return ok({ ...v, events: v.events.slice(-LIMITS.snapshotMax), truncated: true });
      return ok(v);
    }
    case 'since': {
      if (!isRec(payload)) return fail('invalid');
      const { seq, limit, placementVersion } = payload;
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return fail('invalid');
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) return fail('invalid');
      if (placementVersion !== undefined && (typeof placementVersion !== 'number' || !Number.isInteger(placementVersion) || placementVersion < 0)) return fail('invalid');
      return ok(await deps.since(seq, Math.min(typeof limit === 'number' ? limit : LIMITS.sinceMax, LIMITS.sinceMax), typeof placementVersion === 'number' ? placementVersion : -1));
    }
    case 'n.detect': return deps.neighbours ? ok(deps.neighbours.detect()) : ok([]);
    case 'n.summary': {
      if (!deps.neighbours) return ok([]);
      if (!isRec(payload) || !Array.isArray(payload.ids) || payload.ids.length > NEIGHBOURS.length || !payload.ids.every(isNeighbour)) return fail('invalid');
      const off = sourceList(payload.off);
      if (!off) return fail('invalid');
      return ok(await deps.neighbours.summary([...new Set(payload.ids as NeighbourId[])], off));
    }
    case 'n.snapshot': case 'n.since': case 'n.stop': {
      const nb = deps.neighbours;
      if (!nb) return fail('unsupported');
      if (method === 'n.stop') {
        if (!isRec(payload) || !isSource(payload.id)) return fail('invalid');
        await nb.stop(payload.id);
        return ok(true);
      }
      if (!isRec(payload) || !isNeighbour(payload.id)) return fail('invalid');
      const id = payload.id;
      const off = sourceList(payload.off);
      if (!off) return fail('invalid');
      if (method === 'n.snapshot') {
        const v = await nb.snapshot(id, off);
        return ok(v.events.length > LIMITS.snapshotMax ? { ...v, events: v.events.slice(-LIMITS.snapshotMax), truncated: true } : v);
      }
      const { seq, limit, placementVersion } = payload;
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return fail('invalid');
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) return fail('invalid');
      return ok(await nb.since(id, seq, Math.min(typeof limit === 'number' ? limit : LIMITS.sinceMax, LIMITS.sinceMax), typeof placementVersion === 'number' && Number.isInteger(placementVersion) ? placementVersion : -1, off));
    }
    default:
      return fail('unsupported');
  }
}

export function createHandler(deps: RouteDeps): (request: Request) => Promise<Response> {
  return async (request) => {
    let rpcId: unknown = null;
    try {
      if (request.method !== 'POST') return reply(null, fail('invalid'), 405);
      const declared = Number(request.headers.get('content-length') ?? '0');
      if (declared > LIMITS.bodyBytes) return reply(null, fail('limit'), 413);
      const text = await request.text();
      if (Buffer.byteLength(text) > LIMITS.bodyBytes) return reply(null, fail('limit'), 413);
      let env: unknown;
      try { env = JSON.parse(text); } catch { return reply(null, fail('invalid'), 400); }
      if (!isRec(env) || env.type !== 'client-request') return reply(null, fail('invalid'), 400);
      rpcId = env.rpcId;
      const inner = env.payload;
      if (!isRec(inner) || typeof inner.method !== 'string') return reply(rpcId, fail('invalid'), 400);
      return reply(rpcId, await dispatch(deps, inner.method, inner.payload));
    } catch {
      return reply(rpcId, fail('unavailable'), 500);
    }
  };
}
