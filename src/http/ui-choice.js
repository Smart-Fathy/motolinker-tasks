// Which UI a request gets: the classic portals (public/dashboard.html, employee.html) or the new app
// (apps/web, built to apps/web/dist). The switch is per browser and per request, and it fails towards the
// classic page, which is what everybody has today:
//
//   ?ui=next | ?ui=legacy      the request asks, and the server remembers it in the `ml_ui` cookie (a year)
//   the `ml_ui` cookie         what was asked last time in this browser
//   ML_UI_DEFAULT_ADMIN / ML_UI_DEFAULT_TEAM / ML_UI_DEFAULT      what a browser that has asked for nothing gets
//   otherwise                  legacy
//
// Anything that is not exactly "next" or "legacy" is ignored, wherever it came from. Pure functions of the
// request's pieces: src/routes/shell.js does the serving.
const COOKIE = 'ml_ui';
const CHOICES = new Set(['next', 'legacy']);

/** The value of one cookie from a Cookie header, or null. */
function readCookie(/** @type {unknown} */ header, /** @type {string} */ name) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * @param {{ query?: Record<string, unknown>, cookie?: string, defaultUi?: string }} req
 * @returns {{ ui: 'next' | 'legacy', remember: 'next' | 'legacy' | null }} remember: what to write to the cookie, if anything
 */
function chooseUi({ query, cookie, defaultUi } = {}) {
  const asked = query && typeof query.ui === 'string' ? query.ui : null;
  if (asked && CHOICES.has(asked))
    return {
      ui: /** @type {'next' | 'legacy'} */ (asked),
      remember: /** @type {'next' | 'legacy'} */ (asked),
    };
  const saved = readCookie(cookie, COOKIE);
  if (saved && CHOICES.has(saved))
    return { ui: /** @type {'next' | 'legacy'} */ (saved), remember: null };
  return { ui: defaultUi === 'next' ? 'next' : 'legacy', remember: null };
}

/** The Set-Cookie value that remembers a choice. Not HttpOnly (the app may show which UI this is); nothing in it is secret. */
const rememberCookie = (/** @type {'next' | 'legacy'} */ value) =>
  `${COOKIE}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;

/** The env default for a portal: its own variable, then the shared one. */
function defaultFor(/** @type {'admin' | 'team'} */ kind, env = process.env) {
  return (
    (kind === 'team' ? env.ML_UI_DEFAULT_TEAM : env.ML_UI_DEFAULT_ADMIN) ||
    env.ML_UI_DEFAULT ||
    'legacy'
  );
}

module.exports = { chooseUi, rememberCookie, readCookie, defaultFor, COOKIE };
