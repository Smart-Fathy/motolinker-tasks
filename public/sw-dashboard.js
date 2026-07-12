const CACHE = 'motolinker-dash-v34';
const SHELL = ['/dashboard', '/manifest-dashboard.json'];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
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

  // CDN assets (fonts, Lucide, Chart.js) — cache-first, populate on miss
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
  if (url.pathname === '/dashboard') {
    e.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match('/dashboard'))
    );
    return;
  }

  // Icons and manifests — cache-first
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/manifest-dashboard')) {
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
  const target = url || (roomId ? '/dashboard?chat=' + roomId : '/dashboard');
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/dashboard') && 'focus' in client) {
          if (roomId) client.postMessage({ type: 'open_chat_room', roomId });
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
