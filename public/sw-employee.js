const CACHE = 'motolinker-emp-v115';
// The version rides every asset URL (?v=N). The HTML references assets with the
// SAME stamp, so a deploy changes the cache key: new HTML can never be paired
// with the previous bundle out of this cache, which is what used to blank the
// page until enough refreshes let the new worker take over. tests/shared.js
// asserts the HTML and this file agree on N.
const V = CACHE.split('-v')[1];
const SHELL = ['/employee', '/manifest-employee.json', '/help-docs.js?v=' + V, '/assets/employee.css?v=' + V, '/assets/mobile.css?v=' + V, '/assets/employee.js?v=' + V, '/assets/home.js?v=' + V, '/assets/huddle.js?v=' + V,
  '/assets/procurement.js?v=' + V, '/assets/quote.js?v=' + V, '/assets/meetings.js?v=' + V, '/assets/calendar.js?v=' + V, '/assets/availability.js?v=' + V, '/assets/logistics.js?v=' + V, '/assets/chat-extras.js?v=' + V, '/assets/columns.js?v=' + V, '/assets/client-folder.js?v=' + V, '/assets/lead-filters.js?v=' + V, '/assets/lead-views.js?v=' + V, '/assets/mobile.js?v=' + V];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

self.addEventListener('install', e => {
  // Per-URL, tolerating failures — addAll is all-or-nothing, so one 404 during a
  // deploy window meant install failed, the new worker never activated, and the
  // OLD cache kept serving stale assets forever. A miss here just means that URL
  // is fetched from the network on first use instead.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Never intercept API calls or SSE streams
  if (url.pathname.startsWith('/api/')) return;

  // CDN assets (fonts, Lucide icons) — cache-first, populate on miss
  if (CDN_HOSTS.some(h => url.hostname.includes(h))) {
    e.respondWith(
      caches.match(request).then(hit => {
        if (hit) return hit;
        return fetch(request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return res;
        });
      })
    );
    return;
  }

  // App shell HTML — network-first, fall back to cache when offline
  if (url.pathname === '/employee') {
    e.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match('/employee').then(hit =>
          // caches.match resolves undefined on a miss, and respondWith(undefined)
          // is a TypeError the browser renders as a blank document — the worst
          // possible offline behaviour. Say what happened instead.
          hit || new Response('<meta http-equiv="refresh" content="3"><body style="background:#0f1117;color:#889;font-family:sans-serif;display:grid;place-items:center;height:100vh">Reconnecting…</body>', { status: 503, headers: { 'Content-Type': 'text/html' } })))
    );
    return;
  }

  // Icons and manifests — cache-first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/manifest-employee')) {
    e.respondWith(
      caches.match(request).then(hit => {
        if (hit) return hit;
        return fetch(request).then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return res;
        });
      })
    );
    return;
  }
});

// ── Push notification received ────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  try {
    const d = e.data.json();
    const title = d.title || d.senderName || 'MotoLinker';
    const body  = d.body || 'New message';
    const tag   = d.tag || (d.roomId ? `chat-room-${d.roomId}` : 'motolinker');
    e.waitUntil(
      self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        renotify: true,
        data: { url: d.url, roomId: d.roomId },
      })
    );
  } catch (_) {}
});

// ── Notification tapped → open/focus the app ──────────────────────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { url, roomId } = e.notification.data || {};
  const target = url || (roomId ? '/employee?chat=' + roomId : '/employee');
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/employee') && 'focus' in client) {
          if (roomId) client.postMessage({ type: 'open_chat_room', roomId });
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
