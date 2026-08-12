// Every route the app registers, in registration order.
//
//   node tools/route-inventory.js out.txt && diff tools/routes.snapshot.txt out.txt
//
// tools/routes.snapshot.txt was taken before index.js was split into src/routes/*
// and is byte-identical to what the modular version registers. Regenerate it only
// when routes genuinely change, and say so in the commit. Order is load-bearing —
// /huddle/ice must stay ahead of /huddle/:roomId — so this is a sequence, not a set.
// Used as a before/after fingerprint across the restructure.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.GOOGLE_CHAT_ENABLED = '1';
process.env.PORT = process.env.PORT || '3999';

// Truncate first: if index.js throws, an old dump left on disk would make the
// before/after diff pass while the app is actually broken.
require('fs').writeFileSync(process.argv[2], '');
const receiver = require(process.cwd() + '/index.js');

setTimeout(() => {
  const out = [];
  const walk = (stack, depth) => {
    for (const layer of stack || []) {
      if (layer.route) {
        for (const m of Object.keys(layer.route.methods)) {
          if (layer.route.methods[m]) out.push(m.toUpperCase() + ' ' + layer.route.path);
        }
      } else if (layer.handle && layer.handle.stack && depth < 6) {
        walk(layer.handle.stack, depth + 1);
      } else {
        out.push('USE ' + (layer.name || 'anonymous'));
      }
    }
  };
  const app = receiver.app;
  walk((app._router || app.router || {}).stack, 0);
  // Straight to a file: the app logs to stdout on boot and would pollute the dump
  require('fs').writeFileSync(process.argv[2], out.join('\n') + '\n');
  process.exit(0);
}, 3500);
