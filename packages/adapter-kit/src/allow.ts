// The allow-list: an adapter's output may hold only the model's fields. `sanitize` copies exactly those (and drops
// anything else, however it got there); `conformanceProblems` is the check every adapter's tests run.
import { isEngine, type UEvent, type UEventType } from '@dsh-universe/model';

type Spec = Readonly<Record<string, 'string' | 'number' | 'boolean' | 'strings' | 'runs' | 'plugins'>>;

export const MODEL_FIELDS: Readonly<Record<UEventType, Spec>> = {
  workspace: { id: 'string', title: 'string', displayPath: 'string', tags: 'strings' },
  agent: {
    id: 'string', sessionId: 'string', parentAgentId: 'string', workspaceId: 'string', label: 'string', kind: 'string',
    role: 'string', model: 'string', state: 'string', startedAt: 'number', endedAt: 'number', scheduleId: 'string', engine: 'string',
  },
  activity: { id: 'string', t: 'number', agentId: 'string', category: 'string', tool: 'string', connectorId: 'string', durationMs: 'number', ok: 'boolean', tokens: 'number' },
  turn: { t: 'number', agentId: 'string', phase: 'string', reason: 'string' },
  approval: { id: 'string', agentId: 'string', kind: 'string', tool: 'string', askedAt: 'number', decidedAt: 'number', outcome: 'string' },
  job: { id: 'string', agentId: 'string', kind: 'string', startedAt: 'number', endedAt: 'number', outcome: 'string' },
  deliverable: { t: 'number', agentId: 'string', count: 'number' },
  schedule: { id: 'string', title: 'string', status: 'string', nextAt: 'number', runs: 'runs' },
  connector: { id: 'string', title: 'string', state: 'string', tools: 'strings', tags: 'strings' },
  usage: { id: 'string', t: 'number', agentId: 'string', model: 'string', input: 'number', output: 'number', cacheRead: 'number', cacheWrite: 'number' },
  inventory: { plugins: 'plugins', skills: 'strings', hooks: 'number' },
  planmode: { t: 'number', agentId: 'string', active: 'boolean' },
  retry: { id: 'string', t: 'number', agentId: 'string', attempt: 'number', delayMs: 'number', startedAt: 'number' },
};

/** Longest string kept in any field: names and ids, never text. */
export const MAX_STRING = 200;

const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, MAX_STRING) : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function pick(spec: Spec, src: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, kind] of Object.entries(spec)) {
    const v = src[k];
    let x: unknown;
    switch (kind) {
      case 'string': x = str(v); break;
      case 'number': x = num(v); break;
      case 'boolean': x = typeof v === 'boolean' ? v : undefined; break;
      case 'strings': x = Array.isArray(v) ? v.map(str).filter((s): s is string => s !== undefined).slice(0, 500) : undefined; break;
      case 'runs': x = Array.isArray(v) ? v.filter((r) => r && typeof r === 'object').map((r) => pick({ at: 'number', agentId: 'string', ok: 'boolean' }, r as Record<string, unknown>)).filter((r) => r.at !== undefined).slice(0, 200) : undefined; break;
      case 'plugins': x = Array.isArray(v) ? v.filter((r) => r && typeof r === 'object').map((r) => pick({ id: 'string', enabled: 'boolean' }, r as Record<string, unknown>)).filter((r) => r.id !== undefined).slice(0, 500) : undefined; break;
    }
    if (x !== undefined) out[k] = x;
  }
  return out;
}

/** Keeps only the model's fields of a known event type; anything else is undefined. */
export function sanitize(e: unknown): UEvent | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const { type, data } = e as { type?: unknown; data?: unknown };
  if (typeof type !== 'string' || !(type in MODEL_FIELDS) || !data || typeof data !== 'object') return undefined;
  const out = pick(MODEL_FIELDS[type as UEventType], data as Record<string, unknown>);
  // An engine is one of the known names or nothing.
  if (type === 'agent' && out.engine !== undefined && !isEngine(out.engine)) delete out.engine;
  return { type, data: out } as UEvent;
}

/**
 * The conformance check: every event has only model fields, and none of the given
 * sample values (arguments, results, prompts, replies fed into the adapter) appears anywhere in the output.
 */
/** JSON with object keys sorted, so field order does not matter. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));

export function conformanceProblems(output: readonly unknown[], forbidden: readonly string[]): string[] {
  const problems: string[] = [];
  output.forEach((e, i) => {
    const clean = sanitize(e);
    if (!clean) { problems.push(`#${i}: not a model event`); return; }
    if (canonical(clean) !== canonical(e)) problems.push(`#${i} (${clean.type}): fields outside the model`);
  });
  const text = JSON.stringify(output);
  for (const f of forbidden) if (f && text.includes(f)) problems.push(`content leaked: ${JSON.stringify(f.slice(0, 40))}`);
  return problems;
}
