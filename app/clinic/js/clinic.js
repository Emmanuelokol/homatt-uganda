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

function setupClinicLogout() {
  // Setup mobile nav (called from every portal page after DOMContentLoaded)
  setupClinicMobileNav();

  document.getElementById('clinicLogoutBtn')?.addEventListener('click', async () => {
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
  });
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
