// The inside of a place at moment T, as plain data (pure; no canvas): its floors bottom first with their numbers,
// the room template of each floor of a session building, the agents on each floor, and the spec of the room the
// art kit draws. Only metadata and aggregates: counts, ages, states, tool names. No titles, no content.
import {
  FLOOR_KINDS, FLOOR_OF, PLACE, floorsOf, idxAt, recentCalls, roomsOfSession, rootOf, seedOf, stateAt,
  type Engine, type Floor, type FloorKind, type PlacementState, type RoomChoice, type RoomInfo, type StateAt, type Store, type UCapabilities,
} from '@dsh-universe/model';
import type { BuildingShape, RoomPlace, RoomRecent, RoomSpec, RoomTier } from './artkit.ts';
import { towerOf } from './scene.ts';

/** The colour of each kind of floor (the slab in the stack, the band on the walls, the floor list). */
export const FLOOR_COLOURS: Readonly<Record<string, string>> = {
  lobby: '#8A93A3', library: '#6C7BEA', workshop: '#E8873A', machine: '#59627A', meeting: '#B565D9', roof: '#2F8BFF',
  platform: '#2F6BDE', gate: '#4DA3FF', approval: '#E0A01C', question: '#F0A020', plan: '#F0A020', post: '#C8643C',
  skill: '#35B37A', expert: '#3F9070', memory: '#8A93A3', turbine: '#8E7BD6', control: '#59627A', bay: '#E5433D', retry: '#FF8A2B',
};
/** A connector's tools (any other floor id) are teal. */
export const floorColour = (id: string): string => FLOOR_COLOURS[id] ?? '#14A8A4';

export const isRoomFloor = (id: string): id is FloorKind => (FLOOR_KINDS as readonly string[]).includes(id);

/** What kind of place an id is. */
export function placeKind(placeId: string): RoomPlace {
  if (placeId.startsWith('b:')) return 'building';
  if (placeId.startsWith('conn:')) return 'connector';
  if (placeId.startsWith('model:')) return 'power';
  if (placeId === PLACE.town) return 'town';
  if (placeId === PLACE.station) return 'station';
  if (placeId === PLACE.school) return 'school';
  if (placeId === PLACE.library) return 'library';
  return 'fire';
}

export interface InteriorAgent {
  id: string;
  sessionId: string;
  /** Seed of the agent (its look; the same seed as in the street). */
  seed: number;
  state: StateAt;
  subagent: boolean;
  /** The tool of its latest call while running (the placard over its head). */
  tool?: string;
  /** That call's category (its pose). */
  category?: string;
  /** An outside coding engine's agent (its look). */
  engine?: Engine;
}

export interface InteriorFloor extends Floor {
  /** The room template of a session building's floor, or `fixed:<floor id>` for a fixed scene. */
  room: string;
  /** A room template (12×12) rather than a fixed scene. */
  template: boolean;
  colour: string;
  /** The agents on this floor now (sorted by id). */
  people: InteriorAgent[];
  /** An agent is working here now: the room moves. */
  act: boolean;
  /** A fixed scene that shows no data of its own (the floor button says "illustration"). */
  illustrative: boolean;
  recent: RoomRecent[];
  /** Town hall service floors: today's requests of this kind (approved, denied, open). */
  tally?: { yes: number; no: number; open: number };
  /** The library: installed skills and plugins (how many are on). */
  stock?: { skills: number; plugins: number; on: number };
  /** The latest calls on this floor (newest first, at most eight): when, which tool, whether it failed. No content. */
  calls: { t: number; tool: string; ok: boolean }[];
  /** Background jobs of the building: running now, finished today. */
  jobsToday?: { running: number; done: number };
  /** When the latest failed call on this floor happened. */
  lastError?: number;
}

export interface Interior {
  placeId: string;
  place: RoomPlace;
  seed: number;
  /** Bottom floor first. */
  floors: InteriorFloor[];
  rooms: RoomChoice;
  /** Session of a tower (the panel looks its title up). */
  sessionId?: string;
  /** A session of an earlier day (shown as it ended, from the placement record). */
  past?: boolean;
  /** When that session started (ms), if known. */
  started?: number;
  /** The session finished (done). */
  ended?: boolean;
  /**
   * How big this building's floors are now (rooms, lobby and roof): from its tower as the city draws it at T, so a
   * growing building gets bigger floors and looking back shows the size it had then. Public places: large.
   */
  tier: RoomTier;
  /** The tower the tier comes from (session buildings, when the kit sizes floors). */
  shape?: BuildingShape;
}

export interface InteriorInput {
  store: Store;
  placement: PlacementState;
  T: number;
  placeId: string;
  /** Room templates (the art kit's catalog). */
  catalog: readonly RoomInfo[];
  caps: UCapabilities;
  /** Dev and mock mode (`?room=<id>`): show this template on the floor kind it is made for (and at this size). */
  override?: { floor: FloorKind; room: string; tier?: RoomTier };
  /** The art kit's building template tags and floor size rule (`ArtKit.buildingTags`, `ArtKit.roomTier`); without
   * them every floor is full size. */
  templateTags?: readonly (readonly string[])[];
  roomTier?: (b: BuildingShape) => RoomTier;
}

/** Fixed scenes drawn from their floor's data; every template room is live too. */
const LIVE_SCENES = new Set(['skill', 'expert', 'turbine', 'control', 'platform', 'gate', 'memory', 'bay', 'retry', 'lobby', 'approval', 'question', 'plan', 'roof']);

const PLACE_SEED = (placeId: string) => seedOf(placeId);

/** The inside of a place at T. Pure. */
export function interiorOf(o: InteriorInput): Interior {
  const { store, T, placeId } = o;
  const place = placeKind(placeId);
  const sessionId = place === 'building' ? placeId.slice(2) : undefined;
  let rooms: RoomChoice = sessionId ? roomsOfSession(o.placement, sessionId, o.catalog) : {};
  if (o.override) rooms = { ...rooms, [o.override.floor]: o.override.room };
  const seed = sessionId ? seedOf(sessionId) : PLACE_SEED(placeId);
  // A session of an earlier day: no events today; its floors come from the size kept in the placement record.
  const kept = sessionId && !store.agents().some((s) => s.agent.sessionId === sessionId && !s.agent.parentAgentId) ? o.placement.sizes?.[sessionId] : undefined;
  const base: Floor[] = kept
    ? [{ id: 'lobby', n: 0, agents: [] }, ...FLOOR_KINDS.filter((k) => (kept.calls[k] ?? 0) > 0).map((k): Floor => ({ id: k, n: kept.calls[k]!, agents: [], recent: [], jobs: 0, errors: 0 })),
      { id: 'roof', n: kept.tokens, unit: 'tokens', na: !o.caps.tokens, agents: [] }]
    : floorsOf(store, placeId, T, o.caps);
  const floors = base.map((f): InteriorFloor => {
    const template = place === 'building' && isRoomFloor(f.id) && !!rooms[f.id];
    // The town hall keeps records, not people: an agent waiting for the member stands in the square, so it is drawn there and nowhere else.
    const ids = place === 'town' ? [] : f.agents;
    const people: InteriorAgent[] = ids.map((id) => {
      const s = store.agent(id)!;
      const st = stateAt(s, T), k = idxAt(s, T);
      return { id, sessionId: s.agent.sessionId, seed: seedOf(id), state: st, subagent: !!s.agent.parentAgentId, tool: st === 'running' && k ? s.ev[k - 1].tool : undefined, category: st === 'running' && k ? s.ev[k - 1].category : undefined, ...(s.agent.engine ? { engine: s.agent.engine } : {}) };
    }).sort((a, b) => a.id.localeCompare(b.id));
    let recent = f.recent ?? [];
    // Public places: the calls made there in the last minute (they also set the room going).
    if (!f.recent && place !== 'building') recent = recentCalls(store, T, (s, i) => callAt(store, s.ev[i], placeId, f.id));
    const running = people.some((p) => p.state === 'running');
    return {
      ...f, room: template ? rooms[f.id as FloorKind]! : 'fixed:' + f.id, template, colour: floorColour(f.id), people, recent,
      act: running || (place !== 'building' && recent.length > 0 && !f.na),
      tally: place === 'town' ? tallyOf(store, T, f.id) : undefined,
      stock: place === 'library' ? stockOf(store) : undefined,
      ...callsOf(store, T, placeId, f.id, place),
      illustrative: !template && place !== 'connector' && !LIVE_SCENES.has(f.id),
    };
  });
  const root = sessionId ? store.agents().find((s) => s.agent.sessionId === sessionId && !s.agent.parentAgentId) : undefined;
  const ended = kept ? kept.state === 'done' : root ? stateAt(root, T) === 'done' : false;
  const shape = sessionId && o.roomTier && o.templateTags ? towerOf(store, o.placement, sessionId, T, o.templateTags) : undefined;
  const tier: RoomTier = o.override?.tier ?? (shape && o.roomTier ? o.roomTier(shape) : 'large');
  return { placeId, place, seed, floors, rooms, sessionId, past: !!kept, started: kept?.started, ended, tier, ...(shape ? { shape: { template: shape.template, footprint: shape.footprint, segments: shape.segments, stage: shape.stage } } : {}) };
}

/** The latest calls of a floor (tool name, time, ok) and its jobs: what the tape, log board, beacon and printers show. */
function callsOf(store: Store, T: number, placeId: string, floor: string, place: RoomPlace): Pick<InteriorFloor, 'calls' | 'jobsToday' | 'lastError'> {
  const fam = place === 'building' ? new Set(store.agents().filter((s) => 'b:' + rootOf(store, s).agent.sessionId === placeId).map((s) => s.agent.id)) : undefined;
  const on = (s: { agent: { id: string } }, e: { category: string; connectorId?: string; tool: string; ok?: boolean }) => {
    if (fam) return fam.has(s.agent.id) && FLOOR_OF[e.category as keyof typeof FLOOR_OF] === floor;
    if (place === 'connector') return e.connectorId === placeId.slice(5) && e.tool === floor;
    return callAt(store, e, placeId, floor);
  };
  const calls: InteriorFloor['calls'] = [];
  let lastError: number | undefined;
  for (const s of store.agents()) {
    const k = idxAt(s, T);
    for (let i = k - 1; i >= 0; i--) {
      const e = s.ev[i];
      if (!on(s, e)) continue;
      calls.push({ t: e.t, tool: e.tool, ok: e.ok !== false });
      if (e.ok === false && (lastError === undefined || e.t > lastError)) lastError = e.t;
    }
  }
  calls.sort((a, b) => b.t - a.t);
  const day = new Date(T); day.setHours(0, 0, 0, 0);
  let running = 0, done = 0;
  if (fam) for (const s of store.agents()) if (fam.has(s.agent.id)) for (const j of s.jobs) {
    if (j.startedAt > T) continue;
    if (j.endedAt === undefined || j.endedAt > T) running++; else if (j.endedAt >= day.getTime()) done++;
  }
  return { calls: calls.slice(0, 8), jobsToday: fam ? { running, done } : undefined, lastError };
}

/** What the library holds: installed skills and plugins (metadata only: counts). */
export function stockOf(store: Store): { skills: number; plugins: number; on: number } {
  const inv = store.inventory();
  return { skills: inv.skills?.length ?? 0, plugins: inv.plugins?.length ?? 0, on: inv.plugins?.filter((p) => p.enabled).length ?? 0 };
}

/** Today's requests of one kind at T: approved, denied and still open (a cancelled request is none of these). */
export function tallyOf(store: Store, T: number, kind: string): { yes: number; no: number; open: number } {
  const day = new Date(T); day.setHours(0, 0, 0, 0);
  const t = { yes: 0, no: 0, open: 0 };
  for (const s of store.agents()) for (const w of s.waits) {
    if (w.kind !== kind || w.askedAt > T || w.askedAt < day.getTime()) continue;
    if (w.decidedAt === undefined || w.decidedAt > T) t.open++;
    else if (w.outcome === 'allowed') t.yes++;
    else if (w.outcome === 'rejected') t.no++;
    // (cancelled: nobody decided it, e.g. the host restarted while it waited; neither approved nor denied)
  }
  return t;
}

/** The pose of an agent from its latest call's category (metadata only). */
export const POSE_OF: Partial<Record<string, 'type' | 'read' | 'console' | 'web' | 'hand'>> = {
  edit: 'type', write: 'type', read: 'read', search: 'read', memory: 'read', skill: 'read', exec: 'console', web: 'web', delegate: 'hand', connector: 'console',
};

/** Whether a call was made at this public place and floor (the places' floors as `floorsOf` counts them). */
function callAt(store: Store, e: { category: string; connectorId?: string; ok?: boolean; tool: string }, placeId: string, floor: string): boolean {
  void store;
  if (placeId === PLACE.station) return floor === 'gate' && e.category === 'web';
  if (placeId === PLACE.school) return floor === 'skill' && e.category === 'skill';
  if (placeId === PLACE.library) return floor === 'memory' && e.category === 'memory';
  if (placeId === PLACE.fire) return floor === 'bay' && e.ok === false;
  return false;
}

/**
 * The floor shown when entering: the one with most people now (the lowest on a tie). With nobody inside (a quiet
 * or finished building), the room where most of its work was done rather than an empty lobby.
 */
export function defaultFloor(it: Interior): string {
  let best = it.floors[0];
  for (const f of it.floors) if (f.people.length > best.people.length) best = f;
  if (best && best.people.length === 0) {
    const rooms = it.floors.filter((f) => f.template && !f.na);
    if (rooms.length) best = rooms.reduce((a, f) => (f.n > a.n ? f : a));
  }
  return best?.id ?? 'lobby';
}

/** The workspace clock in hours, stepped to the minute (the wall clocks follow replay). */
export function clockHours(T: number): number {
  const d = new Date(T);
  return d.getHours() + d.getMinutes() / 60;
}

/** Tokens in the last five minutes of a power station's model (its turbines). */
export function tokenRate(store: Store, placeId: string, T: number): number {
  if (!placeId.startsWith('model:')) return 0;
  const m = placeId.slice(6);
  let n = 0;
  for (const s of store.agents()) for (const u of s.usage) if (u.model === m && u.t <= T && u.t > T - 5 * 60_000) n += u.input + u.output;
  return n;
}

export interface RoomSpecOptions {
  /** Animation clock in seconds (ignored when the room is still). */
  time: number;
  reduced: boolean;
  night: boolean;
  T: number;
  /** Tokens in the last five minutes (power station). */
  rate?: number;
}

/** The art kit's spec for one floor. The animation clock is zeroed when nothing works here or motion is reduced. */
export function roomSpecOf(it: Interior, f: InteriorFloor, o: RoomSpecOptions, tier: RoomTier = it.tier): RoomSpec {
  const act = f.act || (it.place === 'power' && f.id === 'turbine' && (o.rate ?? 0) > 0);
  const moving = act && !o.reduced;
  return {
    id: it.placeId, room: f.room, floor: f.id, place: it.place, colour: f.colour, seed: it.seed,
    act, frame: moving ? Math.max(1, Math.floor(o.time * 10)) : 0, reduced: o.reduced, night: o.night, na: !!f.na,
    n: f.n, recent: f.recent.map((r) => ({ age: Math.round(r.age), err: r.err })), jobs: f.jobs ?? 0, subs: f.subs ?? [], out: f.out ?? 0,
    queue: it.place === 'town' ? f.n : 0, rate: o.rate ?? 0, hour: clockHours(o.T),
    present: f.people.length, ...(f.tally ? { tally: f.tally } : {}), ...(it.place === 'town' ? { bays: ['approval', 'question', 'plan'].map((id) => it.floors.find((x) => x.id === id)?.tally ?? { yes: 0, no: 0, open: 0 }) } : {}), ...(f.stock ? { stock: f.stock } : {}), ...(it.ended && f.id === 'roof' ? { ended: true } : {}),
    ...(it.place === 'building' && tier !== 'large' ? { tier } : {}),
  };
}

/** Root session of an agent's building (to open "its" building from a list row). */
export const buildingOfAgent = (store: Store, agentId: string): string | undefined => {
  const s = store.agent(agentId);
  return s ? 'b:' + rootOf(store, s).agent.sessionId : undefined;
};
