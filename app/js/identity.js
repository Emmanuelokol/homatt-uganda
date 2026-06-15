/**
 * Homatt Health — Unified Patient Identity (client helper)
 * ────────────────────────────────────────────────────────────────────
 * One person = one phone number, everywhere. This thin wrapper lets any
 * screen (onboarding, clinic booking, preventive shop, …) answer two
 * questions against the single backend identity spine:
 *
 *   1. "Do we already know this phone?"   → HomattIdentity.lookup(phone)
 *   2. "Remember this person from now on" → HomattIdentity.findOrRegister(...)
 *
 * Both funnel through the same canonical phone key as the database
 * (homatt_norm_phone), so +256772123456 / 0772123456 / 772123456 are
 * always treated as the same person — a new app user is auto-recognised
 * the moment they enter the phone a clinic already had on file.
 *
 * Usage:
 *   const supa = window.supabase.createClient(URL, KEY);
 *   const who  = await HomattIdentity.lookup(supa, phoneInput.value);
 *   if (who.found) { greet(who.full_name); prefill(who); }
 */
(function (global) {
  'use strict';

  // Canonical Ugandan phone key — must mirror the SQL homatt_norm_phone():
  // the last 9 significant digits. Returns null if too short to be valid.
  function normPhone(raw) {
    const digits = String(raw || '').replace(/\D/g, '');
    if (digits.length < 9) return null;
    return digits.slice(-9);
  }

  // Pretty local format for display: 0772 123 456
  function formatLocal(raw) {
    const n = normPhone(raw);
    if (!n) return String(raw || '');
    return '0' + n.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
  }

  // Read-only: "do we know this phone?" Safe for guests (no medical data).
  // Returns { found, is_new, full_name, date_of_birth, sex, district, city,
  //           has_app_account, profile_id, visit_count } or { found:false }.
  async function lookup(supabase, phone) {
    const norm = normPhone(phone);
    if (!supabase || !norm) return { found: false, invalid: !norm };
    try {
      const { data, error } = await supabase.rpc('get_patient_identity', { p_phone: norm });
      if (error || !data) return { found: false };
      return data;
    } catch (e) {
      return { found: false, error: String(e && e.message || e) };
    }
  }

  // Find-or-create: remembers this person so the next visit is pre-filled.
  // Pass whatever details you have; the backend only fills blanks, never
  // overwrites. source = 'app' | 'booking' | 'shop' | 'clinic'.
  async function findOrRegister(supabase, opts) {
    opts = opts || {};
    const norm = normPhone(opts.phone);
    if (!supabase || !norm) return { found: false, invalid: !norm };
    try {
      const { data, error } = await supabase.rpc('find_or_register_patient', {
        p_phone:    norm,
        p_name:     opts.name     || null,
        p_dob:      opts.dob      || null,
        p_sex:      opts.sex      || null,
        p_district: opts.district || null,
        p_city:     opts.city     || null,
        p_source:   opts.source   || 'app',
      });
      if (error || !data) return { found: false, error: error && error.message };
      return data;
    } catch (e) {
      return { found: false, error: String(e && e.message || e) };
    }
  }

  global.HomattIdentity = {
    normPhone,
    formatLocal,
    lookup,
    findOrRegister,
  };
})(window);
