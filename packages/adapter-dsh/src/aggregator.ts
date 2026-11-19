// Session events → model events. Only allow-listed fields leave this file: times, tool names, categories, token
// counts, error flags, ids. Arguments, results, messages, error text, file paths and labels are never read into
// the output (every event goes through adapter-kit `sanitize` as a second line of defence).
// Event shapes: DSH 0.2.2-rc.2.
import { categoryOf, themeFromTitle, type CategoryTable, type Engine, type ThemeId, type UEvent, type UTurn } from '@dsh-universe/model';
import { sanitize } from '@dsh-universe/adapter-kit';

/** The parts of a DSH session the aggregator reads. */
export interface SessionLike {
  id: string;
  header?: { createdAt?: number; parentSession?: string; origin?: string; agentPreset?: string; cwd?: string };
}
/** A DSH session event envelope: `{ type, seq, time (ms), data }`. */
export interface SessionEventLike { type: string; seq?: number; time?: number; data?: unknown }

export interface AggregatorDeps {
  categories: CategoryTable;
  /** Workspace of a session (from the workspace registry, else its cwd); '' when not known yet. */
  workspaceOf(sessionId: string, cwd?: string): string;
  now(): number;
  /**
   * A session's title arrived (`session/title`): called with the theme id picked from it. The title text itself is
   * read only to pick the id and never leaves this file.
   */
  onTheme?(sessionId: string, theme: ThemeId): void;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

const TURN_REASON: Record<string, UTurn['reason']> = {
  completed: 'completed', error: 'error', aborted: 'cancelled', interrupted: 'cancelled', forked: 'cancelled',
  blocked: 'other', 'max-tokens': 'other',
};
const OUTCOME: Record<string, 'allowed' | 'rejected' | 'cancelled'> = {
  'allowed-once': 'allowed', allowed: 'allowed', rejected: 'rejected', cancelled: 'cancelled', unavailable: 'cancelled',
};
/**
 * Tools whose call waits for the member, and the kind of wait: its call opens the wait, its result closes it.
 * `exit_plan_mode` presents a finished plan for review through the same `userQuestions` channel as a question
 * (dsh-plan-mode 0.2.2). Only the tool name and the times are read, never the plan or the answer.
 */
const WAIT_TOOLS: Record<string, 'question' | 'plan'> = { ask_user_question: 'question', exit_plan_mode: 'plan' };
const QUESTION_TOOL = 'ask_user_question';
/**
 * Delegation to an outside coding engine (official dsh-subagent-claude-code and dsh-subagent-codex 0.2.2-rc.2: the
 * shared dsh-tool-subagent mounted as `subagent_claude_code` and `subagent_codex`). A run is one blocking tool call
 * in the parent: the call starts it, `subagent/catalog { mode: 'external', childId }` names it, the result ends it.
 * Those runs keep no session of their own (the Claude Agent SDK runs with `persistSession: false`, Codex threads
 * are ephemeral) and report no tool calls or token use to DSH. The catalog's `label` is the task description and
 * is never read.
 */
const ENGINE_TOOLS: Record<string, Engine> = { subagent_claude_code: 'claude-code', subagent_codex: 'codex' };
/** The engine of a subagent provider name (`claude-code`, `codex` by default; a profile may rename them). */
export function engineOfProvider(provider: unknown): Engine | undefined {
  if (typeof provider !== 'string') return undefined;
  if (/claude/i.test(provider)) return 'claude-code';
  if (/codex/i.test(provider)) return 'codex';
  return undefined;
}

export interface Aggregator {
  /** A session appeared (created, or found by backfill). */
  session(session: SessionLike): UEvent[];
  /** One session event. */
  event(session: SessionLike, ev: SessionEventLike): UEvent[];
  /** Host `subagent/start` (`SubagentRunInfo`): the child's parent; for an outside engine also its start. */
  subagent(info: unknown): UEvent[];
  /** Host `subagent/end` (`SubagentRunEndInfo`): only the stop reason is read, never `lastAssistantMessage`. */
  subagentEnd(info: unknown): UEvent[];
  /** The session was disposed. */
  disposed(session: SessionLike): UEvent[];
}

export function createAggregator(deps: AggregatorDeps): Aggregator {
  const known = new Set<string>();
  const calls = new Map<string, { t: number; name: string }>();
  // Engine runs: per parent, the engine calls still open (oldest first), and call → child once the catalog names it.
  const openEngine = new Map<string, { id: string; engine: Engine; child?: string }[]>();
  const childOfCall = new Map<string, string>();
  const ended = new Set<string>();
  const out = (list: unknown[]): UEvent[] => list.map(sanitize).filter((e): e is UEvent => e !== undefined);

  function session(ses: SessionLike): UEvent[] {
    known.add(ses.id);
    const h = rec(ses.header);
    const parent = s(h.parentSession);
    return out([{
      type: 'agent',
      data: {
        id: ses.id, sessionId: ses.id, workspaceId: deps.workspaceOf(ses.id, s(h.cwd)), label: '',
        kind: parent || h.origin === 'subagent' ? 'subagent' : 'main',
        ...(parent ? { parentAgentId: parent } : {}),
        ...(s(h.agentPreset) ? { role: s(h.agentPreset) } : {}),
        state: 'running', startedAt: n(h.createdAt) ?? deps.now(),
      },
    }]);
  }

  function event(ses: SessionLike, ev: SessionEventLike): UEvent[] {
    const agentId = ses.id;
    const t = n(ev.time) ?? deps.now();
    const d = rec(ev.data);
    const r: unknown[] = [];
    switch (ev.type) {
      case 'turn/start': r.push({ type: 'turn', data: { t, agentId, phase: 'start' } }); break;
      case 'turn/end': r.push({ type: 'turn', data: { t, agentId, phase: 'end', reason: TURN_REASON[s(rec(d.reason).kind) ?? ''] ?? 'other' } }); break;
      case 'tool/call':
      case 'tool/ptc-dispatch-start': {
        const name = s(d.name);
        const id = s(d.callId) ?? s(d.subCallId);
        if (!name || !id) break;
        calls.set(agentId + '\0' + id, { t, name });
        const category = categoryOf(deps.categories, name);
        const connectorId = category === 'connector' ? deps.categories.connectorOf(name) : undefined;
        r.push({ type: 'activity', data: { id, t, agentId, category, tool: name, ...(connectorId ? { connectorId } : {}) } });
        const wk = WAIT_TOOLS[name];
        if (wk) r.push({ type: 'approval', data: { id: 'q:' + id, agentId, kind: wk, askedAt: t } });
        const engine = ENGINE_TOOLS[name];
        if (engine) { const l = openEngine.get(agentId) ?? []; if (!l.some((x) => x.id === id)) l.push({ id, engine }); openEngine.set(agentId, l); }
        break;
      }
      case 'subagent/catalog': {
        // Only an outside run (mode `external`): its id and creation time. Its label (the task) is never read.
        if (d.mode !== 'external') break;
        const child = s(d.childId);
        if (!child) break;
        const open = (openEngine.get(agentId) ?? []).find((x) => !x.child);
        if (open) { open.child = child; childOfCall.set(agentId + '\0' + open.id, child); }
        r.push({ type: 'agent', data: {
          id: child, sessionId: child, parentAgentId: agentId, kind: 'subagent', label: '', workspaceId: deps.workspaceOf(agentId, s(rec(ses.header).cwd)),
          state: 'running', startedAt: n(d.childCreatedAt) ?? t, ...(open ? { engine: open.engine } : {}),
        } });
        break;
      }
      case 'tool/result':
      case 'tool/ptc-dispatch': {
        const m = rec(d.message);
        const id = s(m.toolCallId) ?? s(d.subCallId);
        if (!id) break;
        const key = agentId + '\0' + id;
        const c = calls.get(key);
        calls.delete(key);
        const failed = m.isError === true || d.isError === true || d.error !== undefined;
        const name = c?.name ?? s(d.name);
        if (!name) break;
        const category = categoryOf(deps.categories, name);
        const connectorId = category === 'connector' ? deps.categories.connectorOf(name) : undefined;
        r.push({ type: 'activity', data: { id, t: c?.t ?? t, agentId, category, tool: name, ok: !failed, ...(c ? { durationMs: Math.max(0, t - c.t) } : {}), ...(connectorId ? { connectorId } : {}) } });
        const wk = WAIT_TOOLS[name];
        if (wk) r.push({ type: 'approval', data: { id: 'q:' + id, agentId, kind: wk, askedAt: c?.t ?? t, decidedAt: t } });
        if (ENGINE_TOOLS[name]) {
          const l = (openEngine.get(agentId) ?? []).filter((x) => x.id !== id);
          if (l.length) openEngine.set(agentId, l); else openEngine.delete(agentId);
          const child = childOfCall.get(agentId + '\0' + id);
          childOfCall.delete(agentId + '\0' + id);
          if (child && !ended.has(child)) { ended.add(child); r.push({ type: 'agent', data: { id: child, endedAt: t, state: failed ? 'failed' : 'done' } }); }
        }
        break;
      }
      case 'assistant/message': {
        const u = rec(d.usage);
        const model = s(rec(rec(d.message).source).model);
        if (model) r.push({ type: 'agent', data: { id: agentId, model } });
        const input = n(u.inputTokens), output = n(u.outputTokens);
        if (input !== undefined || output !== undefined) {
          r.push({ type: 'usage', data: {
            id: ev.seq !== undefined ? 'seq' + ev.seq : `${s(d.turn) ?? n(d.turn) ?? ''}:${s(d.step) ?? n(d.step) ?? ''}:${t}`,
            t, agentId, model: model ?? '', input: input ?? 0, output: output ?? 0,
            ...(n(u.cacheReadTokens) !== undefined ? { cacheRead: n(u.cacheReadTokens) } : {}),
            ...(n(u.cacheWriteTokens) !== undefined ? { cacheWrite: n(u.cacheWriteTokens) } : {}),
          } });
        }
        break;
      }
      case 'model/selection': { const model = s(d.model); if (model) r.push({ type: 'agent', data: { id: agentId, model } }); break; }
      // Retries of a failed model request (dsh-llm-retry): only the retry id, the attempt and the wait. The failure,
      // the provider's message and the policy are never read.
      // Plan mode on or off (dsh-plan-mode): the flag only.
      case 'plan/mode': if (typeof d.active === 'boolean') r.push({ type: 'planmode', data: { t, agentId, active: d.active } }); break;
      case 'llm/retry': { const id = s(d.retryId); if (id) r.push({ type: 'retry', data: { id, t, agentId, attempt: n(d.retry) ?? 1, ...(n(d.delayMs) !== undefined ? { delayMs: n(d.delayMs) } : {}) } }); break; }
      case 'llm/retry-started': { const id = s(d.retryId); if (id) r.push({ type: 'retry', data: { id, t, agentId, attempt: n(d.retry) ?? 1, startedAt: t } }); break; }
      case 'agent-preset/selected': { const role = s(d.agentPreset); if (role) r.push({ type: 'agent', data: { id: agentId, role } }); break; }
      case 'approval/asked': {
        const id = s(d.id);
        if (id) r.push({ type: 'approval', data: { id, agentId, kind: 'approval', askedAt: t, ...(s(d.toolName) ? { tool: s(d.toolName) } : {}) } });
        break;
      }
      case 'approval/decided': {
        const id = s(d.id);
        if (id) r.push({ type: 'approval', data: { id, agentId, kind: 'approval', askedAt: t, decidedAt: t, outcome: OUTCOME[s(d.outcome) ?? ''] ?? 'cancelled' } });
        break;
      }
      case 'job/registered':
      case 'job/settled': {
        const id = s(d.jobId);
        if (!id) break;
        const status = s(d.status);
        r.push({ type: 'job', data: {
          id, agentId, kind: s(d.kind) ?? 'job', startedAt: n(d.startedAt) ?? t,
          ...(ev.type === 'job/settled' ? { endedAt: n(d.finishedAt) ?? t, outcome: status === 'completed' || status === 'killed' || status === 'failed' ? status : 'failed' } : {}),
        } });
        break;
      }
      case 'session/title': {
        // Log-only event `{ title, source }` (dsh-session-title types.d.ts). The first one is the first real title.
        const title = s(d.title);
        if (title && title.trim()) deps.onTheme?.(agentId, themeFromTitle(title));
        break;
      }
      case 'deliverables/presented': {
        const count = Array.isArray(d.files) ? d.files.length : 0;
        if (count > 0) r.push({ type: 'deliverable', data: { t, agentId, count } });
        break;
      }
    }
    // The agent is announced with its first event that means something: a blank New Session writes only its
    // permission and sandbox settings, and must not become a building.
    const mapped = out(r);
    if (!mapped.length || known.has(agentId)) return mapped;
    return [...session(ses), ...mapped];
  }

  return {
    session,
    event,
    subagent(info) {
      const i = rec(info);
      const child = s(i.id), parent = s(i.parentSessionId);
      if (!child || !parent) return [];
      const engine = i.local === false ? engineOfProvider(i.provider) : undefined;
      // A local child has its own session (its start and workspace come from there); an outside run has none.
      if (i.local !== false) return out([{ type: 'agent', data: { id: child, parentAgentId: parent, kind: 'subagent' } }]);
      return out([{ type: 'agent', data: {
        id: child, sessionId: child, parentAgentId: parent, kind: 'subagent', label: '', workspaceId: deps.workspaceOf(parent),
        state: 'running', startedAt: deps.now(), ...(engine ? { engine } : {}),
      } }]);
    },
    subagentEnd(info) {
      const i = rec(info);
      const child = s(i.id);
      if (!child || i.local !== false || ended.has(child)) return [];
      ended.add(child);
      // `stopReason` only; `lastAssistantMessage` (the run's answer) is content and never read.
      const reason = s(i.stopReason);
      return out([{ type: 'agent', data: { id: child, endedAt: deps.now(), state: reason === 'error' ? 'failed' : 'done' } }]);
    },
    disposed: () => [],
  };
}

/**
 * The approval update from `approval/decided` carries a placeholder `askedAt`; the store merges by id, so the
 * asked time from `approval/asked` stays. Exposed for the tests.
 */
export const _internal = { TURN_REASON, OUTCOME, QUESTION_TOOL, WAIT_TOOLS, ENGINE_TOOLS };
