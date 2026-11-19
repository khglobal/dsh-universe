import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { conformanceProblems } from '@dsh-universe/adapter-kit';
import { createStore, createSeen } from '@dsh-universe/model';
import { dshSample } from '../../fixtures/dsh-sample.ts';
import { zh } from '../src/locales/zh.ts';
import { en } from '../src/locales/en.ts';
import { createFeed, fixtureApi } from '../src/client/feed.ts';
import { fill } from '../src/client/format.ts';
import { CITY, headline, places, sections, todayAt, todayButtons } from '../src/client/view.ts';
import type { Api } from '../src/client/api.ts';

const fx = dshSample(new Date(2026, 10, 18).getTime());   // local midnight: the sample's times are local clock times
const t = (k: string, p?: Record<string, string | number>) => fill((zh as Record<string, string>)[k] ?? k, p);
const store = () => { const s = createStore(); s.applyAll(fx.events); return s; };

test('fixture: the sample day is model events only, deterministic', () => {
  assert.deepEqual(conformanceProblems(fx.events, []), []);
  assert.deepEqual(dshSample(0).events, dshSample(0).events);
  assert.ok(fx.events.filter((e) => e.type === 'agent').length >= 30);
});

test('fixture: the English sample day is the same day with English titles, on the same room themes', () => {
  const zhDay = dshSample(0, 'zh'), enDay = dshSample(0, 'en');
  const strip = (f: typeof zhDay) => f.events.map((e) => JSON.stringify(e.type === 'agent' ? { ...e.data, label: '' } : e.type === 'workspace' || e.type === 'schedule' ? { ...e.data, title: '' } : e.data));
  assert.deepEqual(strip(enDay), strip(zhDay));
  assert.deepEqual(enDay.placement, zhDay.placement);
  const texts = enDay.events.flatMap((e) => (e.type === 'agent' ? [e.data.label] : e.type === 'workspace' || e.type === 'schedule' ? [e.data.title] : []));
  for (const x of texts) assert.ok(x && !/[\u3400-\u9fff]/.test(x), `not English: ${x}`);
  assert.equal(new Set(Object.values(enDay.placement?.themes ?? {})).size >= 8, true);
});

test('today bar and headline on the sample day', () => {
  const s = store();
  const today = todayAt(s, fx.now, CITY);
  assert.equal(today.need, 2, 'the approval in finance and the failed run within 90 minutes');
  assert.equal(today.next?.scheduleId, 'a3');
  assert.ok(today.running >= 4);
  const b = todayButtons(today, fx.now, t, 'zh-CN');
  assert.deepEqual(b.map((x) => x.cat), ['need', 'sched', 'run', 'review', 'err', 'tok']);
  assert.equal(b[0].amber, true);
  assert.ok(b.slice(1).every((x) => !x.amber));
  assert.match(b[1].text, /15:45/);
  assert.match(headline(s, fx.now, t), /\d/);
  assert.ok(!b.some((x) => x.text.includes('{')), 'every placeholder filled');
});

test('list: needs-you first; subagents follow their parent; titles fall back to folder · short id', () => {
  const s = store();
  const secs = sections(s, fx.now, t, 'zh-CN', {});
  assert.equal(secs[0].id, 'need');
  const run = secs.find((x) => x.id === 'running')!.rows.map((r) => r.id);
  const i7 = run.indexOf('s7');
  assert.ok(i7 >= 0 && run[i7 + 1] && ['s7b', 's7c'].includes(run[i7 + 1]));
  s.apply({ type: 'agent', data: { id: 'nolabel1234', sessionId: 'nolabel1234', workspaceId: 'fin', label: '', kind: 'main', state: 'running', startedAt: fx.now - 1000 } });
  const row = sections(s, fx.now, t, 'zh-CN', {}).find((x) => x.id === 'running')!.rows.find((r) => r.id === 'nolabel1234')!;
  assert.equal(row.title, 'finance · nola');
  assert.equal(sections(s, fx.now, t, 'zh-CN', { nolabel1234: 'From the session list' }).find((x) => x.id === 'running')!.rows.find((r) => r.id === 'nolabel1234')!.title, 'From the session list');
});

test('list: marking seen removes a result from review', () => {
  const s = store();
  const seen = createSeen();
  const before = sections(s, fx.now, t, 'zh-CN', {}, seen).find((x) => x.id === 'review')!.rows;
  assert.ok(before.length > 0);
  const id = before[0].id;
  seen.mark(`${CITY}:${id}:${s.agent(id)!.ev.length}`);
  assert.equal(sections(s, fx.now, t, 'zh-CN', {}, seen).find((x) => x.id === 'review')!.rows.length, before.length - 1);
});

test('places: the civic baseline is always listed, also on an empty day; missing data says not provided', () => {
  const caps = fx.platform.caps;
  const empty = places(createStore(), fx.now, t, 'zh-CN', caps).map((p) => p.id);
  assert.deepEqual(empty, ['town', 'station', 'school', 'library', 'fire']);
  const lib = places(createStore(), fx.now, t, 'zh-CN', caps).find((p) => p.id === 'library')!;
  assert.match(lib.floors, new RegExp(zh.na));
});

test('feed: snapshot, then increments; an unreadable host is an error, retry recovers', async () => {
  let fail = false, extra = 0;
  const base = fixtureApi(fx);
  const api: Api = {
    snapshot: async () => (fail ? { ok: false, reason: 'unavailable' } : base.snapshot()),
    since: async (seq) => ({ ok: true, value: { day: fx.day, seq: seq + extra, events: extra ? [{ seq: seq + 1, e: { type: 'agent', data: { id: 'late', sessionId: 'late', workspaceId: 'fin', label: 'x', kind: 'main', state: 'running', startedAt: fx.now } } }] : [], more: false, placementVersion: 0 } }),
  };
  const feed = createFeed(api, { intervalMs: 5 });
  const changes: string[] = [];
  const off = feed.subscribe(() => changes.push(feed.get().phase));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(feed.get().phase, 'ready');
  extra = 1;
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(feed.get().store.agent('late'));
  off();
  fail = true;
  feed.retry();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(feed.get().phase, 'error');
  fail = false;
  feed.retry();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(feed.get().phase, 'ready');
  feed.dispose();
});

test('locale: every key the code uses exists in both tables', () => {
  const dir = new URL('../src/', import.meta.url).pathname;
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
  const used = new Set<string>();
  for (const f of walk(dir)) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('([a-zA-Z]+(?:\.[a-zA-Z]+)*)'/g)) used.add(m[1]);
  assert.ok(used.size > 30);
  for (const k of used) { assert.ok(k in zh, 'zh ' + k); assert.ok(k in en, 'en ' + k); }
  for (const st of ['running', 'waiting', 'idle', 'done', 'failed', 'future']) assert.ok('st.' + st in zh);
  assert.ok(!Object.values(zh).some((v) => v.includes('令牌')));
});

test('drafts service: optional; missing or failing reads as no drafts; a present draft marks the row', async () => {
  const { draftsOf } = await import('../src/client/drafts.ts');
  assert.equal(draftsOf(() => undefined).getSnapshot().has('s1'), false);
  assert.doesNotThrow(() => draftsOf(() => undefined).subscribe(() => {})());
  const boom = draftsOf(() => ({ has() { throw new Error('gone'); }, subscribe() { throw new Error('gone'); } }));
  assert.equal(boom.getSnapshot().has('s1'), false);
  assert.doesNotThrow(() => boom.subscribe(() => {})());
  let notify = () => {};
  const live = draftsOf(() => ({ has: (id: string) => id === 's10', subscribe: (fn: () => void) => { notify = fn; return () => {}; } }));
  let calls = 0;
  live.subscribe(() => { calls++; });
  const before = live.getSnapshot();
  notify();
  assert.equal(calls, 1);
  assert.notEqual(live.getSnapshot(), before, 'a new snapshot so the panel re-renders');
  const secs = sections(store(), fx.now, t, 'zh-CN', {}, createSeen(), live.getSnapshot());
  const row = secs.find((x) => x.id === 'review')!.rows.find((r) => r.id === 's10')!;
  assert.match(row.detail, /有草稿/);
});

test('drafts service: read through ctx.reflect.get by its documented name; missing reflect or service is fine', async () => {
  const { DRAFTS_SERVICE, reflected } = await import('../src/client/drafts.ts');
  assert.equal(DRAFTS_SERVICE, 'workdshSessionDrafts');
  const svc = { has: () => true };
  assert.equal(reflected({ reflect: { get: (n: string) => (n === DRAFTS_SERVICE ? svc : undefined) }, get: () => undefined } as never, DRAFTS_SERVICE), svc);
  assert.equal(reflected({ reflect: { get: () => { throw new Error('none'); } }, get: () => undefined } as never, DRAFTS_SERVICE), undefined);
  assert.equal(reflected({ get: () => { throw new Error('not injected'); } } as never, DRAFTS_SERVICE), undefined, 'no reflect, no service: no error');
});

test('today bar: a host without scheduled tasks says so instead of "none left today"', () => {
  const s = store();
  const b = todayButtons(todayAt(s, fx.now, CITY), fx.now, t, 'zh-CN', { schedules: false });
  assert.equal(b[1].text, (zh as Record<string, string>)['td.schedNa']);
});

test('layer summaries for screen readers: one sentence of counts per data view, no titles; none for "Everything"', async () => {
  const { layerSummary } = await import('../src/client/view.ts');
  const { LAYERS, todayAt: today, metricsAt } = await import('@dsh-universe/model');
  const s = store();
  assert.equal(layerSummary('all', s, fx.now, t, 'zh-CN'), '');
  const titles = fx.events.flatMap((e) => (e.type === 'agent' && e.data.label ? [e.data.label] : []));
  for (const l of LAYERS.filter((x) => x !== 'all')) {
    const text = layerSummary(l, s, fx.now, t, 'zh-CN');
    assert.ok(text.length > 4 && !text.includes('{'), l + ': ' + text);
    assert.ok(!titles.some((x) => text.includes(x)), 'no session titles');
  }
  assert.ok(layerSummary('review', s, fx.now, t, 'zh-CN').includes(String(today(s, fx.now, CITY).review)));
  assert.ok(layerSummary('calls', s, fx.now, t, 'zh-CN').includes(String(metricsAt(s, fx.now).cars)));
});

test('English counts take the singular at 1 (`{n:one|other}`); Chinese never needs it', async () => {
  const { fill } = await import('../src/client/format.ts');
  const { en, zh } = await import('../src/locales/index.ts');
  assert.equal(fill(en['td.err'], { n: 1 }), '1 failed call');
  assert.equal(fill(en['td.err'], { n: 30 }), '30 failed calls');
  assert.equal(fill(en['h.rw'], { r: 1, w: 2 }), '1 agent is working, 2 waiting for you in Review Square.');
  for (const v of Object.values(zh)) assert.ok(!/\{\w+:/.test(v), v);
});

test('durations: whole hours drop the zero part ("1 h", not "1 h 0 min")', async () => {
  const { duration } = await import('../src/client/format.ts');
  const { en } = await import('../src/locales/en.ts');
  const tr = (table: Record<string, string>) => (k: string, v: Record<string, unknown> = {}) => (table[k] ?? k).replace(/\{(\w+)\}/g, (_m, n) => String(v[n]));
  assert.equal(duration(3600_000, tr(zh)), '1 小时');
  assert.equal(duration(3600_000 + 5 * 60_000, tr(zh)), '1 小时 5 分');
  assert.equal(duration(2 * 3600_000, tr(en)), '2 h');
});

test('a change of device pixel ratio refits the canvas (window moved between a Retina and a 1× screen), every time', async () => {
  const { onRatioChange } = await import('../src/client/hooks.ts');
  const queries: string[] = [];
  let listener: (() => void) | undefined, resize: (() => void) | undefined;
  const env = {
    devicePixelRatio: 1,
    matchMedia: (q: string) => { queries.push(q); return { addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: () => { listener = undefined; } } as unknown as MediaQueryList; },
    addEventListener: (_: 'resize', fn: () => void) => { resize = fn; }, removeEventListener: () => { resize = undefined; },
  };
  let fits = 0;
  const stop = onRatioChange(() => { fits++; }, env, 0);
  assert.deepEqual(queries, ['(resolution: 1dppx)']);
  env.devicePixelRatio = 2; listener!();
  assert.equal(fits, 1);
  assert.equal(queries.at(-1), '(resolution: 2dppx)', 're-armed at the new ratio');
  resize!();
  assert.equal(fits, 1, 'the same ratio again is no change');
  env.devicePixelRatio = 1; resize!();
  assert.equal(fits, 2, 'heard from the window resize too');
  stop();
  assert.equal(listener, undefined, 'stopped');
  assert.equal(resize, undefined);
});

test('timeline time zone: the host clock and a label when it is not the viewer zone (#21)', async () => {
  const { clock, utcSuffix, foreignOffset } = await import('../src/client/format.ts');
  const t = Date.UTC(2026, 10, 18, 17, 30);
  assert.equal(clock(t, 'en-GB', 480), '01:30');
  assert.equal(clock(t, 'en-GB', -480), '09:30');
  assert.equal(clock(t, 'en-GB', 0), '17:30');
  assert.equal(utcSuffix(480), '+8');
  assert.equal(utcSuffix(-420), '-7');
  assert.equal(utcSuffix(330), '+5:30');
  assert.equal(utcSuffix(0), '');
  assert.equal(foreignOffset(480, t, 480), undefined, 'same zone: no label');
  assert.equal(foreignOffset(480, t, -480), 480);
  assert.equal(foreignOffset(undefined, t, -480), undefined, 'an older host: the viewer zone, no label');
  assert.equal(fill(en['tl.tz'], { o: utcSuffix(480) }), 'UTC+8');
  assert.equal(fill(zh['tl.tz'], { o: utcSuffix(480) }), 'UTC+8');
});
