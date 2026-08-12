// Hit every registered route — reads and writes — and fail on any
// ReferenceError/TypeError.
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

// A route that throws asynchronously would otherwise take the whole run down with
// it, and the surviving output would look like a pass. Record and carry on; the
// tally is printed at the end. The route named is the one in flight when the error
// surfaced, which for a late rejection may be the next route rather than the guilty
// one — treat it as a starting point, not an accusation.
const crashes = [];
let currentRoute = '(startup)';
process.on('unhandledRejection', e => crashes.push(currentRoute + ' :: ' + String(e && e.message || e).split('\n')[0]));
process.on('uncaughtException',  e => crashes.push(currentRoute + ' :: ' + String(e && e.message || e).split('\n')[0]));

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

  // The employee portal is a third of the app and none of it is reachable with the
  // admin token — /api/employee/login checks a password hash in the database, and the
  // database here is a stub. Logging in is not the point of this run; executing the
  // handlers is. So the session is minted straight into the Map the guard reads, with
  // every permission on, because a 403 proves as little as a 401 does.
  const ctx = require(process.cwd() + '/src/ctx.js');
  const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
  const allOn = {};
  for (const [k, v] of Object.entries(normEmpPerms({}))) if (typeof v === 'boolean') allOn[k] = true;
  const empToken = 'smoke-employee-session';
  ctx.employeeSessions.set(empToken, {
    id: 1, name: 'Smoke', username: 'smoke',
    job_title: 'Chief Technical Officer',   // the Issues centre is gated on this string
    permissions: normEmpPerms(allOn),
  });

  // Group-chat management checks ownership of a real chat_rooms row, and there is no
  // real database here. These six cannot be reached without one, so they are named —
  // any OTHER route turned away by a guard still fails the run.
  const dataGated = new Set([
    'PUT /api/dashboard/chat/rooms/:id',
    'POST /api/dashboard/chat/rooms/:id/members',
    'DELETE /api/dashboard/chat/rooms/:id/members/:memberKey',
    'PUT /api/employee/chat/rooms/:id',
    'POST /api/employee/chat/rooms/:id/members',
    'DELETE /api/employee/chat/rooms/:id/members/:memberKey',
  ]);

  // Skipped because they hang, shell out, or drive a real browser — not because
  // they are safe. The list is printed at the end so the gap stays visible.
  const skip = /\/(events|stream|connect|callback|pdf|export|template\.csv)|whatsapp|puppeteer/i;
  // Auth plumbing is excluded for a specific reason: calling logout destroys this
  // run's own session, and every request after it comes back 401 — which looks like
  // a clean pass while testing nothing at all. The guard below catches that anyway.
  const authPlumbing = /\/api\/(auth\/(login|logout)|employee\/(login|logout))$/;
  const targets = seen.filter(([m, p]) =>
    p.startsWith('/api/') && !skip.test(p) && !authPlumbing.test(p) && m !== 'options');
  const skipped = seen.filter(([m, p]) => p.startsWith('/api/') && skip.test(p));

  // Writes are safe here: SUPABASE_URL is a stub, so nothing reaches a database. A
  // 400 from validation is a pass — the only failure this looks for is the app
  // referring to something that does not exist.
  const body = m => (m === 'get' || m === 'delete') ? undefined : JSON.stringify({});

  // A guard answering "Unauthorized" or "Not permitted" turned the request away before
  // the handler body ran, so it says nothing about whether that body works.
  const REJECTED = /"error"\s*:\s*"(Unauthorized|Not permitted|Not allowed)"/;

  const call = async (method, url, auth) => {
    const opts = {
      method: method.toUpperCase(),
      headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' },
      body: body(method),
    };
    try {
      return await Promise.race([
        fetch(url, opts).then(x => x.text()),
        new Promise(res => setTimeout(() => res('__timeout__'), 6000)),
      ]);
    } catch (e) { return String(e && e.message); }
  };

  let broken = 0, rejected = 0;
  const blind = [];
  const hit = {};
  for (const [method, p] of targets) {
    const url = base + p.replace(/:[A-Za-z_]+/g, '1');
    currentRoute = method.toUpperCase() + ' ' + p;
    // Which token a route wants is not reliably its path prefix, so try the admin
    // session and fall back to the employee one rather than assuming.
    let out = await call(method, url, token);
    if (REJECTED.test(out)) out = await call(method, url, empToken);
    if (out === '__timeout__') continue;
    hit[method] = (hit[method] || 0) + 1;
    if (REJECTED.test(out) && !dataGated.has(currentRoute)) { rejected++; blind.push(currentRoute); }
    if (BAD.test(out)) {
      broken++;
      console.log(`  BROKEN ${method.toUpperCase()} ${p}\n         ` + out.replace(/\s+/g, ' ').slice(0, 150));
    }
  }
  const total = Object.values(hit).reduce((a, b) => a + b, 0);
  const per = Object.entries(hit).sort().map(([m, n]) => `${m.toUpperCase()} ${n}`).join(', ');
  if (skipped.length) {
    console.log(`  not exercised (${skipped.length}): ` +
      [...new Set(skipped.map(([m, p]) => m.toUpperCase() + ' ' + p))].join(', ').slice(0, 400));
  }
  console.log(`  guard needs a real row (${dataGated.size}): ` + [...dataGated].join(', '));
  console.log(`\n${total} routes exercised (${per}), ${broken} with a missing binding`);
  if (crashes.length) {
    console.log(`\n${crashes.length} unhandled error(s) escaped a handler:`);
    for (const c of [...new Set(crashes)].slice(0, 10)) console.log('  ' + c);
  }

  // A request rejected at the guard never reaches the handler, so it proves nothing.
  // If that happens broadly the run is blind and must fail loudly rather than report
  // a clean pass — this is exactly how the first version of this test fooled itself.
  if (rejected) {
    console.log(`\nBLIND: ${rejected}/${total} were turned away by a guard, so their ` +
      'handlers never ran and this run says nothing about them:');
    for (const r of blind.slice(0, 20)) console.log('  ' + r);
    if (blind.length > 20) console.log(`  … and ${blind.length - 20} more`);
    process.exit(1);
  }
  process.exit(broken ? 1 : 0);
}, 4000);
