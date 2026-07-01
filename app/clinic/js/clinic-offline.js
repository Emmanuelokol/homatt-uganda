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

  // run() should return a Promise resolving to a supabase-style {data, error}.
  async function cachedQuery(key, run) {
    // Offline: serve cache immediately if we have it.
    if (isOffline()) {
      var c = raw(key);
      if (c) return { data: c.v, error: null, fromCache: true, cachedAt: c.ts };
    }
    try {
      var res = await run();
      if (res && !res.error && res.data != null) {
        set(key, res.data);
        return { data: res.data, error: null, fromCache: false };
      }
      var cc = raw(key);                    // query errored → fall back to cache
      if (cc) return { data: cc.v, error: null, fromCache: true, cachedAt: cc.ts };
      return res || { data: null, error: { message: 'No data' } };
    } catch (e) {
      var c2 = raw(key);                    // threw (offline) → cache
      if (c2) return { data: c2.v, error: null, fromCache: true, cachedAt: c2.ts };
      return { data: null, error: e };
    }
  }

  // ── Offline write outbox ─────────────────────────────────────────────────
  // Mutations made offline are queued here and replayed (in order) when the
  // connection returns. The page registers a sync handler that knows how to
  // perform each queued op against Supabase.
  var OUTBOX = 'outbox';
  var _syncFn = null;
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

  function registerSync(fn) { _syncFn = fn; if (!isOffline()) flush(); }

  async function flush() {
    if (_syncing || isOffline() || !_syncFn) return;
    var list = outbox();
    if (!list.length) { updateIndicator(); return; }
    _syncing = true;
    try {
      for (var i = 0; i < list.length; i++) {
        var ok = false;
        try { ok = await _syncFn(list[i]); } catch (e) { ok = false; }
        if (ok) {
          saveOutbox(outbox().filter(function (x) { return x.id !== list[i].id; }));
        } else {
          break; // keep order — retry this and the rest next time
        }
      }
    } finally {
      _syncing = false;
      updateIndicator();
    }
  }

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

  window.ClinicOffline = {
    set: set, get: get, age: age, isOffline: isOffline, cachedQuery: cachedQuery,
    enqueue: enqueue, pendingCount: pendingCount, registerSync: registerSync,
    flush: flush, updateIndicator: updateIndicator,
  };
})();
