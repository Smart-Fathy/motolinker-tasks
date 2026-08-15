// The live streams: legal over HTTP/2, immortal on the server, self-healing on
// the client.
//
// Production symptom: net::ERR_HTTP2_PROTOCOL_ERROR on the notification stream.
// Three independent defects added up — a Connection header (illegal in h2, the
// edge resets the stream), Node's default 5-minute requestTimeout destroying
// every stream mid-flight, and clients with no error handler at all, so the
// first refused reconnect silenced chat and notifications for the session.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3991';

const fs = require('fs');
const results = [];
const c = (n, ok, x) => { results.push(ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  return new Response(accept.includes('pgrst.object') ? '{}' : '[]',
    { status: 200, headers: { 'Content-Type': 'application/json' } });
};

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
const base = 'http://127.0.0.1:' + process.env.PORT;
const http = require('http');

// A raw HTTP client so response headers are inspectable (fetch would eat them).
function openStream(path, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(base + path, { headers: { Authorization: 'Bearer ' + token } }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(String(d)));
      resolve({ res, req, read: () => chunks.join('') });
    });
    req.on('error', reject);
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

setTimeout(async () => {
  const { token } = await (await fetch(base + '/api/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.ADMIN_USERNAME || 'admin', password: 'pw' }) })).json();

  const allOn = {};
  for (const [k, v] of Object.entries(normEmpPerms({}))) if (typeof v === 'boolean') allOn[k] = true;
  ctx.employeeSessions.set('sse-emp', { id: 3, name: 'S', username: 's', job_title: '', permissions: normEmpPerms(allOn) });

  // ── 1. No connection-specific headers on any stream ─────────────────────────
  // RFC 9113 §8.2.2: a Connection header makes the h2 message malformed; the
  // Railway edge answered ours with a stream reset — the reported error.
  for (const [name, path, tk] of [
    ['admin notifications', '/api/dashboard/notifications/stream', token],
    ['employee notifications', '/api/employee/notifications/stream', 'sse-emp'],
    ['admin chat', '/api/dashboard/chat/events', token],
    ['employee chat', '/api/employee/chat/events', 'sse-emp'],
    ['whatsapp', '/api/dashboard/whatsapp/events', token],
  ]) {
    const { res, req } = await openStream(path, tk);
    // Node adds its own hop-by-hop Connection header on plain h1 — that is fine
    // and stripped by any h2 proxy. What broke production was the APP setting
    // one explicitly via res.set, asserted against the source below. Here we
    // check the stream opens and speaks SSE.
    c(`${name}: stream opens and speaks SSE`,
      res.statusCode === 200 && String(res.headers['content-type']).startsWith('text/event-stream'),
      JSON.stringify({ ct: res.headers['content-type'], status: res.statusCode }));
    req.destroy();
  }
  const src = [fs.readFileSync('src/routes/notif-streams.js', 'utf8'),
               fs.readFileSync('src/routes/notifications.js', 'utf8'),
               fs.readFileSync('src/routes/whatsapp.js', 'utf8'),
               fs.readFileSync('index.js', 'utf8')].join('\n');
  c("the app never sets a Connection header on a stream",
    !/['"]Connection['"]\s*:\s*['"]keep-alive['"]/.test(src));
  c('all four endpoints share one header set', (src.match(/res\.set\(ctx\.SSE_HEADERS\)/g) || []).length >= 4);

  // ── 2. The server no longer beheads streams at five minutes ─────────────────
  const server = ctx.httpServer;
  c('the HTTP server is captured and its requestTimeout lifted',
    !!server && server.requestTimeout === 0,
    server ? `requestTimeout=${server.requestTimeout}` : 'no ctx.httpServer');
  c('…with keepalive above the edge idle window',
    !!server && server.keepAliveTimeout >= 60_000, server && String(server.keepAliveTimeout));

  // ── 3. Eviction guard: a stale socket closing must not evict the live one ───
  {
    const first = await openStream('/api/employee/notifications/stream', 'sse-emp');
    await sleep(150);
    const second = await openStream('/api/employee/notifications/stream', 'sse-emp');
    await sleep(150);
    first.req.destroy();          // the OLD tab closes after the new one took over
    await sleep(250);
    ctx.createNotification('employee_3', { type: 'request', title: 'Still alive?', body: '', url: '/x' }, false);
    await sleep(350);
    // The stubbed DB strips the payload down to an id — the point here is only
    // that an event arrives on the NEWER socket after the older one closed.
    c('a notification still reaches the newer stream after the old one closes',
      /event: notification/.test(second.read()), second.read().slice(-120).replace(/\n/g, '\\n'));
    second.req.destroy();
  }

  // ── 4. The clients heal themselves ──────────────────────────────────────────
  const dash = fs.readFileSync('public/assets/dashboard.js', 'utf8');
  const emp = fs.readFileSync('public/assets/employee.js', 'utf8');
  const extras = fs.readFileSync('public/assets/chat-extras.js', 'utf8');
  c('the reconnect wrapper exists in the shared layer',
    /function chatStream\(makeUrl, wire\)/.test(extras) && /EventSource\.CLOSED/.test(extras));
  c('no bare EventSource remains in either bundle',
    !/new EventSource\(/.test(dash) && !/new EventSource\(/.test(emp));
  c('every stream in both portals goes through the wrapper',
    (dash.match(/chatStream\(\(\) =>/g) || []).length === 3
    && (emp.match(/chatStream\(\(\) =>/g) || []).length === 2,
    `dash=${(dash.match(/chatStream\(\(\) =>/g) || []).length} emp=${(emp.match(/chatStream\(\(\) =>/g) || []).length}`);
  c('the wrapper backs off instead of hammering a restarting server',
    /delay = Math\.min\(delay \* 2, 60000\)/.test(extras));

  console.log('\n' + results.filter(Boolean).length + '/' + results.length + ' passed');
  process.exit(results.every(Boolean) ? 0 : 1);
}, 1200);
