// The local "seen" marker for results to review. Key: city + session + number of calls at the
// time, so new work makes a session unseen again. Kept on this device, at most 500 entries. When storage cannot be
// read or written nothing breaks: everything counts as not seen.
export const SEEN_MAX = 500;

/**
 * Unsent drafts in the input box: an optional client service that answers with ids and
 * booleans only, never text. Missing (official DSH): drafts do not count.
 */
export interface Drafts { has(sessionId: string): boolean }

export interface SeenStorage { read(): string | null | undefined; write(value: string): void }

export const seenKey = (city: string, sessionId: string, calls: number) => city + ':' + sessionId + ':' + calls;

export interface Seen {
  has(key: string): boolean;
  /** Returns whether the key was new. */
  mark(key: string): boolean;
  size(): number;
  /** Counts the marks made (a change signal: `size` stops growing at SEEN_MAX). */
  version?(): number;
}

export function createSeen(storage?: SeenStorage): Seen {
  let keys: string[] = [];
  try {
    const raw = storage?.read();
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) keys = parsed.filter((x): x is string => typeof x === 'string').slice(-SEEN_MAX);
  } catch { keys = []; }
  const set = new Set(keys);
  let marks = 0;
  return {
    has: (k) => set.has(k),
    mark(k) {
      if (set.has(k)) return false;
      set.add(k);
      keys.push(k);
      marks++;
      while (keys.length > SEEN_MAX) set.delete(keys.shift()!);
      try { storage?.write(JSON.stringify(keys)); } catch { /* kept in memory for this run */ }
      return true;
    },
    size: () => set.size,
    version: () => marks,
  };
}
