/**
 * Homatt Health — Cycle Tracker (Module 1)
 * Detects patterns: cycle length, heavy bleeding, pain, PCOS risk, PMDD, fertility window
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Auth check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'signin.html'; return; }

  const userId = session.user.id;
  const user = JSON.parse(localStorage.getItem('homatt_user') || '{}');

  // Status bar time
  function updateTime() {
    const d = new Date();
    document.getElementById('statusTime').textContent =
      `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // Default dates
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('cycleStart').value = today;

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

  // ---- Single-choice buttons ----
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
  initSlider('painScore', 'painScoreVal');
  initSlider('moodRating', 'moodRatingVal');

  // ---- Helper: get selected choice value ----
  function getChoice(group) {
    const btn = document.querySelector(`.choice-btn[data-group="${group}"].selected`);
    return btn ? btn.dataset.val : null;
  }

  // ---- Helper: get selected chips ----
  function getChips(chipGroup) {
    return Array.from(document.querySelectorAll(`.chip-toggle[data-chip="${chipGroup}"].selected`))
      .map(c => c.dataset.val);
  }

  // ---- Save Log ----
  document.getElementById('saveCycleLog').addEventListener('click', async () => {
    const cycleStart = document.getElementById('cycleStart').value;
    if (!cycleStart) { showToast('Please enter a period start date'); return; }

    const logData = {
      user_id: userId,
      log_date: today,
      cycle_start: cycleStart || null,
      cycle_end: document.getElementById('cycleEnd').value || null,
      flow_intensity: getChoice('flow'),
      has_clotting: getChoice('clotting') === 'yes',
      has_spotting: getChoice('spotting') === 'yes',
      pain_score: parseInt(document.getElementById('painScore').value),
      pms_symptoms: getChips('pms'),
      mood_rating: parseInt(document.getElementById('moodRating').value),
      sexual_activity: getChoice('sexual') === 'yes',
      ovulation_test: getChoice('ovulation'),
      bbt: parseFloat(document.getElementById('bbt').value) || null,
      notes: document.getElementById('cycleNotes').value.trim() || null,
    };

    const btn = document.getElementById('saveCycleLog');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Saving...';

    const { error } = await supabase.from('cycle_logs').insert(logData);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">save</span> Save Today\'s Log';

    if (error) {
      showToast('Error saving log. Please try again.');
      console.error(error);
    } else {
      showToast('Cycle log saved!');
      resetForm();
    }
  });

  function resetForm() {
    document.getElementById('cycleEnd').value = '';
    document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.chip-toggle').forEach(c => c.classList.remove('selected'));
    document.getElementById('painScore').value = 1;
    document.getElementById('painScoreVal').textContent = 1;
    document.getElementById('moodRating').value = 5;
    document.getElementById('moodRatingVal').textContent = 5;
    document.getElementById('bbt').value = '';
    document.getElementById('cycleNotes').value = '';
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

    // Load last 90 days of logs
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: logs } = await supabase
      .from('cycle_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('log_date', ninetyDaysAgo.toISOString().split('T')[0])
      .order('log_date', { ascending: false });

    if (!logs || logs.length === 0) {
      aiLoading.classList.remove('visible');
      patternCta.style.display = 'block';
      showToast('No logs found. Log at least 2 cycles first.');
      return;
    }

    const userContext = { age: user.age || null, city: user.city || null, district: user.district || null };

    const prompt = buildCyclePrompt(logs, userContext);

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

  function buildCyclePrompt(logs, userContext) {
    const logSummary = logs.map(l => ({
      date: l.log_date,
      cycle_start: l.cycle_start,
      cycle_end: l.cycle_end,
      flow: l.flow_intensity,
      clotting: l.has_clotting,
      spotting: l.has_spotting,
      pain: l.pain_score,
      pms: l.pms_symptoms,
      mood: l.mood_rating,
      ovulation: l.ovulation_test,
      bbt: l.bbt,
    }));

    return `You are a preventive health pattern analyzer for Homatt Health app in Uganda.

Analyze this user's menstrual cycle log data and generate structured health insights.

User context: age=${userContext.age || 'unknown'}, location=${userContext.city || 'Uganda'}

Cycle logs (last 90 days, most recent first):
${JSON.stringify(logSummary, null, 2)}

Analysis rules:
- NEVER diagnose or prescribe medication
- Use non-diagnostic language ("pattern suggests", "may indicate", "worth discussing with a doctor")
- Detect: cycle length irregularity, heavy bleeding patterns, pain trends, PCOS risk signals, PMDD patterns, fertility window if regular
- Flag short cycles (<21 days), long cycles (>35 days), amenorrhea (>90 days absent)
- Flag heavy flow >3 days + clots repeatedly (possible menorrhagia)
- Flag pain >= 7 for 2+ cycles (possible endometriosis pattern)
- Flag severe recurrent PMS mood dips (possible PMDD pattern)
- If insufficient data: note it clearly
- Risk levels: green=stable/normal, yellow=monitor closely, orange=consider evaluation, red=seek care urgently

Respond ONLY with valid JSON in exactly this format:
{
  "pattern_summary": "2-3 sentence overview of the cycle pattern",
  "trend_interpretation": "What the trends mean, using cautious language",
  "risk_level": "green|yellow|orange|red",
  "risk_label": "Stable|Monitor|Evaluation Recommended|Urgent",
  "fertility_window": "Estimated fertile window if predictable, or null if not",
  "recommended_next_step": "Specific actionable advice",
  "red_flags": ["flag1", "flag2"],
  "clarifying_data_needed": "What additional logging would improve analysis, or null",
  "confidence": 75
}`;
  }

  function displayResults(result) {
    const aiLoading = document.getElementById('aiLoading');
    const patternResults = document.getElementById('patternResults');

    aiLoading.classList.remove('visible');
    patternResults.classList.add('visible');

    // Stability badge
    const badge = document.getElementById('stabilityBadge');
    badge.className = `stability-badge ${result.risk_level || 'green'}`;
    const iconMap = { green: 'check_circle', yellow: 'watch_later', orange: 'report_problem', red: 'emergency' };
    badge.querySelector('.material-icons-outlined').textContent = iconMap[result.risk_level] || 'check_circle';
    document.getElementById('stabilityLabel').textContent = result.risk_label || 'Stable';
    document.getElementById('confidenceText').textContent = `${result.confidence || 75}% confidence`;

    document.getElementById('patternSummary').textContent = result.pattern_summary || '';
    document.getElementById('trendInterpretation').textContent = result.trend_interpretation || '';
    document.getElementById('nextStep').textContent = result.recommended_next_step || '';

    // Fertility window
    const fertilityCard = document.getElementById('fertilityCard');
    if (result.fertility_window) {
      document.getElementById('fertilityText').textContent = result.fertility_window;
      fertilityCard.classList.remove('hidden');
    } else {
      fertilityCard.classList.add('hidden');
    }

    // Red flags
    const redFlagCard = document.getElementById('redFlagCard');
    const redFlagsList = document.getElementById('redFlagsList');
    if (result.red_flags && result.red_flags.length > 0) {
      redFlagsList.innerHTML = result.red_flags.map(f => `<li>${f}</li>`).join('');
      redFlagCard.classList.remove('hidden');
    } else {
      redFlagCard.classList.add('hidden');
    }

    // Clarifying data
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
      .from('cycle_logs')
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

      const dateStr = new Date(log.log_date).toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      const metrics = [];

      if (log.flow_intensity) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">opacity</span>${capitalize(log.flow_intensity)} flow</span>`);
      if (log.pain_score) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">sentiment_very_dissatisfied</span>Pain: ${log.pain_score}/10</span>`);
      if (log.mood_rating) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">mood</span>Mood: ${log.mood_rating}/10</span>`);
      if (log.has_clotting) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">warning</span>Clotting</span>`);
      if (log.has_spotting) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">fiber_manual_record</span>Spotting</span>`);
      if (log.pms_symptoms && log.pms_symptoms.length > 0) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">sick</span>${log.pms_symptoms.length} PMS symptoms</span>`);

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

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  async function callAI(prompt, cfg) {
    const proxyUrl = cfg.API_PROXY_URL;
    if (!proxyUrl) throw new Error('API_PROXY_URL not configured');

    const res = await fetch(proxyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
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
        pattern_summary: "There isn't enough pattern data yet to make a confident interpretation, or an error occurred.",
        trend_interpretation: 'Please continue logging to build a clearer picture.',
        risk_level: 'green',
        risk_label: 'Stable',
        fertility_window: null,
        recommended_next_step: 'Continue logging daily for at least 2-3 cycles.',
        red_flags: [],
        clarifying_data_needed: 'More cycle data is needed for accurate pattern detection.',
        confidence: 10,
      };
    }
  }
});
