// Calls to this plugin's Host route through the official connection (`connection.rpc.call('/api', ROUTE, …)`).
import type { NeighbourSummary, SinceValue, SnapshotValue } from '@dsh-universe/adapter-dsh';

import { ROUTE, type NeighbourId } from '@dsh-universe/adapter-dsh';

export { ROUTE };
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
export interface Api {
  snapshot(): Promise<Result<SnapshotValue>>;
  since(seq: number, placementVersion: number): Promise<Result<SinceValue>>;
}

const isResult = (v: unknown): v is Result<never> =>
  !!v && typeof v === 'object' && ((v as { ok?: unknown }).ok === true || ((v as { ok?: unknown }).ok === false && typeof (v as { reason?: unknown }).reason === 'string'));

/** The adjacent cities: which tools are on this device, their figures, and one Api per city (only cities turned on). */
export interface NeighbourApi {
  detect(): Promise<Result<{ id: NeighbourId; present: boolean }[]>>;
  summary(ids: readonly NeighbourId[]): Promise<Result<NeighbourSummary[]>>;
  city(id: NeighbourId): Api;
  stop(id: NeighbourId): Promise<Result<boolean>>;
}

export function createApi(rpc: (method: string, payload: unknown) => Promise<unknown>): Api & { neighbours: NeighbourApi } {
  const call = async <T>(method: string, payload?: unknown): Promise<Result<T>> => {
    try {
      // The official rpc wraps our result in its own { ok, value } envelope.
      let r = await rpc(ROUTE, { method, payload });
      if (r && typeof r === 'object' && (r as { ok?: unknown }).ok === true && isResult((r as { value?: unknown }).value)) r = (r as { value: unknown }).value;
      return isResult(r) ? (r as Result<T>) : { ok: false, reason: 'unavailable' };
    } catch { return { ok: false, reason: 'unavailable' }; }
  };
  return {
    snapshot: () => call<SnapshotValue>('snapshot', {}),
    since: (seq, placementVersion) => call<SinceValue>('since', { seq, placementVersion: Math.max(0, placementVersion) }),
    neighbours: {
      detect: () => call('n.detect', {}),
      summary: (ids) => call<NeighbourSummary[]>('n.summary', { ids }),
      city: (id) => ({
        snapshot: () => call<SnapshotValue>('n.snapshot', { id }),
        since: (seq, placementVersion) => call<SinceValue>('n.since', { id, seq, placementVersion: Math.max(0, placementVersion) }),
      }),
      stop: (id) => call('n.stop', { id }),
    },
  };
}
