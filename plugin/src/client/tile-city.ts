// The workbench tile's pure parts (tested without React): which layout a size gets, and the still mini city.
import { rallyAt, type PlacementState, type Store } from '@dsh-universe/model';
import { Traffic, ZOOM_LEVELS, artXY, buildScene, paintCity, scaleOf, wholeCity, type ArtKit, type Camera, type Canvas2D } from '@dsh-universe/renderer';

export type TileLayout = 'wide' | 'square' | 'strip';
/** 4×2: the city beside the numbers; 2×2: the city over two numbers; 4×1: a strip of city beside three numbers. */
export const layoutOf = (size?: { w: number; h: number }): TileLayout => (!size || size.h >= 2 ? (size && size.w <= 2 ? 'square' : 'wide') : 'strip');

/** Half size: one art pixel per two CSS pixels (crisp at a device pixel ratio of 2; averaged at 1). */
const TILE_ZOOM_INDEX = 1;

/** The balloon's top in art pixels (paint.ts: over artXY(14.5, 18.6), doubled below zoom 1 as in the tile, outline included). */
const BALLOON_K = 2;
export const balloonTop = (): number => artXY(14.5, 18.6)[1] - 64 - 22 * BALLOON_K - BALLOON_K;
/** CSS pixels the balloon's top stays inside the frame (the 4×1 strip cut it off). */
export const BALLOON_INSET = 4;

/**
 * The camera's art y: the square a little below the middle so the hall and the blocks behind it fill the picture, but
 * never so low that the balloon's top leaves the frame (a short frame, the 4×1 strip, moves the picture up instead).
 */
export function tileCamY(waiting: number, h: number, dpr: number): number {
  const base = waiting ? 250 : 240, sc = scaleOf({ x: 0, y: 0, zi: TILE_ZOOM_INDEX }, { w: 1, h, dpr });
  return Math.min(base, Math.floor(balloonTop() - (BALLOON_INSET * dpr - (h * dpr) / 2) / sc));
}

/**
 * A still picture of a city. The tile frames the square at half size; `whole` (a city card in the cities-around view)
 * frames the whole city at the widest level that fits.
 */
export function paintTileCity(canvas: HTMLCanvasElement, kit: ArtKit, o: { store: Store; placement: PlacementState; T: number; dark: boolean; w: number; h: number; dpr: number; whole?: boolean }): void {
  const W = Math.round(o.w * o.dpr), H = Math.round(o.h * o.dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const g = canvas.getContext('2d') as Canvas2D | null;
  if (!g) return;
  kit.setLight({ dark: o.dark });
  const scene = buildScene({
    store: o.store, placement: o.placement, T: o.T, templateTags: kit.buildingTags, time: 0, night: o.dark,
    names: { town: '', station: '', fire: '', school: '', library: '' },
  });
  const traffic = new Traffic(11);
  traffic.step(scene.cars, scene.growth, 0, false);
  // The square a little below the middle, so the hall and the blocks behind it fill the picture.
  const n = rallyAt(o.store, o.T).length;
  const cam: Camera = o.whole ? wholeCity({ w: o.w, h: o.h, dpr: o.dpr }, scene.growth) : { x: 0, y: tileCamY(n, o.h, o.dpr), zi: TILE_ZOOM_INDEX };
  const sc = scaleOf(cam, { w: o.w, h: o.h, dpr: o.dpr });
  const bw = Math.ceil(W / sc) + 2 + (Math.ceil(W / sc) & 1), bh = Math.ceil(H / sc) + 2 + (Math.ceil(H / sc) & 1);
  const art = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(bw, bh) : Object.assign(document.createElement('canvas'), { width: bw, height: bh });
  const a = (art as HTMLCanvasElement).getContext('2d') as Canvas2D | null;
  if (!a) return;
  paintCity(a, kit, scene, traffic, { time: 0, zoom: o.whole ? ZOOM_LEVELS[cam.zi] : 0.5, bw, bh, camX: cam.x, camY: cam.y });
  g.setTransform(1, 0, 0, 1, 0, 0);
  // Whole device pixels per art pixel stay crisp; below one (a low-density screen) the picture is averaged down.
  g.imageSmoothingEnabled = sc < 1;
  g.fillStyle = kit.sky();
  g.fillRect(0, 0, W, H);
  g.drawImage(art as CanvasImageSource, Math.round(W / 2 - (bw / 2) * sc), Math.round(H / 2 - (bh / 2) * sc), Math.round(bw * sc), Math.round(bh * sc));
}

/** One adjacent city's figures now (the host's `n.summary`, as the Today bar adds them). */
export interface TileLocal { id: string; running: number; errors: number; tokens: number }
/** The tile's figures: DSH's own, and what Claude Code and Codex on this device add (the Today bar's "+n local"). */
export interface TileFigures { need: number; running: number; errors: number; tokens: number; local: { running: number; errors: number; tokens: number } }

/** Today's DSH figures with the local addition kept apart (never summed into DSH's own figure, as in the Today bar). */
export function tileFigures(d: { need: number; running: number; errors: number; tokens: number }, local: readonly TileLocal[]): TileFigures {
  const sum = (k: 'running' | 'errors' | 'tokens') => local.reduce((a, x) => a + (Number.isFinite(x[k]) && x[k] > 0 ? x[k] : 0), 0);
  return { need: d.need, running: d.running, errors: d.errors, tokens: d.tokens, local: { running: sum('running'), errors: sum('errors'), tokens: sum('tokens') } };
}

/** How often the tile asks for the local figures while it is on screen (the panel asks every 3 s). */
export const TILE_LOCAL_MS = 45_000;
