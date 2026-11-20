# Changelog

Member releases of `@khglobal/dsh-universe`. `scripts/release.mjs` uses the section for the version it cuts as the
release notes; without one, it lists the source commits since the last release.

## 0.3.2

- **The pile beside the Review Center is gone.** The quay plaza east of the hall held nine pieces of street
  furniture and three trees on nine tiles. They overlapped one another, the road and the lot to the south, and read
  as one mystery heap next to a session tower. It is now a café terrace, a newsstand, a tree in blossom and two
  signal masts, each on its own ground.
- **Nothing stands in anything else.** Trees no longer grow inside the town hall or a connector. The hall and the
  station are drawn in the right order against the furniture in front of and behind them. A tower's subagent pods
  stay on its lot, on the side facing the block's lane, instead of reaching onto the road. A new check holds every
  lot, civic building and piece of furniture to its own ground.
- **The time on a building's door is explained.** A building's card now says when the session started, for
  example "Started 00:01 (the time on its door)". As before, it names the folder and the number of subagents.
- **A busy folder stays put.** A new test runs ten minutes of short sessions and subagents coming and going, in a
  normal city and in a full one. Every session keeps its lot and its building, and a building only changes look
  when its state changes.

## 0.3.1

- **Install straight from GitHub.** The repository is now the plugin itself:
  `dsh plugin --profile web add github:khglobal/dsh-universe` installs it with nothing to build or approve, and the
  plugin page shows the README with its screenshots. The npm package is unchanged.
- **Much less CPU when left open.** After 10 seconds without input the city paints twice a second, after a minute
  once a second. It no longer rebuilds the whole city just because the clock moved, and the clock steps more slowly
  while nobody is looking. A busy 300-session day left alone went from about 7% of a core to about 4%, and to about
  2% after a minute.
- **Ambient sound you can actually hear.** 环境音 / Sound was nearly silent in 0.3.0, most of all in the nearby
  cities: it played below what laptop speakers reproduce. Every city now sounds in the audible range, a city at rest
  hums quietly, and the button has a speaker icon. A rendered-audio check guards it.
- **Real names on the map.** MCP Gateways show the connection's name (for example 海星ERP / Astero ERP) instead of
  the server id. Plugin Row and the list show plugin titles instead of package names. Base plugins that are running
  no longer show as disabled.
- **A full city keeps building.** Once the city has grown to its largest, a new session takes the lot of the oldest
  finished building from an earlier day. Before, new sessions got no building at all once about 150 had been placed.
  On a day with more sessions than the city holds, a calm note says how many are only in the list.
- **Review Centre counts agree.** The card, the Today bar and the desks inside give one figure. Sessions stopped on
  an error have their own floor.
- **Today means today.** Just after midnight, failed calls, tokens and "finished" count only what happened since
  midnight. Sessions carried over keep their buildings.
- **Time zones.** The timeline, clock and hour labels follow the host's day, so a browser in another time zone sees
  the right hours (with a zone label).
- **Small screens.** The zoom buttons, tour card, legend and room tooltips stay on screen and clear of each other at
  390 and 320 px. The timeline's hour labels no longer overlap at 320 px, and the list's buttons stay inside the
  window. Notes over the city no longer cover a room's back button.
- **Keyboard.** Enter opens the place the camera was sent to, marked with a crosshair. The list has "Go inside" for
  places and sessions. Focus returns to the city after the tour.
- **Today bar.** No more gap after a long scheduled-task title. The "+n local" breakdown can be read with the
  keyboard and by touch.
- **Nearby cities.** A running session looks running. A session whose process stopped no longer shows "Running" for
  half an hour.
- **Wording.** Consistent names in both languages. Scheduled tasks name the day of their next run. Notes say only
  what is true.

## 0.3.0

- Neighbouring cities, one per vendor: **Claude** (Claude Code and the Claude desktop app's agent sessions),
  **ChatGPT** (Codex) and **WorkBuddy**.
- Detected automatically: a city appears when its tool is on this device, with no setup; each source can be turned off
  under **Nearby cities**.
- Ambient sound for every city, driven by its own activity (off by default).
- Crisp rooms: pixel-exact at every display scale.
- The Nearby cities popover closes on click outside, Esc and its close button, and no longer covers the toolbar; the
  click that closes a popover no longer also enters a building.
- Much lower CPU use: the panel paints only what moves, slows down when left alone and almost stops in a background
  window.
- Midnight: running sessions, waits and schedules carry over into the new day instead of emptying the city.
- The Today bar wraps on narrow windows instead of cutting figures off.
- Robustness: a malformed stored record no longer stops the plugin; neighbour cities count subagents still working;
  "now" and look-back work before 06:00; keyboard focus returns after leaving a room; and more.
