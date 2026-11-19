// The city's ambient sound (the toolbar's Sound switch, off by default). One audio graph for the panel: each city has
// its own bus (its own pitch, so a move between cities is heard), all buses into one master gain. Only the city in view
// plays; moving to another city crossfades the buses. In the cities-around view the cities are heard from a distance:
// all of them quietly, the one whose card has focus brought forward.
//
// Each city's sound follows its own activity:
// - a low murmur, louder the more sessions run (silent when nothing runs);
// - traffic: soft ticks, more of them the more calls in the last five minutes;
// - errors: a soft falling two-note sign while calls failed in the last half hour;
// - waits: two low notes every 2.4 s while someone waits in the square, higher the more are waiting.
//
// Nothing plays before the member's click (the audio context is made inside it), with the switch off, while looking
// back or replaying, under reduced motion, or while the page is hidden.
import { useEffect, useRef } from 'react';
import type { Store } from '@dsh-universe/model';
import { reducedMotion, soundContext } from './time.ts';

export interface CityLevels { running: number; errors: number; traffic: number; waiting: number }
export const QUIET: CityLevels = { running: 0, errors: 0, traffic: 0, waiting: 0 };

/** The part of the Web Audio API used here (a fake one in tests). */
export interface AudioParamLike { value: number; setValueAtTime(v: number, t: number): unknown; setTargetAtTime(v: number, t: number, c: number): unknown; exponentialRampToValueAtTime(v: number, t: number): unknown }
export interface NodeLike { connect<T>(n: T): T; disconnect?(): void }
export interface GainLike extends NodeLike { gain: AudioParamLike }
export interface OscLike extends NodeLike { type: string; frequency: AudioParamLike; detune?: AudioParamLike; start(t?: number): void; stop(t?: number): void }
export interface FilterLike extends NodeLike { type: string; frequency: AudioParamLike }
export interface AudioLike {
  currentTime: number; state: string; destination: NodeLike;
  createGain(): GainLike; createOscillator(): OscLike; createBiquadFilter(): FilterLike;
}

/** The pitch of each city's bus (Hz): DSH, then the neighbours. */
export const CITY_PITCH: Record<string, number> = { dsh: 170, claude: 150, chatgpt: 190, workbuddy: 210 };
/** Crossfade between cities, in seconds. */
export const FADE_S = 0.8;
const MASTER = 0.9;

interface Bus { base: number; gain: GainLike; murmur: GainLike; oscs: OscLike[]; levels: CityLevels; mix: number; nextErr: number; nextWait: number }

export interface Ambience {
  /** Each city's activity and how loud it should be (0 silent, 1 full); cities left out fade to silence. */
  set(levels: Record<string, CityLevels>, mix: Record<string, number>): void;
  /** One step (every 250 ms) of the event layers: traffic ticks, error and wait signs. */
  step(): void;
  /** The buses made so far, by city (for tests). */
  buses(): string[];
  /** Fades out and stops everything. */
  stop(): void;
}

export function createAmbience(a: AudioLike, rand: () => number = Math.random): Ambience {
  const master = a.createGain();
  master.gain.setValueAtTime(0, a.currentTime);
  master.gain.setTargetAtTime(MASTER, a.currentTime, FADE_S / 3);
  master.connect(a.destination);
  const buses = new Map<string, Bus>();
  let stopped = false;

  const bus = (id: string): Bus => {
    let b = buses.get(id);
    if (b) return b;
    const base = CITY_PITCH[id] ?? 180;
    const gain = a.createGain();
    gain.gain.setValueAtTime(0, a.currentTime);
    gain.connect(master);
    // The murmur: two slightly detuned low triangles through a low-pass, always running, its level following the
    // sessions running.
    const lp = a.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420;
    const murmur = a.createGain();
    murmur.gain.setValueAtTime(0, a.currentTime);
    lp.connect(murmur).connect(gain);
    const oscs = [base / 2, base / 2 * 1.006, base * 0.75].map((f) => {
      const o = a.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      o.connect(lp); o.start();
      return o;
    });
    b = { base, gain, murmur, oscs, levels: QUIET, mix: 0, nextErr: 0, nextWait: 0 };
    buses.set(id, b);
    return b;
  };
  const blip = (b: Bus, f: number, type: string, peak: number, len: number, at = a.currentTime) => {
    const o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(b.gain); o.start(at); o.stop(at + len);
  };

  return {
    set(levels, mix) {
      if (stopped) return;
      const now = a.currentTime;
      for (const id of new Set([...Object.keys(levels), ...Object.keys(mix), ...buses.keys()])) {
        const m = Math.max(0, Math.min(1, mix[id] ?? 0));
        if (!buses.has(id) && m === 0) continue;
        const b = bus(id);
        b.levels = levels[id] ?? b.levels;
        if (m !== b.mix) { b.mix = m; b.gain.gain.setTargetAtTime(m, now, FADE_S / 3); }
        const r = b.levels.running;
        b.murmur.gain.setTargetAtTime(r > 0 ? Math.min(0.02, 0.006 + r * 0.002) : 0, now, 0.5);
      }
    },
    step() {
      if (stopped) return;
      const now = a.currentTime;
      for (const b of buses.values()) {
        if (b.mix < 0.01) continue;
        const base = b.base;
        const { traffic, errors, waiting } = b.levels;
        // Traffic: up to about two ticks a second at 40 calls in five minutes (one step is 250 ms).
        if (traffic > 0 && rand() < Math.min(0.5, traffic / 80)) blip(b, base * (5 + rand() * 3), 'sine', 0.004, 0.06);
        if (errors > 0 && now >= b.nextErr) {
          const v = 0.004 + Math.min(1, errors / 5) * 0.004;
          blip(b, base * 2, 'sine', v, 0.3, now); blip(b, base * 1.5, 'sine', v, 0.4, now + 0.28);
          b.nextErr = now + 6;
        }
        if (waiting > 0 && now >= b.nextWait) {
          blip(b, base + waiting * 12, 'square', 0.015, 0.22, now); blip(b, base + 35 + waiting * 12, 'square', 0.015, 0.22, now + 0.24);
          b.nextWait = now + 2.4;
        }
      }
    },
    buses: () => [...buses.keys()],
    stop() {
      if (stopped) return;
      stopped = true;
      const now = a.currentTime;
      master.gain.setTargetAtTime(0, now, FADE_S / 4);
      for (const b of buses.values()) for (const o of b.oscs) { try { o.stop(now + FADE_S * 2); } catch { /* stopped */ } }
      setTimeout(() => { try { master.disconnect?.(); } catch { /* gone */ } }, FADE_S * 2000 + 100);
    },
  };
}

/** A city's activity at `T`: sessions running, calls failed in the last 30 minutes, calls in the last five. */
export function levelsOf(store: Store, T: number, running: number, waiting: number): CityLevels {
  let errors = 0, traffic = 0;
  for (const s of store.agents()) for (const e of s.ev) {
    if (e.t > T || e.t < T - 30 * 60_000) continue;
    if (e.ok === false) errors++;
    if (e.t >= T - 5 * 60_000) traffic++;
  }
  return { running, errors, traffic, waiting };
}

/**
 * The panel's ambience: plays while `on` and live, the mix given (city → loudness), with each city's activity.
 * Waits for the audio context the member's click makes; stops on reduced motion and while the page is hidden.
 */
let suspendTimer: ReturnType<typeof setTimeout> | undefined;
export function useAmbience(on: boolean, live: boolean, levels: Record<string, CityLevels>, mix: Record<string, number>): void {
  const amb = useRef<Ambience | null>(null);
  const cur = useRef({ levels, mix });
  cur.current = { levels, mix };
  const active = on && live && !reducedMotion();
  useEffect(() => {
    if (!active) return;
    if (suspendTimer) { clearTimeout(suspendTimer); suspendTimer = undefined; }
    const apply = () => {
      const a = soundContext();
      // Suspended when the sound last stopped: it resumes now (the member's earlier gesture still counts).
      if (a && a.state === 'suspended') void a.resume?.().catch?.(() => undefined);
      if (!a || a.state !== 'running') return;
      amb.current ??= createAmbience(a as unknown as AudioLike);
      const hidden = globalThis.document?.visibilityState === 'hidden';
      amb.current.set(cur.current.levels, hidden ? {} : cur.current.mix);
      if (!hidden) amb.current.step();
    };
    const id = setInterval(apply, 250);
    apply();
    return () => {
      clearInterval(id); amb.current?.stop(); amb.current = null;
      // Nothing plays any more: the audio context is suspended after the fade-out (it costs nothing then).
      const a = soundContext();
      suspendTimer = setTimeout(() => { if (a && a.state === 'running' && !amb.current) void a.suspend?.().catch?.(() => undefined); }, FADE_S * 2000 + 200);
    };
  }, [active]);
  // A move between cities, or new figures: the mix follows at once (the crossfade is in the graph).
  useEffect(() => { amb.current?.set(levels, mix); }, [JSON.stringify(levels), JSON.stringify(mix)]);
}
