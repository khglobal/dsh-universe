# DSH Universe

**The all-in-one, real-time agent monitor for DeepSeek Harness.** AI agent data visualization that turns every
session and task across all your DSH workspaces into a live, interactive pixel city: sessions are buildings, agents
are people. One glance tells you what is running, what is waiting on you, what failed, where the tokens went and what
is scheduled next. Metadata only, read on your own device.

![The live city: agents walk between buildings, a new session goes up, agents line up in Review Square, a scheduled run arrives by train, and Error Recovery's engines drive out to a fire](https://raw.githubusercontent.com/khglobal/dsh-universe/dev/docs/screenshots/city.gif)

## Features

- **Real-time overview.** Every session and agent across all workspaces, live. The Today bar counts what needs you,
  the next scheduled task, what is running, results to review, failed calls and token use; press one to jump to it.
- **Needs you.** Agents waiting for an approval, an answer or a plan to read gather in Review Square, standing out
  more the longer they wait. One click opens the session in DSH.
- **Errors.** Fires on buildings with failed calls, fire engines on the way, and Error Recovery, which counts retries
  and keeps a repair log.
- **Token and model use.** A power grid: one Model Hub per model with its load, and each building's token use today.
- **Call volume.** Roads and cars show the calls of the last 5 minutes.
- **Schedules.** Scheduled runs arrive as trains at the Scheduler; a clock points at the next one.
- **To review.** Finished sessions you have not seen, unsent drafts and delivered files are marked until you open them.
- **Inside each session.** Each building grows with its work. Go inside to rooms themed by the session title, with
  agents and subagents at their desks posed by the tool they use, and clickable data props: call tape, call log
  board, error beacon and job printers.
- **Timeline.** Look back at any minute of today, replay the day, and see totals for the last 14 days.
- **Workspace-aware.** Each workspace is its own district; buildings keep their place.
- **Works with Claude Code and Codex.** Work a session delegates to Claude Code or Codex (DSH's official subagent
  plugins) stands in that session's building in the engine's colours, named after it, with its status. Optional
  neighbouring cities: when Claude Code or Codex is on the same device, a hint offers to show its sessions as a city
  beside the DSH one; zoom out to see them side by side, each with its sign, and go in for the same buildings, rooms and
  data views. Off by default, one click on or off, and a switch under **Nearby cities**.
- **Day and night.** Auto, day or night; at night only places that are working or waiting are lit.
- **Accessible.** Keyboard control, a screen-reader list view, reduced motion, light and dark themes, English and
  Chinese.
- **Fast.** Built for 60 fps; it still draws with no GPU.
- **Private by design.** Metadata only, never chat or tool content; nothing leaves your device. The Claude Code and
  Codex cities read only once you turn them on.

![Inside a session building: the call tape, error beacon and job printer cards, changing floor, agents moving between desks](https://raw.githubusercontent.com/khglobal/dsh-universe/dev/docs/screenshots/indoor.gif)

![The list view](screenshots/list.png)

The screenshots and animations use made-up sample data.

## Install

Needs DeepSeek Harness 0.2.2-rc.2 or newer.

1. Open **Plugins** and click **Add plugin**.
2. Enter `@khglobal/dsh-universe` and click **Install**.
3. When it says **Installed**, click **Enable now**.

**DSH Universe** then appears in the sidebar. No restart is needed.

**Command line**, for advanced users:

    dsh plugin --profile web add @khglobal/dsh-universe

Use the name of your profile in place of `web`, and restart DSH after installing from the command line.

## What it reads

Metadata only, on your own device:

- times, tool names, the kind of each call, token counts and whether a call failed;
- session and workspace titles (the ones DSH already shows in its lists), model names, connector names and status,
  your installed plugins and skills, and scheduled-task names and times.

It **never** reads your messages, the model's replies or thinking, tool arguments or results, file contents, error
text or file paths. Subagents are shown by their preset name, not their prompt.

For runs delegated to Claude Code or Codex inside DSH: their start, end, engine and whether they failed; never their
task or answer.

The Claude Code and Codex cities, once you turn them on, read their session files on this device for session ids,
times, project folder names, models, token counts, tool names and counts, error flags, turns, retries and subagents,
and a title only when you set one yourself. Never messages, prompts, replies, reasoning, tool input or output,
commands, file contents, error text, generated summaries or your prompt history. Read incrementally, at most 14 days
back.

## Privacy

- Nothing is uploaded. The plugin makes no network requests of its own; the panel talks only to your own DSH.
- Nothing is put into any prompt, and it adds no tools for the model.
- The day's summary is kept in DSH's storage on this device for 14 days. Each device has its own city; nothing is
  synced.

## Licence

**Source-available, not open source.** You may read the code, and install and use the unmodified plugin with DeepSeek
Harness. Copying, modifying, redistributing or reusing the code or the art (including the procedural art and
templates) in other works needs KH's written permission. Copyright KH. See [LICENSE](LICENSE). Source: https://github.com/khglobal/dsh-universe
