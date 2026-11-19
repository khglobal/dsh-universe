# DSH Universe: member guide

DSH Universe draws your DSH day as a small pixel city. Every session you start puts up a building, every agent is a
person, and every tool call shows up as traffic, light and work. Open it from **DSH Universe** in the DSH sidebar.

![The city on the sample day](img/guide-city.png)

## What the city shows

| In the city | In DSH |
| --- | --- |
| A building | One session. It grows a section for each kind of work it does (reading, editing, running commands, connectors…), with a band in that kind's colour on top. |
| A person | An agent. The colour under their feet is the state: Running, Needs you, Idle, Done or Failed. Subagents work inside their parent's building. |
| A sign held up in Review Square | That agent is waiting for you (an approval, a question, or a plan to read). |
| Cars on the avenues | Calls made in the last five minutes. |
| Lit windows at night | Only places that are working or waiting stay lit. An idle city stands still. |

The AI facilities stand round Review Square: the **Review Centre** (approvals, questions and plans), the **Scheduler**
(scheduled tasks), **Error Recovery** (errors and retries), the **Agent Academy** (skill loads and experts), **Skills &
Plugins** (what you installed) and one **Model Hub** per model. Each MCP server has its own **MCP Gateway**, and
installed plugins line **Plugin Row**. Workspaces are
districts, each with a sign showing the workspace's name.

Point at a building to see its card: what the session is doing, its calls, token use and time. **Open session**
on the card takes you to the session in DSH; clicking the building takes you inside. Open **Legend** for a one-page key. The first time you open
DSH Universe a four-step tour points these out; **Show the tour again** in the legend repeats it.

## Review Square and the data views

Review Square in front of the Review Centre is where agents wait for you. The first button of the Today row along the top shows how many
things need you, and the `n` key jumps to the next one. The row is ordered by urgency: waiting for you, scheduled,
running, to review, errors, tokens; a press switches to that layer and goes to the next item.

The **Show** buttons pick one question at a time and grey out everything else:

- **Scheduled**: sessions that scheduled tasks started today, and when the next one runs.
- **Running**: what is working right now.
- **To review**: finished sessions you have not opened yet.
- **Errors**: failed calls and sessions that stopped on an error.
- **Token use**: where today's tokens went.
- **Call volume**: which sessions and connectors are busiest.

![The Errors view](img/guide-errors.png)

**List** shows the same content as text, grouped by what needs you. It is the best view for screen readers and
small screens.

![The list view](img/guide-list.png)

## The timeline and replay

The timeline along the bottom covers today. Drag it, or use the arrow keys (one minute per press), to look back at
any moment: the city rebuilds itself as it stood then. `W` jumps to the next wait and `Shift+W` to the previous one.
**Replay today** plays the whole day forward; **Back to live** returns to now. You can minimise the timeline to a
thin bar.

## Going inside a building

Click a building, or choose **Go inside** on its card (with the keyboard, `Enter` opens the place in the middle of the view). A building opens
floor by floor; each kind of work has its own room, furnished from that session's real numbers: calls today, the
last error, what is on the shelves. Agents stand where they are working. Hover or tap a person or a piece of
furniture for a short card. Use **Floors** to change floor (the lift carries you between them) and **Back to the
city** or `Esc` to leave.

![Inside a building](img/guide-inside.png)

The AI facilities can be entered too: Skills & Plugins shows what you installed, the Agent Academy your skills and
experts, the Scheduler the day's scheduled tasks.

## Claude, ChatGPT and WorkBuddy

**Inside DSH.** When a session hands work to Claude Code or Codex (with DSH's Claude Code or Codex subagent plugins),
the run appears in that session's building as a person in the engine's colours (Claude Code: a terracotta jacket and
a cream cap; Codex: a dark hoodie with a teal visor), named "Claude Code" or "Codex". You see whether it is still
working, finished or failed. DSH does not report these runs' tool calls or token use, so their card says so.

**Neighbouring cities.** Other agent tools on the same computer get a city each, by vendor, automatically, with
nothing to click:

| City | Sources | Their people |
| --- | --- | --- |
| Claude | Claude Code; the Claude desktop app (Cowork, and sessions started in its Code tab) | Claude Code: terracotta jacket, cream cap. Claude app: cream jacket, terracotta cap |
| ChatGPT | Codex (the ChatGPT desktop app's agent work goes into the same store) | dark hoodie, teal visor |
| WorkBuddy | WorkBuddy | violet jacket, green headset |

Every session in those stores is there, including the ones you started outside DSH, and new sessions show up as you
start them. In the Claude city each session's card and list row says which product it is from ("Claude Code" or
"Claude app"), and Cowork sessions have a district of their own. A Code-tab session is saved in Claude Code's store as
well; it is shown once, as the Claude app's.

The first time, a one-line notice says so (with a link to the settings). The DSH city stays what you see first; a small
chip beside the view switch, such as "Claude · 3 running", shows each neighbour, and clicking it goes to that city.
Zoom out past the whole city (the `−` button or key, or the **Map of nearby cities** button) to see the cities side by side, each
with its sign; choose one to go in. Each city has the same buildings, rooms and data views; views with nothing to show
(schedules) are left out. A Claude Code session is titled with the name you gave it (`/rename`); other sessions by
project folder and date. In a cloud workspace there are no such tools, and nothing is shown.

**In the Today bar.** In the DSH city, the running, failed-call and token figures add the neighbours' sessions as
"+n local" (for example "3 sessions running +2 local"); hover for the breakdown by city. DSH's own figure comes first
and is what the button steps through. Runs a DSH session delegates to Claude Code or Codex are not saved in those
tools' session stores, so they are never counted twice.

**Turning it off.** Open **Nearby cities** (top right). Each source has its own switch, under its city: Claude Code
and Claude app under Claude, Codex under ChatGPT, WorkBuddy under WorkBuddy. Clear one and its reading stops, what was
read from it is dropped, and the choice is remembered on this device; a city whose sources are all off is no longer
shown. Turn it back on the same way. If you turned Claude Code or Codex off in an earlier version, it stays off. Only
metadata is read (see below), and nothing leaves your computer. A large store takes a few seconds to read the first
time; the DSH city is ready at once and the neighbours fill in as they are read. What was read is kept on this device,
so the next start reads only what changed.

## What it reads, and what it never reads

DSH Universe reads **metadata only**, on your own device:

- times, tool names, the kind of each call, token counts and whether a call failed;
- session and workspace titles (the same ones DSH shows in its own lists), model names, connector names and their
  status, the plugins and skills you installed, scheduled-task names and times.

It **never** reads your messages, the model's replies or thinking, tool arguments or results, file contents, error
text or file paths. Session metadata of Claude Code, the Claude desktop app, Codex and WorkBuddy on this device is
shown automatically when those tools are installed (the same kinds of fields: times, tool names, token counts, error
flags, models, project folder names), from their agent session files only: never chats (claude.ai and ChatGPT chats are
in the vendor's cloud, not on this device), browser storage, cookies, sign-in or token files, or the apps' databases.
Turn any source off under **Nearby cities**. The README lists exactly which files are read. A subagent's title is its prompt, so subagents are shown by their preset name or as "Subagent n".
Nothing is uploaded and nothing is put into any prompt. The day's summary is kept in DSH's own storage on this
device and deleted after 14 days.

## Sound

**Sound** in the toolbar (off by default) turns on the city's ambience: a low murmur while sessions run, soft ticks
for calls, a falling sign while calls fail, and two low notes every 2.4 seconds while someone waits in Review Square.
Every city (DSH, Claude, ChatGPT, WorkBuddy) has its own pitch and follows its own activity; only the city you are in
plays, and moving to another crossfades. Zoomed out to all cities, they play quietly together and the card you point
at or focus comes forward, so you can hear which city is busy. It starts with your first click (browsers allow no sound
before), and stays silent in the list view, while looking back or replaying, and with reduced motion.

## One city per device

Each device builds its own city. Where a building stands, which results you have seen, and your view settings
(legend, timeline, city or list) are stored on that device and not synced. Your desktop and a cloud environment
each have their own city, and the same session may stand on a different plot in each.

## Accessibility

Everything in the city is also in the list view. In the city, the arrow keys pan, `+` and `−` zoom, `0` returns to
Review Square, `Enter` opens the place in the middle and `Esc` goes back. With reduced motion turned on in your system,
the city updates at most twice a second and nothing flashes.
