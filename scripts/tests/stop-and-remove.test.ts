import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error plain .mjs script without declarations
import { stopAndRemove } from '../stop-and-remove.mjs';

test('stopAndRemove waits for a child that keeps writing on shutdown, then removes its folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dshu-stop-'));
  // The child writes files after SIGTERM before exiting, like a server flushing its stores.
  const src = `const fs=require('fs');const p=require('path');const d=${JSON.stringify(dir)};
    fs.mkdirSync(p.join(d,'store'),{recursive:true});
    process.on('SIGTERM',()=>{let i=0;const t=setInterval(()=>{fs.writeFileSync(p.join(d,'store','f'+i),'x');if(++i>5){clearInterval(t);process.exit(0);}},20);});
    console.log('ready');setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['-e', src], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise<void>((ok) => child.stdout.once('data', () => ok()));
  await stopAndRemove(child, dir);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.equal(existsSync(dir), false);
});

test('stopAndRemove copes with no child and an already-gone folder', async () => {
  await stopAndRemove(undefined, join(tmpdir(), 'dshu-stop-missing-' + process.pid));
});
