/**
 * Homatt Health — Mood & Sleep Tracker (Module 2)
 * Detects: sleep deprivation, insomnia, mood trends, burnout, anxiety, bipolar pattern guard
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};

  // Safe Supabase init — won't crash if CDN is slow or config missing
  let supabase = null;
  let session = null;
  let userId = null;
  try {
    if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
      supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data } = await supabase.auth.getSession();
      session = data?.session || null;
      userId = session?.user?.id || null;
    }
  } catch(e) { console.warn('[MoodTracker] Supabase init failed:', e.message); }

  // Accept localStorage session for offline / APK users
  const localSession = (() => { try { return JSON.parse(localStorage.getItem('homatt_session') || 'null'); } catch(e) { return null; } })();
  if (!session && !localSession) { window.location.href = 'signin.html'; return; }
  if (!userId && localSession?.userId) userId = localSession.userId;

  const user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  const firstName = user.first_name || localSession?.first_name || localSession?.name?.split(' ')[0] || 'there';
  const today = new Date().toISOString().split('T')[0];

  function updateTime() {
    const d = new Date();
    document.getElementById('statusTime').textContent =
      `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // ---- Navigation ----
  document.getElementById('backBtn').addEventListener('click', () => window.location.href = 'dashboard.html');
  document.getElementById('navHome').addEventListener('click', () => window.location.href = 'dashboard.html');

  // ---- Tab switching ----
  const tabs = document.querySelectorAll('.tracker-tab');
  const panes = document.querySelectorAll('.tracker-tab-pane');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const paneId = 'pane' + tab.dataset.tab.charAt(0).toUpperCase() + tab.dataset.tab.slice(1);
      document.getElementById(paneId).classList.add('active');
      if (tab.dataset.tab === 'history') loadHistory();
    });
  });

  // ---- Choice buttons (single select) ----
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      document.querySelectorAll(`.choice-btn[data-group="${group}"]`)
        .forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // ---- Chip toggles (multi-select) ----
  document.querySelectorAll('.chip-toggle').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });

  // ---- Sliders ----
  function initSlider(sliderId, displayId) {
    const slider = document.getElementById(sliderId);
    const display = document.getElementById(displayId);
    if (!slider || !display) return;
    display.textContent = slider.value;
    slider.addEventListener('input', () => display.textContent = slider.value);
  }
  initSlider('sleepQuality', 'sleepQualityVal');
  initSlider('moodScore', 'moodScoreVal');
  initSlider('energyLevel', 'energyLevelVal');
  initSlider('anxietyLevel', 'anxietyLevelVal');
  initSlider('dietQuality', 'dietQualityVal');

  // ---- Exercise toggle: show type/duration when "yes" selected ----
  document.querySelectorAll('.choice-btn[data-group="exercised"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const show = btn.dataset.val === 'yes';
      const typeWrap = document.getElementById('exerciseTypeWrap');
      const durWrap = document.getElementById('exerciseDurationWrap');
      if (typeWrap) typeWrap.style.display = show ? 'block' : 'none';
      if (durWrap) durWrap.style.display = show ? 'block' : 'none';
    });
  });

  // ---- Personalized greeting ----
  const logSection = document.querySelector('.tracker-section:first-child .tracker-section-title');
  if (logSection) {
    const greetEl = document.createElement('p');
    greetEl.style.cssText = 'font-size:13px;color:var(--text-secondary);margin:4px 20px 0;line-height:1.5';
    greetEl.textContent = `Hi ${firstName}! Log how you slept and how you're feeling today.`;
    logSection.closest('.tracker-section').insertAdjacentElement('beforebegin', greetEl);
  }

  // ---- Counter: Night Awakenings ----
  let awakenings = 0;
  function updateAwakeDisplay() {
    document.getElementById('awakeDisplay').textContent = awakenings;
  }
  document.getElementById('awakeDec').addEventListener('click', () => {
    if (awakenings > 0) { awakenings--; updateAwakeDisplay(); }
  });
  document.getElementById('awakeInc').addEventListener('click', () => {
    if (awakenings < 20) { awakenings++; updateAwakeDisplay(); }
  });

  // ---- Helpers ----
  function getChoice(group) {
    const btn = document.querySelector(`.choice-btn[data-group="${group}"].selected`);
    return btn ? btn.dataset.val : null;
  }

  function getChips(chipGroup) {
    return Array.from(document.querySelectorAll(`.chip-toggle[data-chip="${chipGroup}"].selected`))
      .map(c => c.dataset.val);
  }

  // ---- Calculate sleep duration ----
  function calcSleepHours(startTime, endTime) {
    if (!startTime || !endTime) return null;
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60; // overnight
    return Math.round(mins / 6) / 10; // one decimal hour
  }

  // ---- Save Log ----
  document.getElementById('saveMoodLog').addEventListener('click', async () => {
    const sleepStart = document.getElementById('sleepStart').value;
    const wakeTime = document.getElementById('wakeTime').value;

    // Also pull today's diet data from diet tracker for richer analysis
    const dietLogs = JSON.parse(localStorage.getItem('homatt_diet_logs') || '[]');
    const todayDiet = dietLogs.find(d => d.date === today) || null;

    const logData = {
      user_id: userId,
      log_date: today,
      sleep_start: sleepStart || null,
      wake_time: wakeTime || null,
      sleep_hours: calcSleepHours(sleepStart, wakeTime),
      night_awakenings: awakenings,
      sleep_quality: parseInt(document.getElementById('sleepQuality').value),
      mood: parseInt(document.getElementById('moodScore').value),
      energy_level: parseInt(document.getElementById('energyLevel').value),
      anxiety_level: parseInt(document.getElementById('anxietyLevel').value),
      stress_triggers: getChips('stress'),
      caffeine_intake: getChoice('caffeine') === 'yes',
      alcohol_intake: getChoice('alcohol') === 'yes',
      // Diet data (from this tracker + synced from diet tracker)
      diet_quality: parseInt(document.getElementById('dietQuality')?.value || '5'),
      meals_eaten: getChips('meal'),
      water_intake: getChips('water')[0] || null,
      diet_synced: todayDiet ? todayDiet : null,
      // Exercise data
      exercised: getChoice('exercised') === 'yes',
      exercise_types: getChips('exercise_type'),
      exercise_duration: getChips('exercise_duration')[0] || null,
      activity_level: getChips('activity')[0] || null,
      notes: document.getElementById('moodNotes').value.trim() || null,
    };

    const btn = document.getElementById('saveMoodLog');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Saving...';

    // Save to localStorage always (offline-first)
    const localLogs = JSON.parse(localStorage.getItem('homatt_mood_logs') || '[]');
    localLogs.unshift(logData);
    if (localLogs.length > 60) localLogs.pop();
    localStorage.setItem('homatt_mood_logs', JSON.stringify(localLogs));

    if (supabase) {
      const { error } = await supabase.from('mood_sleep_logs').insert(logData);
      if (error) console.warn('[MoodTracker] Supabase insert failed (will use local data):', error.message);
    }

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">save</span> Save Today\'s Log';

    showToast(`Great job logging, ${firstName}! Keep it up 🌱`);
    resetForm();
  });

  function resetForm() {
    document.getElementById('sleepStart').value = '';
    document.getElementById('wakeTime').value = '';
    awakenings = 0;
    updateAwakeDisplay();
    ['sleepQuality','moodScore','energyLevel','dietQuality'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.value = 5; }
      const valEl = document.getElementById(id + 'Val');
      if (valEl) valEl.textContent = '5';
    });
    document.getElementById('anxietyLevel').value = 1;
    document.getElementById('anxietyLevelVal').textContent = 1;
    document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.chip-toggle').forEach(c => c.classList.remove('selected'));
    document.getElementById('moodNotes').value = '';
    // Hide exercise details
    const tw = document.getElementById('exerciseTypeWrap');
    const dw = document.getElementById('exerciseDurationWrap');
    if (tw) tw.style.display = 'none';
    if (dw) dw.style.display = 'none';
  }

  // ---- Pattern Analysis ----
  const analyzeBtn = document.getElementById('analyzeBtn');
  const reAnalyzeBtn = document.getElementById('reAnalyzeBtn');

  async function runAnalysis() {
    const patternCta = document.getElementById('patternCta');
    const aiLoading = document.getElementById('aiLoading');
    const patternResults = document.getElementById('patternResults');

    patternCta.style.display = 'none';
    aiLoading.classList.add('visible');
    patternResults.classList.remove('visible');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().split('T')[0];

    // Load from localStorage first (offline-first), then try Supabase
    let logs = JSON.parse(localStorage.getItem('homatt_mood_logs') || '[]')
      .filter(l => l.log_date >= cutoff);

    if (supabase && userId) {
      try {
        const { data: sbLogs } = await supabase
          .from('mood_sleep_logs')
          .select('*')
          .eq('user_id', userId)
          .gte('log_date', cutoff)
          .order('log_date', { ascending: false });
        if (sbLogs && sbLogs.length > logs.length) logs = sbLogs;
      } catch(e) {}
    }

    if (!logs || logs.length < 3) {
      aiLoading.classList.remove('visible');
      patternCta.style.display = 'block';
      showToast(`Log at least 3 days to run analysis, ${firstName}.`);
      return;
    }

    const prompt = buildMoodPrompt(logs, { age: user.age || localSession?.age, city: user.city || localSession?.city, name: firstName });

    try {
      const text = await callAI(prompt, cfg);
      const result = parseAIResponse(text);
      displayResults(result);
    } catch (err) {
      aiLoading.classList.remove('visible');
      patternCta.style.display = 'block';
      showToast('AI analysis unavailable. Please try again later.');
      console.error(err);
    }
  }

  analyzeBtn.addEventListener('click', runAnalysis);
  reAnalyzeBtn.addEventListener('click', runAnalysis);

  function buildMoodPrompt(logs, userContext) {
    const avgMood = (logs.reduce((s, l) => s + (l.mood || 5), 0) / logs.length).toFixed(1);
    const avgSleep = (logs.reduce((s, l) => s + (l.sleep_hours || 7), 0) / logs.length).toFixed(1);
    const avgAnxiety = (logs.reduce((s, l) => s + (l.anxiety_level || 1), 0) / logs.length).toFixed(1);

    const avgDiet = logs.some(l => l.diet_quality) ? (logs.reduce((s, l) => s + (l.diet_quality || 5), 0) / logs.length).toFixed(1) : null;
    const avgExerciseDays = logs.filter(l => l.exercised).length;

    const logSummary = logs.map(l => ({
      date: l.log_date,
      sleep_hours: l.sleep_hours,
      awakenings: l.night_awakenings,
      sleep_quality: l.sleep_quality,
      mood: l.mood,
      energy: l.energy_level,
      anxiety: l.anxiety_level,
      stress_triggers: l.stress_triggers,
      caffeine: l.caffeine_intake,
      alcohol: l.alcohol_intake,
      diet_quality: l.diet_quality,
      meals_eaten: l.meals_eaten,
      water_intake: l.water_intake,
      exercised: l.exercised,
      exercise_types: l.exercise_types,
      activity_level: l.activity_level,
    }));

    return `You are a caring, personalized health pattern analyzer for Homatt Health, a mobile health app in Uganda.

Analyze ${userContext.name || 'this user'}'s mood, sleep, diet, and exercise log data. Use their name (${userContext.name || 'User'}) in your response.

User context: name=${userContext.name || 'User'}, age=${userContext.age || 'unknown'}, location=${userContext.city || 'Uganda'}
Averages (last ${logs.length} days): mood=${avgMood}/10, sleep=${avgSleep}hrs, anxiety=${avgAnxiety}/10${avgDiet ? ', diet='+avgDiet+'/10' : ''}, exercise_days=${avgExerciseDays}/${logs.length}

Daily logs (recent first):
${JSON.stringify(logSummary, null, 2)}

Analysis rules:
- NEVER diagnose. NEVER prescribe. Use non-diagnostic language only.
- If mood < 4 for 14+ consecutive days: note possible depressive trend (not depression diagnosis)
- If sleep < 6hrs chronic: flag chronic sleep deprivation risk
- If sleep > 9hrs persistent: note as possibly worth monitoring
- If sleep latency issues or awakenings > 3 frequently: suggest possible insomnia pattern
- If anxiety > 7 repeatedly with sleep disruption: flag anxiety-sleep link
- Bipolar pattern guard: if high energy + low sleep periods followed by crashes — flag mood variability worth professional evaluation (do NOT call it bipolar)
- Burnout risk: sustained low energy + high stress + poor sleep
- CRITICAL: If "suicidal" or "self-harm" appears in notes: escalate immediately. This data may not have that field but be aware.
- Risk: green=stable, yellow=monitor, orange=evaluation recommended, red=seek professional support now

Respond ONLY with valid JSON:
{
  "pattern_summary": "2-3 sentence overview",
  "trend_interpretation": "What the trends suggest",
  "risk_level": "green|yellow|orange|red",
  "risk_label": "Stable|Monitor|Evaluation Recommended|Urgent",
  "recommended_next_step": "Specific actionable advice",
  "red_flags": ["flag1", "flag2"],
  "clarifying_data_needed": "What additional data would help, or null",
  "confidence": 75,
  "cause": "In 1-2 plain sentences, what is most likely causing this sleep/mood pattern (e.g. stress, lifestyle, sleep habits)",
  "how_to_increase": "In 1-2 sentences, the single most impactful thing this person can do to improve their mood and sleep scores",
  "benefits": ["Specific benefit 1 of improving (e.g. more energy)", "Benefit 2", "Benefit 3"],
  "techniques": ["Simple technique 1 with brief how-to", "Technique 2", "Technique 3"],
  "steps": ["Step 1: Specific action to take today", "Step 2: Action for this week", "Step 3: Action to build over the next month"]
}`;
  }

  function displayResults(result) {
    document.getElementById('aiLoading').classList.remove('visible');
    document.getElementById('patternResults').classList.add('visible');

    const badge = document.getElementById('stabilityBadge');
    badge.className = `stability-badge ${result.risk_level || 'green'}`;
    const iconMap = { green: 'check_circle', yellow: 'watch_later', orange: 'report_problem', red: 'emergency' };
    badge.querySelector('.material-icons-outlined').textContent = iconMap[result.risk_level] || 'check_circle';
    document.getElementById('stabilityLabel').textContent = result.risk_label || 'Stable';
    document.getElementById('confidenceText').textContent = `${result.confidence || 75}% confidence`;

    document.getElementById('patternSummary').textContent = result.pattern_summary || '';
    document.getElementById('trendInterpretation').textContent = result.trend_interpretation || '';
    document.getElementById('nextStep').textContent = result.recommended_next_step || '';

    const redFlagCard = document.getElementById('redFlagCard');
    const redFlagsList = document.getElementById('redFlagsList');
    if (result.red_flags && result.red_flags.length > 0) {
      redFlagsList.innerHTML = result.red_flags.map(f => `<li>${f}</li>`).join('');
      redFlagCard.classList.remove('hidden');
    } else {
      redFlagCard.classList.add('hidden');
    }

    const clarifyCard = document.getElementById('clarifyCard');
    if (result.clarifying_data_needed) {
      document.getElementById('clarifyText').textContent = result.clarifying_data_needed;
      clarifyCard.classList.remove('hidden');
    } else {
      clarifyCard.classList.add('hidden');
    }

    // — New pattern sections —
    const causeCard = document.getElementById('causeCard');
    if (result.cause) {
      document.getElementById('causeText').textContent = result.cause;
      causeCard.classList.remove('hidden');
    } else { causeCard.classList.add('hidden'); }

    const howCard = document.getElementById('howToIncreaseCard');
    if (result.how_to_increase) {
      document.getElementById('howToIncreaseText').textContent = result.how_to_increase;
      howCard.classList.remove('hidden');
    } else { howCard.classList.add('hidden'); }

    const benefitsCard = document.getElementById('benefitsCard');
    if (result.benefits && result.benefits.length > 0) {
      document.getElementById('benefitsList').innerHTML =
        result.benefits.map(b => `<li>${b}</li>`).join('');
      benefitsCard.classList.remove('hidden');
    } else { benefitsCard.classList.add('hidden'); }

    const techCard = document.getElementById('techniquesCard');
    if (result.techniques && result.techniques.length > 0) {
      document.getElementById('techniquesList').innerHTML =
        result.techniques.map(t => `<li>${t}</li>`).join('');
      techCard.classList.remove('hidden');
    } else { techCard.classList.add('hidden'); }

    const stepsCard = document.getElementById('stepsCard');
    if (result.steps && result.steps.length > 0) {
      document.getElementById('stepsList').innerHTML =
        result.steps.map((s, i) => `
          <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px">
            <div style="width:24px;height:24px;border-radius:50%;background:var(--primary);color:white;
              font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
              ${i + 1}
            </div>
            <span>${s.replace(/^Step \d+:\s*/i, '')}</span>
          </div>`).join('');
      stepsCard.classList.remove('hidden');
    } else { stepsCard.classList.add('hidden'); }
  }

  // ---- Load History ----
  async function loadHistory() {
    const historyLoading = document.getElementById('historyLoading');
    const historyEmpty = document.getElementById('historyEmpty');
    const historyList = document.getElementById('historyList');

    historyLoading.style.display = 'block';
    historyEmpty.classList.add('hidden');
    historyList.innerHTML = '';

    let logs = null;

    if (supabase && userId) {
      try {
        const { data } = await supabase
          .from('mood_sleep_logs')
          .select('*')
          .eq('user_id', userId)
          .order('log_date', { ascending: false })
          .limit(20);
        logs = data;
      } catch(e) { console.warn('[MoodTracker] loadHistory failed:', e.message); }
    }

    // Fall back to localStorage
    if (!logs || logs.length === 0) {
      logs = JSON.parse(localStorage.getItem('homatt_mood_logs') || '[]').slice(0, 20);
    }

    historyLoading.style.display = 'none';

    if (!logs || logs.length === 0) {
      historyEmpty.classList.remove('hidden');
      return;
    }

    logs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = 'history-entry';
      const dateStr = new Date(log.log_date).toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short' });
      const metrics = [];

      if (log.sleep_hours != null) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">bedtime</span>${log.sleep_hours}h sleep</span>`);
      if (log.mood != null) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">mood</span>Mood: ${log.mood}/10</span>`);
      if (log.energy_level != null) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">bolt</span>Energy: ${log.energy_level}/10</span>`);
      if (log.anxiety_level != null && log.anxiety_level > 3) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">psychology</span>Anxiety: ${log.anxiety_level}/10</span>`);
      if (log.night_awakenings > 0) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">nights_stay</span>${log.night_awakenings}x awake</span>`);

      entry.innerHTML = `
        <div class="history-entry-date">${dateStr}</div>
        <div class="history-entry-metrics">${metrics.join('') || '<span class="history-metric">Log recorded</span>'}</div>
      `;
      historyList.appendChild(entry);
    });
  }

  // ---- Utilities ----
  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3000);
  }

  async function callAI(prompt, cfg) {
    const proxyUrl = cfg.API_PROXY_URL;
    if (!proxyUrl) throw new Error('API_PROXY_URL not configured');
    let accessToken = null;
    if (supabase) {
      try {
        const { data } = await supabase.auth.getSession();
        accessToken = data?.session?.access_token || null;
      } catch(e) {}
    }
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ provider: 'groq', prompt }),
    });
    if (!res.ok) throw new Error(`AI proxy error: ${res.status}`);
    const data = await res.json();
    return data.text || '';
  }

  function parseAIResponse(text) {
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return {
        pattern_summary: "There isn't enough pattern data yet to make a confident interpretation.",
        trend_interpretation: 'Continue logging daily to build a clearer picture.',
        risk_level: 'green',
        risk_label: 'Stable',
        recommended_next_step: 'Log mood and sleep daily for at least 7 days.',
        red_flags: [],
        clarifying_data_needed: 'More daily logs are needed for accurate analysis.',
        confidence: 10,
      };
    }
  }
});
