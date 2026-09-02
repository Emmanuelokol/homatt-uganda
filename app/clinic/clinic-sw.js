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
const CACHE = 'homatt-clinic-v140';

// The core pages that must be openable offline. Kept as an explicit list so the
// worker can guarantee they're cached (and repair them if a precache ever fails).
const CORE_PAGES = ['./', 'index.html', 'dashboard.html', 'new-order.html', 'settings.html', 'messages.html', 'guidelines.html'];

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
  'messages.html',
  'guidelines.html',
  'js/guidelines.js?v=20260908',
  'js/vendor/sql-wasm.js',
  'js/ucg-autofill.js?v=20260906',
  'manifest.json',
  'js/vendor/supabase.min.js?v=2110',
  'fonts/material-icons.css?v=1',
  'fonts/material-icons-outlined.woff2?v=1',
  'fonts/inter.css?v=1',
  'fonts/inter-latin.woff2?v=1',
  'css/clinic.css?v=20260905',
  'js/clinic.js?v=20260831',
  'js/messages.js?v=20260811',
  'js/clinic-offline.js?v=20260830a',
  'js/stock-blueprints.js?v=20260906',
  'js/stock-intake.js?v=20260902',
  'js/new-order-wizard.js?v=20260905',
  'js/msg-alerts.js?v=20260829',
  'js/pwa-install.js?v=20260831',
  '../js/config.js',
  '../js/native-bridge.js',
  'icons/clinic-192.png?v=3',
  'icons/clinic-512.png?v=3',
  'icons/logo-mark.svg?v=1',
];

let _lastSelfUpdateCheck = 0;

// ── IndexedDB shell store ────────────────────────────────────────────────────
// A SECOND, independent copy of the app shell. Some phones (Samsung cleaners,
// "free up space" tools) wipe Cache Storage while leaving site data intact —
// which left the cache empty ("Saved pages: 0") no matter how it was filled.
// IndexedDB lives in the protected site-data class (like localStorage, which
// demonstrably survives on those phones), so the app can boot from it when the
// cache has been wiped. Keys are absolute pathnames (no query).
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('homatt-shell', 1);
    r.onupgradeneeded = () => { try { r.result.createObjectStore('files'); } catch (e) {} };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const rq = db.transaction('files', 'readonly').objectStore('files').get(key);
      rq.onsuccess = () => res(rq.result || null);
      rq.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
async function idbPut(key, rec) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(rec, key);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    return true;
  } catch (e) { return false; }
}
function idbKeyFor(u) {
  try { return new URL(u, self.registration.scope).pathname; } catch (e) { return null; }
}
function ctFor(path) {
  if (/\.html($|\?)|\/$/.test(path)) return 'text/html; charset=utf-8';
  if (/\.js($|\?)/.test(path)) return 'application/javascript; charset=utf-8';
  if (/\.css($|\?)/.test(path)) return 'text/css; charset=utf-8';
  if (/\.webmanifest($|\?)/.test(path)) return 'application/manifest+json';
  return 'text/plain; charset=utf-8';
}
// Serve a stored file as a Response, or null.
async function idbServe(pathname) {
  const rec = await idbGet(pathname);
  if (!rec || rec.body == null) return null;
  return new Response(rec.body, { headers: { 'Content-Type': rec.ct || ctFor(pathname) } });
}
// Find ANY stored page (for navigation fallback).
async function idbAnyPage() {
  const scope = new URL(self.registration.scope).pathname;
  for (const p of ['dashboard.html', 'index.html', 'new-order.html', 'settings.html']) {
    const hit = await idbServe(scope + p);
    if (hit) return hit;
  }
  return null;
}

function isVendor(url) {
  return url.hostname.indexOf('cdn.jsdelivr.net') >= 0 ||
         url.hostname.indexOf('fonts.googleapis.com') >= 0 ||
         url.hostname.indexOf('fonts.gstatic.com') >= 0;
}

// A response that is SAFE to hand to a navigation. Serving a response whose
// `redirected` flag is set (or an opaqueredirect from cache) to a navigation is
// a spec-level network error — Chrome then shows ITS OWN dark "You're offline"
// screen even though we "responded". Rebuilding the response from its body
// strips the flag. Old caches can contain such poisoned entries (they predate
// the !r.redirected guards and are migrated forward on update), so every page
// served to a navigation passes through here.
async function navSafe(resp) {
  try {
    if (!resp) return resp;
    if (!resp.redirected && resp.type !== 'opaqueredirect') return resp;
    const body = await resp.clone().blob();
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': resp.headers.get('Content-Type') || 'text/html; charset=utf-8' },
    });
  } catch (e) { return resp; }
}

// Find a cached page across EVERY clinic cache (current + any not-yet-deleted
// older version), most-specific first. This is what lets the portal always open
// to its real UI offline — like Google Docs — instead of a dead-end page.
async function matchAnyCache(req) {
  // caches.keys() can itself throw on some devices (storage pressure, cleaner
  // mid-wipe). A throw here must degrade to "no hit", never to a crash.
  let keys = [];
  try { keys = await caches.keys(); } catch (e) {}
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
  // LAST RESORT: return ANY cached HTML page from any clinic cache. Opening the
  // "wrong" clinic page is still far better than a dead-end — the app's own
  // routing/nav takes over from there. This is what guarantees the portal opens
  // offline as long as it was EVER loaded online, even once.
  for (const key of clinicKeys) {
    try {
      const c = await caches.open(key);
      const reqs = await c.keys();
      for (const rq of reqs) {
        if (rq.mode === 'navigate' || /\.html($|\?)/i.test(rq.url) || /\/clinic\/(\?|$)/.test(rq.url)) {
          const hit = await c.match(rq);
          if (hit) return hit;
        }
      }
    } catch (e) {}
  }
  return null;
}

// Opportunistically cache the WHOLE app shell from a single successful online
// load. The install/activate precache can fail on a flaky connection (and older
// buggy versions could wipe the cache) — this makes ANY good online page load
// re-populate everything, so the app reliably opens offline afterwards.
let _shellEnsuredAt = 0;
// ── Data budget ────────────────────────────────────────────────────────────
// Mobile data here is bought by the megabyte. Measured before this: opening
// the app re-downloaded 1.27 MB of files it already had, every single time,
// because every asset was revalidated on every load. These two helpers stop
// that without ever risking a stale app: versioned files are treated as
// immutable (their ?v= changes when they do), and pages are refreshed on a
// timer instead of on every navigation.
const REVALIDATE_EVERY = 6 * 60 * 60 * 1000;     // a page, at most 4× a day

async function metaGet(key) {
  try { const r = await idbGet('__meta__' + key); return r && Number(r.body) || 0; }
  catch (e) { return 0; }
}
async function metaSet(key, val) {
  try { await idbPut('__meta__' + key, { body: String(val), ct: 'text/plain' }); } catch (e) {}
}

// A file whose URL carries its version, or that never changes without one,
// can be served from the cache for good — fetching it again buys nothing and
// costs the clinic money.
function isImmutable(url) {
  if (url.origin !== self.location.origin) return false;
  if (/[?&]v=/.test(url.search)) return true;
  return /\/(fonts|icons)\/|\/js\/vendor\/|\.(woff2?|ttf|otf|png|jpg|jpeg|svg|wasm)($|\?)/i.test(url.pathname);
}

async function ensureShellCached(cache, force) {
  const now = Date.now();
  if (!force && now - _shellEnsuredAt < 45 * 1000) return;   // throttle unless forced
  _shellEnsuredAt = now;
  await Promise.all(SHELL.map(async (u) => {
    try {
      const cached = !force && await cache.match(u);
      if (cached) {
        // Cache already has it — make sure the IndexedDB mirror does too, by
        // copying the CACHED body across (no network). Without this the mirror
        // stayed empty on healthy devices, so when a cleaner later wiped Cache
        // Storage there was no second copy to boot from.
        if (!/\.(png|woff2?|ttf|otf)($|\?)/i.test(u)) {
          try {
            const key = idbKeyFor(u);
            if (key && !(await idbGet(key))) {
              const body = await cached.clone().text();
              if (body) await idbPut(key, { body: body, ct: cached.headers.get('Content-Type') || ctFor(u) });
            }
          } catch (e) {}
        }
        return;
      }
      const r = await fetch(u, { cache: 'no-cache', credentials: 'same-origin' });
      if (r && r.ok && !r.redirected) {
        await cache.put(u, r.clone());
        // Dual-write text files into the IndexedDB shell store (second copy —
        // survives cleaners that wipe Cache Storage). Binary assets (icons,
        // fonts) are skipped: they'd corrupt as text and aren't needed to boot.
        if (!/\.(png|woff2?|ttf|otf)($|\?)/i.test(u)) {
          try {
            const key = idbKeyFor(u);
            const body = await r.clone().text();
            if (key && body) await idbPut(key, { body: body, ct: r.headers.get('Content-Type') || ctFor(u) });
          } catch (e) {}
        }
      }
    } catch (e) {}
  }));
}

// Let a page explicitly ask the worker to (re)cache the whole shell. This is
// the most reliable path — it doesn't depend on fetch-interception timing — so
// every online page load guarantees the app can be opened offline afterwards.
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && data.type === 'ensureShell') {
    event.waitUntil(caches.open(CACHE).then((c) => ensureShellCached(c, true)).catch(() => {}));
  }
  // A newly installed version can sit "waiting" until every page is closed —
  // on the Android app that can be days, so a fix looks like it never shipped.
  // The page asks for it as soon as it notices; take over immediately.
  if (data && data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Background Sync: the OS fires this the MOMENT connectivity returns — even
// when the page never gets an 'online' event (common on Android). Tell every
// open page to push its offline outbox right now. The pages re-register the
// tag on each enqueue, so this re-arms itself for every batch of changes.
self.addEventListener('sync', (event) => {
  if (event.tag !== 'homatt-outbox') return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => { clients.forEach((c) => { try { c.postMessage({ type: 'flushOutbox' }); } catch (e) {} }); })
      .catch(() => {})
  );
});

function offlineFallbackResponse() {
  // This page is a genuine last resort (empty cache). It is NOT a dead-end: it
  // repairs itself. It (1) checks whether pages are actually cached and, if so,
  // jumps straight into the app; (2) when online, fetches the core pages into
  // the cache DIRECTLY (independent of the worker) and then opens the app; and
  // (3) shows a small diagnostic line so the real state is visible.
  var script =
    '(function(){' +
    'var st=function(t){var e=document.getElementById("st");if(e)e.textContent=t;};' +
    'var big=function(h){var e=document.getElementById("bigmsg");if(e){e.style.display="block";e.innerHTML=h;}};' +
    'function core(){return ["index.html","dashboard.html","new-order.html","settings.html","./"];}' +
    'async function countPages(){var n=0;try{var ks=await caches.keys();for(var i=0;i<ks.length;i++){if(ks[i].indexOf("homatt-clinic-")!==0)continue;var c=await caches.open(ks[i]);var rs=await c.keys();for(var j=0;j<rs.length;j++){if(/\\.html($|\\?)|\\/clinic\\/(\\?|$)/.test(rs[j].url))n++;}}}catch(e){}' +
    'try{n+=await new Promise(function(res){var q=indexedDB.open("homatt-shell",1);q.onupgradeneeded=function(){try{q.result.createObjectStore("files")}catch(e){}};q.onsuccess=function(){try{var rq=q.result.transaction("files","readonly").objectStore("files").getAllKeys();rq.onsuccess=function(){var m=0;(rq.result||[]).forEach(function(k){if(/\\.html$|\\/$/.test(String(k)))m++;});res(m);};rq.onerror=function(){res(0);};}catch(e){res(0)}};q.onerror=function(){res(0)};});}catch(e){}' +
    'return n;}' +
    // Test whether this device can WRITE to cache storage at all, and report the
    // exact failure. QuotaExceededError = phone storage is full — the one cause
    // no code can work around, but the user can fix in a minute.
    'async function testWrite(){try{var c=await caches.open("homatt-clinic-probe");await c.put("__probe__",new Response("ok"));var hit=await c.match("__probe__");await caches.delete("homatt-clinic-probe");return hit?{ok:true}:{ok:false,err:"write did not persist"};}catch(e){return {ok:false,err:(e&&(e.name+": "+e.message))||"unknown"};}}' +
    'async function healOnline(){var okAny=false;try{var ks=(await caches.keys()).filter(function(k){return k.indexOf("homatt-clinic-")===0;});if(!ks.length)ks=["homatt-clinic-v140"];for(var i=0;i<ks.length;i++){var c=await caches.open(ks[i]);var cs=core();for(var j=0;j<cs.length;j++){try{var r=await fetch(cs[j],{cache:"reload"});if(r&&r.ok&&!r.redirected){await c.put(cs[j],r.clone());okAny=true;}}catch(e){}}}}catch(e){}return okAny;}' +
    'async function run(){' +
    'var tries=0;try{tries=parseInt(sessionStorage.getItem("_healTries")||"0",10);}catch(e){}' +
    'var pages=await countPages();' +
    'if(pages>0&&tries<2){try{sessionStorage.setItem("_healTries",String(tries+1));}catch(e){}location.replace("dashboard.html");return;}' +
    'var w=await testWrite();' +
    'if(!w.ok){' +
      'var quota=/quota/i.test(w.err);' +
      'big(quota' +
        '?"<b>Your phone\\u2019s storage is full.</b><br>Homatt Health cannot save the app for offline use until some space is freed.<br><br>Please delete a few photos, videos or unused apps, then open Homatt Health once with internet \\u2014 offline will work from then on."' +
        ':"<b>This phone is blocking offline storage.</b><br>Technical detail: "+w.err+"<br><br>Check: not an Incognito/private tab, and site data is allowed for this site.");' +
      'st("Storage test failed: "+w.err);' +
      'return;' +
    '}' +
    'if(navigator.onLine){st("Finishing setup\\u2026");var ok=await healOnline();if(ok){try{sessionStorage.removeItem("_healTries");}catch(e){}location.replace("dashboard.html");return;}st("Connected but could not download pages \\u2014 check the connection and tap Retry.");return;}' +
    'st("Offline. Saved pages: "+pages+". Storage is OK \\u2014 connect once and the app will finish setting up by itself.");' +
    '}' +
    'addEventListener("online",function(){run();});' +
    'setInterval(function(){if(navigator.onLine)run();},4000);' +
    'run();' +
    '})();';
  return new Response(
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Homatt Health — Offline</title>' +
    '<scr' + 'ipt>' + script + '</scr' + 'ipt>' +
    '</head>' +
    '<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 24px;color:#37474F">' +
    '<div style="font-size:44px">📴</div>' +
    '<h2 style="color:#1B5E20">Setting up…</h2>' +
    '<p style="max-width:320px;margin:8px auto;line-height:1.5">Homatt Health needs an internet connection just once to finish installing. It will reconnect and finish automatically — or tap Retry.</p>' +
    '<p id="bigmsg" style="display:none;max-width:340px;margin:14px auto;line-height:1.6;font-size:14px;color:#B71C1C;background:#FFEBEE;border-radius:12px;padding:14px 16px;text-align:left"></p>' +
    '<p id="st" style="max-width:320px;margin:8px auto;font-size:12px;color:#9AA0A6"></p>' +
    '<button onclick="location.reload()" style="margin-top:14px;background:#1B5E20;color:#fff;border:none;border-radius:10px;padding:12px 20px;font-size:15px;font-weight:700">Retry</button>' +
    '</body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

// An update should only cost the clinic the files that actually changed.
// Every asset URL carries its own version, so an entry with the identical URL
// in the previous cache is the identical file — copying it across costs
// nothing, where re-downloading the whole shell cost about 580 KB on every
// single app update, on every phone.
async function carryOver(newCache, url) {
  try {
    if (await newCache.match(url)) return true;
    const keys = await caches.keys();
    const olds = keys.filter((k) => k !== CACHE && k.indexOf('homatt-clinic-') === 0);
    for (let i = olds.length - 1; i >= 0; i--) {
      const old = await caches.open(olds[i]);
      const hit = await old.match(url);
      if (hit) { await newCache.put(url, hit.clone()); return true; }
    }
  } catch (e) {}
  return false;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (c) => {
      // The install MUST NOT throw. A failed install means the worker never
      // activates — and with no active worker the BROWSER shows its own dark
      // "You're offline" page on launch (exactly the bug we're chasing). So
      // cache the core pages as hard as we can but NEVER fail the install; the
      // activate-repair step, opportunistic per-load caching and the IndexedDB
      // mirror fill any gaps. An always-active worker is what keeps the app's
      // own offline handling in control instead of the browser's.
      // The pages themselves are not versioned, so they are always fetched —
      // that is how new code reaches the phone.
      await Promise.allSettled(CORE_PAGES.map(async (u) => {
        try {
          const r = await fetch(u, { cache: 'no-cache', credentials: 'same-origin' });
          if (r && r.ok && !r.redirected) await c.put(u, r);
        } catch (e) {}
      }));
      // Everything else: take it from the previous cache when the URL is
      // unchanged, and only download what is genuinely new.
      Promise.allSettled(VENDOR.map(async (u) => {
        if (await carryOver(c, u)) return;
        return c.add(u).catch(() => {});
      }));
      Promise.allSettled(
        SHELL.filter((u) => CORE_PAGES.indexOf(u) < 0).map(async (u) => {
          if (await carryOver(c, u)) return;
          return c.add(u).catch(() => {});
        })
      );
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
          try {
            if (await target.match(rq)) continue;   // keep the fresher copy
            const resp = await old.match(rq);
            if (!resp) continue;
            // CLEANSE while migrating: a response with the `redirected` flag is
            // fatal when later served to a navigation (Chrome treats it as a
            // network error and shows its own offline screen). Rebuild those
            // from their body so the poison never travels forward.
            await target.put(rq, await navSafe(resp.clone()));
          } catch (e) {}
        }
      } catch (e) {}
    }

    // 2) REPAIR first (before deleting anything): make sure the core pages are
    //    present in the new cache. Best-effort and silently skipped offline.
    await Promise.all(CORE_PAGES.map(async (u) => {
      try {
        if (await target.match(u)) return;
        const r = await fetch(u, { cache: 'no-cache' });
        if (r && r.ok && !r.redirected) await target.put(u, r.clone());
      } catch (e) {}
    }));

    // 2b) Mirror the core pages into the IndexedDB second copy too, straight
    //     from the cache — every UPDATE now guarantees the backup exists.
    await Promise.all(CORE_PAGES.map(async (u) => {
      try {
        const hit = await target.match(u);
        if (!hit) return;
        const key = idbKeyFor(u);
        if (key && !(await idbGet(key))) {
          const body = await hit.clone().text();
          if (body) await idbPut(key, { body: body, ct: hit.headers.get('Content-Type') || ctFor(u) });
        }
      } catch (e) {}
    }));

    // 3) Only drop the OLD clinic caches once the new cache can actually serve
    //    the shell offline. If a device updated while offline and the migration
    //    couldn't carry the shell across, we KEEP the old caches so matchAnyCache
    //    can still open the app from them — never leaving it with no shell at all.
    const shellReady = (await target.match('dashboard.html')) ||
                       (await target.match('index.html')) ||
                       (await target.match('./'));
    const dropKeys = shellReady
      ? keys.filter((k) => k !== CACHE)                                     // safe: drop all others
      : keys.filter((k) => k !== CACHE && k.indexOf('homatt-clinic-') !== 0); // keep old clinic caches as fallback
    await Promise.all(dropKeys.map((k) => caches.delete(k)));

    await self.clients.claim();
    // NOTE: we deliberately do NOT force-navigate open pages on update. A new
    // version is served silently on the NEXT launch (cache-first), so the app
    // opens instantly like a native app instead of visibly reloading itself.
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }

  // The clinical-guidelines database (~6MB) and the SQLite engine are cached
  // on first use rather than at install, so installing the app stays fast on a
  // slow link. Once a clinician opens Guidelines while online, the whole book
  // is available offline for good. Cache-first: never re-download it.
  if (url.origin === self.location.origin &&
      (/\/data\/.*\.db($|\?)/.test(url.pathname) || /sql-wasm\.wasm($|\?)/.test(url.pathname))) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res && res.ok && !res.redirected) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match(req).then((h) => h || new Response('', { status: 504 }))))
    );
    return;
  }

  // CDN + fonts (cross-origin): cache-first so they work offline. Two guards
  // learned the hard way:
  //   • never respondWith(undefined) — it leaves the request hanging forever
  //     and stalls the page's load event offline;
  //   • cap the network wait at 8s — a black-hole connection (dead upstream,
  //     captive portal) would otherwise stall page load just as badly.
  // Falling back to an empty stylesheet is safe: fonts/icons are also bundled
  // locally (fonts/*.css in the shell).
  if (isVendor(url)) {
    const emptyCss = () => new Response('/* offline */', { status: 200, headers: { 'Content-Type': 'text/css' } });
    const timedFetch = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('vendor fetch timeout')), 8000);
      fetch(req).then((r) => { clearTimeout(t); resolve(r); }, (e) => { clearTimeout(t); reject(e); });
    });
    event.respondWith(
      caches.match(req).then((hit) => hit || timedFetch.then((res) => {
        if (res && (res.status === 200 || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit || emptyCss()))
      .catch(() => emptyCss())
    );
    return;
  }

  // Any other cross-origin (Supabase API, WhatsApp, etc.): don't intercept.
  if (url.origin !== self.location.origin) return;

  // HTML navigations → CACHE-FIRST (app-shell model).
  //
  // Why cache-first and not network-first: on an installed PWA/WebAPK launch,
  // network-first leaves a window where the OS/browser shows its OWN dark
  // "You're offline" screen before our cache fallback runs. Serving the saved
  // page INSTANTLY from cache closes that window entirely — the app opens
  // immediately, online or offline, every launch. Auth lives in localStorage
  // (not the HTML), so a cached shell is always safe; we revalidate in the
  // background to stay fresh, and the worker's own update + reload path applies
  // any new code.
  if (req.mode === 'navigate') {
    // Opportunistic self-update: pages running OLD code never ask for updates,
    // so the worker checks for a newer version of itself on navigations
    // (throttled). This is how stuck devices eventually receive fixes.
    const now = Date.now();
    if (now - _lastSelfUpdateCheck > 6 * 60 * 60 * 1000) {
      _lastSelfUpdateCheck = now;
      try { self.registration.update().catch(() => {}); } catch (e) {}
    }
    event.respondWith((async () => {
      // ABSOLUTE RULE: this function must ALWAYS resolve with a Response. A
      // rejection (or a redirected response reaching the navigation) makes
      // Chrome show ITS OWN dark "You're offline" screen — the exact dead end
      // this worker exists to prevent. Hence the outer try/catch and navSafe().
      try {
        // Background revalidate — never blocks the response; refreshes the
        // cache (and the whole shell) for next time. Never rejects.
        //
        // It does NOT run on every navigation any more. These pages are large
        // (the dashboard is ~190 KB compressed) and re-fetching one on every
        // open was the single biggest recurring cost the app had. Once every
        // six hours keeps a clinic on current code within a day, for a
        // twentieth of the data.
        const lastRev = await metaGet(url.pathname);
        const dueForRefresh = (now - lastRev) > REVALIDATE_EVERY;
        const netUpdate = !dueForRefresh ? Promise.resolve(null) :
          fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
          .then((res) => {
            metaSet(url.pathname, Date.now());
            if (res && res.ok && !res.redirected) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => {
                c.put(req, copy).catch(() => {});
                ensureShellCached(c);
              }).catch(() => {});
            }
            return res;
          })
          .catch(() => null);

        // 1) Cache first — instant, reliable, no browser offline screen.
        const cachedHit = await matchAnyCache(req);
        if (cachedHit) return await navSafe(cachedHit);

        // 2) IndexedDB shell copy — survives cleaners that wipe Cache Storage.
        const idbHit = (await idbServe(url.pathname)) ||
                       (await idbServe(url.pathname.replace(/\/$/, '/index.html'))) ||
                       (await idbAnyPage());
        if (idbHit) return idbHit;

        // 3) Never cached yet (true first run) → wait for the network, then the
        //    self-healing placeholder.
        const net = await netUpdate;
        if (net && (net.ok || net.type === 'opaqueredirect' || net.type === 'opaque')) return net;
        return offlineFallbackResponse();
      } catch (e) {
        // Whatever broke above, the user still gets OUR page, never Chrome's.
        try { return offlineFallbackResponse(); }
        catch (e2) { return new Response('Homatt Health — reload to continue', { headers: { 'Content-Type': 'text/plain' } }); }
      }
    })());
    return;
  }

  // A file that carries its own version in the URL cannot change without the
  // URL changing, so once it is on the phone it is served from there for good.
  // This is what stops the app re-downloading its own scripts, styles, fonts
  // and icons every time it is opened — over a megabyte a day, for files the
  // phone already had.
  if (isImmutable(url)) {
    event.respondWith(
      caches.match(req).then((hit) => hit ||
        caches.match(req, { ignoreSearch: false }).then((h2) => h2 ||
          fetch(req).then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }).catch(async () =>
            (await caches.match(req, { ignoreSearch: true })) ||
            (await idbServe(url.pathname)) ||
            Response.error())))
    );
    return;
  }

  // Everything else same-origin → stale-while-revalidate. Deep fallbacks when offline:
  // an ignoreSearch cache match (so a different ?v= query still resolves the
  // cached file) then the IndexedDB shell copy — so scripts/CSS/fonts always
  // load even if a page requests a slightly different asset version than the
  // shell precached.
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
        .catch(async () => cached ||
          (await caches.match(req, { ignoreSearch: true })) ||
          (await idbServe(url.pathname)) ||
          Response.error());
      return cached || network;
    })
  );
});
