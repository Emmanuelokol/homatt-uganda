/**
 * Homatt Health — Daily Health Micro-Quiz
 *
 * AI provider chain: Gemini → Groq → OpenAI (fallback)
 * Topics rotate daily: Nutrition → Sleep → Movement → Mental Clarity
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Auth check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'signin.html';
    return;
  }

  const user = JSON.parse(localStorage.getItem('homatt_user') || '{}');

  // ── Topic rotation (4 topics, cycles daily) ────────────────────────────────
  const TOPICS = ['Nutrition', 'Sleep', 'Movement', 'Mental Clarity'];
  const TODAY = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const dayIndex = Math.floor(Date.now() / 86400000) % TOPICS.length;
  const topic = TOPICS[dayIndex];

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const screens = {
    loading:        document.getElementById('screenLoading'),
    accountability: document.getElementById('screenAccountability'),
    question:       document.getElementById('screenQuestion'),
    results:        document.getElementById('screenResults'),
    alreadyDone:    document.getElementById('screenAlreadyDone'),
    error:          document.getElementById('screenError'),
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let currentQuiz = null;
  let currentQuestionIndex = 0;
  const answers = [];

  // ── Helpers ────────────────────────────────────────────────────────────────
  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
  }

  function topicIcon(t) {
    return { Nutrition: '🥦', Sleep: '😴', Movement: '🏃', 'Mental Clarity': '🧠' }[t] || '💊';
  }

  function topicBadgeHTML(t) {
    return `<span class="qz-topic-icon">${topicIcon(t)}</span> ${t}`;
  }

  // ── Status bar clock ───────────────────────────────────────────────────────
  function updateTime() {
    const now = new Date();
    document.getElementById('statusTime').textContent =
      now.getHours().toString().padStart(2, '0') + ':' +
      now.getMinutes().toString().padStart(2, '0');
  }
  updateTime();
  setInterval(updateTime, 30000);

  // ── Offline fallback quizzes ───────────────────────────────────────────────
  const FALLBACK_QUIZZES = {
    Nutrition: {
      topic: 'Nutrition',
      questions: [
        {
          type: 'theory', label: 'The Why',
          text: 'Why does eating a variety of colorful vegetables improve your health?',
          options: ['A) It looks more appealing', 'B) Each color provides different nutrients', 'C) It speeds up digestion', 'D) Color has no health effect'],
          correct: 'B',
          explanation: 'Different plant pigments deliver unique vitamins and antioxidants that protect against different diseases.',
        },
        {
          type: 'behavior', label: 'The Do',
          text: 'Did you eat at least one vegetable or fruit yesterday?',
          options: ['Yes', 'No', 'Sometimes'],
        },
        {
          type: 'behavior', label: 'The Do',
          text: 'How often do you skip breakfast during the week?',
          options: ['1', '2', '3', '4', '5'],
          scale_label: '1 = Never  |  5 = Every day',
        },
      ],
      insight: 'Eating 5 plant colors a day reduces chronic disease risk by up to 30% through diverse antioxidant coverage.',
      mission: 'Add one extra vegetable or fruit to your next meal right now — even a small piece counts.',
    },
    Sleep: {
      topic: 'Sleep',
      questions: [
        {
          type: 'theory', label: 'The Why',
          text: 'What happens to your immune system after fewer than 6 hours of sleep?',
          options: ['A) It works faster', 'B) It weakens significantly', 'C) Nothing changes', 'D) It becomes hyperactive'],
          correct: 'B',
          explanation: 'Sleep deprivation reduces natural killer cell activity by up to 70%, making you far more vulnerable to illness.',
        },
        {
          type: 'behavior', label: 'The Do',
          text: 'Did you sleep at least 7 hours last night?',
          options: ['Yes', 'No', 'Sometimes'],
        },
        {
          type: 'behavior', label: 'The Do',
          text: 'How late do you use your phone before sleeping?',
          options: ['1', '2', '3', '4', '5'],
          scale_label: '1 = 1+ hr before bed  |  5 = Right before sleeping',
        },
      ],
      insight: 'Even one night of poor sleep raises stress hormones and inflammation markers that take 3 days to fully recover.',
      mission: 'Set a phone-down alarm for 30 minutes before your planned bedtime tonight — do it right now.',
    },
    Movement: {
      topic: 'Movement',
      questions: [
        {
          type: 'theory', label: 'The Why',
          text: 'What is the minimum daily movement shown to reduce heart disease risk?',
          options: ['A) 30 min vigorous exercise', 'B) 10,000 steps only', 'C) 22 minutes moderate movement', 'D) 1 hour of yoga'],
          correct: 'C',
          explanation: '22 minutes of moderate daily movement reduces cardiovascular mortality risk by 17–35%, research shows.',
        },
        {
          type: 'behavior', label: 'The Do',
          text: 'Did you walk or move actively for at least 15 minutes yesterday?',
          options: ['Yes', 'No', 'Sometimes'],
        },
        {
          type: 'behavior', label: 'The Do',
          text: 'How many hours did you sit without standing yesterday?',
          options: ['1', '2', '3', '4', '5'],
          scale_label: '1 = Less than 2 hours  |  5 = 8+ hours',
        },
      ],
      insight: 'Standing up every 45 minutes reduces blood sugar spikes and triglyceride buildup, even if you exercise daily.',
      mission: 'Stand up right now, do 10 slow squats, then stretch both arms overhead for 30 seconds.',
    },
    'Mental Clarity': {
      topic: 'Mental Clarity',
      questions: [
        {
          type: 'theory', label: 'The Why',
          text: 'Why does slow, controlled breathing reduce stress immediately?',
          options: ['A) It distracts your mind', 'B) It activates the parasympathetic nervous system', 'C) It raises heart rate', 'D) It lowers blood oxygen'],
          correct: 'B',
          explanation: 'Slow exhalation activates the vagus nerve, signaling your brain to switch from fight-or-flight to rest mode.',
        },
        {
          type: 'behavior', label: 'The Do',
          text: 'Did you take any intentional mental breaks from stress yesterday?',
          options: ['Yes', 'No', 'Sometimes'],
        },
        {
          type: 'behavior', label: 'The Do',
          text: 'How is your stress level right now?',
          options: ['1', '2', '3', '4', '5'],
          scale_label: '1 = Very calm  |  5 = Very stressed',
        },
      ],
      insight: 'A 5-minute breathing exercise measurably lowers cortisol, with calming effects lasting 2–3 hours.',
      mission: 'Breathe in for 4 counts, hold for 4, exhale for 6. Repeat 5 times right now.',
    },
  };

  // ── AI quiz generation ─────────────────────────────────────────────────────
  async function generateQuizAI(topicName) {
    const proxyUrl = cfg.API_PROXY_URL;
    if (!proxyUrl) throw new Error('No API proxy URL configured.');

    const userGoals = (user.healthGoals || []).join(', ') || 'general wellness';
    const userLocation = user.district || user.city || 'Uganda';

    const prompt =
      `Generate a Daily Micro-Health Quiz for topic: "${topicName}".\n` +
      `User context: health goals = ${userGoals}, location = ${userLocation}, Uganda.\n\n` +
      `Return ONLY valid JSON with this exact structure:\n` +
      `{"topic":"${topicName}","questions":[` +
      `{"type":"theory","label":"The Why","text":"...max 20 words...","options":["A) ...","B) ...","C) ...","D) ..."],"correct":"A","explanation":"...max 20 words..."},` +
      `{"type":"behavior","label":"The Do","text":"...max 15 words...","options":["Yes","No","Sometimes"]},` +
      `{"type":"behavior","label":"The Do","text":"...rate habit max 15 words...","options":["1","2","3","4","5"],"scale_label":"1 = Never, 5 = Always"}` +
      `],"insight":"...one scientific sentence max 25 words...","mission":"...physical action max 20 words, starts with verb..."}`;

    const providers = ['gemini', 'groq', 'openai'];

    for (const provider of providers) {
      try {
        const res = await fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, prompt, mode: 'quiz' }),
        });

        if (!res.ok) continue;

        const data = await res.json();
        const raw = (data.text || '').replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        const quiz = JSON.parse(raw);

        if (
          Array.isArray(quiz.questions) && quiz.questions.length >= 3 &&
          quiz.insight && quiz.mission
        ) {
          return quiz;
        }
      } catch (_e) {
        // try next provider
      }
    }

    throw new Error('All AI providers failed.');
  }

  // ── Load quiz (today's cached or freshly generated) ────────────────────────
  async function loadQuiz() {
    const cached = JSON.parse(localStorage.getItem('homatt_quiz_cache') || 'null');
    if (cached && cached.date === TODAY && cached.topic === topic) {
      return cached.quiz;
    }

    const quiz = await generateQuizAI(topic).catch(() => FALLBACK_QUIZZES[topic]);
    localStorage.setItem('homatt_quiz_cache', JSON.stringify({ date: TODAY, topic, quiz }));
    return quiz;
  }

  // ── Yesterday's mission lookup ─────────────────────────────────────────────
  function getYesterdayMission() {
    const stored = JSON.parse(localStorage.getItem('homatt_quiz_mission') || 'null');
    if (!stored) return null;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return stored.date === yesterday.toISOString().slice(0, 10) ? stored : null;
  }

  // ── Check if quiz already completed today ──────────────────────────────────
  function isCompletedToday() {
    return localStorage.getItem('homatt_quiz_last_date') === TODAY;
  }

  // ── Screen: Accountability ─────────────────────────────────────────────────
  function showAccountabilityScreen(mission) {
    document.getElementById('accountabilityTopic').innerHTML = topicBadgeHTML(topic);
    document.getElementById('prevMissionText').textContent = mission.text;

    document.getElementById('accountabilityBack').onclick = () => {
      window.location.href = 'dashboard.html';
    };

    document.getElementById('missionYes').onclick = () => {
      // Completing yesterday's mission adds a bonus streak increment
      const s = parseInt(localStorage.getItem('homatt_quiz_streak') || '0');
      localStorage.setItem('homatt_quiz_streak', String(s + 1));
      showQuestionScreen(0);
    };

    document.getElementById('missionNo').onclick = () => {
      showQuestionScreen(0);
    };

    showScreen('accountability');
  }

  // ── Screen: Question ───────────────────────────────────────────────────────
  function showQuestionScreen(index) {
    currentQuestionIndex = index;
    const questions = currentQuiz.questions;
    const q = questions[index];
    const total = questions.length;

    document.getElementById('questionTopic').innerHTML = topicBadgeHTML(topic);

    // Progress dots
    const dotsEl = document.getElementById('progressDots');
    dotsEl.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('span');
      dot.className = 'qz-progress-dot' + (i === index ? ' active' : i < index ? ' done' : '');
      dotsEl.appendChild(dot);
    }

    // Label
    const labelEl = document.getElementById('questionLabel');
    labelEl.textContent = q.label;
    labelEl.className = 'qz-question-label ' + (q.type === 'theory' ? 'label-theory' : 'label-behavior');

    // Question text
    document.getElementById('questionText').textContent = q.text;

    // Remove previous scale label if any
    const prevScale = document.getElementById('screenQuestion').querySelector('.qz-scale-label');
    if (prevScale) prevScale.remove();
    if (q.scale_label) {
      const sl = document.createElement('p');
      sl.className = 'qz-scale-label';
      sl.textContent = q.scale_label;
      document.getElementById('questionText').insertAdjacentElement('afterend', sl);
    }

    // Options
    const optionsEl = document.getElementById('questionOptions');
    optionsEl.innerHTML = '';
    q.options.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'qz-option-btn';
      btn.textContent = opt;
      btn.dataset.value = opt;
      btn.addEventListener('click', () => handleOptionSelect(btn, opt, q, index));
      optionsEl.appendChild(btn);
    });

    // Reset explanation and Next button
    const explanation = document.getElementById('questionExplanation');
    explanation.classList.add('hidden');
    explanation.textContent = '';

    const nextBtn = document.getElementById('questionNext');
    nextBtn.classList.add('hidden');
    nextBtn.textContent = index < total - 1 ? 'Next →' : 'See Results →';

    // Back button
    document.getElementById('questionBack').onclick = () => {
      if (index > 0) {
        showQuestionScreen(index - 1);
      } else if (getYesterdayMission()) {
        showScreen('accountability');
      } else {
        window.location.href = 'dashboard.html';
      }
    };

    showScreen('question');
  }

  function handleOptionSelect(btn, value, question, questionIndex) {
    const allBtns = document.querySelectorAll('.qz-option-btn');

    if (question.type === 'theory') {
      // Reveal correct/wrong
      const selectedLetter = value.charAt(0);
      const isCorrect = selectedLetter === question.correct;

      allBtns.forEach(b => {
        b.disabled = true;
        const letter = b.dataset.value.charAt(0);
        if (letter === question.correct) {
          b.classList.add('correct');
        } else if (b === btn && !isCorrect) {
          b.classList.add('wrong');
        }
      });

      if (question.explanation) {
        const el = document.getElementById('questionExplanation');
        el.textContent = question.explanation;
        el.classList.remove('hidden');
      }

      answers[questionIndex] = { value, correct: isCorrect };
    } else {
      // Behavioral — just mark selected
      allBtns.forEach(b => {
        b.disabled = true;
        b.classList.remove('selected');
      });
      btn.classList.add('selected');
      answers[questionIndex] = { value };
    }

    document.getElementById('questionNext').classList.remove('hidden');
  }

  // Wire up Next button once
  document.getElementById('questionNext').addEventListener('click', () => {
    const total = currentQuiz.questions.length;
    if (currentQuestionIndex < total - 1) {
      showQuestionScreen(currentQuestionIndex + 1);
    } else {
      showResultsScreen();
    }
  });

  // ── Screen: Results ────────────────────────────────────────────────────────
  function showResultsScreen() {
    const theoryIdx = currentQuiz.questions.findIndex(q => q.type === 'theory');
    const theoryAnswer = theoryIdx >= 0 ? answers[theoryIdx] : null;
    const correct = theoryAnswer?.correct ? 1 : 0;

    document.getElementById('resultsTopic').innerHTML = topicBadgeHTML(topic);
    document.getElementById('resultsScore').textContent =
      correct === 1 ? '1/1 correct ✓' : '0/1 correct — try again tomorrow!';
    document.getElementById('insightText').textContent = currentQuiz.insight;
    document.getElementById('missionText').textContent = currentQuiz.mission;

    // Save mission for tomorrow's accountability check
    localStorage.setItem('homatt_quiz_mission', JSON.stringify({
      text: currentQuiz.mission,
      topic,
      date: TODAY,
    }));

    // Update streak (only if this is first completion today)
    if (!isCompletedToday()) {
      const lastDate = localStorage.getItem('homatt_quiz_last_date');
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yDate = yesterday.toISOString().slice(0, 10);

      let streak = parseInt(localStorage.getItem('homatt_quiz_streak') || '0');
      if (lastDate === yDate) {
        streak++;
      } else {
        streak = 1;
      }
      localStorage.setItem('homatt_quiz_streak', String(streak));
      localStorage.setItem('homatt_quiz_last_date', TODAY);
    }

    document.getElementById('resultsDone').onclick = () => {
      window.location.href = 'dashboard.html';
    };

    showScreen('results');
  }

  // ── Screen: Already Done ───────────────────────────────────────────────────
  function showAlreadyDoneScreen() {
    const streak = parseInt(localStorage.getItem('homatt_quiz_streak') || '0');
    document.getElementById('streakDisplay').textContent = streak;
    document.getElementById('alreadyDoneBack').onclick = () => {
      window.location.href = 'dashboard.html';
    };

    // Show today's mission as a reminder
    const todayMission = JSON.parse(localStorage.getItem('homatt_quiz_mission') || 'null');
    if (todayMission && todayMission.date === TODAY && todayMission.text) {
      const missionNote = document.createElement('div');
      missionNote.className = 'qz-prev-mission-card';
      missionNote.style.cssText = 'margin-top: 4px; width: 100%; text-align: left;';
      missionNote.innerHTML =
        '<p style="font-size:11px;font-weight:600;color:var(--accent);margin-bottom:5px">TODAY\'S MISSION</p>' +
        `<p class="qz-prev-mission-text">${todayMission.text}</p>`;
      const body = screens.alreadyDone.querySelector('.qz-already-body');
      const btn = document.getElementById('alreadyDoneBack');
      body.insertBefore(missionNote, btn);
    }

    showScreen('alreadyDone');
  }

  // ── Error handling ─────────────────────────────────────────────────────────
  document.getElementById('retryBtn').addEventListener('click', () => {
    // Clear cache to force fresh generation
    localStorage.removeItem('homatt_quiz_cache');
    init();
  });

  document.getElementById('errorBack').addEventListener('click', () => {
    window.location.href = 'dashboard.html';
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    showScreen('loading');

    // If already done today, show the "already done" screen
    if (isCompletedToday()) {
      // Load cached quiz so mission is available in already-done screen
      const cached = JSON.parse(localStorage.getItem('homatt_quiz_cache') || 'null');
      if (cached && cached.quiz) currentQuiz = cached.quiz;
      showAlreadyDoneScreen();
      return;
    }

    try {
      currentQuiz = await loadQuiz();
    } catch (e) {
      console.error('Quiz load error:', e);
      document.getElementById('errorMsg').textContent =
        'Could not generate quiz. Check your connection and try again.';
      showScreen('error');
      return;
    }

    const prevMission = getYesterdayMission();
    if (prevMission) {
      showAccountabilityScreen(prevMission);
    } else {
      showQuestionScreen(0);
    }
  }

  init();
});
