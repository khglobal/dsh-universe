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
}
export interface SinceValue { day: string; seq: number; events: SeqEvent[]; more: boolean; placement?: PlacementState; placementVersion: number; /** Adjacent cities: whether the first read of the store is still going. */ backfill?: SnapshotValue['backfill'] }

/** The adjacent cities (Claude Code, Codex on this device), read only after the member turned one on. */
export const NEIGHBOURS = ['claude-code', 'codex'] as const;
export type NeighbourId = typeof NEIGHBOURS[number];
export const isNeighbour = (v: unknown): v is NeighbourId => v === 'claude-code' || v === 'codex';
export interface NeighbourRoutes {
  /** Which tools have a session store on this device (folder presence only; nothing is read). */
  detect(): { id: NeighbourId; present: boolean }[];
  snapshot(id: NeighbourId): SnapshotValue | Promise<SnapshotValue>;
  since(id: NeighbourId, seq: number, limit: number, placementVersion: number): SinceValue | Promise<SinceValue>;
  /** Turned off: stop reading and forget what was read. */
  stop(id: NeighbourId): void | Promise<void>;
}

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
    case 'n.snapshot': case 'n.since': case 'n.stop': {
      const nb = deps.neighbours;
      if (!nb) return fail('unsupported');
      if (!isRec(payload) || !isNeighbour(payload.id)) return fail('invalid');
      const id = payload.id;
      if (method === 'n.stop') { await nb.stop(id); return ok(true); }
      if (method === 'n.snapshot') {
        const v = await nb.snapshot(id);
        return ok(v.events.length > LIMITS.snapshotMax ? { ...v, events: v.events.slice(-LIMITS.snapshotMax), truncated: true } : v);
      }
      const { seq, limit, placementVersion } = payload;
      if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) return fail('invalid');
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1)) return fail('invalid');
      return ok(await nb.since(id, seq, Math.min(typeof limit === 'number' ? limit : LIMITS.sinceMax, LIMITS.sinceMax), typeof placementVersion === 'number' && Number.isInteger(placementVersion) ? placementVersion : -1));
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
