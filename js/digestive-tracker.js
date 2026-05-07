/**
 * Homatt Health — Digestive Tracker (Module 4)
 * Detects: IBS pattern, constipation/diarrhea risk, GERD pattern, food triggers, serious red flags
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

      // Blood in stool warning banner
      if (group === 'bloodStool') {
        const banner = document.getElementById('bloodWarnBanner');
        if (btn.dataset.val === 'yes') {
          banner.classList.remove('hidden');
        } else {
          banner.classList.add('hidden');
        }
      }
    });
  });

  // ---- Chip toggles ----
  document.querySelectorAll('.chip-toggle').forEach(chip => {
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
  });

  // ---- Counter: BM frequency ----
  let bmCount = 0;
  function updateBmDisplay() {
    document.getElementById('bmDisplay').textContent = bmCount;
  }
  document.getElementById('bmDec').addEventListener('click', () => {
    if (bmCount > 0) { bmCount--; updateBmDisplay(); }
  });
  document.getElementById('bmInc').addEventListener('click', () => {
    if (bmCount < 12) { bmCount++; updateBmDisplay(); }
  });

  // ---- Bristol Stool Scale ----
  let bristolSelected = null;
  document.querySelectorAll('.bristol-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.bristol-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      bristolSelected = parseInt(btn.dataset.val);
    });
  });

  // ---- Abdominal Pain Slider ----
  const abPainSlider = document.getElementById('abdominalPain');
  const abPainVal = document.getElementById('abdominalPainVal');
  abPainSlider.addEventListener('input', () => {
    abPainVal.textContent = abPainSlider.value;
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
  document.getElementById('saveDigestiveLog').addEventListener('click', async () => {
    const logData = {
      user_id: userId,
      log_date: today,
      bm_frequency: bmCount,
      bristol_scale: bristolSelected,
      abdominal_pain: parseInt(abPainSlider.value),
      bloating: getChoice('bloating'),
      has_reflux: getChoice('reflux') === 'yes',
      has_nausea: getChoice('nausea') === 'yes',
      blood_in_stool: getChoice('bloodStool') === 'yes',
      food_triggers: getChips('food'),
      notes: document.getElementById('digestiveNotes').value.trim() || null,
    };

    const btn = document.getElementById('saveDigestiveLog');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Saving...';

    const { error } = await supabase.from('digestive_logs').insert(logData);

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">save</span> Save Today\'s Log';

    if (error) {
      showToast('Error saving log. Please try again.');
      console.error(error);
    } else {
      // Blood in stool urgent escalation
      if (logData.blood_in_stool) {
        showToast('Blood in stool logged — please seek medical care promptly.');
      } else {
        showToast('Digestive log saved!');
      }
      resetForm();
    }
  });

  function resetForm() {
    bmCount = 0;
    updateBmDisplay();
    bristolSelected = null;
    document.querySelectorAll('.bristol-btn').forEach(b => b.classList.remove('selected'));
    abPainSlider.value = 0;
    abPainVal.textContent = 0;
    document.querySelectorAll('.choice-btn').forEach(b => b.classList.remove('selected'));
    // Re-select 'No' for bloodStool
    const noBtn = document.querySelector('.choice-btn[data-group="bloodStool"][data-val="no"]');
    if (noBtn) noBtn.classList.add('selected');
    document.querySelector('#bloodWarnBanner').classList.add('hidden');
    document.querySelectorAll('.chip-toggle').forEach(c => c.classList.remove('selected'));
    document.getElementById('digestiveNotes').value = '';
  }

  // ---- Pattern Analysis ----
  async function runAnalysis() {
    const patternCta = document.getElementById('patternCta');
    const aiLoading = document.getElementById('aiLoading');
    const patternResults = document.getElementById('patternResults');

    patternCta.style.display = 'none';
    aiLoading.classList.add('visible');
    patternResults.classList.remove('visible');

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: logs } = await Promise.race([
      supabase.from('digestive_logs').select('*').eq('user_id', userId).gte('log_date', thirtyDaysAgo.toISOString().split('T')[0]).order('log_date', { ascending: false }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]).catch(() => ({ data: null }));

    if (!logs || logs.length < 3) {
      aiLoading.classList.remove('visible');
      patternCta.style.display = 'block';
      showToast('Log at least 3 days to run digestive analysis.');
      return;
    }

    const prompt = buildDigestivePrompt(logs, { age: user.age, city: user.city });

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

  function buildDigestivePrompt(logs, userContext) {
    const avgBM = (logs.reduce((s, l) => s + (l.bm_frequency || 0), 0) / logs.length).toFixed(1);
    const avgPain = (logs.reduce((s, l) => s + (l.abdominal_pain || 0), 0) / logs.length).toFixed(1);
    const hasBlood = logs.some(l => l.blood_in_stool);

    const logSummary = logs.map(l => ({
      date: l.log_date,
      bm: l.bm_frequency,
      bristol: l.bristol_scale,
      abdominal_pain: l.abdominal_pain,
      bloating: l.bloating,
      reflux: l.has_reflux,
      nausea: l.has_nausea,
      blood: l.blood_in_stool,
      food_triggers: l.food_triggers,
    }));

    return `You are a preventive health pattern analyzer for Homatt Health, a mobile app in Uganda.

Analyze this digestive health log data to identify gut health patterns.

User: age=${userContext.age || 'unknown'}, location=${userContext.city || 'Uganda'}
Summary: avg ${avgBM} BMs/day, avg abdominal pain ${avgPain}/10, blood in stool: ${hasBlood ? 'YES (FLAGGED)' : 'No'}

Digestive logs (last 30 days, recent first):
${JSON.stringify(logSummary, null, 2)}

Analysis rules:
- NEVER diagnose. Use non-diagnostic language only ("pattern suggests", "may indicate", "worth discussing").
- IBS-like pattern: abdominal pain + alternating stool types (varies between constipation and diarrhea) + >3 months
- Constipation risk: Bristol 1-2 OR <3 BMs/week consistently
- Diarrhea risk: Bristol 6-7 + >3 days → mention dehydration risk, escalate if blood present
- GERD pattern: reflux after meals + recurring, especially at night
- Serious RED FLAGS requiring immediate escalation: blood in stool, black stool (type 7 + very dark would need note), persistent vomiting, severe abdominal pain (>8/10)
- Food trigger correlation: if same food triggers appear repeatedly, note them
- Risk: green=normal, yellow=minor recurring issues, orange=pattern worth evaluation, red=urgent medical attention

If blood_in_stool is TRUE in ANY recent log: set risk_level to "red" and red_flags MUST include "Blood detected in stool — seek medical evaluation promptly."

Respond ONLY with valid JSON:
{
  "pattern_summary": "2-3 sentence overview of digestive pattern",
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

    const { data: logs } = await Promise.race([
      supabase.from('digestive_logs').select('*').eq('user_id', userId).order('log_date', { ascending: false }).limit(20),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
    ]).catch(() => ({ data: null }));

    historyLoading.style.display = 'none';

    if (!logs || logs.length === 0) {
      historyEmpty.classList.remove('hidden');
      return;
    }

    const bristolLabels = { 1: 'Hard lumps', 2: 'Lumpy', 3: 'Cracked', 4: 'Normal', 5: 'Soft', 6: 'Mushy', 7: 'Liquid' };

    logs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = 'history-entry';
      const dateStr = new Date(log.log_date).toLocaleDateString('en-UG', { weekday: 'short', day: 'numeric', month: 'short' });
      const metrics = [];

      metrics.push(`<span class="history-metric"><span class="material-icons-outlined">av_timer</span>${log.bm_frequency} BM${log.bm_frequency !== 1 ? 's' : ''}</span>`);
      if (log.bristol_scale) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">format_list_numbered</span>Type ${log.bristol_scale}: ${bristolLabels[log.bristol_scale]}</span>`);
      if (log.abdominal_pain > 0) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">sick</span>Pain: ${log.abdominal_pain}/10</span>`);
      if (log.bloating && log.bloating !== 'none') metrics.push(`<span class="history-metric"><span class="material-icons-outlined">bubble_chart</span>${capitalize(log.bloating)} bloating</span>`);
      if (log.blood_in_stool) metrics.push(`<span class="history-metric" style="color:#D32F2F"><span class="material-icons-outlined">warning</span>Blood noted</span>`);
      if (log.has_reflux) metrics.push(`<span class="history-metric"><span class="material-icons-outlined">whatshot</span>Reflux</span>`);

      entry.innerHTML = `
        <div class="history-entry-date">${dateStr}</div>
        <div class="history-entry-metrics">${metrics.join('')}</div>
      `;
      historyList.appendChild(entry);
    });
  }

  // ---- Utilities ----
  function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('visible');
    setTimeout(() => toast.classList.remove('visible'), 3500);
  }

  function capitalize(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
  }

  async function callAI(prompt, cfg) {
    const proxyUrl = cfg.API_PROXY_URL;
    if (!proxyUrl) throw new Error('API_PROXY_URL not configured');
    const { data: { session } } = await supabase.auth.getSession();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ provider: 'groq', prompt }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`AI proxy error: ${res.status}`);
      const data = await res.json();
      return data.text || '';
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('Request timed out after 25s');
      throw err;
    }
  }

  function parseAIResponse(text) {
    try {
      const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return {
        pattern_summary: "There isn't enough pattern data yet to make a confident interpretation.",
        trend_interpretation: 'Continue logging daily to build your gut health picture.',
        risk_level: 'green',
        risk_label: 'Stable',
        recommended_next_step: 'Log daily for at least 7 days for meaningful pattern analysis.',
        red_flags: [],
        clarifying_data_needed: 'Note food triggers and Bristol scale type for better insights.',
        confidence: 10,
      };
    }
  }
});
