// Copy fixes from the 0.3.0 QA review (findings 14, 19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { en, zh } from '../src/locales/index.ts';
import { fill } from '../src/client/format.ts';

test('copy: English counts agree with their numbers (one failed call, one place, one car)', () => {
  assert.equal(fill(en['ls.errors'], { n: 1, p: 1, b: 0, r: 1 }), 'Errors: 1 failed call today at 1 place, 0 of them within the last 30 minutes; 1 model request retried.');
  assert.match(fill(en['ls.errors'], { n: 3, p: 2, b: 1, r: 0 }), /3 failed calls today at 2 places/);
  assert.match(fill(en['ls.calls'], { n: 1, c: 1 }), /1 call in the last 5 minutes, 1 car on/);
});

test('copy: the earlier-days heading says how many days it lists (13, today is above it)', () => {
  assert.match(en['li.days'], /13/);
  assert.match(zh['li.days'], /13/);
});

test('copy: the sound button explains itself under reduced motion, in both languages', () => {
  assert.ok(en['snd.rm'] && zh['snd.rm']);
});

test('copy: three cities found are "nearby cities", one is "a nearby city" (one name with the Nearby cities button, #22)', () => {
  assert.match(fill(en['nb.found'], { n: 3, name: 'Claude, ChatGPT and WorkBuddy' }), /shown as nearby cities\./);
  assert.match(fill(en['nb.found'], { n: 1, name: 'Claude' }), /shown as a nearby city\./);
});

// Copy and naming leftovers (#22).
test('copy: one name per thing, one spelling, one word for agent and for failure', () => {
  const enAll = Object.values(en).join('\n'), zhAll = Object.values(zh).join('\n');
  assert.doesNotMatch(enAll, /Review Center|neighbouring|All cities/, 'British spelling like colour and Minimise; one name for nearby cities');
  assert.match(en['nb.region'], /nearby cities/i);
  assert.doesNotMatch(zhAll, /代理/, 'agent is 智能体 throughout');
  assert.doesNotMatch(zh['td.err'], /出错/);
  assert.notEqual(en['li.plugins'], 'Plugin Row');
  assert.doesNotMatch(en['h.empty'], /built/, 'true above a city of earlier buildings after midnight');
  assert.doesNotMatch(en['e.error'], /last read/, 'shown when nothing was read');
});

test('copy: no stray space after full-width punctuation when a name is filled in (zh nb.toggle)', () => {
  assert.equal(fill(zh['nb.toggle'], { name: zh['nb.src.claude-app'] }), '显示 Claude 应用（Cowork、Code 标签页）的会话');
  assert.equal(fill(zh['nb.toggle'], { name: 'Claude' }), '显示 Claude 的会话');
});

test('copy: a scheduled task names the day of a next run that is not today, and a time passed with no run', async () => {
  const { scheduleText } = await import('../src/client/format.ts');
  const t = (k: string, p?: Record<string, string | number>) => fill(en[k as keyof typeof en] ?? k, p);
  const T = new Date(2026, 10, 20, 12, 0).getTime(), at = (d: number, h: number, m = 30) => new Date(2026, 10, d, h, m).getTime();
  assert.equal(scheduleText({ status: 'active', nextAt: at(20, 15) }, undefined, T, t, 'en'), 'Next 15:30');
  assert.equal(scheduleText({ status: 'active', nextAt: at(21, 8) }, { at: at(20, 8) }, T, t, 'en'), 'Next Sat 08:30');
  assert.equal(scheduleText({ status: 'active', nextAt: at(20, 9) }, undefined, T, t, 'en'), 'Due at 09:30, not run yet');
  assert.equal(scheduleText({ status: 'active', nextAt: at(20, 9) }, { at: at(20, 9, 31) }, T, t, 'en'), '');
  assert.equal(scheduleText({ status: 'paused', nextAt: at(21, 8) }, undefined, T, t, 'en'), 'Paused');
});

test('copy: the touch tour, the single-city sound hint and the Enquiries racks have their own words', async () => {
  for (const k of ['tour.building.xTouch', 'snd.hintOne', 'in.p.answered', 'sch.nextDay', 'sch.due'] as const) assert.ok(en[k] && zh[k], k);
  assert.doesNotMatch(en['tour.building.xTouch'], /Point at/);
  assert.doesNotMatch(en['snd.hintOne'], /cities/);
  const { propLines } = await import('../src/client/interior-text.ts');
  const t = (k: string, p?: Record<string, string | number>) => fill(en[k as keyof typeof en] ?? k, p);
  const floor = { id: 'question', tally: { yes: 2, no: 1, open: 1 }, n: 1, na: false } as unknown as Parameters<typeof propLines>[1];
  assert.deepEqual(propLines('racks', floor, t, 'en'), ['3 answered today', '1 still waiting']);
  const approvals = { ...floor, id: 'approval' } as typeof floor;
  assert.deepEqual(propLines('racks', approvals, t, 'en'), ['2 approved today', '1 denied today', '1 still waiting']);
});
