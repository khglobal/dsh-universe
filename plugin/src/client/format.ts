// Numbers, times and durations for the interface; words come from the locale tables.
import type { Translate } from './types.ts';

export function fill(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  // `{n:call|calls}`: the first form when n is 1, else the second (English counts; Chinese does not use it).
  return text
    .replace(/\{(\w+):([^|{}]*)\|([^{}]*)\}/g, (m, k: string, one: string, other: string) => (k in params ? (String(params[k]) === '1' ? one : other) : m))
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** `t` that always fills {placeholders} itself (whether or not the host's bound translator does). */
export const translator = (t: (key: string) => string): Translate => (key, params) => fill(t(key), params);

export const tokens = (n: number, lang: string) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
/** Hours and minutes of t: in the viewer's time zone, or with `offset` (minutes east of UTC) in that offset's (the host's). */
export const clock = (t: number, lang: string, offset?: number) => offset === undefined
  ? new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(t))
  : new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }).format(new Date(t + offset * 60_000));
/** The time zone of an offset as the interface writes it after "UTC": "+8", "-7", "+5:30", "" for UTC itself. */
export const utcSuffix = (offset: number) => {
  if (!offset) return '';
  const a = Math.abs(offset), h = Math.floor(a / 60), m = a % 60;
  return (offset < 0 ? '-' : '+') + h + (m ? ':' + String(m).padStart(2, '0') : '');
};
/** The host's offset when it differs from the viewer's at t (the timeline then says which zone it shows), else undefined. */
export const foreignOffset = (offset: number | undefined, t: number, viewer = -new Date(t).getTimezoneOffset()) =>
  offset !== undefined && offset !== viewer ? offset : undefined;

export function duration(ms: number, t: Translate): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t('dur.s', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('dur.m', { n: m });
  // Whole hours drop the zero part ("1 h", not "1 h 0 min").
  return m % 60 ? t('dur.h', { h: Math.floor(m / 60), m: m % 60 }) : t('dur.hh', { h: m / 60 });
}
