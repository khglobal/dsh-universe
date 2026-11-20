// Unsent drafts (counted under "to review"), read from an optional host service: session draft signal.
import type { Drafts } from '@dsh-universe/model';
import type { ClientCtx, Observable, SessionDraftsService } from './types.ts';

/**
 * Optional host service: session draft signal. `has(id)`, `list()`, `subscribe(listener)` (set changes only,
 * debounced 300 ms).
 */
export const DRAFTS_SERVICE = 'workdshSessionDrafts';

/**
 * Drafts as an observable of a `has` view. The snapshot changes identity on every service notification so React
 * re-renders; any failure of the service reads as "no drafts".
 */
export function draftsOf(get: () => SessionDraftsService | undefined): Observable<Drafts> {
  const none = { has: () => false };
  let snap: Drafts = { has: (id) => { try { return get()?.has(id) === true; } catch { return false; } } };
  return {
    getSnapshot: () => (get() ? snap : none),
    subscribe: (fn) => {
      try {
        return get()?.subscribe?.(() => { snap = { has: snap.has }; fn(); }) ?? (() => {});
      } catch { return () => {}; }
    },
  };
}


/** An optional service through `ctx.reflect.get` (where the host provides it), else `ctx.get`; never throws. */
export function reflected<T>(ctx: ClientCtx, name: string): T | undefined {
  try { return (ctx.reflect ? ctx.reflect.get(name) : ctx.get(name)) as T | undefined; } catch { return undefined; }
}

