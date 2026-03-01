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

  // User avatar initial
  const avatarEl = document.getElementById('userAvatar');
  if (user.firstName) {
    avatarEl.innerHTML = `<span>${user.firstName.charAt(0).toUpperCase()}</span>`;
  }

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

  // ====== Wallet Balances ======
  const wallets = JSON.parse(localStorage.getItem('homatt_wallets') || '{"family":0,"care":0}');
  document.getElementById('familyBalance').textContent = wallets.family.toLocaleString();
  document.getElementById('careBalance').textContent = wallets.care.toLocaleString();

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

  document.getElementById('dailyQuiz').querySelector('.quiz-start-btn').addEventListener('click', () => {
    // Phase 10: will navigate to quiz
  });
});
