/**
 * Homatt Health — Admin Portal Shared Logic
 */

const cfg = window.HOMATT_CONFIG || {};
const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

// Check admin auth before page loads
async function requireAdmin() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'index.html';
    return null;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('first_name, last_name, is_admin')
    .eq('id', session.user.id)
    .single();

  if (!profile || !profile.is_admin) {
    window.location.href = 'index.html';
    return null;
  }

  // Render admin user in topbar
  const adminName = `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Admin';
  const avatarEl = document.getElementById('adminUserAvatar');
  const nameEl = document.getElementById('adminUserName');
  if (avatarEl) avatarEl.textContent = adminName.charAt(0).toUpperCase();
  if (nameEl) nameEl.textContent = adminName;

  return session;
}

// Shared logout
function setupAdminLogout() {
  const logoutBtn = document.getElementById('adminLogoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabase.auth.signOut();
      window.location.href = 'index.html';
    });
  }
}

// Admin toast
function showAdminToast(msg, type = 'default') {
  let toast = document.getElementById('adminToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToast';
    toast.className = 'admin-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  if (type === 'success') toast.style.background = '#1B5E20';
  else if (type === 'error') toast.style.background = '#D32F2F';
  else toast.style.background = '#1E1E1E';
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

// Format date for display
function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-UG', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}
