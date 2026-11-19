// The local-store reader at scale: thousands of files and one large file must not hold the event loop, a large
// file is entered at today's first line (earlier days are not read), and appended lines are read once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalAdapter, createLocalCity, isoTimeOf, listFiles, pack, readCheckpoint, readNext, unpack, type StoreReader } from '../src/local/index.ts';

const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function counter(root: string) {
  const seen = { lines: 0, today: 0, heads: 0, tails: 0 };
  const reader: StoreReader<{ n: number }> = {
    list: (since, tick) => listFiles(root, (rel) => rel.endsWith('.jsonl'), { depth: 2, since, tick }),
    open: () => ({ n: 0 }),
    timeOf: isoTimeOf,
    head: () => { seen.heads++; },
    tail: () => { seen.tails++; },
    line(_s, l, ctx) { seen.lines++; const t = isoTimeOf(l); if (t !== undefined && t >= ctx.dayStart) { seen.today++; ctx.mark(t, 'a'); ctx.emit({ type: 'turn', data: { t, agentId: 'a', phase: 'start' } }); } },
  };
  return { reader, seen };
}

test('local store: thousands of files and a large one, read without holding the event loop', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshu-kit-'));
  try {
    const d0 = midnight();
    const old = new Date(d0 - 3 * 86_400_000);
    for (let p = 0; p < 30; p++) {
      mkdirSync(join(root, 'p' + p));
      for (let i = 0; i < 100; i++) {
        const f = join(root, 'p' + p, `s${i}.jsonl`);
        writeFileSync(f, JSON.stringify({ timestamp: old.toISOString(), type: 'user' }) + '\n');
        utimesSync(f, old, old);
      }
    }
    // 40 MB of yesterday, then 2000 lines of today.
    const big = join(root, 'p0', 'big.jsonl');
    const filler = 'x'.repeat(2000);
    const y = new Date(d0 - 3600_000).toISOString();
    const chunk = Array.from({ length: 1000 }, () => JSON.stringify({ timestamp: y, type: 'assistant', pad: filler })).join('\n') + '\n';
    for (let i = 0; i < 20; i++) appendFileSync(big, chunk);
    appendFileSync(big, Array.from({ length: 2000 }, (_, i) => JSON.stringify({ timestamp: new Date(d0 + 60_000 + i * 1000).toISOString(), type: 'assistant' })).join('\n') + '\n');
    const { reader, seen } = counter(root);
    const city = createLocalCity(reader, { passMs: 200 });
    const gaps: number[] = []; let last = performance.now();
    const iv = setInterval(() => { const n = performance.now(); gaps.push(n - last - 4); last = n; }, 4);
    let passes = 0, events = 0;
    for (;;) { const r = await city.pass(); passes++; events += r.events.length; if (r.complete || passes > 200) break; }
    clearInterval(iv);
    assert.equal(seen.today, 2000, "all of today's lines");
    assert.ok(seen.lines < 2000 + 2000, `yesterday's 20 000 lines are skipped by seeking (read ${seen.lines})`);
    assert.equal(seen.tails, 3000, 'older files: head and tail only');
    assert.equal(events, 2000);
    // Other test files run in parallel, so single long gaps can be scheduling noise: the 99th percentile shows
    // whether the reader itself holds the loop, the maximum only that it never stalls.
    gaps.sort((a, b) => a - b);
    const p99 = gaps[Math.floor(gaps.length * 0.99)], max = gaps[gaps.length - 1];
    assert.ok(p99 < 40, `the event loop is handed back every few ms (p99 gap ${Math.round(p99)} ms)`);
    assert.ok(max < 600, `no stall (longest gap ${Math.round(max)} ms)`);
    // Appended lines are read once, nothing earlier again.
    appendFileSync(big, JSON.stringify({ timestamp: new Date().toISOString(), type: 'user' }) + '\n');
    city.touch();
    // Under load a pass may spend its budget on the listing; the next one goes on.
    let more = 0;
    for (let i = 0; i < 20; i++) { const r = await city.pass(); more += r.events.length; if (r.complete) break; }
    assert.equal(more, 1);
    assert.deepEqual(city.history().map((d) => d.sessions), [1], 'the 14-day totals count it once');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('local store: a line longer than a read window is stepped over, not kept', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshu-kit2-'));
  try {
    const f = join(root, 'a.jsonl');
    writeFileSync(f, 'y'.repeat(3 << 20) + '\n{"ok":1}\n');
    const r1 = await readNext(f, 0, (3 << 20) + 10, 1 << 20);
    assert.deepEqual(r1.lines, []);
    assert.equal(r1.offset, (3 << 20) + 1);
    const r2 = await readNext(f, r1.offset, (3 << 20) + 10, 1 << 20);
    assert.deepEqual(r2.lines, ['{"ok":1}']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('local store: what was read is taken up after a restart; only what changed is read again', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dshu-kit3-'));
  try {
    const d0 = midnight();
    const old = new Date(d0 - 2 * 86_400_000);
    mkdirSync(join(root, 'p'));
    for (let i = 0; i < 50; i++) {
      const f = join(root, 'p', `old${i}.jsonl`);
      writeFileSync(f, JSON.stringify({ timestamp: old.toISOString(), type: 'user' }) + '\n');
      utimesSync(f, old, old);
    }
    const live = join(root, 'p', 'today.jsonl');
    writeFileSync(live, Array.from({ length: 300 }, (_, i) => JSON.stringify({ timestamp: new Date(d0 + 60_000 + i * 1000).toISOString(), type: 'assistant' })).join('\n') + '\n');
    const first = counter(root);
    // Tail marks of older files go into the 14-day totals.
    first.reader.tail = (_s, _l, ctx) => { first.seen.tails++; ctx.mark(old.getTime(), 'o'); };
    const a = createLocalAdapter({ platform: { id: 'x', title: 'X', adapterVersion: '0' }, caps: {} as never, root, watch: [], reader: first.reader, consent: { readsKey: 'k', changesConfig: false, undoKey: 'u' } });
    await a.snapshot('');
    assert.equal(first.seen.today, 300);
    const cp = JSON.parse(JSON.stringify(await a.checkpoint()));
    assert.ok(readCheckpoint(cp.city), 'the checkpoint reads back');
    assert.ok(!JSON.stringify(cp).includes(root), 'no path is kept');
    const history = a.history();

    // Same day: nothing is read again, the events come back with it; an append is read from where it stopped.
    const again = counter(root);
    const b = createLocalAdapter({ platform: { id: 'x', title: 'X', adapterVersion: '0' }, caps: {} as never, root, watch: [], reader: again.reader, consent: { readsKey: 'k', changesConfig: false, undoKey: 'u' }, restore: cp });
    await b.snapshot('');
    assert.deepEqual(again.seen, { lines: 0, today: 0, heads: 0, tails: 0 });
    assert.equal(b.events().length, 300);
    assert.deepEqual(b.history(), history);
    appendFileSync(live, JSON.stringify({ timestamp: new Date().toISOString(), type: 'user' }) + '\n');
    await b.stop();
    const c = createLocalAdapter({ platform: { id: 'x', title: 'X', adapterVersion: '0' }, caps: {} as never, root, watch: [], reader: again.reader, consent: { readsKey: 'k', changesConfig: false, undoKey: 'u' }, restore: cp });
    await c.snapshot('');
    assert.equal(again.seen.lines, 1, 'only the appended line');
    assert.equal(c.events().length, 301);

    // A later day: older files untouched since are taken with their marks; today's are read again.
    const later = counter(root);
    later.reader.tail = (_s, _l, ctx) => { later.seen.tails++; ctx.mark(old.getTime(), 'o'); };
    const tomorrow = d0 + 86_400_000 + 3600_000;
    const city = createLocalCity(later.reader, { now: () => tomorrow, restore: readCheckpoint(cp.city) });
    assert.equal(city.restored(), 'old');
    for (let i = 0; i < 50; i++) if ((await city.pass()).complete) break;
    assert.equal(later.seen.heads, 1, 'only the file touched on the earlier day is opened');
    assert.equal(later.seen.tails, 1);
    assert.ok(city.history().some((d) => d.day === localDayOf(old.getTime()) && d.sessions === 1), 'the kept marks count');

    // Malformed checkpoints are read again from scratch rather than trusted.
    assert.equal(readCheckpoint({ v: 1, day: 'x', files: [{ k: 'a', o: 5, s: 1, m: 0, st: {} }], sessions: [], failed: [], keys: [] }), undefined);
    assert.equal(readCheckpoint('nope'), undefined);
    const st = { calls: new Map([['a', { t: 1 }]]), seen: new Set(['x']), n: 2 };
    assert.deepEqual(unpack(JSON.parse(JSON.stringify(pack(st)))), st);
    await c.stop();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const localDayOf = (t: number) => { const d = new Date(t), p = (x: number) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
