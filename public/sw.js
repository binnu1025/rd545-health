// Keeps the site usable offline. Pages: network first (updates arrive at once), cached copy when offline.
// Built assets have content-hashed names, so they are safe to serve from cache. Google services are never cached.
const CACHE = 'rd545-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const keep = response => { if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); } return response; };
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(keep).catch(() => caches.match(request, { ignoreSearch: true }).then(hit => hit || caches.match('./'))));
    return;
  }
  event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(keep)));
});
