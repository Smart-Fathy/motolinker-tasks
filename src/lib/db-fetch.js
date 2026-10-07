// The fetch the Supabase clients use: the same requests, over connections that
// stay open between them.
//
// Every Supabase query is an HTTPS request, and Node's built-in fetch closes an
// idle connection after 4 seconds. Nobody here clicks every 4 seconds, so almost
// every query opened a new one — DNS, TCP and TLS before the request even left.
// Production measured it: a presence upsert Postgres answers in ~1 ms took ~150 ms
// on a warm connection, ~470 ms after 10–30 s idle and ~850 ms (p90 2.3 s) after
// a quiet half-minute. A lead save is two to four queries in a row, and the table
// reload after it is more, which is how one edit came to take 5–8 seconds.
//
// Only the connection pool is swapped. The request still goes through the global
// fetch, looked up on every call, so it stays Node's own implementation in
// production and the stub the test suites install in place of Supabase.
const { Agent } = require('undici');

// How long an idle connection is kept for the next query. The portals send a
// presence heartbeat every ~15 s per open tab, so while anyone is online the pool
// never sits idle long enough to close. It stays well under the idle limit of the
// Cloudflare edge in front of Supabase, so the server never closes a socket we
// are about to write to.
const KEEP_ALIVE_MS = 60_000;

const dbAgent = new Agent({
  keepAliveTimeout: KEEP_ALIVE_MS,
  // Caps a server's own Keep-Alive hint — never hold a socket longer than this.
  keepAliveMaxTimeout: KEEP_ALIVE_MS,
  connect: { timeout: 10_000 },
});

function dbFetch(input, init) {
  return fetch(input, { ...init, dispatcher: dbAgent });
}

module.exports = { dbFetch, dbAgent, KEEP_ALIVE_MS };
