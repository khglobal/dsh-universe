# DSH Universe

**The all-in-one, real-time agent monitor for DeepSeek Harness.** AI agent data visualization that turns every
session and task across all your DSH workspaces into a live, interactive pixel city: sessions are buildings, agents
are people.

![The live city: agents walk between buildings, a new session goes up, agents line up in Review Square, a train brings a scheduled run to the Scheduler, and in the Errors view Error Recovery's engines drive out to a fire](docs/screenshots/city.gif)

One glance tells you what is running, what is waiting on you, what failed, where the tokens went and what is
scheduled next. Errors, token use, call volume, schedules and finished work each have their own view, and one click
takes you to the session in DSH. It reads metadata only, on your own device.

All screenshots and animations use a made-up sample day (`fixtures/dsh-sample.ts`). No real sessions or data.

## Features

**Real-time overview**
- Every session and agent across all workspaces, live, in one city.
- The **Today** bar counts what needs you, the next scheduled task, what is running, results to review, failed calls
  and token use. Press one to jump to it; `n` goes to the next thing waiting for you.
- A **list view** with the same content as text.

**Needs you**
- Agents waiting for an approval, an answer or a plan to read gather in Review Square holding a sign.
- They stand out more the longer they wait.
- One click follows the agent; **Open session** takes you to it in DSH.

**Errors**
- Fire layer: a fire on each building with failed calls, bigger for more failures; recent ones burn, older ones
  smoulder, and fire engines drive out to them.
- Error Recovery counts today's retried model requests and keeps a repair log.

**Token and model use**
- Power-grid layer: one Model Hub per model with its load, and a wire to each building from the model it used most.
- A meter beside each building shows its token use today; the top three get a bolt overhead.

**Call volume**
- Traffic layer: roads turn yellow, orange and red with the calls of the last 5 minutes, and cars stand for calls.

**Schedules**
- Scheduled runs arrive as trains at the Scheduler.
- A clock over the Scheduler points at the next scheduled task; each building's clock shows when it started.

**To review**
- Sessions that finished and you have not looked at, sessions with an unsent draft, and delivered files are marked on
  their roofs until you open them or mark them as seen.

**Inside each session**

![Inside a session building: the cursor opens the call tape, error beacon and job printer cards, changes floor, and the agents move between desks as their tools change](docs/screenshots/indoor.gif)

- Each session is a building that grows with its work.
- Click it to go inside: real rooms themed by the session title, with floor size following the building's size.
- Agents and subagents sit at their desks, posed by the kind of tool they are using.
- Data props you can click: the call tape, call log board, error beacon and job printers.

**Timeline**
- Look back at any minute of today, or replay the whole day.
- Totals for each of the last 14 days.

**Workspace-aware**
- Each workspace is its own district with a sign; buildings keep their place from day to day.

**Works with Claude Code and Codex**
- Inside DSH: work a session delegates to Claude Code or Codex (DSH's official `dsh-subagent-claude-code` and
  `dsh-subagent-codex` plugins) shows up as an agent in that session's building, in the engine's own colours and named
  "Claude Code" or "Codex", with its status and whether it failed. Its task and its answer are never read.
- Neighbouring cities, automatic: when Claude Code or Codex is on the same device, its sessions appear as a city next
  to the DSH one, with no setup, including sessions started outside DSH; new sessions show up live. The DSH city stays
  the default view: a small chip such as "Claude Code · 3 running" shows the neighbours, and one click goes there.
  Zoom out past the whole city to see the cities side by side, each with its sign; go into one for the same
  buildings, rooms and data views (errors, token use, call volume, waits). A switch for each under **Nearby cities**
  turns one off, and that choice is remembered. Silent where neither is installed, as in a cloud workspace.
- The Today bar's running, failed-call and token figures add those local sessions, labelled "+n local", with the
  breakdown by source (DSH, Claude Code, Codex) on hover. Runs DSH delegates to Claude Code or Codex keep no session of
  their own in those tools' stores, so nothing is counted twice.
- On the Astero workbench home, the **Today** tile (`@khglobal/dsh-universe#today`; 4×2, 2×2 or 4×1) shows the still
  mini city with what needs you, what is running, failed calls, tokens and the next scheduled task. Running, failed
  calls and tokens carry the same "+n local" part; the tile asks for those figures only while it is on screen, about
  once every 45 seconds. A click opens the city.

**Day and night**
- Auto (follows the DSH theme), day or night. At night only places that are working or waiting are lit.

**Accessible**
- Full keyboard control and a screen-reader list view.
- Respects reduced motion.
- Light and dark themes; English and Chinese interface.

**Fast**
- Built for 60 fps frames and checked with 100 buildings; it still draws with no GPU (software rendering).

**Private by design**
- Metadata only: never your messages, replies, tool arguments or results, or file contents.
- Nothing leaves your device.
- Claude Code and Codex cities are shown automatically when those tools are on your device, and read only what is
  listed under [What it reads](#what-it-reads). Turn either off under **Nearby cities**.

## Gallery

| | |
| --- | --- |
| ![The city at night: only places with work in progress are lit](docs/screenshots/city-night.png) | ![The Errors view: failed calls in colour, everything else greyed out](docs/screenshots/layer-errors.png) |
| **Night.** Only the places with a session in progress are lit. | **Errors.** One kind of data at a time; the rest of the city is greyed out. Token use and call volume work the same way. |
| ![Agents waiting for you in Review Square](docs/screenshots/square.png) | ![The timeline replaying the day](docs/screenshots/replay.png) |
| **Review Square.** Agents that need you (an approval, a question, a plan to read) wait in Review Square with a sign. | **Timeline.** Drag back to any moment of the day, or replay it. |
| ![Inside a building: the market desk floor](docs/screenshots/room-market.png) | ![Inside a building: the help desk floor](docs/screenshots/room-helpdesk.png) |
| **Inside a building.** One floor for each kind of work, with the agents standing where they work. | Each kind of floor has its own room, and rooms are laid out like the real thing. |
| ![The list view](docs/screenshots/list.png) | |
| **List.** Everything in the city as text, for screen readers and small screens. | |

## Install

Needs DeepSeek Harness **0.2.2-rc.2 or newer**.

1. Open **Plugins** and click **Add plugin**.
2. Enter `@khglobal/dsh-universe` and click **Install**.
3. When it says **Installed**, click **Enable now**.

**DSH Universe** then appears in the sidebar. No restart is needed.

Command line, for advanced users:

```sh
dsh plugin --profile web add @khglobal/dsh-universe
```

Use the name of your profile in place of `web`, and restart DSH after installing from the command line.

## What it reads

Metadata only, on your own device:

- times, tool names, the kind of each call, token counts and whether a call failed;
- session and workspace titles (the ones DSH already shows in its lists), model names, connector names and status,
  your installed plugins and skills, and scheduled-task names and times.

It **never** reads your messages, the model's replies or thinking, tool arguments or results, file contents, error
text or file paths. Subagents are shown by their preset name, not their prompt.

**Runs delegated to Claude Code or Codex inside DSH:** that a run started and ended, its engine, whether it failed,
and the delegating call's tool name and time. DSH reports no tool calls or token use for these runs, so none are
shown. The task description and the run's answer are never read.

**Claude Code and Codex cities** (shown automatically when the tool is on this device, until you turn its city off),
from their session files on this device (`~/.claude/projects`, `~/.codex/sessions` and `~/.codex/archived_sessions`):

- read: session ids, times, the project folder's name (the full path never leaves the plugin's host side, and only
  as a hash), model names, token counts, tool names and counts, whether a call failed (an error flag, an exit code),
  turns starting and ending, retried requests, subagents and their preset names;
- a session's title only when you set one yourself (Claude Code's `/rename`); otherwise sessions are named by project
  folder and date;
- **never**: messages, prompts, the model's replies or reasoning, tool input or output, commands, patches, file
  contents, error text, generated titles or summaries, your prompt history, account ids or links.

Large stores are read incrementally (only what was added since the last look, from today's first line, at most 14
days back), in small steps that never hold up DSH: the DSH city is ready first and the neighbours fill in after. What
was read (file hashes, read positions and the metadata above, never a path or any content) is kept in DSH's storage
on this device, so the next start reads only what changed.

## Privacy

- **Local Claude Code and Codex sessions are shown automatically.** If Claude Code or Codex is installed on this
  device, their session metadata (the fields under [What it reads](#what-it-reads), never messages, prompts or tool
  content) is shown as neighbouring cities and counted in the Today bar, with no click. To turn it off, open
  **Nearby cities** (top right of the panel) and clear the switch for that tool: reading stops, what was read is
  dropped, and the choice is remembered on this device. In a cloud workspace there are no such stores, so nothing is
  shown.
- Nothing is uploaded. The plugin makes no network requests of its own; the panel talks only to your own DSH.
- Nothing is put into any prompt, and it adds no tools for the model.
- The day's summary is kept in DSH's storage on this device for 14 days. Each device has its own city; nothing is
  synced.

## Development

Node 24.21 or newer.

```sh
npm ci
npm run dev        # the panel on the sample day at http://127.0.0.1:5174/ (?lang=en, ?theme=dark)
npm run check      # typecheck, build, tests, locale checks, npm tarball audit
```

The README animations are recorded from the real panel on the sample day with a fixed clock, so they come out the
same every time: `CHROME_PATH=<chrome-headless-shell> node scripts/readme-gifs.mjs` (needs FFmpeg; gifsicle is used
when it is installed).

How the packages fit together: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). User guide:
[docs/USER-GUIDE.en.md](docs/USER-GUIDE.en.md).

## Security

See [SECURITY.md](SECURITY.md).

## Licence

**Source-available, not open source.** You may read the code, and install and use the unmodified plugin with DeepSeek
Harness. Copying, modifying, redistributing or reusing the code or the art (including the procedural art and
templates) in other works needs KH's written permission. Copyright KH. See [LICENSE](LICENSE).
