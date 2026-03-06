/**
 * Homatt Health — Pain Pattern Tracker (Module 3)
 * Detects: chronic pain, migraine pattern, inflammatory signals, neuropathic pattern, red flags
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

  // ---- Tabs ----
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

  // ---- Choice buttons ----
  document.querySelectorAll('.choice-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = btn.dataset.group;
      document.querySelectorAll(`.choice-btn[data-group="${group}"]`)
        .forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });

  // ---- Chip toggles ----
  document.querySelectorAll('.chip-toggle').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });

  // ---- Slider ----
  const intensitySlider = document.getElementById('painIntensity');
  const intensityVal = document.getElementById('painIntensityVal');
  intensitySlider.addEventListener('input', () => {
    const v = parseInt(intensitySlider.value);
    intensityVal.textContent = v;
    // Color shift based on intensity
    if (v <= 3) { intensityVal.style.background = '#E8F5E9'; intensityVal.style.color = '#2E7D32'; intensityVal.style.borderColor = '#A5D6A7'; }
    else if (v <= 6) { intensityVal.style.background = '#FFF3E0'; intensityVal.style.color = '#E65100'; intensityVal.style.borderColor = '#FFCC80'; }
    else { intensityVal.style.background = '#FFEBEE'; intensityVal.style.color = '#D32F2F'; intensityVal.style.borderColor = '#FFCDD2'; }
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

  // ---- Save Log ----
  document.getElementById('savePainLog').addEventListener('click', async () => {
    const locations = getChips('location');
    if (locations.length === 0) { showToast('Please select at least one pain location'); return; }

    const logData = {
      user_id: userId,
      log_date: today,
      pain_locations: locations,
      intensity: parseInt(intensitySlider.value),
      pain_type: getChoice('painType'),
      duration_hours: parseFloat(document.getElementById('painDuration').value) || null,
      time_of_day: getChoice('timeOfDay'),
      trigger: document.getElementById('painTrigger').value.trim() || null,
      relief_methods: getChips('relief'),
      associated_symptoms: getChips('associated'),
      notes: document.getElementById('painNotes').value.trim() || null,
    };

    const btn = document.getElementById('savePainLog');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Saving...';

    const { error } = await supabase.from('pain_logs').insert(logData);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">save</span> Save Pain Log';

    if (error) {
      showToast('Error saving log. Please try again.');
      console.error(error);
    } else {
      showToast('Pain log saved!');
      resetForm();
    }
  });

  function resetForm() {
    document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
    document.querySelectorAll('.chip-toggle').forEach(c => c.classList.remove('selected'));
    intensitySlider.value = 1;
    intensityVal.textContent = 1;
    intensityVal.style.background = '#FFEBEE';
    intensityVal.style.color = '#D32F2F';
    document.getElementById('painDuration').value = '';
    document.getElementById('painTrigger').value = '';
    document.getElementById('painNotes').value = '';
  }

  // ---- Pattern Analysis ----
  async function runAnalysis() {
    const patternCta = document.getElementById('patternCta');
    const aiLoading = document.getElementById('aiLoading');
    const patternResults = document.getElementById('patternResults');

    patternCta.style.display = 'none';
    aiLoading.classList.add('visible');
    patternResults.classList.remove('visible');

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: logs } = await supabase
      .from('pain_logs')
      .select('*')
      .eq('user_id', userId)
      .gte('log_date', ninetyDaysAgo.toISOString().split('T')[0])
      .order('log_date', { ascending: false });

    if (!logs || logs.length === 0) {
      aiLoading.classList.remove('visible');
      patternCta.style.display = 'block';
      showToast('No pain logs found. Start logging first.');
      return;
    }

    const prompt = buildPainPrompt(logs, { age: user.age, city: user.city });

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

  document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);
  document.getElementById('reAnalyzeBtn').addEventListener('click', runAnalysis);

  function buildPainPrompt(logs, userContext) {
    const totalDays = Math.ceil((new Date() - new Date(logs[logs.length - 1].log_date)) / 86400000) + 1;
    const daysWithPain = logs.filter(l => l.intensity >= 1).length;
    const avgIntensity = (logs.reduce((s, l) => s + (l.intensity || 0), 0) / logs.length).toFixed(1);

    const logSummary = logs.map(l => ({
      date: l.log_date,
      locations: l.pain_locations,
      intensity: l.intensity,
      type: l.pain_type,
      duration_h: l.duration_hours,
      time: l.time_of_day,
      trigger: l.trigger,
      associated: l.associated_symptoms,
    }));

    return `You are a preventive health pattern analyzer for Homatt Health, a mobile app in Uganda.

Analyze this pain log data to identify patterns, classify pain type, and detect clinical risks.

User: age=${userContext.age || 'unknown'}, location=${userContext.city || 'Uganda'}
Summary: ${daysWithPain} pain days out of ${totalDays} tracked days, avg intensity ${avgIntensity}/10

Pain logs (last 90 days, recent first):
${JSON.stringify(logSummary, null, 2)}

Analysis rules:
- NEVER diagnose. Use non-diagnostic language only.
- Classify duration: acute (<1 month), subacute (1-3 months), chronic (>3 months or >3 days/week)
- Migraine pattern: unilateral head pain + throbbing + nausea/light sensitivity/sound sensitivity, 4-72hr duration
- Inflammatory pattern: morning joint pain + stiffness recurring (suggest evaluation)
- Neuropathic pattern: burning + tingling + numbness recurring
- Red flag escalation needed if: sudden severe headache (worst ever), chest pain, neurological deficits (weakness/numbness), pain + fever, trauma-related pain
- Menstrual-related pain if pelvis/abdomen pain correlates with female cycle patterns
- Risk: green=occasional mild pain, yellow=recurring pain worth monitoring, orange=pain affecting daily life, red=urgent red flags present

Respond ONLY with valid JSON:
{
  "pattern_summary": "2-3 sentence overview of pain pattern",
  "trend_interpretation": "Trend analysis with cautious language",
  "risk_level": "green|yellow|orange|red",
  "risk_label": "Stable|Monitor|Evaluation Recommended|Urgent",
  "recommended_next_step": "Specific actionable advice",
  "red_flags": ["flag1", "flag2"],
  "clarifying_data_needed": "What data would improve analysis, or null",
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
      .from('pain_logs')
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

      if (log.pain_locations && log.pain_locations.length > 0) {
        metrics.push(`<span class="history-metric"><span class="material-icons-outlined">location_on</span>${log.pain_locations[0]}${log.pain_locations.length > 1 ? ` +${log.pain_locations.length - 1}` : ''}</span>`);
      }
      if (log.intensity != null) {
        const color = log.intensity <= 3 ? '#2E7D32' : log.intensity <= 6 ? '#E65100' : '#D32F2F';
        metrics.push(`<span class="history-metric" style="color:${color}"><span class="material-icons-outlined">speed</span>Intensity: ${log.intensity}/10</span>`);
      }
      if (log.pain_type) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">category</span>${capitalize(log.pain_type)}</span>`);
      if (log.duration_hours) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">schedule</span>${log.duration_hours}h</span>`);

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
    return str ? str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, ' ') : '';
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
        trend_interpretation: 'Continue logging pain episodes to identify patterns.',
        risk_level: 'green',
        risk_label: 'Stable',
        recommended_next_step: 'Log each pain episode to build your pattern history.',
        red_flags: [],
        clarifying_data_needed: 'Log duration, type, and associated symptoms for better analysis.',
        confidence: 10,
      };
    }
  }
});
