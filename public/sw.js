/*
 * Personal Calendar service worker.
 *
 * Strategy:
 *  - App shell (HTML, JS, CSS, icons): cache-first. Each build produces
 *    fingerprinted asset URLs, so a cached entry can never go stale — only
 *    `index.html` needs special care (see below).
 *  - `/ics` (Magister feed proxy): network-only. Schedule data must be fresh;
 *    there is nothing useful to show offline from a failed fetch.
 *  - `/api/storage` (cross-device sync): network-only, same reasoning.
 *  - Navigation requests: network-first with a cached `index.html` fallback,
 *    so the app still opens offline.
 */
const VERSION = 'v1';
const SHELL_CACHE = `shell-${VERSION}`;

const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Remove caches from previous versions.
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache live data endpoints.
  if (url.pathname === '/ics' || url.pathname.startsWith('/api/')) return;

  // Navigations: network first so updates land immediately, cached shell
  // as the offline fallback.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html')),
    );
    return;
  }

  // Everything else same-origin: cache-first (fingerprinted assets are
  // immutable; index.html is handled above).
  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
