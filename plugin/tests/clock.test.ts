// The panel's clock (#24): it stops while the page is hidden and catches up at once when it is shown again.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PageState } from '@dsh-universe/renderer';
import { LIST_TICK_MS, clockTimer } from '../src/client/hooks.ts';

function fakePage() {
  let hidden = false;
  const subs = new Set<() => void>();
  const page: PageState = { hidden: () => hidden, blurred: () => false, idleFor: () => 0, subscribe: (f) => { subs.add(f); return () => subs.delete(f); } };
  return { page, set(h: boolean) { hidden = h; for (const f of subs) f(); }, subs };
}
function fakeTimers() {
  const live = new Map<number, { f: () => void; ms: number }>();
  let id = 0;
  return { live, set: (f: () => void, ms: number) => { live.set(++id, { f, ms }); return id; }, clear: (k: unknown) => { live.delete(k as number); }, fire() { for (const t of [...live.values()]) t.f(); } };
}

test('clock: ticks while shown, nothing at all while hidden, once at once when shown again', () => {
  const p = fakePage(), tm = fakeTimers();
  let n = 0;
  const stop = clockTimer(() => n++, 1000, p.page, tm);
  assert.equal(tm.live.size, 1);
  tm.fire(); tm.fire();
  assert.equal(n, 2);
  p.set(true);
  assert.equal(tm.live.size, 0, 'no timer while hidden');
  tm.fire();
  assert.equal(n, 2);
  p.set(false);
  assert.equal(n, 3, 'brought up to date when shown');
  assert.equal(tm.live.size, 1);
  stop();
  assert.equal(tm.live.size, 0);
  assert.equal(p.subs.size, 0, 'unsubscribed');
});

test('clock: a page that starts hidden starts no timer; the list steps every few seconds', () => {
  const p = fakePage(), tm = fakeTimers();
  p.set(true);
  clockTimer(() => {}, 1000, p.page, tm);
  assert.equal(tm.live.size, 0);
  assert.ok(LIST_TICK_MS >= 5000);
});
