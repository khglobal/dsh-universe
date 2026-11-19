// The local-store reader at scale: thousands of files and one large file must not hold the event loop, a large
// file is entered at today's first line (earlier days are not read), and appended lines are read once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalCity, isoTimeOf, listFiles, readNext, type StoreReader } from '../src/local/index.ts';

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
