// Painting the city into the low-resolution art buffer: the ground once per border and
// light, then everything that stands, sorted back to front, in whole art pixels. Nothing here writes text.
import { GROWTH } from '@dsh-universe/model';
import type { ArtKit, Canvas2D, PixelPen, Sprite, StreetItem } from './artkit.ts';
import { artXY } from './geometry.ts';
import type { HitArea } from './hit.ts';
import type { Scene, ScenePlace } from './scene.ts';
import { carXY, type Traffic } from './traffic.ts';

/** A sprite as drawn into the art buffer (art pixels), for the text layer's cut-out and for drawing again. */
export interface Blit {
  image: CanvasImageSource; x: number; y: number; w: number; h: number; depth: number;
  /** Whose sprite: a place id, 'car', 'train', or none (street furniture). Data views draw a place again in colour. */
  id?: string;
  /** The part that actually has pixels (sprites are mostly transparent), art pixels: x0, y0, x1, y1. */
  t: readonly [number, number, number, number];
  /** Drawn every frame (a moving thing), not part of the static layer. */
  live?: boolean;
}

export interface PaintResult {
  blits: Blit[];
  hits: HitArea[];
  /** Art-pixel top of each place (markers, name plates, hover cards). */
  tops: Map<string, [number, number]>;
  /** Art-pixel head of each outdoor agent. */
  heads: Map<string, [number, number]>;
  /** Draw calls this frame (the static layer counts as one). */
  draws: number;
  /** Whether the static layer was rebuilt this frame. */
  rebuilt: boolean;
}

export interface PaintOptions {
  /** Animation clock in seconds; 0 under reduced motion. */
  time: number;
  /** Zoom level value (0.25 … 4): the balloon doubles when far out. */
  zoom: number;
  /** Art-buffer size and where the camera centre is in it. */
  bw: number; bh: number; camX: number; camY: number;
}

export interface Surface { canvas: CanvasImageSource & { width: number; height: number }; ctx: Canvas2D }
export type SurfaceFactory = (w: number, h: number) => Surface;

/**
 * Everything that does not move, painted once into one big canvas: the ground, street furniture, trees, the still
 * buildings. Rebuilt only when one of them changes. Each frame then costs one blit plus the moving things; a still
 * thing that stands in front of a moving one is drawn again over it, so the depth order stays right.
 */
export class StaticLayer {
  key = '';
  /** The scene and light the key was last worked out for (a new scene is built only a few times a second). */
  keyOf: { scene: Scene; light: string } | undefined;
  surface: Surface | undefined;
  blits: Blit[] = [];
  hits: HitArea[] = [];
  tops = new Map<string, [number, number]>();
  readonly make: SurfaceFactory;
  constructor(make: SurfaceFactory) { this.make = make; }
}
/** The static layer's canvas in art pixels and where art pixel (0, 0) sits in it. */
export const LAYER_BOX: readonly [number, number, number, number] = [2400, 1500, 1200, 700];

const inGrowth = (x: number, y: number, g: number) => { const G = GROWTH[g]; return x >= G[0] && x < G[2] && y >= G[1] && y < G[3]; };

type Item =
  | { k: 'item'; depth: number; it: StreetItem }
  | { k: 'place'; depth: number; p: ScenePlace }
  | { k: 'car'; depth: number; c: Traffic['cars'][number] }
  | { k: 'train'; depth: number; x: number; car: number }
  | { k: 'agent'; depth: number; a: Scene['agents'][number] }
  | { k: 'wheel'; depth: number; at: readonly [number, number] }
  | { k: 'fountain'; depth: number };

/** Moving things: they are drawn every frame, never baked into the static layer. */
const moving = (p: ScenePlace) => p.state === 'running' || p.state === 'waiting' || (p.civic?.kind === 'power' && p.civic.active);

export function paintCity(A: Canvas2D, kit: ArtKit, scene: Scene, traffic: Traffic, o: PaintOptions, layer?: StaticLayer): PaintResult {
  const { bw, bh, time } = o;
  A.setTransform(1, 0, 0, 1, 0, 0);
  A.imageSmoothingEnabled = false;
  A.fillStyle = kit.sky();
  A.fillRect(0, 0, bw, bh);
  const ox = Math.round(bw / 2 - o.camX), oy = Math.round(bh / 2 - o.camY);
  A.setTransform(1, 0, 0, 1, ox, oy);
  let draws = 1;
  const pen = (g: Canvas2D): PixelPen => (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  const px = pen(A);
  const heads = new Map<string, [number, number]>();
  const view = [-ox - 64, -oy - 64, -ox + bw + 64, -oy + bh + 360];
  const g = scene.growth;
  // Everything that stands, with its depth.
  const layout = kit.street();
  const claimed = scene.ground.claimed, used = scene.ground.used;
  const still: Item[] = [], live: Item[] = [];
  for (const it of layout.items) {
    if (!inGrowth(it.x, it.y, g) || (it.lot && used.has(it.lot)) || (it.block && !claimed.has(it.block))) continue;
    still.push({ k: 'item', depth: it.x + it.y, it });
  }
  if (layout.wheel && inGrowth(layout.wheel[0], layout.wheel[1], g)) still.push({ k: 'wheel', depth: layout.wheel[0] + layout.wheel[1], at: layout.wheel });
  still.push({ k: 'fountain', depth: 14.5 + 20.6 });
  for (const p of scene.places) (moving(p) ? live : still).push({ k: 'place', depth: p.depth, p });
  for (const c of traffic.cars) live.push({ k: 'car', depth: c.i + c.j + 1 + (c.dx + c.dy) * c.u, c });
  // The crowd in the square is drawn over whatever stands in front of it: it must always be seen.
  for (const a of scene.agents) live.push({ k: 'agent', depth: a.inSquare ? a.depth + 1000 : a.depth, a });
  for (const t of scene.trains) live.push({ k: 'train', depth: t.x + 14.5, x: t.x, car: t.car });
  live.sort((x, y) => x.depth - y.depth);

  const hitsLive: HitArea[] = [], topsLive = new Map<string, [number, number]>(), blitsLive: Blit[] = [];
  /** Draws one item at art coordinates into `G`; returns its blit (sprites only). */
  const draw = (G: Canvas2D, it: Item, hits: HitArea[], tops: Map<string, [number, number]>, out: Blit[]): void => {
    const owner = it.k === 'place' ? it.p.id : it.k === 'car' ? 'car' : it.k === 'train' ? 'train' : undefined;
    const blit = (s: Sprite, ax: number, ay: number, depth: number, t?: readonly [number, number, number, number]) => {
      G.drawImage(s.image, ax + s.dx, ay + s.dy);
      out.push({ image: s.image, x: ax + s.dx, y: ay + s.dy, w: s.w, h: s.h, depth, t: t ?? [ax + s.dx, ay + s.dy, ax + s.dx + s.w, ay + s.dy + s.h], ...(owner ? { id: owner } : {}) });
    };
    if (it.k === 'item') {
      const q = artXY(it.it.x, it.it.y), e = it.it.kind === 'tree' ? [11, 30] : it.it.kind === 'detail' ? [40, 44] : [18, 24];
      blit(kit.item(it.it), q[0], q[1], it.depth, [q[0] - e[0], q[1] - e[1], q[0] + e[0], q[1] + 6]);
    }
    else if (it.k === 'place') {
      const p = it.p, q = artXY(p.at[0], p.at[1]);
      const d = p.building ? kit.building(p.building) : kit.civic(p.civic!);
      const hw0 = p.tier === 'building' ? 34 : p.tier === 'house' ? 26 : p.id === 'town' ? 92 : 60;
      blit(d, q[0], q[1], it.depth, [q[0] - hw0, q[1] - d.top - 8, q[0] + hw0, q[1] + 20]);
      for (const x of d.extras ?? []) blit(x, q[0], q[1], it.depth + 0.01);
      tops.set(p.id, [q[0], q[1] - d.top]);
      const hw = p.tier === 'building' ? 26 : p.tier === 'house' ? 24 : p.id === 'town' ? 84 : 50;
      hits.push({ id: p.id, tier: p.tier === 'house' ? 'house' : 'building', r: [q[0] - hw, q[1] - d.top, q[0] + hw, q[1] + 14], depth: it.depth });
    } else if (it.k === 'car') {
      const [x, y] = carXY(it.c), q = artXY(x, y);
      blit(kit.car({ model: it.c.m, colour: it.c.c, dx: it.c.dx, dy: it.c.dy }), q[0], q[1], it.depth, [q[0] - 14, q[1] - 14, q[0] + 14, q[1] + 6]);
    } else if (it.k === 'train') {
      const q = artXY(it.x, 14.5);
      blit(kit.train(it.car), q[0], q[1], it.depth, [q[0] - 40, q[1] - 30, q[0] + 4, q[1] + 6]);
    } else if (it.k === 'agent') {
      const a = it.a, q = artXY(a.pos[0], a.pos[1]);
      kit.person(pen(G), q[0], q[1], a.person);
      heads.set(a.id, [q[0], q[1] - 20]);
      hits.push({ id: 'agent:' + a.id, tier: 'person', r: [q[0] - 9, q[1] - 21, q[0] + 9, q[1] + 6], depth: it.depth });
      out.push({ image: undefined as unknown as CanvasImageSource, x: q[0] - 9, y: q[1] - 30, w: 18, h: 36, depth: it.depth, t: [q[0] - 9, q[1] - 34, q[0] + 9, q[1] + 3] });
    } else if (it.k === 'wheel') wheel(pen(G), artXY(it.at[0], it.at[1]));
    else fountain(pen(G), artXY(14.5, 20.6));
  };

  // The static layer: rebuilt only when something still changed (or the light, the border, the claims).
  const sig = !layer ? '' : layer.keyOf?.scene === scene && layer.keyOf.light === lightKey ? layer.key : stillKey(kit, scene, still);
  if (layer) layer.keyOf = { scene, light: lightKey };
  // Sorted only when drawn (a layer rebuild or no layer): the order never matters for the key.
  const sortStill = () => still.sort((x, y) => x.depth - y.depth);
  let rebuilt = false;
  let stillBlits: Blit[], stillHits: HitArea[], stillTops: Map<string, [number, number]>;
  if (layer) {
    if (layer.key !== sig || !layer.surface) {
      const [W, H, LX, LY] = LAYER_BOX;
      layer.surface ??= layer.make(W, H);
      const L = layer.surface.ctx;
      L.setTransform(1, 0, 0, 1, 0, 0);
      L.clearRect(0, 0, W, H);
      L.imageSmoothingEnabled = false;
      L.setTransform(1, 0, 0, 1, LX, LY);
      const gr = kit.ground(scene.ground);
      L.drawImage(gr.image, gr.dx, gr.dy);
      highwayStubs(pen(L), g);
      for (const p of scene.pools) { const q = artXY(p.x, p.y), s = kit.pool(p.colour, p.r); L.drawImage(s.image, q[0] + s.dx, q[1] + s.dy); }
      layer.blits = []; layer.hits = []; layer.tops = new Map();
      sortStill();
      for (const it of still) draw(L, it, layer.hits, layer.tops, layer.blits);
      layer.key = sig;
      rebuilt = true;
    }
    A.drawImage(layer.surface.canvas, -LAYER_BOX[2], -LAYER_BOX[3]);
    stillBlits = layer.blits; stillHits = layer.hits; stillTops = layer.tops;
  } else {
    // No layer (tests): everything every frame.
    const gr = kit.ground(scene.ground);
    A.drawImage(gr.image, gr.dx, gr.dy);
    highwayStubs(px, g);
    for (const p of scene.pools) { const q = artXY(p.x, p.y), s = kit.pool(p.colour, p.r); A.drawImage(s.image, q[0] + s.dx, q[1] + s.dy); }
    stillBlits = []; stillHits = []; stillTops = new Map();
    sortStill();
    for (const it of still) { draw(A, it, stillHits, stillTops, stillBlits); draws++; }
  }
  // The moving things, and every still thing in front of one of them drawn again over it.
  const liveRects: Blit[] = [];
  // Draw the moving ones in depth order and, after each, the still sprites in front that overlap it.
  const redraw = new Set<Blit>();
  const liveOf = new Map<Item, Blit[]>();
  for (const it of live) {
    const n0 = blitsLive.length;
    draw(A, it, hitsLive, topsLive, blitsLive);
    draws++;
    for (let i = n0; i < blitsLive.length; i++) liveRects.push(blitsLive[i]);
    liveOf.set(it, blitsLive.slice(n0));
  }
  if (liveRects.length) {
    const front: Blit[] = [];
    // The moving things' rectangles in columns of the art buffer: a still sprite is only tested against those in
    // its own columns (a few hundred still sprites against dozens of cars every frame otherwise).
    const COL = 64, cols = new Map<number, Blit[]>();
    for (const r of liveRects) for (let c = Math.floor(r.t[0] / COL); c <= Math.floor(r.t[2] / COL); c++) { const l = cols.get(c); if (l) l.push(r); else cols.set(c, [r]); }
    for (const b of stillBlits) {
      if (redraw.has(b) || b.x > view[2] || b.y > view[3] || b.x + b.w < view[0] || b.y + b.h < view[1]) continue;
      search: for (let c = Math.floor(b.t[0] / COL); c <= Math.floor(b.t[2] / COL); c++) {
        for (const r of cols.get(c) ?? []) if (b.depth > r.depth && b.t[0] < r.t[2] && b.t[2] > r.t[0] && b.t[1] < r.t[3] && b.t[3] > r.t[1]) { redraw.add(b); front.push(b); break search; }
      }
    }
    // A still sprite drawn again may cover a moving one that stands in front of it: replay just those, by depth.
    const again = live.filter((it) => (liveOf.get(it) ?? []).some((r) => front.some((b) => b.depth < it.depth && b.t[0] < r.t[2] && b.t[2] > r.t[0] && b.t[1] < r.t[3] && b.t[3] > r.t[1])));
    const all = [...front.map((b) => ({ d: b.depth, b, it: undefined as Item | undefined })), ...again.map((it) => ({ d: it.depth, b: undefined as Blit | undefined, it }))];
    all.sort((x, y) => x.d - y.d);
    const scratchHits: HitArea[] = [], scratchTops = new Map<string, [number, number]>(), scratch: Blit[] = [];
    for (const e of all) { if (e.b) A.drawImage(e.b.image, e.b.x, e.b.y); else draw(A, e.it!, scratchHits, scratchTops, scratch); draws++; }
  }
  for (const p of scene.places) {
    if (p.building?.state === 'failed') { const t = (stillTops.get(p.id) ?? topsLive.get(p.id)); if (t) { kit.smoke(px, t[0], t[1] + 12, time, '#59627A', 5, 22, p.building.seed % 10 / 10); px(t[0] - 2, t[1] + 10, 4, 4, '#FF8A2B'); } }
    if (p.civic?.kind === 'connector' && p.civic.variant === 0 && p.civic.level > 0) {   // cooling towers steam with the connector's calls
      const rate = Math.min(1, Math.max(0.12, p.civic.level / 14));
      for (const [x, y] of [[13.9, p.at[1] + 0.85], [15.1, p.at[1] + 0.7]]) { const t = artXY(x, y, 46); kit.smoke(px, t[0], t[1], time * (0.6 + rate), '#FFFFFF', Math.round(3 + rate * 4), 20 + rate * 16, x); }
    }
  }
  // Just started (no calls yet): dust at the door while the podium comes up.
  for (const p of scene.places) if (p.building?.stage === 'groundbreaking') {
    const q = artXY(p.at[0], p.at[1] + p.building.footprint + 0.3);
    kit.smoke(px, q[0], q[1], time * 2, '#E3E0D6', 3, 8, 0.4);
  }
  for (const id of scene.puffs) {
    const t = stillTops.get(id) ?? topsLive.get(id);
    if (t) kit.smoke(px, t[0] - 4, t[1] + 14, time, '#8A93A3', 4, 16, 0.2);
  }
  // Tokens are the city's power: light dots run along the line from a busy power station into town (data-driven).
  if (time) for (const m of scene.power) {
    const n = Math.max(1, Math.min(6, Math.ceil(m.rate / 9000))), L1 = Math.abs(m.feed - m.at[0]), L2 = 12.4 - m.at[1];
    for (let k = 0; k < n; k++) {
      const d = (time * 2.2 + k * (L1 + L2) / n) % (L1 + L2);
      const q = d < L1 ? artXY(m.at[0] + (m.feed - m.at[0]) * (d / L1), m.at[1], 22) : artXY(m.feed, m.at[1] + d - L1, 22);
      px(q[0] - 2, q[1] - 2, 4, 4, '#141A30'); px(q[0] - 1, q[1] - 1, 2, 2, '#FFC928');
    }
  }
  if (scene.rally) { const q = artXY(14.5, 18.6); kit.balloon(px, q[0], q[1] - (time ? Math.floor(time * 2) & 1 : 0), o.zoom < 1 ? 2 : 1); }
  const shift = (b: Blit): Blit => ({ ...b, x: b.x + ox, y: b.y + oy, t: [b.t[0] + ox, b.t[1] + oy, b.t[2] + ox, b.t[3] + oy] });
  return {
    blits: [...stillBlits.map(shift), ...blitsLive.filter((b) => b.image).map((b) => ({ ...shift(b), live: true }))],
    hits: [...stillHits, ...hitsLive],
    tops: new Map([...stillTops, ...topsLive]),
    heads, draws, rebuilt,
  };
}

/** What the static layer depends on: the light, the border, the claims, and every still thing's drawing key. */
function stillKey(kit: ArtKit, scene: Scene, still: Item[]): string {
  const parts: string[] = [scene.growth + '', [...scene.ground.claimed].join(';'), [...scene.ground.used].join(';'), scene.ground.models + '.' + scene.ground.connectors, JSON.stringify(scene.pools)];
  for (const it of still) if (it.k === 'place') { const { building: b, civic: c } = it.p; parts.push(b ? JSON.stringify(b) : JSON.stringify(c)); }
  return lightKey + '|' + parts.join('|');
}
let lightKey = '';
/** The light key the static layer was drawn in (set by the view each frame). */
export const setLayerLight = (k: string) => { lightKey = k; };

/** Highways to neighbouring cities, as a stub until the region view (phase 8): an exit at each fixed point on the
 * border, a few spans on piers, then a barrier. No traffic and no names: there is no neighbour data yet. */
function highwayStubs(px: PixelPen, g: number): void {
  const G = GROWTH[g];
  const exits: [number, number, number, number][] = [[12.5, G[1], 0, -1], [G[2], 16.5, 1, 0], [16.5, G[3], 0, 1]];
  for (const [x, y, dx, dy] of exits) {
    const q0 = artXY(x, y), dirx = (dx - dy) * 16, diry = (dx + dy) * 8, N = 6;
    for (let k = 0; k <= N * 4; k++) {
      const u = k / 4, qx = Math.round(q0[0] + dirx * u), qy = Math.round(q0[1] + diry * u);
      if (k % 4 === 0) { px(qx - 3, qy + 4, 6, 18, '#141A30'); px(qx - 2, qy + 4, 4, 17, '#8A93A3'); }
      px(qx - 10, qy - 6, 20, 12, '#141A30');
    }
    for (let k = 0; k <= N * 4; k++) { const u = k / 4, qx = Math.round(q0[0] + dirx * u), qy = Math.round(q0[1] + diry * u); px(qx - 9, qy - 5, 18, 10, '#CDD2DA'); }
    for (let k = 0; k <= N * 4; k++) { const u = k / 4, qx = Math.round(q0[0] + dirx * u), qy = Math.round(q0[1] + diry * u); px(qx - 8, qy - 4, 16, 8, '#59627A'); if (k % 2 === 0) px(qx - 1, qy - 1, 2, 2, '#FFC928'); }
    const e = [Math.round(q0[0] + dirx * N), Math.round(q0[1] + diry * N)];
    px(e[0] - 11, e[1] - 9, 22, 7, '#141A30');
    for (let m = 0; m < 5; m++) px(e[0] - 10 + m * 4, e[1] - 8, 4, 5, m & 1 ? '#FFFFFF' : '#E5433D');
  }
}

/** The fairground wheel: scenery, standing still. */
function wheel(px: PixelPen, q: [number, number]): void {
  const hy = q[1] - 50;
  for (let d = 0; d <= 22; d++) { px(q[0] - 16 + Math.round(d * 16 / 22), q[1] - Math.round(d * 50 / 22), 2, 2, '#59627A'); px(q[0] + 16 - Math.round(d * 16 / 22), q[1] - Math.round(d * 50 / 22), 2, 2, '#59627A'); }
  for (let d = 0; d < 40; d++) { const an = d / 40 * 6.283; px(q[0] + Math.round(Math.cos(an) * 40), hy + Math.round(Math.sin(an) * 40), 2, 2, '#E5433D'); }
  const COL = ['#FF4FA3', '#22C3E6', '#8BD93E', '#FFC928', '#E5433D', '#8E5BE8', '#FF8A2B', '#2F8BFF'];
  for (let k = 0; k < 8; k++) {
    const an = k * 0.7854, gx = q[0] + Math.round(Math.cos(an) * 40), gy = hy + Math.round(Math.sin(an) * 40);
    for (let d = 1; d < 8; d++) px(q[0] + Math.round(Math.cos(an) * d * 5), hy + Math.round(Math.sin(an) * d * 5), 1, 1, '#AEB5C2');
    px(gx - 3, gy, 7, 7, '#141A30'); px(gx - 2, gy + 1, 5, 5, COL[k]);
  }
  px(q[0] - 2, hy - 2, 5, 5, '#141A30'); px(q[0] - 1, hy - 1, 3, 3, '#FFC928');
}

/** The fountain in the square: a basin and a column, still. */
function fountain(px: PixelPen, q: [number, number]): void {
  px(q[0] - 20, q[1] - 6, 40, 10, '#141A30'); px(q[0] - 19, q[1] - 5, 38, 8, '#CDD2DA'); px(q[0] - 16, q[1] - 4, 32, 5, '#2FA8F0');
  px(q[0] - 4, q[1] - 19, 8, 15, '#141A30'); px(q[0] - 3, q[1] - 18, 6, 14, '#F4F1E8'); px(q[0] - 6, q[1] - 22, 12, 4, '#141A30'); px(q[0] - 5, q[1] - 21, 10, 2, '#FFC928');
}
