/* Homatt Health — clinic portal offline data layer
 *
 * Gives the portal last-known data when there's no connection:
 *   • ClinicOffline.set(key, value)        — cache a value (per browser)
 *   • ClinicOffline.get(key, fallback)     — read a cached value
 *   • ClinicOffline.cachedQuery(key, run)  — run a Supabase query, cache the
 *       result on success, and transparently return the cached result when the
 *       device is offline or the query fails.
 *   • A bottom "Offline — showing saved data" banner while disconnected.
 *
 * Writes made while offline are handled by the page (an outbox that replays on
 * reconnect); this file is the read/caching + status half.
 */
(function () {
  'use strict';
  var PREFIX = '_co_';

  // Ask the browser to KEEP our cached data & queued changes even under storage
  // pressure. Without this, phones can silently evict the cache after a while —
  // this is what lets a clinic stay offline for weeks/months without losing the
  // app, its saved data, or unsynced sales.
  try {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persisted().then(function (p) {
        if (!p) navigator.storage.persist().catch(function () {});
      }).catch(function () {});
    }
  } catch (e) {}

  // Whenever a page is open online, explicitly ask the service worker to cache
  // the whole app shell. This is the reliable path that guarantees the portal
  // can be opened offline afterwards — it doesn't depend on the worker happening
  // to intercept the right navigation, and it self-heals a cache an older buggy
  // version may have wiped. Fires on load and on every reconnect.
  function warmShell() {
    try {
      if (navigator.onLine === false) return;
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.ready.then(function (reg) {
        var sw = reg.active || (navigator.serviceWorker.controller);
        if (sw) sw.postMessage({ type: 'ensureShell' });
      }).catch(function () {});
      // VERIFY the pages really got saved (10s later, while still online). If
      // the cache is still empty, the device is refusing storage writes — the
      // one failure that must be surfaced NOW (while online and fixable), not
      // discovered later when the clinic is offline and stuck.
      setTimeout(verifyShellSaved, 10000);
    } catch (e) {}
  }
  async function verifyShellSaved() {
    try {
      if (navigator.onLine === false || !window.caches) return;
      var pages = 0;
      var keys = await caches.keys();
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('homatt-clinic-') !== 0) continue;
        var c = await caches.open(keys[i]);
        var rs = await c.keys();
        for (var j = 0; j < rs.length; j++) {
          if (/\.html($|\?)|\/clinic\/(\?|$)/.test(rs[j].url)) pages++;
        }
      }
      if (pages > 0) return;                       // all good — offline will work
      // Nothing saved: probe WHY and tell the user in plain words.
      var reason = '';
      try {
        var pc = await caches.open('homatt-clinic-probe');
        await pc.put('__probe__', new Response('ok'));
        var hit = await pc.match('__probe__');
        await caches.delete('homatt-clinic-probe');
        if (!hit) reason = 'writes do not persist';
      } catch (e) { reason = (e && e.name) || 'write failed'; }
      if (!reason) {
        // Writes work but pages missing — ask the worker again and re-check once.
        warmShellOnceMore();
        return;
      }
      var quota = /quota/i.test(reason);
      showStorageWarning(quota
        ? 'This phone’s storage is full — Homatt Health can’t save the app for offline use. Free up some space (photos/videos/apps), then reopen with internet.'
        : 'This phone is blocking offline storage (' + reason + '). Offline mode won’t work until site storage is allowed.');
    } catch (e) {}
  }
  var _warmRetried = false;
  function warmShellOnceMore() {
    if (_warmRetried) return;
    _warmRetried = true;
    warmShell();
  }
  function showStorageWarning(text) {
    if (document.getElementById('_coStorageWarn')) return;
    if (!document.body) return;
    var d = document.createElement('div');
    d.id = '_coStorageWarn';
    d.style.cssText = 'position:fixed;left:10px;right:10px;top:10px;z-index:11500;background:#B71C1C;color:#fff;' +
      'border-radius:12px;padding:12px 40px 12px 14px;font-size:13px;font-weight:600;line-height:1.5;' +
      'box-shadow:0 6px 18px rgba(0,0,0,0.3);font-family:inherit';
    d.textContent = text;
    var x = document.createElement('button');
    x.textContent = '×';
    x.setAttribute('aria-label', 'Dismiss');
    x.style.cssText = 'position:absolute;right:6px;top:6px;background:transparent;border:none;color:#fff;font-size:20px;line-height:1;padding:4px 8px;cursor:pointer';
    x.onclick = function () { d.remove(); };
    d.appendChild(x);
    document.body.appendChild(d);
  }
  warmShell();
  window.addEventListener('online', warmShell);

  function k(key) { return PREFIX + key; }
  function set(key, value) {
    try { localStorage.setItem(k(key), JSON.stringify({ ts: Date.now(), v: value })); } catch (e) {}
  }
  function raw(key) {
    try { var r = localStorage.getItem(k(key)); return r ? JSON.parse(r) : null; } catch (e) { return null; }
  }
  function get(key, fallback) {
    var r = raw(key);
    return r ? r.v : (fallback === undefined ? null : fallback);
  }
  function age(key) { var r = raw(key); return r ? Date.now() - r.ts : Infinity; }
  function isOffline() { return navigator.onLine === false; }

  // Race a promise against a timeout so a stalled request on a poor connection
  // can NEVER hang the UI. Resolves with a supabase-style error result on
  // timeout (never rejects).
  var NET_TIMEOUT_MS = 7000;
  function withTimeout(promise, ms) {
    return Promise.race([
      Promise.resolve(promise).catch(function (e) { return { data: null, error: e || { message: 'request failed' } }; }),
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve({ data: null, error: { message: 'timeout — poor connection' }, _timeout: true });
        }, ms || NET_TIMEOUT_MS);
      }),
    ]);
  }

  // run() should return a Promise resolving to a supabase-style {data, error}.
  //
  // CACHE-FIRST (instant on very slow internet). If we already have saved data
  // for this key, return it IMMEDIATELY — online or offline — so the screen
  // paints at once instead of waiting on a crawling connection. When online and
  // the cache is a little stale, a background refresh (capped by the timeout)
  // updates it for the next read. Only the very first load with NO cache waits
  // on the network.
  var _revalidating = {};
  async function cachedQuery(key, run) {
    var c = raw(key);
    if (c) {
      if (!isOffline()) {
        var age = Date.now() - (c.ts || 0);
        // Throttle: don't hammer a slow link — refresh at most every ~12s/key.
        if (age > 12000 && !_revalidating[key]) {
          _revalidating[key] = true;
          withTimeout(run())
            .then(function (res) { if (res && !res.error && res.data != null) set(key, res.data); })
            .catch(function () {})
            .then(function () { _revalidating[key] = false; });
        }
      }
      return { data: c.v, error: null, fromCache: true, cachedAt: c.ts };
    }
    // No saved data yet (first-ever load) → must wait for the network.
    if (isOffline()) return { data: null, error: { message: 'offline — no saved data yet' } };
    try {
      var res = await withTimeout(run());
      if (res && !res.error && res.data != null) {
        set(key, res.data);
        return { data: res.data, error: null, fromCache: false };
      }
      return res || { data: null, error: { message: 'No data' } };
    } catch (e) {
      return { data: null, error: e };
    }
  }

  // Is this error a lost-connection error (or are we simply offline)?
  function isNetworkErr(e) {
    var m = (e && e.message) || String(e || '');
    return isOffline() || /Failed to fetch|NetworkError|network ?error|ERR_INTERNET|Load failed|fetch|timeout/i.test(m);
  }
  // Friendly placeholder to show in a section instead of a raw error offline.
  function offlineHtml(msg) {
    return '<div style="padding:22px;text-align:center;color:#5F6368;font-size:13px">' +
      '<span class="material-icons-outlined" style="font-size:26px;display:block;margin-bottom:6px;color:#B0BEC5">cloud_off</span>' +
      (msg || 'You’re offline — reconnect to load this.') + '</div>';
  }

  // ── Offline write outbox ─────────────────────────────────────────────────
  // Mutations made offline are queued here and replayed (in order) when the
  // connection returns. The page registers a sync handler that knows how to
  // perform each queued op against Supabase.
  var OUTBOX = 'outbox';
  var _handlers = {};   // op type -> async fn(item) => boolean (true = done)
  var _syncing = false;

  function outbox() { return get(OUTBOX, []) || []; }
  function saveOutbox(list) { set(OUTBOX, list); updateIndicator(); }
  function pendingCount() { return outbox().length; }

  function enqueue(type, payload) {
    var list = outbox();
    list.push({
      id: 'op_' + Date.now() + '_' + Math.floor(Math.random() * 1e6),
      type: type, payload: payload, ts: Date.now(),
    });
    saveOutbox(list);
    // Arm the OS-level reconnect trigger: the service worker's Background Sync
    // fires the instant connectivity returns and tells us to flush — no
    // refresh, no waiting for an 'online' event that may never come.
    try { requestBackgroundSync(); } catch (e) {}
    return list.length;
  }

  // Queue a Supabase RPC to run when online. A client op id is added so the
  // idempotent server overloads never apply it twice on a retry.
  function enqueueRpc(fn, args) {
    var a = {};
    for (var k in (args || {})) { if (Object.prototype.hasOwnProperty.call(args, k)) a[k] = args[k]; }
    if (a.p_op_id == null) a.p_op_id = uuid();
    return enqueue('rpc', { fn: fn, args: a });
  }

  // Register a replay handler for one op type. Multiple types can be registered
  // (from different modules/pages), so a queued item syncs wherever a handler
  // for its type is loaded — a sale queued offline still syncs from the
  // dashboard, a consultation from any page that loaded clinic.js, etc.
  function registerSyncHandler(type, fn) { _handlers[type] = fn; if (!isOffline()) flush(); }

  var _retryTimer = null;
  function _scheduleRetry(ms) {
    if (_retryTimer) return;
    _retryTimer = setTimeout(function () { _retryTimer = null; flush(); }, ms || 8000);
  }

  // On reconnect, retry a few times over the first ~20s instead of just once. A
  // single attempt often fires a moment before the connection is truly ready
  // (or before the auth session refreshes), which is why syncing used to need a
  // manual page refresh. The _syncing guard makes overlapping calls safe.
  var _burstTimers = [];
  function burstFlush() {
    _burstTimers.forEach(function (t) { clearTimeout(t); });
    _burstTimers = [300, 2000, 5000, 10000, 20000].map(function (ms) {
      return setTimeout(function () { if (pendingCount() > 0 && !isOffline()) flush(); }, ms);
    });
    if (!isOffline()) flush();
  }

  async function flush(force) {
    if (_syncing || (isOffline() && !force)) return;
    var list = outbox();
    if (!list.length) { updateIndicator(); return; }
    if (!Object.keys(_handlers).length) return;
    _syncing = true;
    var anyFailed = false, anyDropped = 0;
    var PERM_MAX_TRIES = 4;   // permanent rejections give up after this many
    try {
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var h = _handlers[item.type];
        if (!h) continue;                 // no handler here — leave for later
        var r;
        try {
          // Cap each push at 20s so a request stalled on very slow internet can
          // never wedge the queue with _syncing stuck true.
          r = await withTimeout(h(item), 20000);
        } catch (e) { r = false; }        // threw → treat as retryable

        if (r === true) {
          // Success — remove it.
          saveOutbox(outbox().filter(function (x) { return x.id !== item.id; }));
        } else if (r === 'permanent') {
          // The server RAN and rejected it. Retrying can't help — but give it a
          // few quick attempts first so a one-off blip can't discard real data.
          var tries = (item.tries || 0) + 1;
          if (tries >= PERM_MAX_TRIES) {
            saveOutbox(outbox().filter(function (x) { return x.id !== item.id; }));
            anyDropped++;
          } else {
            saveOutbox(outbox().map(function (x) {
              return x.id === item.id ? Object.assign({}, x, { tries: tries }) : x;
            }));
            anyFailed = true;
          }
        } else {
          // Network/offline error (or timeout token) → keep & retry forever.
          // Does NOT count toward the give-up cap.
          anyFailed = true;
        }
      }
      if (anyDropped) {
        try {
          showToast(anyDropped + ' offline change' + (anyDropped > 1 ? 's' : '') +
            ' could not be saved and ' + (anyDropped > 1 ? 'were' : 'was') +
            ' discarded. Please try again.', 'error');
        } catch (e) {}
      }
    } finally {
      _syncing = false;
      updateIndicator();
      // Slow-but-online connections: keep retrying automatically until the
      // queue drains — the user never has to do anything.
      if (anyFailed && !isOffline()) _scheduleRetry(8000);
      // When the queue finishes draining, tell the page so it can refresh its
      // figures from the server (replacing the optimistic offline deltas) with
      // no manual reload.
      if (list.length && pendingCount() === 0) {
        try { window.dispatchEvent(new CustomEvent('clinic-synced')); } catch (e) {}
      }
    }
  }

  // Is the network REALLY reachable? navigator.onLine is unreliable on
  // Android (data returns but the flag stays false, or vice versa), so when
  // changes are stuck we ask the network itself: a tiny same-origin fetch.
  function probeOnline() {
    return withTimeout(
      fetch('manifest.json?probe=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
        .then(function (r) { return !!(r && (r.ok || r.status === 304)); })
        .catch(function () { return false; }),
      6000
    ).then(function (ok) { return ok === true; });
  }

  // Safety nets: retry every 15s while anything is pending, and whenever the
  // app returns to the foreground or is restored from the back/forward cache.
  // When navigator.onLine SAYS offline but changes are pending, probe reality
  // every cycle — the instant real data is back, sync starts by itself.
  setInterval(function () {
    if (pendingCount() === 0) return;
    if (!isOffline()) { flush(); return; }
    probeOnline().then(function (ok) { if (ok) { updateIndicator(); flush(true); } });
  }, 15000);
  try {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && pendingCount() > 0) burstFlush();
    });
    window.addEventListener('pageshow', function () {
      if (!isOffline() && pendingCount() > 0) burstFlush();
    });
  } catch (e) {}

  // ── Offline / sync status banner ─────────────────────────────────────────
  function updateIndicator() {
    var bar = document.getElementById('_clinicOfflineBar');
    var off = isOffline();
    var pending = pendingCount();
    var show = off || pending > 0;

    if (!show) { if (bar) bar.remove(); return; }
    if (!bar) {
      if (!document.body) return;
      bar = document.createElement('div');
      bar.id = '_clinicOfflineBar';
      // pointer-events:none is CRITICAL: this bar sits fixed over the bottom of
      // the screen, exactly where the Quick Sale Sell button lives. Without it,
      // taps landing on the bar died silently — staff had to press Sell many
      // times whenever a sync was pending. The bar is informational only, so
      // every tap must pass straight through it.
      bar.style.cssText = 'pointer-events:none;position:fixed;left:0;right:0;bottom:0;z-index:11000;' +
        'color:#fff;font-family:inherit;font-size:12.5px;font-weight:600;' +
        'text-align:center;padding:7px 12px;display:flex;align-items:center;justify-content:center;gap:6px;' +
        'box-shadow:0 -2px 10px rgba(0,0,0,0.2)';
      document.body.appendChild(bar);
    }
    if (off) {
      bar.style.background = '#37474F';
      bar.innerHTML = '<span class="material-icons-outlined" style="font-size:15px">cloud_off</span>' +
        'Offline — showing saved data.' + (pending ? ' ' + pending + ' change' + (pending > 1 ? 's' : '') + ' will sync.' : ' Changes sync when you reconnect.');
    } else {
      bar.style.background = '#1B5E20';
      bar.innerHTML = '<span class="material-icons-outlined" style="font-size:15px">sync</span>' +
        'Syncing ' + pending + ' offline change' + (pending > 1 ? 's' : '') + '…';
    }
  }

  window.addEventListener('online', function () { updateIndicator(); burstFlush(); });
  window.addEventListener('offline', updateIndicator);

  // ── Real-time reconnect sync (no refresh needed) ─────────────────────────
  // The service worker's Background Sync fires the moment the OS regains
  // connectivity — even when the page never receives an 'online' event. The
  // worker then messages every open page to flush its outbox immediately.
  function requestBackgroundSync() {
    try {
      if (!('serviceWorker' in navigator)) return;
      navigator.serviceWorker.ready.then(function (reg) {
        if (reg.sync && reg.sync.register) reg.sync.register('homatt-outbox').catch(function () {});
      }).catch(function () {});
    } catch (e) {}
  }
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'flushOutbox') { updateIndicator(); burstFlush(); }
      });
    }
  } catch (e) {}
  if (pendingCount() > 0) requestBackgroundSync();   // queued from a previous session
  if (document.readyState !== 'loading') updateIndicator();
  else document.addEventListener('DOMContentLoaded', updateIndicator);

  // Client-side UUID so records created offline have a stable id that all their
  // related rows (prescription, reminders, booking link) can reference before
  // they ever reach the server.
  function uuid() {
    try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  window.ClinicOffline = {
    set: set, get: get, age: age, isOffline: isOffline, cachedQuery: cachedQuery,
    enqueue: enqueue, pendingCount: pendingCount, registerSyncHandler: registerSyncHandler,
    flush: flush, updateIndicator: updateIndicator, uuid: uuid, enqueueRpc: enqueueRpc,
    isNetworkErr: isNetworkErr, offlineHtml: offlineHtml, withTimeout: withTimeout,
  };
})();
