const CACHE = 'artifacts-v3';
const PRECACHE = [
  '/images/logo.png',
  '/images/favicon.ico',
  '/images/apple-touch-icon.png',
  '/images/gt-1080.webp',
  '/images/mx-1080.webp',
  '/images/ni-1080.webp',
  '/images/dp-1080.webp',
  '/images/cup.webp',
  '/css/main.css',
  '/js/main.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || !e.request.url.startsWith(self.location.origin)) return;
  if (e.request.url.includes('/.netlify/') || e.request.url.includes('payfast')) return;

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request));
    return;
  }

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fresh = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
      return cached || fresh;
    })
  );
});
