// Stops a child process, waits for it to exit, then removes a folder it may still be writing to. Used by
// official-dsh-check.mjs: removing the temp folder while the DSH server was still shutting down failed with ENOTEMPTY.
import { rmSync } from 'node:fs';

/** Resolves once `child` has exited (SIGTERM first, SIGKILL after `graceMs`). */
export function stopChild(child, graceMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const hard = setTimeout(() => child.kill('SIGKILL'), graceMs);
    child.once('exit', () => { clearTimeout(hard); done(); });
    child.kill('SIGTERM');
  });
}

/** Stops `child`, then removes `dir`, retrying while late writes settle. */
export async function stopAndRemove(child, dir, graceMs = 5000) {
  await stopChild(child, graceMs);
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
