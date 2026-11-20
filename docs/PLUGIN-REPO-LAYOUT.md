# Public DSH plugin repository layout

The layout this repository uses, and the standard for every public DeepSeek Harness (DSH) plugin repository we
publish. It is what the plugin directories read and what `dsh plugin add github:<owner>/<repo>` installs. Copy it.

## What the installers and directories read

- **Official DSH** (`dsh plugin --profile web add github:<owner>/<repo>[#<branch or commit>]`): pnpm fetches the
  repository tarball of the default branch (or the ref), keeps the files that `files` in the root `package.json`
  lists, and installs that as the package. **It does not build.** A `prepare` script (or `prepack`, `prepublish` or
  `publish` without the `main` file) makes pnpm stop and ask the member to allow the build in the profile's
  `pnpm-workspace.yaml` (`allowBuilds`), so the built files must be committed. `dependencies` are installed from the
  registry; `devDependencies` and `workspaces` are ignored.
- **dsh-plugins.org** (`lwmxiaobei/dsh-plugins`, `scripts/sync-catalog.mjs`): finds repositories by the GitHub topic
  `dsh-plugin`, reads **only the root `package.json` on the default branch**, needs `dsh.bundle.patch` and that the
  patch file exists. It lists the install command `dsh plugin --profile web add github:<owner>/<repo>`.
- **dsh-plugin.org**: the topic `dsh-plugin`, a public repository, a **root `package.json` with the package name and
  version** (matched against npm), an **`apply(ctx)` export**, and an install command in the README. Only plugins on
  npm appear in the in-app Plugin Hub; the others are listed with the `github:` command.
- **awesome-dsh-plugin**: one `data/plugins/<owner>__<repo>.yml` per plugin; needs `dsh.bundle` in `package.json` and
  a `cordis.patch.yml`, real working code, a repository at least one day old.

## Checklist

1. **Root `package.json` is the plugin manifest.** Not `private`. Fields:
   - `name` (the npm name, also the patch row's `id` and `name`), `version`, `description`, `license`, `author`,
     `repository`, `bugs`, `homepage`, `keywords` including `dsh` and `dsh-plugin`;
   - `type: "module"`, `main` and `exports["."]` pointing at the committed Host entry (`./dist/index.js`), plus
     `./client`, `./package.json` and `./locale/*.json` when there is a client;
   - `files`: only what ships (the build, the patch, icon, locale tables, README and the images it shows, LICENSE);
   - `dsh.bundle.patch: "./cordis.patch.yml"`, `dsh.client` when there is browser UI, `engines.dsh`;
   - DSH packages the plugin shares with the host as optional `peerDependencies`, never `dependencies`;
   - no `prepare`, `prepack`, `prepublish`, `publish` or install scripts; `prepublishOnly` may refuse a root publish
     when the npm package is packed elsewhere.
2. **`cordis.patch.yml`** at the root, the row named after the package:
   ```yaml
   - insert:
       - id: '<package name>'
         name: '<package name>'
   ```
3. **Host entry** exporting `name`, `inject` (if any) and `apply(ctx)`:
   ```ts
   export const name = '<package name>';
   export const inject = ['connection'];
   export async function apply(ctx) { /* ... */ }
   ```
4. **Committed build.** `dist/` (or `lib/`) is committed and un-ignored (`!/dist/` after `dist/` in `.gitignore`).
   The build is reproducible (pinned bundler, no source maps, no timestamps). CI runs the build and then
   `git status --porcelain -- dist` and fails on any difference (`scripts/check-build.mjs` here).
5. **Internal packages** are private npm workspaces under `packages/`, listed in the root `workspaces`, bundled into
   the build, never published on their own. Code under a stricter licence (here `packages/art`) stays in its own
   package with its own NOTICE.
6. **GitHub topics**: `dsh-plugin` (required by every directory), plus `dsh`, `deepseek-harness` and a few that say
   what it does. A repository description of one sentence.
7. **README essentials**: one-line value, a screenshot or GIF (relative paths to files that `files` ships, so the
   plugin page inside DSH shows them too), the install commands (`dsh plugin --profile web add <npm name>` and
   `dsh plugin --profile web add github:<owner>/<repo>`), the DSH version needed, what it reads or sends (permissions,
   network), the licence, and a Development section.
8. **npm**: publishing from the root works when `files` is the allowlist (`npm publish --access public`). Audit the
   tarball first (`npm pack --dry-run`, or a script like `scripts/check-tarball.mjs`). This repository packs from a
   staging folder instead (`scripts/npm-pack.mjs`), because its versions come from the capabilities catalog.

## Validate before announcing

```sh
# 1. dsh-plugins.org: run their own inspection on your branch (classification must be "plugin").
git clone --depth 1 https://github.com/lwmxiaobei/dsh-plugins
#    Take scripts/sync-catalog.mjs up to `if (process.argv.includes('--readme-only'))`, then append:
#      const repo = await githubFetch(`/repos/${process.argv[2]}`); if (process.argv[3]) repo.default_branch = process.argv[3]
#      console.log(JSON.stringify(await inspectRepository(repo), null, 2))
node sync-catalog-one.mjs <owner>/<repo> <branch>

# 2. dsh-plugin.org: root package.json name and version, and apply(ctx) from the built entry.
node -e 'const p=require("./package.json");console.log(p.name,p.version)'
node -e 'import("./dist/index.js").then(m=>{if(typeof m.apply!=="function")process.exit(1);console.log("apply ok")})'

# 3. A real install into official DSH with a temporary HOME, from the branch before merging.
node scripts/official-dsh-check.mjs github:<owner>/<repo>#<branch>
```

Then merge, check `dsh plugin --profile web add github:<owner>/<repo>` from the default branch once more, add the
topic, and submit or comment on the directories.
