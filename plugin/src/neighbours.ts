// The adjacent cities on the host, one per vendor: Claude (Claude Code and the Claude desktop app), ChatGPT (Codex)
// and WorkBuddy. Each city is built from its sources on this device, each source a session store read by its own
// adapter. A source is shown whenever its store is found (detection is only whether the store's folder exists: a
// cloud workspace has none, so the panel stays silent there), unless the member turned it off. Nothing is read until
// the panel asks for a city or its figures; a source nobody looks at stops reading, and turning one off stops the
// reading and drops what was read. Each city keeps its own placement, so its buildings keep their lots too (a 0.2
// city's lots carry over to the vendor city it became).
//
// A large store takes seconds to read, so what was read is kept in the plugin's storage on this device per source
// (file hashes, offsets and reader state, plus today's events, never a path or any content) and taken up on the next
// start: only what changed since is read again.
//
// Each session is counted once: the Claude app's Code tab writes its sessions into Claude Code's own store, so those
// belong to the Claude app source and are left out of the Claude Code source (by the reader, and again here for
// anything read before the app claimed them).
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createStore, themeFromTitle, todayAt, type Store, type UCapabilities, type UEvent } from '@dsh-universe/model';
import { createClaudeCodeAdapter } from '@dsh-universe/adapter-claude-code';
import { claudeAppDir, claudeAppPresent, codeTabSessions, createClaudeAppAdapter } from '@dsh-universe/adapter-claude-app';
import { createCodexAdapter } from '@dsh-universe/adapter-codex';
import { createWorkBuddyAdapter } from '@dsh-universe/adapter-workbuddy';
import { localDay, readCheckpoint, type AdapterCheckpoint, type LocalAdapter } from '@dsh-universe/adapter-kit/local';
import {
  CITY_SOURCES, LEGACY_CITY, SOURCES, createPlacementKeeper,
  type KvLike, type NeighbourId, type NeighbourRoutes, type NeighbourSummary, type PlacementKeeper, type SinceValue, type SnapshotValue, type SourceId,
} from '@dsh-universe/adapter-dsh';

/** A source nobody looked at for this long stops reading (it starts again on the next look). */
export const IDLE_MS = 5 * 60_000;
/** While a source changes, what was read is kept at most this often (and always when it stops reading). */
export const SAVE_MS = 60_000;
/** Events per storage entry; past `MAX_KEPT` events only the older files' reading is kept. */
const CHUNK = 2000, MAX_KEPT = 100_000;
/** Per source (the 0.2 keys of Claude Code and Codex stay, so what was read then is taken up). */
export const indexKey = (id: SourceId) => 'index:' + id;
const chunkKey = (id: SourceId, i: number) => `index:${id}:${i}`;
export const placementKey = (id: NeighbourId) => 'placement:' + id;
/** The city's name on its sign (product names, the same in every language). */
const TITLES: Record<NeighbourId, string> = { claude: 'Claude', chatgpt: 'ChatGPT', workbuddy: 'WorkBuddy' };

interface Source {
  adapter?: LocalAdapter; off: () => void; lastAt: number; ready: Promise<void>;
  /** What is in storage: the events kept, the chunks written, when; -1 when nothing was written in this run. */
  savedLen: number; savedChunks: number; savedAt: number; savedEpoch: number; saving?: Promise<void>;
}
interface City {
  keeper: PlacementKeeper; store: Store; log: UEvent[]; ready: Promise<void>;
  /** The sources it is built from now (on, and found on this device), and how far each one's events were taken. */
  set: readonly SourceId[]; seen: Map<SourceId, { a: LocalAdapter; epoch: number; n: number }>;
  /** Bumps whenever the log starts again (a source's new day, a source turned on or off). */
  epoch: number;
  /** The Claude app's sessions when they were last applied (to drop any the Claude Code source read first). */
  owned: ReadonlySet<string>;
}

/** The session an agent id belongs to (`sub:<session>:<agent>` for a subagent). */
const sessionOfAgent = (id: string) => (id.startsWith('sub:') ? id.split(':')[1] ?? id : id);
const agentOfEvent = (e: UEvent): string | undefined => {
  const d = e.data as { id?: unknown; agentId?: unknown; sessionId?: unknown };
  if (e.type === 'agent') return typeof d.sessionId === 'string' ? d.sessionId : typeof d.id === 'string' ? d.id : undefined;
  return typeof d.agentId === 'string' ? d.agentId : undefined;
};

export function createNeighbours(o: { places: KvLike; home?: string; appDir?: string; now?: () => number; log?: (m: string) => void; passMs?: number; saveMs?: number }): NeighbourRoutes & { dispose(): Promise<void> } {
  const home = o.home ?? homedir();
  const now = o.now ?? Date.now;
  const saveMs = o.saveMs ?? SAVE_MS;
  const appDir = o.appDir ?? claudeAppDir(home);
  const sources = new Map<SourceId, Source>();
  const cities = new Map<NeighbourId, City>();
  // The Claude Code sessions the Claude app's Code tab started: one list for both Claude sources.
  const tabs = codeTabSessions(appDir);
  let owned: ReadonlySet<string> = new Set();
  const ownedNow = async () => (owned = await tabs());
  const theme = (city: NeighbourId) => (sid: string, title: string) => { const c = cities.get(city); if (c?.keeper.theme(sid, themeFromTitle(title))) void c.keeper.flush(); };
  const make = (id: SourceId, restore?: AdapterCheckpoint): LocalAdapter => {
    const base = { home, now, passMs: o.passMs, restore };
    switch (id) {
      case 'claude-code': return createClaudeCodeAdapter({ ...base, onTitle: theme('claude'), skip: ownedNow });
      case 'claude-app': return createClaudeAppAdapter({ ...base, dir: appDir, onTitle: theme('claude'), owned: ownedNow });
      case 'codex': return createCodexAdapter(base);
      case 'workbuddy': return createWorkBuddyAdapter(base);
    }
  };
  const present: Record<SourceId, () => boolean> = {
    'claude-code': () => existsSync(join(home, '.claude', 'projects')),
    'claude-app': () => claudeAppPresent(appDir),
    codex: () => existsSync(join(home, '.codex', 'sessions')),
    workbuddy: () => existsSync(join(home, '.workbuddy', 'projects')),
  };

  /** The reading kept by an earlier run; anything malformed or incomplete is read again instead. */
  async function load(id: SourceId): Promise<{ restore?: AdapterCheckpoint; chunks: number }> {
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

  async function save(id: SourceId, s: Source): Promise<void> {
    if (!s.adapter || s.saving) return s.saving;
    const a = s.adapter;
    s.saving = (async () => {
      try {
        const big = a.events().length > MAX_KEPT;
        const cp = await a.checkpoint(big);
        const epoch = a.epoch();
        // Only the chunks that changed: the log only grows within a day.
        const from = s.savedEpoch === epoch && s.savedLen >= 0 ? Math.floor(s.savedLen / CHUNK) : 0;
        const chunks = Math.ceil(cp.events.length / CHUNK);
        for (let i = from; i < chunks; i++) await o.places.put(chunkKey(id, i), cp.events.slice(i * CHUNK, (i + 1) * CHUNK));
        await o.places.put(indexKey(id), { v: 1, n: cp.events.length, chunks, city: cp.city });
        if (s.savedChunks > chunks) await drop(id, chunks, s.savedChunks);
        s.savedLen = cp.events.length; s.savedChunks = chunks; s.savedAt = now(); s.savedEpoch = epoch;
      } catch { o.log?.('neighbours: reading not kept'); } finally { s.saving = undefined; }
    })();
    return s.saving;
  }
  async function drop(id: SourceId, from: number, to: number) {
    const keys = Array.from({ length: Math.max(0, to - from) }, (_, i) => chunkKey(id, from + i));
    try {
      if (o.places.deleteMany) await o.places.deleteMany(keys);
      else for (const k of keys) await o.places.delete?.(k);
    } catch { o.log?.('neighbours: kept reading not dropped'); }
  }

  function openSource(id: SourceId): Source {
    let s = sources.get(id);
    if (!s) {
      const src: Source = { off: () => {}, lastAt: now(), ready: Promise.resolve(), savedLen: -1, savedChunks: 0, savedAt: 0, savedEpoch: -1 };
      src.ready = (async () => {
        if (id === 'claude-code' || id === 'claude-app') await ownedNow().catch(() => undefined);
        const kept = await load(id);
        src.savedChunks = kept.chunks;
        if (sources.get(id) !== src) return;
        const adapter = make(id, kept.restore);
        src.adapter = adapter;
        // What was taken up counts as kept already.
        if (kept.restore?.city.day && adapter.events().length) { src.savedLen = adapter.events().length; src.savedEpoch = adapter.epoch(); src.savedAt = now(); }
        src.off = adapter.subscribe(() => { for (const c of cities.values()) if (c.set.includes(id)) sync(c); });
      })();
      sources.set(id, s = src);
    }
    s.lastAt = now();
    return s;
  }
  async function closeSource(id: SourceId, keep: boolean) {
    const s = sources.get(id);
    if (!s) return;
    sources.delete(id);
    await s.ready.catch(() => undefined);
    s.off();
    if (keep && s.adapter?.caughtUp()) await save(id, s);
    await s.saving;
    await s.adapter?.stop();
  }

  /** Sources' new events into the city's log, its figures and its placement. */
  function sync(c: City) {
    const claude = c.set.includes('claude-app') && c.set.includes('claude-code');
    // A session the Claude app claimed after the Claude Code source read it: the city starts again without it.
    const late = claude && [...owned].some((sid) => !c.owned.has(sid) && c.store.agent(sid));
    const stale = late || c.set.some((id) => { const sn = c.seen.get(id), a = sources.get(id)?.adapter; return !!sn && (sn.a !== a || sn.epoch !== a?.epoch()); });
    if (stale) reset(c);
    c.owned = owned;
    const fresh: UEvent[] = [];
    for (const id of c.set) {
      const a = sources.get(id)?.adapter;
      if (!a) continue;
      const sn = c.seen.get(id) ?? { a, epoch: a.epoch(), n: 0 };
      const list = a.events();
      for (let i = sn.n; i < list.length; i++) {
        const e = list[i];
        if (claude && id === 'claude-code') { const ag = agentOfEvent(e); if (ag && owned.has(sessionOfAgent(ag))) continue; }
        fresh.push(e);
      }
      c.seen.set(id, { a, epoch: a.epoch(), n: list.length });
    }
    if (!fresh.length) return;
    for (const e of fresh) c.log.push(e);
    c.store.applyAll(fresh);
    if (c.keeper.observe(fresh)) void c.keeper.flush();
  }
  function reset(c: City) { c.log = []; c.store = createStore(); c.seen = new Map(); c.epoch++; }

  /** The city with the sources the member left on (and found on this device); a change of sources starts it again. */
  function openCity(id: NeighbourId, off: readonly SourceId[] = []): City {
    const set = CITY_SOURCES[id].filter((s) => !off.includes(s) && present[s]());
    let c = cities.get(id);
    if (!c) {
      const keeper = createPlacementKeeper({ table: o.places, key: placementKey(id), onError: () => o.log?.('neighbours: placement not kept') });
      const city: City = { keeper, store: createStore(), log: [], ready: Promise.resolve(), set: [], seen: new Map(), epoch: 0, owned: new Set() };
      city.ready = (async () => { await migrate(id); await keeper.load(); })();
      cities.set(id, c = city);
    }
    if (c.set.join() !== set.join()) { c.set = set; reset(c); }
    const city = c;
    const ready = city.ready;
    city.ready = (async () => { await ready; await Promise.all(set.map((s) => openSource(s).ready)); if (city.set.join() === set.join()) sync(city); })();
    return city;
  }
  /** A 0.2 city's lots (Claude Code's, Codex's) become its vendor city's, where that city has none yet. */
  async function migrate(id: NeighbourId) {
    try {
      if ((await o.places.get(placementKey(id))) !== undefined) return;
      for (const [old, to] of Object.entries(LEGACY_CITY)) {
        if (to !== id) continue;
        const v = await o.places.get('placement:' + old);
        if (v !== undefined) { await o.places.put(placementKey(id), v); return; }
      }
    } catch { o.log?.('neighbours: placement not carried over'); }
  }

  // Every few seconds: idle sources stop reading; a source read through and changed keeps what it read (soon after
  // its first full read, then at most every `saveMs`).
  const timer = setInterval(() => {
    for (const [id, s] of sources) {
      if (now() - s.lastAt > IDLE_MS) { void closeSource(id, true); continue; }
      const a = s.adapter;
      if (!a?.caughtUp() || s.saving) continue;
      const changed = s.savedLen !== a.events().length || s.savedEpoch !== a.epoch();
      if (changed && (s.savedLen < 0 || now() - s.savedAt >= saveMs)) void save(id, s);
    }
  }, Math.min(15_000, saveMs));
  (timer as { unref?: () => void }).unref?.();

  const caught = (c: City) => c.set.every((s) => !!sources.get(s)?.adapter?.caughtUp());
  const state = (c: City): SnapshotValue['backfill'] => (caught(c) ? 'done' : 'pending');
  /** A city's day as the client compares it: a new day, or the city started again, makes it read the city anew. */
  const dayOf = (c: City) => `${localDay(now())}.${c.epoch}`;
  const capsOf = (c: City): UCapabilities => {
    const all = c.set.map((s) => sources.get(s)?.adapter?.capabilities()).filter((x): x is UCapabilities => !!x);
    const base = all[0] ?? { approvals: false, schedules: false, subagents: false, jobs: false, deliverables: false, skills: false, memory: false, tokens: true, cost: false, latency: false, sessionTitles: false, retries: false, actions: { openSession: false, draftFollowUp: false } };
    const out = { ...base, actions: { ...base.actions } } as UCapabilities;
    for (const x of all.slice(1)) for (const k of Object.keys(out) as (keyof UCapabilities)[]) if (k !== 'actions' && x[k] === true) (out as unknown as Record<string, unknown>)[k] = true;
    return out;
  };
  const touch = (c: City) => { for (const s of c.set) { const x = sources.get(s); if (x) x.lastAt = now(); } };
  const history = (c: City) => {
    const days = new Map<string, { day: string; sessions: number; failed: number }>();
    for (const s of c.set) for (const d of sources.get(s)?.adapter?.history() ?? []) {
      const x = days.get(d.day) ?? { day: d.day, sessions: 0, failed: 0 };
      x.sessions += d.sessions; x.failed += d.failed; days.set(d.day, x);
    }
    return [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  };

  return {
    detect: () => SOURCES.map((id) => ({ id, present: present[id]() })),
    async summary(ids, off = []) {
      const out: NeighbourSummary[] = [];
      for (const id of ids) {
        if (!CITY_SOURCES[id].some((s) => !off.includes(s) && present[s]())) continue;
        const c = openCity(id, off);
        await c.ready;
        touch(c);
        sync(c);
        const d = todayAt(c.store, now(), 'nb:' + id);
        out.push({ id, ready: caught(c), running: d.running, errors: d.errors, tokens: d.tokens });
      }
      return out;
    },
    async snapshot(id, off = []) {
      const c = openCity(id, off);
      await c.ready;
      // The first look waits a moment for the first pass (newest files first); the rest arrives through `since`.
      for (const t0 = Date.now(); !caught(c) && !c.log.length && Date.now() - t0 < 2000;) { await new Promise((r) => setTimeout(r, 100)); sync(c); }
      sync(c);
      touch(c);
      return {
        platform: { id, title: TITLES[id], adapterVersion: '0.2.0', caps: capsOf(c) }, day: dayOf(c), seq: c.log.length, events: c.log.map((e, i) => ({ seq: i + 1, e })), truncated: false, full: false,
        placement: c.keeper.state(), placementVersion: c.keeper.version(), history: history(c), backfill: state(c), storage: 'persistent',
      };
    },
    async since(id, seq, limit, pv, off = []): Promise<SinceValue> {
      const c = openCity(id, off);
      await c.ready;
      sync(c);
      touch(c);
      const list = c.log;
      const events = list.slice(seq, seq + limit).map((e, i) => ({ seq: seq + i + 1, e }));
      return {
        day: dayOf(c), seq: seq + events.length, events, more: seq + events.length < list.length, placementVersion: c.keeper.version(),
        ...(pv !== c.keeper.version() ? { placement: c.keeper.state() } : {}), backfill: state(c),
      };
    },
    // Turned off by the member: what was read is dropped, from storage too (the city's lots are kept for next time).
    async stop(id) {
      const had = sources.get(id);
      await closeSource(id, false);
      let chunks = had?.savedChunks ?? 0;
      try { const m = (await o.places.get(indexKey(id))) as { chunks?: unknown } | undefined; if (typeof m?.chunks === 'number') chunks = Math.max(chunks, m.chunks); } catch { /* none */ }
      try { await o.places.delete?.(indexKey(id)); } catch { /* none */ }
      await drop(id, 0, chunks);
      for (const c of cities.values()) if (c.set.includes(id)) { c.set = c.set.filter((s) => s !== id); reset(c); sync(c); }
    },
    async dispose() {
      clearInterval(timer);
      for (const id of [...sources.keys()]) await closeSource(id, true);
      for (const c of cities.values()) await c.keeper.flush();
    },
  };
}

