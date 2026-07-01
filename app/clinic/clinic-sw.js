/* Homatt Health — clinic portal service worker
 * Scoped to /clinic/. Makes the portal installable AND fully usable offline.
 *
 * Strategy:
 *   • App shell (HTML/CSS/JS) + the Supabase library and Google Fonts are
 *     pre-cached on install, so the portal opens with NO connection.
 *   • Navigations (HTML): network-first → cache fallback (fresh online, works
 *     offline; auth state never stale while online).
 *   • Same-origin assets: stale-while-revalidate.
 *   • CDN (jsDelivr) + Google Fonts: cache-first (they're versioned/stable).
 *   • Supabase API (supabase.co): never touched here — the pages read/write it
 *     directly and fall back to their own localStorage data cache when offline.
 */
const CACHE = 'homatt-clinic-v6';

// Cross-origin libraries the pages need to even boot.
const VENDOR = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Outlined',
];

const SHELL = [
  './',
  'index.html',
  'dashboard.html',
  'new-order.html',
  'settings.html',
  'clinic.webmanifest',
  'css/clinic.css?v=20260627',
  'js/clinic.js?v=20260703',
  'js/clinic-offline.js?v=5',
  'js/new-order-wizard.js?v=20260627',
  'js/pwa-install.js?v=20260630d',
  '../js/config.js',
  '../js/native-bridge.js',
  'icons/clinic-192.png?v=2',
  'icons/clinic-512.png?v=2',
];

function isVendor(url) {
  return url.hostname.indexOf('cdn.jsdelivr.net') >= 0 ||
         url.hostname.indexOf('fonts.googleapis.com') >= 0 ||
         url.hostname.indexOf('fonts.gstatic.com') >= 0;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(
        SHELL.concat(VENDOR).map((u) => c.add(u).catch(() => {}))
      ))
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

  // CDN + fonts (cross-origin): cache-first so they work offline.
  if (isVendor(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Any other cross-origin (Supabase API, WhatsApp, etc.): don't intercept.
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
        .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html') || caches.match('./')))
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
