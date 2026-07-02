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
  var NET_TIMEOUT_MS = 10000;
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
  // Every call is capped at NET_TIMEOUT_MS so a slow connection falls back to
  // the cache instead of hanging forever.
  async function cachedQuery(key, run) {
    // Offline: serve cache immediately if we have it.
    if (isOffline()) {
      var c = raw(key);
      if (c) return { data: c.v, error: null, fromCache: true, cachedAt: c.ts };
    }
    try {
      var res = await withTimeout(run());
      if (res && !res.error && res.data != null) {
        set(key, res.data);
        return { data: res.data, error: null, fromCache: false };
      }
      var cc = raw(key);                    // errored / timed out → cache
      if (cc) return { data: cc.v, error: null, fromCache: true, cachedAt: cc.ts };
      return res || { data: null, error: { message: 'No data' } };
    } catch (e) {
      var c2 = raw(key);                    // threw (offline) → cache
      if (c2) return { data: c2.v, error: null, fromCache: true, cachedAt: c2.ts };
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
    return list.length;
  }

  // Register a replay handler for one op type. Multiple types can be registered
  // (from different modules/pages), so a queued item syncs wherever a handler
  // for its type is loaded — a sale queued offline still syncs from the
  // dashboard, a consultation from any page that loaded clinic.js, etc.
  function registerSyncHandler(type, fn) { _handlers[type] = fn; if (!isOffline()) flush(); }

  var _retryTimer = null;
  function _scheduleRetry(ms) {
    if (_retryTimer) return;
    _retryTimer = setTimeout(function () { _retryTimer = null; flush(); }, ms || 30000);
  }

  async function flush() {
    if (_syncing || isOffline()) return;
    var list = outbox();
    if (!list.length) { updateIndicator(); return; }
    if (!Object.keys(_handlers).length) return;
    _syncing = true;
    var anyFailed = false;
    try {
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        var h = _handlers[item.type];
        if (!h) continue;                 // no handler here — leave for later
        var ok = false;
        try {
          // Cap each push at 20s so a request stalled on very slow internet can
          // never wedge the queue with _syncing stuck true. Handlers return the
          // boolean true when done; a timeout token object is NOT true → retry.
          var r = await withTimeout(h(item), 20000);
          ok = (r === true);
        } catch (e) { ok = false; }
        if (ok) saveOutbox(outbox().filter(function (x) { return x.id !== item.id; }));
        else anyFailed = true;
        // keep failures; they retry on the next flush (order within a type holds)
      }
    } finally {
      _syncing = false;
      updateIndicator();
      // Slow-but-online connections: keep retrying automatically until the
      // queue drains — the user never has to do anything.
      if (anyFailed && !isOffline()) _scheduleRetry(30000);
    }
  }

  // Safety nets: retry every 60s while anything is pending, and whenever the
  // app returns to the foreground.
  setInterval(function () { if (pendingCount() > 0) flush(); }, 60000);
  try {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && pendingCount() > 0) flush();
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
      bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:11000;' +
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

  window.addEventListener('online', function () { updateIndicator(); setTimeout(flush, 600); });
  window.addEventListener('offline', updateIndicator);
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
    flush: flush, updateIndicator: updateIndicator, uuid: uuid,
    isNetworkErr: isNetworkErr, offlineHtml: offlineHtml, withTimeout: withTimeout,
  };
})();
