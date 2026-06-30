/* Homatt Health — clinic portal service worker
 * Scoped to /clinic/. Exists so the portal is installable to the home screen
 * and opens instantly (even on a poor connection).
 * Strategy:
 *   • Navigations (HTML): network-first, fall back to cache when offline, so
 *     content stays fresh and auth state is never stale while online.
 *   • Same-origin assets (css/js/icons): stale-while-revalidate.
 *   • Supabase / CDN: never touched — handled by the page directly.
 */
const CACHE = 'homatt-clinic-v1';

const SHELL = [
  './',
  'index.html',
  'dashboard.html',
  'new-order.html',
  'settings.html',
  'clinic.webmanifest',
  'css/clinic.css?v=20260627',
  'js/clinic.js?v=20260627',
  'js/new-order-wizard.js?v=20260627',
  'js/pwa-install.js?v=20260630b',
  '../js/config.js',
  '../js/native-bridge.js',
  'icons/clinic-192.png?v=2',
  'icons/clinic-512.png?v=2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Never intercept cross-origin (Supabase API, CDNs, Google Fonts).
  if (url.origin !== self.location.origin) return;

  // HTML navigations → network-first, cache fallback (works offline).
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
    );
    return;
  }

  // Same-origin assets → stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
