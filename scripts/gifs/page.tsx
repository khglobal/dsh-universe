// The page the README GIFs are recorded from (scripts/readme-gifs.mjs): the real panel on the English sample day
// (fixtures/dsh-sample.ts), but live. The clock runs on from the sample's moment and a short scripted stretch of
// made-up work arrives through the panel's own feed as time passes: a new session going up, agents asking for a
// review, a failed call, a scheduled run coming in by train. Mock data only; nothing real, nothing leaves the page.
// `?scene=city|indoor` picks the script.
import { createRoot } from 'react-dom/client';
import { cityTemplate, createSeen, freezeTheme, place, themeFromTitle, type UEvent } from '@dsh-universe/model';
import { dshSample } from '../../fixtures/dsh-sample.ts';
import { en } from '../../plugin/src/locales/index.ts';
import { createFeed } from '../../plugin/src/client/feed.ts';
import type { Api } from '../../plugin/src/client/api.ts';
import { fill } from '../../plugin/src/client/format.ts';
import type { Env } from '../../plugin/src/client/types.ts';
import { UniversePanel } from '../../plugin/src/client/UniversePanel.tsx';
import '../../plugin/src/client/interior-view.ts';

const q = new URLSearchParams(location.search);
const scene = q.get('scene') === 'indoor' ? 'indoor' : 'city';
const midnight = new Date(2026, 10, 18); midnight.setHours(0, 0, 0, 0);
const fx = dshSample(midnight.getTime(), 'en');
const NOW = fx.now;
// The page's own clock (Playwright's fake clock while recording): the data moves on in real time from NOW.
const born = performance.now();
const now = () => NOW + (performance.now() - born);
// `?lead=<s>`: the recording starts that many seconds after NOW (the page warms up first); the script counts from there.
const lead = Number(q.get('lead') ?? 0);
const S = (s: number) => NOW + Math.round((lead + s) * 1000);

/** The scripted stretch: events in time order, each with the moment it reaches the panel. */
const later: UEvent[] = [];
const push = (e: UEvent) => later.push(e);
let callN = 0;
const call = (agentId: string, t: number, category: string, tool: string, ok = true, tokens = 1400) => {
  const id = 'g:' + agentId + ':' + callN++;
  push({ type: 'activity', data: { id, t, agentId, category, tool, ok, durationMs: 600, ...(category === 'connector' ? { connectorId: 'erp' } : {}) } } as UEvent);
  push({ type: 'usage', data: { id, t, agentId, model: 'deepseek-v4-pro', input: Math.round(tokens * 0.8), output: Math.round(tokens * 0.2) } } as UEvent);
};
const start = (id: string, ws: string, title: string, t: number, extra: Record<string, unknown> = {}) => {
  push({ type: 'agent', data: { id, sessionId: id, workspaceId: ws, label: title, kind: 'main', model: 'deepseek-v4-pro', state: 'running', startedAt: t, ...extra } } as UEvent);
  push({ type: 'turn', data: { t, agentId: id, phase: 'start' } } as UEvent);
};
const roots: { sessionId: string; workspaceId: string; startedAt: number; title: string }[] = [];

if (scene === 'city') {
  // A new session breaks ground and grows a floor for each kind of work it does; one of its calls fails.
  roots.push({ sessionId: 'g1', workspaceId: 'sal', startedAt: S(0.3), title: 'Weekly sales report' });
  start('g1', 'sal', 'Weekly sales report', S(0.3));
  const kinds: [string, string][] = [['read', 'read'], ['search', 'grep'], ['read', 'read'], ['web', 'web_search'], ['edit', 'edit'], ['search', 'glob'], ['exec', 'bash'], ['edit', 'write'], ['read', 'read']];
  for (let i = 0; i < 48; i++) { const [c, tool] = kinds[i % kinds.length]; call('g1', S(0.6 + i * 0.13), c, tool, true, 2600); }
  call('g1', S(4.0), 'exec', 'bash', false);
  call('g1', S(4.3), 'exec', 'bash', false);
  push({ type: 'retry', data: { id: 'g:r1', t: S(4.4), agentId: 'g1', attempt: 1, delayMs: 2000 } } as UEvent);
  // Agents stop to ask: an approval and a question send two of them walking to Review Square.
  push({ type: 'approval', data: { id: 'g:w1', agentId: 's4', kind: 'approval', askedAt: S(0.6), tool: 'mcp__erp__execute_write' } } as UEvent);
  push({ type: 'approval', data: { id: 'g:w2', agentId: 's1b', kind: 'question', askedAt: S(1.6) } } as UEvent);
  push({ type: 'approval', data: { id: 'g:w3', agentId: 's7c', kind: 'plan', askedAt: S(2.6) } } as UEvent);
  // Busy roads: a burst of calls from the running sessions.
  for (let i = 0; i < 40; i++) { const a = ['s1', 's7', 's7b', 's2', 's1b'][i % 5], erp = i % 3 === 0 && a !== 's7' && a !== 's7b'; call(a, S(i * 0.22), erp ? 'connector' : 'read', erp ? 'mcp__erp__execute_read' : 'read'); }
} else {
  // Indoors (the bid tender building: a lead agent and three subagents). Subagent 2 keeps reading in the library; the
  // lead reads there, then goes down to the workshop to edit, then stops to ask the member a question (and leaves for
  // Review Square). Subagent 3's print job is running.
  push({ type: 'job', data: { id: 'g:j1', agentId: 's7c', kind: 'bash', startedAt: S(-1) } } as UEvent);
  for (let k = 0; k * 0.5 < 11; k++) {
    const x = -1 + k * 0.5;
    call('s7b', S(x), k % 3 ? 'read' : 'search', k % 3 ? 'read' : 'grep');
    if (x < 7.6) call('s7', S(x + 0.2), x < 4.6 ? (k % 2 ? 'read' : 'search') : 'edit', x < 4.6 ? (k % 2 ? 'read' : 'grep') : k % 2 ? 'edit' : 'write');
    call('s7c', S(x + 0.35), 'edit', k % 2 ? 'edit' : 'write');
  }
  call('s7b', S(3.1), 'exec', 'bash', false);
  push({ type: 'approval', data: { id: 'g:w1', agentId: 's7', kind: 'question', askedAt: S(7.8) } } as UEvent);
}

// The placement the host would keep, with the scripted sessions' lots (each still an empty site until it starts).
let placement = fx.placement!;
if (roots.length) {
  const sizes = placement.sizes;
  placement = place(cityTemplate(), placement, roots).state;
  for (const r of roots) placement = freezeTheme(placement, r.sessionId, themeFromTitle(r.title));
  placement.sizes = sizes;
}

/** The host's routes answered from memory: the sample day at once, then the script as its moments come. */
const tOf = (e: UEvent): number => {
  const d = e.data as { t?: number; startedAt?: number; askedAt?: number };
  return d.t ?? d.askedAt ?? d.startedAt ?? 0;
};
later.sort((a, b) => tOf(a) - tOf(b));
const base = fx.events.map((e, i) => ({ seq: i + 1, e }));
const rest = later.map((e, i) => ({ seq: base.length + i + 1, e }));
const upTo = () => base.length + rest.filter((x) => tOf(x.e) <= now()).length;
const api: Api = {
  snapshot: async () => ({ ok: true, value: { platform: { ...fx.platform, caps: { ...fx.platform.caps, actions: { openSession: true, draftFollowUp: true } } }, day: fx.day, seq: base.length, events: base, truncated: false, full: false, placement, placementVersion: 1, history: [], backfill: 'done' } }),
  since: async (seq) => {
    const n = upTo();
    return { ok: true, value: { day: fx.day, seq: Math.max(seq, n), events: rest.filter((x) => x.seq > seq && x.seq <= n), more: false, placementVersion: 1 } };
  },
};

const table: Record<string, string> = en;
const NO_TITLES: Record<string, string> = {};
const env: Env = {
  t: (k, p) => fill(table[k] ?? k, p),
  lang: () => 'en',
  feed: createFeed(api, { intervalMs: 250 }),
  titles: { getSnapshot: () => NO_TITLES, subscribe: () => () => {} },
  seen: createSeen({ read: () => null, write: () => {} }),
  now,
  openSession: () => {},
};
document.documentElement.lang = 'en';
document.body.style.cssText = 'margin:0;overflow:hidden;font:14px/1.5 system-ui, sans-serif';
const el = document.createElement('div'); el.style.height = '100vh'; document.body.append(el);
createRoot(el).render(<UniversePanel env={env} />);
