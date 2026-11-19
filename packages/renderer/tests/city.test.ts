import test from 'node:test';
import assert from 'node:assert/strict';
import { SQUARE_FRONT_CAP, cityTemplate, createStore, emptyPlacement, place, storeysOf, type UEvent } from '@dsh-universe/model';
import { CityView, Traffic, buildScene, createStubKit, deviceRatio, drawTextLayer, hitTest, minZoom, paintCity, scaleOf, wholeCity, zoomStep, homeCamera, type HitArea, type SceneInput } from '../src/index.ts';
import { fakeSurface } from './fake-canvas.ts';

const DAY = new Date(2026, 10, 18).getTime();
const at = (h: number, m = 0) => DAY + (h * 60 + m) * 60_000;
const names = { town: 'T', station: 'S', fire: 'F', school: 'K', library: 'L' };

function day(n = 12): UEvent[] {
  const ev: UEvent[] = [{ type: 'workspace', data: { id: 'w1', title: 'Finance', displayPath: 'fin' } }, { type: 'connector', data: { id: 'erp', title: 'ERP', state: 'connected' } }];
  for (let i = 0; i < n; i++) {
    const id = 's' + i;
    ev.push({ type: 'agent', data: { id, sessionId: id, workspaceId: i % 3 ? 'w1' : 'w2', label: 'secret title ' + i, kind: 'main', state: 'running', startedAt: at(8, i * 7) } });
    ev.push({ type: 'turn', data: { t: at(8, i * 7), agentId: id, phase: 'start' } });
    for (let k = 0; k < 10 + i * 9; k++) ev.push({ type: 'activity', data: { id: id + ':' + k, t: at(8, i * 7) + k * 1000, agentId: id, category: (['read', 'edit', 'exec'] as const)[k % 3], tool: 'read' } });
    ev.push({ type: 'usage', data: { t: at(8, i * 7) + 500, agentId: id, model: 'm1', input: 1000 * i, output: 100 } });
    if (i % 4 === 1) ev.push({ type: 'turn', data: { t: at(9, i), agentId: id, phase: 'end', reason: 'completed' } });
    if (i === 2) ev.push({ type: 'approval', data: { id: 'a', agentId: id, kind: 'approval', askedAt: at(9, 30) } });
  }
  return ev;
}
const placementOf = (ev: UEvent[]) => place(cityTemplate(), emptyPlacement(), ev.flatMap((e) => (e.type === 'agent' ? [{ sessionId: e.data.sessionId, workspaceId: e.data.workspaceId, startedAt: e.data.startedAt }] : []))).state;
function input(ev = day(), T = at(10)): SceneInput {
  const store = createStore(); store.applyAll(ev);
  return { store, placement: placementOf(ev), T, templateTags: [[]], names, time: 0, night: false };
}

test('scene: same history, same city (positions, templates, heights)', () => {
  const a = buildScene(input()), b = buildScene(input());
  assert.deepEqual(a.places.map((p) => [p.id, p.at, p.building?.template, p.building?.segments]), b.places.map((p) => [p.id, p.at, p.building?.template, p.building?.segments]));
});

test('scene: placed buildings never move when later sessions arrive', () => {
  const ev = day(6);
  const before = buildScene(input(ev, at(10)));
  const more = [...ev, ...day(20).filter((e) => e.type === 'agent' && Number(e.data.id.slice(1)) >= 6)];
  const after = buildScene(input(more, at(12)));
  for (const p of before.places.filter((x) => x.tier === 'building')) assert.deepEqual(after.places.find((x) => x.id === p.id)?.at, p.at, p.id);
  assert.ok(after.growth >= before.growth, 'the border only grows');
});

test('scene: an empty workspace has the civic baseline only', () => {
  const store = createStore();
  const s = buildScene({ store, placement: emptyPlacement(), T: at(10), templateTags: [[]], names, time: 0, night: false });
  assert.equal(s.places.filter((p) => p.tier === 'building').length, 0);
  assert.deepEqual(s.places.map((p) => p.id).sort(), ['fire', 'library', 'model:', 'school', 'station', 'town']);
  assert.equal(s.agents.length, 0);
  assert.equal(s.cars, 0, 'no calls, no cars');
  assert.equal(s.animated, false, 'nothing moves');
});

test('scene: lots in front of the square are capped at 13 storeys', () => {
  const T = cityTemplate();
  const capped = T.blocks.flatMap((b) => b.lots).filter((l) => l.cap > 0);
  assert.ok(capped.length > 0);
  const ev = day(1);
  const store = createStore(); store.applyAll(ev);
  for (let i = 0; i < 400; i++) store.apply({ type: 'activity', data: { id: 'x' + i, t: at(8) + i, agentId: 's0', category: (['read', 'edit', 'exec', 'delegate'] as const)[i % 4], tool: 't' } });
  const pl = emptyPlacement();
  pl.lots.s0 = capped[0].key;
  const s = buildScene({ store, placement: pl, T: at(10), templateTags: [[]], names, time: 0, night: false });
  const b = s.places.find((p) => p.id === 'b:s0')!.building!;
  assert.ok(storeysOf(b.segments) <= SQUARE_FRONT_CAP, String(storeysOf(b.segments)));
  pl.lots.s0 = T.blocks.flatMap((x) => x.lots).find((l) => !l.cap)!.key;
  const free = buildScene({ store, placement: pl, T: at(10), templateTags: [[]], names, time: 0, night: false }).places.find((p) => p.id === 'b:s0')!.building!;
  assert.ok(storeysOf(free.segments) > SQUARE_FRONT_CAP);
});

test('scene: signs are place names and start times only, never session titles', () => {
  const s = buildScene(input());
  for (const g of s.signs) {
    assert.ok(!/secret title/.test(g.text), g.text);
    assert.ok(/^\d\d[:-]\d\d$/.test(g.text) || ['T', 'S', 'F', 'K', 'L', 'ERP', 'm1', 'Finance'].includes(g.text), g.text);
  }
});

test('scene: night lights only where sessions are active', () => {
  const inp = input();
  const s = buildScene({ ...inp, night: true });
  const lit = new Set(s.pools.map((p) => `${p.x - 0.4},${p.y - 0.4}`));
  for (const p of s.places.filter((x) => x.tier === 'building')) {
    const active = p.state === 'running' || p.state === 'waiting';
    assert.equal(lit.has(`${p.at[0]},${p.at[1]}`), active, p.id + ' ' + p.state);
  }
  assert.equal(buildScene({ ...inp, night: false }).pools.length, 0, 'no pools by day');
});

test('hit testing: people before houses before buildings; in a tier, the one in front', () => {
  const areas: HitArea[] = [
    { id: 'tower', tier: 'building', r: [0, 0, 100, 100], depth: 50 },
    { id: 'front', tier: 'building', r: [0, 0, 100, 100], depth: 60 },
    { id: 'shop', tier: 'house', r: [10, 10, 60, 60], depth: 1 },
    { id: 'agent', tier: 'person', r: [20, 20, 30, 30], depth: 0 },
  ];
  assert.equal(hitTest(areas, 25, 25)?.id, 'agent');
  assert.equal(hitTest(areas, 50, 50)?.id, 'shop');
  assert.equal(hitTest(areas, 80, 80)?.id, 'front');
  assert.equal(hitTest(areas, 500, 500), undefined);
});

test('pixel art has no glyphs: painting the city never writes text', () => {
  const kit = createStubKit(fakeSurface);
  const f = fakeSurface(400, 300);
  paintCity(f.ctx as never, kit, buildScene(input()), new Traffic(), { time: 0, zoom: 1, bw: 400, bh: 300, camX: 0, camY: 232 });
  assert.ok(f.log.length > 10);
  assert.ok(!f.log.some((l) => /^(fillText|strokeText)/.test(l)), 'no text in the art buffer');
});

test('text layer: whole-pixel coordinates; a sign behind a building is cut out by it', () => {
  const f = fakeSurface(800, 600);
  const img = { width: 10, height: 10 } as never;
  drawTextLayer(f.ctx as never, [{ x: 100.4, y: 80.6, text: '09:55', bg: '#FFF', fg: '#000', small: true, depth: 10 }],
    [{ image: img, sx: 90, sy: 60, sw: 40, sh: 40, depth: 20, t: [70, 60, 85, 90] }, { image: img, sx: 90, sy: 60, sw: 40, sh: 40, depth: 5 }], 2, 1);
  for (const l of f.log.filter((x) => /^(fillRect|fillText)\(/.test(x))) {
    const nums = l.slice(l.indexOf('(') + 1, -1).split(',').filter((x) => /^-?[\d.]+$/.test(x)).map(Number);
    for (const n of nums) assert.ok(Number.isInteger(n), l);
  }
  assert.equal(f.log.filter((l) => l.startsWith('drawImage(')).length, 1, 'only the occluder in front is drawn again');
});

test('camera: whole zoom levels, whole-pixel scale at ≥ 1, the whole city fits', () => {
  const vp = { w: 1440, h: 900, dpr: 1.5 };
  const home = homeCamera(vp);
  assert.equal(scaleOf(home, vp), 3, 'level 2 × 1.5 rounds to 3 device pixels per art pixel');
  assert.equal(zoomStep(home, 1, vp).zi, home.zi + 1);
  assert.equal(zoomStep({ ...home, zi: 5 }, 1, vp).zi, 5);
  assert.equal(zoomStep({ ...home, zi: 1 }, -1, { ...vp, dpr: 2 }).zi, 1, 'desktop stops at 0.5');
  assert.equal(zoomStep({ ...home, zi: 3 }, -3, vp).zi, 2, 'never below one device pixel per art pixel (no speckle)');
  assert.equal(zoomStep({ ...home, zi: 2 }, -2, { w: 390, h: 844, dpr: 1 }).zi, 2, 'narrow at dpr 1 stops at 1× and pans');
  assert.equal(zoomStep({ ...home, zi: 1 }, -1, { w: 390, h: 800, dpr: 4 }).zi, 0, 'narrow screens go to 0.25 when that is still whole device pixels');
  for (let g = 0; g < 9; g++) assert.ok(wholeCity(vp, g).zi >= 1);
});

function fakeView(rm: boolean) {
  const frames: ((t: number) => void)[] = [];
  const cv = fakeSurface(800, 600);
  let painted = 0;
  const view = new CityView({
    kit: createStubKit(fakeSurface), canvas: { width: 800, height: 600, getContext: () => cv.ctx } as never, reducedMotion: () => rm,
    raf: (fn) => { frames.push(fn); return frames.length; }, cancelRaf: () => {}, clock: () => 0,
    artBuffer: () => { const s = fakeSurface(2, 2); return { canvas: { width: 2, height: 2 }, ctx: s.ctx as never }; }, surfaces: fakeSurface as never, onFrame: () => { painted++; },
  });
  const run = (ms: number, step = 1000 / 60) => { for (let t = 0; t <= ms; t += step) { const f = frames.shift(); if (!f) break; f(t); } };
  return { view, run, painted: () => painted, pending: () => frames.length };
}

test('reduced motion: a still picture, at most two frames a second', () => {
  const v = fakeView(true);
  v.view.resize(800, 600, 1);
  v.view.setInput({ ...input(), templateTags: [[]] });
  v.view.start();
  for (let k = 0; k < 6; k++) { v.view.invalidate(); v.run(1000); }
  const n = v.painted();
  assert.ok(n >= 1 && n <= 13, String(n));
  const scene = v.view.scene!;
  assert.ok(scene.agents.every((a) => a.person.phase === 0 && !a.person.walking), 'nobody moves');
  assert.ok(scene.places.every((p) => !p.building || (p.building.frames.blink === 0 && p.building.frames.epoch === 0)));
});

test('idle is still: with nothing animated and nothing changed, no frames are painted', () => {
  const v = fakeView(false);
  v.view.resize(800, 600, 1);
  v.view.setInput({ store: createStore(), placement: emptyPlacement(), T: at(10), templateTags: [[]], names });
  v.view.start();
  v.run(200);
  const n = v.painted();
  v.run(3000);
  assert.equal(v.painted(), n, 'no repaint without a change');
  assert.equal(v.pending(), 0, 'the loop sleeps');
});

test('scene: a failed call puffs smoke for 20 seconds; tool plates are tool names only; power dots only with recent tokens', () => {
  const ev = day(3);
  ev.push({ type: 'activity', data: { id: 'bad', t: at(10) - 10_000, agentId: 's1', category: 'read', tool: 'mcp__erp__execute_read', ok: false } });
  const s = buildScene(input(ev, at(10)));
  assert.ok(s.puffs.includes('b:s1'));
  assert.equal(buildScene(input(ev, at(10, 1))).puffs.length, 0, 'gone after 20 seconds');
  assert.equal(buildScene(input(day(3), at(18))).power.length, 0, 'no tokens in the last five minutes, no dots');
});

test('walking: an agent whose calls move to a connector walks there along the roads, then stands at its door', () => {
  const ev = day(2);
  const t0 = at(9, 50);
  ev.push({ type: 'activity', data: { id: 'c1', t: t0, agentId: 's0', category: 'connector', tool: 'mcp__erp__execute_read', connectorId: 'erp' } });
  const inp = (T: number) => ({ ...input(ev, T), walk: true });
  const mid = buildScene(inp(t0 + 1500)).agents.find((a) => a.id === 's0');
  assert.ok(mid && mid.person.walking, 'on the way');
  const there = buildScene(inp(t0 + 60_000)).agents.find((a) => a.id === 's0');
  assert.ok(there && !there.person.walking, 'arrived');
  assert.equal(there.tool, 'execute_read', 'the tool name without the server prefix');
  assert.deepEqual(there.pos, [14.5, 26.8 + 0.9]);
  const still = buildScene({ ...inp(t0 + 1500), walk: false, time: 0 }).agents.find((a) => a.id === 's0');
  assert.ok(still && !still.person.walking, 'reduced motion: straight at the destination');
});

test('earlier days: a building whose session is not in today\'s data stands at the size and state it ended in', () => {
  const pl = placementOf(day(1));
  pl.lots.old = cityTemplate().blocks.flatMap((b) => b.lots).find((l) => !Object.values(pl.lots).includes(l.key) && !l.cap)!.key;
  pl.sizes = { old: { calls: { library: 60, workshop: 30 }, tokens: 400_000, state: 'failed' } };
  const store = createStore(); store.applyAll(day(1));
  const b = buildScene({ store, placement: pl, T: at(10), templateTags: [[]], names, time: 0, night: false }).places.find((p) => p.id === 'b:old')!.building!;
  assert.equal(b.state, 'failed');
  assert.equal(b.stage, 'topped');
  assert.deepEqual(b.segments.map((x) => x.id), ['podium', 'library', 'workshop']);
  assert.ok(b.footprint > 0.8);
  assert.ok(!JSON.stringify(pl.sizes).match(/title|tool|secret/), 'sizes only');
});

test('trains: a scheduled run arrives 24 s before, stands 10 s, leaves; no schedule, no train', () => {
  const ev = day(2);
  ev.push({ type: 'schedule', data: { id: 'a1', title: 'Daily', status: 'active', nextAt: at(10, 30), runs: [{ at: at(9, 0), agentId: 's0' }] } });
  const x = (T: number) => buildScene(input(ev, T)).trains;
  assert.equal(x(at(10, 0)).length, 0, 'nothing due');
  assert.equal(x(at(10, 30) - 12_000).length, 3, 'arriving: engine and two carriages');
  assert.equal(x(at(10, 30) + 5_000)[0].x, 8.4, 'standing at the platform');
  assert.ok(x(at(9, 0) + 20_000)[0].x < 8.4, 'leaving after a run');
  assert.equal(buildScene(input(day(2), at(10, 30))).trains.length, 0);
});

test('signs: a very long name is shortened with an ellipsis to fit', async () => {
  const { fit } = await import('../src/text.ts');
  const m = { measureText: (t: string) => ({ width: [...t].length * 10 }) };
  assert.equal(fit(m, 'ERP', 100), 'ERP');
  const long = fit(m, '华东区域销售与渠道合作伙伴关系管理（2026 年第四季度专项）', 100);
  assert.ok(long.endsWith('…') && [...long].length <= 10, long);
});

test('camera: going home glides there (no jump); under reduced motion it is there at once', () => {
  for (const rm of [false, true]) {
    const v = fakeView(rm);
    v.view.resize(800, 600, 1);
    v.view.setInput({ ...input(), templateTags: [[]] });
    v.view.start();
    v.run(50);
    v.view.panBy(400, 300);
    const far = { ...v.view.cam };
    v.view.home();
    if (rm) { assert.deepEqual(v.view.cam, homeCamera(v.view.vp)); continue; }
    assert.deepEqual(v.view.cam.x, far.x, 'not moved yet');
    v.run(40);
    const mid = v.view.cam;
    assert.ok(mid.x !== far.x && mid.x !== homeCamera(v.view.vp).x, 'part of the way');
    v.run(1500);
    assert.deepEqual(v.view.cam, homeCamera(v.view.vp), 'arrived');
  }
});

test('text layer: a sign more than half hidden is left out; nothing is written under the bottom controls', () => {
  const f = fakeSurface(800, 600);
  const img = { width: 10, height: 10 } as never;
  const out = drawTextLayer(f.ctx as never, [
    { x: 100, y: 80, text: 'ek-v4', bg: '#FFF', fg: '#000', small: false, depth: 10 },
    { x: 300, y: 590, text: 'Low', bg: '#FFF', fg: '#000', small: false, depth: 10 },
    { x: 500, y: 200, text: 'Clear', bg: '#FFF', fg: '#000', small: false, depth: 10 },
  ], [{ image: img, sx: 0, sy: 0, sw: 300, sh: 300, depth: 20, t: [0, 0, 300, 300] }], 1, 1, 560);
  assert.equal(out.length, 1, 'only the clear sign');
  assert.ok(f.log.some((l) => l.startsWith('fillText(Clear')));
  assert.ok(!f.log.some((l) => l.startsWith('fillText(ek-v4') || l.startsWith('fillText(Low')));
});

test('text layer: no sign and no place name is written under a control over the city', () => {
  const f = fakeSurface(800, 600);
  const out = drawTextLayer(f.ctx as never, [
    { x: 100, y: 300, text: 'Under', bg: '#FFF', fg: '#000', small: false, depth: 10, name: true },
    { x: 500, y: 300, text: 'Free', bg: '#FFF', fg: '#000', small: false, depth: 10, name: true },
    { x: 300, y: 100, text: 'Plate', bg: '#FFF', fg: '#000', small: false, depth: 10 },
  ] as never, [], 1, 1, undefined, [[60, 280, 200, 320], [250, 60, 400, 140]]);
  assert.equal(out.length, 1, 'only the name clear of the controls');
  assert.ok(f.log.some((l) => l.startsWith('fillText(Free')));
  assert.ok(!f.log.some((l) => l.startsWith('fillText(Under') || l.startsWith('fillText(Plate')));
});

test('text layer: a normal city shows every place name (station, school, library, workspace), never dropped for cover', () => {
  const cv = fakeSurface(1600, 1000);
  const view = new CityView({
    kit: createStubKit(fakeSurface), canvas: { width: 1600, height: 1000, getContext: () => cv.ctx } as never, reducedMotion: () => true,
    raf: () => 0, cancelRaf: () => {}, clock: () => 0,
    artBuffer: () => { const s = fakeSurface(2, 2); return { canvas: { width: 2, height: 2 }, ctx: s.ctx as never }; }, surfaces: fakeSurface as never,
  });
  view.resize(1600, 1000, 1);
  view.setInput({ ...input(day(12)), templateTags: [[]] });
  view.paint(0);
  view.whole();
  view.paint(0);
  const texts = cv.log.filter((l) => l.startsWith('fillText(')).map((l) => l.slice(9, l.indexOf(',')));
  for (const n of ['T', 'S', 'F', 'K', 'L', 'ERP', 'Finance']) assert.ok(texts.includes(n), n + ' in ' + texts.join(' '));
});

// Crispness: the art buffer lands on the screen at a whole number of device pixels per art pixel, at a
// whole-pixel offset, with smoothing off, and the backing store is the element's size times the screen's own ratio.
// Every zoom level, a spread of device pixel ratios (a 0.9× zoomed-out page, Windows 125 % and 150 %, Retina, an
// Electron page at 110 %), and camera positions in between art pixels as the glide leaves them.
const RATIOS = [0.9, 1, 1.25, 1.5, 2, 2.2, 3];
function crispView(w: number, h: number, dpr: number, rm = true) {
  const cv = fakeSurface(10, 10);
  const canvas = { width: 0, height: 0, getContext: () => cv.ctx };
  const frames: ((t: number) => void)[] = [];
  const view = new CityView({
    kit: createStubKit(fakeSurface), canvas: canvas as never, reducedMotion: () => rm,
    raf: (fn) => { frames.push(fn); return frames.length; }, cancelRaf: () => {}, clock: () => 0,
    artBuffer: () => { const s = fakeSurface(2, 2); return { canvas: { width: 2, height: 2 }, ctx: s.ctx as never }; }, surfaces: fakeSurface as never,
  });
  view.resize(w, h, dpr);
  view.setInput({ ...input(day(12)), templateTags: [[]] });
  return { view, cv, canvas, frames, dpr };
}
/** The art buffer's blit of the last frame from the call log, and whether smoothing was off when it ran. */
function lastBlit(log: string[]) {
  let i = log.length - 1;
  while (i >= 0 && !log[i].startsWith('drawImage(')) i--;
  // The art buffer is the first drawImage after the sky fill.
  const sky = log.lastIndexOf(log.slice(0, i + 1).reverse().find((l) => l.startsWith('fillRect(0,0,')) ?? '');
  const k = log.findIndex((l, j) => j > sky && l.startsWith('drawImage('));
  const args = log[k].slice(10, -1).split(',').slice(1).map(Number);
  const smooth = log.slice(0, k).reverse().find((l) => l.startsWith('imageSmoothingEnabled='));
  return { args, smoothing: smooth };
}
function assertCrisp(t: ReturnType<typeof crispView>, what: string) {
  const { view, canvas, cv } = t;
  const b = view.blit, dpr = t.dpr;
  assert.equal(canvas.width, Math.round(view.vp.w * dpr), what + ': backing width is the element times the ratio');
  assert.equal(canvas.height, Math.round(view.vp.h * dpr), what + ': backing height');
  assert.ok(Number.isInteger(b.sc) && b.sc >= 1, what + ': ' + b.sc + ' device pixels per art pixel');
  for (const v of [b.x, b.y, b.w, b.h]) assert.ok(Number.isInteger(v), what + ': blit ' + JSON.stringify(b));
  assert.equal(b.w, b.bw * b.sc, what + ': width is the buffer times the whole scale');
  assert.equal(b.h, b.bh * b.sc, what + ': height');
  const { args, smoothing } = lastBlit(cv.log);
  assert.deepEqual(args, [b.x, b.y, b.w, b.h], what + ': the logged draw');
  assert.equal(smoothing, 'imageSmoothingEnabled=false', what + ': smoothing off before the scaled draw');
}

test('crisp: every zoom level and device pixel ratio scales the art by a whole number at whole pixels, smoothing off', () => {
  for (const dpr of RATIOS) for (const [w, h] of [[1440, 900], [1043.296875, 844.5], [390, 700]] as const) {
    const t = crispView(w, h, dpr);
    for (let zi = minZoom(t.view.vp); zi <= 5; zi++) for (const [x, y] of [[0, 232], [96.13, 317.88], [-41.5, 200.49]]) {
      t.view.cam = { x, y, zi };
      t.view.paint(0);
      assertCrisp(t, `dpr ${dpr} ${w}×${h} zoom index ${zi} at ${x},${y}`);
    }
  }
});

test('crisp: the camera glide (and following) moves in whole art pixels; reduced motion jumps', () => {
  const t = crispView(1440, 900, 2, false);
  t.view.cam = { x: 300, y: 500, zi: 3 };
  t.view.moveTo({ x: 0, y: 232, zi: 3 });
  const xs: number[] = [];
  for (let k = 1; k < 40; k++) { t.view.paint(k * 16); assertCrisp(t, 'glide frame ' + k); xs.push(t.view.blit.x); }
  // Each step of the picture is a whole number of art pixels (sc device pixels).
  for (let k = 1; k < xs.length; k++) assert.equal((xs[k] - xs[0]) % t.view.blit.sc, 0, 'step ' + k);
  const r = crispView(1440, 900, 2, true);
  r.view.cam = { x: 300, y: 500, zi: 3 };
  r.view.moveTo({ x: 0, y: 232, zi: 3 });
  assert.deepEqual(r.view.cam, { x: 0, y: 232, zi: 3 }, 'reduced motion: no glide');
});

test('crisp: the screen\'s own pixel ratio, also below 1 and after a change; never under one device pixel per art pixel', () => {
  assert.equal(deviceRatio(0.9), 0.9, 'a page zoomed out on a 1× screen is drawn at 0.9, not stretched from 1');
  assert.equal(deviceRatio(5), 3);
  assert.equal(deviceRatio(Number.NaN), 1);
  for (const dpr of RATIOS) for (let zi = minZoom({ w: 1440, h: 900, dpr }); zi <= 5; zi++) assert.ok(scaleOf({ x: 0, y: 0, zi }, { w: 1440, h: 900, dpr }) >= 1, `dpr ${dpr} level ${zi}`);
  // Moving the window from a 2× to a 0.9× screen at the outermost level steps in to keep whole pixels.
  const t = crispView(1440, 900, 2);
  t.view.cam = { x: 0, y: 232, zi: minZoom(t.view.vp) };
  t.view.resize(1440, 900, 0.9);
  t.dpr = 0.9;
  assert.ok(t.view.cam.zi >= minZoom(t.view.vp));
  t.view.paint(0);
  assertCrisp(t, 'after the ratio changed');
});

test('scene: a session whose main turn ended while its subagent works is drawn running, as it is counted (#27)', async () => {
  const { runningRoots } = await import('@dsh-universe/model');
  const ev: UEvent[] = [
    { type: 'workspace', data: { id: 'w1', title: 'Finance', displayPath: 'fin' } },
    { type: 'agent', data: { id: 'a', sessionId: 'a', workspaceId: 'w1', label: 'x', kind: 'main', state: 'running', startedAt: at(9) } },
    { type: 'turn', data: { t: at(9), agentId: 'a', phase: 'start' } },
    { type: 'turn', data: { t: at(9, 5), agentId: 'a', phase: 'end', reason: 'completed' } },
    { type: 'agent', data: { id: 'k', sessionId: 'a', parentAgentId: 'a', workspaceId: 'w1', label: 'y', kind: 'subagent', state: 'running', startedAt: at(9, 1) } },
    { type: 'turn', data: { t: at(9, 1), agentId: 'k', phase: 'start' } },
  ];
  const inp = input(ev, at(9, 10));
  assert.ok(runningRoots(inp.store, at(9, 10)).has('a'));
  const b = buildScene(inp).places.find((p) => p.sessionId === 'a');
  assert.equal(b?.state, 'running');
  assert.equal(b?.building?.state, 'running');
});
