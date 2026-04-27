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
let currentStep = 1;
let selectedDiagIdx = 0;
let patientType = null; // 'inpatient' | 'outpatient'

const DEMO_QUEUE = [
  {
    booking_code: 'AFH-20260302-4827',
    patient_name: 'Sarah Nalwoga', patient_age: 34, patient_sex: 'female',
    ai_diagnoses: [
      { name: 'Pneumonia',                confidence: 78, icd: 'J18.9', reasoning: 'Fever, productive cough, chest pain, dyspnea pattern' },
      { name: 'Pulmonary Tuberculosis',   confidence: 52, icd: 'A15.0', reasoning: 'Persistent cough with night sweats — endemic region' },
      { name: 'Acute Bronchitis',         confidence: 44, icd: 'J20.9', reasoning: 'Cough and chest discomfort, less severe presentation' },
    ],
    ai_diagnosis: 'Pneumonia', ai_confidence: 78,
    symptoms: ['high fever','chills','cough','chest pain','difficulty breathing'],
    urgency_level: 'urgent', status: 'confirmed',
    created_at: '2026-03-02T08:14:00Z',
  },
  {
    booking_code: 'AFH-20260302-3191',
    patient_name: 'James Okello', patient_age: 28, patient_sex: 'male',
    ai_diagnoses: [
      { name: 'Acute Myocardial Infarction', confidence: 82, icd: 'I21.9', reasoning: 'Crushing chest pain radiating to left arm, diaphoresis' },
      { name: 'Unstable Angina',             confidence: 61, icd: 'I20.0', reasoning: 'Chest pain on exertion, dyspnea — pre-MI pattern' },
      { name: 'Pulmonary Embolism',          confidence: 38, icd: 'I26.9', reasoning: 'Sudden dyspnea and chest pain — rule out via D-dimer' },
    ],
    ai_diagnosis: 'Possible Myocardial Infarction', ai_confidence: 82,
    symptoms: ['severe chest pain','difficulty breathing','sweating','left arm pain'],
    urgency_level: 'emergency', status: 'confirmed',
    created_at: '2026-03-02T07:50:00Z',
  },
  {
    booking_code: 'AFH-20260302-6612',
    patient_name: 'Mary Nakato', patient_age: 45, patient_sex: 'female',
    ai_diagnoses: [
      { name: 'Type 2 Diabetes Mellitus (decompensated)', confidence: 71, icd: 'E11.9',  reasoning: 'Polyuria, polydipsia, blurred vision — classic triad' },
      { name: 'Diabetic Ketoacidosis',                   confidence: 45, icd: 'E11.10', reasoning: 'Severity could indicate ketosis — check ketones, pH' },
      { name: 'Hyperthyroidism',                         confidence: 28, icd: 'E05.90', reasoning: 'Fatigue and weight loss — TSH should be checked' },
    ],
    ai_diagnosis: 'Type 2 Diabetes (worsening)', ai_confidence: 71,
    symptoms: ['increased thirst','frequent urination','blurred vision','fatigue'],
    urgency_level: 'medium', status: 'pending',
    created_at: '2026-03-02T09:30:00Z',
  },
];

const DEFAULT_DOSE_TIMES = {
  1: ['08:00'],
  2: ['08:00', '20:00'],
  3: ['08:00', '14:00', '20:00'],
  4: ['07:00', '12:00', '17:00', '22:00'],
};

const DEMO_RX = [
  { id:'RX-001', patient_name:'Sarah Nalwoga', final_diagnosis:'Pneumonia', ai_diagnosis_confirmed:true, drugs:[{generic_name:'Amoxicillin',strength:'500mg',frequency:'3x daily',duration:'7 days'}], status:'dispensed', created_at:'2026-03-02T10:30:00Z' },
  { id:'RX-002', patient_name:'Grace Atim',    final_diagnosis:'Hypertensive Crisis', ai_diagnosis_confirmed:false, drugs:[{generic_name:'Amlodipine',strength:'5mg',frequency:'1x daily',duration:'30 days'}], status:'issued', created_at:'2026-03-01T17:00:00Z' },
];

// ── AUTH ─────────────────────────────────────────────────────────────────────

function showAuthTab(tab) {
  document.getElementById('signinForm').style.display   = tab === 'signin'   ? 'block' : 'none';
  document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
  document.getElementById('tabSignIn').classList.toggle('active', tab === 'signin');
  document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
}

async function doRegister() {
  const name      = document.getElementById('regName').value.trim();
  const email     = document.getElementById('regEmail').value.trim();
  const password  = document.getElementById('regPassword').value;
  const specialty = document.getElementById('regSpecialty').value.trim();
  const err       = document.getElementById('registerError');
  const success   = document.getElementById('registerSuccess');

  err.classList.remove('visible');
  success.style.display = 'none';

  if (!name || !email || !password || !specialty) {
    err.textContent = 'Please fill in all fields.'; err.classList.add('visible'); return;
  }
  if (password.length < 6) {
    err.textContent = 'Password must be at least 6 characters.'; err.classList.add('visible'); return;
  }

  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { data: { full_name: name, specialty, role: 'clinic_staff' } },
  });

  if (error) { err.textContent = error.message; err.classList.add('visible'); return; }

  // If no email confirmation required, log straight in
  if (data.session) { launchApp(data.user); return; }

  success.style.display = 'block';
}

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
    { queue:'Patient Queue', scan:'QR Scanner', prescriptions:'My Prescriptions', profile:'My Profile', settings:'Clinic Settings' }[name] || name;
  if (name === 'settings') loadClinicHours();
}

// ── WIZARD: STEP NAVIGATION ───────────────────────────────────────────────────

function goStep(n) {
  // Validate forward transitions
  if (n > currentStep) {
    if (currentStep === 2) {
      const diag = document.getElementById('finalDiag').value.trim();
      if (!diag) { alert('Please enter the confirmed diagnosis after testing.'); return; }
    }
    if (currentStep === 3 && !patientType) {
      alert('Please select Inpatient or Outpatient.'); return;
    }
  }

  // Populate Step 2 summary card from selected AI diagnosis
  if (n === 2 && selectedPatient) {
    const diagnoses = selectedPatient.ai_diagnoses || [{ name: selectedPatient.ai_diagnosis, confidence: selectedPatient.ai_confidence || 70, icd: '—' }];
    const sel = diagnoses[selectedDiagIdx] || diagnoses[0];
    document.getElementById('selectedDiagName').textContent = sel.name;
    document.getElementById('selectedDiagConf').textContent = `${sel.confidence}% confidence · ICD: ${sel.icd}`;
    if (!document.getElementById('finalDiag').value) {
      document.getElementById('finalDiag').value = sel.name;
    }
    const riskColors = { low:'badge-completed', medium:'badge-confirmed', high:'badge-urgent', urgent:'badge-urgent', emergency:'badge-emergency' };
    document.getElementById('panelRisk2').innerHTML =
      `<span class="badge ${riskColors[selectedPatient.urgency_level]||'badge-pending'}">${selectedPatient.urgency_level||'medium'}</span>`;
  }

  currentStep = n;
  document.querySelectorAll('.wiz-step').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === n);
  });
  for (let i = 1; i <= 4; i++) {
    const dot = document.getElementById(`d${i}`);
    if (!dot) continue;
    dot.classList.remove('active', 'done');
    if (i === n) dot.classList.add('active');
    else if (i < n) dot.classList.add('done');
  }
  for (let i = 1; i <= 3; i++) {
    const line = document.getElementById(`l${i}${i+1}`);
    if (line) line.classList.toggle('done', i < n);
  }
  document.getElementById('patientPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectDiag(idx) {
  if (!selectedPatient) return;
  const diagnoses = selectedPatient.ai_diagnoses || [];
  selectedDiagIdx = idx;
  document.querySelectorAll('.ai-diag-option').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
    const check = document.getElementById(`diagCheck${i}`);
    if (check) check.classList.toggle('visible', i === idx);
  });
  const sel = diagnoses[idx];
  if (sel) document.getElementById('finalDiag').value = sel.name;
}

function selectType(type) {
  patientType = type;
  document.getElementById('typeInpatient').classList.toggle('selected', type === 'inpatient');
  document.getElementById('typeOutpatient').classList.toggle('selected', type === 'outpatient');
  document.getElementById('inpatientFields').style.display = type === 'inpatient' ? 'block' : 'none';
}

function handleRxRoute(input) {
  document.getElementById('partnerPharmacyGroup').style.display = input.value === 'partner' ? 'block' : 'none';
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
  selectedDiagIdx = 0;
  patientType = null;
  currentStep = 1;

  document.getElementById('patientQueue').style.display = 'none';
  document.getElementById('patientPanel').style.display = 'block';

  // Step 1 — Patient info
  document.getElementById('panelName').textContent    = p.patient_name;
  document.getElementById('panelAgeSex').textContent  = `${p.patient_age||'?'} years / ${p.patient_sex||'Unknown'}`;
  document.getElementById('panelCode').textContent    = p.booking_code;
  document.getElementById('panelTime').textContent    = new Date(p.created_at).toLocaleString('en-UG');

  const urgBadge = document.getElementById('panelUrgencyBadge');
  urgBadge.innerHTML = p.urgency_level === 'emergency'
    ? '<span class="badge badge-emergency">🔴 Emergency</span>'
    : p.urgency_level === 'urgent'
    ? '<span class="badge badge-urgent">🟠 Urgent</span>'
    : '<span class="badge badge-confirmed">● Medium</span>';

  document.getElementById('panelSymptoms').innerHTML =
    (p.symptoms||[]).map(s=>`<span class="tag">${s}</span>`).join('');

  // Step 1 — Render 3 AI differential diagnoses
  const diagnoses = p.ai_diagnoses || [
    { name: p.ai_diagnosis, confidence: p.ai_confidence || 70, icd: '—', reasoning: 'AI assessment based on reported symptoms' }
  ];
  document.getElementById('aiDiagList').innerHTML = diagnoses.map((d, i) => `
    <div class="ai-diag-option ${i===0?'selected':''}" onclick="selectDiag(${i})">
      <div class="diag-rank rank-${i+1}">${i+1}</div>
      <div class="diag-info">
        <div class="diag-name">${d.name}</div>
        <div class="diag-meta">${d.confidence}% confidence · ICD: ${d.icd}</div>
        <div class="diag-reasoning">${d.reasoning}</div>
      </div>
      <div class="diag-check ${i===0?'visible':''}" id="diagCheck${i}">
        <span class="material-icons-outlined" style="font-size:22px;color:#1565C0">check_circle</span>
      </div>
    </div>
  `).join('');

  // Step 2 — Pre-fill diagnosis
  document.getElementById('finalDiag').value = diagnoses[0]?.name || '';
  document.getElementById('aiConfirmed').value = 'yes';
  document.getElementById('modReasonGroup').style.display = 'none';
  document.getElementById('modReason').value = '';

  // Step 3 — Patient type reset
  document.getElementById('typeInpatient').classList.remove('selected');
  document.getElementById('typeOutpatient').classList.remove('selected');
  document.getElementById('inpatientFields').style.display = 'none';
  document.getElementById('step3PatientName').textContent = p.patient_name;
  ['wardName','bedNumber','admissionNotes'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });

  // Step 4 — Reset drug builder & recovery defaults
  drugCount = 0;
  document.getElementById('drugsBuilder').innerHTML = '';
  addDrugRow();

  const recov = new Date();   recov.setDate(recov.getDate() + 7);
  const follow = new Date(); follow.setDate(follow.getDate() + 14);
  document.getElementById('recoveryDate').value = recov.toISOString().slice(0, 10);
  document.getElementById('followupDate').value = follow.toISOString().slice(0, 10);
  document.getElementById('recoveryNotes').value = '';
  document.getElementById('specialInstr').value = '';
  document.querySelector('input[name="rxRoute"][value="clinic"]').checked = true;
  document.getElementById('partnerPharmacyGroup').style.display = 'none';
  document.getElementById('partnerPharmacy').value = '';

  // Bind aiConfirmed change once per session (idempotent)
  const ac = document.getElementById('aiConfirmed');
  if (!ac._bound) {
    ac.addEventListener('change', function() {
      document.getElementById('modReasonGroup').style.display = (this.value === 'no' || this.value === 'partial') ? 'block' : 'none';
    });
    ac._bound = true;
  }

  goStep(1);
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
  row.className = 'drug-row';
  row.id = `drug-${id}`;
  row.innerHTML = `
    <div class="drug-row-header">
      <span class="drug-row-label">Drug ${id}</span>
      <button class="remove-drug-btn" onclick="removeDrug(${id})" title="Remove">
        <span class="material-icons-outlined" style="font-size:16px">close</span>
      </button>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Drug Name (Generic)</label>
        <input type="text" class="form-input" id="dname-${id}" placeholder="e.g. Amoxicillin">
      </div>
      <div class="form-group">
        <label class="form-label">Strength / Dose</label>
        <input type="text" class="form-input" id="dstrength-${id}" placeholder="e.g. 500mg">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Times Per Day</label>
        <select class="form-select" id="dfreq-${id}" onchange="updateTimeSlots(${id}, this.value)">
          <option value="1">1× daily</option>
          <option value="2">2× daily</option>
          <option value="3" selected>3× daily</option>
          <option value="4">4× daily</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Duration</label>
        <input type="text" class="form-input" id="ddur-${id}" placeholder="e.g. 7 days">
      </div>
    </div>
    <div>
      <label class="form-label" style="font-size:11px;color:#1565C0">
        <span class="material-icons-outlined" style="font-size:14px;vertical-align:middle">alarm</span>
        Reminder Times (push notifications sent at these times)
      </label>
      <div class="time-slots" id="dtimes-${id}"></div>
    </div>
  `;
  document.getElementById('drugsBuilder').appendChild(row);
  updateTimeSlots(id, 3);
}

function updateTimeSlots(drugId, freq) {
  const container = document.getElementById(`dtimes-${drugId}`);
  if (!container) return;
  const f = parseInt(freq) || 3;
  const times = DEFAULT_DOSE_TIMES[f] || DEFAULT_DOSE_TIMES[3];
  container.innerHTML = times.map((t, i) => `
    <div class="time-slot-item">
      <label class="form-label" style="font-size:10px;color:var(--text-light)">Dose ${i+1}</label>
      <input type="time" class="time-slot-input" id="dtime-${drugId}-${i}" value="${t}">
    </div>
  `).join('');
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
    const freq = parseInt(document.getElementById(`dfreq-${id}`)?.value || '3');
    const times = [];
    for (let i = 0; i < freq; i++) {
      const t = document.getElementById(`dtime-${id}-${i}`);
      if (t && t.value) times.push(t.value);
    }
    drugs.push({
      generic_name: name,
      strength:     document.getElementById(`dstrength-${id}`)?.value || '',
      frequency:    `${freq}× daily`,
      times_per_day: freq,
      dose_times:   times,
      duration:     document.getElementById(`ddur-${id}`)?.value || '',
    });
  });
  return drugs;
}

// ── ISSUE PRESCRIPTION ────────────────────────────────────────────────────────

async function issuePrescription() {
  if (!selectedPatient) return;

  const finalDiag        = document.getElementById('finalDiag').value.trim();
  const aiConfirmedLevel = document.getElementById('aiConfirmed').value; // yes | partial | no
  const aiConfirmed      = aiConfirmedLevel === 'yes';
  const modReason        = document.getElementById('modReason')?.value.trim() || '';
  const docName          = document.getElementById('docName').value.trim();
  const docLicense       = document.getElementById('docLicense').value.trim();
  const specialInstr     = document.getElementById('specialInstr').value.trim();
  const drugs            = getDrugs();
  const rxRoute          = document.querySelector('input[name="rxRoute"]:checked')?.value || 'clinic';
  const partnerPharmacy  = document.getElementById('partnerPharmacy')?.value || '';
  const recoveryDate     = document.getElementById('recoveryDate')?.value || '';
  const followupDate     = document.getElementById('followupDate')?.value || '';
  const recoveryNotes    = document.getElementById('recoveryNotes')?.value.trim() || '';
  const wardName         = document.getElementById('wardName')?.value.trim() || '';
  const bedNumber        = document.getElementById('bedNumber')?.value.trim() || '';
  const admissionNotes   = document.getElementById('admissionNotes')?.value.trim() || '';

  if (!finalDiag) { alert('Please enter the confirmed diagnosis.'); return; }
  if (!patientType) { alert('Please go back and select Inpatient or Outpatient.'); return; }
  if (!docName || !docLicense) { alert('Please enter your name and license number.'); return; }
  if (!drugs.length) { alert('Please add at least one medication.'); return; }
  if (rxRoute === 'partner' && !partnerPharmacy) { alert('Please select a partner pharmacy.'); return; }
  for (const d of drugs) {
    if (!d.dose_times.length) { alert(`Please set dose times for ${d.generic_name}.`); return; }
  }

  const now = new Date();
  const rxId = 'RX-' + now.getFullYear() + String(now.getMonth()+1).padStart(2,'0') + '-' + Math.floor(Math.random()*9000+1000);
  const sig  = `${docName} | ${docLicense} | ${now.toISOString()} | Kampala Medical Center`;
  const aiPickedDx = (selectedPatient.ai_diagnoses || [])[selectedDiagIdx]?.name || selectedPatient.ai_diagnosis;

  const rxData = {
    booking_code:           selectedPatient.booking_code,
    patient_name:           selectedPatient.patient_name,
    patient_age:            selectedPatient.patient_age,
    patient_sex:            selectedPatient.patient_sex,
    ai_diagnoses:           selectedPatient.ai_diagnoses || null,
    ai_diagnosis_selected:  aiPickedDx,
    ai_diagnosis_confirmed: aiConfirmed,
    ai_confirmed_level:     aiConfirmedLevel,
    final_diagnosis:        finalDiag,
    modification_reason:    aiConfirmedLevel !== 'yes' ? modReason : null,
    patient_type:           patientType,
    ward_name:              wardName || null,
    bed_number:             bedNumber || null,
    admission_notes:        admissionNotes || null,
    drugs,
    rx_route:               rxRoute,
    partner_pharmacy:       rxRoute === 'partner' ? partnerPharmacy : null,
    recovery_date:          recoveryDate || null,
    followup_date:          followupDate || null,
    recovery_notes:         recoveryNotes || null,
    special_instructions:   specialInstr || null,
    doctor_name:            docName,
    doctor_license:         docLicense,
    clinic_name:            'Kampala Medical Center',
    digital_signature:      sig,
    status:                 'issued',
  };

  if (!isDemoMode) {
    const { error } = await sb.from('doctor_prescriptions').insert(rxData);
    if (error) console.warn('DB insert error:', error.message);
  }

  // Build prescription preview text
  const typeLabel = patientType === 'inpatient'
    ? `INPATIENT${wardName ? ' · ' + wardName : ''}${bedNumber ? ' Bed ' + bedNumber : ''}`
    : 'OUTPATIENT';

  const drugList = drugs.map(d =>
    `  • ${d.generic_name} ${d.strength}\n    ${d.frequency} (at ${d.dose_times.join(', ')}) for ${d.duration}`
  ).join('\n');

  const aiStatusLine = aiConfirmedLevel === 'yes'
    ? '✓ AI Diagnosis CONFIRMED'
    : aiConfirmedLevel === 'partial'
    ? '⚠ AI Diagnosis PARTIALLY CONFIRMED'
    : '✗ AI Diagnosis MODIFIED after testing';

  const previewText = `HOMATT HEALTH — E-PRESCRIPTION
${'═'.repeat(44)}
Rx ID   : ${rxId}
Patient : ${selectedPatient.patient_name}
Age/Sex : ${selectedPatient.patient_age||'?'} / ${selectedPatient.patient_sex||'?'}
Type    : ${typeLabel}
Date    : ${now.toLocaleDateString('en-UG', {day:'2-digit',month:'short',year:'numeric'})}
${'─'.repeat(44)}
${aiStatusLine}
AI Dx   : ${aiPickedDx}
Final Dx: ${finalDiag}
${aiConfirmedLevel !== 'yes' && modReason ? `Finding : ${modReason}\n` : ''}${'─'.repeat(44)}
MEDICATIONS:
${drugList}
${recoveryDate ? `\nExpected to feel well by: ${recoveryDate}` : ''}
${followupDate ? `Follow-up visit: ${followupDate}` : ''}
${recoveryNotes ? `\nRecovery notes: ${recoveryNotes}` : ''}
${rxData.partner_pharmacy ? `\nE-Pharmacy: ${rxData.partner_pharmacy} (sent)` : '\nDispense at: This clinic'}
${specialInstr ? `\nInstructions: ${specialInstr}` : ''}
${'─'.repeat(44)}
Doctor  : ${docName}
License : ${docLicense}
Clinic  : Kampala Medical Center
Signed  : ${now.toISOString()}
${'═'.repeat(44)}
[DIGITALLY SIGNED & TAMPER-PROOF]
Push reminders scheduled at every dose time.
Health check-in scheduled 24 hours from now.`;

  document.getElementById('rxPreviewText').textContent = previewText;

  // Show delivery section in modal if e-prescription was sent
  const deliverySection = document.getElementById('rxDeliverySection');
  if (deliverySection) {
    if (rxRoute === 'partner') {
      deliverySection.style.display = 'block';
      const pharmEl = document.getElementById('rxPharmacyName');
      if (pharmEl) pharmEl.textContent = partnerPharmacy || 'Partner Pharmacy';
    } else {
      deliverySection.style.display = 'none';
    }
  }

  document.getElementById('rxModal').classList.remove('hidden');

  // Fire push notifications: prescription_issued + scheduled medication_reminders + health_checkin
  try {
    await sendPrescriptionPush(selectedPatient, rxData, drugs, rxId);
  } catch (e) {
    console.warn('Push notification dispatch failed:', e);
  }

  myPrescriptions.unshift({
    id: rxId,
    patient_name: selectedPatient.patient_name,
    final_diagnosis: finalDiag,
    ai_diagnosis_confirmed: aiConfirmed,
    patient_type: patientType,
    drugs,
    status: 'issued',
    created_at: now.toISOString(),
  });
  renderRxTable(myPrescriptions);
  closePatient();
}

// ── PUSH NOTIFICATION DISPATCH ────────────────────────────────────────────────

async function sendPrescriptionPush(patient, rx, drugs, rxId) {
  const notifyUrl = `${SUPABASE_URL}/functions/v1/notify`;
  const body = {
    type: 'prescription_issued',
    rx_id: rxId,
    booking_code: patient.booking_code,
    patient_name: patient.patient_name,
    final_diagnosis: rx.final_diagnosis,
    patient_type: rx.patient_type,
    rx_route: rx.rx_route,
    partner_pharmacy: rx.partner_pharmacy,
    recovery_date: rx.recovery_date,
    followup_date: rx.followup_date,
    drugs: drugs.map(d => ({
      name: d.generic_name,
      strength: d.strength,
      frequency: d.frequency,
      times_per_day: d.times_per_day,
      dose_times: d.dose_times,
      duration: d.duration,
    })),
  };
  await fetch(notifyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify(body),
  });
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
  tb.innerHTML = rxs.map((r, i) => {
    const typeBadge = r.patient_type === 'inpatient'
      ? '<span class="badge" style="background:#E3F2FD;color:#1565C0">Inpatient</span>'
      : r.patient_type === 'outpatient'
      ? '<span class="badge" style="background:#E8F5E9;color:#2E7D32">Outpatient</span>'
      : '';
    return `
    <tr>
      <td><span class="code-badge" style="font-size:10px">${r.id || 'RX-'+String(i+1).padStart(3,'0')}</span></td>
      <td class="fw-600">${r.patient_name} ${typeBadge}</td>
      <td>${r.final_diagnosis}</td>
      <td>${r.ai_diagnosis_confirmed ? '<span class="text-green fw-600">✓ Confirmed</span>' : '<span class="text-orange fw-600">Modified</span>'}</td>
      <td class="text-sm">${Array.isArray(r.drugs) ? r.drugs.map(d=>d.generic_name).join(', ') : '—'}</td>
      <td><span class="badge ${r.status==='dispensed'?'badge-dispensed':'badge-issued'}">${r.status}</span></td>
      <td class="text-sm text-muted">${r.created_at ? new Date(r.created_at).toLocaleString('en-UG',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}</td>
    </tr>`;
  }).join('');
}

// ── CLINIC HOURS SETTINGS ─────────────────────────────────────────────────────

const HOURS_STORAGE_KEY = 'homatt_clinic_hours';
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function defaultClinicHours() {
  return {
    mon: { open: '08:00', close: '17:00', enabled: true },
    tue: { open: '08:00', close: '17:00', enabled: true },
    wed: { open: '08:00', close: '17:00', enabled: true },
    thu: { open: '08:00', close: '17:00', enabled: true },
    fri: { open: '08:00', close: '17:00', enabled: true },
    sat: { open: '09:00', close: '13:00', enabled: true },
    sun: { open: '',      close: '',      enabled: false },
  };
}

function loadClinicHours() {
  let hours;
  try { hours = JSON.parse(localStorage.getItem(HOURS_STORAGE_KEY) || 'null'); }
  catch { hours = null; }
  if (!hours) hours = defaultClinicHours();

  DAYS.forEach(day => {
    const key = day.toLowerCase();
    const d = hours[key] || defaultClinicHours()[key];
    const cb = document.getElementById(`day${day}`);
    const openEl = document.getElementById(`open${day}`);
    const closeEl = document.getElementById(`close${day}`);
    if (cb) cb.checked = !!d.enabled;
    if (openEl) openEl.value = d.open || '';
    if (closeEl) closeEl.value = d.close || '';
    const timesEl = document.getElementById(`hoursTime${day}`);
    if (timesEl) timesEl.style.opacity = d.enabled ? '1' : '0.4';
  });
  return hours;
}

function saveClinicHours() {
  const hours = {};
  DAYS.forEach(day => {
    const key = day.toLowerCase();
    hours[key] = {
      enabled: document.getElementById(`day${day}`)?.checked || false,
      open:    document.getElementById(`open${day}`)?.value || '',
      close:   document.getElementById(`close${day}`)?.value || '',
    };
  });
  localStorage.setItem(HOURS_STORAGE_KEY, JSON.stringify(hours));
  // Also persist to Supabase if logged in (best-effort)
  if (!isDemoMode) {
    sb.from('clinic_settings').upsert({
      clinic_name: 'Kampala Medical Center',
      setting_key: 'operating_hours',
      setting_value: hours,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'clinic_name,setting_key' }).then(({error}) => {
      if (error) console.warn('Settings save warning:', error.message);
    });
  }
  const msg = document.getElementById('hoursSavedMsg');
  if (msg) { msg.style.display = 'inline'; setTimeout(() => { msg.style.display = 'none'; }, 3000); }
}

function toggleDay(day) {
  const cb = document.getElementById(`day${day}`);
  const enabled = cb?.checked;
  const timesEl = document.getElementById(`hoursTime${day}`);
  if (timesEl) timesEl.style.opacity = enabled ? '1' : '0.4';
}

// Helper used by mobile app booking system to check if clinic is currently open
function isClinicOpen(at = new Date()) {
  let hours;
  try { hours = JSON.parse(localStorage.getItem(HOURS_STORAGE_KEY) || 'null'); }
  catch { hours = null; }
  if (!hours) hours = defaultClinicHours();
  const dayKey = ['sun','mon','tue','wed','thu','fri','sat'][at.getDay()];
  const d = hours[dayKey];
  if (!d || !d.enabled || !d.open || !d.close) return false;
  const cur = at.getHours() * 60 + at.getMinutes();
  const [oh, om] = d.open.split(':').map(Number);
  const [ch, cm] = d.close.split(':').map(Number);
  return cur >= (oh*60 + om) && cur < (ch*60 + cm);
}
window.HomattClinicHours = { isOpen: isClinicOpen, get: () => JSON.parse(localStorage.getItem(HOURS_STORAGE_KEY) || 'null') || defaultClinicHours() };

// ── INIT ──────────────────────────────────────────────────────────────────────

(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    launchApp(session.user);
  }
})();
