/**
 * guest-profile.js — Indirect data collection for unauthenticated users.
 *
 * Any page that collects a name, phone number, age, sex, district, etc.
 * should call guestProfile.save({ name, phone, ... }) so that value is
 * remembered for next time.  Pre-fill forms by calling guestProfile.get().
 *
 * If the user later signs in, their Supabase profile takes precedence and
 * the guest data is merged into homatt_user / homatt_session.
 */

(function(window) {
  'use strict';

  var STORAGE_KEY = 'homatt_guest';

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch(e) { return {}; }
  }

  function persist(data) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch(e) {}
  }

  /**
   * Save one or more fields into the guest profile.
   * Only non-empty truthy values overwrite existing entries.
   * e.g. guestProfile.save({ name: 'Alice', phone: '0700123456' })
   */
  function save(fields) {
    var current = load();
    Object.keys(fields).forEach(function(k) {
      var v = (fields[k] || '').toString().trim();
      if (v) current[k] = v;
    });
    persist(current);
    return current;
  }

  /**
   * Return the full guest profile object.
   * Falls back to homatt_user (signed-in user) if the guest profile is empty.
   */
  function get() {
    var guest = load();
    // Overlay with signed-in user data if available — signed-in always wins
    try {
      var u = JSON.parse(localStorage.getItem('homatt_user') || 'null');
      if (u && typeof u === 'object') {
        if (u.firstName) guest.name  = [u.firstName, u.lastName].filter(Boolean).join(' ');
        if (u.phone)     guest.phone = u.phone;
        if (u.sex)       guest.sex   = u.sex;
        if (u.dob)       guest.dob   = u.dob;
        if (u.district)  guest.district = u.district;
      }
    } catch(e) {}
    return guest;
  }

  /**
   * Wire up auto-save on a single input.
   * guestProfile.wire('patient_name', 'name') — on blur, saves input value as guest.name
   */
  function wire(inputId, field) {
    var el = document.getElementById(inputId);
    if (!el) return;
    // Pre-fill
    var stored = get()[field];
    if (stored && !el.value) el.value = stored;
    // Save on blur
    el.addEventListener('blur', function() {
      var v = el.value.trim();
      if (v) save((_f = {}, _f[field] = v, _f));
      var _f;
    });
  }

  /**
   * Pre-fill a whole form at once.
   * Pass a map of { inputId: profileField }.
   * e.g. guestProfile.prefill({ patient_name: 'name', patient_phone: 'phone' })
   */
  function prefill(map) {
    var profile = get();
    Object.keys(map).forEach(function(inputId) {
      var el = document.getElementById(inputId);
      if (!el) return;
      var v = profile[map[inputId]];
      if (v && !el.value) el.value = v;
    });
  }

  /**
   * Auto-save + pre-fill a whole form.
   * Pass a map of { inputId: profileField }.
   */
  function wireForm(map) {
    prefill(map);
    Object.keys(map).forEach(function(inputId) {
      wire(inputId, map[inputId]);
    });
  }

  window.guestProfile = { save: save, get: get, wire: wire, prefill: prefill, wireForm: wireForm };
})(window);
