// The DSH Universe art kit: every drawing the renderer asks for, through the sprite cache. All rights reserved.
import type { ArtKit, BuildingSpec, CarSpec, CivicSpec, Drawn, GroundSpec, Light, PixelPen, PersonSpec, RoomPart, RoomSpec, Sprite, StackFloor, StreetItem } from '@dsh-universe/renderer';
import { paintRoom, paintStack, roomBox, roomLayout, stackBox } from './interior.ts';
import { roomTier } from './room-tier.ts';
import { RoomCache } from './room-cache.ts';
import { greyRamp } from './palette.ts';
import { setLight as applyLight, P } from './light.ts';
import { drawPerson, smoke, balloon } from './people.ts';
import { ROOMS } from './rooms.ts';
import { SpriteCache, type SurfaceFactory } from './sprites.ts';
import { GROUND_BOX, paintGround } from './street/ground.ts';
import { vHD, vProp, vTree } from './street/furniture.ts';
import { cityLayout } from './street/layout.ts';
import { CIVIC_BOX, paintConnector, paintFire, paintLibrary, paintPower, paintSchool, paintShop, paintStation, paintTown } from './templates/civic/civic.ts';
import { TOWER_TEMPLATES } from './templates/buildings/templates.ts';
import { paintCrane, paintTower } from './templates/buildings/tower.ts';
import { CAR_COLOURS, paintCar, paintPool, paintTrainCar } from './vehicles.ts';
import { g } from './iso.ts';

export const ART_KIT_ID = 'dsh-universe-art';
export const ART_KIT_VERSION = '0.2.0';
const AS = 0.5;

/** A kit with its own sprite cache (one per city view). `make` gives drawing surfaces (tests pass a fake). */
export function createArtKit(o: { make?: SurfaceFactory; budgetBytes?: number } = {}): ArtKit & { cache: SpriteCache; roomCache: RoomCache } {
  const cache = new SpriteCache(o.make, o.budgetBytes);
  const roomCache = new RoomCache(o.make);
  const topOf = new Map<string, { key: string; top: number; doorY: number; crane?: { x: number; y: number; z: number }; roof?: { x: number; y: number; w: number; d: number; z: number } }>();
  /** Tower redraws allowed per frame; beyond that a tower keeps its previous sprite for a frame or two. */
  const REDRAWS_PER_FRAME = 4;
  let redraws = 0;
  let light = applyLight({ dark: false });
  const civicPaint: Record<CivicSpec['kind'], (s: CivicSpec) => number> = {
    town: paintTown, station: paintStation, fire: paintFire, school: paintSchool, library: paintLibrary, power: paintPower, connector: paintConnector, shop: paintShop,
  };
  return {
    cache,
    roomCache,
    id: ART_KIT_ID,
    version: ART_KIT_VERSION,
    rooms: ROOMS,
    buildingTemplates: TOWER_TEMPLATES.length,
    buildingTags: TOWER_TEMPLATES.map((t) => t.tags),
    setLight(l: Light) { light = applyLight(l); return light; },
    sky: () => P.sky,
    street: () => cityLayout(),
    ground(spec: GroundSpec): Sprite {
      const key = ['gr', light, spec.growth, spec.models, spec.connectors, spec.rail, [...spec.claimed].sort().join(';'), [...spec.used].sort().join(';')].join('|');
      const [w, h, ox, oy] = GROUND_BOX;
      return cache.get('ground', key, w, h, ox, oy, () => paintGround(spec), { outline: false });
    },
    beginFrame() { redraws = 0; },
    building(spec: BuildingSpec): Drawn {
      const { id, ...rest } = spec;
      const key = light + '|' + JSON.stringify({ ...rest, frames: { ...rest.frames, crane: 0 } });
      // A blinking (waiting) tower keeps both of its pictures: they take turns twice a second, and painting one again
      // each time (with its read-back for the outline) was most of a frame's cost.
      const owner = spec.frames.blink ? id + '#blink' : id;
      const meta = topOf.get(id);
      let s: Sprite;
      let m = meta;
      if (meta && meta.key !== key && redraws >= REDRAWS_PER_FRAME && cache.peek(owner)) s = cache.peek(owner)!;
      else {
        let fresh: typeof meta | undefined;
        s = cache.get(owner, key, 140, 344, 70, 304, () => { const r = paintTower(spec); fresh = { key, top: r.top * AS, doorY: r.doorY, crane: r.crane, roof: r.roof }; redraws++; }, { tx0: spec.at[0], ty0: spec.at[1] });
        if (fresh) { topOf.set(id, fresh); m = fresh; }
      }
      const out: Drawn = { ...s, top: m?.top ?? 0, doorY: m?.doorY };
      if (m?.roof) {   // the roof in art pixels, relative to the anchor tile (additive hook for the data views)
        const r = m.roof;
        out.roof = { dx: Math.round((r.x - r.y - spec.at[0] + spec.at[1]) * 16), dy: Math.round((r.x + r.y - spec.at[0] - spec.at[1]) * 8 - r.z * AS), hw: Math.round((r.w + r.d) * 16), hh: Math.round((r.w + r.d) * 8) };
      }
      if (m?.crane && spec.state === 'running') {
        const angle = (spec.frames.crane + (spec.seed >>> 0)) % 16;
        const c = cache.shared('crane' + angle + light, 96, 56, 48, 44, () => paintCrane(angle));
        const a = [Math.round((m.crane.x - m.crane.y) * 16), Math.round((m.crane.x + m.crane.y) * 8 - m.crane.z * AS)], b = [Math.round((spec.at[0] - spec.at[1]) * 16), Math.round((spec.at[0] + spec.at[1]) * 8)];
        out.extras = [{ ...c, dx: c.dx + a[0] - b[0], dy: c.dy + a[1] - b[1] }];
      }
      return out;
    },
    civic(spec: CivicSpec): Drawn {
      const { id, ...rest } = spec;
      const key = light + '|' + JSON.stringify(rest);
      const [w, h, ox, oy] = CIVIC_BOX[spec.kind];
      let top = 0;
      // Both pictures of a blinking place (a busy power station) stay cached, like a waiting tower's.
      const owner = spec.frames?.blink ? id + '#blink' : id;
      const s = cache.get(owner, key, w, h, ox, oy, () => { top = civicPaint[spec.kind](spec); }, { tx0: spec.at[0], ty0: spec.at[1] });
      const meta = topOf.get(owner);
      if (meta && meta.key === key) return { ...s, top: meta.top };
      topOf.set(owner, { key, top: top * AS, doorY: 0 });
      return { ...s, top: top * AS };
    },
    item(it: StreetItem): Sprite {
      if (it.kind === 'tree') return cache.shared('tr' + it.k + it.v + light, 30, 44, 15, 38, () => vTree({ k: it.k, s: it.v }));
      if (it.kind === 'detail') return cache.shared('hd' + it.k + '.' + it.v + light, 130, 110, 65, 88, () => vHD(it.k, it.v));
      return cache.shared('pr' + it.k + light, 64, 52, 32, 40, () => vProp(it.k));
    },
    car(c: CarSpec): Sprite {
      return cache.shared('car' + c.model + '.' + c.colour + '.' + c.dx + '.' + c.dy + light, 48, 38, 24, 26, () => paintCar(c.model, CAR_COLOURS[c.colour % CAR_COLOURS.length], c.dx, c.dy));
    },
    train(k: number): Sprite {
      const nite = light.startsWith('1') || light.startsWith('0.75');
      return cache.shared('tn' + k + light, 64, 48, 46, 34, () => paintTrainCar(k, nite));
    },
    person: (px: PixelPen, X: number, Y: number, spec: PersonSpec) => drawPerson(px, X, Y, spec),
    smoke,
    balloon,
    pool(colour: string, r: number): Sprite {
      const s = cache.shared('pool' + colour + r, r * 2, r, 0, 0, () => { g.setTransform(1, 0, 0, 1, 0, 0); paintPool(g, colour, r); }, { outline: false });
      return { ...s, dx: -r, dy: -(r >> 1) };
    },
    memory: () => { const m = cache.stats(); return { ...m, bytes: m.bytes + roomCache.bytes() }; },
    room(spec: RoomSpec, part?: RoomPart): Sprite | undefined {
      const { id, ...rest } = spec;
      return roomCache.get(id, JSON.stringify(rest), roomBox(spec.room, spec.tier), () => paintRoom(spec), spec.night, part, spec.na ? (px) => greyRamp(px, spec.night) : undefined);
    },
    roomLayout,
    roomTier,
    stack(floors: readonly StackFloor[]): Sprite {
      const [w, h, ox, oy] = stackBox(floors.length);
      return cache.get('stack', light + '|' + JSON.stringify(floors), w, h, ox, oy, () => paintStack(floors));
    },
  };
}

