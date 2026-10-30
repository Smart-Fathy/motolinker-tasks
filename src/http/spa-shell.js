// The new app's page, with the workspace written into it.
//
// apps/web/index.html is a template (and, built, apps/web/dist/index.html is the same page with the hashed script
// and sheet added). It carries the admin portal's head; for the team portal the few values that differ are swapped
// in by their exact text. Then src/lib/shell.js — the code that dresses the classic pages — does what it always
// does: the workspace's name, picture and look, the early light/dark script, the wording an admin replaced. The new
// app therefore opens in the same look as the classic page would, from the first paint, with no flash of the
// original, and `?safe=1` still means the original look. Last, the marker in <head> becomes `window.__ML__`, the
// little the app is told about where it is: the portal, the workspace's name, and the wording an admin replaced (the
// classic pages are dressed by markers in their HTML, which an app that draws its own text has none of).
//
// Every swap is by exact text and a missing one is an error, not a quiet miss: a template that has lost a hook
// would otherwise open undressed. tests/spashell.js holds the template and the built page to this.
const BOOT_MARKER = '<!--ml:boot-->';

// What differs between the portals' heads (the values the classic pages have: public/dashboard.html, employee.html).
// The template is the admin's, so only the team needs swapping.
/** @type {Record<string, [string, string][]>} */
const SWAPS = {
  admin: [],
  team: [
    // which portal's defaults the stylesheet starts from (apps/web/src/styles/portal-team.css)
    ['<html lang="en" data-portal="admin">', '<html lang="en" data-portal="team">'],
    ['<meta name="theme-color" content="#1e2130">', '<meta name="theme-color" content="#0a0b10">'],
    [
      '<meta name="apple-mobile-web-app-status-bar-style" content="default">',
      '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
    ],
    [
      '<meta name="apple-mobile-web-app-title" content="ML Admin">',
      '<meta name="apple-mobile-web-app-title" content="MotoLinker">',
    ],
    [
      '<link rel="manifest" href="/manifest-dashboard.json">',
      '<link rel="manifest" href="/manifest-employee.json">',
    ],
    ['<title>MotoLinker · Admin Dashboard</title>', '<title>MotoLinker — Team Portal</title>'],
    ['<a href="/legacy/dashboard">', '<a href="/legacy/employee">'],
  ],
};

// JSON that is safe inside a <script> element: nothing in it can close the element or start a comment, and the two
// line separators JavaScript string literals cannot hold are written out.
const scriptJson = (/** @type {unknown} */ value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

/**
 * The renderer, given the code that dresses a page (src/lib/shell.js, which src/routes/shell.js hands in: this file
 * takes what it needs rather than reaching into the legacy server).
 * @param {{
 *   renderShell: (html: string, ws: Record<string, any>, opts: { safe?: boolean }) => string,
 *   wordingOf: (ws: Record<string, any>, opts: { safe?: boolean }) => Record<string, string>,
 *   defaultName: string,
 * }} deps
 */
function makeRenderSpa({ renderShell, wordingOf, defaultName }) {
  /**
   * @param {string} template the text of apps/web/dist/index.html
   * @param {Record<string, any>} ws the workspace profile (as src/routes/shell.js is handed it)
   * @param {{ kind: 'admin' | 'team', safe?: boolean }} opts
   * @returns {string}
   */
  return function renderSpa(template, ws, { kind, safe = false }) {
    const swaps = SWAPS[kind];
    if (!swaps) throw new Error('spa-shell: no portal called ' + kind);
    let html = template;
    for (const [from, to] of swaps) {
      if (!html.includes(from))
        throw new Error('spa-shell: the template has lost the text it swaps for the team: ' + from);
      html = html.replace(from, () => to);
    }
    if (!html.includes(BOOT_MARKER))
      throw new Error('spa-shell: the template has lost its ' + BOOT_MARKER + ' marker');
    html = renderShell(html, ws, { safe });
    const name = ws.custom_name ? ws.name : defaultName;
    const boot =
      '<script>window.__ML__=' +
      scriptJson({
        v: 1,
        portal: kind,
        ui: 'next',
        workspace: { name, texts: wordingOf(ws, { safe }) },
      }) +
      ';</script>';
    return html.replace(BOOT_MARKER, () => boot);
  };
}

module.exports = { makeRenderSpa, BOOT_MARKER, SWAPS, scriptJson };
