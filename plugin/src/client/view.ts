// What the panel and the tile show, computed from the feed at time T. Pure (tested without React).
import {
  FLOOR_KINDS, PLACE, cumAt, floorsOf, idxAt, listGroups, stateAt, todayAt, waitAt, failedAt, whereabouts, workspaceName,
  deliverablesAt, BURN_MS, metricsAt, type LayerId, hasDraft, planModeAt, rallyAt, type AgentTrack, type Drafts, type ListGroupId, type Seen, type Store, type Today, type UCapabilities,
} from '@dsh-universe/model';
import { shortTool } from '@dsh-universe/renderer';
import { clock, duration, tokens } from './format.ts';
import type { Translate } from './types.ts';

export const CITY = 'dsh';

/** Working agents and everyone in the square (waits and error stops), the same count as the first today button. */
export function counts(store: Store, T: number): { r: number; w: number } {
  let r = 0;
  for (const s of store.agents()) if (stateAt(s, T) === 'running') r++;
  return { r, w: rallyAt(store, T).length };
}

export function headline(store: Store, T: number, t: Translate): string {
  const { r, w } = counts(store, T);
  return r && w ? t('h.rw', { r, w }) : r ? t('h.r', { r }) : w ? t('h.w', { w }) : t('h.none');
}

export interface TodayButton {
  cat: keyof Today['items']; text: string; amber: boolean; count: number;
  /** What the adjacent cities add to this figure (their own sessions, counted on top of DSH's). */
  local?: number;
  /** The figure by source, for the button's tooltip. */
  title?: string;
}

/** An adjacent city's figures now (host `n.summary`). */
export interface LocalFigures { id: string; running: number; errors: number; tokens: number }

/**
 * The DSH-wide figures with the adjacent cities added: sessions running, failed calls and tokens. DSH's own figure
 * stays first and the addition is labelled as local, with the breakdown by source in the tooltip. Nothing is
 * counted twice: a run DSH delegates to Claude Code or Codex keeps no session in their stores (and DSH counts it as a
 * subagent, not a session, with no calls or tokens of its own), so the local sessions are only those started outside
 * DSH.
 */
export function withLocal(buttons: TodayButton[], today: Today, local: readonly LocalFigures[], t: Translate, lang: string): TodayButton[] {
  const KEY = { run: 'running', err: 'errors', tok: 'tokens' } as const;
  return buttons.map((b) => {
    const k = KEY[b.cat as keyof typeof KEY];
    if (!k) return b;
    const n = local.reduce((a, x) => a + x[k], 0);
    if (!n) return b;
    const fmt = (v: number) => (k === 'tokens' ? tokens(v, lang) : String(v));
    const own = today[k];
    const parts = [{ name: t('nb.city.dsh'), v: own }, ...local.filter((x) => x[k] > 0).map((x) => ({ name: t('nb.city.' + x.id), v: x[k] }))];
    return {
      ...b, text: b.text + ' ' + t('td.local', { n: fmt(n) }), count: b.count + n, local: n,
      title: t('td.by', { total: fmt(own + n), list: parts.map((p) => t('td.part', { name: p.name, n: fmt(p.v) })).join(t('td.sep')) }),
    };
  });
}

export function todayButtons(today: Today, T: number, t: Translate, lang: string, caps?: Pick<UCapabilities, 'schedules'>): TodayButton[] {
  const nx = today.next;
  return [
    { cat: 'need', text: t('td.need', { n: today.need }), amber: true, count: today.need },
    { cat: 'sched', text: caps && !caps.schedules ? t('td.schedNa') : nx ? t('td.sched', { t: clock(nx.at, lang), d: nx.at - T < 3600_000 ? t('a.in', { d: duration(nx.at - T, t) }) : nx.title }) : t('td.nosched'), amber: false, count: today.items.sched.length },
    { cat: 'run', text: t('td.run', { n: today.running }), amber: false, count: today.running },
    { cat: 'review', text: t('td.review', { n: today.review }), amber: false, count: today.review },
    { cat: 'err', text: t('td.err', { n: today.errors }), amber: false, count: today.items.err.length },
    { cat: 'tok', text: t('td.tok', { n: tokens(today.tokens, lang) }), amber: false, count: today.items.tok.length },
  ];
}

export interface Row {
  id: string; sessionId: string; title: string; sub: boolean; state: string; stateText: string;
  context: string; detail: string; tokens: string; duration: string; review: boolean; waiting: boolean;
}

/** A place name for "where" text. */
export function placeName(id: string, t: Translate, store: Store): string {
  if (id === PLACE.town) return t('pl.town');
  if (id === PLACE.station) return t('pl.station');
  if (id === PLACE.school) return t('pl.school');
  if (id === PLACE.library) return t('pl.library');
  if (id === PLACE.fire) return t('pl.fire');
  if (id.startsWith('conn:')) { const c = store.connectors().find((x) => x.id === id.slice(5)); return t('pl.conn', { n: c?.title ?? id.slice(5) }); }
  if (id.startsWith('model:')) return t('pl.power', { n: id.slice(6) });
  return t('pl.home');
}

const floorName = (id: string, t: Translate) => {
  const k = 'fl.' + id;
  const v = t(k);
  return v === k ? id : v;
};

export function titleOf(s: AgentTrack, store: Store, titles: Record<string, string>, t: Translate): string {
  // A subagent's session title is its prompt (DSH titles it from the task text): content, never shown. Its preset or
  // type name if it has one, else "Subagent n" in start order under its parent.
  if (s.agent.parentAgentId) {
    // A run delegated to an outside engine (Claude Code, Codex) is named after the engine; its task never is.
    if (s.agent.engine && store.agent(s.agent.parentAgentId)?.agent.engine !== s.agent.engine) return t('eng.' + s.agent.engine);
    if (s.agent.role) return s.agent.role;
    const sibs = store.agents().filter((x) => x.agent.parentAgentId === s.agent.parentAgentId).sort((a, b) => a.agent.startedAt - b.agent.startedAt || a.agent.id.localeCompare(b.agent.id));
    return t('row.subN', { n: sibs.findIndex((x) => x.agent.id === s.agent.id) + 1 });
  }
  const own = titles[s.agent.sessionId] || s.agent.label;
  if (own) return own;
  const ws = store.workspaces().find((w) => w.id === s.agent.workspaceId);
  // A session of a neighbouring city without a title its member set: the project folder and the day.
  if (s.agent.engine) {
    const d = new Date(s.agent.startedAt), p2 = (x: number) => String(x).padStart(2, '0');
    return t('row.neutral', { folder: ws ? workspaceName(ws.displayPath || ws.title, t('ws.default')) : t('ws.default'), date: `${p2(d.getMonth() + 1)}-${p2(d.getDate())}` });
  }
  return t('row.untitled', { folder: ws ? workspaceName(ws.displayPath || ws.title, t('ws.default')) : '', id: s.agent.sessionId.slice(0, 4) });
}

export function rowOf(s: AgentTrack, store: Store, T: number, t: Translate, lang: string, titles: Record<string, string>, review: boolean, drafts?: Drafts): Row {
  const st = stateAt(s, T);
  const ws = store.workspaces().find((w) => w.id === s.agent.workspaceId);
  const kids = store.agents().filter((k) => k.agent.parentAgentId === s.agent.id && k.agent.startedAt <= T).length;
  // A neighbouring city's session says which product it is from (Claude Code or the Claude app in the Claude city).
  const source = s.agent.engine && !s.agent.parentAgentId ? t('eng.' + s.agent.engine) : '';
  const ctx = [source, ws ? workspaceName(ws.title, t('ws.default')) : '', s.agent.parentAgentId ? t('row.sub') : '', kids ? t('row.subs', { n: kids }) : ''].filter(Boolean).join(' · ');
  let detail = '';
  const w = waitAt(s, T);
  if (st === 'waiting' && w) {
    // The wait time first, so a short plate still says how long.
    detail = t('wait.for', { d: duration(T - w.askedAt, t) }) + ' · ' + (w.kind === 'question' ? t('wait.question') : w.kind === 'plan' ? t('wait.plan') : w.tool ? t('wait.approval', { tool: shortTool(w.tool) }) : t('wait.approvalAny'));
  } else if (st === 'failed') {
    const f = failedAt(s, T);
    detail = f !== undefined ? t('fail.square', { d: duration(T - f, t) }) : t('st.failed');
  } else if (st === 'running') {
    const where = whereabouts(store, s, T);
    const k = idxAt(s, T);
    const tool = k ? s.ev[k - 1].tool : '';
    detail = [where ? placeName(where.place, t, store) + ' · ' + floorName(where.floor, t) : '', tool].filter(Boolean).join(' · ');
  } else {
    detail = t('row.calls', { n: idxAt(s, T) });
  }
  // Plan mode (dsh-plan-mode): the session is planning before it works.
  if (planModeAt(s, T) && (st === 'running' || st === 'waiting')) detail = [t('row.plan'), detail].filter(Boolean).join(' · ');
  if (review) {
    // Option C: deliverables are an extra marker, a draft another one.
    const out = deliverablesAt(s, T);
    detail = [detail, out ? t('row.out', { n: out }) : '', hasDraft(s, drafts) ? t('row.draft') : ''].filter(Boolean).join(' · ');
  }
  const endT = s.agent.endedAt ?? (st === 'running' || st === 'waiting' ? T : lastActivity(s, T));
  return {
    id: s.agent.id, sessionId: s.agent.sessionId, title: titleOf(s, store, titles, t), sub: !!s.agent.parentAgentId,
    state: st, stateText: t('st.' + st), context: ctx, detail,
    // A delegated engine run reports no token use to DSH: said so, rather than a zero.
    tokens: s.agent.engine && s.agent.parentAgentId && !s.usage.length ? t('row.tokNa') : t('row.tok', { n: tokens(cumAt(s, T), lang) }),
    duration: duration(Math.max(0, endT - s.agent.startedAt), t), review, waiting: st === 'waiting',
  };
}

function lastActivity(s: AgentTrack, T: number): number {
  let last = s.agent.startedAt;
  const k = idxAt(s, T);
  if (k) last = Math.max(last, s.ev[k - 1].t);
  for (const x of s.turns) if (x.t <= T) last = Math.max(last, x.t);
  return last;
}

export interface Section { id: ListGroupId; title: string; rows: Row[] }

export function sections(store: Store, T: number, t: Translate, lang: string, titles: Record<string, string>, seen?: Seen, drafts?: Drafts, from?: number): Section[] {
  const key: Record<ListGroupId, string> = { need: 'li.need', review: 'li.review', running: 'li.running', failed: 'li.failed', idle: 'li.idle', done: 'li.done' };
  return listGroups(store, T, CITY, seen, drafts, from).map((g) => ({ id: g.id, title: t(key[g.id]), rows: g.rows.map((s) => rowOf(s, store, T, t, lang, titles, g.id === 'review', drafts)) }));
}

export interface PlaceRow { id: string; name: string; floors: string; inside: number }

/** Every public building with its floors' numbers (the list's "all places" part). */
export function places(store: Store, T: number, t: Translate, lang: string, caps: UCapabilities): PlaceRow[] {
  const ids: string[] = [PLACE.town, PLACE.station, PLACE.school, PLACE.library, PLACE.fire];
  for (const c of store.connectors()) ids.push('conn:' + c.id);
  const models = new Set<string>();
  for (const s of store.agents()) for (const u of s.usage) if (u.t <= T && u.model) models.add(u.model);
  for (const m of [...models].sort()) ids.push('model:' + m);
  return ids.map((id) => {
    const fl = floorsOf(store, id, T, caps);
    return {
      id, name: placeName(id, t, store),
      floors: fl.map((f) => floorName(f.id, t) + ' ' + (f.na ? t('na') : f.unit === 'tokens' ? tokens(f.n, lang) : f.unit === 'ms' ? duration(f.n, t) : String(f.n))).join(' · '),
      inside: fl.reduce((a, f) => a + f.agents.length, 0),
    };
  });
}

export { FLOOR_KINDS, todayAt };

/**
 * What a data view shows, in one sentence for screen readers (the city itself is a canvas): counts only, no titles.
 * Announced politely when the layer changes.
 */
export function layerSummary(layer: LayerId, store: Store, T: number, t: Translate, lang: string, seen?: Seen, drafts?: Drafts): string {
  if (layer === 'all') return '';
  const roots = store.agents().filter((s) => !s.agent.parentAgentId && s.agent.startedAt <= T);
  switch (layer) {
    case 'scheduled': {
      const n = roots.filter((s) => s.agent.kind === 'scheduled' || s.agent.scheduleId).length;
      const next = todayAt(store, T, CITY, seen, drafts).next;
      return t('ls.scheduled', { n, next: next ? clock(next.at, lang) : '—' });
    }
    case 'running': return t('ls.running', { n: roots.filter((s) => stateAt(s, T) === 'running').length });
    case 'review': return t('ls.review', { n: todayAt(store, T, CITY, seen, drafts).review });
    case 'errors': {
      const m = metricsAt(store, T);
      let places = 0, burning = 0, retries = 0;
      for (const [id, p] of m.places) if (p.errors && id !== PLACE.fire) { places++; if (T - (p.lastErrorAt ?? 0) < BURN_MS) burning++; }
      for (const s of store.agents()) for (const r of s.retries) if (r.t <= T) retries++;
      return t('ls.errors', { n: m.errors, p: places, b: burning, r: retries });
    }
    case 'tokens': {
      const m = metricsAt(store, T);
      let hot = 0;
      for (const [id, p] of m.places) if (id.startsWith('b:') && p.tokens5 > 0) hot++;
      return t('ls.tokens', { n: tokens(m.tokens, lang), h: hot });
    }
    case 'calls': { const m = metricsAt(store, T); return t('ls.calls', { n: m.calls5, c: m.cars }); }
  }
  return '';
}
