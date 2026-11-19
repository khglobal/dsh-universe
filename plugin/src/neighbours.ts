// The adjacent cities on the host: Claude Code and Codex sessions on this device. Shown whenever their store is
// found (detection is only whether the store's folder exists: a cloud workspace has none, so the panel stays silent
// there), unless the member turned one off. Nothing is read until the panel asks for a city or its figures; a city
// nobody looks at stops reading, and turning one off stops the reading and drops what was read. Each city keeps its
// own placement, so its buildings keep their lots too.
//
// A large store takes seconds to read, so what was read is kept in the plugin's storage on this device (file hashes,
// offsets and reader state, plus today's events, never a path or any content) and taken up on the next start: only
// what changed since is read again.
import { homedir } from 'node:os';
import { createStore, themeFromTitle, todayAt, type Store, type UEvent } from '@dsh-universe/model';
import { createClaudeCodeAdapter } from '@dsh-universe/adapter-claude-code';
import { createCodexAdapter } from '@dsh-universe/adapter-codex';
import { localDay, readCheckpoint, type AdapterCheckpoint, type LocalAdapter } from '@dsh-universe/adapter-kit/local';
import { NEIGHBOURS, createPlacementKeeper, type KvLike, type NeighbourId, type NeighbourRoutes, type NeighbourSummary, type PlacementKeeper, type SinceValue, type SnapshotValue } from '@dsh-universe/adapter-dsh';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** A city nobody looked at for this long stops reading (it starts again on the next look). */
export const IDLE_MS = 5 * 60_000;
/** While a city changes, what was read is kept at most this often (and always when it stops reading). */
export const SAVE_MS = 60_000;
/** Events per storage entry; past `MAX_KEPT` events only the older files' reading is kept. */
const CHUNK = 2000, MAX_KEPT = 100_000;
export const indexKey = (id: NeighbourId) => 'index:' + id;
const chunkKey = (id: NeighbourId, i: number) => `index:${id}:${i}`;

interface City {
  adapter?: LocalAdapter; keeper: PlacementKeeper; store: Store; off: () => void; seen: number; lastAt: number; epoch: number; ready: Promise<void>;
  /** What is in storage: the events kept, the chunks written, when; -1 when nothing was written in this run. */
  savedLen: number; savedChunks: number; savedAt: number; savedEpoch: number; saving?: Promise<void>;
}

export function createNeighbours(o: { places: KvLike; home?: string; now?: () => number; log?: (m: string) => void; passMs?: number; saveMs?: number }): NeighbourRoutes & { dispose(): Promise<void> } {
  const home = o.home ?? homedir();
  const now = o.now ?? Date.now;
  const saveMs = o.saveMs ?? SAVE_MS;
  const cities = new Map<NeighbourId, City>();
  const make = (id: NeighbourId, restore?: AdapterCheckpoint): LocalAdapter => id === 'claude-code'
    ? createClaudeCodeAdapter({ home, now, passMs: o.passMs, restore, onTitle: (sid, title) => { const c = cities.get(id); if (c?.keeper.theme(sid, themeFromTitle(title))) void c.keeper.flush(); } })
    : createCodexAdapter({ home, now, passMs: o.passMs, restore });
  const roots: Record<NeighbourId, string> = { 'claude-code': join(home, '.claude', 'projects'), codex: join(home, '.codex', 'sessions') };
  const TITLES: Record<NeighbourId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

  /** The reading kept by an earlier run; anything malformed or incomplete is read again instead. */
  async function load(id: NeighbourId): Promise<{ restore?: AdapterCheckpoint; chunks: number }> {
    try {
      const m = (await o.places.get(indexKey(id))) as { v?: unknown; n?: unknown; chunks?: unknown; city?: unknown } | undefined;
      const chunks = typeof m?.chunks === 'number' && Number.isInteger(m.chunks) && m.chunks >= 0 ? m.chunks : 0;
      const city = m?.v === 1 ? readCheckpoint(m.city) : undefined;
      if (!city) return { chunks };
      const events: UEvent[] = [];
      if (city.day === localDay(now())) {
        for (let i = 0; i < chunks; i++) {
          const part = await o.places.get(chunkKey(id, i));
          if (!Array.isArray(part)) break;
          for (const e of part) events.push(e as UEvent);
        }
        // Today's events must be all there to go on from the files' offsets; else only older files are taken.
        if (events.length !== m!.n) { city.day = ''; events.length = 0; }
      }
      return { restore: { city, events }, chunks };
    } catch { o.log?.('neighbours: kept reading not available'); return { chunks: 0 }; }
  }

  async function save(id: NeighbourId, c: City): Promise<void> {
    if (!c.adapter || c.saving) return c.saving;
    const a = c.adapter;
    c.saving = (async () => {
      try {
        const big = a.events().length > MAX_KEPT;
        const cp = await a.checkpoint(big);
        const epoch = a.epoch();
        // Only the chunks that changed: the log only grows within a day.
        const from = c.savedEpoch === epoch && c.savedLen >= 0 ? Math.floor(c.savedLen / CHUNK) : 0;
        const chunks = Math.ceil(cp.events.length / CHUNK);
        for (let i = from; i < chunks; i++) await o.places.put(chunkKey(id, i), cp.events.slice(i * CHUNK, (i + 1) * CHUNK));
        await o.places.put(indexKey(id), { v: 1, n: cp.events.length, chunks, city: cp.city });
        if (c.savedChunks > chunks) await drop(id, chunks, c.savedChunks);
        c.savedLen = cp.events.length; c.savedChunks = chunks; c.savedAt = now(); c.savedEpoch = epoch;
      } catch { o.log?.('neighbours: reading not kept'); } finally { c.saving = undefined; }
    })();
    return c.saving;
  }
  async function drop(id: NeighbourId, from: number, to: number) {
    const keys = Array.from({ length: Math.max(0, to - from) }, (_, i) => chunkKey(id, from + i));
    try {
      if (o.places.deleteMany) await o.places.deleteMany(keys);
      else for (const k of keys) await o.places.delete?.(k);
    } catch { o.log?.('neighbours: kept reading not dropped'); }
  }

  /** New events: into the city's figures and its placement. */
  function ingest(c: City) {
    const a = c.adapter!;
    if (a.epoch() !== c.epoch) { c.epoch = a.epoch(); c.seen = 0; c.store = createStore(); }
    const list = a.events();
    if (list.length <= c.seen) return;
    const fresh = list.slice(c.seen);
    c.store.applyAll(fresh);
    if (c.keeper.observe(fresh)) void c.keeper.flush();
    c.seen = list.length;
  }

  function open(id: NeighbourId): City {
    let c = cities.get(id);
    if (!c) {
      const keeper = createPlacementKeeper({ table: o.places, key: 'placement:' + id, onError: () => o.log?.('neighbours: placement not kept') });
      const city: City = { keeper, store: createStore(), off: () => {}, seen: 0, lastAt: now(), epoch: 0, ready: Promise.resolve(), savedLen: -1, savedChunks: 0, savedAt: 0, savedEpoch: -1 };
      city.ready = (async () => {
        const [, kept] = await Promise.all([keeper.load(), load(id)]);
        city.savedChunks = kept.chunks;
        if (cities.get(id) !== city) return;
        const adapter = make(id, kept.restore);
        city.adapter = adapter;
        city.epoch = adapter.epoch();
        // What was taken up counts as kept already.
        if (kept.restore?.city.day && adapter.events().length) { city.savedLen = adapter.events().length; city.savedEpoch = adapter.epoch(); city.savedAt = now(); }
        ingest(city);
        city.off = adapter.subscribe(() => ingest(city));
      })();
      cities.set(id, c = city);
    }
    c.lastAt = now();
    return c;
  }
  async function close(id: NeighbourId, keep: boolean) {
    const c = cities.get(id);
    if (!c) return;
    cities.delete(id);
    await c.ready.catch(() => undefined);
    c.off();
    if (keep && c.adapter?.caughtUp()) await save(id, c);
    await c.saving;
    await c.adapter?.stop();
    await c.keeper.flush();
  }
  // Every few seconds: idle cities stop reading; a city read through and changed keeps what it read (soon after its
  // first full read, then at most every `saveMs`).
  const timer = setInterval(() => {
    for (const [id, c] of cities) {
      if (now() - c.lastAt > IDLE_MS) { void close(id, true); continue; }
      const a = c.adapter;
      if (!a?.caughtUp() || c.saving) continue;
      const changed = c.savedLen !== a.events().length || c.savedEpoch !== a.epoch();
      if (changed && (c.savedLen < 0 || now() - c.savedAt >= saveMs)) void save(id, c);
    }
  }, Math.min(15_000, saveMs));
  (timer as { unref?: () => void }).unref?.();

  const state = (a: LocalAdapter): SnapshotValue['backfill'] => (a.caughtUp() ? 'done' : 'pending');
  return {
    detect: () => NEIGHBOURS.map((id) => ({ id, present: existsSync(roots[id]) })),
    async summary(ids) {
      const out: NeighbourSummary[] = [];
      for (const id of ids) {
        if (!existsSync(roots[id])) continue;
        const c = open(id);
        await c.ready;
        const d = todayAt(c.store, now(), 'nb:' + id);
        out.push({ id, ready: !!c.adapter?.caughtUp(), running: d.running, errors: d.errors, tokens: d.tokens });
      }
      return out;
    },
    async snapshot(id) {
      const c = open(id);
      await c.ready;
      const a = c.adapter!;
      // The first look waits a moment for the first pass (newest files first); the rest arrives through `since`.
      for (const t0 = Date.now(); !a.caughtUp() && !a.events().length && Date.now() - t0 < 2000;) await new Promise((r) => setTimeout(r, 100));
      ingest(c);
      const list = a.events();
      return {
        platform: { id, title: TITLES[id], adapterVersion: '0.1.0', caps: a.capabilities() }, day: localDay(now()), seq: list.length, events: list.map((e, i) => ({ seq: i + 1, e })), truncated: false, full: false,
        placement: c.keeper.state(), placementVersion: c.keeper.version(), history: a.history() ?? [], backfill: state(a), storage: 'persistent',
      };
    },
    async since(id, seq, limit, pv): Promise<SinceValue> {
      const c = open(id);
      await c.ready;
      const a = c.adapter!;
      const list = a.events();
      const events = list.slice(seq, seq + limit).map((e, i) => ({ seq: seq + i + 1, e }));
      return {
        day: localDay(now()), seq: seq + events.length, events, more: seq + events.length < list.length, placementVersion: c.keeper.version(),
        ...(pv !== c.keeper.version() ? { placement: c.keeper.state() } : {}), backfill: state(a),
      };
    },
    // Turned off by the member: what was read is dropped, from storage too (the lots are kept for next time).
    async stop(id) {
      const had = cities.get(id);
      await close(id, false);
      let chunks = had?.savedChunks ?? 0;
      try { const m = (await o.places.get(indexKey(id))) as { chunks?: unknown } | undefined; if (typeof m?.chunks === 'number') chunks = Math.max(chunks, m.chunks); } catch { /* none */ }
      try { await o.places.delete?.(indexKey(id)); } catch { /* none */ }
      await drop(id, 0, chunks);
    },
    async dispose() { clearInterval(timer); for (const id of [...cities.keys()]) await close(id, true); },
  };
}
