// Vector primitives. They paint sprites
// at drawing units (two units = one art pixel) into the pen `g`, which the sprite cache points at its own canvas
// while a painter runs. Painters import `g` (a live binding) and these helpers.
import type { Canvas2D } from '@dsh-universe/renderer';
import { env, P, tone } from './light.ts';

export type Pt = [number, number];
/** Ground tile (x, y) at height z → drawing units. A tile is 64×32 units = 32×16 art pixels. */
export const iso = (x: number, y: number, z = 0): Pt => [(x - y) * 32, (x + y) * 16 - z];
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// eslint-disable-next-line import/no-mutable-exports
export let g: Canvas2D = null as unknown as Canvas2D;
/** Runs `fn` with the pen on `x`. */
export function withPen(x: Canvas2D, fn: () => void): void {
  const g0 = g;
  g = x;
  try { fn(); } finally { g = g0; }
}

export function P4(a: Pt, b: Pt, c: Pt, d: Pt, fill: string): void {
  g.fillStyle = fill; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill();
  g.strokeStyle = fill; g.lineWidth = 1; g.stroke();
}
export const flat = (x0: number, y0: number, x1: number, y1: number, z: number, fill: string) => P4(iso(x0, y0, z), iso(x1, y0, z), iso(x1, y1, z), iso(x0, y1, z), fill);
export function line(a: Pt, b: Pt, col: string, w: number): void {
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
}
export function disc(p: Pt, r: number, col: string): void { g.fillStyle = col; g.beginPath(); g.arc(p[0], p[1], r, 0, 6.3); g.fill(); }
/** A box: lit left face, shaded right face, lifted top, and a white highlight along the lit top edge. */
export function box(x0: number, y0: number, x1: number, y1: number, z0: number, z1: number, c: string, top?: string): void {
  P4(iso(x0, y1, z0), iso(x1, y1, z0), iso(x1, y1, z1), iso(x0, y1, z1), tone(c, env.kL));
  P4(iso(x1, y1, z0), iso(x1, y0, z0), iso(x1, y0, z1), iso(x1, y1, z1), tone(c, env.kR));
  flat(x0, y0, x1, y1, z1, tone(top || c, 0.22));
  if (boxStyle.highlight && z1 - z0 > 7) line(iso(x0, y1, z1 - 1), iso(x1, y1, z1 - 1), '#FFFFFF', 2);
}
/** `highlight`: the one-pixel white edge along a box's top (off for the chunky room props). */
export const boxStyle = { highlight: true };
export function hull(pts: Pt[]): Pt[] {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: Pt[] = [], up: Pt[] = [];
  for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/** The shadow a box of height h throws on the ground (dropped by quantize: it is semi-transparent). */
export function shadow(x0: number, y0: number, x1: number, y1: number, h: number): void {
  const k = h / 32, dx = env.sx * k, dy = env.sy * k;
  const pts = hull([iso(x0, y0), iso(x1, y0), iso(x1, y1), iso(x0, y1), iso(x0 + dx, y0 + dy), iso(x1 + dx, y0 + dy), iso(x1 + dx, y1 + dy), iso(x0 + dx, y1 + dy)]);
  g.fillStyle = P.shadow; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill();
}
export type Quad = [Pt, Pt, Pt, Pt];
export function fillQ(arr: Quad[], col: string): void {
  if (!arr.length) return;
  g.fillStyle = col; g.beginPath();
  for (const q of arr) { g.moveTo(q[0][0], q[0][1]); g.lineTo(q[1][0], q[1][1]); g.lineTo(q[2][0], q[2][1]); g.lineTo(q[3][0], q[3][1]); g.closePath(); }
  g.fill(); arr.length = 0;
}
/** Window quads on the two visible faces, sorted into lit and dark. */
export function winQ(lit: Quad[], dark: Quad[], x0: number, y0: number, x1: number, y1: number, za: number, zb: number, nc: number, wide: boolean | number, isLit: (c: number, face: number) => boolean): void {
  for (let c = 0; c < nc; c++) {
    const u0 = (c + (wide ? 0.08 : 0.22)) / nc, u1 = (c + (wide ? 0.92 : 0.78)) / nc;
    for (let face = 0; face < 2; face++) {
      const q: Quad = face
        ? [iso(x1, lerp(y1, y0, u0), za), iso(x1, lerp(y1, y0, u1), za), iso(x1, lerp(y1, y0, u1), zb), iso(x1, lerp(y1, y0, u0), zb)]
        : [iso(lerp(x0, x1, u0), y1, za), iso(lerp(x0, x1, u1), y1, za), iso(lerp(x0, x1, u1), y1, zb), iso(lerp(x0, x1, u0), y1, zb)];
      (isLit(c, face) ? lit : dark).push(q);
    }
  }
}
export function cyl(cx: number, cy: number, rad: number, z0: number, z1: number, c: string, top?: string): void {
  const b = iso(cx, cy, z0), tp = iso(cx, cy, z1), rx = rad * 45, ry = rx / 2;
  g.fillStyle = tone(c, env.kL); g.beginPath(); g.ellipse(b[0], b[1], rx, ry, 0, 0, Math.PI); g.lineTo(tp[0] - rx, tp[1]); g.lineTo(tp[0] + rx, tp[1]); g.closePath(); g.fill();
  g.fillStyle = tone(c, env.kR); g.beginPath(); g.ellipse(b[0], b[1], rx, ry, 0, 0, Math.PI / 2); g.lineTo(tp[0], tp[1] + ry); g.lineTo(tp[0] + rx, tp[1]); g.closePath(); g.fill();
  g.fillStyle = tone(top || c, 0.22); g.beginPath(); g.ellipse(tp[0], tp[1], rx, ry, 0, 0, 6.3); g.fill();
}
/** A closed outline of four points (hover rings). */
export function ring(q: Pt[], col: string, w: number): void {
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); q.forEach((v, i) => i ? g.lineTo(v[0], v[1]) : g.moveTo(v[0], v[1])); g.closePath(); g.stroke();
}
export function oval(c: Pt, rx: number, ry: number, col: string, w: number): void {
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.ellipse(c[0], c[1], rx, ry, 0, 0, 6.3); g.stroke();
}
