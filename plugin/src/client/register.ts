// Client half: three registrations. The `main` panel and its sidebar entry (official DSH); the `workbench.tile`
// tile and the workbench centre entry only when the host provides a workbench (optional, nothing breaks without).
import { createElement } from 'react';
import { createSeen } from '@dsh-universe/model';
import { PLUGIN_ID, PLUGIN_SLUG } from '@dsh-universe/adapter-dsh';
import { NS, PANEL, en, zh } from '../locales/index.ts';
import { createApi } from './api.ts';
import { createFeed, type Feed } from './feed.ts';
import type { NeighbourId } from '@dsh-universe/adapter-dsh';
import { translator } from './format.ts';
import { Tile, type TileProps } from './Tile.tsx';
import type { ClientCtx, ConnectionService, Env, Observable, SessionDraftsService, SessionsService, UiWorkspaceService } from './types.ts';
import { DRAFTS_SERVICE, draftsOf, reflected } from './drafts.ts';
import { UniversePanel } from './UniversePanel.tsx';
import { SidebarIcon } from './sidebar-icon.ts';
import './interior-view.ts';

export const name = PLUGIN_ID;
export const inject = ['slots', 'locale'] as const;
export const SEEN_STORAGE_KEY = PLUGIN_SLUG + '.seen.dsh';


/** Session titles from the official client list (never stored by this plugin). */
function titlesOf(get: () => SessionsService | undefined): Observable<Record<string, string>> {
  let cache: Record<string, string> = {};
  let src: unknown;
  const read = () => {
    const list = get()?.list;
    const snap = list?.getSnapshot();
    if (snap === src) return cache;
    src = snap;
    const out: Record<string, string> = {};
    for (const [id, row] of Object.entries(snap?.byId ?? {})) { const v = row?.displayTitle ?? row?.title; if (v) out[id] = v; }
    cache = out;
    return cache;
  };
  return {
    getSnapshot: read,
    subscribe: (fn) => { try { return get()?.list?.subscribe(fn) ?? (() => {}); } catch { return () => {}; } },
  };
}

export function createEnv(ctx: ClientCtx): Env {
  const t = translator(ctx.locale.bind(NS));
  const opt = <T,>(n: string): T | undefined => { try { return ctx.get(n) as T | undefined; } catch { return undefined; } };
  const api = createApi((method, payload) => {
    const c = opt<ConnectionService>('connection');
    return c?.rpc ? c.rpc.call('/api', method, payload) : Promise.reject(new Error('no connection'));
  });
  const feed = createFeed(api);
  // One feed per adjacent city, made when the member first looks at it (its figures come from `summary` until
  // then), dropped when it is turned off.
  const nfeeds = new Map<NeighbourId, Feed>();
  const seen = createSeen({
    read: () => globalThis.localStorage?.getItem(SEEN_STORAGE_KEY),
    write: (v) => globalThis.localStorage?.setItem(SEEN_STORAGE_KEY, v),
  });
  return {
    t,
    // The host's current language, read back from our own table (the locale service does not expose it).
    lang: () => (/[\u4e00-\u9fff]/.test(t('li.none')) ? 'zh-CN' : 'en'),
    feed, seen,
    titles: titlesOf(() => opt<SessionsService>('sessions')),
    drafts: draftsOf(() => reflected<SessionDraftsService>(ctx, DRAFTS_SERVICE)),
    openSession: (id) => { opt<UiWorkspaceService>('uiWorkspace')?.openSession?.(id); },
    // The official layout service selects a `main` panel by its key (as the workbench opens its own home).
    openPanel: () => { try { opt<{ selectPanel?(id: string | null): void }>('layout')?.selectPanel?.(PANEL); } catch { /* not ready */ } },
    now: Date.now,
    neighbours: {
      detect: async () => { const r = await api.neighbours.detect(); return r.ok ? r.value.filter((x) => x.present).map((x) => x.id) : []; },
      summary: async (ids) => { if (!ids.length) return []; const r = await api.neighbours.summary(ids); return r.ok ? r.value : []; },
      feed: (id) => { let f = nfeeds.get(id); if (!f) nfeeds.set(id, f = createFeed(api.neighbours.city(id), { appendOnly: true, intervalMs: 3000 })); return f; },
      stop: (id) => { nfeeds.get(id)?.dispose(); nfeeds.delete(id); void api.neighbours.stop(id); },
    },
  };
}

export function apply(ctx: ClientCtx): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }));
  const env = createEnv(ctx);
  ctx.effect(() => () => env.feed.dispose());
  const Panel = () => createElement(UniversePanel, { env });
  const TileView = (p: TileProps) => createElement(Tile, { env, ...p });
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL, label: () => env.t('title') }, Panel as never));
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL, order: 20, label: () => env.t('title') }, SidebarIcon as never));
  // Optional: waits for the workbench to declare its tile slot; on official DSH it never runs.
  ctx.slots.inject('workbench.tile', () => ctx.slots.register({
    name: 'workbench.tile', id: name + '#today', order: 50, label: () => env.t('tile.label'),
    inject: () => ({ sizes: [{ w: 4, h: 2 }, { w: 2, h: 2 }, { w: 4, h: 1 }] }),
  }, TileView as never));
}
