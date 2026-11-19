// The "today" bar: the six things a member comes for, most urgent first, and for each the list of
// items its button steps through.
import { modelPlace } from './places.ts';
import { placeOfCall } from './metrics.ts';
import { seenKey, type Drafts, type Seen } from './seen.ts';
import { cumAt, errsAt, idxAt, stateAt, type AgentTrack, type Store } from './store.ts';
import { rallyAt, type RallyEntry } from './rally.ts';

export const TODAY_ORDER = ['need', 'sched', 'run', 'review', 'err', 'tok'] as const;
export type TodayCat = (typeof TODAY_ORDER)[number];

export interface Today {
  need: number;
  /** Who is waiting and for what, longest first (the same order as `items.need`). */
  waits: RallyEntry[];
  /** Next scheduled run after T, if any. */
  next?: { scheduleId: string; at: number; title: string };
  running: number;
  review: number;
  errors: number;
  tokens: number;
  /** What each button steps through, in a fixed order: agent ids (need, run, review), schedule ids, place ids. */
  items: Record<TodayCat, string[]>;
}

/**
 * "To review": a session whose latest turn completed after the member last looked at it
 * (deliverables or not), or one with an unsent draft in its input box. The seen marker is keyed by city + session
 * + call count, so a session that runs again counts again; a draft counts until it is sent or cleared, seen or not.
 */
export function toReview(s: AgentTrack, T: number, city: string, seen?: Seen, drafts?: Drafts): boolean {
  if (s.agent.parentAgentId) return false;
  if (hasDraft(s, drafts)) return true;
  if (stateAt(s, T) !== 'done') return false;
  return !seen?.has(seenKey(city, s.agent.sessionId, idxAt(s, T)));
}

/** Whether the draft service reports a draft for the session; a missing or failing service means no. */
export function hasDraft(s: AgentTrack, drafts?: Drafts): boolean {
  try { return drafts?.has(s.agent.sessionId) === true; } catch { return false; }
}

/** Deliverables presented by T: an extra marker on a session to review, no longer a condition. */
export const deliverablesAt = (s: AgentTrack, T: number) => s.deliverables.filter((d) => d.t <= T).reduce((a, d) => a + d.count, 0);

/**
 * The sessions at work at T: a root session counts while it or anyone in its family (subagents, engine runs) is
 * running, and it is not waiting for the member (that counts under "need you"). One definition for the today bar,
 * the neighbouring cities' chips and the list's Running group: a main turn that ended while its subagents still
 * work is still running.
 */
export function runningRoots(store: Store, T: number): Set<string> {
  const agents = store.agents();
  const parent = new Map(agents.map((s) => [s.agent.id, s.agent.parentAgentId]));
  const rootId = (id: string) => { let r = id; for (let k = 0; k < 32; k++) { const p = parent.get(r); if (!p || !parent.has(p)) break; r = p; } return r; };
  const out = new Set<string>();
  for (const s of agents) if (stateAt(s, T) === 'running') out.add(rootId(s.agent.id));
  for (const id of [...out]) { const r = store.agent(id); if (!r || stateAt(r, T) === 'waiting' || stateAt(r, T) === 'future') out.delete(id); }
  return out;
}

export function todayAt(store: Store, T: number, city: string, seen?: Seen, drafts?: Drafts): Today {
  const agents = store.agents();
  const need = rallyAt(store, T);
  const roots = agents.filter((s) => !s.agent.parentAgentId);
  const busy = runningRoots(store, T);
  const running = roots.filter((s) => busy.has(s.agent.id)).sort((a, b) => a.agent.startedAt - b.agent.startedAt || a.agent.id.localeCompare(b.agent.id));
  const review = roots.filter((s) => toReview(s, T, city, seen, drafts)).sort((a, b) => (a.agent.endedAt ?? 0) - (b.agent.endedAt ?? 0) || a.agent.id.localeCompare(b.agent.id));
  let errors = 0, tokens = 0;
  const errPlaces = new Map<string, number>();
  for (const s of agents) {
    errors += errsAt(s, T);
    tokens += cumAt(s, T);
    const k = idxAt(s, T);
    for (let i = 0; i < k; i++) {
      const e = s.ev[i];
      if (e.ok !== false) continue;
      const p = placeOfCall(store, s, e);
      errPlaces.set(p, Math.max(errPlaces.get(p) ?? 0, e.t));
    }
  }
  // Looking back, a run that came later today was still ahead at T (QA finding 13): the next run at T is the first
  // of the schedule's runs after T, or its next planned one.
  const nextOf = (x: ReturnType<Store['schedules']>[number]) => {
    let n = x.status === 'active' && x.nextAt !== undefined && x.nextAt > T ? x.nextAt : Infinity;
    for (const r of x.runs) if (r.at > T && r.at < n) n = r.at;
    return n;
  };
  const upcoming = store.schedules()
    .map((x) => ({ ...x, nextAt: nextOf(x) }))
    .filter((x) => Number.isFinite(x.nextAt))
    .sort((a, b) => a.nextAt - b.nextAt || a.id.localeCompare(b.id));
  const models = [...new Set(agents.flatMap((s) => s.usage.filter((u) => u.t <= T).map((u) => u.model)))].sort();
  return {
    need: need.length,
    waits: need,
    next: upcoming[0] ? { scheduleId: upcoming[0].id, at: upcoming[0].nextAt!, title: upcoming[0].title } : undefined,
    running: running.length,
    review: review.length,
    errors,
    tokens,
    items: {
      need: need.map((w) => w.agentId),
      sched: upcoming.map((x) => x.id),
      run: running.map((s) => s.agent.id),
      review: review.map((s) => s.agent.id),
      err: [...errPlaces].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p),
      tok: models.map(modelPlace),
    },
  };
}

/** The next item after `cursor` (-1 for the first press); wraps round. Returns -1 when there is none. */
export function nextIndex(cursor: number, length: number, step: 1 | -1 = 1): number {
  if (length <= 0) return -1;
  if (cursor < 0 || cursor >= length) return step === 1 ? 0 : length - 1;
  return (cursor + step + length) % length;
}
