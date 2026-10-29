// What the host reads from the repository, pinned.
//
// Production is built by Railway's Railpack from this tree: it copies every package.json and the lockfile,
// runs `npm install`, copies the source over, runs the `build` script if there is one, and starts
// `npm run start`. Three things it does are easy to change by accident and costly to find out about
// from production:
//
//   1. the Node version. It comes from package.json "engines" — and from any idiomatic version file
//      (.nvmrc, .node-version, .tool-versions, mise.toml), which Railpack's mise reads AFTER engines and
//      lets override it. A .nvmrc added "for developers" moves production to another Node major, in a
//      release that is about something else. Changing the runtime is a decision: edit the expected
//      value below in the same commit that changes engines.
//   2. what the deploy image carries. It takes /app/node_modules from the install layer and the source
//      from the build layer; a workspace package's own node_modules is not something to rely on. So
//      whatever a package under packages/ needs at runtime is declared by the root package too, where
//      npm hoists it.
//   3. the lockfile agreeing with package.json, which `npm install` on the host silently repairs and
//      `npm ci` in CI refuses.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const exists = f => fs.existsSync(path.join(ROOT, f));

// The Node range production builds with. Railpack resolves ">=18.0.0" to the latest 18.x (18.20.8 at the
// time of writing). Moving it is a release of its own.
const PRODUCTION_NODE = '>=18.0.0';

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const pkg = read('package.json');
const lock = read('package-lock.json');

// ── 1. the Node version ─────────────────────────────────────────────────────────────────────────
check(`production's Node is chosen by package.json engines, and it is ${PRODUCTION_NODE}`, pkg.engines && pkg.engines.node === PRODUCTION_NODE, JSON.stringify(pkg.engines));
const IDIOMATIC = ['.nvmrc', '.node-version', '.tool-versions', 'mise.toml', '.mise.toml', 'mise.local.toml', '.config/mise.toml'];
const present = IDIOMATIC.filter(exists);
check('no version file sits beside it to override it (Railpack hands those to mise)', present.length === 0, present.join(', '));
check('the host starts the server with `npm run start`, which runs index.js', pkg.scripts && pkg.scripts.start === 'node index.js', pkg.scripts && pkg.scripts.start);
check('`npm run build` exists and does nothing until a workspace has something to build', typeof (pkg.scripts && pkg.scripts.build) === 'string'
  && !/\bvite\b|\btsc\b|\bwebpack\b/.test(pkg.scripts.build), pkg.scripts && pkg.scripts.build);

// ── 2. what the deploy image carries ────────────────────────────────────────────────────────────
const workspaceDirs = [];
for (const glob of pkg.workspaces || []) {
  const base = glob.replace(/\/\*$/, '');
  if (!exists(base)) continue;
  for (const d of fs.readdirSync(path.join(ROOT, base), { withFileTypes: true }))
    if (d.isDirectory() && exists(path.join(base, d.name, 'package.json'))) workspaceDirs.push(path.join(base, d.name));
}
const shared = workspaceDirs.filter(d => d.startsWith('packages' + path.sep) || d.startsWith('packages/'));
check('the workspace packages the server loads are found (packages/contracts at least)', shared.some(d => d.endsWith('contracts')), shared.join(', '));
const missing = [];
const rangeDiffers = [];
for (const d of shared) {
  const wp = read(path.join(d, 'package.json'));
  for (const [name, range] of Object.entries(wp.dependencies || {})) {
    const rootRange = (pkg.dependencies || {})[name];
    if (!rootRange) missing.push(`${d} needs ${name}`);
    else if (rootRange !== range) rangeDiffers.push(`${d} wants ${name}@${range}, the root has ${rootRange}`);
  }
}
check('everything a shared package needs at runtime is declared by the root package as well, at the same range', missing.length === 0 && rangeDiffers.length === 0, missing.concat(rangeDiffers).join('; '));
const nested = shared.filter(d => exists(path.join(d, 'node_modules')) && fs.readdirSync(path.join(ROOT, d, 'node_modules')).length);
check('…and npm therefore has nothing to nest inside a shared package', nested.length === 0, nested.join(', '));
check('the shared packages are workspace links in the lockfile, not copies', shared.every(d => {
  const name = read(path.join(d, 'package.json')).name;
  const entry = lock.packages['node_modules/' + name];
  return entry && entry.link === true && entry.resolved === d.split(path.sep).join('/');
}));

// ── 3. the lockfile agrees with package.json ────────────────────────────────────────────────────
const rootLock = lock.packages[''] || {};
const same = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort());
check('the lockfile lists the root dependencies package.json lists', same(rootLock.dependencies, pkg.dependencies));
check('…and the dev dependencies', same(rootLock.devDependencies, pkg.devDependencies));
check('…and the Node range', same(rootLock.engines, pkg.engines));
check('…and the workspaces', JSON.stringify(rootLock.workspaces) === JSON.stringify(pkg.workspaces));

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
