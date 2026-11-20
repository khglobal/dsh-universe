// Stops the DSH server and removes its temporary folder without racing the OS.
//
// A just-killed child process may still hold files open in its cwd (logs, caches,
// the default workspace). An immediate recursive rm therefore fails with
// ENOTEMPTY / EBUSY / EPERM even on a completely clean run, which used to make
// official-dsh-check exit 1. Wait for the process to actually exit, then retry
// those transient "still in use" errors with a short delay. A folder we cannot
// remove is reported to the caller as `false` rather than thrown, so a clean
// check never fails because of its own cleanup.
import { rmSync } from 'node:fs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isExited = (child) => Boolean(child) && (child.exitCode !== null || child.signalCode !== null);

const waitForExit = (child, timeoutMs) => new Promise((resolve) => {
  if (isExited(child)) return resolve();
  const done = () => { clearInterval(tick); clearTimeout(timer); resolve(); };
  const tick = setInterval(() => { if (isExited(child)) done(); }, 25);
  const timer = setTimeout(() => { clearInterval(tick); done(); }, timeoutMs);
  if (typeof child.once === 'function') child.once('exit', done);
});

const isBusy = (err) => ['ENOTEMPTY', 'EBUSY', 'EPERM', 'EEXIST', 'EACCES'].includes(err?.code);

/**
 * Stop `server` (if any) and remove `dir`, tolerating the post-exit file-handle race.
 * Returns true when the folder is gone or intentionally kept, false on a final removal failure.
 */
export async function cleanupTemp(server, dir, opts = {}) {
  const { keep = false, remove = (d) => rmSync(d, { recursive: true, force: true }),
    sleep: snooze = sleep, retries = 5, delayMs = 100, exitTimeoutMs = 5000 } = opts;

  if (server) {
    if (!isExited(server) && typeof server.kill === 'function') server.kill();
    await waitForExit(server, exitTimeoutMs);
  }
  if (keep) return true;

  let last;
  for (let i = 0; i <= retries; i++) {
    try {
      remove(dir);
      last = undefined;
      break;
    } catch (err) {
      last = err;
      if (!isBusy(err) || i === retries) break;
      await snooze(delayMs);
    }
  }
  if (last) console.error(`[official-dsh] cleanup of ${dir} failed: ${last.message}`);
  return !last;
}
