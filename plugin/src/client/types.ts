import type { ComponentType } from 'react';

export type Translate = (key: string, params?: Record<string, string | number>) => string;
export interface SlotsService {
  inject(owner: string, fn: () => (() => void) | void): void;
  register(options: Record<string, unknown>, component: ComponentType<never>): () => void;
}
export interface LocaleService {
  register(ns: string, tables: Record<string, Record<string, string>>): () => void;
  bind(ns: string): Translate;
}
export interface ClientCtx {
  slots: SlotsService;
  locale: LocaleService;
  effect(fn: () => (() => void) | void): void;
  get(name: string): unknown;
  /** cordis reflection: reads an optional service without declaring it in `inject`. */
  reflect?: { get(name: string): unknown };
  /** cordis optional injection: runs `fn` while the named services are present. */
  inject?(deps: string[], fn: (scope: unknown) => void): void;
}
/** `@deepseek-ai/dsh-client-store` ObservableSnapshot. */
export interface Observable<T> { getSnapshot(): T; subscribe(fn: () => void): () => void }
/** The official client `sessions` service (only the list is read: titles). */
export interface SessionsService { list?: Observable<{ byId?: Record<string, { displayTitle?: string; title?: string } | undefined> }> }
/**
 * Optional host service: session draft signal. Which sessions have an unsent draft in their input box. Ids and booleans only,
 * never text. Missing on official DSH; then drafts do not count.
 */
export interface SessionDraftsService { has(sessionId: string): boolean; list?(): readonly string[]; subscribe?(fn: () => void): () => void }
export interface UiWorkspaceService { openSession?(target: string): void }
export interface ConnectionService { rpc?: { call(channel: string, endpoint: string, payload: unknown): Promise<unknown> } }
/** What the panel and the tile get from the plugin (no host context reaches components). */
export interface Env {
  t: Translate;
  lang(): string;
  feed: import('./feed.ts').Feed;
  titles: Observable<Record<string, string>>;
  seen: import('@dsh-universe/model').Seen;
  /** Unsent drafts; absent when the base has no draft service. */
  drafts?: Observable<import('@dsh-universe/model').Drafts>;
  openSession?(sessionId: string): void;
  /** Shows this plugin's full panel (the tile's click); absent when the host has no layout service. */
  openPanel?(): void;
  /** The moment shown (live: the clock; mock data: the fixture's moment). */
  now(): number;
  /**
   * The adjacent cities (Claude Code, Codex on this device). `detect` says which stores exist (nothing is read);
   * `summary` gives today's figures of the cities shown (on unless the member turned one off); `feed` reads one
   * city in full (when the member looks at it); `stop` turns it off on the host.
   */
  neighbours?: {
    detect(): Promise<readonly import('@dsh-universe/adapter-dsh').NeighbourId[]>;
    summary(ids: readonly import('@dsh-universe/adapter-dsh').NeighbourId[]): Promise<readonly import('@dsh-universe/adapter-dsh').NeighbourSummary[]>;
    feed(id: import('@dsh-universe/adapter-dsh').NeighbourId): import('./feed.ts').Feed;
    stop(id: import('@dsh-universe/adapter-dsh').NeighbourId): void;
  };
}
