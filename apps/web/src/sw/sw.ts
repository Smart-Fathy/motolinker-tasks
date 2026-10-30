/// <reference lib="webworker" />
// The new app's service worker. One file, served at /sw-ui-dashboard.js and /sw-ui-employee.js (the address says which
// portal it is for), built beside the app by apps/web/sw-plugin.ts, which also writes in the list of files to keep.
// What it decides is in logic.ts; this wires it to the browser. It does four things:
//   - keeps the app's first load (the entry script and style, and the portal's page) so the app starts without a network;
//   - keeps every other file of the app the first time it is used, cache first (their names carry a hash of their content);
//   - shows a push and takes a tap on it to the app;
//   - takes over at once when it is new, and deletes only the caches of older builds of itself.
// It never touches /api/ (the live streams above all), and never a page that is not the app's — the classic pages the app
// shows in frames live at /legacy/…, outside its scope.
import {
  cacheName,
  isPortalWindow,
  keepAsset,
  keepPage,
  notificationOf,
  pageKey,
  routeOf,
  staleCaches,
  targetOf,
  type Route,
} from './logic';
import { portalOfWorker, type WorkerMessage } from './shared';

declare const self: ServiceWorkerGlobalScope;
/** The files of the app's first load, written in by the build. */
declare const __PRECACHE__: readonly string[];
/** A name for this build's files; it changes when any of them does. */
declare const __BUILD__: string;

const portal = portalOfWorker(self.location.pathname);

if (portal) {
  const origin = self.location.origin;
  const current = cacheName(portal, __BUILD__);
  const key = pageKey(portal, origin);
  const open = () => caches.open(current);

  const reconnecting = () =>
    new Response(
      '<meta http-equiv="refresh" content="3"><body style="background:#0f1117;color:#889;font-family:sans-serif;display:grid;place-items:center;height:100vh">Reconnecting…</body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );

  /** A file kept the first time it is used. */
  const cacheFirst = async (event: FetchEvent, worth: typeof keepAsset): Promise<Response> => {
    const cache = await open();
    const hit = await cache.match(event.request);
    if (hit) return hit;
    const response = await fetch(event.request);
    if (worth(response)) event.waitUntil(cache.put(event.request, response.clone()));
    return response;
  };

  const answer: Record<Exclude<Route, 'pass'>, (event: FetchEvent) => Promise<Response>> = {
    // The app's page: from the network, so a new build arrives with the next open; the last one kept stands in without it.
    page: async event => {
      try {
        const response = await fetch(event.request);
        if (keepPage(response, event.request.url)) {
          const copy = response.clone();
          event.waitUntil(open().then(cache => cache.put(key, copy)));
        }
        return response;
      } catch {
        return (await (await open()).match(key)) ?? reconnecting();
      }
    },
    asset: event => cacheFirst(event, keepAsset),
    icon: event => cacheFirst(event, keepAsset),
    font: event => cacheFirst(event, keepAsset),
    // The install manifest carries the workspace's name and colours: from the network, so a rename reaches an installed copy.
    manifest: async event => {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(open().then(cache => cache.put(event.request, copy)));
        }
        return response;
      } catch {
        return (await (await open()).match(event.request)) ?? Response.error();
      }
    },
  };

  self.addEventListener('install', event => {
    event.waitUntil(
      (async () => {
        const cache = await open();
        // File by file, and a miss is not the end of the install: addAll is all or nothing, and one file missing during a
        // deploy would leave the old worker serving the old build for good. A file not kept is fetched when it is needed.
        await Promise.all(__PRECACHE__.map(url => cache.add(url).catch(() => undefined)));
        try {
          const response = await fetch(key);
          if (keepPage(response, key)) await cache.put(key, response);
        } catch {
          /* no network now: the page is kept the first time it is opened with one */
        }
        await self.skipWaiting();
      })(),
    );
  });

  self.addEventListener('activate', event => {
    event.waitUntil(
      (async () => {
        for (const name of staleCaches(await caches.keys(), portal, current))
          await caches.delete(name);
        await self.clients.claim();
      })(),
    );
  });

  self.addEventListener('fetch', event => {
    const route = routeOf(event.request, portal, origin);
    if (route !== 'pass') event.respondWith(answer[route](event));
  });

  self.addEventListener('push', event => {
    let shown = null;
    try {
      shown = notificationOf(event.data?.json());
    } catch {
      /* not JSON: nothing to say */
    }
    if (shown) {
      event.waitUntil(
        self.registration.showNotification(shown.title, shown.options as NotificationOptions),
      );
    }
  });

  self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = targetOf(event.notification.data, portal, origin);
    event.waitUntil(
      (async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const there = windows.find(w => isPortalWindow(w.url, portal));
        if (!there) {
          await self.clients.openWindow(target);
          return;
        }
        const message: WorkerMessage = { ml: 'sw', v: 1, type: 'open', url: target };
        there.postMessage(message);
        await there.focus();
      })(),
    );
  });
}
