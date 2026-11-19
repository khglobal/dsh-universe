// Made-up Claude Code and Codex session stores for tests and screenshots: the real file layouts and record shapes
// (field names as the CLIs write them), with a marker string in every content field. Nothing in the adapters' output
// or the rendered page may contain a marker; the explicit session title (`customTitle`) is the one text that may.
import { mkdirSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { claudeAppDir } from '@dsh-universe/adapter-claude-app';

/** Marker strings, one per content field. */
export const MARK = {
  prompt: 'LEAKMARK-prompt-a1', reply: 'LEAKMARK-reply-b2', thinking: 'LEAKMARK-thinking-c3', toolInput: 'LEAKMARK-toolinput-d4',
  toolResult: 'LEAKMARK-toolresult-e5', toolUseResult: 'LEAKMARK-tooluseresult-f6', aiTitle: 'LEAKMARK-aititle-g7',
  lastPrompt: 'LEAKMARK-lastprompt-h8', queue: 'LEAKMARK-queue-i9', attachment: 'LEAKMARK-attachment-j0', apiRequest: 'LEAKMARK-apirequest-k1',
  summary: 'LEAKMARK-summary-l2', agentName: 'LEAKMARK-agentname-m3', subTask: 'LEAKMARK-subtask-n4', parentDir: 'LEAKMARKparentdir',
  branch: 'LEAKMARK-branch-o5', prUrl: 'LEAKMARK-prurl-p6', errorText: 'LEAKMARK-errortext-q7', account: 'LEAKMARK-account-r8',
  history: 'LEAKMARK-history-s9', instructions: 'LEAKMARK-instructions-t0', args: 'LEAKMARK-args-u1', output: 'LEAKMARK-output-v2',
  threadName: 'LEAKMARK-threadname-w3', command: 'LEAKMARK-command-x4', stdout: 'LEAKMARK-stdout-y5', reasoning: 'LEAKMARK-reasoning-z6',
  gitUrl: 'LEAKMARK-giturl-a7', fileContent: 'LEAKMARK-filecontent-b8', cost: 'LEAKMARK-cost-c9',
  email: 'LEAKMARK-email-d0', systemPrompt: 'LEAKMARK-systemprompt-e1', initialMessage: 'LEAKMARK-initialmessage-f2', audit: 'LEAKMARK-audit-g3',
  browser: 'LEAKMARK-browserstore-h4', token: 'LEAKMARK-token-i5', appTitle: 'LEAKMARK-apptitle-j6', wbArgs: 'LEAKMARK-wbargs-k7',
  wbDisplay: 'LEAKMARK-wbdisplay-l8', wbDb: 'LEAKMARK-wbdb-m9', wbTask: 'LEAKMARK-wbtask-n0', wbTrace: 'LEAKMARK-wbtrace-o1',
  wbTitle: 'LEAKMARK-wbtitle-p2', wbAgent: 'LEAKMARK-wbagentname-q3',
} as const;
export const MARKERS: readonly string[] = Object.values(MARK);
/** The one explicit, member-set title in the fixture (allowed to appear). */
export const CUSTOM_TITLE = 'Release prep';
export const PROJECTS = { app: 'demo-app', api: 'billing-api', docs: 'docs-site', report: 'market-report' };
/** The fixture's session ids by source (the Claude app's Code-tab session lives in Claude Code's store). */
export const IDS = {
  codeTab: 'c0ffee02-0000-4000-8000-000000000001', adopted: 'c0ffee01-0000-4000-8000-000000000004',
  cowork: ['c0ffee03-0000-4000-8000-000000000001', 'c0ffee03-0000-4000-8000-000000000002'],
  workbuddy: ['0b0d0b0d-0000-4000-8000-000000000001', '0b0d0b0d-0000-4000-8000-000000000002', '0b0d0b0d-0000-4000-8000-000000000003'],
};

const iso = (t: number) => new Date(t).toISOString();
const line = (o: unknown) => JSON.stringify(o) + '\n';

export interface ClaudeSteps { tools: [string, boolean][]; end: 'end_turn' | 'open' | 'apierror'; title?: string; model?: string; sub?: string }

/** One Claude Code-format session file (and its subagent's) under `projects`, as Claude Code 2.x writes it. */
export function claudeSession(projects: string, sid: string, project: string, start: number, steps: ClaudeSteps, cwdOf: (p: string) => string = (p) => `/work/${MARK.parentDir}/${p}`): string {
  const common = (sid: string, cwd: string) => ({ sessionId: sid, cwd, version: '2.1.0', gitBranch: MARK.branch, userType: 'external', entrypoint: 'cli' });
      const cwd = cwdOf(project);
      const dir = join(projects, cwd.replace(/[/.]/g, '-'));
      mkdirSync(dir, { recursive: true });
      const f = join(dir, sid + '.jsonl');
      let t = start, n = 0;
      const tick = () => (t += 40_000 + (n++ % 5) * 9_000);
      let out = '';
      out += line({ type: 'permission-mode', permissionMode: 'auto', sessionId: sid });
      out += line({ type: 'session-owner', accountUuid: MARK.account, organizationUuid: MARK.account, sessionId: sid });
      out += line({ type: 'queue-operation', operation: 'enqueue', timestamp: iso(t), sessionId: sid, content: MARK.queue });
      out += line({ parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: MARK.prompt }, uuid: 'u' + n, timestamp: iso(tick()), ...common(sid, cwd) });
      out += line({ parentUuid: 'x', isSidechain: false, type: 'attachment', attachment: { type: 'file', content: { file: { content: MARK.fileContent, filePath: cwd + '/x' } }, text: MARK.attachment }, uuid: 'a' + n, timestamp: iso(t), ...common(sid, cwd) });
      out += line({ type: 'api-request', sessionId: sid, id: 'r' + n, timestamp: iso(t), params: { model: 'claude-opus-4-5', system: MARK.apiRequest }, tail: [MARK.apiRequest] });
      if (steps.title) out += line({ type: 'custom-title', customTitle: steps.title, sessionId: sid });
      out += line({ type: 'ai-title', aiTitle: MARK.aiTitle, sessionId: sid });
      out += line({ type: 'agent-name', agentName: MARK.agentName, sessionId: sid });
      out += line({ type: 'last-prompt', leafUuid: 'x', lastPrompt: MARK.lastPrompt, sessionId: sid });
      steps.tools.forEach(([name, ok], i) => {
        const mid = `msg_${sid.slice(0, 6)}_${i}`, tid = `toolu_${sid.slice(0, 6)}_${i}`;
        const usage = { input_tokens: 1200 + i * 300, output_tokens: 300 + i * 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 400, server_tool_use: { web_search_requests: 0 } };
        const m = { id: mid, type: 'message', role: 'assistant', model: steps.model ?? 'claude-opus-4-5', stop_reason: 'tool_use', usage };
        // One response, written as a line per content block with the same id and usage (counted once).
        out += line({ parentUuid: 'x', isSidechain: false, type: 'assistant', message: { ...m, content: [{ type: 'thinking', thinking: MARK.thinking, signature: 'sig' }] }, requestId: 'req', uuid: 'th' + i, timestamp: iso(tick()), ...common(sid, cwd) });
        out += line({ parentUuid: 'x', isSidechain: false, type: 'assistant', message: { ...m, content: [{ type: 'text', text: MARK.reply }] }, uuid: 'tx' + i, timestamp: iso(t), ...common(sid, cwd) });
        out += line({ parentUuid: 'x', isSidechain: false, type: 'assistant', message: { ...m, content: [{ type: 'tool_use', id: tid, name, input: { command: MARK.toolInput, file_path: MARK.toolInput } }] }, uuid: 'tu' + i, timestamp: iso(t), ...common(sid, cwd) });
        out += line({ parentUuid: 'x', isSidechain: false, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: MARK.toolResult, is_error: !ok }] }, toolUseResult: { stdout: MARK.toolUseResult, stderr: MARK.errorText }, uuid: 'tr' + i, timestamp: iso(tick()), sourceToolAssistantUUID: 'tu' + i, ...common(sid, cwd) });
      });
      if (steps.end === 'end_turn') {
        out += line({ parentUuid: 'x', isSidechain: false, type: 'assistant', message: { id: `msg_${sid.slice(0, 6)}_end`, role: 'assistant', model: steps.model ?? 'claude-opus-4-5', stop_reason: 'end_turn', usage: { input_tokens: 800, output_tokens: 600 }, content: [{ type: 'text', text: MARK.reply }] }, uuid: 'end', timestamp: iso(tick()), ...common(sid, cwd) });
        out += line({ parentUuid: 'x', isSidechain: false, type: 'system', subtype: 'turn_duration', durationMs: 120000, timestamp: iso(t), uuid: 'td', ...common(sid, cwd) });
      } else if (steps.end === 'apierror') {
        out += line({ parentUuid: 'x', isSidechain: false, type: 'system', subtype: 'api_error', level: 'error', error: MARK.errorText, retryAttempt: 2, retryInMs: 4000, timestamp: iso(tick()), uuid: 'ae' + sid.slice(0, 4), ...common(sid, cwd) });
        out += line({ parentUuid: 'x', isSidechain: false, type: 'assistant', isApiErrorMessage: true, message: { id: `msg_${sid.slice(0, 6)}_err`, role: 'assistant', model: '<synthetic>', stop_reason: 'stop_sequence', usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: 'text', text: MARK.errorText }] }, uuid: 'err', timestamp: iso(tick()), ...common(sid, cwd) });
      }
      out += line({ type: 'pr-link', sessionId: sid, prNumber: 7, prUrl: MARK.prUrl, prRepository: MARK.prUrl, timestamp: iso(t) });
      out += line({ type: 'cost-state', sessionId: sid, totalCostUSD: 1.5, modelUsage: { [MARK.cost]: {} } });
      out += line({ type: 'file-history-snapshot', messageId: 'm', snapshot: { trackedFileBackups: { [MARK.fileContent]: {} } } });
      writeFileSync(f, out);
      if (steps.sub) {
        const sdir = join(dir, sid, 'subagents');
        mkdirSync(sdir, { recursive: true });
        const aid = 'a' + steps.sub;
        writeFileSync(join(sdir, `agent-${aid}.meta.json`), JSON.stringify({ agentType: 'Explore', isBuiltIn: true, description: MARK.subTask, toolUseId: 'toolu_x', model: 'claude-haiku-4-5', finished: true }));
        let s2 = '';
        let t2 = start + 5 * 60_000;
        s2 += line({ parentUuid: null, isSidechain: true, agentId: aid, type: 'user', message: { role: 'user', content: MARK.subTask }, uuid: 's0', timestamp: iso(t2), ...common(sid, cwd) });
        for (let i = 0; i < 3; i++) {
          const tid = `toolu_sub_${aid}_${i}`;
          s2 += line({ parentUuid: 'x', isSidechain: true, agentId: aid, type: 'assistant', message: { id: `msg_sub_${aid}_${i}`, role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'tool_use', usage: { input_tokens: 500, output_tokens: 90 }, content: [{ type: 'tool_use', id: tid, name: i === 1 ? 'Grep' : 'Read', input: { pattern: MARK.toolInput } }] }, uuid: 'sa' + i, timestamp: iso(t2 += 20_000) , ...common(sid, cwd) });
          s2 += line({ parentUuid: 'x', isSidechain: true, agentId: aid, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tid, content: [{ type: 'text', text: MARK.toolResult }] }] }, uuid: 'sr' + i, timestamp: iso(t2 += 9_000), ...common(sid, cwd) });
        }
        s2 += line({ parentUuid: 'x', isSidechain: true, agentId: aid, type: 'assistant', message: { id: `msg_sub_${aid}_end`, role: 'assistant', model: 'claude-haiku-4-5', stop_reason: 'end_turn', usage: { input_tokens: 400, output_tokens: 200 }, content: [{ type: 'text', text: MARK.reply }] }, uuid: 'se', timestamp: iso(t2 += 10_000), ...common(sid, cwd) });
        writeFileSync(join(sdir, `agent-${aid}.jsonl`), s2);
      }
      return f;
}


/**
 * Writes `<home>/.claude/projects/...` and `<home>/.codex/sessions/...` with sessions of today (at `now`) and of
 * two earlier days. Returns the session ids.
 */
export function seedLocalStores(home: string, now: number, o: { claude?: boolean; codex?: boolean; claudeApp?: boolean; workbuddy?: boolean } = {}) {
  const day0 = new Date(now); day0.setHours(0, 0, 0, 0);
  const at = (h: number, m = 0) => day0.getTime() + (h * 60 + m) * 60_000;
  const ids = { cc: [] as string[], cx: [] as string[], app: [] as string[], wb: [] as string[] };
  if (o.claude !== false) {
    const root = join(home, '.claude');
    const projects = join(root, 'projects');
    const session = (sid: string, project: string, st: number, steps: ClaudeSteps) => { ids.cc.push(sid); return claudeSession(projects, sid, project, st, steps); };
    const ok = (n: string): [string, boolean] => [n, true];
    session('c0ffee01-0000-4000-8000-000000000001', PROJECTS.app, at(8, 40), { tools: [ok('Read'), ok('Grep'), ok('Edit'), ['Bash', false], ok('Bash'), ok('Edit')], end: 'end_turn', title: CUSTOM_TITLE, sub: '1' });
    session('c0ffee01-0000-4000-8000-000000000002', PROJECTS.app, Math.max(at(0, 5), now - 8 * 60_000), { tools: [ok('Glob'), ok('Read'), ok('WebFetch'), ok('mcp__linear__get_issue'), ok('Write')], end: 'open' });
    session('c0ffee01-0000-4000-8000-000000000003', PROJECTS.api, at(9, 15), { tools: [ok('Read'), ['Bash', false], ['Bash', false]], end: 'apierror' });
    session('c0ffee01-0000-4000-8000-000000000004', PROJECTS.api, at(11, 0), { tools: [ok('TodoWrite'), ok('Read'), ok('Edit'), ok('Bash'), ok('Skill')], end: 'end_turn', model: 'claude-sonnet-4-5' });
    session('c0ffee01-0000-4000-8000-000000000005', PROJECTS.docs, at(7, 30), { tools: [ok('Read'), ok('Write')], end: 'end_turn' });
    // An earlier day, for the 14-day totals.
    const old = session('c0ffee01-0000-4000-8000-000000000009', PROJECTS.docs, at(-30), { tools: [ok('Read')], end: 'end_turn' });
    const oldT = new Date(at(-29)); utimesSync(old, oldT, oldT);
    writeFileSync(join(root, 'history.jsonl'), line({ display: MARK.history, pastedContents: {}, timestamp: now, project: '/work/' + MARK.parentDir }));
  }
  if (o.codex !== false) {
    const root = join(home, '.codex');
    const p2 = (x: number) => String(x).padStart(2, '0');
    const rollout = (id: string, project: string, start: number, items: { tools: [string, number | boolean][]; end: 'complete' | 'open' | 'error'; model?: string; parent?: string }) => {
      const d = new Date(start);
      const dir = join(root, 'sessions', String(d.getFullYear()), p2(d.getMonth() + 1), p2(d.getDate()));
      mkdirSync(dir, { recursive: true });
      const f = join(dir, `rollout-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}-${p2(d.getMinutes())}-00-${id}.jsonl`);
      const cwd = `/work/${MARK.parentDir}/${project}`;
      let t = start, n = 0;
      const tick = () => (t += 30_000 + (n++ % 4) * 7_000);
      const rec = (type: string, payload: unknown) => line({ timestamp: iso(t), type, payload });
      let out = rec('session_meta', { id, timestamp: iso(t), cwd, originator: 'codex_cli_rs', cli_version: '0.60.0', instructions: MARK.instructions, model_provider: 'openai',
        source: items.parent ? { subagent: { thread_spawn: { parent_thread_id: items.parent, depth: 1, agent_role: 'worker', agent_nickname: MARK.agentName } } } : 'cli', git: { commit_hash: 'abc', branch: MARK.branch, repository_url: MARK.gitUrl } });
      out += rec('turn_context', { cwd, approval_policy: 'on-request', sandbox_policy: { mode: 'workspace-write' }, model: items.model ?? 'gpt-5-codex', effort: 'medium', summary: 'auto' });
      tick(); out += rec('event_msg', { type: 'task_started', model_context_window: 272000 });
      out += rec('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: MARK.prompt }] });
      out += rec('event_msg', { type: 'user_message', message: MARK.prompt, images: [] });
      items.tools.forEach(([name, res], i) => {
        const cid = `call_${id.slice(0, 6)}_${i}`;
        tick(); out += rec('response_item', { type: 'reasoning', summary: [{ type: 'summary_text', text: MARK.reasoning }], encrypted_content: MARK.reasoning });
        out += rec('event_msg', { type: 'agent_reasoning', text: MARK.reasoning });
        if (name === 'apply_patch') out += rec('response_item', { type: 'custom_tool_call', status: 'completed', call_id: cid, name, input: MARK.args });
        else out += rec('response_item', { type: 'function_call', name, arguments: JSON.stringify({ command: [MARK.command], cmd: MARK.args }), call_id: cid });
        tick();
        if (typeof res === 'number') out += rec('event_msg', { type: 'exec_command_end', call_id: cid, stdout: MARK.stdout, stderr: MARK.errorText, aggregated_output: MARK.stdout, exit_code: res, duration: { secs: 2, nanos: 0 }, command: [MARK.command] });
        else if (name === 'apply_patch') out += rec('event_msg', { type: 'patch_apply_end', call_id: cid, stdout: MARK.stdout, stderr: '', success: res });
        else out += rec('event_msg', { type: 'mcp_tool_call_end', call_id: cid, invocation: { server: 'linear', tool: 'get', arguments: MARK.args }, result: res ? { Ok: { content: [{ type: 'text', text: MARK.output }] } } : { Err: MARK.errorText } });
        out += rec(name === 'apply_patch' ? 'response_item' : 'response_item', name === 'apply_patch' ? { type: 'custom_tool_call_output', call_id: cid, output: MARK.output } : { type: 'function_call_output', call_id: cid, output: MARK.output });
        out += rec('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: 9000, cached_input_tokens: 4000, output_tokens: 900, reasoning_output_tokens: 300, total_tokens: 9900 }, last_token_usage: { input_tokens: 3000 + i * 500, cached_input_tokens: 1500, output_tokens: 250, reasoning_output_tokens: 100, total_tokens: 3250 }, model_context_window: 272000 }, rate_limits: { primary: { used_percent: 12 } } });
      });
      tick();
      if (items.end === 'complete') { out += rec('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: MARK.reply }] }); out += rec('event_msg', { type: 'agent_message', message: MARK.reply }); out += rec('event_msg', { type: 'task_complete', turn_id: '1', last_agent_message: MARK.reply }); }
      else if (items.end === 'error') { out += rec('event_msg', { type: 'stream_error', message: MARK.errorText }); tick(); out += rec('event_msg', { type: 'error', message: MARK.errorText }); }
      writeFileSync(f, out);
      ids.cx.push(id);
      return f;
    };
    rollout('0a11ce00-0000-4000-8000-000000000001', PROJECTS.api, at(9, 0), { tools: [['shell', 0], ['shell', 1], ['apply_patch', true], ['shell', 0]], end: 'complete' });
    rollout('0a11ce00-0000-4000-8000-000000000002', PROJECTS.api, Math.max(at(0, 5), now - 9 * 60_000), { tools: [['shell', 0], ['linear__get_issue', true], ['apply_patch', true]], end: 'open', parent: undefined });
    rollout('0a11ce00-0000-4000-8000-000000000003', PROJECTS.app, at(8, 10), { tools: [['shell', 2], ['shell', 2]], end: 'error' });
    rollout('0a11ce00-0000-4000-8000-000000000004', PROJECTS.api, Math.max(at(0, 6), now - 6 * 60_000), { tools: [['shell', 0], ['shell', 0]], end: 'complete', parent: '0a11ce00-0000-4000-8000-000000000002', model: 'gpt-5-codex-mini' });
    const old = rollout('0a11ce00-0000-4000-8000-000000000009', PROJECTS.app, at(-50), { tools: [['shell', 0]], end: 'complete' });
    const oldT = new Date(at(-49)); utimesSync(old, oldT, oldT);
    writeFileSync(join(root, 'history.jsonl'), line({ session_id: 'x', ts: 1, text: MARK.history }));
    writeFileSync(join(root, 'session_index.jsonl'), line({ id: '0a11ce00-0000-4000-8000-000000000001', thread_name: MARK.threadName, updated_at: iso(now) }));
  }
  if (o.claudeApp !== false) seedClaudeApp(home, now, at, ids.app);
  if (o.workbuddy !== false) seedWorkBuddy(home, at, now, ids.wb);
  return ids;
}

/** Appends one more Claude Code turn to a session (live updates). */
export function appendClaudeTurn(file: string, sid: string, t: number, name: string) {
  const cwd = `/work/${MARK.parentDir}/${PROJECTS.app}`;
  appendFileSync(file, line({ parentUuid: 'x', isSidechain: false, type: 'assistant', message: { id: 'msg_live_' + t, role: 'assistant', model: 'claude-opus-4-5', stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'tool_use', id: 'toolu_live_' + t, name, input: { x: MARK.toolInput } }] }, uuid: 'l' + t, timestamp: iso(t), sessionId: sid, cwd }));
}

/**
 * The Claude desktop app's folder: two Cowork sessions (transcripts in Claude Code's format inside the session's own
 * folder, beside a metadata file, an audit log, uploads and outputs full of content), a Code-tab session started in
 * the app (its transcript in Claude Code's own store) and one picked up from a terminal session (stays Claude Code's),
 * plus browser storage and token files that must never be read.
 */
function seedClaudeApp(home: string, now: number, at: (h: number, m?: number) => number, out: string[]) {
  const app = claudeAppDir(home);
  const org = join(app, 'local-agent-mode-sessions', 'acc00000-0000-4000-8000-000000000001', 'org00000-0000-4000-8000-000000000001');
  const sess = (n: number, cli: string, start: number, steps: ClaudeSteps) => {
    const local = `local_${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
    const dir = join(org, local);
    mkdirSync(join(dir, 'outputs'), { recursive: true });
    mkdirSync(join(dir, 'uploads'), { recursive: true });
    writeFileSync(join(org, local + '.json'), JSON.stringify({ sessionId: local, cliSessionId: cli, title: MARK.appTitle, initialMessage: MARK.initialMessage, systemPrompt: MARK.systemPrompt, emailAddress: MARK.email, accountName: MARK.account, cwd: '/sessions/' + MARK.parentDir, model: 'claude-opus-4-5', createdAt: start, lastActivityAt: now }));
    writeFileSync(join(dir, 'audit.jsonl'), line({ type: 'user', session_id: cli, message: { content: MARK.audit }, _audit_timestamp: iso(start) }));
    writeFileSync(join(dir, 'outputs', 'report.md'), MARK.fileContent);
    claudeSession(join(dir, '.claude', 'projects'), cli, 'outputs', start, steps, () => `/Users/${MARK.parentDir}/Claude/local_${n}/outputs`);
    out.push(cli);
  };
  const ok = (n: string): [string, boolean] => [n, true];
  sess(1, IDS.cowork[0], at(9, 30), { tools: [ok('Read'), ok('mcp__notion__search'), ok('Write')], end: 'end_turn', sub: '9', model: 'claude-sonnet-4-5' });
  sess(2, IDS.cowork[1], Math.max(at(0, 3), now - 5 * 60_000), { tools: [ok('WebSearch'), ['Bash', false], ok('Skill')], end: 'open' });
  const tabs = join(app, 'claude-code-sessions', 'acc00000-0000-4000-8000-000000000001', 'org00000-0000-4000-8000-000000000001');
  mkdirSync(tabs, { recursive: true });
  writeFileSync(join(tabs, 'local_tab00001.json'), JSON.stringify({ sessionId: 'local_tab00001', cliSessionId: IDS.codeTab, title: MARK.appTitle, cwd: '/work/' + MARK.parentDir, model: 'claude-opus-4-5', createdAt: at(10), lastActivityAt: at(11), permissionMode: 'default', remoteMcpServersConfig: [{ name: 'x', instructions: MARK.instructions }] }));
  writeFileSync(join(tabs, 'local_tab00002.json'), JSON.stringify({ sessionId: 'local_tab00002', cliSessionId: IDS.adopted, fromCliTranscript: true, adoptedFromOtherSurface: true, title: MARK.appTitle, createdAt: at(11), lastActivityAt: at(12) }));
  claudeSession(join(home, '.claude', 'projects'), IDS.codeTab, PROJECTS.app, at(10, 5), { tools: [ok('Read'), ok('Edit'), ['Bash', false], ok('Bash')], end: 'end_turn' });
  out.push(IDS.codeTab);
  // Never read: the app's browser storage, cookies and token files.
  mkdirSync(join(app, 'Local Storage', 'leveldb'), { recursive: true });
  writeFileSync(join(app, 'Local Storage', 'leveldb', '000003.log'), MARK.browser);
  mkdirSync(join(app, 'IndexedDB'), { recursive: true });
  writeFileSync(join(app, 'IndexedDB', 'x.jsonl'), line({ type: 'assistant', timestamp: iso(now), text: MARK.browser }));
  writeFileSync(join(app, 'Cookies'), MARK.token);
  writeFileSync(join(app, 'buddy-tokens.json'), JSON.stringify({ token: MARK.token }));
  writeFileSync(join(app, 'config.json'), JSON.stringify({ oauth: MARK.token }));
}

/**
 * WorkBuddy's store (`~/.workbuddy`): three sessions of today and one older, in the agent's own run format (field names
 * as WorkBuddy writes them, times in milliseconds), a subagent, a failed call, a session that stopped on an error;
 * and the files beside them (database, tasks, traces, settings) with markers that must never be read.
 */
function seedWorkBuddy(home: string, at: (h: number, m?: number) => number, now: number, out: string[]) {
  const root = join(home, '.workbuddy');
  const cwdOf = (p: string) => `/Users/${MARK.parentDir}/WorkBuddy/${p}`;
  const usage = (i: number) => ({ input_tokens: 4000 + i * 500, output_tokens: 300 + i * 20, cache_read_input_tokens: 1000, total_tokens: 4300 + i * 520 });
  const pd = (o: Record<string, unknown> = {}) => ({ model: 'glm-5.2', requestModelId: 'auto', requestModelName: 'Auto', agent: 'cli', traceId: 'tr', conversationRequestId: 'cr', ...o });
  const session = (sid: string, project: string, start: number, steps: { tools: [string, 'ok' | 'error' | 'exit' | 'open'][]; end: 'done' | 'open' | 'error'; sub?: boolean; model?: string }) => {
    const cwd = cwdOf(project);
    const dir = join(root, 'projects', cwd.replace(/[/.]/g, '-'));
    mkdirSync(dir, { recursive: true });
    let t = start, n = 0;
    const tick = () => (t += 30_000 + (n++ % 4) * 6_000);
    const base = () => ({ sessionId: sid, cwd, timestamp: t });
    let s = '';
    s += line({ type: 'message', role: 'user', id: 'u0', content: [{ type: 'input_text', text: MARK.prompt }], rawContent: [{ type: 'text', text: MARK.prompt }], providerData: { messageId: 'pu0' }, ...base() });
    s += line({ type: 'file-history-snapshot', id: 'fh', isSnapshotUpdate: false, snapshot: { messageId: 'x', trackedFileBackups: { [MARK.fileContent]: { backupFileName: MARK.fileContent, version: 1, backupTime: iso(t) } } }, timestamp: t });
    s += line({ type: 'ai-title', aiTitle: MARK.wbTitle, sessionId: sid, timestamp: t });
    steps.tools.forEach(([name, res], i) => {
      const mid = `pm_${sid.slice(-4)}_${i}`, cid = `call_${sid.slice(-4)}_${i}`;
      tick();
      s += line({ type: 'reasoning', id: 'r' + i, content: [{ type: 'input_text', text: MARK.reasoning }], providerData: pd({ messageId: mid, reasoning: MARK.reasoning }), ...base() });
      s += line({ type: 'message', role: 'assistant', status: 'completed', id: 'a' + i, content: [{ type: 'output_text', text: MARK.reply }], providerData: pd({ messageId: mid, model: steps.model ?? 'glm-5.2' }), ...base() });
      s += line({ type: 'function_call', id: 'f' + i, callId: cid, name, arguments: JSON.stringify({ command: MARK.wbArgs }), status: 'completed', message: { usage: usage(i) }, providerData: pd({ messageId: mid, model: steps.model ?? 'glm-5.2', argumentsDisplayText: MARK.wbDisplay, usage: { inputTokens: 4000, outputTokens: 300, requests: 1, totalTokens: 4300, inputTokensDetails: [{ cached_tokens: 1000 }] }, rawUsage: { prompt_tokens: 4000, completion_tokens: 300, credit: 1 } }), ...base() });
      if (res === 'open') return;
      tick();
      const toolResult = res === 'error' ? { error: MARK.errorText, content: MARK.toolResult } : { content: [MARK.toolResult], title: MARK.toolResult, rawResponse: { exitCode: res === 'exit' ? 1 : 0, stdoutBytesTruncated: 0, query: MARK.toolInput }, renderer: { type: 'code', value: MARK.output } };
      s += line({ type: 'function_call_result', id: 'fr' + i, callId: cid, name, status: 'completed', output: { type: 'text', text: MARK.output }, providerData: pd({ toolResult }), ...base() });
    });
    tick();
    if (steps.end === 'done') s += line({ type: 'message', role: 'assistant', status: 'completed', id: 'end', content: [{ type: 'output_text', text: MARK.reply }], message: { usage: usage(9) }, providerData: pd({ messageId: `pm_${sid.slice(-4)}_end`, model: steps.model ?? 'glm-5.2' }), ...base() });
    else if (steps.end === 'error') s += line({ type: 'message', role: 'assistant', status: 'incomplete', id: 'err', content: [{ type: 'output_text', text: MARK.errorText }], providerData: { messageId: 'perr', error: { code: 500, status: 500, message: MARK.errorText, requestID: MARK.account } }, ...base() });
    const f = join(dir, sid + '.jsonl');
    writeFileSync(f, s);
    if (steps.sub) {
      const sdir = join(dir, sid, 'subagents');
      mkdirSync(sdir, { recursive: true });
      mkdirSync(join(dir, sid, 'tool-results'), { recursive: true });
      writeFileSync(join(dir, sid, 'tool-results', 'r.txt'), MARK.toolResult);
      let t2 = start + 4 * 60_000, s2 = '';
      const sb = () => ({ sessionId: 'sub-' + sid, cwd, timestamp: t2 });
      s2 += line({ type: 'message', role: 'user', id: 'su', content: [{ type: 'input_text', text: MARK.subTask }], providerData: { agent: 'Explore', isSubAgent: true }, ...sb() });
      for (let i = 0; i < 2; i++) {
        t2 += 15_000;
        s2 += line({ type: 'function_call', id: 'sf' + i, callId: `sc_${sid.slice(-4)}_${i}`, name: i ? 'Grep' : 'Read', arguments: MARK.wbArgs, message: { usage: usage(i) }, providerData: pd({ agent: 'Explore', isSubAgent: true, messageId: `sm_${sid.slice(-4)}_${i}`, model: 'deepseek-v4-flash' }), ...sb() });
        t2 += 5_000;
        s2 += line({ type: 'function_call_result', id: 'sr' + i, callId: `sc_${sid.slice(-4)}_${i}`, status: 'completed', output: { type: 'text', text: MARK.output }, providerData: pd({ agent: 'Explore', isSubAgent: true, toolResult: { content: [MARK.toolResult] } }), ...sb() });
      }
      t2 += 10_000;
      s2 += line({ type: 'message', role: 'assistant', status: 'completed', id: 'se', content: [{ type: 'output_text', text: MARK.reply }], providerData: pd({ agent: 'Explore', isSubAgent: true, messageId: 'sme', model: 'deepseek-v4-flash' }), ...sb() });
      writeFileSync(join(sdir, `agent-${sid.slice(-8)}.jsonl`), s2);
    }
    out.push(sid);
    return f;
  };
  session(IDS.workbuddy[0], PROJECTS.report, at(8, 20), { tools: [['Read', 'ok'], ['WebSearch', 'ok'], ['Bash', 'exit'], ['Write', 'ok'], ['Edit', 'error']], end: 'done', sub: true });
  session(IDS.workbuddy[1], PROJECTS.report, Math.max(at(0, 4), now - 4 * 60_000), { tools: [['Read', 'ok'], ['mcp__tapd__list', 'ok'], ['Bash', 'open']], end: 'open', model: 'kimi-k3-1' });
  session(IDS.workbuddy[2], PROJECTS.docs, at(10, 40), { tools: [['Glob', 'ok']], end: 'error' });
  const old = session('0b0d0b0d-0000-4000-8000-000000000009', PROJECTS.docs, at(-40), { tools: [['Read', 'ok']], end: 'done' });
  const oldT = new Date(at(-39)); utimesSync(old, oldT, oldT);
  // Never read: WorkBuddy's database, tasks, traces, settings, memory and sign-in data, and the CodeBuddy extension.
  writeFileSync(join(root, 'workbuddy.db'), MARK.wbDb);
  mkdirSync(join(root, 'tasks', 'x'), { recursive: true });
  writeFileSync(join(root, 'tasks', 'x', '1.json'), JSON.stringify({ id: '1', subject: MARK.wbTask, description: MARK.wbTask, status: 'completed' }));
  mkdirSync(join(root, 'traces', '1'), { recursive: true });
  writeFileSync(join(root, 'traces', '1', 't.json'), JSON.stringify({ trace: { sessionId: IDS.workbuddy[0], name: MARK.wbTrace }, spans: [{ toolInput: MARK.wbTrace, toolOutput: MARK.wbTrace }] }));
  writeFileSync(join(root, 'settings.json'), JSON.stringify({ token: MARK.token }));
  writeFileSync(join(root, 'USER.md'), MARK.email);
  mkdirSync(join(home, 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth'), { recursive: true });
  writeFileSync(join(home, 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth', 'a.json'), JSON.stringify({ token: MARK.token }));
}
