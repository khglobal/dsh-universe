// The Claude app adapter: the Claude desktop app's agent sessions on this device, in the Claude city beside Claude
// Code's. Shown whenever the app's session folders are found (the member can turn it off). Metadata only.
//
// The app runs a Claude Code agent for its agent work and keeps that agent's transcripts in Claude Code's format, so
// the transcripts are read by the same reader as Claude Code's (see adapter-claude-code/src/reader.ts for exactly
// which fields). Two kinds of session, checked against a real store (Claude desktop, macOS):
//
// - Cowork (local agent mode): `<app>/local-agent-mode-sessions/<account>/<org>/local_<id>/.claude/projects/
//   <project>/<session>.jsonl` (and `<session>/subagents/agent-<x>.jsonl`). Only these transcripts are read; the
//   session's `local_<id>.json` beside them (which holds the first message, the system prompt and the account's
//   e-mail), `audit.jsonl`, uploads, outputs and every other file are never opened.
// - The Code tab: `<app>/claude-code-sessions/<account>/<org>/local_<id>.json` says which Claude Code session the tab
//   runs (`cliSessionId`) and whether it was started in the app or only picked up from a terminal session
//   (`fromCliTranscript`). Of these files only those two keys are read. A session started in the app belongs to the
//   Claude app; its transcript is in Claude Code's own store (`~/.claude/projects`), read from there, and left out of
//   the Claude Code source, so each session is counted once. A terminal session the app merely lists stays Claude
//   Code's.
//
// Never read: chats with Claude (kept in Anthropic's cloud, not on this device), the app's browser storage (Local
// Storage, IndexedDB, caches, cookies), token or account files, and anything else in the app's folder.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createLocalAdapter, listFiles, type AdapterCheckpoint, type FileRef, type LocalAdapter } from '@dsh-universe/adapter-kit/local';
import { SESSION_FILE, SUBAGENT_FILE, claudeCodeCaps, sessionOfFile, transcriptReader } from '@dsh-universe/adapter-claude-code';

export const CLAUDE_APP_ADAPTER_VERSION = '0.1.0';

/** The Claude desktop app's own folder: macOS `~/Library/Application Support/Claude`, Windows `%APPDATA%\Claude`. */
export function claudeAppDir(home: string, platform: string = process.platform, env: Record<string, string | undefined> = process.env): string {
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude');
  // %APPDATA% only when it is this home's (tests and other members' homes use the default place).
  if (platform === 'win32') return join(env.APPDATA && home === homedir() ? env.APPDATA : join(home, 'AppData', 'Roaming'), 'Claude');
  return join(home, '.config', 'Claude');
}
export const coworkRoot = (dir: string) => join(dir, 'local-agent-mode-sessions');
export const codeTabRoot = (dir: string) => join(dir, 'claude-code-sessions');

/** The district of every Cowork session: the app runs each in a scratch folder of its own, with no project name. */
export const COWORK_WORKSPACE = { id: 'p:cowork', title: 'Cowork' } as const;

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const TAB_FILE = /^[^/]+\/[^/]+\/local_[^/]+\.json$/;

/**
 * The Claude Code session ids the app's Code tab started (and so owns). Each tab file is parsed once per change (by
 * size and time) and only `cliSessionId` and `fromCliTranscript` are taken from it.
 */
export function codeTabSessions(dir: string): () => Promise<ReadonlySet<string>> {
  const cache = new Map<string, { size: number; mtimeMs: number; id?: string }>();
  let last: ReadonlySet<string> = new Set();
  return async () => {
    const files = await listFiles(codeTabRoot(dir), (rel) => TAB_FILE.test(rel), { depth: 2 });
    const seen = new Set<string>();
    for (const f of files) {
      seen.add(f.path);
      const c = cache.get(f.path);
      if (c && c.size === f.size && c.mtimeMs === f.mtimeMs) continue;
      let id: string | undefined;
      try {
        const o = JSON.parse(await readFile(f.path, 'utf8')) as Record<string, unknown>;
        const cli = o && typeof o === 'object' ? o.cliSessionId : undefined;
        if (typeof cli === 'string' && ID.test(cli) && o.fromCliTranscript !== true) id = cli;
      } catch { /* being written, or not ours */ }
      cache.set(f.path, { size: f.size, mtimeMs: f.mtimeMs, id });
    }
    for (const k of [...cache.keys()]) if (!seen.has(k)) cache.delete(k);
    const out = new Set<string>();
    for (const c of cache.values()) if (c.id) out.add(c.id);
    last = out;
    return last;
  };
}

/** Cowork transcripts: only `local_<id>/.claude/projects/...` of each session, never the session's other files. */
async function coworkFiles(dir: string, since: number, tick: () => Promise<void>): Promise<FileRef[]> {
  const root = coworkRoot(dir);
  const out: FileRef[] = [];
  const kids = async (d: string) => { try { return (await readdir(d, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  for (const account of await kids(root)) {
    for (const org of await kids(join(root, account))) {
      for (const s of await kids(join(root, account, org))) {
        if (!s.startsWith('local_')) continue;
        await tick();
        out.push(...await listFiles(join(root, account, org, s, '.claude', 'projects'), (rel) => SESSION_FILE.test(rel) || SUBAGENT_FILE.test(rel), { depth: 3, since, tick }));
      }
    }
  }
  return out;
}

/** The app's transcripts: Cowork's, and the Code tab's own sessions in Claude Code's store. */
export function claudeAppReader(o: { home: string; dir: string; owned: () => Promise<ReadonlySet<string>> }) {
  const { dir, owned } = o;
  const projects = join(o.home, '.claude', 'projects');
  const cowork = coworkRoot(dir);
  return transcriptReader({
    engine: 'claude-app',
    async list(since, tick) {
      const mine = await owned();
      const tab = mine.size ? (await listFiles(projects, (rel) => SESSION_FILE.test(rel) || SUBAGENT_FILE.test(rel), { depth: 3, since, tick })).filter((f) => mine.has(sessionOfFile(f.path))) : [];
      return [...await coworkFiles(dir, since, tick), ...tab];
    },
    workspace: (f) => (f.path.startsWith(cowork) ? COWORK_WORKSPACE : undefined),
  });
}

export function createClaudeAppAdapter(o: { home: string; dir?: string; now?: () => number; onTitle?: (sessionId: string, title: string) => void; passMs?: number; restore?: AdapterCheckpoint; owned?: () => Promise<ReadonlySet<string>> }): LocalAdapter {
  const dir = o.dir ?? claudeAppDir(o.home);
  const projects = join(o.home, '.claude', 'projects');
  const owned = o.owned ?? codeTabSessions(dir);
  const cowork = coworkRoot(dir);
  const reader = claudeAppReader({ home: o.home, dir, owned });
  return createLocalAdapter({
    platform: { id: 'claude-app', title: 'Claude', adapterVersion: CLAUDE_APP_ADAPTER_VERSION },
    caps: claudeCodeCaps(), root: dir, present: () => claudeAppPresent(dir),
    watch: [cowork, codeTabRoot(dir), projects], reader,
    consent: { readsKey: 'nb.reads', changesConfig: false, undoKey: 'nb.undo' },
    now: o.now, onTitle: o.onTitle, passMs: o.passMs, restore: o.restore,
  });
}

/** Whether the app's agent-session folders are on this device (folder presence only). */
export const claudeAppPresent = (dir: string) => existsSync(coworkRoot(dir)) || existsSync(codeTabRoot(dir));
