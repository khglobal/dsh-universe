# DSH Universe (`@khglobal/dsh-universe`)

The all-in-one, real-time agent monitor for DeepSeek Harness: AI agent data visualization that shows every session and
task across all workspaces as a live, interactive pixel city. Sessions are buildings and agents are the people; errors,
token use, call volume, schedules and items waiting on you are shown at a glance. One entry in the sidebar opens the
city panel, the list and the Today bar.

It reads host metadata only (session state, tool names, usage, times), never session content, plan text or replies.

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
