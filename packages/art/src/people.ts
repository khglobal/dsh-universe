// People: one person = one agent (or the member in the square), drawn straight in whole-pixel
// rectangles. The shirt is the agent's own colour; state is pose, plate and placard, never colour alone. There are
// no invented people: no passers-by, no staff, no crowds.
import type { PersonSpec, PixelPen } from '@dsh-universe/renderer';
import { BOLD, SC } from './palette.ts';

export const SKIN = ['#F2C9A5', '#E3B089', '#C98F6A', '#F2C9A5'];
export const HAIR = ['#5A4636', '#27304F', '#8D6B52', '#141A30'];
export const SHIRT = ['#2F6BDE', '#D9628A', '#3F9070', '#8E7BD6', '#E8873A', '#14A8A4', '#E5564B', '#5FAE6B'];
const PANTS = ['#27304F', '#5A4636', '#39415A', '#1F4FB0'];

export interface Look { shirt: string; sleeve: string | null; skin: string; hair: string; hs: number; pants: string; acc: number; accC: string }
export const look = (seed: number): Look => ({
  shirt: SHIRT[seed % 8], sleeve: seed % 3 ? null : '#FFFFFF', skin: SKIN[seed % 4], hair: HAIR[(seed >> 2) % 4],
  hs: (seed >> 1) % 3, pants: PANTS[(seed >> 3) % 4], acc: seed % 5, accC: BOLD[(seed * 3) % 8],
});
const MEMBER: Look = { shirt: '#E8705A', sleeve: '#FFFFFF', skin: '#F2C9A5', hair: '#141A30', hs: 0, pants: '#27304F', acc: 3, accC: '#FFFFFF' };
/**
 * Outside coding engines keep their own face (skin and hair from the seed) but wear that engine's outfit, so a Claude
 * Code or Codex agent reads as one at a glance, in the street and at a desk: Claude Code a terracotta jacket with a
 * cream cap and a white spark on the chest; Codex a near-black hoodie with a teal visor and a teal chest stripe.
 */
const ENGINE_LOOK: Record<NonNullable<PersonSpec['engine']>, Pick<Look, 'shirt' | 'sleeve' | 'pants' | 'accC'>> = {
  'claude-code': { shirt: '#C8643C', sleeve: '#B5573A', pants: '#5A4636', accC: '#F4F1E8' },
  codex: { shirt: '#27304F', sleeve: '#141A30', pants: '#39415A', accC: '#14A8A4' },
};
function lookOf(spec: PersonSpec): Look {
  if (spec.member) return MEMBER;
  const base = look(spec.seed >>> 0);
  return spec.engine ? { ...base, ...ENGINE_LOOK[spec.engine], acc: 0 } : base;
}
/** The engine's mark: a cap or visor on the head and a badge on the chest. */
function engineMark(px: PixelPen, X: number, by: number, engine: NonNullable<PersonSpec['engine']>, o: Look): void {
  if (engine === 'claude-code') {
    px(X - 4, by - 8, 8, 2, o.accC); px(X + 2, by - 6, 3, 1, o.accC);   // cap with its peak
    px(X - 1, by + 1, 1, 3, '#FFFFFF'); px(X - 2, by + 2, 3, 1, '#FFFFFF');   // spark
  } else {
    px(X - 4, by - 7, 8, 1, o.accC); px(X - 4, by - 6, 1, 2, o.accC); px(X + 3, by - 6, 1, 2, o.accC);   // visor band
    px(X - 3, by + 2, 6, 1, o.accC);   // chest stripe
  }
}

export function drawPerson(px: PixelPen, X: number, Y: number, spec: PersonSpec): void {
  const o = lookOf(spec);
  const stateCol = spec.state === 'future' ? SC.idle : SC[spec.state];
  const ph = spec.phase;
  const f = spec.walking ? (Math.floor(ph * 6) & 1) : 0, b = (spec.placard || spec.working) && ph ? (Math.floor(ph * 3) & 1) : 0, sm = spec.subagent ? 1 : 0;
  const D0 = '#141A30', sit = spec.state === 'failed' && !spec.placard;
  if (!spec.member) { px(X - 6, Y - 1, 12, 3, D0); px(X - 5, Y, 10, 1, stateCol); }
  if (spec.ring) { const rc = spec.member ? '#E8705A' : stateCol; px(X - 8, Y + 2, 16, 1, rc); px(X - 8, Y - 2, 1, 4, rc); px(X + 7, Y - 2, 1, 4, rc); }
  const by = Y - (sit ? 8 : 10) + b + sm;
  px(X - 5, by - 1, 10, 8 - sm, D0); px(X - 4, by - 8, 8, 8, D0);
  if (sit) { px(X - 5, Y - 3, 10, 3, D0); px(X - 4, Y - 2, 8, 1, o.pants); }
  else { px(X - 3, Y - 4 + sm, 3, 4 - sm, D0); px(X, Y - 4 + sm, 3, 4 - sm, D0); px(X - 2, Y - 4 + sm, 1, 3 - sm - f, o.pants); px(X + 1, Y - 4 + sm + f, 1, 3 - sm - f, o.pants); }
  px(X - 3, by, 6, 6 - sm, o.shirt); if (spec.subagent) px(X - 3, by + 2, 6, 1, '#FFFFFF');
  if (spec.pose && !spec.walking) pose(px, X, by, spec.pose, o, ph);
  else { px(X - 4, by + f, 1, 4, o.sleeve || o.shirt); px(X + 3, by + 1 - f, 1, 4, o.sleeve || o.shirt); px(X - 4, by + 4 + f, 1, 1, o.skin); px(X + 3, by + 5 - f, 1, 1, o.skin); }
  px(X - 3, by - 7, 6, 6, o.skin); px(X - 3, by - 7, 6, 2, o.hair); px(X - 3, by - 5, 1, 2, o.hair);
  if (o.hs === 1) { px(X + 2, by - 5, 1, 3, o.hair); px(X - 3, by - 3, 1, 2, o.hair); } else if (o.hs === 2) px(X - 1, by - 8, 2, 1, o.hair);
  px(X - 2, by - 4, 1, 1, D0); px(X + 1, by - 4, 1, 1, D0); px(X - 1, by - 2, 2, 1, '#C8643C');
  if (o.acc === 1) { px(X - 4, by - 8, 8, 2, o.accC); px(X + 2, by - 6, 3, 1, o.accC); }
  else if (o.acc === 2) { px(X - 6, by, 2, 5, D0); px(X - 6, by + 1, 1, 3, o.accC); }
  else if (o.acc === 3) px(X, by + 1, 1, 3, '#FFFFFF');
  else if (o.acc === 4) { px(X - 4, by - 5, 1, 2, D0); px(X + 3, by - 5, 1, 2, D0); px(X - 3, by - 8, 6, 1, D0); }
  if (spec.engine && !spec.member) engineMark(px, X, by, spec.engine, o);
  if (spec.placard && spec.placardSmall) smallPlacard(px, X, by - 8, spec.placard);
  else if (spec.placard) placard(px, X, Y - b, spec.placard, spec.tier, ph, spec.placardLift ?? 0);
}

/**
 * The small placard of someone behind the square's first row: 6 wide with a 1-pixel outline,
 * amber (red after an error), a 2×4 "!" in it (one row taller than 6×6 so the "!" does not touch the top and read as
 * an H), held to the right of the head (top 1 above the head's outline, centre 5
 * right of the person), so no face is covered: one pixel higher and it would cover the mouth of the person diagonally
 * behind (rows are 8 pixels apart).
 */
function smallPlacard(px: PixelPen, X: number, headTop: number, kind: 1 | 2 | 3): void {
  const x = X + 2, y = headTop - 1;
  px(x, y, 6, 7, '#141A30'); px(x + 1, y + 1, 4, 5, kind === 3 ? '#E5433D' : '#F0A020');
  px(x + 2, y + 2, 2, 2, '#141A30'); px(x + 2, y + 5, 2, 1, '#141A30');
}

/** Arms and what they hold for a pose (whole pixels; `ph` 0 = still). */
function pose(px: PixelPen, X: number, by: number, kind: NonNullable<PersonSpec['pose']>, o: Look, ph: number): void {
  const sl = o.sleeve || o.shirt, D0 = '#141A30', tick = ph ? Math.floor(ph * 5) & 1 : 0;
  if (kind === 'type') {   // both forearms forward on the keys, hands taking turns
    px(X - 4, by, 1, 3, sl); px(X + 3, by, 1, 3, sl); px(X - 3, by + 3, 2, 1, sl); px(X + 1, by + 3, 2, 1, sl);
    px(X - 2, by + 4 - tick, 1, 1, o.skin); px(X + 1, by + 3 + tick, 1, 1, o.skin);
  } else if (kind === 'read') {   // a book held open in front, a page turning now and then
    px(X - 4, by, 1, 3, sl); px(X + 3, by, 1, 3, sl);
    px(X - 3, by + 2, 6, 4, D0); px(X - 2, by + 3, 2, 2, '#FFFFFF'); px(X, by + 3, 2, 2, tick ? '#F4F1E8' : '#FFFFFF'); px(X - 3, by + 3, 1, 2, o.skin); px(X + 2, by + 3, 1, 2, o.skin);
  } else if (kind === 'console') {   // both arms up at the console, at shoulder height
    px(X - 4, by, 1, 2, sl); px(X + 3, by, 1, 2, sl); px(X - 5, by + 1, 1, 2, sl); px(X + 4, by + 1, 1, 2, sl);
    px(X - 5, by + 3 - tick, 1, 1, o.skin); px(X + 4, by + 3, 1, 1, o.skin);
  } else if (kind === 'web') {   // one hand up at the window screen
    px(X - 4, by, 1, 4, sl); px(X - 4, by + 4, 1, 1, o.skin);
    px(X + 3, by - 3, 1, 4, sl); px(X + 3, by - 4, 1, 1, o.skin); px(X + 4, by - 5, 1, 1, tick ? '#7FD0FF' : '#22C3E6');
  } else {   // handing a folder to the subagent
    px(X - 4, by, 1, 4, sl); px(X - 4, by + 4, 1, 1, o.skin);
    px(X + 3, by + 1, 3, 1, sl); px(X + 6, by + 1, 1, 1, o.skin);
    px(X + 6, by - 1 + tick, 4, 4, D0); px(X + 7, by + tick, 2, 2, '#FFC928');
  }
}

/** The placard an agent holds up in the square; louder the longer it waits. */
function placard(px: PixelPen, X: number, Y: number, kind: 1 | 2 | 3, tier: number, ph: number, lift: number): void {
  const col = kind === 3 ? SC.failed : SC.waiting;
  const bx = X + 3, by = Y - 31 - tier * 2 - lift, bw = 9 + tier * 2;
  px(bx + 2, Y - 21 - lift, 1, 13 + lift, '#59627A'); px(bx - 1, by - 1, bw + 2, 11, '#141A30'); px(bx, by, bw, 9, col);
  const cx = bx + (bw >> 1);
  if (kind === 1) for (let m = 0; m <= tier; m++) { const xx = cx - tier * 2 + m * 4; px(xx, by + 1, 1, 4, '#141A30'); px(xx, by + 6, 1, 1, '#141A30'); }
  else if (kind === 2) { px(cx - 1, by + 1, 3, 1, '#141A30'); px(cx + 1, by + 2, 1, 2, '#141A30'); px(cx, by + 4, 1, 1, '#141A30'); px(cx, by + 6, 1, 1, '#141A30'); }
  else for (let m = 0; m < 5; m++) { px(cx - 2 + m, by + 2 + m, 1, 1, '#FFFFFF'); px(cx + 2 - m, by + 2 + m, 1, 1, '#FFFFFF'); }
  if (tier === 2) {   // a megaphone
    px(X - 9, Y - 13, 4, 4, '#141A30'); px(X - 8, Y - 12, 3, 2, '#F4F1E8'); px(X - 11, Y - 14, 3, 6, '#141A30'); px(X - 10, Y - 13, 1, 4, '#F4F1E8');
    if (ph && (Math.floor(ph * 4) & 1)) { px(X - 13, Y - 15, 1, 1, col); px(X - 14, Y - 11, 1, 1, col); px(X - 13, Y - 8, 1, 1, col); }
  }
}

/** Solid pixel smoke, no transparency. */
export function smoke(px: PixelPen, X: number, Y: number, time: number, col: string, n: number, rise: number, seed: number): void {
  for (let k = 0; k < n; k++) {
    const ph = (time * 0.25 + k / n + seed) % 1, z2 = 2 + Math.floor(ph * 3);
    if (ph > 0.85 && (k & 1)) continue;
    px(Math.round(X + Math.sin(ph * 5 + k) * 3 * ph + ph * 5), Math.round(Y - ph * rise), z2, z2, col);
  }
}

/** The "!" balloon over the square: there whenever someone waits; doubled when the camera is far out. */
export function balloon(px: PixelPen, X: number, Y: number, k: number): void {
  const bx = X - 8 * k, by = Y - 64 - 22 * k;
  px(bx - k, by - k, 16 * k + 2 * k, 18 * k + 2 * k, '#141A30'); px(bx, by, 16 * k, 18 * k, SC.waiting);
  px(bx + 6 * k, by + 18 * k, 4 * k, 3 * k, '#141A30'); px(bx + 7 * k, by + 3 * k, 2 * k, 8 * k, '#141A30'); px(bx + 7 * k, by + 13 * k, 2 * k, 2 * k, '#141A30');
}
