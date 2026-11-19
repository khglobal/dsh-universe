// Frame pacing for the city and the rooms. A view paints on demand: at once (every display frame) when something
// changed or the member is moving the camera or a transition runs; at AMBIENT_FPS while only the ambient life moves
// (windows, cars, people at work); at BLURRED_FPS while the window is not focused; not at all while the page is hidden
// (and again at once when it comes back). Reduced motion: a still picture, at most two frames a second.
//
// Measured (scripts/cpu-check.mjs, 1440×900 at dpr 2, 300 sessions): painting every display frame cost about half a
// core for as long as one session ran or waited; the pixel art itself only changes in twelfths of a second.

/** Frames a second while only the ambient life moves (the scene's animation clock runs in twelfths of a second). */
export const AMBIENT_FPS = 12;
/**
 * Frames a second for the ambient life once nobody has touched the page for CALM_AFTER_MS (left open on a side).
 * Each frame's step stays what it is at 4 (a car moves at most a tenth of a second's way a frame: view.ts), so the
 * traffic only moves on more slowly. 0.3.1 (with the clock-only updates and the cached text layer in view.ts):
 * the busy day left alone went from a median 14.6% to 6.8% of a core on a loaded machine, 4.1–4.8% on a quiet one
 * (scripts/cpu-check.mjs --gpu, running clock).
 */
export const CALM_FPS = 2;
export const CALM_AFTER_MS = 10_000;
/** Frames a second while the window is not focused. */
export const BLURRED_FPS = 1;
/** Least time between two paints under reduced motion (ms). */
export const REDUCED_GAP_MS = 500;

/** Whether anybody can see the page, and whether its window has the focus. */
export interface PageState {
  hidden(): boolean;
  blurred(): boolean;
  /** Milliseconds since the member last moved the pointer, scrolled or pressed a key in the page. */
  idleFor(): number;
  /** Called when either changes; returns its removal. */
  subscribe(fn: () => void): () => void;
}

/** A page that is always visible and focused (tests, and environments without a document). */
export const ALWAYS_SHOWN: PageState = { hidden: () => false, blurred: () => false, idleFor: () => 0, subscribe: () => () => {} };

let shared: PageState | undefined;
/**
 * The real page: `visibilitychange`, `pagehide` / `pageshow`, and the window's `blur` / `focus`. Shared by every view
 * (one set of listeners). It starts focused: a headless or embedded page may never report the focus at all.
 */
export function documentPage(): PageState {
  if (shared) return shared;
  const doc = (globalThis as { document?: Document }).document;
  const win = globalThis as unknown as Partial<Window>;
  if (!doc || typeof win.addEventListener !== 'function') return (shared = ALWAYS_SHOWN);
  let blurred = false, gone = false, lastInput = performance.now();
  const subs = new Set<() => void>();
  const emit = () => { for (const f of [...subs]) f(); };
  doc.addEventListener('visibilitychange', emit);
  win.addEventListener('pagehide', () => { gone = true; emit(); });
  win.addEventListener('pageshow', () => { gone = false; emit(); });
  win.addEventListener('blur', () => { if (!blurred) { blurred = true; emit(); } });
  win.addEventListener('focus', () => { if (blurred) { blurred = false; emit(); } });
  // Any press or key in the page means it has the focus (some hosts send no focus event back to an iframe); any
  // input at all wakes the ambient life back up to its full rate.
  const touch = () => { const calm = performance.now() - lastInput >= CALM_AFTER_MS; lastInput = performance.now(); if (calm) emit(); };
  const back = () => { touch(); if (blurred) { blurred = false; emit(); } };
  win.addEventListener('pointerdown', back, true);
  win.addEventListener('keydown', back, true);
  win.addEventListener('pointermove', touch, { capture: true, passive: true });
  win.addEventListener('wheel', touch, { capture: true, passive: true });
  return (shared = {
    hidden: () => gone || doc.visibilityState === 'hidden',
    blurred: () => blurred,
    idleFor: () => performance.now() - lastInput,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  });
}

export interface PaceInput {
  /** Something changed, the camera glides or a transition (entry fade, lift, cross-fade) runs: full rate. */
  urgent: boolean;
  /** Only the ambient life moves. */
  ambient: boolean;
  reducedMotion: boolean;
  blurred: boolean;
  /** Nobody has touched the page for a while (CALM_AFTER_MS). */
  calm?: boolean;
  /** Reduced motion, but the member's own hand (a drag): paint at once anyway. */
  hand?: boolean;
}

/**
 * The least time between the last paint and the next one (ms): 0 is the next display frame; `undefined` means no
 * further frame is needed until something changes.
 */
export function frameGap(p: PaceInput): number | undefined {
  if (p.reducedMotion) return p.urgent ? (p.hand ? 0 : REDUCED_GAP_MS) : undefined;
  if (p.urgent) return 0;
  if (!p.ambient) return undefined;
  return 1000 / (p.blurred ? BLURRED_FPS : p.calm ? CALM_FPS : AMBIENT_FPS);
}

/** Display frames are about 16.7 ms apart: a paint this much early still counts as on time. */
export const FRAME_SLACK_MS = 9;

export interface FrameLoopOptions {
  tick(ts: number): void;
  raf?: (fn: (t: number) => void) => number;
  cancelRaf?: (id: number) => void;
  /** A timer (default setTimeout when the display frames are the browser's; with injected frames, none). */
  timeout?: ((fn: () => void, ms: number) => unknown) | null;
  clearTimeout?: (id: unknown) => void;
  clock(): number;
  page: PageState;
}

/**
 * The loop of one view: `request(gap)` asks for `tick(ts)` once `gap` ms after the last paint (0: the next display
 * frame). Long gaps wait on a timer (no display frame is requested meanwhile); a hidden page requests nothing and
 * resumes when it is shown again.
 */
export class FrameLoop {
  private raf = 0;
  private timer: unknown;
  private off: (() => void) | undefined;
  private on = false;
  private wanted: number | undefined;
  lastPaint = -1e9;
  private readonly o: FrameLoopOptions;
  constructor(o: FrameLoopOptions) { this.o = o; }


  start(): void {
    if (this.on) return;
    this.on = true;
    this.off = this.o.page.subscribe(() => { if (this.on && !this.o.page.hidden()) this.request(0); else this.cancel(); });
  }
  stop(): void { this.on = false; this.off?.(); this.off = undefined; this.cancel(); }
  get running(): boolean { return this.on; }
  private cancel(): void {
    if (this.raf) (this.o.cancelRaf ?? cancelAnimationFrame)(this.raf);
    this.raf = 0;
    if (this.timer !== undefined) (this.o.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = undefined;
  }
  private frame(): void {
    if (this.raf) return;
    this.raf = (this.o.raf ?? requestAnimationFrame)((t) => { this.raf = 0; if (this.on && !this.o.page.hidden()) this.o.tick(t); });
  }
  /** Asks for a tick `gap` ms after the last paint. A sooner request replaces a later one. */
  request(gap = 0): void {
    if (!this.on || this.o.page.hidden()) return;
    const wait = Math.max(0, this.lastPaint + gap - this.o.clock());
    const timeout = this.o.timeout === undefined ? (this.o.raf ? null : setTimeout) : this.o.timeout;
    if (wait <= 20 || !timeout) {
      if (this.timer !== undefined) { (this.o.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>)))(this.timer); this.timer = undefined; }
      this.frame();
      return;
    }
    if (this.raf) return;   // a sooner frame is already asked for
    if (this.timer !== undefined) {
      if (this.wanted !== undefined && this.wanted <= this.o.clock() + wait) return;
      (this.o.clearTimeout ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>)))(this.timer);
    }
    this.wanted = this.o.clock() + wait;
    // Wake up a little early: the paint then lands on the display frame at the right time.
    this.timer = timeout(() => { this.timer = undefined; this.wanted = undefined; this.frame(); }, wait - 12);
  }
  /** Whether a paint is due at `ts` for this gap (a clock that went back counts as due). */
  due(ts: number, gap: number): boolean { return ts < this.lastPaint || ts - this.lastPaint >= gap - FRAME_SLACK_MS; }
}
