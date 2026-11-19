// The page scripts/room-check.mjs drives: the inside view (RoomView) with the real art kit on the sample day.
// window.show({ place, floor, room, dark, reduced, w, h }) opens a place; window.perf(...) measures frames;
// window.grid(...) paints rooms side by side (review sheets).
import { createArtKit, ROOMS } from '@dsh-universe/art';
import { createStore, FLOOR_KINDS, idxAt, FLOOR_OF, type FloorKind } from '@dsh-universe/model';
import { RoomView, interiorOf, defaultFloor, tokenRate, type Interior } from '@dsh-universe/renderer';
import { dshSample } from '../../fixtures/dsh-sample.ts';

const midnight = new Date(2026, 10, 18).getTime();
const fx = dshSample(midnight);
const store = createStore(); store.applyAll(fx.events);
const kit = createArtKit();
let clock = 0, reduced = false;
const canvas = document.getElementById('cv') as HTMLCanvasElement;
const view = new RoomView({ kit, canvas, reducedMotion: () => reduced, raf: () => 0, cancelRaf: () => {}, clock: () => clock });
view.start();

/** The building with the most calls on a kind of floor (where a template preview gets real data). */
function busiest(kind: FloorKind): string {
  const per = new Map<string, number>();
  for (const s of store.agents()) {
    const root = s.agent.parentAgentId ? store.agent(s.agent.parentAgentId) ?? s : s;
    const k = idxAt(s, fx.now);
    for (let i = 0; i < k; i++) if (FLOOR_OF[s.ev[i].category] === kind) per.set(root.agent.sessionId, (per.get(root.agent.sessionId) ?? 0) + 1);
  }
  return 'b:' + [...per].sort((a, b) => b[1] - a[1])[0][0];
}
let it: Interior | undefined;
declare global { interface Window { show(o: Record<string, unknown>): unknown; perf(frames: number, step: number): unknown; ROOM_IDS: string[]; frame(ms: number): unknown; go(floor: string, frames: number): unknown; grid(ids: string[], o: Record<string, unknown>, cols: number): void } }
window.ROOM_IDS = ROOMS.map((r) => r.id);
window.show = (o) => {
  const room = o.room as string | undefined;
  const kind = room ? (ROOMS.find((r) => r.id === room)!.floors[0]) : undefined;
  const placeId = (o.place as string) ?? (kind ? busiest(kind) : 'b:s7');
  const T = (o.T as number) ?? fx.now;
  reduced = !!o.reduced;
  const ovFloor = ((o.floor as FloorKind | undefined) ?? kind) as FloorKind;
  it = interiorOf({ store, placement: fx.placement!, T, placeId, catalog: ROOMS, caps: fx.platform.caps, override: room && kind ? { floor: ovFloor, room, ...(o.tier ? { tier: o.tier as never } : {}) } : undefined, templateTags: kit.buildingTags, roomTier: kit.roomTier });
  if (o.tier) it = { ...it, tier: o.tier as never };
  const floor = (o.floor as string) ?? (kind && it.floors.some((f) => f.id === kind) ? kind : defaultFloor(it));
  view.setDark(!!o.dark);
  view.resize((o.w as number) ?? 1280, (o.h as number) ?? 760, (o.dpr as number) ?? 1);
  canvas.style.width = ((o.w as number) ?? 1280) + 'px'; canvas.style.height = ((o.h as number) ?? 760) + 'px'; canvas.style.background = kit.sky();
  view.setInput({ interior: it, floor, T, rate: tokenRate(store, placeId, T) });
  clock += 1000; view.paint(clock); clock += 1000; view.paint(clock);
  return { placeId, floor, floors: it.floors.map((f) => [f.id, f.room, f.people.length, f.act, f.recent.length, f.jobs]), animated: view.animated, geometry: view.geometry };
};
window.go = (floor, frames) => { if (!it) return; const cur = (view as unknown as { input: { T: number; rate?: number } }).input; view.setInput({ interior: it, floor, T: cur.T, rate: cur.rate }); for (let i = 0; i < frames; i++) { clock += 16; view.paint(clock); } return view.animated; };
window.frame = (ms) => { clock += ms; view.paint(clock); return view.animated; };
window.perf = (frames, step) => {
  view.resetStats();
  for (let i = 0; i < frames; i++) { clock += step; view.paint(clock); }
  return { ...view.stats(), roomPaints: view.roomPaints };
};
window.grid = (ids, o, cols) => {
  // `o.scale`: device pixels per art pixel (whole); `o.tier`: the floor size (default the building's largest).
  const cv = canvas, k = Math.max(1, Math.round((o.scale as number) ?? 1)), W = 404 * k, H = 236 * k;
  cv.style.width = W * cols / k + 'px'; cv.style.height = H * Math.ceil(ids.length / cols) / k + 'px';
  cv.width = W * cols; cv.height = H * Math.ceil(ids.length / cols);
  const c = cv.getContext('2d')!; kit.setLight({ dark: !!o.dark }); c.imageSmoothingEnabled = false; c.fillStyle = kit.sky(); c.fillRect(0, 0, cv.width, cv.height);
  ids.forEach((room, i) => {
    const s = kit.room({ id: 'g' + i, room, floor: 'library', place: 'building', colour: '#6C7BEA', seed: 7, act: !!o.act, frame: o.act ? 33 : 0, reduced: false, night: !!o.dark, na: false, n: 40, recent: [{ age: 2, err: false }, { age: 9, err: true }], jobs: 1, subs: [], out: 0, queue: 0, rate: 0, hour: 15.5, ...(o.tier ? { tier: o.tier as never } : {}) })!;
    c.drawImage(s.image, (i % cols) * W, Math.floor(i / cols) * H, s.w * k, s.h * k);
  });
};

/**
 * Pixel size and detail of a picture (RGBA, w×h; transparent pixels are outside it). `fine`: of the aligned 2×2 blocks
 * that touch the picture, the share that is not one colour, at the best of the four grid phases (0 for art drawn on a
 * 2-pixel grid, well above 0 for art at one art pixel). `edges`: colour changes between neighbours inside the picture
 * per opaque pixel. `colours`: distinct opaque colours.
 */
function density(d: Uint8ClampedArray, w: number, h: number): { n: number; fine: number; edges: number; colours: number } {
  const u = new Uint32Array(d.buffer, d.byteOffset, w * h), at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3] ? u[y * w + x] : 0);
  let n = 0, edges = 0;
  const colours = new Set<number>();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = at(x, y);
    if (!v) continue;
    n++; colours.add(v);
    const r = at(x + 1, y), b = at(x, y + 1);
    if (r && r !== v) edges++;
    if (b && b !== v) edges++;
  }
  let fine = 1;
  for (const [px, py] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    let blocks = 0, mixed = 0;
    for (let y = py - 1; y < h; y += 2) for (let x = px - 1; x < w; x += 2) {
      const q = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)];
      if (!q.some(Boolean)) continue;
      blocks++;
      if (q.some((v) => v !== q[0])) mixed++;
    }
    if (blocks) fine = Math.min(fine, mixed / blocks);
  }
  return { n, fine, edges: n ? edges / n : 0, colours: colours.size };
}
declare global { interface Window { density(o: Record<string, unknown>): unknown } }
/**
 * The props of a room (as show() opens it), each measured as the room cache laid it down, and the people as the view
 * draws them: the check holds the props to the people's pixel size and to a minimum of detail.
 */
window.density = (o) => {
  kit.roomCache.clear();
  const items: { tag: string; outlined: boolean; x: number; y: number; w: number; h: number; data: Uint8ClampedArray }[] = [];
  kit.roomCache.trace = items;
  try { window.show({ ...o, reduced: true }); } finally { kit.roomCache.trace = null; }
  const props = items.map((it) => ({ tag: it.tag, outlined: it.outlined, ...density(it.data, it.w, it.h) }));
  const people = [3, 17, 42, 77].map((seed) => {
    const cv = new OffscreenCanvas(40, 48), g = cv.getContext('2d')!;
    kit.person((x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }, 20, 40, { seed, state: 'running', subagent: false, ring: false, phase: 0, walking: false, working: false, placard: 0, tier: 0 });
    return density(g.getImageData(0, 0, 40, 48).data, 40, 48);
  });
  return { props, people };
};
void FLOOR_KINDS;
