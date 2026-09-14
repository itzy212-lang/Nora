// Nora Service Worker — PWA offline support
// Bumped 2026-09-13, real, confirmed cause of "I made a fix but
// nothing changed at all": this version number hadn't moved since
// August 14th, while today's session alone deployed dozens of times.
// Static assets here are served cache-first — once a client has
// cached something under an unchanged CACHE_NAME, it keeps serving
// that same cached version indefinitely, regardless of how many new
// deployments actually go live, until this version number itself
// changes and the activate handler below deletes the stale cache.
const CACHE_NAME = 'nora-v10';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon.svg',
];

// Install — cache static assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network first, fall back to cache for navigation
self.addEventListener('fetch', event => {
  const { request } = event;

  // Skip non-GET and API requests — always go to network
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/')) return;
  if (request.url.includes('supabase.co')) return;
  if (request.url.includes('openai.com')) return;

  // Navigation requests — serve index.html from cache if offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets — cache first
  event.respondWith(
    caches.match(request).then(cached => cached || fetch(request))
  );
});

// Push notifications
self.addEventListener('push', event => {
  if (!event.data) return;
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title || 'Nora', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'nora-notification',
      data: { url: data.url || '/' },
      vibrate: [200, 100, 200],
    })
  );
});

// Notification click — open the app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      const existing = windowClients.find(c => c.url === url && 'focus' in c);
      if (existing) return existing.focus();
      return clients.openWindow(url);
    })
  );
});
