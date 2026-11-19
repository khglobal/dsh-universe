# DSH Universe

Your DeepSeek Harness day as a small pixel city. Every session is a building and every agent is a person. One look
tells you what is running, what is waiting for you and what got done today.

![The city on a sample day](screenshots/city.png)

## What it shows

- **The city.** A building for each session, growing as the session works. Agents that need you (an approval, a
  question, a plan to read) hold up a sign in the square.
- **Today.** A row along the top: what needs you, the next scheduled task, what is running, results to review, failed
  calls and token use. Press one to jump to it.
- **Show.** Scheduled, Running, To review, Errors, Token use or Call volume: one kind at a time, the rest greyed out.
- **Inside a building.** One floor for each kind of work, with the agents standing where they work.
- **Timeline.** Drag back to any moment of the day, or replay it.
- **List.** Everything in the city as text, for screen readers and small screens.

Point at a building and press **Open session** on its card to go to that session in DSH. Click the building to go
inside.

![Inside a building](screenshots/inside.png)

![The list view](screenshots/list.png)

The screenshots use made-up sample data.

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

## Privacy

- Nothing is uploaded. The plugin makes no network requests of its own; the panel talks only to your own DSH.
- Nothing is put into any prompt, and it adds no tools for the model.
- The day's summary is kept in DSH's storage on this device for 14 days. Each device has its own city; nothing is
  synced.

## Licence

**Source-available, not open source.** You may read the code, and install and use the unmodified plugin with DeepSeek
Harness. Copying, modifying, redistributing or reusing the code or the art (including the procedural art and
templates) in other works needs KH's written permission. Copyright KH. See [LICENSE](LICENSE). Source: https://github.com/khglobal/dsh-universe
