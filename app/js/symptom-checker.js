/**
 * Homatt Health - Symptom Checker with Groq + OpenAI + Gemini AI
 * Multi-screen flow: Patient → Symptoms → Follow-up → Results → Monitoring
 * API priority: Groq → OpenAI → Gemini → Offline engine
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};

  // Create Supabase client safely — works even if config.js is stale or CDN is slow
  let supabase = null;
  let session = null;
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
    try {
      supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data } = await supabase.auth.getSession();
      session = data?.session || null;
    } catch(e) { console.warn('[SC] Supabase init failed:', e.message); }
  }

  // Accept localStorage session as fallback (APK users, offline mode, expired Supabase session)
  const _localSess = (() => { try { return JSON.parse(localStorage.getItem('homatt_session') || 'null'); } catch(e) { return null; } })();
  const _localUser = (() => { try { return JSON.parse(localStorage.getItem('homatt_user') || 'null'); } catch(e) { return null; } })();

  if (!session && !_localSess && !_localUser) {
    window.location.href = 'signin.html';
    return;
  }

  // ====== API Config ======
  const PROXY_URL = cfg.API_PROXY_URL || '';

  // ====== State ======
  const user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  // Load family from cache first, then try to refresh from Supabase in background
  let family = JSON.parse(localStorage.getItem('homatt_family') || '[]');
  // Background sync of family members so next open has fresh data
  if (supabase && session && session.user) {
    supabase.from('family_members')
      .select('id,name,relationship,dob,sex')
      .eq('primary_user_id', session.user.id)
      .then(({ data }) => {
        if (data && data.length) {
          const mapped = data.map(m => {
            let age = '';
            if (m.dob) {
              const b = new Date(m.dob);
              age = Math.floor((Date.now() - b) / (365.25 * 24 * 60 * 60 * 1000));
            }
            return { name: m.name, relation: m.relationship || 'family', sex: m.sex || 'unknown', age };
          });
          localStorage.setItem('homatt_family', JSON.stringify(mapped));
          // If the patient list is still on screen, rebuild it with fresh data
          if (document.getElementById('screenPatient').classList.contains('active')) {
            family.splice(0, family.length, ...mapped);
            buildPatientList();
          }
        }
      }).catch(() => {}); // offline — stay with cached
  }
  let selectedPatient = null;
  let enteredSymptoms = '';
  let selectedChips = new Set();
  let followupAnswers = {};
  let diagnosisData = null;
  let monitoringSession = null;
  let aiAvailable = null; // null = untested, true/false after first call

  // ====== Elements ======
  const screens = document.querySelectorAll('.sc-screen');
  const backBtn = document.getElementById('backBtn');
  let currentScreen = 'screenPatient';

  // ====== Status bar time ======
  function updateTime() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('statusTime').textContent = `${h}:${m}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // ====== Screen Navigation ======
  function showScreen(screenId) {
    screens.forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    currentScreen = screenId;
    document.querySelector('.app-screen').scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleBack() {
    if (currentScreen === 'screenPatient') {
      window.location.href = 'dashboard.html';
    } else if (currentScreen === 'screenSymptoms') {
      showScreen('screenPatient');
    } else if (currentScreen === 'screenFollowup') {
      showScreen('screenSymptoms');
    } else if (currentScreen === 'screenResults') {
      showScreen('screenFollowup');
    } else if (currentScreen === 'screenMonitor') {
      showScreen('screenResults');
    } else {
      window.location.href = 'dashboard.html';
    }
  }

  backBtn.addEventListener('click', handleBack);

  // Scroll the monitoring action textarea into view when the user taps it.
  // The monitoring screen has a header + condition card + tips card above it,
  // so the textarea starts off-screen once the keyboard opens. Scrolling it
  // into view prevents it being hidden behind the keyboard.
  document.getElementById('monitorInitialAction').addEventListener('focus', () => {
    setTimeout(() => {
      const el = document.getElementById('monitorInitialAction');
      if (!el) return;
      const scroller = document.querySelector('.app-screen');
      if (!scroller) return;
      const elRect = el.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const targetTop = scroller.scrollTop + elRect.top - scrollerRect.top
        - (scroller.clientHeight / 2) + (elRect.height / 2);
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
    }, 350); // after the keyboard animation (~300 ms) settles
  });

  // Register with native-bridge so the Android hardware back button does the same
  window.HomattBackHandler = function () {
    handleBack();
    return true; // tell native-bridge we handled it
  };

  // Bottom nav
  document.getElementById('navHome').addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });

  // ====== SCREEN 1: Patient Selection ======
  function buildPatientList() {
    const list = document.getElementById('patientList');
    list.innerHTML = '';

    let userAge = '';
    if (user.dob) {
      const birth = new Date(user.dob);
      userAge = Math.floor((Date.now() - birth) / (365.25 * 24 * 60 * 60 * 1000));
    }

    // Always show "Me" card first — even if the user has no family members
    const selfCard = createPatientCard({
      name: `${user.firstName || 'Me'} (You)`,
      icon: 'person',
      subtitle: `${user.sex === 'male' ? 'Male' : user.sex === 'female' ? 'Female' : 'User'}${userAge ? ', ' + userAge + ' yrs' : ''}`,
      badge: 'You',
    }, () => {
      selectedPatient = {
        name: user.firstName || 'User',
        age: userAge,
        sex: user.sex || 'unknown',
        relation: 'self',
      };
      document.getElementById('patientName').textContent = 'Checking for: You';
      showScreen('screenSymptoms');
    });
    list.appendChild(selfCard);

    // Add family / dependents from cache
    family.forEach((member) => {
      const icon = member.relation === 'child' ? 'child_care'
                 : member.relation === 'parent' ? 'elderly'
                 : member.relation === 'spouse' ? 'favorite'
                 : 'person';
      const card = createPatientCard({
        name: member.name,
        icon,
        subtitle: `${member.sex === 'male' ? 'Male' : member.sex === 'female' ? 'Female' : ''}${member.age ? ', ' + member.age + ' yrs' : ''} · ${member.relation}`,
        badge: member.relation,
      }, () => {
        selectedPatient = {
          name: member.name,
          age: member.age,
          sex: member.sex || 'unknown',
          relation: member.relation,
        };
        document.getElementById('patientName').textContent = `Checking for: ${member.name}`;
        showScreen('screenSymptoms');
      });
      list.appendChild(card);
    });

    // If no family yet, show a hint
    if (family.length === 0) {
      const hint = document.createElement('p');
      hint.style.cssText = 'text-align:center;font-size:12px;color:var(--text-secondary);margin-top:12px;padding:0 20px;line-height:1.5';
      hint.textContent = 'Add family members in the Family Hub to check symptoms for them too.';
      list.appendChild(hint);
    }
  }

  function createPatientCard({ name, icon, subtitle, badge }, onClick) {
    const card = document.createElement('button');
    card.className = 'sc-patient-card';
    const badgeHtml = badge
      ? `<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:rgba(27,94,32,0.12);color:var(--primary);text-transform:capitalize;margin-top:3px;display:inline-block">${badge}</span>`
      : '';
    card.innerHTML = `
      <div class="sc-patient-avatar">
        <span class="material-icons-outlined">${icon}</span>
      </div>
      <div class="sc-patient-info">
        <p class="sc-patient-name">${name}</p>
        <p class="sc-patient-detail">${subtitle}</p>
        ${badgeHtml}
      </div>
      <span class="material-icons-outlined sc-patient-arrow">chevron_right</span>
    `;
    card.addEventListener('click', onClick);
    return card;
  }

  buildPatientList();

  // ====== SCREEN 2: Symptom Input ======
  const symptomInput = document.getElementById('symptomInput');
  const charCount = document.getElementById('charCount');

  symptomInput.addEventListener('input', () => {
    charCount.textContent = symptomInput.value.length;
  });

  document.querySelectorAll('.sc-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const symptom = chip.dataset.symptom;
      if (selectedChips.has(symptom)) {
        selectedChips.delete(symptom);
        chip.classList.remove('selected');
      } else {
        selectedChips.add(symptom);
        chip.classList.add('selected');
      }
    });
  });

  document.getElementById('btnAnalyze').addEventListener('click', () => {
    const typed = symptomInput.value.trim();
    const chips = Array.from(selectedChips);

    if (!typed && chips.length === 0) {
      symptomInput.focus();
      symptomInput.classList.add('shake');
      setTimeout(() => symptomInput.classList.remove('shake'), 300);
      return;
    }

    const parts = [];
    if (typed) parts.push(typed);
    if (chips.length > 0) parts.push(chips.join(', '));
    enteredSymptoms = parts.join('. Also experiencing: ');

    showScreen('screenFollowup');
    getFollowupQuestions();
  });

  // ====== SCREEN 3: Follow-up Questions ======
  async function getFollowupQuestions() {
    const loading = document.getElementById('followupLoading');
    const content = document.getElementById('followupContent');
    loading.style.display = 'flex';
    content.style.display = 'none';

    // If we already know AI is unavailable, skip to fallback
    if (aiAvailable === false) {
      renderFollowupQuestions(getSmartFallbackQuestions(enteredSymptoms));
      loading.style.display = 'none';
      content.style.display = 'block';
      return;
    }

    const prompt = `You are a health assistant for a mobile health app in Uganda. A patient has described these symptoms: "${enteredSymptoms}".

Patient info: ${selectedPatient.name}, ${selectedPatient.age ? selectedPatient.age + ' years old' : 'age unknown'}, ${selectedPatient.sex}.

Generate exactly 4 follow-up questions to better understand their condition. For each question, provide 3-4 clickable answer options.

IMPORTANT: Respond ONLY with valid JSON, no markdown, no explanation. Use this exact format:
{
  "questions": [
    {
      "question": "How long have you had this symptom?",
      "options": ["Less than 24 hours", "1-3 days", "More than a week", "On and off for weeks"]
    }
  ]
}`;

    try {
      const data = await callAI(prompt);
      const parsed = parseJSON(data);

      if (parsed && parsed.questions) {
        aiAvailable = true;
        renderFollowupQuestions(parsed.questions);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.warn('AI follow-up failed, using smart fallback:', err.message);
      // Don't permanently disable AI - still try again for diagnosis
      renderFollowupQuestions(getSmartFallbackQuestions(enteredSymptoms));
    }

    loading.style.display = 'none';
    content.style.display = 'block';
  }

  function getSmartFallbackQuestions(symptoms) {
    const s = symptoms.toLowerCase();
    const questions = [
      {
        question: 'How long have you been experiencing these symptoms?',
        options: ['Less than 24 hours', '1-3 days', '4-7 days', 'More than a week'],
      },
      {
        question: 'How severe is the discomfort right now?',
        options: ['Mild - I can go about my day', 'Moderate - It bothers me a lot', 'Severe - I can barely function'],
      },
    ];

    // Add symptom-specific questions
    if (s.includes('fever') || s.includes('hot') || s.includes('temperature') || s.includes('chills')) {
      questions.push({
        question: 'What is your temperature like?',
        options: ['Slightly warm', 'High fever (above 38°C)', 'Very high fever with chills', 'Comes and goes'],
      });
    } else if (s.includes('headache') || s.includes('head')) {
      questions.push({
        question: 'Where exactly is the headache?',
        options: ['Front of head / forehead', 'Both sides', 'Back of head / neck', 'All over'],
      });
    } else if (s.includes('stomach') || s.includes('abdominal') || s.includes('belly')) {
      questions.push({
        question: 'Where is the stomach pain?',
        options: ['Upper stomach', 'Lower stomach', 'Around the navel', 'All over the abdomen'],
      });
    } else if (s.includes('cough') || s.includes('chest') || s.includes('breathing')) {
      questions.push({
        question: 'What type of cough do you have?',
        options: ['Dry cough', 'Cough with mucus/phlegm', 'Cough with blood', 'Wheezing / difficulty breathing'],
      });
    } else if (s.includes('diarrhea') || s.includes('vomit') || s.includes('nausea')) {
      questions.push({
        question: 'How often are you experiencing this?',
        options: ['1-2 times today', '3-5 times today', 'More than 5 times', 'Constant nausea'],
      });
    } else {
      questions.push({
        question: 'Have you had these symptoms before?',
        options: ['No, this is the first time', 'Yes, it happened once before', 'Yes, it keeps coming back', 'It runs in my family'],
      });
    }

    questions.push({
      question: 'Do you have any of these additional symptoms?',
      options: ['Fever or chills', 'Loss of appetite', 'Body weakness / fatigue', 'None of these'],
    });

    return questions;
  }

  function renderFollowupQuestions(questions) {
    const list = document.getElementById('questionsList');
    list.innerHTML = '';
    followupAnswers = {};

    questions.forEach((q, qIndex) => {
      const questionEl = document.createElement('div');
      questionEl.className = 'sc-question-block';
      questionEl.innerHTML = `
        <p class="sc-question-text">${qIndex + 1}. ${q.question}</p>
        <div class="sc-options-wrap" data-qindex="${qIndex}">
          ${q.options.map((opt) => `
            <button class="sc-option-btn" data-qindex="${qIndex}" data-value="${opt}">
              ${opt}
            </button>
          `).join('')}
        </div>
      `;
      list.appendChild(questionEl);
    });

    list.querySelectorAll('.sc-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const qi = btn.dataset.qindex;
        btn.closest('.sc-options-wrap').querySelectorAll('.sc-option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        followupAnswers[qi] = btn.dataset.value;
        // Update answered counter
        const countEl = document.getElementById('answeredCount');
        if (countEl) countEl.textContent = Object.keys(followupAnswers).length;
        // Hide validation message when user starts answering
        const validationMsg = document.getElementById('followupValidationMsg');
        if (validationMsg) validationMsg.style.display = 'none';
      });
    });
  }

  // Get diagnosis button
  document.getElementById('btnGetDiagnosis').addEventListener('click', () => {
    const answeredCount = Object.keys(followupAnswers).length;
    const validationMsg = document.getElementById('followupValidationMsg');
    if (answeredCount < 1) {
      const firstUnanswered = document.querySelector('.sc-options-wrap');
      if (firstUnanswered) {
        firstUnanswered.classList.add('shake');
        setTimeout(() => firstUnanswered.classList.remove('shake'), 300);
        firstUnanswered.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (validationMsg) {
        validationMsg.style.display = 'block';
        validationMsg.textContent = 'Please answer at least one question above to get your assessment.';
      }
      return;
    }
    if (validationMsg) validationMsg.style.display = 'none';
    showScreen('screenResults');
    getDiagnosis();
  });

  // ====== Symptom Cache ======
  async function checkSymptomCache(symptoms) {
    try {
      const key = symptoms.toLowerCase().trim().split(/\s+/).sort().slice(0,8).join(' ');
      const { data } = await supabase.from('symptom_cache')
        .select('*')
        .eq('symptoms_key', key)
        .order('times_used', { ascending: false })
        .limit(1)
        .single();
      if (data && data.conditions_json) {
        return { ...JSON.parse(data.conditions_json), _fromCache: true };
      }
    } catch(e) {}
    return null;
  }

  // ====== SCREEN 4: Diagnosis Results ======
  async function getDiagnosis() {
    const loading = document.getElementById('resultsLoading');
    const content = document.getElementById('resultsContent');
    loading.style.display = 'flex';
    content.style.display = 'none';

    // Check symptom cache first
    const cached = await checkSymptomCache(enteredSymptoms);
    if (cached) {
      diagnosisData = cached;
      renderDiagnosis(cached);
      loading.style.display = 'none';
      content.style.display = 'block';
      // Show "From verified cases" badge
      const badge = document.createElement('div');
      badge.style.cssText = 'background:#E8F5E9;border:1px solid #4CAF50;border-radius:8px;padding:10px 14px;font-size:12px;color:#1B5E20;display:flex;gap:8px;align-items:center;margin-bottom:12px';
      badge.innerHTML = '<span class="material-icons-outlined" style="font-size:16px">verified</span>Assessment based on verified clinical cases in Uganda';
      content.prepend(badge);
      return;
    }

    const answersText = Object.entries(followupAnswers)
      .map(([k, v]) => v)
      .join('; ');

    // Fetch historical corrections for learning context
    const corrections = await getHistoricalCorrections(enteredSymptoms);
    const correctionContext = corrections.length
      ? `\nHISTORICAL LEARNING DATA (cases where AI was corrected by a clinician in this region):\n` +
        corrections.map(c => `- AI said "${c.top_diagnosis}" but clinician confirmed "${c.clinician_confirmed_diagnosis}" for symptoms: "${(c.symptoms_text||'').slice(0,80)}"`).join('\n') +
        `\nUse this data to improve accuracy — if similar symptoms appear, adjust probability accordingly.\n`
      : '';

    // Always try AI for diagnosis (even if follow-up questions used fallback)
    {
      const prompt = `You are a medical health assistant AI for a mobile health app in Uganda called "Homatt Health".

A patient described these symptoms: "${enteredSymptoms}"
Follow-up answers: "${answersText}"
Patient: ${selectedPatient.name}, ${selectedPatient.age ? selectedPatient.age + ' years old' : 'age unknown'}, ${selectedPatient.sex}, located in ${user.location || 'Uganda'}.
${correctionContext}
Based on this information, provide a health assessment. Consider common diseases in Uganda/East Africa (malaria, typhoid, UTIs, respiratory infections, etc.).

IMPORTANT: This is NOT a final diagnosis - it is guidance only.
IMPORTANT: Respond ONLY with valid JSON, no markdown. Use this exact structure:

{
  "symptoms_identified": ["symptom1", "symptom2", "symptom3"],
  "conditions": [
    {
      "name": "Condition Name",
      "likelihood_percent": 75,
      "severity": "low|medium|high",
      "description": "Brief 1-2 sentence description"
    }
  ],
  "causes": ["Possible cause 1", "Possible cause 2", "Possible cause 3"],
  "prevention_tips": ["Tip 1", "Tip 2", "Tip 3", "Tip 4"],
  "immediate_actions": ["Action 1", "Action 2"],
  "overall_risk": "low|medium|high",
  "followup_message": "A caring message about monitoring their health and what to watch for",
  "should_visit_clinic": false,
  "clinic_urgency": "none|soon|urgent"
}

Provide 2-3 possible conditions ordered by likelihood. Be specific but compassionate. Use plain language a non-medical person can understand.`;

      try {
        const data = await callAI(prompt);
        const parsed = parseJSON(data);

        if (parsed && parsed.conditions) {
          aiAvailable = true;
          diagnosisData = parsed;
          renderDiagnosis(parsed);
          loading.style.display = 'none';
          content.style.display = 'block';
          saveToHistory(parsed);
          return;
        }
        throw new Error('Invalid AI response format');
      } catch (err) {
        console.warn('AI diagnosis failed, using local engine:', err.message);
        aiAvailable = false;
        // Show visible error so user knows why AI isn't working
        showAIError(err.message);
      }
    }

    // Fallback: local symptom analysis engine
    const localDiagnosis = analyzeSymptoms(enteredSymptoms, answersText);
    diagnosisData = localDiagnosis;
    renderDiagnosis(localDiagnosis);
    loading.style.display = 'none';
    content.style.display = 'block';
    saveToHistory(localDiagnosis);
  }

  // ====================================================================
  // OFFLINE SYMPTOM ANALYSIS ENGINE
  // A rule-based system mapping symptoms to common East African conditions
  // ====================================================================
  function analyzeSymptoms(symptoms, answers) {
    const s = (symptoms + ' ' + answers).toLowerCase();

    // Symptom detection helpers
    const has = (terms) => terms.some(t => s.includes(t));

    // Identify symptoms present
    const identified = [];
    if (has(['headache', 'head pain', 'head ache'])) identified.push('Headache');
    if (has(['fever', 'high temperature', 'hot body', 'chills'])) identified.push('Fever');
    if (has(['cough', 'coughing'])) identified.push('Cough');
    if (has(['stomach pain', 'abdominal', 'belly pain', 'tummy'])) identified.push('Stomach pain');
    if (has(['diarrhea', 'diarrhoea', 'loose stool', 'watery stool'])) identified.push('Diarrhea');
    if (has(['vomit', 'throwing up', 'nausea', 'feel sick'])) identified.push('Nausea/Vomiting');
    if (has(['fatigue', 'tired', 'weakness', 'weak', 'no energy'])) identified.push('Fatigue');
    if (has(['body ache', 'body pain', 'joint pain', 'muscle'])) identified.push('Body aches');
    if (has(['sore throat', 'throat pain', 'swallow'])) identified.push('Sore throat');
    if (has(['dizziness', 'dizzy', 'lightheaded'])) identified.push('Dizziness');
    if (has(['chest pain', 'chest tight', 'breathing', 'breathless'])) identified.push('Chest discomfort');
    if (has(['back pain', 'lower back', 'backache'])) identified.push('Back pain');
    if (has(['rash', 'skin', 'itching', 'itchy'])) identified.push('Skin irritation');
    if (has(['runny nose', 'sneezing', 'blocked nose', 'congestion'])) identified.push('Nasal congestion');
    if (has(['urination', 'urine', 'peeing', 'burning pee'])) identified.push('Urinary symptoms');
    if (has(['eye', 'red eye', 'watery eye'])) identified.push('Eye irritation');
    if (has(['loss of appetite', 'no appetite', 'not hungry'])) identified.push('Loss of appetite');

    if (identified.length === 0) {
      identified.push(symptoms.split(/[,.;]+/)[0].trim());
    }

    // Score conditions based on symptom matches
    const conditions = [];
    let overallRisk = 'low';
    let shouldVisitClinic = false;
    let clinicUrgency = 'none';

    // ---------- MALARIA ----------
    if (has(['fever', 'chills', 'hot']) || has(['headache']) || has(['body ache', 'joint pain'])) {
      let score = 0;
      if (has(['fever', 'chills', 'hot body', 'high temperature'])) score += 35;
      if (has(['headache', 'head pain'])) score += 15;
      if (has(['body ache', 'joint pain', 'muscle'])) score += 15;
      if (has(['fatigue', 'tired', 'weakness'])) score += 10;
      if (has(['nausea', 'vomit', 'loss of appetite'])) score += 10;
      if (has(['sweating', 'sweat'])) score += 10;
      score = Math.min(score, 85);
      if (score >= 40) {
        conditions.push({
          name: 'Malaria',
          likelihood_percent: score,
          severity: score >= 65 ? 'high' : 'medium',
          description: 'A mosquito-borne illness very common in Uganda. Causes fever, chills, headache, and body aches. Treatable with antimalarial medication when caught early.',
        });
      }
    }

    // ---------- TYPHOID ----------
    if (has(['fever']) || has(['stomach', 'abdominal']) || has(['headache'])) {
      let score = 0;
      if (has(['fever', 'high temperature'])) score += 25;
      if (has(['stomach pain', 'abdominal', 'belly'])) score += 20;
      if (has(['headache'])) score += 10;
      if (has(['diarrhea', 'loose stool']) || has(['constipat'])) score += 15;
      if (has(['loss of appetite', 'no appetite'])) score += 10;
      if (has(['fatigue', 'weakness'])) score += 10;
      if (has(['more than a week', '4-7 days'])) score += 10;
      score = Math.min(score, 80);
      if (score >= 35) {
        conditions.push({
          name: 'Typhoid Fever',
          likelihood_percent: score,
          severity: score >= 60 ? 'high' : 'medium',
          description: 'A bacterial infection spread through contaminated food or water. Causes prolonged fever, stomach pain, and fatigue. Requires antibiotic treatment.',
        });
      }
    }

    // ---------- COMMON COLD / FLU ----------
    if (has(['cough', 'sore throat', 'runny nose', 'sneezing', 'congestion'])) {
      let score = 0;
      if (has(['cough'])) score += 20;
      if (has(['sore throat', 'throat pain'])) score += 20;
      if (has(['runny nose', 'sneezing', 'blocked nose', 'congestion'])) score += 20;
      if (has(['fever', 'mild fever'])) score += 10;
      if (has(['headache'])) score += 10;
      if (has(['body ache'])) score += 10;
      if (has(['less than 24', '1-3 days'])) score += 5;
      score = Math.min(score, 80);
      if (score >= 30) {
        conditions.push({
          name: 'Common Cold / Upper Respiratory Infection',
          likelihood_percent: score,
          severity: 'low',
          description: 'A viral infection affecting the nose and throat. Usually clears up on its own within 5-7 days with rest and fluids.',
        });
      }
    }

    // ---------- GASTROENTERITIS ----------
    if (has(['diarrhea', 'vomit', 'nausea', 'stomach'])) {
      let score = 0;
      if (has(['diarrhea', 'loose stool', 'watery stool'])) score += 30;
      if (has(['vomit', 'throwing up'])) score += 25;
      if (has(['stomach pain', 'abdominal', 'cramp'])) score += 15;
      if (has(['nausea', 'feel sick'])) score += 10;
      if (has(['fever'])) score += 5;
      if (has(['more than 5', 'constant'])) score += 10;
      score = Math.min(score, 80);
      if (score >= 35) {
        conditions.push({
          name: 'Gastroenteritis (Stomach Flu)',
          likelihood_percent: score,
          severity: has(['more than 5', 'severe', 'barely function']) ? 'medium' : 'low',
          description: 'An infection of the stomach and intestines causing diarrhea, vomiting, and stomach cramps. Stay hydrated with ORS (oral rehydration salts).',
        });
      }
    }

    // ---------- UTI ----------
    if (has(['urination', 'urine', 'peeing', 'burning', 'frequent'])) {
      let score = 0;
      if (has(['burning', 'pain when peeing', 'burning pee'])) score += 30;
      if (has(['frequent', 'often', 'urination'])) score += 20;
      if (has(['lower back', 'back pain'])) score += 15;
      if (has(['fever'])) score += 10;
      if (has(['stomach pain', 'lower stomach', 'abdominal'])) score += 10;
      score = Math.min(score, 75);
      if (score >= 30) {
        conditions.push({
          name: 'Urinary Tract Infection (UTI)',
          likelihood_percent: score,
          severity: 'medium',
          description: 'A bacterial infection in the urinary system. Common symptoms include burning during urination and frequent urge to urinate. Treatable with antibiotics.',
        });
      }
    }

    // ---------- TENSION HEADACHE / MIGRAINE ----------
    if (has(['headache', 'head pain']) && !has(['fever'])) {
      let score = 0;
      if (has(['headache', 'head pain'])) score += 35;
      if (has(['both sides', 'all over', 'forehead'])) score += 15;
      if (has(['stress', 'screen', 'sleep'])) score += 10;
      if (has(['dizziness', 'dizzy'])) score += 10;
      if (has(['nausea'])) score += 10;
      if (has(['mild'])) score += 5;
      score = Math.min(score, 70);
      if (score >= 30) {
        conditions.push({
          name: 'Tension Headache',
          likelihood_percent: score,
          severity: 'low',
          description: 'A common headache often caused by stress, dehydration, lack of sleep, or eye strain. Usually resolves with rest, water, and pain relief.',
        });
      }
    }

    // ---------- RESPIRATORY INFECTION ----------
    if (has(['cough', 'chest', 'breathing', 'phlegm', 'wheezing'])) {
      let score = 0;
      if (has(['chest pain', 'chest tight'])) score += 25;
      if (has(['cough with mucus', 'phlegm'])) score += 20;
      if (has(['breathing', 'breathless', 'wheezing'])) score += 20;
      if (has(['fever'])) score += 10;
      if (has(['more than a week'])) score += 10;
      score = Math.min(score, 80);
      if (score >= 35) {
        conditions.push({
          name: 'Lower Respiratory Infection',
          likelihood_percent: score,
          severity: has(['breathless', 'blood', 'severe']) ? 'high' : 'medium',
          description: 'An infection affecting the lungs or lower airways. Can include bronchitis or pneumonia. May require medical attention especially if breathing is difficult.',
        });
      }
    }

    // ---------- GENERAL BODY PAIN ----------
    if (has(['back pain', 'muscle', 'body ache']) && conditions.length < 2) {
      conditions.push({
        name: 'Musculoskeletal Pain',
        likelihood_percent: 45,
        severity: 'low',
        description: 'Pain in muscles, joints, or back often caused by physical strain, poor posture, or carrying heavy loads. Rest and gentle stretching usually help.',
      });
    }

    // Sort by likelihood
    conditions.sort((a, b) => b.likelihood_percent - a.likelihood_percent);

    // Keep top 3
    const topConditions = conditions.slice(0, 3);

    // If no conditions matched, provide general guidance
    if (topConditions.length === 0) {
      topConditions.push({
        name: 'Unspecified Symptoms',
        likelihood_percent: 50,
        severity: 'medium',
        description: 'Your symptoms need further evaluation. We recommend visiting a healthcare provider for a proper examination and possible lab tests.',
      });
    }

    // Determine overall risk
    const highRisk = topConditions.some(c => c.severity === 'high');
    const medRisk = topConditions.some(c => c.severity === 'medium');
    const hasSevereAnswers = has(['severe', 'barely function', 'very high', 'blood', 'more than 5']);

    if (highRisk || hasSevereAnswers) {
      overallRisk = 'high';
      shouldVisitClinic = true;
      clinicUrgency = 'urgent';
    } else if (medRisk || has(['moderate', 'more than a week', '4-7 days'])) {
      overallRisk = 'medium';
      clinicUrgency = 'soon';
    }

    // Build causes based on top condition
    const topName = topConditions[0].name.toLowerCase();
    let causes, preventionTips, immediateActions, followupMsg;

    if (topName.includes('malaria')) {
      causes = [
        'Bite from an infected Anopheles mosquito',
        'Being in an area with stagnant water where mosquitoes breed',
        'Not sleeping under a treated mosquito net',
      ];
      preventionTips = [
        'Sleep under an insecticide-treated mosquito net every night',
        'Use mosquito repellent, especially in the evening',
        'Remove stagnant water around your home',
        'Wear long sleeves and pants in the evening',
      ];
      immediateActions = [
        'Get a malaria rapid test (RDT) at the nearest clinic or pharmacy',
        'Take plenty of fluids and rest while waiting for results',
      ];
      followupMsg = 'Malaria is very treatable when caught early. If your fever persists or gets worse, please visit a health facility immediately for testing and treatment.';
    } else if (topName.includes('typhoid')) {
      causes = [
        'Drinking contaminated water',
        'Eating food prepared in unhygienic conditions',
        'Contact with an infected person who handles food',
      ];
      preventionTips = [
        'Always drink boiled or treated water',
        'Wash hands thoroughly before eating and after using the toilet',
        'Eat freshly cooked food and avoid street food if possible',
        'Get a typhoid vaccination if available',
      ];
      immediateActions = [
        'Visit a health facility for a Widal test or blood culture',
        'Stay hydrated and rest',
      ];
      followupMsg = 'Typhoid fever requires antibiotic treatment from a doctor. Do not self-medicate. Visit a health facility for proper diagnosis and treatment.';
    } else if (topName.includes('cold') || topName.includes('respiratory')) {
      causes = [
        'Viral infection spread through air droplets',
        'Close contact with someone who has a cold',
        'Weakened immune system due to stress or poor nutrition',
      ];
      preventionTips = [
        'Rest and get plenty of sleep',
        'Drink warm fluids like tea with honey and lemon',
        'Gargle with warm salt water for sore throat',
        'Wash hands frequently to prevent spreading',
      ];
      immediateActions = [
        'Take paracetamol for fever and pain if needed',
        'Stay hydrated with warm fluids',
      ];
      followupMsg = 'Most colds clear up in 5-7 days. If your cough lasts more than 2 weeks or you have difficulty breathing, please visit a health facility.';
    } else if (topName.includes('gastro') || topName.includes('stomach')) {
      causes = [
        'Eating contaminated or undercooked food',
        'Drinking unsafe water',
        'Viral or bacterial infection',
      ];
      preventionTips = [
        'Drink ORS (Oral Rehydration Salts) to prevent dehydration',
        'Eat bland foods like rice, bananas, and toast when able',
        'Avoid dairy, spicy, and fatty foods until recovered',
        'Wash hands thoroughly and ensure food is well-cooked',
      ];
      immediateActions = [
        'Start ORS immediately to replace lost fluids',
        'If diarrhea persists beyond 3 days, visit a health facility',
      ];
      followupMsg = 'The most important thing is to stay hydrated. If you see blood in stool, can\'t keep fluids down, or symptoms last more than 3 days, seek medical care.';
    } else if (topName.includes('uti')) {
      causes = [
        'Bacteria entering the urinary tract',
        'Not drinking enough water',
        'Poor hygiene practices',
      ];
      preventionTips = [
        'Drink plenty of water (at least 8 glasses daily)',
        'Maintain good personal hygiene',
        'Don\'t hold urine for too long',
        'Wear loose, breathable cotton underwear',
      ];
      immediateActions = [
        'Drink lots of water to help flush out bacteria',
        'Visit a health facility for a urine test and antibiotics',
      ];
      followupMsg = 'UTIs are easily treatable with antibiotics. Don\'t ignore the symptoms - visit a clinic for a urine test and proper treatment.';
    } else if (topName.includes('headache') || topName.includes('tension')) {
      causes = [
        'Stress and tension',
        'Dehydration - not drinking enough water',
        'Eye strain from screens or poor lighting',
        'Lack of sleep or irregular sleep patterns',
      ];
      preventionTips = [
        'Drink at least 8 glasses of water daily',
        'Take regular breaks from screens (20-20-20 rule)',
        'Get 7-8 hours of sleep each night',
        'Practice relaxation techniques like deep breathing',
      ];
      immediateActions = [
        'Drink 2 glasses of water and rest in a quiet, dark room',
        'Take paracetamol if the pain is bothering you',
      ];
      followupMsg = 'Tension headaches are usually not serious. If headaches become frequent or very severe, or come with vision changes, please see a doctor.';
    } else {
      causes = [
        'Could have multiple possible causes',
        'May be related to lifestyle, diet, or environment',
        'Further examination needed to determine exact cause',
      ];
      preventionTips = [
        'Stay hydrated and eat nutritious meals',
        'Get adequate rest and sleep',
        'Visit a health facility if symptoms persist beyond 3 days',
        'Keep track of your symptoms and any changes',
      ];
      immediateActions = [
        'Rest and monitor your symptoms closely',
        'Visit a health facility for proper evaluation',
      ];
      followupMsg = 'We recommend monitoring your symptoms. If they persist, worsen, or new symptoms appear, please visit a health facility for proper examination.';
    }

    return {
      symptoms_identified: identified,
      conditions: topConditions,
      causes,
      prevention_tips: preventionTips,
      immediate_actions: immediateActions,
      overall_risk: overallRisk,
      followup_message: followupMsg,
      should_visit_clinic: shouldVisitClinic,
      clinic_urgency: clinicUrgency,
    };
  }

  // ====== Render Diagnosis ======
  function renderDiagnosis(data) {
    const tagsEl = document.getElementById('symptomTags');
    tagsEl.innerHTML = data.symptoms_identified
      .map(s => `<span class="sc-tag">${s}</span>`)
      .join('');

    const condList = document.getElementById('conditionsList');
    condList.innerHTML = '';
    data.conditions.forEach((cond, i) => {
      const condEl = document.createElement('div');
      condEl.className = `sc-condition-item ${cond.severity}`;
      condEl.innerHTML = `
        <div class="sc-condition-header">
          <div class="sc-condition-rank">${i + 1}</div>
          <div class="sc-condition-name-wrap">
            <h4 class="sc-condition-name">${cond.name}</h4>
            <span class="sc-severity-badge ${cond.severity}">${cond.severity} risk</span>
          </div>
          <div class="sc-likelihood">
            <svg viewBox="0 0 36 36" class="sc-likelihood-ring">
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" stroke="#E0E0E0" stroke-width="3"/>
              <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none" stroke="${getLikelihoodColor(cond.likelihood_percent)}" stroke-width="3"
                    stroke-dasharray="${cond.likelihood_percent}, 100" stroke-linecap="round"/>
            </svg>
            <span class="sc-likelihood-text">${cond.likelihood_percent}%</span>
          </div>
        </div>
        <p class="sc-condition-desc">${cond.description}</p>
      `;
      condList.appendChild(condEl);
    });

    document.getElementById('causesBody').innerHTML =
      `<ul class="sc-info-list">${data.causes.map(c => `<li>${c}</li>`).join('')}</ul>`;

    document.getElementById('preventionBody').innerHTML =
      `<ul class="sc-info-list">${data.prevention_tips.map(t => `<li>${t}</li>`).join('')}</ul>`;

    // Action area based on risk
    const actionArea = document.getElementById('actionArea');
    actionArea.innerHTML = '';

    // Consultation fee estimate based on condition
    const topCond = (data.conditions[0]?.name || '').toLowerCase();
    const feeRange = topCond.includes('malaria') || topCond.includes('typhoid') ? 'UGX 20,000 – 35,000' :
                     topCond.includes('uti') || topCond.includes('gastro') ? 'UGX 15,000 – 25,000' :
                     topCond.includes('cold') || topCond.includes('flu') || topCond.includes('respiratory') ? 'UGX 10,000 – 20,000' :
                     topCond.includes('headache') || topCond.includes('pain') ? 'UGX 10,000 – 20,000' :
                     topCond.includes('diabetes') || topCond.includes('chronic') ? 'UGX 25,000 – 50,000' :
                     'UGX 10,000 – 30,000';

    if (data.overall_risk === 'high' || data.should_visit_clinic || data.clinic_urgency === 'urgent') {
      actionArea.innerHTML = `
        <div class="sc-urgent-banner">
          <span class="material-icons-outlined">emergency</span>
          <p>Based on your symptoms, we strongly recommend visiting a health facility as soon as possible.</p>
        </div>
        <div style="background:#FFF8E1;border:1px solid #FFD54F;border-radius:10px;padding:10px 14px;font-size:12px;color:#795548;display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span class="material-icons-outlined" style="font-size:16px;color:#F9A825">payments</span>
          <span>Estimated clinic consultation fee: <strong>${feeRange}</strong></span>
        </div>
        <button class="btn sc-clinic-btn urgent" id="btnBookClinic">
          <span class="material-icons-outlined">local_hospital</span>
          Find Nearest Clinic
        </button>
        <button class="btn sc-monitor-btn" id="btnStartMonitor">
          <span class="material-icons-outlined">schedule</span>
          Start Symptom Monitoring
        </button>
      `;
    } else if (data.overall_risk === 'medium' || data.clinic_urgency === 'soon') {
      actionArea.innerHTML = `
        <div class="sc-medium-banner">
          <span class="material-icons-outlined">info</span>
          <p>${data.followup_message || 'Monitor your symptoms closely. If they persist or worsen, please visit a health facility.'}</p>
        </div>
        <div style="background:#FFF8E1;border:1px solid #FFD54F;border-radius:10px;padding:10px 14px;font-size:12px;color:#795548;display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span class="material-icons-outlined" style="font-size:16px;color:#F9A825">payments</span>
          <span>Estimated clinic consultation fee: <strong>${feeRange}</strong></span>
        </div>
        <button class="btn sc-monitor-btn primary" id="btnStartMonitor">
          <span class="material-icons-outlined">monitor_heart</span>
          Start Symptom Monitoring
        </button>
        <button class="btn sc-clinic-btn secondary" id="btnBookClinic">
          <span class="material-icons-outlined">local_hospital</span>
          Find Nearby Clinics
        </button>
      `;
    } else {
      actionArea.innerHTML = `
        <div class="sc-low-banner">
          <span class="material-icons-outlined">check_circle</span>
          <p>${data.followup_message || 'Your symptoms appear mild. Follow the prevention tips above and monitor how you feel.'}</p>
        </div>
        <button class="btn sc-monitor-btn primary" id="btnStartMonitor">
          <span class="material-icons-outlined">monitor_heart</span>
          Monitor My Symptoms
        </button>
        <button class="btn sc-clinic-btn secondary" id="btnBookClinic">
          <span class="material-icons-outlined">local_hospital</span>
          Find Nearby Clinics
        </button>
        <button class="btn sc-home-btn" id="btnGoHome">
          <span class="material-icons-outlined">home</span>
          Back to Dashboard
        </button>
      `;
    }

    // OTC medication recommendations — shown for ALL risk levels
    const otcMap = {
      malaria:      [{ name: 'Paracetamol 500mg', note: 'For fever & pain' }, { name: 'ORS Sachets', note: 'Hydration' }],
      fever:        [{ name: 'Paracetamol 500mg', note: 'For fever & pain' }, { name: 'ORS Sachets', note: 'Hydration' }],
      cold:         [{ name: 'Paracetamol 500mg', note: 'For fever & pain' }, { name: 'Vitamin C', note: 'Immune support' }],
      respiratory:  [{ name: 'Paracetamol 500mg', note: 'For fever & pain' }, { name: 'Vitamin C', note: 'Immune support' }],
      gastro:       [{ name: 'ORS Sachets', note: 'Replace lost fluids' }, { name: 'Metronidazole 400mg', note: 'For gut infections' }],
      stomach:      [{ name: 'ORS Sachets', note: 'Replace lost fluids' }, { name: 'Metronidazole 400mg', note: 'For gut infections' }],
      headache:     [{ name: 'Paracetamol 500mg', note: 'Pain relief' }, { name: 'Ibuprofen 400mg', note: 'Anti-inflammatory' }],
      tension:      [{ name: 'Paracetamol 500mg', note: 'Pain relief' }, { name: 'Ibuprofen 400mg', note: 'Anti-inflammatory' }],
      uti:          [{ name: 'Drink plenty of water', note: 'Flush bacteria' }, { name: 'Ciprofloxacin 500mg', note: 'Needs Rx — see pharmacist' }],
      typhoid:      [{ name: 'Paracetamol 500mg', note: 'Fever control' }, { name: 'ORS Sachets', note: 'Hydration' }],
    };

    const topCondName = (data.conditions[0]?.name || '').toLowerCase();
    let otcItems = [];
    for (const [key, items] of Object.entries(otcMap)) {
      if (topCondName.includes(key)) { otcItems = items; break; }
    }
    if (!otcItems.length) {
      otcItems = [{ name: 'Paracetamol 500mg', note: 'For pain or fever' }, { name: 'ORS Sachets', note: 'Stay hydrated' }];
    }

    const otcSection = document.createElement('div');
    otcSection.className = 'sc-otc-section';
    otcSection.innerHTML = `
      <div class="sc-otc-title">
        <span class="material-icons-outlined">medication</span>
        Available Over-the-Counter
      </div>
      <div class="sc-otc-disclaimer">
        ⚠️ This is not a prescription. Always confirm with a licensed pharmacist or doctor before taking any medication.
      </div>
      <div class="sc-otc-list" id="otcList">
        ${otcItems.map(item => `
          <div class="sc-otc-item">
            <span>${item.name}</span>
            <span style="font-size:11px;color:var(--text-secondary)">${item.note}</span>
          </div>
        `).join('')}
      </div>
      <button class="btn sc-order-btn" id="btnOrderMeds">
        <span class="material-icons-outlined">local_pharmacy</span>
        Order Medicines
      </button>
    `;
    actionArea.appendChild(otcSection);

    // ── Diagnosis Feedback Card ──────────────────────────────
    const feedbackCard = document.createElement('div');
    feedbackCard.style.cssText = 'margin-top:20px;background:#F8F9FA;border-radius:14px;padding:16px;text-align:center';
    feedbackCard.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:#1A1A1A;margin-bottom:10px">Was this assessment helpful?</div>
      <div style="display:flex;gap:10px;justify-content:center;margin-bottom:10px">
        <button id="feedbackYes" style="flex:1;max-width:120px;padding:10px;border:2px solid #4CAF50;background:#E8F5E9;border-radius:10px;font-size:13px;font-weight:700;color:#2E7D32;cursor:pointer;font-family:inherit">
          👍 Yes, helpful
        </button>
        <button id="feedbackNo" style="flex:1;max-width:120px;padding:10px;border:2px solid #E0E0E0;background:#fff;border-radius:10px;font-size:13px;font-weight:700;color:#5F6368;cursor:pointer;font-family:inherit">
          👎 Not really
        </button>
      </div>
      <textarea id="feedbackNote" style="display:none;width:100%;padding:9px 12px;border:1.5px solid #E0E0E0;border-radius:8px;font-size:12px;font-family:inherit;resize:none;outline:none" rows="2" placeholder="Tell us how we can improve..."></textarea>
      <div id="feedbackThanks" style="display:none;font-size:13px;color:#2E7D32;font-weight:600;padding:8px 0">✓ Thank you for your feedback!</div>
    `;
    actionArea.appendChild(feedbackCard);

    // Feedback button handlers
    const fbYes = feedbackCard.querySelector('#feedbackYes');
    const fbNo  = feedbackCard.querySelector('#feedbackNo');
    const fbNote = feedbackCard.querySelector('#feedbackNote');
    const fbThanks = feedbackCard.querySelector('#feedbackThanks');

    async function saveFeedback(helpful, note) {
      if (supabase && userId) {
        await supabase.from('ai_triage_sessions').insert({
          user_id: userId,
          symptoms_text: enteredSymptoms,
          top_diagnosis: data.conditions[0]?.name || '',
          feedback_helpful: helpful,
          feedback_note: note || null,
          created_at: new Date().toISOString(),
        }).catch(() => {});
      }
      fbYes.style.display = 'none';
      fbNo.style.display = 'none';
      fbNote.style.display = 'none';
      fbThanks.style.display = 'block';
    }

    fbYes.addEventListener('click', () => saveFeedback(true, ''));
    fbNo.addEventListener('click', () => {
      fbNote.style.display = 'block';
      fbNote.focus();
      fbNo.style.borderColor = '#F44336';
      fbNo.style.background = '#FFEBEE';
      fbNo.style.color = '#C62828';
      fbNo.textContent = '👎 Submit feedback';
      fbNo.onclick = () => saveFeedback(false, fbNote.value.trim());
    });
    // ────────────────────────────────────────────────────────────

    const orderBtn = document.getElementById('btnOrderMeds');
    if (orderBtn) {
      orderBtn.addEventListener('click', () => {
        // Map top condition name to a medicine-orders condition key
        const cn = topCondName;
        const condKey = cn.includes('malaria') ? 'malaria' :
                        cn.includes('fever') || cn.includes('typhoid') ? 'fever' :
                        cn.includes('pain') || cn.includes('headache') ? 'pain' :
                        cn.includes('gastro') || cn.includes('diarrhea') || cn.includes('stomach') ? 'digestive' :
                        cn.includes('respiratory') || cn.includes('cold') || cn.includes('flu') ? 'infection' :
                        cn.includes('uti') || cn.includes('urinary') ? 'infection' :
                        'other';
        window.location.href = 'medicine-orders.html?condition=' + condKey;
      });
    }

    // Wire action buttons
    const bookClinicBtn = document.getElementById('btnBookClinic');
    if (bookClinicBtn) {
      bookClinicBtn.addEventListener('click', () => {
        openClinicBookingModal(data);
      });
    }

    const monitorBtn = document.getElementById('btnStartMonitor');
    if (monitorBtn) {
      monitorBtn.addEventListener('click', () => {
        startMonitoring();
      });
    }

    const goHomeBtn = document.getElementById('btnGoHome');
    if (goHomeBtn) {
      goHomeBtn.addEventListener('click', () => {
        window.location.href = 'dashboard.html';
      });
    }
  }

  function getLikelihoodColor(percent) {
    if (percent >= 70) return '#D32F2F';
    if (percent >= 40) return '#F57C00';
    return '#2E7D32';
  }

  // ====== SCREEN 5: Follow-up Monitoring ======
  let countdownInterval = null;

  // Prevention tips per condition (used in Phase 1 & 2)
  function getPreventionTipsForCondition(conditionName, diagData) {
    // Use AI-generated tips if available
    if (diagData?.prevention_tips?.length) return diagData.prevention_tips;
    const c = (conditionName || '').toLowerCase();
    if (c.includes('malaria'))     return ['Sleep under a treated mosquito net tonight','Drink plenty of fluids and stay hydrated','Avoid going outside at dusk without mosquito repellent','Get a malaria rapid test (RDT) at the nearest clinic'];
    if (c.includes('typhoid'))     return ['Drink only boiled or bottled water','Wash your hands thoroughly before eating','Eat freshly cooked food only','Visit a health facility for proper testing'];
    if (c.includes('cold') || c.includes('respiratory') || c.includes('flu')) return ['Drink warm fluids — tea, soup, water with honey','Rest in a warm, well-ventilated room','Gargle with warm salt water for sore throat','Wash hands often to avoid spreading the infection'];
    if (c.includes('gastro') || c.includes('diarrhea') || c.includes('stomach')) return ['Start ORS (Oral Rehydration Salts) right away','Eat small amounts of bland food: rice, bananas, toast','Avoid dairy, spicy and fatty foods until better','Visit a clinic if diarrhea lasts more than 3 days'];
    if (c.includes('uti') || c.includes('urinary'))    return ['Drink at least 8 glasses of water today','Urinate frequently — don\'t hold it in','Avoid caffeine and alcohol while symptomatic','Visit a clinic for a urine test and antibiotics'];
    if (c.includes('headache') || c.includes('tension')) return ['Drink 2 glasses of water immediately','Rest in a quiet, dim room for 20 minutes','Take paracetamol if the pain is strong','Apply a cool or warm cloth to your forehead'];
    return ['Rest and get enough sleep','Drink plenty of water throughout the day','Eat light nutritious meals','Monitor your symptoms and visit a clinic if they worsen'];
  }

  function renderMonitorTipsCard(containerId, tips, conditionName) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="sc-monitor-tips-title">
        <span class="material-icons-outlined">health_and_safety</span>
        What to do for ${conditionName}
      </div>
      <ul class="sc-monitor-tips-list">
        ${tips.map(t => `<li>${t}</li>`).join('')}
      </ul>
    `;
  }

  function startMonitoring() {
    const condName = diagnosisData.conditions[0]?.name || 'Your condition';
    const firstName = user.first_name || user.firstName || user.name?.split(' ')[0] || 'there';

    monitoringSession = {
      condition: condName,
      risk: diagnosisData.overall_risk,
      startedAt: null, // set when countdown begins
      checkIns: [],
      symptomsSame: 0,
      initialAction: '',
    };

    // Update monitor header with personal greeting
    const heading = document.getElementById('monitorHeading');
    const subheading = document.getElementById('monitorSubheading');
    if (heading) heading.textContent = `Hey ${firstName}, let's monitor your health`;
    if (subheading) subheading.textContent = 'Follow the steps below while we check on you in 1 hour';

    // Show condition card
    document.getElementById('monitorCondition').innerHTML = `
      <div class="sc-monitor-cond-card">
        <span class="material-icons-outlined">medical_information</span>
        <div>
          <p class="sc-monitor-cond-name">Monitoring: ${condName}</p>
          <p class="sc-monitor-cond-risk">Risk level: <strong class="${monitoringSession.risk}">${monitoringSession.risk}</strong></p>
        </div>
      </div>
    `;

    // Reset all phases
    document.getElementById('monitorPhase1').style.display = 'block';
    document.getElementById('monitorPhase2').style.display = 'none';
    document.getElementById('monitorPhase3').style.display = 'none';
    document.getElementById('feelingOptions').style.display = 'none';
    document.getElementById('monitorResponse').style.display = 'none';
    document.getElementById('monitorTimer').style.display = 'none';

    // Render prevention tips in Phase 1
    const tips = getPreventionTipsForCondition(condName, diagnosisData);
    renderMonitorTipsCard('monitorTipsCard', tips, condName);

    // Wire the "Start 1-Hour Monitoring" button
    const startBtn = document.getElementById('btnStartCountdown');
    if (startBtn) {
      // Remove old listeners by cloning
      const newStartBtn = startBtn.cloneNode(true);
      startBtn.parentNode.replaceChild(newStartBtn, startBtn);
      newStartBtn.addEventListener('click', () => {
        const action = document.getElementById('monitorInitialAction')?.value.trim() || '';
        monitoringSession.initialAction = action;
        beginCountdown(tips, condName, action);
      });
    }

    showScreen('screenMonitor');
  }

  function beginCountdown(tips, condName, initialAction) {
    const now = new Date();
    monitoringSession.startedAt = now.toISOString();
    monitoringSession.countdownStartedAt = now.toISOString();
    // nextCheckinAt tells dashboard.js when to show the banner; checkinPending=false hides it until then
    monitoringSession.nextCheckinAt = new Date(now.getTime() + 3600000).toISOString(); // +1 hour
    monitoringSession.checkinPending = false;
    localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));

    // Persist to Supabase so pg_cron JOB 11 can send hourly push reminders
    try {
      if (!window._symptomSupa) {
        const _cfg = window.HOMATT_CONFIG || {};
        if (_cfg.SUPABASE_URL && _cfg.SUPABASE_ANON_KEY && window.supabase) {
          window._symptomSupa = window.supabase.createClient(_cfg.SUPABASE_URL, _cfg.SUPABASE_ANON_KEY);
        }
      }
      if (window._symptomSupa) {
        window._symptomSupa.auth.getSession().then(async ({ data }) => {
          const userId = data?.session?.user?.id;
          if (!userId) return;
          // Mark any previous active sessions for this user as abandoned first
          // so pg_cron doesn't send stale reminders
          await window._symptomSupa
            .from('symptom_monitoring_logs')
            .update({ outcome: 'abandoned', ended_at: monitoringSession.startedAt })
            .eq('user_id', userId)
            .eq('outcome', 'active')
            .catch(() => {});
          // Insert the new monitoring session
          window._symptomSupa.from('symptom_monitoring_logs').insert({
            user_id: userId,
            condition: condName,
            started_at: monitoringSession.startedAt,
            outcome: 'active',
            check_ins: [],
            last_checkin_at: monitoringSession.startedAt,
          }).then(({ error }) => {
            if (error) console.warn('[SC] monitoring log insert failed:', error.message);
            else monitoringSession._dbLogged = true;
          });
        });
      }
    } catch (_e) { /* non-fatal */ }

    // Switch to Phase 2
    document.getElementById('monitorPhase1').style.display = 'none';
    document.getElementById('monitorPhase2').style.display = 'block';

    // Render tips in countdown card too (reminder)
    renderMonitorTipsCard('monitorCountdownTips', tips, condName);

    // Show what the user said they're doing
    const reminderEl = document.getElementById('monitorActionReminder');
    if (reminderEl) {
      if (initialAction) {
        reminderEl.style.display = 'flex';
        reminderEl.innerHTML = `
          <span class="material-icons-outlined" style="font-size:18px;color:#1565C0;flex-shrink:0">check_circle</span>
          <span><strong>You're doing:</strong> ${initialAction}</span>
        `;
      } else {
        reminderEl.style.display = 'none';
      }
    }

    // Start the visual countdown
    startCountdownTimer(3600); // 3600 seconds = 1 hour

    // Request browser notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  function startCountdownTimer(totalSeconds) {
    // Clear any existing interval
    if (countdownInterval) clearInterval(countdownInterval);

    const circumference = 2 * Math.PI * 44; // r=44 → 276.46
    const progressCircle = document.getElementById('countdownProgressCircle');
    const displayEl = document.getElementById('countdownDisplay');
    let remaining = totalSeconds;

    function updateDisplay() {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      if (displayEl) displayEl.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
      if (progressCircle) {
        const offset = circumference * (1 - remaining / totalSeconds);
        progressCircle.style.strokeDashoffset = offset;
      }
    }

    updateDisplay();

    countdownInterval = setInterval(() => {
      remaining--;
      if (remaining < 0) remaining = 0;
      updateDisplay();

      if (remaining === 0) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        triggerCheckinPhase();
      }
    }, 1000);
  }

  function triggerCheckinPhase() {
    const firstName = user.first_name || user.firstName || user.name?.split(' ')[0] || 'there';

    // Mark check-in as pending so dashboard banner shows if user navigates away
    const _ms = (() => { try { return JSON.parse(localStorage.getItem('homatt_monitoring') || 'null'); } catch(e) { return null; } })();
    if (_ms) { _ms.checkinPending = true; try { localStorage.setItem('homatt_monitoring', JSON.stringify(_ms)); } catch(e) {} }

    // Hide countdown, show check-in prompt
    document.getElementById('monitorPhase2').style.display = 'none';
    document.getElementById('monitorPhase3').style.display = 'block';
    document.getElementById('feelingOptions').style.display = 'flex';

    // Personalize the check-in text
    const checkinText = document.getElementById('monitorCheckinText');
    if (checkinText) {
      checkinText.textContent = `Time's up, ${firstName}! How are you feeling now compared to when you started?`;
    }

    // Update header
    const heading = document.getElementById('monitorHeading');
    const subheading = document.getElementById('monitorSubheading');
    if (heading) heading.textContent = 'Check-In Time!';
    if (subheading) subheading.textContent = 'Tell us how you\'re feeling after 1 hour';

    // Send browser notification if page is open
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Homatt Health Check-In', {
        body: `Time to check in on your ${monitoringSession.condition}. How are you feeling?`,
        icon: '/icons/icon-192.png',
      });
    }

    // Re-enable feeling buttons and wire them
    document.querySelectorAll('.sc-feeling-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = false;
    });
    wireMonitoringButtons();
  }

  function wireMonitoringButtons() {
    document.querySelectorAll('.sc-feeling-btn').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', () => {
        const feeling = newBtn.dataset.feeling;

        // Disable all feeling buttons once one is selected
        document.querySelectorAll('.sc-feeling-btn').forEach(b => {
          b.classList.remove('selected');
          b.disabled = true;
        });
        newBtn.classList.add('selected');

        const checkinTime = new Date().toISOString();
        monitoringSession.checkIns.push({
          feeling,
          time: checkinTime,
          initialAction: monitoringSession.initialAction || '',
        });

        if (feeling === 'same') {
          monitoringSession.symptomsSame++;
        } else {
          monitoringSession.symptomsSame = 0;
        }

        localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));

        // Update last_checkin_at in DB so pg_cron resets its 55-min window
        // and doesn't send a duplicate push notification
        if (window._symptomSupa && monitoringSession.startedAt) {
          window._symptomSupa.auth.getSession().then(({ data }) => {
            const userId = data?.session?.user?.id;
            if (!userId) return;
            window._symptomSupa
              .from('symptom_monitoring_logs')
              .update({ last_checkin_at: checkinTime, check_ins: monitoringSession.checkIns })
              .eq('user_id', userId)
              .eq('started_at', monitoringSession.startedAt)
              .eq('outcome', 'active')
              .catch(() => {});
          });
        }

        handleMonitoringResponse(feeling);
      });
    });
  }

  function handleMonitoringResponse(feeling) {
    const responseEl = document.getElementById('monitorResponse');
    const timerEl = document.getElementById('monitorTimer');

    const firstName = user.first_name || user.name?.split(' ')[0] || 'there';
    if (feeling === 'better') {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const inBg = isDark ? '#2C2C2C' : '#fff';
      const inColor = isDark ? '#F0F0F0' : '#111';
      responseEl.innerHTML = `
        <div class="sc-monitor-msg better">
          <span class="material-icons-outlined">celebration</span>
          <div>
            <p class="sc-monitor-msg-title">Great news, ${firstName}!</p>
            <p>We're happy to hear you're feeling better. Help us learn by sharing your recovery experience — it helps us give better advice in future.</p>
          </div>
        </div>
        <div style="margin-top:14px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px">
          <label style="font-size:13px;font-weight:600;color:var(--text-primary);display:block;margin-bottom:8px">
            What helped you recover? (optional but helpful)
          </label>
          <textarea id="recoveryWhatHelped" rows="3"
            style="width:100%;border:2px solid var(--border);border-radius:8px;padding:10px 12px;
              font-size:14px;font-family:inherit;background:${inBg};color:${inColor};resize:none;outline:none;box-sizing:border-box"
            placeholder="e.g. I rested for 2 days, drank ORS, took paracetamol 500mg..."></textarea>
          <div style="margin-top:10px">
            <label style="font-size:13px;font-weight:600;color:var(--text-primary);display:block;margin-bottom:6px">How long did it take to feel better?</label>
            <select id="recoveryDuration"
              style="width:100%;padding:10px 12px;border:2px solid var(--border);border-radius:8px;font-size:14px;font-family:inherit;background:${inBg};color:${inColor};outline:none">
              <option value="">Select...</option>
              <option value="few_hours">A few hours</option>
              <option value="1_day">About 1 day</option>
              <option value="2_3_days">2–3 days</option>
              <option value="1_week">About a week</option>
              <option value="longer">Longer than a week</option>
            </select>
          </div>
        </div>
        <button id="btnMarkRecovered"
          style="width:100%;margin-top:14px;padding:14px;background:linear-gradient(135deg,#2E7D32,#43A047);color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;touch-action:manipulation">
          <span class="material-icons-outlined">check_circle</span>
          Mark as Fully Recovered
        </button>
      `;
      responseEl.style.display = 'block';
      timerEl.style.display = 'none';

      document.getElementById('btnMarkRecovered')?.addEventListener('click', async () => {
        const whatHelped = document.getElementById('recoveryWhatHelped')?.value.trim() || '';
        const duration = document.getElementById('recoveryDuration')?.value || '';
        // Save recovery record locally
        const recoveries = JSON.parse(localStorage.getItem('homatt_recovery_log') || '[]');
        recoveries.unshift({
          condition: monitoringSession.condition,
          recoveredAt: new Date().toISOString(),
          startedAt: monitoringSession.startedAt,
          whatHelped,
          duration,
          checkIns: monitoringSession.checkIns,
        });
        if (recoveries.length > 50) recoveries.pop();
        localStorage.setItem('homatt_recovery_log', JSON.stringify(recoveries));

        // Save to Supabase symptom_monitoring_logs if authenticated
        try {
          if (!window._symptomSupa) {
            const _cfg = window.HOMATT_CONFIG || {};
            if (_cfg.SUPABASE_URL && _cfg.SUPABASE_ANON_KEY && window.supabase) {
              window._symptomSupa = window.supabase.createClient(_cfg.SUPABASE_URL, _cfg.SUPABASE_ANON_KEY);
            }
          }
          if (window._symptomSupa) {
            const { data: _sd } = await window._symptomSupa.auth.getSession();
            const _sess = _sd?.session || null;
            await window._symptomSupa.from('symptom_monitoring_logs').insert({
              user_id: _sess?.user?.id || null,
              condition: monitoringSession.condition,
              started_at: monitoringSession.startedAt,
              ended_at: new Date().toISOString(),
              outcome: 'recovered',
              check_ins: monitoringSession.checkIns,
              what_helped: whatHelped,
            });
          }
        } catch(_e) { console.warn('[SC] monitoring log save failed:', _e.message); }

        // Clear active monitoring
        localStorage.removeItem('homatt_monitoring');
        monitoringSession = null;
        // Show final message
        responseEl.innerHTML = `
          <div class="sc-monitor-msg better" style="flex-direction:column;text-align:center;padding:20px">
            <span class="material-icons-outlined" style="font-size:48px;color:#2E7D32;margin-bottom:8px">health_and_safety</span>
            <p class="sc-monitor-msg-title" style="font-size:18px">Recovery recorded, ${firstName}!</p>
            <p style="color:var(--text-secondary);line-height:1.6;margin-top:6px">
              We've saved your recovery journey. ${whatHelped ? 'What you shared helps us give you smarter advice next time.' : 'Stay healthy and take care!'}
            </p>
            <button onclick="window.location.href='dashboard.html'"
              style="margin-top:16px;padding:12px 24px;background:#1B5E20;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer">
              Back to Dashboard
            </button>
          </div>
        `;
        document.getElementById('sc-feeling-options') && (document.getElementById('feelingOptions').style.display = 'none');
      });
    } else if (feeling === 'same') {
      const condition = (monitoringSession.condition || '').toLowerCase();
      const otcMap = {
        malaria: { icon: 'warning', label: 'Get Tested First', color: '#E65100', items: ['Visit a clinic or pharmacy for a malaria Rapid Diagnostic Test (RDT)', 'Do not self-medicate with antimalarials without a positive test', 'Take paracetamol to reduce fever while waiting'] },
        cold: { icon: 'medication', label: 'OTC Options', color: '#1565C0', items: ['Paracetamol 500mg for fever and headache (2 tablets every 6 hrs after food)', 'Antihistamine (e.g. cetirizine) for runny nose', 'Warm water with honey and lemon for sore throat', 'Saline nasal drops for blocked nose'] },
        headache: { icon: 'medication', label: 'OTC Options', color: '#1565C0', items: ['Paracetamol 500mg or Ibuprofen 400mg with food', 'Drink 2 glasses of water — dehydration is a common cause', 'Rest in a quiet, dim room for 20 minutes'] },
        gastro: { icon: 'medication', label: 'OTC Options', color: '#1565C0', items: ['ORS (Oral Rehydration Salts) — buy from any pharmacy, mix with clean water', 'Zinc tablets (for children with diarrhea)', 'Avoid spicy, fatty, or dairy foods until better', 'If diarrhea lasts >3 days or there is blood, go to a clinic'] },
        stomach: { icon: 'medication', label: 'OTC Options', color: '#1565C0', items: ['ORS (Oral Rehydration Salts) to prevent dehydration', 'Oral metronidazole if prescribed before for similar issue', 'Visit clinic if no improvement in 48 hours'] },
        uti: { icon: 'local_hospital', label: 'Clinic Recommended', color: '#C62828', items: ['UTIs require a prescription antibiotic — OTC drugs are not enough', 'Drink lots of water to help flush bacteria', 'Visit a clinic for a urine test and proper treatment today'] },
        typhoid: { icon: 'local_hospital', label: 'Clinic Recommended', color: '#C62828', items: ['Typhoid requires prescription antibiotics from a doctor', 'Do not self-medicate', 'Visit a health facility for a Widal test or blood culture'] },
        default: { icon: 'medication', label: 'General Tips', color: '#2E7D32', items: ['Rest and stay well hydrated', 'Take paracetamol for pain or fever if needed', 'Eat light, nutritious meals', 'If no improvement in 48 hours, visit a clinic'] },
      };

      const getOTC = () => {
        for (const key of Object.keys(otcMap)) {
          if (key !== 'default' && condition.includes(key)) return otcMap[key];
        }
        // Check by partial keywords
        if (condition.includes('respiratory') || condition.includes('cold') || condition.includes('flu')) return otcMap.cold;
        if (condition.includes('gastro') || condition.includes('diarrhea')) return otcMap.gastro;
        return otcMap.default;
      };

      const otc = getOTC();

      if (monitoringSession.symptomsSame >= 2) {
        // 2nd or more "same" — offer OTC first, then clinic
        const needsClinic = ['malaria', 'typhoid', 'uti'].some(k => condition.includes(k));
        responseEl.innerHTML = `
          <div class="sc-monitor-msg escalate">
            <span class="material-icons-outlined">warning</span>
            <div>
              <p class="sc-monitor-msg-title">Symptoms still not improving</p>
              <p>${needsClinic ? 'Your condition needs medical attention. Please visit a clinic.' : 'Try the options below. If there\'s no improvement in 24 hours, please see a doctor.'}</p>
            </div>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-top:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span class="material-icons-outlined" style="color:${otc.color};font-size:20px">${otc.icon}</span>
              <strong style="font-size:13px;color:var(--text-primary)">${otc.label}</strong>
            </div>
            <ul style="padding-left:16px;margin:0;font-size:13px;color:var(--text-secondary);line-height:1.7">
              ${otc.items.map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
          <button class="btn sc-clinic-btn urgent" id="btnMonitorClinic" style="margin-top:12px">
            <span class="material-icons-outlined">local_hospital</span>
            Find Nearest Clinic
          </button>
        `;
        responseEl.style.display = 'block';
        timerEl.style.display = 'none';
        document.getElementById('btnMonitorClinic')?.addEventListener('click', () => {
          openClinicBookingModal(diagnosisData || { conditions: [{ name: monitoringSession.condition, likelihood_percent: 60 }], clinic_urgency: 'soon', overall_risk: 'medium', symptoms_identified: [] });
        });
      } else {
        // 1st "same" — ask what they did + show OTC
        responseEl.innerHTML = `
          <div class="sc-monitor-msg same">
            <span class="material-icons-outlined">info</span>
            <div>
              <p class="sc-monitor-msg-title">Noted — no change yet</p>
              <p>Tell us what you tried, and we'll suggest what to do next.</p>
            </div>
          </div>
          <div style="margin-top:14px">
            <label style="font-size:13px;font-weight:600;color:var(--text-primary);display:block;margin-bottom:8px">
              What did you do to manage your symptoms? (optional)
            </label>
            <textarea id="monitorWhatDid" rows="3"
              style="width:100%;border:2px solid #C8C8C8;border-radius:8px;padding:10px 12px;
                font-size:15px;font-family:inherit;background:#fff;color:#111;resize:none;outline:none;
                -webkit-text-fill-color:#111;box-sizing:border-box"
              placeholder="e.g. I rested, drank water, took paracetamol..."></textarea>
            <button id="btnSameSubmit"
              style="width:100%;margin-top:10px;padding:13px;background:linear-gradient(135deg,#1565C0,#1976D2);color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;touch-action:manipulation">
              <span class="material-icons-outlined">check_circle</span>
              Submit &amp; Continue
            </button>
          </div>
          <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px;margin-top:12px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <span class="material-icons-outlined" style="color:${otc.color};font-size:20px">${otc.icon}</span>
              <strong style="font-size:13px;color:var(--text-primary)">${otc.label}</strong>
            </div>
            <ul style="padding-left:16px;margin:0;font-size:13px;color:var(--text-secondary);line-height:1.7">
              ${otc.items.map(item => `<li>${item}</li>`).join('')}
            </ul>
          </div>
        `;
        responseEl.style.display = 'block';
        timerEl.style.display = 'none';

        // Save "what did they do" on change (passive autosave)
        const didInput = document.getElementById('monitorWhatDid');
        if (didInput) {
          didInput.addEventListener('change', () => {
            monitoringSession.lastAction = didInput.value.trim();
            localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));
          });
          // Dark mode border
          const theme = document.documentElement.getAttribute('data-theme');
          if (theme === 'dark') {
            didInput.style.background = '#2C2C2C';
            didInput.style.borderColor = '#555';
            didInput.style.color = '#F0F0F0';
            didInput.style.webkitTextFillColor = '#F0F0F0';
          }
        }

        // Submit & Continue button
        document.getElementById('btnSameSubmit')?.addEventListener('click', async () => {
          const actionText = document.getElementById('monitorWhatDid')?.value.trim() || '';
          monitoringSession.lastAction = actionText;
          localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));

          // Try to save check-in to Supabase
          try {
            if (!window._symptomSupa) {
              const _cfg = window.HOMATT_CONFIG || {};
              if (_cfg.SUPABASE_URL && _cfg.SUPABASE_ANON_KEY && window.supabase) {
                window._symptomSupa = window.supabase.createClient(_cfg.SUPABASE_URL, _cfg.SUPABASE_ANON_KEY);
              }
            }
            if (window._symptomSupa) {
              const { data: _sd } = await window._symptomSupa.auth.getSession();
              const _sess = _sd?.session || null;
              await window._symptomSupa.from('symptom_monitoring_logs').upsert({
                user_id: _sess?.user?.id || null,
                condition: monitoringSession.condition,
                started_at: monitoringSession.startedAt,
                outcome: 'active',
                check_ins: monitoringSession.checkIns,
                last_checkin_at: new Date().toISOString(),
              }, { onConflict: 'user_id,started_at' });
            }
          } catch(_e) { console.warn('[SC] check-in save failed:', _e.message); }

          // Show confirmation and schedule next check-in
          responseEl.innerHTML = `
            <div class="sc-monitor-msg same" style="flex-direction:column;text-align:center;padding:20px">
              <span class="material-icons-outlined" style="font-size:40px;color:#1565C0;margin-bottom:8px">schedule</span>
              <p class="sc-monitor-msg-title">Noted! Check back in 1 hour</p>
              <p style="color:var(--text-secondary);line-height:1.6;margin-top:6px">
                We've recorded your check-in. We'll remind you to check back in an hour. Rest and stay hydrated.
              </p>
            </div>
          `;
          timerEl.style.display = 'flex';
          scheduleNextCheckIn(1);
        });
      }
    } else if (feeling === 'worse') {
      const firstName = user.first_name || user.firstName || user.name?.split(' ')[0] || 'there';
      const condName = monitoringSession.condition || 'your condition';
      responseEl.innerHTML = `
        <div class="sc-monitor-msg worse">
          <span class="material-icons-outlined">emergency</span>
          <div>
            <p class="sc-monitor-msg-title">${firstName}, please seek care now</p>
            <p>Your ${condName} symptoms are getting worse after monitoring. Don't wait — visit the nearest health facility as soon as possible. Your health matters.</p>
          </div>
        </div>
        <div style="background:#FFEBEE;border:1px solid #EF9A9A;border-radius:10px;padding:12px 14px;margin-top:12px;font-size:13px;color:#B71C1C">
          <strong>Warning signs that need immediate attention:</strong>
          <ul style="margin:8px 0 0 16px;line-height:1.8">
            <li>Difficulty breathing or chest pain</li>
            <li>High fever (above 39°C) that won't come down</li>
            <li>Severe vomiting or diarrhea</li>
            <li>Loss of consciousness or extreme weakness</li>
          </ul>
        </div>
        <button class="btn sc-clinic-btn urgent" id="btnWorseClinic" style="margin-top:14px">
          <span class="material-icons-outlined">local_hospital</span>
          Find Nearest Clinic Now
        </button>
        <button class="btn sc-emergency-btn" id="btnEmergency" style="margin-top:8px">
          <span class="material-icons-outlined">call</span>
          Call Emergency: 112
        </button>
      `;
      responseEl.style.display = 'block';
      timerEl.style.display = 'none';

      const worseClinic = document.getElementById('btnWorseClinic');
      if (worseClinic) {
        worseClinic.addEventListener('click', () => {
          openClinicBookingModal(diagnosisData || { conditions: [{ name: monitoringSession.condition, likelihood_percent: 70 }], clinic_urgency: 'urgent', overall_risk: 'high', symptoms_identified: [] });
        });
      }

      const emergBtn = document.getElementById('btnEmergency');
      if (emergBtn) {
        emergBtn.addEventListener('click', () => {
          window.location.href = 'tel:112';
        });
      }
    }
  }

  function scheduleNextCheckIn(hours) {
    document.getElementById('nextCheckTime').textContent =
      hours === 1 ? '1 hour' : `${hours} hours`;

    const nextTime = new Date();
    nextTime.setTime(nextTime.getTime() + hours * 3600000);
    monitoringSession.nextCheckIn = nextTime.toISOString();
    localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));

    // Request browser notification permission for auto hourly reminders
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Show Phase 2 countdown again for the next hour
    document.getElementById('monitorPhase3').style.display = 'none';
    document.getElementById('monitorResponse').style.display = 'none';
    document.getElementById('monitorTimer').style.display = 'none';
    document.getElementById('feelingOptions').style.display = 'none';
    document.getElementById('monitorPhase2').style.display = 'block';

    const tips = getPreventionTipsForCondition(monitoringSession.condition, diagnosisData);
    renderMonitorTipsCard('monitorCountdownTips', tips, monitoringSession.condition);

    const reminderEl = document.getElementById('monitorActionReminder');
    if (reminderEl && monitoringSession.initialAction) {
      reminderEl.style.display = 'flex';
      reminderEl.innerHTML = `
        <span class="material-icons-outlined" style="font-size:18px;color:#1565C0;flex-shrink:0">check_circle</span>
        <span><strong>Keep doing:</strong> ${monitoringSession.initialAction}</span>
      `;
    }

    // Start countdown for next check-in
    const msUntil = nextTime - Date.now();
    startCountdownTimer(Math.max(0, Math.round(msUntil / 1000)));

    // Schedule in-page reminder using setTimeout (fallback if countdown misses)
    if (msUntil > 0 && msUntil < 2 * 3600000) {
      setTimeout(() => {
        const m = JSON.parse(localStorage.getItem('homatt_monitoring') || 'null');
        if (!m) return;
        if (document.getElementById('screenMonitor').classList.contains('active')) {
          triggerCheckinPhase();
        }
      }, msUntil);
    }
  }

  // ====== Save to history (localStorage + Supabase ai_triage_sessions) ======
  async function saveToHistory(data) {
    // Local symptom history
    const history = JSON.parse(localStorage.getItem('homatt_symptom_history') || '[]');
    history.unshift({
      date:       new Date().toISOString(),
      patient:    selectedPatient.name,
      symptoms:   enteredSymptoms,
      conditions: data.conditions,
      risk:       data.overall_risk,
    });
    if (history.length > 20) history.pop();
    localStorage.setItem('homatt_symptom_history', JSON.stringify(history));

    // Save triage context for booking page
    const topCondition = (data.conditions || [])[0] || {};
    const triageCtx = {
      primary_condition: topCondition.name || '',
      confidence:        topCondition.likelihood_percent || 0,
      ai_confidence:     topCondition.likelihood_percent || 0,
      overall_risk:      data.overall_risk || 'low',
      should_visit_clinic: data.should_visit_clinic || false,
      clinic_urgency:    data.clinic_urgency || 'none',
      symptoms:          enteredSymptoms,
      timestamp:         new Date().toISOString(),
      ai_conditions:     data.conditions || [],   // all up-to-3 diagnoses with percentages
    };
    localStorage.setItem('homatt_last_triage', JSON.stringify(triageCtx));

    // Save to Supabase ai_triage_sessions for learning engine
    if (supabase && session?.user?.id) {
      try {
        await supabase.from('ai_triage_sessions').insert({
          user_id:            session.user.id,
          patient_name:       selectedPatient.name,
          patient_age:        selectedPatient.age || null,
          patient_sex:        selectedPatient.sex || null,
          symptoms_text:      enteredSymptoms,
          followup_answers:   followupAnswers,
          ai_conditions:      data.conditions,
          ai_confidence:      topCondition.likelihood_percent || null,
          top_diagnosis:      topCondition.name || null,
          overall_risk:       data.overall_risk || null,
          should_visit_clinic: data.should_visit_clinic || false,
          clinic_urgency:     data.clinic_urgency || 'none',
        });
      } catch (e) {
        // Non-fatal: triage session save failed
        console.warn('[Homatt] Failed to save triage session:', e.message);
      }
    }
  }

  // ====== Fetch historical AI corrections for learning context ======
  async function getHistoricalCorrections(symptomsText) {
    if (!supabase || !session?.user?.id) return [];
    try {
      const { data } = await supabase
        .from('ai_triage_sessions')
        .select('symptoms_text, top_diagnosis, clinician_confirmed_diagnosis, ai_was_correct')
        .not('clinician_confirmed_diagnosis', 'is', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!data?.length) return [];
      // Filter to cases where AI was wrong
      return data.filter(d => d.ai_was_correct === false).slice(0, 4);
    } catch (e) {
      return [];
    }
  }

  // ====== Show AI error banner on results screen ======
  function showAIError(errorMsg) {
    const content = document.getElementById('resultsContent');
    // Remove any existing error banner
    const existing = document.getElementById('aiErrorBanner');
    if (existing) existing.remove();

    const banner = document.createElement('div');
    banner.id = 'aiErrorBanner';
    banner.style.cssText = 'background:#FFF3E0;border:1px solid #FF9800;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#E65100;';
    banner.innerHTML = `
      <strong>AI Unavailable</strong> — Using offline analysis instead.<br>
      <span style="font-size:11px;color:#999;">Error: ${errorMsg}</span>
    `;
    content.insertBefore(banner, content.firstChild);
  }

  // ====== AI API Call: Groq (primary) → OpenAI (secondary) → Gemini (tertiary) ======
  async function callAI(prompt) {
    if (!PROXY_URL) {
      throw new Error('API_PROXY_URL is not set in config.js. Deploy the Supabase Edge Function first.');
    }

    console.log('[Homatt AI] Starting AI call chain via proxy...');
    const providers = ['gemini', 'groq', 'openai'];
    const errors = [];

    for (const provider of providers) {
      try {
        console.log(`[Homatt AI] Trying ${provider}...`);
        const text = await callProxy(provider, prompt);
        if (text) {
          console.log(`[Homatt AI] ${provider} SUCCESS`);
          return text;
        }
        errors.push(`${provider}: empty response`);
      } catch (err) {
        console.warn(`[Homatt AI] ${provider} failed:`, err.message);
        errors.push(`${provider}: ${err.message}`);
      }
    }

    const errorDetails = errors.join(' | ');
    console.error('[Homatt AI] All providers failed:', errorDetails);
    throw new Error(errorDetails);
  }

  // ---- Proxy Call ----
  async function callProxy(provider, prompt) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, prompt }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        const errBody = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errBody.slice(0, 100)}`);
      }

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      return data.text || '';
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out after 25s');
      throw err;
    }
  }

  // ====== JSON Parser ======
  function parseJSON(text) {
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.error('JSON parse error:', e, '\nRaw:', text);
      return null;
    }
  }

  // ====== Haversine distance (km) between two lat/lng points ======
  function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // Get user GPS coords — returns {lat, lng} or null
  async function getUserCoords() {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        ()  => resolve(null),
        { timeout: 6000, maximumAge: 300000 }
      );
    });
  }

  // ====== Clinic Booking — Full Screen Modal ======
  async function openClinicBookingModal(diagData) {
    localStorage.setItem('homatt_clinic_reason', JSON.stringify({
      condition: diagData.conditions[0]?.name || 'Health Check',
      urgency: diagData.clinic_urgency || diagData.overall_risk,
      symptoms: diagData.symptoms_identified,
    }));

    const existing = document.getElementById('clinicBookingModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'clinicBookingModal';
    modal.style.cssText = 'display:flex;position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:1000;align-items:flex-end';

    const topConditionName = diagData.conditions[0]?.name || 'Health Check';
    const urgencyColor = diagData.overall_risk === 'high' ? '#C62828' :
                         diagData.overall_risk === 'medium' ? '#E65100' : '#1B5E20';

    modal.innerHTML = `
      <div id="cbInner" style="background:#F8F9FA;border-radius:22px 22px 0 0;width:100%;max-height:90vh;overflow-y:auto;box-sizing:border-box;display:flex;flex-direction:column">
        <!-- Header -->
        <div style="background:#fff;border-radius:22px 22px 0 0;padding:20px 20px 16px;position:sticky;top:0;z-index:2;border-bottom:1px solid #F0F0F0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
            <h3 style="font-size:17px;font-weight:700;color:#111;margin:0">Clinics Near You</h3>
            <button id="cbClose" style="background:none;border:none;cursor:pointer;padding:4px;color:#666">
              <span class="material-icons-outlined" style="font-size:24px">close</span>
            </button>
          </div>
          <p style="font-size:12px;color:#666;margin:0">Based on your assessment: <strong style="color:${urgencyColor}">${topConditionName}</strong></p>
        </div>

        <!-- Loading state -->
        <div id="cbLoading" style="display:flex;flex-direction:column;align-items:center;padding:40px 20px;gap:12px">
          <span class="material-icons-outlined" style="font-size:40px;color:#1B5E20;animation:scBounce 1s ease-in-out infinite">my_location</span>
          <p style="font-size:14px;color:#555;text-align:center;margin:0">Finding clinics near you…</p>
        </div>

        <!-- Clinic list -->
        <div id="cbClinicList" style="display:none;padding:12px 16px 24px"></div>

        <!-- Booking confirm step -->
        <div id="cbConfirmStep" style="display:none;padding:20px 16px 28px"></div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.getElementById('cbClose').addEventListener('click', () => modal.remove());

    // ── Fetch user location + clinics in parallel ──
    // Safe clinic fetch: tries full column list first; if migration hasn't run yet
    // (schema cache error), retries with just the stable columns so real clinics
    // still appear instead of falling back to hard-coded mock data.
    async function fetchClinics() {
      if (!supabase) return { data: null };
      let res = await supabase.from('clinics')
        .select('id, name, district, county, city, parish, address, latitude, longitude, phone, consultation_fee, specialties, accepts_online_slots, opening_hours, services, facilities, description, contact_person, whatsapp')
        .eq('active', true)
        .limit(50);
      if (res.error && (res.error.message?.includes('schema cache') || res.error.message?.includes('column'))) {
        // Migration not yet applied — retry without new columns so real clinics still show
        res = await supabase.from('clinics')
          .select('id, name, district, city, address, latitude, longitude, phone, consultation_fee, specialties, opening_hours')
          .eq('active', true)
          .limit(50);
      }
      return res;
    }

    const [userCoords, clinicsResult] = await Promise.all([
      getUserCoords(),
      fetchClinics(),
    ]);

    const userLat = userCoords?.lat ?? null;
    const userLng = userCoords?.lng ?? null;
    const userDistrict = (user.district || user.location || '').toLowerCase();

    // ── Reverse-geocode user GPS to get their subcounty/parish name ──
    // Uses OpenStreetMap Nominatim (free, no API key).
    // This lets us match clinics that entered their location as a place name
    // even when the user has GPS but the clinic has no lat/lng.
    let userGeoNames = { district: userDistrict, subcounty: '', county: '', parish: '' };
    if (userLat !== null && userLng !== null) {
      try {
        const rgRes = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${userLat}&lon=${userLng}&zoom=14&addressdetails=1`,
          { headers: { 'Accept-Language': 'en', 'User-Agent': 'HomattHealth/1.0' } }
        );
        if (rgRes.ok) {
          const rg = await rgRes.json();
          const addr = rg.address || {};
          // Uganda's Nominatim address breakdown:
          //   village/town/suburb = subcounty or trading centre
          //   county = county
          //   state_district = district
          userGeoNames = {
            district:  (addr.state_district || addr.county || userDistrict || '').toLowerCase(),
            county:    (addr.county || '').toLowerCase(),
            subcounty: (addr.village || addr.town || addr.suburb || addr.city_district || '').toLowerCase(),
            parish:    (addr.neighbourhood || addr.hamlet || addr.isolated_dwelling || '').toLowerCase(),
          };
        }
      } catch (_) { /* Nominatim unavailable — use profile district */ }
    }

    // condFeeMap is built after clinics are sorted/sliced (needs real clinic IDs)
    // { clinic_id: [{condition_name, fee, notes}, ...] }
    let condFeeMap = {};

    const mockClinics = [
      { id: 'mock-1', name: 'Mulago National Referral Hospital', district: 'Kampala', city: 'Mulago', address: 'Mulago Hill Rd', latitude: 0.3476, longitude: 32.5739, consultation_fee: 20000 },
      { id: 'mock-2', name: 'Kampala International Hospital',    district: 'Kampala', city: 'Namuwongo', address: 'Namuwongo', latitude: 0.3137, longitude: 32.5811, consultation_fee: 50000 },
      { id: 'mock-3', name: 'Case Medical Centre',               district: 'Kampala', city: 'Kololo',    address: 'Kololo', latitude: 0.3392, longitude: 32.5942, consultation_fee: 45000 },
      { id: 'mock-4', name: 'Nsambya Hospital',                  district: 'Kampala', city: 'Nsambya',   address: 'Nsambya', latitude: 0.2946, longitude: 32.5889, consultation_fee: 25000 },
      { id: 'mock-5', name: 'Nakasero Hospital',                 district: 'Kampala', city: 'Nakasero',  address: 'Nakasero', latitude: 0.3329, longitude: 32.5833, consultation_fee: 60000 },
    ];

    // Prefer real clinics from the DB; fall back to mock data only when DB returned nothing
    let clinics = (clinicsResult?.data?.length) ? clinicsResult.data : mockClinics;

    // Store full clinic objects so the booking confirm step can access services/pricing
    let _cbClinics = clinics;

    // ── Uganda hierarchy location score for a clinic ──
    // Scores how closely the clinic's place names match the user's location.
    // Parish match = 100, Subcounty = 85, County = 65, District = 45, none = 0
    function locationScore(c) {
      const cDistrict  = (c.district  || '').toLowerCase();
      const cCity      = (c.city      || '').toLowerCase(); // subcounty
      const cCounty    = (c.county    || '').toLowerCase();
      const cParish    = (c.parish    || '').toLowerCase();
      const { district: uDist, subcounty: uSub, county: uCo, parish: uPar } = userGeoNames;

      if (uPar  && cParish   && (cParish.includes(uPar)   || uPar.includes(cParish)))   return 100;
      if (uSub  && cCity     && (cCity.includes(uSub)     || uSub.includes(cCity)))      return 85;
      if (uSub  && cParish   && (cParish.includes(uSub)   || uSub.includes(cParish)))    return 80;
      if (uCo   && cCounty   && (cCounty.includes(uCo)    || uCo.includes(cCounty)))     return 65;
      if (uDist && cDistrict && (cDistrict === uDist || cDistrict.includes(uDist) || uDist.includes(cDistrict))) return 45;
      return 0;
    }

    // Sort priority:
    //  1. GPS distance (km) when both user and clinic have coordinates
    //  2. Uganda place-name hierarchy score (parish > subcounty > county > district)
    //  3. Alphabetical name
    clinics = clinics
      .map(c => ({
        ...c,
        _distKm: (userLat !== null && userLng !== null && c.latitude && c.longitude)
          ? haversineKm(userLat, userLng, parseFloat(c.latitude), parseFloat(c.longitude))
          : null,
        _locScore: locationScore(c),
      }))
      .sort((a, b) => {
        // Clinics with GPS distance come first, sorted by km
        if (a._distKm !== null && b._distKm !== null) return a._distKm - b._distKm;
        if (a._distKm !== null) return -1; // a has GPS, b doesn't → a first
        if (b._distKm !== null) return 1;
        // Both without GPS coords — use place-name hierarchy score
        if (b._locScore !== a._locScore) return b._locScore - a._locScore;
        return (a.name || '').localeCompare(b.name || '');
      });

    // Only show the nearest/most relevant (max 10)
    clinics = clinics.slice(0, 10);
    _cbClinics = clinics; // keep sorted/sliced reference for booking step

    // ── Fetch ALL condition fees for the top clinics (sequential — needs IDs first) ──
    // Fetches every row from clinic_condition_fees for the returned clinics so that
    // ALL AI conditions (not just the top one's first word) can be matched.
    if (supabase) {
      const realIds = clinics.filter(c => !String(c.id).startsWith('mock-')).map(c => c.id);
      if (realIds.length) {
        const feesRes = await supabase.from('clinic_condition_fees')
          .select('clinic_id, condition_name, fee, notes')
          .in('clinic_id', realIds);
        if (feesRes?.data) {
          feesRes.data.forEach(row => {
            if (!condFeeMap[row.clinic_id]) condFeeMap[row.clinic_id] = [];
            condFeeMap[row.clinic_id].push(row);
          });
        }
      }
    }

    // Returns the best-matching fee row for a clinic given the AI conditions list,
    // or null when no condition fee has been entered for this clinic.
    function getBestFeeMatch(clinicId) {
      const fees = condFeeMap[clinicId] || [];
      if (!fees.length) return null;
      for (const cond of (diagData.conditions || [])) {
        // Split condition name into meaningful words (>3 chars) for fuzzy matching
        const words = cond.name.toLowerCase().split(/[\s,/-]+/).filter(w => w.length > 3);
        const match = fees.find(f => {
          const fn = f.condition_name.toLowerCase();
          return words.some(w => fn.includes(w));
        });
        if (match) return { ...match, _matchedCondition: cond.name };
      }
      return null;
    }

    // ── Render clinic cards ──
    const cbLoading = document.getElementById('cbLoading');
    const cbList    = document.getElementById('cbClinicList');
    cbLoading.style.display = 'none';
    cbList.style.display    = 'block';

    if (!clinics.length) {
      cbList.innerHTML = '<p style="text-align:center;color:#888;padding:20px;font-size:14px">No clinics found. Please try again later.</p>';
      return;
    }

    const locationLabel = userCoords
      ? '<span style="font-size:11px;color:#2E7D32;display:flex;align-items:center;gap:3px"><span class="material-icons-outlined" style="font-size:13px">gps_fixed</span>Sorted by GPS distance</span>'
      : `<span style="font-size:11px;color:#888">Showing clinics in ${user.district || 'your area'}</span>`;

    cbList.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">${locationLabel}</div>`;

    // Helper: is clinic open right now?
    function clinicOpenStatus(hours) {
      if (!hours || typeof hours !== 'object') return null;
      const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      const now = new Date();
      const dayName = days[now.getDay()];
      const h = hours[dayName];
      if (!h || h.closed) return { open: false, label: 'Closed today' };
      if (!h.open || !h.close) return null;
      const [oh, om] = h.open.split(':').map(Number);
      const [ch, cm] = h.close.split(':').map(Number);
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const openMin = oh * 60 + om;
      const closeMin = ch * 60 + cm;
      if (nowMin >= openMin && nowMin < closeMin) return { open: true, label: `Open · closes ${h.close}` };
      if (nowMin < openMin) return { open: false, label: `Opens ${h.open}` };
      return { open: false, label: `Closed · opens ${h.open} tomorrow` };
    }

    clinics.forEach(clinic => {
      // Condition-specific fee: matched against ALL AI conditions, not just the first word
      const condFee = getBestFeeMatch(clinic.id);

      // Fee priority: condition-specific (AI matched) > services list > general consultation fee
      const clinicServices = Array.isArray(clinic.services) ? clinic.services : [];
      const generalSvc = clinicServices.find(s => /general|consult|opd/i.test(s.type || '')) || clinicServices[0];

      const feeDisplay = condFee
        ? `UGX ${Number(condFee.fee).toLocaleString()}`
        : clinic.consultation_fee
          ? `UGX ${Number(clinic.consultation_fee).toLocaleString()}`
          : generalSvc?.fee
            ? `UGX ${Number(generalSvc.fee).toLocaleString()}`
            : 'Fee on visit';
      // Show the matched condition name (e.g. "Malaria") or fall back to general label
      const feeNote = condFee
        ? (condFee._matchedCondition || condFee.condition_name)
        : (generalSvc && !clinic.consultation_fee)
          ? (generalSvc.type || 'General')
          : 'General consultation';
      // Distance label: GPS km if available, else show subcounty/parish/district area name
      const distLabel = (clinic._distKm !== null && clinic._distKm !== undefined)
        ? `${clinic._distKm < 1 ? Math.round(clinic._distKm * 1000) + ' m' : clinic._distKm.toFixed(1) + ' km'} away`
        : [clinic.parish, clinic.city, clinic.district].filter(Boolean).join(', ');

      const openStatus = clinicOpenStatus(clinic.opening_hours);
      const openBadge = openStatus
        ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:6px;background:${openStatus.open ? '#E8F5E9' : '#FAFAFA'};color:${openStatus.open ? '#1B5E20' : '#9E9E9E'};border:1px solid ${openStatus.open ? '#A5D6A7' : '#E0E0E0'}">${openStatus.label}</span>`
        : '';

      const onlineBadge = clinic.accepts_online_slots
        ? `<span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:6px;background:#E3F2FD;color:#1565C0;border:1px solid #90CAF9">Online booking</span>`
        : '';

      const specChips = Array.isArray(clinic.specialties) && clinic.specialties.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${clinic.specialties.slice(0,3).map(s => `<span style="font-size:10px;background:#F3E5F5;color:#6A1B9A;border-radius:6px;padding:2px 7px">${s}</span>`).join('')}${clinic.specialties.length > 3 ? `<span style="font-size:10px;color:#9E9E9E">+${clinic.specialties.length - 3}</span>` : ''}</div>`
        : '';

      const phoneLink = clinic.phone
        ? `<a href="tel:${clinic.phone.replace(/\s/g,'')}" style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#1565C0;text-decoration:none;margin-top:5px"><span class="material-icons-outlined" style="font-size:13px">phone</span>${clinic.phone}</a>`
        : '';

      const card = document.createElement('div');
      card.style.cssText = 'background:#fff;border-radius:14px;padding:14px;margin-bottom:10px;box-shadow:0 1px 4px rgba(0,0,0,.07)';
      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px">
          <div style="width:40px;height:40px;border-radius:10px;background:#E8F5E9;display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-icons-outlined" style="font-size:22px;color:#1B5E20">local_hospital</span>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#111;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${clinic.name}</div>
            <div style="font-size:11px;color:#888;margin-top:2px;display:flex;align-items:center;gap:4px">
              <span class="material-icons-outlined" style="font-size:12px">place</span>
              ${distLabel}${distLabel && clinic.address ? ' · ' : ''}${clinic.address || ''}
            </div>
            ${phoneLink}
            <div style="display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:7px">
              <div style="background:#FFF8E1;border:1px solid #FFE082;border-radius:8px;padding:4px 10px;font-size:12px;color:#795548;font-weight:600">
                <span style="font-size:10px;color:#9E9E9E;font-weight:400">${feeNote}: </span>${feeDisplay}
              </div>
              ${openBadge}
              ${onlineBadge}
            </div>
            ${specChips}
          </div>
          <button class="cb-book-btn" data-clinic-id="${clinic.id}" data-clinic-name="${clinic.name.replace(/"/g, '&quot;')}" data-fee="${condFee?.fee || clinic.consultation_fee || 0}" data-fee-label="${feeDisplay}"
            style="flex-shrink:0;background:#1B5E20;color:#fff;border:none;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;align-self:center">
            Book
          </button>
        </div>
      `;
      cbList.appendChild(card);
    });

    // ── Wire "Book" buttons ──
    document.querySelectorAll('.cb-book-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const clinicId   = btn.dataset.clinicId;
        const clinicName = btn.dataset.clinicName;
        const feeLabel   = btn.dataset.feeLabel;
        // Look up the full clinic object so the confirm step can show the services table
        const clinicObj  = _cbClinics.find(c => c.id === clinicId) || {};
        // Pass all condition fees so the confirm step can render a per-diagnosis fee table
        const clinicFees = condFeeMap[clinicId] || [];
        showBookingConfirmStep(diagData, clinicId, clinicName, feeLabel, clinicObj, clinicFees);
      });
    });
  }

  // ── Show booking confirmation step (time select + confirm) ──
  function showBookingConfirmStep(diagData, clinicId, clinicName, feeLabel, clinicObj = {}, clinicFees = []) {
    const cbList    = document.getElementById('cbClinicList');
    const cbConfirm = document.getElementById('cbConfirmStep');
    if (cbList)    cbList.style.display    = 'none';
    if (!cbConfirm) return;
    cbConfirm.style.display = 'block';

    const isMock = !clinicId || clinicId.startsWith('mock-');

    // ── Per-diagnosis fee table ──
    // For each AI condition show the fee this clinic has entered, or "Ask at reception".
    const aiConditions = (diagData.conditions || []).slice(0, 5);
    const diagFeeRows = aiConditions.map(cond => {
      const words = cond.name.toLowerCase().split(/[\s,/-]+/).filter(w => w.length > 3);
      const matched = clinicFees.find(f => {
        const fn = f.condition_name.toLowerCase();
        return words.some(w => fn.includes(w));
      });
      return { condName: cond.name, pct: cond.likelihood_percent, matched };
    });
    const anyDiagFee = diagFeeRows.some(r => r.matched);

    const diagFeesHtml = anyDiagFee
      ? `<div style="border-top:1px solid #C8E6C9;margin-top:8px;padding-top:8px">
           <div style="font-size:10px;color:#388E3C;font-weight:700;letter-spacing:.5px;margin-bottom:5px">FEES FOR YOUR CONDITIONS</div>
           ${diagFeeRows.map(r => `
             <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #F1F8E9">
               <div style="font-size:12px;color:#333;max-width:65%">
                 ${r.condName}
                 ${r.pct ? `<span style="font-size:10px;color:#9E9E9E;margin-left:4px">${r.pct}%</span>` : ''}
               </div>
               <span style="font-size:12px;font-weight:700;color:${r.matched ? '#1B5E20' : '#9E9E9E'}">
                 ${r.matched ? 'UGX ' + Number(r.matched.fee).toLocaleString() : 'Ask at reception'}
               </span>
             </div>`).join('')}
         </div>`
      : '';

    // ── General services / pricing table from clinic settings ──
    const clinicServices = Array.isArray(clinicObj.services) ? clinicObj.services.filter(s => s.type && s.fee) : [];
    const servicesHtml = (!anyDiagFee && clinicServices.length > 0)
      ? `<div style="border-top:1px solid #C8E6C9;margin-top:8px;padding-top:8px">
           <div style="font-size:10px;color:#388E3C;font-weight:700;letter-spacing:.5px;margin-bottom:5px">SERVICES &amp; FEES</div>
           ${clinicServices.map(s => `
             <div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid #F1F8E9">
               <span style="font-size:12px;color:#333">${s.type}</span>
               <span style="font-size:12px;font-weight:700;color:#1B5E20">UGX ${Number(s.fee).toLocaleString()}</span>
             </div>`).join('')}
         </div>`
      : '';

    // Address / phone info for the confirm card
    const addressLine = clinicObj.address ? `<div style="font-size:11px;color:#777;margin-top:2px;display:flex;align-items:center;gap:3px"><span class="material-icons-outlined" style="font-size:12px">place</span>${clinicObj.address}${clinicObj.city ? ', ' + clinicObj.city : ''}</div>` : '';
    const phoneLine   = clinicObj.phone   ? `<a href="tel:${(clinicObj.phone).replace(/\s/g,'')}" style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#1565C0;text-decoration:none;margin-top:3px"><span class="material-icons-outlined" style="font-size:12px">phone</span>${clinicObj.phone}</a>` : '';

    cbConfirm.innerHTML = `
      <button id="cbBack" style="background:none;border:none;cursor:pointer;display:flex;align-items:center;gap:4px;color:#1B5E20;font-size:13px;font-weight:600;font-family:inherit;padding:0;margin-bottom:16px">
        <span class="material-icons-outlined" style="font-size:18px">arrow_back</span> Back to clinics
      </button>

      <div style="background:#E8F5E9;border-radius:12px;padding:12px 14px;margin-bottom:16px">
        <div style="display:flex;align-items:flex-start;gap:10px">
          <span class="material-icons-outlined" style="font-size:24px;color:#1B5E20;margin-top:2px">local_hospital</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:700;color:#111">${clinicName}</div>
            ${addressLine}
            ${phoneLine}
            <div style="font-size:12px;color:#555;margin-top:5px">Estimated fee: <strong>${feeLabel}</strong></div>
            ${diagFeesHtml}
            ${servicesHtml}
          </div>
        </div>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:6px">Patient Name</label>
        <input id="cbPatientName" type="text" value="${selectedPatient?.name || ''}"
          style="width:100%;padding:12px 14px;border:1.5px solid #DDD;border-radius:10px;font-size:15px;font-family:inherit;outline:none;box-sizing:border-box;color:#111;background:#fff"
          placeholder="Patient name" />
      </div>

      <div style="margin-bottom:16px">
        <label style="font-size:12px;font-weight:600;color:#555;display:block;margin-bottom:8px">Preferred Appointment Time</label>
        <div style="display:flex;flex-direction:column;gap:8px" id="cbTimeOpts">
          <button class="cb-time-btn" data-time="asap" style="padding:12px 16px;border:1.5px solid #DDD;border-radius:10px;background:#fff;font-size:14px;font-family:inherit;text-align:left;cursor:pointer;color:#333">As soon as possible</button>
          <button class="cb-time-btn" data-time="today_afternoon" style="padding:12px 16px;border:1.5px solid #DDD;border-radius:10px;background:#fff;font-size:14px;font-family:inherit;text-align:left;cursor:pointer;color:#333">Today afternoon</button>
          <button class="cb-time-btn" data-time="tomorrow_morning" style="padding:12px 16px;border:1.5px solid #DDD;border-radius:10px;background:#fff;font-size:14px;font-family:inherit;text-align:left;cursor:pointer;color:#333">Tomorrow morning</button>
        </div>
      </div>

      <button id="cbConfirmBtn"
        style="width:100%;padding:14px;background:#00695C;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px">
        <span class="material-icons-outlined">check_circle</span>
        Confirm Booking
      </button>
    `;

    document.getElementById('cbBack').addEventListener('click', () => {
      cbConfirm.style.display = 'none';
      cbConfirm.innerHTML = '';
      document.getElementById('cbClinicList').style.display = 'block';
    });

    let selectedTime = 'asap';
    document.querySelectorAll('.cb-time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cb-time-btn').forEach(b => {
          b.style.borderColor = '#DDD'; b.style.background = '#fff'; b.style.fontWeight = '400';
        });
        btn.style.borderColor = '#00695C';
        btn.style.background  = '#E8F5E9';
        btn.style.fontWeight  = '600';
        selectedTime = btn.dataset.time;
      });
      if (btn.dataset.time === 'asap') btn.click();
    });

    document.getElementById('cbConfirmBtn').addEventListener('click', async () => {
      const patientName = document.getElementById('cbPatientName').value.trim();
      if (!patientName) {
        const inp = document.getElementById('cbPatientName');
        inp.style.borderColor = '#D32F2F';
        inp.focus();
        return;
      }

      const confirmBtn = document.getElementById('cbConfirmBtn');
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<span class="material-icons-outlined" style="animation:scBounce 1s ease-in-out infinite">hourglass_empty</span> Booking…';

      const bookingCode = 'HO-' + Math.floor(100 + Math.random() * 900);
      const pinChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      let pinToken = 'HK-';
      for (let i = 0; i < 6; i++) pinToken += pinChars[Math.floor(Math.random() * pinChars.length)];
      const pinExpiry = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

      const bookingRecord = {
        booking_code:   bookingCode,
        patient_name:   patientName,
        patient_user_id: session?.user?.id || null,
        patient_age:    selectedPatient?.age || null,
        patient_sex:    selectedPatient?.sex || null,
        symptoms:       enteredSymptoms || null,
        ai_diagnosis:   diagData.conditions[0]?.name || null,
        conditions_json: diagData.conditions || [],
        ai_confidence:  diagData.conditions[0]?.likelihood_percent || null,
        urgency_level:  diagData.clinic_urgency === 'urgent' ? 'high' : diagData.clinic_urgency === 'soon' ? 'medium' : 'normal',
        risk_score:     diagData.conditions[0]?.likelihood_percent || 50,
        clinic_id:      isMock ? null : clinicId,
        preferred_time: selectedTime,
        status:         'pending',
        pin_token:      pinToken,
        pin_expires_at: pinExpiry,
      };

      let savedOk = false;
      let savedId  = null;
      if (supabase) {
        try {
          const { data: inserted, error: insertErr } = await supabase
            .from('bookings').insert(bookingRecord).select('id').single();
          if (insertErr) {
            console.error('[Homatt] Booking insert error:', insertErr.message);
          } else {
            savedOk = true;
            savedId  = inserted?.id || null;
          }
        } catch (e) {
          console.warn('[Homatt] Booking insert failed (offline?):', e.message);
        }
      }

      // localStorage backup
      const localBookings = JSON.parse(localStorage.getItem('homatt_bookings') || '[]');
      localBookings.unshift({ ...bookingRecord, clinic_name: clinicName, savedToDb: savedOk, id: savedId });
      if (localBookings.length > 20) localBookings.pop();
      localStorage.setItem('homatt_bookings', JSON.stringify(localBookings));

      // ── Push notification via OneSignal Edge Function ──
      if (savedOk && supabase && session?.user?.id) {
        const timeLabel = selectedTime === 'asap' ? 'as soon as possible'
                        : selectedTime === 'today_afternoon' ? 'this afternoon'
                        : 'tomorrow morning';
        try {
          await supabase.functions.invoke('send-notification', {
            body: {
              userId:  session.user.id,
              title:   'Booking Confirmed!',
              message: `Your visit to ${clinicName} is confirmed for ${timeLabel}. Show code ${bookingCode} at reception.`,
              data:    { screen: 'appointment', id: savedId || bookingCode },
            },
          });
        } catch (e) {
          console.warn('[Homatt] Push notification failed:', e.message);
        }
      }

      // ── Success screen ──
      const cbConfirm = document.getElementById('cbConfirmStep');
      if (!cbConfirm) return;
      cbConfirm.innerHTML = `
        <div style="text-align:center;padding:12px 0 8px">
          <div style="width:68px;height:68px;border-radius:50%;background:#E8F5E9;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
            <span class="material-icons-outlined" style="font-size:38px;color:#2E7D32">check_circle</span>
          </div>
          <h3 style="font-size:18px;font-weight:700;color:#111;margin:0 0 6px">Booking Confirmed!</h3>
          <p style="font-size:13px;color:#666;margin:0 0 20px">A push notification has been sent to your device.</p>

          <div style="background:#F1F8E9;border:2px dashed #4CAF50;border-radius:14px;padding:20px;margin-bottom:14px">
            <p style="font-size:11px;color:#555;margin:0 0 5px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Booking Code</p>
            <p style="font-size:34px;font-weight:800;color:#1B5E20;letter-spacing:4px;margin:0 0 12px">${bookingCode}</p>
            <div style="background:rgba(0,0,0,0.05);border-radius:8px;padding:10px">
              <p style="font-size:10px;color:#555;margin:0 0 4px;font-weight:600;text-transform:uppercase;letter-spacing:.5px">PIN (show to reception)</p>
              <p style="font-size:18px;font-weight:700;color:#00695C;letter-spacing:2px;margin:0">${pinToken}</p>
            </div>
          </div>

          <div style="background:#fff;border:1px solid #E0E0E0;border-radius:12px;padding:14px;text-align:left;margin-bottom:18px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <span class="material-icons-outlined" style="font-size:18px;color:#00695C">local_hospital</span>
              <span style="font-size:13px;font-weight:600;color:#333">${clinicName}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span class="material-icons-outlined" style="font-size:18px;color:#00695C">schedule</span>
              <span style="font-size:13px;color:#555">${selectedTime === 'asap' ? 'As soon as possible' : selectedTime === 'today_afternoon' ? 'Today afternoon' : 'Tomorrow morning'}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px">
              <span class="material-icons-outlined" style="font-size:18px;color:#00695C">payments</span>
              <span style="font-size:13px;color:#555">Expected fee: <strong>${feeLabel}</strong></span>
            </div>
          </div>

          <button id="cbDoneBtn"
            style="width:100%;padding:14px;background:#00695C;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer">
            Done
          </button>
        </div>
      `;

      document.getElementById('cbDoneBtn').addEventListener('click', () => {
        document.getElementById('clinicBookingModal')?.remove();
      });
    });
  }

  // ====== Check for existing monitoring session ======
  const existingMonitor = localStorage.getItem('homatt_monitoring');
  if (existingMonitor) {
    const session = JSON.parse(existingMonitor);
    if (session.nextCheckIn) {
      const nextTime = new Date(session.nextCheckIn);
      const now = new Date();
      if (now >= nextTime) {
        monitoringSession = session;
        diagnosisData = { conditions: [{ name: session.condition }], overall_risk: session.risk };
        document.getElementById('monitorCondition').innerHTML = `
          <div class="sc-monitor-cond-card">
            <span class="material-icons-outlined">medical_information</span>
            <div>
              <p class="sc-monitor-cond-name">Monitoring: ${session.condition}</p>
              <p class="sc-monitor-cond-risk">Risk level: <strong class="${session.risk}">${session.risk}</strong></p>
            </div>
          </div>
        `;
        document.getElementById('monitorResponse').style.display = 'none';
        document.getElementById('monitorTimer').style.display = 'none';
        showScreen('screenMonitor');
        wireMonitoringButtons();
      }
    }
  }
});
