#!/usr/bin/env node
// Which suites run on shard I of N. `bash tests/run.sh --shard I/N` asks this; CI runs the N shards side by
// side, one machine each, so the suite takes as long as its heaviest shard instead of the sum of them all.
//
//   bash tests/run.sh --list | node tools/shard-plan.js I N         the I-th shard's suite names, comma-separated
//   bash tests/run.sh --list | node tools/shard-plan.js --table N   every shard with its expected seconds
//
// The suites are dealt out longest first, each to the shard that is lightest so far (greedy bin packing:
// deterministic, and within a few percent of even), by the seconds in tests/suite-weights.json. A suite that
// is not listed there weighs `default`, so a new suite is never left out of every shard — it may only land on
// a slightly heavier one until somebody adds its weight (CI prints the seconds every suite took). Within a
// shard the suites keep the order tests/run.sh lists them in.
const fs = require('fs');
const path = require('path');

const WEIGHTS_FILE = path.join(__dirname, '..', 'tests', 'suite-weights.json');

/**
 * @param {string[]} names the suites, in run order
 * @param {{ default: number, seconds: Record<string, number> }} weights
 * @param {number} n how many shards
 * @returns {{ total: number, names: string[] }[]} one entry per shard, shard 1 first
 */
function plan(names, weights, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('the number of shards must be a whole number, 1 or more');
  if (n > names.length) throw new Error(`${n} shards for ${names.length} suites: a shard would have nothing to run`);
  const weightOf = name => (name in (weights.seconds || {}) ? weights.seconds[name] : weights.default);
  const shards = Array.from({ length: n }, () => ({ total: 0, units: [] }));
  const longestFirst = names
    .map((name, order) => ({ name, order, w: weightOf(name) }))
    .sort((a, b) => b.w - a.w || a.order - b.order);
  for (const unit of longestFirst) {
    let lightest = shards[0];
    for (const s of shards) if (s.total < lightest.total) lightest = s;
    lightest.units.push(unit);
    lightest.total += unit.w;
  }
  return shards.map(s => ({ total: s.total, names: s.units.sort((a, b) => a.order - b.order).map(u => u.name) }));
}

const readWeights = () => JSON.parse(fs.readFileSync(WEIGHTS_FILE, 'utf8'));

if (require.main === module) {
  const fail = msg => {
    console.error('shard-plan: ' + msg);
    process.exit(2);
  };
  const args = process.argv.slice(2);
  const names = fs.readFileSync(0, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
  try {
    if (args[0] === '--table') {
      const shards = plan(names, readWeights(), Number(args[1]));
      shards.forEach((s, i) => console.log(`shard ${i + 1}/${shards.length}  ${String(s.total).padStart(4)} s  ${s.names.join(' ')}`));
    } else {
      const [i, n] = [Number(args[0]), Number(args[1])];
      if (!Number.isInteger(i) || i < 1 || i > n) fail('usage: shard-plan.js I N   (1 <= I <= N), suite names on stdin');
      console.log(plan(names, readWeights(), n)[i - 1].names.join(','));
    }
  } catch (e) {
    fail(e.message);
  }
}

module.exports = { plan };
