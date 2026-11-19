// The city view: a low-resolution art buffer scaled to the screen by a whole number, the text
// layer on top at screen resolution, a camera in zoom levels, hit testing, and a frame loop that only repaints when
// something moves. Reduced motion: no tweens, nothing animated, at most two frames a second.
import type { ArtKit, Canvas2D } from './artkit.ts';
import { deviceRatio, homeCamera, minZoom, scaleOf, toArt, toScreen, wholeCity, zoomStep, pan, type Camera, type Viewport } from './camera.ts';
import { artXY, ZOOM_LEVELS } from './geometry.ts';
import { hitTest, type HitArea } from './hit.ts';
import { StaticLayer, paintCity, setLayerLight, type PaintResult, type SurfaceFactory } from './paint.ts';
import { coloredSet, type LayerId } from '@dsh-universe/model';
import { buildScene, type Scene, type SceneInput, type Sign } from './scene.ts';
import { drawTextLayer, type Occluder, type PlacedSign } from './text.ts';
import { Traffic } from './traffic.ts';

export interface CityViewOptions {
  kit: ArtKit;
  canvas: HTMLCanvasElement;
  reducedMotion(): boolean;
  /** Called after each painted frame (DOM markers follow the camera). */
  onFrame?(v: CityView): void;
  /** Requests a frame; defaults to requestAnimationFrame. */
  raf?: (fn: (t: number) => void) => number;
  cancelRaf?: (id: number) => void;
  /** Clock for frame timing (ms). */
  clock?: () => number;
  /** Canvases for the static layer (tests pass a fake). */
  surfaces?: SurfaceFactory;
  /** The art buffer (tests pass a fake; default an offscreen canvas). */
  artBuffer?: () => { canvas: { width: number; height: number }; ctx: Canvas2D };
}

/**
 * An overlay drawn in the frame loop (data views, phase 5). `art` runs on the low-resolution art buffer after the
 * city is painted (whole art pixels; the transform puts art pixel (0, 0) of the world at its place, so `artXY`
 * positions work as they are); `screen` runs on the screen canvas after the text layer (device pixels). Neither may
 * write text into the art buffer. `animated` keeps the loop running while it returns true.
 */
export interface Overlay {
  id: string;
  art?(o: OverlayFrame): void;
  screen?(o: OverlayFrame & { toScreen(ax: number, ay: number): [number, number] }): void;
  animated?(o: OverlayFrame): boolean;
  /** Before painting: may move outdoor agents (people walking to and from the square). Runs every frame. */
  scene?(o: { scene: Scene; dt: number; time: number; reducedMotion: boolean }): void;
}
export interface OverlayFrame {
  ctx: Canvas2D;
  kit: ArtKit;
  scene: Scene;
  /** What the scene was built from (store, placement, T, and the seen marker for the review layer). */
  input: ViewInput;
  last: PaintResult;
  /** The active layer id (the toolbar's), 'all' by default. */
  layer: string;
  /** Animation clock, seconds (0 under reduced motion). */
  time: number;
  reducedMotion: boolean;
  dpr: number;
  /** Zoom level value (0.25 … 4). */
  zoom: number;
  /** The sign rectangles of this frame (screen stage only; empty in the art stage). */
  signRects?: readonly (readonly [number, number, number, number] & { bg?: string; fg?: string; border?: string })[];
}

export type ViewInput = Omit<SceneInput, 'time' | 'night' | 'hover' | 'follow'>;
export interface FrameStats { frames: number; p50: number; p95: number; max: number }

export class CityView {
  readonly kit: ArtKit;
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: Canvas2D;
  private readonly art: HTMLCanvasElement | OffscreenCanvas;
  private readonly actx: Canvas2D;
  private readonly o: CityViewOptions;
  cam: Camera = { x: 0, y: 232, zi: 3 };
  /** Where the camera is gliding to. */
  private goal: Camera | undefined;
  vp: Viewport = { w: 800, h: 600, dpr: 1 };
  dark = false;
  hover: string | undefined;
  follow: string | undefined;
  private readonly overlays: Overlay[] = [];
  layer = 'all';
  private input: ViewInput | undefined;
  private inputVersion = 0;
  private inputAt = 0;
  private sceneKey = '';
  private keepKey = '';
  private keep: Set<string> | null = null;
  scene: Scene | undefined;
  /** Where the text layer drew signs this frame (device pixels): checks treat them as interface, not city. */
  signRects: ([number, number, number, number] & { bg?: string; fg?: string; border?: string })[] = [];
  last: PaintResult | undefined;
  private readonly traffic = new Traffic();
  private readonly still: StaticLayer;
  private dirty = true;
  private raf = 0;
  private lastPaint = 0;
  private lastTick = 0;
  private running = false;
  private readonly times: number[] = [];
  private frames = 0;
  private t0: number;
  /**
   * How the last frame put the art buffer on the screen (device pixels): checks hold it to whole numbers, a whole
   * scale and smoothing off.
   */
  blit = { sc: 0, x: 0, y: 0, w: 0, h: 0, bw: 0, bh: 0, smoothing: true };
  /** Where the last frame's time went (ms): scene data, pixel art, scaling to the screen, text layer. */
  parts = { scene: 0, art: 0, blit: 0, text: 0 };

  constructor(o: CityViewOptions) {
    this.o = o; this.kit = o.kit; this.canvas = o.canvas;
    this.ctx = o.canvas.getContext('2d') as Canvas2D;
    if (o.artBuffer) { const b = o.artBuffer(); this.art = b.canvas as OffscreenCanvas; this.actx = b.ctx; }
    else {
      this.art = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2) : document.createElement('canvas');
      // A GPU-backed buffer (measured: on an integrated GPU a CPU-backed one costs ~15 ms a frame in blits).
      this.actx = (this.art as HTMLCanvasElement).getContext('2d') as Canvas2D;
    }
    this.still = new StaticLayer(o.surfaces ?? ((w, h) => {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
      return { canvas, ctx: (canvas as HTMLCanvasElement).getContext('2d') as Canvas2D };
    }));
    this.t0 = this.now();
  }

  private now() { return this.o.clock ? this.o.clock() : performance.now(); }

  resize(w: number, h: number, dpr: number): void {
    const first = !this.input && this.vp.w === 800;
    this.vp = { w, h, dpr: deviceRatio(dpr) };
    this.canvas.width = Math.round(w * this.vp.dpr);
    this.canvas.height = Math.round(h * this.vp.dpr);
    if (first) this.cam = homeCamera(this.vp);
    // A new ratio can put the level under one device pixel per art pixel: step in to the nearest whole one.
    const lo = minZoom(this.vp);
    if (this.cam.zi < lo) this.cam = { ...this.cam, zi: lo };
    if (this.goal && this.goal.zi < lo) this.goal = { ...this.goal, zi: lo };
    this.invalidate();
  }
  setInput(input: ViewInput): void { this.input = input; this.inputAt = this.now(); this.inputVersion++; this.invalidate(); }
  setDark(dark: boolean): void { if (dark !== this.dark) { this.dark = dark; this.invalidate(); } }
  /** Adds an overlay; returns its removal. */
  addOverlay(o: Overlay): () => void { this.overlays.push(o); this.invalidate(); return () => { const i = this.overlays.indexOf(o); if (i >= 0) this.overlays.splice(i, 1); this.invalidate(); }; }
  /** CSS pixels at the bottom covered by the panel's own controls: no sign is written there. */
  textBottom = 0;
  setTextBottom(px: number): void { if (px !== this.textBottom) { this.textBottom = px; this.invalidate(); } }
  /** Rectangles (CSS pixels, x0 y0 x1 y1) of the controls over the city: no sign or name is written under them. */
  textAvoid: readonly (readonly [number, number, number, number])[] = [];
  setTextAvoid(rects: readonly (readonly [number, number, number, number])[]): void {
    if (rects.length === this.textAvoid.length && rects.every((r, i) => r.every((v, k) => v === this.textAvoid[i][k]))) return;
    this.textAvoid = rects; this.invalidate();
  }
  setLayer(id: string): void { if (id !== this.layer) { this.layer = id; this.invalidate(); } }
  setHover(id: string | undefined): void { if (id !== this.hover) { this.hover = id; this.invalidate(); } }
  setFollow(id: string | undefined): void { this.follow = id; this.invalidate(); }
  invalidate(): void { this.dirty = true; this.kick(); }

  /**
   * Moves the camera to `c`: the zoom level changes at once (only whole levels), the position glides there (about a
   * quarter of a second), so going home, to the whole city or to a followed agent never jumps. Reduced motion: at once.
   */
  moveTo(c: Camera): void {
    if (this.o.reducedMotion()) { this.cam = c; this.goal = undefined; }
    else { this.goal = c; this.cam = { ...this.cam, zi: c.zi }; }
    this.invalidate();
  }
  home(): void { this.moveTo(homeCamera(this.vp)); }
  whole(): void { this.moveTo(wholeCity(this.vp, this.scene?.growth ?? 0)); }
  /** Whether the camera can go further out (false at the widest level: the panel may then show the cities around). */
  canZoomOut(): boolean { return this.cam.zi > minZoom(this.vp); }
  zoom(d: number, sx?: number, sy?: number): void { this.goal = undefined; this.cam = zoomStep(this.cam, d, this.vp, sx, sy); this.invalidate(); }
  panBy(dx: number, dy: number): void { this.goal = undefined; this.follow = undefined; this.cam = pan(this.cam, dx, dy, this.vp); this.invalidate(); }
  /** Centre the camera on a place or agent (art pixels from the last paint). */
  centreOn(id: string): boolean {
    const q = this.last?.tops.get(id) ?? this.last?.heads.get(id.replace(/^agent:/, ''));
    if (!q) return false;
    this.moveTo({ ...this.cam, x: q[0], y: q[1] + 20 });
    this.invalidate();
    return true;
  }

  /** What is under a CSS pixel: an agent first, then a small house, then a building. */
  hitAt(sx: number, sy: number): HitArea | undefined {
    if (!this.last) return undefined;
    const [ax, ay] = toArt(sx, sy, this.cam, this.vp);
    return hitTest(this.last.hits, ax, ay);
  }
  /** Where an art point is on screen (CSS pixels). */
  screenOf(ax: number, ay: number): [number, number] { return toScreen(ax, ay, this.cam, this.vp); }
  zoomValue(): number { return ZOOM_LEVELS[this.cam.zi]; }
  /** True at the whole-city zoom level or further out. */
  isWhole(): boolean { return this.cam.zi <= wholeCity(this.vp, this.scene?.growth ?? 0).zi; }

  start(): void { this.running = true; this.kick(); }
  stop(): void { this.running = false; if (this.raf) (this.o.cancelRaf ?? cancelAnimationFrame)(this.raf); this.raf = 0; }

  private kick(): void {
    if (!this.running || this.raf) return;
    this.raf = (this.o.raf ?? requestAnimationFrame)((t) => { this.raf = 0; this.tick(t); });
  }

  private tick(ts: number): void {
    if (!this.running) return;
    const rm = this.o.reducedMotion();
    const animated = !rm && (!!this.scene?.animated || (!!this.scene && !!this.last && this.overlays.some((o) => o.animated?.(this.frameOf(this.actx, 0)))));
    const gliding = !!this.goal;
    const due = this.dirty || animated || gliding;
    // Reduced motion: a still picture, at most two frames a second.
    if (due && (!rm || ts - this.lastPaint >= 500)) { this.paint(ts); this.lastPaint = ts; this.dirty = false; }
    if (animated || gliding || (rm && this.dirty)) this.kick();
  }

  /** One frame. `ts` in ms. Public for tests and the performance script. */
  paint(ts = this.now()): void {
    const start = this.now();
    const rm = this.o.reducedMotion();
    const time = rm ? 0 : (ts - this.t0) / 1000;
    const dt = this.lastTick ? Math.min(0.1, (ts - this.lastTick) / 1000) : 0;
    this.lastTick = ts;
    if (this.goal) {
      const g = this.goal;
      if (rm) { this.cam = g; this.goal = undefined; }
      else {
        const k = Math.min(1, (dt || 1 / 60) * 9);
        const x = this.cam.x + (g.x - this.cam.x) * k, y = this.cam.y + (g.y - this.cam.y) * k;
        if (Math.abs(g.x - x) < 0.5 && Math.abs(g.y - y) < 0.5) { this.cam = g; this.goal = undefined; } else this.cam = { x, y, zi: g.zi };
      }
    }
    setLayerLight(this.kit.setLight({ dark: this.dark }));
    this.kit.beginFrame?.();
    if (!this.input) return;
    const tA = this.now();
    // The scene changes with the data, the hover, the light, and the animation clock in twelfths of a second.
    const tq = Math.floor(time * 12) / 12;
    const sk = this.inputVersion + '|' + this.hover + '|' + this.follow + '|' + this.dark + '|' + tq;
    const T = this.input.live && !rm ? this.input.T + Math.min(1500, this.now() - this.inputAt) : this.input.T;
    const scene = this.scene = sk === this.sceneKey && this.scene ? this.scene : buildScene({ ...this.input, T, time: tq, night: this.dark, hover: this.hover, follow: this.follow });
    this.sceneKey = sk;
    const tB = this.now();
    for (const ov of this.overlays) ov.scene?.({ scene, dt, time, reducedMotion: rm });
    this.traffic.step(scene.cars, scene.growth, dt, !rm);
    const sc = scaleOf(this.cam, this.vp);
    let bw = Math.ceil(this.canvas.width / sc) + 2, bh = Math.ceil(this.canvas.height / sc) + 2;
    bw += bw & 1; bh += bh & 1;
    if (this.art.width !== bw || this.art.height !== bh) { this.art.width = bw; this.art.height = bh; }
    const camX = Math.round(this.cam.x), camY = Math.round(this.cam.y);
    this.last = paintCity(this.actx, this.kit, scene, this.traffic, { time, zoom: ZOOM_LEVELS[this.cam.zi], bw, bh, camX, camY }, this.still);
    for (const ov of this.overlays) if (ov.art) { this.actx.setTransform(1, 0, 0, 1, Math.round(bw / 2 - camX), Math.round(bh / 2 - camY)); ov.art(this.frameOf(this.actx, time)); }
    // Following an agent: the camera keeps gliding after it while it walks.
    if (this.follow && !rm) {
      const h = this.last.heads.get(this.follow);
      if (h && (Math.abs(h[0] - (this.goal ?? this.cam).x) > 1 || Math.abs(h[1] + 20 - (this.goal ?? this.cam).y) > 1)) this.goal = { ...this.cam, x: h[0], y: h[1] + 20 };
    }
    const tC = this.now();
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    const offX = Math.round(this.canvas.width / 2 - (bw / 2) * sc), offY = Math.round(this.canvas.height / 2 - (bh / 2) * sc);
    c.fillStyle = this.kit.sky();
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.art as CanvasImageSource, offX, offY, Math.round(bw * sc), Math.round(bh * sc));
    this.blit = { sc, x: offX, y: offY, w: Math.round(bw * sc), h: Math.round(bh * sc), bw, bh, smoothing: !!c.imageSmoothingEnabled };
    // The text layer: screen resolution, whole pixels, after the pixel art; hidden parts cut out.
    const zoom = ZOOM_LEVELS[this.cam.zi];
    const ax0 = Math.round(bw / 2 - camX), ay0 = Math.round(bh / 2 - camY);
    const toDev = (x: number, y: number): [number, number] => [Math.round(offX + (x + ax0) * sc), Math.round(offY + (y + ay0) * sc)];
    const signs: PlacedSign[] = [];
    const kk = this.sceneKey + '|' + this.layer;
    if (kk !== this.keepKey) { this.keepKey = kk; this.keep = this.layer !== 'all' && this.input ? coloredSet(this.layer as LayerId, this.input.store, scene.T, this.input.city ?? 'dsh', this.input.seen, this.input.drafts) : null; }
    const keep = this.keep;
    for (const s of scene.signs) {
      const focus = s.door !== undefined && (s.door === this.hover || s.door === this.follow);
      if (zoom < s.minZoom && !focus) continue;
      if (s.door && keep && !keep.has(s.door)) continue;
      // Out below 1× the balloon over the square speaks; the hall's sign under it would collide.
      if (zoom < 1 && s.place === 'town' && this.scene?.rally) continue;
      // A place name sits 10 px above its own roof, centred; others where the scene puts them.
      const top = s.place ? this.last.tops.get(s.place) : undefined;
      const q = top ?? artXY(s.x, s.y, s.z), d = toDev(q[0], q[1]);
      if (top) d[1] -= Math.round(10 * this.vp.dpr);
      if (d[0] < -200 || d[1] < -60 || d[0] > this.canvas.width + 200 || d[1] > this.canvas.height + 60) continue;
      // In a layer, the name of a grey place is grey too (the square's hall keeps its yellow).
      const grey = s.name && keep && s.place !== 'town' && !(s.place && keep.has(s.place));
      signs.push({ x: d[0], y: d[1], text: s.text, small: s.small, depth: s.depth, name: s.name,
        ...(grey ? { bg: '#F4F1E8', fg: '#5B6475', border: '#8A93A3' } : { bg: s.bg, fg: s.fg, ...(s.border ? { border: s.border } : {}) }) });
    }
    // Only sprites that actually cover a sign can cut it out: test their tight rectangles first.
    const occ: Occluder[] = [];
    if (signs.length) {
      const rects = signs.map((s) => [s.x - 160, s.y - 60, s.x + 160, s.y + 20]);
      for (const b of this.last.blits) {
        const t0 = offX + b.t[0] * sc, t1 = offY + b.t[1] * sc, t2 = offX + b.t[2] * sc, t3 = offY + b.t[3] * sc;
        if (!rects.some((r) => t0 < r[2] && t2 > r[0] && t1 < r[3] && t3 > r[1])) continue;
        occ.push({ image: b.image, sx: Math.round(offX + b.x * sc), sy: Math.round(offY + b.y * sc), sw: Math.round(b.w * sc), sh: Math.round(b.h * sc), depth: b.depth, t: [t0, t1, t2, t3] });
      }
    }
    const tD = this.now();
    this.signRects = drawTextLayer(c, signs, occ, this.vp.dpr, Math.max(1, Math.round(sc / 2)), this.textBottom > 0 ? Math.round((this.vp.h - this.textBottom) * this.vp.dpr) : undefined,
      this.textAvoid.map((r) => [r[0], r[1], r[2], r[3]].map((v) => Math.round(v * this.vp.dpr)) as [number, number, number, number]));
    for (const ov of this.overlays) if (ov.screen) { c.setTransform(1, 0, 0, 1, 0, 0); ov.screen({ ...this.frameOf(c, time), toScreen: toDev }); }
    const tE = this.now();
    this.parts = { scene: tB - tA, art: tC - tB, blit: tD - tC, text: tE - tD };
    this.frames++;
    const ms = this.now() - start;
    this.times.push(ms);
    if (this.times.length > 600) this.times.shift();
    this.o.onFrame?.(this);
  }

  private frameOf(ctx: Canvas2D, time: number): OverlayFrame {
    return { ctx, kit: this.kit, scene: this.scene!, input: this.input!, last: this.last!, layer: this.layer, time, reducedMotion: this.o.reducedMotion(), dpr: this.vp.dpr, zoom: ZOOM_LEVELS[this.cam.zi], signRects: this.signRects };
  }

  stats(): FrameStats {
    const a = [...this.times].sort((x, y) => x - y);
    const q = (p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0);
    return { frames: this.frames, p50: q(0.5), p95: q(0.95), max: a[a.length - 1] ?? 0 };
  }
  resetStats(): void { this.times.length = 0; this.frames = 0; }
}
