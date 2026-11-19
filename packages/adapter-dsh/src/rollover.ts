// What a new day starts with when DSH stays open past midnight: the city's standing things (workspaces, scheduled
// tasks, connectors, the plugin inventory, as they are now) and every session still at work or waiting at midnight,
// with all of its events (its building, floors and figures look the same on both sides of midnight). Sessions that
// ended before midnight stay in yesterday (the earlier-days list and the placement's kept sizes show them).
import { createStore, stateAt, type UEvent } from '@dsh-universe/model';

/** Event types that describe the city's standing things (latest one per id wins). */
export const STANDING = new Set<UEvent['type']>(['workspace', 'schedule', 'connector', 'inventory']);

const idOf = (e: UEvent) => (e.data as { id?: unknown }).id;
const agentOf = (e: UEvent): string | undefined => {
  if (e.type === 'agent') return typeof e.data.id === 'string' ? e.data.id : undefined;
  const a = (e.data as { agentId?: unknown }).agentId;
  return typeof a === 'string' ? a : undefined;
};

/**
 * The events the new day starts with, from yesterday's `events`, at the moment `T` (midnight or the first moment
 * after it this host noticed). Standing things: the latest event per type and id. Open sessions: every root session
 * running or waiting at `T` and its whole family (subagents, engine runs), with every event that names them, in order.
 */
export function carryOver(events: readonly UEvent[], T: number): UEvent[] {
  const standing = new Map<string, UEvent>();
  for (const e of events) if (STANDING.has(e.type)) { const id = idOf(e); standing.set(e.type + ':' + (typeof id === 'string' ? id : ''), e); }
  const st = createStore();
  st.applyAll(events);
  const parentOf = new Map<string, string | undefined>();
  for (const s of st.agents()) parentOf.set(s.agent.id, s.agent.parentAgentId);
  const rootOf = (id: string) => { let r = id; for (let k = 0; k < 32 && parentOf.get(r) && parentOf.has(parentOf.get(r)!); k++) r = parentOf.get(r)!; return r; };
  // A family is open when any of its members is still at work or waiting.
  const openRoots = new Set<string>();
  for (const s of st.agents()) { const x = stateAt(s, T); if (x === 'running' || x === 'waiting') openRoots.add(rootOf(s.agent.id)); }
  const open = new Set<string>();
  for (const id of parentOf.keys()) if (openRoots.has(rootOf(id))) open.add(id);
  const out: UEvent[] = [...standing.values()];
  for (const e of events) { const a = agentOf(e); if (a && open.has(a)) out.push(e); }
  return out;
}
