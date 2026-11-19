// The Claude Code adapter: Claude Code's sessions on this device as an adjacent city, shown whenever the store is
// found (the member can turn it off). It reads `~/.claude/projects` incrementally (see reader.ts for exactly which fields).
import { join } from 'node:path';
import type { UCapabilities } from '@dsh-universe/model';
import { createLocalAdapter, type AdapterCheckpoint, type LocalAdapter } from '@dsh-universe/adapter-kit/local';
import { claudeCodeReader } from './reader.ts';

export * from './reader.ts';
export const CLAUDE_CODE_ADAPTER_VERSION = '0.1.0';

export const claudeCodeCaps = (): UCapabilities => ({
  approvals: true, schedules: false, subagents: true, jobs: false, deliverables: false, skills: true, memory: false,
  tokens: true, cost: false, latency: true, sessionTitles: true, retries: true, actions: { openSession: false, draftFollowUp: false },
});

/** The folder whose presence means Claude Code is on this device. */
export const claudeCodeRoot = (home: string) => join(home, '.claude', 'projects');

/** `skip`: session ids another source owns (the Claude app's Code tab), left out so each session is counted once. */
export function createClaudeCodeAdapter(o: { home: string; now?: () => number; onTitle?: (sessionId: string, title: string) => void; passMs?: number; restore?: AdapterCheckpoint; skip?: () => Promise<ReadonlySet<string>> | ReadonlySet<string> }): LocalAdapter {
  return createLocalAdapter({
    platform: { id: 'claude-code', title: 'Claude Code', adapterVersion: CLAUDE_CODE_ADAPTER_VERSION },
    caps: claudeCodeCaps(), root: claudeCodeRoot(o.home), watch: [claudeCodeRoot(o.home)], reader: claudeCodeReader(o.home, o.skip),
    consent: { readsKey: 'nb.reads', changesConfig: false, undoKey: 'nb.undo' },
    now: o.now, onTitle: o.onTitle, passMs: o.passMs, restore: o.restore,
  });
}
