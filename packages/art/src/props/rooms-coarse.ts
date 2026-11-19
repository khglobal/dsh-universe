// Side rooms and corners with chunky parts (first made for a 2-pixel grid, now composed at the room's own resolution):
// the same rooms in the same places as props/sides.ts and props/corners.ts, parts at least four pixels across in palette colours. What changes is data, as before: the cage's rack lights and the booth's lamps and record
// light run only while an agent works on the floor (`act`); the break area's coffee steams then. All rights reserved.
import { act, B, BOLD, Bw, cyl, disc, F, fl2, flat, fN, g, hs, line, nt, P4, pt, rcol, rec, scr, tm } from './pen.ts';
import { bush } from './units.ts';
import type { Kit } from './walls.ts';

/** A vertical post standing on the floor (a box 0.12 tile square). */
const post = (x: number, y: number, h: number, c = '#59627A'): void => Bw(x, y, x + 0.12, y + 0.12, 0, h, c);
/** A server rack facing +y with a column of lights that blink while busy. */
function rack(x: number, y: number, w: number, d: number, h: number, k: number): void {
  B(x, y, x + w, y + d, 0, h, '#39415A', '#59627A');
  for (let r = 0; r < 4; r++) {
    const z = 4 + r * ((h - 6) / 4), on = act && hs(k, r, fl2 >> 1) > 0.35;
    P4(pt(x + 0.08, y + d, z), pt(x + w - 0.08, y + d, z), pt(x + w - 0.08, y + d, z + 3), pt(x + 0.08, y + d, z + 3), '#27304F');
    P4(pt(x + 0.1, y + d, z), pt(x + 0.26, y + d, z), pt(x + 0.26, y + d, z + 3), pt(x + 0.1, y + d, z + 3), on ? (hs(r, k, 3) > 0.8 ? '#FFC928' : '#4CC552') : '#2A6B55');
  }
}

export const SIDE_C: Kit = {
  /** Glass meeting room: a glass back wall, a frame, a table with six chairs, things on the table. */
  glass: () => {
    P4(pt(8.3, 2.3, 3), pt(8.3, 5.7, 3), pt(8.3, 5.7, 30), pt(8.3, 2.3, 30), '#BFF1EE');
    Bw(8.3, 2.3, 8.42, 5.7, 28, 32, '#8A93A3'); Bw(8.3, 2.3, 8.42, 5.7, 0, 3, '#8A93A3');
    F(8.5, 2.5, 11.5, 5.5, '#E6F7D6');
    for (const [cx, cy, bx, by] of [[9.4, 3.05, 0, -1], [10.4, 3.05, 0, -1], [9.4, 4.75, 0, 1], [10.4, 4.75, 0, 1], [8.8, 3.9, -1, 0], [11.0, 3.9, 1, 0]] as const) {
      B(cx - 0.04, cy - 0.04, cx + 0.04, cy + 0.04, 0, 4, '#59627A'); B(cx - 0.18, cy - 0.18, cx + 0.18, cy + 0.18, 4, 8, '#39415A', '#27304F');
      B(cx - 0.18 + (bx > 0 ? 0.24 : 0), cy - 0.18 + (by > 0 ? 0.24 : 0), cx + 0.18 - (bx < 0 ? 0.24 : 0), cy + 0.18 - (by < 0 ? 0.24 : 0), 8, 18, '#39415A');
    }
    B(9.3, 3.6, 9.42, 3.72, 0, 8, '#59627A'); B(10.5, 4.2, 10.62, 4.32, 0, 8, '#59627A'); B(9.1, 3.4, 10.8, 4.5, 8, 11, '#8D6B52', '#C9925A');
    flat(9.3, 3.6, 9.7, 3.95, 11.4, '#FFFFFF'); flat(9.85, 3.75, 10.25, 4.1, 11.4, '#141A30'); flat(10.3, 4.05, 10.65, 4.35, 11.4, '#FFC928');
    bush(11.1, 2.6);
    for (const x of [8.3, 9.4, 10.45, 11.38]) post(x, 5.6, 32, '#8A93A3');
    Bw(8.3, 5.6, 11.5, 5.72, 28, 32, '#8A93A3'); Bw(8.3, 5.6, 11.5, 5.72, 0, 3, '#8A93A3');
  },
  /** Server cage: a mesh frame round two rows of racks, a warning sign on the door. */
  cage: () => {
    F(8.4, 2.4, 11.5, 5.6, '#DDF0F8');
    P4(pt(8.3, 2.3, 2), pt(8.3, 5.7, 2), pt(8.3, 5.7, 30), pt(8.3, 2.3, 30), '#CDD2DA');
    for (let k = 0; k < 4; k++) rack(8.6 + k * 0.72, 2.6, 0.58, 0.7, 30, k);
    for (let k = 0; k < 3; k++) rack(8.9 + k * 0.82, 4.2, 0.62, 0.7, 26, k + 4);
    for (const x of [8.3, 9.5, 10.3, 11.38]) post(x, 5.6, 32);
    for (const z of [0, 15, 29]) { Bw(8.3, 5.62, 9.5, 5.7, z, z + 3, '#59627A'); Bw(10.3, 5.62, 11.5, 5.7, z, z + 3, '#59627A'); }
    P4(pt(10.5, 5.72, 14), pt(11.1, 5.72, 14), pt(11.1, 5.72, 22), pt(10.5, 5.72, 22), '#FFC928');
    P4(pt(10.7, 5.72, 16), pt(10.9, 5.72, 16), pt(10.9, 5.72, 20), pt(10.7, 5.72, 20), '#141A30');
  },
  /** Stock room: two shelf units of boxes, a pallet of cartons, a hand truck. */
  store: () => {
    F(8.4, 2.4, 11.5, 5.6, '#E3E0D6');
    for (let k = 0; k < 2; k++) {
      const y = 2.5 + k * 1.5;
      for (let r = 0; r < 3; r++) {
        const z = r * 10;
        B(8.5, y, 11.4, y + 0.56, z, z + 3, '#8A93A3', '#AEB5C2');
        for (let c = 0; c < 5; c++) if (hs(k * 5 + r, c, 9) > 0.2) B(8.6 + c * 0.56, y + 0.08, 9.06 + c * 0.56, y + 0.48, z + 3, z + 9, hs(c, r, 4) > 0.5 ? '#C9925A' : BOLD[(c + r * 2 + k) % 9], '#FFF6CF');
      }
      for (const x of [8.5, 9.9, 11.3]) Bw(x, y + 0.46, x + 0.12, y + 0.58, 0, 30, '#39415A');
    }
    B(9.0, 4.7, 9.95, 5.45, 0, 2, '#A8743F', '#C9925A');
    for (let i = 0; i < 4; i++) B(9.05 + (i & 1) * 0.46, 4.75 + (i >> 1) * 0.34, 9.45 + (i & 1) * 0.46, 5.05 + (i >> 1) * 0.34, 2, 8 + (i % 2) * 2, '#A8743F', '#C9925A');
    B(10.45, 5.15, 10.95, 5.45, 0, 3, '#E5433D'); B(10.45, 5.15, 10.57, 5.27, 3, 16, '#E5433D');
    B(10.5, 5.2, 10.92, 5.42, 3, 9, '#C9925A', '#FFF6CF');
    disc(pt(10.55, 5.5, 2), 4, '#141A30'); disc(pt(10.9, 5.5, 2), 4, '#141A30');
  },
  /** Photo booth: a white backdrop, a stool, two lamps on stands (lit while busy), a camera with a record light. */
  booth: () => {
    F(8.4, 2.4, 11.5, 5.6, '#F4F1E8');
    P4(pt(8.6, 2.5, 0), pt(11.3, 2.5, 0), pt(11.3, 2.5, 30), pt(8.6, 2.5, 30), '#FFFFFF');
    F(8.6, 2.5, 11.3, 4.2, '#FFFFFF');
    Bw(8.55, 2.42, 11.35, 2.56, 29, 33, '#8A93A3');
    B(9.7, 3.2, 10.2, 3.6, 0, 7, BOLD[5]); disc(pt(9.95, 3.4, 13), 7, BOLD[1]);
    for (const [x, y] of [[8.8, 4.3], [11.1, 4.3]] as const) {
      post(x - 0.06, y - 0.06, 22, '#39415A');
      Bw(x - 0.22, y - 0.06, x + 0.22, y + 0.06, 0, 3, '#39415A');
      const q = pt(x, y, 26); g.fillStyle = '#141A30'; g.fillRect(q[0] - 10, q[1] - 8, 20, 16); g.fillStyle = act ? '#FFF6CF' : '#AEB5C2'; g.fillRect(q[0] - 6, q[1] - 4, 12, 8);
    }
    post(9.9, 4.95, 13, '#39415A'); B(9.74, 4.86, 10.16, 5.14, 13, 19, '#27304F');
    disc(pt(9.95, 4.86, 16), 5, '#7FD0FF'); if (act) disc(pt(10.1, 5.14, 18), 4, '#E5433D');
    B(8.6, 5.1, 9.0, 5.42, 0, 6, '#39415A');
  },
};

export const CORNER_C: Kit = {
  /** Break area: a rug, an L of sofas, a low table, the coffee counter (steam while busy), a vending machine. */
  lounge: () => {
    F(8.4, 9.1, 11.6, 11.7, '#FF4FA3'); F(8.55, 9.25, 11.45, 11.55, '#FFE9F3');
    B(8.5, 9.5, 9.0, 11.0, 0, 6, '#8E5BE8'); B(8.5, 9.5, 8.7, 11.0, 6, 14, '#8E5BE8');
    B(8.5, 11.05, 10.4, 11.55, 0, 6, '#2F6BDE'); B(8.5, 11.35, 10.4, 11.55, 6, 14, '#2F6BDE');
    B(8.6, 10.0, 8.92, 10.3, 6, 9, '#FFC928'); B(9.4, 11.1, 9.72, 11.35, 6, 9, '#FF8A2B');
    B(9.5, 10.1, 9.62, 10.22, 0, 4, '#59627A'); B(10.1, 10.38, 10.22, 10.5, 0, 4, '#59627A'); B(9.4, 10.0, 10.3, 10.6, 4, 7, '#C9925A', '#FFF6CF'); flat(9.5, 10.1, 9.85, 10.35, 7.4, '#E5433D'); B(9.95, 10.2, 10.1, 10.35, 7, 11, '#FFFFFF');
    B(11.1, 9.1, 11.7, 10.6, 0, 11, '#39415A', '#59627A');
    B(11.18, 9.2, 11.62, 9.62, 11, 19, '#E5433D', '#FF8A7A'); if (act) for (let i = 0; i < 2; i++) disc(pt(11.38, 9.4, 22 + ((tm * 7 + i * 6) % 12)), 4, '#CDD2DA');
    B(11.18, 9.85, 11.62, 10.35, 11, 17, '#CDD2DA', '#F4F1E8'); P4(pt(11.24, 10.35, 12), pt(11.52, 10.35, 12), pt(11.52, 10.35, 16), pt(11.24, 10.35, 16), '#27304F');
    B(11.05, 10.85, 11.7, 11.5, 0, 28, '#2F6BDE', '#7FA8F5');
    P4(pt(11.1, 11.5, 9), pt(11.5, 11.5, 9), pt(11.5, 11.5, 25), pt(11.1, 11.5, 25), nt ? '#BFF1EE' : '#7FD0FF');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) P4(pt(11.14 + c * 0.18, 11.5, 11 + r * 5), pt(11.28 + c * 0.18, 11.5, 11 + r * 5), pt(11.28 + c * 0.18, 11.5, 14 + r * 5), pt(11.14 + c * 0.18, 11.5, 14 + r * 5), BOLD[(r * 3 + c * 2) % 9]);
    P4(pt(11.1, 11.5, 2), pt(11.6, 11.5, 2), pt(11.6, 11.5, 6), pt(11.1, 11.5, 6), '#141A30');
  },
  /** Lockers: a row along each wall, a bench, shoes, a first-aid box, an extinguisher, hooks with towels. */
  lockers: () => {
    F(8.4, 9.1, 11.6, 11.7, '#E3E0D6');
    for (let k = 0; k < 5; k++) { const y = 9.2 + k * 0.48; B(11.2, y, 11.7, y + 0.46, 0, 26, BOLD[(k * 2 + 1) % 9]); P4(pt(11.2, y + 0.3, 12), pt(11.2, y + 0.38, 12), pt(11.2, y + 0.38, 16), pt(11.2, y + 0.3, 16), '#FFC928'); }
    for (let k = 0; k < 5; k++) { const x = 8.5 + k * 0.5; B(x, 11.25, x + 0.48, 11.7, 0, 26, k & 1 ? '#2F6BDE' : '#19B8A0', '#CDD2DA'); P4(pt(x + 0.1, 11.7, 18), pt(x + 0.38, 11.7, 18), pt(x + 0.38, 11.7, 22), pt(x + 0.1, 11.7, 22), '#141A30'); P4(pt(x + 0.3, 11.7, 9), pt(x + 0.4, 11.7, 9), pt(x + 0.4, 11.7, 13), pt(x + 0.3, 11.7, 13), '#FFC928'); }
    for (const x of [8.9, 10.4]) B(x, 10.2, x + 0.12, 10.45, 0, 4, '#59627A'); B(8.8, 10.1, 10.6, 10.55, 4, 7, '#C9925A', '#FFF6CF');
    for (let i = 0; i < 3; i++) B(9.0 + i * 0.5, 10.62, 9.3 + i * 0.5, 10.86, 0, 3, BOLD[i * 2]);
    B(8.5, 9.2, 8.92, 9.5, 12, 18, '#FFFFFF'); P4(pt(8.62, 9.5, 13), pt(8.8, 9.5, 13), pt(8.8, 9.5, 17), pt(8.62, 9.5, 17), '#E5433D');
    B(9.3, 9.2, 9.7, 9.6, 0, 15, '#E5433D', '#FF8A7A'); cyl(9.5, 9.4, 0.12, 15, 19, '#141A30', '#39415A');
    for (let i = 0; i < 3; i++) { const q = pt(10.2 + i * 0.3, 9.3, 16); g.fillStyle = ['#FFC928', '#FFFFFF', '#FF8A2B'][i]; g.fillRect(q[0] - 5, q[1] - 2, 10, 8); }
  },
  /** Pantry: a chequered floor, the counter with sink and microwave, a fridge, two round tables with stools. */
  pantry: () => {
    F(8.4, 9.1, 11.6, 11.7, '#FFF6CF');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if ((i + j) & 1) F(8.4 + i * 0.8, 9.1 + j * 0.86, 9.2 + i * 0.8, 9.96 + j * 0.86, '#FFFFFF');
    B(11.1, 9.1, 11.7, 10.9, 0, 11, '#F4F1E8', '#CDD2DA');
    for (let i = 0; i < 3; i++) P4(pt(11.1, 9.2 + i * 0.58, 2), pt(11.1, 9.68 + i * 0.58, 2), pt(11.1, 9.68 + i * 0.58, 9), pt(11.1, 9.2 + i * 0.58, 9), '#FFFFFF');
    flat(11.2, 9.25, 11.6, 9.8, 11.4, '#AEB5C2'); B(11.46, 9.36, 11.56, 9.46, 11, 17, '#8A93A3');
    B(11.18, 10.0, 11.62, 10.45, 11, 17, '#39415A', '#59627A'); P4(pt(11.18, 10.06, 12), pt(11.18, 10.36, 12), pt(11.18, 10.36, 16), pt(11.18, 10.06, 16), '#27304F');
    B(11.05, 10.95, 11.7, 11.6, 0, 28, '#F4F1E8', '#FFFFFF'); P4(pt(11.05, 11.0, 14), pt(11.05, 11.55, 14), pt(11.05, 11.55, 16), pt(11.05, 11.0, 16), '#8A93A3');
    for (const [x, y, c] of [[9.1, 9.9, '#E5433D'], [9.9, 10.9, '#2F6BDE']] as [number, number, string][]) {
      B(x - 0.04, y - 0.04, x + 0.04, y + 0.04, 0, 8, '#8A93A3'); cyl(x, y, 0.34, 8, 10, '#FFFFFF', '#F4F1E8'); disc(pt(x - 0.1, y, 11.5), 4, c);
      for (const [dx, dy] of [[-0.5, 0], [0.5, 0], [0, -0.48], [0, 0.48]]) cyl(x + dx, y + dy, 0.13, 0, 6, '#59627A', c);
    }
    B(8.5, 11.3, 8.8, 11.6, 0, 9, '#59627A', '#39415A'); B(8.5, 9.2, 8.75, 9.45, 0, 15, '#2E9E48', '#4CC552');
  },
};

/** Centrepieces redrawn with chunky parts. */
export const CENTER_C: Kit = {
  /** Briefing: a stage with a lectern and microphone, a flag, a screen with a bar per recent call while busy (red: failed), twelve audience chairs. */
  podium: () => {
    B(3.6, 3.5, 6.9, 4.4, 0, 3, '#8D6B52', '#C9925A');
    B(5, 3.7, 5.5, 4.1, 3, 16, '#5A4636', '#8D6B52'); flat(5.06, 3.76, 5.44, 4.04, 16.4, '#FFFFFF');
    Bw(5.08, 3.94, 5.18, 4.04, 16, 22, '#39415A'); B(5.04, 3.92, 5.2, 4.06, 22, 25, '#141A30');
    Bw(3.76, 3.56, 3.86, 3.66, 3, 33, '#AEB5C2');
    { const q = pt(3.86, 3.62, 33); g.fillStyle = BOLD[4]; g.fillRect(q[0], q[1] - 2, 16, 10); }
    scr(5.9, 3.56, 0.9, 10, 26, act);
    if (act) rec.slice(0, 3).forEach((e, k) => P4(pt(5.98, 3.62, 20 - k * 4), pt(5.98 + 0.7 * (0.4 + 0.6 * hs(k, 1, 1)), 3.62, 20 - k * 4), pt(5.98 + 0.7 * (0.4 + 0.6 * hs(k, 1, 1)), 3.62, 23 - k * 4), pt(5.98, 3.62, 23 - k * 4), rcol(e)));
    for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) { const x = 3.75 + c * 0.54, y = 4.9 + r * 0.55; B(x, y, x + 0.34, y + 0.3, 4, 7, BOLD[(r * 3 + 1) % 9]); B(x, y + 0.26, x + 0.34, y + 0.32, 7, 15, BOLD[(r * 3 + 1) % 9]); }
  },
  /** Boardroom: a long table with ten chairs, papers and glasses, and a screen at the head showing a bar per recent call while busy. */
  longtable: () => {
    F(3.4, 3.2, 7.1, 6, '#27304F'); F(3.5, 3.3, 7, 5.9, '#39415A');
    for (const x of [4.1, 6.3]) B(x, 4.5, x + 0.14, 4.64, 0, 9, '#39415A');
    B(3.9, 4.15, 6.6, 5, 9, 12, '#5A4636', '#8D6B52');
    for (let i = 0; i < 5; i++) {
      for (const y of [3.75, 5.15]) { B(4 + i * 0.52, y, 4.36 + i * 0.52, y + 0.3, 4, 7, '#27304F'); B(4 + i * 0.52, y + (y < 4 ? -0.06 : 0.26), 4.36 + i * 0.52, y + (y < 4 ? 0 : 0.32), 7, 17, '#141A30'); }
      flat(4.04 + i * 0.52, 4.24, 4.32 + i * 0.52, 4.46, 12.4, '#FFFFFF');
      B(4.16 + i * 0.52, 4.74, 4.26 + i * 0.52, 4.84, 12, 15, '#BFF1EE');
    }
    Bw(3.5, 4.1, 3.7, 5.05, 12, 31, '#141A30');
    P4(pt(3.7, 4.18, 14), pt(3.7, 4.97, 14), pt(3.7, 4.97, 29), pt(3.7, 4.18, 29), act ? '#1F4FB0' : '#27304F');
    if (act) rec.slice(0, 3).forEach((e, k) => P4(pt(3.7, 4.26 + k * 0.24, 16), pt(3.7, 4.44 + k * 0.24, 16), pt(3.7, 4.44 + k * 0.24, 19 + hs(k, 1, 2) * 9), pt(3.7, 4.26 + k * 0.24, 19 + hs(k, 1, 2) * 9), rcol(e)));
    flat(5.08, 4.44, 5.42, 4.72, 12.4, '#141A30');
  },
  /** Code review table: two big screens showing the diff of recent calls while busy (green added, red removed), keyboards, mugs, stools, and a whiteboard with a green tick per doubling of files changed. */
  reviewtable: () => {
    F(3.5, 3.3, 7, 5.9, '#E6F7D6');
    for (const x of [4.2, 6.2]) B(x, 4.5, x + 0.1, 4.6, 0, 12, '#8A93A3');
    B(4.1, 4.1, 6.4, 5, 12, 15, '#CDD2DA', '#FFFFFF');
    for (let m = 0; m < 2; m++) {
      const x = 4.2 + m * 1.15;
      Bw(x + 0.42, 4.12, x + 0.58, 4.24, 15, 18, '#39415A');
      Bw(x, 4.1, x + 1, 4.22, 18, 34, '#141A30');
      P4(pt(x + 0.08, 4.22, 20), pt(x + 0.92, 4.22, 20), pt(x + 0.92, 4.22, 32), pt(x + 0.08, 4.22, 32), act ? '#27304F' : '#39415A');
      if (act) for (let r = 0; r < 3; r++) {
        const e = rec[(r + m * 3) % Math.max(1, rec.length)], add = (r + m) % 3 !== 0, z = 28 - r * 4, w = 0.6 * (0.35 + 0.65 * hs(r, m, e ? Math.round(e.age / 20) : 1));
        P4(pt(x + 0.14, 4.22, z), pt(x + 0.26, 4.22, z), pt(x + 0.26, 4.22, z + 3), pt(x + 0.14, 4.22, z + 3), add ? '#4CC552' : '#E5433D');
        P4(pt(x + 0.3, 4.22, z), pt(x + 0.3 + w, 4.22, z), pt(x + 0.3 + w, 4.22, z + 3), pt(x + 0.3, 4.22, z + 3), add ? '#8BD93E' : '#FF8A7A');
      }
    }
    for (let i = 0; i < 3; i++) { flat(4.3 + i * 0.7, 4.46, 4.8 + i * 0.7, 4.66, 15.4, '#AEB5C2'); B(4.86 + i * 0.7, 4.66, 5.0 + i * 0.7, 4.8, 15, 19, BOLD[i * 3]); }
    for (let i = 0; i < 4; i++) cyl(4.3 + i * 0.6, 5.35, 0.14, 0, 9, '#59627A', BOLD[(i * 2 + 2) % 9]);
    B(3.6, 3.5, 3.9, 3.8, 0, 16, '#F4F1E8');
    P4(pt(3.62, 3.8, 3), pt(3.88, 3.8, 3), pt(3.88, 3.8, 15), pt(3.62, 3.8, 15), '#FFFFFF');
    for (let r = 0; r < Math.min(3, Math.floor(Math.log2((fN || 0) + 1) / 1.5)); r++) P4(pt(3.66, 3.8, 11 - r * 4), pt(3.84, 3.8, 11 - r * 4), pt(3.84, 3.8, 14 - r * 4), pt(3.66, 3.8, 14 - r * 4), '#4CC552');
  },
  /** The trading pit: a raised round with a rail, a counter ringed with screens (cycling while busy), the turning sign. */
  pit: () => {
    cyl(5.2, 4.55, 1.55, 0, 2.5, '#8E5BE8', '#E9DDF5');
    for (let i = 1; i < 8; i++) { const a = Math.PI * (i / 8), q0 = pt(5.2 - Math.cos(a) * 1.5, 4.55 + Math.sin(a) * 1.5, 2.5); line(q0, [q0[0], q0[1] - 10], '#C9925A', 4); disc([q0[0], q0[1] - 11], 4, '#FFC928'); }
    cyl(5.2, 4.55, 1, 2.5, 10.5, '#39415A', '#59627A'); cyl(5.2, 4.55, 0.62, 10.5, 12, '#141A30', '#27304F');
    const c0 = pt(5.2, 4.55, 7);
    for (let i = 0; i < 7; i++) {
      const a = Math.PI * (i + 0.5) / 7, x = c0[0] - Math.cos(a) * 62, y = c0[1] + Math.sin(a) * 28;
      g.fillStyle = '#141A30'; g.fillRect(x - 8, y - 7, 16, 14);
      g.fillStyle = act ? ['#4CC552', '#FFC928', '#22C3E6', '#FF8A7A', '#4CC552', '#FF4FA3'][(i + Math.floor(tm * 1.3)) % 6] : '#27304F'; g.fillRect(x - 4, y - 3, 8, 6);
    }
    for (let i = 0; i < 4; i++) { const a = Math.PI * (i + 0.5) / 4, q = pt(5.2 - Math.cos(a) * 0.8, 4.55 + Math.sin(a) * 0.8, 10.5); g.fillStyle = i & 1 ? '#FFFFFF' : '#FFC928'; g.fillRect(q[0] - 4, q[1] - 2, 8, 4); }
    line(pt(5.2, 4.55, 12), pt(5.2, 4.55, 30), '#8A93A3', 4);
    const t0 = pt(5.2, 4.55, 35), wv = Math.max(4, Math.abs(Math.cos(tm * 0.9)) * 22);
    g.fillStyle = '#141A30'; g.fillRect(t0[0] - wv - 2, t0[1] - 8, wv * 2 + 4, 16);
    g.fillStyle = '#FFC928'; g.fillRect(t0[0] - wv, t0[1] - 6, wv * 2, 12);
    g.fillStyle = '#141A30'; g.fillRect(t0[0] - wv * 0.6, t0[1] - 2, wv * 1.2, 4);
  },
};
