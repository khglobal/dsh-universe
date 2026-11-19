// The adjacent cities end to end on the host and in the page: fixture Claude Code and Codex stores with a marker in
// every content field; nothing is read before a city is asked for; shown by default with no click; what was read is
// kept across restarts; no marker reaches the routes, the plugin's storage or the rendered DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createStore, historyWindow } from '@dsh-universe/model';
import { createHandler, memoryKv } from '@dsh-universe/adapter-dsh';
import { MARKERS, CUSTOM_TITLE, seedLocalStores } from '../../fixtures/local-stores.ts';
import { createNeighbours, indexKey } from '../src/neighbours.ts';
import { DEFAULT_PREFS, neighbourOn, readPrefs } from '../src/client/prefs.ts';
import { createFeed, fixtureApi } from '../src/client/feed.ts';
import { fill } from '../src/client/format.ts';
import { places, sections, todayButtons, withLocal } from '../src/client/view.ts';
import { todayAt } from '@dsh-universe/model';
import { en } from '../src/locales/en.ts';
import { zh } from '../src/locales/zh.ts';
import { loadClient } from './bundle.ts';

const noon = () => { const d = new Date(); d.setHours(12, 0, 0, 0); return d.getTime(); };
const rpc = async (h: (r: Request) => Promise<Response>, method: string, payload: unknown) => {
  const res = await h(new Request('http://x/api', { method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 1, payload: { method, payload } }) }));
  return (await res.json()).result;
};

test('neighbours: detection only looks for the folders; a device without them (a cloud workspace) finds nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshu-nb0-'));
  try {
    const nb = createNeighbours({ places: memoryKv(), home });
    const h = createHandler({ snapshot: () => { throw new Error('x'); }, since: () => { throw new Error('x'); }, neighbours: nb });
    assert.deepEqual((await rpc(h, 'n.detect', {})).value, [{ id: 'claude-code', present: false }, { id: 'codex', present: false }]);
    assert.deepEqual(await rpc(h, 'n.snapshot', { id: 'other' }), { ok: false, reason: 'invalid' });
    await nb.dispose();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('neighbours: the routes serve each city with its own placement; no content leaves the host', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshu-nb1-'));
  const now = noon();
  seedLocalStores(home, now);
  const places = memoryKv();
  const nb = createNeighbours({ places, home, now: () => now });
  try {
    const h = createHandler({ snapshot: () => { throw new Error('x'); }, since: () => { throw new Error('x'); }, neighbours: nb });
    assert.deepEqual((await rpc(h, 'n.detect', {})).value.map((x: { present: boolean }) => x.present), [true, true]);
    for (const id of ['claude-code', 'codex']) {
      let snap = (await rpc(h, 'n.snapshot', { id })).value;
      for (let i = 0; i < 50 && snap.backfill === 'pending'; i++) { await new Promise((r) => setTimeout(r, 50)); snap = (await rpc(h, 'n.snapshot', { id })).value; }
      assert.equal(snap.platform.id, id);
      assert.equal(snap.backfill, 'done');
      assert.ok(snap.events.length > 10);
      const roots = snap.events.filter((x: { e: { type: string; data: { parentAgentId?: string } } }) => x.e.type === 'agent' && !x.e.data.parentAgentId && 'startedAt' in x.e.data);
      assert.ok(Object.keys(snap.placement.lots).length >= roots.length && roots.length > 0, 'every session has a lot');
      const since = (await rpc(h, 'n.since', { id, seq: 3, placementVersion: snap.placementVersion })).value;
      assert.equal(since.events[0].seq, 4);
      const wire = JSON.stringify([snap, since]);
      for (const m of MARKERS) assert.ok(!wire.includes(m), `${id}: ${m}`);
      assert.ok(!wire.includes('/work/'), 'no paths');
    }
    assert.deepEqual((await rpc(h, 'n.stop', { id: 'codex' })).value, true);
    assert.ok(places.data.has('placement:codex'), 'a city turned off keeps its lots for next time');
    assert.ok(!places.data.has('placement'), "the DSH city's placement is untouched");
  } finally { await nb.dispose(); rmSync(home, { recursive: true, force: true }); }
});

test('neighbours: the rendered cities and list show engines and the set title, never a marker', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshu-nb2-'));
  const now = noon();
  seedLocalStores(home, now);
  const nb = createNeighbours({ places: memoryKv(), home, now: () => now });
  const { Region, ListView } = await loadClient<{ Region: (p: unknown) => unknown; ListView: (p: unknown) => unknown }>('tests/nb-entry.ts');
  try {
    for (const [lang, table] of [['en', en], ['zh-CN', zh]] as const) {
      const t = (k: string, p?: Record<string, string | number>) => fill((table as Record<string, string>)[k] ?? k, p);
      const feeds = [];
      let html = '';
      for (const id of ['claude-code', 'codex'] as const) {
        let snap = await nb.snapshot(id);
        for (let i = 0; i < 50 && snap.backfill === 'pending'; i++) { await new Promise((r) => setTimeout(r, 50)); snap = await nb.snapshot(id); }
        const feed = createFeed(fixtureApi({ platform: snap.platform, day: snap.day, events: snap.events.map((x) => x.e), placement: snap.placement, history: snap.history }));
        await new Promise<void>((ok) => { const off = feed.subscribe(() => { if (feed.get().phase === 'ready') { off(); ok(); } }); });
        feeds.push({ id, feed });
        const store = createStore(); store.applyAll(snap.events.map((x) => x.e));
        html += renderToString(createElement(ListView as never, { t, lang, T: now, sections: sections(store, now, t, lang, {}), places: places(store, now, t, lang, snap.platform.caps), schedules: null, plugins: undefined, days: historyWindow(snap.history, store, now), onSeen: () => {} } as never));
      }
      html += renderToString(createElement(Region as never, { cities: feeds, active: 'claude-code', t, lang, now, dark: false, onEnter: () => {}, onClose: () => {} } as never));
      for (const m of MARKERS) assert.ok(!html.includes(m), `${lang}: ${m} in the DOM`);
      assert.ok(!html.includes('/work/'));
      assert.ok(html.includes(CUSTOM_TITLE), 'the title the member set is shown');
      assert.ok(html.includes('Claude Code') && html.includes('Codex'), 'each city has its sign');
      assert.ok(html.includes('demo-app'), 'untitled sessions are named by their folder');
      for (const f of feeds) f.feed.dispose();
    }
  } finally { await nb.dispose(); rmSync(home, { recursive: true, force: true }); }
});

test('delegated runs: a Claude Code or Codex run inside DSH is named after its engine, never its task', async () => {
  const { rowOf } = await import('../src/client/view.ts');
  const t = (k: string, p?: Record<string, string | number>) => fill((en as Record<string, string>)[k] ?? k, p);
  const T0 = noon() - 3600_000;
  const st = createStore();
  st.applyAll([
    { type: 'agent', data: { id: 'p', sessionId: 'p', workspaceId: 'w', label: 'Parent', kind: 'main', state: 'running', startedAt: T0 } },
    { type: 'agent', data: { id: 'cc', sessionId: 'cc', parentAgentId: 'p', workspaceId: 'w', label: '', kind: 'subagent', engine: 'claude-code', state: 'running', startedAt: T0 + 60_000 } },
    { type: 'agent', data: { id: 'cx', sessionId: 'cx', parentAgentId: 'p', workspaceId: 'w', label: '', kind: 'subagent', engine: 'codex', state: 'running', startedAt: T0 + 120_000, endedAt: T0 + 600_000 } },
    { type: 'agent', data: { id: 'cx', state: 'failed' } as never },
  ]);
  const cc = rowOf(st.agent('cc')!, st, T0 + 300_000, t, 'en', { cc: 'LEAKMARK-task' }, false);
  assert.equal(cc.title, 'Claude Code');
  assert.equal(cc.tokens, 'token use not reported');
  assert.equal(cc.state, 'running');
  const cx = rowOf(st.agent('cx')!, st, T0 + 900_000, t, 'en', {}, false);
  assert.equal(cx.title, 'Codex');
  assert.equal(cx.state, 'failed');
});

test('neighbours: on by default with no click; the figures are read and no marker reaches the routes or storage', async () => {
  // A member who never chose anything (and one who answered the old hint with "Not now") on this device.
  assert.ok(neighbourOn(DEFAULT_PREFS, 'claude-code') && neighbourOn(DEFAULT_PREFS, 'codex'), 'on with no click');
  const declined = readPrefs({ getItem: () => JSON.stringify({ neighbours: { codex: false } }) });
  assert.ok(neighbourOn(declined, 'claude-code') && !neighbourOn(declined, 'codex'), 'a city turned off stays off');
  const home = mkdtempSync(join(tmpdir(), 'dshu-nb3-'));
  const now = noon();
  seedLocalStores(home, now);
  const store = memoryKv();
  const nb = createNeighbours({ places: store, home, now: () => now, saveMs: 50 });
  try {
    const h = createHandler({ snapshot: () => { throw new Error('x'); }, since: () => { throw new Error('x'); }, neighbours: nb });
    const ids = (await rpc(h, 'n.detect', {})).value.filter((x: { present: boolean }) => x.present).map((x: { id: string }) => x.id).filter((id: 'claude-code' | 'codex') => neighbourOn(DEFAULT_PREFS, id));
    assert.deepEqual(ids, ['claude-code', 'codex']);
    let sum = (await rpc(h, 'n.summary', { ids })).value;
    for (let i = 0; i < 100 && !sum.every((x: { ready: boolean }) => x.ready); i++) { await new Promise((r) => setTimeout(r, 50)); sum = (await rpc(h, 'n.summary', { ids })).value; }
    assert.deepEqual(sum.map((x: { id: string }) => x.id), ['claude-code', 'codex']);
    for (const x of sum) assert.ok(x.ready && x.tokens > 0 && x.running + x.errors >= 0, JSON.stringify(x));
    assert.deepEqual(await rpc(h, 'n.summary', { ids: ['other'] }), { ok: false, reason: 'invalid' });
    // What was read is kept on this device (for the next start): hashes, offsets, counts, never content or a path.
    for (let i = 0; i < 100 && !(store.data.has(indexKey('claude-code')) && store.data.has(indexKey('codex'))); i++) await new Promise((r) => setTimeout(r, 50));
    assert.ok(store.data.has(indexKey('claude-code')) && store.data.has(indexKey('codex')), 'the reading is kept');
    const kept = JSON.stringify([...store.data]);
    const wire = JSON.stringify(sum);
    for (const m of MARKERS) { assert.ok(!kept.includes(m), `storage: ${m}`); assert.ok(!wire.includes(m), `wire: ${m}`); }
    assert.ok(!kept.includes('/work/') && !kept.includes(home), 'no paths in storage');
  } finally { await nb.dispose(); rmSync(home, { recursive: true, force: true }); }
});

test('neighbours: after a restart the kept reading is taken up; turning a city off drops it', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dshu-nb4-'));
  const now = noon();
  seedLocalStores(home, now);
  const store = memoryKv();
  try {
    const first = createNeighbours({ places: store, home, now: () => now });
    let snap = await first.snapshot('claude-code');
    for (let i = 0; i < 50 && snap.backfill === 'pending'; i++) { await new Promise((r) => setTimeout(r, 50)); snap = await first.snapshot('claude-code'); }
    await first.dispose();
    assert.ok(store.data.has(indexKey('claude-code')), 'kept when DSH stops');
    // The next start: the same city at once, from what was kept.
    const second = createNeighbours({ places: store, home, now: () => now });
    const again = await second.snapshot('claude-code');
    assert.equal(again.events.length, snap.events.length);
    assert.deepEqual(again.events.map((x) => x.e), snap.events.map((x) => x.e));
    assert.deepEqual(again.history, snap.history);
    await second.stop('claude-code');
    assert.ok(![...store.data.keys()].some((k) => k.startsWith('index:claude-code')), 'turned off: what was read is dropped');
    assert.ok(store.data.has('placement:claude-code'), 'its lots are kept for next time');
    await second.dispose();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('figures: local sessions are added to running, errors and tokens with their source, never into DSH\'s own', () => {
  const t = (k: string, p?: Record<string, string | number>) => fill((en as Record<string, string>)[k] ?? k, p);
  const st = createStore();
  const T0 = noon() - 3600_000;
  st.applyAll([{ type: 'agent', data: { id: 'a', sessionId: 'a', workspaceId: 'w', label: '', kind: 'main', state: 'running', startedAt: T0 } }]);
  const today = todayAt(st, noon(), 'dsh');
  const plain = todayButtons(today, noon(), t, 'en');
  const local = [{ id: 'claude-code', running: 2, errors: 3, tokens: 12_000 }, { id: 'codex', running: 1, errors: 0, tokens: 0 }];
  const b = withLocal(plain, today, local, t, 'en');
  const run = b.find((x) => x.cat === 'run')!, err = b.find((x) => x.cat === 'err')!, tok = b.find((x) => x.cat === 'tok')!;
  assert.equal(run.text, '1 session running +3 local');
  assert.equal(run.count, 4);
  assert.match(run.title!, /^4 in all: DSH 1 · Claude Code 2 · Codex 1\./);
  assert.equal(err.text, '0 failed calls +3 local');
  assert.match(err.title!, /DSH 0 · Claude Code 3\./, 'a source with nothing is left out');
  assert.match(tok.title!, /Claude Code 12K/);
  assert.deepEqual(b.filter((x) => !['run', 'err', 'tok'].includes(x.cat)), plain.filter((x) => !['run', 'err', 'tok'].includes(x.cat)));
  assert.deepEqual(withLocal(plain, today, [], t, 'en'), plain, 'no local sessions: unchanged');
});
