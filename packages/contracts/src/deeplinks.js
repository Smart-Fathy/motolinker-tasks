'use strict';
// Links that already exist in the world, read by the new app: '/employee#requests' in a notification the server wrote
// last month, '/dashboard?chat=<room>' in a push notification's click, a bookmark of '/dashboard#customers'. The classic
// portals name a screen by a hash; the new app gives each screen a path ('/dashboard/leads'). This is the one place that
// knows both, in both directions: the new app reads old links with it, and the server sends a browser that has not chosen
// the new app from a new-app address to the classic page it stands for.

const { screenIdFromLegacy, screenOf, legacyIdOf, inPortal, isNewTo } = require('./modules');

/** @typedef {import('./modules').Portal} Portal */

const ROOM = /^[A-Za-z0-9_-]{1,80}$/;
const BASE = /** @type {Record<Portal, string>} */ ({ admin: '/dashboard', team: '/employee' });

/**
 * The screen an address asks for, as a path inside the app ('/requests', '/chat/<room>'), or null when it asks for
 * nothing in particular (and the app opens where it would have anyway). A chat room is asked for by `?chat=` — a
 * notification click — and wins over a hash; a hash that is not a screen asks for nothing.
 * @param {Portal} portal
 * @param {{ search?: string, hash?: string }} where
 * @returns {string | null}
 */
function resolveDeepLink(portal, { search = '', hash = '' }) {
  const room = new URLSearchParams(search).get('chat');
  if (room !== null) return ROOM.test(room) ? '/chat/' + room : '/chat';
  const key = String(hash).replace(/^#/, '');
  if (!key) return null;
  const id = screenIdFromLegacy(key, portal);
  return id ? '/' + id : null;
}

/**
 * Where a link stored by the server (a notification's `url`) goes in the app: the same, for the portal that is
 * open. A link into the other portal, or into nothing known, goes nowhere.
 * @param {string} url
 * @param {Portal} portal
 * @returns {string | null}
 */
function linkTarget(url, portal) {
  const m = /^\/(dashboard|employee)\/?(\?[^#]*)?(#.*)?$/.exec(String(url || ''));
  if (!m) return null;
  if (m[1] !== BASE[portal].slice(1)) return null;
  return resolveDeepLink(portal, { search: m[2] || '', hash: m[3] || '' });
}

/**
 * The classic page for an address inside the new app: '/dashboard/leads' -> '/dashboard#customers'. What is not a screen
 * ('/dashboard/__gallery', a mistyped path), or is a screen the classic portal never had, is the portal itself.
 * @param {Portal} portal
 * @param {string} path  the part after the portal's own address, e.g. '/leads' or '/chat/abc'
 * @returns {string}
 */
function classicUrlFor(portal, path) {
  const bare = String(path || '').split(/[?#]/)[0] || '';
  const parts = bare.split('/').filter(Boolean);
  const screen = parts.length ? screenOf(parts[0] || '') : undefined;
  if (!screen || !inPortal(screen, portal) || isNewTo(screen, portal)) return BASE[portal];
  if (screen.id === 'chat' && parts[1] && ROOM.test(parts[1]))
    return BASE[portal] + '?chat=' + parts[1];
  return BASE[portal] + '#' + legacyIdOf(screen, portal);
}

module.exports = { resolveDeepLink, linkTarget, classicUrlFor };
