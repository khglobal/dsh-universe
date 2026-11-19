// Small per-device view preferences (legend open, timeline minimised, city or list). Storage that cannot be read or
// written falls back to the defaults and never throws.
import { PLUGIN_SLUG } from '@dsh-universe/adapter-dsh';

/** `sound`: the square's ambient sound, off by default. */
/** `toured`: the first-run tour was seen or dismissed on this device. */
/** `light`: day or night in the city and its rooms; `auto` follows the host's theme (dark is night). */
export type Light = 'auto' | 'day' | 'night';
export const LIGHTS: readonly Light[] = ['auto', 'day', 'night'];
/**
 * `neighbours`: the adjacent cities (Claude Code, Codex on this device) the member turned off (false) or on (true).
 * On by default: absent means on, wherever the tool's store is found.
 */
export type NeighbourChoice = Partial<Record<'claude-code' | 'codex', boolean>>;
/** `noticed`: the tools whose one-line "found" notice was shown on this device. */
export interface Prefs { legend: boolean; dockMin: boolean; view: 'city' | 'list'; sound: boolean; toured: boolean; light: Light; neighbours: NeighbourChoice; noticed: ('claude-code' | 'codex')[] }
export const PREFS_KEY = PLUGIN_SLUG + '.view';
export const DEFAULT_PREFS: Prefs = { legend: false, dockMin: false, view: 'city', sound: false, toured: false, light: 'auto', neighbours: {}, noticed: [] };
/** Whether an adjacent city is shown: unless the member turned it off. */
export const neighbourOn = (p: Pick<Prefs, 'neighbours'>, id: 'claude-code' | 'codex'): boolean => p.neighbours[id] !== false;

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
      noticed: Array.isArray(raw.noticed) ? (['claude-code', 'codex'] as const).filter((k) => (raw.noticed as unknown[]).includes(k)) : [],
    };
  } catch { return { ...DEFAULT_PREFS }; }
}
function readChoice(v: unknown): NeighbourChoice {
  const r = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const out: NeighbourChoice = {};
  for (const k of ['claude-code', 'codex'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
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
