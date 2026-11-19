// The adjacent cities on the host: Claude Code and Codex sessions on this device. Nothing is read until the panel
// asks for a city, which it does only after the member turned that city on; turning it off stops the reading and
// drops what was read. Detection is only whether the store's folder exists (a cloud workspace has none, so the panel
// stays silent there). Each city keeps its own placement, so its buildings keep their lots too.
import { homedir } from 'node:os';
import { themeFromTitle } from '@dsh-universe/model';
import { createClaudeCodeAdapter } from '@dsh-universe/adapter-claude-code';
import { createCodexAdapter } from '@dsh-universe/adapter-codex';
import { localDay, type LocalAdapter } from '@dsh-universe/adapter-kit/local';
import { NEIGHBOURS, createPlacementKeeper, type KvLike, type NeighbourId, type NeighbourRoutes, type PlacementKeeper, type SinceValue, type SnapshotValue } from '@dsh-universe/adapter-dsh';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** A city nobody looked at for this long stops reading (it starts again on the next look). */
export const IDLE_MS = 5 * 60_000;

interface City { adapter: LocalAdapter; keeper: PlacementKeeper; off: () => void; seen: number; lastAt: number; epoch: number; ready: Promise<void> }

export function createNeighbours(o: { places: KvLike; home?: string; now?: () => number; log?: (m: string) => void; passMs?: number }): NeighbourRoutes & { dispose(): Promise<void> } {
  const home = o.home ?? homedir();
  const now = o.now ?? Date.now;
  const cities = new Map<NeighbourId, City>();
  const make = (id: NeighbourId): LocalAdapter => id === 'claude-code'
    ? createClaudeCodeAdapter({ home, now, passMs: o.passMs, onTitle: (sid, title) => { const c = cities.get(id); if (c?.keeper.theme(sid, themeFromTitle(title))) void c.keeper.flush(); } })
    : createCodexAdapter({ home, now, passMs: o.passMs });
  const roots: Record<NeighbourId, string> = { 'claude-code': join(home, '.claude', 'projects'), codex: join(home, '.codex', 'sessions') };
  const TITLES: Record<NeighbourId, string> = { 'claude-code': 'Claude Code', codex: 'Codex' };

  function open(id: NeighbourId): City {
    let c = cities.get(id);
    if (!c) {
      const adapter = make(id);
      const keeper = createPlacementKeeper({ table: o.places, key: 'placement:' + id, onError: () => o.log?.('neighbours: placement not kept') });
      const city: City = { adapter, keeper, off: () => {}, seen: 0, lastAt: now(), epoch: adapter.epoch(), ready: keeper.load() };
      city.off = adapter.subscribe(() => {
        // Lots for the sessions read since the last time (a new day starts the list again).
        if (adapter.epoch() !== city.epoch) { city.epoch = adapter.epoch(); city.seen = 0; }
        const list = adapter.events();
        if (keeper.observe(list.slice(city.seen))) void keeper.flush();
        city.seen = list.length;
      });
      cities.set(id, c = city);
    }
    c.lastAt = now();
    return c;
  }
  async function close(id: NeighbourId) {
    const c = cities.get(id);
    if (!c) return;
    cities.delete(id);
    c.off();
    await c.adapter.stop();
    await c.keeper.flush();
  }
  const timer = setInterval(() => { for (const [id, c] of cities) if (now() - c.lastAt > IDLE_MS) void close(id); }, 60_000);
  (timer as { unref?: () => void }).unref?.();

  const state = (c: City): SnapshotValue['backfill'] => (c.adapter.caughtUp() ? 'done' : 'pending');
  return {
    detect: () => NEIGHBOURS.map((id) => ({ id, present: existsSync(roots[id]) })),
    async snapshot(id) {
      const c = open(id);
      await c.ready;
      // The first look waits a moment for the first pass (newest files first); the rest arrives through `since`.
      for (const t0 = Date.now(); !c.adapter.caughtUp() && !c.adapter.events().length && Date.now() - t0 < 2000;) await new Promise((r) => setTimeout(r, 100));
      const list = c.adapter.events();
      if (c.keeper.observe(list.slice(c.seen))) void c.keeper.flush();
      c.seen = list.length;
      return {
        platform: { id, title: TITLES[id], adapterVersion: '0.1.0', caps: c.adapter.capabilities() }, day: localDay(now()), seq: list.length, events: list.map((e, i) => ({ seq: i + 1, e })), truncated: false, full: false,
        placement: c.keeper.state(), placementVersion: c.keeper.version(), history: c.adapter.history() ?? [], backfill: state(c), storage: 'persistent',
      };
    },
    async since(id, seq, limit, pv): Promise<SinceValue> {
      const c = open(id);
      await c.ready;
      const list = c.adapter.events();
      const events = list.slice(seq, seq + limit).map((e, i) => ({ seq: seq + i + 1, e }));
      return {
        day: localDay(now()), seq: seq + events.length, events, more: seq + events.length < list.length, placementVersion: c.keeper.version(),
        ...(pv !== c.keeper.version() ? { placement: c.keeper.state() } : {}), backfill: state(c),
      };
    },
    stop: close,
    async dispose() { clearInterval(timer); for (const id of [...cities.keys()]) await close(id); },
  };
}
