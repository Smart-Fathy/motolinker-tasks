const CACHE = 'motolinker-emp-v2';
const SHELL = ['/employee', '/manifest-employee.json'];
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com'];

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
        .catch(() => caches.match('/employee'))
    );
    return;
  }

  // Icons and manifests — cache-first
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/manifest-employee')) {
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
    const { senderName, body, roomId } = e.data.json();
    e.waitUntil(
      self.registration.showNotification(senderName || 'MotoLinker', {
        body: body || 'New message',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: `chat-room-${roomId}`,
        renotify: true,
        data: { roomId },
      })
    );
  } catch (_) {}
});

// ── Notification tapped → open/focus the app and go to that chat room ─────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const roomId = e.notification.data?.roomId;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes('/employee') && 'focus' in client) {
          client.postMessage({ type: 'open_chat_room', roomId });
          return client.focus();
        }
      }
      return clients.openWindow('/employee?chat=' + roomId);
    })
  );
});
