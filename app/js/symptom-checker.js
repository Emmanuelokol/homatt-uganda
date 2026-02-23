/**
 * Homatt Health - Symptom Checker with Gemini AI
 * Multi-screen flow: Patient → Symptoms → Follow-up → Results → Monitoring
 */

document.addEventListener('DOMContentLoaded', () => {
  // Auth check
  if (localStorage.getItem('homatt_logged_in') !== 'true') {
    window.location.href = 'signin.html';
    return;
  }

  // ====== Constants ======
  const GEMINI_API_KEY = 'AIzaSyC9d0bhlF8OqaiiYP0O25Pgjtthzr9FnRk';
  const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

  // ====== State ======
  const user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  const family = JSON.parse(localStorage.getItem('homatt_family') || '[]');
  let selectedPatient = null; // { name, age, sex, relation }
  let enteredSymptoms = '';
  let selectedChips = new Set();
  let followupAnswers = {};
  let diagnosisData = null; // store the full AI diagnosis
  let monitoringSession = null;

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

    // Update back button behavior
    backBtn.style.display = screenId === 'screenPatient' ? 'flex' : 'flex';
  }

  backBtn.addEventListener('click', () => {
    if (currentScreen === 'screenPatient') {
      window.location.href = 'dashboard.html';
    } else if (currentScreen === 'screenSymptoms') {
      // If no family, go back to dashboard
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

    // Calculate user age
    let userAge = '';
    if (user.dob) {
      const birth = new Date(user.dob);
      const today = new Date();
      userAge = Math.floor((today - birth) / (365.25 * 24 * 60 * 60 * 1000));
    }

    // If no family, skip straight to symptoms
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

    // Primary user card
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

    // Family members
    family.forEach((member, index) => {
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

  // Quick symptom chips
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

  // Analyze button
  document.getElementById('btnAnalyze').addEventListener('click', () => {
    const typed = symptomInput.value.trim();
    const chips = Array.from(selectedChips);

    if (!typed && chips.length === 0) {
      symptomInput.focus();
      symptomInput.classList.add('shake');
      setTimeout(() => symptomInput.classList.remove('shake'), 300);
      return;
    }

    // Combine symptoms
    const parts = [];
    if (typed) parts.push(typed);
    if (chips.length > 0) parts.push(chips.join(', '));
    enteredSymptoms = parts.join('. Also experiencing: ');

    showScreen('screenFollowup');
    getFollowupQuestions();
  });

  // ====== SCREEN 3: Follow-up Questions (Gemini AI) ======
  async function getFollowupQuestions() {
    const loading = document.getElementById('followupLoading');
    const content = document.getElementById('followupContent');
    loading.style.display = 'flex';
    content.style.display = 'none';

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
      const data = await callGemini(prompt);
      const parsed = parseJSON(data);

      if (parsed && parsed.questions) {
        renderFollowupQuestions(parsed.questions);
        loading.style.display = 'none';
        content.style.display = 'block';
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.error('Follow-up error:', err);
      // Fallback questions
      renderFollowupQuestions(getFallbackQuestions());
      loading.style.display = 'none';
      content.style.display = 'block';
    }
  }

  function getFallbackQuestions() {
    return [
      {
        question: 'How long have you been experiencing these symptoms?',
        options: ['Less than 24 hours', '1-3 days', '4-7 days', 'More than a week'],
      },
      {
        question: 'How severe is the discomfort?',
        options: ['Mild - I can go about my day', 'Moderate - It\'s bothering me', 'Severe - It\'s hard to function'],
      },
      {
        question: 'Have you taken any medication for this?',
        options: ['No, nothing yet', 'Over-the-counter medicine', 'Prescribed medication', 'Traditional remedies'],
      },
      {
        question: 'Do you have any of these additional symptoms?',
        options: ['Fever or chills', 'Loss of appetite', 'Difficulty sleeping', 'None of these'],
      },
    ];
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
          ${q.options.map((opt, oIndex) => `
            <button class="sc-option-btn" data-qindex="${qIndex}" data-value="${opt}">
              ${opt}
            </button>
          `).join('')}
        </div>
      `;
      list.appendChild(questionEl);
    });

    // Option click handlers
    list.querySelectorAll('.sc-option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const qi = btn.dataset.qindex;
        // Deselect siblings
        btn.closest('.sc-options-wrap').querySelectorAll('.sc-option-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        followupAnswers[qi] = btn.dataset.value;
      });
    });
  }

  // Get diagnosis button
  document.getElementById('btnGetDiagnosis').addEventListener('click', () => {
    // Check at least 2 questions answered
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

  // ====== SCREEN 4: Diagnosis Results (Gemini AI) ======
  async function getDiagnosis() {
    const loading = document.getElementById('resultsLoading');
    const content = document.getElementById('resultsContent');
    loading.style.display = 'flex';
    content.style.display = 'none';

    const answersText = Object.entries(followupAnswers)
      .map(([k, v]) => v)
      .join('; ');

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
      const data = await callGemini(prompt);
      const parsed = parseJSON(data);

      if (parsed && parsed.conditions) {
        diagnosisData = parsed;
        renderDiagnosis(parsed);
        loading.style.display = 'none';
        content.style.display = 'block';

        // Save to history
        saveToHistory(parsed);
      } else {
        throw new Error('Invalid diagnosis format');
      }
    } catch (err) {
      console.error('Diagnosis error:', err);
      loading.style.display = 'none';
      content.style.display = 'block';
      renderDiagnosisError();
    }
  }

  function renderDiagnosis(data) {
    // Symptom tags
    const tagsEl = document.getElementById('symptomTags');
    tagsEl.innerHTML = data.symptoms_identified
      .map(s => `<span class="sc-tag">${s}</span>`)
      .join('');

    // Conditions
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

    // Causes
    document.getElementById('causesBody').innerHTML =
      `<ul class="sc-info-list">${data.causes.map(c => `<li>${c}</li>`).join('')}</ul>`;

    // Prevention
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
        // Store the condition for clinic booking
        localStorage.setItem('homatt_clinic_reason', JSON.stringify({
          condition: data.conditions[0]?.name || 'Health Check',
          urgency: data.clinic_urgency || data.overall_risk,
          symptoms: data.symptoms_identified,
        }));
        // For now, show a message. Later will navigate to clinic finder
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

  function renderDiagnosisError() {
    document.getElementById('resultsContent').innerHTML = `
      <div class="sc-disclaimer">
        <span class="material-icons-outlined" style="font-size:18px">error</span>
        <p>We couldn't complete the assessment right now. Please check your internet connection and try again.</p>
      </div>
      <button class="btn btn-next" onclick="location.reload()">
        <span class="material-icons-outlined">refresh</span>
        Try Again
      </button>
      <button class="btn sc-home-btn" style="margin-top:10px" onclick="location.href='dashboard.html'">
        <span class="material-icons-outlined">home</span>
        Back to Dashboard
      </button>
    `;
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

    // Save monitoring session
    localStorage.setItem('homatt_monitoring', JSON.stringify(monitoringSession));

    // Show monitor condition
    document.getElementById('monitorCondition').innerHTML = `
      <div class="sc-monitor-cond-card">
        <span class="material-icons-outlined">medical_information</span>
        <div>
          <p class="sc-monitor-cond-name">Monitoring: ${monitoringSession.condition}</p>
          <p class="sc-monitor-cond-risk">Risk level: <strong class="${monitoringSession.risk}">${monitoringSession.risk}</strong></p>
        </div>
      </div>
    `;

    // Reset feeling options
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
      // Remove old listeners by cloning
      const newBtn = btn.cloneNode(true);
      btn.parentNode.replaceChild(newBtn, btn);

      newBtn.addEventListener('click', () => {
        const feeling = newBtn.dataset.feeling;

        // Highlight selection
        document.querySelectorAll('.sc-feeling-btn').forEach(b => {
          b.classList.remove('selected');
          b.disabled = true;
        });
        newBtn.classList.add('selected');

        // Record check-in
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

        // Handle response
        handleMonitoringResponse(feeling);
      });
    });
  }

  async function handleMonitoringResponse(feeling) {
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
      scheduleNextCheckIn(2); // 2 hours for improving
    } else if (feeling === 'same') {
      if (monitoringSession.symptomsSame >= 2) {
        // Symptoms persisted through multiple check-ins
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
        scheduleNextCheckIn(1); // 1 hour
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

    // Store next check-in time
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
    // Keep last 20 entries
    if (history.length > 20) history.pop();
    localStorage.setItem('homatt_symptom_history', JSON.stringify(history));
  }

  // ====== Gemini API Call ======
  async function callGemini(prompt) {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.8,
          maxOutputTokens: 2048,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return text;
  }

  // ====== JSON Parser (handles markdown code blocks) ======
  function parseJSON(text) {
    // Strip markdown code fences if present
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
        // Time for a check-in
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
