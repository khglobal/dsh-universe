// What the inside view writes about a floor (pure; tested without React). Text only from the locale tables.
import type { InteriorFloor } from '@dsh-universe/renderer';
import { clock, duration, tokens } from './format.ts';
import type { Translate } from './types.ts';

/** Places with an inside: every building with floors. Plugin shops are one-room houses with nothing inside. */
export const interiorMatches = (placeId: string): boolean => placeId !== '' && !placeId.startsWith('shop:');

/** A floor's name: its meaning, then (for a template room) the room's name, e.g. "Library · Market desk". */
export function floorLabel(f: InteriorFloor, t: Translate): string {
  const k = 'fl.' + f.id, name = t(k) === k ? f.id.replace(/^mcp__[^_]+__/, '') : t(k);
  const room = f.template ? t('rm.' + f.room) : '';
  // A room named like its floor (the machine room on the machine floor) is named once.
  return room && room !== name ? t('in.room', { f: name, r: room }) : name;
}
/** A floor's number as the list shows it. */
export function floorValue(f: InteriorFloor, t: Translate, lang: string): string {
  if (f.na) return t('na');
  return f.unit === 'tokens' ? tokens(f.n, lang) : f.unit === 'ms' ? duration(f.n, t) : String(f.n);
}

/** The data props of a room and what each card says: the same numbers the prop draws, metadata only. */
export const PROP_IDS = [
  'tape', 'board', 'beacon', 'printers', 'whiteboard', 'crates', 'reception', 'racks', 'solar',
  'menu', 'departures', 'webtally', 'turnstiles', 'blackboard', 'portraits', 'books', 'cartridges', 'load', 'meter', 'dial', 'repairlog', 'engine',
] as const;
export type PropId = (typeof PROP_IDS)[number];

/** The last calls of a floor as card lines (time · tool · ok or failed). */
const callLines = (f: InteriorFloor, t: Translate, lang: string, n: number): string[] =>
  f.calls.slice(0, n).map((c) => t('in.call', { t: clock(c.t, lang), tool: c.tool.replace(/^mcp__[^_]+__/, ''), r: t(c.ok ? 'in.call.ok' : 'in.call.fail') }));

export function propLines(id: PropId, f: InteriorFloor, t: Translate, lang: string, extra: { rate?: number } = {}): string[] {
  if (f.na && id !== 'books' && id !== 'cartridges') return [t('na')];
  switch (id) {
    case 'crates': return [t('in.p.out', { n: f.out ?? 0 })];
    case 'reception': return [t('in.people', { n: f.people.length })];
    case 'racks': {
      const y = f.tally ?? { yes: 0, no: 0, open: f.n };
      // Questions are answered, not approved or denied (the Review Centre's Enquiries floor).
      if (f.id === 'question') return [t('in.p.answered', { n: y.yes + y.no }), t('in.p.open', { n: y.open })];
      return [t('in.p.yes', { n: y.yes }), t('in.p.no', { n: y.no }), t('in.p.open', { n: y.open })];
    }
    case 'solar': case 'meter': return [t('in.p.tokens', { n: tokens(f.n, lang) })];
    case 'load': return [t('in.p.rate', { n: tokens(extra.rate ?? 0, lang) })];
    case 'menu': return [t('in.p.calls', { n: f.n }), ...callLines(f, t, lang, 5)];
    case 'departures': return [t('in.p.runs', { n: f.n })];
    case 'webtally': return [t('in.p.web', { n: f.n }), ...callLines(f, t, lang, 4)];
    case 'turnstiles': return [t('in.recent', { n: f.recent.length }), ...callLines(f, t, lang, 4)];
    case 'blackboard': return [t('in.p.skills', { n: f.n })];
    case 'portraits': return [t('in.p.experts', { n: f.n })];
    case 'books': return [t('in.p.installed', { n: f.stock?.skills ?? 0 })];
    case 'cartridges': return [t('in.p.plugins', { n: f.stock?.plugins ?? 0, on: f.stock?.on ?? 0 })];
    case 'dial': return [t('in.p.avg', { d: duration(f.n, t) })];
    case 'repairlog': {
      if (f.id === 'retry') return [t('ov.retries', { n: f.n })]; const l = [t('in.p.failed', { n: f.n })]; if (f.lastError !== undefined) l.push(t('in.err.last', { t: clock(f.lastError, lang) })); return [...l, ...callLines(f, t, lang, 4)]; }
    case 'engine': return [t('in.recentErr', { n: f.recent.length })];
    default: break;
  }
  if (id === 'tape' || id === 'board') {
    if (!f.calls.length) return [t('in.nocalls')];
    return f.calls.slice(0, id === 'tape' ? 8 : 6).map((c) => t('in.call', { t: clock(c.t, lang), tool: c.tool.replace(/^mcp__[^_]+__/, ''), r: t(c.ok ? 'in.call.ok' : 'in.call.fail') }));
  }
  if (id === 'beacon') {
    const lines = [f.errors ? t('in.err.today', { n: f.errors }) : t('in.err.none')];
    if (f.lastError !== undefined) lines.push(t('in.err.last', { t: clock(f.lastError, lang) }));
    lines.push(t('in.recentErr', { n: f.recent.filter((r) => r.err).length }));
    return lines;
  }
  if (id === 'printers') {
    const j = f.jobsToday ?? { running: f.jobs ?? 0, done: 0 };
    return [t('in.jobs.running', { n: j.running }), t('in.jobs.done', { n: j.done })];
  }
  const lines = Math.min(6, f.n ? 1 + Math.floor(Math.log2(f.n + 1)) : 0);
  return [t('in.wb', { n: f.n, l: lines })];
}

/** The room in one sentence for screen readers (e.g. "Library · Market desk · 3 agents working · 1 failure in the last minute"). */
export function roomSummary(f: InteriorFloor, t: Translate): string {
  return t('in.summary', { room: floorLabel(f, t), n: f.people.filter((p) => p.state === 'running').length, e: f.recent.filter((r) => r.err).length });
}
