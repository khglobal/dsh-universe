// Where things stand on the ground, in tiles: the civic buildings' footprints as their painters draw them
// (templates/civic/civic.ts), a session lot's envelope (the widest tower and its subagent pods) and the street
// furniture's own small footprint. Layout rules only: the checks hold the city to "nothing stands in anything else".
import { cityTemplate, type CityTemplate, type Lot } from '@dsh-universe/model';
import { STATION_DEPTH_ADD, TOWN_DEPTH_ADD, type StreetItem } from '@dsh-universe/renderer';

export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];
export interface Footprint { id: string; rects: readonly Rect[]; /** The painter's depth for it (scene.ts). */ depth: number }

/** The connectors' places (scene.ts CONNECTOR_AT), one per slot. */
export const CONNECTOR_SPOTS: readonly (readonly [number, number])[] = [[14.5, 26.8], [14.5, 9.8], [14.5, 31.5]];
/** Plugin shops: the place of shop i (scene.ts). */
export const shopSpot = (i: number): [number, number] => { const by = [7, 17][(i >> 2) % 2], sl = i & 3; return [23 + (sl & 1) * 3 + 1, by + (sl >> 1) * 3 + 1]; };

/** The civic baseline and every place that may join it (all power plants, connectors and shops), as painted. */
export function civicFootprints(template: CityTemplate = cityTemplate()): Footprint[] {
  const at = (id: string) => template.civic.find((c) => c.id === id)!.at;
  const out: Footprint[] = [];
  const t = at('town');
  out.push({ id: 'town', rects: [[12.35, 13.35, 16.65, 16.75]], depth: t[0] + t[1] + TOWN_DEPTH_ADD });
  const s = at('station');
  out.push({ id: 'station', rects: [[7.2, 13.1, 10.2, 13.8], [10.5, 13.15, 11.0, 13.65], [11.5, 14.3, 11.7, 14.7]], depth: s[0] + s[1] + STATION_DEPTH_ADD });
  const f = at('fire');
  out.push({ id: 'fire', rects: [[f[0] - 1.1, f[1] - 0.6, f[0] + 1.1, f[1] + 0.6]], depth: f[0] + f[1] });
  const sc = at('school');
  out.push({ id: 'school', rects: [[sc[0] - 0.9, sc[1] - 0.7, sc[0] + 0.9, sc[1] + 0.7]], depth: sc[0] + sc[1] });
  const l = at('library');
  out.push({ id: 'library', rects: [[l[0] - 1.7, l[1] - 1.3, l[0] + 1.7, l[1] + 1.6]], depth: l[0] + l[1] });
  template.powerBlocks.forEach(([bx, by], i) => { const c = [bx + 2.5, by + 2.5]; out.push({ id: 'power:' + i, rects: [[c[0] - 1.7, c[1] - 0.9, c[0] + 1.6, c[1] + 0.9]], depth: c[0] + c[1] }); });
  CONNECTOR_SPOTS.forEach(([x, y], i) => {
    const ref = i === 0 ? [14.5, 14.5] : i === 1 ? [14.5, 9.8] : [14.5, 24.5], dx = x - ref[0], dy = y - ref[1];
    const r: Rect = i === 0 ? [13.3, 13.4, 15.6, 15.85] : i === 1 ? [13.7, 9.2, 15.3, 10.4] : [13.6, 23.9, 15.4, 25.7];
    out.push({ id: 'conn:' + i, rects: [[r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]], depth: x + y });
  });
  for (let i = 0; i < 8; i++) { const [x, y] = shopSpot(i); out.push({ id: 'shop:' + i, rects: [[x - 0.76, y - 0.66, x + 0.76, y + 0.66]], depth: x + y }); }
  return out;
}

/** How far a tower's subagent pods stand out of its east face (tiles; tower.ts). */
export const POD_REACH = 0.1;
/** The ground a session's tower may cover on its lot: the widest footprint (0.9) round the lot's centre, and its
 * subagent pods. */
export function lotEnvelope(L: Lot): Rect {
  const cx = L.x + 1, cy = L.y + 1, hw = 0.9;
  return [cx - hw, cy - hw, cx + hw + POD_REACH, cy + hw];
}

/** The ground a piece of street furniture covers round its centre: a small radius for props and trees. */
export function itemRadius(it: Pick<StreetItem, 'kind'>): number { return it.kind === 'detail' ? 0.3 : it.kind === 'tree' ? 0.2 : 0.12; }
/** The detailed pieces' ground as furniture.ts draws them (x0, y0, x1, y1 round the centre), by kind. */
export const DETAIL_EXTENT: Record<number, Rect> = {
  0: [-0.95, -0.26, 0.98, 0.55], 1: [-0.6, -0.45, 0.75, 0.5], 2: [-0.07, -0.07, 0.07, 0.07], 3: [-0.34, -0.34, 0.34, 0.34],
  4: [-0.9, -0.62, 0.9, 0.6], 5: [-0.6, -0.22, 0.9, 0.45], 6: [-0.8, -0.2, 0.8, 0.2], 7: [-0.8, -0.25, 0.8, 0.25],
};
/** The ground a piece of street furniture covers, as a rectangle. */
export function itemRect(it: Pick<StreetItem, 'kind' | 'k' | 'x' | 'y'>): Rect {
  const e = it.kind === 'detail' ? DETAIL_EXTENT[it.k] ?? [-0.3, -0.3, 0.3, 0.3] : (() => { const r = itemRadius(it); return [-r, -r, r, r] as const; })();
  return [it.x + e[0], it.y + e[1], it.x + e[2], it.y + e[3]];
}

export const inRect = (x: number, y: number, r: Rect, m = 0) => x > r[0] - m && x < r[2] + m && y > r[1] - m && y < r[3] + m;
export const rectsMeet = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
