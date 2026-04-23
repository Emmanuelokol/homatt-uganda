/**
 * Homatt Health — Chronic Condition Pathways
 *
 * Enrol / unenrol users into condition-specific pathways and auto-schedule:
 *   - refill reminders (based on refill_interval_days)
 *   - periodic check-in prompts with Better/Same/Worse action buttons
 *     (based on checkin_frequency)
 *
 * Reads the catalogue from condition_catalog and persists enrolments to
 * patient_conditions (see supabase/migrations/20260424_chronic_condition_pathways.sql).
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  let supabase = null;
  let session = null;
  try {
    if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) {
      supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
      const { data } = await supabase.auth.getSession();
      session = data?.session || null;
    }
  } catch(e) {}
  if (!session) { window.location.href = 'signin.html'; return; }

  // Status bar clock
  (function tick() {
    const n = new Date();
    const el = document.getElementById('statusTime');
    if (el) el.textContent = n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
    setTimeout(tick, 30000);
  })();

  // ── Fallback catalogue (used when DB is unreachable) ──
  const FALLBACK_CATALOG = [
    { key:'diabetes',      label:'Diabetes (Type 2)',    icon:'bloodtype',         color:'#C62828', default_refill_days:30, education_tips:[
      'Check your blood sugar every morning before breakfast',
      'Walk for 30 minutes a day — it lowers your sugar',
      'Avoid sugary drinks like soda and juice',
      'Eat more vegetables and whole grains',
      'If you feel dizzy, shaky or sweaty, eat something sweet immediately'
    ]},
    { key:'hypertension',  label:'High Blood Pressure',  icon:'favorite',          color:'#D32F2F', default_refill_days:30, education_tips:[
      'Reduce salt in your food — use herbs and lemon instead',
      'Take your medication at the same time every day',
      'Limit alcohol to one drink a day',
      'Manage stress with prayer, meditation or a walk',
      'Check your blood pressure once a week at a clinic'
    ]},
    { key:'asthma',        label:'Asthma',               icon:'air',               color:'#1976D2', default_refill_days:30, education_tips:[
      'Always carry your inhaler',
      'Avoid smoke, dust and strong perfumes',
      'Warm up before exercise',
      'If breathing gets hard, use your blue inhaler and rest',
      'Go to a clinic immediately if your lips turn blue'
    ]},
    { key:'heart_disease', label:'Heart Disease',        icon:'monitor_heart',     color:'#B71C1C', default_refill_days:30, education_tips:[
      'Take heart medication exactly as prescribed — never skip',
      'Eat less red meat, more fish and vegetables',
      'Do not lift heavy loads',
      'Stop smoking',
      'Go to the clinic if you feel chest pain, short breath, or fainting'
    ]},
    { key:'hiv',           label:'HIV',                  icon:'health_and_safety', color:'#6A1B9A', default_refill_days:30, education_tips:[
      'Take your ARVs at the same time every day — never miss',
      'Keep all clinic appointments for viral load checks',
      'Eat a balanced diet to stay strong',
      'Use condoms to protect yourself and your partner',
      'Join a support group — you are not alone'
    ]},
    { key:'tb',            label:'Tuberculosis (TB)',    icon:'masks',             color:'#E65100', default_refill_days:30, education_tips:[
      'Finish the FULL course of TB medication — even if you feel better',
      'Cover your mouth when coughing',
      'Sleep alone for the first 2 weeks of treatment',
      'Eat high-protein foods — eggs, beans, fish',
      'Return to the clinic every month for monitoring'
    ]},
    { key:'depression',    label:'Depression / Anxiety', icon:'psychology',        color:'#5E35B1', default_refill_days:30, education_tips:[
      'You are not alone — talk to someone you trust',
      'Take your medication every day, even when you feel good',
      'Go outside for 15 minutes of sunlight daily',
      'Keep a simple daily routine',
      'Call the Homatt support line if you feel hopeless'
    ]},
    { key:'other',         label:'Other Chronic Condition', icon:'medical_services', color:'#37474F', default_refill_days:30, education_tips:[
      'Take medication exactly as prescribed',
      'Keep a health diary',
      'Attend all clinic follow-ups',
      'Eat well and stay hydrated',
      'Call us if something feels wrong'
    ]},
  ];

  // ── State ──
  let CATALOG = FALLBACK_CATALOG;
  let active = [];
  let selectedKey = null;
  let selectedCatalogItem = null;

  // ── Toast ──
  const toastEl = document.getElementById('ccToast');
  const showToast = (msg) => {
    if (!toastEl) return alert(msg);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => toastEl.classList.remove('show'), 2500);
  };

  // ── Load catalogue ──
  try {
    const { data: cat } = await supabase.from('condition_catalog').select('*').order('label');
    if (cat && cat.length) CATALOG = cat;
  } catch(e) { /* fall back */ }

  // ── Load active enrolments ──
  async function reloadActive() {
    try {
      const { data } = await supabase
        .from('patient_conditions')
        .select('*')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('enrolled_at', { ascending: false });
      active = data || [];
    } catch(e) { active = []; }
    renderActive();
    renderCatalog();
  }

  function renderActive() {
    const list  = document.getElementById('activeList');
    const empty = document.getElementById('activeEmpty');
    if (!list) return;
    if (!active.length) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-UG', { day:'numeric', month:'short', year:'numeric' }) : '—';
    list.innerHTML = active.map(c => {
      const meta = CATALOG.find(k => k.key === c.condition) || { icon:'medical_services', color:'#37474F', label: c.condition };
      const due = c.next_refill_at ? `Next refill: ${fmt(c.next_refill_at)}` : 'Refill pending';
      return `
        <div class="cc-card" onclick="window.__ccOpenDetail('${c.id}')">
          <div class="cc-card-icon" style="background:${meta.color}15">
            <span class="material-icons-outlined" style="color:${meta.color}">${meta.icon}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div class="cc-card-title">${meta.label} <span class="cc-chip">${c.checkin_frequency || 'weekly'} check-ins</span></div>
            <div class="cc-card-desc">${c.medication_name ? c.medication_name + ' — ' : ''}${due}</div>
          </div>
          <span class="material-icons-outlined" style="color:var(--text-hint);flex-shrink:0">chevron_right</span>
        </div>`;
    }).join('');
  }

  function renderCatalog() {
    const list = document.getElementById('catalogList');
    if (!list) return;
    const enrolledKeys = new Set(active.map(a => a.condition));
    list.innerHTML = CATALOG.map(item => {
      const already = enrolledKeys.has(item.key);
      return `
        <div class="cc-card" onclick="window.__ccOpenEnroll('${item.key}')" style="${already ? 'opacity:.55;pointer-events:none' : ''}">
          <div class="cc-card-icon" style="background:${item.color}15">
            <span class="material-icons-outlined" style="color:${item.color}">${item.icon}</span>
          </div>
          <div style="flex:1;min-width:0">
            <div class="cc-card-title">${item.label}${already ? ' <span class="cc-chip">Enrolled</span>' : ''}</div>
            <div class="cc-card-desc">Refills every ${item.default_refill_days} days · weekly feeling check-ins · tips</div>
          </div>
          <span class="material-icons-outlined" style="color:var(--text-hint);flex-shrink:0">${already ? 'check' : 'add_circle_outline'}</span>
        </div>`;
    }).join('');
  }

  // ── Enroll modal ──
  window.__ccOpenEnroll = (key) => {
    const item = CATALOG.find(k => k.key === key);
    if (!item) return;
    selectedKey = key;
    selectedCatalogItem = item;
    document.getElementById('enrollLabel').textContent = 'Enroll in ' + item.label;
    document.getElementById('enrollIcon').textContent  = item.icon;
    document.getElementById('refillDays').value = String(item.default_refill_days || 30);
    document.getElementById('checkinFreq').value = 'weekly';
    document.getElementById('medName').value = '';
    document.getElementById('enrollModal').classList.add('open');
  };
  window.closeEnrollModal = () => { document.getElementById('enrollModal').classList.remove('open'); };

  document.getElementById('enrollBtn').addEventListener('click', async () => {
    if (!selectedKey || !selectedCatalogItem) return;
    const btn = document.getElementById('enrollBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 1s linear infinite">refresh</span> Enrolling...';

    const medName     = document.getElementById('medName').value.trim();
    const refillDays  = parseInt(document.getElementById('refillDays').value, 10) || 30;
    const checkinFreq = document.getElementById('checkinFreq').value;
    const nextRefill  = new Date(); nextRefill.setDate(nextRefill.getDate() + refillDays);

    try {
      const { data: row, error } = await supabase.from('patient_conditions').insert({
        user_id:              session.user.id,
        condition:            selectedKey,
        condition_label:      selectedCatalogItem.label,
        medication_name:      medName || null,
        refill_interval_days: refillDays,
        next_refill_at:       nextRefill.toISOString(),
        checkin_frequency:    checkinFreq,
        status:               'active',
      }).select('id').maybeSingle();
      if (error) throw error;

      // Fire-and-forget: schedule refill + first check-in notifications
      await scheduleFollowups({
        conditionId:  row?.id,
        label:        selectedCatalogItem.label,
        medName,
        refillDays,
        checkinFreq,
        tips:         selectedCatalogItem.education_tips || [],
      });

      showToast('Enrolled! We will remind you about refills and check-ins.');
      window.closeEnrollModal();
      await reloadActive();
    } catch(e) {
      console.error('[Chronic] enroll failed:', e);
      showToast('Could not enroll. Please try again.');
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<span class="material-icons-outlined">check_circle</span> Enroll Me';
    }
  });

  // ── Detail / unenroll modal ──
  window.__ccOpenDetail = (id) => {
    const c = active.find(a => a.id === id);
    if (!c) return;
    const meta = CATALOG.find(k => k.key === c.condition) || { icon:'medical_services', color:'#37474F', label:c.condition, education_tips:[] };
    const tips = Array.isArray(meta.education_tips) ? meta.education_tips : [];
    document.getElementById('detailTitle').innerHTML = `<span class="material-icons-outlined" style="color:${meta.color}">${meta.icon}</span> ${meta.label}`;
    const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-UG', { day:'numeric', month:'short', year:'numeric' }) : '—';
    document.getElementById('detailMeta').innerHTML = `
      <strong>Medication:</strong> ${c.medication_name || '—'}<br>
      <strong>Refill every:</strong> ${c.refill_interval_days} days<br>
      <strong>Next refill:</strong> ${fmt(c.next_refill_at)}<br>
      <strong>Check-ins:</strong> ${c.checkin_frequency}`;
    document.getElementById('detailTips').innerHTML = tips.length
      ? tips.map(t => `<div class="cc-tip">${t}</div>`).join('')
      : '<div class="cc-empty">No tips available yet.</div>';
    document.getElementById('unenrollBtn').onclick = async () => {
      if (!confirm('Are you sure you want to unenroll from ' + meta.label + '?')) return;
      try {
        await supabase.from('patient_conditions').update({ status:'paused', updated_at:new Date().toISOString() }).eq('id', c.id);
        showToast('Unenrolled from ' + meta.label);
        window.closeDetailModal();
        await reloadActive();
      } catch(e) { showToast('Failed to unenroll'); }
    };
    document.getElementById('detailModal').classList.add('open');
  };
  window.closeDetailModal = () => { document.getElementById('detailModal').classList.remove('open'); };

  // ── Schedule auto-notifications for refills + check-ins + tips ──
  async function scheduleFollowups({ conditionId, label, medName, refillDays, checkinFreq, tips }) {
    const now = new Date();
    const invoke = (body) => supabase.functions.invoke('send-notification', { body }).catch(() => {});

    // 1) Refill reminder — 2 days before the refill date at 09:00
    const refillAt = new Date(now);
    refillAt.setDate(refillAt.getDate() + refillDays - 2);
    refillAt.setHours(9, 0, 0, 0);
    if (refillAt > now) {
      invoke({
        userId:        session.user.id,
        title:         `Refill your ${medName || label} medication`,
        message:       `Your ${medName || label} medication is almost done. Refill in 2 days to avoid missing a dose.`,
        data:          { screen: 'orders', id: conditionId, pathway:'refill' },
        pref_category: 'medicine_reminders',
        send_after:    refillAt.toISOString(),
      });
    }

    // 2) Recurring check-ins with feeling buttons (first 8 occurrences)
    const freqDays = { daily:1, weekly:7, biweekly:14, monthly:30 }[checkinFreq] || 7;
    for (let i = 1; i <= 8; i++) {
      const at = new Date(now);
      at.setDate(at.getDate() + i * freqDays);
      at.setHours(10, 0, 0, 0);
      invoke({
        userId:        session.user.id,
        title:         `How is your ${label}?`,
        message:       `Quick check-in: how are you feeling with your ${label} today?`,
        data:          { screen:'prescription-checkin', id:conditionId, checkin_type:'chronic_checkin', drug: medName || label },
        pref_category: 'medicine_reminders',
        send_after:    at.toISOString(),
        buttons: [
          { id: 'feeling_better', text: 'Feeling Better ✓' },
          { id: 'feeling_same',   text: 'About the Same' },
          { id: 'feeling_worse',  text: 'Feeling Worse ✗' },
        ],
      });
    }

    // 3) Education tips — one tip per week for 4 weeks
    (tips || []).slice(0, 4).forEach((tip, i) => {
      const at = new Date(now);
      at.setDate(at.getDate() + (i + 1) * 7);
      at.setHours(14, 0, 0, 0);
      invoke({
        userId:        session.user.id,
        title:         `${label} tip`,
        message:       tip,
        data:          { screen:'dashboard', pathway:'education' },
        pref_category: 'medicine_reminders',
        send_after:    at.toISOString(),
      });
    });
  }

  // Initial load
  await reloadActive();

  // Pre-open detail modal if ?id= param present
  const qid = new URLSearchParams(window.location.search).get('id');
  if (qid) {
    // small delay to let renderActive run
    setTimeout(() => { if (active.find(a => a.id === qid)) window.__ccOpenDetail(qid); }, 150);
  }
});
