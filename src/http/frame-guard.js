'use strict';
// Who may put one of the portals' pages in a frame: this site itself, and nobody else.
//
// A page that any website can frame is a page any website can dress up. Lay the admin dashboard over a decoy, in a frame the
// visitor cannot see, and their click lands on whatever the dashboard has under the pointer (clickjacking). So the pages go
// out with
//
//   Content-Security-Policy: frame-ancestors 'self'    the rule, which current browsers enforce
//   X-Frame-Options: SAMEORIGIN                        the same rule for a browser that only knows this one (a browser that
//                                                      knows both goes by the first and ignores this)
//
// 'self' and not 'none' because this site frames itself: the new app shows a screen it has not rebuilt as its classic page, in
// an <iframe> of the same origin (/legacy/dashboard?embed=1, /legacy/employee?embed=1: apps/web/src/legacy/LegacyFrame.tsx).
//
// Covered, however the address is spelled:
//   /dashboard and /employee, their .html files, and everything inside them (/dashboard/*, /employee/*)
//   /legacy/*, the classic pages the new app frames
//   any other path that is a .html file, so a page added to public/ is covered without anyone remembering to say so
//
// Not covered, on purpose:
//   /api/*   JSON, not a page. (The marketing website posts its form to /api/submissions from another origin: that is a
//            fetch, not a frame.)
//   /ui/*    the new app's scripts and sheets; the page that loads them is covered
//   the manifests, icons, service workers and every other file in public/ that is not .html
//
// Nothing in this repository is meant to be framed by another site: there is no public booking, availability or form page
// (the website's form lives on the website). One that is added has to stay out of `pages`, and be named here with its reason.
const { posix } = require('path');

const FRAME_ANCESTORS = "frame-ancestors 'self'";
const FRAME_OPTIONS = 'SAMEORIGIN';

/**
 * Is this request path a page? It is read the way the server itself reads it, because a page opened by a spelling nobody
 * thought of is a page without the header: routes ignore case and a trailing slash, and the file server decodes %-escapes and
 * settles `//`, `/./` and `/../` before it looks for a file — so /DASHBOARD, /dashboard/, /dashboard%2Ehtml and
 * /x/../dashboard.html/. all open a portal (tests/framing.js tries each against the real server). A path that is not valid
 * %-encoding is nothing the server will serve, and counts as a page all the same: when in doubt, protect.
 * @param {string[]} roots the pages, lower case, as makeFrameGuard keeps them
 * @param {string} pathname the request's path as it came, without the query
 * @returns {boolean}
 */
function isPage(roots, pathname) {
  let path = pathname;
  try {
    path = decodeURIComponent(path);
  } catch (_) {
    return true;
  }
  path = posix.normalize('/' + path).toLowerCase();
  return (
    roots.some(root => path === root || path.startsWith(root + '/')) || /\.html\/?$/.test(path)
  );
}

/**
 * The middleware: both headers on a page, nothing on anything else. They are set before the response is made, so whatever
 * answers (the page, a redirect to the classic page, a 404) carries them — except that Express's own error pages put a
 * Content-Security-Policy of their own (`default-src 'none'`) in place of the first one; the second stays.
 * @param {{ pages: string[] }} deps pages: the roots of the portals' pages ('/dashboard'); each covers itself, its .html
 *   file and everything inside it
 * @returns {import('express').RequestHandler}
 */
function makeFrameGuard({ pages }) {
  const roots = pages.map(page => page.toLowerCase());
  // A list that covers nothing is not a guard, and a typo in it should stop the boot rather than leave a portal open.
  if (!roots.length || roots.some(root => !/^\/[^/]+(\/[^/]+)*$/.test(root)))
    throw new Error(
      'frame-guard: pages are roots like "/dashboard" (a leading slash, none at the end), and there has to be one',
    );
  return function frameGuard(req, res, next) {
    if (isPage(roots, req.path)) {
      res.setHeader('Content-Security-Policy', FRAME_ANCESTORS);
      res.setHeader('X-Frame-Options', FRAME_OPTIONS);
    }
    next();
  };
}

module.exports = { makeFrameGuard, isPage };
