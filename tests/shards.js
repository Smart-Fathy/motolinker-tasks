// The suites are split over machines in CI; this holds that split to account.
//
// CI runs `bash tests/run.sh --shard I/N` for I = 1..N, side by side on N machines (the suites use fixed
// ports, so they can only be parallel across machines, never on one). The failure to fear is silent: a suite
// that lands in no shard simply never runs in CI and nobody notices. So this checks, from the real runner and
// the real workflow, that
//
//   1. the runner lists every suite once, by name, and `--list` runs nothing;
//   2. for several shard counts, the shards together are exactly the whole list, and no suite is in two;
//   3. the split is balanced by the weights in tests/suite-weights.json, which name only suites that exist;
//   4. the contrast audit, split in three so it can be spread, is the whole audit: parts 1/3, 2/3 and 3/3;
//   5. misuse of the flags fails instead of running something else;
//   6. the workflow's matrix is exactly shards 1..N for the N its command uses, and the job called `suite` —
//      the one name a branch rule would require — passes only when every shard did.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { plan } = require('../tools/shard-plan');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const runner = (...args) => {
  const t0 = Date.now();
  const r = spawnSync('bash', ['tests/run.sh', ...args], { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status, out: r.stdout.split('\n').filter(Boolean), err: r.stderr.trim(), ms: Date.now() - t0 };
};

// ── 1. the list ─────────────────────────────────────────────────────────────────────────────────
const all = runner('--list');
check('the runner lists its suites by name and exits 0', all.status === 0 && all.out.length > 80, `${all.out.length} suites`);
check('…each once, with a plain name', new Set(all.out).size === all.out.length && all.out.every(n => /^[a-z0-9]+$/.test(n)), all.out.filter((n, i) => all.out.indexOf(n) !== i).join(', '));
check('…including the ones that are not a `run` line, and this one', ['smoke', 'routes', 'shards', 'deployconfig'].every(n => all.out.includes(n)));
check('--list runs nothing: it answers at once', all.ms < 3000, `${all.ms} ms`);

// ── 2. the shards are a partition of the list ───────────────────────────────────────────────────
for (const n of [1, 2, 5, 8]) {
  const parts = [];
  for (let i = 1; i <= n; i++) parts.push(runner('--list', '--shard', `${i}/${n}`));
  const flat = parts.flatMap(p => p.out);
  const missing = all.out.filter(s => !flat.includes(s));
  const twice = flat.filter((s, i) => flat.indexOf(s) !== i);
  check(`${n} shard(s): together exactly the whole list, no suite in two, none empty`, parts.every(p => p.status === 0 && p.out.length > 0) && missing.length === 0 && twice.length === 0 && flat.length === all.out.length,
    `missing: ${missing.join(',') || 'none'}; twice: ${twice.join(',') || 'none'}`);
}
check('a shard keeps the order the runner lists its suites in', (() => {
  const s = runner('--list', '--shard', '3/5').out;
  const idx = s.map(n => all.out.indexOf(n));
  return idx.every((v, i) => i === 0 || idx[i - 1] < v);
})());

// ── 3. balance, and weights that mean something ─────────────────────────────────────────────────
const weights = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'suite-weights.json'), 'utf8'));
check('every weight names a suite that exists, and is a positive number of seconds', Object.entries(weights.seconds).every(([k, v]) => all.out.includes(k) && Number.isFinite(v) && v > 0) && weights.default > 0,
  Object.keys(weights.seconds).filter(k => !all.out.includes(k)).join(', '));
const five = plan(all.out, weights, 5);
const total = five.reduce((a, s) => a + s.total, 0);
const heaviest = Math.max(...five.map(s => s.total));
const heaviestUnit = Math.max(...all.out.map(n => (n in weights.seconds ? weights.seconds[n] : weights.default)));
check('five shards come out within 10% of even (or are as even as the heaviest single suite allows)', heaviest <= Math.max(total / 5 * 1.1, heaviestUnit), `${five.map(s => s.total).join(' / ')} s`);
check('a suite with no weight yet still lands in a shard (it weighs the default)', plan([...all.out, 'brandnewsuite'], weights, 5).flatMap(s => s.names).includes('brandnewsuite'));

// ── 4. the audit in three parts ─────────────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, 'tests', 'run.sh'), 'utf8');
const auditLines = src.split('\n').filter(l => /^run themeaudit\d /.test(l));
check('the contrast audit runs as parts 1/3, 2/3 and 3/3 of itself', JSON.stringify(auditLines.map(l => l.match(/--part=(\d\/\d)/)[1])) === JSON.stringify(['1/3', '2/3', '3/3']) && auditLines.every(l => /node tests\/themeaudit\.js /.test(l)), auditLines.join(' | '));
check('…and --only themeaudit still asks for all three', JSON.stringify(runner('--list', '--only', 'themeaudit').out) === JSON.stringify(['themeaudit1', 'themeaudit2', 'themeaudit3']));

// ── 5. misuse fails ─────────────────────────────────────────────────────────────────────────────
const bad = [['--shard', '0/5'], ['--shard', '6/5'], ['--shard', 'x'], ['--shard', '1/500'], ['--shard', '1/5', '--only', 'smoke'], ['--only', 'nosuchsuite'], ['--only', ''], ['--nonsense']];
const notRefused = bad.filter(a => runner('--list', ...a).status === 0);
check('a bad shard, a name that matches nothing, an empty list and an unknown flag are all refused', notRefused.length === 0, notRefused.map(a => a.join(' ')).join(' | '));

// ── 6. the workflow ─────────────────────────────────────────────────────────────────────────────
const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
const matrix = (ci.match(/matrix:\s*\n\s*shard:\s*\[([0-9,\s]+)\]/) || [])[1];
const shardsInMatrix = matrix ? matrix.split(',').map(s => Number(s.trim())) : [];
const usedN = [...ci.matchAll(/bash tests\/run\.sh --shard \$\{\{ matrix\.shard \}\}\/(\d+)/g)].map(m => Number(m[1]));
check('the workflow runs shard I of N for exactly I = 1..N', usedN.length === 1 && shardsInMatrix.length === usedN[0] && shardsInMatrix.every((v, i) => v === i + 1), `matrix [${shardsInMatrix}], command /${usedN}`);
check('…without stopping the others when one fails, so every red suite is seen at once', /fail-fast:\s*false/.test(ci));
const aggregator = (ci.match(/\n  suite:\n([\s\S]*?)(?=\n  \S|$)/) || [])[1] || '';
check('the job called `suite` waits for every shard, runs even when one failed, and passes only if all passed', /needs:\s*suite-shard/.test(aggregator) && /if:\s*always\(\)/.test(aggregator) && /needs\.suite-shard\.result/.test(aggregator) && /= "success"|== 'success'|= success/.test(aggregator));
check('…and the shard job is not itself called `suite`, so there is one check of that name', /\n  suite-shard:\n/.test(ci) && (ci.match(/\n {2}suite:\n/g) || []).length === 1);

console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
