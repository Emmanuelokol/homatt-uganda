/**
 * Homatt Health — Service Worker
 * Strategy:
 *   • App shell (HTML/CSS/JS/icons): Cache-first, update in background
 *   • Google Fonts / CDN: Cache-first with 7-day expiry
 *   • Supabase API calls: Network-first, never cached (handled by JS/localStorage)
 *   • Everything else: Network-first, fall back to cache
 */

const CACHE_NAME = 'homatt-shell-v8';

const APP_SHELL = [
  './',
  './signin.html',
  './dashboard.html',
  './family.html',
  './medicine-orders.html',
  './symptom-checker.html',
  './profile.html',
  './wallet.html',
  './clinic-booking.html',
  './mood-sleep-tracker.html',
  './cycle-tracker.html',
  './pain-tracker.html',
  './digestive-tracker.html',
  './quiz.html',
  './manifest.json',
  './css/styles.css',
  './css/pages.css',
  './css/trackers.css',
  './css/symptom-checker.css',
  './js/config.js',
  './js/native-bridge.js',
  './js/app.js',
  './js/signin.js',
  './js/dashboard.js',
  './js/family.js',
  './js/symptom-checker.js',
  './js/profile.js',
  './js/wallet.js',
  './js/mood-sleep-tracker.js',
  './js/cycle-tracker.js',
  './js/pain-tracker.js',
  './js/digestive-tracker.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

// ── Install: pre-cache the app shell ────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache what we can; ignore individual failures (some files may not exist yet)
      return Promise.allSettled(
        APP_SHELL.map((url) => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: serve from cache, update in background ───────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept Supabase API calls — let JS handle offline via localStorage
  if (url.hostname.includes('supabase.co')) return;
  // Never intercept Chrome extensions
  if (url.protocol === 'chrome-extension:') return;
  // Never intercept non-GET requests
  if (event.request.method !== 'GET') return;

  // Google Fonts / CDN assets: cache-first
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
          }
          return response;
        }).catch(() => cached || new Response('', { status: 503 }));
      })
    );
    return;
  }

  // Admin / clinic / pharmacy / rider portals: always network-first (auth-sensitive)
  if (
    url.pathname.includes('/admin/') ||
    url.pathname.includes('/clinic/') ||
    url.pathname.includes('/pharmacy/') ||
    url.pathname.includes('/rider/')
  ) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell: cache-first, refresh in background (stale-while-revalidate)
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((c) => c.put(event.request, clone));
        }
        return response;
      }).catch(() => null);

      // Return cache immediately if available; otherwise wait for network
      return cached || networkFetch.then((r) => r || new Response(
        '<h2 style="font-family:sans-serif;text-align:center;padding:40px">You are offline.<br>Please reconnect to continue.</h2>',
        { headers: { 'Content-Type': 'text/html' } }
      ));
    })
  );
});
