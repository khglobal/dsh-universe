// Mock-data dev mode (`npm run dev`): the panel and the tile on a fixed sample day, no DSH needed.
// `?lang=en` for English, `?theme=dark` for a dark page. `?room=<template id>`: that room, full page, on the sample
// day's busiest floor of its kind (real sample data; nobody invented).
import { createRoot } from 'react-dom/client';
import { createSeen, createStore, FLOOR_OF, idxAt, type FloorKind } from '@dsh-universe/model';
import { ROOMS } from '@dsh-universe/art';
import { InteriorView } from '../client/Interior.tsx';
import '../client/interior-view.ts';
import { dshSample } from '../../../fixtures/dsh-sample.ts';
import { stressDay, type StressKind } from '../../../fixtures/stress.ts';
import { en, zh } from '../locales/index.ts';
import { createFeed, fixtureApi } from '../client/feed.ts';
import type { Api } from '../client/api.ts';
import { fill } from '../client/format.ts';
import { Tile } from '../client/Tile.tsx';
import { TileSkins } from './tile-skins.tsx';
import type { Env } from '../client/types.ts';
import { UniversePanel } from '../client/UniversePanel.tsx';

const q = new URLSearchParams(location.search);
const table: Record<string, string> = q.get('lang') === 'en' ? en : zh;
// `?fixed=1`: the sample day is 2026-11-18 (golden screenshots); otherwise today. `?empty=1`: a workspace with no
// sessions yet (the civic baseline only). `?panel=1`: the panel alone, full height.
const midnight = q.get('fixed') === '1' ? new Date(2026, 10, 18) : new Date(); midnight.setHours(0, 0, 0, 0);
// `?stress=one|many|ws8|errors|long|idle`: a stress day instead of the sample (fixtures/stress.ts).
const stress = q.get('stress') as StressKind | null;
const full = stress ? stressDay(midnight.getTime(), stress, q.get('lang') === 'en' ? 'en' : 'zh') : dshSample(midnight.getTime(), q.get('lang') === 'en' ? 'en' : 'zh');
// Stress views for review (mock data only): `?waits=N` puts N of the sample's own agents in the square (asked 1 to N
// minutes before the fixed moment); `?sessions=N` adds N short sessions spread over the day, every seventh waiting a
// while and every eleventh stopping on an error.
{
  const waits = Number(q.get('waits') ?? 0), extra = Number(q.get('sessions') ?? 0);
  if (waits > 0) {
    const live = full.events.filter((e): e is Extract<typeof e, { type: 'agent' }> => e.type === 'agent' && e.data.startedAt < full.now);
    live.slice(0, waits).forEach((e, i) => full.events.push({ type: 'approval', data: { id: 'dev-w' + i, agentId: e.data.id, kind: i % 3 === 0 ? 'question' : i % 3 === 1 ? 'approval' : 'plan', askedAt: full.now - (i + 1) * 60_000 } }));
  }
  const d0 = new Date(full.now); d0.setHours(7, 0, 0, 0);
  for (let i = 0; i < extra; i++) {
    const id = 'dev-s' + i, t = d0.getTime() + Math.floor((full.now - d0.getTime()) * (i / Math.max(1, extra)));
    full.events.push({ type: 'agent', data: { id, sessionId: id, workspaceId: 'def', label: '', kind: 'main', state: 'running', startedAt: t } });
    full.events.push({ type: 'turn', data: { t, agentId: id, phase: 'start' } });
    for (let k = 0; k < 6; k++) full.events.push({ type: 'activity', data: { id: id + ':' + k, t: t + k * 40_000, agentId: id, category: 'read', tool: 'read', ok: true } });
    if (i % 7 === 0) full.events.push({ type: 'approval', data: { id: id + ':w', agentId: id, kind: 'approval', askedAt: t + 60_000, decidedAt: t + 60_000 + (i % 5 + 1) * 120_000 } });
    full.events.push({ type: 'turn', data: { t: t + 9 * 60_000, agentId: id, phase: 'end', reason: i % 11 === 0 ? 'error' : 'completed' } });
  }
}
// `?engines=1`: three of the sample's sessions delegate work to Claude Code and Codex (dsh-subagent-claude-code and
// dsh-subagent-codex): the runs stand in their parent's building in the engine's colours, named after the engine.
if (q.get('engines') === '1') {
  const roots = full.events.filter((e): e is Extract<typeof e, { type: 'agent' }> => e.type === 'agent' && !e.data.parentAgentId && e.data.startedAt < full.now - 30 * 60_000).slice(0, 3);
  roots.forEach((r, i) => {
    const id = 'dev-engine-' + i, engine = i === 1 ? 'codex' as const : 'claude-code' as const;
    full.events.push({ type: 'agent', data: { id, sessionId: id, parentAgentId: r.data.id, workspaceId: r.data.workspaceId, label: '', kind: 'subagent', engine, state: 'running', startedAt: full.now - (12 + i * 5) * 60_000 } });
    full.events.push({ type: 'activity', data: { id: id + ':call', t: full.now - (12 + i * 5) * 60_000, agentId: r.data.id, category: 'delegate', tool: engine === 'codex' ? 'subagent_codex' : 'subagent_claude_code' } });
    if (i === 2) full.events.push({ type: 'agent', data: { id, endedAt: full.now - 3 * 60_000, state: 'failed' } as never });
  });
}
const fx = q.get('empty') === '1'
  ? { ...full, events: full.events.filter((e) => e.type === 'workspace' || e.type === 'connector' || e.type === 'inventory' || e.type === 'schedule'), placement: undefined }
  : full;
// `?state=loading|error|pending|memory|nosched`: the panel's quiet states (first run, host down, storage, services).
function stateApi(api: Api, state: string | null): Api {
  // Dev mode can "open" sessions (a stub, below), so the cards' open and confirm buttons show; `?open=0` hides them.
  if (q.get('open') !== '0') {
    const inner = api;
    api = { ...inner, snapshot: async () => { const r = await inner.snapshot(); if (!r.ok) return r; return { ok: true, value: { ...r.value, platform: { ...r.value.platform, caps: { ...r.value.platform.caps, actions: { openSession: true, draftFollowUp: true } } } } }; } };
  }
  if (!state) return api;
  if (state === 'loading') return { snapshot: () => new Promise(() => {}), since: () => new Promise(() => {}) };
  if (state === 'error') return { snapshot: async () => ({ ok: false, reason: 'unavailable' }), since: async () => ({ ok: false, reason: 'unavailable' }) };
  return {
    ...api,
    snapshot: async () => {
      const r = await api.snapshot();
      if (!r.ok) return r;
      const v = { ...r.value };
      if (state === 'pending') v.backfill = 'pending';
      if (state === 'memory') v.storage = 'memory';
      if (state === 'nosched') v.platform = { ...v.platform, caps: { ...v.platform.caps, schedules: false } };
      return { ok: true, value: v };
    },
  };
}
const NO_TITLES: Record<string, string> = {};
const STRESS_TITLES: Record<string, string> = Object.fromEntries(fx.events.flatMap((e) => (e.type === 'agent' && e.data.label ? [[e.data.sessionId, e.data.label]] : [])));
const env: Env = {
  t: (k, p) => fill(table[k] ?? k, p),
  lang: () => (q.get('lang') === 'en' ? 'en' : 'zh-CN'),
  feed: createFeed(stateApi(fixtureApi(fx), q.get('state'))),
  titles: stress ? { getSnapshot: () => STRESS_TITLES, subscribe: () => () => {} } : { getSnapshot: () => NO_TITLES, subscribe: () => () => {} },
  seen: createSeen({ read: () => localStorage.getItem('dshu.dev.seen'), write: (v) => localStorage.setItem('dshu.dev.seen', v) }),
  // `?clock=run`: the clock runs on from the sample's moment (what a member sees); otherwise it stays at that moment.
  now: q.get('clock') === 'run' ? ((t0) => () => fx.now + (Date.now() - t0))(Date.now()) : () => fx.now,
  // A stub: records the request (window.__dshuOpened) and flashes the page edge, so the card buttons can be tried.
  openSession: (id: string) => {
    const w = window as unknown as { __dshuOpened?: string[] };
    (w.__dshuOpened ??= []).push(id);
    console.info('[dev] openSession', id);
    document.body.animate?.([{ boxShadow: 'inset 0 0 0 4px #2F6BDE' }, { boxShadow: 'inset 0 0 0 0 #2F6BDE' }], { duration: 600 });
  },
  // `?local=1`: the Claude, ChatGPT and WorkBuddy cities present with fixed figures, so the tile's "+n local" part can be seen.
  ...(q.get('local') === '1' ? { neighbours: {
    detect: async () => ['claude-code', 'claude-app', 'codex', 'workbuddy'] as const,
    summary: async () => [{ id: 'claude', ready: true, running: 2, errors: 1, tokens: 184_000 }, { id: 'chatgpt', ready: true, running: 1, errors: 0, tokens: 52_000 }, { id: 'workbuddy', ready: true, running: 1, errors: 2, tokens: 31_000 }] as const,
    feed: () => { throw Error('dev: no neighbour feed'); }, stop: () => {},
  } } as Partial<Env> : {}),
};
if (q.get('theme') === 'dark') document.documentElement.style.cssText = 'color-scheme: dark; background: #141A30; color: #EEF7FB';
document.documentElement.lang = env.lang();
const only = q.get('panel') === '1';
if (only) {
  document.body.style.overflow = 'hidden'; document.getElementById('tiles')!.remove(); document.getElementById('panel')!.style.height = '100vh'; }
if (q.get('tiles') === 'skins') {
  document.getElementById('panel')!.remove();
  const el = document.getElementById('tiles')!; el.style.padding = '0';
  createRoot(el).render(<TileSkins render={(size, theme) => <Tile env={env} size={size} theme={theme} reducedMotion={false} />} />);
} else if (!only) createRoot(document.getElementById('tiles')!).render(
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    {[{ w: 4, h: 2 }, { w: 2, h: 2 }, { w: 4, h: 1 }].map((size) => (
      <div key={size.w + 'x' + size.h} style={{ width: size.w * 80, height: size.h * 80, border: '1px solid rgba(127,127,127,.3)', borderRadius: 12 }}>
        <Tile env={env} size={size} />
      </div>
    ))}
  </div>,
);
const room = q.get('room');
const tpl = room ? ROOMS.find((r) => r.id === room) : undefined;
if (tpl) {
  // The building of the sample day with most calls on this kind of floor shows the room with its real data.
  const store = createStore(); store.applyAll(fx.events);
  const kind = tpl.floors[0] as FloorKind, per = new Map<string, number>();
  for (const s of store.agents()) {
    let r = s; while (r.agent.parentAgentId && store.agent(r.agent.parentAgentId)) r = store.agent(r.agent.parentAgentId)!;
    const k = idxAt(s, fx.now);
    for (let i = 0; i < k; i++) if (FLOOR_OF[s.ev[i].category] === kind) per.set(r.agent.sessionId, (per.get(r.agent.sessionId) ?? 0) + 1);
  }
  const sid = [...per].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 's1';
  document.body.style.overflow = 'hidden'; document.getElementById('tiles')?.remove();
  const el = document.getElementById('panel')!; el.style.cssText = 'position: relative; height: 100vh';
  createRoot(el).render(<InteriorView placeId={'b:' + sid} store={store} placement={fx.placement!} T={fx.now} titles={NO_TITLES} t={env.t} lang={env.lang()} close={() => { location.search = ''; }}
    caps={fx.platform.caps} previewRoom={{ floor: kind, room: tpl.id }} floor={kind} />);
} else if (q.get('tiles') !== 'skins') createRoot(document.getElementById('panel')!).render(<UniversePanel env={env} />);
