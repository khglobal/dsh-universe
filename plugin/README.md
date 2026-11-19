# DSH Universe (`@khglobal/dsh-universe`)

The all-in-one, real-time agent monitor for DeepSeek Harness: AI agent data visualization that shows every session and
task across all workspaces as a live, interactive pixel city. Sessions are buildings and agents are the people; errors,
token use, call volume, schedules and items waiting on you are shown at a glance. One entry in the sidebar opens the
city panel, the list and the Today bar.

It reads host metadata only (session state, tool names, usage, times), never session content, plan text or replies.

Works with Claude Code and Codex: runs a DSH session delegates to them stand in its building, named after the engine.

Neighbouring cities, one per vendor, shown automatically when their agent tools are on the same device and counted
in the Today bar as "+n local":

- **Claude**: Claude Code (`~/.claude/projects`) and the Claude desktop app's agent sessions (Cowork, and sessions
  started in its Code tab), each tagged with its product. A Code-tab session is also in Claude Code's store; it is
  counted once, as the Claude app's.
- **ChatGPT**: Codex (`~/.codex/sessions`, `~/.codex/archived_sessions`).
- **WorkBuddy**: WorkBuddy's sessions (`~/.workbuddy/projects`).

Metadata only (times, tool names and counts, token counts, models, error flags, subagents, project folder names), read
from those session files on this device; nothing leaves it. Never read: messages, prompts, replies, reasoning, tool
input or output, file contents, error text, generated titles, chats with Claude or ChatGPT (kept in the vendor's cloud),
browser storage, cookies, account or token files, databases. Each source is on by default and has its own switch under
**Nearby cities**; turning one off stops the reading and drops what was read.

On the Astero workbench home, the Today tile (`@khglobal/dsh-universe#today`) shows what needs you, running sessions,
failed calls, tokens and the next scheduled task, with the same "+n local" part, and opens the city on a click.

## Desktop and cloud

- Works in both, with the same plugin package.
- The city's layout is kept in each host's own storage: desktop and cloud each have their own city, not synced.
- In the cloud, a newly installed plugin loads the next time the workspace starts.

## Install

In DSH: open **Plugins**, click **Add plugin**, enter `@khglobal/dsh-universe` and click **Install**.

## Source

The source is public at `khglobal/dsh-universe` under a source-available licence: you may read the source and install
and use the unmodified plugin; copying, modifying, redistributing or using the code and art in other works needs KH's
written permission. See `LICENSE`.
