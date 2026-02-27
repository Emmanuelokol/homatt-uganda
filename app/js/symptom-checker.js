/**
 * Homatt Health - Symptom Checker with Groq + DeepSeek + OpenAI + Gemini AI
 * Multi-screen flow: Patient → Symptoms → Follow-up → Results → Monitoring
 * API priority: Groq → DeepSeek → OpenAI → Gemini → Offline engine
 */

document.addEventListener('DOMContentLoaded', () => {
  // Auth check
  if (localStorage.getItem('homatt_logged_in') !== 'true') {
    window.location.href = 'signin.html';
    return;
  }

  // ====== API Config ======
  // Keys are loaded from window.HOMATT_CONFIG (injected via config.js, never committed).
  // config.js is generated at CI build time from GitHub Secrets.
  // See config.example.js for setup instructions.
  const cfg = window.HOMATT_CONFIG || {};

  const GROK_API_KEY = cfg.GROQ_API_KEY || '';
  const GROK_URL = 'https://api.groq.com/openai/v1/chat/completions';
  const GROK_MODEL = 'llama-3.3-70b-versatile';

  // DeepSeek (secondary) - OpenAI-compatible API
  const DEEPSEEK_API_KEY = cfg.DEEPSEEK_API_KEY || '';
  const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
  const DEEPSEEK_MODEL = 'deepseek-chat';

  // OpenAI (tertiary fallback)
  const OPENAI_API_KEY = cfg.OPENAI_API_KEY || '';
  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  const OPENAI_MODEL = 'gpt-4o-mini';

  // Gemini (quaternary fallback)
  const GEMINI_API_KEY = cfg.GEMINI_API_KEY || '';
  const GEMINI_MODELS = [
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-pro',
  ];

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
      const prompt = `You are a medical health assistant AI for a mobile health app in Uganda called "Homatt Health".

A patient described these symptoms: "${enteredSymptoms}"
Follow-up answers: "${answersText}"
Patient: ${selectedPatient.name}, ${selectedPatient.age ? selectedPatient.age + ' years old' : 'age unknown'}, ${selectedPatient.sex}, located in ${user.location || 'Uganda'}.

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

    if (data.overall_risk === 'high' || data.should_visit_clinic || data.clinic_urgency === 'urgent') {
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

  // ====== AI API Call: Groq (primary) → DeepSeek (secondary) → OpenAI (tertiary) → Gemini (quaternary) ======
  async function callAI(prompt) {
    console.log('[Homatt AI] Starting AI call chain...');
    const errors = [];

    // 1) Try Groq first (fast inference)
    if (GROK_API_KEY) {
      try {
        console.log('[Homatt AI] Trying Groq (llama-3.3-70b-versatile)...');
        const text = await callGrok(prompt);
        if (text) {
          console.log('[Homatt AI] Grok SUCCESS');
          return text;
        }
        errors.push('Grok: empty response');
      } catch (err) {
        console.warn('[Homatt AI] Grok failed:', err.message);
        errors.push('Grok: ' + err.message);
      }
    } else {
      errors.push('Grok: no key configured');
    }

    // 2) Try DeepSeek as secondary fallback
    if (DEEPSEEK_API_KEY) {
      try {
        console.log('[Homatt AI] Trying DeepSeek (deepseek-chat)...');
        const text = await callDeepSeek(prompt);
        if (text) {
          console.log('[Homatt AI] DeepSeek SUCCESS');
          return text;
        }
        errors.push('DeepSeek: empty response');
      } catch (err) {
        console.warn('[Homatt AI] DeepSeek failed:', err.message);
        errors.push('DeepSeek: ' + err.message);
      }
    } else {
      errors.push('DeepSeek: no key configured');
    }

    // 3) Try OpenAI as tertiary fallback
    if (OPENAI_API_KEY) {
      try {
        console.log('[Homatt AI] Trying OpenAI (gpt-4o-mini)...');
        const text = await callOpenAI(prompt);
        if (text) {
          console.log('[Homatt AI] OpenAI SUCCESS');
          return text;
        }
        errors.push('OpenAI: empty response');
      } catch (err) {
        console.warn('[Homatt AI] OpenAI failed:', err.message);
        errors.push('OpenAI: ' + err.message);
      }
    } else {
      errors.push('OpenAI: no key configured');
    }

    // 4) Try Gemini models as quaternary fallback
    if (GEMINI_API_KEY) {
      for (const model of GEMINI_MODELS) {
        try {
          console.log(`[Homatt AI] Trying Gemini ${model}...`);
          const text = await callGeminiModel(model, prompt);
          if (text) {
            console.log(`[Homatt AI] Gemini ${model} SUCCESS`);
            return text;
          }
          errors.push(`${model}: empty response`);
        } catch (err) {
          console.warn(`[Homatt AI] Gemini ${model} failed:`, err.message);
          errors.push(`${model}: ${err.message}`);
        }
      }
    } else {
      errors.push('Gemini: no key configured');
    }

    const errorDetails = errors.join(' | ');
    console.error('[Homatt AI] All providers failed:', errorDetails);
    throw new Error(errorDetails);
  }

  // ---- Fetch with timeout ----
  async function fetchWithTimeout(url, options, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return response;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out after ' + (timeoutMs / 1000) + 's');
      throw err;
    }
  }

  // ---- Groq Call (OpenAI-compatible API) ----
  async function callGrok(prompt) {
    const response = await fetchWithTimeout(GROK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a medical health assistant for a mobile health app in Uganda called Homatt Health. Always respond with valid JSON only, no markdown or explanation.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    }, 25000);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.warn(`[Homatt AI] Groq error (${response.status}):`, errBody.substring(0, 300));
      throw new Error(`Groq HTTP ${response.status}: ${errBody.substring(0, 100)}`);
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content || '';
  }

  // ---- DeepSeek Call (OpenAI-compatible API) ----
  async function callDeepSeek(prompt) {
    const response = await fetchWithTimeout(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a medical health assistant for a mobile health app in Uganda called Homatt Health. Always respond with valid JSON only, no markdown or explanation.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    }, 25000);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.warn(`[Homatt AI] DeepSeek error (${response.status}):`, errBody.substring(0, 300));
      throw new Error(`DeepSeek HTTP ${response.status}: ${errBody.substring(0, 100)}`);
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content || '';
  }

  // ---- OpenAI Call ----
  async function callOpenAI(prompt) {
    const response = await fetchWithTimeout(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          {
            role: 'system',
            content: 'You are a medical health assistant for a mobile health app in Uganda called Homatt Health. Always respond with valid JSON only, no markdown or explanation.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    }, 20000);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.warn(`[Homatt AI] OpenAI error (${response.status}):`, errBody.substring(0, 300));
      throw new Error(`OpenAI HTTP ${response.status}: ${errBody.substring(0, 100)}`);
    }

    const result = await response.json();
    return result.choices?.[0]?.message?.content || '';
  }

  // ---- Gemini Call (single model) ----
  async function callGeminiModel(model, prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          maxOutputTokens: 2048,
        },
      }),
    }, 15000);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.warn(`[Homatt AI] Gemini ${model} error (${response.status}):`, errText.substring(0, 200));
      throw new Error(`Gemini ${model}: HTTP ${response.status}`);
    }

    const result = await response.json();
    return result.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
