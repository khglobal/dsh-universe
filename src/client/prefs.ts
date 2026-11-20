// Small per-device view preferences (legend open, timeline minimised, city or list). Storage that cannot be read or
// written falls back to the defaults and never throws.
import { CITY_SOURCES, LEGACY_CITY, NEIGHBOURS, PLUGIN_SLUG, SOURCES, type NeighbourId, type SourceId } from '@dsh-universe/adapter-dsh';

/** `sound`: the square's ambient sound, off by default. */
/** `toured`: the first-run tour was seen or dismissed on this device. */
/** `light`: day or night in the city and its rooms; `auto` follows the host's theme (dark is night). */
export type Light = 'auto' | 'day' | 'night';
export const LIGHTS: readonly Light[] = ['auto', 'day', 'night'];
/**
 * `neighbours`: the sources of the adjacent cities (Claude Code, the Claude app, Codex, WorkBuddy on this device) the
 * member turned off (false) or on (true). On by default: absent means on, wherever the source's store is found. Keyed
 * by source as in 0.2 (when Claude Code and Codex were cities of their own), so a choice made then carries over.
 */
export type NeighbourChoice = Partial<Record<SourceId, boolean>>;
/** `noticed`: the cities whose one-line "found" notice was shown on this device. */
export interface Prefs { legend: boolean; dockMin: boolean; view: 'city' | 'list'; sound: boolean; toured: boolean; light: Light; neighbours: NeighbourChoice; noticed: NeighbourId[] }
export const PREFS_KEY = PLUGIN_SLUG + '.view';
export const DEFAULT_PREFS: Prefs = { legend: false, dockMin: false, view: 'city', sound: false, toured: false, light: 'auto', neighbours: {}, noticed: [] };
/** Whether a source is shown: unless the member turned it off. */
export const neighbourOn = (p: Pick<Prefs, 'neighbours'>, id: SourceId): boolean => p.neighbours[id] !== false;
/** The sources the member turned off (sent with each request, so the host leaves them out). */
export const offSources = (p: Pick<Prefs, 'neighbours'>): SourceId[] => SOURCES.filter((s) => p.neighbours[s] === false);
/** The cities with a source found on this device. */
export const citiesFound = (present: readonly SourceId[]): NeighbourId[] => NEIGHBOURS.filter((c) => CITY_SOURCES[c].some((s) => present.includes(s)));
/** The cities shown: with a source found on this device and left on. */
export const citiesShown = (p: Pick<Prefs, 'neighbours'>, present: readonly SourceId[]): NeighbourId[] =>
  NEIGHBOURS.filter((c) => CITY_SOURCES[c].some((s) => present.includes(s) && neighbourOn(p, s)));

export function readPrefs(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Prefs {
  try {
    const raw = JSON.parse(storage?.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return {
      legend: typeof raw.legend === 'boolean' ? raw.legend : DEFAULT_PREFS.legend,
      dockMin: typeof raw.dockMin === 'boolean' ? raw.dockMin : DEFAULT_PREFS.dockMin,
      view: raw.view === 'list' ? 'list' : 'city',
      sound: raw.sound === true,
      toured: raw.toured === true,
      light: raw.light === 'day' || raw.light === 'night' ? raw.light : 'auto',
      neighbours: readChoice(raw.neighbours),
      // 0.2 noted its cities by source (Claude Code, Codex): those notices count for the city each one is part of.
      noticed: Array.isArray(raw.noticed) ? NEIGHBOURS.filter((k) => (raw.noticed as unknown[]).some((x) => x === k || (typeof x === 'string' && LEGACY_CITY[x] === k))) : [],
    };
  } catch { return { ...DEFAULT_PREFS }; }
}
function readChoice(v: unknown): NeighbourChoice {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: NeighbourChoice = {};
  for (const k of SOURCES) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  return out;
}
export function writePrefs(p: Prefs, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try { storage?.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* kept for this run only */ }
}

/** Whether the host shows a dark theme: its text colour is light. */
export function hostDark(el: Element | null): boolean {
  if (!el) return false;
  const m = getComputedStyle(el).color.match(/\d+(\.\d+)?/g);
  if (!m) return false;
  const [r, g, b] = m.map(Number);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
/** Night in the city: chosen, or (auto) the host's dark theme. */
export const isNight = (light: Light | undefined, dark: boolean): boolean => (light === 'night' ? true : light === 'day' ? false : dark);
/** The next state of the toolbar's day/night button: auto → day → night → auto. */
export const nextLight = (l: Light): Light => LIGHTS[(LIGHTS.indexOf(l) + 1) % LIGHTS.length];
