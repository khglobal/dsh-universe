// The WorkBuddy adapter: WorkBuddy's (Tencent's desktop AI agent) sessions on this device as an adjacent city, shown
// whenever the store is found (the member can turn it off). It reads `~/.workbuddy/projects` incrementally (see
// reader.ts for exactly which fields). WorkBuddy's other folders (`~/Library/Application Support/WorkBuddy`,
// `com.workbuddy.workbuddy`: telemetry and device ids; `CodeBuddyExtension`: sign-in data of the separate CodeBuddy
// editor extension) hold no agent sessions and are never opened.
import type { UCapabilities } from '@dsh-universe/model';
import { createLocalAdapter, type AdapterCheckpoint, type LocalAdapter } from '@dsh-universe/adapter-kit/local';
import { workbuddyProjects, workbuddyReader } from './reader.ts';

export * from './reader.ts';
export const WORKBUDDY_ADAPTER_VERSION = '0.1.0';

export const workbuddyCaps = (): UCapabilities => ({
  approvals: true, schedules: false, subagents: true, jobs: false, deliverables: false, skills: true, memory: false,
  tokens: true, cost: false, latency: true, sessionTitles: false, retries: false, actions: { openSession: false, draftFollowUp: false },
});

/** The folder whose presence means WorkBuddy is on this device. */
export const workbuddyRoot = workbuddyProjects;

export function createWorkBuddyAdapter(o: { home: string; now?: () => number; passMs?: number; restore?: AdapterCheckpoint }): LocalAdapter {
  return createLocalAdapter({
    platform: { id: 'workbuddy', title: 'WorkBuddy', adapterVersion: WORKBUDDY_ADAPTER_VERSION },
    caps: workbuddyCaps(), root: workbuddyRoot(o.home), watch: [workbuddyRoot(o.home)], reader: workbuddyReader(o.home),
    consent: { readsKey: 'nb.reads', changesConfig: false, undoKey: 'nb.undo' },
    now: o.now, passMs: o.passMs, restore: o.restore,
  });
}
