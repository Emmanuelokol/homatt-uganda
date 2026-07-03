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
  owner:        ['*'],
  clinician:    ['consultations', 'history', 'bookings', 'meds'],
  nurse:        ['consultations', 'history', 'bookings', 'meds'],
  receptionist: ['bookings', 'history', 'payments', 'quicksale'],
};

var CLINIC_ROLE_LABELS = {
  owner:        'Owner / Manager',
  clinician:    'Clinician (Doctor)',
  nurse:        'Nurse',
  receptionist: 'Receptionist',
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

// Page-level guard: redirect to the dashboard if the role lacks a capability.
// Call at the top of a protected page (e.g. new-order requires 'consultations').
function requireClinicCap(cap) {
  if (clinicCan(cap)) return true;
  alert('Your role does not have access to this page.');
  window.location.href = 'dashboard.html';
  return false;
}

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
    if (r.error) return false;                 // transport/db/auth error → keep & retry
    if (r.data && r.data.ok === false) {       // server ran but rejected → permanent, drop
      console.warn('replay rpc rejected:', fn, r.data.error);
      return true;
    }
    return true;                               // ok (or idempotent duplicate) → done
  } catch (e) {
    return false;                              // network threw → keep & retry
  }
}

if (window.ClinicOffline) {
  ClinicOffline.registerSyncHandler('rpc', function (item) { return _replayRpc(item.payload); });
}
