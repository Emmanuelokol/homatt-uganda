/**
 * Homatt Health — Pharmacy Portal Shared Logic
 */

/* ── Build sidebar ── */
function buildPharmacySidebar(activePage) {
  const nav = [
    { label:'Overview', links:[
      { href:'dashboard.html', id:'dashboard', icon:'dashboard', text:'Dashboard' }
    ]},
    { label:'Orders', links:[
      { href:'orders.html', id:'orders', icon:'receipt_long', text:'Order Queue' },
      { href:'dashboard.html#active', id:'active', icon:'local_shipping', text:'Active Deliveries' }
    ]},
    { label:'Inventory', links:[
      { href:'inventory.html', id:'inventory', icon:'inventory_2', text:'Stock Management' }
    ]},
    { label:'Earnings', links:[
      { href:'earnings.html', id:'earnings', icon:'payments', text:'Revenue & Payouts' }
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
      <div class="sidebar-logo-text" id="pharmacyName">Pharmacy Portal</div>
      <div class="sidebar-logo-sub">Homatt Health — Uganda</div>
    </div>
    <nav class="sidebar-nav">${navHTML}</nav>
    <div class="sidebar-footer">
      <div class="admin-badge">
        <span class="material-icons-outlined" style="font-size:14px">local_pharmacy</span> Pharmacy
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,0.45);margin:6px 0 10px" id="pharmacyUserName">Loading...</div>
      <button class="logout-sidebar-btn" id="pharmacyLogoutBtn">
        <span class="material-icons-outlined" style="font-size:16px">logout</span> Sign Out
      </button>
    </div>`;

  // ── Mobile hamburger ──
  const topbar = document.querySelector('.admin-topbar');
  if (topbar && !topbar.querySelector('.sidebar-hamburger')) {
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
    el.classList.toggle('open', open);
    document.getElementById('_sidebarOverlay').classList.toggle('active', open);
  };
  const burger = topbar?.querySelector('.sidebar-hamburger');
  if (burger) burger.onclick = () => toggle(!el.classList.contains('open'));
  const ov = document.getElementById('_sidebarOverlay');
  if (ov) ov.onclick = () => toggle(false);
  el.querySelectorAll('.sidebar-link').forEach(l =>
    l.addEventListener('click', () => { if (window.innerWidth <= 768) toggle(false); })
  );
}

/* ── Session management ── */
function getPharmacySession() {
  try {
    const s = JSON.parse(localStorage.getItem('pharmacy_session') || 'null');
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : null;
  } catch(e) { return null; }
}

function requirePharmacy() {
  // Hide content immediately so there's no flash of protected content before redirect
  document.body.style.visibility = 'hidden';
  const s = getPharmacySession();
  if (!s) {
    localStorage.removeItem('pharmacy_session');
    window.location.href = 'index.html';
    return null;
  }
  // Auth passed — show the page
  document.body.style.visibility = 'visible';
  const el = document.getElementById('pharmacyUserName');
  const nm = document.getElementById('pharmacyName');
  const av = document.getElementById('pharmacyUserAvatar');
  const nt = document.getElementById('pharmacyUserNameTop');
  if (el) el.textContent = s.staffName || s.pharmacyName || 'Pharmacist';
  if (nm) nm.textContent = s.pharmacyName || 'Pharmacy Portal';
  if (av) av.textContent = (s.staffName || s.pharmacyName || 'P')[0].toUpperCase();
  if (nt) nt.textContent = s.staffName || 'Pharmacist';

  // Non-demo: validate Supabase session in background to prevent localStorage forgery
  if (!s.demo) {
    setTimeout(async () => {
      try {
        const supa = initPharmacySupabase();
        if (!supa) return;
        const { data } = await supa.auth.getSession();
        if (!data?.session) {
          localStorage.removeItem('pharmacy_session');
          window.location.href = 'index.html';
          return;
        }
        if (s.userId && data.session.user.id !== s.userId) {
          localStorage.removeItem('pharmacy_session');
          window.location.href = 'index.html';
        }
      } catch(e) { /* Network error — allow offline access */ }
    }, 200);
  }

  return s;
}

function setupPharmacyLogout() {
  document.getElementById('pharmacyLogoutBtn')?.addEventListener('click', async () => {
    // Sign out of Supabase if connected
    if (window.supabase && window.HOMATT_CONFIG?.SUPABASE_URL) {
      try { await window._pharmSupa?.auth.signOut(); } catch(e) {}
    }
    localStorage.removeItem('pharmacy_session');
    window.location.href = 'index.html';
  });
}

function showToast(msg, type = 'success') {
  let t = document.getElementById('pharmacyToast');
  if (!t) { t = document.createElement('div'); t.id = 'pharmacyToast'; t.className = 'admin-toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.style.background = type === 'error' ? '#D32F2F' : type === 'warning' ? '#E65100' : '#1E1E1E';
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3500);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-UG', { day:'numeric', month:'short', year:'numeric' });
}
function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-UG', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}
function formatUGX(n) {
  if (!n && n !== 0) return '—';
  return 'UGX ' + Number(n).toLocaleString();
}

/* ── Supabase init for pharmacy portal ── */
function initPharmacySupabase() {
  const cfg = window.HOMATT_CONFIG || {};
  if (!cfg.SUPABASE_URL || !window.supabase) return null;
  return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { storageKey: 'sb-homatt-pharmacy-auth' } });
}

/* ── Mock data (demo mode fallback) ── */
const MOCK_ORDERS = [
  { id:'ord-001', status:'incoming', urgency:'urgent',   patient_name:'Ssempa Robert',  patient_phone:'+256 771 123 456', delivery_address:'Ntinda Estate, Plot 7',  items:[{name:'Coartem 20/120mg',qty:6},{name:'Paracetamol 500mg',qty:10}], medication_cost:18500, delivery_cost:2000, total_cost:20500, created_at: new Date(Date.now()-180000).toISOString() },
  { id:'ord-002', status:'incoming', urgency:'standard', patient_name:'Nakato Brenda',  patient_phone:'+256 782 234 567', delivery_address:'Kyanja, Zone 3, H22',     items:[{name:'Amoxicillin 500mg',qty:21}], medication_cost:8500, delivery_cost:2000, total_cost:10500, created_at: new Date(Date.now()-420000).toISOString() },
  { id:'ord-003', status:'confirmed',urgency:'standard', patient_name:'Mubiru John',    patient_phone:'+256 755 345 678', delivery_address:'Namuwongo, Block B',      items:[{name:'ORS Sachet',qty:5},{name:'Paracetamol 500mg',qty:10}], medication_cost:5000, delivery_cost:2000, total_cost:7000, created_at: new Date(Date.now()-900000).toISOString() },
  { id:'ord-004', status:'preparing', urgency:'standard', patient_name:'Namutebi Agnes', patient_phone:'+256 700 456 789', delivery_address:'Kira Road, House 14',    items:[{name:'Folic Acid 5mg',qty:30},{name:'Ferrous Sulphate 200mg',qty:30}], medication_cost:9000, delivery_cost:2000, total_cost:11000, created_at: new Date(Date.now()-1800000).toISOString() },
];

const MOCK_INVENTORY = [
  { id:'inv-1', medicine_name:'Coartem 20/120mg',       quantity:48,  reorder_threshold:20, retail_price:3200 },
  { id:'inv-2', medicine_name:'Paracetamol 500mg',      quantity:230, reorder_threshold:50, retail_price:500  },
  { id:'inv-3', medicine_name:'Amoxicillin 500mg',      quantity:8,   reorder_threshold:30, retail_price:850  },
  { id:'inv-4', medicine_name:'ORS Sachet',             quantity:5,   reorder_threshold:20, retail_price:1200 },
  { id:'inv-5', medicine_name:'Metformin 500mg',        quantity:180, reorder_threshold:40, retail_price:600  },
  { id:'inv-6', medicine_name:'Amlodipine 5mg',         quantity:120, reorder_threshold:30, retail_price:700  },
  { id:'inv-7', medicine_name:'Folic Acid 5mg',         quantity:15,  reorder_threshold:25, retail_price:300  },
  { id:'inv-8', medicine_name:'Ferrous Sulphate 200mg', quantity:12,  reorder_threshold:25, retail_price:400  },
  { id:'inv-9', medicine_name:'Metronidazole 400mg',    quantity:60,  reorder_threshold:20, retail_price:900  },
  { id:'inv-10',medicine_name:'Ibuprofen 400mg',        quantity:90,  reorder_threshold:30, retail_price:600  },
];
