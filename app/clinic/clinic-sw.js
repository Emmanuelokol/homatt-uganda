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
const CACHE = 'homatt-clinic-v17';

// The core pages that must be openable offline. Kept as an explicit list so the
// worker can guarantee they're cached (and repair them if a precache ever fails).
const CORE_PAGES = ['./', 'index.html', 'dashboard.html', 'new-order.html', 'settings.html'];

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
  'js/clinic.js?v=20260704b',
  'js/clinic-offline.js?v=9',
  'js/new-order-wizard.js?v=20260704',
  'js/pwa-install.js?v=20260703',
  '../js/config.js',
  '../js/native-bridge.js',
  'icons/clinic-192.png?v=2',
  'icons/clinic-512.png?v=2',
];

let _lastSelfUpdateCheck = 0;

function isVendor(url) {
  return url.hostname.indexOf('cdn.jsdelivr.net') >= 0 ||
         url.hostname.indexOf('fonts.googleapis.com') >= 0 ||
         url.hostname.indexOf('fonts.gstatic.com') >= 0;
}

// Find a cached page across EVERY clinic cache (current + any not-yet-deleted
// older version), most-specific first. This is what lets the portal always open
// to its real UI offline — like Google Docs — instead of a dead-end page.
async function matchAnyCache(req) {
  const keys = await caches.keys();
  const clinicKeys = [CACHE].concat(
    keys.filter((k) => k !== CACHE && k.indexOf('homatt-clinic-') === 0)
  );
  const attempts = [
    (c) => c.match(req),
    (c) => c.match(req, { ignoreSearch: true }),
    (c) => c.match('dashboard.html'),
    (c) => c.match('index.html'),
    (c) => c.match('./'),
  ];
  for (const attempt of attempts) {
    for (const key of clinicKeys) {
      try {
        const c = await caches.open(key);
        const hit = await attempt(c);
        if (hit) return hit;
      } catch (e) {}
    }
  }
  return null;
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
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldClinic = keys.filter((k) => k !== CACHE && k.indexOf('homatt-clinic-') === 0);
    // Was this an UPGRADE (an older clinic cache existed) or a first install?
    const hadOld = oldClinic.length > 0;
    const target = await caches.open(CACHE);

    // 1) MIGRATE: carry every previously-cached response into the new cache
    //    BEFORE deleting the old one. An upgrade must never lose the offline
    //    shell — losing it is exactly what made the app show the dead-end
    //    "You're offline" page even though it had already been opened online.
    for (const key of oldClinic) {
      try {
        const old = await caches.open(key);
        const reqs = await old.keys();
        for (const rq of reqs) {
          if (await target.match(rq)) continue;   // keep the fresher copy
          const resp = await old.match(rq);
          if (resp) await target.put(rq, resp.clone());
        }
      } catch (e) {}
    }

    // 2) Now safe to drop every non-current cache.
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));

    // 3) REPAIR: guarantee the core pages are present. A flaky precache during
    //    install used to leave a fresh device unable to open offline. Best-effort
    //    and silently skipped when there's no connection.
    await Promise.all(CORE_PAGES.map(async (u) => {
      try {
        if (await target.match(u)) return;
        const r = await fetch(u, { cache: 'no-cache' });
        if (r && r.ok) await target.put(u, r.clone());
      } catch (e) {}
    }));

    await self.clients.claim();

    if (hadOld) {
      // CRITICAL DELIVERY FIX. Android restores tabs from memory without
      // re-navigating, so a page loaded under an old version can keep running
      // stale JS for DAYS — old enough pages don't even have the
      // controllerchange auto-reload. The service worker is the only thing the
      // browser still updates independently, so when a new version activates
      // we force-refresh the open clinic pages ourselves. Skip pages with
      // long forms (consultation/settings) so no typed work is ever lost —
      // they refresh on their next natural navigation instead.
      const cs = await self.clients.matchAll({ type: 'window' });
      cs.forEach((c) => {
        try {
          if (/new-order\.html|settings\.html/.test(c.url)) return;
          if (c.navigate) c.navigate(c.url);
        } catch (e) {}
      });
    }
  })());
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
    // Opportunistic self-update: pages running OLD code never ask for updates,
    // so the worker checks for a newer version of itself on navigations
    // (throttled). This is how stuck devices eventually receive fixes.
    const now = Date.now();
    if (now - _lastSelfUpdateCheck > 30 * 60 * 1000) {
      _lastSelfUpdateCheck = now;
      try { self.registration.update().catch(() => {}); } catch (e) {}
    }
    event.respondWith((async () => {
      try {
        // cache:'no-cache' bypasses the HTTP cache and revalidates with the
        // server (GitHub Pages sends max-age=600 — without this, a reload up
        // to 10 minutes after a deploy re-served the previous, possibly buggy,
        // HTML). ETag revalidation keeps unchanged loads cheap (304).
        const res = await fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      } catch (e) {
        // Serve the real cached UI from ANY clinic cache so the app opens
        // offline like Google Docs. The placeholder below is a genuine
        // last resort — only ever seen before the very first online open.
        const hit = await matchAnyCache(req);
        return hit || new Response(
          '<!doctype html><html><head><meta charset="utf-8">' +
          '<meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Homatt Health — Offline</title>' +
          '<script>addEventListener("online",function(){location.reload()});setInterval(function(){if(navigator.onLine)location.reload()},4000);</scr' + 'ipt>' +
          '</head>' +
          '<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 24px;color:#37474F">' +
          '<div style="font-size:44px">📴</div>' +
          '<h2 style="color:#1B5E20">Setting up…</h2>' +
          '<p style="max-width:320px;margin:8px auto;line-height:1.5">Homatt Health needs an internet connection just once to finish installing. It will reconnect and finish automatically — or tap Retry.</p>' +
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
