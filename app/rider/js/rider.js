/* Homatt Health — Rider Portal shared JS */

function requireRider() {
  const raw = localStorage.getItem('rider_session');
  if (!raw) { window.location.href = 'index.html'; return null; }
  const s = JSON.parse(raw);
  const name = s.name || 'Rider';
  const el1 = document.getElementById('riderUserName');
  const el2 = document.getElementById('riderUserNameTop');
  const av  = document.getElementById('riderUserAvatar');
  if (el1) el1.textContent = name;
  if (el2) el2.textContent = name;
  if (av)  av.textContent  = name[0].toUpperCase();
  return s;
}

function setupRiderMobileNav() {
  const sidebar = document.querySelector('.admin-sidebar');
  const topbar  = document.querySelector('.admin-topbar');
  if (!sidebar || !topbar) return;
  if (!topbar.querySelector('.sidebar-hamburger')) {
    const burger = document.createElement('button');
    burger.className = 'sidebar-hamburger';
    burger.innerHTML = '<span class="material-icons-outlined">menu</span>';
    topbar.insertBefore(burger, topbar.firstChild);
  }
  if (!document.getElementById('_sidebarOverlay')) {
    const ov = document.createElement('div');
    ov.id = '_sidebarOverlay'; ov.className = 'sidebar-overlay';
    document.body.appendChild(ov);
  }
  const toggle = (open) => {
    sidebar.classList.toggle('open', open);
    document.getElementById('_sidebarOverlay').classList.toggle('active', open);
  };
  topbar.querySelector('.sidebar-hamburger').onclick = () => toggle(!sidebar.classList.contains('open'));
  document.getElementById('_sidebarOverlay').onclick = () => toggle(false);
  sidebar.querySelectorAll('.sidebar-link, a').forEach(l =>
    l.addEventListener('click', () => { if (window.innerWidth <= 768) toggle(false); })
  );
}

function setupRiderLogout() {
  setupRiderMobileNav();
  document.getElementById('riderLogoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('rider_session');
    window.location.href = 'index.html';
  });
}

function showToast(msg, type = 'success') {
  let t = document.getElementById('riderToast');
  if (!t) { t = document.createElement('div'); t.id = 'riderToast'; t.className = 'admin-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.background = type === 'error' ? '#D32F2F' : type === 'warning' ? '#E65100' : '#1E1E1E';
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3500);
}

/* ── Mock delivery requests ── */
let DELIVERY_REQUESTS = [
  { id:'REQ-041', type:'Medication', item:'Insulin + syringes (urgent)',  from:'Kampala Pharmacy, Wandegeya', to:'Plot 14, Ntinda Estate',     dist:'2.8 km', pay:'UGX 9,500',  urgent:true  },
  { id:'REQ-042', type:'Lab Result', item:'Blood test results',           from:'Mulago Lab',                  to:'Kira Road, House 22B',       dist:'4.1 km', pay:'UGX 7,000',  urgent:false },
  { id:'REQ-043', type:'Medication', item:'Malaria drugs (3-day course)', from:'City Chemist, Nakasero',      to:'Namuwongo, Zone 3',          dist:'5.3 km', pay:'UGX 12,000', urgent:false },
];

let ACTIVE_DELIVERIES = [
  { id:'DEL-038', item:'Prenatal vitamins',  from:'Wandegeya Pharmacy', to:'Naalya Estate, House 7', dist:'3.2 km', status:'in-transit', pay:'UGX 8,500',  elapsed:'12 min' },
];

const COMPLETED_TODAY = [
  { id:'DEL-035', item:'Paracetamol + ORS',  to:'Kyanja, Plot 5',     pay:'UGX 6,000',  time:'08:10' },
  { id:'DEL-036', item:'Prescription drugs', to:'Mbuya, Hill Road',   pay:'UGX 11,000', time:'09:35' },
  { id:'DEL-037', item:'Lab sample delivery',to:'Bukoto Medical Lab',  pay:'UGX 8,500',  time:'10:55' },
  { id:'DEL-038', item:'Eye drops + cream',  to:'Naguru, House 31',   pay:'UGX 5,500',  time:'12:20' },
  { id:'DEL-039', item:'Insulin pen',        to:'Kamwokya, Zone 4',   pay:'UGX 14,000', time:'13:40' },
  { id:'DEL-040', item:'Prenatal vitamins',  to:'Ntinda, Plot 22',    pay:'UGX 9,000',  time:'15:05' },
];
