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
const CACHE = 'homatt-clinic-v8';

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
  'js/pwa-install.js?v=20260702',
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
    caches.open(CACHE).then((c) => {
      // Vendor libraries (CDN/fonts) are cached best-effort in the background so
      // a slow/blocked CDN can never delay or break installing the app shell.
      Promise.allSettled(VENDOR.map((u) => c.add(u).catch(() => {})));
      // The app SHELL is what offline navigation needs — wait for it.
      return Promise.allSettled(SHELL.map((u) => c.add(u).catch(() => {})));
    }).then(() => self.skipWaiting())
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
  // Must NEVER resolve to undefined (that shows as ERR_FAILED / "can't be
  // reached"): every path returns a real Response — the requested page, another
  // cached clinic page, or a friendly offline page.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      } catch (e) {
        const c = await caches.open(CACHE);
        const hit = (await c.match(req)) ||
                    (await c.match(req, { ignoreSearch: true })) ||
                    (await c.match('index.html')) ||
                    (await c.match('dashboard.html')) ||
                    (await c.match('./'));
        return hit || new Response(
          '<!doctype html><html><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Homatt Health — Offline</title></head>' +
          '<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 24px;color:#37474F">' +
          '<div style="font-size:44px">📴</div>' +
          '<h2 style="color:#1B5E20">You’re offline</h2>' +
          '<p style="max-width:320px;margin:8px auto;line-height:1.5">Open Homatt Health once with an internet connection to finish setting it up for offline use, then it will work without data.</p>' +
          '<button onclick="location.reload()" style="margin-top:14px;background:#1B5E20;color:#fff;border:none;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:700">Retry</button>' +
          '</body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      }
    })());
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
