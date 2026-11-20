// Nothing stands in anything else (0.3.2, a pile of furniture beside the town hall): every session lot, every civic
// building (with every power plant, connector and shop that may join it) and every piece of street furniture keeps
// to its own ground, and where a civic building and a piece of furniture meet on screen the painter's order agrees
// with which stands in front.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cityTemplate, isRoad, MAX_GROWTH } from '@dsh-universe/model';
import { civicFootprints, cityLayout, inRect, itemRect, lotEnvelope, rectsMeet, type GroundRect } from '../src/index.ts';

const T = cityTemplate(), civ = civicFootprints(T), items = cityLayout().items, lots = T.blocks.flatMap((b) => b.lots);
const at = (r: GroundRect) => r.map((v) => +v.toFixed(2)).join(',');
const name = (it: (typeof items)[number]) => `${it.kind}${it.k}@${it.x.toFixed(2)},${it.y.toFixed(2)}`;

test('session lots: no two meet, none meets a civic building or a road', () => {
  const bad: string[] = [];
  for (let i = 0; i < lots.length; i++) {
    const e = lotEnvelope(lots[i]);
    for (let j = i + 1; j < lots.length; j++) if (rectsMeet(e, lotEnvelope(lots[j]))) bad.push(`${lots[i].key} meets ${lots[j].key}`);
    for (const c of civ) for (const r of c.rects) if (rectsMeet(e, r)) bad.push(`${lots[i].key} meets ${c.id}`);
    for (let x = Math.floor(e[0]); x < e[2]; x++) for (let y = Math.floor(e[1]); y < e[3]; y++) if (isRoad(x, y, MAX_GROWTH)) bad.push(`${lots[i].key} [${at(e)}] on road ${x},${y}`);
  }
  assert.deepEqual(bad, []);
});

test('civic buildings: no two meet', () => {
  const bad: string[] = [];
  for (let i = 0; i < civ.length; i++) for (let j = i + 1; j < civ.length; j++)
    if (civ[i].rects.some((a) => civ[j].rects.some((b) => rectsMeet(a, b)))) bad.push(`${civ[i].id} meets ${civ[j].id}`);
  assert.deepEqual(bad, []);
});

test('street furniture: nothing inside a civic building, on a lot it does not belong to, or on another piece', () => {
  const bad: string[] = [];
  for (const it of items) {
    const r0 = itemRect(it);
    for (const c of civ) for (const r of c.rects) if (rectsMeet(r0, r) && inRect(it.x, it.y, r, 0.3)) bad.push(`${name(it)} in ${c.id}`);
    for (const L of lots) if (it.lot !== L.key && rectsMeet(r0, lotEnvelope(L))) bad.push(`${name(it)} on lot ${L.key}`);
  }
  // Trees may stand in clumps; a tree never stands on furniture, and no two pieces of furniture share ground.
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if ((a.kind === 'tree' && b.kind === 'tree') || (a.lot && b.lot)) continue;
    if (rectsMeet(itemRect(a), itemRect(b))) bad.push(`${name(a)} on ${name(b)}`);
  }
  assert.deepEqual(bad, []);
});

test('the painter order agrees with the ground: furniture in front of a civic building is drawn after it', () => {
  const bad: string[] = [];
  for (const c of civ) for (const r of c.rects) for (const it of items) {
    if (it.x < r[0] - 1.5 || it.x > r[2] + 1.5 || it.y < r[1] - 1.5 || it.y > r[3] + 1.5) continue;
    // Only what can meet on screen (columns of the iso view overlap).
    const u = it.x - it.y; if (u < r[0] - r[3] - 0.6 || u > r[2] - r[1] + 0.6) continue;
    const front = (it.x >= r[2] && it.y > r[1]) || (it.y >= r[3] && it.x > r[0]);
    const behind = (it.x <= r[0] && it.y < r[3]) || (it.y <= r[1] && it.x < r[2]);
    const d = it.x + it.y;
    if (front && !behind && d <= c.depth) bad.push(`${name(it)} in front of ${c.id} but drawn under it (${d.toFixed(2)} ≤ ${c.depth.toFixed(2)})`);
    if (behind && !front && d >= c.depth) bad.push(`${name(it)} behind ${c.id} but drawn over it (${d.toFixed(2)} ≥ ${c.depth.toFixed(2)})`);
  }
  assert.deepEqual(bad, []);
});

test('the same for session lots: a tower is drawn after what stands behind it and before what stands in front', () => {
  const bad: string[] = [];
  for (const L of lots) {
    const r = lotEnvelope(L), depth = L.x + 1 + L.y + 1;
    for (const c of civ) for (const q of c.rects) {
      const u0 = q[0] - q[3], u1 = q[2] - q[1], v0 = r[0] - r[3], v1 = r[2] - r[1];
      if (u1 < v0 || v1 < u0) continue;
      const civFront = q[0] >= r[2] || q[1] >= r[3], civBehind = q[2] <= r[0] || q[3] <= r[1];
      if (civFront && !civBehind && c.depth <= depth) bad.push(`${c.id} in front of lot ${L.key} but drawn under it`);
      if (civBehind && !civFront && c.depth >= depth) bad.push(`${c.id} behind lot ${L.key} but drawn over it`);
    }
  }
  assert.deepEqual(bad, []);
});
