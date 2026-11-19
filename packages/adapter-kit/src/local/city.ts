// A city from another tool's local session store, built incrementally: each pass lists the files touched in the
// last 14 days, reads only what was appended since the last pass (byte offsets), and stops when its time budget is
// spent, handing the event loop back every few milliseconds. The store's own format is read by a `StoreReader`;
// everything it emits goes through `sanitize`, so only model fields can come out.
//
// Older files (last touched before today) are read only at their head and tail, for the 14-day totals. Files touched
// today are read from the first line of today on (a binary search on byte offsets in a large file), so a long
// session's earlier history is never read in full.
import type { UDay, UEvent } from '@dsh-universe/model';
import { sanitize } from '../allow.ts';
import { budget, readLines, readNext, seekTime, type FileRef } from './files.ts';

export const WINDOW_DAYS = 14;
/** Bytes read from one file per step, and from a file's head and tail. */
const STEP_BYTES = 1 << 20, HEAD_BYTES = 64 << 10, TAIL_BYTES = 64 << 10;

export interface LineCtx {
  /** Local midnight of the city's day: only events at or after it are emitted. */
  dayStart: number;
  now: number;
  /** A model event (sanitized here; anything outside the model is dropped). */
  emit(e: unknown): void;
  /** Counts a root session for the day of `t` in the 14-day totals; `failed` when it stopped on an error that day. */
  mark(t: number, sessionId: string, failed?: boolean): void;
  /** True the first time a key is seen this day (a workspace announced once). */
  once(key: string): boolean;
  /** A session title the member set explicitly (never a generated summary): used only to pick the room theme. */
  title?(sessionId: string, title: string): void;
}

export interface StoreReader<S> {
  /** Files to consider, touched at or after `since`. */
  list(since: number, tick: () => Promise<void>): Promise<FileRef[]>;
  /** Fresh state for a file (path-derived ids, a side file such as a subagent's metadata). */
  open(file: FileRef): Promise<S> | S;
  /** A line's time, read cheaply (for seeking in a large file). */
  timeOf(line: string): number | undefined;
  /** The first lines of a file, once: session metadata. */
  head?(state: S, lines: readonly string[], ctx: LineCtx): void;
  /** The last lines of a file not touched today: whether its last day ended on an error. */
  tail?(state: S, lines: readonly string[], ctx: LineCtx): void;
  /** One line, in file order, from today's first line on. */
  line(state: S, line: string, ctx: LineCtx): void;
  /** After each pass: settle what the store never closes (a session left mid-turn). */
  settle?(state: S, ctx: LineCtx): void;
}

export interface PassResult { events: UEvent[]; complete: boolean; /** The day changed: everything before is stale. */ reset: boolean }

export interface LocalCity {
  /** One incremental pass. */
  pass(): Promise<PassResult>;
  /** Totals of the last 14 days (today included). */
  history(): UDay[];
  day(): string;
  /** Something changed on disk: list the files again on the next pass. */
  touch(): void;
}

export function localDay(t: number): string {
  const d = new Date(t), p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

interface Track<S> { state: S; offset: number; size: number; mtimeMs: number; caught: boolean }

export function createLocalCity<S>(reader: StoreReader<S>, o: { now?: () => number; passMs?: number; relistMs?: number; onTitle?: (sessionId: string, title: string) => void } = {}): LocalCity {
  const now = o.now ?? Date.now;
  let day = localDay(now()), dayStart = midnight(now());
  let files = new Map<string, Track<S>>();
  let sessions = new Map<string, Set<string>>(), failed = new Map<string, Set<string>>();
  let listed: FileRef[] = [], listedAt = -Infinity, dirty = true;
  let seenKeys = new Set<string>();

  const ctxFor = (out: UEvent[]): LineCtx => ({
    dayStart, now: now(),
    once(k) { if (seenKeys.has(k)) return false; seenKeys.add(k); return true; },
    emit(e) { const c = sanitize(e); if (c) out.push(c); },
    mark(t, sid, f) {
      const d = localDay(t);
      if (Date.parse(d + 'T00:00:00') < dayStart - WINDOW_DAYS * 86_400_000) return;
      (sessions.get(d) ?? sessions.set(d, new Set()).get(d)!).add(sid);
      if (f) (failed.get(d) ?? failed.set(d, new Set()).get(d)!).add(sid);
    },
    ...(o.onTitle ? { title: o.onTitle } : {}),
  });

  return {
    day: () => day,
    touch() { dirty = true; },
    history() {
      const days = [...sessions.keys()].sort().slice(-WINDOW_DAYS);
      return days.map((d) => ({ day: d, sessions: sessions.get(d)!.size, failed: [...(failed.get(d) ?? [])].filter((x) => sessions.get(d)!.has(x)).length }));
    },
    async pass() {
      const out: UEvent[] = [];
      let reset = false;
      if (localDay(now()) !== day) {
        // A new day: today's city starts empty and the files are read again (older ones only at head and tail).
        day = localDay(now()); dayStart = midnight(now());
        files = new Map(); sessions = new Map(); failed = new Map(); seenKeys = new Set(); dirty = true; reset = true;
      }
      const b = budget(o.passMs ?? 400);
      const ctx = ctxFor(out);
      if (dirty || now() - listedAt > (o.relistMs ?? 10_000)) {
        listed = (await reader.list(dayStart - WINDOW_DAYS * 86_400_000, b.tick)).sort((x, y) => y.mtimeMs - x.mtimeMs);
        listedAt = now(); dirty = false;
      }
      let complete = true;
      for (const f of listed) {
        if (b.over()) { complete = false; break; }
        await b.tick();
        let tr = files.get(f.path);
        if (!tr) {
          tr = { state: await reader.open(f), offset: 0, size: 0, mtimeMs: 0, caught: false };
          files.set(f.path, tr);
          const head = await readLines(f.path, 0, Math.min(f.size, HEAD_BYTES));
          reader.head?.(tr.state, head.lines, ctx);
          if (f.mtimeMs < dayStart) {
            // Not touched today: only its last lines (did it end on an error), then it is caught up.
            const tail = await readLines(f.path, Math.max(0, f.size - TAIL_BYTES), f.size);
            reader.tail?.(tr.state, f.size > TAIL_BYTES ? tail.lines.slice(1) : tail.lines, ctx);
            tr.offset = tail.end;
          } else {
            tr.offset = await seekTime(f.path, f.size, dayStart, (l) => reader.timeOf(l));
          }
        }
        // Rewritten or cut short: read again from the start.
        if (f.size < tr.offset) { tr.offset = 0; }
        tr.size = f.size; tr.mtimeMs = f.mtimeMs;
        while (tr.offset < tr.size) {
          if (b.over()) { complete = false; break; }
          const r = await readNext(f.path, tr.offset, tr.size, STEP_BYTES);
          if (r.offset === tr.offset) break;
          tr.offset = r.offset;
          for (const line of r.lines) { reader.line(tr.state, line, ctx); await b.tick(); }
        }
        tr.caught = tr.offset >= tr.size;
        if (!tr.caught) complete = false;
      }
      for (const tr of files.values()) reader.settle?.(tr.state, ctx);
      return { events: out, complete, reset };
    },
  };
}
