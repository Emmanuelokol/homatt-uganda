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

  // ====== Personalized Daily Tips Engine ======
  //
  // Tips are selected based on:
  //   • Time of day (morning = prevention, afternoon = activity, evening = recovery)
  //   • User location / district malaria risk level
  //   • User health goals
  //   • Recent symptom history
  //   • Anti-repetition (avoid tips seen in the last 5 sessions)

  const TIPS_DB = [
    // ── Hydration ─────────────────────────────────────────────────────────
    { id: 'h1', categories: ['hydration'], timeOfDay: ['morning', 'afternoon'], goals: [],
      text: 'Drink at least 8 glasses of water daily. Staying hydrated helps your body fight infections, regulate temperature, and maintain energy levels.' },
    { id: 'h2', categories: ['hydration'], timeOfDay: ['afternoon'], goals: ['hydration'],
      text: 'If you feel tired or have a headache in the afternoon, drink a glass of water first — dehydration is the most common hidden cause.' },
    { id: 'h3', categories: ['hydration'], timeOfDay: ['morning'], goals: ['hydration'],
      text: 'Start each morning with a glass of water before anything else. It rehydrates your body after 6-8 hours of sleep and kick-starts your metabolism.' },

    // ── Nutrition ──────────────────────────────────────────────────────────
    { id: 'n1', categories: ['nutrition'], timeOfDay: ['morning'], goals: ['nutrition', 'weight_management'],
      text: 'Eat at least 5 servings of fruits and vegetables daily. Colorful foods like sweet potato, spinach, and tomatoes are packed with immune-boosting vitamins.' },
    { id: 'n2', categories: ['nutrition'], timeOfDay: ['morning', 'afternoon'], goals: ['nutrition'],
      text: 'Limit sugar in your food and drinks. Excess sugar raises blood sugar levels, increases diabetes risk, and contributes to tooth decay.' },
    { id: 'n3', categories: ['nutrition', 'blood_pressure'], timeOfDay: ['morning', 'evening'], goals: ['blood_pressure'],
      text: 'Reduce salt in your cooking. High sodium intake is a leading driver of high blood pressure — try using herbs, lemon, or garlic for flavour instead.' },
    { id: 'n4', categories: ['nutrition', 'weight_management'], timeOfDay: ['afternoon'], goals: ['weight_management'],
      text: 'Avoid large meals late at night. Eating 2-3 hours before bed allows your body to digest properly and supports a healthy weight.' },

    // ── Sleep ─────────────────────────────────────────────────────────────
    { id: 's1', categories: ['sleep'], timeOfDay: ['evening'], goals: [],
      text: 'Aim for 7-8 hours of sleep each night. Deep sleep is when your body repairs itself, strengthens immunity, and consolidates memory.' },
    { id: 's2', categories: ['sleep'], timeOfDay: ['evening'], goals: [],
      text: 'Try to go to bed and wake up at the same time every day — even on weekends. A consistent sleep schedule improves sleep quality significantly.' },
    { id: 's3', categories: ['sleep'], timeOfDay: ['evening'], goals: [],
      text: 'Put your phone away 30 minutes before bed. The blue light from screens signals your brain to stay awake, making it harder to fall asleep.' },

    // ── Exercise ──────────────────────────────────────────────────────────
    { id: 'e1', categories: ['exercise'], timeOfDay: ['morning', 'afternoon'], goals: ['weight_management', 'fitness'],
      text: 'Take a 30-minute walk every day. Regular exercise lowers the risk of heart disease, type 2 diabetes, and helps maintain a healthy weight.' },
    { id: 'e2', categories: ['exercise'], timeOfDay: ['afternoon'], goals: ['fitness'],
      text: 'You do not need a gym to stay fit. Bodyweight exercises like squats, push-ups, and stretching at home are highly effective.' },
    { id: 'e3', categories: ['exercise'], timeOfDay: ['morning'], goals: ['fitness', 'stress'],
      text: 'Morning exercise — even 10 minutes — boosts your mood, improves focus, and reduces stress hormones for the entire day.' },

    // ── Hygiene ───────────────────────────────────────────────────────────
    { id: 'hy1', categories: ['hygiene'], timeOfDay: ['morning', 'afternoon', 'evening'], goals: [],
      text: 'Wash your hands with soap for at least 20 seconds before eating and after using the toilet. This single habit prevents the most common infections.' },
    { id: 'hy2', categories: ['hygiene'], timeOfDay: ['morning'], goals: [],
      text: 'Keep your home clean and ensure no stagnant water collects in containers, gutters, or pots — standing water is the main breeding ground for malaria mosquitoes.' },

    // ── Malaria (shown more often for high-risk districts) ────────────────
    { id: 'm1', categories: ['malaria'], timeOfDay: ['evening'], goals: [], malariaRisk: ['high', 'medium'],
      text: 'Sleep under an insecticide-treated mosquito net every night — especially from dusk to dawn when malaria mosquitoes are most active.' },
    { id: 'm2', categories: ['malaria'], timeOfDay: ['evening'], goals: [], malariaRisk: ['high'],
      text: 'In your area, malaria risk is high. Apply mosquito repellent on exposed skin every evening and wear long sleeves and trousers after sunset.' },
    { id: 'm3', categories: ['malaria'], timeOfDay: ['morning'], goals: [], malariaRisk: ['high', 'medium'],
      text: 'Know the early signs of malaria: fever, chills, headache, and body aches. If you or a family member develops these symptoms, get a rapid test (RDT) immediately.' },
    { id: 'm4', categories: ['malaria'], timeOfDay: ['morning', 'afternoon'], goals: [], malariaRisk: ['high'],
      text: 'Remove all stagnant water around your home today. Empty containers, buckets, and old tyres to eliminate mosquito breeding sites and protect your family.' },

    // ── Stress & Mental Health ────────────────────────────────────────────
    { id: 'st1', categories: ['stress'], timeOfDay: ['afternoon', 'evening'], goals: ['stress'],
      text: 'Practice deep breathing for 5 minutes daily: inhale for 4 counts, hold for 4, exhale for 6. This activates your body\'s natural calm response.' },
    { id: 'st2', categories: ['stress'], timeOfDay: ['evening'], goals: ['stress'],
      text: 'Talking to someone you trust about your worries can significantly reduce stress and improve your mental wellbeing. You do not have to carry things alone.' },
    { id: 'st3', categories: ['stress'], timeOfDay: ['afternoon'], goals: ['stress'],
      text: 'Take a 5-minute break every hour if you work at a desk or screen. Stand, stretch, and look at something far away — your mind and body need it.' },

    // ── Blood Pressure ────────────────────────────────────────────────────
    { id: 'bp1', categories: ['blood_pressure'], timeOfDay: ['morning'], goals: ['blood_pressure'],
      text: 'Check your blood pressure regularly — even when you feel fine. Hypertension (high blood pressure) has no symptoms until it causes serious damage.' },
    { id: 'bp2', categories: ['blood_pressure'], timeOfDay: ['morning', 'evening'], goals: ['blood_pressure'],
      text: 'Reduce salt, exercise regularly, and manage stress to keep your blood pressure in a healthy range. These three changes alone can lower it significantly.' },

    // ── Maternal & Child Health ───────────────────────────────────────────
    { id: 'mc1', categories: ['maternal'], timeOfDay: ['morning'], goals: ['maternal_health'],
      text: 'Breastfeed exclusively for the first 6 months if possible. Breast milk provides complete nutrition and powerful immune protection for your baby.' },
    { id: 'mc2', categories: ['maternal', 'child'], timeOfDay: ['morning', 'afternoon'], goals: ['child_health'],
      text: 'Keep your child\'s vaccination card up to date. Immunisations protect against life-threatening diseases and are available free at government health centres.' },
    { id: 'mc3', categories: ['child'], timeOfDay: ['afternoon'], goals: ['child_health'],
      text: 'Wash your baby\'s hands and face regularly. Young children touch everything — good hygiene habits from early age reduce infections significantly.' },

    // ── Preventive Screenings ─────────────────────────────────────────────
    { id: 'pr1', categories: ['preventive'], timeOfDay: ['morning'], goals: [],
      text: 'Visit a health facility at least once a year for a general check-up — even when you feel healthy. Many serious conditions are easier to treat when caught early.' },
    { id: 'pr2', categories: ['preventive'], timeOfDay: ['morning'], goals: [],
      text: 'Women aged 25+ should have a cervical cancer screening (VIA or Pap smear) every 3 years. It takes only minutes and can save your life.' },

    // ── Recovery / Post-Illness ───────────────────────────────────────────
    { id: 'rc1', categories: ['recovery'], timeOfDay: ['evening'], goals: [],
      text: 'If you have recently been unwell, continue resting and eating nutritious food even after symptoms clear. Your immune system needs energy to fully recover.' },
    { id: 'rc2', categories: ['recovery'], timeOfDay: ['afternoon', 'evening'], goals: [],
      text: 'Complete any course of medication prescribed by your doctor — even if you feel better before the course ends. Stopping early can cause resistance.' },

    // ── Posture & Ergonomics ──────────────────────────────────────────────
    { id: 'po1', categories: ['exercise', 'stress'], timeOfDay: ['afternoon'], goals: [],
      text: 'Sit up straight and keep your shoulders relaxed. Poor posture causes back and neck pain over time — set a reminder to check your posture every hour.' },
  ];

  const HIGH_MALARIA_DISTRICTS = ['jinja', 'gulu', 'lira', 'soroti', 'arua', 'hoima'];
  const MED_MALARIA_DISTRICTS = ['kampala', 'wakiso', 'mukono', 'mbarara', 'mbale', 'masaka', 'fort_portal', 'entebbe'];

  function getUserMalariaRisk() {
    const d = (user.district || user.location || '').toLowerCase().replace(/\s+/g, '_');
    if (HIGH_MALARIA_DISTRICTS.includes(d)) return 'high';
    if (MED_MALARIA_DISTRICTS.includes(d)) return 'medium';
    return 'low';
  }

  function getTimeOfDay(hour) {
    if (hour < 12) return 'morning';
    if (hour < 17) return 'afternoon';
    return 'evening';
  }

  function selectPersonalizedTip(shownIds) {
    const hour = new Date().getHours();
    const timeSlot = getTimeOfDay(hour);
    const malariaRisk = getUserMalariaRisk();
    const goals = (user.healthGoals || []).map(g => g.toLowerCase().replace(/\s+/g, '_'));
    const recentHistory = JSON.parse(localStorage.getItem('homatt_symptom_history') || '[]');

    // Build category priorities based on user data
    const priorityCategories = new Set();

    // Always include time-appropriate general categories
    if (timeSlot === 'morning') priorityCategories.add('hydration');
    if (timeSlot === 'afternoon') priorityCategories.add('exercise');
    if (timeSlot === 'evening') priorityCategories.add('sleep');

    // Location-based: high/medium malaria risk → prioritise malaria tips
    if (malariaRisk === 'high' || malariaRisk === 'medium') {
      priorityCategories.add('malaria');
    }

    // Goal-based: map health goals to tip categories
    const goalCategoryMap = {
      'weight_management': ['nutrition', 'exercise'],
      'manage_bp': ['blood_pressure', 'nutrition'],
      'blood_pressure': ['blood_pressure', 'nutrition'],
      'stress_management': ['stress'],
      'sleep_improvement': ['sleep'],
      'maternal_health': ['maternal'],
      'child_health': ['child'],
      'general_wellness': ['preventive', 'hydration'],
    };
    goals.forEach(goal => {
      const mapped = goalCategoryMap[goal] || [];
      mapped.forEach(c => priorityCategories.add(c));
    });

    // Recent symptom history → add recovery/relevant category
    if (recentHistory.length > 0) {
      const recentCondition = (recentHistory[0].conditions?.[0]?.name || '').toLowerCase();
      if (recentCondition.includes('malaria')) priorityCategories.add('malaria');
      else if (recentCondition.includes('respiratory') || recentCondition.includes('cold')) priorityCategories.add('hygiene');
      else priorityCategories.add('recovery');
    }

    // Filter tips by time of day and available categories
    let candidates = TIPS_DB.filter(tip => {
      // Time-of-day filter
      if (!tip.timeOfDay.includes(timeSlot)) return false;
      // Malaria risk filter: skip tips that require higher risk than user's level
      if (tip.malariaRisk && !tip.malariaRisk.includes(malariaRisk)) return false;
      // Skip recently shown tips
      if (shownIds.includes(tip.id)) return false;
      return true;
    });

    if (candidates.length === 0) {
      // Reset anti-repetition if we've exhausted available tips
      localStorage.removeItem('homatt_shown_tip_ids');
      candidates = TIPS_DB.filter(tip => tip.timeOfDay.includes(timeSlot));
    }

    // Score candidates: tips matching priority categories score higher
    const scored = candidates.map(tip => {
      let score = 0;
      tip.categories.forEach(cat => {
        if (priorityCategories.has(cat)) score += 2;
      });
      tip.goals.forEach(g => {
        if (goals.includes(g)) score += 1;
      });
      return { tip, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Pick from top 3 with some randomness so it doesn't always repeat top result
    const topCandidates = scored.slice(0, 3);
    const selected = topCandidates[Math.floor(Math.random() * topCandidates.length)];
    return selected ? selected.tip : candidates[0];
  }

  // Anti-repetition: track last 5 shown tip IDs
  let shownTipIds = JSON.parse(localStorage.getItem('homatt_shown_tip_ids') || '[]');
  let currentTip = selectPersonalizedTip(shownTipIds);

  const tipText = document.getElementById('tipText');
  if (currentTip) {
    tipText.textContent = currentTip.text;
    // Record this tip as shown
    if (!shownTipIds.includes(currentTip.id)) {
      shownTipIds.push(currentTip.id);
      if (shownTipIds.length > 5) shownTipIds.shift();
      localStorage.setItem('homatt_shown_tip_ids', JSON.stringify(shownTipIds));
    }
  }

  document.getElementById('nextTip').addEventListener('click', () => {
    const nextTip = selectPersonalizedTip(shownTipIds);
    if (!nextTip) return;
    tipText.style.opacity = '0';
    setTimeout(() => {
      tipText.textContent = nextTip.text;
      currentTip = nextTip;
      tipText.style.opacity = '1';
      if (!shownTipIds.includes(nextTip.id)) {
        shownTipIds.push(nextTip.id);
        if (shownTipIds.length > 5) shownTipIds.shift();
        localStorage.setItem('homatt_shown_tip_ids', JSON.stringify(shownTipIds));
      }
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

  // ====== Quiz Streak & Button Label ======
  const streak = parseInt(localStorage.getItem('homatt_quiz_streak') || '0');
  document.getElementById('streakCount').textContent = streak;

  const quizDoneToday = localStorage.getItem('homatt_quiz_last_date') === new Date().toISOString().slice(0, 10);
  const quizStartBtn = document.getElementById('dailyQuiz').querySelector('.quiz-start-btn');
  if (quizDoneToday) {
    quizStartBtn.innerHTML = 'Review Today\'s Quiz <span class="material-icons-outlined">replay</span>';
  }

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
    window.location.href = 'quiz.html';
  });
});
