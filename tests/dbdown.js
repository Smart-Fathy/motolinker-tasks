// A database that stops answering no longer takes the whole site down with it.
//
// The outage (28 Oct): Supabase's database stalled, and every query hung until the
// gateway in front of it gave up with a 504, two to five minutes later. Boot waited on
// four such queries before it opened the port, so the deploy that went out during the
// outage had no port open for twelve and a half minutes and Railway answered every
// visitor with "Application failed to respond" — for the pages as well, which need no
// database.
//
// Two things rode along. The push-key read that failed fell through to making a new key
// pair, served at once and written over the stored one (that write went out at 07:43
// UTC and met a 504 too) — had it landed, push would have stopped on every device
// subscribed with the old key, for good. And the Google tokens, whose read failed the
// same way, stayed unloaded until the next deploy.
//
// This boots the real app against a database that holds every query, then lets the
// queries fail as the gateway did, then lets the database recover.
const { spawnSync } = require('child_process');
const webpush = require('web-push');
const { createFakeSupabase } = require('./helpers/fake-supabase');

const results = [];
const c = (n, ok, x) => { results.push(!!ok); console.log((ok ? '  ok  ' : ' FAIL ') + n + (x ? '  ' + x : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub';
process.env.ADMIN_PASSWORD = 'pw';
delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;   // the pair lives in the database
const FIRST_BOOT = process.argv.includes('--first-boot');
process.env.PORT = FIRST_BOOT ? '3964' : (process.env.PORT || '3963');
const base = 'http://127.0.0.1:' + process.env.PORT;
const pushKey = async () => (await (await fetch(base + '/api/push/vapid-public-key')).json()).key;

if (FIRST_BOOT) firstBoot(); else outage();

// ── The outage, end to end ───────────────────────────────────────────────────────
async function outage() {
  const stored = webpush.generateVAPIDKeys();
  const drive = { refresh_token: 'drive-refresh', access_token: 'drive-access' };
  const db = createFakeSupabase({
    google_tokens: [{ user_key: 'vapid', tokens: stored }, { user_key: 'admin_drive', tokens: drive }],
    quotation_settings: [], sessions: [], push_subscriptions: [],
  });
  db.install();

  // 'stalled' holds a query until the test lets go of it; 'gateway' answers the way
  // Supabase's gateway did once it gave up; 'healthy' reaches the database.
  let mode = 'stalled';
  const held = [], asked = [];
  const viaDb = global.fetch;
  const gatewayTimeout = () => new Response('upstream request timeout', { status: 504, headers: { 'Content-Type': 'text/plain' } });
  global.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!url.includes('stub.supabase.co')) return viaDb(input, init);
    asked.push({ method: String((init && init.method) || 'GET').toUpperCase(), url });
    if (mode === 'healthy') return viaDb(input, init);
    if (mode === 'gateway') return Promise.resolve(gatewayTimeout());
    return new Promise(resolve => held.push(() => resolve(mode === 'healthy' ? viaDb(input, init) : gatewayTimeout())));
  };
  const vapidReads = () => asked.filter(a => a.method === 'GET' && /google_tokens.*user_key=eq\.vapid/.test(a.url)).length;
  const tokenWrites = () => asked.filter(a => a.method !== 'GET' && /\/google_tokens/.test(a.url)).length;

  const started = Date.now();
  require(process.cwd() + '/index.js');
  const ctx = require(process.cwd() + '/src/ctx');

  // ── The database holds every query: the site still opens ─────────────────────
  let page = null;
  for (let i = 0; i < 200 && !page; i++) {
    try { page = await fetch(base + '/dashboard'); } catch (_) { await sleep(100); }
  }
  const openedAfter = Date.now() - started;
  c('the site answers while the database has answered nothing', page && page.status === 200 && held.length > 0,
    page ? `HTTP ${page.status}, ${held.length} queries still waiting` : 'no answer in 20s');
  c('…within seconds, not when the gateway gives up minutes later', page && openedAfter < 10_000, `${openedAfter} ms`);
  if (!page) return done();   // nothing below can be asked of a server that is not there
  c('the push key is empty meanwhile, which the browser takes as "not yet"', (await pushKey()) === '');

  // ── The gateway gives up: every held query, and every new one, is a 504 ───────
  ctx.BOOT_RETRY_MS = 200;
  mode = 'gateway';
  held.splice(0).forEach(release => release());
  await sleep(1000);
  c('a push-key read that failed makes no new pair: the key stays empty', (await pushKey()) === '');
  c('…and nothing is written over the stored pair', tokenWrites() === 0, `${tokenWrites()} write(s) to google_tokens`);
  c('the read is tried again while the database is down', vapidReads() >= 2, `${vapidReads()} reads`);
  c('the Google tokens are not loaded yet either', !ctx.driveTokens);

  // ── The database recovers ────────────────────────────────────────────────────
  mode = 'healthy';
  let key = '';
  for (let i = 0; i < 50 && !key; i++) { await sleep(100); key = await pushKey(); }
  c('once the database answers, push comes back with the stored pair — no restart', key === stored.publicKey,
    key ? (key === stored.publicKey ? '' : 'a different key: ' + key.slice(0, 12)) : 'still empty');
  c('…and the stored pair was never replaced',
    tokenWrites() === 0 && db.tables.google_tokens.find(r => r.user_key === 'vapid').tokens.publicKey === stored.publicKey);
  for (let i = 0; i < 20 && !ctx.driveTokens; i++) await sleep(100);
  c('the Google tokens arrive too', JSON.stringify(ctx.driveTokens) === JSON.stringify(drive), JSON.stringify(ctx.driveTokens));
  const settled = vapidReads();
  await sleep(800);
  c('the retries stop once a read succeeds', vapidReads() === settled, `${settled} → ${vapidReads()}`);

  // ── A first boot still makes, saves and serves a pair ─────────────────────────
  const child = spawnSync(process.execPath, [__filename, '--first-boot'], { encoding: 'utf8', timeout: 30_000 });
  const verdict = String(child.stdout || '').split('\n').find(l => l.startsWith('FIRST-BOOT')) || 'no verdict';
  c('with no pair stored, boot makes one, saves it and serves it', child.status === 0, verdict);
  done();
}

function done() {
  const passed = results.filter(Boolean).length;
  console.log(`\n${passed}/${results.length} database-outage checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

// ── Run in a child: one process boots the app only once ──────────────────────────
async function firstBoot() {
  const db = createFakeSupabase({ google_tokens: [], quotation_settings: [], sessions: [], push_subscriptions: [] });
  db.install();
  require(process.cwd() + '/index.js');
  let key = '';
  for (let i = 0; i < 100 && !key; i++) {
    try { key = await pushKey(); } catch (_) {}
    if (!key) await sleep(100);
  }
  const row = db.tables.google_tokens.find(r => r.user_key === 'vapid');
  const ok = !!key && !!row && row.tokens.publicKey === key && !!row.tokens.privateKey;
  console.log(ok ? 'FIRST-BOOT ok' : `FIRST-BOOT key=${key ? key.slice(0, 12) : '(none)'} saved=${row ? row.tokens.publicKey.slice(0, 12) : '(none)'}`);
  process.exit(ok ? 0 : 1);
}
