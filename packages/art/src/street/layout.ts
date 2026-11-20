// Static street furniture, trees and park patterns of the city template, seeded once.
// They carry no data and never move; there are no people among them (passers-by, staff, buskers,
// animals, birds, balloons and kites are all gone). A lot's furniture shows only while its block is claimed and
// the lot is still empty; a tree on a lot goes when a building takes the lot.
import type { StreetItem, StreetLayout } from '@dsh-universe/renderer';
import { cityTemplate, hs, rng, type Block } from '@dsh-universe/model';
import { civicFootprints, inRect, itemRadius, itemRect, lotEnvelope, rectsMeet } from '../footprints.ts';

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export interface Deco { bx: number; by: number; v: number }
export interface CityLayout extends StreetLayout { deco: readonly Deco[]; lotVariant: ReadonlyMap<string, number> }

let cached: CityLayout | undefined;

export function cityLayout(): CityLayout {
  if (cached) return cached;
  const T = cityTemplate();
  const r = rng(80);
  const items: StreetItem[] = [];
  const deco: Deco[] = [];
  const lotVariant = new Map<string, number>();
  const tree = (x: number, y: number, lot?: string) => { const s = r() < 0.4 ? 0 : r() < 0.6 ? 1 : 2, k = r() < 0.3 ? 1 : 0; items.push({ x, y, kind: 'tree', k, v: s, ...(lot ? { lot } : {}) }); };
  const put = (x0: number, y0: number, x1: number, y1: number, n: number, lot?: string) => { for (let i = 0; i < n; i++) tree(lerp(x0, x1, r()), lerp(y0, y1, r()), lot); };
  const pp = (x: number, y: number, k: number, b?: Block, lot?: string) => items.push({ x, y, kind: 'prop', k, v: 0, ...(b ? { block: b.key } : {}), ...(lot ? { lot } : {}) });
  for (const b of T.blocks) if (b.zone === 'park') {
    const v = Math.floor(hs(b.bx, b.by, 19) * 6);
    deco.push({ bx: b.bx, by: b.by, v });
    if (v === 5) { put(b.bx + 0.4, b.by + 0.4, b.bx + 4.6, b.by + 1.2, 4); put(b.bx + 0.4, b.by + 3.8, b.bx + 4.6, b.by + 4.6, 4); }
    else if (v === 2) put(b.bx + 2.35, b.by + 0.5, b.bx + 2.65, b.by + 4.5, 3);
  }
  // The quality sample: the quay plaza east of the hall (its deck is x 17–20, y 13–16), dressed by hand, without
  // people. Few pieces, each on its own ground (footprints.ts DETAIL_EXTENT): a café terrace, a newsstand by the water, a
  // tree in blossom and two signal masts at the deck's west corners. It used to hold nine pieces and three trees on
  // nine tiles, overlapping one another, the road and the lot to the south: it read as a pile next to the hall.
  const SIGN: Record<number, StreetItem['sign']> = { 4: 'cafe', 5: 'truck', 1: 'news', 0: 'bus' };
  const H = (x: number, y: number, k: number, v = 0) => items.push({ x, y, kind: 'detail', k, v, ...(SIGN[k] ? { sign: SIGN[k] } : {}) });
  H(18.7, 14.0, 4); H(19.15, 15.3, 1); H(17.06, 15.94, 2); H(17.06, 13.06, 2); H(17.45, 15.5, 3, 2);
  const ARM = [4, 5, 8, 10, 13, 6, 16, 29, 32];
  for (const b of T.blocks) {
    const h = Math.floor(hs(b.bx, b.by, 31) * 1e6), X = b.bx, Y = b.by;
    pp(X + 5.08, Y + 5.08, 12); pp(X - 0.08, Y + 5.08, 11); pp(X - 0.08, Y - 0.08, 25); pp(X + 5.08, Y - 0.08, 25);
    if (b.zone === 'build') {
      pp(X + 2.5, Y + 2.5, [15, 10, 5, 7][h % 4]); pp(X + 2.5, Y + 1, ARM[(h >> 2) % 9]); pp(X + 2.5, Y + 4, ARM[(h >> 5) % 9]); pp(X + 1, Y + 2.5, ARM[(h >> 8) % 9]); pp(X + 4, Y + 2.5, ARM[(h >> 11) % 9]);
      pp(X + 2.5, Y + 4.86, [0, 1, 7, 9][(h >> 14) % 4]); pp(X + 4.86, Y + 2.5, [2, 3, 6, 11][(h >> 16) % 4]); pp(X + 2.5, Y + 0.14, [11, 14, 6, 5][(h >> 18) % 4]); pp(X + 0.14, Y + 2.5, [11, 2, 3, 14][(h >> 3) % 4]);
      for (const L of b.lots) {
        const v = Math.floor(hs(L.x, L.y, 7) * 4);
        lotVariant.set(L.key, v);
        if (v < 2) { pp(L.x + 0.9, L.y + 0.9, v ? 19 : 18, b, L.key); pp(L.x + 1.5, L.y + 1.6, 17, b, L.key); pp(L.x + 1, L.y + 1.92, 21, b, L.key); pp(L.x + 1.35, L.y + 0.6, 26, b, L.key); }
        else if (v === 2) { pp(L.x + 0.5, L.y + 0.6, 22, undefined, L.key); pp(L.x + 1.5, L.y + 1.4, 23, undefined, L.key); pp(L.x + 0.55, L.y + 1.5, 24, undefined, L.key); }
      }
    } else if (b.zone === 'park') { pp(X + 1.2, Y + 2.5, 4); pp(X + 3.8, Y + 2.5, 4); pp(X + 2.5, Y + 4.6, 11); pp(X + 4.5, Y + 4.5, 6); pp(X + 2.5, Y + 0.5, 13); pp(X + 0.5, Y + 4.5, 5); pp(X + 3.6, Y + 1.2, 27); pp(X + 1.3, Y + 3.7, 28); pp(X + 4.5, Y + 0.5, 4); pp(X + 0.5, Y + 0.6, 29); }
    else if (b.zone === 'shops') { pp(X + 2.5, Y + 2.5, 10); pp(X + 2.5, Y + 1, 10); pp(X + 2.5, Y + 4, 13); pp(X + 2.5, Y + 4.86, 0); pp(X + 1, Y + 2.5, 32); pp(X + 4, Y + 2.5, 32); pp(X + 2.5, Y + 0.3, 24); }
    else if (b.zone === 'library') { pp(X + 1, Y + 4.6, 4); pp(X + 4, Y + 4.6, 4); pp(X + 2.5, Y + 4.7, 5); pp(X + 4.7, Y + 2.5, 8); }
  }
  for (let k = 0; k < 5; k++) { pp(12.3, 17.25 + k, 14); pp(16.7, 17.25 + k, 14); }
  pp(13, 21.8, 5); pp(16, 21.8, 5); pp(12.7, 16.95, 4); pp(16.3, 16.95, 4); pp(11.9, 12.8, 9); pp(17.2, 22.2, 7); pp(13.5, 21.78, 30); pp(15.5, 21.78, 30); pp(8.2, 14.05, 4); pp(9.4, 14.05, 6); pp(13.2, 17.2, 29); pp(15.9, 20.6, 32);
  for (let x = 18; x < 40; x += 2) { pp(x, 16.02, 14); pp(x + 1, 12.98, x % 4 ? 4 : 11); if ((x >> 1) & 1) pp(x + 1.2, 14.9 - (x % 3) * 0.35, 20); }
  put(13.3, 1.3, 15.7, 2.9, 5); put(13.3, 6.2, 15.7, 8.2, 4); put(1.3, 13.2, 5.7, 13.8, 6); put(1.3, 15.3, 5.7, 15.8, 6); put(7.2, 15.3, 11.7, 15.8, 6);
  put(13.3, -11, 15.7, -1, 10); put(13.3, 29.3, 15.7, 39.7, 12); put(-11.5, 13.1, -0.5, 13.7, 10); put(-11.5, 15.3, -0.5, 15.8, 10);
  for (const b of T.blocks) if (b.zone === 'build') for (const L of b.lots) { if (r() < 0.7) put(L.x + 0.3, L.y + 0.3, L.x + 1.7, L.y + 1.7, 1 + ((r() * 2) | 0), L.key); }
  put(12.15, 13.3, 12.85, 21.7, 7); put(16.15, 13.3, 16.85, 21.7, 7); put(13.2, 21.72, 15.8, 21.9, 3);
  // One outer park is the fairground (its wheel is static scenery); the other fairgrounds become paved squares.
  const outer = deco.filter((d) => !(d.bx >= 1 && d.bx <= 23 && d.by >= 1 && d.by <= 23));
  const fd = outer.find((d) => d.v === 4) ?? outer[0] ?? deco[0];
  for (const d of deco) if (d.v === 4 && d !== fd) d.v = 3;
  if (fd) fd.v = 4;
  const inSample = (o: { x: number; y: number }) => o.x > 16.9 && o.x < 20.6 && o.y > 12.9 && o.y < 17.1;
  // Nothing stands in anything else: a random tree that fell inside a civic building, on a session lot it does not
  // belong to, or on a piece of furniture is left out (the hand-placed pieces are kept clear by checks instead).
  const civic = civicFootprints(T).flatMap((c) => c.rects);
  const lots = T.blocks.flatMap((b) => b.lots);
  const fixed = items.filter((o) => o.kind !== 'tree');
  const clear = (o: StreetItem) => o.kind !== 'tree' || (!civic.some((r) => inRect(o.x, o.y, r, itemRadius(o)))
    && !lots.some((L) => L.key !== o.lot && rectsMeet(itemRect(o), lotEnvelope(L)))
    && !fixed.some((f) => rectsMeet(itemRect(o), itemRect(f))));
  const kept = items.filter((o) => (o.kind === 'detail' || !inSample(o)) && clear(o));
  cached = { items: kept, deco, lotVariant, ...(fd ? { wheel: [fd.bx + 2.5, fd.by + 2.2] as const } : {}) };
  return cached;
}
