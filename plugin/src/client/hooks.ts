import { useEffect, useState, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';
import type { Feed, FeedState } from './feed.ts';
import type { Observable } from './types.ts';

export const useFeed = (feed: Feed): FeedState => useSyncExternalStore(feed.subscribe, feed.get, feed.get);
export const useObservable = <T,>(o: Observable<T>): T => useSyncExternalStore(o.subscribe, o.getSnapshot, o.getSnapshot);

/** The clock, once a second while mounted (the text of waits and durations follows it; nothing is animated). */
export function useNow(now: () => number): number {
  const [t, setT] = useState(now);
  useEffect(() => { const id = setInterval(() => setT(now()), 1000); return () => clearInterval(id); }, [now]);
  return t;
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
