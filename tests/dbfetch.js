// Supabase queries have to reuse their connections.
//
// Production measured what happened when they didn't. Node's fetch closes an idle
// connection after 4 s, the Cloudflare edge in front of Supabase sends no
// Keep-Alive hint to stretch that, and staff click far less often than every 4 s —
// so nearly every query paid DNS, TCP and TLS again. A presence upsert Postgres
// answers in ~1 ms took ~850 ms after a quiet half-minute, and a lead save is
// several queries in a row. src/lib/db-fetch.js keeps the connections for a minute.
//
// The fake Supabase here behaves like that edge: it never closes an idle socket
// and sends no Keep-Alive hint, so the client's own idle limit is the only one in
// play. The same round of queries runs twice with five idle seconds between, and
// the second round must not open a single new connection. Node's plain fetch is
// put through the same rounds alongside, so the test shows it reproduces the
// problem rather than passing against a server that would have reused anyway.
const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const { dbFetch, dbAgent, KEEP_ALIVE_MS } = require('../src/lib/db-fetch');

const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const KEY = 'service-key-for-tests';

function fakeSupabase() {
  const seen = { connections: 0, requests: [] };
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      let out;
      if (req.url.startsWith('/storage/v1/object/')) out = { Key: req.url.slice('/storage/v1/object/'.length), Id: 'obj-1' };
      else if (req.method === 'GET') out = [{ id: 1, name: 'Ahmed Kamal' }];
      else out = { id: 7, ...JSON.parse(body.toString() || '{}') };
      const json = JSON.stringify(out);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
      res.end(json);
    });
  });
  // 0 = never close an idle socket, and (in Node) send no Keep-Alive header.
  srv.keepAliveTimeout = 0;
  srv.on('connection', () => { seen.connections++; });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, seen, url: `http://127.0.0.1:${srv.address().port}` })));
}

// What one lead save and its follow-ups send: a read, an insert, an update,
// and a chat-file upload (multer hands those over as raw Buffers).
const BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
async function round(sb) {
  return {
    read: await sb.from('customers').select('*'),
    ins: await sb.from('customers').insert({ name: 'Mona Said', phone: '0101' }).select().single(),
    upd: await sb.from('customers').update({ lead_status: 'hot' }).eq('id', 7).select().single(),
    up: await sb.storage.from('chat-files').upload('t/a.png', BYTES, { contentType: 'image/png', upsert: false }),
  };
}

(async () => {
  const probe = await fakeSupabase();
  const hint = await fetch(probe.url + '/rest/v1/customers?select=*');
  c('the fake edge sends no Keep-Alive hint, like the real one', hint.headers.get('keep-alive') === null, String(hint.headers.get('keep-alive')));
  await hint.text(); probe.srv.close();

  const plain = await fakeSupabase(), pooled = await fakeSupabase();
  const sbPlain = createClient(plain.url, KEY);                                     // what production ran
  const sbPooled = createClient(pooled.url, KEY, { global: { fetch: dbFetch } });   // what it runs now

  const [, a] = await Promise.all([round(sbPlain), round(sbPooled)]);
  const warm = { plain: plain.seen.connections, pooled: pooled.seen.connections };

  // Everything a save needs still works through the custom fetch.
  c('a read returns rows', !a.read.error && Array.isArray(a.read.data) && a.read.data[0].name === 'Ahmed Kamal', a.read.error && a.read.error.message);
  c('an insert returns the row', !a.ins.error && a.ins.data && a.ins.data.name === 'Mona Said', a.ins.error && a.ins.error.message);
  const insReq = pooled.seen.requests.find(r => r.method === 'POST' && r.url.startsWith('/rest/'));
  c('…sent with the service key as apikey and bearer',
    !!insReq && insReq.headers.apikey === KEY && insReq.headers.authorization === 'Bearer ' + KEY);
  c('…and its JSON body intact', !!insReq && JSON.parse(insReq.body.toString()).phone === '0101');
  c('an update returns the row', !a.upd.error && a.upd.data && a.upd.data.lead_status === 'hot', a.upd.error && a.upd.error.message);
  const updReq = pooled.seen.requests.find(r => r.method === 'PATCH');
  c('…filtered by id', !!updReq && /[?&]id=eq\.7(&|$)/.test(updReq.url), updReq && updReq.url);
  const upReq = pooled.seen.requests.find(r => r.url.startsWith('/storage/'));
  c('a storage upload of a Buffer arrives byte for byte',
    !a.up.error && !!upReq && Buffer.compare(upReq.body, BYTES) === 0, a.up.error && a.up.error.message);
  c('…with its content type', !!upReq && upReq.headers['content-type'] === 'image/png', upReq && upReq.headers['content-type']);

  await sleep(5000); // past the 4 s idle limit of Node's own fetch
  await Promise.all([round(sbPlain), round(sbPooled)]);
  c('control: after 5 s idle, Node\'s plain fetch connected all over again — the production symptom',
    plain.seen.connections > warm.plain, `${warm.plain} → ${plain.seen.connections} connection(s)`);
  c('after the same 5 s, the pooled fetch opened no new connection',
    pooled.seen.connections === warm.pooled, `${warm.pooled} → ${pooled.seen.connections} connection(s)`);
  c('idle connections are kept for a minute', KEEP_ALIVE_MS === 60_000);

  await dbAgent.close().catch(() => {});
  plain.srv.close(); pooled.srv.close();
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
