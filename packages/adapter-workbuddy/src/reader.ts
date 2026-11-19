// WorkBuddy's local session store → model events. Metadata only.
//
// Layout (WorkBuddy desktop, macOS, checked against a real store): `~/.workbuddy/projects/<project>/<session id>.jsonl`
// holds a session, `<project>/<session id>/subagents/agent-<id>.jsonl` each of its subagents. One JSON object per
// line, in the agent's own run format: `message` (a member's prompt or the model's reply), `function_call` (a tool
// call), `function_call_result`, `reasoning`, `ai-title`, `file-history-snapshot`. Times are milliseconds.
//
// Read, by field name only:
// - every line read: `type`, `timestamp`, `cwd` (folder name and a hash only leave this file);
// - `message`: `role`, `status`, `providerData.model`, `providerData.messageId`, whether `providerData.error` is
//   there (never its text), the flags `providerData.isCompactInternal`, `isSummary`, `isCompacted` (an internal
//   compaction prompt is not the member's), `message.usage.{input_tokens, output_tokens, cache_read_input_tokens}`;
// - `function_call`: `name`, `callId`, `providerData.model`, `providerData.messageId`, `message.usage` as above, and
//   in a subagent's file `providerData.agent` (its preset name);
// - `function_call_result`: `callId`, and whether the call failed: `providerData.toolResult.error` is there (never its
//   text), `providerData.toolResult.rawResponse.is_error` is true, or `...rawResponse.exitCode` is a non-zero number.
// Never read: message text (`content`, `rawContent`), reasoning, tool `arguments` and `argumentsDisplayText`, tool
// output and results, error text, `ai-title` (a generated title), file snapshots, the app's database, logs, traces,
// tasks, memory, settings, credentials and every other file under `~/.workbuddy`. WorkBuddy keeps a title the member
// set only in its database, which is not read, so sessions are named by project folder and day.
import { basename, dirname, join } from 'node:path';
import { categoryOf, type CategoryTable, type Category } from '@dsh-universe/model';
import { folderName, listFiles, pathId, type FileRef, type LineCtx, type StoreReader } from '@dsh-universe/adapter-kit/local';

const T: Record<string, Category> = {};
const put = (c: Category, ...names: string[]) => { for (const n of names) T[n] = c; };
put('read', 'Read', 'read_me');
put('search', 'Glob', 'Grep', 'ToolSearch', 'DeferExecuteTool');
put('edit', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit');
put('exec', 'Bash', 'BashOutput', 'KillShell');
put('web', 'WebFetch', 'WebSearch');
put('delegate', 'Task', 'Agent', 'TaskOutput', 'SendMessage');
put('skill', 'Skill');
put('plan', 'TodoWrite', 'AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet');
const MCP = /^mcp__([A-Za-z0-9_.-]+?)__/;
export const WORKBUDDY_TOOLS: CategoryTable = { platform: 'workbuddy', tools: T, connectorOf: (tool) => MCP.exec(tool)?.[1] };
const WAIT: Record<string, 'question' | 'plan'> = { AskUserQuestion: 'question', ExitPlanMode: 'plan' };
/** A turn whose last reply came this long ago with no call after it is over (the reply is written before any call). */
export const QUIET_MS = 20_000;
/** A session with no new line for this long while a turn is open is taken as stopped (the app was closed). */
export const STALE_MS = 30 * 60_000;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** A preset name, never free text. */
const PRESET = /^[A-Za-z][A-Za-z0-9 _-]{0,39}$/;

export interface WbFile {
  agentId: string;
  sessionId: string;
  parent?: string;
  role?: string;
  ws?: string;
  folder?: string;
  model?: string;
  announced: boolean;
  turnOpen: boolean;
  /** The time of the last reply in an open turn with no call after it: the turn's end, once it stays quiet. */
  endAt?: number;
  lastT: number;
  calls: Map<string, { t: number; name: string }>;
  usage: Set<string>;
}

const WANTED = /"type":"(?:message|function_call|function_call_result)"/;
/** `"timestamp":<ms>` without parsing the line. */
export const msTimeOf = (line: string): number | undefined => {
  const m = /"timestamp":(\d{12,14})[,}]/.exec(line);
  return m ? Number(m[1]) : undefined;
};

export const workbuddyProjects = (home: string) => join(home, '.workbuddy', 'projects');

export function workbuddyReader(home: string): StoreReader<WbFile> {
  const projects = workbuddyProjects(home);
  return {
    list: (since, tick) => listFiles(projects, (rel) => /^[^/]+\/[^/]+\.jsonl$/.test(rel) || /^[^/]+\/[^/]+\/subagents\/agent-[^/]+\.jsonl$/.test(rel), { depth: 3, since, tick }),
    open(f: FileRef): WbFile {
      const name = basename(f.path, '.jsonl');
      if (basename(dirname(f.path)) !== 'subagents') return fresh(name, name);
      const sessionId = basename(dirname(dirname(f.path)));
      const st = fresh('sub:' + sessionId + ':' + name.replace(/^agent-/, ''), sessionId);
      st.parent = sessionId;
      return st;
    },
    timeOf: msTimeOf,
    head(st, lines) { for (const l of lines) { if (st.ws) break; if (!/"cwd":/.test(l)) continue; const o = parse(l); if (o && str(o.cwd)) folderOf(st, str(o.cwd)!); } },
    tail(st, lines, ctx) {
      let last: number | undefined, failed = false;
      for (const l of lines) {
        if (!WANTED.test(l)) continue;
        const o = parse(l);
        const t = o ? num(o.timestamp) : undefined;
        if (!o || t === undefined) continue;
        last = t;
        if (o.type === 'message' && o.role === 'assistant') failed = hasError(o);
        else if (o.type === 'message' && o.role === 'user') failed = false;
      }
      if (!st.parent && last !== undefined) ctx.mark(last, st.sessionId, failed);
    },
    line(st, l, ctx) {
      if (!WANTED.test(l)) return;
      const o = parse(l);
      if (o) onLine(st, o, ctx);
    },
    settle(st, ctx) {
      if (!st.turnOpen || !st.announced) return;
      if (st.endAt !== undefined && !st.calls.size && ctx.now - st.lastT > QUIET_MS) end(st, st.endAt, 'completed', ctx);
      else if (ctx.now - st.lastT > STALE_MS) end(st, st.lastT, 'other', ctx);
    },
  };
}

const fresh = (agentId: string, sessionId: string): WbFile => ({ agentId, sessionId, announced: false, turnOpen: false, lastT: 0, calls: new Map(), usage: new Set() });
const parse = (l: string): Rec | undefined => { try { return rec(JSON.parse(l)); } catch { return undefined; } };
const folderOf = (st: WbFile, cwd: string) => { st.ws = 'p:' + pathId(cwd); st.folder = folderName(cwd); };
const hasError = (o: Rec) => rec(o.providerData).error != null;
const modelOf = (o: Rec) => { const m = str(rec(o.providerData).model)?.trim(); return m && m !== 'auto' && m.length <= 80 ? m : undefined; };

function announce(st: WbFile, t: number, ctx: LineCtx) {
  if (st.announced) return;
  st.announced = true;
  const ws = st.ws ?? 'p:unknown';
  if (ctx.once(ws)) ctx.emit({ type: 'workspace', data: { id: ws, title: st.folder ?? '', displayPath: st.folder ?? '' } });
  ctx.emit({ type: 'agent', data: {
    id: st.agentId, sessionId: st.parent ?? st.sessionId, workspaceId: ws, label: '', engine: 'workbuddy',
    kind: st.parent ? 'subagent' : 'main', ...(st.parent ? { parentAgentId: st.parent } : {}), ...(st.role ? { role: st.role } : {}),
    ...(st.model ? { model: st.model } : {}), state: 'running', startedAt: t,
  } });
}
function start(st: WbFile, t: number, ctx: LineCtx) {
  if (st.turnOpen) return;
  st.turnOpen = true; st.endAt = undefined;
  ctx.emit({ type: 'turn', data: { t, agentId: st.agentId, phase: 'start' } });
}
function end(st: WbFile, t: number, reason: 'completed' | 'error' | 'other', ctx: LineCtx) {
  st.turnOpen = false; st.endAt = undefined;
  ctx.emit({ type: 'turn', data: { t, agentId: st.agentId, phase: 'end', reason } });
}
function usage(st: WbFile, o: Rec, t: number, ctx: LineCtx) {
  const u = rec(rec(o.message).usage);
  const id = str(rec(o.providerData).messageId) ?? str(o.id);
  const input = num(u.input_tokens) ?? 0, output = num(u.output_tokens) ?? 0, cached = num(u.cache_read_input_tokens) ?? 0;
  if (!id || st.usage.has(id) || (input <= 0 && output <= 0)) return;
  st.usage.add(id);
  // The prompt count includes the part read from the cache.
  ctx.emit({ type: 'usage', data: { id: 'wb:' + id, t, agentId: st.agentId, model: st.model ?? '', input: Math.max(0, input - cached), output, ...(cached ? { cacheRead: cached } : {}) } });
}

function onLine(st: WbFile, o: Rec, ctx: LineCtx) {
  if (!st.ws && str(o.cwd)) folderOf(st, str(o.cwd)!);
  const t = num(o.timestamp);
  if (t === undefined) return;
  const pd = rec(o.providerData);
  if (st.parent && !st.role) { const r = str(pd.agent); if (r && PRESET.test(r)) st.role = r; }
  const m = modelOf(o);
  if (!st.parent) ctx.mark(t, st.sessionId, o.type === 'message' && o.role === 'assistant' && hasError(o));
  if (t < ctx.dayStart) { if (m) st.model = m; return; }
  announce(st, t, ctx);
  if (m && m !== st.model) { st.model = m; ctx.emit({ type: 'agent', data: { id: st.agentId, model: m } }); }
  st.lastT = Math.max(st.lastT, t);
  const agentId = st.agentId;
  if (o.type === 'message') {
    if (o.role === 'user') {
      // An internal compaction prompt is WorkBuddy's own, not the member's.
      if (pd.isCompactInternal === true || pd.isSummary === true || pd.isCompacted === true) return;
      if (st.turnOpen) end(st, st.endAt ?? t, 'completed', ctx);
      start(st, t, ctx);
      return;
    }
    if (o.role !== 'assistant') return;
    start(st, t, ctx);
    usage(st, o, t, ctx);
    if (hasError(o)) end(st, t, 'error', ctx);
    else if (o.status === 'completed') st.endAt = t;
    return;
  }
  if (o.type === 'function_call') {
    const cid = str(o.callId), name = str(o.name);
    start(st, t, ctx);
    st.endAt = undefined;
    usage(st, o, t, ctx);
    if (!cid || !name || st.calls.has(cid)) return;
    st.calls.set(cid, { t, name });
    const category = categoryOf(WORKBUDDY_TOOLS, name);
    const connectorId = category === 'connector' ? WORKBUDDY_TOOLS.connectorOf(name) : undefined;
    ctx.emit({ type: 'activity', data: { id: 'wb:' + cid, t, agentId, category, tool: name, ...(connectorId ? { connectorId } : {}) } });
    if (WAIT[name]) ctx.emit({ type: 'approval', data: { id: 'q:wb:' + cid, agentId, kind: WAIT[name], askedAt: t } });
    return;
  }
  if (o.type === 'function_call_result') {
    const cid = str(o.callId);
    const c = cid ? st.calls.get(cid) : undefined;
    if (!cid || !c) return;
    st.calls.delete(cid);
    const tr = rec(pd.toolResult), raw = rec(tr.rawResponse);
    const failed = (typeof tr.error === 'string' && tr.error.length > 0) || (tr.error != null && typeof tr.error !== 'string') || raw.is_error === true || (typeof raw.exitCode === 'number' && raw.exitCode !== 0);
    const category = categoryOf(WORKBUDDY_TOOLS, c.name);
    const connectorId = category === 'connector' ? WORKBUDDY_TOOLS.connectorOf(c.name) : undefined;
    ctx.emit({ type: 'activity', data: { id: 'wb:' + cid, t: c.t, agentId, category, tool: c.name, ok: !failed, durationMs: Math.max(0, t - c.t), ...(connectorId ? { connectorId } : {}) } });
    if (WAIT[c.name]) ctx.emit({ type: 'approval', data: { id: 'q:wb:' + cid, agentId, kind: WAIT[c.name], askedAt: c.t, decidedAt: t } });
  }
}
