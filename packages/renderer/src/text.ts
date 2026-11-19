// The text layer: every word is drawn after the pixel art, at the screen's own resolution, on
// whole pixels, in the host's font: never scaled, never painted into the pixel art. A sign hidden behind a building
// is cut out: whatever was drawn in front of the sign is drawn again over it.
import { inkOn } from './contrast.ts';
import type { Canvas2D } from './artkit.ts';

export interface PlacedSign { x: number; y: number; text: string; bg: string; fg: string; small: boolean; depth: number; border?: string; /** A place name: never dropped for cover. */ name?: boolean }
/** A sprite already drawn, in screen pixels, with its depth (for the cut-out). */
export interface Occluder {
  image: CanvasImageSource; sx: number; sy: number; sw: number; sh: number; depth: number;
  /** A moving thing (drawn every frame). */
  live?: boolean;
  /** Where it has pixels (screen pixels); defaults to the whole image. */
  t?: readonly [number, number, number, number];
}

export const SIGN_FONT = 'system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
export const SMALL_FONT = 'ui-monospace,Menlo,Consolas,monospace';

/** The text, shortened with an ellipsis to fit `max` pixels (long workspace or connector names stay one tidy sign). */
export function fit(ctx: { measureText(t: string): { width: number } }, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  const chars = [...text];
  let lo = 0, hi = chars.length;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ctx.measureText(chars.slice(0, m).join('') + '…').width <= max) lo = m; else hi = m - 1; }
  return chars.slice(0, lo).join('').trimEnd() + '…';
}

/** Draws one sign; returns its rectangle (screen pixels, integers). `u` is the frame width (whole pixels). */
export function drawSign(ctx: Canvas2D, s: PlacedSign, dpr: number, u: number, dry = false): [number, number, number, number] {
  const fs = Math.round((s.small ? 9 : 12) * dpr);
  ctx.font = `700 ${fs}px ${s.small ? SMALL_FONT : SIGN_FONT}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const text = fit(ctx, s.text, (s.small ? 130 : 190) * dpr);
  let w = Math.ceil(ctx.measureText(text).width) + 6 * u + 4; w += w & 1;
  const h = fs + 4 * u + 2, x0 = Math.round(s.x - w / 2), y0 = Math.round(s.y - h - (s.small ? 0 : 3 * u));
  if (dry) return [x0 - u, y0 - u, x0 + w + u, y0 + h + u + (s.small ? 0 : 3 * u)];
  if (!s.small) { ctx.fillStyle = '#141A30'; ctx.fillRect(x0 + 3 * u, y0 + h, 2 * u, 3 * u); ctx.fillRect(x0 + w - 5 * u, y0 + h, 2 * u, 3 * u); }
  ctx.fillStyle = s.border ?? '#141A30'; ctx.fillRect(x0 - u, y0 - u, w + 2 * u, h + 2 * u);
  ctx.fillStyle = s.bg; ctx.fillRect(x0, y0, w, h);
  ctx.fillStyle = inkOn(s.bg, s.fg); ctx.fillText(text, x0 + Math.round(w / 2), y0 + Math.round(h / 2) + 1);
  return [x0 - u, y0 - u, x0 + w + u, y0 + h + u + (s.small ? 0 : 3 * u)];
}

type Mask = { w: number; h: number; a: Uint8Array };
const masks = new WeakMap<object, Mask | null>();
/** Which pixels of a sprite are opaque (sprites are cached and never change); null where pixels cannot be read. */
function maskOf(img: CanvasImageSource): Mask | null {
  const k = img as object;
  if (masks.has(k)) return masks.get(k)!;
  let m: Mask | null = null;
  try {
    const c = img as { width?: number; height?: number; getContext?: (t: string) => { getImageData?: (x: number, y: number, w: number, h: number) => { data: ArrayLike<number> } } | null };
    const w = c.width ?? 0, h = c.height ?? 0, g = c.getContext?.('2d'), d = w && h && g?.getImageData ? g.getImageData(0, 0, w, h).data : undefined;
    if (d && d.length >= w * h * 4) { const a = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 0 ? 1 : 0; m = { w, h, a }; }
  } catch { m = null; }
  masks.set(k, m);
  return m;
}

/**
 * Draws the signs back to front and cuts out what stands in front of each: an occluder deeper than the sign and
 * overlapping it is drawn again, clipped to the sign. Returns the sign rectangles.
 */
export function drawTextLayer(ctx: Canvas2D, signs: readonly PlacedSign[], occluders: readonly Occluder[], dpr: number, u: number, clipBottom?: number, avoid: readonly (readonly [number, number, number, number])[] = [],
  /** Collects each plate drawn (not names) with its depth: what a later frame may cut out again. */
  plates?: { r: [number, number, number, number]; depth: number }[]): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  // Nothing is written under the panel's own controls at the bottom.
  if (clipBottom !== undefined) { ctx.beginPath(); ctx.rect(0, 0, 1e5, clipBottom); ctx.clip(); }
  const names: [number, number, number, number][] = [];
  // Plates first, back to front; place names last, over everything (they float above their own roof).
  for (const s of [...signs].sort((a, b) => (a.name ? 1 : 0) - (b.name ? 1 : 0) || a.depth - b.depth)) {
    let r = drawSign(ctx, s, dpr, u, true);
    if (clipBottom !== undefined && r[3] > clipBottom) continue;
    // Nor under any other control over the city (today bar, toolbar, legend, zoom, view switch; device pixels).
    const under = (q: readonly number[]) => avoid.some((a) => q[0] < a[2] && q[2] > a[0] && q[1] < a[3] && q[3] > a[1]);
    if (under(r)) continue;
    // A sign running off the left or right edge would read as a fragment (`ee…`): left out until scrolled into view.
    const cw = (ctx.canvas as { width?: number } | undefined)?.width;
    if (cw && (r[0] < 0 || r[2] > cw)) continue;
    if (s.name) {
      // Never dropped for cover. If another name is already there, step up 14 px, at most three times.
      let lifted = s;
      for (let k = 0; k < 3 && names.some((n) => r[0] < n[2] && r[2] > n[0] && r[1] < n[3] && r[3] > n[1]); k++) {
        lifted = { ...lifted, y: lifted.y - Math.round(14 * dpr) };
        r = drawSign(ctx, lifted, dpr, u, true);
      }
      if (under(r)) continue;
      drawSign(ctx, lifted, dpr, u);
      names.push(r);
      out.push(Object.assign(r, { bg: s.bg, fg: inkOn(s.bg, s.fg), border: s.border ?? '#141A30' }));
      continue;
    }
    const front = occluders.filter((o) => {
      if (o.depth <= s.depth) return false;
      const t = o.t ?? [o.sx, o.sy, o.sx + o.sw, o.sy + o.sh];
      return !(t[0] >= r[2] || t[2] <= r[0] || t[1] >= r[3] || t[3] <= r[1]);
    });
    // A plate mostly hidden behind what stands in front of it is left out, not shown as a stub: cover is measured on
    // an 8×4 grid of points against the occluders' tight boxes, each point counted once; drop above 60 %.
    // A point counts as covered where the sprite has a pixel (its alpha, read once per sprite), else by its tight box.
    let hidden = 0;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) {
      const px = r[0] + (r[2] - r[0]) * (i + 0.5) / 8, py = r[1] + (r[3] - r[1]) * (j + 0.5) / 4;
      if (front.some((o) => {
        const t = o.t ?? [o.sx, o.sy, o.sx + o.sw, o.sy + o.sh];
        if (!(px >= t[0] && px < t[2] && py >= t[1] && py < t[3])) return false;
        const m = maskOf(o.image);
        if (!m || o.sw <= 0 || o.sh <= 0) return true;
        const ix = Math.floor((px - o.sx) / o.sw * m.w), iy = Math.floor((py - o.sy) / o.sh * m.h);
        return ix >= 0 && iy >= 0 && ix < m.w && iy < m.h && m.a[iy * m.w + ix] === 1;
      })) hidden++;
    }
    if (hidden / 32 > 0.6) continue;
    drawSign(ctx, s, dpr, u);
    plates?.push({ r: [r[0], r[1], r[2], r[3]], depth: s.depth });
    // The rectangle carries the sign's colours (checks tell a sign's own pixels from a sprite cut out over it).
    out.push(Object.assign(r, { bg: s.bg, fg: inkOn(s.bg, s.fg), border: s.border ?? '#141A30' }));
    for (const o of front) {
      ctx.save();
      ctx.beginPath(); ctx.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]); ctx.clip();
      ctx.drawImage(o.image, o.sx, o.sy, o.sw, o.sh);
      ctx.restore();
    }
  }
  ctx.restore();
  return out;
}
