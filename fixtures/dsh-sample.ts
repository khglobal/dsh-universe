// Mock data for dev mode and tests: a sample DSH city as model events.
// Seeded, so every run gives the same day. Tool names are the real DSH 0.2.2-rc.2 names. Titles are sample session
// titles (data, not interface text), in Chinese and English: `dshSample(midnight, 'en')` gives the same day with
// English titles. Each English title lands on the same room theme as its Chinese one (fixtures test), so the city
// looks the same in both languages.
import type { Fixture } from '@dsh-universe/adapter-kit';
import { cityTemplate, emptyPlacement, freezeTheme, hs, place, rng, themeFromTitle, type PlacementState } from '@dsh-universe/model';
import type { Category, UEvent } from '@dsh-universe/model';

const HM = (s: string) => { const [h, m, sec] = s.split(':').map(Number); return (h * 3600 + m * 60 + (sec || 0)) * 1000; };
const NOW = HM('15:44:46');

type Kind = 'read' | 'search' | 'edit' | 'exec' | 'web' | 'conn' | 'task' | 'skill';
interface Ses {
  id: string; ws: string; title: Text; start: number; end?: number; final?: 'done' | 'failed'; idleFrom?: number;
  parent?: string; origin?: string; preset?: string; conn?: string; model: string; out?: number;
  waits?: [number, number | null, 'appr' | 'ask', string | null, string?][]; jobs?: [number, number | null][];
  w: Partial<Record<Kind, number>>; seed: number; pace?: number;
}

const TOOLS: Record<Exclude<Kind, 'conn'>, string[]> = {
  read: ['read'], search: ['grep', 'glob'], edit: ['edit', 'write'], exec: ['bash'], web: ['web_fetch', 'web_search'], task: ['subagent'], skill: ['skill'],
};
const CAT: Record<Kind, Category> = { read: 'read', search: 'search', edit: 'edit', exec: 'exec', web: 'web', conn: 'connector', task: 'delegate', skill: 'skill' };
const CONNS = [
  { id: 'erp', title: 'ERP', tools: ['mcp__erp__execute_read', 'mcp__erp__aggregate_read', 'mcp__erp__search_tools', 'mcp__erp__execute_write'] },
  { id: 'im', title: 'IM', tools: ['mcp__im__read_archive', 'mcp__im__list_chats'] },
];
export type SampleLang = 'zh' | 'en';
/** A sample text in both languages: [zh, en]. */
type Text = readonly [string, string];
const WS: { id: string; title: Text; path: string }[] = [
  { id: 'fin', title: ['财务对账', 'Finance'], path: 'finance' }, { id: 'sal', title: ['销售跟进', 'Sales'], path: 'sales' },
  { id: 'bid', title: ['投标 2026', 'Bids 2026'], path: 'bids-2026' }, { id: 'def', title: ['默认工作区', 'Default workspace'], path: 'workspace' },
];
const AUTOS: { id: string; title: Text; at: number; run: string | null }[] = [
  { id: 'a1', title: ['招标公告日报', 'Daily research: new tender notices'], at: HM('08:30'), run: 's9' }, { id: 'a2', title: ['本周线索跟进提醒', 'Weekly sales lead follow-up reminder'], at: HM('09:00'), run: 's5' },
  { id: 'a3', title: ['每日库存预警', 'Daily stock alert'], at: HM('15:45'), run: null }, { id: 'a4', title: ['下班前待办小结', 'End-of-day to-do summary'], at: HM('18:00'), run: null },
];
const PLUGINS: [string, boolean][] = [['pdf-tools', true], ['charts', true], ['ocr', true], ['calendar', true], ['translator', false], ['git-helper', true], ['web-clipper', true], ['sheet-kit', true], ['mail-merge', false]];
const EXTRA: Text[] = [['核对银行流水', 'Reconcile bank statement'], ['整理客户名单', 'Tidy up customer list'], ['招标文件目录', 'Tender document index'], ['清理下载文件夹', 'Clean up downloads folder'], ['发票抬头校验', 'Validate invoice billing names'], ['回复询价邮件草稿', 'Draft replies to customer enquiries'], ['资质证书到期表', 'Licence expiry tracker'], ['合并两份表格', 'Merge two spreadsheets'], ['差旅报销核对', 'Check travel expense claims'], ['竞品价格摘录', 'Competitor price list'], ['答疑纪要整理', 'Clarification meeting notes'], ['会议纪要转待办', 'Turn meeting minutes into todos'], ['应付账款账龄', 'Accounts payable ageing'], ['样品寄送清单', 'Sample shipping sheet'], ['评分办法摘录', 'Bid scoring rules summary'], ['批量重命名文件', 'Batch rename files']];

const SESSIONS: Ses[] = [
  { id: 's1', ws: 'fin', title: ['3 月应收账款对账', 'Reconcile March accounts receivable'], start: HM('14:05'), conn: 'erp', model: 'deepseek-v4-pro', w: { read: 3, search: 1, edit: 1.5, exec: 0.8, conn: 5, task: 0.2 }, seed: 11 },
  { id: 's1a', parent: 's1', ws: 'fin', title: ['核对回款流水', 'Match incoming payments'], start: HM('14:22'), end: HM('14:51'), final: 'done', conn: 'erp', model: 'deepseek-v4', w: { read: 2, conn: 5, edit: 0.5 }, seed: 12 },
  { id: 's1b', parent: 's1', ws: 'fin', title: ['标记逾期客户', 'Flag overdue customers'], start: HM('15:12'), conn: 'erp', model: 'deepseek-v4', w: { read: 2, conn: 4, edit: 1 }, seed: 13 },
  { id: 's2', ws: 'fin', title: ['供应商发票三单匹配', 'Three-way match of supplier invoices'], start: HM('15:02'), waits: [[HM('15:31:10'), null, 'appr', 'mcp__erp__execute_write']], preset: 'finance-expert', conn: 'erp', model: 'deepseek-v4-pro', w: { read: 2, conn: 5, edit: 0.6, skill: 0.3 }, seed: 21 },
  { id: 's3', ws: 'fin', title: ['月度费用报销汇总', 'Monthly expense claims summary'], start: HM('11:20'), end: HM('11:48'), final: 'done', out: 2, waits: [[HM('11:30'), HM('11:32'), 'appr', 'mcp__erp__execute_write', 'rejected']], conn: 'erp', model: 'deepseek-v4', w: { read: 2, conn: 4, edit: 0.6 }, seed: 31 },
  { id: 's4', ws: 'sal', title: ['中东客户报价单更新', 'Update quotation for Middle East customer'], start: HM('15:20'), conn: 'erp', model: 'deepseek-v4-pro', w: { read: 2, search: 1, edit: 2.5, web: 1.2, conn: 3, exec: 0.4, skill: 0.3 }, seed: 41 },
  { id: 's5', ws: 'sal', title: ['本周线索跟进提醒', 'Weekly sales lead follow-up reminder'], start: HM('09:00'), end: HM('09:06'), final: 'done', origin: 'a2', conn: 'im', model: 'deepseek-v4', w: { read: 1, conn: 4, edit: 1 }, seed: 51 },
  { id: 's6', ws: 'sal', title: ['客户拜访纪要整理', 'Write up customer visit notes'], start: HM('12:40'), idleFrom: HM('13:10'), conn: 'im', model: 'deepseek-v4', w: { read: 3, edit: 2, conn: 1 }, seed: 61 },
  { id: 's7', ws: 'bid', title: ['市政管网项目响应矩阵', 'Municipal pipeline project response matrix'], start: HM('13:40'), waits: [[HM('14:02'), HM('14:09'), 'ask', null]], preset: 'bid-expert', model: 'deepseek-v4-pro', pace: 0.8, w: { read: 5, search: 3, edit: 3, exec: 1, web: 1.4, task: 0.3, skill: 0.4 }, seed: 71 },
  { id: 's7a', parent: 's7', ws: 'bid', title: ['资质条款逐条核对', 'Check qualification clauses one by one'], start: HM('13:52'), end: HM('14:40'), final: 'done', model: 'deepseek-v4', w: { read: 5, search: 3, edit: 1 }, seed: 72 },
  { id: 's7b', parent: 's7', ws: 'bid', title: ['技术偏离表', 'Technical deviation list'], start: HM('14:10'), model: 'deepseek-v4', w: { read: 4, search: 2, edit: 3 }, seed: 73 },
  { id: 's7c', parent: 's7', ws: 'bid', title: ['报价清单核对', 'Check quoted bill of quantities'], start: HM('15:25'), model: 'deepseek-v4', w: { read: 3, edit: 2, exec: 1 }, seed: 74 },
  { id: 's8', ws: 'bid', title: ['投标保证金条款比对', 'Compare bid bond clauses'], start: HM('10:12'), end: HM('10:19'), final: 'failed', conn: 'erp', model: 'deepseek-v4', w: { read: 3, conn: 3 }, seed: 81 },
  { id: 's9', ws: 'bid', title: ['招标公告日报', 'Daily research: new tender notices'], start: HM('08:30'), end: HM('08:41'), final: 'done', origin: 'a1', out: 1, model: 'deepseek-v4', w: { web: 5, read: 1, edit: 1 }, seed: 91 },
  { id: 's10', ws: 'def', title: ['周报草稿', 'Weekly report draft'], start: HM('09:40'), end: HM('09:52'), final: 'done', out: 1, model: 'deepseek-v4', w: { read: 4, edit: 3 }, seed: 101 },
  { id: 's11', ws: 'def', jobs: [[HM('15:08'), HM('15:11')], [HM('15:20'), null]], title: ['修复导出脚本的编码问题', 'Fix encoding bug in export script'], start: HM('15:05'), model: 'deepseek-v4-pro', w: { read: 3, search: 2, edit: 3, exec: 3 }, seed: 111 },
  { id: 's12', ws: 'def', title: ['库存预警规则梳理', 'Review stock alert rules'], start: HM('12:30'), idleFrom: HM('12:50'), waits: [[HM('12:38'), HM('12:44'), 'appr', 'mcp__erp__execute_write', 'allowed']], conn: 'erp', model: 'deepseek-v4', w: { read: 3, conn: 2, edit: 1 }, seed: 121 },
];

/** One sample day; `midnight` is the local start of that day in ms. `lang` picks the titles' language. */
export function dshSample(midnight: number, lang: SampleLang = 'zh'): Fixture {
  const L = lang === 'en' ? 1 : 0;
  const at = (ms: number) => midnight + ms;
  const now = at(NOW);
  const ses: (Omit<Ses, 'title'> & { title: string })[] = SESSIONS.map((x) => ({ ...x, title: x.title[L] }));
  EXTRA.forEach((tt, i) => {
    const title = tt[L];
    const t0 = HM('08:05') + i * 1_500_000 + Math.round(hs(i, 3, 3) * 900_000);
    ses.push({ id: 'x' + i, ws: WS[i % WS.length].id, title, start: t0, end: t0 + 240_000 + Math.round(hs(i, 5, 1) * 1_500_000), final: i === 7 || i === 15 ? 'failed' : 'done', model: i % 2 ? 'deepseek-v4' : i % 3 ? 'deepseek-v4' : 'deepseek-v4-pro', w: { read: 3, search: 1, edit: 2, exec: i % 2 ? 1.5 : 0 }, seed: 300 + i * 7, out: i % 3 === 0 ? 1 : 0 });
  });
  const ev: UEvent[] = [];
  for (const w of WS) ev.push({ type: 'workspace', data: { id: w.id, title: w.title[L], displayPath: w.path } });
  for (const c of CONNS) ev.push({ type: 'connector', data: { id: c.id, title: c.title, state: 'connected', tools: c.tools } });
  ev.push({ type: 'inventory', data: { plugins: PLUGINS.map(([id, enabled]) => ({ id, enabled })) } });
  for (const a of AUTOS) {
    ev.push({ type: 'schedule', data: { id: a.id, title: a.title[L], status: 'active', ...(a.at > NOW ? { nextAt: at(a.at) } : { nextAt: at(a.at) + 86_400_000 }), runs: a.at <= NOW && a.run ? [{ at: at(a.at), agentId: a.run }] : [] } });
  }
  for (const s of ses) {
    if (s.start > NOW) continue;
    ev.push({ type: 'agent', data: {
      id: s.id, sessionId: s.id, workspaceId: s.ws, label: s.title, kind: s.origin ? 'scheduled' : s.parent ? 'subagent' : 'main',
      ...(s.parent ? { parentAgentId: s.parent } : {}), ...(s.preset ? { role: s.preset } : {}), ...(s.origin ? { scheduleId: s.origin } : {}),
      model: s.model, state: 'running', startedAt: at(s.start),
    } });
    ev.push({ type: 'turn', data: { t: at(s.start), agentId: s.id, phase: 'start' } });
    const waits = s.waits ?? [];
    for (const [i, w] of waits.entries()) {
      if (w[0] > NOW) continue;
      const outcome = w[4] === 'rejected' ? 'rejected' : w[4] ? 'allowed' : undefined;
      ev.push({ type: 'approval', data: { id: s.id + ':w' + i, agentId: s.id, kind: w[2] === 'ask' ? 'question' : 'approval', askedAt: at(w[0]), ...(w[3] ? { tool: w[3] } : {}), ...(w[1] !== null && w[1] <= NOW ? { decidedAt: at(w[1]) } : {}), ...(outcome && w[1] !== null ? { outcome } : {}) } });
    }
    for (const [i, j] of (s.jobs ?? []).entries()) {
      if (j[0] > NOW) continue;
      ev.push({ type: 'job', data: { id: s.id + ':j' + i, agentId: s.id, kind: 'bash', startedAt: at(j[0]), ...(j[1] !== null && j[1] <= NOW ? { endedAt: at(j[1]), outcome: 'completed' } : {}) } });
    }
    // Calls in bursts.
    const r = rng(s.seed);
    const until = Math.min(s.end ?? s.idleFrom ?? NOW, NOW);
    const inWait = (T: number) => waits.some((w) => T >= w[0] && (w[1] === null || T < w[1]));
    let T = s.start, last: Kind | undefined, n = 0;
    const kinds = Object.keys(s.w) as Kind[];
    for (;;) {
      T += (5 + r() * r() * 62) * (s.pace ?? 1) * 1000;
      if (T >= until) break;
      if (inWait(T)) continue;
      let k = last;
      if (!k || r() > 0.62) {
        let sum = 0; for (const x of kinds) sum += s.w[x]!;
        let v = r() * sum; k = kinds[0];
        for (const x of kinds) { v -= s.w[x]!; if (v <= 0) { k = x; break; } }
      }
      last = k;
      const conn = k === 'conn' ? CONNS.find((c) => c.id === s.conn) : undefined;
      const pool = conn ? conn.tools.filter((x) => !/write/.test(x)) : TOOLS[k as Exclude<Kind, 'conn'>];
      const tool = pool[Math.floor(r() * pool.length)];
      const base = { read: 900, search: 500, edit: 1500, exec: 700, web: 2300, conn: 1200, task: 600, skill: 400 }[k];
      const tok = Math.round(base * (0.5 + r() * 1.2));
      const ms = Math.round(150 + r() * r() * 3800);
      const err = r() < 0.012;
      const id = s.id + ':c' + n++;
      ev.push({ type: 'activity', data: { id, t: at(T), agentId: s.id, category: CAT[k], tool, ok: !err, durationMs: ms, ...(conn ? { connectorId: conn.id } : {}) } });
      ev.push({ type: 'usage', data: { id, t: at(T), agentId: s.id, model: s.model, input: Math.round(tok * 0.8), output: tok - Math.round(tok * 0.8) } });
    }
    if (s.idleFrom !== undefined && s.idleFrom <= NOW) ev.push({ type: 'turn', data: { t: at(s.idleFrom), agentId: s.id, phase: 'end', reason: 'cancelled' } });
    if (s.end !== undefined && s.end <= NOW) {
      if (s.out) ev.push({ type: 'deliverable', data: { t: at(s.end) - 1000, agentId: s.id, count: s.out } });
      ev.push({ type: 'turn', data: { t: at(s.end), agentId: s.id, phase: 'end', reason: s.final === 'failed' ? 'error' : 'completed' } });
    }
  }
  // Model-request retries (the fire station's repair log): two before each session that stopped on an error, one
  // on every fifth running session; and one running session plans before it works (plan mode on since its start).
  ses.forEach((s, i) => {
    if (s.start > NOW) return;
    const fail = s.final === 'failed' && s.end !== undefined && s.end <= NOW;
    if (!fail && (s.end !== undefined || i % 5)) return;
    const t0 = fail ? at(s.end!) - 90_000 : at(Math.min(NOW, s.start + 20 * 60_000));
    for (let k = 0; k < (fail ? 2 : 1); k++) {
      ev.push({ type: 'retry', data: { id: s.id + ':r' + k, t: t0 + k * 30_000, agentId: s.id, attempt: k + 1, delayMs: 2000 * (k + 1) } });
      if (!fail || k === 0) ev.push({ type: 'retry', data: { id: s.id + ':r' + k, t: t0 + k * 30_000 + 2000 * (k + 1), agentId: s.id, attempt: k + 1, startedAt: t0 + k * 30_000 + 2000 * (k + 1) } });
    }
  });
  const planner = ses.find((s) => !s.parent && s.end === undefined && s.start <= NOW && s.id !== 's1' && !s.waits?.length);
  if (planner) ev.push({ type: 'planmode', data: { t: at(planner.start) + 60_000, agentId: planner.id, active: true } });
  const d = new Date(midnight);
  // Buildings left from earlier days (the host keeps their lots and sizes, never their titles): placed first.
  const past = Array.from({ length: 26 }, (_, i) => {
    const h = Math.floor(hs(900 + i * 13, 11, 3) * 1e6);
    return { sessionId: 'h' + i, workspaceId: WS[i % WS.length].id, startedAt: midnight - (1 + (i % 6)) * 86_400_000 + i * 600_000, title: '',
      size: { calls: { library: 3 + (h % 37), workshop: (h >> 4) % 29, machine: (h >> 7) % 3 ? (h >> 9) % 23 : 0, meeting: (h >> 11) % 5 ? 0 : 2 }, tokens: 40_000 + (h % 97) * 6000, started: midnight - (1 + (i % 6)) * 86_400_000 + i * 600_000, state: i % 9 === 4 ? 'failed' as const : 'done' as const } };
  });
  const placement = samplePlacement([...past, ...ses.filter((x) => !x.parent && x.start <= NOW).map((x) => ({ sessionId: x.id, workspaceId: x.ws, startedAt: at(x.start), title: x.title }))]);
  placement.sizes = Object.fromEntries(past.map((p) => [p.sessionId, { ...p.size, calls: Object.fromEntries(Object.entries(p.size.calls).filter(([, n]) => n > 0)) }]));
  const p = (x: number) => String(x).padStart(2, '0');
  return {
    platform: { id: 'dsh', title: 'DSH', adapterVersion: 'fixture', caps: {
      approvals: true, schedules: true, subagents: true, jobs: true, deliverables: true, skills: true, memory: false,
      tokens: true, cost: false, latency: true, sessionTitles: true, retries: true, actions: { openSession: false, draftFollowUp: false },
    } },
    day: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
    now,
    events: ev,
    placement,
  };
}

/** The placement the host would keep for these sessions (and the theme it would freeze from each title). */
export function samplePlacement(roots: { sessionId: string; workspaceId: string; startedAt: number; title: string }[]): PlacementState {
  let st = place(cityTemplate(), emptyPlacement(), roots).state;
  for (const r of roots) if (r.title) st = freezeTheme(st, r.sessionId, themeFromTitle(r.title));
  return st;
}
