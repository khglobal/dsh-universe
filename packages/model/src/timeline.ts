// The timeline: a scrubber over today, look-back to any moment, a replay of the
// day, and the wait bands. Pure: the panel keeps `scrub` (null = live) and `replay`, and asks these functions.
import { rallyAt } from './rally.ts';
import { dayStart } from './history.ts';
import { BIN_MS, errsAt, failedAt, type Store } from './store.ts';
import { FAILED_IN_SQUARE_MS } from './whereabouts.ts';
import type { WaitKind } from './rally.ts';

/** One key press moves the scrubber this far. */
export const SCRUB_STEP_MS = 60_000;
/** Dragging to within this of now (or past it) returns to live. */
export const LIVE_SNAP_MS = 30_000;
/** Replay: the day in 15 seconds; under reduced motion, 15 still steps (one every 450 ms, then live). */
export const REPLAY_MS = 15_000;
export const REPLAY_STEPS = 15;
export const REPLAY_STEP_MS = 450;

const HOUR = 3600_000;
/**
 * The span the timeline draws: 06:00–22:00, widened to whatever happened earlier or later today, and always to now
 * (between midnight and 06:00 the axis starts at the hour before now, so now has its marker and ← goes back a minute).
 */
export function daySpan(store: Store, live: number): [number, number] {
  const d0 = dayStart(live);
  let a = d0 + 6 * HOUR, b = d0 + 22 * HOUR;
  for (const s of store.agents()) if (s.agent.startedAt >= d0 && s.agent.startedAt < a) a = Math.max(d0, Math.floor(s.agent.startedAt / HOUR) * HOUR);
  if (live < a) a = Math.max(d0, Math.floor(live / HOUR) * HOUR - HOUR);
  if (live > b) b = Math.min(d0 + 24 * HOUR, Math.ceil(live / HOUR) * HOUR);
  return [a, b];
}

/** A scrubber value → the moment to show; null means live. */
export function scrubTo(v: number, live: number, from = dayStart(live)): number | null {
  if (!Number.isFinite(v) || v >= live - LIVE_SNAP_MS) return null;
  return Math.max(from, Math.round(v));
}

/** Keyboard: one minute per press (Home/End go to the start of the day / live). Past now → live. */
export function stepScrub(cur: number | null, live: number, key: string, from = dayStart(live)): number | null | undefined {
  const at = cur ?? live;
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': return scrubTo(at - SCRUB_STEP_MS, live, from);
    case 'ArrowRight': case 'ArrowUp': return cur === null ? null : scrubTo(at + SCRUB_STEP_MS, live, from);
    case 'PageDown': return scrubTo(at - 60 * SCRUB_STEP_MS, live, from);
    case 'PageUp': return cur === null ? null : scrubTo(at + 60 * SCRUB_STEP_MS, live, from);
    case 'Home': return from;
    case 'End': return null;
    default: return undefined;
  }
}

export interface Replay { /** Wall-clock start (ms). */ startedAt: number; from: number }

/** Where the replay starts: a little before the first thing that happened today, or the start of the day. */
export function replayFrom(store: Store, live: number): number {
  const d0 = dayStart(live);
  let first = Infinity;
  for (const s of store.agents()) if (s.agent.startedAt >= d0 && s.agent.startedAt < first) first = s.agent.startedAt;
  if (!Number.isFinite(first) || first >= live) return d0;
  return Math.max(d0, Math.floor((first - 5 * 60_000) / 60_000) * 60_000);
}

/**
 * The moment a replay shows at wall-clock `now`. Smooth over 15 seconds; under reduced motion 15 steps, no tween.
 * `done`: the replay is over and the view goes back to live.
 */
export function replayAt(r: Replay, now: number, live: number, reduced: boolean): { T: number; done: boolean; step?: number } {
  const span = Math.max(0, live - r.from);
  const el = Math.max(0, now - r.startedAt);
  if (reduced) {
    const n = Math.floor(el / REPLAY_STEP_MS);
    if (n >= REPLAY_STEPS) return { T: live, done: true, step: REPLAY_STEPS };
    return { T: Math.round(r.from + span * (n / (REPLAY_STEPS - 1))), done: false, step: n };
  }
  const u = el / REPLAY_MS;
  if (u >= 1) return { T: live, done: true };
  return { T: Math.round(r.from + span * u), done: false };
}

/** The distinct moments a reduced-motion replay shows (for tests and the screen-reader text). */
export const replaySteps = (from: number, live: number) =>
  Array.from({ length: REPLAY_STEPS }, (_, n) => Math.round(from + (live - from) * (n / (REPLAY_STEPS - 1))));

export interface WaitBand { agentId: string; sessionId: string; kind: WaitKind; from: number; to: number; open: boolean }

/**
 * Wait bands on the timeline: every approval, question and plan wait today (asked → decided, or → now when open),
 * and every stop on an error for the time it kept the agent in the square (≤ 90 minutes, or until the next turn).
 */
export function waitBands(store: Store, live: number): WaitBand[] {
  const d0 = dayStart(live);
  const out: WaitBand[] = [];
  for (const s of store.agents()) {
    for (const w of s.waits) {
      if (w.askedAt > live) continue;
      const to = w.decidedAt !== undefined && w.decidedAt <= live ? w.decidedAt : live;
      if (to < d0) continue;
      out.push({ agentId: s.agent.id, sessionId: s.agent.sessionId, kind: w.kind, from: Math.max(d0, w.askedAt), to, open: to === live && (w.decidedAt === undefined || w.decidedAt > live) });
    }
    const fails = s.turns.filter((x) => x.phase === 'end' && x.reason === 'error' && x.t <= live).map((x) => x.t);
    if (s.agent.state === 'failed' && s.agent.endedAt !== undefined && s.agent.endedAt <= live && !fails.includes(s.agent.endedAt)) fails.push(s.agent.endedAt);
    for (const f of fails) {
      if (failedAt(s, f) !== f) continue;
      const next = s.turns.find((x) => x.t > f && x.phase === 'start')?.t ?? Infinity;
      const to = Math.min(f + FAILED_IN_SQUARE_MS, next, live);
      if (to < d0) continue;
      out.push({ agentId: s.agent.id, sessionId: s.agent.sessionId, kind: 'error', from: Math.max(d0, f), to, open: to === live && next > live && f + FAILED_IN_SQUARE_MS > live });
    }
  }
  return out.sort((a, b) => a.from - b.from || a.agentId.localeCompare(b.agentId));
}

/** How many are waiting at each moment (a check that the bands and the square agree). */
export const waitingAt = (store: Store, T: number) => rallyAt(store, T).length;

/** What the timeline's hover plate says about one ten-minute bar. */
export interface BinReadout { from: number; to: number; calls: number; work: number; failed: number }
/** The ten minutes containing `at`: its calls, edit and command calls, and failed calls (results that came back failed). */
export function binReadout(store: Store, at: number): BinReadout {
  const from = Math.floor(at / BIN_MS) * BIN_MS, to = from + BIN_MS;
  const b = store.bins().get(from);
  let failed = 0;
  if (b) for (const s of store.agents()) failed += errsAt(s, to - 1) - errsAt(s, from - 1);
  return { from, to, calls: b?.calls ?? 0, work: b?.work ?? 0, failed };
}
