#!/usr/bin/env node
// The web app's unit tests (Vitest, apps/web) as the one line tests/run.sh prints for a suite:
//   N/N web unit checks passed
// A failing run lists the checks that failed, then the same line, and exits non-zero.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ml-vitest-')), 'result.json');
const run = spawnSync(process.execPath, [path.join(root, 'node_modules', 'vitest', 'vitest.mjs'), 'run', '--reporter=json', '--outputFile=' + out], {
  cwd: path.join(root, 'apps', 'web'),
  encoding: 'utf8',
  maxBuffer: 1 << 26,
});

let result;
try {
  result = JSON.parse(fs.readFileSync(out, 'utf8'));
} catch (_) {
  console.log((run.stdout || '') + (run.stderr || ''));
  console.log('0/0 web unit checks passed (Vitest produced no result)');
  process.exit(1);
}
fs.rmSync(path.dirname(out), { recursive: true, force: true });

const failed = (result.testResults || []).flatMap(file => (file.assertionResults || []).filter(t => t.status === 'failed').map(t => `  FAIL ${path.relative(root, file.name)}: ${t.fullName}\n${(t.failureMessages || []).join('\n').split('\n').slice(0, 6).join('\n')}`));
const crashed = (result.testResults || []).filter(f => f.status === 'failed' && !(f.assertionResults || []).length).map(f => `  FAIL ${path.relative(root, f.name)}: ${f.message || 'the file did not run'}`);
for (const line of [...failed, ...crashed]) console.log(line);
console.log(`${result.numPassedTests}/${result.numTotalTests} web unit checks passed`);
process.exit(result.success && !crashed.length ? 0 : 1);
