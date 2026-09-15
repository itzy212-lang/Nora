// Nora Service Worker — PWA offline support
// Bumped 2026-09-13 (third time today): follow-up refinement to the
// notepad z-index fix — it now sits below the top bar instead of
// covering it, per request. Bumping again so this reaches devices
// promptly.
// Nora Service Worker — PWA offline support
// Bumped 2026-09-15: new project pause feature + "Project Complete"
// rename, both frontend changes. Bumping so they reach devices
// promptly rather than relying on a stale cached bundle.
// Nora Service Worker — PWA offline support
// Bumped 2026-09-15 (second time today): follow-up fix to a real
// error reported live in the pause feature just shipped — an
// untested .catch() pattern on the reminder task insert, not used
// anywhere else in this file. Bumping again so the fix reaches
// devices promptly.
const CACHE_NAME = 'nora-v14';
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
