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
import { budget, pathId, readLines, readNext, seekTime, type FileRef } from './files.ts';

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

/**
 * What a city has read, kept by the host across restarts so a large store is not read again. Files are keyed by a
 * hash of their path (no path is kept); each carries how far it was read and its reader state. `day` is the day the
 * files touched that day were read for: on the same day everything is reused (with the events kept beside it); on a
 * later day only files read at head and tail (not touched since) are, with the 14-day marks they gave.
 */
export interface CityCheckpoint {
  v: 1;
  /** '' when the day's own reading is not kept (only older files are). */
  day: string;
  files: { k: string; o: number; s: number; m: number; old?: 1; mk?: [number, string, 0 | 1][]; st: unknown }[];
  sessions: [string, string[]][];
  failed: [string, string[]][];
  keys: string[];
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
  /** What was read so far, to be kept across restarts (`oldOnly`: only files read at head and tail). */
  save(oldOnly?: boolean): CityCheckpoint;
  /** What the checkpoint given at creation restored: all of today ('day'), only older files ('old') or nothing. */
  restored(): 'day' | 'old' | 'none';
}

export function localDay(t: number): string {
  const d = new Date(t), p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const midnight = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };

interface Track<S> { state: S; offset: number; size: number; mtimeMs: number; caught: boolean; old?: boolean; marks?: [number, string, 0 | 1][] }

/** Reader state to JSON and back: Maps and Sets are tagged, everything else is plain data. */
const MAP = '\u0000m', SET = '\u0000s';
export function pack(v: unknown): unknown {
  if (v instanceof Map) return { [MAP]: [...v].map(([k, x]) => [k, pack(x)]) };
  if (v instanceof Set) return { [SET]: [...v].map(pack) };
  if (Array.isArray(v)) return v.map(pack);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
  return v;
}
export function unpack(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unpack);
  if (v && typeof v === 'object') {
    const r = v as Record<string, unknown>;
    if (Array.isArray(r[MAP])) return new Map((r[MAP] as [unknown, unknown][]).map(([k, x]) => [k, unpack(x)]));
    if (Array.isArray(r[SET])) return new Set((r[SET] as unknown[]).map(unpack));
    return Object.fromEntries(Object.entries(r).map(([k, x]) => [k, unpack(x)]));
  }
  return v;
}
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** A checkpoint read back from storage, checked field by field; anything malformed gives undefined. */
export function readCheckpoint(v: unknown): CityCheckpoint | undefined {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
  if (!r || r.v !== 1 || typeof r.day !== 'string' || !Array.isArray(r.files) || !Array.isArray(r.sessions) || !Array.isArray(r.failed) || !Array.isArray(r.keys)) return undefined;
  const days = (x: unknown[]) => x.every((d) => Array.isArray(d) && typeof d[0] === 'string' && Array.isArray(d[1]) && d[1].every((s: unknown) => typeof s === 'string'));
  if (!days(r.sessions) || !days(r.failed) || !r.keys.every((k) => typeof k === 'string')) return undefined;
  const ok = r.files.every((f) => {
    const x = f && typeof f === 'object' ? (f as Record<string, unknown>) : undefined;
    return !!x && typeof x.k === 'string' && isNum(x.o) && isNum(x.s) && isNum(x.m) && x.o <= x.s
      && (x.mk === undefined || (Array.isArray(x.mk) && x.mk.every((m) => Array.isArray(m) && isNum(m[0]) && typeof m[1] === 'string')));
  });
  return ok ? (r as unknown as CityCheckpoint) : undefined;
}

export function createLocalCity<S>(reader: StoreReader<S>, o: { now?: () => number; passMs?: number; relistMs?: number; onTitle?: (sessionId: string, title: string) => void; restore?: CityCheckpoint } = {}): LocalCity {
  const now = o.now ?? Date.now;
  let day = localDay(now()), dayStart = midnight(now());
  let files = new Map<string, Track<S>>();
  let sessions = new Map<string, Set<string>>(), failed = new Map<string, Set<string>>();
  let listed: FileRef[] = [], listedAt = -Infinity, dirty = true;
  let seenKeys = new Set<string>();
  // Files kept from an earlier run, by path hash: taken up when the listing finds them.
  let kept = new Map<string, CityCheckpoint['files'][number]>();
  let restored: 'day' | 'old' | 'none' = 'none';
  if (o.restore) {
    const cp = o.restore;
    if (cp.day === day) {
      restored = 'day';
      sessions = new Map(cp.sessions.map(([d, l]) => [d, new Set(l)]));
      failed = new Map(cp.failed.map(([d, l]) => [d, new Set(l)]));
      seenKeys = new Set(cp.keys);
      for (const f of cp.files) kept.set(f.k, f);
    } else {
      // Another day: only files read at head and tail, untouched since, are taken as they were.
      for (const f of cp.files) if (f.old && f.m < dayStart) kept.set(f.k, f);
      if (kept.size) restored = 'old';
    }
  }

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
    restored: () => restored,
    save(oldOnly) {
      const out: CityCheckpoint = { v: 1, day: oldOnly ? '' : day, files: [], sessions: [], failed: [], keys: oldOnly ? [] : [...seenKeys] };
      for (const [path, tr] of files) {
        if (oldOnly && !tr.old) continue;
        out.files.push({ k: pathId(path), o: tr.offset, s: tr.size, m: tr.mtimeMs, ...(tr.old ? { old: 1 as const, mk: tr.marks ?? [] } : {}), st: pack(tr.state) });
      }
      if (!oldOnly) {
        out.sessions = [...sessions].map(([d, l]) => [d, [...l]]);
        out.failed = [...failed].map(([d, l]) => [d, [...l]]);
      }
      return out;
    },
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
        files = new Map(); sessions = new Map(); failed = new Map(); seenKeys = new Set(); kept = new Map(); dirty = true; reset = true;
      }
      const b = budget(o.passMs ?? 400);
      const ctx = ctxFor(out);
      // Listed again after a change on disk, and anyway every few seconds (a watcher can miss a new file; listing is
      // cheap next to reading), so a new session shows up within one regular pass.
      // (Real time: the city's clock may be fixed in tests and replays.)
      if (dirty || performance.now() - listedAt > (o.relistMs ?? 4_000)) {
        listed = (await reader.list(dayStart - WINDOW_DAYS * 86_400_000, b.tick)).sort((x, y) => y.mtimeMs - x.mtimeMs);
        listedAt = performance.now(); dirty = false;
      }
      let complete = true;
      for (const f of listed) {
        if (b.over()) { complete = false; break; }
        await b.tick();
        let tr = files.get(f.path);
        const k = !tr && kept.size ? pathId(f.path) : undefined;
        const prev = k !== undefined ? kept.get(k) : undefined;
        if (prev) kept.delete(k!);
        if (!tr && prev && (restored === 'day' ? f.size >= prev.o : prev.s === f.size && prev.m === f.mtimeMs)) {
          // Read in an earlier run: go on from where it stopped (or, untouched since, take its marks as they were).
          tr = { state: unpack(prev.st) as S, offset: prev.o, size: prev.s, mtimeMs: prev.m, caught: false, ...(prev.old ? { old: true, marks: prev.mk ?? [] } : {}) };
          files.set(f.path, tr);
          if (restored === 'old') for (const [t, sid, x] of tr.marks ?? []) ctx.mark(t, sid, x === 1);
        }
        if (!tr) {
          tr = { state: await reader.open(f), offset: 0, size: 0, mtimeMs: 0, caught: false };
          files.set(f.path, tr);
          const head = await readLines(f.path, 0, Math.min(f.size, HEAD_BYTES));
          reader.head?.(tr.state, head.lines, ctx);
          if (f.mtimeMs < dayStart) {
            // Not touched today: only its last lines (did it end on an error), then it is caught up.
            const tail = await readLines(f.path, Math.max(0, f.size - TAIL_BYTES), f.size);
            // Its marks are kept with it, so a later run can take them without reading the file again.
            const marks: [number, string, 0 | 1][] = [];
            reader.tail?.(tr.state, f.size > TAIL_BYTES ? tail.lines.slice(1) : tail.lines, { ...ctx, mark(t, sid, x) { marks.push([t, sid, x ? 1 : 0]); ctx.mark(t, sid, x); } });
            tr.offset = tail.end; tr.old = true; tr.marks = marks;
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
          // An older file written to again: its lines now count for today, so it is no longer kept as it was.
          if (tr.old) { tr.old = false; tr.marks = undefined; }
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
