// The other DSH sources: workspaces, schedules, MCP connectors and the
// plugin list. Every service is optional; a missing one gives nothing and the matching capability is false.
// Only names, ids, states and times are kept (schedule prompts and MCP configuration are never read).
import type { UEvent } from '@dsh-universe/model';
import { sanitize } from '@dsh-universe/adapter-kit';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const s = (v: unknown) => (typeof v === 'string' ? v : undefined);

export interface SourceServices {
  /** `workspaceRegistry.list()` rows: `{ id, path, title, sessionIds }`. */
  workspaceRegistry?: { list?(): readonly unknown[] };
  /** `schedule.list({ limit })` → `{ items }`. */
  schedule?: { list?(input: { limit?: number }): Promise<unknown> | unknown };
  /** `mcpManager.list()` → `{ name, configured, status: { state } }[]`. */
  mcpManager?: { list?(): readonly unknown[] };
  /** `pluginInventory.list()` → `{ entries: { moduleName, enabled }[] }`: every Host module, built-ins included. */
  pluginInventory?: { list?(): Promise<unknown> | unknown };
  /** `pluginManager.listBundles()` → `{ name, installed, enabled, meta: { title }, rows: { moduleName, entryId }[] }[]`:
   *  `installed` = the member added it to the profile; `enabled` = selected in the profile manifest. */
  pluginManager?: { listBundles?(): Promise<unknown> | unknown };
  /** Astero's connector service (`workdshConnectors.list()` → `{ serverName, title, titles: { zh, en } }[]`): only
   *  the display names of the MCP servers are read. Absent in official DSH, where a server is named by its id. */
  workdshConnectors?: { list?(): Promise<unknown> | unknown };
}

/** Display text from DSH's `LocalizedText` (a literal, or translations by lowercase language id with `en` required):
 *  `title` is the English or literal text, `titleZh` the Chinese one when there is one. */
export function localized(v: unknown): { title?: string; titleZh?: string } {
  if (typeof v === 'string') return v.trim() ? { title: v } : {};
  const x = rec(v);
  const en = s(x.en)?.trim() || undefined;
  const zh = (s(x.zh) ?? s(x['zh-cn']) ?? s(x['zh-hans']))?.trim() || undefined;
  const title = en ?? zh ?? Object.values(x).find((y): y is string => typeof y === 'string' && y.trim() !== '');
  return { ...(title ? { title } : {}), ...(zh && zh !== title ? { titleZh: zh } : {}) };
}

const MCP_STATE: Record<string, 'connected' | 'connecting' | 'failed' | 'disabled' | 'unknown'> = {
  connected: 'connected', connecting: 'connecting', reconnecting: 'connecting', 'waiting-credentials': 'connecting',
  failed: 'failed', disabled: 'disabled', closed: 'disabled',
};

/** The display path of a workspace: the folder name only (the full path never leaves the host). */
export const folderOf = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';

const trimSep = (p: string) => p.replace(/[\\/]+$/, '');
/** The workspace whose folder is `cwd` or contains it; the longest folder wins. '' when none. */
export function folderMatch(folders: readonly { id: string; path: string }[], cwd: string): string {
  const c = trimSep(cwd);
  let best = '', len = -1;
  for (const f of folders) {
    if (!f.path) continue;
    const inside = c === f.path || (c.startsWith(f.path) && (c[f.path.length] === '/' || c[f.path.length] === '\\'));
    if (inside && f.path.length > len) { best = f.id; len = f.path.length; }
  }
  return best;
}

export interface Sources {
  /** Reads every source now; returns model events (deduplicated by the store). */
  read(): Promise<UEvent[]>;
  /** The session's workspace: from the registry, else the workspace whose folder holds `cwd`; '' when neither. */
  workspaceOf(sessionId: string, cwd?: string): string;
  mcpServers(): string[];
  /** Whether the workspace registry has been read with at least one workspace. */
  knowsWorkspaces(): boolean;
  has(name: keyof SourceServices): boolean;
}

export function createSources(get: () => SourceServices, log: (m: string) => void = () => {}): Sources {
  const wsOfSession = new Map<string, string>();
  // Workspace folders, only for matching a new session's cwd on the host (DSH 0.2.2-rc.2 lists a session in the
  // registry only after `session/created`). Never sent anywhere.
  let folders: { id: string; path: string }[] = [];
  let servers: string[] = [];
  const out = (list: unknown[]) => list.map(sanitize).filter((e): e is UEvent => e !== undefined);
  const safe = async <T>(name: string, fn: () => Promise<T> | T): Promise<T | undefined> => {
    try { return await fn(); } catch { log(name + ': not readable'); return undefined; }
  };

  return {
    async read() {
      const svc = get();
      const r: unknown[] = [];
      const rows = await safe('workspaces', () => svc.workspaceRegistry?.list?.());
      if (Array.isArray(rows)) folders = [];
      if (Array.isArray(rows)) for (const w of rows) {
        const x = rec(w), id = s(x.id);
        if (!id) continue;
        const path = s(x.path) ?? '';
        if (path) folders.push({ id, path: trimSep(path) });
        r.push({ type: 'workspace', data: { id, title: s(x.title) || folderOf(path), displayPath: folderOf(path) } });
        if (Array.isArray(x.sessionIds)) for (const sid of x.sessionIds) if (typeof sid === 'string') wsOfSession.set(sid, id);
      }
      const sch = rec(await safe('schedule', () => svc.schedule?.list?.({ limit: 100 })));
      if (Array.isArray(sch.items)) for (const it of sch.items) {
        const x = rec(it), id = s(x.id);
        if (!id) continue;
        const status = s(x.status);
        const nextAt = status === 'active' && s(x.scheduledAt) ? Date.parse(s(x.scheduledAt)!) : undefined;
        const last = rec(x.lastDelivery);
        const lastAt = s(last.deliveredAt) ? Date.parse(s(last.deliveredAt)!) : undefined;
        r.push({ type: 'schedule', data: {
          id, title: s(x.title) ?? '', status: status === 'paused' || status === 'ended' ? status : 'active',
          ...(nextAt !== undefined && Number.isFinite(nextAt) ? { nextAt } : {}),
          runs: lastAt !== undefined && Number.isFinite(lastAt) ? [{ at: lastAt, ...(s(last.targetSessionId) ? { agentId: s(last.targetSessionId) } : {}) }] : [],
        } });
      }
      const mcp = await safe('mcp', () => svc.mcpManager?.list?.());
      if (Array.isArray(mcp)) {
        servers = [];
        const names = await connectorNames(svc);
        for (const m of mcp) {
          const x = rec(m), name = s(x.name);
          if (!name) continue;
          servers.push(name);
          // The connection's display name where the host has one (Astero ERP for `a_kh_erp`), else the server id.
          const named = names.get(name);
          r.push({ type: 'connector', data: { id: name, title: named?.title ?? name, ...(named?.titleZh ? { titleZh: named.titleZh } : {}), state: MCP_STATE[s(rec(x.status).state) ?? ''] ?? 'unknown' } });
        }
      }
      // Plugins the member installed, not the Host's own modules: the plugin manager's bundles the profile declares
      // (only names and on/off). Without a plugin manager, the module inventory minus DSH's own packages.
      const bundles = await safe('bundles', () => svc.pluginManager?.listBundles?.());
      const inv = rec(await safe('plugins', () => svc.pluginInventory?.list?.()));
      const entries = Array.isArray(inv.entries) ? inv.entries : undefined;
      if (Array.isArray(bundles)) {
        r.push({ type: 'inventory', data: { plugins: memberPlugins(bundles, entries) } });
      } else if (entries) {
        r.push({ type: 'inventory', data: { plugins: entries.map((e) => rec(e)).filter((e) => s(e.moduleName) && !BUILT_IN.test(s(e.moduleName)!))
          .map((e) => ({ id: s(e.moduleName)!, enabled: e.enabled === true, ...localized(rec(e.meta).title) })) } });
      }
      return out(r);
    },
    workspaceOf: (sid, cwd) => wsOfSession.get(sid) ?? (cwd ? folderMatch(folders, cwd) : ''),
    mcpServers: () => servers.slice(),
    knowsWorkspaces: () => folders.length > 0,
    has: (name) => { try { return get()[name] !== undefined; } catch { return false; } },
  };
}

/** DSH's own packages (Host modules, not member plugins). */
const BUILT_IN = /^@deepseek-ai\//;
type MemberPlugin = { id: string; enabled: boolean; title?: string; titleZh?: string };
/**
 * The member's plugins from `pluginManager.listBundles()`: bundles the profile declares, by package name, with the
 * display title DSH's own plugin list shows (`meta.title`, else the first row's, else the package name).
 * On when it runs: selected in the profile, or any of its rows is a live, enabled Loader entry in the module
 * inventory (base plugins a host loads through its own rows rather than the bundle selection).
 */
export function memberPlugins(bundles: readonly unknown[], inventory: readonly unknown[] = []): MemberPlugin[] {
  const live = new Set<string>(), liveModules = new Set<string>();
  for (const e of inventory) {
    const x = rec(e);
    const running = x.enabled === true && x.fiberPhase !== 'failed' && x.fiberPhase !== 'unloading';
    if (!running) continue;
    if (s(x.entryId)) live.add(s(x.entryId)!);
    if (s(x.moduleName)) liveModules.add(s(x.moduleName)!);
  }
  const out: MemberPlugin[] = [];
  for (const b of bundles) {
    const x = rec(b);
    const name = s(x.name) ?? '';
    if (!name || x.installed !== true) continue;
    const rows = Array.isArray(x.rows) ? x.rows.map(rec) : [];
    const running = x.enabled === true || liveModules.has(name)
      || rows.some((row) => (s(row.entryId) !== undefined && live.has(s(row.entryId)!)) || (s(row.moduleName) !== undefined && liveModules.has(s(row.moduleName)!)));
    const label = localized(rec(x.meta).title);
    const named = label.title ? label : localized(rows.map((row) => rec(row.meta).title).find((t) => t !== undefined));
    out.push({ id: name, enabled: running, ...named });
  }
  return out;
}

/** MCP display names by server name, from the host's connector service when there is one (names only). */
async function connectorNames(svc: SourceServices): Promise<Map<string, { title?: string; titleZh?: string }>> {
  const out = new Map<string, { title?: string; titleZh?: string }>();
  let list: unknown;
  try { list = await svc.workdshConnectors?.list?.(); } catch { return out; }
  if (!Array.isArray(list)) return out;
  for (const c of list) {
    const x = rec(c), server = s(x.serverName);
    if (!server || out.has(server)) continue;
    const titles = rec(x.titles);
    const named = s(titles.en) || s(titles.zh) ? localized({ en: s(titles.en) ?? s(titles.zh) ?? '', zh: s(titles.zh) ?? '' }) : localized(s(x.title));
    if (named.title) out.set(server, named);
  }
  return out;
}
