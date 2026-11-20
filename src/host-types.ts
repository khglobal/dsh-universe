// Minimal local declarations of the DSH Host interfaces this plugin uses (0.2.2-rc.2).
// Every service but `connection` and `storageDomain` is optional: a missing one degrades, it never stops activation.
export interface KvTableLike {
  get(key: string): unknown;
  put(key: string, value: unknown): Promise<void>;
  delete?(key: string): Promise<unknown>;
  keys?(): Iterable<string>;
  deleteMany?(keys: readonly string[]): Promise<unknown>;
}
export interface DomainLike { table(name: string): KvTableLike; close(): Promise<void> | void }
export interface StorageDomainLike { open(spec: { name: string; version: number; tables: Record<string, { valueSchema: unknown }> }): Promise<DomainLike> }
export interface FetchRegistry { register(route: { path: string; methods: string[]; requestBody: 'buffered'; fetch(request: Request): Promise<Response> }): () => unknown }
export interface HostCtx {
  effect(fn: () => (() => unknown) | void): void;
  get?(name: string): unknown;
  on?(name: string, listener: (...args: unknown[]) => void): () => void;
  connection?: { fetch?: FetchRegistry };
  logger?(name: string): { warn(m: string): void };
}
