/**
 * Homatt Health — Admin Portal Shared Logic
 */
const cfg = window.HOMATT_CONFIG || {};
// Isolated storage key so admin session never overwrites the Homatt patient session
const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
  auth: { storageKey: 'sb-homatt-admin-auth' }
});

/* ── Sidebar builder ── */
function buildAdminSidebar(activePage) {
  const nav = [
    { label:'Overview', links:[
      { href:'dashboard.html', icon:'dashboard', id:'dashboard', text:'Dashboard' }
    ]},
    { label:'Partners', links:[
      { href:'clinics.html',    icon:'local_hospital', id:'clinics',    text:'Clinics' },
      { href:'pharmacies.html', icon:'local_pharmacy',  id:'pharmacies', text:'Pharmacies' },
      { href:'riders.html',     icon:'electric_moped',  id:'riders',     text:'Riders' }
    ]},
    { label:'Operations', links:[
      { href:'users.html',         icon:'people',          id:'users',         text:'Users' },
      { href:'support.html',       icon:'contact_support', id:'support',       text:'Support Tickets' },
      { href:'prescriptions.html', icon:'medication',       id:'prescriptions', text:'Prescriptions' }
    ]},
    { label:'Content', links:[
      { href:'emergency.html', icon:'emergency',   id:'emergency', text:'Emergency Info' },
      { href:'terms.html',     icon:'description', id:'terms',     text:'Terms & Content' }
    ]},
    { label:'Financial', links:[
      { href:'finance.html', icon:'payments', id:'finance', text:'Finance & Payouts' }
    ]},
    { label:'Marketplace', links:[
      { href:'marketplace.html', icon:'storefront', id:'marketplace', text:'Products' }
    ]}
  ];

  const navHTML = nav.map(g => `
    <div class="sidebar-section-label">${g.label}</div>
    ${g.links.map(l => `
      <a href="${l.href}" class="sidebar-link${l.id === activePage ? ' active' : ''}">
        <span class="material-icons-outlined">${l.icon}</span> ${l.text}
      </a>`).join('')}
  `).join('');

  const el = document.querySelector('.admin-sidebar');
  if (!el) return;
  el.innerHTML = `
    <div class="sidebar-logo">
      <div class="sidebar-logo-text">Homatt Health</div>
      <div class="sidebar-logo-sub">Admin Portal — Uganda</div>
    </div>
    <nav class="sidebar-nav">${navHTML}</nav>
    <div class="sidebar-footer">
      <div class="admin-badge">
        <span class="material-icons-outlined" style="font-size:14px">verified_user</span> Admin
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,0.5);margin-bottom:10px" id="adminUserName">Loading...</div>
      <button class="logout-sidebar-btn" id="adminLogoutBtn">
        <span class="material-icons-outlined" style="font-size:16px">logout</span> Sign Out
      </button>
    </div>`;
}

/* ── Admin auth guard ── */
async function requireAdmin() {
  // Demo mode — skip Supabase auth entirely
  let demo;
  try { demo = JSON.parse(localStorage.getItem('admin_session') || 'null'); } catch(e) {}
  if (demo && typeof demo === 'object' && demo.demo) {
    const adminName = demo.name || 'Admin (Demo)';
    const avatarEl = document.getElementById('adminUserAvatar');
    const nameEl   = document.getElementById('adminUserName');
    const nameTop  = document.getElementById('adminUserNameTop');
    if (avatarEl) avatarEl.textContent = adminName.charAt(0).toUpperCase();
    if (nameEl)   nameEl.textContent   = adminName;
    if (nameTop)  nameTop.textContent  = adminName;
    return { demo: true };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return null; }

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, is_admin')
    .eq('id', session.user.id)
    .single();

  if (!profile?.is_admin) { window.location.href = 'index.html'; return null; }

  const adminName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Admin';
  const avatarEl = document.getElementById('adminUserAvatar');
  const nameEl   = document.getElementById('adminUserName');
  const nameTop  = document.getElementById('adminUserNameTop');
  if (avatarEl) avatarEl.textContent = adminName.charAt(0).toUpperCase();
  if (nameEl)   nameEl.textContent   = adminName;
  if (nameTop)  nameTop.textContent  = adminName;
  return session;
}

/* ── Portal auth guard (clinic/pharmacy/rider portals) ── */
async function requirePortalUser(expectedRole, onSuccess) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }

  const { data } = await supabase
    .from('portal_users')
    .select('*')
    .eq('auth_user_id', session.user.id)
    .eq('role', expectedRole)
    .eq('is_active', true)
    .single();

  if (!data) { window.location.href = 'index.html'; return; }
  onSuccess(session, data);
}

/* ── Logout ── */
function setupAdminLogout() {
  document.getElementById('adminLogoutBtn')?.addEventListener('click', async () => {
    localStorage.removeItem('admin_session');
    await supabase.auth.signOut();
    window.location.href = 'index.html';
  });
}

/* ── Toast ── */
function showAdminToast(msg, type = 'default') {
  let t = document.getElementById('adminToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'adminToast';
    t.className = 'admin-toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = type === 'success' ? '#1B5E20' : type === 'error' ? '#D32F2F' : '#1E1E1E';
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3000);
}

/* ── Utilities ── */
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-UG', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
}
function formatShortDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-UG', { day:'numeric', month:'short', year:'numeric' });
}
function formatUGX(n) {
  if (!n && n !== 0) return '—';
  return 'UGX ' + Number(n).toLocaleString();
}
