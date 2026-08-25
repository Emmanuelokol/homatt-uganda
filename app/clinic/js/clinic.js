/* Homatt Health — Clinic Portal shared JS */

function _getClinicSupabase() {
  const cfg = window.HOMATT_CONFIG || {};
  if (!cfg.SUPABASE_URL || !window.supabase) return null;
  return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { storageKey: 'sb-homatt-clinic-auth' }
  });
}

function requireClinic() {
  // Hide content immediately so there's no flash of protected content before redirect
  document.body.style.visibility = 'hidden';
  let s;
  try { s = JSON.parse(localStorage.getItem('clinic_session') || 'null'); } catch(e) {}
  if (!s || typeof s !== 'object' || Array.isArray(s)) {
    localStorage.removeItem('clinic_session');
    window.location.href = 'index.html';
    return null;
  }
  // Auth passed — show the page
  document.body.style.visibility = 'visible';
  const name = s.staffName || s.name || 'Clinic Staff';
  const el1 = document.getElementById('clinicUserName');
  const el2 = document.getElementById('clinicUserNameTop');
  const av  = document.getElementById('clinicUserAvatar');
  if (el1) el1.textContent = name;
  if (el2) el2.textContent = name;
  if (av)  av.textContent  = name[0].toUpperCase();

  // Non-demo: validate Supabase session in background.
  // If the stored session is a fake (no real Supabase token), redirect after short delay.
  // This prevents URL manipulation while still showing the page immediately for real users.
  if (!s.demo) {
    setTimeout(async () => {
      try {
        const supa = _getClinicSupabase();
        if (!supa) return;
        const { data } = await supa.auth.getSession();
        if (!data?.session) {
          // No valid Supabase session — the localStorage was faked or expired
          localStorage.removeItem('clinic_session');
          window.location.href = 'index.html';
          return;
        }
        // Verify the session belongs to the stored user
        if (s.userId && data.session.user.id !== s.userId) {
          localStorage.removeItem('clinic_session');
          window.location.href = 'index.html';
        }
      } catch(e) { /* Network error — allow offline access */ }
    }, 200);
  }

  return s;
}

function setupClinicMobileNav() {
  const sidebar = document.querySelector('.admin-sidebar');
  const topbar  = document.querySelector('.admin-topbar');
  if (!sidebar || !topbar) return;

  // Inject hamburger into topbar
  if (!topbar.querySelector('.sidebar-hamburger')) {
    const burger = document.createElement('button');
    burger.className = 'sidebar-hamburger';
    burger.innerHTML = '<span class="material-icons-outlined">menu</span>';
    burger.setAttribute('aria-label', 'Open navigation menu');
    topbar.insertBefore(burger, topbar.firstChild);
  }

  // Inject overlay
  if (!document.getElementById('_sidebarOverlay')) {
    const overlay = document.createElement('div');
    overlay.id = '_sidebarOverlay';
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
  }

  const toggle = (open) => {
    sidebar.classList.toggle('open', open);
    document.getElementById('_sidebarOverlay').classList.toggle('active', open);
  };

  topbar.querySelector('.sidebar-hamburger').onclick = () => toggle(!sidebar.classList.contains('open'));
  document.getElementById('_sidebarOverlay').onclick = () => toggle(false);
  sidebar.querySelectorAll('.sidebar-link').forEach(l =>
    l.addEventListener('click', () => { if (window.innerWidth <= 768) toggle(false); })
  );
}

async function clinicSignOut() {
  // Sign out of Supabase auth so the session token is invalidated
  const cfg = window.HOMATT_CONFIG || {};
  if (window.supabase && cfg.SUPABASE_URL) {
    try {
      const tmpSupa = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { storageKey: 'sb-homatt-clinic-auth' }
      });
      await tmpSupa.auth.signOut();
    } catch(e) {}
  }
  localStorage.removeItem('clinic_session');
  window.location.href = 'index.html';
}

function setupClinicLogout() {
  // Setup mobile nav (called from every portal page after DOMContentLoaded)
  setupClinicMobileNav();

  document.getElementById('clinicLogoutBtn')?.addEventListener('click', clinicSignOut);

  // Inject an always-visible exit control into the top bar. Without this the only
  // way out is the Sign Out button at the bottom of the sidebar, which is hidden
  // behind the hamburger on mobile — so a demo user has no obvious way back to
  // the login screen to sign in with their live account.
  _injectClinicTopbarExit();
}

function _injectClinicTopbarExit() {
  const right = document.querySelector('.admin-topbar-right');
  // Light/dark toggle — same preference as the login page (homatt_theme).
  try {
    if (right && !document.getElementById('themeToggleTop')) {
      const tt = document.createElement('button');
      tt.type = 'button'; tt.id = 'themeToggleTop'; tt.className = 'theme-toggle-top';
      tt.setAttribute('aria-label', 'Switch between light and dark mode');
      const paint = () => {
        const dark = document.documentElement.getAttribute('data-theme') === 'dark';
        tt.innerHTML = '<span class="material-icons-outlined">' + (dark ? 'light_mode' : 'dark_mode') + '</span>';
      };
      tt.addEventListener('click', () => {
        const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('homatt_theme', next); } catch (e) {}
        paint();
      });
      paint();
      right.insertBefore(tt, right.firstChild);
    }
  } catch (e) {}
  if (!right || document.getElementById('clinicTopbarExitBtn')) return;

  let session = null;
  try { session = JSON.parse(localStorage.getItem('clinic_session') || 'null'); } catch(e) {}
  const isDemo = !!(session && session.demo);

  // "DEMO" badge so it is obvious this is not the live account
  if (isDemo) {
    const badge = document.createElement('span');
    badge.id = 'clinicDemoBadge';
    badge.className = 'clinic-demo-badge';
    badge.textContent = 'DEMO';
    right.insertBefore(badge, right.firstChild);
  }

  const btn = document.createElement('button');
  btn.id = 'clinicTopbarExitBtn';
  btn.type = 'button';
  btn.className = 'clinic-exit-btn' + (isDemo ? ' demo' : '');
  btn.innerHTML =
    '<span class="material-icons-outlined" style="font-size:18px">logout</span>' +
    '<span class="exit-label">' + (isDemo ? 'Exit Demo' : 'Sign Out') + '</span>';
  btn.addEventListener('click', clinicSignOut);
  right.appendChild(btn);
}

/**
 * Resolves the clinic_id for the logged-in staff member.
 * If the session already has a clinicId, returns it immediately.
 * Otherwise queries portal_users, updates the stored session, and returns it.
 * Returns null for demo sessions or when no clinic is linked.
 */
async function resolveClinicId(supabase, session) {
  if (!session || session.demo) return null;
  if (session.clinicId) return session.clinicId;
  if (!supabase) return null;

  try {
    const { data: authData } = await supabase.auth.getSession();
    if (!authData?.session?.user) return null;

    const { data: pu } = await supabase
      .from('portal_users')
      .select('clinic_id, staff_role, clinics(name)')
      .eq('auth_user_id', authData.session.user.id)
      .eq('role', 'clinic_staff')
      .eq('is_active', true)
      .single();

    if (pu?.clinic_id) {
      const updated = Object.assign({}, session, {
        clinicId: pu.clinic_id,
        clinicName: pu.clinics?.name || session.clinicName || 'Clinic',
        staffRole: pu.staff_role || session.staffRole || 'owner',
      });
      localStorage.setItem('clinic_session', JSON.stringify(updated));
      return pu.clinic_id;
    }
  } catch (e) { /* network error — fail gracefully */ }
  return null;
}

/* ──────────────────────────────────────────────────────────
 * Staff role-based access control
 *
 * Each clinic staff member has a role that decides which portal
 * sections they can use. Sections/links are tagged in the HTML with
 * data-cap="<capability>" (or data-nav-cap on nav links); anything
 * the role can't access is hidden.
 *
 * FAIL-SAFE: unknown / missing role → treated as 'owner' (full
 * access) so a missing column or older session never locks anyone out.
 * ────────────────────────────────────────────────────────── */
var CLINIC_ROLE_CAPS = {
  // Owner/Manager: everything — finances, stock, settings, staff accounts.
  owner:        ['*'],
  // Clinicians & nurses: clinical work + selling + stock (view/restock/add
  // item) — but NOT financial reports, payments ledger or settings.
  clinician:    ['consultations', 'history', 'bookings', 'meds', 'quicksale', 'stock'],
  nurse:        ['consultations', 'history', 'bookings', 'meds', 'quicksale', 'stock'],
  // Receptionists: the front desk — bookings, history, recording payments and
  // quick sales. No clinical notes, no stock, no finances, no settings.
  receptionist: ['bookings', 'history', 'payments', 'quicksale'],
  // Salesperson / drug-shop attendant: ONLY quick sale + stock (view, restock,
  // add item). No consultations, no history, no payments ledger, no finances,
  // no settings. Perfect for a drug shop that just sells.
  salesperson:  ['quicksale', 'stock'],
};

var CLINIC_ROLE_LABELS = {
  owner:        'Owner / Manager',
  clinician:    'Clinician (Doctor)',
  nurse:        'Nurse',
  receptionist: 'Receptionist',
  salesperson:  'Sales / Drug shop',
};

function clinicRole() {
  try {
    var s = JSON.parse(localStorage.getItem('clinic_session') || 'null');
    if (s && s.staffRole && CLINIC_ROLE_CAPS[s.staffRole]) return s.staffRole;
  } catch (e) {}
  return 'owner';   // fail-safe: full access
}

function clinicCan(cap) {
  var caps = CLINIC_ROLE_CAPS[clinicRole()] || ['*'];
  return caps.indexOf('*') !== -1 || caps.indexOf(cap) !== -1;
}

// Hide every [data-cap] / [data-nav-cap] element the current role can't use.
function applyRoleGating() {
  try {
    document.querySelectorAll('[data-cap]').forEach(function (el) {
      if (!clinicCan(el.getAttribute('data-cap'))) el.style.display = 'none';
    });
    document.querySelectorAll('[data-nav-cap]').forEach(function (el) {
      if (!clinicCan(el.getAttribute('data-nav-cap'))) el.style.display = 'none';
    });
  } catch (e) { /* never let gating break the page */ }
}

/* ──────────────────────────────────────────────────────────
 * Subscription tiers (Schedule B) — basic | premium
 *
 * Premium-only features are tagged data-tier-feature="<feature>" in
 * the HTML. Unlike role gating (which HIDES), tier gating LOCKS the
 * section — dimmed with an upgrade chip — so basic clinics can see
 * what premium offers.
 *
 * FAIL-OPEN: unknown / missing tier (older DB, network error, demo)
 * → premium, so a paying clinic is never locked out by a glitch.
 * During the 30-day free period every clinic is premium.
 * ────────────────────────────────────────────────────────── */
var CLINIC_TIER_FEATURES = {
  basic:   ['stock', 'quicksale', 'alerts', 'consultations', 'history', 'bookings', 'payments', 'meds'],
  premium: ['*'],
};

// Free-onboarding period REMOVED (2026-07): clinics run on their assigned
// tier from day one. Kept as a stub so older cached pages can't crash.
function clinicTrialDaysLeft() { return 0; }

function clinicTier() {
  try {
    var s = JSON.parse(localStorage.getItem('clinic_session') || 'null');
    if (s && s.tier && CLINIC_TIER_FEATURES[s.tier]) return s.tier;
  } catch (e) {}
  return 'premium';   // fail-open: never lock out on missing data
}

// PREMIUM GATING SWITCH — OFF for now. Every clinic sees ALL features; no
// "Premium plan" locks anywhere. The admin's Basic/Premium selector still
// records each clinic's plan, so flip this to true to switch the locks back
// on later without any other change.
var TIER_GATING_ENABLED = false;

function clinicHasFeature(f) {
  if (!TIER_GATING_ENABLED) return true;   // gating disabled → everything unlocked
  var feats = CLINIC_TIER_FEATURES[clinicTier()] || ['*'];
  return feats.indexOf('*') !== -1 || feats.indexOf(f) !== -1;
}

// Lock every [data-tier-feature] section the clinic's tier doesn't include:
// dim it, disable interaction, and show an upgrade chip. Re-runs safely.
function applyTierGating() {
  try {
    document.querySelectorAll('[data-tier-feature]').forEach(function (el) {
      var ok = clinicHasFeature(el.getAttribute('data-tier-feature'));
      var chip = el.querySelector(':scope > .tier-lock-chip');
      if (ok) {
        el.style.opacity = ''; el.style.pointerEvents = ''; el.style.position = '';
        if (chip) chip.remove();
        return;
      }
      el.style.opacity = '0.5';
      el.style.pointerEvents = 'none';
      if (!/relative|absolute|fixed/.test(getComputedStyle(el).position)) el.style.position = 'relative';
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'tier-lock-chip';
        chip.style.cssText = 'position:absolute;top:10px;right:10px;z-index:5;background:#37474F;color:#fff;'
          + 'font-size:11px;font-weight:700;padding:4px 12px;border-radius:20px;display:flex;align-items:center;'
          + 'gap:4px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.25)';
        chip.innerHTML = '<span class="material-icons-outlined" style="font-size:13px">lock</span> Premium plan';
        el.appendChild(chip);
      }
    });
    // Trial banner — filled if the page has a #trialBanner slot.
    var tb = document.getElementById('trialBanner');
    if (tb) {
      var days = clinicTrialDaysLeft();
      if (days > 0) {
        tb.innerHTML = '<span class="material-icons-outlined" style="font-size:16px;vertical-align:-3px">card_giftcard</span> '
          + '<strong>Free onboarding period</strong> — full access, ' + days + ' day' + (days !== 1 ? 's' : '') + ' left.';
        tb.style.display = 'block';
      } else {
        tb.style.display = 'none';
      }
    }
  } catch (e) { /* never let gating break the page */ }
}

// Fetch the clinic's tier in the background and re-apply gating. Separate
// from the login query on purpose: an un-migrated DB (missing columns)
// must never break sign-in — this just quietly leaves the tier unknown.
async function refreshClinicTier(supabase, session) {
  try {
    if (!supabase || !session || session.demo || !session.clinicId) return;
    var res = await supabase.from('clinics')
      .select('subscription_tier, trial_ends_at')
      .eq('id', session.clinicId)
      .single();
    if (res.error || !res.data) return;                 // column missing / offline → keep fail-open
    var updated = Object.assign({}, session, {
      tier:        res.data.subscription_tier || 'premium',
      trialEndsAt: res.data.trial_ends_at || null,
    });
    localStorage.setItem('clinic_session', JSON.stringify(updated));
    applyTierGating();
  } catch (e) { /* offline — cached tier (or fail-open) stands */ }
}

// Page-level guard: redirect to the dashboard if the role lacks a capability.
// Call at the top of a protected page (e.g. new-order requires 'consultations').
function requireClinicCap(cap) {
  if (clinicCan(cap)) return true;
  alert('Your role does not have access to this page.');
  window.location.href = 'dashboard.html';
  return false;
}

/* ── Stable patient identifier ───────────────────────────────────────────────
 * Every patient needs ONE id that is the same on every visit, on every device
 * and offline — so a clinician can quote it, search it, and follow the person
 * through Patient History and Active Treatments. (The old CLN-xxxx code was
 * derived from the visit id, so it changed with every consultation.)
 *
 * Derived deterministically from the patient's phone number (the key this app
 * already groups patients by), so no server round-trip and no storage: the same
 * phone always yields the same id, in this clinic and any other.
 */
function homattPatientId(phoneOrPatient, fallback) {
  var src = phoneOrPatient;
  if (src && typeof src === 'object') {
    src = src.patient_phone || src.phone || src.clinic_patient_id || src.id || '';
  }
  var key = String(src || '').replace(/\D/g, '');
  // The same phone gets written 0788…, +256788…, 256788… or 788… — they are one
  // patient, so reduce every Ugandan form to the bare 9-digit subscriber number.
  key = key.replace(/^0+/, '').replace(/^256/, '');
  if (key.length > 9) key = key.slice(-9);
  if (key.length < 6) {
    key = String(src || fallback || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  if (!key) return '';
  // FNV-1a — tiny, stable, no dependencies.
  var h = 0x811c9dc5;
  for (var i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  var code = h.toString(36).toUpperCase().padStart(6, '0').slice(-6);
  return 'HP-' + code;
}
window.homattPatientId = homattPatientId;

// ── Case number — the label the clinic actually says out loud ─────────────
// Example: #001M2208O
//     001   the visit's number for this clinic that day (resets each morning)
//     M     first letter of the diagnosis (M for Malaria)
//     2208  day and month (22 August)
//     O     Outpatient — I for Inpatient
//
// It exists so a patient can be identified from the very first moment, before
// anyone has taken a phone number or even a name. Those can be filled in later
// and the case number never changes.
function homattCaseCode(opts) {
  opts = opts || {};
  var d = opts.date ? new Date(opts.date) : new Date();
  if (isNaN(d.getTime())) d = new Date();
  var seq = Math.max(1, parseInt(opts.seq, 10) || 1);
  if (seq > 999) seq = ((seq - 1) % 999) + 1;
  var dxLetter = String(opts.diagnosis || '').trim().replace(/[^A-Za-z]/g, '').charAt(0);
  var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
  return '#' + String(seq).padStart(3, '0') +
         (dxLetter ? dxLetter.toUpperCase() : 'X') +
         pad2(d.getDate()) + pad2(d.getMonth() + 1) +
         (String(opts.patientType || '').toLowerCase() === 'inpatient' ? 'I' : 'O');
}
window.homattCaseCode = homattCaseCode;

// The next number for today, per clinic. Kept locally so it works with no
// network at all; the day is part of the key so it resets each morning by
// itself and old days fall away.
function homattNextCaseSeq(clinicId) {
  var d = new Date();
  var day = d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  var key = 'homatt_case_seq_' + (clinicId || 'local');
  var cur = { day: day, n: 0 };
  try {
    var raw = JSON.parse(localStorage.getItem(key) || 'null');
    if (raw && raw.day === day) cur = raw;
  } catch (e) {}
  cur.n = (parseInt(cur.n, 10) || 0) + 1;
  cur.day = day;
  try { localStorage.setItem(key, JSON.stringify(cur)); } catch (e) {}
  return cur.n;
}
window.homattNextCaseSeq = homattNextCaseSeq;

// ── Which version is this phone actually running? ─────────────────────────
// The build marker used to live only on the sign-in page, so once a clinician
// was signed in there was no way to tell whether a fix had reached them. On the
// Android app the web files are packaged INSIDE the APK, so a new APK has to be
// installed before any change appears — and until now that was invisible.
// This line is added to the side menu on every page.
var HOMATT_BUILD = 'v128';
window.HOMATT_BUILD = HOMATT_BUILD;

function homattBuildLine() {
  var foot = document.querySelector('.sidebar-footer');
  if (!foot) return;
  var el = document.getElementById('homattBuildLine');
  if (!el) {
    el = document.createElement('div');
    el.id = 'homattBuildLine';
    el.style.cssText = 'font-size:10.5px;line-height:1.5;color:rgba(255,255,255,0.42);' +
      'margin-top:10px;letter-spacing:.2px;word-break:break-word';
    foot.appendChild(el);
  }
  var native = !!(window.Capacitor && window.Capacitor.isNativePlatform &&
                  window.Capacitor.isNativePlatform());
  var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  var mode = native ? 'android app' : (standalone ? 'installed' : 'browser');
  el.textContent = 'Version ' + HOMATT_BUILD + ' · ' + mode;

  // Add the service-worker state once it is known — that is what tells us
  // whether an old copy of the app is still being served from the cache.
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.getRegistration().then(function (reg) {
    var sw = !reg ? 'no offline cache'
      : reg.waiting ? 'UPDATE READY — fully close and reopen the app'
      : reg.active ? 'offline cache on' : 'starting';
    el.textContent = 'Version ' + HOMATT_BUILD + ' · ' + mode + ' · ' + sw;
    // A waiting worker means a newer version is sitting there unused. Take it.
    try { if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
    try { if (reg && reg.update) reg.update(); } catch (e) {}
  }).catch(function () {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', homattBuildLine);
} else {
  homattBuildLine();
}
window.homattBuildLine = homattBuildLine;

function showToast(msg, type = 'success') {
  let t = document.getElementById('clinicToast');
  if (!t) { t = document.createElement('div'); t.id = 'clinicToast'; t.className = 'admin-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.background = type === 'error' ? '#D32F2F' : '#1E1E1E';
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3000);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-UG', { day:'numeric', month:'short', year:'numeric' });
}
function fmtTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleTimeString('en-UG', { hour:'2-digit', minute:'2-digit' });
}

/* ── Mock patient data ── */
const MOCK_PATIENTS = [
  { q:1, id:'P-001', name:'Ssempa Robert',    age:55, sex:'M', complaint:'High blood pressure / dizziness', priority:'urgent',    status:'waiting',     arrive:'08:15' },
  { q:2, id:'P-002', name:'Nakato Brenda',    age:28, sex:'F', complaint:'Fever & headache',                priority:'normal',    status:'in-progress', arrive:'08:40' },
  { q:3, id:'P-003', name:'Mubiru John',      age:12, sex:'M', complaint:'Malaria symptoms',               priority:'high',      status:'waiting',     arrive:'09:05' },
  { q:4, id:'P-004', name:'Namutebi Agnes',   age:31, sex:'F', complaint:'Prenatal check-up (32 weeks)',   priority:'scheduled', status:'waiting',     arrive:'09:20' },
  { q:5, id:'P-005', name:'Kibuuka Paul',     age:67, sex:'M', complaint:'Chest pain & shortness of breath', priority:'urgent',  status:'waiting',     arrive:'09:35' },
  { q:6, id:'P-006', name:'Namukasa Grace',   age:24, sex:'F', complaint:'Stomach pain',                  priority:'normal',    status:'waiting',     arrive:'09:50' },
  { q:7, id:'P-007', name:'Ssali Emmanuel',   age:44, sex:'M', complaint:'Diabetes check + insulin Rx',   priority:'scheduled', status:'waiting',     arrive:'10:05' },
];

const MOCK_APPOINTMENTS = [
  { time:'10:30', name:'Dr. check – Nakayiza Rose',     type:'Ante-natal follow-up' },
  { time:'11:00', name:'Tumwesigye Alex',               type:'Post-surgery wound check' },
  { time:'11:30', name:'Nabirye Florence (child)',      type:'Immunisation' },
  { time:'13:00', name:'Ssekandi Mark',                 type:'Lab results review' },
  { time:'14:00', name:'Nambi Sarah',                   type:'BP monitoring' },
  { time:'14:30', name:'Okello Dennis',                 type:'Malaria follow-up' },
];

/* ── Offline consultation replay ───────────────────────────────────────────
 * A New Consultation recorded offline is queued (type 'consultation') with a
 * client-generated diagnosis id and everything that depends on it. This handler
 * replays the same sequence the wizard runs online, from any page that loaded
 * clinic.js, once the connection returns. The diagnosis id is the primary key,
 * so a re-run is a duplicate insert (treated as "already done") — the sale/
 * prescription/reminders are never double-created for the diagnosis.
 */
async function _replayConsultation(bundle) {
  var supa = _getClinicSupabase();
  if (!supa) return false;
  if (!bundle || !bundle.dxPayload) return true; // malformed → drop
  var dx = bundle.dxPayload;

  // 1. Diagnosis (fetch throw = offline → keep; server error = drop/continue).
  try {
    var r = await supa.from('clinic_diagnoses').insert(dx);
    if (r.error && /follow_up_reason/.test(r.error.message || '')) {
      var p = Object.assign({}, dx); delete p.follow_up_reason;
      r = await supa.from('clinic_diagnoses').insert(p);
    }
    if (r.error && !/duplicate|already exists/i.test(r.error.message || '')) {
      console.warn('replay diagnosis (will retry):', r.error.message);
      // KEEP it queued rather than drop. If a clinic was offline long enough for
      // its login to expire, the insert fails on auth — we must not lose the
      // consultation; it syncs after the staff signs in again. (Duplicate = a
      // prior partial run → fall through and finish the dependent rows.)
      return false;
    }
  } catch (e) {
    return false; // network — keep and retry later
  }

  // 2–5. Dependent rows — best effort (mirror the wizard's fire-and-forget).
  if (bundle.invItems && bundle.invItems.length) {
    try { await supa.rpc('deduct_inventory', { p_clinic_id: dx.clinic_id, p_diagnosis_id: dx.id, p_booking_id: (bundle.booking && bundle.booking.bookingId) || null, p_items: bundle.invItems }); } catch (e) {}
  }
  if (bundle.epx) { try { await supa.from('e_prescriptions').insert(bundle.epx); } catch (e) {} }
  if (bundle.followups && bundle.followups.length) { try { await supa.from('clinic_followups').insert(bundle.followups); } catch (e) {} }
  if (bundle.booking && bundle.booking.bookingId) {
    try { await supa.from('bookings').update({ status: 'attended', attended_at: bundle.booking.attended_at, clinic_diagnosis_id: dx.id }).eq('id', bundle.booking.bookingId); } catch (e) {}
  }
  return true; // done → remove from queue
}

if (window.ClinicOffline) {
  ClinicOffline.registerSyncHandler('consultation', function (item) { return _replayConsultation(item.payload); });
}

/* ── Generic offline RPC replay ────────────────────────────────────────────
 * Any queued { fn, args } (Record Payment, Restock, etc.) replays here once
 * online. args carry a client p_op_id and the server has idempotent 6-arg
 * overloads, so a retry after a lost ack returns the first result instead of
 * applying the write twice. If those overloads aren't deployed yet, we retry
 * once without p_op_id so the write still lands (idempotency resumes when the
 * migration applies).
 */
async function _replayRpc(payload) {
  var supa = _getClinicSupabase();
  if (!supa || !payload || !payload.fn) return !supa ? false : true;
  var fn = payload.fn, args = payload.args || {};
  try {
    var r = await supa.rpc(fn, args);
    if (r.error && ('p_op_id' in args) &&
        /could not find the function|p_op_id|does not exist|without parameters/i.test(r.error.message || '')) {
      var a2 = {};
      for (var k in args) { if (k !== 'p_op_id' && Object.prototype.hasOwnProperty.call(args, k)) a2[k] = args[k]; }
      r = await supa.rpc(fn, a2);
    }
    // A queued batch-add on a clinic that has not deployed the batches migration
    // falls back to a flat top-up, so the stock is never lost waiting for it.
    if (r.error && fn === 'add_stock_batch' &&
        /could not find the function|does not exist|schema cache/i.test(r.error.message || '')) {
      r = await supa.rpc('adjust_inventory', {
        p_clinic_id: args.p_clinic_id, p_inventory_id: args.p_inventory_id,
        p_qty_change: args.p_qty, p_txn_type: 'addition', p_notes: args.p_notes || null,
      });
    }
    if (r.error) return _replayDropOnPermanent('rpc ' + fn, r.error);
    if (r.data && r.data.ok === false) {       // server ran but rejected → permanent, drop
      console.warn('replay rpc rejected:', fn, r.data.error);
      return true;
    }
    return true;                               // ok (or idempotent duplicate) → done
  } catch (e) {
    return _replayDropOnPermanent('rpc ' + fn, e);
  }
}

// Replay a queued table insert (e.g. a stock item added offline). The row
// carries a client-generated id, so a duplicate means it already landed — that
// counts as success. If the live DB is missing a newer column, strip it and
// retry so the row still saves (mirrors the online add-stock fallback).
// Classify a failed replay so the outbox never spins "Syncing…" forever.
//   returns false        → NETWORK/offline error: keep & retry indefinitely
//                          (never counts against the give-up cap).
//   returns 'permanent'  → the server ran and REJECTED it (missing table /
//                          column, RLS, constraint, validation). Retrying
//                          can't help; the flush loop drops it after a few
//                          quick attempts (so a transient blip can't lose
//                          data, but a truly stuck write clears itself).
function _replayDropOnPermanent(label, err) {
  var CO = window.ClinicOffline;
  if (CO && CO.isNetworkErr && CO.isNetworkErr(err)) {
    console.warn('replay ' + label + ' (offline — will retry):', err && err.message);
    return false;
  }
  console.error('replay ' + label + ' rejected by server:', (err && err.message) || err);
  return 'permanent';
}

async function _replayTableInsert(payload) {
  var supa = _getClinicSupabase();
  if (!supa) return false;
  if (!payload || !payload.table || !payload.row) return true;   // malformed → drop
  var row = {};
  for (var k in payload.row) { if (Object.prototype.hasOwnProperty.call(payload.row, k)) row[k] = payload.row[k]; }
  try {
    var r = await supa.from(payload.table).insert(row);
    var guard = 0;
    while (r.error && payload.stripUnknownColumns && guard++ < 8) {
      var m = (r.error.message || '').match(/Could not find the '([^']+)' column/);
      if (!m || !(m[1] in row)) break;
      delete row[m[1]];
      r = await supa.from(payload.table).insert(row);
    }
    if (r.error) {
      if (/duplicate|already exists/i.test(r.error.message || '')) return true;  // already saved
      return _replayDropOnPermanent('insert ' + payload.table, r.error);
    }
    return true;
  } catch (e) {
    return _replayDropOnPermanent('insert ' + payload.table, e);
  }
}

// Replay a queued table UPDATE (e.g. clinic settings saved offline). Naturally
// idempotent — applying the same patch twice gives the same row. If the live DB
// lacks a newer column, strip it and retry so the rest still saves.
async function _replayTableUpdate(payload) {
  var supa = _getClinicSupabase();
  if (!supa) return false;
  if (!payload || !payload.table || !payload.patch || !payload.match) return true;  // malformed → drop
  var patch = {};
  for (var k in payload.patch) { if (Object.prototype.hasOwnProperty.call(payload.patch, k)) patch[k] = payload.patch[k]; }
  try {
    var q = function () { return supa.from(payload.table).update(patch).match(payload.match); };
    var r = await q();
    var guard = 0;
    while (r.error && guard++ < 10) {
      var m = (r.error.message || '').match(/Could not find the '([^']+)' column|column \S*?\.?"?([a-z_]+)"? does not exist/i);
      var bad = m && (m[1] || m[2]);
      if (!bad || !(bad in patch)) break;
      delete patch[bad];
      if (!Object.keys(patch).length) return true;   // nothing left to save
      r = await q();
    }
    if (r.error) return _replayDropOnPermanent('update ' + payload.table, r.error);
    return true;
  } catch (e) { return _replayDropOnPermanent('update ' + payload.table, e); }
}

// Replay a queued UPSERT (rows carry client ids → idempotent).
async function _replayTableUpsert(payload) {
  var supa = _getClinicSupabase();
  if (!supa) return false;
  if (!payload || !payload.table || !payload.rows || !payload.rows.length) return true;
  try {
    var r = await supa.from(payload.table).upsert(payload.rows, { onConflict: payload.onConflict || 'id' });
    if (r.error) {
      if (/duplicate|already exists/i.test(r.error.message || '')) return true;
      return _replayDropOnPermanent('upsert ' + payload.table, r.error);
    }
    return true;
  } catch (e) { return _replayDropOnPermanent('upsert ' + payload.table, e); }
}

// Replay a queued DELETE by ids (idempotent — deleting again is a no-op).
async function _replayTableDelete(payload) {
  var supa = _getClinicSupabase();
  if (!supa) return false;
  if (!payload || !payload.table || !payload.ids || !payload.ids.length) return true;
  try {
    var r = await supa.from(payload.table).delete().in('id', payload.ids);
    if (r.error) return _replayDropOnPermanent('delete ' + payload.table, r.error);
    return true;
  } catch (e) { return _replayDropOnPermanent('delete ' + payload.table, e); }
}

if (window.ClinicOffline) {
  ClinicOffline.registerSyncHandler('rpc', function (item) { return _replayRpc(item.payload); });
  ClinicOffline.registerSyncHandler('table_insert', function (item) { return _replayTableInsert(item.payload); });
  ClinicOffline.registerSyncHandler('table_update', function (item) { return _replayTableUpdate(item.payload); });
  ClinicOffline.registerSyncHandler('table_upsert', function (item) { return _replayTableUpsert(item.payload); });
  ClinicOffline.registerSyncHandler('table_delete', function (item) { return _replayTableDelete(item.payload); });

  // Called by the offline outbox BEFORE each flush. After a spell offline the
  // auth token often expires; every queued write then fails on auth and stays
  // queued forever ("Syncing 1 offline change…" that only clears on a manual
  // reload — because reloading re-inits Supabase and refreshes the token).
  // getSession() refreshes an expired token, and we re-authorize the realtime
  // socket with the fresh token so live updates resume too.
  window._clinicEnsureAuth = async function () {
    try {
      var supa = _getClinicSupabase();
      if (!supa) return;
      var s = await supa.auth.getSession();
      var tok = s && s.data && s.data.session && s.data.session.access_token;
      if (tok && supa.realtime && supa.realtime.setAuth) supa.realtime.setAuth(tok);
    } catch (e) {}
  };
}
