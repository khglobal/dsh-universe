// DSH 0.2.2-rc.2 tool names → categories. Unknown names are `other`.
import type { Category, CategoryTable } from '@dsh-universe/model';

const T: Record<string, Category> = {};
const put = (c: Category, ...names: string[]) => { for (const n of names) T[n] = c; };
put('read', 'read', 'read_image', 'cordis_inspect_list', 'cordis_inspect_query', 'list_mcp_resources', 'list_mcp_resource_templates', 'read_mcp_resource');
put('search', 'glob', 'grep', 'session_search', 'session_event_search', 'session_trace', 'session_event_trace', 'session_event_read');
put('edit', 'write', 'edit', 'apply_patch', 'str_replace_editor', 'office_render', 'office_convert', 'office_recalculate');
put('exec', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill', 'run_code', 'create_worktree');
put('web', 'web_search', 'web_fetch');
put('delegate', 'subagent', 'subagent_claude_code', 'subagent_codex', 'list_subagent_models', 'send_message', 'interrupt_agent', 'list_agents', 'wait_agent', 'workflow',
  'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update');
put('skill', 'skill');
put('plan', 'exit_plan_mode', 'todo_write', 'get_goal', 'create_goal', 'update_goal', 'ralph', 'schedule_create', 'schedule_list', 'schedule_view', 'schedule_edit');
put('deliver', 'present');

/** `mcp__<server>__<tool>` (dsh-mcp-client `publicToolName`). */
const MCP = /^mcp__([A-Za-z0-9_-]+?)__/;

export function dshCategories(knownServers: () => readonly string[] = () => []): CategoryTable {
  return {
    platform: 'dsh',
    tools: T,
    connectorOf(tool) {
      if (!tool.startsWith('mcp__')) return undefined;
      // A known server name first: names may contain "__", and long names are hashed (never parse those).
      const known = knownServers().filter((s) => tool.startsWith('mcp__' + s + '__')).sort((a, b) => b.length - a.length)[0];
      if (known) return known;
      return MCP.exec(tool)?.[1];
    },
  };
}

export const DSH_TOOLS: Readonly<Record<string, Category>> = T;
