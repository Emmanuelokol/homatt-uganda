/**
 * Homatt Health - Dashboard Logic
 *
 * IMPORTANT: All event listeners are registered SYNCHRONOUSLY at the top
 * of DOMContentLoaded, before any `await`. This ensures the UI is always
 * interactive regardless of network speed or Supabase availability.
 */

// Hardcoded Supabase credentials — anon key is safe to expose
const _SB_URL  = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const _SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtna2RpeWt6bXFqb3Vnd3p6ZXdpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEyMzI1MTEsImV4cCI6MjA4NjgwODUxMX0.BhrLUC57jA-xsoFiTKqk_qKVsHsb71YGSEnvjzyQ0e8';

document.addEventListener('DOMContentLoaded', () => {

  // ═══════════════════════════════════════════════════════════
  //  PART 1 — SYNCHRONOUS SETUP (runs instantly, no network)
  // ═══════════════════════════════════════════════════════════

  // Ensure shop screen is hidden until explicitly switched to
  const shopScreenEl   = document.getElementById('shopScreen');
  const homeScreenEl   = document.getElementById('homeScreen');
  if (shopScreenEl)  shopScreenEl.style.display  = 'none';
  if (homeScreenEl)  homeScreenEl.style.display  = '';   // let CSS flex:1 apply

  // Update status bar time
  function updateTime() {
    const now   = new Date();
    const h     = String(now.getHours()).padStart(2, '0');
    const m     = String(now.getMinutes()).padStart(2, '0');
    const el    = document.getElementById('statusTime');
    if (el) el.textContent = `${h}:${m}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // Greeting text (doesn't need auth)
  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning,';
    if (hour < 17) return 'Good afternoon,';
    return 'Good evening,';
  }
  const welcomeEl = document.querySelector('.dash-welcome');
  if (welcomeEl) welcomeEl.textContent = getGreeting();

  // Show cached user data immediately (no waiting for network)
  const cachedUser = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  const userNameEl = document.getElementById('userName');
  const avatarEl   = document.getElementById('userAvatar');
  if (userNameEl) userNameEl.textContent = cachedUser.firstName || 'User';
  if (avatarEl && cachedUser.firstName) {
    avatarEl.innerHTML = `<span>${cachedUser.firstName.charAt(0).toUpperCase()}</span>`;
  }

  // Wallet balances from cache
  const wallets = JSON.parse(localStorage.getItem('homatt_wallets') || '{"family":0,"care":0}');
  const famBal = document.getElementById('familyBalance');
  const carBal = document.getElementById('careBalance');
  if (famBal) famBal.textContent = wallets.family.toLocaleString();
  if (carBal) carBal.textContent = wallets.care.toLocaleString();

  // Quiz streak from cache
  const streak    = parseInt(localStorage.getItem('homatt_quiz_streak') || '0');
  const streakEl  = document.getElementById('streakCount');
  if (streakEl) streakEl.textContent = streak;

  // ── Bottom Tab Navigation (4 tabs: Home, Family, Shop, Profile) ─────
  function switchTab(screenId, navId) {
    // Explicit style toggle — works even if CSS hasn't loaded
    if (homeScreenEl) homeScreenEl.style.display = 'none';
    if (shopScreenEl) shopScreenEl.style.display = 'none';

    const target = document.getElementById(screenId);
    if (target) {
      target.style.display = screenId === 'shopScreen' ? 'flex' : '';
      document.querySelectorAll('.app-screen, .shop-screen').forEach(s => s.classList.remove('active'));
      target.classList.add('active');
    }
    document.querySelectorAll('.bottom-nav .nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById(navId)?.classList.add('active');
  }

  document.getElementById('navHome')?.addEventListener('click',   () => switchTab('homeScreen', 'navHome'));
  document.getElementById('navFamily')?.addEventListener('click', () => switchTab('homeScreen', 'navHome')); // placeholder
  document.getElementById('navShop')?.addEventListener('click',   () => switchTab('shopScreen', 'navShop'));
  document.getElementById('navProfile')?.addEventListener('click',() => switchTab('homeScreen', 'navHome')); // placeholder

  // ── Daily Tips ────────────────────────────────────────────
  const tips = [
    'Drink at least 8 glasses of water daily. Staying hydrated helps your body fight infections and keeps your energy levels up.',
    'Wash your hands with soap for at least 20 seconds before eating and after using the toilet to prevent disease.',
    'Sleep 7-8 hours each night. Good rest strengthens your immune system and improves your mood.',
    'Eat at least 5 servings of fruits and vegetables daily for essential vitamins and minerals.',
    'Take a 30-minute walk every day. Regular exercise reduces the risk of heart disease and diabetes.',
    'Use a mosquito net every night, especially during rainy season, to protect against malaria.',
    'Limit sugar intake. Too much sugar increases the risk of diabetes and tooth decay.',
    'Check your blood pressure regularly, even if you feel fine. Hypertension often has no symptoms.',
    'Breastfeed exclusively for the first 6 months. Breast milk provides all the nutrients a baby needs.',
    'Visit a health facility at least once a year for a general check-up, even when you feel healthy.',
    'Apply sunscreen or cover up when in the sun for extended periods to protect your skin.',
    'Reduce salt in your food. High sodium intake can lead to high blood pressure.',
    'Practice deep breathing for 5 minutes daily to reduce stress and improve mental health.',
    'Keep your home clean and free of standing water to prevent mosquito breeding.',
  ];
  let tipIndex = Math.floor(Math.random() * tips.length);
  const tipText = document.getElementById('tipText');
  if (tipText) tipText.textContent = tips[tipIndex];
  document.getElementById('nextTip')?.addEventListener('click', () => {
    if (!tipText) return;
    tipIndex = (tipIndex + 1) % tips.length;
    tipText.style.opacity = '0';
    setTimeout(() => { tipText.textContent = tips[tipIndex]; tipText.style.opacity = '1'; }, 200);
  });

  // ── Reminder Dismiss ──────────────────────────────────────
  document.querySelectorAll('.reminder-dismiss').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.reminder-item');
      if (!item) return;
      item.style.transform  = 'translateX(100%)';
      item.style.opacity    = '0';
      item.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      setTimeout(() => item.remove(), 300);
    });
  });

  // ── Symptom Checker ───────────────────────────────────────
  document.getElementById('symptomChecker')?.addEventListener('click', () => {
    window.location.href = 'symptom-checker.html';
  });

  // ── Malaria Alert deep-links to shop malaria tab ──────────
  document.getElementById('malariaAlert')?.addEventListener('click', () => {
    switchTab('shopScreen', 'navShop');
    document.querySelectorAll('#shopScreen .cat-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.cat === 'malaria');
    });
  });

  // ── Quiz (placeholder) ────────────────────────────────────
  document.querySelector('.quiz-start-btn')?.addEventListener('click', () => {
    // Phase 10: quiz navigation
  });

  // ── Rate Us ───────────────────────────────────────────────
  document.getElementById('featureRateUs')?.addEventListener('click', () => {
    // Simple in-app rating prompt
    const rating = window.confirm('Enjoying Homatt Health?\n\nTap OK to rate us 5 stars — it really helps!');
    if (rating) {
      // Could open Play Store link here
      alert('Thank you so much! Your support means the world to us.');
    }
  });

  // ── Health Insights (Active Monitoring) ──────────────────
  renderHealthInsights();


  // ═══════════════════════════════════════════════════════════
  //  PART 2 — ASYNC SETUP (network-dependent, non-blocking)
  // ═══════════════════════════════════════════════════════════

  loadAuthAndData();
});


// ─── Health Insights ────────────────────────────────────────────────────────

function renderHealthInsights() {
  const container = document.getElementById('healthInsightsContainer');
  if (!container) return;

  const diagnosis = JSON.parse(localStorage.getItem('homatt_active_diagnosis') || 'null');

  if (!diagnosis || !diagnosis.condition) {
    container.innerHTML = `
      <div class="insight-empty">
        <span class="material-icons-outlined">check_circle</span>
        <p>No active monitoring. Use "Check My Health" to get started.</p>
      </div>`;
    return;
  }

  // Check if user already checked in today
  const checkins = JSON.parse(localStorage.getItem('homatt_checkins') || '[]');
  const today    = new Date().toDateString();
  const todayCheckin = checkins.find(c => new Date(c.timestamp).toDateString() === today);

  const buttonsOrResult = todayCheckin
    ? `<div class="checkin-confirmed">✓ Today's check-in: <strong>${todayCheckin.status.charAt(0).toUpperCase() + todayCheckin.status.slice(1)}</strong> — ${checkinMessage(todayCheckin.status)}</div>`
    : `<div class="checkin-buttons">
        <button class="checkin-btn better" data-status="better">
          <span class="material-icons-outlined">sentiment_satisfied</span>Better
        </button>
        <button class="checkin-btn same" data-status="same">
          <span class="material-icons-outlined">sentiment_neutral</span>Same
        </button>
        <button class="checkin-btn worse" data-status="worse">
          <span class="material-icons-outlined">sentiment_very_dissatisfied</span>Worse
        </button>
      </div>`;

  container.innerHTML = `
    <div class="monitoring-card">
      <div class="monitoring-card-header">
        <div class="monitoring-icon">
          <span class="material-icons-outlined">monitor_heart</span>
        </div>
        <div class="monitoring-title">Active Monitoring: ${escHtml(diagnosis.condition)}</div>
      </div>
      <p class="monitoring-why"><strong>Why:</strong> You reported ${escHtml(diagnosis.condition)} and are being monitored every hour.</p>
      <p class="monitoring-risk"><strong>Risk:</strong> Unresolved symptoms can worsen if left unmanaged.</p>
      <div class="monitoring-checkin">
        <span class="material-icons-outlined">female</span>
        How are you feeling right now? Tap a button below to log your check-in.
      </div>
      ${buttonsOrResult}
    </div>`;

  container.querySelectorAll('.checkin-btn').forEach(btn => {
    btn.addEventListener('click', () => handleCheckin(btn.dataset.status, diagnosis));
  });
}

function checkinMessage(status) {
  return {
    better: 'Keep resting and stay hydrated.',
    same:   'Continue your treatment and rest.',
    worse:  'Consider visiting a health facility.',
  }[status] || '';
}

function handleCheckin(status, diagnosis) {
  const checkin = {
    condition: diagnosis.condition,
    status,
    timestamp: new Date().toISOString(),
  };
  const checkins = JSON.parse(localStorage.getItem('homatt_checkins') || '[]');
  checkins.unshift(checkin);
  localStorage.setItem('homatt_checkins', JSON.stringify(checkins.slice(0, 50)));

  // Re-render to show confirmed state
  renderHealthInsights();

  // Nudge toward shop for malaria products if feeling worse
  if (status === 'worse') {
    setTimeout(() => {
      document.getElementById('malariaAlert')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 800);
  }
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─── Async auth + data load ──────────────────────────────────────────────────

async function loadAuthAndData() {
  const cfg    = window.HOMATT_CONFIG || {};
  const sbUrl  = cfg.SUPABASE_URL  || _SB_URL;
  const sbAnon = cfg.SUPABASE_ANON_KEY || _SB_ANON;

  let supabase;
  try {
    supabase = window.supabase.createClient(sbUrl, sbAnon);
  } catch (e) {
    console.error('[Homatt] Supabase init failed:', e);
    window.location.href = 'signin.html';
    return;
  }

  // Auth check — getSession() reads localStorage first, very fast normally
  let session = null;
  try {
    const { data } = await supabase.auth.getSession();
    session = data?.session;
  } catch (e) {
    console.error('[Homatt] Auth check failed:', e);
  }

  if (!session) {
    window.location.href = 'signin.html';
    return;
  }

  // Init Preventive Shop (async, non-blocking)
  if (window.initShop) window.initShop(supabase, session);

  // Load fresh user profile from Supabase (updates cached data)
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (profile) {
      const user = {
        firstName: profile.first_name,
        lastName:  profile.last_name,
        phone:     profile.phone_number,
        dob:       profile.dob,
        sex:       profile.sex,
        district:  profile.district,
        location:  profile.district,
        city:      profile.city,
        hasFamily: profile.has_family,
        familySize:profile.family_size,
        healthGoals: profile.health_goals,
      };
      localStorage.setItem('homatt_user', JSON.stringify(user));

      // Update UI with fresh data
      const userNameEl = document.getElementById('userName');
      const avatarEl   = document.getElementById('userAvatar');
      if (userNameEl) userNameEl.textContent = profile.first_name || 'User';
      if (avatarEl && profile.first_name) {
        avatarEl.innerHTML = `<span>${profile.first_name.charAt(0).toUpperCase()}</span>`;
      }

      // Update malaria risk based on user's district
      updateMalariaRisk(profile.district || profile.city || '');
    }
  } catch (e) {
    console.warn('[Homatt] Profile load failed (using cache):', e);
    // Already showing cached data from Part 1 — graceful degradation
    const cached = JSON.parse(localStorage.getItem('homatt_user') || '{}');
    updateMalariaRisk(cached.district || cached.location || '');
  }
}


function updateMalariaRisk(location) {
  const riskLevels = {
    kampala: 'medium', wakiso: 'medium', mukono: 'medium',
    jinja: 'high', mbarara: 'medium', gulu: 'high',
    lira: 'high', mbale: 'medium', masaka: 'medium',
    fort_portal: 'medium', soroti: 'high', arua: 'high',
    kabale: 'low', hoima: 'high', entebbe: 'medium',
  };
  const userRisk    = riskLevels[(location || '').toLowerCase().replace(' ', '_')] || 'medium';
  const alertLevel  = document.querySelector('.alert-level');
  const alertDetail = document.querySelector('.alert-detail');
  if (alertLevel) {
    alertLevel.textContent = userRisk.charAt(0).toUpperCase() + userRisk.slice(1) + ' Risk';
    alertLevel.className   = 'alert-level ' + userRisk;
  }
  const riskMessages = {
    low:    'Risk is low but stay protected at night',
    medium: 'Use mosquito nets and repellent',
    high:   'High risk! Use nets, repellent & avoid standing water',
  };
  if (alertDetail) alertDetail.textContent = riskMessages[userRisk];
}
