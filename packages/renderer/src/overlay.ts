// The data views. With a layer other than "Everything" the city goes grey
// and the layer's subjects are drawn again in colour: scheduled sessions under clocks, running towers, results to
// review, fires and fire engines, power lines, jammed roads and cars. Agents in the square and the balloon keep
// their colour in every layer. Everything that moves here moves because of data (a fire burns because a call
// failed, a light runs along a wire because tokens were used); under reduced motion nothing moves.
//
// Art stage: whole pixels, no text, no semi-transparent pixels. Screen stage: the tags (counts, times, tool names),
// at screen resolution on whole pixels, from the locale tables.
import { inkOn } from './contrast.ts';
import { BURN_MS, buildingOf, planModeAt, burning, fireTier, idxAt, stateAt, toReview, deliverablesAt, hasDraft, type Store } from '@dsh-universe/model';
import type { ArtKit, Canvas2D, PixelPen } from './artkit.ts';
import { artXY } from './geometry.ts';
import type { Blit } from './paint.ts';
import type { Scene, SceneAgent, ScenePlace } from './scene.ts';
import { INK, JAM, layerData, lerp, markTop, pen, roadRoute, worldOffset, type LayerData } from './overlay-common.ts';
import { paintPower, powerTags } from './overlay-power.ts';
import type { Overlay, OverlayFrame } from './view.ts';

export type Translate = (key: string, params?: Record<string, string | number>) => string;
export interface DataViewOptions {
  t: Translate;
  /** Formatters from the panel (numbers and durations follow the interface language). */
  tokens(n: number): string;
  duration(ms: number): string;
  clock(t: number): string;
}

/** A tag on the screen stage: text over a hard-edged box in the layer's colour. */
export interface Tag { x: number; y: number; text: string; bg: string; fg: string; prio: number }

const MAX_TRUCKS = 5;
/** The roof edge of a tower kept in colour, per layer (the layers whose subjects are towers). */
const ACCENT: Partial<Record<string, string>> = { scheduled: '#2F6BDE', running: '#2F8BFF', review: '#C9925A', tokens: '#FF8A2B', errors: '#E5433D' };

/** A 2 px diamond along a roof's edge, outlined in ink (whole pixels). */
function roofEdge(px: PixelPen, x: number, y: number, hw: number, hh: number, c: string): void {
  const n = Math.max(hw, 1);
  for (let i = 0; i <= n; i++) {
    const dy = Math.round((i / n) * hh);
    for (const [ax, ay] of [[x - hw + i, y - dy], [x - hw + i, y + dy], [x + hw - i, y - dy], [x + hw - i, y + dy]]) { px(ax, ay - 1, 2, 3, INK); }
  }
  for (let i = 0; i <= n; i++) {
    const dy = Math.round((i / n) * hh);
    for (const [ax, ay] of [[x - hw + i, y - dy], [x - hw + i, y + dy], [x + hw - i, y - dy], [x + hw - i, y + dy]]) px(ax, ay, 2, 1, c);
  }
}
const TRUCK_SPEED = 5;     // tiles a second
const TRUCK_STAY = 9;      // seconds at the fire

/** For this frame's art stage: whether a place's roof is visible (set by the data views before they draw). */
let seenNow: (p: ScenePlace) => boolean = () => true;
const seenCache: { key: string; map: Map<string, boolean> } = { key: '', map: new Map() };

// ---------- the leak check (local, with a real canvas) ----------

/** True in the dev page build (scripts/dev.mjs), false in the shipped plugin (plugin/scripts/build.mjs). */
declare const __DSHU_DEV__: boolean | undefined;
/** On when a check script sets `globalThis.__dshuLeakCheck` on the dev page (never in the shipped plugin: it reads pixels back). */
const leakCheckOn = () => typeof __DSHU_DEV__ !== 'undefined' && __DSHU_DEV__ && (globalThis as { __dshuLeakCheck?: boolean }).__dshuLeakCheck === true;
type Snap = { w: number; h: number; data: Uint8ClampedArray };
/** The pixels the layer's subjects cover (their sprites' opaque pixels and the people kept in colour), by the spec. */
function specMask(f: OverlayFrame, d: LayerData, ox: number, oy: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (typeof OffscreenCanvas === 'undefined') return out;
  const c = new OffscreenCanvas(w, h), m = c.getContext('2d') as Canvas2D | null;
  if (!m) return out;
  const subject = (id?: string) => !!id && (id === 'car' ? d.layer === 'calls' : id === 'train' ? d.layer === 'scheduled' : !!d.colour?.has(id));
  for (const b of f.last.blits) if (b.image && subject(b.id)) m.drawImage(b.image, b.x, b.y);
  m.setTransform(1, 0, 0, 1, ox, oy);
  for (const a of f.scene.agents) if (a.inSquare || !d.colour || d.colour.has(a.id)) { const q = artXY(a.pos[0], a.pos[1]); f.kit.person(pen(m), q[0], q[1], a.person); }
  const data = m.getImageData(0, 0, w, h).data;
  for (let i = 0; i < out.length; i++) if (data[i * 4 + 3]) out[i] = 1;
  return out;
}
const rgb = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1, 7), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
/** Whether a pixel is one of a sign's own colours or a blend of its text into its plate (anti-aliased glyphs). */
function signPixel(p: [number, number, number], s: { bg?: string; fg?: string; border?: string }): boolean {
  const cols = [s.bg, s.fg, s.border, '#141A30'].filter((x): x is string => !!x && /^#[0-9a-f]{6}/i.test(x)).map(rgb);
  if (cols.some((c) => Math.hypot(c[0] - p[0], c[1] - p[1], c[2] - p[2]) < 60)) return true;
  if (!s.bg || !s.fg) return false;
  const a = rgb(s.bg), b = rgb(s.fg), ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L));
  return Math.hypot(a[0] + ab[0] * u - p[0], a[1] + ab[1] * u - p[1], a[2] + ab[2] * u - p[2]) < 40;
}
function snapshot(g: Canvas2D): Snap | undefined {
  const c = g.canvas as { width: number; height: number };
  try { return { w: c.width, h: c.height, data: g.getImageData(0, 0, c.width, c.height).data }; } catch { return undefined; }
}
/** Which art-buffer pixels the data view changed after greying the city: its subjects, its drawings, the square. */
let drawnMask: { w: number; h: number; mask: Uint8Array; ox: number; oy: number } | undefined;
function diff(a: Snap, b: Snap | undefined): { w: number; h: number; mask: Uint8Array } {
  const mask = new Uint8Array(a.w * a.h);
  if (b && b.w === a.w && b.h === a.h) for (let i = 0; i < mask.length; i++) { const k = i * 4; if (a.data[k] !== b.data[k] || a.data[k + 1] !== b.data[k + 1] || a.data[k + 2] !== b.data[k + 2]) mask[i] = 1; }
  return { w: a.w, h: a.h, mask };
}
/**
 * Saturated pixels on the finished screen that are neither a layer subject, the square or what the layer drew, nor a
 * sign's own colours (the text layer is interface): colour that leaked into the grey city. Returns the count and a few places to look.
 */
function findLeaks(f: OverlayFrame & { toScreen(ax: number, ay: number): [number, number] }, m: { w: number; h: number; mask: Uint8Array; ox: number; oy: number }): { count: number; at: [number, number][] } {
  const g = f.ctx, c = g.canvas as { width: number; height: number };
  let img: Uint8ClampedArray;
  try { img = g.getImageData(0, 0, c.width, c.height).data; } catch { return { count: -1, at: [] }; }
  // Screen = s · buffer + c (buffer = world + offset).
  const p0 = f.toScreen(-m.ox, -m.oy), p1 = f.toScreen(100 - m.ox, -m.oy), s = (p1[0] - p0[0]) / 100;
  const signs = f.signRects ?? [];
  let count = 0;
  const at: [number, number][] = [];
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const k = (y * c.width + x) * 4, r = img[k], gg = img[k + 1], b = img[k + 2];
    if (Math.max(r, gg, b) - Math.min(r, gg, b) <= 40) continue;
    const bx = Math.floor((x - p0[0]) / s), by = Math.floor((y - p0[1]) / s);
    if (bx >= 0 && by >= 0 && bx < m.w && by < m.h && m.mask[by * m.w + bx]) continue;
    const sign = signs.find((q) => x >= q[0] && x < q[2] && y >= q[1] && y < q[3]);
    if (sign && signPixel([r, gg, b], sign)) continue;
    count++;
    if (at.length < 8 && !at.some((p) => Math.abs(p[0] - x) + Math.abs(p[1] - y) < 40)) at.push([x, y]);
  }
  return { count, at };
}

export function createDataViews(o: DataViewOptions): Overlay & { tags(): Tag[] } {
  const cache: { v?: LayerData } = {};
  const routes = new Map<string, [number, number][]>();
  let tags: Tag[] = [];
  let live = false;

  const overlay: Overlay & { tags(): Tag[] } = {
    id: 'data-views',
    tags: () => tags,
    animated(f) { return live && !f.reducedMotion; },
    art(f) {
      tags = [];
      live = false;
      if (!f.input || f.layer === 'all') return;
      const d = layerData(cache, f.input, f.scene, f.layer);
      const g = f.ctx, px = pen(g);
      const [ox, oy] = worldOffset(g);
      grey(g, isNight(f.kit));
      const before = leakCheckOn() ? snapshot(g) : undefined;
      // Things on the ground first (jammed roads, the railway), then everything in colour in depth order, with
      // grey sprites that stand in front of them drawn again so the depth order holds.
      const ground: Rect[] = [];
      if (d.layer === 'calls') ground.push(...jamLayer(f.ctx, d, isNight(f.kit), ox, oy));
      if (d.layer === 'scheduled') for (let x = -22; x < 11.5; x += 0.5) { const q = artXY(x, 14.5); px(q[0], q[1] - 1, 2, 2, '#2F6BDE'); }
      // The layer's ground drawings (railway, jammed roads) are its own: allowed colour too.
      const ground0 = before ? diff(before, snapshot(g)) : undefined;
      const spec = before ? specMask(f, d, ox, oy, before.w, before.h) : undefined;
      if (spec && ground0) for (let i = 0; i < spec.length; i++) if (ground0.mask[i]) spec[i] = 1;
      const covers = recolour(f, d, ground, ox, oy);
      const mid = before ? snapshot(g) : undefined;
      // Asked for every marker and tag: answered once per place while the view, the data and the clock stand still.
      const vk = d.key + '|' + ox + '|' + oy + '|' + (f.ctx.canvas as { width: number }).width + '|' + Math.floor(f.time * 2);
      if (seenCache.key !== vk) { seenCache.key = vk; seenCache.map = new Map(); }
      seenNow = (p) => { let v = seenCache.map.get(p.id); if (v === undefined) seenCache.map.set(p.id, v = roofSeen(f, covers, p)); return v; };
      // Every tower kept in colour gets its roof edged in the layer's colour, so a pale (white or glass) tower is not
      // mistaken for a grey one.
      const accent = ACCENT[d.layer];
      if (accent) for (const p of f.scene.places) if (p.tier === 'building' && p.building && d.colour?.has(p.id) && seenNow(p)) {
        const roof = f.kit.building(p.building).roof, q = artXY(p.at[0], p.at[1]);
        if (roof) roofEdge(px, q[0] + roof.dx, q[1] + roof.dy, roof.hw, roof.hh, accent);
      }
      switch (d.layer) {
        case 'errors': live = fires(f, d, px, routes) || live; break;
        case 'tokens': live = paintPower(f, d, px) || live; break;
        case 'scheduled': clocks(f, d, px); break;
        case 'running': running(f, d, px); break;
        case 'review': review(f, d, px); break;
        case 'calls': live = f.scene.cars > 0; break;
      }
      // The square stays on top of every layer's drawing (wires, smoke, engines): its people, then the balloon.
      for (const a of f.scene.agents.filter((x) => x.inSquare).sort((x, y) => x.depth - y.depth)) { const q = artXY(a.pos[0], a.pos[1]); f.kit.person(px, q[0], q[1], a.person); }
      if (f.scene.rally) { const q = artXY(14.5, 18.6); f.kit.balloon(px, q[0], q[1] - (f.time ? Math.floor(f.time * 2) & 1 : 0), f.zoom < 1 ? 2 : 1); }
      tags = tagsOf(f, d, o);
      // Allowed colour: the layer's subjects by specification, plus what the layer then drew (fires, wires, markers,
      // the square). The recolouring itself is not trusted: a grey sprite it drew in colour is a leak.
      if (before && mid && spec) { const late = diff(mid, snapshot(g)); for (let i = 0; i < spec.length; i++) if (late.mask[i]) spec[i] = 1; drawnMask = { w: before.w, h: before.h, mask: spec, ox, oy }; }
    },
    screen(f) {
      if (typeof __DSHU_DEV__ !== 'undefined' && __DSHU_DEV__ && leakCheckOn() && f.layer !== 'all' && drawnMask) (globalThis as { __dshuLeaks?: unknown }).__dshuLeaks = findLeaks(f, drawnMask);
      if (f.layer === 'all' || !tags.length) return;
      drawTags(f.ctx, tags, f.toScreen, f.dpr);
    },
  };
  return overlay;
}

// ---------- grey and colour ----------

const isNight = (kit: ArtKit) => { const c = kit.sky(); const n = parseInt(c.slice(1, 7), 16); return Number.isFinite(n) && ((n >> 16) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) < 100; };

/** The whole buffer to grey, then a light veil (dark at night). The buffer is opaque, so the result stays opaque. */
function grey(g: Canvas2D, night: boolean): void {
  const w = (g.canvas as { width: number }).width, h = (g.canvas as { height: number }).height;
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'saturation';
  g.fillStyle = '#808080';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = night ? 'rgba(10,15,36,.4)' : 'rgba(255,255,255,.4)';
  g.fillRect(0, 0, w, h);
  g.restore();
}

/** One sprite in grey, the same way (made per frame: sprites may be redrawn in place). */
function greySprite(b: Blit, night: boolean, memo: Map<CanvasImageSource, CanvasImageSource>): CanvasImageSource | undefined {
  const hit = memo.get(b.image);
  if (hit) return hit;
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const c = new OffscreenCanvas(Math.max(1, b.w), Math.max(1, b.h)), x = c.getContext('2d', { willReadFrequently: true });
  if (!x) return undefined;
  x.imageSmoothingEnabled = false;
  x.drawImage(b.image, 0, 0);
  x.globalCompositeOperation = 'saturation'; x.fillStyle = '#808080'; x.fillRect(0, 0, b.w, b.h);
  x.globalCompositeOperation = 'source-over'; x.fillStyle = night ? 'rgba(10,15,36,.4)' : 'rgba(255,255,255,.4)'; x.fillRect(0, 0, b.w, b.h);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(b.image, 0, 0);
  memo.set(b.image, c);
  return c;
}

type Rect = [number, number, number, number, number];   // buffer x0, y0, x1, y1, depth
const greyCache: { stamp: string; map: Map<CanvasImageSource, CanvasImageSource> } = { stamp: '', map: new Map() };
/** Grey sprites drawn again in front of coloured ones this frame. */
type Covers = { depth: number; b: Blit }[];

/** Whether an opaque pixel of a sprite is at a buffer point (sprites are canvases; anything else counts as opaque). */
function opaqueAt(b: Blit, x: number, y: number): boolean {
  const lx = Math.floor(x - b.x), ly = Math.floor(y - b.y);
  if (lx < 0 || ly < 0 || lx >= b.w || ly >= b.h) return false;
  // One read-back per sprite while the grey cache's stamp holds (a read-back costs far more than its size).
  let a = alphaCache.map.get(b.image);
  if (a === undefined) {
    const c = (b.image as { getContext?: (k: '2d') => CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null }).getContext?.('2d');
    try { a = c ? { w: b.w, data: c.getImageData(0, 0, b.w, b.h).data } : null; } catch { a = null; }
    alphaCache.map.set(b.image, a);
  }
  return a ? a.data[(ly * a.w + lx) * 4 + 3] > 0 : true;
}
const alphaCache: { stamp: string; map: Map<CanvasImageSource, { w: number; data: Uint8ClampedArray } | null> } = { stamp: '', map: new Map() };

/**
 * Whether a place's roof can be seen: not hidden behind a grey building in front of it. Markers and labels of the
 * layer go only on what can be seen, so none floats over a grey building.
 */
function roofSeen(f: OverlayFrame, covers: Covers, p: ScenePlace): boolean {
  const top = f.last.tops.get(p.id);
  if (!top) return false;
  const [ox, oy] = worldOffset(f.ctx);
  // A tower: its roof centre (a crown or crane tip can poke out above a tower in front while the roof is hidden).
  const roof = p.building ? f.kit.building(p.building).roof : undefined, q = artXY(p.at[0], p.at[1]);
  const x = (roof ? q[0] + roof.dx : top[0]) + ox, y = (roof ? q[1] + roof.dy + 2 : top[1] + 10) + oy;
  return !covers.some((c) => c.depth > p.depth && c.b.t[0] <= x && c.b.t[2] >= x && c.b.t[1] <= y && c.b.t[3] >= y && opaqueAt(c.b, x, y));
}
const overlaps = (a: readonly number[], b: readonly number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Is this person kept in colour? Agents in the square always are (and the member's agents walking to it). */
const keeps = (d: LayerData, a: SceneAgent) => a.inSquare || !d.colour || d.colour.has(a.id.replace(/^walk:/, ''));

function recolour(f: OverlayFrame, d: LayerData, ground: Rect[], ox: number, oy: number): Covers {
  const g = f.ctx, W = (g.canvas as { width: number }).width, H = (g.canvas as { height: number }).height;
  const onScreen = (b: Blit) => b.x < W && b.y < H && b.x + b.w > 0 && b.y + b.h > 0;
  const coloured: { depth: number; r: readonly number[]; draw(): void }[] = [];
  const keepBlit = (b: Blit) => !!b.id && (b.id === 'car' ? d.layer === 'calls' : b.id === 'train' ? d.layer === 'scheduled' : !!d.colour?.has(b.id));
  for (const b of f.last.blits) if (b.image && keepBlit(b) && onScreen(b)) coloured.push({ depth: b.depth, r: b.t, draw: () => { g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(b.image, b.x, b.y); } });
  const people = f.scene.agents.filter((a) => keeps(d, a));
  for (const a of people) {
    const q = artXY(a.pos[0], a.pos[1]);
    coloured.push({ depth: a.depth, r: [q[0] - 9 + ox, q[1] - 40 + oy, q[0] + 9 + ox, q[1] + 3 + oy], draw: () => { g.setTransform(1, 0, 0, 1, ox, oy); f.kit.person(pen(g), q[0], q[1], a.person); } });
  }
  // Grey sprites in front of something coloured (or of a jammed road) are drawn again over it.
  // Grey sprites are kept while the data, the layer, the light and the half-second clock stay the same (a sprite can
  // be redrawn in place when its building changes, which only happens with those).
  // Keyed on the data version, the layer, the light, the 5-second window-light clock and the moment in 5-minute steps (a replay
  // moves the moment every frame; buildings only change shape between those steps).
  const night = isNight(f.kit), stamp = f.input.store.version() + '|' + d.layer + '|' + night + '|' + Math.floor(f.time / 5) + '|' + Math.floor(f.input.T / 300_000);
  if (greyCache.stamp !== stamp) { greyCache.stamp = stamp; greyCache.map = new Map(); alphaCache.stamp = stamp; alphaCache.map = new Map(); }
  const memo = greyCache.map;
  const front: { depth: number; b: Blit; draw(): void }[] = [];
  const under = [...coloured.map((c) => [...c.r.slice(0, 4), c.depth] as Rect), ...ground];
  // A coarse grid over the buffer (64 px cells) so each sprite is tested only against what lies in its own cells:
  // with hundreds of sessions the all-pairs test cost several milliseconds a frame.
  const CELL = 64, grid = new Map<number, Rect[]>();
  const cells = (r: readonly number[], fn: (k: number) => void) => {
    for (let cx = Math.floor(r[0] / CELL); cx <= Math.floor(r[2] / CELL); cx++) for (let cy = Math.floor(r[1] / CELL); cy <= Math.floor(r[3] / CELL); cy++) fn(cx * 4096 + cy);
  };
  for (const u of under) cells(u, (k) => { const l = grid.get(k); if (l) l.push(u); else grid.set(k, [u]); });
  const beneath = (b: Blit) => { let hit = false; cells(b.t, (k) => { if (!hit) hit = !!grid.get(k)?.some((u) => b.depth > u[4] && overlaps(b.t, u)); }); return hit; };
  for (const b of f.last.blits) {
    if (!b.image || keepBlit(b) || !onScreen(b)) continue;
    if (!beneath(b)) continue;
    const gs = greySprite(b, night, memo);
    if (gs) front.push({ depth: b.depth, b, draw: () => { g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(gs, b.x, b.y); } });
  }
  for (const it of [...coloured, ...front].sort((x, y) => x.depth - y.depth)) it.draw();
  g.setTransform(1, 0, 0, 1, ox, oy);
  // The text layer cuts a sign behind a sprite out by drawing that sprite again over it, after this stage: a grey
  // sprite must be drawn again in grey, or its colour leaks back in a patch round every sign.
  const signs = f.scene.signs.map((s) => { const q = artXY(s.x, s.y, s.z); return [q[0] + ox - 170, q[1] + oy - 40, q[0] + ox + 170, q[1] + oy + 14]; });
  for (const b of f.last.blits) {
    if (!b.image || keepBlit(b) || !onScreen(b) || !signs.some((r) => overlaps(b.t, r))) continue;
    const gs = greySprite(b, night, memo);
    if (gs) b.image = gs;
  }
  return front;
}

/**
 * The jammed roads, drawn once into a canvas of their own while the data and the light stay the same, then put down
 * with one call per frame (hundreds of tiles of rows each would otherwise cost several milliseconds a frame).
 */
const jamCache: { key: string; img?: OffscreenCanvas; x0: number; y0: number; tiles: [number, number, number][] } = { key: '', x0: 0, y0: 0, tiles: [] };
function jamLayer(g: Canvas2D, d: LayerData, night: boolean, ox: number, oy: number): Rect[] {
  // Keyed on what is jammed, not on the moment: in replay the moment moves every frame while the roads mostly stay.
  let sig = night + '|' + d.jam.size;
  for (const [k, lv] of d.jam) sig += ';' + k + lv;
  const key = sig;
  if (jamCache.key !== key) {
    jamCache.key = key;
    jamCache.tiles = [...d.jam].map(([k, lv]) => { const [i, j] = k.split(',').map(Number); return [i, j, lv]; });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [i, j] of jamCache.tiles) { const [cx, cy] = artXY(i + 0.5, j + 0.5); x0 = Math.min(x0, cx - 16); y0 = Math.min(y0, cy - 8); x1 = Math.max(x1, cx + 16); y1 = Math.max(y1, cy + 8); }
    jamCache.img = undefined;
    if (jamCache.tiles.length && typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0)), x = c.getContext('2d');
      if (x) { const p = pen(x as Canvas2D); for (const [i, j, lv] of jamCache.tiles) tile(p, i, j, JAM[lv - 1], 0, 0, night, -x0, -y0); jamCache.img = c; jamCache.x0 = x0; jamCache.y0 = y0; }
    }
  }
  if (jamCache.img) g.drawImage(jamCache.img, jamCache.x0, jamCache.y0);
  else { const p = pen(g); for (const [i, j, lv] of jamCache.tiles) tile(p, i, j, JAM[lv - 1], 0, 0, night); }
  return jamCache.tiles.map(([i, j]) => { const [cx, cy] = artXY(i + 0.5, j + 0.5); return [cx - 16 + ox, cy - 8 + oy, cx + 16 + ox, cy + 8 + oy, i + j + 0.5]; });
}

/** A road tile filled in one colour, row by row (whole pixels, no anti-aliased edges). Returns its buffer rect. */
function tile(px: PixelPen, i: number, j: number, c: string, ox: number, oy: number, night = false, dx = 0, dy = 0): Rect {
  const [cx0, cy0] = artXY(i + 0.5, j + 0.5), cx = cx0 + dx, cy = cy0 + dy;
  // At night every other row only: still plainly yellow, orange or red, but the dark road shows through, so the
  // jam does not glare brighter than the lit windows.
  for (let r = -8; r < 8; r++) { const hw = 16 - Math.abs(2 * r + 1); if (hw > 0 && (!night || (r & 1) === 0)) px(cx - hw, cy + r, hw * 2, 1, c); }
  return [cx - 16 + ox, cy - 8 + oy, cx + 16 + ox, cy + 8 + oy, i + j + 0.5];
}

// ---------- shared bits ----------

const topOf = (f: OverlayFrame, p: ScenePlace) => markTop(f, p);
const places = (f: OverlayFrame) => new Map(f.scene.places.map((p) => [p.id, p]));

/** A small icon over a place: 0 clock (scheduled), 1 hammer (running), 2 parcel (delivered files), 3 envelope (a
 * draft), 4 check (finished, not seen yet). Still. */
function icon(px: PixelPen, x: number, y: number, k: 0 | 1 | 2 | 3 | 4, at?: number): void {
  px(x - 7, y - 13, 14, 13, INK);
  if (k === 0) {
    px(x - 6, y - 12, 12, 11, '#FFFFFF');
    px(x - 5, y - 11, 10, 9, '#2F6BDE'); px(x - 4, y - 10, 8, 7, '#FFFFFF');
    // Hands from the real time of the run: hour hand (short) and minute hand (long), in eight directions.
    const d = at !== undefined ? new Date(at) : undefined;
    const dir = (a: number) => [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]][((Math.round(a * 8) % 8) + 8) % 8];
    const m = d ? dir(d.getMinutes() / 60) : [0, -1], h = d ? dir(((d.getHours() % 12) + d.getMinutes() / 60) / 12) : [1, 0];
    for (let s = 1; s <= 3; s++) px(x + m[0] * s - 1, y - 7 + m[1] * s - 1, 1, 1, INK);
    for (let s = 1; s <= 2; s++) px(x + h[0] * s - 1, y - 7 + h[1] * s - 1, 1, 1, '#E5433D');
    px(x - 1, y - 8, 1, 1, INK);
  } else if (k === 1) {
    px(x - 6, y - 12, 12, 11, '#2F8BFF'); px(x - 3, y - 10, 2, 7, '#FFFFFF'); px(x - 1, y - 8, 4, 2, '#FFFFFF');
  } else if (k === 2) {
    px(x - 6, y - 12, 12, 11, '#C9925A'); px(x - 6, y - 8, 12, 1, '#FFC928'); px(x - 1, y - 12, 2, 11, '#FFC928');
  } else if (k === 3) {
    px(x - 6, y - 12, 12, 11, '#FFFFFF');
    for (let s = 0; s < 6; s++) { px(x - 6 + s, y - 12 + s, 1, 1, '#59627A'); px(x + 5 - s, y - 12 + s, 1, 1, '#59627A'); }
  } else {
    px(x - 6, y - 12, 12, 11, '#35B37A');
    for (const [dx, dy] of [[-4, -7], [-3, -6], [-2, -5], [-1, -6], [0, -7], [1, -8], [2, -9], [3, -10]]) px(x + dx, y + dy, 2, 2, '#FFFFFF');
  }
}

// ---------- scheduled: the station's clock and the sessions trains brought ----------

function clocks(f: OverlayFrame, d: LayerData, px: PixelPen): void {
  const st = f.scene.places.find((p) => p.id === 'station');
  const store = f.input.store, T = f.input.T;
  if (st && seenNow(st)) { const q = topOf(f, st); const next = nextRun(store, T); if (q) icon(px, q[0], q[1] - 6, 0, next); }
  const P = places(f);
  for (const s of store.agents()) {
    if (s.agent.parentAgentId || !(s.agent.kind === 'scheduled' || s.agent.scheduleId) || s.agent.startedAt > T) continue;
    const p = P.get(buildingOf(store, s));
    const q = p && seenNow(p) && topOf(f, p);
    if (q) icon(px, q[0], q[1] - 4, 0, s.agent.startedAt);
  }
  void d;
}
const nextRun = (store: Store, T: number) => store.schedules().filter((x) => x.status === 'active' && x.nextAt !== undefined && x.nextAt > T).sort((a, b) => a.nextAt! - b.nextAt!)[0]?.nextAt;

// ---------- running: towers at work, a blue line to their agents that are out ----------

function running(f: OverlayFrame, d: LayerData, px: PixelPen): void {
  const P = places(f), store = f.input.store, T = f.input.T;
  for (const p of f.scene.places) if (p.tier === 'building' && p.state === 'running' && seenNow(p)) { const q = topOf(f, p); if (q) icon(px, q[0], q[1] - 4, 1); }
  for (const a of f.scene.agents) {
    if (a.inSquare || a.id.startsWith('walk:')) continue;
    const s = store.agent(a.id);
    if (!s || stateAt(s, T) !== 'running') continue;
    const home = P.get(buildingOf(store, s));
    if (!home) continue;
    const b0 = artXY(home.at[0], home.at[1] + 1), q = artXY(a.pos[0], a.pos[1]);
    const n = Math.max(1, Math.abs(q[0] - b0[0]), Math.abs(q[1] - b0[1]));
    for (let i = 0; i < n; i += 3) px(Math.round(lerp(b0[0], q[0], i / n)), Math.round(lerp(b0[1], q[1], i / n)), 1, 1, '#2F8BFF');
    f.kit.person(px, q[0], q[1], a.person);
  }
  void d;
}

// ---------- to review: finished work with something to look at ----------

function review(f: OverlayFrame, d: LayerData, px: PixelPen): void {
  const store = f.input.store, T = f.input.T, P = places(f);
  for (const s of store.agents()) {
    if (!toReview(s, T, f.input.city ?? 'dsh', f.input.seen, f.input.drafts)) continue;
    const p = P.get(buildingOf(store, s)), q = p && d.colour?.has(p.id) && seenNow(p) && topOf(f, p);
    if (!q) continue;
    const parcel = deliverablesAt(s, T) > 0, draft = hasDraft(s, f.input.drafts);
    if (parcel && draft) { icon(px, q[0] - 8, q[1] - 4, 2); icon(px, q[0] + 8, q[1] - 4, 3); }
    else icon(px, q[0], q[1] - 4, parcel ? 2 : draft ? 3 : 4);
  }
  void d;
}

// ---------- errors: fires on the roofs, engines from the fire station ----------

function fires(f: OverlayFrame, d: LayerData, px: PixelPen, routes: Map<string, [number, number][]>): boolean {
  const T = f.input.T, time = f.reducedMotion ? 0 : f.time;
  const burn = f.scene.places.filter((p) => p.id !== 'fire' && (d.metrics.places.get(p.id)?.errors ?? 0) > 0)
    .sort((a, b) => (d.metrics.places.get(b.id)!.lastErrorAt ?? 0) - (d.metrics.places.get(a.id)!.lastErrorAt ?? 0));
  let moving = false;
  burn.forEach((p, i) => {
    const m = d.metrics.places.get(p.id)!, top = topOf(f, p);
    if (!top || !seenNow(p)) return;
    const tier = fireTier(m.errors), x0 = top[0], y0 = top[1] + (p.tier === 'building' ? 10 : 18);
    if (burning(m, T)) {
      moving = true;
      const fr = time ? Math.floor(time * 6 + i) & 1 : 0;
      for (let k = 0; k < tier + 1; k++) {
        const x = x0 - tier * 3 + k * 5, h = 6 + tier * 2 - (k & 1) * 2 + fr * ((k & 1) ? 2 : -1);
        px(x - 1, y0 - h - 1, 6, h + 2, INK); px(x, y0 - h, 4, h, '#E5433D'); px(x + 1, y0 - h + 2, 2, h - 2, '#FF8A2B'); px(x + 1, y0 - 3, 2, 3, '#FFC928');
      }
      f.kit.smoke(px, x0, y0 - 10 - tier * 2, time, '#59627A', 3, 18, i * 0.3);
    } else {
      // Put out more than 30 minutes ago: a scorch mark and a wisp.
      px(x0 - 5, y0 - 3, 10, 4, INK); px(x0 - 3, y0 - 2, 2, 1, '#FF8A2B');
      f.kit.smoke(px, x0, y0 - 4, time * 0.5, '#AEB5C2', 2, 12, i * 0.3);
    }
  });
  // Engines: from the fire station along the roads to what is burning now (at most five), spray, and back.
  const fs = f.scene.places.find((p) => p.id === 'fire');
  const gate0 = fs && d.gates.get('fire')?.[0];
  if (!gate0) return moving;
  burn.filter((p) => burning(d.metrics.places.get(p.id), T)).slice(0, MAX_TRUCKS).forEach((p, i) => {
    const gate = d.gates.get(p.id)?.[0];
    if (!gate) return;
    const key = gate0 + '>' + gate + '|' + f.scene.growth;
    let path = routes.get(key);
    if (!path) { path = roadRoute(gate0, gate, f.scene.growth); routes.set(key, path); }
    if (path.length < 2) return;
    const L = path.length - 1, go = L / TRUCK_SPEED, cyc = go * 2 + TRUCK_STAY;
    // Reduced motion: parked at the fire.
    const ph = f.reducedMotion ? go + 1 : (f.time + i * 4.3) % cyc;
    const u = ph < go ? ph / go : ph < go + TRUCK_STAY ? 1 : 1 - (ph - go - TRUCK_STAY) / go;
    const fl = u * L, k = Math.min(L - 1, Math.floor(fl)), a0 = path[k], b0 = path[k + 1];
    const x = lerp(a0[0], b0[0], fl - k), y = lerp(a0[1], b0[1], fl - k), back = ph >= go + TRUCK_STAY ? -1 : 1;
    const dx = Math.sign(b0[0] - a0[0]) * back, dy = Math.sign(b0[1] - a0[1]) * back;
    const q = artXY(x, y), car = f.kit.car({ model: 5, colour: 0, dx: dx || 0, dy: dx ? 0 : (dy || 1) });
    f.ctx.drawImage(car.image, q[0] + car.dx, q[1] + car.dy);
    if (f.time && (Math.floor(f.time * 4) & 1)) px(q[0] - 1, q[1] - 17, 3, 2, '#2F8BFF');
    if (u === 1) {
      const top = topOf(f, p);
      if (!top) return;
      const tq: [number, number] = [top[0], top[1] + (p.tier === 'building' ? 10 : 18)];
      for (let j = 0; j < 2; j++) {
        // Two firefighters at the engine, spraying up at the roof.
        const fx = q[0] + 10 + j * 9, fy = q[1] + 5 + j * 3;
        px(fx - 3, fy - 11, 6, 11, INK); px(fx - 2, fy - 6, 4, 4, '#E5433D'); px(fx - 2, fy - 10, 4, 3, '#FFC928'); px(fx - 2, fy - 2, 1, 2, '#27304F'); px(fx + 1, fy - 2, 1, 2, '#27304F');
        for (let w = 0; w < 10; w++) {
          const uu = (w + (f.time ? (f.time * 8) % 1 : 0)) / 10, wx = lerp(fx, tq[0], uu), wy = lerp(fy - 8, tq[1], uu) - Math.sin(uu * Math.PI) * 14;
          px(Math.round(wx), Math.round(wy), 2, 2, w & 1 ? '#7FD0FF' : '#2FA8F0');
        }
      }
    }
    moving = true;
  });
  return moving;
}

// ---------- tags (screen stage) ----------

function tagsOf(f: OverlayFrame, d: LayerData, o: DataViewOptions): Tag[] {
  const out: Tag[] = [], store = f.input.store, T = f.input.T, P = places(f);
  // A tag sits on top of what is drawn over the place (`up`: its height in art pixels, so it follows the zoom); the
  // gap above that is a fixed few screen pixels (drawTags), not art pixels that would grow with the zoom.
  const at = (p: ScenePlace, up = 0): [number, number] | undefined => { const q = topOf(f, p); return q ? [q[0], q[1] - up] : undefined; };
  const push = (p: ScenePlace | undefined, text: string, bg: string, prio: number, up?: number) => { const q = p && seenNow(p) && at(p, up); if (q) out.push({ x: q[0], y: q[1], text, bg, fg: '#FFFFFF', prio }); };
  switch (d.layer) {
    case 'scheduled': {
      const nx = store.schedules().filter((x) => x.status === 'active' && x.nextAt !== undefined && x.nextAt > T).sort((a, b) => a.nextAt! - b.nextAt!)[0];
      push(P.get('station'), nx ? o.t('td.sched', { t: o.clock(nx.nextAt!), d: nx.nextAt! - T < 3600_000 ? o.t('a.in', { d: o.duration(nx.nextAt! - T) }) : nx.title }) : o.t('td.nosched'), '#2F6BDE', 100, 19);
      for (const s of store.agents()) {
        if (s.agent.parentAgentId || !(s.agent.kind === 'scheduled' || s.agent.scheduleId) || s.agent.startedAt > T) continue;
        const st = stateAt(s, T);
        push(P.get(buildingOf(store, s)), o.clock(s.agent.startedAt) + ' ' + (st === 'failed' ? '×' : st === 'done' ? '✓' : '…'), st === 'failed' ? '#E5433D' : '#2F6BDE', 50, 17);
      }
      break;
    }
    case 'running':
      for (const s of store.agents()) {
        if (s.agent.parentAgentId || stateAt(s, T) !== 'running') continue;
        const k = idxAt(s, T), tool = k ? s.ev[k - 1].tool : '';
        const startedTurn = [...s.turns].reverse().find((x) => x.t <= T && x.phase === 'start')?.t ?? s.agent.startedAt;
        push(P.get(buildingOf(store, s)), [tool, o.duration(T - startedTurn)].filter(Boolean).join(' · '), '#2F8BFF', 50, 17);
      }
      break;
    case 'review':
      for (const s of store.agents()) {
        if (!toReview(s, T, f.input.city ?? 'dsh', f.input.seen, f.input.drafts)) continue;
        const n = deliverablesAt(s, T), dr = hasDraft(s, f.input.drafts);
        const text = [n ? o.t('row.out', { n }) : '', dr ? o.t('row.draft') : ''].filter(Boolean).join(' · ');
        const home = P.get(buildingOf(store, s));
        if (text && home && d.colour?.has(home.id)) push(home, text, '#C9925A', 50, 17);
      }
      break;
    case 'errors': {
      // The fire station's repair log: model requests retried today (only where the platform reports retries).
      let retries = 0;
      for (const s of store.agents()) for (const r of s.retries) if (r.t <= T) retries++;
      if (retries) push(P.get('fire'), o.t('ov.retries', { n: retries }), '#E5433D', 1e15, 0);
      for (const [id, m] of d.metrics.places) if (m.errors && id !== 'fire') push(P.get(id), o.t('td.err', { n: m.errors }), T - (m.lastErrorAt ?? 0) < BURN_MS ? '#E5433D' : '#59627A', m.lastErrorAt ?? 0, 6);
      break;
    }
    case 'tokens':
      out.push(...powerTags(f, d, o.tokens, o.t, (p, dy) => at(p, dy)));
      break;
    case 'calls':
      for (const [id, m] of d.metrics.places) if (m.calls5 && id !== 'fire') push(P.get(id), o.t('ov.calls5', { n: m.calls5 }), m.calls5 >= 40 ? '#E5433D' : m.calls5 >= 12 ? '#FF8A2B' : '#B8860B', m.calls5, 0);
      break;
  }
  return out;
}

/** Tags at screen resolution, whole pixels, the host font; the more important ones win where they overlap. */
function drawTags(g: Canvas2D, tags: Tag[], toScreen: (x: number, y: number) => [number, number], dpr: number): void {
  const fs = Math.round(11 * dpr), padX = Math.round(5 * dpr), h = Math.round(16 * dpr), bw = Math.max(1, Math.round(dpr));
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  const taken: number[][] = [];
  for (const t of [...tags].sort((a, b) => b.prio - a.prio)) {
    const [sx, sy] = toScreen(t.x, t.y);
    const w = Math.round(g.measureText(t.text).width) + padX * 2;
    // Kept whole inside the canvas (8 px in), never cut at an edge; one whose place is off screen is not drawn.
    const W = (g.canvas as { width: number }).width, inset = Math.round(8 * dpr);
    if (sx < 0 || sx > W) continue;
    const x = Math.max(inset, Math.min(W - inset - w, Math.round(sx - w / 2))), y = Math.round(sy - h - 3 * dpr);
    if (y < inset) continue;
    const r = [x - 2, y - 2, x + w + 2, y + h + 2];
    if (taken.some((q) => overlaps(q, r))) continue;
    taken.push(r);
    g.fillStyle = INK; g.fillRect(x - bw, y - bw, w + bw * 2, h + bw * 2);
    g.fillStyle = t.bg; g.fillRect(x, y, w, h);
    t.fg = inkOn(t.bg, t.fg); g.fillStyle = t.fg; g.fillText(t.text, x + padX, y + Math.round(h / 2));
  }
  g.restore();
}


/**
 * The balloon's badge: how many are waiting, at screen resolution next to the "!" balloon, in every
 * layer. Doubled with the balloon when the camera is far out.
 */
export function createSquareBadge(): Overlay {
  return {
    id: 'square-badge',
    screen(f) {
      const n = f.scene.rally;
      if (!n) return;
      const k = f.zoom < 1 ? 2 : 1, q = artXY(14.5, 18.6);
      const [sx, sy] = f.toScreen(q[0] + 8 * k + 2, q[1] - 64 - 22 * k - (f.time ? Math.floor(f.time * 2) & 1 : 0));
      const g = f.ctx, dpr = f.dpr, text = String(n);
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.font = `700 ${Math.round(12 * dpr)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      const h = Math.round(18 * dpr), w = Math.max(h, Math.round(g.measureText(text).width) + Math.round(10 * dpr)), b = Math.max(1, Math.round(dpr));
      const x = Math.round(sx), y = Math.round(sy - h / 2);
      g.fillStyle = INK; g.fillRect(x - b, y - b, w + 2 * b, h + 2 * b);
      g.fillStyle = '#E5433D'; g.fillRect(x, y, w, h);
      g.fillStyle = '#FFFFFF'; g.fillText(text, x + Math.round(w / 2), y + Math.round(h / 2));
      g.restore();
    },
  };
}

/**
 * Plan mode: a session that is planning before it works has a blueprint over
 * its roof, the wireframe of three storeys still to come, in dashed blueprint blue, and a rolled plan beside it. It
 * follows `plan/mode` at the moment shown, so look-back and replay agree; it never moves. Drawn before the data
 * views, so a data view greys it with the rest of the city.
 */
export function createPlanBlueprints(): Overlay {
  return {
    id: 'plan-blueprints',
    art(f) {
      if (!f.input) return;
      const store = f.input.store, T = f.input.T, px = pen(f.ctx);
      for (const p of f.scene.places) {
        if (p.tier !== 'building' || !p.sessionId || !p.building) continue;
        const root = store.agent(p.sessionId);
        if (!root || !planModeAt(root, T)) continue;
        // On the roof itself (the kit knows where it is; the crane and crown stand above it).
        const roof = f.kit.building(p.building).roof, q = artXY(p.at[0], p.at[1]);
        if (roof) blueprint(px, q[0] + roof.dx, q[1] + roof.dy, roof.hw, roof.hh);
        else { const top = f.last.tops.get(p.id); if (top) blueprint(px, top[0], top[1] + 4, Math.round(32 * p.building.footprint), Math.round(16 * p.building.footprint)); }
      }
    },
  };
}

const BLUE = '#2F8BFF', PAPER = '#DDEBFF';

/** Dashed whole-pixel line (2 on, 2 off). */
function dashed(px: PixelPen, a: readonly [number, number], b: readonly [number, number], c: string): void {
  const n = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
  for (let i = 0; i <= n; i++) if ((i & 3) < 2) px(Math.round(lerp(a[0], b[0], i / (n || 1))), Math.round(lerp(a[1], b[1], i / (n || 1))), 1, 1, c);
}

/** The wireframe of three storeys to come over a roof centred at (x, y), half-size hw × hh (art pixels). */
function blueprint(px: PixelPen, x: number, y: number, hw: number, hh: number): void {
  const storey = 8, base = y;
  const ring = (yy: number) => {
    const L: [number, number] = [x - hw, yy], R: [number, number] = [x + hw, yy], F: [number, number] = [x, yy + hh], B: [number, number] = [x, yy - hh];
    dashed(px, L, F, BLUE); dashed(px, F, R, BLUE); dashed(px, R, B, BLUE); dashed(px, B, L, BLUE);
  };
  for (let k = 1; k <= 3; k++) ring(base - k * storey);
  for (const [cx, cy] of [[x - hw, base], [x + hw, base], [x, base + hh], [x, base - hh]]) dashed(px, [cx, cy - storey], [cx, cy - 3 * storey], BLUE);
  // The rolled plan beside the roof: a sheet with a grid, held by the roll.
  const sx = x + hw + 4, sy = base - 3 * storey - 2;
  px(sx - 1, sy - 1, 14, 11, INK); px(sx, sy, 12, 9, PAPER);
  for (let i = 2; i < 12; i += 3) px(sx + i, sy, 1, 9, BLUE);
  for (let j = 2; j < 9; j += 3) px(sx, sy + j, 12, 1, BLUE);
  px(sx - 2, sy - 2, 3, 13, INK); px(sx - 1, sy - 1, 1, 11, BLUE);
}
