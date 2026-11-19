// The city at moment T, as plain data (pure; no canvas): which buildings stand where and how tall, where the agents
// are, which places are lit, which signs are written. Placement comes from model/placement (seeded, never moves);
// an empty workspace shows the civic baseline only. No titles reach this file: signs are place names and start
// times only.
import {
  workspaceName,
  FAILED_IN_SQUARE_MS, FLOOR_OF, GROWTH, PLACE, buildingId, chooseTemplate, cityTemplate, cumAt, failedAt, footprintOf, growthAt,
  hueOf, idxAt, lotOf, placardOf, rallyAt, rootOf, seedOf, segmentsOf, sessionStateAt, stageOf, stateAt, themeIdOf, themeOf, waitAt, whereabouts,
  type AgentTrack, type CityTemplate, type Drafts, type Seen, type FloorKind, type PlacementState, type StateAt, type Store,
} from '@dsh-universe/model';
import { along, gatesOf, route } from './walk.ts';
import type { BuildingShape, BuildingSpec, CivicKind, CivicSpec, Frames, GroundSpec, PersonSpec } from './artkit.ts';

export const RECENT_MS = 5 * 60 * 1000;
const CONNECTOR_AT: readonly [number, number][] = [[14.5, 26.8], [14.5, 9.8], [14.5, 31.5]];
const DOOR: Record<string, [number, number]> = { town: [13.3, 17.6], station: [11.3, 13.5], fire: [14.5, 24.5], school: [14.5, 5.4], library: [3.5, 27.3] };

export interface Sign {
  x: number; y: number; z: number; text: string; bg: string; fg: string; minZoom: number; small: boolean; depth: number;
  /** Frame colour (default ink). */ border?: string;
  /** A door plate of this building: shown on hover or selection whatever the zoom, hidden when the layer greys it. */ door?: string;
  /** A place name: never dropped for cover; drawn above the roof of `place` when it is known. */ name?: boolean;
  /** The place a name belongs to (its roof anchors the sign; a layer greys it with the place). */ place?: string;
}

export interface ScenePlace {
  id: string;
  /** 'building' for session towers; 'house' for plugin shops (small houses); 'civic' for the rest. */
  tier: 'building' | 'house' | 'civic';
  at: readonly [number, number];
  depth: number;
  building?: BuildingSpec;
  civic?: CivicSpec;
  /** Session of a tower (for name plates and hover cards; the title is looked up by the panel). */
  sessionId?: string;
  state?: StateAt;
  /** Agents working inside now. */
  inside: number;
}

export interface SceneAgent { id: string; sessionId: string; pos: readonly [number, number]; depth: number; person: PersonSpec; inSquare: boolean; /** The tool it is using now (a name, never arguments). */ tool?: string }

export interface Pool { x: number; y: number; colour: string; r: number }

export interface Scene {
  T: number;
  growth: number;
  ground: GroundSpec;
  places: ScenePlace[];
  agents: SceneAgent[];
  /** Cars wanted on the roads: calls in the last five minutes ÷ 2, at most 64. */
  cars: number;
  rally: number;
  pools: Pool[];
  /** Train cars on the railway (tile x, car index): a scheduled run arriving, standing, leaving. */
  trains: { x: number; car: number }[];
  /** Places with a failed call in the last 20 seconds (a small puff of smoke). */
  puffs: string[];
  /** Power stations drawing tokens in the last five minutes, with the rate (tokens): light dots run along the lines. */
  power: { id: string; at: readonly [number, number]; feed: number; rate: number }[];
  signs: Sign[];
  /** Something moves (a crane, a blinking beacon, a waiting agent, cars): repaint while visible. */
  animated: boolean;
}

export interface SceneNames {
  town: string; station: string; fire: string; school: string; library: string;
  /** Shop signs on the street furniture of the quay plaza (optional). */
  cafe?: string; truck?: string; news?: string; bus?: string; /** DSH's name for its first-use workspace, in the member's language. */ defaultWorkspace?: string }
export interface SceneInput {
  store: Store;
  placement: PlacementState;
  T: number;
  /** Building template tags from the art kit (template i ↔ tags[i]). */
  templateTags: readonly (readonly string[])[];
  names: SceneNames;
  /** Animation clock in seconds; 0 under reduced motion. */
  time: number;
  hover?: string;
  follow?: string;
  /** Agents walk between places even with the animation clock at 0 (tests); off under reduced motion. */
  walk?: boolean;
  /** Live: between data updates T runs on with the clock (so walkers move smoothly). */
  live?: boolean;
  /** Night lighting (pools of light are drawn at night only). */
  night: boolean;
  template?: CityTemplate;
  /** Not used by the scene: the data views read them (the "to review" layer). */
  city?: string;
  seen?: Seen;
  drafts?: Drafts;
}

const STILL: Frames = { crane: 0, blink: 0, epoch: 0 };
const WS_COLOURS = ['#F2B233', '#5FAE6B', '#8E7BD6', '#4DA3FF', '#FF8A2B', '#19B8A0', '#D9628A', '#6C7BEA'];
const SHOP_COLOURS = ['#FF4FA3', '#22C3E6', '#8BD93E', '#FFC928', '#E5433D', '#8E5BE8', '#FF8A2B', '#2F8BFF'];
const POWER_COLOURS = ['#8E7BD6', '#D9628A', '#14A8A4', '#E8873A'];
/** Month-day, for buildings of earlier days. */
const md = (t: number) => { const d = new Date(t); return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const hm = (t: number) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

/** A tool name without its MCP server prefix (`mcp__erp__execute_read` → `execute_read`). */
export const shortTool = (n: string) => n.replace(/^mcp__[^_]+(?:_[^_]+)*?__/, '');

/** The last move of an agent between places: where it set off from, where to, and when (pure, from its calls and
 * waits). Undefined when it has not moved since it started. */
function lastLeg(s: AgentTrack, T: number, homeId: string, now: string): { from: string; to: string; t0: number } | undefined {
  const place = (i: number) => {
    const e = s.ev[i];
    return e.category === 'connector' && e.connectorId ? 'conn:' + e.connectorId : e.category === 'web' ? PLACE.station : e.category === 'skill' ? PLACE.school : e.category === 'memory' ? PLACE.library : homeId;
  };
  if (now === PLACE.town) {
    // Out of its own door to the square: when the wait began, or when it stopped on an error.
    const w = waitAt(s, T);
    if (w) return { from: homeId, to: PLACE.town, t0: w.askedAt };
    const f = failedAt(s, T);
    if (f !== undefined) return { from: homeId, to: PLACE.town, t0: f };
    return undefined;
  }
  const k = idxAt(s, T);
  // Back from the square: the wait was answered (or the 90 minutes after an error ran out, or it started working
  // again): it walks to where it is now, if every call since was there.
  const back = leftSquareAt(s, T);
  if (back !== undefined && !s.ev.slice(0, k).some((e, i) => e.t > back && place(i) !== now)) return { from: PLACE.town, to: now, t0: back };
  if (!k) return undefined;
  const p = place(k - 1);
  if (p !== now) return undefined;
  let j = k - 1;
  while (j > 0 && place(j - 1) === p) j--;
  if (j === 0) return undefined;
  const w = s.waits.find((x) => x.decidedAt !== undefined && x.decidedAt <= s.ev[j].t && x.decidedAt > s.ev[j - 1].t);
  return { from: w ? PLACE.town : place(j - 1), to: p, t0: s.ev[j].t };
}

/**
 * A session tower at T as the city draws it: its template, storeys, footprint, growth stage and state. `fam` is the
 * session and its subagents (none for a session of an earlier day, whose size comes from the placement record).
 * Shared by the city and the inside view, so a building's floors are sized from exactly the tower on screen.
 */
export function towerAt(
  placement: PlacementState, sessionId: string, fam: readonly AgentTrack[], root: AgentTrack | undefined, capped: boolean, T: number, templateTags: readonly (readonly string[])[],
): BuildingShape & { state: StateAt } {
  // A session of an earlier day: its size and the state it ended in come from the placement record.
  const kept = root ? undefined : placement.sizes?.[sessionId];
  const ended: StateAt = kept ? (kept.state === 'running' || kept.state === 'waiting' ? 'idle' : kept.state) : 'done';
  // A main turn that ended while a subagent still works: running, as the today bar counts it (model runningRoots).
  const state: StateAt = root ? sessionStateAt(root, fam, T) : ended;
  const calls: Partial<Record<FloorKind, number>> = {};
  let n = 0, tokens = 0;
  for (const s of fam) {
    const k = idxAt(s, T);
    for (let i = 0; i < k; i++) { const f = FLOOR_OF[s.ev[i].category]; if (f) { calls[f] = (calls[f] ?? 0) + 1; n++; } }
    tokens += cumAt(s, T);
  }
  if (kept) { Object.assign(calls, kept.calls); tokens = kept.tokens; }
  const segments = root || kept ? segmentsOf(calls, capped) : segmentsOf({ library: 4 }, capped);
  const theme = themeOf({ themeId: themeIdOf(placement, sessionId) });
  return { state, segments, footprint: footprintOf(tokens), stage: root ? stageOf(state, n) : 'topped', template: chooseTemplate(seedOf(sessionId), theme, templateTags) };
}

/** The tower of a placed session at T (its shape), or undefined when it has no lot or has not started. */
export function towerOf(store: Store, placement: PlacementState, sessionId: string, T: number, templateTags: readonly (readonly string[])[], template: CityTemplate = cityTemplate()): (BuildingShape & { state: StateAt }) | undefined {
  const lot = lotOf(template, placement, sessionId);
  if (!lot) return undefined;
  const fam = store.agents().filter((s) => rootOf(store, s).agent.sessionId === sessionId);
  const root = fam.find((s) => s.agent.sessionId === sessionId && !s.agent.parentAgentId);
  if (root && root.agent.startedAt > T) return undefined;
  return towerAt(placement, sessionId, fam, root, lot.cap > 0, T, templateTags);
}

/** How many people the square draws (the balloon's count says the rest), and how many of them hold full placards. */
export const SQUARE_MAX = 20;
export const SQUARE_FULL = 5;
/** How much higher every other full placard is held: one placard and its outline, so neighbours 11 pixels apart never overlap. */
export const SQUARE_LIFT = 12;
/** The square's centre (the middle of its paving, ground.ts) and its grid on the screen, in art pixels. */
const SQ_C: readonly [number, number] = sqCentre(14.5, 19.15, -12, 0);
function sqCentre(x: number, y: number, dx: number, dy: number): [number, number] { return [x + (dx / 16 + dy / 8) / 2, y + (dy / 8 - dx / 16) / 2]; }
const SQ_COL = 11, SQ_ROW = 8, SQ_SHIFT = 5, SQ_COLS = 5;

/**
 * Where the n-th person in the square stands: longest wait first, nearest the hall. A grid that
 * is square on the screen: 5 columns 11 art pixels apart, rows 8 pixels lower, odd rows shifted 5 pixels, at most 4
 * rows, centred on the paving so nobody stands off it. The first row (the five who have waited longest) holds full
 * placards above their heads; everyone else a small one beside the head, so no face is covered.
 */
export function squareSpot(n: number): [number, number] {
  const k = Math.max(0, Math.min(n, SQUARE_MAX - 1)), c = k % SQ_COLS, r = Math.floor(k / SQ_COLS);
  const dx = (c - (SQ_COLS - 1) / 2) * SQ_COL + (r & 1 ? SQ_SHIFT : 0) - SQ_SHIFT / 2, dy = (r - 1.5) * SQ_ROW;
  return [SQ_C[0] + (dx / 16 + dy / 8) / 2, SQ_C[1] + (dy / 8 - dx / 16) / 2];
}

/** When the agent last left the square by T: a wait decided, an error stop's 90 minutes over, or a new turn after it. */
function leftSquareAt(s: AgentTrack, T: number): number | undefined {
  let t: number | undefined;
  for (const w of s.waits) if (w.decidedAt !== undefined && w.decidedAt <= T && (t === undefined || w.decidedAt > t)) t = w.decidedAt;
  for (let i = 0; i < s.turns.length; i++) {
    const x = s.turns[i];
    if (x.t > T || x.phase !== 'end' || x.reason !== 'error') continue;
    const next = s.turns.slice(i + 1).find((y) => y.phase === 'start')?.t;
    const out = Math.min(x.t + FAILED_IN_SQUARE_MS, next ?? Infinity);
    if (out <= T && (t === undefined || out > t)) t = out;
  }
  return t;
}

/** Where the head of a train is (tile x on the railway) d seconds after its run time, or undefined when off the map. */
export function trainX(d: number): number | undefined {
  const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
  if (d < -24 || d > 32) return undefined;
  return d < 0 ? lerp(-22, 8.4, 1 - Math.pow(-d / 24, 2)) : d < 10 ? 8.4 : lerp(8.4, -22, Math.pow((d - 10) / 22, 2));
}

export function framesAt(time: number, seed = 0): Frames {
  return time ? { crane: Math.floor(time * 2.5 + (seed % 16)) % 16, blink: Math.floor(time * 2) & 1, epoch: Math.floor(time / 5) } : { crane: seed % 16, blink: 0, epoch: 0 };
}

/** Only the frames a state shows: a running tower turns its crane and changes window lights every 5 s; a waiting
 * one blinks. Everything else is still (so its sprite is never redrawn for the clock). */
function framesFor(state: StateAt, time: number, seed: number): Frames {
  const f = framesAt(time, seed);
  return state === 'running' ? { crane: f.crane, blink: 0, epoch: f.epoch } : state === 'waiting' ? { crane: 0, blink: f.blink, epoch: 0 } : { crane: 0, blink: 0, epoch: 0 };
}

export function buildScene(o: SceneInput): Scene {
  const { store, placement, T, time } = o;
  const template = o.template ?? cityTemplate();
  const growth = Math.max(0, Math.min(GROWTH.length - 1, growthAt(placement, T)));
  const agents = store.agents().filter((s) => stateAt(s, T) !== 'future');
  const byRoot = new Map<string, AgentTrack[]>();
  for (const s of store.agents()) {
    const r = rootOf(store, s).agent.sessionId;
    byRoot.set(r, [...(byRoot.get(r) ?? []), s]);
  }
  const where = new Map(agents.map((s) => [s.agent.id, whereabouts(store, s, T)]));
  const inside = new Map<string, number>();
  for (const s of agents) {
    const w = where.get(s.agent.id);
    const st = stateAt(s, T);
    if (w && st !== 'done' && st !== 'failed') inside.set(w.place, (inside.get(w.place) ?? 0) + 1);
  }
  const places: ScenePlace[] = [];
  const signs: Sign[] = [];
  const pools: Pool[] = [];
  let animated = false;
  const frames = framesAt(time);
  // Claims at T (the block tint and the workspace name plate).
  const claimed = new Map<string, number>();
  const wsFirstBlock = new Map<string, string>();
  for (const c of placement.claims) {
    if (c.t > T) continue;
    claimed.set(c.block, (placement.workspaces[c.workspaceId] ?? 0) % WS_COLOURS.length);
    if (!wsFirstBlock.has(c.workspaceId)) wsFirstBlock.set(c.workspaceId, c.block);
  }
  const used = new Set<string>();
  const blockLooks = new Map<string, [number, number][]>();
  // Session towers: every placed session that has started by T (sessions of earlier days stand finished).
  for (const [sessionId, lotKey] of Object.entries(placement.lots)) {
    const lot = lotOf(template, placement, sessionId);
    if (!lot) continue;
    const fam = byRoot.get(sessionId) ?? [];
    const root = fam.find((s) => s.agent.sessionId === sessionId && !s.agent.parentAgentId);
    if (root && root.agent.startedAt > T) continue;
    used.add(lotKey);
    const { state, segments, footprint, stage, template: tpl } = towerAt(placement, sessionId, fam, root, lot.cap > 0, T, o.templateTags);
    const seed = seedOf(sessionId);
    const at: [number, number] = [lot.x + 1, lot.y + 1];
    const id = buildingId(sessionId);
    const heads: { floor: FloorKind | 'podium'; seed: number }[] = [];
    for (const s of fam) {
      const w = where.get(s.agent.id), st = stateAt(s, T);
      if (!w || w.place !== id || st === 'done' || st === 'failed' || st === 'future') continue;
      heads.push({ floor: (['library', 'workshop', 'machine', 'meeting'] as string[]).includes(w.floor) ? (w.floor as FloorKind) : 'podium', seed: seedOf(s.agent.id) });
    }
    const resting = state === 'done' ? fam.filter((s) => stateAt(s, T) === 'done').map((s) => seedOf(s.agent.id)) : [];
    const annexes = fam.filter((s) => s.agent.parentAgentId && s.agent.startedAt <= T).map((s) => stateAt(s, T));
    // Two towers on one block never share both facade and main colour.
    const bk = lot.bx + ',' + lot.by;
    let hueShift = 0;
    const mine = blockLooks.get(bk) ?? [];
    while (hueShift < 9 && mine.some((x) => x[0] === tpl % 4 && x[1] === (hueOf(seed) + hueShift) % 9)) hueShift++;
    mine.push([tpl % 4, (hueOf(seed) + hueShift) % 9]); blockLooks.set(bk, mine);
    const b: BuildingSpec = {
      id, seed, template: tpl, ...(hueShift ? { hueShift } : {}), at, segments, footprint, stage, state,
      heads, resting, annexes, scheduled: !!root && (root.agent.kind === 'scheduled' || !!root.agent.scheduleId), preset: !!root?.agent.role,
      hover: o.hover === id, frames: framesFor(state, time, seed),
    };
    if (state === 'running' || state === 'waiting') animated = true;
    places.push({ id, tier: 'building', at, depth: at[0] + at[1], building: b, sessionId, state, inside: inside.get(id) ?? 0 });
    const kept = root ? undefined : placement.sizes?.[sessionId];
    const plate = root ? hm(root.agent.startedAt) : kept?.started !== undefined ? md(kept.started) : undefined;
    // Door plates: today's start time from zoom 2, an earlier day's date only from zoom 3; at
    // night they are dark, so the windows of working towers stay the brightest thing.
    if (plate) signs.push({ x: at[0], y: at[1] + b.footprint + 0.14, z: 17, text: plate, bg: o.night ? '#131C40' : '#FFFFFF', fg: o.night ? '#EEF7FB' : '#141A30', ...(o.night ? { border: '#3D4F85' } : {}), minZoom: root ? 2 : 3, small: true, depth: at[0] + at[1] + 0.5, door: id });
    if (o.night && (state === 'running' || state === 'waiting')) pools.push({ x: at[0] + 0.4, y: at[1] + 0.4, colour: state === 'waiting' ? '#F0A020' : '#FFD37E', r: 30 });
  }
  // The civic baseline: always there, with or without sessions.
  const rallyList = agents.filter((s) => where.get(s.agent.id)?.place === PLACE.town);
  const civic = (id: string, kind: CivicKind, at: readonly [number, number], variant: number, extra: Partial<CivicSpec> = {}, depthAdd = 0) => {
    const n = inside.get(id) ?? 0;
    const spec: CivicSpec = { id, kind, at, variant, active: n > 0, level: 0, on: true, clock: kind === 'town' || kind === 'station' ? Math.floor((new Date(T).getHours() * 60 + new Date(T).getMinutes()) / 5) * 5 : 0, hover: o.hover === id, frames: STILL, ...extra };
    if (kind === 'power' && spec.active) spec.frames = { crane: 0, blink: frames.blink, epoch: 0 };
    places.push({ id, tier: kind === 'shop' ? 'house' : 'civic', at, depth: at[0] + at[1] + depthAdd, civic: spec, inside: n });
    if (o.night && n > 0 && kind !== 'town') pools.push({ x: at[0] + 0.4, y: at[1] + 0.6, colour: '#FFD37E', r: 44 });
    return spec;
  };
  const tw = template.civic.find((c) => c.id === 'town')!.at;
  civic(PLACE.town, 'town', tw, 0, { active: rallyList.length > 0 || (inside.get(PLACE.town) ?? 0) > 0 }, 1.2);
  signs.push({ x: 14.5, y: 16.25, z: 66, text: o.names.town, bg: '#FFC928', fg: '#141A30', minZoom: 0.25, small: false, depth: 30.9, name: true, place: PLACE.town });
  civic(PLACE.station, 'station', template.civic.find((c) => c.id === 'station')!.at, 0, {}, 1.6);
  signs.push({ x: 8.5, y: 13.85, z: 24, text: o.names.station, bg: '#2F6BDE', fg: '#FFFFFF', minZoom: 1, small: false, depth: 24.1, name: true, place: PLACE.station });
  const fire = template.civic.find((c) => c.id === 'fire')!.at;
  civic(PLACE.fire, 'fire', fire, 0);
  signs.push({ x: fire[0] - 0.4, y: fire[1] + 0.65, z: 26, text: o.names.fire, bg: '#E5433D', fg: '#FFFFFF', minZoom: 1, small: false, depth: fire[0] + fire[1] + 0.7, name: true, place: PLACE.fire });
  const school = template.civic.find((c) => c.id === 'school')!.at;
  civic(PLACE.school, 'school', school, 0);
  signs.push({ x: school[0] - 0.6, y: school[1] + 0.8, z: 8, text: o.names.school, bg: '#2E9E48', fg: '#FFFFFF', minZoom: 1, small: false, depth: school[0] + school[1] + 0.9, name: true, place: PLACE.school });
  const lib = template.civic.find((c) => c.id === 'library')!.at;
  civic(PLACE.library, 'library', lib, 0);
  signs.push({ x: lib[0] - 0.4, y: lib[1] + 1.35, z: 10, text: o.names.library, bg: '#2F6BDE', fg: '#FFFFFF', minZoom: 1, small: false, depth: lib[0] + lib[1] + 1.4, name: true, place: PLACE.library });
  // Power stations: one per model seen today (the first is always built); stack height = today's tokens.
  const modelTok = new Map<string, number>(), modelRecent = new Map<string, number>();
  for (const s of agents) for (const u of s.usage) {
    if (u.t > T || !u.model) continue;
    modelTok.set(u.model, (modelTok.get(u.model) ?? 0) + u.input + u.output);
    if (u.t > T - RECENT_MS) modelRecent.set(u.model, (modelRecent.get(u.model) ?? 0) + u.input + u.output);
  }
  const models = [...modelTok.keys()].sort();
  const mlist = models.length ? models : [''];
  mlist.slice(0, template.powerBlocks.length).forEach((m, i) => {
    const [bx, by] = template.powerBlocks[i];
    const at: [number, number] = [bx + 2.5, by + 2.5];
    const id = m ? 'model:' + m : 'model:';
    const rate = modelRecent.get(m) ?? 0;
    if (rate > 0) animated = true;
    civic(id, 'power', at, i, { level: 46 + 150 * Math.min(1, Math.sqrt((modelTok.get(m) ?? 0) / 1.6e6)), active: rate > 0 });
    if (m) signs.push({ x: at[0] - 0.8, y: at[1] + 1, z: 8, text: m, bg: POWER_COLOURS[i % 4], fg: '#FFFFFF', minZoom: 1, small: false, depth: at[0] + at[1] + 1.1, name: true, place: 'model:' + m });
  });
  // Connectors: one each, in three shapes taken in turn.
  const conns = store.connectors().slice().sort((a, b) => a.id.localeCompare(b.id)).slice(0, CONNECTOR_AT.length);
  let recentCalls = 0;
  const busy = new Map<string, number>();
  for (const s of agents) for (let i = idxAt(s, T) - 1; i >= 0 && s.ev[i].t > T - RECENT_MS; i--) {
    recentCalls++;
    const e = s.ev[i];
    if (e.connectorId) busy.set(e.connectorId, (busy.get(e.connectorId) ?? 0) + 1);
  }
  conns.forEach((c, i) => {
    const at = CONNECTOR_AT[i];
    civic('conn:' + c.id, 'connector', at, i, { level: busy.get(c.id) ?? 0 });
    signs.push({ x: at[0] - (i === 1 ? 1 : 0.1), y: at[1] + 1.3, z: 8, text: c.title, bg: '#19B8A0', fg: '#FFFFFF', minZoom: 1, small: false, depth: at[0] + at[1] + 1.4, name: true, place: 'conn:' + c.id });
  });
  // Plugin street: one shop per installed plugin; a disabled one has its shutters down.
  (store.inventory().plugins ?? []).slice(0, 8).forEach((pl, i) => {
    const by = [7, 17][(i >> 2) % 2], sl = i & 3;
    const at: [number, number] = [23 + (sl & 1) * 3 + 1, by + (sl >> 1) * 3 + 1];
    const v = seedOf(pl.id) & 4095;
    civic('shop:' + pl.id, 'shop', at, v, { on: pl.enabled });
    signs.push({ x: at[0], y: at[1] + 0.7, z: 34, text: pl.id, bg: pl.enabled ? SHOP_COLOURS[v % 8] : '#8A93A3', fg: '#141A30', minZoom: 3, small: true, depth: at[0] + at[1] + 0.8 });
  });
  // Workspace name plates at the corner of the first block each workspace claimed.
  for (const [wsId, blockKey] of wsFirstBlock) {
    const b = template.blocks.find((x) => x.key === blockKey);
    const ws = store.workspaces().find((w) => w.id === wsId);
    if (!b || !ws) continue;
    signs.push({ x: b.bx + 2.5, y: b.by + 5.2, z: 10, text: o.names.defaultWorkspace ? workspaceName(ws.title, o.names.defaultWorkspace) : ws.title, bg: WS_COLOURS[(placement.workspaces[wsId] ?? 0) % WS_COLOURS.length], fg: '#141A30', minZoom: 1, small: false, depth: b.bx + b.by + 10.3, name: true });
  }
  // Agents outdoors: in the square (waiting, or stopped on an error < 90 min), at a shared place, or sitting at
  // their own door after an error. Inside a building they are heads at the windows.
  // The square: one person per real wait, longest wait in front; placard and loudness from model/rally.
  const waits = rallyAt(store, T);
  const out: SceneAgent[] = [];
  waits.forEach((e, n) => {
    if (n >= SQUARE_MAX) return;
    const s = store.agent(e.agentId)!;
    const st = stateAt(s, T);
    const pos = squareSpot(n);
    const person = personOf(s, st, o, time, placardOf(e.kind), e.tier);
    out.push({ id: s.agent.id, sessionId: s.agent.sessionId, pos, depth: pos[0] + pos[1] + 0.05, inSquare: true, person: n >= SQUARE_FULL ? { ...person, placardSmall: true } : n & 1 ? { ...person, placardLift: SQUARE_LIFT } : person });
    animated = true;
  });
  // Everyone else outdoors: walking between places (from the moment their calls moved there), standing at a shared
  // place, or sitting at their own door after an error. Inside a building they are heads at the windows.
  const placeById = new Map(places.map((p) => [p.id, p]));
  const placeAt = (id: string) => placeById.get(id);
  const doorOf = (id: string, s: AgentTrack): [number, number] | undefined => {
    const p = placeAt(id);
    if (!p) return undefined;
    if (p.tier === 'building') return [p.at[0] + 0.1, p.at[1] + 1.12];
    const d = DOOR[id] ?? [p.at[0], p.at[1] + 0.9];
    const k = s.agent.parentAgentId ? 1 + (seedOf(s.agent.id) % 3) : 0;
    return [d[0] + k * 0.3, d[1]];
  };
  for (const s of agents) {
    const w = where.get(s.agent.id);
    if (!w) continue;
    const st = stateAt(s, T);
    const homeId = buildingId(rootOf(store, s).agent.sessionId);
    const k = idxAt(s, T), tool = st === 'running' && k ? shortTool(s.ev[k - 1].tool) : undefined;
    // Walking: the place changed at t0, coming from `from`.
    let pos: [number, number] | undefined, walking = false;
    if (time > 0 || o.walk) {
      const leg = lastLeg(s, T, homeId, w.place);
      if (leg && leg.from !== leg.to) {
        // Out of the square: from the spot it stood on just before it left (the square's order at that moment).
        const was = leg.from === PLACE.town ? rallyAt(store, leg.t0 - 1).findIndex((e) => e.agentId === s.agent.id) : -1;
        const a = placeAt(leg.from), b = placeAt(leg.to), d0 = was >= 0 ? squareSpot(was) : doorOf(leg.from, s), d1 = w.place === PLACE.town ? squareSpot(Math.max(0, waits.findIndex((e) => e.agentId === s.agent.id))) : doorOf(leg.to, s);
        if (a && b && d0 && d1) {
          const r = route(gatesOf(leg.from, a.at), gatesOf(leg.to, b.at), growth);
          const off = ((seedOf(s.agent.id) % 100) / 100 - 0.5) * 0.4;
          const pts: [number, number][] = [d0, ...r.map((t): [number, number] => [t[0] + 0.5 + off, t[1] + 0.5 + off]), d1];
          const at2 = along(pts, T - leg.t0);
          if (at2) { pos = at2; walking = true; }
        }
      }
    }
    if (!walking) {
      if (w.place === PLACE.town) continue;   // in the square (drawn above)
      if (w.place === homeId) {
        if (st !== 'failed' || (failedAt(s, T) !== undefined && T - failedAt(s, T)! < FAILED_IN_SQUARE_MS)) continue;
        pos = doorOf(homeId, s);
      } else pos = doorOf(w.place, s);
    } else if (w.place === PLACE.town) {
      // On the way to the square: not in it yet.
      const i = out.findIndex((x) => x.id === s.agent.id);
      if (i >= 0) out.splice(i, 1);
    }
    if (!pos) continue;
    const person = { ...personOf(s, st, o, time, 0, 0), walking, phase: walking ? time + (seedOf(s.agent.id) % 7) : 0 };
    out.push({ id: s.agent.id, sessionId: s.agent.sessionId, pos, depth: pos[0] + pos[1] + 0.05, inSquare: false, person, ...(tool ? { tool } : {}) });
    if (walking) animated = true;
    // The tool name over the head: a text-layer plate, never painted into the pixels.
    if (tool) signs.push({ x: pos[0], y: pos[1], z: 44, text: tool, bg: '#FFFFFF', fg: '#141A30', minZoom: 2, small: true, depth: pos[0] + pos[1] + 0.06 });
  }
  if (o.night && waits.length) { pools.push({ x: 14.7, y: 15.4, colour: '#FFF6CF', r: 72 }); pools.push({ x: 14.5, y: 19.2, colour: '#FFD37E', r: 58 }); }
  const cars = Math.max(0, Math.min(64, Math.round(recentCalls / 2)));
  if (cars) animated = true;
  // A failed call puts up a small puff for 20 seconds where it happened.
  const puffs = new Set<string>();
  for (const s of agents) for (let i = idxAt(s, T) - 1; i >= 0 && s.ev[i].t > T - 20_000; i--) {
    const e = s.ev[i];
    if (e.ok !== false) continue;
    const homeId = buildingId(rootOf(store, s).agent.sessionId);
    puffs.add(e.connectorId ? 'conn:' + e.connectorId : e.category === 'web' ? PLACE.station : e.category === 'skill' ? PLACE.school : e.category === 'memory' ? PLACE.library : homeId);
  }
  if (puffs.size) animated = true;
  // Trains: every scheduled run comes in on a train: it slows into the station
  // 24 s before the run, stands 10 s, and leaves; the next run on the timetable arrives the same way.
  const trains: { x: number; car: number }[] = [];
  const runTimes = new Set<number>();
  for (const sc of store.schedules()) {
    for (const r of sc.runs) runTimes.add(r.at);
    if (sc.status === 'active' && sc.nextAt !== undefined) runTimes.add(sc.nextAt);
  }
  for (const at of runTimes) {
    const x = trainX((T - at) / 1000);
    if (x === undefined) continue;
    for (let k = 0; k < 3; k++) trains.push({ x: x - k * 1.3, car: k });
  }
  if (trains.length) animated = true;
  const power = places.filter((p) => p.civic?.kind === 'power' && p.civic.active).map((p) => ({ id: p.id, at: p.at, feed: p.at[0] < 13 ? 12.5 : 16.5, rate: modelRecent.get(p.id.slice(6)) ?? 0 }));
  return {
    T, growth,
    ground: { growth, claimed, used, models: Math.max(1, models.length), connectors: conns.length, rail: true },
    places, agents: out, cars, rally: waits.length, pools, signs, animated, puffs: [...puffs], power, trains,
  };
}

function personOf(s: AgentTrack, st: StateAt, o: SceneInput, time: number, placard: 0 | 1 | 2 | 3, tier: 0 | 1 | 2): PersonSpec {
  return {
    seed: seedOf(s.agent.id), state: st, subagent: !!s.agent.parentAgentId, ring: o.follow === s.agent.id || o.hover === s.agent.id,
    phase: placard ? time + (seedOf(s.agent.id) % 7) : 0, walking: false, placard, tier,
    ...(s.agent.engine ? { engine: s.agent.engine } : {}),
  };
}
