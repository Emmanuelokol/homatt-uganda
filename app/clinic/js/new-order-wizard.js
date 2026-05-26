/* ════════════════════════════════════════════════════════════════════
 * Homatt Health — New Consultation Wizard  (2-screen)
 * Screen 1: Patient & Assessment
 * Screen 2: Treatment & Bill
 * Saves to: clinic_diagnoses, e_prescriptions, clinic_followups
 * Background: medication reminders, follow-up scheduling,
 *             inventory deduction, e-prescription generation
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
    patient: null,
    bookingId: null,
    bookingCode: null,
    confirmedDx: '',
    severity: 'moderate',
    patientType: 'outpatient',
    ward: '',
    labTests: [],
    labResults: '',
    medications: [],
    materialsUsed: [],
    expectedRecovery: '',
    followUpDays: 7,
    followUpReason: '',
    stockSource: 'clinic',
    pharmacyId: null,
    patientNotes: '',
    formulary: [],
    clinicInventory: [],
    feeConsult: 0,
    feeLab: 0,
    feeMeds: 0,
    paymentStatus: 'paid',
  };
  window._wizState = state;

  // ── Lab-test prices (UGX) ────────────────────────────────────────
  const LAB_PRICES = {
    'Malaria RDT':                        5000,
    'Thick Blood Smear':                  8000,
    'Thin Blood Smear':                  10000,
    'Malaria PCR':                       25000,
    'Full Blood Count (FBC)':            15000,
    'ESR':                                8000,
    'CRP':                               12000,
    'Blood Group & Rhesus':               8000,
    'Blood Sugar (Random)':               5000,
    'Fasting Blood Sugar':                6000,
    'HbA1c':                             35000,
    'Liver Function Tests (LFTs)':       25000,
    'Kidney Function (Creatinine)':      15000,
    'Serum Electrolytes':                20000,
    'Blood Culture & Sensitivity':       30000,
    'HIV Rapid Test':                     5000,
    'CD4 Count':                         30000,
    'Hepatitis B (HBsAg)':              15000,
    'Hepatitis C (HCV)':                 20000,
    'Syphilis (VDRL/RPR)':              12000,
    'Widal (Typhoid)':                   15000,
    'Brucella Agglutination':            20000,
    'TB Sputum AFB Smear':              15000,
    'TB GeneXpert':                      50000,
    'Urinalysis (Dipstick)':             5000,
    'Urine Microscopy':                   8000,
    'Urine Culture & Sensitivity':       25000,
    'Pregnancy Test (uHCG)':             5000,
    'Stool Microscopy (Ova & Parasites)':10000,
    'Stool Culture & Sensitivity':       25000,
    'H. Pylori (Stool Antigen)':         20000,
    'BP Measurement':                     2000,
    'Pulse Oximetry (SpO2)':              3000,
    'Blood Glucose (POC)':                4000,
    'ECG':                               20000,
    'Chest X-Ray':                       40000,
    'Ultrasound':                        60000,
  };

  // ── Fee helpers ──────────────────────────────────────────────────
  function recalcFees() {
    const c = parseFloat(document.getElementById('feeConsult')?.value) || 0;
    const l = parseFloat(document.getElementById('feeLab')?.value)    || 0;
    const m = parseFloat(document.getElementById('feeMeds')?.value)   || 0;
    state.feeConsult = c; state.feeLab = l; state.feeMeds = m;
    const total = c + l + m;
    const el = document.getElementById('feeTotal');
    if (el) el.textContent = total.toLocaleString('en-UG');
  }

  function autoFillLabFee() {
    const total = state.labTests.reduce((s, t) => s + (LAB_PRICES[t] || 0), 0);
    const el = document.getElementById('feeLab');
    if (el && !parseFloat(el.value)) { el.value = total || ''; recalcFees(); }
  }

  let _feeCardInited = false;
  function initFeeCard() {
    if (_feeCardInited) return;
    _feeCardInited = true;
    ['feeConsult','feeLab','feeMeds'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', recalcFees);
    });
    document.querySelectorAll('.pay-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.pay-chip').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.paymentStatus = btn.dataset.pay;
      });
    });
    // Pre-fill consultation fee from clinic settings
    if (supabase && _clinicId) {
      supabase.from('clinics').select('consultation_fee').eq('id', _clinicId).maybeSingle()
        .then(({ data }) => {
          if (data?.consultation_fee) {
            const el = document.getElementById('feeConsult');
            if (el && !parseFloat(el.value)) { el.value = data.consultation_fee; recalcFees(); }
          }
        }).catch(() => {});
    }
  }

  // ── Live summary bar ─────────────────────────────────────────────
  function updateConsultSummaryBar() {
    const p = state.patient;
    if (!p) return;
    const avatar = (p.name||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
    const el1 = document.getElementById('csbAvatar');
    const el2 = document.getElementById('csbName');
    const el3 = document.getElementById('csbDx');
    if (el1) el1.textContent = avatar;
    if (el2) el2.textContent = p.name || '—';
    if (el3) el3.textContent = (state.confirmedDx || '—') +
      (state.severity && state.severity !== 'moderate' ? ' · ' + state.severity : '');
  }

  // ── Step navigation ──────────────────────────────────────────────
  function showStep(n) {
    state.step = n;
    document.querySelectorAll('.wiz-section').forEach(s => {
      s.style.display = (parseInt(s.dataset.step,10) === n) ? '' : 'none';
    });
    document.querySelectorAll('.wiz-dot').forEach(dot => {
      const i = parseInt(dot.dataset.dot, 10);
      dot.classList.remove('done','current');
      if (i < n) dot.classList.add('done');
      else if (i === n) dot.classList.add('current');
    });
    const dotLine = document.getElementById('dotLine');
    if (dotLine) dotLine.classList.toggle('done', n > 1);
    if (n === 2) {
      updateConsultSummaryBar();
      initFeeCard();
      autoFillLabFee();
      if (!state.medications.length) addMedication();
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  document.querySelectorAll('[data-back]').forEach(b =>
    b.onclick = () => showStep(state.step - 1));

  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ════════════════════════════════════════════════════════════════
  // SCREEN 1: Patient lookup
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

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, phone_number, phone')
      .or(`phone_number.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(5);

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
    document.getElementById('ppPhone').textContent = p.phone || (p.fromBooking ? 'From booking ' + (state.bookingCode || '') : '');
    document.getElementById('ppAvatar').textContent = (p.name||'?').split(' ').map(x=>x[0]).slice(0,2).join('').toUpperCase();
    const badge = document.getElementById('ppBadge');
    if (p.fromBooking) {
      badge.textContent = '✓ Verified';
      badge.style.background = '#E8F5E9';
      badge.style.color = '#1B5E20';
    } else {
      badge.textContent = p.registered ? 'On Homatt' : 'Walk-in';
      badge.style.background = p.registered ? '#fff' : '#FFE0B2';
      badge.style.color = p.registered ? '#2E7D32' : '#E65100';
    }
    patientMenu.style.display = 'none';
    document.getElementById('step1Next').disabled = false;
    document.getElementById('bookingCodeBlock').style.display = 'none';
    loadPatientProfile(p);
  }

  document.getElementById('ppChangeBtn').onclick = () => {
    state.patient = null;
    phoneInput.value = '';
    document.getElementById('patientSearchBlock').style.display = '';
    document.getElementById('bookingCodeBlock').style.display = 'none';
    document.getElementById('lookupTabPhone').classList.add('active');
    document.getElementById('lookupTabCode').classList.remove('active');
    document.getElementById('patientPillBlock').style.display = 'none';
    const card = document.getElementById('patientProfileCard');
    if (card) { card.style.display = 'none'; card.innerHTML = ''; }
    document.getElementById('step1Next').disabled = true;
    phoneInput.focus();
  };

  document.addEventListener('click', e => {
    if (!e.target.closest('.autocomplete-wrap')) patientMenu.style.display = 'none';
  });

  // ── Lookup tabs ──────────────────────────────────────────────────
  document.getElementById('lookupTabPhone').onclick = () => {
    document.getElementById('lookupTabPhone').classList.add('active');
    document.getElementById('lookupTabCode').classList.remove('active');
    document.getElementById('patientSearchBlock').style.display = '';
    document.getElementById('bookingCodeBlock').style.display = 'none';
  };
  document.getElementById('lookupTabCode').onclick = () => {
    document.getElementById('lookupTabCode').classList.add('active');
    document.getElementById('lookupTabPhone').classList.remove('active');
    document.getElementById('bookingCodeBlock').style.display = '';
    document.getElementById('patientSearchBlock').style.display = 'none';
    document.getElementById('codeError').style.display = 'none';
    setTimeout(() => document.getElementById('bookingCodeInput').focus(), 80);
  };

  const bookingCodeInput = document.getElementById('bookingCodeInput');
  if (bookingCodeInput) {
    bookingCodeInput.addEventListener('input', () => {
      let v = bookingCodeInput.value.toUpperCase().replace(/[^A-Z0-9-]/g, '');
      if (v && !v.startsWith('HO')) v = 'HO-' + v.replace(/^HO-?/, '');
      bookingCodeInput.value = v;
    });
    bookingCodeInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('lookupCodeBtn').click();
    });
  }

  document.getElementById('lookupCodeBtn').onclick = async () => {
    const code = (bookingCodeInput?.value || '').trim().toUpperCase();
    const errEl = document.getElementById('codeError');
    errEl.style.display = 'none';
    if (!code || !code.startsWith('HO')) {
      errEl.textContent = 'Enter a valid code starting with HO- (e.g. HO-928)';
      errEl.style.display = 'block'; return;
    }
    if (!supabase) { errEl.textContent = 'Database unavailable'; errEl.style.display = 'block'; return; }

    const btn = document.getElementById('lookupCodeBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px;animation:spin 1s linear infinite">hourglass_empty</span> Looking up…';

    try {
      const { data, error } = await supabase.rpc('lookup_by_booking_code', { p_code: code });
      if (error) throw error;
      if (!data || !data.length) {
        errEl.textContent = 'No booking found for ' + code; errEl.style.display = 'block';
      } else {
        const row = data[0];
        state.bookingId   = row.booking_id;
        state.bookingCode = code;
        selectPatient({
          id: row.patient_user_id || null,
          clinicPatientId: null,
          name: row.full_name || row.patient_name || 'Patient',
          phone: row.phone || '',
          registered: !!row.patient_user_id,
          fromBooking: true,
          allergies:             row.allergies,
          chronic_conditions:    row.chronic_conditions,
          blood_group:           row.blood_group,
          medical_notes:         row.medical_notes,
          consent_share_history: row.consent_share_history,
          _profilePreloaded: true,
        });
      }
    } catch(e) {
      errEl.textContent = 'Error: ' + e.message; errEl.style.display = 'block';
    }
    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px">search</span> Find Patient';
  };

  // ── Load returning patient profile ───────────────────────────────
  async function loadPatientProfile(patient) {
    const card = document.getElementById('patientProfileCard');
    if (!card) return;

    if (patient._profilePreloaded) {
      try {
        const { data: meds } = await supabase.rpc('get_patient_active_meds', {
          p_phone:   patient.phone || null,
          p_user_id: patient.id    || null,
        });
        patient._activeMeds = meds || [];
      } catch(e) {}
      renderProfileCard(card, patient, null);
      fetchVisitHistory(patient, card);
      return;
    }

    card.innerHTML = '<div style="padding:10px;color:#9AA0A6;font-size:13px;text-align:center">Loading medical history…</div>';
    card.style.display = '';

    if (!supabase) { card.innerHTML = ''; card.style.display = 'none'; return; }

    let medProfile = null;
    let activeMeds = [];

    try {
      const { data: meds } = await supabase.rpc('get_patient_active_meds', {
        p_phone:   patient.phone || null,
        p_user_id: patient.id    || null,
      });
      activeMeds = meds || [];
    } catch(e) {}

    if (patient.clinicPatientId) {
      try {
        const { data } = await supabase.from('clinic_patients')
          .select('allergies,chronic_conditions,blood_group,medical_notes,consent_share_history,consent_recorded_at,is_child,parent_phone,date_of_birth,sex')
          .eq('id', patient.clinicPatientId).maybeSingle();
        medProfile = data;
      } catch(e) {}
    } else if (patient.id) {
      try {
        const { data } = await supabase.from('profiles')
          .select('allergies,chronic_conditions,blood_group,medical_notes,consent_share_history,consent_recorded_at')
          .eq('id', patient.id).maybeSingle();
        medProfile = data;
      } catch(e) {}
    } else if (patient.phone) {
      try {
        const { data } = await supabase.rpc('lookup_returning_patient', {
          p_phone: patient.phone,
          p_name_query: patient.name || null
        });
        if (data && data.length) {
          medProfile = data[0];
          if (!patient.clinicPatientId && medProfile.clinic_patient_id) {
            state.patient.clinicPatientId = medProfile.clinic_patient_id;
          }
        }
      } catch(e) {}
    }

    const merged = { ...patient, ...(medProfile || {}), _activeMeds: activeMeds };
    renderProfileCard(card, merged, null);
    fetchVisitHistory(merged, card);
  }

  async function fetchVisitHistory(patient, card) {
    if (!supabase || !card) return;
    const consent = patient.consent_share_history;
    const phone   = patient.phone || patient.parent_phone || '';
    const name    = patient.name || '';

    try {
      let query = supabase.from('patient_full_history')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (consent && phone) {
        query = query.eq('patient_phone', phone);
      } else if (consent && name) {
        query = query.ilike('patient_name', '%' + name + '%');
      } else {
        if (!_clinicId) { renderProfileCard(card, patient, []); return; }
        query = query.eq('clinic_id', _clinicId);
        if (phone) query = query.eq('patient_phone', phone);
        else if (name) query = query.ilike('patient_name', '%' + name + '%');
      }

      const { data } = await query;
      renderProfileCard(card, patient, data || []);
    } catch(e) {
      renderProfileCard(card, patient, []);
    }
  }

  function renderProfileCard(card, patient, history) {
    if (!card) return;
    card.style.display = '';

    const allergies = patient.allergies || [];
    const chronic   = patient.chronic_conditions || [];
    const blood     = patient.blood_group || '';
    const consent   = patient.consent_share_history;
    const notNone   = arr => arr.length && !(arr.length === 1 && arr[0].toLowerCase() === 'none');

    let html = '<div style="border-top:1px solid #F0F0F0;margin-top:6px;padding-top:12px">';

    const activeMeds = patient._activeMeds || [];
    if (activeMeds.length) {
      const medList = activeMeds.slice(0, 5).map(m => {
        const items = Array.isArray(m.items) ? m.items : [];
        const names = items.slice(0, 3).map(it => it.drug_name || it.name || it.drug || '').filter(Boolean);
        const fromClinic = m.clinic_name ? ' <span style="opacity:.7">(' + esc(m.clinic_name) + ')</span>' : '';
        const pickup = m.picked_up_at
          ? ''
          : ' <span style="background:#FFCDD2;color:#B71C1C;font-size:10px;padding:1px 6px;border-radius:8px;font-weight:700">NOT PICKED UP</span>';
        return `<div style="margin-top:4px;font-weight:600;line-height:1.4">${esc(names.join(', ') || 'Active prescription')}${fromClinic}${pickup}</div>`;
      }).join('');
      const more = activeMeds.length > 5 ? `<div style="font-size:11px;opacity:.7;margin-top:4px">+${activeMeds.length - 5} more</div>` : '';
      html += `<div class="pp-alert" style="background:#FFEBEE;color:#B71C1C;border-left:4px solid #C62828;flex-direction:column;align-items:stretch">
        <div style="display:flex;align-items:center;gap:8px">
          <span class="material-icons-outlined" style="font-size:18px">medication</span>
          <strong>CURRENT MEDS — check for interactions</strong>
        </div>
        ${medList}${more}
      </div>`;
    }

    if (notNone(allergies)) {
      html += `<div class="pp-alert allergy">
        <span class="material-icons-outlined" style="font-size:18px;flex-shrink:0">warning</span>
        <div><strong>ALLERGY:</strong> ${esc(allergies.join(' · '))}</div>
      </div>`;
    }
    if (notNone(chronic)) {
      html += `<div class="pp-alert chronic">
        <span class="material-icons-outlined" style="font-size:18px;flex-shrink:0">monitor_heart</span>
        <div><strong>CHRONIC:</strong> ${esc(chronic.join(' · '))}</div>
      </div>`;
    }
    if (blood && blood !== 'Unknown') {
      html += `<div class="pp-alert blood">
        <span class="material-icons-outlined" style="font-size:18px;flex-shrink:0">water_drop</span>
        <div><strong>Blood Group:</strong> ${esc(blood)}</div>
      </div>`;
    }
    if (patient.medical_notes) {
      html += `<div class="pp-alert notes">
        <span class="material-icons-outlined" style="font-size:18px;flex-shrink:0">sticky_note_2</span>
        <div>${esc(patient.medical_notes)}</div>
      </div>`;
    }

    const hasIntake = notNone(allergies) || notNone(chronic) || (blood && blood !== 'Unknown');
    const canEdit   = patient.clinicPatientId || patient.id;
    if (!hasIntake && canEdit) {
      html += `<div style="background:#FFF8E1;border:1px dashed #FFC107;border-radius:10px;padding:10px 14px;font-size:12px;color:#5D4037;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        <span class="material-icons-outlined" style="font-size:16px;color:#F57C00;flex-shrink:0">assignment_late</span>
        <span>No medical intake on file for this patient.</span>
        <button id="openIntakeBtn" style="margin-left:auto;padding:6px 12px;background:#F57C00;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Record intake</button>
      </div>`;
    } else if (hasIntake && canEdit) {
      html += `<div style="text-align:right;margin-bottom:8px">
        <button id="openIntakeBtn" style="padding:5px 12px;background:none;border:1px solid #E0E0E0;border-radius:8px;font-size:11px;color:#5F6368;cursor:pointer;font-family:inherit">
          <span class="material-icons-outlined" style="font-size:13px;vertical-align:-2px">edit</span> Edit intake
        </button>
      </div>`;
    }

    if (history === null) {
      html += '<div style="color:#9AA0A6;text-align:center;font-size:13px;padding:8px 0">Loading visit history…</div>';
    } else if (!history.length) {
      html += `<div style="color:#9AA0A6;font-size:13px;padding:8px 0;text-align:center">
        <span class="material-icons-outlined" style="font-size:24px;display:block;margin-bottom:4px;color:#E0E0E0">history</span>
        No previous visits recorded.
      </div>`;
    } else {
      if (!consent) {
        html += `<div style="background:#E3F2FD;border-radius:10px;padding:10px 14px;font-size:12px;color:#0D47A1;margin-bottom:10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="material-icons-outlined" style="font-size:16px;flex-shrink:0">lock</span>
          <span style="flex:1">Showing <strong>this clinic's records only</strong>. Patient hasn't consented to cross-clinic sharing.</span>
          <button id="requestConsentBtn" style="padding:6px 12px;background:#1565C0;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Request consent</button>
        </div>`;
      } else {
        html += `<div style="background:#E8F5E9;border-radius:10px;padding:8px 12px;font-size:12px;color:#1B5E20;margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <span class="material-icons-outlined" style="font-size:16px">verified</span>
          Patient consented — showing records from all clinics.
        </div>`;
      }

      const missed = history.filter(h => h.missed).length;
      if (missed) {
        html += `<div style="background:#FFEBEE;border-radius:8px;padding:8px 12px;font-size:12px;color:#C62828;margin-bottom:8px;display:flex;align-items:center;gap:6px">
          <span class="material-icons-outlined" style="font-size:16px">event_busy</span>
          <strong>${missed} missed appointment${missed !== 1 ? 's' : ''}</strong> on record
        </div>`;
      }

      html += '<div class="pp-section-title">Visit History</div>';
      history.slice(0, 3).forEach((h, i) => {
        const d       = new Date(h.created_at);
        const dateStr = d.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' });
        const meds    = Array.isArray(h.prescription_items) ? h.prescription_items.length : 0;
        const noShow  = h.missed;
        html += `<div class="pp-row">
          <span class="pp-row-label" style="font-size:12px">${i === 0 ? 'Last visit' : dateStr}</span>
          <span class="pp-row-value" style="font-size:12px">
            ${i === 0 ? '<strong>' + esc(dateStr) + '</strong> · ' : ''}${esc(h.clinic_name || 'This clinic')}
            <br><span style="color:#5F6368">${esc(h.confirmed_diagnosis || 'Pending')}${noShow ? ' <span style="color:#C62828;font-weight:700"> · No-show</span>' : ''}</span>
            ${meds ? `<br><span style="color:#1565C0">${meds} med${meds !== 1 ? 's' : ''} prescribed</span>` : ''}
          </span>
        </div>`;
      });
      if (history.length > 3) {
        html += `<div style="text-align:center;font-size:12px;color:#9AA0A6;padding-top:6px">${history.length - 3} more visit${history.length - 3 !== 1 ? 's' : ''} on record</div>`;
      }
    }

    html += '</div>';
    card.innerHTML = html;

    const intakeBtn = card.querySelector('#openIntakeBtn');
    if (intakeBtn) intakeBtn.onclick = () => openIntakeModal(state.patient);

    const consentBtn = card.querySelector('#requestConsentBtn');
    if (consentBtn) consentBtn.onclick = () => requestConsent(state.patient);
  }

  async function requestConsent(patient) {
    if (!supabase) return;
    if (!confirm('Ask the patient verbally:\n\n"Do you consent to sharing your medical history with other Homatt-network clinics for safer care?"\n\nOnce they agree, tap OK to record their consent.')) return;
    try {
      await supabase.rpc('record_patient_consent', {
        p_phone: patient.phone || null,
        p_clinic_patient_id: patient.clinicPatientId || null,
      });
      state.patient.consent_share_history = true;
      showToast('Consent recorded', 'success');
      loadPatientProfile(state.patient);
    } catch(e) {
      showToast('Error recording consent: ' + e.message, 'error');
    }
  }

  // ════════════════════════════════════════════════════════════════
  // INTAKE MODAL
  // ════════════════════════════════════════════════════════════════
  let _selectedBloodGroup = '';

  document.querySelectorAll('.bg-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bg-chip').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _selectedBloodGroup = btn.dataset.bg;
    });
  });

  function openIntakeModal(patient) {
    const modal = document.getElementById('intakeModal');
    if (!modal || !patient) return;
    document.getElementById('intakeAllergies').value = (patient.allergies || []).join(', ');
    document.getElementById('intakeChronic').value   = (patient.chronic_conditions || []).join(', ');
    document.getElementById('intakeNotes').value     = patient.medical_notes || '';
    _selectedBloodGroup = patient.blood_group || '';
    document.querySelectorAll('.bg-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bg === _selectedBloodGroup);
    });
    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('intakeAllergies').focus(), 120);
  }

  document.getElementById('intakeCancelBtn').onclick = () => {
    document.getElementById('intakeModal').style.display = 'none';
  };
  document.getElementById('intakeSkipBtn').onclick = () => {
    document.getElementById('intakeModal').style.display = 'none';
  };

  document.getElementById('intakeSaveBtn').onclick = async () => {
    const patient = state.patient;
    if (!supabase) { showToast('Database unavailable', 'error'); return; }

    const allergiesRaw = document.getElementById('intakeAllergies').value.trim();
    const chronicRaw   = document.getElementById('intakeChronic').value.trim();
    const notes        = document.getElementById('intakeNotes').value.trim();
    const blood        = _selectedBloodGroup;

    const allergiesArr = allergiesRaw ? allergiesRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const chronicArr   = chronicRaw   ? chronicRaw.split(',').map(s => s.trim()).filter(Boolean)   : [];

    if (!patient.clinicPatientId && !patient.id) {
      showToast('Register the patient first before saving intake', 'error'); return;
    }

    const btn = document.getElementById('intakeSaveBtn');
    const origHTML = btn.innerHTML;
    btn.disabled = true; btn.textContent = 'Saving…';

    try {
      if (patient.clinicPatientId) {
        await supabase.rpc('save_patient_intake', {
          p_clinic_patient_id: patient.clinicPatientId,
          p_allergies:  allergiesArr,
          p_chronic:    chronicArr,
          p_blood_group: blood || null,
          p_medical_notes: notes || null,
        });
      } else if (patient.id) {
        await supabase.from('profiles').update({
          allergies:          allergiesArr,
          chronic_conditions: chronicArr,
          blood_group:        blood || null,
          medical_notes:      notes || null,
        }).eq('id', patient.id);
      }

      Object.assign(state.patient, {
        allergies:          allergiesArr,
        chronic_conditions: chronicArr,
        blood_group:        blood || null,
        medical_notes:      notes || null,
        _profilePreloaded:  true,
      });

      document.getElementById('intakeModal').style.display = 'none';
      showToast('Intake saved', 'success');
      loadPatientProfile(state.patient);
    } catch(e) {
      showToast('Error: ' + e.message, 'error');
    }
    btn.disabled = false; btn.innerHTML = origHTML;
  };

  // ── Quick-register modal ─────────────────────────────────────────
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

  // ── Diagnosis input ──────────────────────────────────────────────
  document.getElementById('confirmedDx').addEventListener('input', e => {
    state.confirmedDx = e.target.value;
  });

  // ── Severity chips ───────────────────────────────────────────────
  document.querySelectorAll('#sevChips .sev-chip').forEach(b => {
    b.onclick = () => {
      document.querySelectorAll('#sevChips .sev-chip').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.severity = b.dataset.sev;
    };
  });

  // ── Lab test chips (all groups) ──────────────────────────────────
  function renderLabSelectedTray() {
    const tray = document.getElementById('labSelectedTray');
    if (!tray) return;
    if (!state.labTests.length) { tray.style.display = 'none'; tray.innerHTML = ''; return; }
    tray.style.display = 'flex';
    tray.innerHTML = state.labTests.map(t =>
      `<span class="lab-tray-chip" data-lab="${esc(t)}"
         style="display:inline-flex;align-items:center;gap:4px;background:#E3F2FD;color:#0D47A1;border:1.5px solid #1565C0;padding:4px 10px;border-radius:14px;font-size:12px;font-weight:700;cursor:pointer">
         ${esc(t)} <span class="material-icons-outlined" style="font-size:14px">close</span>
       </span>`
    ).join('');
    tray.querySelectorAll('.lab-tray-chip').forEach(chip => {
      chip.onclick = () => {
        const lab = chip.dataset.lab;
        const idx = state.labTests.indexOf(lab);
        if (idx >= 0) state.labTests.splice(idx, 1);
        // Sync the matching chip's visual state
        document.querySelectorAll('.lab-chip').forEach(c => {
          if (c.dataset.lab === lab) c.classList.remove('active');
        });
        renderLabSelectedTray();
      };
    });
  }

  document.querySelectorAll('.lab-chip').forEach(b => {
    b.onclick = () => {
      b.classList.toggle('active');
      const lab = b.dataset.lab;
      const i = state.labTests.indexOf(lab);
      if (i === -1) state.labTests.push(lab); else state.labTests.splice(i, 1);
      renderLabSelectedTray();
    };
  });

  // ── Lab search / filter ──────────────────────────────────────────
  const labSearchEl   = document.getElementById('labSearch');
  const labSearchClr  = document.getElementById('labSearchClear');
  const labNoMatchEl  = document.getElementById('labNoMatch');

  function applyLabFilter() {
    const q = (labSearchEl?.value || '').trim().toLowerCase();
    if (labSearchClr) labSearchClr.style.display = q ? 'block' : 'none';
    let anyVisible = false;
    document.querySelectorAll('.lab-chip').forEach(chip => {
      const lab  = (chip.dataset.lab || '').toLowerCase();
      const text = (chip.textContent || '').toLowerCase();
      const match = !q || lab.includes(q) || text.includes(q);
      chip.style.display = match ? '' : 'none';
      if (match) anyVisible = true;
    });
    document.querySelectorAll('.lab-group').forEach(group => {
      const visible = Array.from(group.querySelectorAll('.lab-chip'))
        .some(c => c.style.display !== 'none');
      group.style.display = visible ? '' : 'none';
    });
    if (labNoMatchEl) labNoMatchEl.style.display = (q && !anyVisible) ? 'block' : 'none';
  }

  if (labSearchEl) {
    labSearchEl.addEventListener('input', applyLabFilter);
    labSearchEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') { labSearchEl.value = ''; applyLabFilter(); }
    });
  }
  if (labSearchClr) {
    labSearchClr.onclick = () => {
      if (labSearchEl) { labSearchEl.value = ''; labSearchEl.focus(); }
      applyLabFilter();
    };
  }

  document.getElementById('labResults').addEventListener('input', e => {
    state.labResults = e.target.value;
  });

  // ── Care level toggle ────────────────────────────────────────────
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

  // ── Step 1 → Step 2 ─────────────────────────────────────────────
  document.getElementById('step1Next').onclick = () => {
    if (!state.patient) { showToast('Select a patient first', 'error'); return; }
    if (!state.confirmedDx.trim()) {
      showToast('Enter the confirmed diagnosis', 'error');
      document.getElementById('confirmedDx').focus();
      return;
    }
    showStep(2);
  };

  // ── Pre-fill from URL params ─────────────────────────────────────
  (function preFillFromURL() {
    const p = new URLSearchParams(window.location.search);
    const name        = p.get('patient_name');
    const phone       = p.get('patient_phone');
    const id          = p.get('patient_id');
    const cpId        = p.get('clinic_patient_id');
    const bookingId   = p.get('booking_id');
    const bookingCode = p.get('booking_code');

    if (bookingId) {
      state.bookingId   = bookingId;
      state.bookingCode = bookingCode || null;
    }

    if (name && (phone || bookingId)) {
      selectPatient({
        id: id || null,
        clinicPatientId: cpId || null,
        name, phone: phone || '',
        registered: !!id,
        fromBooking: !!bookingId,
      });
      // Patient is pre-selected. Clinician fills in diagnosis before advancing.
      return;
    }
    setTimeout(() => phoneInput.focus(), 200);
  })();

  // ════════════════════════════════════════════════════════════════
  // SCREEN 2: Medications
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

  async function loadClinicInventory() {
    if (!supabase) return;
    try {
      const clinicId = await resolveClinicId(supabase, session);
      if (!clinicId) return;
      const { data } = await supabase.rpc('get_clinic_stock', { p_clinic_id: clinicId });
      state.clinicInventory = data || [];
    } catch(e) {}
  }

  loadFormulary();
  loadClinicInventory();

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
      inventoryItemId: null,
      qtyToDeduct: 0,
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
        ${m.inventoryItemId ? (() => {
          const inv = state.clinicInventory.find(x => x.id === m.inventoryItemId);
          const stockBg = inv?.is_critical ? '#FFEBEE' : inv?.is_low_stock ? '#FFF3E0' : '#E8F5E9';
          const stockClr = inv?.is_critical ? '#C62828' : inv?.is_low_stock ? '#E65100' : '#1B5E20';
          const stockTxt = inv ? `${inv.quantity} ${inv.unit} in stock` : 'In clinic stock';
          return `<div style="font-size:11px;color:${stockClr};background:${stockBg};padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;margin-bottom:6px">
            <span class="material-icons-outlined" style="font-size:12px">inventory_2</span>${esc(stockTxt)}</div>`;
        })() : ''}

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
          ${m.inventoryItemId ? `<div>
            <label class="field-label">Units used (${esc(state.clinicInventory.find(x=>x.id===m.inventoryItemId)?.unit||'units')})</label>
            <input class="field-input qty-deduct-input" data-idx="${i}"
              type="number" min="0" step="1" value="${m.qtyToDeduct||''}" placeholder="0"
              style="border-color:#00897B">
          </div>` : ''}
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
    ct.querySelectorAll('.qty-deduct-input').forEach(input => {
      input.addEventListener('input', e => {
        const i = parseInt(input.dataset.idx,10);
        state.medications[i].qtyToDeduct = parseFloat(e.target.value) || 0;
      });
    });
  }

  function onDrugInput(e, idx) {
    const q = e.target.value.trim().toLowerCase();
    state.medications[idx].drug = e.target.value;
    state.medications[idx].inventoryItemId = null;
    state.medications[idx].qtyToDeduct     = 0;
    const menu = document.querySelector(`.drug-menu[data-idx="${idx}"]`);
    if (!q) { menu.style.display = 'none'; return; }

    const invMatches = state.clinicInventory.filter(inv =>
      inv.item_type === 'medicine' &&
      inv.item_name.toLowerCase().includes(q)
    ).slice(0, 5);

    const formMatches = state.formulary.filter(d =>
      d.name.toLowerCase().includes(q) || (d.generic_name||'').toLowerCase().includes(q)
    ).slice(0, 6);

    if (!invMatches.length && !formMatches.length) { menu.style.display = 'none'; return; }

    const invHtml = invMatches.map(inv => {
      const stockBg  = inv.is_critical ? '#FFEBEE' : inv.is_low_stock ? '#FFF3E0' : '#E8F5E9';
      const stockClr = inv.is_critical ? '#C62828' : inv.is_low_stock ? '#E65100' : '#1B5E20';
      return `<div class="autocomplete-item" data-inv-id="${esc(inv.id)}" data-inv-name="${esc(inv.item_name)}"
                   style="border-left:3px solid #00897B">
        <div class="ac-name" style="display:flex;align-items:center;gap:6px">
          ${esc(inv.item_name)}
          <span style="font-size:10px;background:${stockBg};color:${stockClr};padding:1px 6px;border-radius:10px;font-weight:700">${inv.quantity} ${esc(inv.unit)}</span>
        </div>
        <div class="ac-cat" style="color:#00897B">From clinic stock</div>
      </div>`;
    }).join('');

    const formHtml = formMatches.map(d => `
      <div class="autocomplete-item" data-name="${esc(d.name)}">
        <div class="ac-name">${esc(d.name)}</div>
        <div class="ac-cat">${esc(d.default_dosage || '')}</div>
      </div>
    `).join('');

    menu.innerHTML = (invMatches.length ? `<div style="padding:4px 12px;font-size:10px;font-weight:700;color:#00897B;text-transform:uppercase;letter-spacing:.4px;background:#F1F8E9">Clinic Stock</div>${invHtml}` : '')
      + (formMatches.length ? `<div style="padding:4px 12px;font-size:10px;font-weight:700;color:#9AA0A6;text-transform:uppercase;letter-spacing:.4px;background:#FAFAFA">Formulary</div>${formHtml}` : '');
    menu.style.display = 'block';

    menu.querySelectorAll('[data-inv-id]').forEach(el => {
      el.onclick = () => {
        const inv = state.clinicInventory.find(x => x.id === el.dataset.invId);
        if (!inv) return;
        state.medications[idx].drug            = inv.item_name;
        state.medications[idx].inventoryItemId = inv.id;
        state.medications[idx].qtyToDeduct     = 1;
        const fMatch = state.formulary.find(d => d.name.toLowerCase() === inv.item_name.toLowerCase());
        if (fMatch) {
          state.medications[idx].dosage       = fMatch.default_dosage || state.medications[idx].dosage;
          state.medications[idx].durationDays = fMatch.default_days   || state.medications[idx].durationDays;
        }
        menu.style.display = 'none';
        autoSetExpectedRecovery();
        renderMeds();
      };
    });

    menu.querySelectorAll('[data-name]').forEach(el => {
      el.onclick = () => {
        const drug = state.formulary.find(d => d.name === el.dataset.name);
        if (!drug) return;
        state.medications[idx].drug            = drug.name;
        state.medications[idx].dosage          = drug.default_dosage || state.medications[idx].dosage;
        state.medications[idx].durationDays    = drug.default_days   || state.medications[idx].durationDays;
        const invLink = state.clinicInventory.find(x =>
          x.item_type === 'medicine' && x.item_name.toLowerCase() === drug.name.toLowerCase()
        );
        if (invLink) {
          state.medications[idx].inventoryItemId = invLink.id;
          state.medications[idx].qtyToDeduct     = 1;
        }
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
    const mm   = String(d.getMonth()+1).padStart(2,'0');
    const dd   = String(d.getDate()).padStart(2,'0');
    const iso  = `${yyyy}-${mm}-${dd}`;
    state.expectedRecovery = iso;
    const el = document.getElementById('expRecovery');
    if (el) el.value = iso;
  }

  document.getElementById('expRecovery').addEventListener('change', e => {
    state.expectedRecovery = e.target.value;
  });

  document.getElementById('addMedBtn').onclick = addMedication;

  // ── Materials (collapsed section) ────────────────────────────────
  const materialsToggle = document.getElementById('materialsToggle');
  const materialsBody   = document.getElementById('materialsBody');
  if (materialsToggle && materialsBody) {
    materialsToggle.onclick = () => {
      const isOpen = materialsBody.style.display !== 'none';
      materialsBody.style.display = isOpen ? 'none' : '';
      materialsToggle.classList.toggle('open', !isOpen);
    };
  }

  function renderMaterials() {
    const ct   = document.getElementById('materialsContainer');
    const hint = document.getElementById('materialsEmptyHint');
    if (!ct) return;
    if (!state.materialsUsed.length) { if (hint) hint.style.display = 'block'; ct.innerHTML = ''; return; }
    if (hint) hint.style.display = 'none';
    ct.innerHTML = state.materialsUsed.map((m, i) => {
      const inv     = state.clinicInventory.find(x => x.id === m.item_id);
      const stockTxt = inv ? ` (${inv.quantity} ${inv.unit} in stock)` : '';
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #F5F5F5">
        <span style="flex:1;font-size:13px;font-weight:600;color:#202124">${esc(m.item_name)}${esc(stockTxt)}</span>
        <input type="number" min="1" step="1" value="${m.qty||1}"
          style="width:60px;padding:5px 8px;border:1.5px solid #00897B;border-radius:8px;font-size:13px;text-align:center;font-family:inherit;outline:none"
          data-mat-idx="${i}" class="mat-qty-input">
        <span style="font-size:12px;color:#9AA0A6">${esc(m.unit||'units')}</span>
        <button class="mat-del-btn" data-idx="${i}" style="background:none;border:none;cursor:pointer;padding:2px">
          <span class="material-icons-outlined" style="font-size:18px;color:#9AA0A6">delete_outline</span>
        </button>
      </div>`;
    }).join('');
    ct.querySelectorAll('.mat-qty-input').forEach(inp => {
      inp.addEventListener('input', e => {
        const i = parseInt(inp.dataset.matIdx, 10);
        state.materialsUsed[i].qty = parseFloat(e.target.value) || 1;
      });
    });
    ct.querySelectorAll('.mat-del-btn').forEach(btn => {
      btn.onclick = () => {
        state.materialsUsed.splice(parseInt(btn.dataset.idx,10), 1);
        renderMaterials();
      };
    });
  }

  function showMaterialPicker() {
    const options = state.clinicInventory.filter(x => x.item_type !== 'medicine' && x.is_active !== false);
    if (!options.length) {
      showToast('No materials/consumables in clinic stock yet. Add them in the Stock Tracker on the dashboard.', 'error');
      return;
    }
    const existing = document.getElementById('matPickerSheet');
    if (existing) existing.remove();

    const sheet = document.createElement('div');
    sheet.id = 'matPickerSheet';
    sheet.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:800;display:flex;align-items:flex-end;justify-content:center';
    sheet.innerHTML = `<div style="background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:500px;max-height:70vh;overflow-y:auto;padding:20px">
      <div style="font-weight:700;font-size:16px;margin-bottom:14px;display:flex;align-items:center;gap:8px">
        <span class="material-icons-outlined" style="color:#00897B">inventory_2</span> Select Material / Consumable
      </div>
      ${options.map(inv => {
        const stockBg  = inv.is_critical ? '#FFEBEE' : inv.is_low_stock ? '#FFF3E0' : '#E8F5E9';
        const stockClr = inv.is_critical ? '#C62828' : inv.is_low_stock ? '#E65100' : '#1B5E20';
        return `<div class="mat-picker-item" data-id="${esc(inv.id)}" data-name="${esc(inv.item_name)}" data-unit="${esc(inv.unit||'units')}"
                     style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1.5px solid #E8EAED;border-radius:10px;margin-bottom:8px;cursor:pointer">
          <div>
            <div style="font-size:13px;font-weight:600">${esc(inv.item_name)}</div>
            <div style="font-size:11px;color:#9AA0A6">${esc(inv.item_type)}</div>
          </div>
          <span style="font-size:11px;background:${stockBg};color:${stockClr};padding:2px 8px;border-radius:10px;font-weight:700">${inv.quantity} ${esc(inv.unit)}</span>
        </div>`;
      }).join('')}
      <button onclick="document.getElementById('matPickerSheet').remove()"
        style="width:100%;padding:12px;margin-top:8px;background:#F5F5F5;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Cancel</button>
    </div>`;
    document.body.appendChild(sheet);

    sheet.querySelectorAll('.mat-picker-item').forEach(el => {
      el.onclick = () => {
        const alreadyIdx = state.materialsUsed.findIndex(m => m.item_id === el.dataset.id);
        if (alreadyIdx >= 0) {
          state.materialsUsed[alreadyIdx].qty++;
        } else {
          state.materialsUsed.push({ item_id: el.dataset.id, item_name: el.dataset.name, unit: el.dataset.unit, qty: 1 });
        }
        sheet.remove();
        renderMaterials();
        if (materialsBody) materialsBody.style.display = '';
        if (materialsToggle) materialsToggle.classList.add('open');
      };
    });
    sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });
  }

  const addMaterialBtn = document.getElementById('addMaterialBtn');
  if (addMaterialBtn) addMaterialBtn.onclick = showMaterialPicker;

  // ── Stock source toggle ──────────────────────────────────────────
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

  // ── Return visit inputs ──────────────────────────────────────────
  function updateFollowUpHint() {
    const hint = document.getElementById('followUpDateHint');
    if (!hint) return;
    const days = Number(state.followUpDays);
    if (!days || days <= 0) { hint.textContent = 'No follow-up scheduled.'; return; }
    const d = new Date();
    d.setDate(d.getDate() + days);
    const label = d.toLocaleDateString('en-UG', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
    hint.textContent = 'Patient should return on ' + label + (state.followUpReason ? ' — for ' + state.followUpReason : '');
  }

  const fuDaysEl = document.getElementById('followUpDays');
  if (fuDaysEl) {
    fuDaysEl.value = state.followUpDays;
    fuDaysEl.addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      state.followUpDays = isNaN(v) ? 0 : Math.max(0, Math.min(365, v));
      updateFollowUpHint();
    });
  }
  const fuReasonEl = document.getElementById('followUpReason');
  if (fuReasonEl) {
    fuReasonEl.addEventListener('input', e => {
      state.followUpReason = e.target.value;
      updateFollowUpHint();
    });
  }
  updateFollowUpHint();

  // ════════════════════════════════════════════════════════════════
  // Background: build follow-up schedule rows
  // ════════════════════════════════════════════════════════════════
  function buildFollowupRows(diagnosisId) {
    const rows  = [];
    const today = new Date();
    today.setSeconds(0, 0);

    function whenAt(daysFromNow, hhmm) {
      const d = new Date(today);
      d.setDate(d.getDate() + daysFromNow);
      const [h,m] = hhmm.split(':').map(Number);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    }

    const firstTime = (state.medications[0]?.intakeTimes?.[0]) || '08:00';
    rows.push({
      diagnosis_id: diagnosisId,
      scheduled_at: whenAt(1, firstTime),
      type: 'check_in',
      message: `How are you feeling after starting your ${state.confirmedDx} treatment? Tap below to tell us.`,
      day_number: 1,
      intake_time: firstTime,
    });

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

    if (state.expectedRecovery) {
      const recDate  = new Date(state.expectedRecovery);
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

  // ════════════════════════════════════════════════════════════════
  // Submit
  // ════════════════════════════════════════════════════════════════
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
      btn.innerHTML = '<span class="material-icons-outlined" style="font-size:20px">send</span> Send Prescription &amp; Start Follow-up';
      return;
    }

    // Validate medications
    if (!state.medications.length) {
      showToast('Add at least one medication', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined" style="font-size:20px">send</span> Send Prescription &amp; Start Follow-up';
      return;
    }
    const medsOk = state.medications.every(m => m.drug && m.dosage && m.intakeTimes.every(t => t));
    if (!medsOk) {
      showToast('Fill in drug name, dosage and intake times for each medication', 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined" style="font-size:20px">send</span> Send Prescription &amp; Start Follow-up';
      return;
    }

    if (!state.expectedRecovery) autoSetExpectedRecovery();

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
      booking_id: state.bookingId || null,
      patient_name: state.patient.name || null,
      patient_phone: state.patient.phone,
      clinic_patient_id: state.patient.clinicPatientId || null,
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
      follow_up_days:    Number(state.followUpDays) > 0 ? Number(state.followUpDays) : null,
      follow_up_reason:  (state.followUpReason || '').trim() || null,
      prescription_items: items,
      intake_schedule: items,
      consultation_fee_ugx: state.feeConsult || 0,
      lab_fee_ugx:          state.feeLab    || 0,
      meds_fee_ugx:         state.feeMeds   || 0,
      total_charged_ugx:    (state.feeConsult + state.feeLab + state.feeMeds) || 0,
      payment_status:       state.paymentStatus || 'pending',
    };

    let dx, dxError;
    ({ data: dx, error: dxError } = await supabase
      .from('clinic_diagnoses')
      .insert(dxPayload)
      .select().single());

    // Graceful fallback if follow_up_reason column not yet migrated
    if (dxError && dxError.message && dxError.message.includes('follow_up_reason')) {
      const compatPayload = Object.assign({}, dxPayload);
      delete compatPayload.follow_up_reason;
      ({ data: dx, error: dxError } = await supabase
        .from('clinic_diagnoses')
        .insert(compatPayload)
        .select().single());
    }

    if (dxError) {
      showToast('Save failed: ' + dxError.message, 'error');
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined" style="font-size:20px">send</span> Send Prescription &amp; Start Follow-up';
      return;
    }

    // 1b. Auto-deduct clinic inventory (fire-and-forget)
    try {
      const invItems = [
        ...state.medications
          .filter(m => m.inventoryItemId && m.qtyToDeduct > 0)
          .map(m => ({ item_id: m.inventoryItemId, qty: m.qtyToDeduct })),
        ...state.materialsUsed
          .filter(m => m.item_id && m.qty > 0)
          .map(m => ({ item_id: m.item_id, qty: m.qty })),
      ];
      if (invItems.length) {
        supabase.rpc('deduct_inventory', {
          p_clinic_id:    _clinicId,
          p_diagnosis_id: dx.id,
          p_booking_id:   state.bookingId || null,
          p_items:        invItems,
        }).then(({ data: dResult }) => {
          const low = dResult?.low_stock;
          if (Array.isArray(low) && low.length) {
            low.forEach(item => showToast(`⚠ Low stock: ${item.item_name} — ${item.quantity} left`, 'error'));
          }
        }).catch(() => {});
      }
    } catch(e) {}

    // 2. Insert e_prescription
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

    // 3. Insert clinic_followups (medication reminders + check-ins)
    const followups = buildFollowupRows(dx.id);
    if (followups.length) {
      try { await supabase.from('clinic_followups').insert(followups); } catch(e) {}
    }

    // 4. Mark booking as attended
    try {
      const now = new Date().toISOString();
      if (state.bookingId) {
        await supabase
          .from('bookings')
          .update({ status: 'attended', attended_at: now, clinic_diagnosis_id: dx.id })
          .eq('id', state.bookingId);
      } else if (state.patient && state.patient.id) {
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        await supabase
          .from('bookings')
          .update({ status: 'attended', attended_at: now, clinic_diagnosis_id: dx.id })
          .eq('patient_user_id', state.patient.id)
          .in('status', ['pending', 'confirmed', 'in_progress'])
          .gte('created_at', since);
      }
    } catch(e) {}

    // 5. Post-consultation push notification
    if (state.patient && state.patient.id) {
      try {
        let title, message;
        if (state.stockSource === 'pharmacy') {
          title   = 'Prescription Ready';
          message = 'Your prescription has been sent to a partner pharmacy. Tap to choose delivery or pickup.';
        } else {
          title   = 'Consultation Complete';
          message = 'Your consultation is done. Please collect your prescription at the clinic pharmacy.';
        }
        await supabase.functions.invoke('send-notification', {
          body: {
            userId:  state.patient.id,
            title,
            message,
            data: { screen: 'prescription', id: dx.id },
            pref_category: 'appointment_reminders',
          }
        });
      } catch(e) {}
    }

    // 6. Show success sheet
    const allTimes  = state.medications.flatMap(m => m.intakeTimes).sort();
    const uniqTimes = [...new Set(allTimes)];

    const successMsgEl = document.getElementById('successMsg');
    if (successMsgEl) {
      successMsgEl.innerHTML = `<strong>${esc(state.patient?.name || 'Patient')}</strong>'s consultation saved. `
        + (state.stockSource === 'pharmacy'
          ? 'Prescription sent to partner pharmacy.'
          : 'Prescription ready at clinic pharmacy.');
    }
    const successRemindersEl = document.getElementById('successReminders');
    if (successRemindersEl) {
      const lines = [
        `📲 <strong>Medication reminders</strong> daily at ${uniqTimes.length ? uniqTimes.join(', ') : '—'}`,
        `💬 <strong>Check-in message</strong> tomorrow at ${uniqTimes[0] || '08:00'}`,
      ];
      if (state.expectedRecovery) {
        lines.push(`🎯 <strong>Course-completion check</strong> on ${state.expectedRecovery}`);
      }
      if (Number(state.followUpDays) > 0) {
        const rd = new Date();
        rd.setDate(rd.getDate() + Number(state.followUpDays));
        lines.push(`📅 <strong>Return visit</strong> — ${rd.toLocaleDateString('en-UG', { weekday:'short', day:'numeric', month:'short' })}`);
      }
      successRemindersEl.innerHTML = lines.map(l =>
        `<div style="font-size:12px;color:#2E7D32;padding:3px 0">${l}</div>`
      ).join('');
    }
    const successSheet = document.getElementById('successSheet');
    if (successSheet) successSheet.style.display = 'flex';
  };

  // Initialise
  showStep(1);
  addMedication();

  window._wizState = state;
  window._showStep = showStep;
  window._wizEsc   = esc;
})();
