import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '@dsh-universe/model';
import { ROOMS } from '@dsh-universe/art';
import { interiorOf } from '@dsh-universe/renderer';
import { dshSample } from '../../fixtures/dsh-sample.ts';
import { zh } from '../src/locales/zh.ts';
import { en } from '../src/locales/en.ts';
import { fill } from '../src/client/format.ts';
import { floorLabel, floorValue, interiorMatches } from '../src/client/interior-text.ts';

const fx = dshSample(new Date(2026, 10, 18).getTime());
const tz = (k: string, p?: Record<string, string | number>) => fill((zh as Record<string, string>)[k] ?? k, p);
const te = (k: string, p?: Record<string, string | number>) => fill((en as Record<string, string>)[k] ?? k, p);

test('inside view: every building with floors has one; plugin shops do not', () => {
  for (const id of ['b:s1', 'town', 'station', 'school', 'library', 'fire', 'conn:erp', 'model:deepseek-v4']) assert.ok(interiorMatches(id), id);
  assert.equal(interiorMatches('shop:pdf-tools'), false);
});

test('every room template has a name in both languages', () => {
  for (const r of ROOMS) {
    assert.ok((zh as Record<string, string>)['rm.' + r.id], 'zh rm.' + r.id);
    assert.ok((en as Record<string, string>)['rm.' + r.id], 'en rm.' + r.id);
  }
});

test('on the sample day: every building opens, floors are named "meaning · room", no room twice in a building', () => {
  const store = createStore(); store.applyAll(fx.events);
  const roots = store.agents().filter((s) => !s.agent.parentAgentId && s.agent.startedAt <= fx.now);
  assert.ok(roots.length >= 10);
  for (const s of roots) {
    const it = interiorOf({ store, placement: fx.placement!, T: fx.now, placeId: 'b:' + s.agent.sessionId, catalog: ROOMS, caps: fx.platform.caps });
    const rooms = it.floors.filter((f) => f.template).map((f) => f.room);
    assert.equal(new Set(rooms).size, rooms.length, s.agent.sessionId);
    for (const f of it.floors) {
      const zl = floorLabel(f, tz), el = floorLabel(f, te);
      assert.ok(!zl.includes('fl.') && !zl.includes('rm.'), zl);
      assert.ok(!el.includes('fl.') && !el.includes('rm.'), el);
      if (f.template) assert.match(zl, / · /);
      assert.ok(floorValue(f, tz, 'zh-CN').length > 0);
    }
    // No title reaches the inside: floors and people carry ids, counts and tool names only.
    assert.ok(!JSON.stringify(it).includes(s.agent.label));
  }
  // Public places too.
  for (const id of ['town', 'station', 'school', 'library', 'fire', 'conn:erp']) {
    const it = interiorOf({ store, placement: fx.placement!, T: fx.now, placeId: id, catalog: ROOMS, caps: fx.platform.caps });
    assert.ok(it.floors.length >= 1, id);
    for (const f of it.floors) assert.ok(!floorLabel(f, tz).includes('fl.'), id + ' ' + f.id);
  }
});

test('the inside view writes no interface text of its own', () => {
  const src = readFileSync(new URL('../src/client/Interior.tsx', import.meta.url), 'utf8');
  assert.ok(!/[一-鿿]/.test(src));
});

test('a room named like its floor is named once (not "X · X")', () => {
  const f = { id: 'machine', template: true, room: 'servers' } as never;
  assert.equal(floorLabel(f, tz), '机房');
  assert.equal(floorLabel({ id: 'library', template: true, room: 'market' } as never, tz), '图书室 · 行情台');
});

test('data prop cards and the room summary: the same numbers the props draw, metadata only', async () => {
  const { propLines, roomSummary } = await import('../src/client/interior-text.ts');
  const store = createStore(); store.applyAll(fx.events);
  const it = interiorOf({ store, placement: fx.placement!, T: fx.now, placeId: 'b:s7', catalog: ROOMS, caps: fx.platform.caps });
  const lib = it.floors.find((f) => f.id === 'library')!;
  assert.ok(lib.calls.length > 0 && lib.calls.length <= 8);
  assert.ok(lib.calls.every((c, i) => i === 0 || c.t <= lib.calls[i - 1].t), 'newest first');
  const tape = propLines('tape', lib, tz, 'zh-CN');
  assert.equal(tape.length, lib.calls.length);
  assert.match(tape[0], /^\d\d:\d\d · \S+ · (成功|失败)$/);
  assert.ok(propLines('beacon', lib, tz, 'zh-CN')[0].length > 0);
  assert.match(propLines('printers', lib, tz, 'zh-CN')[0], /后台任务在跑/);
  assert.match(propLines('whiteboard', lib, tz, 'zh-CN')[0], /白板上 \d 行/);
  assert.match(roomSummary(lib, tz), /^图书室 · \S+ · \d+ 个智能体在干活 · 最近一分钟 \d+ 次出错$/);
  const s7 = store.agents().find((s) => s.agent.sessionId === 's7')!;
  for (const id of ['tape', 'board', 'beacon', 'printers', 'whiteboard'] as const) assert.ok(!propLines(id, lib, tz, 'zh-CN').join().includes(s7.agent.label), 'no titles');
});

test('every data prop in every room kind has a name and a card with its numbers (halls and public floors too)', async () => {
  const { PROP_IDS, propLines } = await import('../src/client/interior-text.ts');
  const { createArtKit } = await import('@dsh-universe/art');
  const kit = createArtKit();
  for (const id of PROP_IDS) { assert.ok((zh as Record<string, string>)['in.prop.' + id], 'zh ' + id); assert.ok((en as Record<string, string>)['in.prop.' + id], 'en ' + id); }
  const store = createStore(); store.applyAll(fx.events);
  const places = ['b:s7', 'town', 'station', 'school', 'library', 'fire', 'conn:erp', 'model:deepseek-v4-pro'];
  const seen = new Set<string>();
  for (const placeId of places) {
    const it = interiorOf({ store, placement: fx.placement!, T: fx.now, placeId, catalog: ROOMS, caps: fx.platform.caps });
    for (const f of it.floors) for (const p of kit.roomLayout(f.room).props ?? []) {
      seen.add(p.id);
      const lines = propLines(p.id as never, f, tz, 'zh-CN', { rate: 1200 });
      assert.ok(lines.length > 0 && lines.every((l) => l.length > 0 && !l.includes('in.')), placeId + ' ' + f.id + ' ' + p.id + ' ' + lines);
    }
  }
  for (const id of ['tape', 'crates', 'reception', 'racks', 'solar', 'menu', 'departures', 'webtally', 'turnstiles', 'blackboard', 'portraits', 'books', 'cartridges', 'load', 'meter', 'dial', 'repairlog', 'engine']) assert.ok(seen.has(id), 'reachable: ' + id);
});

test('a subagent is never named by its session title (DSH titles it with its prompt): preset name, else "subagent n"', async () => {
  const { rowOf, sections } = await import('../src/client/view.ts');
  const store = createStore(); store.applyAll(fx.events);
  const subs = store.agents().filter((s) => s.agent.parentAgentId);
  assert.ok(subs.length >= 2);
  const secret = '核对资质条款 #run:read,grep 把第三章逐条对照';
  const titles: Record<string, string> = {};
  for (const s of subs) titles[s.agent.sessionId] = secret;
  for (const s of subs) {
    const r = rowOf(s, store, fx.now, tz, 'zh-CN', titles, false);
    assert.ok(!r.title.includes('核对资质条款') && !r.title.includes('#run'), r.title);
    assert.ok(s.agent.role ? r.title === s.agent.role : /^子智能体 \d+$/.test(r.title), r.title);
  }
  const all = JSON.stringify(sections(store, fx.now, tz, 'zh-CN', titles));
  assert.ok(!all.includes('核对资质条款'), 'not in the list either');
});

test('the first-use workspace is named the way DSH names it (Default workspace)', async () => {
  const { workspaceName } = await import('@dsh-universe/model');
  assert.equal(workspaceName('default-workspace', tz('ws.default')), '默认工作区');
  assert.equal(workspaceName('default-workspace', te('ws.default')), 'Default workspace');
  assert.equal(workspaceName('财务对账', '默认工作区'), '财务对账');
});

test('floor size follows the building on the sample day; the floor card says so (in both languages) only for smaller floors', async () => {
  const { createArtKit } = await import('@dsh-universe/art');
  const kit = createArtKit();
  const store = createStore(); store.applyAll(fx.events);
  const tiers = new Set<string>();
  for (const s of store.agents().filter((a) => !a.agent.parentAgentId && a.agent.startedAt <= fx.now)) {
    const it = interiorOf({ store, placement: fx.placement!, T: fx.now, placeId: 'b:' + s.agent.sessionId, catalog: ROOMS, caps: fx.platform.caps, templateTags: kit.buildingTags, roomTier: kit.roomTier });
    tiers.add(it.tier);
  }
  assert.deepEqual([...tiers].sort(), ['large', 'medium', 'small'], 'the sample city has buildings of every size');
  for (const k of ['in.size.small', 'in.size.medium']) { assert.ok((zh as Record<string, string>)[k]); assert.ok((en as Record<string, string>)[k]); }
  assert.ok(!(zh as Record<string, string>)['in.size.large'], 'nothing is said about full-size floors');
  const src = readFileSync(new URL('../src/client/Interior.tsx', import.meta.url), 'utf8');
  assert.match(src, /templateTags: kit\.buildingTags, roomTier: kit\.roomTier/, 'the panel sizes floors with the kit\'s rule');
});
