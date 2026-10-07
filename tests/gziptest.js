// Responses go out gzipped — except the event streams, which must not be held back.
//
// Production's edge logged ~670 KB sent for every leads list and 250 KB+ for the
// portal bundle: nothing was compressed. index.js now gzips responses. The catch
// is the server-sent event streams (notifications, chat, WhatsApp, huddles): the
// compression middleware counts text/event-stream as compressible, and gzip holds
// bytes back until it has a block to pack — so a notification would sit in the
// buffer instead of reaching the browser. Those streams are filtered out, and
// this checks an event written mid-stream still arrives at once.
process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
process.env.PORT = process.env.PORT || '3995';

const fs = require('fs'), http = require('http'), zlib = require('zlib');
const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };

// A leads table the size of production's (1,054 rows, ~650 bytes each).
const LEADS = Array.from({ length: 1000 }, (_, i) => ({
  id: i + 1, name: 'Lead ' + (i + 1), phone: '010' + String(10000000 + i), email: '', source: 'fb_ad',
  lead_status: ['cold', 'warm', 'hot'][i % 3], car_in_question: 'BYD Seal', budget_lead: 1700000, budget_max: 2000000,
  notes: 'Asked about delivery dates and the trade-in offer', custom_fields: { cf_vehicle_offered: 'Seal Premium' },
  created_at: '2026-10-01T10:00:00Z', assigned_to: null,
}));
const realFetch = global.fetch;
global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!url.includes('stub.supabase.co')) return realFetch(input, init);
  const h = (init && init.headers) || {};
  const accept = String(typeof h.get === 'function' ? (h.get('Accept') || '') : (h.Accept || h.accept || ''));
  const body = accept.includes('pgrst.object') ? '{}' : (url.includes('/rest/v1/customers?') ? JSON.stringify(LEADS) : '[]');
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
};

require(process.cwd() + '/index.js');
const ctx = require(process.cwd() + '/src/ctx.js');
const { normEmpPerms } = require(process.cwd() + '/src/routes/employee-portal.js');
const PORT = Number(process.env.PORT);
ctx.employeeSessions.set('emp', { id: 7, name: 'Sara', username: 'sara', job_title: 'Sales', permissions: normEmpPerms({ leads: true }) });

// Raw GET, so the bytes on the wire are visible (fetch would decompress them).
// Browsers accept Brotli as well as gzip, and the middleware prefers Brotli.
const PACKED = ['br', 'gzip'];
const unpack = r => r.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(r.raw)
  : r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.raw) : r.raw;
function get(path, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path, headers }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, raw: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

(async () => {
  await new Promise(r => setTimeout(r, 400)); // let the server start listening
  const GZ = { 'Accept-Encoding': 'gzip, deflate, br' };

  const disk = fs.readFileSync('public/assets/employee.js');
  let r = await get('/assets/employee.js', GZ);
  c('the portal bundle goes out compressed', PACKED.includes(r.headers['content-encoding']), String(r.headers['content-encoding']));
  c('…and unpacks to the file on disk', PACKED.includes(r.headers['content-encoding']) && unpack(r).equals(disk));
  c('…at a fraction of its size', r.raw.length < disk.length / 2, `${disk.length} → ${r.raw.length} bytes`);

  r = await get('/api/employee/leads', { ...GZ, Authorization: 'Bearer emp' });
  const plain = unpack(r);
  let rows = null; try { rows = JSON.parse(plain.toString()); } catch (_) {}
  c('the leads list goes out compressed', r.status === 200 && PACKED.includes(r.headers['content-encoding']), `${r.status} ${r.headers['content-encoding']}`);
  c('…and unpacks to every lead', Array.isArray(rows) && rows.length === LEADS.length);
  c('…at under a fifth of its size', r.raw.length < plain.length / 5, `${plain.length} → ${r.raw.length} bytes`);

  r = await get('/assets/employee.js', { 'Accept-Encoding': 'gzip' });
  c('a gzip-only client gets gzip', r.headers['content-encoding'] === 'gzip' && zlib.gunzipSync(r.raw).equals(disk), String(r.headers['content-encoding']));
  r = await get('/assets/employee.js', {});
  c('a client that cannot unpack still gets plain bytes', !r.headers['content-encoding'] && r.raw.equals(disk), String(r.headers['content-encoding']));

  // The notification stream, asked for by a client that accepts gzip.
  await new Promise((resolve) => {
    const t0 = Date.now(); let gotOk = 0, gotEvent = 0, buf = '';
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/employee/notifications/stream', headers: { ...GZ, Authorization: 'Bearer emp' } }, res => {
      c('the notification stream is not compressed', !res.headers['content-encoding'], String(res.headers['content-encoding']));
      c('…and still says it is an event stream', /text\/event-stream/.test(res.headers['content-type'] || ''), res.headers['content-type']);
      let sentAt = 0;
      res.on('data', d => {
        buf += d.toString();
        if (!gotOk && buf.includes(':ok')) {
          gotOk = Date.now() - t0;
          sentAt = Date.now();
          const live = ctx.notifSseClients.get('employee_7');
          live.write('event: notification\ndata: {"title":"New lead assigned"}\n\n');
        }
        if (!gotEvent && buf.includes('New lead assigned')) {
          gotEvent = Date.now() - sentAt;
          c('the stream opens at once', gotOk < 1000, `${gotOk} ms`);
          c('an event written mid-stream arrives at once, not when a buffer fills', gotEvent < 300, `${gotEvent} ms`);
          req.destroy(); resolve();
        }
      });
    });
    setTimeout(() => { if (!gotEvent) { c('an event written mid-stream arrives at once, not when a buffer fills', false, 'nothing within 3 s'); req.destroy(); resolve(); } }, 3000);
  });

  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
