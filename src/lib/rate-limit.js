// A failure counter for sign-in endpoints.
//
// Nothing throttled a login before: a password, or a six-digit code, could be
// guessed as fast as the server would answer. A six-digit second factor is only a
// factor if the guesses are limited, so this is what makes 2FA mean something.
//
// Held in memory, like the sessions themselves: a restart forgets the counts, which
// gives an attacker a fresh allowance per deploy — acceptable next to the
// alternative of a table write on every failed guess.
//
//   const byUser = createLimiter({ max: 10, windowMs: 15 * 60_000 });
//   const wait = byUser.retryAfter('sara');   // seconds, 0 = go ahead
//   if (wait) return res.status(429)…
//   …on a wrong password:  byUser.fail('sara');
//   …on a right one:       byUser.reset('sara');
function createLimiter({ max, windowMs }) {
  const failures = new Map();   // key -> [timestamps within the window]
  const live = (key, now) => {
    const list = (failures.get(key) || []).filter(t => now - t < windowMs);
    if (list.length) failures.set(key, list); else failures.delete(key);
    return list;
  };
  const limiter = {
    // Seconds until another attempt is allowed; 0 when under the limit.
    retryAfter(key, now = Date.now()) {
      const list = live(key, now);
      if (list.length < max) return 0;
      return Math.max(1, Math.ceil((list[list.length - max] + windowMs - now) / 1000));
    },
    // Count one failure. Returns how many are now in the window.
    fail(key, now = Date.now()) {
      const list = live(key, now);
      list.push(now);
      failures.set(key, list);
      return list.length;
    },
    reset(key) { failures.delete(key); },
    get size() { return failures.size; },
    sweep(now = Date.now()) { for (const key of [...failures.keys()]) live(key, now); },
  };
  // Forget keys that have gone quiet, or every address that ever failed stays here.
  setInterval(() => limiter.sweep(), Math.max(60_000, windowMs)).unref();
  return limiter;
}

module.exports = { createLimiter };
