// The common model. Every adapter fills exactly these shapes and nothing else:
// no arguments, results, prompts, replies, file contents, file names, URLs or error text.
// Times are milliseconds since the epoch.

export type PlatformId = string;
export type AgentState = 'running' | 'waiting' | 'idle' | 'done' | 'failed';
/** `future`: the agent has not started at the asked moment. */
export type StateAt = AgentState | 'future';
export type Category =
  | 'read' | 'search' | 'edit' | 'exec' | 'web' | 'connector' | 'delegate'
  | 'skill' | 'memory' | 'plan' | 'deliver' | 'other';

export const CATEGORIES: readonly Category[] = [
  'read', 'search', 'edit', 'exec', 'web', 'connector', 'delegate', 'skill', 'memory', 'plan', 'deliver', 'other',
];

/** A platform that cannot give a kind of data says false; the city shows that floor as "not provided". */
export interface UCapabilities {
  approvals: boolean; schedules: boolean; subagents: boolean; jobs: boolean; deliverables: boolean;
  skills: boolean; memory: boolean; tokens: boolean; cost: boolean; latency: boolean;
  /** false: sessions are shown as "folder · short id". */
  sessionTitles: boolean;
  /** Model-request retries (the fire station's repair log). Optional: absent means not provided. */
  retries?: boolean;
  actions: { openSession: boolean; draftFollowUp: boolean };
}

export interface UPlatform { id: PlatformId; title: string; adapterVersion: string; caps: UCapabilities }

/** `tags`: labels the platform declares for the workspace (none on DSH 0.2.2-rc.2). */
export interface UWorkspace { id: string; title: string; displayPath: string; tags?: string[] }

export interface UAgent {
  id: string;
  sessionId: string;
  parentAgentId?: string;
  workspaceId: string;
  /** The session title: shown in labels and panels only, never painted into the city. */
  label: string;
  kind: 'main' | 'subagent' | 'scheduled';
  /** Expert preset name or subagent type. */
  role?: string;
  model?: string;
  state: AgentState;
  startedAt: number;
  endedAt?: number;
  scheduleId?: string;
  /**
   * The coding engine that does this agent's work when it is not the platform's own: `claude-code` or `codex` (a
   * DSH subagent delegated to Claude Code or Codex, or any agent of a Claude Code or Codex city). Drawn with that
   * engine's look and named after it.
   */
  engine?: Engine;
}

/** Coding engines with their own look in the city. */
export type Engine = 'claude-code' | 'codex';
export const ENGINES: readonly Engine[] = ['claude-code', 'codex'];
export const isEngine = (v: unknown): v is Engine => v === 'claude-code' || v === 'codex';

export interface UActivity {
  /** Opaque call id from the platform, used only to drop duplicates (backfill overlapping live events). */
  id?: string;
  t: number;
  agentId: string;
  category: Category;
  /** The tool name only. */
  tool: string;
  connectorId?: string;
  durationMs?: number;
  ok?: boolean;
  tokens?: number;
}

export interface UApproval {
  id: string;
  agentId: string;
  kind: 'approval' | 'question' | 'plan';
  tool?: string;
  askedAt: number;
  decidedAt?: number;
  outcome?: 'allowed' | 'rejected' | 'cancelled';
}

export interface UJob {
  id: string; agentId: string; kind: string; startedAt: number; endedAt?: number;
  outcome?: 'completed' | 'killed' | 'failed';
}

/** Only how many. */
export interface UDeliverable { t: number; agentId: string; count: number }

export interface USchedule {
  id: string; title: string; status: 'active' | 'paused' | 'ended';
  nextAt?: number; runs: { at: number; agentId?: string; ok?: boolean }[];
}

export interface UConnector {
  id: string; title: string;
  state: 'connected' | 'connecting' | 'failed' | 'disabled' | 'unknown';
  tools?: string[];
  tags?: string[];
}

export interface UUsage {
  id?: string;
  t: number; agentId: string; model: string; input: number; output: number;
  cacheRead?: number; cacheWrite?: number;
}

/** Names and counts only. */
export interface UInventory { plugins?: { id: string; enabled: boolean }[]; skills?: string[]; hooks?: number }

/** A turn ending: the store turns these into running / idle / done / failed. */
export interface UTurn { t: number; agentId: string; phase: 'start' | 'end'; reason?: 'completed' | 'error' | 'cancelled' | 'other' }

/**
 * A model request that failed and is retried (DSH `llm/retry`, then `llm/retry-started` when the wait is over). Only
 * the retry id, times, the attempt number and the wait: never the failure, the provider's message or the request.
 */
export interface URetry { id: string; t: number; agentId: string; attempt: number; delayMs?: number; startedAt?: number }

/** Plan mode switched on or off for a session (DSH `plan/mode { active }`): only the flag and the time. */
export interface UPlanMode { t: number; agentId: string; active: boolean }

/** Per-day totals kept for 14 days. */
export interface UDay { day: string; sessions: number; failed: number }

export type UEvent =
  | { type: 'workspace'; data: UWorkspace }
  | { type: 'agent'; data: UAgent }
  | { type: 'activity'; data: UActivity }
  | { type: 'turn'; data: UTurn }
  | { type: 'approval'; data: UApproval }
  | { type: 'job'; data: UJob }
  | { type: 'deliverable'; data: UDeliverable }
  | { type: 'schedule'; data: USchedule }
  | { type: 'connector'; data: UConnector }
  | { type: 'usage'; data: UUsage }
  | { type: 'retry'; data: URetry }
  | { type: 'planmode'; data: UPlanMode }
  | { type: 'inventory'; data: UInventory };

export type UEventType = UEvent['type'];

/** A numbered event as stored and served by the host. */
export interface SeqEvent { seq: number; e: UEvent }

export interface USnapshot {
  platform: UPlatform;
  day: string;
  /** The last sequence number included; `since` continues from here. */
  seq: number;
  events: UEvent[];
  history?: UDay[];
}
