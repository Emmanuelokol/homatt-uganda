/**
 * Homatt Health - Dashboard Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Auth check via Supabase session
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = 'signin.html';
    return;
  }

  // Load user data — prefer Supabase, fall back to localStorage cache
  let user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (profile) {
    user = {
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone_number,
      dob: profile.dob,
      sex: profile.sex,
      district: profile.district,
      location: profile.district,
      city: profile.city,
      hasFamily: profile.has_family,
      familySize: profile.family_size,
      healthGoals: profile.health_goals,
    };
    localStorage.setItem('homatt_user', JSON.stringify(user));
  }

  // Update status bar time
  function updateTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const mins = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('statusTime').textContent = `${hours}:${mins}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // ====== Greeting ======
  function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning,';
    if (hour < 17) return 'Good afternoon,';
    return 'Good evening,';
  }

  document.querySelector('.dash-welcome').textContent = getGreeting();
  document.getElementById('userName').textContent = user.firstName || 'User';

  // User avatar initial — click navigates to profile
  const avatarEl = document.getElementById('userAvatar');
  if (user.firstName) {
    avatarEl.innerHTML = `<span>${user.firstName.charAt(0).toUpperCase()}</span>`;
  }
  avatarEl.addEventListener('click', () => { window.location.href = 'profile.html'; });

  // ====== Daily Health Tips ======
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
  tipText.textContent = tips[tipIndex];

  document.getElementById('nextTip').addEventListener('click', () => {
    tipIndex = (tipIndex + 1) % tips.length;
    tipText.style.opacity = '0';
    setTimeout(() => {
      tipText.textContent = tips[tipIndex];
      tipText.style.opacity = '1';
    }, 200);
  });

  // ====== Reminder Dismiss ======
  document.querySelectorAll('.reminder-dismiss').forEach(btn => {
    btn.addEventListener('click', () => {
      const item = btn.closest('.reminder-item');
      item.style.transform = 'translateX(100%)';
      item.style.opacity = '0';
      setTimeout(() => item.remove(), 300);
    });
  });

  // ====== Quiz Streak ======
  const streak = parseInt(localStorage.getItem('homatt_quiz_streak') || '0');
  document.getElementById('streakCount').textContent = streak;

  // ====== Malaria Alert Region ======
  const riskLevels = {
    kampala: 'medium', wakiso: 'medium', mukono: 'medium',
    jinja: 'high', mbarara: 'medium', gulu: 'high',
    lira: 'high', mbale: 'medium', masaka: 'medium',
    fort_portal: 'medium', soroti: 'high', arua: 'high',
    kabale: 'low', hoima: 'high', entebbe: 'medium',
  };

  const userRisk = riskLevels[user.district || user.location] || 'medium';
  const alertLevel = document.querySelector('.alert-level');
  alertLevel.textContent = userRisk.charAt(0).toUpperCase() + userRisk.slice(1) + ' Risk';
  alertLevel.className = 'alert-level ' + userRisk;

  const riskMessages = {
    low: 'Risk is low but stay protected at night',
    medium: 'Use mosquito nets and repellent',
    high: 'High risk! Use nets, repellent & avoid standing water',
  };
  document.querySelector('.alert-detail').textContent = riskMessages[userRisk];

  // ====== Feature Cards Navigation ======
  document.getElementById('symptomChecker').addEventListener('click', () => {
    window.location.href = 'symptom-checker.html';
  });

  document.getElementById('featureCycle').addEventListener('click', () => {
    window.location.href = 'cycle-tracker.html';
  });

  document.getElementById('featureMoodSleep').addEventListener('click', () => {
    window.location.href = 'mood-sleep-tracker.html';
  });

  document.getElementById('featurePain').addEventListener('click', () => {
    window.location.href = 'pain-tracker.html';
  });

  document.getElementById('featureDigestive').addEventListener('click', () => {
    window.location.href = 'digestive-tracker.html';
  });

  document.getElementById('dailyQuiz').querySelector('.quiz-start-btn').addEventListener('click', () => {
    // Phase 10: quiz — show coming soon toast
    const toast = document.createElement('div');
    toast.className = 'tracker-toast';
    toast.textContent = 'Daily health quiz launching soon!';
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('visible'), 10);
    setTimeout(() => { toast.classList.remove('visible'); setTimeout(() => toast.remove(), 400); }, 2800);
  });

  // ====== Health Score Calculation ======
  async function calculateHealthScore() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const uid = session.user.id;

    // Fetch tracker data in parallel
    const [moodRes, painRes, rxRes, dosesRes] = await Promise.all([
      supabase.from('mood_sleep_logs').select('sleep_hours,sleep_quality,mood,energy_level,anxiety_level')
        .eq('user_id', uid).gte('created_at', since),
      supabase.from('pain_logs').select('intensity')
        .eq('user_id', uid).gte('created_at', since),
      supabase.from('prescriptions').select('id,frequency,start_date,end_date')
        .eq('user_id', uid).eq('status', 'active'),
      supabase.from('prescription_doses').select('taken,taken_at')
        .eq('user_id', uid).gte('taken_at', since),
    ]);

    const moodLogs = moodRes.data || [];
    const painLogs = painRes.data || [];
    const prescriptions = rxRes.data || [];
    const doses = dosesRes.data || [];

    // 1. Sleep score (0–25): optimal ~7-8 hrs, quality 1-10
    let sleepScore = 12; // default
    if (moodLogs.length > 0) {
      const avgHours = moodLogs.reduce((s, l) => s + (parseFloat(l.sleep_hours) || 0), 0) / moodLogs.length;
      const avgQuality = moodLogs.reduce((s, l) => s + (l.sleep_quality || 5), 0) / moodLogs.length;
      const hoursScore = Math.max(0, 1 - Math.abs(avgHours - 7.5) / 7.5);
      sleepScore = Math.round((hoursScore * 0.6 + (avgQuality / 10) * 0.4) * 25);
    }

    // 2. Mood score (0–20): avg mood 1-10
    let moodScore = 10; // default
    if (moodLogs.length > 0) {
      const avgMood = moodLogs.reduce((s, l) => s + (l.mood || 5), 0) / moodLogs.length;
      const avgEnergy = moodLogs.reduce((s, l) => s + (l.energy_level || 5), 0) / moodLogs.length;
      const avgAnxiety = moodLogs.reduce((s, l) => s + (l.anxiety_level || 5), 0) / moodLogs.length;
      moodScore = Math.round(((avgMood / 10) * 0.5 + (avgEnergy / 10) * 0.3 + ((10 - avgAnxiety) / 10) * 0.2) * 20);
    }

    // 3. Pain score (0–20): lower pain = higher score
    let painScore = 14; // default (assume mild)
    if (painLogs.length > 0) {
      const avgPain = painLogs.reduce((s, l) => s + (l.intensity || 3), 0) / painLogs.length;
      painScore = Math.round((1 - avgPain / 10) * 20);
    }

    // 4. Medication adherence (0–20): doses taken / expected
    let adherenceScore = 10; // default
    if (prescriptions.length > 0 && doses.length > 0) {
      const freqMap = { once_daily: 1, twice_daily: 2, three_times: 3, four_times: 4, weekly: 0.14, as_needed: 0 };
      const expectedDoses = prescriptions.reduce((s, rx) => {
        const freq = freqMap[rx.frequency] || 1;
        return s + Math.min(30, freq * 30);
      }, 0);
      if (expectedDoses > 0) {
        const takenDoses = doses.filter(d => d.taken).length;
        adherenceScore = Math.min(20, Math.round((takenDoses / expectedDoses) * 20));
      }
    }

    // 5. Engagement score (0–15): number of logs in 30 days
    const totalLogs = moodLogs.length + painLogs.length;
    const engagementScore = Math.min(15, Math.round(totalLogs * 1.5));

    const total = sleepScore + moodScore + painScore + adherenceScore + engagementScore;
    const score = Math.max(0, Math.min(100, total));

    // Update UI
    const scoreEl = document.getElementById('healthScore');
    const ringEl = document.querySelector('.score-svg circle:last-child');
    const statusEl = document.querySelector('.health-score-status');
    const ringLabel = document.querySelector('.score-ring-label');

    if (scoreEl) scoreEl.textContent = score;
    if (ringLabel) ringLabel.textContent = score + '%';

    // Animate ring: circumference = 2*pi*34 ≈ 213.6
    if (ringEl) {
      const offset = 213.6 - (score / 100) * 213.6;
      ringEl.setAttribute('stroke-dashoffset', offset.toFixed(1));
    }

    let statusText = 'Keep tracking to improve!';
    if (score >= 85) statusText = 'Excellent — Outstanding health!';
    else if (score >= 70) statusText = 'Good — Keep it up!';
    else if (score >= 55) statusText = 'Fair — Room to improve';
    else if (score >= 40) statusText = 'Low — Focus on your health';
    if (statusEl) statusEl.innerHTML = `<span class="material-icons-outlined" style="font-size:14px">${score >= 55 ? 'trending_up' : 'trending_down'}</span> ${statusText}`;
  }

  // Run health score in background (non-blocking)
  calculateHealthScore().catch(() => {});

  // ====== Bottom Nav ======
  document.getElementById('navFamily').addEventListener('click', () => { window.location.href = 'family.html'; });
  document.getElementById('navShop').addEventListener('click', () => { window.location.href = 'family.html#shop'; });
  document.getElementById('navProfile').addEventListener('click', () => { window.location.href = 'profile.html'; });

  // Notification bell
  document.getElementById('notifBtn').addEventListener('click', () => {
    // Phase: notifications panel — coming soon
  });
});
