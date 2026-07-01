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

  // ── Offline status banner ────────────────────────────────────────────────
  function updateIndicator() {
    var bar = document.getElementById('_clinicOfflineBar');
    if (isOffline()) {
      if (!bar && document.body) {
        bar = document.createElement('div');
        bar.id = '_clinicOfflineBar';
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:11000;' +
          'background:#37474F;color:#fff;font-family:inherit;font-size:12.5px;font-weight:600;' +
          'text-align:center;padding:7px 12px;display:flex;align-items:center;justify-content:center;gap:6px;' +
          'box-shadow:0 -2px 10px rgba(0,0,0,0.2)';
        bar.innerHTML = '<span class="material-icons-outlined" style="font-size:15px">cloud_off</span>' +
          'Offline — showing saved data. Changes will sync when you reconnect.';
        document.body.appendChild(bar);
      }
    } else if (bar) {
      bar.remove();
    }
  }

  window.addEventListener('online', updateIndicator);
  window.addEventListener('offline', updateIndicator);
  if (document.readyState !== 'loading') updateIndicator();
  else document.addEventListener('DOMContentLoaded', updateIndicator);

  window.ClinicOffline = {
    set: set, get: get, age: age, isOffline: isOffline,
    cachedQuery: cachedQuery, updateIndicator: updateIndicator,
  };
})();
