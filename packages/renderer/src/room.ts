// The inside view: one floor at a time as a square isometric room
// at the city's angle, the whole building as a floor stack at its left, the agents of this floor at their
// workstations. A low-resolution art buffer scaled by a whole number, text at screen resolution on top.
//
// Rules: people are agents only; nothing moves unless an agent works on this floor (an idle floor is one still
// picture and the frame loop stops); entering fades the room in over the city; newcomers step out of the lift;
// reduced motion: no fade, no walking, no animation, at most two frames a second.
import { STACK_PITCH, stackLabelY, type RoomPropId, type ArtKit, type Canvas2D, type PersonSpec, type PixelPen, type RoomSpec, type RoomTier, type Sprite } from './artkit.ts';
import type { FrameStats } from './view.ts';
import { deviceRatio } from './camera.ts';
import { POSE_OF, roomSpecOf, type Interior, type InteriorAgent, type InteriorFloor } from './room-scene.ts';
import { route, type P } from './room-walk.ts';
import { shortTool } from './scene.ts';
import { drawTextLayer, SMALL_FONT, type PlacedSign } from './text.ts';
import { AMBIENT_FPS, CALM_AFTER_MS, CALM_FPS, FrameLoop, documentPage, frameGap, type PageState } from './pace.ts';

export interface RoomViewOptions {
  kit: ArtKit;
  canvas: HTMLCanvasElement;
  reducedMotion(): boolean;
  onFrame?(v: RoomView): void;
  raf?: (fn: (t: number) => void) => number;
  cancelRaf?: (id: number) => void;
  /** A timer for long gaps between frames (default setTimeout with the browser's frames; none with injected ones). */
  timeout?: ((fn: () => void, ms: number) => unknown) | null;
  clearTimeout?: (id: unknown) => void;
  /** Whether the page is hidden or its window blurred (default: the real document). */
  page?: PageState;
  clock?: () => number;
  /** The art buffer (tests pass a fake; default an offscreen canvas). */
  artBuffer?: () => { canvas: { width: number; height: number }; ctx: Canvas2D };
  /** Bands a moving room is painted in, one per frame (default 3). */
  bands?: number;
}

export interface RoomInput {
  interior: Interior;
  /** The floor shown. */
  floor: string;
  T: number;
  /** Tokens in the last five minutes (power station turbines). */
  rate?: number;
  /** Town hall: the name plate over each service counter, by floor id (the panel's own floor name and count). */
  bayText?: Readonly<Record<string, string>>;
}

/** Where things are on screen after a paint (CSS pixels). */
export interface RoomGeometry {
  wide: boolean;
  /** Room image: left, top, CSS pixels per art pixel. */
  x: number; y: number; zoom: number; w: number; h: number;
  /** Floor stack (wide only): left, top, width, height; and the left/top of each floor's button, bottom floor first. */
  stack?: { x: number; y: number; w: number; h: number };
  labels: [number, number][];
  /** The data props on screen (CSS pixel rectangles), template rooms only. */
  props: { id: RoomPropId; r: [number, number, number, number] }[];
}

interface Walker { q: [number, number]; at: string; moving: boolean; path: P[]; goal: string }

/** Walking speed indoors, tiles per second. */
const SPEED = 2.4;
/** Seconds between workstation changes of a running agent ("about every 7 seconds"). */
const SHIFT_S = 7;
/** The fade from the city into the room lasts about 0.4 s. */
const FADE_PER_S = 2.6;
/** Changing floors: a short lift slide (ms) by one slab (art pixels). */
const LIFT_MS = 150;
const SLAB = 24;

export class RoomView {
  readonly kit: ArtKit;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: Canvas2D;
  private readonly o: RoomViewOptions;
  private readonly art: { width: number; height: number };
  private readonly actx: Canvas2D;
  vp = { w: 800, h: 600, dpr: 1 };
  dark = false;
  hover: string | undefined;
  follow: string | undefined;
  private input: RoomInput | undefined;
  private shown: { key: string; sprite: Sprite; place: string; floor: string } | undefined;
  private job: { spec: RoomSpec; key: string; part: number } | undefined;
  private readonly walkers = new Map<string, Walker>();
  private enterK = 1;
  private entering = false;
  private leaving: (() => void) | undefined;
  /** A floor change in progress (the lift), or the room growing to its building's new size (a cross-fade, from = to). */
  private slide: { image: CanvasImageSource; w: number; h: number; x: number; y: number; s2: number; from: number; to: number; t0: number } | undefined;
  /** The floor size shown, per place and floor (a change while the member looks is cross-faded). */
  private shownTier: { key: string; tier: RoomTier } | undefined;
  /** The agents stand at their spots at once (after the room changed size under them). */
  private snapWalkers = false;
  private lastS2 = 1;
  private dirty = true;
  /** Drag offset of a room bigger than the view (phones), CSS pixels; reset when the floor changes. */
  private pan: [number, number] = [0, 0];
  private panKey = '';
  /** The member is dragging: paint on the next frame even under reduced motion (it is their hand, not animation). */
  private urgent = false;
  private readonly loop: FrameLoop;
  private readonly page: PageState;
  private get running(): boolean { return this.loop.running; }
  private lastTick = 0;
  private readonly t0: number;
  private readonly times: number[] = [];
  private frames = 0;
  /** Painted frames in which the room itself was (partly) repainted. */
  roomPaints = 0;
  animated = false;
  /** Steps of the room's own animation a second (pace.ts): ROOM_HZ, once a second when left alone or in the background. */
  private roomHz = ROOM_HZ;
  /** A transition runs (entry fade, lift, cross-fade, the room painted band by band): full rate. */
  private transition = false;
  geometry: RoomGeometry = { wide: true, x: 0, y: 0, zoom: 1, w: 0, h: 0, labels: [], props: [] };
  /**
   * How the last frame put the room's art buffer on the screen (device pixels): checks hold it to whole numbers, a
   * whole scale and smoothing off.
   */
  blit = { sc: 0, x: 0, y: 0, w: 0, h: 0, smoothing: true };
  /** Where the text layer drew plates this frame (device pixels): checks treat them as interface, not art. */
  signRects: [number, number, number, number][] = [];
  /** Agents on screen (CSS pixel rectangles), front first. */
  hits: { id: string; r: [number, number, number, number] }[] = [];

  constructor(o: RoomViewOptions) {
    this.o = o; this.kit = o.kit; this.canvas = o.canvas;
    this.ctx = o.canvas.getContext('2d') as Canvas2D;
    if (o.artBuffer) { const b = o.artBuffer(); this.art = b.canvas; this.actx = b.ctx; }
    else {
      const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
      this.art = c; this.actx = (c as HTMLCanvasElement).getContext('2d') as Canvas2D;
    }
    this.t0 = this.now();
    this.page = o.page ?? documentPage();
    this.loop = new FrameLoop({ tick: (t) => this.tick(t), raf: o.raf, cancelRaf: o.cancelRaf, timeout: o.timeout, clearTimeout: o.clearTimeout, clock: () => this.now(), page: this.page });
  }

  private now() { return this.o.clock ? this.o.clock() : performance.now(); }

  resize(w: number, h: number, dpr: number): void {
    this.vp = { w, h, dpr: deviceRatio(dpr) };
    this.canvas.width = Math.round(w * this.vp.dpr);
    this.canvas.height = Math.round(h * this.vp.dpr);
    this.invalidate();
  }
  /**
   * New data or another floor. A different place starts the entry fade (unless motion is reduced). The same floor of
   * the same place a moment later (the live clock moving on) while the room moves anyway: shown with its next frame,
   * not painted at once.
   */
  setInput(input: RoomInput): void {
    const prev = this.input;
    if (prev && prev.interior.placeId === input.interior.placeId && prev.floor === input.floor && this.running && this.animated && !this.o.reducedMotion()) {
      this.input = input;
      const gap = this.gap(false);
      if (gap !== undefined) this.loop.request(gap);
      return;
    }
    if (!prev || prev.interior.placeId !== input.interior.placeId) { this.walkers.clear(); this.enter(); }
    else if (prev.floor !== input.floor) {
      this.walkers.clear();
      // The lift: the old floor slides away by one slab while the new one comes in (none under reduced motion).
      const fl = input.interior.floors, a = fl.findIndex((x) => x.id === prev.floor), b = fl.findIndex((x) => x.id === input.floor);
      if (!this.o.reducedMotion() && this.running && a >= 0 && b >= 0 && this.art.width > 2) this.snapshot(a, b);
    }
    this.input = input;
    this.invalidate();
  }
  /** Keeps the picture on screen now, to slide (floor change) or cross-fade (new size) into the next one. */
  private snapshot(from: number, to: number): void {
    const snap = this.o.artBuffer ? this.o.artBuffer() : (() => { const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas'); return { canvas: cv, ctx: (cv as HTMLCanvasElement).getContext('2d') as Canvas2D }; })();
    snap.canvas.width = this.art.width; snap.canvas.height = this.art.height;
    snap.ctx.drawImage(this.art as CanvasImageSource, 0, 0);
    this.slide = { image: snap.canvas as unknown as CanvasImageSource, w: this.art.width, h: this.art.height, x: this.geometry.x, y: this.geometry.y, s2: this.lastS2, from, to, t0: -1 };
  }
  /** Starts the fade in from the city. */
  enter(): void { this.shownTier = undefined; this.enterK = 0; this.entering = true; this.leaving = undefined; this.invalidate(); }
  /** Fades back out to the city, then calls `done` (at once under reduced motion). */
  leave(done: () => void): void {
    if (this.o.reducedMotion() || !this.running) { done(); return; }
    this.leaving = done; this.entering = false; this.invalidate();
  }
  setDark(dark: boolean): void { if (dark !== this.dark) { this.dark = dark; this.invalidate(); } }
  setHover(id: string | undefined): void { if (id !== this.hover) { this.hover = id; this.invalidate(); } }
  /** Drags a room that is bigger than the view (no effect when it fits). */
  panBy(dx: number, dy: number): void { this.pan[0] += dx; this.pan[1] += dy; this.urgent = true; this.invalidate(); }
  setFollow(id: string | undefined): void { if (id !== this.follow) { this.follow = id; this.invalidate(); } }
  invalidate(): void { this.dirty = true; this.kick(); }

  start(): void { this.loop.start(); this.kick(); }
  stop(): void { this.loop.stop(); }

  private kick(): void { this.loop.request(0); }

  /** The least time to the next paint (ms), or undefined when nothing needs one (pace.ts). */
  private gap(rm: boolean): number | undefined {
    return frameGap({ urgent: this.dirty || (!rm && this.transition), ambient: !rm && this.animated, reducedMotion: rm, blurred: this.page.blurred(), calm: this.page.idleFor() >= CALM_AFTER_MS, hand: this.urgent });
  }

  private tick(ts: number): void {
    if (!this.running) return;
    const rm = this.o.reducedMotion();
    const gap = this.gap(rm);
    if (gap === undefined) return;
    // Left alone (or in the background) the room's machinery steps every other second and its call tape in steps of
    // a few seconds: each step composes the whole room again, and at a step a second, composed in bands over three
    // frames at CALM_FPS, the room was always being composed.
    this.roomHz = gap >= 1000 / CALM_FPS - 1 ? 0.5 : gap >= 1000 / AMBIENT_FPS + 1 ? 1 : ROOM_HZ;
    if (this.loop.due(ts, gap)) { this.paint(ts); this.loop.lastPaint = ts; this.dirty = false; this.urgent = false; }
    const next = this.gap(rm);
    if (next !== undefined) this.loop.request(next);
  }

  /** The floor shown now. */
  floor(): InteriorFloor | undefined {
    const it = this.input?.interior;
    return it?.floors.find((f) => f.id === this.input!.floor) ?? it?.floors[0];
  }

  /** The agent under a CSS pixel. */
  hitAt(sx: number, sy: number): string | undefined {
    for (const h of this.hits) if (sx >= h.r[0] && sx <= h.r[2] && sy >= h.r[1] && sy <= h.r[3]) return h.id;
    return undefined;
  }

  /** One frame. Public for tests and the performance script. */
  paint(ts = this.now()): void {
    const start = perfNow();
    const rm = this.o.reducedMotion();
    const time = rm ? 0 : (ts - this.t0) / 1000;
    const dt = this.lastTick ? Math.min(0.1, Math.max(0, (ts - this.lastTick) / 1000)) : 0;
    this.lastTick = ts;
    const inp = this.input, f = this.floor();
    if (!inp || !f) return;
    this.kit.setLight({ dark: this.dark });
    // The entry fade (none under reduced motion: no tweens).
    if (rm) { this.enterK = 1; this.entering = false; }
    else if (this.leaving) this.enterK = Math.max(0, this.enterK - dt * FADE_PER_S);
    else if (this.entering) { this.enterK = Math.min(1, this.enterK + dt * FADE_PER_S); if (this.enterK >= 1) this.entering = false; }
    const k = this.enterK * this.enterK * (3 - 2 * this.enterK);
    // The room: at once when it is new or its data changed; band by band while it only moves.
    // The floor size follows the building. When the building grows past a size while the member is
    // in the room, the room cross-fades to its new size and the agents stand at their new spots (no walk-in).
    const tier = inp.interior.tier, tierKey = inp.interior.placeId + '|' + f.id;
    if (this.shownTier && this.shownTier.key === tierKey && this.shownTier.tier !== tier) {
      if (!rm && this.running && this.art.width > 2 && !this.slide) { const fi = inp.interior.floors.indexOf(f); this.snapshot(fi, fi); }
      this.walkers.clear(); this.snapWalkers = true;
    }
    this.shownTier = { key: tierKey, tier };
    // The room's own machinery (screens, gauges, turbines) steps a few times a second: each step composes the whole
    // room again (every prop snapped and outlined), which at ten steps a second was most of an open room's cost. The
    // people keep moving at the frame rate.
    const spec = roomSpecOf(inp.interior, f, { time: Math.floor(time * this.roomHz) / this.roomHz, reduced: rm, night: this.dark, T: inp.T, rate: inp.rate, ageStep: this.roomHz < 1 ? 4 : 1 }, tier);
    const key = JSON.stringify(spec);
    const same = this.shown && this.shown.place === inp.interior.placeId && this.shown.floor === f.id;
    let repainted = false;
    if (this.job && (this.job.spec.room !== spec.room || this.job.spec.id !== spec.id || !spec.frame)) this.job = undefined;
    if (!this.shown || this.shown.key !== key) {
      if (!same || !spec.frame || !this.shown) {
        const s = this.kit.room(spec)!;
        this.shown = { key, sprite: s, place: inp.interior.placeId, floor: f.id };
        this.job = undefined; repainted = true;
      } else if (!this.job) this.job = { spec, key, part: 0 };
    }
    if (this.job) {
      const n = Math.max(1, this.o.bands ?? 3);
      const s = this.kit.room(this.job.spec, { i: this.job.part, n });
      this.job.part++; repainted = true;
      if (s) { this.shown = { key: this.job.key, sprite: s, place: inp.interior.placeId, floor: f.id }; this.job = undefined; }
    }
    if (repainted) this.roomPaints++;
    const room = this.shown!.sprite;
    const layout = this.kit.roomLayout(f.room, inp.interior.place === 'building' ? tier : undefined);
    // Layout: the room as large as a whole zoom of 1–4 allows; the stack on the left.
    const vw = this.vp.w, vh = this.vp.h, dpr = this.vp.dpr, wide = vw > 760;
    const bw = layout.w, bh = layout.h, big = layout.size > 6;
    const stackW = wide && !big ? 250 : 0;
    // Whole device pixels per art pixel (so a phone at 3× still gets a whole number), at most 4 CSS pixels.
    // Fit the room's own drawing (the sprite has a few transparent pixels round it), not the sprite box: on a narrow
    // screen at 1× a 12×12 room (386 art pixels wide) then fits a 390 px phone without cropping, at 1× and at 3×.
    const m = wide ? 8 : 1, cw = Math.ceil(layout.size * 32) + 2, cx0 = layout.ox - Math.ceil(layout.size * 16) - 1;
    let S2 = Math.max(1, Math.floor(Math.min(4 * dpr, ((vw - 2 * m - stackW) * dpr) / cw, ((vh - 2 * m) * dpr) / bh)));
    // On a phone a room is never smaller than 2 CSS pixels per art pixel: what does not fit is
    // reached by dragging, and the view opens on the floor's people (or the lift when nobody is there).
    if (!wide) S2 = Math.max(S2, Math.round(2 * dpr));
    const zi = S2 / dpr;
    let X0 = Math.round(m + stackW + (vw - 2 * m - stackW - cw * zi) / 2 - cx0 * zi), Y0 = Math.round(m + (vh - 2 * m - bh * zi) / 2);
    const overX = cw * zi > vw - 2 * m, overY = bh * zi > vh - 2 * m;
    if (overX || overY) {
      const key = inp.interior.placeId + '|' + f.id;
      if (this.panKey !== key) { this.panKey = key; this.pan = [0, 0]; }
      const at = (x: number, y: number) => [layout.ox + (x - y) * 16, layout.oy + (x + y) * 8];
      const pts = f.people.length ? f.people.map((_p, j) => layout.spots[j % Math.max(1, layout.spots.length)] ?? layout.lift) : [layout.lift];
      const fx = pts.reduce((a, q) => a + at(q[0], q[1])[0], 0) / pts.length, fy = pts.reduce((a, q) => a + at(q[0], q[1])[1], 0) / pts.length;
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      if (overX) { const want = vw / 2 - fx * zi + this.pan[0], x = Math.round(clamp(want, vw - m - (cx0 + cw) * zi, m - cx0 * zi)); this.pan[0] += x - want; X0 = x; }
      if (overY) { const want = vh / 2 - fy * zi + this.pan[1], y = Math.round(clamp(want, vh - m - bh * zi, m)); this.pan[1] += y - want; Y0 = y; }
    }
    if (this.art.width !== bw || this.art.height !== bh) { this.art.width = bw; this.art.height = bh; }
    const A = this.actx;
    A.setTransform(1, 0, 0, 1, 0, 0);
    A.imageSmoothingEnabled = false;
    A.clearRect(0, 0, bw, bh);
    A.drawImage(room.image, 0, 0);
    // The agents of this floor: at their spots, newcomers out of the lift, walking in whole art pixels.
    const px: PixelPen = (x, y, w, h, c) => { A.fillStyle = c; A.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
    const ox = layout.ox, oy = layout.oy, spots = layout.spots;
    const P2 = (x: number, y: number): [number, number] => [ox + Math.round((x - y) * 16), oy + Math.round((x + y) * 8)];
    const placeFloor = inp.interior.placeId + '|' + f.id;
    let moving = false;
    const people = f.people;
    people.forEach((s, j) => {
      const run = s.state === 'running';
      const si = (j + (run && !rm ? Math.floor(time / SHIFT_S + s.seed * 0.37) : 0)) % Math.max(1, spots.length);
      const sp = spots[si] ?? [layout.size / 2, layout.size / 2];
      const tx = sp[0] + (j >= spots.length ? 0.3 : 0), ty = sp[1] + (j >= spots.length ? 0.25 : 0);
      let w = this.walkers.get(s.id);
      if (!w || w.at !== placeFloor || rm) {
        w = { q: rm || k < 0.5 || this.snapWalkers ? [tx, ty] : [layout.lift[0], layout.lift[1]], at: placeFloor, moving: false, path: [], goal: '' };
        this.walkers.set(s.id, w);
      }
      // A new spot: a route along the walkways (newcomers from the lift too).
      const goal = tx.toFixed(2) + ',' + ty.toFixed(2);
      if (w.goal !== goal) { w.goal = goal; w.path = route(layout.aisles ?? [], [w.q[0], w.q[1]], [tx, ty]).slice(1); }
      let step = SPEED * dt;
      w.moving = false;
      while (w.path.length && step > 0) {
        const p = w.path[0], d = Math.hypot(p[0] - w.q[0], p[1] - w.q[1]);
        if (d <= step) { w.q[0] = p[0]; w.q[1] = p[1]; step -= d; w.path.shift(); w.moving = true; }
        else { w.q[0] += (p[0] - w.q[0]) / d * step; w.q[1] += (p[1] - w.q[1]) / d * step; step = 0; w.moving = true; }
      }
      if (w.path.length) w.moving = true;
      if (w.moving) moving = true;
    });
    for (const id of [...this.walkers.keys()]) if (!people.some((p) => p.id === id)) this.walkers.delete(id);
    this.snapWalkers = false;
    const hits: { id: string; r: [number, number, number, number]; d: number }[] = [];
    const plates: PlacedSign[] = [];
    for (const s of [...people].sort((a, b) => depth(this.walkers.get(a.id)) - depth(this.walkers.get(b.id)))) {
      const w = this.walkers.get(s.id)!;
      const q = P2(w.q[0], w.q[1]);
      const ring = this.follow === s.id || this.hover === s.id;
      const spec2: PersonSpec = {
        seed: s.seed, state: s.state, subagent: s.subagent, ring, phase: rm ? 0 : time + (s.seed % 97) / 97,
        walking: w.moving && !rm, working: s.state === 'running' && !w.moving && !rm, placard: 0, tier: 0,
        pose: s.state === 'running' && !w.moving && s.category ? POSE_OF[s.category] : undefined,
        ...(s.engine ? { engine: s.engine } : {}),
      };
      this.kit.person(px, q[0], q[1], spec2);
      hits.push({ id: s.id, r: [X0 + (q[0] - 7) * zi, Y0 + (q[1] - 19) * zi, X0 + (q[0] + 7) * zi, Y0 + (q[1] + 3) * zi], d: q[1] });
      // One tag per group of people standing together (their tags would pile up over the heads).
      const tx0 = (X0 + q[0] * zi) * dpr, ty0 = (Y0 + (q[1] - 22) * zi) * dpr;
      const crowded = plates.some((o) => Math.abs(o.x - tx0) < 44 * dpr && Math.abs(o.y - ty0) < 16 * dpr);
      if (!crowded && s.state === 'running' && s.tool) plates.push({ x: Math.round((X0 + q[0] * zi) * dpr), y: Math.round((Y0 + (q[1] - 22) * zi) * dpr), text: shortTool(s.tool), bg: f.colour, fg: '#FFFFFF', small: true, depth: q[1] });
    }
    // Town hall: a name plate over each service counter, in the town hall sign's colours.
    for (const b of layout.bays ?? []) {
      const text = inp.bayText?.[b.floor];
      if (!text) continue;
      const q = P2(b.at[0], b.at[1]);
      plates.push({ x: Math.round((X0 + q[0] * zi) * dpr), y: Math.round((Y0 + (q[1] - b.at[2] / 2) * zi) * dpr), text, bg: '#FFC928', fg: '#141A30', small: false, depth: -1 });
    }
    this.hits = hits.sort((a, b) => b.d - a.d).map(({ id, r }) => ({ id, r }));
    // To the screen: the city shows through while the room fades in.
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.globalAlpha = k;
    c.imageSmoothingEnabled = false;
    c.fillStyle = this.kit.sky();
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // (X0, Y0 are CSS pixels; the art buffer lands on whole device pixels.)
    let lift = 1;
    if (this.slide && !rm) {
      const sl = this.slide;
      if (sl.t0 < 0) sl.t0 = ts;
      lift = Math.min(1, (ts - sl.t0) / LIFT_MS);
      // going up: the floors drop away; the same floor at a new size only cross-fades
      const e = lift * lift * (3 - 2 * lift), dir = sl.to > sl.from ? 1 : -1, d = sl.to === sl.from ? 0 : SLAB * S2;
      c.save(); c.globalAlpha = k * (1 - e);
      c.drawImage(sl.image, Math.round(sl.x * dpr), Math.round(sl.y * dpr + dir * d * e), sl.w * sl.s2, sl.h * sl.s2);
      c.globalAlpha = k * e;
      c.drawImage(this.art as CanvasImageSource, Math.round(X0 * dpr), Math.round(Y0 * dpr - dir * d * (1 - e)), bw * S2, bh * S2);
      c.restore();
      if (lift >= 1) this.slide = undefined;
    } else {
      this.slide = undefined;
      c.drawImage(this.art as CanvasImageSource, Math.round(X0 * dpr), Math.round(Y0 * dpr), bw * S2, bh * S2);
    }
    this.blit = { sc: S2, x: Math.round(X0 * dpr), y: Math.round(Y0 * dpr), w: bw * S2, h: bh * S2, smoothing: !!c.imageSmoothingEnabled };
    const labels: [number, number][] = [];
    let stackRect: RoomGeometry['stack'];
    const fl = inp.interior.floors;
    if (wide) {   // the whole building at a glance: one slab per floor, pick a floor here
      const st = this.kit.stack(fl.map((x) => ({ colour: x.colour, agents: x.people.map((p) => p.seed), states: x.people.map((p) => p.state), selected: x.id === f.id })));
      const U = Math.max(1, Math.round(dpr)), sh = st.h, sx0 = 20;
      // In the empty corner above the room's left wall, the same place for every room, hall and civic scene (the small
      // scenes used to have it half-way down).
      const sy0 = Math.min(64, Math.round((vh - sh * 2) / 2));
      c.drawImage(st.image, Math.round(sx0 * dpr), Math.round(sy0 * dpr), st.w * 2 * U, sh * 2 * U);
      fl.forEach((_x, i) => labels.push([sx0 + (st.w * 2 * U) / dpr + 6, sy0 + (stackLabelY(sh, i) * 2 * U) / dpr]));
      stackRect = { x: sx0, y: sy0, w: (st.w * 2 * U) / dpr, h: (sh * 2 * U) / dpr };
      // The lift car beside the stack: at the shown floor, travelling with the floor change.
      const fi = fl.indexOf(f), sl = this.slide;
      const at = sl && lift < 1 ? sl.from + (sl.to - sl.from) * (lift * lift * (3 - 2 * lift)) : fi;
      const ly = sy0 + (stackLabelY(sh, 0) - at * STACK_PITCH) * 2 * U / dpr, lx = sx0 + (st.w * 2 * U) / dpr - 2;
      c.fillStyle = '#141A30'; c.fillRect(Math.round(lx * dpr), Math.round((ly - 6) * dpr), Math.round(3 * dpr), Math.round(12 * dpr));
    }
    const uu = Math.max(1, Math.round(S2 / 2));
    this.signRects = drawTextLayer(c, unstack(c, plates, dpr, uu), [], dpr, uu);
    c.globalAlpha = 1;
    // The data props, for the panel's buttons over them.
    const props = (layout.props ?? []).map((p) => {
      const pts: [number, number][] = [];
      if ('wall' in p) for (const a of [p.a0, p.a1]) for (const z of [p.z0, p.z1]) pts.push(p.wall === 'back' ? [a, 0.04, z] as never : [0.04, a, z] as never);
      const corners = 'wall' in p ? pts.map((q) => [q[0], q[1], (q as unknown as number[])[2]]) : [p.floor[0], p.floor[2]].flatMap((x) => [p.floor[1], p.floor[3]].flatMap((y) => [[x, y, 0], [x, y, p.z1]]));
      const xs = corners.map((c) => ox + (c[0] - c[1]) * 16), ys = corners.map((c) => oy + (c[0] + c[1]) * 8 - c[2] * 0.5);
      const r: [number, number, number, number] = [X0 + Math.min(...xs) * zi, Y0 + Math.min(...ys) * zi, X0 + Math.max(...xs) * zi, Y0 + Math.max(...ys) * zi];
      return { id: p.id, r };
    });
    this.geometry = { wide, x: X0, y: Y0, zoom: zi, w: bw * zi, h: bh * zi, stack: stackRect, labels, props };
    this.lastS2 = S2;
    this.transition = !rm && (this.entering || !!this.leaving || !!this.job || !!this.slide);
    this.animated = !rm && (spec.frame > 0 || moving || this.transition);
    if (this.leaving && this.enterK <= 0) { const done = this.leaving; this.leaving = undefined; this.animated = false; this.transition = false; done(); }
    this.frames++;
    const ms = perfNow() - start;
    this.times.push(ms);
    if (this.times.length > 600) this.times.shift();
    this.o.onFrame?.(this);
  }

  /** What the panel's elements over the room follow (agents' places, the floor's geometry): see CityView.domKey. */
  domKey(): string {
    const g = this.geometry;
    return [this.input?.interior.placeId, this.input?.floor, g.x, g.y, g.zoom, g.w, g.h, this.vp.w, this.vp.h, this.hover, this.hits.map((h) => h.id + ':' + h.r.map(Math.round).join(',')).join(';')].join('|');
  }

  stats(): FrameStats {
    const a = [...this.times].sort((x, y) => x - y);
    const q = (p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
    return { frames: this.frames, p50: q(0.5), p95: q(0.95), max: a[a.length - 1] ?? 0 };
  }
  resetStats(): void { this.times.length = 0; this.frames = 0; this.roomPaints = 0; }
}

/**
 * Tool placards of agents standing close together would cover each other: the one further back moves up until it
 * is clear (front ones keep their place). Same size and font as the text layer draws them.
 */
export function unstack(ctx: Canvas2D, plates: readonly PlacedSign[], dpr: number, u: number): PlacedSign[] {
  const fs = Math.round(9 * dpr), h = fs + 4 * u + 2 + 2 * u;
  ctx.font = `700 ${fs}px ${SMALL_FONT}`;
  const placed: [number, number, number, number][] = [];
  const out: PlacedSign[] = [];
  for (const p of [...plates].sort((a, b) => b.depth - a.depth)) {
    const w = Math.ceil(ctx.measureText(p.text).width) + 6 * u + 4 + 2 * u;
    let y = p.y;
    for (let guard = 0; guard < 8; guard++) {
      const r: [number, number, number, number] = [p.x - w / 2, y - h, p.x + w / 2, y];
      const hit = placed.find((q) => r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]);
      if (!hit) { placed.push(r); break; }
      y = Math.round(hit[1]);
    }
    out.push({ ...p, y });
  }
  return out;
}

/** Steps a second of a room's own animation (its sprite is composed again at each). */
export const ROOM_HZ = 3;

/** Frame timing uses the real clock even when tests drive the animation clock. */
const perfNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const depth = (w: Walker | undefined) => (w ? w.q[0] + w.q[1] : 0);

export type { InteriorAgent };
