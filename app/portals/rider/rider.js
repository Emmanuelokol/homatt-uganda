/**
 * Homatt Health — Rider Portal JS
 */

const SUPABASE_URL  = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { detectSessionInUrl: false },
});

let isDemoMode = false;
let isOnline   = true;
let activeDeliveryStep = 1; // 1=assigned,2=at_pharmacy,3=in_transit,4=delivered

const DEMO_DELIVERIES = [
  {
    id: 'DEL-001',
    patient_name:    'Sarah Nalwoga',
    address:         '15 Muyenga Hill, Kampala',
    district:        'Kampala',
    drugs:           'Amoxicillin 500mg (21 tabs)',
    distance_km:     4.2,
    eta_minutes:     35,
    earnings:        3000,
    urgent:          true,
    pharmacy:        'City Pharmacy, Kampala Road',
  },
  {
    id: 'DEL-002',
    patient_name:    'David Mukasa',
    address:         'Bugolobi, Plot 5, Kampala',
    district:        'Kampala',
    drugs:           'Ciprofloxacin 500mg (28 tabs)',
    distance_km:     2.8,
    eta_minutes:     22,
    earnings:        3000,
    urgent:          false,
    pharmacy:        'Nakasero Pharmacy',
  },
];

const DEMO_HISTORY = [
  { date: '2 Mar 2026', patient: 'Grace Atim',    address: 'Ntinda Estate',   earnings: 3000, status: 'delivered', time: '09:42 AM' },
  { date: '1 Mar 2026', patient: 'Peter Ssali',   address: 'Kololo Ave',      earnings: 3000, status: 'delivered', time: '02:15 PM' },
  { date: '1 Mar 2026', patient: 'Rose Nansubuga', address: 'Kawempe Market', earnings: 3000, status: 'delivered', time: '11:30 AM' },
  { date: '28 Feb 2026', patient: 'James Okello', address: 'Mulago Hill',     earnings: 3000, status: 'delivered', time: '08:05 AM' },
  { date: '28 Feb 2026', patient: 'Aisha Namutebi', address: 'Nakasero Rd',   earnings: 3000, status: 'delivered', time: '10:50 AM' },
];

// ── AUTH ─────────────────────────────────────────────────────────────────────

async function doLogin() {
  const phone = document.getElementById('loginPhone').value.replace(/\s/g, '');
  const pass  = document.getElementById('loginPassword').value;
  if (!phone || !pass) { return; }

  const digits = phone.replace(/[^0-9]/g, '');
  const email  = '256' + digits.slice(-9) + '@rider.homatt.ug';

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { document.getElementById('loginError').classList.add('visible'); return; }
  launchApp();
}

function enterDemo() { isDemoMode = true; launchApp(); }
function doLogout()  { sb.auth.signOut(); location.href = '../'; }

function launchApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appLayout').style.display   = 'block';
  document.getElementById('statusDot').style.background = '#69F0AE';
  renderAvailableDeliveries(DEMO_DELIVERIES);
  renderHistory(DEMO_HISTORY);
  renderEarnings(DEMO_HISTORY);
}

// ── PAGE NAV ──────────────────────────────────────────────────────────────────

function rShowPage(name, el) {
  document.querySelectorAll('.r-page').forEach(p => p.classList.remove('active'));
  document.getElementById('rpage-' + name).classList.add('active');
  document.querySelectorAll('.r-nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
}

// ── ONLINE TOGGLE ─────────────────────────────────────────────────────────────

function toggleOnline() {
  isOnline = !isOnline;
  document.getElementById('statusDot').style.background  = isOnline ? '#69F0AE' : '#FF5252';
  document.getElementById('statusLabel').textContent     = isOnline ? 'Online' : 'Offline';
  if (!isOnline) {
    document.getElementById('availableDeliveries').innerHTML =
      '<div class="empty-state"><span class="material-icons-outlined">two_wheeler</span><p>You are offline. Toggle online to receive orders.</p></div>';
  } else {
    renderAvailableDeliveries(DEMO_DELIVERIES);
  }
}

// ── AVAILABLE DELIVERIES ──────────────────────────────────────────────────────

function renderAvailableDeliveries(deliveries) {
  const el = document.getElementById('availableDeliveries');
  if (!deliveries.length) {
    el.innerHTML = '<div class="empty-state"><span class="material-icons-outlined">inbox</span><p>No deliveries available right now</p></div>';
    return;
  }
  el.innerHTML = deliveries.map(d => `
    <div class="delivery-card">
      <div class="delivery-card-header">
        <div>
          <div class="delivery-patient">${d.patient_name}
            ${d.urgent ? '<span class="badge badge-emergency" style="font-size:10px;margin-left:6px">URGENT</span>' : ''}
          </div>
          <div class="delivery-address"><span class="material-icons-outlined" style="font-size:13px;vertical-align:middle">location_on</span> ${d.address}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:800;color:var(--accent-orange)">UGX ${(d.earnings||3000).toLocaleString()}</div>
          <div class="text-sm text-muted">${d.distance_km} km</div>
        </div>
      </div>
      <div class="delivery-meta">
        <span><span class="material-icons-outlined">schedule</span> ${d.eta_minutes} min ETA</span>
        <span><span class="material-icons-outlined">local_pharmacy</span> ${d.pharmacy}</span>
      </div>
      <div style="margin-top:8px;font-size:12px;color:var(--text-mid)">
        <span class="material-icons-outlined" style="font-size:13px;vertical-align:middle">medication</span>
        ${d.drugs}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-ghost btn-sm" style="flex:1" onclick="declineDelivery('${d.id}')">Decline</button>
        <button class="btn btn-primary btn-sm" style="flex:2;background:var(--accent-orange)" onclick="acceptDelivery('${d.id}','${d.patient_name}','${d.address}',${d.eta_minutes},${d.distance_km},${d.earnings})">
          <span class="material-icons-outlined">check</span> Accept (${d.eta_minutes} min to accept)
        </button>
      </div>
    </div>
  `).join('');
}

let acceptTimer = null;
function acceptDelivery(id, patient, address, eta, dist, earnings) {
  // Update active delivery view
  document.getElementById('activePatient').textContent  = patient;
  document.getElementById('activeAddress').textContent  = address;
  document.getElementById('activeMeta').innerHTML = `
    <span><span class="material-icons-outlined">schedule</span>ETA: ${eta} min</span>
    <span><span class="material-icons-outlined">route</span>${dist} km</span>
    <span><span class="material-icons-outlined">payments</span>UGX ${earnings.toLocaleString()}</span>
  `;

  activeDeliveryStep = 2;
  updateSteps(2);

  // Switch to active tab
  rShowPage('active', document.querySelectorAll('.r-nav-item')[1]);

  alert(`Delivery accepted!\n\nHead to pharmacy to pick up:\n${patient}'s order.\n\nScan QR code at pharmacy before collecting.`);
}

function declineDelivery(id) {
  const deliveries = DEMO_DELIVERIES.filter(d => d.id !== id);
  renderAvailableDeliveries(deliveries);
}

// ── ACTIVE DELIVERY ───────────────────────────────────────────────────────────

function updateSteps(step) {
  const steps = ['step1','step2','step3','step4'];
  steps.forEach((s, i) => {
    const el = document.getElementById(s);
    if (!el) return;
    el.className = 'step';
    if (i + 1 < step) el.classList.add('done');
    else if (i + 1 === step) el.classList.add('active');
  });
}

function scanPickup() {
  activeDeliveryStep = 3;
  updateSteps(3);
  document.getElementById('activeButtons').innerHTML = `
    <div class="alert alert-success" style="margin-bottom:12px">
      <span class="material-icons-outlined">check_circle</span>
      Package picked up at pharmacy. QR scan confirmed.
    </div>
    <button class="btn btn-primary" onclick="scanDelivery()" style="width:100%;background:var(--accent-orange)">
      <span class="material-icons-outlined">qr_code_scanner</span> Scan Delivery QR at Patient
    </button>
  `;
}

function scanDelivery() {
  activeDeliveryStep = 4;
  updateSteps(4);
  const now = new Date().toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('activeButtons').innerHTML = `
    <div class="alert alert-success">
      <span class="material-icons-outlined">check_circle</span>
      <div>
        <strong>Delivery Complete!</strong><br>
        Package delivered at ${now}. UGX 3,000 added to your earnings.
      </div>
    </div>
    <button class="btn btn-ghost" style="width:100%;margin-top:8px" onclick="rShowPage('available',document.querySelectorAll('.r-nav-item')[0])">
      <span class="material-icons-outlined">arrow_back</span> Back to Available Orders
    </button>
  `;

  // Add to history
  DEMO_HISTORY.unshift({
    date:     new Date().toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' }),
    patient:  document.getElementById('activePatient').textContent,
    address:  document.getElementById('activeAddress').textContent,
    earnings: 3000,
    status:   'delivered',
    time:     now,
  });
  renderHistory(DEMO_HISTORY);
  renderEarnings(DEMO_HISTORY);
}

// ── HISTORY ───────────────────────────────────────────────────────────────────

function renderHistory(history) {
  const el = document.getElementById('historyList');
  el.innerHTML = history.map(h => `
    <div class="delivery-card" style="cursor:default">
      <div class="delivery-card-header">
        <div>
          <div class="delivery-patient">${h.patient}</div>
          <div class="delivery-address">${h.address}</div>
          <div style="font-size:11px;color:var(--text-light);margin-top:4px">${h.date} · ${h.time}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:16px;font-weight:800;color:var(--brand-primary)">+UGX ${(h.earnings||3000).toLocaleString()}</div>
          <span class="badge badge-completed" style="margin-top:4px">Delivered</span>
        </div>
      </div>
    </div>
  `).join('');
}

// ── EARNINGS ──────────────────────────────────────────────────────────────────

function renderEarnings(history) {
  const el = document.getElementById('earningsList');
  el.innerHTML = history.slice(0, 5).map(h => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:600">${h.patient}</div>
        <div style="font-size:11px;color:var(--text-light)">${h.date} · ${h.time}</div>
      </div>
      <div style="font-size:14px;font-weight:700;color:var(--brand-primary)">+UGX ${(h.earnings||3000).toLocaleString()}</div>
    </div>
  `).join('');
}

// ── INIT ──────────────────────────────────────────────────────────────────────

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) launchApp();
})();
