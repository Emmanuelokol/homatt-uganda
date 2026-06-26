/**
 * Homatt Health — Clinic Portal JS
 */

const SUPABASE_URL  = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57j[...]';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let isDemoMode = false;
let selectedPatient = null;
let myPrescriptions = [];

const DEMO_QUEUE = [
  {
    booking_code: 'AFH-20260302-4827',
    patient_name: 'Sarah Nalwoga', patient_age: 34, patient_sex: 'female',
    ai_diagnosis: 'Pneumonia', ai_confidence: 78,
    symptoms: ['high fever','chills','cough','chest pain'],
    urgency_level: 'urgent', status: 'confirmed',
    created_at: '2026-03-02T08:14:00Z',
  },
  {
    booking_code: 'AFH-20260302-3191',
    patient_name: 'James Okello', patient_age: 28, patient_sex: 'male',
    ai_diagnosis: 'Possible MI', ai_confidence: 82,
    symptoms: ['severe chest pain','sweating'],
    urgency_level: 'emergency', status: 'confirmed',
    created_at: '2026-03-02T07:50:00Z',
  },
  {
    booking_code: 'AFH-20260302-6612',
    patient_name: 'Mary Nakato', patient_age: 45, patient_sex: 'female',
    ai_diagnosis: 'Type 2 Diabetes', ai_confidence: 71,
    symptoms: ['increased thirst','frequent urination'],
    urgency_level: 'medium', status: 'pending',
    created_at: '2026-03-02T09:30:00Z',
  },
];

const DEMO_RX = [
  { id:'RX-001', patient_name:'Sarah Nalwoga', status:'issued', created_at:'2026-03-02T10:00:00Z' },
  { id:'RX-002', patient_name:'Grace Atim', status:'dispensed', created_at:'2026-03-02T09:45:00Z' },
];

// AUTH

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (error) {
    document.getElementById('loginError').classList.add('visible');
    return;
  }
  launchApp(data.user);
}

function enterDemo() {
  isDemoMode = true;
  launchApp(null);
}

function backToLogin() {
  document.getElementById('appLayout').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'block';
  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('loginError').classList.remove('visible');
  isDemoMode = false;
}

function launchApp(user) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appLayout').style.display   = 'flex';
  const now = new Date();
  document.getElementById('pageDate').textContent =
    now.toLocaleDateString('en-UG', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  loadData();
}

// PAGE NAV

function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('pageTitle').textContent =
    { queue:'Patient Queue', scan:'QR Scanner', prescriptions:'My Prescriptions', profile:'My Profile' }[name] || name;
}

// DATA

async function loadData() {
  let queue, rxs;
  if (isDemoMode) {
    queue = DEMO_QUEUE;
    rxs   = DEMO_RX;
  } else {
    const [q, r] = await Promise.all([
      sb.from('bookings').select('*').in('status',['pending','confirmed']).order('created_at', { ascending: false }),
      sb.from('doctor_prescriptions').select('*').order('created_at', { ascending: false }).limit(20),
    ]);
    queue = q.data?.length ? q.data : DEMO_QUEUE;
    rxs   = r.data?.length ? r.data : DEMO_RX;
  }
  myPrescriptions = rxs;
  renderQueue(queue);
  renderRxTable(rxs);
  document.getElementById('qPending').textContent = queue.filter(p => p.status !== 'completed').length;
}

// RENDER QUEUE

function renderQueue(patients) {
  const el = document.getElementById('patientQueue');
  if (!patients.length) {
    el.innerHTML = '<div class="empty-state"><span class="material-icons-outlined">check_circle</span><p>No patients in queue</p></div>';
    return;
  }
  el.innerHTML = patients.map((p, i) => {
    const initials = p.patient_name.split(' ').map(n=>n[0]).join('').slice(0,2).toUpperCase();
    const isUrgent = p.urgency_level === 'emergency' || p.urgency_level === 'urgent';
    return `
      <div class="patient-card ${isUrgent?'priority':''}" onclick="openPatient(${i})" data-idx="${i}">
        <div class="patient-avatar">${initials}</div>
        <div class="patient-info">
          <div class="patient-name">${p.patient_name}
            ${isUrgent ? `<span class="urgent-flag"><span class="material-icons-outlined" style="font-size:11px">emergency</span>${p.urgency_level.toUpperCase()}</span>` : ''}
          </div>
          <div class="patient-meta">${p.patient_age||'?'}${p.patient_sex?'/'+p.patient_sex[0].toUpperCase():''} · AI: ${p.ai_diagnosis}</div>
          <div class="patient-time">${new Date(p.created_at).toLocaleTimeString('en-UG',{hour:'2-digit',minute:'2-digit'})} · <span class="code-badge" style="font-size:10px">${p.booking_code}</span></div>
        </div>
        <div>
          <span class="badge ${p.status==='confirmed'?'badge-confirmed':'badge-pending'}">${p.status}</span>
        </div>
      </div>
    `;
  }).join('');
  window._queuePatients = patients;
}

function openPatient(idx) {
  const p = window._queuePatients[idx];
  if (!p) return;
  selectedPatient = p;
  alert(`Selected: ${p.patient_name}\n\nAI Diagnosis: ${p.ai_diagnosis}\nConfidence: ${p.ai_confidence}%\n\n(Patient detail view would open here in full version)`);
}

// QR SCANNER

let scannedPatient = null;

function simulateScan() {
  const p = (window._queuePatients || DEMO_QUEUE)[0];
  scannedPatient = p;
  document.getElementById('scanSuccess').style.display = 'block';
  document.getElementById('scanPatientName').textContent = p.patient_name;
}

// PRESCRIPTIONS TABLE

function renderRxTable(rxs) {
  const tb = document.getElementById('myRxTable');
  tb.innerHTML = rxs.map((r, i) => `
    <tr>
      <td><span class="code-badge" style="font-size:10px">${r.id || 'RX-'+String(i+1).padStart(3,'0')}</span></td>
      <td class="fw-600">${r.patient_name}</td>
      <td><span class="badge ${r.status==='dispensed'?'badge-dispensed':'badge-issued'}">${r.status}</span></td>
      <td class="text-sm text-muted">${r.created_at ? new Date(r.created_at).toLocaleString('en-UG',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
    </tr>
  `).join('');
}

// INIT

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    launchApp(session.user);
  }
})();
