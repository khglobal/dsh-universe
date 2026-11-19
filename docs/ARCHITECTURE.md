# DSH Universe: architecture and extension points

How the packages fit together, and where new work plugs in.

## Packages

| Package | Role | Depends on |
| --- | --- | --- |
| `model` | Types, the store, placement, themes, rooms, whereabouts, today bar, layers. Pure, no drawing. | — |
| `renderer` | Scenes, camera, hit testing, text layer, frame loop. Draws only through an `ArtKit`. | `model` |
| `art` | The proprietary art kit (palette, sprites, templates, street, people, cars). Separable. | `model`, `renderer` (types) |
| `adapter-dsh` | Host aggregator, storage, placement keeper, routes, plugin identity (`identity.ts`). | `model`, `adapter-kit` |
| `adapter-claude-code`, `adapter-codex` | The neighbouring cities: Claude Code and Codex session stores on this device, metadata only, built on `adapter-kit/local` (incremental byte-offset reading, a time budget, 14 days, a checkpoint the plugin keeps across restarts). Shown by default wherever a store is found; the host also serves each city's figures (`n.summary`) for the DSH Today bar and the chips. | `model`, `adapter-kit` |
| `plugin` | Host entry, client registration, React panel. | all |

Without the art package the plugin still runs: `plugin/src/client/kit.ts` is the one line that picks the kit
(`createArtKit()` from `art`, or `createStubKit()` from `renderer`).

## The frame (renderer)

`CityView` (`renderer/src/view.ts`) owns one city canvas:

1. `buildScene` (`scene.ts`, pure): store + placement + T → places, agents, signs, pools, car count. Rebuilt when the
   input, hover, light or the animation clock (in twelfths of a second) changes.
2. `paintCity` (`paint.ts`): into a low-resolution **art buffer**. A cached **static layer** holds the ground and
   everything still (street furniture, trees, still buildings). It is rebuilt only when one of them changes. Each
   frame then blits that layer, draws the moving things (running and waiting towers, cars, agents), and draws again
   every still sprite that stands in front of a moving one.
3. **Overlays, art stage** (see below).
4. The art buffer is scaled to the screen by a whole number (`scaleOf`).
5. **Text layer** (`text.ts`): signs at screen resolution, on whole pixels; a sign behind a sprite is cut out by
   drawing that sprite again over it.
6. **Overlays, screen stage.**
7. `onFrame(view)`: the panel moves its DOM name plates and hover card.

The loop paints only when something changed or something moves (`scene.animated`, or an overlay's `animated()`).
Under reduced motion there are no tweens, the clock is 0 and there are at most two frames a second.

## Extension point 1: `ArtKit` (renderer/src/artkit.ts)

Everything the renderer draws comes from the kit; sprites come back already snapped to the palette and outlined.

- `building(spec)`, `civic(spec)`: return a `Drawn` (a `Sprite`, plus `top` for markers and `extras` for moving
  parts drawn as their own sprites, like the crane).
- `ground`, `item`, `car`, `pool`: return sprites.
- `person`, `smoke`, `balloon`: draw whole-pixel rectangles through a `PixelPen`.
- `beginFrame()`: optional; spreads costly redraws over frames.
- `memory()`: sprite count and bytes.
- `room(spec, part?)`, `roomLayout(room)`, `stack(floors)` and `rooms`: the interiors. `room` returns the
  sprite of one floor without its people (a 12×12 template room or a 5.2×5.2 fixed scene); with `part` it paints
  one band of a moving room per call so no frame pays for a whole room. `roomLayout` gives the room's size, the
  spots agents stand on and the lift. Templates are in `art/src/templates/rooms/*.ts`, the prop library in
  `art/src/props/*.ts`, the five floor plans in `art/src/plans.ts`. The spec carries only counts, ages, states
  and the clock; `act` false (nobody works on this floor) means the room is one still picture.

The art package keeps its own state (light, sprite cache) per kit: `createArtKit({ make?, budgetBytes? })`. Tests
pass a fake surface factory (`art/tests/fake-canvas.ts`).

## The inside view (renderer `room-scene.ts`, `room.ts`)

`interiorOf` (pure): store + placement + T + place → floors bottom first (`floorsOf`), the template of each room
floor (`roomsOfSession`: from the frozen theme id and the session seed, never twice in a building), the agents on
each floor and their latest tool. `RoomView` draws one floor like `CityView` draws the city: an art buffer scaled
by a whole number, the floor stack on the left, people at the plan's spots (newcomers from the lift), tool names
on the text layer, an entry fade, and a loop that stops when nothing moves. The panel's place view is
`plugin/src/client/Interior.tsx` (registered in `interior-view.ts`).

## Extension point 2: overlays in the frame loop (renderer)

```ts
interface Overlay {
  id: string;
  art?(o: OverlayFrame): void;                     // on the art buffer, after the city, before scaling
  screen?(o: OverlayFrame & { toScreen }): void;   // on the screen canvas, after the text layer
  animated?(o: OverlayFrame): boolean;             // keep the loop running while true
}
interface OverlayFrame { ctx; kit; scene; last: PaintResult; layer: string; time; reducedMotion; dpr }
const off = view.addOverlay(overlay);   // returns its removal
view.setLayer('errors');                // the toolbar's layer id; overlays read `o.layer`
```

In the art stage the transform puts world art pixels where `artXY(x, y, z)` says. `last.tops`, `last.heads` and
`last.blits` give the positions and sprites drawn this frame: draw them again to keep something in colour after
greying the buffer. Rules: no text in the art stage (signs go on the screen stage, whole pixels, host font); no
semi-transparent pixels in the art stage; anything that moves must be data-driven, and nothing moves under reduced
motion.

**Data views** live in `renderer/src/overlay*.ts`. The panel registers them with
`registerOverlay(factory)` from `plugin/src/client/extensions.ts`; the factory gets `{ t, lang }` and returns an
`Overlay`.

## Extension point 3: views of a place in the panel (plugin)

```ts
registerPlaceView({
  id: 'interior',
  matches: (placeId) => placeId.startsWith('b:') || placeId === 'town',
  Component: InteriorView,   // gets PlaceViewProps: placeId, store, placement, T, titles, t, lang, close, onOpen
});
```

A click on a place selects it and opens its card. The card shows a "go inside" button when a registered view
matches, and the view then covers the city until `close()`. Place ids are `b:<root session id>`, `town`, `station`,
`fire`, `school`, `library`, `conn:<id>`, `model:<name>` and `shop:<plugin id>`. Register at module load, from a
file that `plugin/src/client/register.ts` imports.

## The panel (plugin/src/client)

| File | What |
| --- | --- |
| `UniversePanel.tsx` | The `main` panel: today bar, city/list toggle, `n` / `N`. It owns `T` (the moment shown); replay sets it here. |
| `CityPanel.tsx` | Canvas, pointer and keys, name plates, hover card, toolbar (layer buttons, legend), zoom. |
| `Timeline.tsx` | The timeline dock: clock, live, calls per ten minutes; minimisable. |
| `chrome.ts` | The hard-edged chrome styles. |
| `extensions.ts` | `registerPlaceView`, `registerOverlay`. |
| `prefs.ts` | Legend open, timeline minimised, city or list (per device). |
| `kit.ts` | Which art kit. |

Interface text only comes from `plugin/src/locales/{zh,en}.ts` (`npm run check-no-inline-text`); "token" is never
translated. Titles appear only in the DOM (name plates, cards, list), never in pixels.

## Checks

- `npm run check`: type check, build, unit tests, locale tables, no inline text.
- `node scripts/city-check.mjs --golden`: fixed-time screenshots (centre, whole city, light and dark, empty
  workspace) against `fixtures/golden/`. Add `--update` to rewrite them. Needs a headless Chromium; set
  `CHROME_PATH` if Playwright's is not installed. It skips cleanly without one.
- `node scripts/city-check.mjs --perf [--gpu]`: frame times and sprite memory at 100 buildings, 30 running and
  10 events a second.
- `node scripts/city-check.mjs --shots <dir>`: screenshots for review.
