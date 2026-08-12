// Hit every registered GET route and fail on any ReferenceError/TypeError.
//
// The module split left bindings behind in code paths that only run on certain
// routes. Booting the app catches nothing — the module loads and registers its
// routes fine — and probing one route per module missed eleven of them, including
// the chat room list. So: exercise all of them.
//
// Database errors are expected and ignored (the Supabase URL here is a stub). What
// this looks for is the app referring to something that does not exist.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.GOOGLE_CLIENT_ID = 'cid';
process.env.PORT = process.env.PORT || '3996';

const BAD = /ReferenceError|is not defined|is not a function|Cannot read properties of undefined/;
const receiver = require(process.cwd() + '/index.js');

const seen = [];
setTimeout(async () => {
  const walk = (stack) => {
    for (const l of stack || []) {
      if (l.route) { for (const m of Object.keys(l.route.methods)) if (l.route.methods[m]) seen.push([m, l.route.path]); }
      else if (l.handle && l.handle.stack) walk(l.handle.stack);
    }
  };
  const app = receiver.app;
  walk((app._router || app.router || {}).stack);

  const base = 'http://127.0.0.1:' + process.env.PORT;
  const { token } = await (await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();

  // Only GETs, and nothing that streams forever or drives a browser
  const skip = /\/(events|stream|connect|callback|pdf|export|template\.csv)|whatsapp|puppeteer/i;
  const targets = seen.filter(([m, p]) => m === 'get' && p.startsWith('/api/') && !skip.test(p));

  let broken = 0, hit = 0;
  for (const [, p] of targets) {
    const url = base + p.replace(/:[A-Za-z_]+/g, '1');
    let body = '';
    try {
      const r = await Promise.race([
        fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(x => x.text()),
        new Promise(res => setTimeout(() => res('__timeout__'), 6000)),
      ]);
      body = r;
    } catch (e) { body = String(e && e.message); }
    if (body === '__timeout__') continue;
    hit++;
    if (BAD.test(body)) { broken++; console.log('  BROKEN ' + p + '\n         ' + body.replace(/\s+/g, ' ').slice(0, 150)); }
  }
  console.log(`\n${hit} GET routes exercised, ${broken} with a missing binding`);
  process.exit(broken ? 1 : 0);
}, 4000);
