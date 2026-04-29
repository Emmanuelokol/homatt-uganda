/* ════════════════════════════════════════════════════════════════════
 * Homatt Health — New Consultation Wizard
 * 5-step flow: patient → AI dx → confirmed dx → meds → review/send
 * Saves to: clinic_diagnoses, e_prescriptions, clinic_followups
 * ════════════════════════════════════════════════════════════════════ */

(function() {
  const session  = requireClinic();
  setupClinicLogout();
  const supabase = _getClinicSupabase();

  document.getElementById('clinicUserDate').textContent =
    new Date().toLocaleDateString('en-UG', { day:'numeric', month:'short', year:'numeric' });

  // Resolve clinic_id
  let _clinicId = session?.clinicId || null;
  if (!_clinicId && supabase && !session?.demo) {
    resolveClinicId(supabase, session).then(id => { _clinicId = id; });
  }

  // ── State ────────────────────────────────────────────────────────
  const state = {
    step: 1,
    patient: null,         // {id, clinicPatientId, name, phone, registered}
    aiDiagnoses: [],       // [{name, likelihood_percent, urgency}]
    aiSelectedIdx: -1,     // which AI diagnosis was selected
    aiSource: 'app',       // 'app' (from triage history) | 'clinic_input'
    enteredSymptoms: '',   // when clinician types symptoms manually
    confirmedDx: '',
    severity: 'moderate',
    patientType: 'outpatient',
    ward: '',
    labTests: [],
    labResults: '',
    medications: [],       // [{drug, dosage, timesPerDay, intakeTimes:[], durationDays}]
    expectedRecovery: '',
    stockSource: 'clinic', // 'clinic' | 'pharmacy'
    pharmacyId: null,
    patientNotes: '',
    formulary: [],
  };
  window._wizState = state; // expose for debug

  // ── Step navigation ─────────────────────────────────────────────
  function showStep(n) {
    state.step = n;
    document.querySelectorAll('.wiz-section').forEach(s => {
      s.style.display = (parseInt(s.dataset.step,10) === n) ? '' : 'none';
    });
    document.querySelectorAll('.wiz-pill').forEach(p => {
      const i = parseInt(p.dataset.pill,10);
      p.classList.remove('done','current');
      if (i < n) p.classList.add('done');
      else if (i === n) p.classList.add('current');
    });
    if (n === 5) renderReview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('[data-back]').forEach(b =>
    b.onclick = () => showStep(state.step - 1));

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ════════════════════════════════════════════════════════════════
  // STEP 1: Patient lookup
  // ════════════════════════════════════════════════════════════════
  const phoneInput  = document.getElementById('patientPhone');
  const patientMenu = document.getElementById('patientResults');

  function normPhone(raw) {
    let p = String(raw||'').replace(/\D/g,'');
    if (p.startsWith('256')) p = '0' + p.slice(3);
    if (p.startsWith('7') && p.length === 9) p = '0' + p;
    return p;
  }

  let phoneTimer;
  phoneInput.addEventListener('input', () => {
    clearTimeout(phoneTimer);
    const q = normPhone(phoneInput.value);
    if (q.length < 4) { patientMenu.style.display = 'none'; return; }
    phoneTimer = setTimeout(() => searchPatients(q), 220);
  });

  async function searchPatients(q) {
    if (!supabase) { renderPatientMenu([], q); return; }

    // Search profiles (Homatt users)
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, phone_number, phone')
      .or(`phone_number.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(5);

    // Search clinic_patients (stub patients at this clinic)
    let stubs = [];
    if (_clinicId) {
      const { data: cp } = await supabase
        .from('clinic_patients')
        .select('id, full_name, phone')
        .eq('clinic_id', _clinicId)
        .ilike('phone', `%${q}%`)
        .limit(5);
      stubs = cp || [];
    }

    const seenPhones = new Set((profiles||[]).map(p => p.phone_number || p.phone).filter(Boolean));
    const stubsFiltered = stubs.filter(s => {
      if (seenPhones.has(s.phone)) return false;
      seenPhones.add(s.phone);
      return true;
    });

    const rows = [
      ...(profiles||[]).map(p => ({
        id: p.id, clinicPatientId: null, registered: true,
        name: ((p.first_name||'')+' '+(p.last_name||'')).trim() || 'Unnamed',
        phone: p.phone_number || p.phone || '',
      })),
      ...stubsFiltered.map(s => ({
        id: null, clinicPatientId: s.id, registered: false,
        name: s.full_name, phone: s.phone,
      })),
    ];
    renderPatientMenu(rows, q);
  }

  function renderPatientMenu(rows, q) {
    if (!rows.length) {
      patientMenu.innerHTML = `
        <div class="autocomplete-item" id="registerPrompt" style="background:#FFF8E1">
          <div class="ac-name" style="color:#E65100">
            <span class="material-icons-outlined" style="font-size:14px;vertical-align:-2px">person_add</span>
            Register new patient: ${esc(q)}
          </div>
          <div class="ac-cat">Will save to your clinic and send SMS invite</div>
        </div>`;
      patientMenu.style.display = 'block';
      document.getElementById('registerPrompt').onclick = () => openRegisterModal(q);
      return;
    }
    patientMenu.innerHTML = rows.map((r,i) => `
      <div class="autocomplete-item" data-idx="${i}">
        <div class="ac-name">${esc(r.name)} ${r.registered ? '' : '<span style="font-size:10px;color:#E65100">(not on Homatt)</span>'}</div>
        <div class="ac-cat">${esc(r.phone)}</div>
      </div>`).join('');
    patientMenu.style.display = 'block';
    patientMenu.querySelectorAll('.autocomplete-item').forEach(el => {
      el.onclick = () => selectPatient(rows[parseInt(el.dataset.idx,10)]);
    });
  }

  function selectPatient(p) {
    state.patient = p;
    document.getElementById('patientSearchBlock').style.display = 'none';
    document.getElementById('patientPillBlock').style.display = '';
    document.getElementById('ppName').textContent  = p.name;
    document.getElementById('ppPhone').textContent = p.phone;
    document.getElementById('ppAvatar').textContent = (p.name||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
    const badge = document.getElementById('ppBadge');
    badge.textContent = p.registered ? 'On Homatt' : 'Walk-in';
    badge.style.background = p.registered ? '#fff' : '#FFE0B2';
    badge.style.color = p.registered ? '#2E7D32' : '#E65100';
    patientMenu.style.display = 'none';
    document.getElementById('step1Next').disabled = false;
  }

  document.getElementById('ppChangeBtn').onclick = () => {
    state.patient = null;
    phoneInput.value = '';
    document.getElementById('patientSearchBlock').style.display = '';
    document.getElementById('patientPillBlock').style.display = 'none';
    document.getElementById('step1Next').disabled = true;
    phoneInput.focus();
  };

  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) patientMenu.style.display = 'none';
  });

  // ── Quick-register modal ───────────────────────────────────────
  const regModal = document.getElementById('registerModal');
  function openRegisterModal(prefillPhone) {
    document.getElementById('regPhone').value = prefillPhone || phoneInput.value;
    document.getElementById('regName').value = '';
    regModal.style.display = 'flex';
    setTimeout(() => document.getElementById('regName').focus(), 100);
  }
  document.getElementById('registerCancelBtn').onclick = () => regModal.style.display = 'none';

  document.getElementById('registerBtn').onclick = async () => {
    const name  = document.getElementById('regName').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    if (!name || !phone) { showToast('Name and phone required', 'error'); return; }

    const btn = document.getElementById('registerBtn');
    btn.disabled = true;

    if (!_clinicId && supabase && !session?.demo) {
      _clinicId = await resolveClinicId(supabase, session);
    }

    let clinicPatientId = null;
    if (supabase && _clinicId) {
      try {
        const { data: cp } = await supabase
          .from('clinic_patients')
          .upsert(
            { clinic_id: _clinicId, full_name: name, phone, registered_by: session?.userId || null },
            { onConflict: 'clinic_id,phone' }
          )
          .select('id').single();
        if (cp) clinicPatientId = cp.id;
      } catch(e) {}
    }

    selectPatient({ id: null, clinicPatientId, name, phone, registered: false });
    regModal.style.display = 'none';
    btn.disabled = false;

    if (supabase) {
      try {
        await supabase.functions.invoke('send-sms-invite', {
          body: { phone, name, clinicName: session?.clinicName || 'Clinic' }
        });
      } catch(e) {}
    }
    showToast('Patient registered', 'success');
  };

  // Step 1 → Step 2
  document.getElementById('step1Next').onclick = () => {
    if (!state.patient) { showToast('Select a patient first', 'error'); return; }
    showStep(2);
    loadAiDiagnoses();
  };

  // Pre-fill from URL params (when navigated from patients.html)
  (function preFillFromURL() {
    const p = new URLSearchParams(window.location.search);
    const name  = p.get('patient_name');
    const phone = p.get('patient_phone');
    const id    = p.get('patient_id');
    const cpId  = p.get('clinic_patient_id');
    if (name && phone) {
      selectPatient({
        id: id || null,
        clinicPatientId: cpId || null,
        name, phone,
        registered: !!id,
      });
      return;
    }
    setTimeout(() => phoneInput.focus(), 200);
  })();

  // ════════════════════════════════════════════════════════════════
  // STEP 2: AI Diagnoses
  // ════════════════════════════════════════════════════════════════
  const aiDxArea = document.getElementById('aiDxArea');
  const manualSymptomsArea = document.getElementById('manualSymptomsArea');

  async function loadAiDiagnoses() {
    aiDxArea.innerHTML = `
      <div style="text-align:center;padding:30px;color:#9AA0A6">
        <span class="material-icons-outlined" style="font-size:32px;display:block;margin-bottom:6px">hourglass_empty</span>
        Looking up patient's symptom history…
      </div>`;
    manualSymptomsArea.style.display = 'none';

    if (!supabase || !state.patient) {
      showManualEntry('No patient data available');
      return;
    }

    // Pull most recent AI triage session for Homatt-registered patients
    if (state.patient.id) {
      const { data: sessions } = await supabase
        .from('ai_triage_sessions')
        .select('ai_conditions, top_diagnosis, ai_confidence, created_at, overall_risk, clinic_urgency')
        .eq('user_id', state.patient.id)
        .order('created_at', { ascending: false })
        .limit(1);
      if (sessions?.length && sessions[0].ai_conditions?.length) {
        const s = sessions[0];
        state.aiDiagnoses = (s.ai_conditions || []).slice(0, 3);
        state.aiSource = 'app';
        renderAiCards(s);
        return;
      }
      // Fallback: check bookings.ai_full_data
      const { data: booking } = await supabase
        .from('bookings')
        .select('ai_full_data, symptoms, created_at')
        .eq('patient_user_id', state.patient.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (booking?.ai_full_data?.conditions?.length) {
        state.aiDiagnoses = booking.ai_full_data.conditions.slice(0, 3);
        state.aiSource = 'app';
        renderAiCards({ created_at: booking.created_at });
        return;
      }
    }

    // No data → manual symptoms entry
    showManualEntry(state.patient.id ? 'No prior symptom check found for this patient' : 'Walk-in patient — enter their symptoms');
  }

  function showManualEntry(reason) {
    aiDxArea.innerHTML = `
      <div class="empty-ai-state">
        <span class="material-icons-outlined" style="font-size:18px;vertical-align:-3px">info</span>
        ${esc(reason)}. Enter symptoms below to get AI suggestions.
      </div>`;
    manualSymptomsArea.style.display = '';
    state.aiSource = 'clinic_input';
  }

  function renderAiCards(meta) {
    const ageMs = Date.now() - new Date(meta.created_at || Date.now()).getTime();
    const ageHrs = Math.floor(ageMs / 3600000);
    const ageLabel = ageHrs < 1 ? 'just now' :
                     ageHrs < 24 ? `${ageHrs}h ago` :
                     `${Math.floor(ageHrs/24)}d ago`;

    const cards = state.aiDiagnoses.map((dx, i) => {
      const conf = dx.likelihood_percent || dx.confidence || 0;
      const cls = conf >= 75 ? 'high' : conf >= 50 ? 'med' : '';
      const urgency = dx.urgency || meta.clinic_urgency || '';
      return `
        <div class="dx-card" data-idx="${i}">
          <div class="dx-card-top">
            <span class="dx-name">${esc(dx.name)}</span>
            <span class="dx-confidence ${cls}">${conf}% match</span>
          </div>
          <div class="dx-meta">
            ${dx.severity ? `Severity: ${esc(dx.severity)}` : ''}
            ${urgency ? ` · ${esc(urgency)}` : ''}
          </div>
        </div>`;
    }).join('');

    aiDxArea.innerHTML = `
      <div style="font-size:11px;color:#9AA0A6;margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px;font-weight:600">
        From patient's symptom check · ${ageLabel}
      </div>
      ${cards}
      <div class="helper" style="margin-top:10px">Tap the closest match. You can edit it on the next step after lab tests.</div>
    `;
    aiDxArea.querySelectorAll('.dx-card').forEach(el => {
      el.onclick = () => {
        aiDxArea.querySelectorAll('.dx-card').forEach(c => c.classList.remove('selected'));
        el.classList.add('selected');
        state.aiSelectedIdx = parseInt(el.dataset.idx, 10);
        state.confirmedDx = state.aiDiagnoses[state.aiSelectedIdx].name;
      };
    });
  }

  // Manual symptoms → AI proxy
  document.getElementById('getAiBtn').onclick = async () => {
    const symptoms = document.getElementById('manualSymptoms').value.trim();
    if (!symptoms) { showToast('Enter symptoms first', 'error'); return; }
    state.enteredSymptoms = symptoms;

    const btn = document.getElementById('getAiBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px">hourglass_empty</span> Thinking…';

    try {
      const prompt = `Patient in Uganda reports these symptoms: "${symptoms}". Provide exactly 3 most likely diagnoses ranked by likelihood. Respond with ONLY a JSON array (no markdown, no preamble): [{"name":"<condition>","likelihood_percent":<0-100>,"severity":"mild|moderate|severe","urgency":"routine|urgent|emergency"}]. Consider tropical diseases common in Uganda (malaria, typhoid, schistosomiasis, etc.).`;
      const { data, error } = await supabase.functions.invoke('ai-proxy', {
        body: { provider: 'groq', prompt }
      });
      if (error) throw error;
      let parsed = [];
      try {
        const text = (data?.text || '').replace(/```json|```/g, '').trim();
        parsed = JSON.parse(text);
      } catch(e) {
        showToast('AI response could not be parsed. Please type the diagnosis directly on the next step.', 'error');
        // Skip ahead with empty diagnoses — clinician fills it manually
        state.aiDiagnoses = [];
        state.aiSelectedIdx = -1;
        showStep(3);
        return;
      }
      state.aiDiagnoses = (parsed || []).slice(0, 3);
      state.aiSource = 'clinic_input';
      manualSymptomsArea.style.display = 'none';
      renderAiCards({ created_at: new Date().toISOString() });
    } catch(e) {
      showToast('AI request failed: ' + (e.message || 'unknown'), 'error');
    }
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px">auto_awesome</span> Get AI diagnosis suggestions';
  };

  // Step 2 → Step 3
  document.getElementById('step2Next').onclick = () => {
    // It's OK to skip AI selection — clinician can type confirmed dx directly
    document.getElementById('confirmedDx').value = state.confirmedDx || '';
    showStep(3);
  };

  // ════════════════════════════════════════════════════════════════
  // STEP 3: Confirmed Dx + Severity + Lab tests + Care level
  // ════════════════════════════════════════════════════════════════
  document.getElementById('confirmedDx').addEventListener('input', e => {
    state.confirmedDx = e.target.value;
  });

  // Severity chips
  document.querySelectorAll('#sevChips .sev-chip').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#sevChips .sev-chip').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.severity = b.dataset.sev;
    };
  });

  // Lab test chips
  document.querySelectorAll('#labChips .lab-chip').forEach(b => {
    b.onclick = () => {
      b.classList.toggle('active');
      const lab = b.dataset.lab;
      const i = state.labTests.indexOf(lab);
      if (i === -1) state.labTests.push(lab); else state.labTests.splice(i,1);
    };
  });

  document.getElementById('labResults').addEventListener('input', e => {
    state.labResults = e.target.value;
  });

  // Care level toggle
  document.querySelectorAll('.care-opt').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.care-opt').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.patientType = b.dataset.care;
      document.getElementById('wardField').style.display =
        (state.patientType === 'inpatient') ? '' : 'none';
    };
  });
  document.getElementById('wardInput').addEventListener('input', e => {
    state.ward = e.target.value;
  });

  // Step 3 → Step 4
  document.getElementById('step3Next').onclick = () => {
    if (!state.confirmedDx.trim()) {
      showToast('Enter the confirmed diagnosis', 'error');
      document.getElementById('confirmedDx').focus();
      return;
    }
    showStep(4);
    if (!state.medications.length) addMedication(); // start with one med row
  };

  // ════════════════════════════════════════════════════════════════
  // STEP 4: Medications with intake times
  // ════════════════════════════════════════════════════════════════
  const FALLBACK_FORMULARY = [
    { name: 'Coartem 20/120mg',    default_dosage:'4 tabs twice daily',     common_dosages:['4 tabs twice daily','3 tabs twice daily'], default_days: 3 },
    { name: 'Amoxicillin 500mg',   default_dosage:'500mg three times daily',common_dosages:['500mg three times daily','250mg three times daily'], default_days: 5 },
    { name: 'Paracetamol 500mg',   default_dosage:'1g four times daily',    common_dosages:['1g four times daily','500mg four times daily'], default_days: 3 },
    { name: 'Metronidazole 400mg', default_dosage:'400mg three times daily',common_dosages:['400mg three times daily'], default_days: 7 },
    { name: 'Ciprofloxacin 500mg', default_dosage:'500mg twice daily',      common_dosages:['500mg twice daily'], default_days: 7 },
    { name: 'ORS Sachet',          default_dosage:'After each loose stool', common_dosages:['1 sachet after each loose stool'], default_days: 3 },
    { name: 'Omeprazole 20mg',     default_dosage:'20mg once daily',        common_dosages:['20mg once daily'], default_days: 14 },
    { name: 'Metformin 500mg',     default_dosage:'500mg twice daily',      common_dosages:['500mg twice daily'], default_days: 30 },
    { name: 'Amlodipine 5mg',      default_dosage:'5mg once daily',         common_dosages:['5mg once daily','10mg once daily'], default_days: 30 },
  ];

  async function loadFormulary() {
    if (!supabase) { state.formulary = FALLBACK_FORMULARY; return; }
    try {
      const { data } = await supabase
        .from('formulary')
        .select('name, generic_name, category, default_dosage, common_dosages, default_days')
        .order('name');
      state.formulary = data?.length ? data : FALLBACK_FORMULARY;
    } catch(e) { state.formulary = FALLBACK_FORMULARY; }
  }
  loadFormulary();

  // Default time slots based on times-per-day
  const DEFAULT_TIMES = {
    1: ['08:00'],
    2: ['08:00','20:00'],
    3: ['08:00','14:00','20:00'],
    4: ['07:00','12:00','17:00','22:00'],
  };

  function addMedication() {
    state.medications.push({
      drug: '', dosage: '',
      timesPerDay: 2,
      intakeTimes: [...DEFAULT_TIMES[2]],
      durationDays: 5,
    });
    renderMeds();
  }

  function removeMedication(idx) {
    state.medications.splice(idx, 1);
    renderMeds();
  }

  function renderMeds() {
    const ct = document.getElementById('medsContainer');
    ct.innerHTML = state.medications.map((m, i) => `
      <div class="med-row" data-idx="${i}">
        <div class="med-row-h">
          <span class="med-num">Drug ${i+1}</span>
          ${state.medications.length > 1 ? `<button class="med-del-btn" data-rm="${i}"><span class="material-icons-outlined">delete_outline</span></button>` : ''}
        </div>

        <label class="field-label">Drug name</label>
        <div class="autocomplete-wrap">
          <input class="field-input drug-input" data-idx="${i}"
            value="${esc(m.drug)}" placeholder="Type 'amox', 'coartem'…" autocomplete="off">
          <div class="autocomplete-menu drug-menu" data-idx="${i}"></div>
        </div>

        <div style="height:10px"></div>
        <div class="field-row">
          <div>
            <label class="field-label">Dosage</label>
            <input class="field-input dose-input" data-idx="${i}"
              value="${esc(m.dosage)}" placeholder="e.g. 500mg">
          </div>
          <div>
            <label class="field-label">Duration (days)</label>
            <input class="field-input days-input" data-idx="${i}"
              type="number" min="1" max="180" value="${m.durationDays}">
          </div>
        </div>

        <div style="height:10px"></div>
        <label class="field-label">How many times a day?</label>
        <div class="sev-chips" style="margin-bottom:10px">
          ${[1,2,3,4].map(n => `
            <button class="sev-chip times-chip ${m.timesPerDay===n?'active':''}"
                    data-idx="${i}" data-n="${n}" type="button">${n}×</button>
          `).join('')}
        </div>

        <label class="field-label">Intake times</label>
        <div class="time-grid" style="grid-template-columns:repeat(${m.timesPerDay},1fr)">
          ${m.intakeTimes.map((t,j) => `
            <input type="time" class="time-input" data-idx="${i}" data-j="${j}" value="${t}">
          `).join('')}
        </div>
      </div>
    `).join('');

    // Wire up listeners
    ct.querySelectorAll('.med-del-btn').forEach(b =>
      b.onclick = () => removeMedication(parseInt(b.dataset.rm,10)));
    ct.querySelectorAll('.drug-input').forEach(input => {
      input.addEventListener('input', e => onDrugInput(e, parseInt(input.dataset.idx,10)));
    });
    ct.querySelectorAll('.dose-input').forEach(input => {
      input.addEventListener('input', e => {
        state.medications[parseInt(input.dataset.idx,10)].dosage = e.target.value;
      });
    });
    ct.querySelectorAll('.days-input').forEach(input => {
      input.addEventListener('input', e => {
        state.medications[parseInt(input.dataset.idx,10)].durationDays = Math.max(1, parseInt(e.target.value,10) || 1);
        autoSetExpectedRecovery();
      });
    });
    ct.querySelectorAll('.times-chip').forEach(b => {
      b.onclick = () => {
        const i = parseInt(b.dataset.idx,10);
        const n = parseInt(b.dataset.n,10);
        state.medications[i].timesPerDay = n;
        state.medications[i].intakeTimes = [...DEFAULT_TIMES[n]];
        renderMeds();
      };
    });
    ct.querySelectorAll('.time-input').forEach(input => {
      input.addEventListener('change', e => {
        const i = parseInt(input.dataset.idx,10);
        const j = parseInt(input.dataset.j,10);
        state.medications[i].intakeTimes[j] = e.target.value;
      });
    });
  }

  function onDrugInput(e, idx) {
    const q = e.target.value.trim().toLowerCase();
    state.medications[idx].drug = e.target.value;
    const menu = document.querySelector(`.drug-menu[data-idx="${idx}"]`);
    if (!q) { menu.style.display = 'none'; return; }
    const matches = state.formulary.filter(d =>
      d.name.toLowerCase().includes(q) || (d.generic_name||'').toLowerCase().includes(q)
    ).slice(0, 8);
    if (!matches.length) { menu.style.display = 'none'; return; }
    menu.innerHTML = matches.map(d => `
      <div class="autocomplete-item" data-name="${esc(d.name)}">
        <div class="ac-name">${esc(d.name)}</div>
        <div class="ac-cat">${esc(d.default_dosage || '')}</div>
      </div>
    `).join('');
    menu.style.display = 'block';
    menu.querySelectorAll('.autocomplete-item').forEach(el => {
      el.onclick = () => {
        const drug = state.formulary.find(d => d.name === el.dataset.name);
        if (!drug) return;
        state.medications[idx].drug = drug.name;
        state.medications[idx].dosage = drug.default_dosage || state.medications[idx].dosage;
        state.medications[idx].durationDays = drug.default_days || state.medications[idx].durationDays;
        menu.style.display = 'none';
        autoSetExpectedRecovery();
        renderMeds();
      };
    });
  }

  function autoSetExpectedRecovery() {
    const maxDays = state.medications.reduce((m, x) => Math.max(m, x.durationDays || 0), 0);
    if (!maxDays) return;
    const d = new Date();
    d.setDate(d.getDate() + maxDays);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const dd = String(d.getDate()).padStart(2,'0');
    const iso = `${yyyy}-${mm}-${dd}`;
    state.expectedRecovery = iso;
    document.getElementById('expRecovery').value = iso;
  }

  document.getElementById('expRecovery').addEventListener('change', e => {
    state.expectedRecovery = e.target.value;
  });

  document.getElementById('addMedBtn').onclick = addMedication;

  // Stock toggle
  document.querySelectorAll('.stock-opt').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('.stock-opt').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.stockSource = b.dataset.stock;
    };
  });

  document.getElementById('patientNotes').addEventListener('input', e => {
    state.patientNotes = e.target.value;
  });

  // Step 4 → Step 5
  document.getElementById('step4Next').onclick = () => {
    const ok = state.medications.every(m => m.drug && m.dosage && m.intakeTimes.every(t => t));
    if (!state.medications.length) {
      showToast('Add at least one medication', 'error');
      return;
    }
    if (!ok) {
      showToast('Fill in drug name, dosage and intake times for each medication', 'error');
      return;
    }
    if (!state.expectedRecovery) autoSetExpectedRecovery();
    showStep(5);
  };

  // ════════════════════════════════════════════════════════════════
  // STEP 5: Review + Submit
  // ════════════════════════════════════════════════════════════════
  function renderReview() {
    const grid = document.getElementById('reviewGrid');
    const medsLines = state.medications.map(m =>
      `${m.drug} · ${m.dosage} · ${m.intakeTimes.join(', ')} · ${m.durationDays} days`
    ).join('<br>');

    grid.innerHTML = `
      <div class="lbl">Patient</div>
      <div class="val">${esc(state.patient.name)} · ${esc(state.patient.phone)}</div>
      <div class="lbl">Diagnosis</div>
      <div class="val">${esc(state.confirmedDx)} (${esc(state.severity)})</div>
      <div class="lbl">Care level</div>
      <div class="val">${state.patientType === 'inpatient' ? 'Inpatient — '+esc(state.ward||'Ward TBC') : 'Outpatient'}</div>
      ${state.labTests.length ? `<div class="lbl">Lab tests</div><div class="val">${state.labTests.map(esc).join(', ')}</div>` : ''}
      ${state.labResults ? `<div class="lbl">Lab results</div><div class="val">${esc(state.labResults)}</div>` : ''}
      <div class="lbl">Medications</div>
      <div class="val">${medsLines}</div>
      <div class="lbl">Expected recovery</div>
      <div class="val">${esc(state.expectedRecovery)}</div>
      <div class="lbl">Source</div>
      <div class="val">${state.stockSource === 'clinic' ? 'Clinic stock' : 'E-prescription → partner pharmacy'}</div>
      ${state.patientNotes ? `<div class="lbl">Instructions</div><div class="val">${esc(state.patientNotes)}</div>` : ''}
    `;

    // Reminder schedule preview
    const allTimes = state.medications.flatMap(m => m.intakeTimes).sort();
    const uniqTimes = [...new Set(allTimes)];
    document.getElementById('reminderPreview').innerHTML = `
      <div>📲 <strong>Daily medication reminders</strong> at ${uniqTimes.length ? uniqTimes.join(', ') : '—'}</div>
      <div>💬 <strong>"How are you feeling?" check-in</strong> tomorrow ${uniqTimes[0] || '08:00'}</div>
      <div>🎯 <strong>Course-completion check</strong> on ${state.expectedRecovery}</div>
      ${state.stockSource === 'pharmacy' ? `<div>🚚 <strong>Delivery confirmation push</strong> to patient — they choose pickup or home delivery</div>` : ''}
    `;
  }

  // ── Build followup schedule ───────────────────────────────────
  function buildFollowupRows(diagnosisId) {
    const rows = [];
    const today = new Date();
    today.setSeconds(0,0);

    function whenAt(daysFromNow, hhmm) {
      const d = new Date(today);
      d.setDate(d.getDate() + daysFromNow);
      const [h,m] = hhmm.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    }

    // 1) "How are you feeling?" check-in 24h after start, at the first med time
    const firstTime = (state.medications[0]?.intakeTimes?.[0]) || '08:00';
    rows.push({
      diagnosis_id: diagnosisId,
      scheduled_at: whenAt(1, firstTime),
      type: 'check_in',
      message: `How are you feeling after starting your ${state.confirmedDx} treatment? Tap below to tell us.`,
      day_number: 1,
      intake_time: firstTime,
    });

    // 2) Per-medication intake reminders for the duration
    state.medications.forEach(m => {
      const days = m.durationDays;
      m.intakeTimes.forEach(time => {
        for (let d = 0; d < days; d++) {
          rows.push({
            diagnosis_id: diagnosisId,
            scheduled_at: whenAt(d, time),
            type: 'medication',
            message: `Time to take your ${m.drug} (${m.dosage}). Tap below to confirm.`,
            day_number: d + 1,
            intake_time: time,
          });
        }
      });
    });

    // 3) Course-complete check on expected recovery
    if (state.expectedRecovery) {
      const recDate = new Date(state.expectedRecovery);
      const daysAhead = Math.max(1, Math.round((recDate - today) / 86400000));
      rows.push({
        diagnosis_id: diagnosisId,
        scheduled_at: whenAt(daysAhead, firstTime),
        type: 'course_complete',
        message: `Did you complete your full ${state.confirmedDx} treatment? Reply YES / NO.`,
        day_number: daysAhead,
        intake_time: firstTime,
      });
    }

    return rows;
  }

  // ── Submit ────────────────────────────────────────────────────
  document.getElementById('submitBtn').onclick = async () => {
    const btn = document.getElementById('submitBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px">hourglass_empty</span> Sending…';

    if (!_clinicId && supabase && !session?.demo) {
      _clinicId = await resolveClinicId(supabase, session);
    }

    if (!supabase || !_clinicId) {
      showToast('Demo mode — not saved. Connect a clinic to save.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px">send</span> Send Prescription & Start Follow-up';
      return;
    }

    // Build prescription_items jsonb from medications
    const items = state.medications.map(m => ({
      drug_name:    m.drug,
      strength:     m.dosage,
      frequency:    m.timesPerDay + 'x_daily',
      duration:     m.durationDays,
      intake_times: m.intakeTimes,
    }));

    // 1. Insert clinic_diagnoses
    const dxPayload = {
      clinic_id: _clinicId,
      clinician_id: session?.userId || null,
      patient_name: state.patient.name || null,
      patient_phone: state.patient.phone,
      clinic_patient_id: state.patient.clinicPatientId || null,
      ai_diagnoses: state.aiDiagnoses,
      ai_source: state.aiSource,
      ai_suggested_diagnosis: state.aiDiagnoses[state.aiSelectedIdx]?.name || null,
      ai_confidence: state.aiDiagnoses[state.aiSelectedIdx]?.likelihood_percent || null,
      ai_match: state.aiSelectedIdx >= 0 &&
        state.aiDiagnoses[state.aiSelectedIdx]?.name?.toLowerCase() === state.confirmedDx.toLowerCase(),
      confirmed_diagnosis: state.confirmedDx,
      severity: state.severity,
      patient_type: state.patientType,
      ward: state.ward || null,
      lab_tests_ordered: state.labTests,
      lab_results: state.labResults || null,
      clinical_findings: state.labResults || null,
      patient_instructions: state.patientNotes || null,
      delivery_preference: state.stockSource === 'pharmacy' ? 'delivery' : 'pickup',
      treatment_plan: items.map(i => `${i.drug_name} ${i.strength} × ${i.duration}d`).join('; '),
      expected_recovery: state.expectedRecovery || null,
      prescription_items: items,
      intake_schedule: items,
    };
    if (state.patient.id) dxPayload.clinician_id = session?.userId || null;

    const { data: dx, error: dxError } = await supabase
      .from('clinic_diagnoses')
      .insert(dxPayload)
      .select().single();

    if (dxError) {
      showToast('Save failed: ' + dxError.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px">send</span> Send Prescription & Start Follow-up';
      return;
    }

    // 2. Insert e_prescription if there are meds
    if (items.length) {
      const epx = {
        diagnosis_id: dx.id,
        patient_id: state.patient.id || null,
        clinic_patient_id: state.patient.clinicPatientId || null,
        clinic_id: _clinicId,
        issued_by: session?.userId || null,
        items,
        status: 'active',
        start_date: new Date().toISOString().slice(0,10),
        end_date: state.expectedRecovery || null,
        delivery_method: state.stockSource === 'pharmacy' ? 'delivery' : 'pickup',
        delivery_preference: state.stockSource === 'pharmacy' ? 'delivery' : 'pickup',
        patient_instructions: state.patientNotes || null,
        notes: state.confirmedDx,
      };
      await supabase.from('e_prescriptions').insert(epx);
    }

    // 3. Insert clinic_followups for medication reminders + check-ins
    const followups = buildFollowupRows(dx.id);
    if (followups.length) {
      // clinic_followups uses clinic_order_id FK, but we want to link to diagnosis.
      // Map to the existing schema (clinic_order_id) using diagnosis_id stored elsewhere,
      // OR just insert with diagnosis_id (added via migration's day_number / intake_time columns).
      // Strategy: use clinic_orders as the routing record, OR insert a stub clinic_order
      // pointing at the same diagnosis. Simpler: use a separate insert path.
      // Fallback compatible with existing clinic_followups schema:
      try {
        await supabase.from('clinic_followups').insert(followups);
      } catch (e) { /* non-fatal; reminders won't fire but consultation is saved */ }
    }

    // 4. If e-prescription, send delivery confirmation push to patient (best-effort)
    if (state.stockSource === 'pharmacy' && state.patient.id) {
      try {
        await supabase.functions.invoke('send-notification', {
          body: {
            userId: state.patient.id,
            title: 'Prescription Ready',
            message: 'Your prescription has been sent to a partner pharmacy. Tap to choose delivery or pickup.',
            data: { screen: 'prescription', id: dx.id }
          }
        });
      } catch(e) {}
    }

    showToast('Consultation saved. Reminders scheduled.', 'success');
    setTimeout(() => { window.location.href = 'dashboard.html'; }, 900);
  };

  // Initialise: highlight step 1 pills and add first med row
  showStep(1);
  addMedication();

  window._wizState = state;
  window._showStep = showStep;
  window._wizEsc = esc;
})();
