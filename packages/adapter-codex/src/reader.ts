// Codex's local session store → model events. Metadata only.
//
// Layout (Codex CLI rollout files): `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<thread id>.jsonl`, archived ones in
// `~/.codex/archived_sessions/`. One JSON object per line: `{ timestamp, type, payload }`.
//
// Read, by field name only:
// - `session_meta`: `payload.id`, `payload.cwd` (folder name and a hash only leave this file), and of
//   `payload.source` only the parent thread id and the agent role of a spawned subagent
//   (`source.subagent.thread_spawn.{parent_thread_id, agent_role}`);
// - `turn_context`: `payload.model`, `payload.cwd`;
// - `response_item`: `payload.type`, and for `function_call`, `custom_tool_call`, `local_shell_call` and
//   `web_search_call` only `name` and `call_id`; for `*_output` items only `call_id`;
// - `event_msg`: `payload.type`; `token_count` → `payload.info.last_token_usage.{input_tokens, cached_input_tokens,
//   output_tokens}`; `exec_command_end` → `call_id`, `exit_code`; `patch_apply_end` → `call_id`, `success`;
//   `mcp_tool_call_end` → `call_id` and whether `result` holds `Err`; `task_started`, `task_complete`,
//   `turn_aborted`, `error`, `stream_error` → the type and the time only.
// Never read: messages, reasoning, `user_message`, `agent_message`, `instructions`, tool `arguments`, `input` and
// `output`, command lines, patches, error messages, `history.jsonl` (prompts), `session_index.jsonl` thread names
// (not verifiably member-set) and the state databases. Codex has no member-set title in its rollout files, so
// sessions are named by project folder and day.
import { basename, join } from 'node:path';
import { categoryOf, type CategoryTable, type Category } from '@dsh-universe/model';
import { folderName, isoTimeOf, listFiles, pathId, type FileRef, type LineCtx, type StoreReader } from '@dsh-universe/adapter-kit/local';

const T: Record<string, Category> = {};
const put = (c: Category, ...names: string[]) => { for (const n of names) T[n] = c; };
put('read', 'read_file', 'view_image', 'list_mcp_resources', 'read_mcp_resource');
put('search', 'list_dir', 'grep_files', 'file_search');
put('edit', 'apply_patch');
put('exec', 'shell', 'exec_command', 'write_stdin', 'local_shell', 'unified_exec');
put('web', 'web_search');
put('delegate', 'spawn_agent', 'send_input', 'wait', 'close_agent', 'resume_agent');
put('plan', 'update_plan');
/** MCP tools are named `<server>__<tool>`. */
const MCP = /^(?:mcp__)?([A-Za-z0-9_.-]+?)__[A-Za-z0-9]/;
export const CODEX_TOOLS: CategoryTable = { platform: 'codex', tools: T, connectorOf: (tool) => (T[tool] ? undefined : MCP.exec(tool)?.[1]) };
export const STALE_MS = 30 * 60_000;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export interface CxFile {
  agentId: string;
  parent?: string;
  role?: string;
  /** The project folder: its name and a hash of its path (the path itself is never kept). */
  ws?: string;
  folder?: string;
  model?: string;
  announced: boolean;
  turnOpen: boolean;
  lastT: number;
  calls: Map<string, { t: number; name: string; ok?: boolean }>;
  usageN: number;
}

/** The thread id at the end of a rollout file name (`rollout-2026-11-19T09-00-00-<uuid>.jsonl`). */
const idOfName = (path: string) => /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(basename(path))?.[1] ?? basename(path, '.jsonl');
/** Record types worth parsing. */
const WANTED = /"type":"(?:session_meta|turn_context|response_item|event_msg)"/;
const TOOL_ITEMS = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call']);
const OUTPUT_ITEMS = new Set(['function_call_output', 'custom_tool_call_output']);

export function codexReader(home: string): StoreReader<CxFile> {
  const root = join(home, '.codex');
  return {
    async list(since, tick) {
      const live = await listFiles(join(root, 'sessions'), (rel) => /^\d{4}\/\d\d\/\d\d\/rollout-[^/]+\.jsonl$/.test(rel), { depth: 3, since, tick });
      const archived = await listFiles(join(root, 'archived_sessions'), (rel) => /^rollout-[^/]+\.jsonl$/.test(rel), { depth: 0, since, tick });
      return [...live, ...archived];
    },
    open: (f: FileRef): CxFile => ({ agentId: idOfName(f.path), announced: false, turnOpen: false, lastT: 0, calls: new Map(), usageN: 0 }),
    timeOf: isoTimeOf,
    head(st, lines) { for (const l of lines.slice(0, 5)) { const o = parse(l); if (o?.type === 'session_meta') sessionMeta(st, rec(o.payload)); } },
    tail(st, lines, ctx) {
      let last: number | undefined, failed = false;
      for (const l of lines) {
        const o = parse(l);
        const t = Date.parse(str(o?.timestamp) ?? '');
        if (!o || !Number.isFinite(t)) continue;
        last = t;
        if (o.type === 'event_msg') { const k = rec(o.payload).type; if (k === 'error') failed = true; else if (k === 'task_started' || k === 'task_complete') failed = false; }
      }
      if (!st.parent && last !== undefined) ctx.mark(last, st.agentId, failed);
    },
    line(st, l, ctx) {
      if (!WANTED.test(l)) return;
      const o = parse(l);
      if (o) onLine(st, o, ctx);
    },
    settle(st, ctx) {
      if (st.turnOpen && st.announced && ctx.now - st.lastT > STALE_MS) {
        st.turnOpen = false;
        ctx.emit({ type: 'turn', data: { t: st.lastT, agentId: st.agentId, phase: 'end', reason: 'other' } });
      }
    },
  };
}

const parse = (l: string): Rec | undefined => { try { return rec(JSON.parse(l)); } catch { return undefined; } };
function sessionMeta(st: CxFile, p: Rec) {
  const id = str(p.id);
  if (id && !st.announced) st.agentId = id;
  if (!st.ws && str(p.cwd)) folderOf(st, str(p.cwd)!);
  const spawn = rec(rec(rec(p.source).subagent).thread_spawn);
  const parent = str(spawn.parent_thread_id);
  if (parent) { st.parent = parent; const role = str(spawn.agent_role); if (role) st.role = role.slice(0, 80); }
}
const folderOf = (st: CxFile, cwd: string) => { st.ws = 'p:' + pathId(cwd); st.folder = folderName(cwd); };
const workspaceOf = (st: CxFile) => st.ws ?? 'p:unknown';

function announce(st: CxFile, t: number, ctx: LineCtx) {
  if (st.announced) return;
  st.announced = true;
  const ws = workspaceOf(st);
  if (ctx.once(ws)) ctx.emit({ type: 'workspace', data: { id: ws, title: st.folder ?? '', displayPath: st.folder ?? '' } });
  ctx.emit({ type: 'agent', data: {
    id: st.agentId, sessionId: st.parent ?? st.agentId, workspaceId: ws, label: '', engine: 'codex',
    kind: st.parent ? 'subagent' : 'main', ...(st.parent ? { parentAgentId: st.parent } : {}), ...(st.role ? { role: st.role } : {}),
    ...(st.model ? { model: st.model } : {}), state: 'running', startedAt: t,
  } });
}

function call(st: CxFile, ctx: LineCtx, t: number, id: string, name: string) {
  if (st.calls.has(id)) return;
  st.calls.set(id, { t, name });
  const category = categoryOf(CODEX_TOOLS, name);
  const connectorId = category === 'connector' ? CODEX_TOOLS.connectorOf(name) : undefined;
  ctx.emit({ type: 'activity', data: { id, t, agentId: st.agentId, category, tool: name, ...(connectorId ? { connectorId } : {}) } });
}
function result(st: CxFile, ctx: LineCtx, t: number, id: string, ok?: boolean) {
  const c = st.calls.get(id);
  if (!c) return;
  if (ok !== undefined) c.ok = ok;
  const category = categoryOf(CODEX_TOOLS, c.name);
  const connectorId = category === 'connector' ? CODEX_TOOLS.connectorOf(c.name) : undefined;
  ctx.emit({ type: 'activity', data: { id, t: c.t, agentId: st.agentId, category, tool: c.name, durationMs: Math.max(0, t - c.t), ...(c.ok !== undefined ? { ok: c.ok } : {}), ...(connectorId ? { connectorId } : {}) } });
}

function onLine(st: CxFile, o: Rec, ctx: LineCtx) {
  const p = rec(o.payload);
  if (o.type === 'session_meta') { sessionMeta(st, p); }
  if (o.type === 'turn_context') {
    if (!st.ws && str(p.cwd)) folderOf(st, str(p.cwd)!);
    const m = str(p.model);
    if (m && m !== st.model) { st.model = m; if (st.announced) ctx.emit({ type: 'agent', data: { id: st.agentId, model: m } }); }
  }
  const t = Date.parse(str(o.timestamp) ?? '');
  if (!Number.isFinite(t)) return;
  const kind = str(p.type);
  if (!st.parent) ctx.mark(t, st.agentId, o.type === 'event_msg' && kind === 'error');
  if (t < ctx.dayStart || o.type === 'session_meta' || o.type === 'turn_context') return;
  announce(st, t, ctx);
  st.lastT = Math.max(st.lastT, t);
  const agentId = st.agentId;
  if (o.type === 'response_item') {
    if (kind && TOOL_ITEMS.has(kind)) {
      const id = str(p.call_id) ?? str(p.id);
      const name = kind === 'local_shell_call' ? 'local_shell' : kind === 'web_search_call' ? 'web_search' : str(p.name);
      if (id && name) call(st, ctx, t, id, name);
      if (id && kind === 'web_search_call') result(st, ctx, t, id);
    } else if (kind && OUTPUT_ITEMS.has(kind)) {
      const id = str(p.call_id);
      if (id) result(st, ctx, t, id);
    }
    return;
  }
  if (o.type !== 'event_msg') return;
  switch (kind) {
    case 'task_started': if (!st.turnOpen) { st.turnOpen = true; ctx.emit({ type: 'turn', data: { t, agentId, phase: 'start' } }); } return;
    case 'task_complete': st.turnOpen = false; ctx.emit({ type: 'turn', data: { t, agentId, phase: 'end', reason: 'completed' } }); return;
    case 'turn_aborted': st.turnOpen = false; ctx.emit({ type: 'turn', data: { t, agentId, phase: 'end', reason: 'cancelled' } }); return;
    case 'error': st.turnOpen = false; ctx.emit({ type: 'turn', data: { t, agentId, phase: 'end', reason: 'error' } }); return;
    case 'stream_error': ctx.emit({ type: 'retry', data: { id: 'r' + t, t, agentId, attempt: 1 } }); return;
    case 'token_count': {
      const u = rec(rec(p.info).last_token_usage);
      const input = num(u.input_tokens), cached = num(u.cached_input_tokens) ?? 0, output = num(u.output_tokens);
      if (input === undefined && output === undefined) return;
      ctx.emit({ type: 'usage', data: { id: 'u' + t + ':' + st.usageN++, t, agentId, model: st.model ?? '', input: Math.max(0, (input ?? 0) - cached), output: output ?? 0, ...(cached ? { cacheRead: cached } : {}) } });
      return;
    }
    case 'exec_command_end': { const id = str(p.call_id); if (id) result(st, ctx, t, id, num(p.exit_code) === 0); return; }
    case 'patch_apply_end': { const id = str(p.call_id); if (id) result(st, ctx, t, id, p.success === true); return; }
    case 'mcp_tool_call_end': { const id = str(p.call_id); if (id) result(st, ctx, t, id, !('Err' in rec(p.result))); return; }
  }
}
