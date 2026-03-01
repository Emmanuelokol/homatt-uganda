/**
 * Homatt Health — Mood & Sleep Tracker (Module 2)
 * Detects: sleep deprivation, insomnia, mood trends, burnout, anxiety, bipolar pattern guard
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'signin.html'; return; }

  const userId = session.user.id;
  const user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
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
      notes: document.getElementById('moodNotes').value.trim() || null,
    };

    const btn = document.getElementById('saveMoodLog');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Saving...';

    const { error } = await supabase.from('mood_sleep_logs').insert(logData);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">save</span> Save Today\'s Log';

    if (error) {
      showToast('Error saving log. Please try again.');
      console.error(error);
    } else {
      showToast('Mood & sleep log saved!');
      resetForm();
    }
  });

  function resetForm() {
    document.getElementById('sleepStart').value = '';
    document.getElementById('wakeTime').value = '';
    awakenings = 0;
    updateAwakeDisplay();
    document.getElementById('sleepQuality').value = 5;
    document.getElementById('sleepQualityVal').textContent = 5;
    document.getElementById('moodScore').value = 5;
    document.getElementById('moodScoreVal').textContent = 5;
    document.getElementById('energyLevel').value = 5;
    document.getElementById('energyLevelVal').textContent = 5;
    document.getElementById('anxietyLevel').value = 1;
    document.getElementById('anxietyLevelVal').textContent = 1;
    document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.chip-toggle').forEach(c => c.classList.remove('selected'));
    document.getElementById('moodNotes').value = '';
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

    const { data: logs } = await supabase
      .from('mood_sleep_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('log_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('log_date', { ascending: false });

    if (!logs || logs.length < 3) {
      aiLoading.classList.remove('visible');
      patternCta.style.display = 'block';
      showToast('Log at least 3 days to run analysis.');
      return;
    }

    const prompt = buildMoodPrompt(logs, { age: user.age, city: user.city });

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
    }));

    return `You are a preventive health pattern analyzer for Homatt Health, a mobile health app in Uganda.

Analyze this user's mood and sleep log data.

User: age=${userContext.age || 'unknown'}, location=${userContext.city || 'Uganda'}
Averages: mood=${avgMood}/10, sleep=${avgSleep}hrs, anxiety=${avgAnxiety}/10

Daily logs (last 30 days, recent first):
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
  "confidence": 75
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
  }

  // ---- Load History ----
  async function loadHistory() {
    const historyLoading = document.getElementById('historyLoading');
    const historyEmpty = document.getElementById('historyEmpty');
    const historyList = document.getElementById('historyList');

    historyLoading.style.display = 'block';
    historyEmpty.classList.add('hidden');
    historyList.innerHTML = '';

    const { data: logs } = await supabase
      .from('mood_sleep_logs')
      .select('*')
      .eq('user_id', userId)
      .order('log_date', { ascending: false })
      .limit(20);

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
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
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
