// Every route the app registers, in registration order — the fingerprint of the API.
//
//   node tools/route-inventory.js out.txt [--v1 out-v1.txt]   dump (legacy routes → out.txt; /api/v1 routes, each with the
//                                                             guards in front of its handler, → out-v1.txt when asked for)
//   node tools/route-inventory.js --check                     compare with the committed snapshots; exit 1 and say how they differ
//   node tools/route-inventory.js --check --append-only       …allowing new routes: the snapshot must still be an in-order subsequence
//   node tools/route-inventory.js --write                     regenerate tools/routes.snapshot.txt and tools/routes.v1.snapshot.txt
//
// tools/routes.snapshot.txt was taken before index.js was split into src/routes/* and is byte-identical
// to what the modular version registers. Regenerate it only when routes genuinely change, and say so in the
// commit. Order is load-bearing — /huddle/ice must stay ahead of /huddle/:roomId — so this is a sequence,
// not a set. /api/v1 (src/http/mount-v1.js) is mounted in a final pass after every legacy route and is
// fingerprinted separately, with its guards: a v1 route that lost its `requireActor` shows up here.
// bash tests/run.sh runs `--check`.
const fs = require('fs');
const path = require('path');

const SNAPSHOT = path.join(__dirname, 'routes.snapshot.txt');
const SNAPSHOT_V1 = path.join(__dirname, 'routes.v1.snapshot.txt');
const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const after = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };

const CHECK = flag('--check');
const WRITE = flag('--write');
const APPEND_ONLY = flag('--append-only');
const outFile = !CHECK && !WRITE ? argv.find(a => !a.startsWith('--') && a !== after('--v1')) : undefined;
if (!CHECK && !WRITE && !outFile) {
  console.error('usage: node tools/route-inventory.js out.txt [--v1 out-v1.txt] | --check [--append-only] | --write');
  process.exit(2);
}

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CHAT_ENABLED = '1';
process.env.PORT = process.env.PORT || '3999';

// Truncate first: if index.js throws, an old dump left on disk would make the
// before/after diff pass while the app is actually broken.
if (outFile) fs.writeFileSync(outFile, '');
const receiver = require(process.cwd() + '/index.js');

// Is `old` an in-order subsequence of `now`? (Returns the first line of `old` that is not found, or null.)
function firstMissing(old, now) {
  let i = 0;
  for (const line of old) {
    while (i < now.length && now[i] !== line) i++;
    if (i >= now.length) return line;
    i++;
  }
  return null;
}

// How two lists differ, for a human: the first line that is not where it was.
function describe(name, old, now, appendOnly) {
  if (appendOnly) {
    const miss = firstMissing(old, now);
    return miss === null ? null : `${name}: "${miss}" is gone, or no longer comes after the lines before it`;
  }
  if (old.length === now.length && old.every((l, i) => l === now[i])) return null;
  const at = old.findIndex((l, i) => l !== now[i]);
  const i = at < 0 ? Math.min(old.length, now.length) : at;
  return `${name}: ${old.length} routes recorded, ${now.length} registered; first difference at line ${i + 1}: recorded "${old[i] ?? '(end)'}", registered "${now[i] ?? '(end)'}"`;
}

setTimeout(() => {
  const legacy = [];
  const v1 = [];
  const walk = (stack, depth) => {
    for (const layer of stack || []) {
      if (layer.route) {
        const handlers = layer.route.stack || [];
        const guards = handlers.slice(0, -1).map(h => h.name || 'anonymous');
        for (const m of Object.keys(layer.route.methods)) {
          if (!layer.route.methods[m]) continue;
          const line = m.toUpperCase() + ' ' + layer.route.path;
          if (layer.route.path.startsWith('/api/v1/')) v1.push(`${line} [${guards.join(', ')}]`);
          else legacy.push(line);
        }
      } else if (layer.handle && layer.handle.stack && depth < 6) {
        walk(layer.handle.stack, depth + 1);
      } else {
        legacy.push('USE ' + (layer.name || 'anonymous'));
      }
    }
  };
  const app = receiver.app;
  walk((app._router || app.router || {}).stack, 0);
  const text = list => (list.length ? list.join('\n') + '\n' : '');
  const lines = f => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) : []);

  // Straight to files: the app logs to stdout on boot and would pollute the dump
  if (WRITE) {
    fs.writeFileSync(SNAPSHOT, text(legacy));
    fs.writeFileSync(SNAPSHOT_V1, text(v1));
    console.log(`wrote ${legacy.length} routes to tools/routes.snapshot.txt and ${v1.length} to tools/routes.v1.snapshot.txt`);
    process.exit(0);
  }
  if (CHECK) {
    const problems = [
      describe('routes.snapshot.txt', lines(SNAPSHOT), legacy, APPEND_ONLY),
      describe('routes.v1.snapshot.txt', lines(SNAPSHOT_V1), v1, APPEND_ONLY),
    ].filter(Boolean);
    if (problems.length) {
      console.log('ROUTES CHANGED — review, then regenerate with: node tools/route-inventory.js --write');
      for (const p of problems) console.log('  ' + p);
      process.exit(1);
    }
    console.log(`inventory matches the snapshots (${legacy.length} routes + ${v1.length} under /api/v1${APPEND_ONLY ? ', append-only' : ''})`);
    process.exit(0);
  }
  fs.writeFileSync(outFile, text(legacy));
  const v1File = after('--v1');
  if (v1File) fs.writeFileSync(v1File, text(v1));
  process.exit(0);
}, 3500);
