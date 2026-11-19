// Workstations drawn with chunky parts (first made for a 2-pixel grid; now composed at the room's own resolution, the
// same pixel size as the people, see room-cache `OWN_INKS`): every part is 0.125 tile across or more, 4 drawing units
// high, lines at least 4 wide. Chunky, readable parts in palette colours: monitor, keyboard, chair, mug, paper. What
// changes is data, as before: screens are lit only while an agent works on the floor (`act`). All rights reserved.
import { act, B, BOLD, cyl, disc, errNow, fl2, flat, fN, g, hs, line, nt, P4, pt, rec, rm, tm, W } from './pen.ts';
import type { UnitKit } from './units.ts';
import { boxStyle } from '../iso.ts';
import { CENTER_C, CORNER_C, SIDE_C } from './rooms-coarse.ts';

/** A screen on the front face of a monitor (plane y), lit while the floor works; a bar of "text" moves on it. */
function screen(x0: number, x1: number, y: number, z0: number, z1: number, k: number): void {
  const on = act, c = on ? ['#2F6BDE', '#2A6B55', '#1F4FB0'][k % 3] : '#39415A';
  P4(pt(x0, y, z0), pt(x1, y, z0), pt(x1, y, z1), pt(x0, y, z1), c);
  if (!on) return;
  const row = (fl2 >> 2) + k;
  for (let r = 0; r < 2; r++) { const zz = z1 - 4 - r * 4 - (row % 2) * 0; const w = (x1 - x0) * (0.4 + 0.4 * hs(k, r, row)); P4(pt(x0 + 0.06, y, zz - 2), pt(x0 + 0.06 + w, y, zz - 2), pt(x0 + 0.06 + w, y, zz), pt(x0 + 0.06, y, zz), r ? '#4CC552' : '#FFFFFF'); }
}

/** An office chair facing the desk (its back towards the viewer). */
function chair(x: number, y: number, c = '#39415A'): void {
  disc(pt(x + 0.62, y + 0.98, 1), 8, '#59627A');
  B(x + 0.44, y + 0.82, x + 0.8, y + 1.1, 4, 9, '#27304F', c);
  B(x + 0.44, y + 1.04, x + 0.8, y + 1.16, 9, 22, c);
}

/** The office desk (most rooms): two monitors, keyboard, paper, a mug, a desk phone on every other. */
const desk = (x: number, y: number, k: number): void => {
  chair(x, y);
  B(x, y, x + 1.25, y + 0.62, 0, 12, '#C9925A', '#FFF6CF');
  B(x, y + 0.56, x + 1.25, y + 0.62, 0, 12, '#A8743F');
  for (const mx of [0.1, 0.66]) {
    B(x + mx + 0.19, y + 0.1, x + mx + 0.31, y + 0.22, 12, 16, '#39415A');
    B(x + mx, y + 0.06, x + mx + 0.5, y + 0.14, 16, 32, '#141A30');
    screen(x + mx + 0.06, x + mx + 0.44, y + 0.14, 19, 30, k * 2 + (mx > 0.5 ? 1 : 0));
  }
  flat(x + 0.36, y + 0.32, x + 0.86, y + 0.46, 12.4, '#AEB5C2');
  flat(x + 0.36, y + 0.32, x + 0.86, y + 0.36, 12.6, '#CDD2DA');
  flat(x + 0.06, y + 0.3, x + 0.28, y + 0.54, 12.4, k & 1 ? '#FFC928' : '#FFFFFF');
  B(x + 0.96, y + 0.34, x + 1.1, y + 0.48, 12, 20, BOLD[k % 9]);
  if (k % 2 === 0) B(x + 1.12, y + 0.4, x + 1.22, y + 0.54, 12, 16, '#27304F');
  if (nt && act) flat(x + 0.36, y + 0.46, x + 0.86, y + 0.52, 12.4, '#FFC928');
};

/** A control console (machine rooms): three screens on a dark back panel, a row of lamps that blink while busy. */
const console_ = (x: number, y: number, k: number): void => {
  chair(x, y, '#59627A');
  B(x, y, x + 1.25, y + 0.62, 0, 10, '#8A93A3', '#CDD2DA');
  B(x, y, x + 1.25, y + 0.18, 10, 30, '#59627A', '#8A93A3');
  for (let i = 0; i < 3; i++) { P4(pt(x + 0.04 + i * 0.4, y + 0.18, 12), pt(x + 0.4 + i * 0.4, y + 0.18, 12), pt(x + 0.4 + i * 0.4, y + 0.18, 29), pt(x + 0.04 + i * 0.4, y + 0.18, 29), '#141A30'); screen(x + 0.08 + i * 0.4, x + 0.36 + i * 0.4, y + 0.18, 15, 26, k * 3 + i); }
  flat(x + 0.3, y + 0.3, x + 0.95, y + 0.46, 10.4, '#59627A');
  if (act) for (let i = 0; i < 4; i++) if (hs(k, i, fl2 >> 2) > 0.45) flat(x + 0.06 + i * 0.3, y + 0.48, x + 0.24 + i * 0.3, y + 0.6, 10.6, ['#E5433D', '#FFC928', '#4CC552', '#22C3E6'][i]);
};

/** A workbench (workshops): pegboard with tools, a vise, parts bins, a small monitor; a spark while busy. */
const bench = (x: number, y: number, k: number): void => {
  B(x + 0.48, y + 0.84, x + 0.76, y + 1.08, 0, 9, '#59627A', '#C9925A');
  B(x, y, x + 1.25, y + 0.62, 0, 10, '#8A93A3', '#CDD2DA');
  for (let i = 0; i < 3; i++) P4(pt(x + 0.06 + i * 0.4, y + 0.62, 2), pt(x + 0.38 + i * 0.4, y + 0.62, 2), pt(x + 0.38 + i * 0.4, y + 0.62, 8), pt(x + 0.06 + i * 0.4, y + 0.62, 8), i & 1 ? '#AEB5C2' : '#F4F1E8');
  B(x, y, x + 1.25, y + 0.08, 10, 30, '#C9925A');
  for (let i = 0; i < 3; i++) P4(pt(x + 0.12 + i * 0.26, y + 0.08, 18), pt(x + 0.26 + i * 0.26, y + 0.08, 18), pt(x + 0.26 + i * 0.26, y + 0.08, 26), pt(x + 0.12 + i * 0.26, y + 0.08, 26), ['#E5433D', '#39415A', '#FFC928'][i]);
  B(x + 0.08, y + 0.3, x + 0.3, y + 0.48, 10, 16, '#39415A');
  for (let i = 0; i < 2; i++) B(x + 0.42 + i * 0.2, y + 0.14, x + 0.58 + i * 0.2, y + 0.3, 10, 14, BOLD[(k + i * 3) % 9]);
  B(x + 0.92, y + 0.1, x + 1.2, y + 0.16, 10, 24, '#141A30'); screen(x + 0.96, x + 1.16, y + 0.16, 13, 22, k);
  if (act && (fl2 + k) & 2) disc(pt(x + 0.66, y + 0.42, 12), 4, '#FF8A2B');
};

/** A drafting table (studios): a tilted board with a drawing, a pencil tray, a small screen beside it. */
const draft = (x: number, y: number, k: number): void => {
  B(x + 0.48, y + 0.86, x + 0.76, y + 1.1, 0, 10, '#59627A', BOLD[k % 9]);
  for (const dx of [0.06, 1.1]) B(x + dx, y + 0.12, x + dx + 0.1, y + 0.5, 0, 9, '#8A93A3');
  P4(pt(x, y + 0.6, 9), pt(x + 0.86, y + 0.6, 9), pt(x + 0.86, y + 0.08, 19), pt(x, y + 0.08, 19), '#F4F1E8');
  P4(pt(x + 0.08, y + 0.52, 10.6), pt(x + 0.78, y + 0.52, 10.6), pt(x + 0.78, y + 0.14, 17.6), pt(x + 0.08, y + 0.14, 17.6), '#FFFFFF');
  P4(pt(x + 0.16, y + 0.44, 12), pt(x + 0.44, y + 0.44, 12), pt(x + 0.44, y + 0.26, 15.6), pt(x + 0.16, y + 0.26, 15.6), BOLD[(k * 2 + 1) % 9]);
  disc(pt(x + 0.6, y + 0.32, 15), 6, BOLD[(k * 2 + 4) % 9]);
  flat(x + 0.04, y + 0.6, x + 0.82, y + 0.7, 9, '#FFC928');
  B(x + 0.92, y + 0.2, x + 1.24, y + 0.5, 0, 10, '#59627A', '#8A93A3');
  B(x + 0.94, y + 0.22, x + 1.22, y + 0.3, 10, 22, '#141A30'); screen(x + 0.97, x + 1.19, y + 0.3, 12, 20, k);
};

/** A study carrel (libraries): wooden sides and back, a stack of books, an open book, a green reading lamp. */
const carrel = (x: number, y: number, k: number): void => {
  B(x + 0.46, y + 0.84, x + 0.78, y + 1.1, 4, 9, '#5A4636', '#8D6B52'); B(x + 0.46, y + 1.04, x + 0.78, y + 1.14, 9, 20, '#8D6B52');
  B(x, y, x + 1.25, y + 0.62, 0, 10, '#A8743F', '#C9925A');
  B(x, y, x + 1.25, y + 0.08, 10, 26, '#8D6B52');
  B(x, y, x + 0.08, y + 0.52, 10, 20, '#8D6B52'); B(x + 1.17, y, x + 1.25, y + 0.52, 10, 20, '#8D6B52');
  for (let i = 0; i < 2 + k % 3; i++) B(x + 0.12, y + 0.14, x + 0.42, y + 0.36, 10 + i * 4, 14 + i * 4, '#FFFFFF', BOLD[(k + i * 2) % 9]);
  flat(x + 0.5, y + 0.26, x + 0.74, y + 0.5, 10.4, '#FFFFFF'); flat(x + 0.76, y + 0.26, x + 0.98, y + 0.5, 10.4, '#F4F1E8');
  flat(x + 0.74, y + 0.26, x + 0.76, y + 0.5, 10.6, '#8A93A3');
  B(x + 1.04, y + 0.12, x + 1.12, y + 0.2, 10, 18, '#C9925A');
  P4(pt(x + 0.94, y + 0.16, 18), pt(x + 1.2, y + 0.16, 18), pt(x + 1.16, y + 0.16, 23), pt(x + 0.98, y + 0.16, 23), '#2E9E48');
  if (nt && act) flat(x + 0.86, y + 0.18, x + 1.16, y + 0.44, 10.4, '#FFF6CF');
};

/** A café table (lounges): two stools, a round table, cups, a laptop that is on while the floor works. */
const cafe = (x: number, y: number, k: number): void => {
  for (const dx of [0.12, 0.9]) cyl(x + dx + 0.1, y + 0.4, 0.16, 0, 6, '#8D6B52', BOLD[(k + (dx > 0.5 ? 3 : 0)) % 9]);
  B(x + 0.56, y + 0.26, x + 0.68, y + 0.38, 0, 9, '#59627A');
  cyl(x + 0.62, y + 0.32, 0.36, 9, 11, '#C9925A', '#FFF6CF');
  B(x + 0.4, y + 0.16, x + 0.52, y + 0.28, 11, 16, '#FFFFFF');
  B(x + 0.72, y + 0.34, x + 0.84, y + 0.46, 11, 16, BOLD[k % 9]);
  flat(x + 0.5, y + 0.34, x + 0.72, y + 0.52, 11.4, '#AEB5C2');
  P4(pt(x + 0.5, y + 0.34, 11.4), pt(x + 0.72, y + 0.34, 11.4), pt(x + 0.72, y + 0.28, 18), pt(x + 0.5, y + 0.28, 18), act ? '#22C3E6' : '#39415A');
  if (k % 3 === 0) { B(x + 1.04, y + 0.04, x + 1.26, y + 0.26, 0, 7, '#C8643C'); disc(pt(x + 1.15, y + 0.15, 14), 8, '#2E9E48'); }
};

/** Kinds redrawn with chunky parts (the rest keep their earlier drawing). */
const coarse = (f: (x: number, y: number, k: number) => void) => (x: number, y: number, k: number): void => {
  boxStyle.highlight = false;
  try { f(x, y, k); } finally { boxStyle.highlight = true; }
};
export const COARSE_UNIT: Partial<UnitKit> = { desk: coarse(desk), console: coarse(console_), bench: coarse(bench), draft: coarse(draft), carrel: coarse(carrel), cafe: coarse(cafe) };

/** Item tags of back-wall art: `wallc` for the redrawn kinds, `walld` for the video wall (both snapped to their own colours). */
export const wallTag = (kind: string): string => (COARSE_WALL_ART[kind] ? 'wallc' : kind === 'video' ? 'walld' : 'wall');

/** Status board (security, operations): six columns of service lamps, two rows of three; a red lamp on an error. */
const status = (): void => {
  W(0.5, 6.5, 7, 36.8, '#141A30');
  for (let c = 0; c < 6; c++) {
    const x = 0.6 + c * 0.98;
    W(x, x + 0.86, 29, 35, BOLD[c]);
    for (let r = 0; r < 2; r++) for (let d = 0; d < 3; d++) {
      const v = hs(c * 3 + r, d, act ? fl2 >> 2 : 0);
      W(x + d * 0.3, x + d * 0.3 + 0.22, 10 + r * 10, 16 + r * 10, !act ? '#27304F' : errNow && c === 5 && r === 0 ? '#E5433D' : v > 0.82 ? '#FFC928' : v > 0.2 ? '#4CC552' : '#2A6B55');
    }
  }
};

/** Progress board (specs, planning): three rows, each a coloured label, a bar filling while busy and a lamp. */
const board = (): void => {
  W(0.5, 6.5, 7, 36.8, '#F4F1E8');
  W(0.5, 6.5, 31, 36.8, '#FFC928');
  for (let c = 0; c < 5; c++) W(0.7 + c * 1.2, 1.1 + c * 1.2, 32, 36, '#141A30');
  for (let r = 0; r < 3; r++) {
    const z = 10 + r * 7;
    W(0.62, 1.4, z, z + 5, BOLD[r * 2]);
    W(1.6, 5.4, z, z + 5, '#CDD2DA');
    W(1.6, 1.6 + 3.8 * (0.25 + 0.7 * hs(r, 4, act ? Math.floor(tm * 0.3) : 0)), z, z + 5, r === 1 && errNow ? '#E5433D' : '#4CC552');
    W(5.7, 6.2, z, z + 5, act ? (hs(r, 2, fl2 >> 3) > 0.3 ? '#4CC552' : '#FFC928') : '#8A93A3');
  }
};

/** TV wall (newsrooms): eight screens, lit while busy (the channel changes slowly), each with a picture. */
const tvwall = (): void => {
  W(0.5, 6.5, 7, 36.8, '#141A30');
  for (let c = 0; c < 4; c++) for (let r = 0; r < 2; r++) {
    const x = 0.6 + c * 1.48, z = 9 + r * 14, sc = (c + r * 3 + (act ? Math.floor(tm * 0.4 + c * 0.3) : 0)) % 9;
    W(x, x + 1.36, z, z + 12, act ? BOLD[sc] : '#27304F');
    if (!act) continue;
    W(x + 0.2, x + 0.8, z + 3, z + 9, errNow && c === 0 && r === 0 ? '#E5433D' : '#FFFFFF');
  }
};

/** Review queue (code review, help desks): three columns; cards for the last calls and for the files changed. */
const queue = (): void => {
  W(0.5, 6.5, 7, 36.8, '#F4F1E8');
  for (let c = 0; c < 3; c++) {
    const x = 0.6 + c * 1.97;
    W(x, x + 1.87, 31, 35.6, ['#8A93A3', '#2F6BDE', '#4CC552'][c]);
    W(x, x + 1.87, 8, 30, '#FFFFFF');
    const n = c === 1 ? Math.min(3, rec.length) : c === 2 ? Math.min(3, Math.floor(Math.log2((fN || 0) + 1))) : 2;
    for (let r = 0; r < n; r++) {
      const z = 23 - r * 7;
      W(x + 0.1, x + 1.77, z, z + 5, c === 1 && rec[r] && rec[r].err ? '#FF8A7A' : ['#FFC928', '#7FA8F5', '#8BD93E'][c]);
      W(x + 0.2, x + 0.5, z + 1, z + 4, '#141A30');
    }
  }
};

/** A polyline on the back wall (heights in drawing units), two pixels thick. */
function wline(pts: readonly (readonly [number, number])[], col: string): void {
  g.strokeStyle = col; g.lineWidth = 4; g.beginPath();
  pts.forEach(([x, z], k) => { const q = pt(x, 0.04, z); if (k) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); });
  g.stroke();
}

/** Archive shelves: three shelves of labelled boxes between dark uprights. */
const boxes = (): void => {
  W(0.5, 6.5, 7, 36.8, '#8A93A3');
  for (let r = 0; r < 3; r++) {
    const z = 7 + r * 10;
    W(0.5, 6.5, z, z + 3, '#59627A');
    for (let c = 0; c < 9; c++) if (hs(r, c, 5) > 0.12) {
      const x = 0.6 + c * 0.65;
      W(x, x + 0.52, z + 3, z + 10, hs(r, c, 6) > 0.5 ? '#C9925A' : '#A8743F');
      W(x + 0.12, x + 0.4, z + 5, z + 8, '#FFFFFF');
    }
  }
  for (const x of [0.5, 3.4, 6.38]) W(x, x + 0.12, 7, 36.8, '#39415A');
};

/** Bookcase: four shelves of books in the bold colours, a ladder leaning on it. */
const books = (): void => {
  W(0.5, 6.5, 7, 36.8, '#8D6B52');
  for (let r = 0; r < 4; r++) {
    const z = 8 + r * 7;
    W(0.56, 6.44, z, z + 6.5, '#5A4636');
    for (let c = 0; c < 20; c++) if (hs(r, c, 2) > 0.1) { const x = 0.6 + c * 0.29; W(x, x + 0.24, z, z + 4.5 + hs(r, c, 1) * 1.5, BOLD[Math.floor(hs(r, c, 3) * 9)]); }
  }
  for (const x of [3.1, 3.74]) W(x, x + 0.14, 0, 36, '#A8743F');
  for (let r = 0; r < 4; r++) W(3.1, 3.88, 5 + r * 9, 8 + r * 9, '#A8743F');
};

/** Charts: a pie, a bar chart (moves while busy) and two lines on a whiteboard. */
const charts = (): void => {
  W(0.5, 6.5, 7, 36.8, '#F4F1E8');
  { const c0 = pt(1.5, 0.04, 22); let a = -1.57; [0.42, 0.27, 0.19, 0.12].forEach((v, k) => { g.fillStyle = BOLD[k * 2]; g.beginPath(); g.moveTo(c0[0], c0[1]); g.arc(c0[0], c0[1], 24, a, a + v * 6.283); g.closePath(); g.fill(); a += v * 6.283; }); disc(c0, 10, '#F4F1E8'); }
  for (let k = 0; k < 5; k++) W(2.7 + k * 0.36, 2.96 + k * 0.36, 10, 12 + 20 * (0.25 + 0.7 * hs(k, 3, act ? Math.floor(tm * 0.4) : 0)), BOLD[(k + 1) % 9]);
  W(2.6, 4.5, 8, 10, '#141A30');
  W(4.7, 6.4, 9, 35, '#FFFFFF');
  wline([...Array(7)].map((_, k) => [4.85 + k * 0.25, 14 + hs(k, 5, 5) * 16] as const), '#E5433D');
  wline([...Array(7)].map((_, k) => [4.85 + k * 0.25, 12 + hs(k, 7, 7) * 12] as const), '#2F6BDE');
};

/** Lab wall: hexagon rings on a whiteboard, one report bar per doubling of files changed, a periodic table. */
const chem = (): void => {
  W(0.5, 6.5, 7, 36.8, '#141A30');
  W(0.56, 3.6, 8.4, 35.4, '#FFFFFF');
  g.strokeStyle = '#2F6BDE'; g.lineWidth = 4;
  for (let i = 0; i < 3; i++) { const c0 = pt(1.0 + i * 1.0, 0.04, 28 - (i & 1) * 6); g.beginPath(); for (let a = 0; a < 7; a++) { const an = a * 1.047, q = [c0[0] + Math.cos(an) * 10, c0[1] + Math.sin(an) * 10]; if (a) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); } g.stroke(); }
  const n = Math.min(3, fN ? 1 + Math.floor(Math.log2(fN + 1) / 2) : 0);
  for (let r = 0; r < n; r++) W(0.7, 0.7 + 2.4 * (0.4 + 0.6 * hs(r, 2, 2)), 15 - r * 4, 18 - r * 4, ['#E5433D', '#141A30', '#2E9E48'][r % 3]);
  W(3.7, 6.44, 8.4, 35.4, '#27304F');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) if (!((r === 0 && c > 0 && c < 7) || (r === 1 && c > 1 && c < 6))) W(3.8 + c * 0.33, 4.05 + c * 0.33, 28 - r * 6.5, 33 - r * 6.5, [BOLD[0], BOLD[1], BOLD[3], BOLD[5]][(c >> 1) % 4]);
};

/** Map wall: land on a blue sea, a grid, and a pin for each recent call (red for a failure, bigger when new). */
const mapw = (): void => {
  W(0.5, 6.5, 7, 36.8, '#141A30'); W(0.58, 6.42, 8.6, 35.2, '#1F4FB0');
  for (const [x0, x1, z0, z1] of [[0.9, 2.2, 20, 32], [1.3, 2, 11, 20], [2.9, 3.9, 22, 33], [3.1, 3.7, 12, 22], [4.2, 6, 20, 32], [5.2, 5.9, 11, 17]] as const) W(x0, x1, z0, z1, '#2E9E48');
  for (let i = 1; i < 4; i++) W(0.58 + i * 1.46, 0.7 + i * 1.46, 8.6, 35.2, '#2F6BDE');
  rec.slice(0, 8).forEach((e, k) => { const q = pt(0.9 + hs(k, 1, Math.round(e.age / 60) + 3) * 5.2, 0.04, 12 + hs(k, 2, 5) * 20); line(q, [q[0], q[1] - 8], '#FFFFFF', 3); disc([q[0], q[1] - 10], e.age < 4 && !rm ? 7 : 5, e.err ? '#E5433D' : '#FFC928'); });
};

/** Mood board: ten pinned photos (a coloured picture in a white frame, a red pin). */
const mood = (): void => {
  W(0.5, 6.5, 7, 36.8, '#8D6B52'); W(0.56, 6.44, 8.4, 35.4, '#C9925A');
  for (let i = 0; i < 10; i++) {
    const x = 0.7 + (i % 5) * 1.15, z = 10 + Math.floor(i / 5) * 13, w = 0.72;
    W(x, x + w, z, z + 10, '#FFFFFF'); W(x + 0.12, x + w - 0.12, z + 3, z + 9, BOLD[(i * 4 + 1) % 9]);
    W(x + 0.3, x + 0.42, z + 10, z + 12, '#E5433D');
  }
};

/** Vault wall: a grid of deposit boxes (some with a gold tag) and the vault door, whose dial turns while busy. */
const vaultw = (): void => {
  W(0.5, 6.5, 7, 36.8, '#59627A');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) { const x = 0.6 + c * 0.56, z = 9 + r * 7; W(x, x + 0.46, z, z + 6, '#AEB5C2'); W(x + 0.16, x + 0.3, z + 2, z + 4, hs(r, c, 4) > 0.8 ? '#FFC928' : '#39415A'); }
  W(3.5, 6.4, 8.4, 35.6, '#8A93A3');
  const c0 = pt(4.95, 0.04, 22);
  disc(c0, 24, '#39415A'); disc(c0, 20, '#AEB5C2'); disc(c0, 8, '#59627A');
  for (let k = 0; k < 4; k++) { const a = (act ? tm * 0.6 : 0.3) + k * 1.571; line(c0, [c0[0] + Math.cos(a) * 16, c0[1] + Math.sin(a) * 16], '#39415A', 4); disc([c0[0] + Math.cos(a) * 16, c0[1] + Math.sin(a) * 16], 4, '#FFC928'); }
};

/** Observatory: a star field (stars twinkle while busy) with a constellation, and a mark per recent call (red: failed). */
const stars = (): void => {
  W(0.5, 6.5, 7, 36.8, '#141A30'); W(0.58, 3.9, 8.6, 35.2, '#27304F');
  for (let i = 0; i < 16; i++) { const q = pt(0.7 + hs(i, 1, 1) * 3.0, 0.04, 10 + hs(i, 2, 2) * 23); g.fillStyle = act && hs(i, 3, fl2 >> 2) > 0.75 ? '#FFC928' : '#FFFFFF'; g.fillRect(q[0] - 2, q[1] - 2, 4, 4); }
  g.strokeStyle = '#7FD0FF'; g.lineWidth = 3; g.beginPath();
  for (let i = 0; i < 5; i++) { const q = pt(1 + i * 0.6, 0.04, 18 + hs(i, 6, 6) * 12); if (i) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }
  g.stroke();
  W(4, 6.42, 8.6, 35.2, '#F4F1E8');
  W(4.2, 6.3, 10, 12, '#141A30'); W(4.2, 4.32, 10, 33, '#141A30');
  rec.slice(0, 8).forEach((e, k) => { const x = 4.5 + hs(k, 1, 9) * 1.6, z = 15 + hs(k, 2, 9) * 15; W(x, x + 0.18, z, z + 4, e.err ? '#E5433D' : '#2F6BDE'); });
};

/** Café menu: a chalk board with dishes and prices, shelves of cups, jars and boxes. */
const menu = (): void => {
  W(0.5, 6.5, 7, 36.8, '#8D6B52'); W(0.6, 3.6, 12, 35.6, '#141A30'); W(0.7, 3.5, 13.5, 34.2, '#27304F');
  for (let r = 0; r < 3; r++) { const z = 28 - r * 7; W(0.85, 0.85 + 1.4 * (0.5 + 0.5 * hs(r, 1, 1)), z, z + 3, '#FFFFFF'); W(2.8, 3.3, z, z + 3, '#FFC928'); }
  disc(pt(3.1, 0.04, 15.5), 6, '#FF8A2B');
  for (let r = 0; r < 3; r++) {
    W(3.8, 6.4, 12 + r * 8, 15 + r * 8, '#5A4636');
    for (let c = 0; c < 6; c++) { const x = 3.9 + c * 0.42, z = 15 + r * 8; W(x, x + 0.26, z, z + 5, r === 0 ? '#FFFFFF' : r === 1 ? BOLD[(c * 2 + 1) % 9] : '#C9925A'); }
  }
};

/** Redrawn wall art, by wall kind (all fourteen; the video wall keeps its own drawing). */
export const COARSE_WALL_ART: Record<string, () => void> = { status, board, tvwall, queue, boxes, books, charts, chem, mapw, mood, vaultw, stars, menu };

/** Side rooms, corners and centrepieces drawn without the box highlight, their edges snapped to their own colours. */
export const COARSE_SIDE = new Set<string>(Object.keys(SIDE_C));
export const COARSE_CORNER = new Set<string>(Object.keys(CORNER_C));
export const COARSE_CENTER = new Set<string>([...Object.keys(CENTER_C), 'globe', 'anchor', 'soc', 'grid', 'press', 'printer3d', 'booths', 'kiosk', 'suite', 'washer', 'aisle', 'line', 'tanks', 'cube', 'sorter', 'rotary', 'cell', 'table']);
/** Draws `f` without the one-pixel highlight on boxes when `on` (the chunky props' look). */
export function onGrid(on: boolean, f: () => void): void {
  if (!on) { f(); return; }
  boxStyle.highlight = false;
  try { f(); } finally { boxStyle.highlight = true; }
}
