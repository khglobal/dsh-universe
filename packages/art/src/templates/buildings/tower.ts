// A session's tower. Silhouette, facade, crown and shop front come from the template (so a
// building never changes its looks); segments, storeys and footprint come from what the session did (so it grows);
// lights and the crane come from its state. Night windows are lit only where a session is actually working or
// waiting. Painted in world tiles around the lot centre; the sprite cache places it.
import type { BuildingSpec } from '@dsh-universe/renderer';
import { hs } from '@dsh-universe/model';
import { P4, box, cyl, disc, fillQ, flat, g, iso, lerp, line, ring, winQ, type Quad } from '../../iso.ts';
import { env, P, tone } from '../../light.ts';
import { BOLD, FC, SC, mix } from '../../palette.ts';
import { HAIR, SHIRT, SKIN } from '../../people.ts';
import { partsOf } from './silhouettes.ts';
import { TOWER_TEMPLATES } from './templates.ts';

/** Storey height outside, drawing units (5.5 art pixels). */
export const SH = 11;

const BAND: Record<string, string> = { podium: FC.lobby, library: FC.library, workshop: FC.workshop, machine: FC.machine, meeting: FC.meeting };
/** Share of windows lit by state. Idle and finished towers are dark: lights mean work. */
const LIT: Record<string, number> = { running: 0.6, waiting: 0.35, idle: 0, done: 0, failed: 0, future: 0 };

/** The look of a session, from its seed (hue and roof colour from the hash). */
export function lookOf(seed: number): { hue: number; roofc: string } {
  const h = Math.floor(hs(seed | 0, 11, 3) * 1e6);
  return { hue: (h >> 12) % 9, roofc: BOLD[((h >> 12) + 4 + ((h >> 10) % 3)) % 9] };
}

/** Paints the tower; returns its height (drawing units) for markers, and the y of its door. */
export function paintTower(b: BuildingSpec): { top: number; doorY: number; crane?: { x: number; y: number; z: number }; roof: { x: number; y: number; w: number; d: number; z: number } } {
  const tp = TOWER_TEMPLATES[((b.template % TOWER_TEMPLATES.length) + TOWER_TEMPLATES.length) % TOWER_TEMPLATES.length];
  const look = lookOf(b.seed), hue = (look.hue + (b.hueShift ?? 0)) % 9, rc0 = look.roofc;
  const sp = { form: tp.form, mat: tp.mat, roof: tp.roof, win: tp.win, aw: tp.aw, hue, roofc: rc0 };
  const stt = b.state, [cx, cy] = b.at, hw = b.footprint, G = 1, nite = env.night > 0.5, seed = b.seed | 0;
  const bold = BOLD[sp.hue], base = sp.mat === 4 ? mix(bold, '#FFFFFF', 0.28) : bold;
  const wall = stt === 'failed' ? mix(base, '#59627A', 0.6) : stt === 'idle' ? mix(base, '#CDD2DA', 0.3) : base;
  const roofc = stt === 'failed' ? '#59627A' : sp.roofc;
  const lit: Quad[] = [], dark: Quad[] = [];
  const litF = LIT[stt] ?? 0, ep = b.frames.epoch, run = stt === 'running', glow = (c: string) => (nite ? c : tone(c, 0));
  const litC = stt === 'waiting' && (b.frames.blink & 1) ? '#F0A020' : P.lit;
  if (b.hover) ring([iso(cx - 1, cy - 1), iso(cx + 1, cy - 1), iso(cx + 1, cy + 1), iso(cx - 1, cy + 1)], SC[stt === 'future' ? 'idle' : stt], 4);
  let z = 3, k = 0, lastZ0 = 3, lastStoreys = 0;
  let last: [number, number, number, number] = [cx - hw, cy - hw, cx + hw, cy + hw];
  const round = sp.form === 8, P0s = partsOf(sp.form, 0, cx, cy, hw), P0 = P0s[0], PL = P0s[P0s.length - 1];
  // One annex pod per subagent (the first four), roofed in its state colour, on the side facing the block's lane so
  // it stays on the lot (art/footprints.ts lotEnvelope: never on the road or the lane's furniture). West pods stand
  // behind the tower, so they are painted before it; east ones in front, after it.
  const pods = () => b.annexes.slice(0, 4).forEach((st, i) => {
    const y = cy - hw + i * 0.44, x0 = b.podsWest ? cx - hw - 0.36 : cx + hw + 0.06;
    box(x0, y, x0 + 0.3, y + 0.34, 0, 8, '#F4F1E8', SC[st === 'future' ? 'idle' : st]);
  });
  if (b.podsWest) pods();
  box(P0[0] - 0.08, P0[1] - 0.08, (round ? cx + hw : PL[2]) + 0.08, Math.max(P0[3], PL[3]) + 0.08, 0, 3, '#CDD2DA');
  for (const sg of b.segments) {
    const h = sg.storeys * SH * G, on = b.heads.filter((a) => a.floor === sg.id), bandC = glow(BAND[sg.id] ?? FC.lobby);
    if (round && k) {
      const rad = hw * 0.88;
      cyl(cx, cy, rad, z, z + h, wall, wall);
      const c0 = iso(cx, cy, z), rx = rad * 45;
      for (let r = 0; r < sg.storeys; r++) for (let c = 0; c < 7; c++) {
        const a = Math.PI * (c + 0.5) / 7, wx = c0[0] - Math.cos(a) * rx * 0.96, wy = c0[1] + Math.sin(a) * rx * 0.5 - (r * SH + 8) * G;
        const isL = (on.length > 0 && r === 0) || hs(seed + k * 31 + r * 7, c, ep + ((c + r) & 3)) < litF;
        g.fillStyle = isL ? litC : P.dark; g.fillRect(Math.round(wx / 2) * 2 - 3, Math.round(wy / 2) * 2, 6, 8 * G);
      }
      g.strokeStyle = bandC; g.lineWidth = 3; g.beginPath(); g.ellipse(c0[0], c0[1] - h + 2, rx, rx / 2, 0, 0, Math.PI); g.stroke();
      last = [cx - rad * 0.7, cy - rad * 0.7, cx + rad * 0.7, cy + rad * 0.7];
    } else {
      partsOf(sp.form, k, cx, cy, hw).forEach(([x0, y0, x1, y1], pi) => {
        box(x0, y0, x1, y1, z, z + h, k ? wall : ['#F4F1E8', '#59627A', '#E3E0D6'][sp.hue % 3], k ? wall : '#CDD2DA');
        if (hs(seed, k, 41) > 0.35) { box(x1 - 0.26, y0 + 0.06, x1 - 0.08, y0 + 0.22, z + h, z + h + 3, '#CDD2DA'); box(x0 + 0.06, y1 - 0.2, x0 + 0.2, y1 - 0.06, z + h, z + h + 2.5, '#AEB5C2', '#8A93A3'); }
        const nc = Math.max(2, Math.round((x1 - x0) * 2.3)), nr = Math.max(2, Math.round((y1 - y0) * 2.3));
        const LQ = (u0: number, u1: number, za: number, zb: number, c: string) => P4(iso(lerp(x0, x1, u0), y1, za), iso(lerp(x0, x1, u1), y1, za), iso(lerp(x0, x1, u1), y1, zb), iso(lerp(x0, x1, u0), y1, zb), c);
        const RQ = (u0: number, u1: number, za: number, zb: number, c: string) => P4(iso(x1, lerp(y1, y0, u0), za), iso(x1, lerp(y1, y0, u1), za), iso(x1, lerp(y1, y0, u1), zb), iso(x1, lerp(y1, y0, u0), zb), c);
        if (sp.mat === 3) for (let c = 0; c < nc * 2; c += 2) { LQ(c / (nc * 2), (c + 1) / (nc * 2), z, z + h, tone('#FFFFFF', env.kL)); if (c < nr * 2) RQ(c / (nr * 2), (c + 1) / (nr * 2), z, z + h, tone('#FFFFFF', env.kR)); }   // stone ribs
        else if (sp.mat === 5) for (let r = 0; r < sg.storeys; r++) { LQ(0, 1, z + (r * SH + 8) * G, z + (r * SH + 11) * G, tone('#FFFFFF', env.kL)); RQ(0, 1, z + (r * SH + 8) * G, z + (r * SH + 11) * G, tone('#FFFFFF', env.kR)); }   // white spandrels
        else if (sp.mat === 4) for (let r = 0; r < sg.storeys * 2; r++) for (let c = r & 1; c < nc * 2; c += 2) LQ(c / (nc * 2), (c + 1) / (nc * 2), z + r * SH * G / 2, z + (r + 1) * SH * G / 2, tone(mix(wall, '#FFFFFF', 0.45), env.kL));   // tiles
        if (sp.mat <= 2 && k) {   // curtain walls: sky glass, glass tinted in the tower's colour, pale green glass
          const gl = sp.mat === 1 ? [mix(bold, '#FFFFFF', 0.5), mix(bold, '#FFFFFF', 0.2)] : sp.mat === 0 ? ['#7FD0FF', '#2FA8F0'] : ['#BFF1EE', '#22C3E6'];
          for (let r = 0; r < sg.storeys; r++) {
            const isL = (on.length > 0 && r === 0) || hs(seed + k * 31 + r * 7 + pi, 1, ep + (r & 3)) < litF * 1.2;
            LQ(0.05, 0.95, z + (r * SH + 1.5) * G, z + (r * SH + 9.5) * G, isL ? litC : nite ? P.dark : gl[0]);
            RQ(0.05, 0.95, z + (r * SH + 1.5) * G, z + (r * SH + 9.5) * G, isL ? litC : nite ? P.dark : gl[1]);
          }
          g.strokeStyle = sp.mat === 1 ? tone('#27304F', 0) : tone('#FFFFFF', 0); g.lineWidth = 2; g.beginPath();
          for (let c = 1; c < nc; c++) { const a = iso(lerp(x0, x1, c / nc), y1, z), q = iso(lerp(x0, x1, c / nc), y1, z + h - 3); g.moveTo(a[0], a[1]); g.lineTo(q[0], q[1]); }
          for (let c = 1; c < nr; c++) { const a = iso(x1, lerp(y1, y0, c / nr), z), q = iso(x1, lerp(y1, y0, c / nr), z + h - 3); g.moveTo(a[0], a[1]); g.lineTo(q[0], q[1]); }
          g.stroke();
        } else {
          for (let r = 0; r < sg.storeys; r++) {
            winQ(lit, dark, x0, y0, x1, y1, z + (r * SH + (sp.win === 2 ? 1.5 : 2.5)) * G, z + (r * SH + (sp.win === 2 ? 9 : 7.5)) * G, sp.win === 1 ? Math.ceil(nc / 2) : nc, sp.win === 1,
              (c, f) => (on.length > 0 && r === 0) || hs(seed + k * 31 + r * 7 + pi, c + f * 9, ep + ((c + r) & 3)) < litF);
          }
          fillQ(dark, P.dark); fillQ(lit, litC);
        }
        LQ(0, 1, z + h - 3, z + h, bandC); RQ(0, 1, z + h - 3, z + h, nite ? bandC : tone(BAND[sg.id] ?? FC.lobby, -0.18));
        const fh = Math.floor(hs(seed, k + pi * 3, 53) * 64), zt = z + h;
        if (k) {
          if (sp.mat >= 3 && (fh & 1)) for (let r = 0; r < sg.storeys; r += 2) box(lerp(x0, x1, 0.3), y1, lerp(x0, x1, 0.7), y1 + 0.07, z + r * SH + 1, z + r * SH + 4, '#F4F1E8', '#CDD2DA');   // balconies
          if (fh & 2) { const q = iso(x0 + 0.1, y1 - 0.12, zt); disc([q[0], q[1] - 6], 6, P.tree1); disc([q[0] + 9, q[1] - 2], 4, P.tree2); }   // planting on the terrace
          if (nite && (fh & 4) && (run || stt === 'waiting')) { LQ(0, 1, zt - 5, zt - 3.5, '#FFC928'); RQ(0, 1, zt - 5, zt - 3.5, '#FFC928'); }   // a lit cornice, only on a working tower
          if ((fh & 24) === 8 && k === 1) P4(iso(x1, y1 + 0.02, z + 2), iso(x1 + 0.09, y1 + 0.02, z + 2), iso(x1 + 0.09, y1 + 0.02, z + Math.min(h, 24)), iso(x1, y1 + 0.02, z + Math.min(h, 24)), BOLD[(sp.hue + 4) % 9]);   // a blade sign (colour, no letters)
        } else if (sg.storeys >= 2) {   // the podium's fascia sign: colour blocks, no lettering
          const sc2 = BOLD[(sp.hue + 3 + pi) % 9];
          LQ(0.08, 0.92, zt - 9, zt - 4.5, tone(sc2, 0)); for (let m = 0; m < 4; m++) LQ(0.16 + m * 0.18, 0.26 + m * 0.18, zt - 7.6, zt - 6, '#FFFFFF'); RQ(0.1, 0.9, zt - 9, zt - 4.5, tone(sc2, -0.15));
          RQ(0.38, 0.62, 3, 9, nite ? P.dark : tone('#7FD0FF', -0.1)); box(x1, lerp(y1, y0, 0.34), x1 + 0.16, lerp(y1, y0, 0.66), 9, 10.5, '#39415A', '#59627A');   // a side entrance under a canopy
        }
        if (sp.form === 9 || sp.form === 1) box(x0 - 0.05, y0 - 0.05, x1 + 0.05, y1 + 0.05, z + h - 2, z + h, '#F4F1E8');
        if (!k && !pi) {   // shop front: display windows, a door, one of four awnings
          const open = run || stt === 'waiting', dc = open ? litC : P.dark, mx = (x0 + x1) / 2, u = (v: number) => (v - x0) / (x1 - x0);
          LQ(0.06, u(mx - 0.18), 4, 3 + 9 * G, dc); LQ(u(mx + 0.18), 0.94, 4, 3 + 9 * G, dc);
          if (open) for (let i = 0; i < 3; i++) { LQ(0.09 + i * 0.07, 0.13 + i * 0.07, 4.5, 6.5 + (i & 1) * 2, BOLD[(sp.hue + i * 2) % 9]); LQ(u(mx + 0.22) + i * 0.07, u(mx + 0.22) + 0.04 + i * 0.07, 4.5, 7.5 - (i & 1) * 2, BOLD[(sp.hue + 1 + i * 3) % 9]); }
          LQ(u(mx - 0.14), u(mx + 0.14), 3, 12 * G, tone('#39415A', 0));
          const aw = (c: string) => P4(iso(x0, y1, z + h - 3), iso(x1, y1, z + h - 3), iso(x1, y1 + 0.22, z + h - 7), iso(x0, y1 + 0.22, z + h - 7), c);
          if (sp.aw === 2) LQ(0.04, 0.96, z + h - 6, z + h - 3, glow(BOLD[(sp.hue + 3) % 9]));
          else {
            aw(stt === 'waiting' ? SC.waiting : glow(roofc));
            if (sp.aw === 0) for (let a2 = 0; a2 < 4; a2++) { const u0 = lerp(x0, x1, (a2 * 2 + 0.5) / 8), u1 = lerp(x0, x1, (a2 * 2 + 1.5) / 8); P4(iso(u0, y1, z + h - 3), iso(u1, y1, z + h - 3), iso(u1, y1 + 0.22, z + h - 7), iso(u0, y1 + 0.22, z + h - 7), '#FFFFFF'); }
            else if (sp.aw === 3) for (let a2 = 0; a2 < 6; a2++) { const q = iso(lerp(x0, x1, (a2 + 0.5) / 6), y1 + 0.22, z + h - 7); g.fillStyle = '#FFFFFF'; g.fillRect(q[0] - 3, q[1], 6, 4); }
          }
        }
        last = [x0, y0, x1, y1];
      });
    }
    on.slice(0, 3).forEach((a, c) => {   // heads at the windows: the agents on this segment now
      const q = iso(lerp(last[0], last[2], (c + 0.5) / 3), last[3], z + 5 * G);
      g.fillStyle = '#141A30'; g.fillRect(q[0] - 4, q[1] - 4, 8, 10); g.fillStyle = SKIN[a.seed % 4]; g.fillRect(q[0] - 2, q[1] - 2, 4, 4); g.fillStyle = SHIRT[a.seed % 8]; g.fillRect(q[0] - 2, q[1] + 2, 4, 2);
    });
    lastZ0 = z; lastStoreys = sg.storeys;
    z += h; k++;
  }
  const [tx0, ty0, tx1, ty1] = last, rcx = (tx0 + tx1) / 2, rcy = (ty0 + ty1) / 2, rw = (tx1 - tx0) / 2, rd = (ty1 - ty0) / 2, c0 = iso(rcx, rcy, z);
  const roof = sp.form === 6 || sp.form === 2 ? 2 : sp.form === 9 ? 4 : round ? (sp.roof & 1 ? 3 : 8) : sp.roof;
  const flatRoof = [0, 5, 6, 7, 9].includes(roof), m = Math.min(rw, rd), steel = nite ? '#AEB5C2' : '#59627A', bk = '#E5433D';
  let crown = 0;
  const topped = b.stage === 'topped';
  // Topped out (done, failed or idle): the template's own crown goes on, so finished towers keep their skyline
  // shape; the flat crowns (helipad, pool, roof garden, solar deck) are the only flat roofs.
  if (topped) crown = paintCrown(roof, { tx0, ty0, tx1, ty1, rcx, rcy, rw, rd, m, z, c0, wall, roofc, nite, steel, bk });
  let top = z + 14 + crown;
  if (stt === 'done') b.resting.slice(0, 4).forEach((s, i) => {   // the family's finished agents resting on the roof
    const v = flatRoof ? iso(rcx - rw * 0.5 + i * rw * 0.34, rcy + rd * 0.45 - (i & 1) * rd * 0.5, z + 1) : iso(cx - 0.5 + i * 0.34, cy + hw + 0.3, 0);
    g.fillStyle = '#141A30'; g.fillRect(v[0] - 5, v[1] - 22, 10, 22); g.fillStyle = SHIRT[s % 8]; g.fillRect(v[0] - 4, v[1] - 12, 8, 10);
    g.fillStyle = SKIN[s % 4]; g.fillRect(v[0] - 3, v[1] - 20, 6, 7); g.fillStyle = HAIR[(s >> 2) % 4]; g.fillRect(v[0] - 3, v[1] - 21, 6, 3);
  });
  if (b.stage === 'construction' && k > 1) {   // under construction: scaffolding round the top section
    const [sx0, sy0, sx1, sy1] = last, pole = '#8A93A3', plank = '#C9925A';
    for (const [px, py] of [[sx0 - 0.04, sy1 + 0.04], [sx1 + 0.04, sy1 + 0.04], [sx1 + 0.04, sy0 - 0.04], [(sx0 + sx1) / 2, sy1 + 0.04], [sx1 + 0.04, (sy0 + sy1) / 2]]) line(iso(px, py, lastZ0), iso(px, py, z + 4), pole, 2);
    for (let r = 0; r <= lastStoreys; r++) {
      const zz = lastZ0 + r * SH + 1;
      line(iso(sx0 - 0.04, sy1 + 0.04, zz), iso(sx1 + 0.04, sy1 + 0.04, zz), plank, 2);
      line(iso(sx1 + 0.04, sy1 + 0.04, zz), iso(sx1 + 0.04, sy0 - 0.04, zz), plank, 2);
    }
  }
  let crane: { x: number; y: number; z: number } | undefined;
  if (run) {   // the crane turns while the session runs: drawn as its own sprite (16 angles), so the tower is not redrawn
    crane = { x: tx0 + 0.18, y: ty0 + 0.18, z };
    top = Math.max(top, z + 38);
  }
  if (stt === 'waiting') {   // an amber beacon on the roof, on and off
    const q = iso(rcx, rcy, z + 20); line(q, iso(rcx, rcy, z), '#59627A', 2);
    g.fillStyle = b.frames.blink & 1 ? SC.waiting : '#7A2E2A'; g.fillRect(q[0] - 5, q[1] - 8, 10, 10);
    top = Math.max(top, z + 34);
  }
  if (stt === 'done') { const f = iso(tx0 + 0.12, ty1 - 0.12, z); line(f, [f[0], f[1] - 16], '#59627A', 2); g.fillStyle = SC.done; g.fillRect(f[0], f[1] - 16, 10, 6); }
  if (b.scheduled) {   // a clock on the side: started by a scheduled task
    const c = iso(P0[2], cy, 3 + SH * 0.6); disc(c, 6, '#FFFFFF'); g.strokeStyle = '#2F6BDE'; g.lineWidth = 2; g.beginPath(); g.arc(c[0], c[1], 6, 0, 6.3); g.moveTo(c[0], c[1] - 4); g.lineTo(c[0], c[1]); g.lineTo(c[0] + 3, c[1] + 1); g.stroke();
  }
  if (b.preset) {   // a purple pennant: an expert preset
    const q = iso(tx1 - 0.1, ty1 - 0.1, z); line(q, [q[0], q[1] - 20], '#59627A', 2);
    g.fillStyle = '#8E5BE8'; g.beginPath(); g.moveTo(q[0], q[1] - 20); g.lineTo(q[0] + 12, q[1] - 16); g.lineTo(q[0], q[1] - 12); g.closePath(); g.fill();
  }
  if (!b.podsWest) pods();
  return { top, doorY: P0[3], crane, roof: { x: rcx, y: rcy, w: rw, d: rd, z } };
}

/** The tower crane at one of 16 angles, around its own foot (tile 0, 0, height 0). */
export function paintCrane(angle: number): void {
  const mz = 30, ang = (angle % 16) / 16 * 6.283, jx = Math.cos(ang), jy = Math.sin(ang);
  const m0 = iso(0, 0, 0), m1 = iso(0, 0, mz), j1 = iso(jx * 1.3, jy * 1.3, mz - 4), j0 = iso(-jx * 0.5, -jy * 0.5, mz - 4), hk = iso(jx * 0.95, jy * 0.95, mz - 4);
  line(m0, m1, P.crane, 4); line(j0, j1, P.crane, 3); line(hk, [hk[0], hk[1] + 14], '#39415A', 2);
  g.fillStyle = '#39415A'; g.fillRect(j0[0] - 3, j0[1] - 2, 6, 6); g.fillStyle = SC.running; g.fillRect(m1[0] - 3, m1[1] - 5, 6, 6);
}

interface CrownCtx { tx0: number; ty0: number; tx1: number; ty1: number; rcx: number; rcy: number; rw: number; rd: number; m: number; z: number; c0: [number, number]; wall: string; roofc: string; nite: boolean; steel: string; bk: string }

/** The twelve crowns; they go on when the work stops. Returns the crown height. */
export function paintCrown(roof: number, c: CrownCtx): number {
  const { tx0, ty0, tx1, ty1, rcx, rcy, rw, rd, m, z, c0, wall, roofc, nite, steel, bk } = c;
  switch (roof) {
    case 0: box(rcx - rw * 0.6, rcy - rd * 0.6, rcx + rw * 0.5, rcy + rd * 0.5, z, z + 9, '#CDD2DA', '#AEB5C2'); box(rcx + rw * 0.55, rcy - rd * 0.2, rcx + rw * 0.85, rcy + rd * 0.4, z, z + 4, '#AEB5C2'); return 9;   // mechanical penthouse
    case 1: for (const [dx, dy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) line(iso(rcx + dx * rw, rcy + dy * rd, z), iso(rcx + dx * rw, rcy + dy * rd, z + 10), '#5A4636', 2); cyl(rcx, rcy, m * 0.5, z + 10, z + 22, '#C9925A', '#A8743F'); return 22;   // water tank on legs
    case 2: { box(rcx - m * 0.55, rcy - m * 0.55, rcx + m * 0.55, rcy + m * 0.55, z, z + 10, wall, '#F4F1E8'); box(rcx - m * 0.28, rcy - m * 0.28, rcx + m * 0.28, rcy + m * 0.28, z + 10, z + 22, wall, '#F4F1E8'); const a = iso(rcx, rcy, z + 22); line(a, [a[0], a[1] - 46], steel, 3); g.fillStyle = bk; g.fillRect(a[0] - 2, a[1] - 50, 4, 4); return 70; }   // needle spire
    case 3: for (let i = 0; i < 3; i++) { const w = m * (0.85 - 0.24 * i); box(rcx - w, rcy - w, rcx + w, rcy + w, z + i * 8, z + i * 8 + 8, i === 2 ? roofc : wall, i === 2 ? '#FFC928' : '#F4F1E8'); } return 24;   // stepped crown
    case 4: { box(rcx - m * 0.4, rcy - m * 0.4, rcx + m * 0.4, rcy + m * 0.4, z, z + 8, '#CDD2DA'); const a = iso(rcx, rcy, z + 8); line(a, [a[0], a[1] - 58], steel, 4); line([a[0] - 8, a[1] - 20], [a[0] + 8, a[1] - 20], steel, 2); line([a[0] - 5, a[1] - 38], [a[0] + 5, a[1] - 38], steel, 2); g.fillStyle = bk; g.fillRect(a[0] - 2, a[1] - 62, 4, 4); return 70; }   // broadcast mast
    case 5: g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.beginPath(); g.ellipse(c0[0], c0[1], m * 34, m * 17, 0, 0, 6.3); g.moveTo(c0[0] - 5, c0[1] - 4); g.lineTo(c0[0] - 5, c0[1] + 4); g.moveTo(c0[0] + 5, c0[1] - 4); g.lineTo(c0[0] + 5, c0[1] + 4); g.moveTo(c0[0] - 5, c0[1]); g.lineTo(c0[0] + 5, c0[1]); g.stroke(); return 0;   // helipad
    case 6: flat(tx0 + 0.15, ty0 + 0.15, tx1 - 0.15, ty1 - 0.15, z + 0.5, '#F4F1E8'); flat(tx0 + 0.28, ty0 + 0.28, tx1 - 0.28, ty1 - 0.28, z + 0.6, nite ? '#2F6BDE' : '#2FA8F0'); return 0;   // rooftop pool
    case 7: flat(tx0 + 0.1, ty0 + 0.1, tx1 - 0.1, ty1 - 0.1, z + 0.5, tone('#4CC552', 0)); disc(iso(rcx - rw * 0.4, rcy - rd * 0.3, z + 8), 7, P.tree1); disc(iso(rcx + rw * 0.3, rcy + rd * 0.3, z + 7), 6, P.tree2); return 8;   // roof garden
    case 8: { const m0 = iso(rcx, rcy, z), m1: [number, number] = [m0[0], m0[1] - 34]; line(m0, m1, steel, 3); line([m1[0] - 8, m1[1] + 8], [m1[0] + 8, m1[1] + 8], steel, 2); disc([m1[0] + 8, m1[1] + 16], 6, '#F4F1E8'); g.fillStyle = bk; g.fillRect(m1[0] - 2, m1[1] - 4, 4, 4); return 36; }   // antenna and dish
    case 9: for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) flat(lerp(tx0, tx1, 0.1 + i * 0.45), lerp(ty0, ty1, 0.1 + j * 0.45), lerp(tx0, tx1, 0.45 + i * 0.45), lerp(ty0, ty1, 0.45 + j * 0.45), z + 3, '#1F4FB0'); return 0;   // solar panels
    case 10: { const hh = m * 34, a = iso(tx0, ty1, z), b = iso(tx1, ty1, z), cc = iso(tx1, ty1, z + hh); g.fillStyle = tone(roofc, env.kL); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(cc[0], cc[1]); g.closePath(); g.fill(); P4(iso(tx1, ty1, z), iso(tx1, ty0, z), iso(tx1, ty0, z + hh), iso(tx1, ty1, z + hh), tone(roofc, env.kR)); P4(iso(tx0, ty0, z), iso(tx1, ty0, z + hh), iso(tx1, ty1, z + hh), iso(tx0, ty1, z), tone(roofc, 0.25)); return hh; }   // slanted crown
    default: box(rcx - m * 0.62, rcy - m * 0.62, rcx + m * 0.62, rcy + m * 0.62, z, z + 12, '#F4F1E8'); box(rcx - m * 0.45, rcy - m * 0.45, rcx + m * 0.45, rcy + m * 0.45, z + 12, z + 18, roofc, '#FFC928'); return 18;   // lantern
  }
}
