// What the new app's service worker decides, kept apart from the worker (sw.ts, which only wires these to the browser's
// events) so that every decision can be tested without a browser. No DOM, no app code: the worker starts before the app.
import type { Portal } from '../lib/env';
import { scopeOf } from './shared';

const CACHE_PREFIX = 'ml-ui-';

/** The classic workers keep their caches under their own names (motolinker-dash-v…); these never touch them, nor they ours. */
const family = (portal: Portal): string => `${CACHE_PREFIX}${scopeOf(portal).slice(1)}-`;

/** The cache this build of the app lives in. A new build is a new name, so old and new files are never mixed. */
export const cacheName = (portal: Portal, build: string): string => family(portal) + build;

/** Caches left by older builds of this portal's app: the only ones this worker deletes. */
export const staleCaches = (names: readonly string[], portal: Portal, current: string): string[] =>
  names.filter(name => name.startsWith(family(portal)) && name !== current);

/** The one place the portal's page is kept: every address inside the app is answered by the same page. */
export const pageKey = (portal: Portal, origin: string): string => origin + scopeOf(portal);

const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

export type Route = 'page' | 'asset' | 'icon' | 'manifest' | 'font' | 'pass';

/**
 * What to do with a request. Anything not named here is the browser's own business: the API and its live streams above
 * all (nothing under /api/ is named), and every page that is not this app's (the classic pages at /legacy/…, which the app
 * shows in frames).
 */
export function routeOf(
  request: { url: string; method: string; mode: string },
  portal: Portal,
  origin: string,
): Route {
  if (request.method !== 'GET') return 'pass';
  const url = new URL(request.url);
  if (FONT_HOSTS.has(url.hostname)) return 'font';
  if (url.origin !== origin) return 'pass';
  const path = url.pathname;
  const base = scopeOf(portal);
  if (path.startsWith('/ui/assets/')) return 'asset';
  if (path.startsWith('/icons/')) return 'icon';
  if (path === `/manifest-${base.slice(1)}.json`) return 'manifest';
  if (request.mode === 'navigate' && (path === base || path.startsWith(base + '/'))) return 'page';
  return 'pass';
}

/**
 * Is this answer a page worth keeping for the next time the network is not there? Only the new app's own, whole, and
 * not the original-look (?safe=1) page: the classic page, an error page and a redirect are somebody else's to show.
 */
export function keepPage(
  response: { status: number; headers: { get(name: string): string | null } },
  requestUrl: string,
): boolean {
  return (
    response.status === 200 &&
    response.headers.get('X-ML-UI') === 'next' &&
    !new URL(requestUrl).searchParams.has('safe')
  );
}

/** A font file comes back opaque (a cross-origin request made by a stylesheet); it is kept all the same. */
export const keepAsset = (response: { ok: boolean; type: string }): boolean =>
  response.ok || response.type === 'opaque';

/** What a push says, as the notification it shows; null for a push that says nothing. */
export interface Shown {
  title: string;
  options: {
    body: string;
    icon: string;
    badge: string;
    tag: string;
    renotify: true;
    data: { url: string | undefined; roomId: string | undefined };
  };
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export function notificationOf(payload: unknown): Shown | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const d = payload as Record<string, unknown>;
  const roomId = text(d['roomId']);
  return {
    title: text(d['title']) ?? text(d['senderName']) ?? 'MotoLinker',
    options: {
      body: text(d['body']) ?? 'New message',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: text(d['tag']) ?? (roomId ? `chat-room-${roomId}` : 'motolinker'),
      renotify: true,
      data: { url: text(d['url']), roomId },
    },
  };
}

/**
 * Where a tapped notification goes: the address the push named if it is on this origin, else the chat room it came from,
 * else the portal itself. (The payload comes from our own server; this is care about what an address can be, not trust.)
 */
export function targetOf(data: unknown, portal: Portal, origin: string): string {
  const base = scopeOf(portal);
  const d = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
  const url = text(d['url']);
  if (url) {
    try {
      const at = new URL(url, origin);
      if (at.origin === origin) return at.pathname + at.search + at.hash;
    } catch {
      /* not an address */
    }
  }
  const roomId = text(d['roomId']);
  return roomId ? `${base}?chat=${encodeURIComponent(roomId)}` : base;
}

/** Is this open window one of the portal's pages (the new app's, or the classic page at the same address)? */
export function isPortalWindow(clientUrl: string, portal: Portal): boolean {
  const path = new URL(clientUrl).pathname;
  const base = scopeOf(portal);
  return path === base || path.startsWith(base + '/');
}
