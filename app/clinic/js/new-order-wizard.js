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
  // Consultations are clinical — receptionists are sent back to the dashboard.
  if (!requireClinicCap('consultations')) return;
  try { applyRoleGating(); } catch (e) {}   // hide nav links this role can't use
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
    b.onclick = () => { if (state.step > 1) showStep(state.step - 1); });

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

  // Search the locally-cached patient pool (built by the dashboard from recent
  // consultations). Instant, works fully offline — no network at all.
  function searchLocalPatients(q) {
    const CO = window.ClinicOffline;
    if (!CO || !_clinicId) return [];
    const pool = CO.get('hist_pool_' + _clinicId, []) || [];
    const needle = q.toLowerCase();
    const seen = new Set(), rows = [];
    for (const x of pool) {
      const name = x.patient_name || '', phone = x.patient_phone || '';
      if (name.toLowerCase().indexOf(needle) < 0 && phone.indexOf(q) < 0) continue;
      const key = phone + '|' + name;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ id: null, clinicPatientId: null, registered: false, name: name || 'Unnamed', phone });
      if (rows.length >= 8) break;
    }
    return rows;
  }

  async function searchPatients(q) {
    if (!supabase) { renderPatientMenu([], q); return; }

    const CO = window.ClinicOffline;
    // OFFLINE: never touch the network (it hangs the whole search for the full
    // timeout in airplane mode). Answer instantly from the cached pool.
    if (CO && CO.isOffline()) { renderPatientMenu(searchLocalPatients(q), q); return; }

    // SUB-ACCOUNT SAFE PATH: the search_clinic_patients RPC runs with
    // definer rights after verifying the caller is active clinic staff —
    // so clinicians/nurses/receptionists find the clinic's patients even
    // where legacy row security blocked their direct reads. Falls back to
    // the original direct queries if the RPC isn't installed yet.
    try {
      const rpc = supabase.rpc('search_clinic_patients', { p_q: q });
      // Cap the wait so a slow link fails fast to the local cache instead of
      // freezing the search box.
      const r = CO ? await CO.withTimeout(rpc, 6000) : await rpc;
      if (r && r._timeout) { renderPatientMenu(searchLocalPatients(q), q); return; }
      if (!r.error && Array.isArray(r.data)) {
        const seen = new Set();
        const rows = [];
        for (const x of r.data) {
          const key = (x.phone || '') + '|' + (x.full_name || '');
          if (seen.has(key)) continue;
          seen.add(key);
          rows.push({
            id: x.profile_id || null,
            clinicPatientId: x.clinic_patient_id || null,
            registered: !!x.registered,
            name: x.full_name || 'Unnamed',
            phone: x.phone || '',
          });
        }
        renderPatientMenu(rows, q);
        return;
      }
    } catch (e) { /* fall through to direct queries */ }

    const _cap = (p) => CO ? CO.withTimeout(p, 6000) : p;
    const profRes = await _cap(supabase
      .from('profiles')
      .select('id, first_name, last_name, phone_number, phone')
      .or(`phone_number.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(5));
    if (profRes && profRes._timeout) { renderPatientMenu(searchLocalPatients(q), q); return; }
    const profiles = profRes && profRes.data;

    let stubs = [];
    if (_clinicId) {
      const cpRes = await _cap(supabase
        .from('clinic_patients')
        .select('id, full_name, phone')
        .eq('clinic_id', _clinicId)
        .ilike('phone', `%${q}%`)
        .limit(5));
      stubs = (cpRes && !cpRes._timeout && cpRes.data) || [];
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
    // Keep age info on the live patient so smart dosing can pick adult vs child
    if (medProfile && state.patient) {
      if (medProfile.date_of_birth != null) state.patient.date_of_birth = medProfile.date_of_birth;
      if (medProfile.is_child != null)      state.patient.is_child      = medProfile.is_child;
      if (medProfile.sex != null)           state.patient.sex           = medProfile.sex;
      if (window._syncDosingToggle) window._syncDosingToggle();
    }
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
        // A visit from ANOTHER clinic shows where it happened (name + place);
        // a visit here just says "This clinic".
        const foreign = h.clinic_id && _clinicId && h.clinic_id !== _clinicId;
        const place   = [h.clinic_district, h.clinic_address].filter(Boolean).join(', ');
        const whereTxt = foreign
          ? esc(h.clinic_name || 'Partner clinic') + (place ? ' <span style="color:#9AA0A6">(' + esc(place) + ')</span>' : '')
          : esc(h.clinic_name && h.clinic_id !== _clinicId ? h.clinic_name : 'This clinic');
        html += `<div class="pp-row">
          <span class="pp-row-label" style="font-size:12px">${i === 0 ? 'Last visit' : dateStr}</span>
          <span class="pp-row-value" style="font-size:12px">
            ${i === 0 ? '<strong>' + esc(dateStr) + '</strong> · ' : ''}${whereTxt}
            <br><span style="color:#5F6368">${esc(h.confirmed_diagnosis || 'Pending')}${noShow ? ' <span style="color:#C62828;font-weight:700"> · No-show</span>' : ''}</span>
            ${h.clinician_name ? `<br><span style="color:#00796B">Seen by ${esc(h.clinician_name)}</span>` : ''}
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
  function openRegisterModal(prefillPhone, prefillName) {
    document.getElementById('regPhone').value = prefillPhone || phoneInput.value;
    // A referred patient arrives with their name already known — prefill it so
    // registering is a single tap.
    document.getElementById('regName').value = prefillName || '';
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

    const CO = window.ClinicOffline;
    const offline = CO ? CO.isOffline() : (navigator.onLine === false);

    // Resolve the clinic id with NO network round-trip when we already know it
    // (we almost always do). Only look it up online, never while offline —
    // resolveClinicId awaits getSession(), which hangs for the full timeout in
    // airplane mode and was a big part of the ~1-minute wait.
    if (!_clinicId && session?.clinicId) _clinicId = session.clinicId;
    if (!_clinicId && !offline && supabase && !session?.demo) {
      _clinicId = await resolveClinicId(supabase, session);
    }

    // Queue the patient write offline with a local id, so the wizard proceeds
    // instantly and the row syncs later.
    function queueLocally() {
      if (!CO || !_clinicId) return null;
      const id = CO.uuid();
      CO.enqueue('table_upsert', {
        table: 'clinic_patients',
        rows: [{ id, clinic_id: _clinicId, full_name: name, phone, registered_by: session?.userId || null }],
        onConflict: 'clinic_id,phone'
      });
      CO.flush();
      return id;
    }

    function finish(clinicPatientId, msg) {
      selectPatient({ id: null, clinicPatientId, name, phone, registered: false });
      regModal.style.display = 'none';
      btn.disabled = false;
      showToast(msg, 'success');
      // SMS invite is fire-and-forget and ONLINE-only — never await it (it hung
      // the whole flow for a minute in airplane mode).
      if (supabase && !offline) {
        try {
          supabase.functions.invoke('send-sms-invite', {
            body: { phone, name, clinicName: session?.clinicName || 'Clinic' }
          }).catch(() => {});
        } catch (e) {}
      }
    }

    // OFFLINE (or no clinic/supabase): instant local save, no network at all.
    if (offline || !supabase || !_clinicId) {
      finish(queueLocally(), offline ? 'Patient saved — will sync when online' : 'Patient registered');
      return;
    }

    // ONLINE: race the upsert against a short timeout so a slow link can't wedge
    // the wizard; on timeout/failure fall back to the offline queue instantly.
    let clinicPatientId = null;
    try {
      const up = supabase.from('clinic_patients')
        .upsert({ clinic_id: _clinicId, full_name: name, phone, registered_by: session?.userId || null },
                { onConflict: 'clinic_id,phone' })
        .select('id').single();
      const res = CO ? await CO.withTimeout(up, 6000) : await up;
      if (res && res._timeout) throw new Error('timeout');
      if (res && res.data) clinicPatientId = res.data.id;
      else if (res && res.error) throw res.error;
    } catch (e) {
      clinicPatientId = queueLocally();       // couldn't reach server → queue
    }
    finish(clinicPatientId, 'Patient registered');
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

  // ── Custom lab tests (added by clinicians, per clinic, offline-safe) ──
  // Stored in clinic_custom_lab_tests; a local copy lives in ClinicOffline so
  // the chips render (and new ones can be ADDED) with no connection at all.
  function _customLabKey() { return 'custom_labs_' + (_clinicId || 'me'); }

  function wireLabChip(b) {
    b.onclick = () => {
      b.classList.toggle('active');
      const lab = b.dataset.lab;
      const i = state.labTests.indexOf(lab);
      if (i === -1) state.labTests.push(lab); else state.labTests.splice(i, 1);
      renderLabSelectedTray();
    };
  }

  function renderCustomLabChips(names) {
    const group = document.getElementById('customLabGroup');
    const box   = document.getElementById('customLabChips');
    if (!group || !box) return;
    if (!names.length) { group.style.display = 'none'; box.innerHTML = ''; return; }
    group.style.display = '';
    box.innerHTML = names.map(n =>
      `<button type="button" class="lab-chip${state.labTests.indexOf(n) >= 0 ? ' active' : ''}" data-lab="${esc(n)}">${esc(n)}</button>`
    ).join('');
    box.querySelectorAll('.lab-chip').forEach(wireLabChip);
  }

  function loadCustomLabTests() {
    const CO = window.ClinicOffline;
    let names = (CO && CO.get(_customLabKey(), [])) || [];
    renderCustomLabChips(names);
    if (!supabase || !_clinicId || (CO && CO.isOffline())) return;
    supabase.from('clinic_custom_lab_tests').select('test_name')
      .eq('clinic_id', _clinicId).order('test_name')
      .then(res => {
        if (res.error || !res.data) return;
        const fresh = res.data.map(r => r.test_name);
        // Keep local-only names queued offline that haven't synced yet
        const merged = fresh.concat(names.filter(n =>
          !fresh.some(x => x.toLowerCase() === n.toLowerCase())));
        if (CO) CO.set(_customLabKey(), merged);
        renderCustomLabChips(merged);
      }).catch(() => {});
  }
  // Clinic id can resolve late — try now and again shortly after boot.
  loadCustomLabTests();
  setTimeout(loadCustomLabTests, 2500);

  function addCustomLabTest(raw) {
    const name = (raw || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (name.length < 2) { showToast('Type the test name in the search box first', 'error'); return; }
    // Already exists anywhere (built-in or custom)? Just select it.
    const all = Array.from(document.querySelectorAll('.lab-chip'));
    const dup = all.find(c => (c.dataset.lab || '').toLowerCase() === name.toLowerCase());
    if (dup) {
      if (!dup.classList.contains('active')) dup.click();
    } else {
      const CO = window.ClinicOffline;
      const list = (CO && CO.get(_customLabKey(), [])) || [];
      list.push(name);
      if (CO) CO.set(_customLabKey(), list);
      renderCustomLabChips(list);
      // Select it immediately
      state.labTests.push(name);
      renderLabSelectedTray();
      renderCustomLabChips(list);
      // Register in the backend — queued offline, synced automatically.
      const row = { clinic_id: _clinicId, test_name: name };
      if (CO) {
        row.id = CO.uuid();
        CO.enqueue('table_insert', { table: 'clinic_custom_lab_tests', row: row, stripUnknownColumns: true });
        CO.flush();
      } else if (supabase && _clinicId) {
        supabase.from('clinic_custom_lab_tests').insert(row).then(() => {}).catch(() => {});
      }
    }
    const se = document.getElementById('labSearch');
    if (se) { se.value = ''; }
    applyLabFilter();
    showToast('"' + name + '" added to your clinic\'s tests', 'success');
  }

  // ── Lab search / filter ──────────────────────────────────────────
  const labSearchEl   = document.getElementById('labSearch');
  const labSearchClr  = document.getElementById('labSearchClear');
  const labNoMatchEl  = document.getElementById('labNoMatch');

  function applyLabFilter() {
    const q = (labSearchEl?.value || '').trim().toLowerCase();
    const qEl = document.getElementById('labNoMatchQ');
    if (qEl) qEl.textContent = (labSearchEl?.value || '').trim();
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

  const labAddBtn = document.getElementById('labAddNewBtn');
  if (labAddBtn) labAddBtn.onclick = () => addCustomLabTest(labSearchEl ? labSearchEl.value : '');

  document.getElementById('labResults').addEventListener('input', e => {
    state.labResults = e.target.value;
  });

  // ── Refer to a partner clinic (offline-safe, auto-notifies them) ──
  let _refReason = '';
  const _refKey = () => 'partner_clinics';

  function loadPartnerClinics() {
    const sel = document.getElementById('refClinicSel');
    if (!sel) return;
    const CO = window.ClinicOffline;
    const paint = (rows) => {
      if (!rows || !rows.length) {
        sel.innerHTML = '<option value="">No partner clinics found yet</option>';
        return;
      }
      sel.innerHTML = '<option value="">Choose a clinic…</option>' + rows.map(c =>
        `<option value="${esc(c.id)}" data-phone="${esc(c.phone || '')}" data-place="${esc([c.district, c.address].filter(Boolean).join(', '))}">${esc(c.name)}${c.district ? ' — ' + esc(c.district) : ''}</option>`
      ).join('');
    };
    const cached = CO && CO.get(_refKey(), null);
    if (cached) paint(cached);
    if (!supabase || (CO && CO.isOffline())) { if (!cached) paint([]); return; }
    supabase.from('clinics').select('id,name,phone,district,address')
      .neq('id', _clinicId || '00000000-0000-0000-0000-000000000000')
      .eq('active', true).order('name').limit(150)
      .then(res => {
        if (res.error || !res.data) return;
        if (CO) CO.set(_refKey(), res.data);
        paint(res.data);
      }).catch(() => {});
  }

  function openReferralModal() {
    if (!state.patient) { showToast('Select or register the patient first', 'error'); return; }
    const m = document.getElementById('refModal');
    if (!m) return;
    document.getElementById('refPatientLine').textContent =
      state.patient.name + (state.patient.phone ? ' · ' + state.patient.phone : '');
    document.getElementById('refDone').style.display = 'none';
    document.getElementById('refError').style.display = 'none';
    document.getElementById('refCreateBtn').style.display = '';
    document.getElementById('refNotes').value = '';
    document.getElementById('refNeededItem').value = '';
    document.getElementById('refNeededItem').style.display = 'none';
    _refReason = '';
    document.querySelectorAll('.ref-reason').forEach(b => b.classList.remove('active'));
    loadPartnerClinics();
    m.style.display = 'flex';
  }

  document.getElementById('referOutBtn')?.addEventListener('click', openReferralModal);
  document.getElementById('refCancelBtn')?.addEventListener('click', () => {
    document.getElementById('refModal').style.display = 'none';
  });
  document.getElementById('refModal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) e.currentTarget.style.display = 'none';
  });
  document.querySelectorAll('.ref-reason').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.ref-reason').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      _refReason = b.dataset.r;
      // Ask WHICH item when the reason is a missing drug or test
      const ni = document.getElementById('refNeededItem');
      const wants = /medicine|lab/i.test(_refReason);
      ni.style.display = wants ? '' : 'none';
      if (wants) ni.focus();
    });
  });

  document.getElementById('refCreateBtn')?.addEventListener('click', () => {
    const errEl = document.getElementById('refError');
    const fail = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };
    errEl.style.display = 'none';
    const sel = document.getElementById('refClinicSel');
    const toId = sel.value;
    if (!toId) return fail('Choose the clinic to refer to.');
    if (!_refReason) return fail('Pick a reason.');
    const opt = sel.options[sel.selectedIndex];
    const CO = window.ClinicOffline;
    const code = 'RF-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    const row = {
      from_clinic_id: _clinicId,
      to_clinic_id: toId,
      patient_name: state.patient.name,
      patient_phone: state.patient.phone || null,
      reason: _refReason,
      needed_item: (document.getElementById('refNeededItem').value || '').trim() || null,
      notes: (document.getElementById('refNotes').value || '').trim() || null,
      referral_code: code,
    };
    if (!_clinicId) return fail('Your account is not linked to a clinic yet — reconnect once and retry.');
    if (CO) {
      row.id = CO.uuid();
      CO.enqueue('table_insert', { table: 'clinic_referrals', row: row, stripUnknownColumns: true });
      CO.flush();
    } else if (supabase) {
      supabase.from('clinic_referrals').insert(row).then(() => {}).catch(() => {});
    }
    // Success view + WhatsApp handoff for the patient
    const clinicName  = opt.textContent;
    const clinicPhone = opt.dataset.phone || '';
    const clinicPlace = opt.dataset.place || '';
    document.getElementById('refCodeOut').textContent = code;
    document.getElementById('refClinicDetails').innerHTML =
      '<strong>' + esc(clinicName) + '</strong><br>' +
      (clinicPlace ? esc(clinicPlace) + '<br>' : '') +
      (clinicPhone ? '📞 ' + esc(clinicPhone) : '');
    const msg = 'Hello ' + state.patient.name + ', you have been referred to ' + clinicName
      + (clinicPlace ? ' (' + clinicPlace + ')' : '')
      + (clinicPhone ? ', tel ' + clinicPhone : '')
      + '. Your referral code is ' + code + '. Please show this message when you arrive. — Homatt Health';
    const waTarget = (state.patient.phone || '').replace(/[^0-9]/g, '').replace(/^0/, '256');
    document.getElementById('refWhatsBtn').href =
      'https://wa.me/' + (waTarget || '') + '?text=' + encodeURIComponent(msg);
    document.getElementById('refDone').style.display = 'block';
    document.getElementById('refCreateBtn').style.display = 'none';
    showToast('Referral sent' + ((CO && CO.isOffline()) ? ' — will sync when online' : ''), 'success');
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

  // Resolve a phone number against the clinic's patients. Returns the matching
  // patient row (with their real ids so history links up) or null. Used when a
  // REFERRED patient is opened from the dashboard: if they're already in the
  // system we skip straight to the assessment; if not, we register them first.
  async function _resolvePatientByPhone(phone) {
    const q = normPhone(phone);
    if (!q || q.length < 4) return null;
    const CO = window.ClinicOffline;
    const pick = (rows) => {
      if (!rows || !rows.length) return null;
      const exact = rows.find(r => normPhone(r.phone) === q);
      return exact || rows[0];
    };
    // Offline → the saved patient pool only (never touch the network).
    if (CO && CO.isOffline()) return pick(searchLocalPatients(q));
    try {
      const rpc = supabase.rpc('search_clinic_patients', { p_q: q });
      const r = CO ? await CO.withTimeout(rpc, 6000) : await rpc;
      if (r && !r._timeout && !r.error && Array.isArray(r.data) && r.data.length) {
        return pick(r.data.map(x => ({
          id: x.profile_id || null,
          clinicPatientId: x.clinic_patient_id || null,
          registered: !!x.registered,
          name: x.full_name || '',
          phone: x.phone || '',
        })));
      }
    } catch (e) {}
    // Fallback: this clinic's own patient stubs.
    try {
      if (_clinicId) {
        const cq = supabase.from('clinic_patients').select('id, full_name, phone')
          .eq('clinic_id', _clinicId).ilike('phone', '%' + q + '%').limit(5);
        const cr = CO ? await CO.withTimeout(cq, 6000) : await cq;
        if (cr && !cr._timeout && cr.data && cr.data.length) {
          return pick(cr.data.map(s => ({
            id: null, clinicPatientId: s.id, registered: false,
            name: s.full_name || '', phone: s.phone || '',
          })));
        }
      }
    } catch (e) {}
    // Last resort: locally cached pool (may know them from a past visit).
    return pick(searchLocalPatients(q));
  }

  // A referral opened from the dashboard: mark it attended once the
  // consultation is saved, so it leaves "Referrals Received" by itself.
  function _closeReferralIfAny() {
    const rid = state.referralId;
    if (!rid) return;
    state.referralId = null;                      // once only
    try {
      const CO = window.ClinicOffline;
      if (CO) {
        // Must go through the RPC: a plain UPDATE from the RECEIVING clinic is
        // rejected by the referral RLS policy (its WITH CHECK only allows the
        // sender's clinic), so the sending clinic would never see it attended.
        // enqueue('rpc') not enqueueRpc(): the latter injects a p_op_id arg this
        // function doesn't take (wasted failed call). Setting a fixed status is
        // idempotent anyway.
        CO.enqueue('rpc', { fn: 'set_referral_status', args: { p_referral_id: rid, p_status: 'seen' } });
        CO.flush();
        // Keep the cached inbox in step so it disappears immediately.
        try {
          const key = 'referrals_in_' + _clinicId;
          const cached = CO.get(key, null);
          if (cached) CO.set(key, cached.map(r => r.id === rid ? Object.assign({}, r, { status: 'seen' }) : r));
        } catch (e) {}
      } else if (supabase) {
        supabase.rpc('set_referral_status', { p_referral_id: rid, p_status: 'seen' }).then(() => {}).catch(() => {});
      }
    } catch (e) {}
  }

  // ── Pre-fill from URL params ─────────────────────────────────────
  (function preFillFromURL() {
    const p = new URLSearchParams(window.location.search);
    const name        = p.get('patient_name');
    const phone       = p.get('patient_phone');
    const id          = p.get('patient_id');
    const cpId        = p.get('clinic_patient_id');
    const bookingId   = p.get('booking_id');
    const bookingCode = p.get('booking_code');
    const referralId  = p.get('referral_id');
    const lookup      = p.get('lookup') === '1' || !!referralId;

    if (bookingId) {
      state.bookingId   = bookingId;
      state.bookingCode = bookingCode || null;
    }
    if (referralId) state.referralId = referralId;

    // REFERRED PATIENT: resolve them against the system first.
    //  • already in the system → select them and go straight to the assessment
    //  • not in the system     → open Register (prefilled) so one tap adds them,
    //                            then the same assessment steps continue
    if (lookup && phone) {
      phoneInput.value = phone;
      const hint = document.getElementById('patientResults');
      if (hint) {
        hint.style.display = 'block';
        hint.innerHTML = '<div style="padding:12px;color:#5F6368;font-size:13px">Checking if this patient is already in your system…</div>';
      }
      (async () => {
        let found = null;
        try { found = await _resolvePatientByPhone(phone); } catch (e) {}
        if (hint) { hint.style.display = 'none'; hint.innerHTML = ''; }
        if (found) {
          selectPatient({
            id: found.id || null,
            clinicPatientId: found.clinicPatientId || null,
            name: found.name || name || 'Patient',
            phone: found.phone || phone,
            registered: !!found.registered,
          });
          try { showToast('Referred patient found — continue the consultation', 'success'); } catch (e) {}
        } else {
          openRegisterModal(phone, name || '');
          try { showToast('New patient — register them to continue', 'info'); } catch (e) {}
        }
      })();
      return;
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
    const CO = window.ClinicOffline;
    const run = () => supabase
      .from('formulary')
      .select('name, generic_name, category, default_dosage, common_dosages, default_days')
      .order('name');
    try {
      // Cached: the drug list is available offline so the wizard is fully usable
      // with no connection (was empty offline → looked broken).
      const res = CO ? await CO.cachedQuery('formulary_global', run) : await run();
      state.formulary = (res.data && res.data.length) ? res.data : FALLBACK_FORMULARY;
    } catch(e) { state.formulary = FALLBACK_FORMULARY; }
  }

  async function loadClinicInventory() {
    if (!supabase) return;
    const CO = window.ClinicOffline;
    try {
      const clinicId = await resolveClinicId(supabase, session);
      if (!clinicId) return;
      // Reuse the dashboard's stock cache key so the wizard shows your real stock
      // offline (to prescribe from it and deduct correctly).
      const run = () => supabase.rpc('get_clinic_stock', { p_clinic_id: clinicId });
      const res = CO ? await CO.cachedQuery('stock_' + clinicId, run) : await run();
      state.clinicInventory = res.data || [];
    } catch(e) {}
  }

  loadFormulary();
  loadClinicInventory();

  // Opening the app should land on Home — not a blank New Consultation that the
  // OS resumed. If the app is brought back and this wizard is completely
  // untouched, go to the dashboard. ANY entered work (patient, diagnosis, meds,
  // labs, or a booking) keeps the user here so nothing is ever lost.
  (function () {
    let _hiddenAt = 0;
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { _hiddenAt = Date.now(); return; }
      const untouched = state.step === 1 && !state.patient && !state.bookingId &&
        !state.confirmedDx && !(state.medications && state.medications.length) &&
        !(state.labTests && state.labTests.length) && !(state.materialsUsed && state.materialsUsed.length);
      if (untouched && _hiddenAt && (Date.now() - _hiddenAt > 2500)) {
        window.location.replace('dashboard.html');
      }
    });
  })();

  const DEFAULT_TIMES = {
    1: ['08:00'],
    2: ['08:00','20:00'],
    3: ['08:00','14:00','20:00'],
    4: ['07:00','12:00','17:00','22:00'],
  };

  // ── Smart prescription defaults ─────────────────────────────────
  // The clinician just types the drug; dose, times/day, intake times and
  // duration fill themselves from standard Uganda outpatient regimens —
  // adult or child depending on the patient. Every field stays editable.
  // Each regimen may carry adult / child / infant (<1 yr) doses. `preg:true`
  // flags drugs to avoid/verify in pregnancy (shown for female & unknown-sex
  // adults). `wt:true` marks weight-based paediatric dosing where an estimated
  // weight hint is most useful.
  const DRUG_REGIMENS = [
    { match:['paracetamol','panadol','acetaminophen'],
      adult:{dose:'1g (2 tabs of 500mg)', times:3, days:3},
      child:{dose:'15mg/kg per dose (syrup 120mg/5ml)', times:3, days:3, wt:true},
      infant:{dose:'15mg/kg (syrup 120mg/5ml)', times:3, days:3, wt:true} },
    { match:['coartem','artemether','lumefantrine','duo-cotecxin','artefan'],
      adult:{dose:'4 tabs per dose',      times:2, days:3},
      child:{dose:'1–3 tabs per dose by weight (5–14kg:1, 15–24kg:2, 25–34kg:3)', times:2, days:3, wt:true},
      infant:{dose:'1 tab per dose (5–14kg)', times:2, days:3, wt:true} },
    { match:['amoxicillin','amoxil','amoxyl'],
      adult:{dose:'500mg',               times:3, days:5},
      child:{dose:'25mg/kg per dose (syrup 250mg/5ml)', times:3, days:5, wt:true},
      infant:{dose:'62.5–125mg (syrup 125mg/5ml)', times:3, days:5, wt:true} },
    { match:['metronidazole','flagyl'],
      adult:{dose:'400mg',               times:3, days:7},
      child:{dose:'7.5mg/kg per dose',   times:3, days:7, wt:true} },
    { match:['ciprofloxacin','cipro'],
      adult:{dose:'500mg',               times:2, days:7, preg:true} },
    { match:['doxycycline','doxy'],
      adult:{dose:'100mg',               times:2, days:7, preg:true} },
    { match:['cotrimoxazole','septrin','co-trimoxazole','bactrim'],
      adult:{dose:'960mg (2 tabs of 480mg)', times:2, days:5},
      child:{dose:'24mg/kg per dose (syrup 240mg/5ml)', times:2, days:5, wt:true},
      infant:{dose:'120mg (syrup 2.5ml)', times:2, days:5} },
    { match:['azithromycin','zithromax'],
      adult:{dose:'500mg',               times:1, days:3},
      child:{dose:'10mg/kg',             times:1, days:3, wt:true} },
    { match:['erythromycin'],
      adult:{dose:'500mg',               times:4, days:5},
      child:{dose:'12.5mg/kg per dose',  times:4, days:5, wt:true} },
    { match:['ibuprofen','brufen'],
      adult:{dose:'400mg',               times:3, days:3},
      child:{dose:'10mg/kg (syrup 100mg/5ml)', times:3, days:3, wt:true, preg:false} },
    { match:['diclofenac'],
      adult:{dose:'50mg',                times:2, days:5, preg:true} },
    { match:['ors','oral rehydration'],
      adult:{dose:'1 sachet in 1L water, after each loose stool', times:3, days:3},
      child:{dose:'½–1 sachet, after each loose stool', times:3, days:3},
      infant:{dose:'¼–½ sachet, 5ml/kg after each stool', times:3, days:3, wt:true} },
    { match:['zinc'],
      adult:{dose:'20mg',                times:1, days:10},
      child:{dose:'20mg (10mg if under 6 months)', times:1, days:10},
      infant:{dose:'10mg',               times:1, days:10} },
    { match:['cetirizine','zyrtec'],
      adult:{dose:'10mg',                times:1, days:5},
      child:{dose:'5mg (syrup 5ml)',     times:1, days:5} },
    { match:['chlorpheniramine','piriton'],
      adult:{dose:'4mg',                 times:3, days:5},
      child:{dose:'1–2mg (syrup 2.5–5ml)', times:2, days:5} },
    { match:['omeprazole','losec'],
      adult:{dose:'20mg',                times:1, days:14} },
    { match:['metformin','glucophage'],
      adult:{dose:'500mg',               times:2, days:30} },
    { match:['amlodipine','norvasc'],
      adult:{dose:'5mg',                 times:1, days:30} },
    { match:['albendazole','zentel'],
      adult:{dose:'400mg single dose',   times:1, days:1, preg:true},
      child:{dose:'400mg single dose (200mg if 1–2 yrs)', times:1, days:1} },
    { match:['mebendazole','vermox'],
      adult:{dose:'100mg',               times:2, days:3, preg:true},
      child:{dose:'100mg',               times:2, days:3} },
    { match:['fluconazole','diflucan'],
      adult:{dose:'150mg single dose',   times:1, days:1, preg:true} },
    { match:['ferrous','iron'],
      adult:{dose:'200mg',               times:1, days:30},
      child:{dose:'3mg/kg elemental iron (syrup)', times:1, days:30, wt:true} },
    { match:['folic'],
      adult:{dose:'5mg',                 times:1, days:30} },
    { match:['vitamin c','ascorbic'],
      adult:{dose:'1 tab',               times:1, days:7},
      child:{dose:'1 tab',               times:1, days:7} },
    { match:['salbutamol','ventolin'],
      adult:{dose:'4mg (or 2 puffs inhaler)', times:3, days:5},
      child:{dose:'2mg (syrup 5ml) or 1–2 puffs', times:3, days:5} },
    // ── Additional common Uganda OPD drugs ──
    { match:['nystatin'],
      adult:{dose:'1–2 tabs / 5ml suspension', times:4, days:7},
      child:{dose:'1ml suspension to each side of mouth', times:4, days:7},
      infant:{dose:'1ml suspension', times:4, days:7} },
    { match:['nifedipine'],
      adult:{dose:'20mg',                times:2, days:30} },
    { match:['hydrochlorothiazide','hctz'],
      adult:{dose:'25mg',                times:1, days:30} },
    { match:['prednisolone','prednisone'],
      adult:{dose:'30–40mg',             times:1, days:5},
      child:{dose:'1mg/kg',              times:1, days:5, wt:true} },
    { match:['dexamethasone'],
      adult:{dose:'4mg',                 times:1, days:3},
      child:{dose:'0.15mg/kg',           times:1, days:3, wt:true} },
    { match:['hyoscine','buscopan'],
      adult:{dose:'10mg',                times:3, days:3} },
    { match:['loratadine','clarityne'],
      adult:{dose:'10mg',                times:1, days:5},
      child:{dose:'5mg (syrup 5ml)',     times:1, days:5} },
    { match:['ranitidine','zantac'],
      adult:{dose:'150mg',               times:2, days:14} },
    { match:['ceftriaxone'],
      adult:{dose:'1–2g IV/IM',          times:1, days:5},
      child:{dose:'50–80mg/kg IV/IM',    times:1, days:5, wt:true} },
    { match:['benzylpenicillin','crystalline penicillin'],
      adult:{dose:'2–4 MU IV',           times:4, days:5},
      child:{dose:'50,000 IU/kg IV',     times:4, days:5, wt:true} },
    { match:['gentamicin'],
      adult:{dose:'5–7mg/kg IV/IM',      times:1, days:5, wt:true},
      child:{dose:'7.5mg/kg IV/IM',      times:1, days:5, wt:true} },
    { match:['nevirapine','dolutegravir','tenofovir','efavirenz','tld'],
      adult:{dose:'As per national ART guidelines — confirm regimen', times:1, days:30} },
    { match:['quinine'],
      adult:{dose:'600mg',               times:3, days:7},
      child:{dose:'10mg/kg per dose',    times:3, days:7, wt:true} },
    { match:['artesunate'],
      adult:{dose:'2.4mg/kg IV at 0,12,24h then daily', times:1, days:3, wt:true},
      child:{dose:'3mg/kg IV (under 20kg)', times:1, days:3, wt:true} },
  ];

  // Age the clinician typed in (years). Wins over the patient record so a
  // walk-in with no DOB can still be dosed by age.
  state.manualAgeYears = null;

  function patientAgeYears() {
    if (state.manualAgeYears !== null && state.manualAgeYears !== undefined) return state.manualAgeYears;
    const p = state.patient || {};
    if (p.date_of_birth) {
      const a = (Date.now() - new Date(p.date_of_birth).getTime()) / 31557600000;
      if (isFinite(a) && a >= 0 && a < 130) return a;
    }
    return null;
  }

  // Rough paediatric weight estimate (APLS) so weight-based doses have a hint.
  function estWeightKg(age) {
    if (age === null || age >= 18) return null;
    if (age < 1)  return Math.round((age * 12 * 0.5 + 3.5) * 10) / 10; // ~0.5kg/month + 3.5
    if (age <= 5) return Math.round((age + 4) * 2);
    return Math.round(age * 3 + 7);
  }

  // 'adult' | 'child' — manual toggle wins, else patient record, else adult
  state.dosingMode = null;
  function effectiveDosingMode() {
    const band = effectiveAgeBand();
    return band === 'adult' ? 'adult' : 'child';
  }

  // 'infant' (<1yr) | 'child' (1–11) | 'adult' (12+). Age (typed or DOB) wins;
  // then the manual Adult/Child toggle; then the patient record; else adult.
  function effectiveAgeBand() {
    const age = patientAgeYears();
    if (age !== null) {
      if (age < 1)  return 'infant';
      if (age < 12) return 'child';
      return 'adult';
    }
    if (state.dosingMode) return state.dosingMode === 'child' ? 'child' : 'adult';
    if (state.patient && state.patient.is_child) return 'child';
    return 'adult';
  }

  // True when we should surface a pregnancy caution: female adult, or adult of
  // unknown sex (so the clinician is reminded to check).
  function pregnancyRelevant() {
    const age = patientAgeYears();
    if (age !== null && age < 12) return false;
    const sex = (state.patient && (state.patient.sex || state.patient.gender) || '').toString().toLowerCase();
    if (sex === 'male' || sex === 'm') return false;
    return true; // female or unknown
  }

  function findRegimen(name) {
    const n = (name || '').toLowerCase();
    if (n.length < 3) return null;
    return DRUG_REGIMENS.find(r => r.match.some(m => n.includes(m))) || null;
  }

  // "three times daily" / "bd" / "every 8 hours" → 1–4
  function parseTimesPerDay(text) {
    const t = (text || '').toLowerCase();
    if (/four times|4 times|\bqid\b|\bqds\b|every 6 ?h/.test(t)) return 4;
    if (/three times|3 times|\btds\b|\btid\b|every 8 ?h/.test(t)) return 3;
    if (/twice|two times|2 times|\bbd\b|\bbid\b|every 12 ?h/.test(t)) return 2;
    if (/once|one time|1 time|\bod\b|single dose|\bstat\b/.test(t)) return 1;
    return null;
  }

  // Fill dosage, frequency, intake times and duration for medication idx
  // from its drug name. Returns true if anything was auto-filled.
  function applyAutoRegimen(idx) {
    const m = state.medications[idx];
    if (!m || !m.drug) return false;
    m._pregWarn = false;
    const band = effectiveAgeBand();
    const age  = patientAgeYears();
    const reg  = findRegimen(m.drug);
    if (reg) {
      // Pick the closest available dose for the age band.
      let r, usedBand;
      if (band === 'infant')      { r = reg.infant || reg.child || reg.adult; usedBand = reg.infant ? 'infant' : (reg.child ? 'child' : 'adult'); }
      else if (band === 'child')  { r = reg.child  || reg.adult;              usedBand = reg.child ? 'child' : 'adult'; }
      else                        { r = reg.adult;                            usedBand = 'adult'; }

      m.dosage       = r.dose;
      m.timesPerDay  = r.times;
      m.intakeTimes  = [...DEFAULT_TIMES[r.times]];
      m.durationDays = r.days;

      // Build the auto-fill badge: which dose, the age used, weight hint, and
      // a pregnancy caution where relevant.
      let note;
      if (usedBand === 'adult' && band !== 'adult') note = 'adult dose — verify for this age';
      else note = usedBand + ' dose';
      if (age !== null) {
        const yrs = age < 1 ? Math.round(age * 12) + ' mo' : (Math.round(age * 10) / 10) + ' yr';
        note += ' · ' + yrs;
        if (r.wt) { const w = estWeightKg(age); if (w) note += ' · ~' + w + 'kg'; }
      }
      m._autoNote   = note;
      m._pregWarn   = (r.preg && pregnancyRelevant()) ? true : false;
      return true;
    }
    // Fallback: formulary defaults, with the frequency parsed out of the text
    const dl = m.drug.toLowerCase();
    const f = state.formulary.find(d => (d.name || '').toLowerCase() === dl)
           || state.formulary.find(d => d.generic_name && dl.includes(d.generic_name.toLowerCase()));
    if (f && f.default_dosage) {
      m.dosage       = f.default_dosage;
      m.durationDays = f.default_days || m.durationDays;
      const n = parseTimesPerDay(f.default_dosage);
      if (n) { m.timesPerDay = n; m.intakeTimes = [...DEFAULT_TIMES[n]]; }
      m._autoNote = 'formulary default';
      return true;
    }
    return false;
  }

  // Age input + Adult/Child toggle: set the age once and every auto-filled drug
  // re-doses for that age. Re-applies regimens to drugs that were auto-filled.
  (function wireDosingToggle() {
    const aBtn    = document.getElementById('doseModeAdult');
    const cBtn    = document.getElementById('doseModeChild');
    const ageInp  = document.getElementById('patientAgeInput');
    const yrsBtn  = document.getElementById('ageUnitYrs');
    const mosBtn  = document.getElementById('ageUnitMos');
    const label   = document.getElementById('dosingBandLabel');
    if (!aBtn || !cBtn) return;
    state.ageUnit = 'yrs';

    function reapplyAll() {
      let changed = false;
      state.medications.forEach((m, i) => {
        if (m._autoNote && applyAutoRegimen(i)) changed = true;
      });
      if (changed) autoSetExpectedRecovery();
      renderMeds();
      updateLabel();
    }

    function updateLabel() {
      const band = effectiveAgeBand();
      const age  = patientAgeYears();
      aBtn.classList.toggle('active', band === 'adult');
      cBtn.classList.toggle('active', band !== 'adult');
      if (!label) return;
      let txt;
      if (age !== null) {
        const ageStr = age < 1 ? Math.round(age * 12) + ' month' + (Math.round(age*12)!==1?'s':'') : (Math.round(age*10)/10) + ' yr' + (age>=2?'s':'');
        const bandWord = band === 'infant' ? 'infant' : band === 'child' ? 'child' : 'adult';
        const w = estWeightKg(age);
        txt = 'Dosing for a ' + ageStr + ' ' + bandWord + (w ? ' · approx ' + w + 'kg' : '');
      } else {
        txt = 'Dosing for: ' + (band === 'adult' ? 'Adult' : 'Child') + ' — set the age above for exact paediatric doses';
      }
      label.innerHTML = '<span class="material-icons-outlined" style="font-size:14px">bolt</span>' + esc(txt);
    }

    function readAge() {
      const raw = (ageInp && ageInp.value || '').trim();
      if (raw === '') { state.manualAgeYears = null; }
      else {
        let v = parseFloat(raw);
        if (!isFinite(v) || v < 0) { state.manualAgeYears = null; }
        else { state.manualAgeYears = state.ageUnit === 'mos' ? v / 12 : v; }
      }
      reapplyAll();
    }

    if (ageInp) ageInp.addEventListener('input', readAge);
    if (yrsBtn) yrsBtn.onclick = () => { state.ageUnit = 'yrs'; yrsBtn.classList.add('active'); mosBtn && mosBtn.classList.remove('active'); readAge(); };
    if (mosBtn) mosBtn.onclick = () => { state.ageUnit = 'mos'; mosBtn.classList.add('active'); yrsBtn && yrsBtn.classList.remove('active'); readAge(); };

    function setMode(mode) {
      // Tapping Adult/Child clears the typed age and uses the simple band.
      state.dosingMode = mode;
      state.manualAgeYears = null;
      if (ageInp) ageInp.value = '';
      reapplyAll();
    }
    aBtn.onclick = () => setMode('adult');
    cBtn.onclick = () => setMode('child');

    // Pre-fill the age box from the patient record once their profile loads.
    window._syncDosingToggle = function() {
      const p = state.patient || {};
      if (state.manualAgeYears === null && p.date_of_birth && ageInp && !ageInp.value) {
        const a = (Date.now() - new Date(p.date_of_birth).getTime()) / 31557600000;
        if (isFinite(a) && a >= 0 && a < 130) {
          if (a < 2) { state.ageUnit = 'mos'; if (yrsBtn) yrsBtn.classList.remove('active'); if (mosBtn) mosBtn.classList.add('active'); ageInp.value = String(Math.round(a * 12)); }
          else        { state.ageUnit = 'yrs'; if (mosBtn) mosBtn.classList.remove('active'); if (yrsBtn) yrsBtn.classList.add('active'); ageInp.value = String(Math.round(a)); }
        }
      }
      reapplyAll();
    };
    updateLabel();
  })();

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
        ${m._autoNote ? `<div style="font-size:11px;color:#1B5E20;background:#E8F5E9;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;margin-bottom:6px;margin-left:4px">
          <span class="material-icons-outlined" style="font-size:12px">bolt</span>Auto-filled (${esc(m._autoNote)}) — edit anything below if needed</div>` : ''}
        ${m._pregWarn ? `<div style="font-size:11px;color:#C62828;background:#FFEBEE;padding:3px 9px;border-radius:6px;display:inline-flex;align-items:center;gap:4px;margin-bottom:6px;margin-left:4px">
          <span class="material-icons-outlined" style="font-size:12px">pregnant_woman</span>Caution in pregnancy — confirm before prescribing</div>` : ''}

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
      // Typed a name without picking from the menu (e.g. "panadol" then tapped
      // away) — still auto-fill, but never clobber a dosage already entered.
      input.addEventListener('change', () => {
        const i = parseInt(input.dataset.idx,10);
        const m = state.medications[i];
        if (m && m.drug && !m.dosage && applyAutoRegimen(i)) {
          autoSetExpectedRecovery();
          renderMeds();
        }
      });
    });
    ct.querySelectorAll('.dose-input').forEach(input => {
      input.addEventListener('input', e => {
        const i = parseInt(input.dataset.idx,10);
        state.medications[i].dosage = e.target.value;
        state.medications[i]._autoNote = '';   // clinician took over — drop the auto badge
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
        applyAutoRegimen(idx);
        menu.style.display = 'none';
        autoSetExpectedRecovery();
        renderMeds();
      };
    });

    menu.querySelectorAll('[data-name]').forEach(el => {
      el.onclick = () => {
        const drug = state.formulary.find(d => d.name === el.dataset.name);
        if (!drug) return;
        state.medications[idx].drug = drug.name;
        applyAutoRegimen(idx);
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
    const resetBtn = () => {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined" style="font-size:20px">send</span> Send Prescription &amp; Start Follow-up';
    };
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="font-size:18px">hourglass_empty</span> Sending…';

    try {

    if (!_clinicId && supabase && !session?.demo) {
      _clinicId = await resolveClinicId(supabase, session);
    }

    if (!supabase || !_clinicId) {
      showToast('Demo mode — not saved. Connect a clinic to save.', 'error');
      resetBtn();
      return;
    }

    // Validate medications
    if (!state.medications.length) {
      showToast('Add at least one medication', 'error');
      resetBtn();
      return;
    }
    const medsOk = state.medications.every(m => m.drug && m.dosage && m.intakeTimes.every(t => t));
    if (!medsOk) {
      showToast('Fill in drug name, dosage and intake times for each medication', 'error');
      resetBtn();
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
      clinician_name: session?.staffName || null,
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

    // ── OFFLINE: queue the entire consultation and sync when back online ──
    // Used both when the device is plainly offline AND when an online save hits
    // a network error/timeout on a flaky link — so a consultation is NEVER lost.
    function queueConsultationOffline() {
      const cid = ClinicOffline.uuid();
      dxPayload.id = cid;                          // client id links all rows
      // Stamp the real consultation time so every dashboard section can place
      // it correctly (today's patients, revenue period, sorting) before sync.
      if (!dxPayload.created_at) dxPayload.created_at = new Date().toISOString();
      const epx = items.length ? {
        diagnosis_id: cid,
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
      } : null;
      const followups = buildFollowupRows(cid);
      const invItems = [
        ...state.medications.filter(m => m.inventoryItemId && m.qtyToDeduct > 0).map(m => ({ item_id: m.inventoryItemId, qty: m.qtyToDeduct })),
        ...state.materialsUsed.filter(m => m.item_id && m.qty > 0).map(m => ({ item_id: m.item_id, qty: m.qty })),
      ];
      ClinicOffline.enqueue('consultation', {
        dxPayload, epx, followups, invItems,
        booking: { bookingId: state.bookingId || null, attended_at: new Date().toISOString() },
      });
      // Keep the cached Quick Sale stock accurate for anything deducted here.
      try {
        if (invItems.length) {
          const key = 'qs_inventory_' + _clinicId;
          const cachedInv = ClinicOffline.get(key);
          if (Array.isArray(cachedInv)) {
            invItems.forEach(it => { const c = cachedInv.find(x => x.id === it.item_id); if (c) c.quantity = Math.max(0, Number(c.quantity) - Number(it.qty)); });
            ClinicOffline.set(key, cachedInv);
          }
        }
      } catch(e) {}
      const successMsgEl = document.getElementById('successMsg');
      if (successMsgEl) successMsgEl.innerHTML = '<strong>' + esc(state.patient?.name || 'Patient') + '</strong>’s consultation <strong>saved offline</strong>. It syncs automatically when you’re back online.';
      const successRemindersEl = document.getElementById('successReminders');
      if (successRemindersEl) successRemindersEl.innerHTML = '<div style="font-size:12px;color:#2E7D32;padding:3px 0"><span class="material-icons-outlined" style="font-size:13px;vertical-align:-2px">cloud_off</span> Prescription &amp; reminders will be scheduled once it syncs.</div>';
      const successSheet = document.getElementById('successSheet');
      if (successSheet) successSheet.style.display = 'flex';
      _closeReferralIfAny();   // referral handled → leaves the inbox
    }

    if (window.ClinicOffline && navigator.onLine === false) {
      queueConsultationOffline();
      return;
    }

    // ONLINE: save directly, but cap the request so a stalled connection can't
    // hang the wizard — and if it fails for network reasons, fall back to the
    // offline queue instead of losing the consultation.
    const _saveTO = (p) => (window.ClinicOffline ? ClinicOffline.withTimeout(p, 15000) : p);
    let dx, dxError;
    ({ data: dx, error: dxError } = await _saveTO(supabase
      .from('clinic_diagnoses')
      .insert(dxPayload)
      .select().single()));

    // Graceful fallback if follow_up_reason column not yet migrated
    if (dxError && dxError.message && dxError.message.includes('follow_up_reason')) {
      const compatPayload = Object.assign({}, dxPayload);
      delete compatPayload.follow_up_reason;
      ({ data: dx, error: dxError } = await _saveTO(supabase
        .from('clinic_diagnoses')
        .insert(compatPayload)
        .select().single()));
    }

    if (dxError) {
      // Lost/again-flaky connection while "online" → queue it, don't fail.
      if (window.ClinicOffline && ClinicOffline.isNetworkErr(dxError)) {
        queueConsultationOffline();
        return;
      }
      showToast('Save failed: ' + dxError.message, 'error');
      resetBtn();
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
    _closeReferralIfAny();     // referral handled → leaves the inbox

    } catch (fatalErr) {
      console.error('submitBtn fatal:', fatalErr);
      showToast('Unexpected error: ' + fatalErr.message, 'error');
      resetBtn();
    }
  };

  // Initialise
  showStep(1);
  addMedication();

  window._wizState = state;
  window._showStep = showStep;
  window._wizEsc   = esc;
})();
