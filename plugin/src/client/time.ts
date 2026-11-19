// The moment the panel shows: live (the clock), a moment looked back to, or a replay of the day (model/timeline).
// Also the audio context of the optional ambient sound (sound.ts), made inside the member's click.
import { useEffect, useState } from 'react';
import { REPLAY_STEP_MS, replayAt, replayFrom, type Replay, type Store } from '@dsh-universe/model';
import type { TimeMode } from './Timeline.tsx';

export const reducedMotion = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export interface TimeState { T: number; mode: TimeMode; scrub(T: number | null): void; replay(): void }

export function useTime(live: number, store: Store | undefined, clock: () => number = () => Date.now()): TimeState {
  const [past, setPast] = useState<number | null>(null);
  const [play, setPlay] = useState<Replay | null>(null);
  const [, tick] = useState(0);
  const rm = reducedMotion();
  // While a replay runs: redraw at its pace (smooth, or one still step every 450 ms under reduced motion).
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => tick((x) => x + 1), rm ? REPLAY_STEP_MS / 3 : 66);
    return () => clearInterval(id);
  }, [play, rm]);
  let T = past ?? live, mode: TimeMode = past === null ? 'live' : 'past';
  if (play) {
    const r = replayAt(play, clock(), live, rm);
    if (r.done) queueMicrotask(() => setPlay(null));
    else { T = r.T; mode = 'replay'; }
  }
  return {
    T, mode,
    scrub: (v) => { setPlay(null); setPast(v); },
    replay: () => {
      if (play) { setPlay(null); setPast(null); return; }
      if (!store) return;
      setPast(null);
      setPlay({ startedAt: clock(), from: replayFrom(store, live) });
    },
  };
}

/** One audio context for the panel, made (or resumed) inside the member's click: browsers keep audio started
 * anywhere else suspended. */
let audio: AudioContext | null = null;
export function unlockSound(): void {
  const Ctx = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return;
  try { audio ??= new Ctx(); void audio.resume?.(); } catch { audio = null; }
}

/** The panel's audio context once the member's click made it (undefined before: nothing may play). */
export const soundContext = (): AudioContext | undefined => audio ?? undefined;
