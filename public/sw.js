// ReelzTV service worker — makes the site installable and usable offline.
//
// Lives in public/ so Vite copies it verbatim to /sw.js (must be served from
// the site root so its scope covers every page).
//
// Caching strategy:
//   • HTML / navigations → network first, cache as fallback. This is the
//     important one: index.html points at content-hashed JS/CSS, so serving a
//     stale copy after a new deploy would reference files that no longer exist
//     and show a blank page.
//   • Everything else (hashed assets, icons, manifest) → cache first, since a
//     new deploy produces new file names.
//   • JSON catalogs (e.g. /adult.json) → network first. They are editable on
//     the host without a rebuild, and a cache-first response would keep showing
//     the copy from the very first visit — i.e. an empty list forever.
const CACHE_NAME = 'reelztv-v3';
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/RZicon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never touch API calls / embeds on other origins.
  if (url.origin !== self.location.origin) return;

  const isHtml =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isHtml) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Host-editable JSON catalogs: always go to the network, cache only as an
  // offline fallback.
  if (url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() =>
          // Offline and never cached yet → answer with an empty catalog so the
          // section degrades to its "no titles" state instead of a network error.
          caches
            .match(request)
            .then((cached) => cached || new Response('[]', { headers: { 'content-type': 'application/json' } }))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
    )
  );
});
