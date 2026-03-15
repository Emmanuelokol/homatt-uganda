/**
 * Homatt Health — Admin Portal JS
 * Supabase-integrated with demo mode fallback
 */

const SUPABASE_URL  = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let isDemoMode = false;
let currentFilter = 'all';

// ── DEMO DATA ───────────────────────────────────────────────────────────────

// ── SHOP ORDER DEMO DATA ─────────────────────────────────────────────────────

const DEMO_SHOP_ORDERS = [
  { id: 'so-001', product_name: 'Mosquito Net',            quantity: 2, unit_price: 15000, total_price: 30000, contact_phone: '0701234567', delivery_address: 'Kampala, Nakasero',    status: 'pending',    created_at: '2026-03-14T09:00:00Z' },
  { id: 'so-002', product_name: 'Hand Sanitizer 500ml',    quantity: 3, unit_price: 5000,  total_price: 15000, contact_phone: '0702345678', delivery_address: 'Wakiso, Nansana',      status: 'processing', created_at: '2026-03-14T08:30:00Z' },
  { id: 'so-003', product_name: 'ORS Sachets (20 pcs)',    quantity: 1, unit_price: 4000,  total_price: 4000,  contact_phone: '0703456789', delivery_address: 'Kampala, Rubaga',      status: 'shipped',    created_at: '2026-03-13T14:00:00Z' },
  { id: 'so-004', product_name: 'Mosquito Repellent Spray',quantity: 4, unit_price: 8000,  total_price: 32000, contact_phone: '0704567890', delivery_address: 'Mukono, Seeta',        status: 'delivered',  created_at: '2026-03-12T11:00:00Z' },
  { id: 'so-005', product_name: 'Face Masks (10 pcs)',     quantity: 5, unit_price: 6000,  total_price: 30000, contact_phone: '0705678901', delivery_address: 'Kampala, Mengo',       status: 'completed',  created_at: '2026-03-11T10:00:00Z' },
  { id: 'so-006', product_name: 'Vitamin C 500mg (30 tabs)',quantity: 2, unit_price: 10000,total_price: 20000, contact_phone: '0706789012', delivery_address: 'Jinja, Main Street',   status: 'pending',    created_at: '2026-03-14T07:45:00Z' },
];

const DEMO = {
  bookings: [
    { booking_code: 'AFH-20260302-4827', patient_name: 'Sarah Nalwoga', patient_age: 34, patient_sex: 'female', ai_diagnosis: 'Pneumonia', urgency_level: 'urgent',   status: 'confirmed',  clinic: 'Kampala Medical Center',       created_at: '2026-03-02T08:14:00Z' },
    { booking_code: 'AFH-20260302-3191', patient_name: 'James Okello',  patient_age: 28, patient_sex: 'male',   ai_diagnosis: 'Malaria',   urgency_level: 'emergency', status: 'in_progress', clinic: 'Mulago National Referral',    created_at: '2026-03-02T07:50:00Z' },
    { booking_code: 'AFH-20260301-9043', patient_name: 'Grace Atim',    patient_age: 52, patient_sex: 'female', ai_diagnosis: 'Hypertension', urgency_level: 'urgent', status: 'completed', clinic: 'Case Medical Center',         created_at: '2026-03-01T15:30:00Z' },
    { booking_code: 'AFH-20260301-7712', patient_name: 'David Mukasa',  patient_age: 19, patient_sex: 'male',   ai_diagnosis: 'Typhoid',   urgency_level: 'medium',    status: 'completed', clinic: 'Nakasero Hospital',            created_at: '2026-03-01T11:20:00Z' },
    { booking_code: 'AFH-20260228-6554', patient_name: 'Aisha Namutebi',patient_age: 41, patient_sex: 'female', ai_diagnosis: 'Appendicitis', urgency_level: 'emergency', status: 'cancelled', clinic: 'International Hospital KLA', created_at: '2026-02-28T22:10:00Z' },
    { booking_code: 'AFH-20260228-5123', patient_name: 'Peter Ssali',   patient_age: 67, patient_sex: 'male',   ai_diagnosis: 'COPD Exacerbation', urgency_level: 'urgent', status: 'completed', clinic: 'Kampala Medical Center', created_at: '2026-02-28T09:00:00Z' },
    { booking_code: 'AFH-20260227-4401', patient_name: 'Rose Nansubuga', patient_age: 22, patient_sex: 'female', ai_diagnosis: 'UTI', urgency_level: 'medium', status: 'completed', clinic: 'Case Medical Center',             created_at: '2026-02-27T14:00:00Z' },
  ],
  escalations: [
    { patient_name: 'James Okello',  urgency_level: 'emergency', symptoms: ['severe chest pain','difficulty breathing','sweating'], ai_diagnosis: 'Possible Myocardial Infarction', confidence_percent: 82, location_district: 'Kampala', action_taken: 'call_emergency', resolved: false, created_at: '2026-03-02T07:50:00Z' },
    { patient_name: 'Sarah Nalwoga', urgency_level: 'urgent',    symptoms: ['high fever','chills','cough','chest pain'], ai_diagnosis: 'Pneumonia', confidence_percent: 78, location_district: 'Kampala', action_taken: 'book_clinic', resolved: false, created_at: '2026-03-02T08:14:00Z' },
    { patient_name: 'Aisha Namutebi',urgency_level: 'emergency', symptoms: ['severe abdominal pain','nausea','vomiting'], ai_diagnosis: 'Appendicitis', confidence_percent: 91, location_district: 'Kampala', action_taken: 'call_emergency', resolved: false, created_at: '2026-02-28T22:10:00Z' },
    { patient_name: 'Peter Ssali',   urgency_level: 'urgent',    symptoms: ['severe cough','difficulty breathing','wheezing'], ai_diagnosis: 'COPD Exacerbation', confidence_percent: 85, location_district: 'Kampala', action_taken: 'book_clinic', resolved: true, created_at: '2026-02-28T09:00:00Z' },
    { patient_name: 'Grace Atim',    urgency_level: 'urgent',    symptoms: ['severe headache','blurred vision','high blood pressure'], ai_diagnosis: 'Hypertensive Crisis', confidence_percent: 87, location_district: 'Wakiso', action_taken: 'book_clinic', resolved: true, created_at: '2026-03-01T15:30:00Z' },
  ],
  prescriptions: [
    { id: 'RX-001', patient_name: 'Sarah Nalwoga', doctor_name: 'Dr. Sarah Nakamya', doctor_license: 'UMC-2024-00123', final_diagnosis: 'Pneumonia', ai_diagnosis_confirmed: true, drugs: [{generic_name:'Amoxicillin',strength:'500mg',frequency:'3x daily',duration:'7 days'}], status: 'dispensed', created_at: '2026-03-02T10:30:00Z' },
    { id: 'RX-002', patient_name: 'Grace Atim',    doctor_name: 'Dr. James Ssali',   doctor_license: 'UMC-2024-00456', final_diagnosis: 'Hypertensive Crisis', ai_diagnosis_confirmed: false, drugs: [{generic_name:'Amlodipine',strength:'5mg',frequency:'1x daily',duration:'30 days'},{generic_name:'Hydrochlorothiazide',strength:'25mg',frequency:'1x daily',duration:'30 days'}], status: 'dispensed', created_at: '2026-03-01T17:00:00Z' },
    { id: 'RX-003', patient_name: 'David Mukasa',  doctor_name: 'Dr. Grace Atim',    doctor_license: 'UMC-2024-00789', final_diagnosis: 'Typhoid Fever', ai_diagnosis_confirmed: true, drugs: [{generic_name:'Ciprofloxacin',strength:'500mg',frequency:'2x daily',duration:'14 days'}], status: 'issued', created_at: '2026-03-01T12:45:00Z' },
    { id: 'RX-004', patient_name: 'Peter Ssali',   doctor_name: 'Dr. Sarah Nakamya', doctor_license: 'UMC-2024-00123', final_diagnosis: 'COPD Exacerbation', ai_diagnosis_confirmed: true, drugs: [{generic_name:'Salbutamol Inhaler',strength:'100mcg',frequency:'4x daily',duration:'5 days'},{generic_name:'Prednisolone',strength:'30mg',frequency:'1x daily',duration:'5 days'}], status: 'dispensed', created_at: '2026-02-28T10:00:00Z' },
  ],
  clinics: [
    { name: 'Kampala Medical Center',          district: 'Kampala', phone: '+256700123456', license_number: 'KMC-2024-001', specialties: ['General Medicine','Emergency','Pediatrics'] },
    { name: 'Mulago National Referral Hospital',district: 'Kampala', phone: '+256414531000', license_number: 'MNR-2024-002', specialties: ['Emergency','Surgery','Obstetrics'] },
    { name: 'Case Medical Center',              district: 'Kampala', phone: '+256312202100', license_number: 'CMC-2024-003', specialties: ['General Medicine','Diagnostics'] },
    { name: 'Nakasero Hospital',                district: 'Kampala', phone: '+256312103000', license_number: 'NKS-2024-004', specialties: ['Emergency','Cardiac','Orthopedics'] },
    { name: 'International Hospital Kampala',   district: 'Kampala', phone: '+256417200400', license_number: 'IHK-2024-005', specialties: ['Emergency','ICU','Oncology'] },
  ],
  pharmacies: [
    { name: 'City Pharmacy',      district: 'Kampala', phone: '+256700234567', license_number: 'PHM-2024-001' },
    { name: 'Nakasero Pharmacy',  district: 'Kampala', phone: '+256700345678', license_number: 'PHM-2024-002' },
    { name: 'Life Care Pharmacy', district: 'Kampala', phone: '+256700456789', license_number: 'PHM-2024-003' },
  ],
  riders: [
    { full_name: 'David Mukasa', phone: '+256701234567', plate_number: 'UAA 123B', total_deliveries: 47, rating: 4.90, available: true  },
    { full_name: 'Peter Kasozi', phone: '+256702345678', plate_number: 'UBA 456C', total_deliveries: 23, rating: 4.80, available: true  },
    { full_name: 'Moses Okello', phone: '+256703456789', plate_number: 'UAB 789D', total_deliveries: 68, rating: 4.95, available: false },
  ],
  flags: [
    { title: 'Repeated pharmacy rejections', desc: 'Life Care Pharmacy rejected 3 orders in 24 hours. Manual review required.', level: 'warning' },
    { title: 'High volume booking spike', desc: 'Bookings increased 180% in Kawempe district between 06:00–09:00. Possible outbreak.', level: 'warning' },
  ],
};

// ── AUTH ────────────────────────────────────────────────────────────────────

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const err   = document.getElementById('loginError');
  if (!email || !pass) { err.textContent = 'Please enter email and password.'; err.classList.add('visible'); return; }

  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    err.textContent = 'Invalid credentials. Try demo mode.';
    err.classList.add('visible');
    return;
  }
  document.getElementById('sUserName').textContent = data.user.email.split('@')[0];
  document.getElementById('avatarBtn').textContent = data.user.email[0].toUpperCase();
  launchApp();
}

function enterDemo() {
  isDemoMode = true;
  document.getElementById('sUserName').textContent = 'Demo Admin';
  launchApp();
}

function doLogout() {
  sb.auth.signOut();
  location.href = '../';
}

async function launchApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appLayout').style.display   = 'flex';
  await loadAllData();
}

// ── PAGE NAVIGATION ──────────────────────────────────────────────────────────

function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('pageTitle').textContent =
    { dashboard:'Dashboard', bookings:'Bookings', escalations:'Escalations',
      prescriptions:'Prescriptions', compliance:'Compliance', reports:'Reports',
      clinics:'Clinics Registry', pharmacies:'Pharmacies Registry', riders:'Rider Fleet',
      'shop-orders': 'Shop Orders' }[name] || name;
}

// ── DATA LOADING ─────────────────────────────────────────────────────────────

async function loadAllData() {
  let bookings, escalations, prescriptions, clinics, pharmacies, riders, shopOrders;

  if (isDemoMode) {
    bookings      = DEMO.bookings;
    escalations   = DEMO.escalations;
    prescriptions = DEMO.prescriptions;
    clinics       = DEMO.clinics;
    pharmacies    = DEMO.pharmacies;
    riders        = DEMO.riders;
    shopOrders    = DEMO_SHOP_ORDERS;
  } else {
    const [b, e, p, cl, ph, r, so] = await Promise.all([
      sb.from('bookings').select('*').order('created_at', { ascending: false }).limit(50),
      sb.from('escalations').select('*').order('created_at', { ascending: false }).limit(20),
      sb.from('doctor_prescriptions').select('*').order('created_at', { ascending: false }).limit(20),
      sb.from('clinics').select('*').eq('verified', true),
      sb.from('pharmacies').select('*').eq('verified', true),
      sb.from('riders').select('*'),
      sb.from('shop_orders').select('*').order('created_at', { ascending: false }).limit(100),
    ]);
    bookings      = b.data  || DEMO.bookings;
    escalations   = e.data  || DEMO.escalations;
    prescriptions = p.data  || DEMO.prescriptions;
    clinics       = cl.data || DEMO.clinics;
    pharmacies    = ph.data || DEMO.pharmacies;
    riders        = r.data  || DEMO.riders;
    shopOrders    = so.data || DEMO_SHOP_ORDERS;
  }

  renderDashBookings(bookings.slice(0, 5));
  renderDashEscalations(escalations.slice(0, 4));
  renderDashPrescriptions(prescriptions.slice(0, 4));
  renderDashFlags();
  renderAllBookings(bookings);
  renderEscalations(escalations);
  renderPrescriptions(prescriptions);
  renderClinics(clinics);
  renderPharmacies(pharmacies);
  renderRiders(riders);
  renderComplianceFlags();
  renderShopOrders(shopOrders);
  renderDashShopOrders(shopOrders.slice(0, 5));

  // Update shop orders badge with pending count
  const pending = shopOrders.filter(o => o.status === 'pending').length;
  document.getElementById('badgeShopOrders').textContent = pending;
  document.getElementById('dashShopCount').textContent = shopOrders.length;
  document.getElementById('dashShopPending').textContent = `↑ ${pending} pending`;
}

// ── RENDERERS ────────────────────────────────────────────────────────────────

function urgencyBadge(u) {
  if (u === 'emergency') return '<span class="badge badge-emergency">🔴 Emergency</span>';
  if (u === 'urgent')    return '<span class="badge badge-urgent">🟠 Urgent</span>';
  if (u === 'medium')    return '<span class="badge badge-confirmed">Medium</span>';
  return '<span class="badge">Low</span>';
}

function statusBadge(s) {
  const map = {
    pending:'badge-pending', confirmed:'badge-confirmed', in_progress:'badge-progress',
    completed:'badge-completed', cancelled:'badge-cancelled',
  };
  return `<span class="badge ${map[s]||''}">${s.replace('_',' ')}</span>`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-UG', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function renderDashBookings(bks) {
  const tb = document.getElementById('dashBookingsTable');
  tb.innerHTML = bks.map(b => `
    <tr>
      <td><span class="code-badge">${b.booking_code}</span></td>
      <td>${b.patient_name}</td>
      <td>${urgencyBadge(b.urgency_level)}</td>
      <td>${statusBadge(b.status)}</td>
    </tr>
  `).join('');
}

function renderDashEscalations(escs) {
  const tl = document.getElementById('dashEscalationsTimeline');
  tl.innerHTML = escs.map(e => `
    <li class="timeline-item">
      <div class="timeline-dot ${e.urgency_level === 'emergency' ? 'red' : 'orange'}">
        <span class="material-icons-outlined">${e.urgency_level === 'emergency' ? 'emergency' : 'warning'}</span>
      </div>
      <div class="timeline-content">
        <div class="timeline-title">${e.patient_name} — ${e.urgency_level.toUpperCase()}</div>
        <div class="timeline-sub">${e.ai_diagnosis || 'Unknown'} · ${e.confidence_percent || 0}% confidence</div>
        <div class="timeline-time">${fmtDate(e.created_at)} · ${e.resolved ? '✅ Resolved' : '🔴 Active'}</div>
      </div>
    </li>
  `).join('');
}

function renderDashPrescriptions(rxs) {
  const tb = document.getElementById('dashPrescTable');
  tb.innerHTML = rxs.map(r => `
    <tr>
      <td>${r.patient_name}</td>
      <td>${r.doctor_name}</td>
      <td>${r.final_diagnosis}</td>
      <td><span class="badge ${r.status==='dispensed'?'badge-dispensed':'badge-issued'}">${r.status}</span></td>
    </tr>
  `).join('');
}

function renderDashFlags() {
  const el = document.getElementById('dashFlags');
  el.innerHTML = DEMO.flags.map(f => `
    <div class="compliance-flag ${f.level === 'red' ? 'red' : ''}">
      <span class="material-icons-outlined compliance-flag-icon">warning</span>
      <div class="compliance-flag-body">
        <div class="compliance-flag-title">${f.title}</div>
        <div class="compliance-flag-desc">${f.desc}</div>
      </div>
    </div>
  `).join('');
}

let _allBookings = [];
function renderAllBookings(bks) {
  _allBookings = bks;
  renderBookingsTable(bks);
}

function renderBookingsTable(bks) {
  const tb = document.getElementById('allBookingsTable');
  if (!bks.length) {
    tb.innerHTML = '<tr><td colspan="9" class="text-muted text-sm" style="text-align:center;padding:24px">No bookings found</td></tr>';
    return;
  }
  tb.innerHTML = bks.map(b => `
    <tr>
      <td><span class="code-badge">${b.booking_code}</span></td>
      <td class="fw-600">${b.patient_name}</td>
      <td class="text-sm">${b.patient_age || '—'}/${b.patient_sex?b.patient_sex[0].toUpperCase():'?'}</td>
      <td class="text-sm">${b.ai_diagnosis || '—'}</td>
      <td>${urgencyBadge(b.urgency_level)}</td>
      <td class="text-sm text-muted">${b.clinic || '—'}</td>
      <td>${statusBadge(b.status)}</td>
      <td class="text-sm text-muted">${fmtDate(b.created_at)}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewBooking('${b.booking_code}')">View</button></td>
    </tr>
  `).join('');
}

function filterBookings(q) {
  const filtered = _allBookings.filter(b =>
    b.booking_code.toLowerCase().includes(q.toLowerCase()) ||
    b.patient_name.toLowerCase().includes(q.toLowerCase())
  );
  renderBookingsTable(filtered);
}

function filterByStatus(status, el) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  currentFilter = status;
  const filtered = status === 'all' ? _allBookings : _allBookings.filter(b => b.status === status);
  renderBookingsTable(filtered);
}

function viewBooking(code) {
  const b = _allBookings.find(x => x.booking_code === code);
  if (!b) return;
  alert(`Booking Detail\n\nCode: ${b.booking_code}\nPatient: ${b.patient_name}\nDiagnosis: ${b.ai_diagnosis}\nUrgency: ${b.urgency_level}\nStatus: ${b.status}`);
}

function renderEscalations(escs) {
  const tb = document.getElementById('escalationsTable');
  tb.innerHTML = escs.map(e => `
    <tr class="escalation-row ${e.urgency_level}">
      <td class="fw-600">${e.patient_name}</td>
      <td>${urgencyBadge(e.urgency_level)}</td>
      <td class="text-sm">${(e.symptoms||[]).slice(0,2).join(', ')}</td>
      <td class="fw-600">${e.ai_diagnosis || '—'}</td>
      <td class="fw-600">${e.confidence_percent || 0}%</td>
      <td class="text-sm text-muted">${e.location_district || '—'}</td>
      <td class="text-sm">${e.action_taken ? e.action_taken.replace('_',' ') : '—'}</td>
      <td class="text-sm text-muted">${fmtDate(e.created_at)}</td>
      <td>${e.resolved ? '<span class="badge badge-completed">Resolved</span>' : '<span class="badge badge-emergency">Active</span>'}</td>
    </tr>
  `).join('');
}

function renderPrescriptions(rxs) {
  const tb = document.getElementById('prescriptionsTable');
  tb.innerHTML = rxs.map((r, i) => `
    <tr>
      <td><span class="code-badge" style="font-size:11px">${r.id || 'RX-' + String(i+1).padStart(3,'0')}</span></td>
      <td class="fw-600">${r.patient_name}</td>
      <td>${r.doctor_name}</td>
      <td class="text-sm text-muted">${r.doctor_license}</td>
      <td class="fw-600">${r.final_diagnosis}</td>
      <td>${r.ai_diagnosis_confirmed ? '<span class="text-green fw-600">✓ Yes</span>' : '<span class="text-orange fw-600">Modified</span>'}</td>
      <td class="text-sm">${Array.isArray(r.drugs) ? r.drugs.map(d=>d.generic_name||d).join(', ') : '—'}</td>
      <td><span class="badge ${r.status==='dispensed'?'badge-dispensed':'badge-issued'}">${r.status}</span></td>
      <td class="text-sm text-muted">${fmtDate(r.created_at)}</td>
    </tr>
  `).join('');
}

function renderClinics(cls) {
  const tb = document.getElementById('clinicsTable');
  tb.innerHTML = cls.map(c => `
    <tr>
      <td class="fw-600">${c.name}</td>
      <td class="text-sm">${c.district||'—'}</td>
      <td class="text-sm">${c.phone||'—'}</td>
      <td class="text-sm text-muted">${c.license_number||'—'}</td>
      <td class="text-sm">${(c.specialties||[]).map(s=>`<span class="tag">${s}</span>`).join('')}</td>
      <td><span class="badge badge-verified">✓ Verified</span></td>
    </tr>
  `).join('');
}

function renderPharmacies(phs) {
  const tb = document.getElementById('pharmaciesTable');
  tb.innerHTML = phs.map(p => `
    <tr>
      <td class="fw-600">${p.name}</td>
      <td class="text-sm">${p.district||'—'}</td>
      <td class="text-sm">${p.phone||'—'}</td>
      <td class="text-sm text-muted">${p.license_number||'—'}</td>
      <td><span class="badge badge-verified">✓ Verified</span></td>
    </tr>
  `).join('');
}

function renderRiders(rds) {
  const tb = document.getElementById('ridersTable');
  tb.innerHTML = rds.map(r => `
    <tr>
      <td class="fw-600">${r.full_name}</td>
      <td class="text-sm">${r.phone}</td>
      <td class="text-sm text-muted">${r.plate_number||'—'}</td>
      <td class="fw-600">${r.total_deliveries}</td>
      <td class="fw-600 text-green">⭐ ${(r.rating||5).toFixed(2)}</td>
      <td>${r.available ? '<span class="badge badge-completed">Available</span>' : '<span class="badge badge-progress">On Delivery</span>'}</td>
    </tr>
  `).join('');
}

function renderComplianceFlags() {
  const el = document.getElementById('complianceFlags');
  el.innerHTML = DEMO.flags.map(f => `
    <div class="compliance-flag ${f.level === 'red' ? 'red' : ''}">
      <span class="material-icons-outlined compliance-flag-icon">warning</span>
      <div class="compliance-flag-body">
        <div class="compliance-flag-title">${f.title}</div>
        <div class="compliance-flag-desc">${f.desc}</div>
        <button class="btn btn-ghost btn-sm mt-16" style="margin-top:8px">Mark Reviewed</button>
      </div>
    </div>
  `).join('');
}

// ── SHOP ORDERS ──────────────────────────────────────────────────────────────

function renderDashShopOrders(orders) {
  const tb = document.getElementById('dashShopOrdersTable');
  if (!tb) return;
  tb.innerHTML = orders.map(o => `
    <tr>
      <td><span class="code-badge">${String(o.id).slice(0,8).toUpperCase()}</span></td>
      <td class="fw-600">${o.product_name}</td>
      <td class="text-sm">${o.quantity}</td>
      <td class="fw-600">UGX ${o.total_price.toLocaleString()}</td>
      <td class="text-sm text-muted">${o.delivery_address||'—'}</td>
      <td>${shopOrderStatusBadge(o.status)}</td>
      <td>
        ${o.status === 'pending'
          ? `<button class="btn btn-ghost btn-sm" onclick="updateShopOrder('${o.id}','processing')">Process</button>`
          : `<span class="text-muted text-sm">—</span>`}
      </td>
    </tr>
  `).join('');
}


let _allShopOrders = [];

function shopOrderStatusBadge(s) {
  const map = {
    pending:    'badge-pending',
    processing: 'badge-progress',
    shipped:    'badge-confirmed',
    delivered:  'badge-dispensed',
    completed:  'badge-completed',
  };
  const labels = {
    pending: 'Pending', processing: 'Processing',
    shipped: 'Shipped', delivered: 'Delivered', completed: 'Completed',
  };
  return `<span class="badge ${map[s]||''}">${labels[s]||s}</span>`;
}

function renderShopOrders(orders) {
  _allShopOrders = orders;
  renderShopOrdersTable(orders);
}

function renderShopOrdersTable(orders) {
  const tb = document.getElementById('shopOrdersTable');
  if (!orders.length) {
    tb.innerHTML = '<tr><td colspan="9" class="text-muted text-sm" style="text-align:center;padding:24px">No shop orders yet</td></tr>';
    return;
  }
  tb.innerHTML = orders.map(o => `
    <tr>
      <td><span class="code-badge">${String(o.id).slice(0,8).toUpperCase()}</span></td>
      <td class="fw-600">${o.product_name}</td>
      <td class="text-sm">${o.quantity}</td>
      <td class="fw-600">UGX ${o.total_price.toLocaleString()}</td>
      <td class="text-sm">${o.contact_phone||'—'}</td>
      <td class="text-sm text-muted">${o.delivery_address||'—'}</td>
      <td>${shopOrderStatusBadge(o.status)}</td>
      <td class="text-sm text-muted">${fmtDate(o.created_at)}</td>
      <td>
        ${o.status === 'pending'
          ? `<button class="btn btn-ghost btn-sm" onclick="updateShopOrder('${o.id}','processing')">Process</button>`
          : ''}
        ${o.status === 'processing'
          ? `<button class="btn btn-ghost btn-sm" onclick="updateShopOrder('${o.id}','shipped')">Mark Shipped</button>`
          : ''}
        ${o.status === 'shipped'
          ? `<button class="btn btn-ghost btn-sm" onclick="updateShopOrder('${o.id}','delivered')">Mark Delivered</button>`
          : ''}
        ${o.status === 'delivered' || o.status === 'completed'
          ? `<span class="text-muted text-sm">—</span>`
          : ''}
      </td>
    </tr>
  `).join('');
}

function filterShopOrders(q) {
  const filtered = _allShopOrders.filter(o =>
    o.product_name.toLowerCase().includes(q.toLowerCase()) ||
    (o.contact_phone||'').includes(q) ||
    (o.delivery_address||'').toLowerCase().includes(q.toLowerCase())
  );
  renderShopOrdersTable(filtered);
}

function filterShopByStatus(status, el) {
  document.querySelectorAll('#page-shop-orders .filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const filtered = status === 'all' ? _allShopOrders : _allShopOrders.filter(o => o.status === status);
  renderShopOrdersTable(filtered);
}

async function updateShopOrder(id, newStatus) {
  if (!confirm(`Mark this order as "${newStatus}"?`)) return;
  if (!isDemoMode) {
    const { error } = await sb
      .from('shop_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) { alert('Could not update order status.'); return; }
  }
  // Update local state
  const idx = _allShopOrders.findIndex(o => o.id === id);
  if (idx !== -1) _allShopOrders[idx].status = newStatus;
  renderShopOrdersTable(_allShopOrders);
  // Refresh badge
  const pending = _allShopOrders.filter(o => o.status === 'pending').length;
  document.getElementById('badgeShopOrders').textContent = pending;
}

// ── INIT ─────────────────────────────────────────────────────────────────────

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    document.getElementById('sUserName').textContent = session.user.email.split('@')[0];
    launchApp();
  }
})();
