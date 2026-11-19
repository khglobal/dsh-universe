import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, stateAt } from '../src/store.ts';
import { todayAt } from '../src/today.ts';
import { rallyAt } from '../src/rally.ts';
import {
  binReadout, scrubTo, stepScrub, replayAt, replayFrom, replaySteps, waitBands, waitingAt,
  SCRUB_STEP_MS, LIVE_SNAP_MS, REPLAY_MS, REPLAY_STEPS, REPLAY_STEP_MS,
} from '../src/timeline.ts';
import { historyWindow, todayTotals, dayKey, dayStart, HISTORY_DAYS } from '../src/history.ts';
import { agent, at, call, turn, usage, wait, M } from './helpers.ts';

const LIVE = at(12);

test('scrubber: the keyboard moves one minute per press; going past now returns to live', () => {
  assert.equal(stepScrub(null, LIVE, 'ArrowLeft'), LIVE - SCRUB_STEP_MS);
  assert.equal(stepScrub(LIVE - 5 * M, LIVE, 'ArrowLeft'), LIVE - 6 * M);
  assert.equal(stepScrub(LIVE - 5 * M, LIVE, 'ArrowRight'), LIVE - 4 * M);
  assert.equal(stepScrub(LIVE - M, LIVE, 'ArrowRight'), null, 'one minute forward from a minute ago is now: live');
  assert.equal(stepScrub(null, LIVE, 'ArrowRight'), null, 'live stays live');
  assert.equal(stepScrub(LIVE - 3 * M, LIVE, 'End'), null);
  assert.equal(stepScrub(LIVE - 3 * M, LIVE, 'Home'), dayStart(LIVE));
  assert.equal(stepScrub(dayStart(LIVE), LIVE, 'ArrowLeft'), dayStart(LIVE), 'never before the start of the day');
  assert.equal(stepScrub(LIVE - 3 * M, LIVE, 'x'), undefined, 'other keys are not ours');
});

test('scrubber: dragging to now or past it is live; anything earlier is a moment', () => {
  assert.equal(scrubTo(LIVE + 5 * M, LIVE), null);
  assert.equal(scrubTo(LIVE, LIVE), null);
  assert.equal(scrubTo(LIVE - LIVE_SNAP_MS + 1, LIVE), null);
  assert.equal(scrubTo(LIVE - LIVE_SNAP_MS - 1, LIVE), LIVE - LIVE_SNAP_MS - 1);
  assert.equal(scrubTo(at(9), LIVE), at(9));
  assert.equal(scrubTo(Number.NaN, LIVE), null);
});

function day() {
  const st = createStore();
  st.applyAll([
    agent('a', at(9)), turn('a', at(9), 'start'), call('a', at(9, 5), 'read'), usage('a', at(9, 5), 100, 10),
    call('a', at(9, 40), 'exec', 'bash', { ok: false }), wait('a', 'w1', at(10), at(10, 20)), turn('a', at(10, 30), 'end', 'completed'),
    agent('b', at(11)), turn('b', at(11), 'start'), call('b', at(11, 1), 'edit'), turn('b', at(11, 10), 'end', 'error'),
    agent('c', at(11, 30)), wait('c', 'q', at(11, 50), undefined, 'question'),
  ]);
  return st;
}

test('look-back: a session that has not started at T is not there; the numbers are those of that moment', () => {
  const st = day();
  assert.equal(stateAt(st.agent('b')!, at(10, 59)), 'future');
  const t10 = todayAt(st, at(10, 10), 'dsh');
  assert.equal(t10.need, 1, 'at 10:10 a was waiting');
  assert.equal(t10.running, 0);
  assert.equal(t10.errors, 1);
  assert.equal(t10.tokens, 110);
  const t930 = todayAt(st, at(9, 30), 'dsh');
  assert.deepEqual([t930.need, t930.running, t930.errors], [0, 1, 0], 'the failed bash at 9:40 has not happened yet');
  assert.deepEqual(rallyAt(st, at(11, 20)).map((e) => e.kind), ['error'], 'b stopped on an error at 11:10');
  assert.deepEqual(rallyAt(st, LIVE).map((e) => [e.agentId, e.kind]), [['b', 'error'], ['c', 'question']]);
});

test('replay: starts a little before the first session, ends back at live; reduced motion is 15 steps', () => {
  const st = day();
  const from = replayFrom(st, LIVE);
  assert.equal(from, at(8, 55));
  const r = { startedAt: 1000, from };
  assert.deepEqual(replayAt(r, 1000, LIVE, false), { T: from, done: false });
  assert.equal(replayAt(r, 1000 + REPLAY_MS / 2, LIVE, false).T, Math.round(from + (LIVE - from) / 2));
  assert.deepEqual(replayAt(r, 1000 + REPLAY_MS, LIVE, false), { T: LIVE, done: true });
  const seen = new Set<number>();
  for (let el = 0; el < REPLAY_STEPS * REPLAY_STEP_MS; el += 50) {
    const x = replayAt(r, 1000 + el, LIVE, true);
    assert.equal(x.done, false);
    seen.add(x.T);
  }
  assert.equal(seen.size, REPLAY_STEPS, 'exactly 15 distinct still pictures, no tween');
  assert.deepEqual([...seen], replaySteps(from, LIVE));
  assert.equal([...seen].at(-1), LIVE);
  assert.deepEqual(replayAt(r, 1000 + REPLAY_STEPS * REPLAY_STEP_MS, LIVE, true), { T: LIVE, done: true, step: REPLAY_STEPS });
  assert.equal(replayFrom(createStore(), LIVE), dayStart(LIVE), 'an empty day replays from midnight');
});

test('wait bands: approvals, questions and stops on an error, with the square agreeing at every minute', () => {
  const st = day();
  const bands = waitBands(st, LIVE);
  assert.deepEqual(bands.map((b) => [b.agentId, b.kind, (b.from - at(0)) / M, (b.to - at(0)) / M, b.open]), [
    ['a', 'approval', 600, 620, false],
    ['b', 'error', 670, 720, true],
    ['c', 'question', 710, 720, true],
  ]);
  for (let T = at(9); T <= LIVE; T += M) {
    const n = bands.filter((b) => T >= b.from && (T < b.to || (b.open && T === b.to))).length;
    assert.equal(waitingAt(st, T), n, 'at ' + new Date(T).toISOString());
  }
});

test('history: 14 days ending today, oldest first; today counted live; missing days are unknown, not zero', () => {
  const st = day();
  const today = dayKey(LIVE);
  const yesterday = dayKey(dayStart(LIVE) - 1);
  const w = historyWindow([{ day: yesterday, sessions: 7, failed: 2 }, { day: today, sessions: 99, failed: 99 }], st, LIVE);
  assert.equal(w.length, HISTORY_DAYS);
  assert.deepEqual(w.at(-1), { day: today, sessions: 3, failed: 1, known: true, today: true });
  assert.deepEqual(w.at(-2), { day: yesterday, sessions: 7, failed: 2, known: true, today: false });
  assert.equal(w[0].known, false);
  assert.deepEqual(todayTotals(st, at(10)), { day: today, sessions: 1, failed: 0 }, 'look-back counts only what had happened');
  assert.ok(w.every((d, i) => i === 0 || d.day > w[i - 1].day));
});

test('timeline hover: one ten-minute bar read out (calls, edits and commands, failed calls)', () => {
  const s = createStore();
  s.applyAll([agent('a', at(9)), agent('b', at(9)),
    call('a', at(10, 1), 'edit'), call('a', at(10, 2), 'read', 'read', { ok: false }), call('b', at(10, 9, 59), 'exec', 'sh', { ok: false }),
    call('b', at(10, 10), 'read', 'read', { ok: false }), call('a', at(9, 59, 59), 'read', 'read', { ok: false })]);
  assert.deepEqual(binReadout(s, at(10, 5)), { from: at(10), to: at(10, 10), calls: 3, work: 2, failed: 2 });
  assert.deepEqual(binReadout(s, at(10, 10)), { from: at(10, 10), to: at(10, 20), calls: 1, work: 0, failed: 1 });
  assert.deepEqual(binReadout(s, at(11)), { from: at(11), to: at(11, 10), calls: 0, work: 0, failed: 0 });
});

test('timeline at night (QA finding 7): between midnight and 06:00 the axis reaches now and ← goes back one minute', async () => {
  const { daySpan, stepScrub, createStore: cs } = await import('../src/index.ts');
  const live = new Date(2026, 10, 19, 1, 37).getTime();
  const [from, to] = daySpan(cs(), live);
  assert.ok(from <= live - 60_000 && to > live, `${new Date(from).toTimeString()} – ${new Date(to).toTimeString()}`);
  assert.equal(stepScrub(null, live, 'ArrowLeft', from), live - 60_000);
  const day = daySpan(cs(), new Date(2026, 10, 19, 15).getTime());
  assert.equal(new Date(day[0]).getHours(), 6, 'by day the axis still starts at 06:00');
});

test('earlier days (QA finding 14): a neighbouring city\'s store covers every day, so a day without sessions says none; DSH\'s own storage says unknown', async () => {
  const { historyWindow, createStore: cs } = await import('../src/index.ts');
  const T = new Date(2026, 10, 18, 12).getTime();
  const stored = [{ day: '2026-11-17', sessions: 3, failed: 1 }];
  const own = historyWindow(stored, cs(), T);
  const nb = historyWindow(stored, cs(), T, undefined, true);
  assert.equal(own.filter((d) => !d.today && !d.known).length, own.length - 2);
  assert.ok(nb.every((d) => d.known), 'every day known for a complete source');
  assert.equal(nb.find((d) => d.day === '2026-11-16')!.sessions, 0);
});
