// Claude Code's local session store → model events. Metadata only.
//
// Layout (Claude Code 2.x, checked against a real store): `~/.claude/projects/<project>/<session id>.jsonl` holds a
// session, `<project>/<session id>/subagents/agent-<id>.jsonl` each of its subagents, with `agent-<id>.meta.json`
// beside it. One JSON object per line.
//
// Read, by field name only:
// - every line: `type`, `timestamp`, `sessionId`, `cwd` (folder name and a hash only leave this file),
//   `isMeta`, `isApiErrorMessage`;
// - `assistant`: `message.id`, `message.model`, `message.stop_reason`, `message.usage.{input_tokens, output_tokens,
//   cache_read_input_tokens, cache_creation_input_tokens}`, and of each `message.content[]` block only `type`, and
//   for `tool_use` blocks `id` and `name`;
// - `user`: of each `message.content[]` block only `type`, and for `tool_result` blocks `tool_use_id` and `is_error`;
//   whether `message.content` is a string (a typed prompt starts a turn; its text is never read);
// - `system`: `subtype` (`api_error` is a retried request), `uuid`;
// - `custom-title`: `customTitle`, the title the member set with /rename (the only title used);
// - a subagent's `meta.json`: `agentType` (its preset name).
// Never read: message text, thinking, tool inputs and results (`input`, `content`, `toolUseResult`), prompts
// (`last-prompt`, `queue-operation`), attachments, API request records, file history, `aiTitle` and every other
// generated summary, `agentName`, account and organisation ids, PR links.
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { categoryOf, type CategoryTable, type Category } from '@dsh-universe/model';
import { folderName, isoTimeOf, listFiles, pathId, type FileRef, type LineCtx, type StoreReader } from '@dsh-universe/adapter-kit/local';

const T: Record<string, Category> = {};
const put = (c: Category, ...names: string[]) => { for (const n of names) T[n] = c; };
put('read', 'Read', 'NotebookRead', 'LS', 'ListMcpResourcesTool', 'ReadMcpResourceTool');
put('search', 'Glob', 'Grep', 'ToolSearch');
put('edit', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit');
put('exec', 'Bash', 'BashOutput', 'KillShell', 'KillBash', 'Monitor', 'TaskStop');
put('web', 'WebFetch', 'WebSearch');
put('delegate', 'Task', 'Agent', 'SendMessage', 'TaskOutput');
put('skill', 'Skill', 'SlashCommand');
put('plan', 'TodoWrite', 'ExitPlanMode', 'EnterPlanMode', 'AskUserQuestion', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet');
const MCP = /^mcp__([A-Za-z0-9_.-]+?)__/;
export const CLAUDE_CODE_TOOLS: CategoryTable = { platform: 'claude-code', tools: T, connectorOf: (tool) => MCP.exec(tool)?.[1] };
/** Tools whose call waits for the member, closed by their result. */
const WAIT: Record<string, 'question' | 'plan'> = { AskUserQuestion: 'question', ExitPlanMode: 'plan' };
/** A session with no new line for this long while a turn is open is taken as stopped (the CLI was closed). */
export const STALE_MS = 30 * 60_000;

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const blocks = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec) : []);

export interface CcFile {
  /** The agent this file is: the session id for a session, `sub:<session>:<agent>` for a subagent. */
  agentId: string;
  sessionId: string;
  parent?: string;
  role?: string;
  cwd?: string;
  model?: string;
  title?: string;
  announced: boolean;
  turnOpen: boolean;
  lastT: number;
  calls: Map<string, { t: number; name: string }>;
  usage: Set<string>;
  ended: Set<string>;
}

/** Lines worth parsing: the record types read here (a cheap test before JSON.parse; the type is checked again). */
const WANTED = /"type":"(?:assistant|user|system|custom-title)"/;

export function claudeCodeReader(home: string): StoreReader<CcFile> {
  const projects = join(home, '.claude', 'projects');
  return {
    async list(since, tick) {
      return listFiles(projects, (rel) => /^[^/]+\/[^/]+\.jsonl$/.test(rel) || /^[^/]+\/[^/]+\/subagents\/agent-[^/]+\.jsonl$/.test(rel), { depth: 3, since, tick });
    },
    async open(f: FileRef) {
      const name = basename(f.path, '.jsonl');
      const sub = basename(dirname(f.path)) === 'subagents';
      if (!sub) return fresh(name, name);
      const sessionId = basename(dirname(dirname(f.path)));
      const st = fresh('sub:' + sessionId + ':' + name.replace(/^agent-/, ''), sessionId);
      st.parent = sessionId;
      try {
        // The subagent's preset name only (`description` is its task and is never read).
        const meta = rec(JSON.parse(await readFile(f.path.replace(/\.jsonl$/, '.meta.json'), 'utf8')));
        const role = str(meta.agentType);
        if (role) st.role = role.slice(0, 80);
      } catch { /* no metadata */ }
      return st;
    },
    timeOf: isoTimeOf,
    head(st, lines) { for (const l of lines) { if (st.cwd) break; meta(st, parse(l)); } },
    tail(st, lines, ctx) {
      let first: number | undefined, last: number | undefined, failed = false;
      for (const l of lines) {
        const o = parse(l);
        if (!o) continue;
        const t = Date.parse(str(o.timestamp) ?? '');
        if (!Number.isFinite(t)) continue;
        first ??= t; last = t;
        if (o.type === 'assistant') failed = o.isApiErrorMessage === true;
      }
      if (!st.parent && last !== undefined) ctx.mark(last, st.sessionId, failed);
      void first;
    },
    line(st, l, ctx) {
      if (!WANTED.test(l)) return;
      const o = parse(l);
      if (!o) return;
      onLine(st, o, ctx);
    },
    settle(st, ctx) {
      if (st.turnOpen && st.announced && ctx.now - st.lastT > STALE_MS) {
        st.turnOpen = false;
        ctx.emit({ type: 'turn', data: { t: st.lastT, agentId: st.agentId, phase: 'end', reason: 'other' } });
      }
    },
  };
}

const fresh = (agentId: string, sessionId: string): CcFile => ({ agentId, sessionId, announced: false, turnOpen: false, lastT: 0, calls: new Map(), usage: new Set(), ended: new Set() });
const parse = (l: string): Rec | undefined => { try { return rec(JSON.parse(l)); } catch { return undefined; } };
function meta(st: CcFile, o: Rec | undefined) {
  if (!o) return;
  if (!st.cwd && str(o.cwd)) st.cwd = str(o.cwd);
  if (o.type === 'custom-title') { const x = str(o.customTitle)?.trim(); if (x) st.title = x.slice(0, 200); }
}
const workspaceOf = (st: CcFile) => (st.cwd ? 'p:' + pathId(st.cwd) : 'p:unknown');

function announce(st: CcFile, t: number, ctx: LineCtx) {
  if (st.announced) return;
  st.announced = true;
  const ws = workspaceOf(st);
  if (ctx.once(ws)) ctx.emit({ type: 'workspace', data: { id: ws, title: st.cwd ? folderName(st.cwd) : '', displayPath: st.cwd ? folderName(st.cwd) : '' } });
  ctx.emit({ type: 'agent', data: {
    id: st.agentId, sessionId: st.parent ?? st.sessionId, workspaceId: ws, label: st.parent ? '' : st.title ?? '', engine: 'claude-code',
    kind: st.parent ? 'subagent' : 'main', ...(st.parent ? { parentAgentId: st.parent } : {}), ...(st.role ? { role: st.role } : {}),
    ...(st.model ? { model: st.model } : {}), state: 'running', startedAt: t,
  } });
  if (!st.parent && st.title) ctx.title?.(st.agentId, st.title);
}

function onLine(st: CcFile, o: Rec, ctx: LineCtx) {
  if (o.type === 'custom-title') {
    const x = str(o.customTitle)?.trim();
    if (!x || st.parent) return;
    st.title = x.slice(0, 200);
    if (st.announced) { ctx.emit({ type: 'agent', data: { id: st.agentId, label: st.title } }); ctx.title?.(st.agentId, st.title); }
    return;
  }
  meta(st, o);
  const t = Date.parse(str(o.timestamp) ?? '');
  if (!Number.isFinite(t)) return;
  if (o.type === 'assistant') { const m = str(rec(o.message).model); if (m && m !== '<synthetic>') st.model = m; }
  if (!st.parent) ctx.mark(t, st.sessionId, o.type === 'assistant' && o.isApiErrorMessage === true);
  if (t < ctx.dayStart) return;
  announce(st, t, ctx);
  st.lastT = Math.max(st.lastT, t);
  const agentId = st.agentId;
  const msg = rec(o.message);
  if (o.type === 'assistant') {
    const id = str(msg.id);
    // `<synthetic>`: a message Claude Code wrote itself (an API error notice), not a model.
    const model = str(msg.model) === '<synthetic>' ? undefined : str(msg.model);
    if (model && model !== st.model) { st.model = model; ctx.emit({ type: 'agent', data: { id: agentId, model } }); }
    if (!st.turnOpen) { st.turnOpen = true; ctx.emit({ type: 'turn', data: { t, agentId, phase: 'start' } }); }
    const u = rec(msg.usage);
    // One API response is written as several lines (one per content block) with the same id and usage: count it once.
    if (id && !st.usage.has(id) && ((num(u.input_tokens) ?? 0) > 0 || (num(u.output_tokens) ?? 0) > 0)) {
      st.usage.add(id);
      ctx.emit({ type: 'usage', data: {
        id, t, agentId, model: model ?? st.model ?? '', input: num(u.input_tokens) ?? 0, output: num(u.output_tokens) ?? 0,
        ...(num(u.cache_read_input_tokens) !== undefined ? { cacheRead: num(u.cache_read_input_tokens) } : {}),
        ...(num(u.cache_creation_input_tokens) !== undefined ? { cacheWrite: num(u.cache_creation_input_tokens) } : {}),
      } });
    }
    for (const b of blocks(msg.content)) {
      if (b.type !== 'tool_use') continue;
      const cid = str(b.id), name = str(b.name);
      if (!cid || !name || st.calls.has(cid)) continue;
      st.calls.set(cid, { t, name });
      const category = categoryOf(CLAUDE_CODE_TOOLS, name);
      const connectorId = category === 'connector' ? CLAUDE_CODE_TOOLS.connectorOf(name) : undefined;
      ctx.emit({ type: 'activity', data: { id: cid, t, agentId, category, tool: name, ...(connectorId ? { connectorId } : {}) } });
      if (WAIT[name]) ctx.emit({ type: 'approval', data: { id: 'q:' + cid, agentId, kind: WAIT[name], askedAt: t } });
    }
    if (o.isApiErrorMessage === true) {
      st.turnOpen = false;
      ctx.emit({ type: 'turn', data: { t, agentId, phase: 'end', reason: 'error' } });
    } else if (msg.stop_reason === 'end_turn' && id && !st.ended.has(id)) {
      st.ended.add(id);
      st.turnOpen = false;
      ctx.emit({ type: 'turn', data: { t, agentId, phase: 'end', reason: 'completed' } });
    }
    return;
  }
  if (o.type === 'user') {
    if (o.isMeta === true) return;
    // A typed prompt (a string, or text blocks without a tool result) starts a turn. Its text is never read.
    const bs = blocks(msg.content);
    const prompt = typeof msg.content === 'string' || (bs.length > 0 && bs.every((b) => b.type === 'text' || b.type === 'image'));
    if (prompt && !st.turnOpen) { st.turnOpen = true; ctx.emit({ type: 'turn', data: { t, agentId, phase: 'start' } }); }
    for (const b of bs) {
      if (b.type !== 'tool_result') continue;
      const cid = str(b.tool_use_id);
      const c = cid ? st.calls.get(cid) : undefined;
      if (!cid || !c) continue;
      st.calls.delete(cid);
      const category = categoryOf(CLAUDE_CODE_TOOLS, c.name);
      const connectorId = category === 'connector' ? CLAUDE_CODE_TOOLS.connectorOf(c.name) : undefined;
      ctx.emit({ type: 'activity', data: { id: cid, t: c.t, agentId, category, tool: c.name, ok: b.is_error !== true, durationMs: Math.max(0, t - c.t), ...(connectorId ? { connectorId } : {}) } });
      if (WAIT[c.name]) ctx.emit({ type: 'approval', data: { id: 'q:' + cid, agentId, kind: WAIT[c.name], askedAt: c.t, decidedAt: t } });
    }
    return;
  }
  if (o.type === 'system' && o.subtype === 'api_error') {
    const id = str(o.uuid);
    if (id) ctx.emit({ type: 'retry', data: { id, t, agentId, attempt: num(o.retryAttempt) ?? 1, ...(num(o.retryInMs) !== undefined ? { delayMs: num(o.retryInMs) } : {}) } });
  }
}
