// Day-partitioned storage of model events (14 days), numbered so the client can ask for "everything after n".
// Keys: `day:<YYYY-MM-DD>:<chunk>` hold up to CHUNK numbered events; `meta` holds the counters. Writes are batched
// (every few seconds), so a busy host does constant work per event.
import type { SeqEvent, UEvent } from '@dsh-universe/model';
import { sanitize } from '@dsh-universe/adapter-kit';
import type { KvLike } from './kv.ts';

export const RETENTION_DAYS = 14;
export const CHUNK = 500;
/** Most events kept for one day; past it the day stops recording (and says so). */
export const MAX_EVENTS_PER_DAY = 100_000;

/** Local calendar day of a time. */
export function dayOf(t: number, tz?: string): string {
  const d = new Date(t);
  if (tz) return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Fields an event cannot do without (an event missing one is dropped when read back). */
const REQUIRED: Partial<Record<UEvent['type'], readonly string[]>> = {
  workspace: ['id'], agent: ['id'], activity: ['t', 'agentId'], turn: ['t', 'agentId', 'phase'], approval: ['id', 'agentId', 'askedAt'],
  job: ['id', 'agentId', 'startedAt'], deliverable: ['t', 'agentId'], schedule: ['id'], connector: ['id'], usage: ['t', 'agentId'],
  planmode: ['t', 'agentId'], retry: ['id', 't', 'agentId'],
};
/** Counts and sizes are never negative. */
const COUNTS = ['input', 'output', 'cacheRead', 'cacheWrite', 'tokens', 'count', 'durationMs', 'attempt', 'delayMs', 'hooks'];

/**
 * A stored record as read back, checked like a new event (the file can be damaged or edited by hand): the model's
 * fields only, the ones it needs present, no negative counts, and a number after `after`. Anything else is dropped.
 */
export function storedEvent(x: unknown, after: number): SeqEvent | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const { seq, e } = x as { seq?: unknown; e?: unknown };
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= after) return undefined;
  const clean = sanitize(e);
  if (!clean) return undefined;
  const d = clean.data as Record<string, unknown>;
  if ((REQUIRED[clean.type] ?? []).some((k) => d[k] === undefined)) return undefined;
  for (const k of COUNTS) if (typeof d[k] === 'number' && (d[k] as number) < 0) d[k] = 0;
  return { seq, e: clean };
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86_400_000);

interface Meta { version: 1; day: string; seq: number; chunks: number; full?: boolean; days: string[] }

export interface DayStore {
  /** Loads today's events (call once at start). */
  load(): Promise<void>;
  /** Appends an event to today; returns its number (0 when the day is full). */
  append(e: UEvent): number;
  /** Today's events after `seq`, at most `limit`. */
  since(seq: number, limit: number): { seq: number; events: SeqEvent[]; more: boolean };
  /** Today's date (rolls over to a new day first, like every other call). */
  day(): string;
  /** All of today. */
  today(): { day: string; seq: number; events: SeqEvent[]; full: boolean };
  /** Days with stored events, oldest first. */
  days(): string[];
  /** Events of an earlier stored day (for the 14-day totals). */
  readDay(day: string): Promise<UEvent[]>;
  flush(): Promise<void>;
  /** Deletes days older than RETENTION_DAYS. */
  prune(): Promise<number>;
  dispose(): Promise<void>;
}

export function createDayStore(o: {
  table: KvLike; now: () => number; flushMs?: number; tz?: string; onError?: (e: unknown) => void;
  /** At a new day: the events it starts with, from the day that ended (rollover.ts carryOver). */
  carry?: (day: string, events: readonly SeqEvent[]) => readonly UEvent[];
}): DayStore {
  let meta: Meta = { version: 1, day: dayOf(o.now(), o.tz), seq: 0, chunks: 0, days: [] };
  let events: SeqEvent[] = [];
  let flushed = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const key = (day: string, chunk: number) => `day:${day}:${chunk}`;
  const read = async (k: string) => { try { return await o.table.get(k); } catch (e) { o.onError?.(e); return undefined; } };

  function rollover() {
    const day = dayOf(o.now(), o.tz);
    if (day === meta.day) return;
    // A new day: the old one is written out first, then numbering starts again, with what carries over.
    void flush();
    const prevDay = meta.day, prev = events;
    meta = { version: 1, day, seq: 0, chunks: 0, days: meta.days.includes(meta.day) || !events.length ? meta.days : [...meta.days, meta.day] };
    events = [];
    flushed = 0;
    let seed: readonly UEvent[] = [];
    try { seed = o.carry?.(prevDay, prev) ?? []; } catch (e) { o.onError?.(e); }
    for (const e of seed) events.push({ seq: ++meta.seq, e });
    if (seed.length) schedule();
  }

  function schedule() {
    if (timer || o.flushMs === 0) return;
    timer = setTimeout(() => { timer = undefined; void flush(); }, o.flushMs ?? 5000);
    (timer as { unref?: () => void }).unref?.();
  }

  async function flush(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = undefined; }
    const day = meta.day, list = events, from = Math.floor(flushed / CHUNK) * CHUNK;
    if (flushed >= list.length) return writing;
    const upto = list.length;
    writing = writing.then(async () => {
      try {
        for (let c = from; c < upto; c += CHUNK) await o.table.put(key(day, c / CHUNK), list.slice(c, Math.min(c + CHUNK, upto)));
        const days = meta.days.includes(day) ? meta.days : [...meta.days, day];
        if (day === meta.day) meta.days = days;
        await o.table.put('meta', { ...meta, day, chunks: Math.ceil(upto / CHUNK), days });
        if (day === meta.day && list === events) flushed = Math.max(flushed, upto);
      } catch (e) { o.onError?.(e); }
    });
    return writing;
  }

  return {
    async load() {
      const m = (await read('meta')) as Meta | undefined;
      if (m && m.version === 1 && Array.isArray(m.days)) {
        meta.days = m.days.filter((d) => typeof d === 'string');
        if (m.day === meta.day) {
          let bad = 0;
          for (let c = 0; c < (Number.isInteger(m.chunks) ? m.chunks : 0); c++) {
            const chunk = await read(key(m.day, c));
            if (!Array.isArray(chunk)) continue;
            for (const x of chunk) {
              const ok = storedEvent(x, events.length ? events[events.length - 1].seq : 0);
              if (ok) events.push(ok); else bad++;
            }
          }
          if (bad) o.onError?.(Object.assign(new Error(bad + ' damaged record(s) skipped'), { name: 'DamagedRecords' }));
          meta.seq = events.length ? events[events.length - 1].seq : 0;
          meta.full = m.full === true;
          // Damaged records dropped: the whole day is written again (repaired) with the next flush.
          flushed = bad ? 0 : events.length;
          if (bad) schedule();
        }
      }
    },
    append(e) {
      rollover();
      if (events.length >= MAX_EVENTS_PER_DAY) { meta.full = true; return 0; }
      const seq = ++meta.seq;
      events.push({ seq, e });
      schedule();
      return seq;
    },
    since(seq, limit) {
      rollover();
      // Numbers restart each day: a client still on yesterday's numbers (seq beyond today's) gets today from 0.
      const from = seq > meta.seq ? 0 : seq;
      let lo = 0, hi = events.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (events[m].seq <= from) lo = m + 1; else hi = m; }
      const slice = events.slice(lo, lo + limit);
      return { seq: slice.length ? slice[slice.length - 1].seq : from, events: slice, more: lo + limit < events.length };
    },
    day() { rollover(); return meta.day; },
    today() { rollover(); return { day: meta.day, seq: meta.seq, events: events.slice(), full: !!meta.full }; },
    days: () => meta.days.slice(),
    async readDay(day) {
      const out: UEvent[] = [];
      for (let c = 0; ; c++) {
        const chunk = await read(key(day, c));
        if (!Array.isArray(chunk)) break;
        for (const x of chunk) { const ok = storedEvent(x, -1); if (ok) out.push(ok.e); }
      }
      return out;
    },
    flush,
    async prune() {
      const today = dayOf(o.now(), o.tz);
      const old = meta.days.filter((d) => daysBetween(d, today) >= RETENTION_DAYS);
      const keys = o.table.keys ? [...o.table.keys()].filter((k) => { const m = /^day:(\d{4}-\d{2}-\d{2}):/.exec(k); return !!m && daysBetween(m[1], today) >= RETENTION_DAYS; }) : [];
      // Without `keys`, walk the known days' chunks.
      if (!o.table.keys) for (const d of old) for (let c = 0; ; c++) { const k = key(d, c); if ((await read(k)) === undefined) break; keys.push(k); }
      try {
        if (keys.length) {
          if (o.table.deleteMany) await o.table.deleteMany(keys);
          else for (const k of keys) await o.table.delete?.(k);
        }
        meta.days = meta.days.filter((d) => !old.includes(d));
        await o.table.put('meta', { ...meta, chunks: Math.ceil(flushed / CHUNK) });
      } catch (e) { o.onError?.(e); }
      return keys.length;
    },
    async dispose() { await flush(); },
  };
}
