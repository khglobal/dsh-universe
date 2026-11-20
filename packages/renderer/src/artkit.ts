// The only way the renderer reaches the art: a small typed interface. The real kit lives in packages/art (kept
// separable, all rights reserved); `createStubKit` (flat grey boxes) stands in for it in tests, mock-data dev mode
// and any build without the art package.
//
// Every sprite the kit returns is already snapped to its palette and outlined; the renderer only places it.
// Positions are ground tiles (x, y); the art-pixel position of a tile is `artXY` (geometry.ts).
import type { Engine, RoomInfo, Segment, Stage, StateAt } from '@dsh-universe/model';

export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Sprite {
  image: CanvasImageSource;
  /** Top-left of the image in art pixels, relative to the art-pixel position of its anchor tile. */
  dx: number;
  dy: number;
  w: number;
  h: number;
}
/** A sprite of a place: `top` is how far above its ground point (art pixels) markers and labels go. */
export interface Drawn extends Sprite {
  top: number;
  /** Where the door plate sits (tile y). */
  doorY?: number;
  /** A tower's roof: its centre relative to the anchor and its half-size, art pixels (data views draw on it). */
  roof?: { dx: number; dy: number; hw: number; hh: number };
  /** Moving parts drawn as their own sprites over it (a turning crane), offsets relative to the same anchor. */
  extras?: readonly Sprite[];
}

/** Light: stepped, so sprites can be cached. Dark theme = the night city. */
export interface Light { dark: boolean; clockHour?: number }

/** Discrete animation frames, from data and the clock; all 0 under reduced motion. */
export interface Frames { crane: number; blink: number; epoch: number }

/** What the renderer knows about a session building; no titles, no content. */
export interface BuildingSpec {
  /** Owner of the sprite slot (the building id). */
  id: string;
  /** Seed of the session: colour and small variations. */
  seed: number;
  /** Building template index (0 … buildingTemplates − 1). */
  template: number;
  /** Added to the seed's main colour so neighbours on one block never look the same (0 by default). */
  hueShift?: number;
  /** Lot centre, tiles. */
  at: readonly [number, number];
  segments: readonly Segment[];
  /** Half-width of the footprint in a 2×2 lot (0.58–0.90). */
  footprint: number;
  stage: Stage;
  state: StateAt;
  /** Agents at a window of each segment now (their seeds); at most three per segment are drawn. */
  heads: readonly { floor: Segment['id']; seed: number }[];
  /** Finished agents of the family resting on the roof (seeds). */
  resting: readonly number[];
  /** Subagent annexes, by state. */
  annexes: readonly StateAt[];
  scheduled: boolean;
  preset: boolean;
  hover: boolean;
  frames: Frames;
}

export type CivicKind = 'town' | 'station' | 'fire' | 'school' | 'library' | 'power' | 'connector' | 'shop';
export interface CivicSpec {
  /** Owner of the sprite slot (the place id). */
  id: string;
  kind: CivicKind;
  at: readonly [number, number];
  /** connector: slot 0–2 (three shapes); power: model index; shop: plugin variant seed. */
  variant: number;
  /** Someone works inside (or waits in the square, for the town hall): windows lit at night. */
  active: boolean;
  /** power: stack height (drawing units, from today's tokens); connector: calls in the last 5 minutes. */
  level: number;
  /** shop: plugin enabled. */
  on: boolean;
  /** station / town: the clock (minutes of the day, stepped to 5). */
  clock: number;
  hover: boolean;
  frames: Frames;
}

export interface GroundSpec {
  /** Border growth step (model GROWTH index). */
  growth: number;
  /** Claimed blocks at T: block key → workspace colour index. */
  claimed: ReadonlyMap<string, number>;
  /** Lots holding a building at T. */
  used: ReadonlySet<string>;
  /** Number of power stations (one per model, at least one). */
  models: number;
  /** Connectors (one plaza each, up to three). */
  connectors: number;
  /** The railway to the station (always shown in phase 2). */
  rail: boolean;
}

export interface PersonSpec {
  seed: number;
  state: StateAt;
  subagent: boolean;
  /** The member, in the square (never an invented person). */
  member?: boolean;
  /** Plate under the feet (state colour); a ring when followed or hovered. */
  ring: boolean;
  /** Animation phase: 0 under reduced motion and when idle. */
  phase: number;
  walking: boolean;
  /** Working at a desk: a small bob (indoors, while its agent runs). */
  working?: boolean;
  /**
   * What it is doing now, from its latest call's tool category (indoors, standing at its spot): typing (edit,
   * write), reading (read, search), at the console (shell), at the window screen (web), handing a folder over
   * (subagent). Only moves (typing, turning a page) while `phase` runs.
   */
  pose?: 'type' | 'read' | 'console' | 'web' | 'hand';
  /** Placard in the square: 0 none, 1 approval, 2 question, 3 failed; tier 0–2 by waiting time. */
  placard: 0 | 1 | 2 | 3;
  tier: 0 | 1 | 2;
  /** Behind the square's first row: a small placard beside the head instead of the full one above it. */
  placardSmall?: boolean;
  /** Art pixels the full placard is held higher (every other one in the square's first row, so neighbours do not overlap). */
  placardLift?: number;
  /** An outside coding engine's agent (Claude Code, Codex): drawn in that engine's colours. */
  engine?: Engine;
}

export interface CarSpec { model: number; colour: number; dx: number; dy: number }

export interface StreetItem { x: number; y: number; kind: 'prop' | 'detail' | 'tree'; k: number; v: number; /** A shop sign on it (a word from the locale tables, drawn in the text layer). */ sign?: 'cafe' | 'truck' | 'news' | 'bus'; /** Only when this block is claimed. */ block?: string; /** Only while this lot is empty. */ lot?: string }
export interface StreetLayout { items: readonly StreetItem[]; /** Fairground wheel (static scenery), if inside the city. */ wheel?: readonly [number, number] }

/** Pixel pen: whole art pixels only. */
export type PixelPen = (x: number, y: number, w: number, h: number, colour: string) => void;

export interface SpriteMemory { sprites: number; bytes: number; draws: number; hits: number; evictions: number }

export interface ArtKit {
  readonly id: string;
  readonly version: string;
  /** Room templates (id, tags, floors) for `chooseRoom`. */
  readonly rooms: readonly RoomInfo[];
  /** How many session-building templates there are. */
  readonly buildingTemplates: number;
  /** Tags of each building template (for picking a template from the session theme). */
  readonly buildingTags: readonly (readonly string[])[];
  /** A new frame begins (lets the kit spread costly redraws over frames). */
  beginFrame?(): void;
  /** Sets the light; returns its key (changes when the light does). */
  setLight(l: Light): string;
  /** Background colour of the current light. */
  sky(): string;
  /** Static street furniture and trees of the city template (seeded; no data, no people). */
  street(): StreetLayout;
  ground(spec: GroundSpec): Sprite;
  building(spec: BuildingSpec): Drawn;
  civic(spec: CivicSpec): Drawn;
  item(it: StreetItem): Sprite;
  car(spec: CarSpec): Sprite;
  /** One car of a train (0 the engine): trains bring scheduled runs into the station. */
  train(car: number): Sprite;
  /** A person, drawn straight into the art canvas in whole-pixel rectangles. */
  person(px: PixelPen, X: number, Y: number, spec: PersonSpec): void;
  /** Solid smoke (2–5 px squares), `t` in seconds (0 when still). */
  smoke(px: PixelPen, X: number, Y: number, t: number, colour: string, n: number, rise: number, seed: number): void;
  /** A hard-edged dithered pool of light on the ground (night). */
  pool(colour: string, r: number): Sprite;
  /** The amber "!" balloon over the square. */
  balloon(px: PixelPen, X: number, Y: number, k: number): void;
  memory(): SpriteMemory;
  /**
   * One floor of a place, as a room: its shell, furniture and data, without the agents.
   * Without `part` the room is painted at once. With `part` only band `i` of `n` is painted into a back buffer
   * (so one frame never pays for a whole room); the finished sprite comes back with the last band, `undefined`
   * before. A spec already painted comes back at once either way.
   */
  room(spec: RoomSpec, part?: RoomPart): Sprite | undefined;
  /** The geometry of a room at a size tier (default large): its size, where agents stand, where the lift is. */
  roomLayout(room: string, tier?: RoomTier): RoomLayout;
  /**
   * The size of a session building's floors from the building as the city draws it ("bigger
   * buildings have bigger floors"): its template's drawn footprint, its storeys and its growth stage. Pure, and
   * never smaller for a building that has grown. A kit without it has full-size floors only.
   */
  roomTier?(b: BuildingShape): RoomTier;
  /** The whole building at a glance (floor slabs, bottom first, each with its agents). */
  stack(floors: readonly StackFloor[]): Sprite;
}

/**
 * The size of a session building's floors: small and medium are compact versions of the same rooms (fewer
 * workstations, the same template, every data element); large is the full 12×12 room.
 */
export type RoomTier = 'small' | 'medium' | 'large';
/** What decides a building's floor size: what the city draws of it. */
export type BuildingShape = Pick<BuildingSpec, 'template' | 'footprint' | 'segments' | 'stage'>;

/** One horizontal band of a room painting. */
export interface RoomPart { i: number; n: number }

/** A call on this floor in the last minute: seconds ago, and whether it failed. */
export interface RoomRecent { age: number; err: boolean }

/** What a place is (the room's wall colour and its fixed scenes follow it). */
export type RoomPlace = 'building' | 'connector' | 'town' | 'station' | 'school' | 'library' | 'power' | 'fire';

/**
 * One floor to draw. Only metadata and aggregates: counts, ages, states, the clock. `room` is a room template id
 * (a 12×12 room) or a fixed scene (lobby, roof and the floors of the public buildings, 5.2×5.2).
 */
export interface RoomSpec {
  /** Owner of the sprite slot (one per view). */
  id: string;
  room: string;
  /** The floor id (lobby, library, …, a connector's tool name, platform, approval, …). */
  floor: string;
  place: RoomPlace;
  /** Colour of the floor's kind (the band on the walls, the floor tint). */
  colour: string;
  /** Seed of the place (building colour, small seeded variations). */
  seed: number;
  /** An agent is working on this floor now. When false nothing in the room moves. */
  act: boolean;
  /** Animation clock in tenths of a second: 0 when `act` is false or motion is reduced. */
  frame: number;
  reduced: boolean;
  night: boolean;
  /** The platform does not provide this floor's data: hatched floor. */
  na: boolean;
  /** Calls (or the floor's number) so far. */
  n: number;
  /** Calls on this floor in the last minute, newest first (at most 8). */
  recent: readonly RoomRecent[];
  /** Background jobs running now (the job printers). */
  jobs: number;
  /** States of the building's subagents (meeting floor). */
  subs: readonly StateAt[];
  /** Deliverables of a finished session (lobby). */
  out: number;
  /** Requests waiting at this window (town hall). */
  queue: number;
  /** Tokens in the last five minutes (the power station's turbines). */
  rate: number;
  /** The workspace clock in hours, stepped to the minute (wall clocks; follows replay). */
  hour: number;
  /** The session has ended (a finished building's roof is a garden). */
  ended?: boolean;
  /** The library: installed skills and plugins (how many are on). */
  stock?: { skills: number; plugins: number; on: number };
  /** Agents on this floor now (the lobby's reception screen is on only while someone is there). */
  present?: number;
  /** Town hall service floors: today's requests of this kind, approved, denied and still open. */
  tally?: { yes: number; no: number; open: number };
  /** Town hall: every service counter's tally (approval, question, plan), drawn as tickets on its bay. */
  bays?: readonly { yes: number; no: number; open: number }[];
  /** A session building's floor size (rooms, lobby and roof); default large. */
  tier?: RoomTier;
}

export interface RoomLayout {
  /** Side of the room in tiles (12 for a full-size room or hall, 10.5 or 9 for a compact one, 5.2 for a fixed scene). */
  size: number;
  /** Where agents stand, in tiles (workstation chairs first). */
  spots: readonly (readonly [number, number])[];
  /** Where a newcomer steps out of the lift. */
  lift: readonly [number, number];
  /**
   * The data props every template room shares, where they are drawn: on a wall (`along` the back
   * wall's x or the left wall's y, heights in drawing units) or standing on the floor (a tile box). The panel puts a
   * button over each so its numbers can be read.
   */
  props?: readonly RoomProp[];
  /** Town hall: where each service counter's name plate goes (tiles, height in drawing units), by floor id. */
  bays?: readonly { floor: string; at: readonly [number, number, number] }[];
  /** Walkways (x0, y0, x1, y1 in tiles, as drawn): agents walk along them. */
  aisles?: readonly (readonly [number, number, number, number])[];
  /** The room sprite: size and where tile (0, 0) is in it (art pixels). */
  w: number; h: number; ox: number; oy: number;
}

export type RoomPropId =
  | 'tape' | 'board' | 'beacon' | 'printers' | 'whiteboard'
  | 'crates' | 'reception' | 'racks' | 'solar'
  | 'menu' | 'departures' | 'webtally' | 'turnstiles' | 'blackboard' | 'portraits' | 'books' | 'cartridges' | 'load' | 'meter' | 'dial' | 'repairlog' | 'engine';
export type RoomProp =
  | { id: RoomPropId; wall: 'back' | 'left'; a0: number; a1: number; z0: number; z1: number }
  | { id: RoomPropId; floor: readonly [number, number, number, number]; z1: number };

/** A slab of the floor stack: the floor's colour, the agents on it (seed and state), whether it is shown. */
export interface StackFloor { colour: string; agents: readonly number[]; states?: readonly StateAt[]; selected: boolean }
/** The floor stack's geometry (art pixels): slab pitch; the sprite's anchor is `STACK_BASE` above its bottom edge. */
export const STACK_PITCH = 15;
export const STACK_BASE = 26;
/** Where floor i's label is centred, in art pixels below the stack sprite's top edge. */
export const stackLabelY = (h: number, i: number): number => h - STACK_BASE + 14.8 - i * STACK_PITCH;

/** Checks that a kit is usable; returns the problems (empty when fine). */
export function artKitProblems(kit: ArtKit): string[] {
  const out: string[] = [];
  if (!kit.id) out.push('id is empty');
  if (!(kit.buildingTemplates >= 1)) out.push('no building templates');
  if (kit.buildingTags.length !== kit.buildingTemplates) out.push('building tags do not match the templates');
  const ids = new Set<string>();
  for (const r of kit.rooms) {
    if (ids.has(r.id)) out.push('room ' + r.id + ' twice');
    ids.add(r.id);
    if (!r.floors.length) out.push('room ' + r.id + ' has no floor');
  }
  for (const f of ['library', 'workshop', 'machine', 'meeting'] as const) if (!kit.rooms.some((r) => r.floors.includes(f))) out.push('no room for the ' + f + ' floor');
  for (const fn of ['setLight', 'sky', 'street', 'ground', 'building', 'civic', 'item', 'car', 'train', 'person', 'smoke', 'pool', 'balloon', 'memory', 'room', 'roomLayout', 'stack'] as const) {
    if (typeof kit[fn] !== 'function') out.push(fn + ' missing');
  }
  return out;
}
