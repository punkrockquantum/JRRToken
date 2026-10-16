/*
 * FLUX PWA service worker.
 *
 * Offline strategy:
 *  - Navigations: network-first, falling back to the cached app shell
 *    (index.html) so the app opens with no connection.
 *  - Same-origin GET assets (icons, splash, manifest): stale-while-
 *    revalidate — serve instantly from cache, refresh in the background.
 *
 * Bump CACHE_VERSION whenever the precached shell/assets change so old
 * caches are cleaned up on activate.
 */
const CACHE_VERSION = 'flux-pwa-v1';
const APP_SHELL = './index.html';

const PRECACHE_URLS = [
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Precache the shell; tolerate individual asset failures so install
      // never aborts over one missing optional file.
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })))
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // App navigations: network-first with offline fallback to the shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          cache.put(APP_SHELL, fresh.clone());
          return fresh;
        } catch (err) {
          const cache = await caches.open(CACHE_VERSION);
          const cached = (await cache.match(request)) || (await cache.match(APP_SHELL));
          if (cached) return cached;
          throw err;
        }
      })()
    );
    return;
  }

  // Other same-origin assets: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => undefined);
      return cached || (await network) || Response.error();
    })()
  );
});
