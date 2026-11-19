// The floors of every place and their numbers at T. A floor whose data the platform
// cannot give is marked `na` and shows "not provided".
import { FLOOR_KINDS, FLOOR_OF, PLACE, buildingOf, connectorPlace, modelPlace } from './places.ts';
import { idxAt, cumAt, stateAt, type AgentTrack, type Store } from './store.ts';
import { rallyAt, type WaitKind } from './rally.ts';
import type { StateAt, UCapabilities } from './types.ts';
import { whereabouts } from './whereabouts.ts';

export interface Floor {
  id: string;
  n: number;
  /** The platform does not provide this data. */
  na?: boolean;
  /** `n` is a token count / an average in milliseconds. */
  unit?: 'tokens' | 'ms';
  /** Agents on this floor at T (ids). */
  agents: string[];
  /** Running background jobs (machine room). */
  jobs?: number;
  /** States of the subagents (meeting room). */
  subs?: StateAt[];
  /** Deliverables of a finished session (lobby). */
  out?: number;
  /** Calls on this floor in the last minute, newest first, at most 8: seconds ago and whether it failed. */
  recent?: RecentCall[];
  /** Failed calls on this floor so far. */
  errors?: number;
  /** Repair log: retries whose wait is over and that went again. */
  recovered?: number;
}

/** A recent call as a room shows it: an age and a failure flag, nothing else. */
export interface RecentCall { age: number; err: boolean }
/** How far back "recent" goes (the call tape of a room). */
export const RECENT_CALL_MS = 60_000;

/** Calls in the last minute matching `pred`, newest first. */
export function recentCalls(store: Store, T: number, pred: (s: AgentTrack, i: number) => boolean, max = 8): RecentCall[] {
  const out: RecentCall[] = [];
  for (const s of store.agents()) {
    for (let i = idxAt(s, T) - 1; i >= 0 && s.ev[i].t > T - RECENT_CALL_MS; i--) if (pred(s, i)) out.push({ age: (T - s.ev[i].t) / 1000, err: s.ev[i].ok === false });
  }
  return out.sort((a, b) => a.age - b.age).slice(0, max);
}

const F = (id: string, n: number, extra: Partial<Floor> = {}): Floor => ({ id, n, agents: [], ...extra });

function countCalls(store: Store, T: number, pred: (s: AgentTrack, i: number) => boolean): number {
  let n = 0;
  for (const s of store.agents()) {
    const k = idxAt(s, T);
    for (let i = 0; i < k; i++) if (pred(s, i)) n++;
  }
  return n;
}

export function floorsOf(store: Store, placeId: string, T: number, caps: UCapabilities): Floor[] {
  const all = store.agents();
  let fl: Floor[];
  if (placeId.startsWith('b:')) {
    const fam = all.filter((s) => buildingOf(store, s) === placeId);
    const counts = new Map<string, number>();
    let tokens = 0;
    for (const s of fam) {
      tokens += cumAt(s, T);
      const k = idxAt(s, T);
      for (let i = 0; i < k; i++) {
        const f = FLOOR_OF[s.ev[i].category];
        if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
    const root = fam.find((s) => !s.agent.parentAgentId);
    const rootState = root ? stateAt(root, T) : 'future';
    const out = root && rootState === 'done' ? root.deliverables.filter((d) => d.t <= T).reduce((a, d) => a + d.count, 0) : 0;
    fl = [F('lobby', fam.filter((s) => s.agent.startedAt <= T).length, { out })];
    const here = new Set(fam.map((s) => whereabouts(store, s, T)).filter((w) => w?.place === placeId).map((w) => w!.floor));
    const famIds = new Set(fam.map((s) => s.agent.id));
    const running = caps.jobs ? fam.flatMap((s) => s.jobs).filter((j) => j.startedAt <= T && (j.endedAt === undefined || j.endedAt > T)).length : undefined;
    for (const id of FLOOR_KINDS) {
      const n = counts.get(id) ?? 0;
      if (n === 0 && !here.has(id)) continue;
      // Every room shows the family's running background jobs on its printers.
      const extra: Partial<Floor> = { jobs: running };
      extra.recent = recentCalls(store, T, (s, i) => famIds.has(s.agent.id) && FLOOR_OF[s.ev[i].category] === id);
      let errors = 0;
      for (const s of fam) { const k = idxAt(s, T); for (let i = 0; i < k; i++) if (s.ev[i].ok === false && FLOOR_OF[s.ev[i].category] === id) errors++; }
      extra.errors = errors;
      if (id === 'meeting') extra.subs = fam.filter((s) => s.agent.parentAgentId && s.agent.startedAt <= T).map((s) => stateAt(s, T));
      fl.push(F(id, n, extra));
    }
    fl.push(F('roof', tokens, { unit: 'tokens', na: !caps.tokens }));
  } else if (placeId.startsWith('conn:')) {
    const per = new Map<string, number>();
    const id = placeId.slice(5);
    const c = store.connectors().find((x) => x.id === id);
    for (const t of c?.tools ?? []) per.set(t, 0);
    for (const s of all) {
      const k = idxAt(s, T);
      for (let i = 0; i < k; i++) if (s.ev[i].connectorId === id) per.set(s.ev[i].tool, (per.get(s.ev[i].tool) ?? 0) + 1);
    }
    fl = [...per].map(([tool, n]) => F(tool, n, { recent: recentCalls(store, T, (s, i) => s.ev[i].connectorId === id && s.ev[i].tool === tool) }));
    if (!fl.length) fl = [F('lobby', 0)];
  } else if (placeId.startsWith('model:')) {
    const m = placeId.slice(6);
    let tok = 0, ms = 0, n = 0;
    for (const s of all) {
      let t = 0;
      for (const u of s.usage) if (u.t <= T && u.model === m) t += u.input + u.output;
      tok += t;
      if (s.agent.model === m) {
        const k = idxAt(s, T);
        for (let i = 0; i < k; i++) if (s.ev[i].durationMs !== undefined) { ms += s.ev[i].durationMs!; n++; }
      }
    }
    fl = [F('turbine', tok, { unit: 'tokens', na: !caps.tokens }), F('control', n ? Math.round(ms / n) : 0, { unit: 'ms', na: !caps.latency })];
  } else if (placeId === PLACE.station) {
    const runs = store.schedules().flatMap((x) => x.runs).filter((r) => r.at <= T).length;
    fl = [F('platform', runs, { na: !caps.schedules }), F('gate', countCalls(store, T, (s, i) => s.ev[i].category === 'web'))];
  } else if (placeId === PLACE.town) {
    // One figure for "needs you": the square's waits (rallyAt, the card's and the today bar's count), each on the desk
    // of its kind; stops on an error on the post floor. The floors always add up to the card.
    const waits = rallyAt(store, T);
    const n = (kind: WaitKind) => waits.filter((w) => w.kind === kind).length;
    fl = [F('approval', n('approval'), { na: !caps.approvals }), F('question', n('question')), F('plan', n('plan')), F('post', n('error'))];
  } else if (placeId === PLACE.fire) {
    // The repair log: model requests retried today by T (`recovered`: the retry's wait ended and it went again).
    let retries = 0, recovered = 0;
    for (const s of all) for (const r of s.retries) { if (r.t > T) continue; retries++; if (r.startedAt !== undefined && r.startedAt <= T) recovered++; }
    fl = [F('bay', countCalls(store, T, (s, i) => s.ev[i].ok === false)), F('retry', retries, { na: !caps.retries, recovered })];
  } else if (placeId === PLACE.library) {
    fl = [F('memory', countCalls(store, T, (s, i) => s.ev[i].category === 'memory'), { na: !caps.memory })];
  } else if (placeId === PLACE.school) {
    fl = [
      F('skill', countCalls(store, T, (s, i) => s.ev[i].category === 'skill'), { na: !caps.skills }),
      F('expert', all.filter((s) => !s.agent.parentAgentId && s.agent.role && s.agent.startedAt <= T).length),
    ];
  } else {
    fl = [F('lobby', 0)];
  }
  // Who is on which floor right now (the town keeps its people outside in the square).
  for (const s of all) {
    const w = whereabouts(store, s, T);
    if (!w || w.place !== placeId || w.floor === 'done' || (w.floor === 'failed' && placeId !== PLACE.town)) continue;
    const floor = placeId === PLACE.town && w.floor === 'failed' ? 'post' : w.floor;
    (fl.find((f) => f.id === floor) ?? fl[0]).agents.push(s.agent.id);
  }
  return fl;
}

export { connectorPlace, modelPlace };
