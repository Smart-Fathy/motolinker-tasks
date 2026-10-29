// What the host reads from the repository, pinned.
//
// Production is built by Railway's Railpack from this tree: it copies every package.json and the lockfile,
// runs `npm install`, copies the source over, runs the `build` script if there is one, and starts
// `npm run start`. Four things it does are easy to change by accident and costly to find out about
// from production:
//
//   1. the Node version. It comes from package.json "engines" — and from any idiomatic version file
//      (.nvmrc, .node-version, .tool-versions, mise.toml), which Railpack's mise reads AFTER engines and
//      lets override it. A .nvmrc added "for developers" moves production to another Node major, in a
//      release that is about something else. Changing the runtime is a decision: edit the expected
//      value below in the same commit that changes engines. CI reads the same line, so what the suites
//      run on is what production runs on.
//   2. what the deploy image carries. It takes /app/node_modules from the install layer and the source
//      from the build layer; a workspace package's own node_modules is not something to rely on. So
//      whatever a package under packages/ needs at runtime is declared by the root package too, where
//      npm hoists it.
//   3. the lockfile agreeing with package.json, which `npm install` on the host silently repairs and
//      `npm ci` in CI refuses.
//   4. what the host is told to check before it moves traffic to a new deployment (railway.json). A
//      release that cannot boot must never replace the one that can, so the path it asks has to be a
//      public route the server really has — and the file may set nothing else: config in the repository
//      overrides the dashboard, so a stray `startCommand` or `builder` there changes production.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const exists = f => fs.existsSync(path.join(ROOT, f));

// The Node range production builds with. Railpack resolves "22.x" to the latest 22.x. It was ">=18.0.0"
// (Node 18.20.8) until the release that added the healthcheck. Moving it again is a release of its own.
const PRODUCTION_NODE = '22.x';

const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const pkg = read('package.json');
const lock = read('package-lock.json');

// ── 1. the Node version ─────────────────────────────────────────────────────────────────────────
check(`production's Node is chosen by package.json engines, and it is ${PRODUCTION_NODE}`, pkg.engines && pkg.engines.node === PRODUCTION_NODE, JSON.stringify(pkg.engines));
const IDIOMATIC = ['.nvmrc', '.node-version', '.tool-versions', 'mise.toml', '.mise.toml', 'mise.local.toml', '.config/mise.toml'];
const present = IDIOMATIC.filter(exists);
check('no version file sits beside it to override it (Railpack hands those to mise)', present.length === 0, present.join(', '));
// Every actions/setup-node step, one by one (a step runs from its "- uses:" line to the next line that
// is not indented deeper than the dash).
const setupNode = [];
for (const f of fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter(n => /\.ya?ml$/.test(n))) {
  const lines = fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/uses:\s*actions\/setup-node@/.test(line)) return;
    const dash = line.indexOf('- ');
    const body = [line];
    for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/) > dash); j++) body.push(lines[j]);
    setupNode.push({ f, step: body.join('\n') });
  });
}
const notFromEngines = setupNode.filter(s => !/node-version-file:\s*package\.json/.test(s.step));
check('CI reads its Node from the same engines line, so the suites run on what production runs on', setupNode.length > 0 && notFromEngines.length === 0, notFromEngines.map(s => s.f).join(', ') || `${setupNode.length} setup-node steps`);
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

// ── 4. what the host is told to check before it moves traffic ───────────────────────────────────
const railway = exists('railway.json') ? read('railway.json') : null;
check('railway.json exists', !!railway);
const HEALTH = '/api/v1/health';
check('…it asks the host to check ' + HEALTH + ' before a new deployment takes traffic', !!railway && !!railway.deploy && railway.deploy.healthcheckPath === HEALTH, JSON.stringify(railway && railway.deploy));
const timeout = railway && railway.deploy && railway.deploy.healthcheckTimeout;
check('…with a timeout that fails a bad release quickly yet is many times a normal boot (seconds)', Number.isInteger(timeout) && timeout >= 30 && timeout <= 300, String(timeout));
const stray = railway ? Object.keys(railway).filter(k => k !== '$schema' && k !== 'deploy').concat(Object.keys(railway.deploy || {}).filter(k => !['healthcheckPath', 'healthcheckTimeout'].includes(k))) : [];
check('…and it sets nothing else (config in the repository overrides the dashboard: builder, start command, replicas, restart policy stay where they are unless this test is changed on purpose)', stray.length === 0, stray.join(', '));
const v1 = fs.readFileSync(path.join(ROOT, 'tools', 'routes.v1.snapshot.txt'), 'utf8').split('\n');
check('the path it asks is a route the server really has, public (no guard in front of it), asked with GET', v1.includes('GET ' + HEALTH + ' []'), v1.filter(l => l.includes(HEALTH)).join(' | ') || 'not in tools/routes.v1.snapshot.txt');

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
