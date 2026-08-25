// Shared application context.
//
// index.js builds the singletons — supabase clients, the express app, auth guards,
// domain helpers — and Object.assign()s them onto this object before requiring any
// route module. Route modules then pull what they need out of it.
//
// A single mutable object rather than a long parameter list: threading fifteen
// arguments through every mount() call is worse, and having each module reach back
// into index.js would be circular.
//
// The one rule: index.js must populate this BEFORE requiring anything under
// src/routes, because those modules read from it at require time.
const ctx = {};

// Pull dependencies out by name and fail loudly if one is missing. A plain
// destructure would hand back `undefined` and turn a typo into a mystery crash
// on some request hours later; this turns it into a boot failure naming the key.
ctx.need = function need(...keys) {
  const out = {};
  const missing = [];
  for (const k of keys) {
    // Presence, not truthiness: an optional config value like SMTP_FROM is
    // legitimately undefined when unset, and `undefined` is a real answer.
    // Object.assign creates the key either way, so a genuine typo still shows up.
    if (!(k in ctx)) missing.push(k);
    out[k] = ctx[k];
  }
  if (missing.length) {
    throw new Error(`src/ctx: ${missing.join(', ')} not provided yet — index.js must ` +
      `Object.assign it onto the context before requiring this module.`);
  }
  return out;
};

// A write that carries a column the database may not have yet. Migrations here
// are applied by hand against Supabase, so a deploy can land ahead of the SQL —
// and when it does, losing the whole record because of one optional column is
// the wrong trade. Retry once without the column, keeping everything else.
// (src/routes/stock.js has carried this shape since migration 001; this is that
// pattern, generalized, for the custom_fields columns.)
ctx.writeOptional = async function writeOptional(run, row, optionalKeys) {
  let res = await run(row);
  const missing = String((res.error && (res.error.message || res.error.details)) || '');
  const dropped = (optionalKeys || []).filter(k => missing.includes(k));
  const looksMissing = res.error && (res.error.code === '42703' || res.error.code === 'PGRST204'
    || /does not exist|could not find/i.test(missing));
  if (res.error && looksMissing && dropped.length) {
    console.warn(`[db] ${dropped.join(', ')} column(s) missing — apply the pending migrations. Saving without them.`);
    const rest = { ...row };
    dropped.forEach(k => { delete rest[k]; });
    res = await run(rest);
  }
  return res;
};

// ── Configurable columns on a grid row ────────────────────────────────────────
// Line items and stock units are rebuilt server-side from a fixed key list,
// which is the right way to keep a shape honest — and it silently discarded
// every column an admin ADDED through the Columns editor with it. Someone typed
// a link into a column they had made, saved, reopened the vehicle and found the
// field empty: the value never left the request.
//
// The extras ride alongside the builtins, flat, which is where the client reads
// them from. Sanitised rather than trusted: primitives only, one key can't be a
// builtin's, and both the key count and each value are capped so a hand-written
// POST cannot stuff the row.
const GRID_EXTRA_MAX_KEYS = 40;
const GRID_EXTRA_MAX_LEN = 2000;
ctx.gridExtras = function gridExtras(raw, builtins) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const own = new Set(Object.keys(builtins || {}));
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (own.has(k) || !/^[A-Za-z0-9_-]{1,60}$/.test(k)) continue;
    const v = raw[k];
    if (v == null || typeof v === 'object' || typeof v === 'function') continue;
    const val = typeof v === 'boolean' ? v : String(v).trim().slice(0, GRID_EXTRA_MAX_LEN);
    if (val === '' || val === false) continue;
    out[k] = val;
    if (++n >= GRID_EXTRA_MAX_KEYS) break;
  }
  return out;
};
// Each builder drops rows the user left blank, testing the handful of builtins
// that mean "someone typed here". A row whose only content is a configured
// column has to count too, or fixing the save above changes nothing.
ctx.hasGridExtras = function hasGridExtras(row, builtins) {
  const own = new Set(Object.keys(builtins || {}));
  return Object.keys(row || {}).some(k => !own.has(k)
    && row[k] !== '' && row[k] !== false && row[k] != null);
};

module.exports = ctx;
