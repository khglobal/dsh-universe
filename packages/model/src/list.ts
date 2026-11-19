// The list view's groups: the same six things as the today bar, then every place. Needs-you
// first; inside a group, sessions newest first, each followed by its own subagents.
import type { Drafts, Seen } from './seen.ts';
import { stateAt, type AgentTrack, type Store } from './store.ts';
import { runningRoots, toReview } from './today.ts';
import { rally } from './rally.ts';

export const LIST_GROUPS = ['need', 'review', 'running', 'failed', 'idle', 'done'] as const;
export type ListGroupId = (typeof LIST_GROUPS)[number];
export interface ListGroup { id: ListGroupId; rows: AgentTrack[] }

/** Parents newest first, each followed by its children of the same group; orphans (parent elsewhere) after. */
export function familyOrder(rows: readonly AgentTrack[]): AgentTrack[] {
  const ids = new Set(rows.map((s) => s.agent.id));
  const newest = (a: AgentTrack, b: AgentTrack) => b.agent.startedAt - a.agent.startedAt || a.agent.id.localeCompare(b.agent.id);
  const kids = new Map<string, AgentTrack[]>();
  for (const s of rows) {
    const p = s.agent.parentAgentId;
    if (p && ids.has(p)) kids.set(p, [...(kids.get(p) ?? []), s]);
  }
  const out: AgentTrack[] = [];
  const walk = (s: AgentTrack) => { out.push(s); for (const k of (kids.get(s.agent.id) ?? []).sort(newest)) walk(k); };
  for (const s of rows.filter((x) => !x.agent.parentAgentId || !ids.has(x.agent.parentAgentId)).sort(newest)) walk(s);
  return out;
}

/** When an agent last stopped by T (it ended, or its latest turn ended). */
function stoppedAt(s: AgentTrack, T: number): number {
  if (s.agent.endedAt !== undefined && s.agent.endedAt <= T) return s.agent.endedAt;
  let t = s.agent.startedAt;
  for (const x of s.turns) if (x.t <= T && x.phase === 'end') t = Math.max(t, x.t);
  return t;
}

/**
 * `from`: the start of the host's day (see `todayAt`): a subagent of a carried-over session that finished or failed
 * before it is not listed as finished (or failed) today. Without it, nothing is left out.
 */
export function listGroups(store: Store, T: number, city: string, seen?: Seen, drafts?: Drafts, from = -Infinity): ListGroup[] {
  const need = rally(store, T);
  const inSquare = new Set(need.map((s) => s.agent.id));
  const vis = store.agents().filter((s) => stateAt(s, T) !== 'future' && !inSquare.has(s.agent.id));
  // A session whose subagents still work is in Running (with them), like the today bar counts it.
  const busy = runningRoots(store, T);
  const groupOf = (s: AgentTrack) => (busy.has(s.agent.id) ? 'running' : stateAt(s, T));
  const by = (st: string) => familyOrder(vis.filter((s) => groupOf(s) === st && ((st !== 'done' && st !== 'failed') || stoppedAt(s, T) >= from)));
  const review = vis.filter((s) => toReview(s, T, city, seen, drafts));
  const reviewIds = new Set(review.map((s) => s.agent.id));
  return [
    { id: 'need', rows: need },
    { id: 'review', rows: familyOrder(review) },
    { id: 'running', rows: by('running') },
    { id: 'failed', rows: by('failed') },
    { id: 'idle', rows: by('idle') },
    { id: 'done', rows: by('done').filter((s) => !reviewIds.has(s.agent.id)) },
  ];
}
