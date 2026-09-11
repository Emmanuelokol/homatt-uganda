/* Homatt Health — the clinician's own portal.
 *
 * The clinic portal answers "what is happening in my clinic". This answers
 * "where am I working, and what have I done" — and the two are deliberately
 * different accounts of the same events.
 *
 * The clinician signs in once. They hold their own profile, their own work
 * record and their own references, none of which belong to any clinic. To do
 * clinical work they attach to a clinic by scanning its QR code, and that
 * attachment is temporary, revocable and logged.
 *
 * WHERE THE CLINICAL WORK ACTUALLY HAPPENS
 * Not here. Once attached, the clinician is sent into the ordinary clinic
 * portal — the same intake screen, the same suggestion engine, the same
 * treatment wizard, the same offline outbox — with a role that hides the
 * money, the stock management and the reports. A second copy of the treatment
 * screen would be a second thing to keep correct, and the second one is always
 * the one nobody measured.
 */
(function (global) {
  'use strict';

  var AUTH_KEY    = 'sb-homatt-clinic-auth';   // the SAME session as the clinic
  var SESSION_KEY = 'clinician_session';       // who this person is
  var CLINIC_KEY  = 'clinic_session';          // which clinic they are inside

  /* The Supabase library is captured the instant this file loads.
   * A page that writes `var supabase = ...` at the top level of a classic
   * script replaces window.supabase — where the library itself lives — and
   * every later call throws. The clinic portal learned that the expensive way;
   * this file does not repeat it. */
  var _lib = (global.supabase && typeof global.supabase.createClient === 'function')
    ? global.supabase : null;
  var _client = null;

  function supa() {
    var cfg = global.HOMATT_CONFIG || {};
    if (!cfg.SUPABASE_URL) return null;
    if (!_lib && global.supabase && typeof global.supabase.createClient === 'function') {
      _lib = global.supabase;
    }
    if (_client) return _client;
    if (!_lib) {
      if (global.supabase && typeof global.supabase.from === 'function') return global.supabase;
      return null;
    }
    try {
      // One storage key for both portals. The clinician signs in here and
      // walks into the clinic portal still signed in; two keys would mean two
      // sign-ins for one person.
      _client = _lib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { storageKey: AUTH_KEY }
      });
    } catch (e) { return null; }
    return _client;
  }

  function getJSON(k) {
    try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; }
  }
  function setJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }

  function session()  { return getJSON(SESSION_KEY); }

  // Does this device hold a real sign-in? Same question, and the same answer,
  // as the clinic portal asks — see the long note in clinic.js about why a
  // null session and a null answer are not the same thing.
  function hasStoredLogin() {
    try {
      var raw = localStorage.getItem(AUTH_KEY);
      if (!raw) return false;
      var t = JSON.parse(raw);
      var s = (t && t.currentSession) || t;
      return !!(s && (s.refresh_token || s.access_token));
    } catch (e) { return false; }
  }

  function signOutBecause(why) {
    try {
      localStorage.setItem('homatt_last_signout', JSON.stringify({
        why: String(why || 'unknown'), at: new Date().toISOString(),
        online: navigator.onLine !== false,
      }));
    } catch (e) {}
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(CLINIC_KEY); } catch (e) {}
    global.location.href = 'index.html';
  }

  async function signOut() {
    try { var s = supa(); if (s) await s.auth.signOut(); } catch (e) {}
    try { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(CLINIC_KEY); } catch (e) {}
    global.location.href = 'index.html';
  }

  /* The guard on every clinician page.
   *
   * Offline is not grounds for putting anybody out. A clinician on a Ugandan
   * connection loses signal several times a day and the whole app is built to
   * carry on without it; only the server actually refusing the stored sign-in
   * counts. This is the same reasoning as requireClinic(), and for the same
   * reason: "you are not signed in" and "I could not check just now" are the
   * same return value and must not have the same consequence. */
  function requireClinician() {
    document.body.style.visibility = 'hidden';
    var s = session();
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      signOutBecause('the saved sign-in on this device could not be read');
      return null;
    }
    document.body.style.visibility = 'visible';

    var nameEls = document.querySelectorAll('[data-clinician-name]');
    for (var i = 0; i < nameEls.length; i++) nameEls[i].textContent = s.name || 'Clinician';

    setTimeout(async function () {
      try {
        var c = supa(); if (!c) return;
        var g = await c.auth.getSession();
        if (g && g.data && g.data.session) {
          if (s.userId && g.data.session.user.id !== s.userId) {
            signOutBecause('this browser is signed in as a different user');
          }
          return;
        }
        if (!hasStoredLogin()) { signOutBecause('there is no sign-in stored on this device'); return; }
        if (navigator.onLine === false) return;
        var r = await c.auth.refreshSession();
        if (r && r.error) {
          // A refresh token is used once, and this app opens several pages. Two
          // renewing together means the slower one is told the token was
          // already used, for a token that was good a second ago. Look again
          // before disturbing anybody.
          await new Promise(function (res) { setTimeout(res, 1200); });
          var again = await c.auth.getSession();
          if (again && again.data && again.data.session) return;
          signOutBecause('the server refused the saved sign-in');
        }
      } catch (e) { /* network. The next page will ask again. */ }
    }, 300);
    return s;
  }

  // Renew before it expires rather than after, when the app comes back to the
  // front — an Android WebView that spent the morning suspended has a dead
  // timer and a stale token, and the first tap is what discovers it.
  function keepSignedIn() {
    var busy = false;
    async function renew() {
      if (busy || navigator.onLine === false || !hasStoredLogin()) return;
      busy = true;
      try {
        var c = supa();
        if (c) {
          var g = await c.auth.getSession();
          var s = g && g.data && g.data.session;
          var soon = !s || !s.expires_at || (s.expires_at * 1000 - Date.now()) < 5 * 60 * 1000;
          if (soon) await c.auth.refreshSession();
        }
      } catch (e) {}
      busy = false;
    }
    document.addEventListener('visibilitychange', function () { if (!document.hidden) renew(); });
    global.addEventListener('online', renew);
    global.addEventListener('focus', renew);
  }

  /* ── Walking into a clinic ─────────────────────────────────────────────
   * Writes the clinic portal's own session, so every screen over there works
   * exactly as it does for staff, and marks it as a visiting clinician so the
   * role gating hides the money, the stock management and the reports.
   *
   * `clinician: true` is what the clinic portal reads to know this is somebody
   * who arrived by QR rather than a member of staff. */
  function enterClinic(link) {
    var s = session() || {};
    setJSON(CLINIC_KEY, {
      userId:     s.userId,
      staffName:  s.name || 'Clinician',
      clinicId:   link.clinic_id,
      clinicName: link.clinic_name || 'Clinic',
      staffRole:  'visiting_clinician',
      clinician:  true,
      clinicianId: s.clinicianId || null,
      stintId:    link.id || link.stint_id || null,
      expiresAt:  link.expires_at || null,
      email:      s.email || null,
    });
  }

  function leaveClinic() {
    try { localStorage.removeItem(CLINIC_KEY); } catch (e) {}
  }

  function currentClinic() {
    var c = getJSON(CLINIC_KEY);
    return (c && c.clinician) ? c : null;
  }

  /* ── Small helpers the pages share ─────────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // "3 days ago", "in 26 days" — a date on its own makes a clinician do
  // arithmetic to find out whether their access has run out.
  function when(iso, opts) {
    if (!iso) return '';
    var t = new Date(iso).getTime();
    if (!isFinite(t)) return '';
    var d = t - Date.now(), ahead = d > 0, s = Math.abs(d) / 1000;
    var n, unit;
    if (s < 90)          { return ahead ? 'in a moment' : 'just now'; }
    else if (s < 5400)   { n = Math.round(s / 60);    unit = 'minute'; }
    else if (s < 129600) { n = Math.round(s / 3600);  unit = 'hour'; }
    else if (s < 5184000){ n = Math.round(s / 86400); unit = 'day'; }
    else                 { n = Math.round(s / 2592000); unit = 'month'; }
    var txt = n + ' ' + unit + (n === 1 ? '' : 's');
    if (opts === 'bare') return txt;
    return ahead ? ('in ' + txt) : (txt + ' ago');
  }

  function dayMonth(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (!isFinite(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Turn a thrown/returned Supabase problem into something a person can act on.
  // The library's own wording ("FunctionsFetchError", "JWT expired") tells a
  // clinician nothing and worries them.
  function saySorry(err, fallback) {
    var msg = String((err && (err.message || err.error_description)) || err || '');
    if (!msg) return fallback || 'That did not work. Try again.';
    if (/failed to fetch|networkerror|network request failed|load failed|timeout|abort/i.test(msg)) {
      return 'No connection just now. Try again when you have signal.';
    }
    if (/invalid login credentials/i.test(msg)) return 'That email and password do not match.';
    if (/email not confirmed/i.test(msg))       return 'Check your email and confirm the address first.';
    if (/user already registered|already exists/i.test(msg)) {
      return 'There is already an account with that email. Sign in instead.';
    }
    if (/password/i.test(msg) && /least|short|6|8/i.test(msg)) {
      return 'Choose a longer password — at least 8 characters.';
    }
    if (/rate limit|too many/i.test(msg)) return 'Too many tries. Wait a minute and try again.';
    return msg;
  }

  global.HomattClinician = {
    supa: supa,
    session: session,
    setSession: function (v) { setJSON(SESSION_KEY, v); },
    requireClinician: requireClinician,
    keepSignedIn: keepSignedIn,
    hasStoredLogin: hasStoredLogin,
    signOut: signOut,
    signOutBecause: signOutBecause,
    enterClinic: enterClinic,
    leaveClinic: leaveClinic,
    currentClinic: currentClinic,
    esc: esc, when: when, dayMonth: dayMonth, saySorry: saySorry,
    AUTH_KEY: AUTH_KEY, SESSION_KEY: SESSION_KEY, CLINIC_KEY: CLINIC_KEY,
  };
})(typeof window !== 'undefined' ? window : globalThis);
