// Daily totals over the last 14 days: sessions started and sessions that
// stopped on an error, per day. Earlier days come from what the host stored; today is counted live from the store
// so it moves with the timeline. Days the host has nothing for are marked unknown, not zero.
import type { Store } from './store.ts';
import type { UDay } from './types.ts';

export const HISTORY_DAYS = 14;

export interface HistoryDay extends UDay {
  /** false: the host has no record of the day (the plugin was not running); drawn as an empty lot, not as zero. */
  known: boolean;
  today: boolean;
}

const pad = (x: number) => String(x).padStart(2, '0');
/** Local calendar day of a time ("2026-11-19"), the same key the host uses. */
export const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
/** Local midnight at the start of T's day. */
export const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Today's totals at T from the store: root sessions started by T, and those that had a turn end on an error by T. */
export function todayTotals(store: Store, T: number): UDay {
  let sessions = 0, failed = 0;
  const from = dayStart(T);
  for (const s of store.agents()) {
    const a = s.agent;
    if (a.parentAgentId || a.startedAt > T || a.startedAt < from) continue;
    sessions++;
    if (s.turns.some((x) => x.t <= T && x.phase === 'end' && x.reason === 'error') || (a.state === 'failed' && a.endedAt !== undefined && a.endedAt <= T)) failed++;
  }
  return { day: dayKey(T), sessions, failed };
}

/** The 14 days ending with T's day, oldest first. Today is live; a stored row for today is ignored. */
/**
 * `complete`: the source covers every day of the window (a neighbouring city's own store, read 14 days back), so a
 * day it has nothing for had no sessions; otherwise (DSH's own day storage) such a day is unknown.
 */
export function historyWindow(stored: readonly UDay[], store: Store, T: number, n = HISTORY_DAYS, complete = false): HistoryDay[] {
  const byDay = new Map(stored.map((d) => [d.day, d]));
  const out: HistoryDay[] = [];
  const base = new Date(dayStart(T));
  for (let k = n - 1; k >= 0; k--) {
    const d = new Date(base);
    d.setDate(base.getDate() - k);
    const key = dayKey(d.getTime());
    if (k === 0) { out.push({ ...todayTotals(store, T), known: true, today: true }); continue; }
    const row = byDay.get(key);
    out.push(row ? { day: key, sessions: row.sessions, failed: row.failed, known: true, today: false } : { day: key, sessions: 0, failed: 0, known: complete, today: false });
  }
  return out;
}
