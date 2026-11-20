// `npm publish` from the repository root is refused. The root package.json is the plugin manifest (DSH installs the
// repository with `dsh plugin add github:khglobal/dsh-universe`, and the plugin directories read it), so it is not
// private; but the public npm package is packed from a capabilities catalog release by scripts/npm-pack.mjs and
// published only by .github/workflows/npm-publish.yml, which never runs this script.
console.error('npm publish from the repository root is not used: run the npm-publish workflow (scripts/npm-pack.mjs packs the package).');
process.exit(1);
