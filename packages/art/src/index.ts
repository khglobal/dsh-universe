// The DSH Universe art kit. All rights reserved (see NOTICE). Phase 2: the city (palette, sprites, towers, civic
// buildings, streets, cars, people). Phase 3: the rooms (50 templates, the prop library, five floor plans).
import { createArtKit } from './kit.ts';

export { createArtKit, ART_KIT_ID, ART_KIT_VERSION } from './kit.ts';
export { ROOMS } from './rooms.ts';
export { MASTER, BOLD, PAL32, lut, inPalette, mix } from './palette.ts';
export { quantize, outline, ALPHA_CUT } from './quantize.ts';
export { SpriteCache, type Sprite, type Surface, type SurfaceFactory } from './sprites.ts';
export { TOWER_TEMPLATES, SILHOUETTES } from './templates/buildings/templates.ts';
export { CIVIC_TEMPLATES } from './templates/civic/civic.ts';
export { cityLayout } from './street/layout.ts';
export { ROOM_TEMPLATES, roomTemplate, type RoomTemplate } from './templates/rooms/index.ts';
export { planOf, PLAN_TYPES, ROOM_SIZE, LIFT, DOOR, type RoomPlan, type PlanType } from './plans.ts';
export { compactPlan, hallPlan, paintRoom, paintStack, roomBox, roomLayout, roomPlan, sceneOf, thingsOf, wallsOf, type HallPlan } from './interior.ts';
export { TIER_SIZE, clearOf, pack, walkways } from './compact.ts';
export { TIER_AT, bulkOf, plateOf, roomTier } from './room-tier.ts';
export { RoomCache } from './room-cache.ts';
export { UNIT } from './props/units.ts';
export { WALL } from './props/walls.ts';
export { CENTER } from './props/centers.ts';
export { SIDE } from './props/sides.ts';
export { CORNER } from './props/corners.ts';
export { FIXED_SCENES } from './props/fixed.ts';
export { setFootprintProbe, setPen, type RoomLook } from './props/pen.ts';

/** 15 silhouettes × 4 facades. */
export const BUILDING_TEMPLATES = 60;

/** A default kit (its own sprite cache). Prefer `createArtKit()` per view. */
export const artKit = createArtKit();
export { civicFootprints, lotEnvelope, POD_REACH, itemRadius, itemRect, DETAIL_EXTENT, inRect, rectsMeet, CONNECTOR_SPOTS, shopSpot, type Footprint, type Rect as GroundRect } from './footprints.ts';
