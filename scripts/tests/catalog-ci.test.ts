import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error plain .mjs script without declarations
import { probe, waitAndMerge } from '../catalog-ci.mjs';

type Run = { id: number; name: string; status: string; conclusion: string | null };
type Job = { name: string; status: string; conclusion: string | null };
type State = { pr?: Record<string, unknown>; runs: Run[]; jobs?: Record<number, Job[]>; actions403?: boolean };

// A fake gh: answers the REST reads from a list of states (one per poll) and records every call.
const fakeGh = (states: State[]) => {
  const calls: string[][] = [];
  let poll = -1;
  const now = () => states[Math.min(poll, states.length - 1)];
  const run = (args: string[]) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'merge') return '';
    const path = args.at(-1)!;
    if (/\/pulls\/\d+$/u.test(path)) { poll++; return JSON.stringify(now().pr ?? { state: 'open', merged: false, head: { sha: 'abc' } }); }
    if (now().actions403 && path.includes('/actions/'))
      throw Object.assign(Error('gh: Resource not accessible by personal access token (HTTP 403)'), { stderr: 'gh: Resource not accessible by personal access token (HTTP 403)' });
    let m = /actions\/runs\?head_sha=(\w+)/u.exec(path);
    if (m) { assert.equal(m[1], 'abc'); return JSON.stringify({ workflow_runs: now().runs }); }
    m = /actions\/runs\/(\d+)\/jobs/u.exec(path);
    if (m) return JSON.stringify({ jobs: now().jobs?.[Number(m[1])] ?? [] });
    throw Error(`unexpected gh ${args.join(' ')}`);
  };
  return { run, calls, merges: () => calls.filter((c) => c[0] === 'pr' && c[1] === 'merge') };
};
const opts = (run: unknown) => ({ run, sleep: async () => {}, tries: 5 });
const ci = (status: string, conclusion: string | null): Run => ({ id: 1, name: 'ci', status, conclusion });
const plugins = (conclusion: string): Job => ({ name: 'plugins', status: 'completed', conclusion });

test('catalog CI: green plugins job merges the PR with --admin --squash --delete-branch', async () => {
  const gh = fakeGh([{ runs: [ci('completed', 'success')], jobs: { 1: [plugins('success')] } }]);
  assert.equal(await waitAndMerge('126', opts(gh.run)), 'merged');
  assert.deepEqual(gh.merges(), [['pr', 'merge', '126', '-R', 'khglobal/astero-capabilities', '--admin', '--squash', '--delete-branch']]);
});

test('catalog CI: a failed plugins job throws and does not merge', async () => {
  const gh = fakeGh([{ runs: [ci('completed', 'failure')], jobs: { 1: [plugins('failure')] } }]);
  await assert.rejects(waitAndMerge('126', opts(gh.run)), /checks failed on .*pull\/126: ci \(failure\), ci\/plugins \(failure\)/u);
  assert.equal(gh.merges().length, 0);
});

test('catalog CI: no runs yet, then in progress, then success: waits and merges', async () => {
  const gh = fakeGh([
    { runs: [] },
    { runs: [ci('queued', null)] },
    { runs: [ci('in_progress', null)] },
    { runs: [ci('completed', 'success')], jobs: { 1: [plugins('success')] } },
  ]);
  assert.equal(await waitAndMerge('126', opts(gh.run)), 'merged');
  assert.equal(gh.calls.filter((c) => c.at(-1)!.endsWith('/pulls/126')).length, 4);
  assert.equal(gh.merges().length, 1);
});

test('catalog CI: already merged (by the review routine) is fine and merges nothing', async () => {
  const gh = fakeGh([{ pr: { state: 'closed', merged: true, head: { sha: 'abc' } }, runs: [] }]);
  assert.equal(await waitAndMerge('126', opts(gh.run)), 'already-merged');
  assert.equal(gh.merges().length, 0);
});

test('catalog CI: green runs without a plugins job do not merge', async () => {
  const gh = fakeGh([{ runs: [ci('completed', 'success')], jobs: { 1: [{ name: 'lint', status: 'completed', conclusion: 'success' }] } }]);
  await assert.rejects(waitAndMerge('126', opts(gh.run)), /without a successful "plugins" job/u);
  assert.equal(gh.merges().length, 0);
});

test('catalog CI: still pending after the last poll times out', async () => {
  const gh = fakeGh([{ runs: [ci('in_progress', null)] }]);
  await assert.rejects(waitAndMerge('126', opts(gh.run)), /checks did not finish/u);
});

test('catalog CI: a token without Actions read gets the exact permission to add', async () => {
  const gh = fakeGh([{ runs: [], actions403: true }]);
  await assert.rejects(waitAndMerge('126', opts(gh.run)), /"Actions: Read-only"/u);
  const missing = probe({ run: gh.run }).filter((r: { ok: boolean }) => !r.ok).map((r: { name: string }) => r.name);
  assert.ok(missing.includes('Actions: Read-only'));
});
