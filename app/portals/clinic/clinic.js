/**
 * Homatt Health — Clinic Portal JS
 */

const SUPABASE_URL  = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8';
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

let isDemoMode = false;
let selectedPatient = null;
let drugCount = 0;
let myPrescriptions = [];

const DEMO_QUEUE = [
  {
    booking_code: 'AFH-20260302-4827',
    patient_name: 'Sarah Nalwoga', patient_age: 34, patient_sex: 'female',
    ai_diagnosis: 'Pneumonia', ai_confidence: 78,
    symptoms: ['high fever','chills','cough','chest pain','difficulty breathing'],
    urgency_level: 'urgent', status: 'confirmed',
    created_at: '2026-03-02T08:14:00Z',
  },
  {
    booking_code: 'AFH-20260302-3191',
    patient_name: 'James Okello', patient_age: 28, patient_sex: 'male',
    ai_diagnosis: 'Possible Myocardial Infarction', ai_confidence: 82,
    symptoms: ['severe chest pain','difficulty breathing','sweating','left arm pain'],
    urgency_level: 'emergency', status: 'confirmed',
    created_at: '2026-03-02T07:50:00Z',
  },
  {
    booking_code: 'AFH-20260302-6612',
    patient_name: 'Mary Nakato', patient_age: 45, patient_sex: 'female',
    ai_diagnosis: 'Type 2 Diabetes (worsening)', ai_confidence: 71,
    symptoms: ['increased thirst','frequent urination','blurred vision','fatigue'],
    urgency_level: 'medium', status: 'pending',
    created_at: '2026-03-02T09:30:00Z',
  },
];

const DEMO_RX = [
  { id:'RX-001', patient_name:'Sarah Nalwoga', final_diagnosis:'Pneumonia', ai_diagnosis_confirmed:true, drugs:[{generic_name:'Amoxicillin',strength:'500mg',frequency:'3x daily',duration:'7 days'}], status:'dispensed', created_at:'2026-03-02T10:30:00Z' },
  { id:'RX-002', patient_name:'Grace Atim',    final_diagnosis:'Hypertensive Crisis', ai_diagnosis_confirmed:false, drugs:[{generic_name:'Amlodipine',strength:'5mg',frequency:'1x daily',duration:'30 days'}], status:'issued', created_at:'2026-03-01T17:00:00Z' },
];

// ── AUTH ─────────────────────────────────────────────────────────────────────

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

function doLogout() {
  sb.auth.signOut();
  location.href = '../';
}

function launchApp(user) {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appLayout').style.display   = 'flex';
  const now = new Date();
  document.getElementById('pageDate').textContent =
    now.toLocaleDateString('en-UG', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
  loadData();
}

// ── PAGE NAV ──────────────────────────────────────────────────────────────────

function showPage(name, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.getElementById('pageTitle').textContent =
    { queue:'Patient Queue', scan:'QR Scanner', prescriptions:'My Prescriptions', profile:'My Profile' }[name] || name;
}

// ── DATA ──────────────────────────────────────────────────────────────────────

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

// ── RENDER QUEUE ──────────────────────────────────────────────────────────────

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

  // Store patients for later reference
  window._queuePatients = patients;
}

function openPatient(idx) {
  const p = window._queuePatients[idx];
  if (!p) return;
  selectedPatient = p;

  document.getElementById('patientQueue').style.display = 'none';
  document.getElementById('patientPanel').style.display = 'block';

  // Fill in patient info
  document.getElementById('panelName').textContent    = p.patient_name;
  document.getElementById('panelAgeSex').textContent  = `${p.patient_age||'?'} years / ${p.patient_sex||'Unknown'}`;
  document.getElementById('panelCode').textContent    = p.booking_code;
  document.getElementById('panelTime').textContent    = new Date(p.created_at).toLocaleString('en-UG');
  document.getElementById('panelDiag').textContent    = p.ai_diagnosis;
  document.getElementById('panelConf').textContent    = `Confidence: ${p.ai_confidence||70}%`;
  document.getElementById('finalDiag').value          = p.ai_diagnosis;

  const urgBadge = document.getElementById('panelUrgencyBadge');
  urgBadge.innerHTML = p.urgency_level === 'emergency'
    ? '<span class="badge badge-emergency">🔴 Emergency</span>'
    : p.urgency_level === 'urgent'
    ? '<span class="badge badge-urgent">🟠 Urgent</span>'
    : '<span class="badge badge-confirmed">Medium</span>';

  document.getElementById('panelSymptoms').innerHTML =
    (p.symptoms||[]).map(s=>`<span class="tag">${s}</span>`).join('');

  const riskColors = { low:'badge-completed', medium:'badge-confirmed', high:'badge-urgent', urgent:'badge-urgent', emergency:'badge-emergency' };
  document.getElementById('panelRisk').innerHTML =
    `<span class="badge ${riskColors[p.urgency_level]||'badge-pending'}">${p.urgency_level||'medium'}</span>`;

  // Reset drug builder with one empty row
  drugCount = 0;
  document.getElementById('drugsBuilder').innerHTML = '';
  addDrugRow();

  document.getElementById('aiConfirmed').addEventListener('change', function() {
    document.getElementById('modReasonGroup').style.display = this.value === 'no' ? 'block' : 'none';
  });
}

function closePatient() {
  selectedPatient = null;
  document.getElementById('patientQueue').style.display = 'block';
  document.getElementById('patientPanel').style.display = 'none';
}

// ── DRUG BUILDER ──────────────────────────────────────────────────────────────

function addDrugRow() {
  const id = ++drugCount;
  const row = document.createElement('div');
  row.className = 'drug-builder-row';
  row.id = `drug-${id}`;
  row.innerHTML = `
    <input type="text" class="form-input" placeholder="Drug name (generic)" id="dname-${id}">
    <input type="text" class="form-input" placeholder="Strength" id="dstrength-${id}">
    <input type="text" class="form-input" placeholder="Frequency" id="dfreq-${id}">
    <input type="text" class="form-input" placeholder="Duration" id="ddur-${id}">
    <button class="remove-drug-btn" onclick="removeDrug(${id})"><span class="material-icons-outlined" style="font-size:16px">remove</span></button>
  `;
  document.getElementById('drugsBuilder').appendChild(row);
}

function removeDrug(id) {
  const el = document.getElementById(`drug-${id}`);
  if (el && document.getElementById('drugsBuilder').children.length > 1) {
    el.remove();
  }
}

function getDrugs() {
  const drugs = [];
  document.querySelectorAll('[id^="dname-"]').forEach(el => {
    const id = el.id.replace('dname-','');
    const name = el.value.trim();
    if (!name) return;
    drugs.push({
      generic_name: name,
      strength:     (document.getElementById(`dstrength-${id}`)||{}).value || '',
      frequency:    (document.getElementById(`dfreq-${id}`)||{}).value || '',
      duration:     (document.getElementById(`ddur-${id}`)||{}).value || '',
    });
  });
  return drugs;
}

// ── ISSUE PRESCRIPTION ────────────────────────────────────────────────────────

async function issuePrescription() {
  if (!selectedPatient) return;

  const finalDiag   = document.getElementById('finalDiag').value.trim();
  const aiConfirmed = document.getElementById('aiConfirmed').value === 'yes';
  const modReason   = document.getElementById('modReason').value.trim();
  const docName     = document.getElementById('docName').value.trim();
  const docLicense  = document.getElementById('docLicense').value.trim();
  const specialInstr= document.getElementById('specialInstr').value.trim();
  const drugs       = getDrugs();

  if (!finalDiag) { alert('Please enter the final diagnosis.'); return; }
  if (!docName || !docLicense) { alert('Please enter your name and license number.'); return; }
  if (!drugs.length) { alert('Please add at least one drug.'); return; }

  const now = new Date();
  const rxId = 'RX-' + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + '-' + Math.floor(Math.random()*9000+1000);
  const sig  = `${docName} | ${docLicense} | ${now.toISOString()} | Kampala Medical Center`;

  const rxData = {
    booking_id:              null,
    patient_name:            selectedPatient.patient_name,
    ai_diagnosis_confirmed:  aiConfirmed,
    final_diagnosis:         finalDiag,
    modification_reason:     aiConfirmed ? null : modReason,
    drugs,
    doctor_name:             docName,
    doctor_license:          docLicense,
    clinic_name:             'Kampala Medical Center',
    digital_signature:       sig,
    status:                  'issued',
  };

  if (!isDemoMode) {
    const { error } = await sb.from('doctor_prescriptions').insert(rxData);
    if (error) console.warn('DB insert error:', error.message);
  }

  // Build prescription preview text
  const drugList = drugs.map(d =>
    `  • ${d.generic_name} ${d.strength}\n    ${d.frequency} for ${d.duration}`
  ).join('\n');

  const previewText = `HOMATT HEALTH — E-PRESCRIPTION
${'═'.repeat(40)}
Patient : ${selectedPatient.patient_name}
Age/Sex : ${selectedPatient.patient_age||'?'} / ${selectedPatient.patient_sex||'?'}
Date    : ${now.toLocaleDateString('en-UG', {day:'2-digit',month:'short',year:'numeric'})}
${'─'.repeat(40)}
${aiConfirmed ? 'AI Diagnosis CONFIRMED' : 'AI Diagnosis MODIFIED'}
Initial AI: ${selectedPatient.ai_diagnosis}
Final Dx  : ${finalDiag}
${!aiConfirmed && modReason ? `Reason    : ${modReason}\n` : ''}${'─'.repeat(40)}
MEDICATIONS:
${drugList}
${specialInstr ? `\nInstructions: ${specialInstr}` : ''}
${'─'.repeat(40)}
Doctor    : ${docName}
License   : ${docLicense}
Clinic    : Kampala Medical Center
Signed    : ${now.toISOString()}
${'═'.repeat(40)}
[DIGITALLY SIGNED & TAMPER-PROOF]`;

  document.getElementById('rxPreviewText').textContent = previewText;
  document.getElementById('rxModal').classList.remove('hidden');

  // Add to local list
  myPrescriptions.unshift({ id: rxId, patient_name: selectedPatient.patient_name, final_diagnosis: finalDiag, ai_diagnosis_confirmed: aiConfirmed, drugs, status: 'issued', created_at: now.toISOString() });
  renderRxTable(myPrescriptions);
  closePatient();
}

function closeRxModal() {
  document.getElementById('rxModal').classList.add('hidden');
}

// ── QR SCANNER ────────────────────────────────────────────────────────────────

let scannedPatient = null;

function simulateScan() {
  // Simulate finding the first patient
  const p = (window._queuePatients || DEMO_QUEUE)[0];
  scannedPatient = p;
  document.getElementById('scanSuccess').style.display = 'block';
  document.getElementById('scanPatientName').textContent = p.patient_name;
  document.getElementById('scanDiagnosis').textContent   = `AI: ${p.ai_diagnosis} · ${p.urgency_level.toUpperCase()}`;
}

function manualLookup() {
  const code = document.getElementById('manualCode').value.trim().toUpperCase();
  const patients = window._queuePatients || DEMO_QUEUE;
  const p = patients.find(x => x.booking_code === code);
  if (!p) { alert('No patient found with that booking code.'); return; }
  scannedPatient = p;
  document.getElementById('scanSuccess').style.display = 'block';
  document.getElementById('scanPatientName').textContent = p.patient_name;
  document.getElementById('scanDiagnosis').textContent   = `AI: ${p.ai_diagnosis} · ${p.urgency_level.toUpperCase()}`;
}

function openPatientFromScan() {
  if (!scannedPatient) return;
  const patients = window._queuePatients || DEMO_QUEUE;
  const idx = patients.findIndex(p => p.booking_code === scannedPatient.booking_code);
  showPage('queue', document.querySelector('.nav-item'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector('.nav-item').classList.add('active');
  if (idx >= 0) openPatient(idx);
}

// ── PRESCRIPTIONS TABLE ───────────────────────────────────────────────────────

function renderRxTable(rxs) {
  const tb = document.getElementById('myRxTable');
  tb.innerHTML = rxs.map((r, i) => `
    <tr>
      <td><span class="code-badge" style="font-size:10px">${r.id || 'RX-'+String(i+1).padStart(3,'0')}</span></td>
      <td class="fw-600">${r.patient_name}</td>
      <td>${r.final_diagnosis}</td>
      <td>${r.ai_diagnosis_confirmed ? '<span class="text-green fw-600">✓ Confirmed</span>' : '<span class="text-orange fw-600">Modified</span>'}</td>
      <td class="text-sm">${Array.isArray(r.drugs) ? r.drugs.map(d=>d.generic_name).join(', ') : '—'}</td>
      <td><span class="badge ${r.status==='dispensed'?'badge-dispensed':'badge-issued'}">${r.status}</span></td>
      <td class="text-sm text-muted">${r.created_at ? new Date(r.created_at).toLocaleString('en-UG',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
    </tr>
  `).join('');
}

// ── INIT ──────────────────────────────────────────────────────────────────────

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    launchApp(session.user);
  }
})();
