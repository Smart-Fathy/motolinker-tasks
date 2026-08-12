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

module.exports = ctx;
