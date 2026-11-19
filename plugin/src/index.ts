// Host half: the DSH adapter (aggregator, backfill, sources, day storage, placement) and the route the client reads.
import { PLUGIN_ID, ROUTE_PATH, STORAGE_DOMAIN, memoryKv, startDshHost, type KvLike } from '@dsh-universe/adapter-dsh';
import type { HostCtx, StorageDomainLike } from './host-types.ts';
import { createNeighbours } from './neighbours.ts';

export const name = PLUGIN_ID;
export const inject: readonly string[] = ['connection', 'storageDomain'];

/** `valueSchema` is a zod type in DSH; our values are checked by our own readers, so every value passes here. */
const passthrough = { safeParse: (data: unknown) => ({ success: true, data }), parse: (data: unknown) => data };
export const DOMAIN = { name: STORAGE_DOMAIN, version: 1, tables: { events: { valueSchema: passthrough }, places: { valueSchema: passthrough } } };

export async function apply(ctx: HostCtx): Promise<void> {
  let logger: { warn(m: string): void } | undefined;
  try { logger = ctx.logger?.(PLUGIN_ID); } catch { /* no logger */ }
  const log = (m: string) => { try { logger?.warn(m); } catch { /* logging never breaks activation */ } };
  const optional = (n: string): unknown => { try { return ctx.get?.(n); } catch { return undefined; } };

  let events: KvLike = memoryKv(), places: KvLike = memoryKv(), storage: 'persistent' | 'memory' = 'memory';
  try {
    const domain = await (optional('storageDomain') as StorageDomainLike | undefined)?.open(DOMAIN);
    if (domain) {
      events = domain.table('events');
      places = domain.table('places');
      storage = 'persistent';
      ctx.effect(() => () => { void domain.close(); });
    }
  } catch { log('storage: in memory only'); }

  // Claude Code and Codex on this device: nothing is read until the member turns their city on in the panel.
  const neighbours = createNeighbours({ places, log });
  const host = await startDshHost({
    on: (n, fn) => (ctx.on ? ctx.on(n, fn) : () => {}),
    service: optional,
    events, places, log, storage, neighbours,
  });
  ctx.effect(() => () => { void neighbours.dispose(); });
  // Registered after the storage domain, so it is disposed before the domain closes.
  ctx.effect(() => () => { void host.dispose(); });
  const fetch = ctx.connection?.fetch;
  if (fetch) ctx.effect(() => { const off = fetch.register({ path: ROUTE_PATH, methods: ['POST'], requestBody: 'buffered', fetch: host.handler }); return () => { void off(); }; });
  else log('connection: no route; the panel will say it cannot read');
}
