/**
 * Homatt Health - Symptom Checker with Groq + OpenAI + Gemini AI
 * Multi-screen flow: Patient → Symptoms → Follow-up → Results → Monitoring
 * API priority: Groq → OpenAI → Gemini → Offline engine
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Auth check via Supabase session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'signin.html';
    return;
  }

  // ====== API Config ======
  const PROXY_URL = cfg.API_PROXY_URL || '';

  // ====== State ======
  const user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  const family = JSON.parse(localStorage.getItem('homatt_family') || '[]');
  let selectedPatient = null;
  let enteredSymptoms = '';
  let selectedChips = new Set();
  let followupAnswers = {};
  let diagnosisData = null;
  let monitoringSession = null;
  let aiAvailable = null; // null = untested, true/false after first call

  // ====== Emergency Triggers ======
  // Keywords that warrant immediate escalation without follow-up questions
  const EMERGENCY_TRIGGERS = [
    {
      keywords: ['chest pain', 'chest tightness', 'tight chest', 'chest pressure'],
      message: 'Chest pain can be a sign of a serious heart condition. Do not wait — seek emergency care immediately.',
      icon: 'favorite',
    },
    {
      keywords: ['difficulty breathing', 'cannot breathe', "can't breathe", 'shortness of breath', 'trouble breathing', 'hard to breathe'],
      message: 'Difficulty breathing is a medical emergency. Call 112 or go to the nearest emergency department immediately.',
      icon: 'air',
    },
    {
      keywords: ['stroke', 'face drooping', 'arm weakness', 'slurred speech', 'sudden numbness', 'sudden confusion', 'sudden vision loss'],
      message: 'These symptoms may indicate a stroke — a medical emergency. Every minute matters. Call 112 immediately.',
      icon: 'emergency',
    },
    {
      keywords: ['uncontrolled bleeding', 'heavy bleeding', 'wont stop bleeding', "won't stop bleeding", 'blood everywhere'],
      message: 'Uncontrolled bleeding is a life-threatening emergency. Apply pressure to the wound and call 112 immediately.',
      icon: 'bloodtype',
    },
    {
      keywords: ['severe allergic', 'anaphylaxis', 'throat swelling', 'lips swelling', 'tongue swelling', 'cant swallow', "can't swallow"],
      message: 'Severe allergic reactions can be life-threatening. If you have an EpiPen, use it immediately. Call 112 now.',
      icon: 'warning',
    },
    {
      keywords: ['suicidal', 'want to die', 'kill myself', 'self harm', 'hurt myself'],
      message: 'You are not alone. Please reach out to someone you trust or call a crisis helpline. Your life matters deeply.',
      icon: 'support',
    },
    {
      keywords: ['pregnancy bleeding', 'bleeding while pregnant', 'pregnancy pain', 'no baby movement', 'baby not moving', 'preeclampsia'],
      message: 'Pregnancy complications require immediate medical attention. Go to a maternity facility or call 112 right away.',
      icon: 'pregnant_woman',
    },
    {
      keywords: ['infant fever', 'baby fever', 'newborn fever', 'baby not breathing', 'baby unconscious'],
      message: 'High fever or breathing problems in a young baby require emergency care. Go to the nearest health facility immediately.',
      icon: 'child_care',
    },
  ];

  function detectEmergency(symptomText) {
    const lower = symptomText.toLowerCase();
    for (const trigger of EMERGENCY_TRIGGERS) {
      if (trigger.keywords.some(kw => lower.includes(kw))) {
        return trigger;
      }
    }
    return null;
  }

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

  backBtn.addEventListener('click', () => {
    if (currentScreen === 'screenPatient') {
      window.location.href = 'dashboard.html';
    } else if (currentScreen === 'screenEmergency') {
      showScreen('screenSymptoms');
    } else if (currentScreen === 'screenSymptoms') {
      if (!user.hasFamily || family.length === 0) {
        window.location.href = 'dashboard.html';
      } else {
        showScreen('screenPatient');
      }
    } else if (currentScreen === 'screenFollowup') {
      showScreen('screenSymptoms');
    } else if (currentScreen === 'screenResults') {
      showScreen('screenFollowup');
    } else if (currentScreen === 'screenMonitor') {
      showScreen('screenResults');
    }
  });

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
      const today = new Date();
      userAge = Math.floor((today - birth) / (365.25 * 24 * 60 * 60 * 1000));
    }

    if (!user.hasFamily || family.length === 0) {
      selectedPatient = {
        name: user.firstName || 'User',
        age: userAge,
        sex: user.sex || 'unknown',
        relation: 'self',
      };
      document.getElementById('patientName').textContent = 'Checking for: You';
      showScreen('screenSymptoms');
      return;
    }

    const selfCard = createPatientCard({
      name: `${user.firstName} (You)`,
      icon: 'person',
      subtitle: `${user.sex === 'male' ? 'Male' : 'Female'}${userAge ? ', ' + userAge + ' yrs' : ''}`,
    }, () => {
      selectedPatient = {
        name: user.firstName,
        age: userAge,
        sex: user.sex,
        relation: 'self',
      };
      document.getElementById('patientName').textContent = 'Checking for: You';
      showScreen('screenSymptoms');
    });
    list.appendChild(selfCard);

    family.forEach((member) => {
      const card = createPatientCard({
        name: member.name,
        icon: member.relation === 'child' ? 'child_care' : 'person',
        subtitle: `${member.sex === 'male' ? 'Male' : 'Female'}, ${member.age} yrs - ${member.relation}`,
      }, () => {
        selectedPatient = {
          name: member.name,
          age: member.age,
          sex: member.sex,
          relation: member.relation,
        };
        document.getElementById('patientName').textContent = `Checking for: ${member.name}`;
        showScreen('screenSymptoms');
      });
      list.appendChild(card);
    });
  }

  function createPatientCard({ name, icon, subtitle }, onClick) {
    const card = document.createElement('button');
    card.className = 'sc-patient-card';
    card.innerHTML = `
      <div class="sc-patient-avatar">
        <span class="material-icons-outlined">${icon}</span>
      </div>
      <div class="sc-patient-info">
        <p class="sc-patient-name">${name}</p>
        <p class="sc-patient-detail">${subtitle}</p>
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

    // Check for emergency symptoms before proceeding to follow-up questions
    const emergency = detectEmergency(enteredSymptoms);
    if (emergency) {
      showEmergencyScreen(emergency);
      return;
    }

    showScreen('screenFollowup');
    getFollowupQuestions();
  });

  // ====== Emergency Screen ======
  function showEmergencyScreen(emergency) {
    const msgEl = document.getElementById('emergencyMessage');
    const iconEl = document.getElementById('emergencyIcon');
    if (iconEl) iconEl.textContent = emergency.icon || 'emergency';
    if (msgEl) msgEl.textContent = emergency.message;
    showScreen('screenEmergency');

    // Wire emergency action buttons
    const callBtn = document.getElementById('btnCallEmergency');
    const backBtn2 = document.getElementById('btnEmergencyBack');
    if (callBtn) {
      callBtn.onclick = () => { window.location.href = 'tel:112'; };
    }
    if (backBtn2) {
      backBtn2.onclick = () => { showScreen('screenSymptoms'); };
    }
  }

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

    const prompt = `A patient in Uganda has described these symptoms: "${enteredSymptoms}".

Patient info: ${selectedPatient.name}, ${selectedPatient.age ? selectedPatient.age + ' years old' : 'age unknown'}, ${selectedPatient.sex}, location: ${user.location || user.district || 'Uganda'}.

Generate exactly 4 structured follow-up questions to better understand the clinical picture. Questions should cover:
1. Symptom onset and duration
2. Severity (mild / moderate / severe)
3. Any current medications or known allergies (important for safe guidance)
4. Any associated symptoms or relevant medical history

Keep all options short and easy to understand for a non-medical person.

Respond ONLY with valid JSON, no markdown, no explanation. Use this exact format:
{
  "questions": [
    {
      "question": "How long have you had this symptom?",
      "options": ["Less than 24 hours", "1-3 days", "4-7 days", "More than a week"]
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
      question: 'Are you currently taking any medication or have known allergies?',
      options: ['No medications or allergies', 'Taking painkillers (paracetamol/ibuprofen)', 'Taking prescription medicine', 'I have a known drug allergy'],
    });

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
      });
    });
  }

  // Get diagnosis button
  document.getElementById('btnGetDiagnosis').addEventListener('click', () => {
    if (Object.keys(followupAnswers).length < 2) {
      const firstUnanswered = document.querySelector('.sc-options-wrap:not(:has(.selected))');
      if (firstUnanswered) {
        firstUnanswered.classList.add('shake');
        setTimeout(() => firstUnanswered.classList.remove('shake'), 300);
      }
      return;
    }

    showScreen('screenResults');
    getDiagnosis();
  });

  // ====== SCREEN 4: Diagnosis Results ======
  async function getDiagnosis() {
    const loading = document.getElementById('resultsLoading');
    const content = document.getElementById('resultsContent');
    loading.style.display = 'flex';
    content.style.display = 'none';

    const answersText = Object.entries(followupAnswers)
      .map(([k, v]) => v)
      .join('; ');

    // Always try AI for diagnosis (even if follow-up questions used fallback)
    {
      const hasKnownAllergy = answersText.toLowerCase().includes('drug allergy');
      const takingPrescription = answersText.toLowerCase().includes('prescription medicine');
      const healthGoalsText = user.healthGoals ? user.healthGoals.join(', ') : 'none specified';

      const prompt = `CLINICAL TRIAGE REQUEST — Homatt Health, Uganda

PATIENT:
- Name: ${selectedPatient.name}
- Age: ${selectedPatient.age ? selectedPatient.age + ' years old' : 'age unknown'}
- Sex: ${selectedPatient.sex}
- Location: ${user.location || user.district || 'Uganda'}
- Health goals: ${healthGoalsText}
${hasKnownAllergy ? '- ALERT: Patient has a known drug allergy — do not suggest OTC without flagging this\n' : ''}${takingPrescription ? '- NOTE: Patient is taking prescription medication — check for interactions before suggesting OTC\n' : ''}
REPORTED SYMPTOMS: "${enteredSymptoms}"

FOLLOW-UP ANSWERS: "${answersText}"

REQUIRED CLINICAL REASONING:
1. Identify the most likely condition with clear reasoning (why this diagnosis fits the symptom pattern)
2. List 1–2 alternative possibilities, explaining why possible and why less likely than the primary
3. Assign triage level: green (self-care), yellow (monitor), orange (see doctor soon), red (emergency)
4. If triage is green or yellow: suggest safe OTC options WITH mechanism of action and contraindications
5. If triage is orange or red: do NOT suggest OTC — recommend clinic/emergency instead
6. List 3–5 specific red flags the patient must watch for
7. If overall confidence is below 50%: state uncertainty clearly and do NOT provide a specific diagnosis

Consider common East African/Ugandan conditions: malaria, typhoid, UTIs, respiratory infections, gastroenteritis, etc.

Respond ONLY with valid JSON, no markdown. Use this exact structure:
{
  "symptoms_identified": ["symptom1", "symptom2"],
  "confidence_level": "high|moderate|low",
  "confidence_percent": 80,
  "uncertainty_note": "",
  "triage_level": "green|yellow|orange|red",
  "triage_label": "Self-care appropriate|Monitor closely|See doctor soon|Emergency",
  "triage_reason": "Brief reason for this triage level in plain language",
  "conditions": [
    {
      "name": "Most Likely Condition",
      "likelihood_percent": 70,
      "severity": "low|medium|high",
      "description": "1-2 sentence plain-language description",
      "reasoning": "Why this diagnosis fits the symptom pattern"
    },
    {
      "name": "Alternative Condition",
      "likelihood_percent": 20,
      "severity": "low|medium|high",
      "description": "1-2 sentence plain-language description",
      "reasoning": "Why possible but less likely"
    }
  ],
  "otc_guidance": [
    {
      "name": "Safe OTC option (brand name / generic name)",
      "indication": "What symptom it treats",
      "mechanism": "How it works — brief pharmacological explanation",
      "dose_note": "Follow label instructions. Consult a pharmacist for the correct dose for your age and weight.",
      "contraindications": ["Condition 1", "Condition 2"]
    }
  ],
  "red_flags": [
    "Seek care immediately if fever rises above 39°C",
    "Seek care immediately if you develop difficulty breathing"
  ],
  "escalation_required": false,
  "escalation_message": "",
  "causes": ["Possible cause 1", "Possible cause 2"],
  "prevention_tips": ["Tip 1", "Tip 2", "Tip 3"],
  "immediate_actions": ["Action 1", "Action 2"],
  "overall_risk": "low|medium|high",
  "followup_message": "A caring reassuring message about next steps",
  "should_visit_clinic": false,
  "clinic_urgency": "none|soon|urgent"
}

Provide 2–3 conditions ordered by likelihood. Use compassionate, plain language.`;

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

    // Build OTC guidance and red flags based on top condition
    const topName = topConditions[0].name.toLowerCase();

    // Determine triage level from risk and conditions
    let triageLevel = 'green';
    let triageLabel = 'Self-care appropriate';
    let triageReason = 'Your symptoms appear manageable at home with rest and self-care.';

    if (overallRisk === 'high' || clinicUrgency === 'urgent') {
      triageLevel = 'red';
      triageLabel = 'Emergency — Seek care now';
      triageReason = 'Your symptoms suggest a potentially serious condition that requires urgent medical attention.';
    } else if (topName.includes('malaria') || topName.includes('typhoid') || topName.includes('uti') || topName.includes('lower respiratory')) {
      triageLevel = 'orange';
      triageLabel = 'See doctor soon';
      triageReason = 'This condition requires professional evaluation and likely prescription treatment. Do not delay.';
    } else if (overallRisk === 'medium' || clinicUrgency === 'soon') {
      triageLevel = 'yellow';
      triageLabel = 'Monitor closely';
      triageReason = 'Your symptoms should be watched carefully. Visit a clinic if they do not improve within 24–48 hours.';
    }

    // OTC guidance (only for green/yellow triage — not for orange/red)
    let otcGuidance = [];
    let redFlags = [];

    // Build causes based on top condition
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
      // OTC for malaria: only paracetamol for fever relief (antimalarials are prescription)
      if (triageLevel !== 'red') {
        otcGuidance = [{
          name: 'Paracetamol (Panadol)',
          indication: 'Temporary fever and pain relief while awaiting malaria test',
          mechanism: 'Paracetamol reduces fever by inhibiting prostaglandin synthesis in the brain, lowering the body\'s temperature set-point. It does not treat malaria itself.',
          dose_note: 'Follow label instructions carefully. Consult a pharmacist for the correct dose for your age and weight. Do NOT take more than the stated dose.',
          contraindications: ['Liver disease', 'Heavy alcohol use', 'Already taking other paracetamol-containing products'],
        }];
      }
      redFlags = [
        'Fever above 39°C or that does not respond to paracetamol',
        'Convulsions or fits',
        'Unusual drowsiness, confusion, or difficulty waking up',
        'Difficulty breathing',
        'Dark or brown-colored urine',
        'Vomiting that prevents you from keeping any fluids down',
      ];
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
      // No OTC for typhoid — requires prescription antibiotics
      redFlags = [
        'Severe or worsening abdominal pain',
        'Fever above 40°C',
        'Blood in stool',
        'Extreme weakness or inability to stand',
        'Confusion or unusual drowsiness',
      ];
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
      if (triageLevel === 'green' || triageLevel === 'yellow') {
        otcGuidance = [
          {
            name: 'Paracetamol (Panadol)',
            indication: 'Fever and throat/head pain relief',
            mechanism: 'Paracetamol works by blocking prostaglandin production in the brain, which reduces the fever response and decreases the perception of pain.',
            dose_note: 'Follow label instructions. Consult a pharmacist for the correct dose.',
            contraindications: ['Liver disease', 'Heavy alcohol use'],
          },
          {
            name: 'Saline nasal rinse (salt water)',
            indication: 'Nasal congestion relief',
            mechanism: 'Saline rinse physically flushes mucus, irritants, and pathogens from the nasal passages, reducing congestion and inflammation with no drug effects.',
            dose_note: 'Use a clean cup of boiled, cooled water with a pinch of salt. Sniff gently or use a rinse bottle.',
            contraindications: [],
          },
        ];
      }
      redFlags = [
        'Difficulty breathing or rapid breathing',
        'Fever above 39°C lasting more than 3 days',
        'Cough lasting more than 2 weeks',
        'Coughing up blood or yellow-green mucus with chest pain',
        'Symptoms worsening after initial improvement',
      ];
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
      if (triageLevel === 'green' || triageLevel === 'yellow') {
        otcGuidance = [{
          name: 'Oral Rehydration Salts (ORS)',
          indication: 'Preventing and treating dehydration from diarrhea and vomiting',
          mechanism: 'ORS uses the sodium-glucose cotransport mechanism in the small intestine to actively pull water back into the bloodstream even during active diarrhea, restoring fluid and electrolyte balance.',
          dose_note: 'Dissolve one ORS sachet in 1 litre of clean (boiled and cooled) water. Sip frequently. Consult a pharmacist for child dosing.',
          contraindications: ['If the patient is unconscious or unable to swallow — use IV fluids in hospital instead'],
        }];
      }
      redFlags = [
        'Blood in stool or vomit',
        'Unable to keep any fluids down for more than 4 hours',
        'Signs of dehydration: dry mouth, sunken eyes, no urination for 6+ hours, dizziness',
        'Diarrhea or vomiting lasting more than 3 days',
        'Severe cramping abdominal pain',
        'In young children: fewer wet nappies, no tears when crying, unusually sleepy',
      ];
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
      // UTI requires prescription antibiotics — no OTC for the infection itself
      // But hydration support is appropriate
      redFlags = [
        'Fever above 38°C with back or flank pain (may indicate kidney infection)',
        'Blood in urine',
        'Severe pain in the lower back or side',
        'Symptoms not improving after 2 days of increased fluids',
        'In children: new bedwetting, crying during urination',
      ];
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
      if (triageLevel === 'green' || triageLevel === 'yellow') {
        otcGuidance = [
          {
            name: 'Paracetamol (Panadol)',
            indication: 'Mild to moderate headache and pain relief',
            mechanism: 'Paracetamol works by inhibiting prostaglandin synthesis in the brain and spinal cord, reducing the transmission of pain signals without causing stomach irritation.',
            dose_note: 'Follow label instructions. Do not exceed the stated dose. Consult a pharmacist for advice.',
            contraindications: ['Liver disease', 'Heavy alcohol use', 'Already taking other paracetamol products'],
          },
          {
            name: 'Ibuprofen (Brufen)',
            indication: 'Headache with tension or inflammation',
            mechanism: 'Ibuprofen is an NSAID that works by inhibiting COX-1 and COX-2 enzymes, reducing the production of prostaglandins that cause pain and inflammation.',
            dose_note: 'Take with food to protect the stomach. Follow label instructions. Consult a pharmacist.',
            contraindications: ['Stomach ulcers or acid reflux', 'Kidney disease', 'Pregnancy (especially 3rd trimester)', 'Hypertension', 'Blood thinners'],
          },
        ];
      }
      redFlags = [
        'Sudden, severe "thunderclap" headache — the worst headache of your life',
        'Headache with fever AND stiff neck (cannot bend chin to chest)',
        'Headache with vision changes, confusion, or weakness on one side',
        'Headache after a head injury',
        'Headaches becoming more frequent or severe over days/weeks',
      ];
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
      redFlags = [
        'Symptoms worsening instead of improving',
        'New symptoms developing',
        'Fever above 38.5°C',
        'Inability to eat or drink',
        'Unusual drowsiness or confusion',
      ];
    }

    // For unspecified or uncertain cases, confidence is moderate/low
    const confidencePercent = topConditions[0].name === 'Unspecified Symptoms' ? 45 : Math.min(topConditions[0].likelihood_percent, 85);
    const confidenceLevel = confidencePercent >= 80 ? 'high' : confidencePercent >= 50 ? 'moderate' : 'low';
    const uncertaintyNote = confidenceLevel === 'low'
      ? "I'm not fully confident about the specific diagnosis based on the information provided. Let's approach this safely — a healthcare professional can provide a proper examination and tests."
      : '';

    return {
      symptoms_identified: identified,
      confidence_level: confidenceLevel,
      confidence_percent: confidencePercent,
      uncertainty_note: uncertaintyNote,
      triage_level: triageLevel,
      triage_label: triageLabel,
      triage_reason: triageReason,
      conditions: topConditions,
      otc_guidance: otcGuidance,
      red_flags: redFlags,
      escalation_required: triageLevel === 'red',
      escalation_message: triageLevel === 'red' ? 'Please seek emergency medical care immediately. Do not wait.' : '',
      causes,
      prevention_tips: preventionTips,
      immediate_actions: immediateActions,
      overall_risk: overallRisk,
      followup_message: followupMsg,
      should_visit_clinic: shouldVisitClinic,
      clinic_urgency: clinicUrgency,
    };
  }

  // ====== Render Triage Card ======
  function renderTriageCard(data) {
    const card = document.getElementById('triageCard');
    if (!card) return;
    const level = data.triage_level || 'yellow';
    const label = data.triage_label || 'Monitor closely';
    const reason = data.triage_reason || '';
    const emojiMap = { green: '🟢', yellow: '🟡', orange: '🟠', red: '🔴' };

    card.className = `sc-triage-card ${level}`;
    card.innerHTML = `
      <div class="sc-triage-header">
        <span class="sc-triage-emoji">${emojiMap[level] || '🟡'}</span>
        <span class="sc-triage-label">${label}</span>
      </div>
      ${reason ? `<p class="sc-triage-description">${reason}</p>` : ''}
    `;
    card.style.display = 'block';

    // Show confidence / uncertainty note
    const confBar = document.getElementById('confidenceBar');
    if (confBar && data.confidence_level) {
      const confLabel = data.confidence_level === 'high' ? 'High confidence assessment' :
        data.confidence_level === 'moderate' ? 'Moderate confidence — review possibilities below' :
        'Limited confidence — please consult a healthcare professional';
      confBar.innerHTML = `<p class="sc-confidence-text">Assessment confidence: <strong>${confLabel}</strong></p>`;
      confBar.style.display = 'block';
    }

    const uncNote = document.getElementById('uncertaintyNote');
    if (uncNote && data.uncertainty_note) {
      uncNote.textContent = data.uncertainty_note;
      uncNote.style.display = 'block';
    }
  }

  // ====== Render OTC Guidance Card ======
  function renderOTCCard(data) {
    const card = document.getElementById('otcCard');
    const body = document.getElementById('otcBody');
    if (!card || !body) return;

    const guidance = data.otc_guidance || [];
    if (guidance.length === 0 || (data.triage_level === 'orange' || data.triage_level === 'red')) {
      card.style.display = 'none';
      return;
    }

    body.innerHTML = guidance.map(otc => `
      <div class="sc-otc-item">
        <p class="sc-otc-name">${otc.name}</p>
        <p class="sc-otc-indication">${otc.indication || ''}</p>
        <p class="sc-otc-mechanism"><strong>How it works:</strong> ${otc.mechanism}</p>
        <p class="sc-otc-dose">⚠ ${otc.dose_note}</p>
        ${otc.contraindications && otc.contraindications.length > 0
          ? `<p class="sc-otc-contraindications">Not suitable for: ${otc.contraindications.join(', ')}</p>`
          : ''}
      </div>
    `).join('');
    card.style.display = 'block';
  }

  // ====== Render Red Flags Card ======
  function renderRedFlagsCard(data) {
    const card = document.getElementById('redFlagsCard');
    const body = document.getElementById('redFlagsBody');
    if (!card || !body) return;

    const flags = data.red_flags || [];
    if (flags.length === 0) { card.style.display = 'none'; return; }

    body.innerHTML = `<ul class="sc-redflags-list">${flags.map(f => `<li>${f}</li>`).join('')}</ul>`;
    card.style.display = 'block';
  }

  // ====== Render Diagnosis ======
  function renderDiagnosis(data) {
    // Render new clinical sections first
    renderTriageCard(data);

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

    // Render OTC guidance and red flags
    renderOTCCard(data);
    renderRedFlagsCard(data);

    // Action area based on triage level (falling back to overall_risk for offline engine compatibility)
    const actionArea = document.getElementById('actionArea');
    actionArea.innerHTML = '';

    const isEmergency = data.triage_level === 'red' || data.escalation_required;
    const isUrgent = data.triage_level === 'orange' || data.overall_risk === 'high' || data.clinic_urgency === 'urgent';
    const isMonitor = data.triage_level === 'yellow' || data.overall_risk === 'medium' || data.clinic_urgency === 'soon';

    if (isEmergency) {
      actionArea.innerHTML = `
        <div class="sc-urgent-banner">
          <span class="material-icons-outlined">emergency</span>
          <p>${data.escalation_message || 'Based on your symptoms, please seek emergency medical care immediately. Do not wait.'}</p>
        </div>
        <button class="btn sc-emergency-btn" id="btnEmergency112" style="margin-bottom:8px">
          <span class="material-icons-outlined">call</span>
          Call Emergency: 112
        </button>
        <button class="btn sc-clinic-btn urgent" id="btnBookClinic">
          <span class="material-icons-outlined">local_hospital</span>
          Find Nearest Emergency Facility
        </button>
      `;
    } else if (data.overall_risk === 'high' || data.should_visit_clinic || data.clinic_urgency === 'urgent') {
      actionArea.innerHTML = `
        <div class="sc-urgent-banner">
          <span class="material-icons-outlined">emergency</span>
          <p>Based on your symptoms, we strongly recommend visiting a health facility as soon as possible.</p>
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
        <button class="btn sc-home-btn" id="btnGoHome">
          <span class="material-icons-outlined">home</span>
          Back to Dashboard
        </button>
      `;
    }

    // Wire action buttons
    const emergencyBtn112 = document.getElementById('btnEmergency112');
    if (emergencyBtn112) {
      emergencyBtn112.addEventListener('click', () => { window.location.href = 'tel:112'; });
    }

    const bookClinicBtn = document.getElementById('btnBookClinic');
    if (bookClinicBtn) {
      bookClinicBtn.addEventListener('click', () => {
        localStorage.setItem('homatt_clinic_reason', JSON.stringify({
          condition: data.conditions[0]?.name || 'Health Check',
          urgency: data.clinic_urgency || data.overall_risk,
          symptoms: data.symptoms_identified,
        }));
        alert('Clinic finder coming soon! In the meantime, please visit your nearest health facility.');
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
  function startMonitoring() {
    monitoringSession = {
      condition: diagnosisData.conditions[0]?.name || 'Your condition',
      risk: diagnosisData.overall_risk,
      startedAt: new Date().toISOString(),
      checkIns: [],
      symptomsSame: 0,
    };

    localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));

    document.getElementById('monitorCondition').innerHTML = `
      <div class="sc-monitor-cond-card">
        <span class="material-icons-outlined">medical_information</span>
        <div>
          <p class="sc-monitor-cond-name">Monitoring: ${monitoringSession.condition}</p>
          <p class="sc-monitor-cond-risk">Risk level: <strong class="${monitoringSession.risk}">${monitoringSession.risk}</strong></p>
        </div>
      </div>
    `;

    document.getElementById('monitorResponse').style.display = 'none';
    document.getElementById('monitorTimer').style.display = 'none';
    document.querySelectorAll('.sc-feeling-btn').forEach(b => {
      b.classList.remove('selected');
      b.disabled = false;
    });

    showScreen('screenMonitor');
    wireMonitoringButtons();
  }

  function wireMonitoringButtons() {
    document.querySelectorAll('.sc-feeling-btn').forEach(btn => {
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', () => {
        const feeling = newBtn.dataset.feeling;

        document.querySelectorAll('.sc-feeling-btn').forEach(b => {
          b.classList.remove('selected');
          b.disabled = true;
        });
        newBtn.classList.add('selected');

        monitoringSession.checkIns.push({
          feeling,
          time: new Date().toISOString(),
        });

        if (feeling === 'same') {
          monitoringSession.symptomsSame++;
        } else {
          monitoringSession.symptomsSame = 0;
        }

        localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));
        handleMonitoringResponse(feeling);
      });
    });
  }

  function handleMonitoringResponse(feeling) {
    const responseEl = document.getElementById('monitorResponse');
    const timerEl = document.getElementById('monitorTimer');

    if (feeling === 'better') {
      responseEl.innerHTML = `
        <div class="sc-monitor-msg better">
          <span class="material-icons-outlined">celebration</span>
          <div>
            <p class="sc-monitor-msg-title">Great to hear!</p>
            <p>Your symptoms are improving. Continue following the prevention tips and stay hydrated. We'll check in again to make sure you're recovering well.</p>
          </div>
        </div>
      `;
      responseEl.style.display = 'block';
      timerEl.style.display = 'flex';
      scheduleNextCheckIn(2);
    } else if (feeling === 'same') {
      if (monitoringSession.symptomsSame >= 2) {
        responseEl.innerHTML = `
          <div class="sc-monitor-msg escalate">
            <span class="material-icons-outlined">warning</span>
            <div>
              <p class="sc-monitor-msg-title">Your symptoms are persisting</p>
              <p>Since your condition hasn't improved after multiple check-ins, we recommend visiting a health facility for proper examination.</p>
            </div>
          </div>
          <button class="btn sc-clinic-btn urgent" id="btnMonitorClinic" style="margin-top:12px">
            <span class="material-icons-outlined">local_hospital</span>
            Find Nearest Clinic
          </button>
        `;
        responseEl.style.display = 'block';
        timerEl.style.display = 'none';

        const clinicBtn = document.getElementById('btnMonitorClinic');
        if (clinicBtn) {
          clinicBtn.addEventListener('click', () => {
            alert('Clinic finder coming soon! Please visit your nearest health facility.');
          });
        }
      } else {
        responseEl.innerHTML = `
          <div class="sc-monitor-msg same">
            <span class="material-icons-outlined">info</span>
            <div>
              <p class="sc-monitor-msg-title">Noted</p>
              <p>Keep resting and follow the tips. We'll check in again soon. If symptoms worsen at any time, please seek medical help.</p>
            </div>
          </div>
        `;
        responseEl.style.display = 'block';
        timerEl.style.display = 'flex';
        scheduleNextCheckIn(1);
      }
    } else if (feeling === 'worse') {
      responseEl.innerHTML = `
        <div class="sc-monitor-msg worse">
          <span class="material-icons-outlined">emergency</span>
          <div>
            <p class="sc-monitor-msg-title">Please seek medical attention</p>
            <p>Your symptoms are getting worse. We strongly recommend visiting the nearest health facility as soon as possible. Don't wait - your health is important.</p>
          </div>
        </div>
        <button class="btn sc-clinic-btn urgent" id="btnWorseClinic" style="margin-top:12px">
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
          alert('Clinic finder coming soon! Please visit your nearest health facility immediately.');
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
    nextTime.setHours(nextTime.getHours() + hours);
    monitoringSession.nextCheckIn = nextTime.toISOString();
    localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));
  }

  // ====== Save to history ======
  function saveToHistory(data) {
    const history = JSON.parse(localStorage.getItem('homatt_symptom_history') || '[]');
    history.unshift({
      date: new Date().toISOString(),
      patient: selectedPatient.name,
      symptoms: enteredSymptoms,
      conditions: data.conditions,
      risk: data.overall_risk,
    });
    if (history.length > 20) history.pop();
    localStorage.setItem('homatt_symptom_history', JSON.stringify(history));
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
    const timer = setTimeout(() => controller.abort(), 25000);

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
