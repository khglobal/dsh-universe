# Changelog

Member releases of `@khglobal/dsh-universe`. `scripts/release.mjs` uses the section for the version it cuts as the
release notes; without one, it lists the source commits since the last release.

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
