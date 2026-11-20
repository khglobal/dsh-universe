// Regression tests for the official-dsh-check temp-folder clean-up race (issue #28).
// A just-killed DSH server can still hold files in its cwd, so an immediate
// recursive rm fails with ENOTEMPTY/EBUSY and used to turn a clean run into exit 1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
// @ts-expect-error plain .mjs script without declarations
import { cleanupTemp } from '../official-dsh-cleanup.mjs';

const nap = async () => {};
const exited = () => {
  const c = new EventEmitter() as any;
  c.exitCode = 0;
  c.signalCode = null;
  c.kill = () => true;
  return c;
};
// A server that only reports its exit a short while after kill(), while it is
// still draining file handles in the temp folder -- the exact ENOTEMPTY race.
const dying = (delayMs = 5) => {
  const c = new EventEmitter() as any;
  c.exitCode = null;
  c.signalCode = null;
  c.killed = false;
  c.kill = () => {
    c.killed = true;
    setTimeout(() => { c.exitCode = 0; c.emit('exit', 0, null); }, delayMs);
    return true;
  };
  return c;
};

test('cleanup kills the server and waits for exit before removing its folder', async () => {
  const c = dying(10);
  const order: string[] = [];
  const remove = () => { order.push(c.exitCode === null ? 'remove:running' : 'remove:exited'); };
  assert.equal(await cleanupTemp(c, 'T', { remove, sleep: nap } as any), true);
  assert.equal(c.killed, true);
  assert.deepEqual(order, ['remove:exited']);
});

test('cleanup retries removal while the OS still holds the folder (ENOTEMPTY then EBUSY)', async () => {
  const c = exited();
  let tries = 0;
  const remove = () => {
    tries++;
    if (tries === 1) throw Object.assign(Error('busy'), { code: 'ENOTEMPTY' });
    if (tries === 2) throw Object.assign(Error('busy'), { code: 'EBUSY' });
  };
  assert.equal(await cleanupTemp(c, 'T', { remove, sleep: nap, retries: 5 } as any), true);
  assert.equal(tries, 3);
});

test('cleanup gives up quietly after repeated busy errors so a clean run still exits 0', async () => {
  const c = exited();
  let tries = 0;
  const remove = () => { tries++; throw Object.assign(Error('busy'), { code: 'ENOTEMPTY' }); };
  assert.equal(await cleanupTemp(c, 'T', { remove, sleep: nap, retries: 3 } as any), false);
  assert.equal(tries, 4); // first attempt + 3 retries
});

test('cleanup never retries a non-busy removal error and never throws', async () => {
  const c = exited();
  let tries = 0;
  const remove = () => { tries++; throw Object.assign(Error('bad argument'), { code: 'EINVAL' }); };
  assert.equal(await cleanupTemp(c, 'T', { remove, sleep: nap, retries: 5 } as any), false);
  assert.equal(tries, 1);
});

test('cleanup with keep still stops the server but leaves the folder in place', async () => {
  const c = dying(1);
  let removed = 0;
  const remove = () => { removed++; };
  assert.equal(await cleanupTemp(c, 'T', { keep: true, remove, sleep: nap } as any), true);
  assert.equal(c.killed, true);
  assert.equal(removed, 0);
});

test('cleanup removes the folder even if the server never reports exit (timeout)', async () => {
  const c = new EventEmitter() as any;
  c.exitCode = null;
  c.signalCode = null;
  c.kill = () => true; // never emits exit
  const order: string[] = [];
  const remove = () => { order.push('remove'); };
  assert.equal(await cleanupTemp(c, 'T', { remove, sleep: nap, exitTimeoutMs: 5 } as any), true);
  assert.deepEqual(order, ['remove']);
});
