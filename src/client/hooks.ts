import { useEffect, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import type { Feed, FeedState } from './feed.ts';
import type { Observable } from './types.ts';
import { CALM_AFTER_MS, documentPage, type PageState } from '@dsh-universe/renderer';

export const useFeed = (feed: Feed): FeedState => useSyncExternalStore(feed.subscribe, feed.get, feed.get);
export const useObservable = <T,>(o: Observable<T>): T => useSyncExternalStore(o.subscribe, o.getSnapshot, o.getSnapshot);

/** The clock's step under the list: its durations move on every few seconds (each step recomputes the whole day). */
export const LIST_TICK_MS = 5000;

/**
 * The clock, every `every` ms while mounted and the page is shown (the text of waits and durations follows it;
 * nothing is animated). A hidden page stops it (each tick recomputes the day: 2 to 4% of a core on a busy day for
 * nobody to see) and catches up at once when it is shown again. Left alone (no input for CALM_AFTER_MS) or in a
 * window without the focus, it steps every CALM_TICK_MS, and catches up at the member's first move.
 */
export function useNow(now: () => number, every = 1000, page: PageState = documentPage()): number {
  const [t, setT] = useState(now);
  useEffect(() => clockTimer(() => setT(now()), every, page), [now, every, page]);
  return t;
}

/** The clock's step while the page is left alone or in the background (ms). */
export const CALM_TICK_MS = 2000;

/**
 * Calls `fn` every `every` ms while the page is shown (every CALM_TICK_MS at least while it is left alone or
 * blurred); stops while it is hidden and calls it once at once when it is shown again or woken up. Returns the stop.
 */
export function clockTimer(fn: () => void, every: number, page: PageState,
  timers: { set: (f: () => void, ms: number) => unknown; clear: (id: unknown) => void } = { set: (f, ms) => setInterval(f, ms), clear: (id) => clearInterval(id as ReturnType<typeof setInterval>) },
  clock: () => number = () => performance.now()): () => void {
  let id: unknown, last = clock(), calm = false;
  const call = () => { last = clock(); fn(); };
  const tick = () => {
    calm = page.blurred() || page.idleFor() >= CALM_AFTER_MS;
    if (calm && clock() - last < Math.max(every, CALM_TICK_MS) - 50) return;
    call();
  };
  const arm = () => {
    if (page.hidden()) { if (id !== undefined) timers.clear(id); id = undefined; return; }
    // Shown again, or woken up from the calm step: brought up to date at once.
    if (id === undefined || (calm && clock() - last >= every - 50)) call();
    calm = false;
    id ??= timers.set(tick, every);
  };
  const off = page.subscribe(arm);
  if (!page.hidden()) id = timers.set(tick, every);
  return () => { off(); if (id !== undefined) timers.clear(id); id = undefined; };
}

/**
 * A 16 px fade at the edge where a one-row scrolling bar is cut (the today bar and the toolbar at
 * 390 px). Only while something is hidden past that edge; the left edge too once scrolled.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>): CSSProperties {
  const [cut, setCut] = useState<{ l: boolean; r: boolean }>({ l: false, r: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const look = () => {
      const l = el.scrollLeft > 1, r = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setCut((c) => (c.l === l && c.r === r ? c : { l, r }));
    };
    look();
    el.addEventListener('scroll', look, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(look) : undefined;
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', look); ro?.disconnect(); };
  }, [ref]);
  if (!cut.l && !cut.r) return {};
  const m = `linear-gradient(to right, ${cut.l ? 'transparent, #000 16px' : '#000'}, ${cut.r ? '#000 calc(100% - 16px), transparent' : '#000'})`;
  return { maskImage: m, WebkitMaskImage: m };
}

/**
 * Calls `fn` whenever the device pixel ratio changes without the element changing size: the window moved between a
 * Retina and a 1× screen, or the page zoom changed. A ResizeObserver does not see that, and a canvas left at the old
 * ratio is scaled by the browser: at 1× → 2× the signs turn blocky, at 2× → 1× pixel columns drop out. Heard from the
 * `resolution` media query and the window's resize, with a once-a-second look as the fallback (some hosts and headless
 * browsers send neither). Returns the stop.
 */
export function onRatioChange(fn: () => void, env: {
  matchMedia?: (q: string) => MediaQueryList; devicePixelRatio?: number;
  addEventListener?: (k: 'resize', f: () => void) => void; removeEventListener?: (k: 'resize', f: () => void) => void;
} = globalThis, every = 1000): () => void {
  let mq: MediaQueryList | undefined, done = false, last = env.devicePixelRatio || 1;
  const check = () => {
    if (done) return;
    const now = env.devicePixelRatio || 1;
    if (now !== last) { last = now; fn(); }
    arm();
  };
  function arm() {
    mq?.removeEventListener?.('change', check);
    mq = env.matchMedia?.(`(resolution: ${last}dppx)`);
    mq?.addEventListener?.('change', check);
  }
  arm();
  env.addEventListener?.('resize', check);
  const id = every > 0 ? setInterval(check, every) : undefined;
  return () => { done = true; mq?.removeEventListener?.('change', check); env.removeEventListener?.('resize', check); if (id !== undefined) clearInterval(id); };
}

/**
 * A view's onFrame for the panel: re-render (bump `frame`) when what the panel's elements follow changed (`key`),
 * at most every `ms`, and once more after the last change. Painting a frame alone re-renders nothing.
 */
export function frameNotifier(key: () => string, bump: () => void, ms = 120): { onFrame(): void; dispose(): void } {
  let last = 0, shown = '', timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => { timer = undefined; last = performance.now(); shown = key(); bump(); };
  return {
    onFrame() {
      if (key() === shown) return;
      const wait = ms - (performance.now() - last);
      if (wait <= 0) { if (timer) { clearTimeout(timer); timer = undefined; } fire(); }
      else timer ??= setTimeout(fire, wait);
    },
    dispose() { if (timer) clearTimeout(timer); timer = undefined; },
  };
}
