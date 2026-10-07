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
const { Agent, fetch: undiciFetch } = require('undici');

// How long an idle connection is kept for the next query.
//
// Long, because one connection is not enough to keep warm. undici frees a socket
// one event-loop turn after its response, so a handler's second query (the
// update after the read, the insert after the duplicate check) goes out on a
// second connection. The presence heartbeat — one query, every 30 s, visible tabs
// only — keeps the first warm and never touches the second. At 5 minutes, a save
// made within 5 minutes of the last one finds both still open.
//
// And bounded: the Cloudflare edge in front of Supabase closes an idle HTTP/1.1
// connection at 400 s, not configurable. Closing ours first means it never shuts
// a socket we are about to write to.
const KEEP_ALIVE_MS = 300_000;

const dbAgent = new Agent({
  keepAliveTimeout: KEEP_ALIVE_MS,
  // Caps a server's own Keep-Alive hint — never hold a socket longer than this.
  keepAliveMaxTimeout: KEEP_ALIVE_MS,
  connect: { timeout: 10_000 },
});

// Which fetch carries the pool. Node's own is preferred: it is what production
// has always used, and it is the global the test suites replace with their stand-in
// for Supabase. But it is built on the undici bundled with Node, and the pool comes
// from our undici 6. Bundled 5–7 (Node 18–24) drive it fine; bundled 8 (Node 26)
// rejects it before any socket opens, which would fail every query. There, undici's
// own fetch — the same version as the pool — takes over.
const BUNDLED_UNDICI_MAJOR = parseInt(String(process.versions.undici || '0'), 10);
const USES_NODE_FETCH = BUNDLED_UNDICI_MAJOR >= 5 && BUNDLED_UNDICI_MAJOR <= 7;

function dbFetch(input, init) {
  const opts = { ...init, dispatcher: dbAgent };
  return USES_NODE_FETCH ? fetch(input, opts) : undiciFetch(input, opts);
}

module.exports = { dbFetch, dbAgent, KEEP_ALIVE_MS, USES_NODE_FETCH };
