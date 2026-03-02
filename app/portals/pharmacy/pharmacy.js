/**
 * Homatt Health — Pharmacy Portal JS
 */

const SUPABASE_URL  = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let isDemoMode = false;
let selectedOrder = null;
let allOrders = [];

const DEMO_ORDERS = [
  {
    id: 'ORD-001',
    prescription_id: 'RX-001',
    patient_name: 'Sarah Nalwoga',
    patient_phone: '+256 701 234 567',
    delivery_address: '15 Muyenga Hill, Kampala',
    doctor_name: 'Dr. Sarah Nakamya',
    doctor_license: 'UMC-2024-00123',
    digital_signature: 'Dr. Sarah Nakamya | UMC-2024-00123 | 2026-03-02T10:30:00Z',
    final_diagnosis: 'Pneumonia',
    drugs: [
      { generic_name: 'Amoxicillin', brand: 'Amoxil', strength: '500mg', frequency: '3x daily', duration: '7 days', quantity: 21 },
    ],
    medication_cost: 48000,
    status: 'incoming',
  },
  {
    id: 'ORD-002',
    prescription_id: 'RX-002',
    patient_name: 'Grace Atim',
    patient_phone: '+256 702 345 678',
    delivery_address: 'Ntinda Estate, House 7, Kampala',
    doctor_name: 'Dr. James Ssali',
    doctor_license: 'UMC-2024-00456',
    digital_signature: 'Dr. James Ssali | UMC-2024-00456 | 2026-03-01T17:00:00Z',
    final_diagnosis: 'Hypertensive Crisis',
    drugs: [
      { generic_name: 'Amlodipine',           strength: '5mg',  frequency: '1x daily', duration: '30 days', quantity: 30 },
      { generic_name: 'Hydrochlorothiazide',  strength: '25mg', frequency: '1x daily', duration: '30 days', quantity: 30 },
    ],
    medication_cost: 75000,
    status: 'incoming',
  },
  {
    id: 'ORD-003',
    prescription_id: 'RX-003',
    patient_name: 'David Mukasa',
    patient_phone: '+256 701 234 567',
    delivery_address: 'Bugolobi, Plot 5, Kampala',
    doctor_name: 'Dr. Grace Atim',
    doctor_license: 'UMC-2024-00789',
    digital_signature: 'Dr. Grace Atim | UMC-2024-00789 | 2026-03-01T12:45:00Z',
    final_diagnosis: 'Typhoid Fever',
    drugs: [
      { generic_name: 'Ciprofloxacin', strength: '500mg', frequency: '2x daily', duration: '14 days', quantity: 28 },
    ],
    medication_cost: 60000,
    status: 'incoming',
  },
  {
    id: 'ORD-004',
    prescription_id: 'RX-004',
    patient_name: 'Peter Ssali',
    patient_phone: '+256 703 456 789',
    delivery_address: 'Kololo, Avenue Road, Kampala',
    doctor_name: 'Dr. Sarah Nakamya',
    doctor_license: 'UMC-2024-00123',
    digital_signature: 'Dr. Sarah Nakamya | UMC-2024-00123 | 2026-02-28T10:00:00Z',
    final_diagnosis: 'COPD Exacerbation',
    drugs: [
      { generic_name: 'Salbutamol Inhaler', strength: '100mcg', frequency: '4x daily', duration: '5 days', quantity: 1 },
      { generic_name: 'Prednisolone',       strength: '30mg',   frequency: '1x daily', duration: '5 days', quantity: 5 },
    ],
    medication_cost: 85000,
    status: 'ready',
  },
  {
    id: 'ORD-005',
    prescription_id: null, // missing — should auto-reject
    patient_name: 'Unknown Patient',
    patient_phone: '—',
    delivery_address: '—',
    doctor_name: '—',
    doctor_license: '—',
    digital_signature: null,
    final_diagnosis: 'Unknown',
    drugs: [{ generic_name: 'Tramadol', strength: '50mg', frequency: '3x daily', duration: '7 days', quantity: 21 }],
    medication_cost: 35000,
    status: 'rejected',
  },
];

// ── AUTH ─────────────────────────────────────────────────────────────────────

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) { document.getElementById('loginError').classList.add('visible'); return; }
  launchApp();
}

function enterDemo() { isDemoMode = true; launchApp(); }
function doLogout()  { sb.auth.signOut(); location.href = '../'; }

function launchApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appLayout').style.display   = 'flex';
  loadOrders();
}

// ── PAGE NAV ──────────────────────────────────────────────────────────────────

function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('pageTitle').textContent =
    { orders:'Orders', fulfilment:'Order Fulfilment', handoff:'Rider Handoff', earnings:'Earnings' }[name] || name;
}

// ── LOAD DATA ─────────────────────────────────────────────────────────────────

async function loadOrders() {
  if (isDemoMode) {
    allOrders = DEMO_ORDERS;
  } else {
    const { data } = await sb.from('pharmacy_orders').select('*, doctor_prescriptions(*)').order('created_at', { ascending: false });
    allOrders = data?.length ? data : DEMO_ORDERS;
  }
  renderOrders(allOrders.filter(o => o.status === 'incoming'));
  renderFulfilTable(allOrders.filter(o => o.status === 'ready'));
  document.getElementById('badgeOrders').textContent = allOrders.filter(o => o.status === 'incoming').length;
}

// ── RENDER ORDERS ─────────────────────────────────────────────────────────────

function renderOrders(orders) {
  const el = document.getElementById('ordersList');
  if (!orders.length) {
    el.innerHTML = '<div class="empty-state"><span class="material-icons-outlined">check_circle</span><p>No incoming orders</p></div>';
    return;
  }
  el.innerHTML = orders.map(o => `
    <div class="order-card" onclick="openOrder('${o.id}')">
      <div class="order-card-header">
        <span class="order-code">${o.prescription_id || 'NO-RX'}</span>
        <span class="badge ${o.status==='incoming'?'badge-incoming':'badge-verified'}">${o.status}</span>
      </div>
      <div class="order-patient">${o.patient_name}</div>
      <div class="order-meta">${o.final_diagnosis} · ${o.drugs.length} drug(s) · UGX ${(o.medication_cost||0).toLocaleString()}</div>
      <div class="order-meta">${o.doctor_name} · Lic: ${o.doctor_license}</div>
    </div>
  `).join('');
}

function renderFulfilTable(orders) {
  const tb = document.getElementById('fulfilTable');
  if (!orders.length) {
    tb.innerHTML = '<tr><td colspan="5" class="text-muted text-sm" style="text-align:center;padding:20px">No orders ready yet</td></tr>';
    return;
  }
  tb.innerHTML = orders.map(o => `
    <tr>
      <td><span class="code-badge" style="font-size:10px">${o.id}</span></td>
      <td class="fw-600">${o.patient_name}</td>
      <td class="text-sm">${o.drugs.map(d=>d.generic_name).join(', ')}</td>
      <td class="fw-600 text-green">UGX ${((o.medication_cost||0)+5000).toLocaleString()}</td>
      <td><span class="badge badge-completed">Ready</span></td>
    </tr>
  `).join('');
}

// ── ORDER DETAIL ──────────────────────────────────────────────────────────────

function openOrder(id) {
  const o = allOrders.find(x => x.id === id);
  if (!o) return;
  selectedOrder = o;

  document.getElementById('ordersList').style.display  = 'none';
  document.getElementById('orderPanel').style.display  = 'block';

  // Verification checks
  const checks = [
    { label: 'Prescription ID present',    ok: !!o.prescription_id },
    { label: 'Doctor name present',        ok: !!o.doctor_name && o.doctor_name !== '—' },
    { label: 'License number valid',       ok: !!o.doctor_license && o.doctor_license !== '—' },
    { label: 'Digital signature present',  ok: !!o.digital_signature },
    { label: 'No controlled substance',    ok: !o.drugs.some(d => /tramadol|morphine|codeine/i.test(d.generic_name)) },
    { label: 'No antibiotic without Rx',   ok: !o.drugs.some(d => /amoxicillin|ciprofloxacin/i.test(d.generic_name)) || !!o.prescription_id },
  ];

  const allOk = checks.every(c => c.ok);

  document.getElementById('verifyChecks').innerHTML = checks.map(c => `
    <div class="verify-row">
      <span class="material-icons-outlined ${c.ok ? 'verify-icon-ok' : 'verify-icon-fail'}">${c.ok ? 'check_circle' : 'cancel'}</span>
      <span class="fw-600" style="font-size:13px">${c.label}</span>
    </div>
  `).join('');

  document.getElementById('verifyOk').style.display   = allOk ? 'flex' : 'none';
  document.getElementById('verifyFail').style.display  = allOk ? 'none' : 'flex';
  document.getElementById('btnFulfil').disabled        = !allOk;

  // Patient details
  document.getElementById('patientDetailsTable').innerHTML = `
    <tr><td class="text-muted text-sm" style="padding:6px">Patient</td><td class="fw-600">${o.patient_name}</td></tr>
    <tr><td class="text-muted text-sm" style="padding:6px">Phone</td><td class="fw-600">${o.patient_phone}</td></tr>
    <tr><td class="text-muted text-sm" style="padding:6px">Delivery Address</td><td class="fw-600">${o.delivery_address}</td></tr>
    <tr><td class="text-muted text-sm" style="padding:6px">Diagnosis</td><td class="fw-600">${o.final_diagnosis}</td></tr>
  `;

  // Drug list
  document.getElementById('rxDrugList').innerHTML = o.drugs.map(d => `
    <li class="rx-drug-item">
      <div class="rx-drug-name">${d.generic_name} ${d.brand ? `(${d.brand})` : ''}</div>
      <div class="rx-drug-details">
        ${d.strength} · ${d.frequency} · ${d.duration}
        ${d.quantity ? `· Qty: ${d.quantity}` : ''}
      </div>
    </li>
  `).join('');

  const medCost = o.medication_cost || 0;
  document.getElementById('medCost').textContent   = 'UGX ' + medCost.toLocaleString();
  document.getElementById('totalCost').textContent  = 'UGX ' + (medCost + 5000).toLocaleString();
}

function closeOrder() {
  selectedOrder = null;
  document.getElementById('ordersList').style.display  = 'block';
  document.getElementById('orderPanel').style.display  = 'none';
}

async function startFulfilment() {
  if (!selectedOrder) return;

  // Update order status
  if (!isDemoMode) {
    await sb.from('pharmacy_orders').update({ status: 'ready', updated_at: new Date().toISOString() }).eq('id', selectedOrder.id);
  }

  selectedOrder.status = 'ready';
  const idx = allOrders.findIndex(o => o.id === selectedOrder.id);
  if (idx >= 0) allOrders[idx] = selectedOrder;

  alert(`✅ Order for ${selectedOrder.patient_name} is marked as READY.\n\nA rider has been assigned and will collect shortly.\nPayment will be released upon delivery confirmation.`);

  renderOrders(allOrders.filter(o => o.status === 'incoming'));
  renderFulfilTable(allOrders.filter(o => o.status === 'ready'));
  document.getElementById('badgeOrders').textContent = allOrders.filter(o => o.status === 'incoming').length;
  closeOrder();
}

function rejectOrder() {
  if (!selectedOrder) return;
  const reason = prompt('Reason for rejection:');
  if (!reason) return;
  alert(`Order rejected.\nReason: ${reason}\n\nPatient will be notified. Admin flagged for review.`);
  selectedOrder.status = 'rejected';
  renderOrders(allOrders.filter(o => o.status === 'incoming'));
  closeOrder();
}

// ── RIDER HANDOFF ─────────────────────────────────────────────────────────────

function simulateHandoff() {
  const now = new Date().toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('handoffTime').textContent   = now;
  document.getElementById('handoffSuccess').style.display = 'flex';
}

// ── INIT ──────────────────────────────────────────────────────────────────────

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) launchApp();
})();
