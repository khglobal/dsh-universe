// Waits for the CI of a catalog PR in khglobal/astero-capabilities and merges it once every check is green.
//
// The release token is a fine-grained personal access token, and those cannot be granted "checks: read", so
// `gh pr view --json statusCheckRollup` (GraphQL check runs) is refused for it. The catalog's checks are GitHub Actions
// jobs (the required one is `plugins` in ci.yml), so they are read through the Actions REST API instead, which needs
// only the repository permission "Actions: Read-only".
//
//   node scripts/catalog-ci.mjs --probe     reports whether the token in GH_TOKEN can read what the release needs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = 'khglobal/astero-capabilities';
export const REQUIRED_JOB = 'plugins';
export const ACTIONS_PERMISSION = 'Actions: Read-only';
const GREEN = new Set(['success', 'neutral', 'skipped']);

/** Runs gh and returns stdout; on failure throws an Error carrying gh's stderr (as .stderr). */
export const gh = (args, input) => {
  const r = spawnSync('gh', args, { encoding: 'utf8', input, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  if (r.status !== 0) throw Object.assign(Error(`gh ${args.join(' ')} failed (${r.status}): ${(r.stderr ?? '').trim()}`), { stderr: r.stderr ?? '' });
  return r.stdout.trim();
};

const refused = (e) => /HTTP 403|HTTP 404|Resource not accessible/u.test(`${e?.stderr ?? ''} ${e?.message ?? ''}`);
const noActions = (repo) => Error(`the release token (CAPABILITIES_TOKEN) cannot read GitHub Actions runs on ${repo}. `
  + `Add the repository permission "${ACTIONS_PERMISSION}" for ${repo} to the fine-grained personal access token `
  + '(GitHub → Settings → Developer settings → Fine-grained tokens → the token → Repository permissions → Actions). '
  + 'The PR was opened; merge it by hand this time.');

/** Actions API reads for one PR, through an injectable gh (tests pass a fake). */
export const api = (run = gh, repo = REPO) => {
  const get = (path) => JSON.parse(run(['api', '-H', 'Accept: application/vnd.github+json', `repos/${repo}/${path}`]));
  const actions = (path) => { try { return get(path); } catch (e) { throw refused(e) ? noActions(repo) : e; } };
  return {
    pr: (n) => get(`pulls/${n}`),
    runs: (sha) => actions(`actions/runs?head_sha=${sha}&per_page=100`).workflow_runs ?? [],
    jobs: (id) => actions(`actions/runs/${id}/jobs?filter=latest&per_page=100`).jobs ?? [],
    merge: (n) => run(['pr', 'merge', String(n), '-R', repo, '--admin', '--squash', '--delete-branch']),
  };
};

/**
 * Polls until the PR is merged (the auto-review routine may merge it first; that is fine) or every workflow run on its
 * head commit has completed. Then every job must be green and the required `plugins` job must have succeeded, and the
 * PR is merged. Throws when a check failed or nothing finished after `tries` polls. Returns 'merged' or 'already-merged'.
 */
export async function waitAndMerge(n, { run = gh, repo = REPO, tries = 120, interval = 15000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const a = api(run, repo);
  const url = `https://github.com/${repo}/pull/${n}`;
  for (let i = 0; ; i++) {
    const pr = a.pr(n);
    if (pr.merged || pr.merged_at) return 'already-merged';
    if (pr.state === 'closed') throw Error(`${url} was closed without merging`);
    const runs = a.runs(pr.head.sha);
    if (runs.length > 0 && runs.every((r) => r.status === 'completed')) {
      const jobs = runs.flatMap((r) => a.jobs(r.id).map((j) => ({ ...j, workflow: r.name })));
      const bad = [
        ...runs.filter((r) => !GREEN.has(r.conclusion)).map((r) => `${r.name} (${r.conclusion})`),
        ...jobs.filter((j) => j.status === 'completed' && !GREEN.has(j.conclusion)).map((j) => `${j.workflow}/${j.name} (${j.conclusion})`),
      ];
      if (bad.length) throw Error(`checks failed on ${url}: ${[...new Set(bad)].join(', ')}`);
      if (!jobs.some((j) => j.name === REQUIRED_JOB && j.conclusion === 'success'))
        throw Error(`checks finished on ${url} without a successful "${REQUIRED_JOB}" job`);
      a.merge(n);
      return 'merged';
    }
    if (i > tries) throw Error(`checks did not finish on ${url}`);
    await sleep(interval);
  }
}

/** What the release needs from the token, each checked with one harmless read. */
export function probe({ run = gh, repo = REPO } = {}) {
  const check = (name, path) => {
    try { run(['api', `repos/${repo}/${path}`]); return { name, ok: true }; } catch (e) { return { name, ok: false, error: (e?.stderr || e?.message || '').trim().split('\n')[0] }; }
  };
  return [
    check('Contents: Read', 'contents/catalog/plugins.json?ref=dev'),
    check('Pull requests: Read', 'pulls?per_page=1'),
    check(ACTIONS_PERMISSION, 'actions/runs?per_page=1'),
  ];
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--probe')) {
  const results = probe();
  for (const r of results) console.log(`${r.ok ? 'ok     ' : 'MISSING'} ${r.name}${r.ok ? '' : ` (${r.error})`}`);
  if (!results.every((r) => r.ok)) {
    console.log(`::error::CAPABILITIES_TOKEN lacks: ${results.filter((r) => !r.ok).map((r) => r.name).join(', ')} on ${REPO}`);
    process.exit(1);
  }
}
