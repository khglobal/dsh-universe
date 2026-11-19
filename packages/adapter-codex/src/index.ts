// The Codex adapter: Codex's sessions on this device as an adjacent city, shown whenever the store is found (the
// member can turn it off). It reads `~/.codex/sessions` and `~/.codex/archived_sessions` incrementally (see reader.ts for exactly which fields).
import { join } from 'node:path';
import type { UCapabilities } from '@dsh-universe/model';
import { createLocalAdapter, type AdapterCheckpoint, type LocalAdapter } from '@dsh-universe/adapter-kit/local';
import { codexReader } from './reader.ts';

export * from './reader.ts';
export const CODEX_ADAPTER_VERSION = '0.1.0';

export const codexCaps = (): UCapabilities => ({
  approvals: false, schedules: false, subagents: true, jobs: false, deliverables: false, skills: false, memory: false,
  tokens: true, cost: false, latency: true, sessionTitles: false, retries: true, actions: { openSession: false, draftFollowUp: false },
});

/** The folder whose presence means Codex is on this device (its sessions folder, created with the first session). */
export const codexRoot = (home: string) => join(home, '.codex', 'sessions');

export function createCodexAdapter(o: { home: string; now?: () => number; passMs?: number; restore?: AdapterCheckpoint }): LocalAdapter {
  return createLocalAdapter({
    platform: { id: 'codex', title: 'Codex', adapterVersion: CODEX_ADAPTER_VERSION },
    caps: codexCaps(), root: codexRoot(o.home), watch: [codexRoot(o.home), join(o.home, '.codex', 'archived_sessions')], reader: codexReader(o.home),
    consent: { readsKey: 'nb.reads', changesConfig: false, undoKey: 'nb.undo' },
    now: o.now, passMs: o.passMs, restore: o.restore,
  });
}
