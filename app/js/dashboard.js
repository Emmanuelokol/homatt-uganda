/**
 * Homatt Health - Dashboard Logic
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
  } catch(e) { console.warn('[Dashboard] Supabase init failed:', e.message); }

  if (!session) {
    // Only redirect if we have no cached user either (fully signed out)
    const localSession = (() => { try { return JSON.parse(localStorage.getItem('homatt_session') || 'null'); } catch(e) { return null; } })();
    const localUser = (() => { try { return JSON.parse(localStorage.getItem('homatt_user') || 'null'); } catch(e) { return null; } })();
    if (!localSession && !localUser) {
      window.location.href = 'signin.html';
      return;
    }
    // If session exists but profile is not yet complete, go to onboarding
    if (localSession && localSession.userId && !localSession.first_name) {
      const localUserObj = localUser || {};
      if (!localUserObj.firstName) {
        window.location.href = 'onboarding.html';
        return;
      }
    }
    // Offline or token expired but we have cached data — continue with cache
  }

  // Load user data — prefer Supabase, fall back to localStorage cache
  const localSession = (() => { try { return JSON.parse(localStorage.getItem('homatt_session') || 'null'); } catch(e) { return null; } })();
  let user = (() => { try { return JSON.parse(localStorage.getItem('homatt_user') || '{}'); } catch(e) { return {}; } })();

  // Merge local session data into user object
  if (localSession) {
    if (!user.firstName && localSession.first_name) user.firstName = localSession.first_name;
    if (!user.firstName && localSession.name) user.firstName = localSession.name.split(' ')[0];
  }

  if (session && supabase) {
    try {
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
      } else if (!user.firstName && !localSession) {
        // Supabase session exists but no patient profile AND no cached data.
        // This is a portal staff account that slipped through — sign out and go to signin.
        await supabase.auth.signOut();
        window.location.href = 'signin.html';
        return;
      }
    } catch(e) { console.warn('[Dashboard] Profile fetch failed:', e.message); }
  }

  // Re-link OneSignal every dashboard load — handles the auto-login path where the user
  // was already logged in and signin.html redirected immediately, bypassing oneSignalLogin().
  // Delay ensures onesignal.js has had time to call initOneSignal() first.
  if (session?.user?.id && typeof oneSignalLogin === 'function') {
    setTimeout(() => oneSignalLogin(session.user.id), 1500);
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

  // ====== Feature Cards Navigation ======
  document.getElementById('symptomChecker').addEventListener('click', () => {
    window.location.href = 'symptom-checker.html';
  });

  document.getElementById('featureMalaria').addEventListener('click', () => {
    window.location.href = 'malaria-tracker.html';
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

  document.getElementById('featureChildGrowth').addEventListener('click', () => {
    window.location.href = 'child-growth-tracker.html';
  });

  // ====== Health Score Calculation ======
  async function calculateHealthScore() {
    if (!supabase || !session?.user?.id) return;
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
  document.getElementById('navShop').addEventListener('click', () => { window.location.href = 'shop.html'; });
  document.getElementById('navProfile').addEventListener('click', () => { window.location.href = 'profile.html'; });

  // Notification bell — slide-up panel
  document.getElementById('notifBtn').addEventListener('click', showNotificationPanel);

  function showNotificationPanel() {
    if (document.getElementById('notifPanel')) return;

    const notifications = JSON.parse(localStorage.getItem('homatt_notifications') || '[]');
    const defaults = [
      { icon: 'water_drop', color: '#1565C0', title: 'Drink Water', body: 'You have not logged water today. Stay hydrated!', time: '2 min ago' },
      { icon: 'bedtime', color: '#4527A0', title: 'Sleep Reminder', body: 'Log your sleep quality from last night.', time: '1 hr ago' },
      { icon: 'medication', color: '#E65100', title: 'Medication Due', body: 'Check your medication schedule for today.', time: '3 hr ago' },
      { icon: 'tips_and_updates', color: '#2E7D32', title: 'Health Tip', body: 'Walk for 30 minutes today to boost your mood and energy.', time: 'Today' },
    ];
    const items = notifications.length > 0 ? notifications : defaults;

    const panel = document.createElement('div');
    panel.id = 'notifPanel';
    panel.style.cssText = `
      position:fixed;bottom:0;left:50%;transform:translateX(-50%) translateY(100%);
      width:100%;max-width:430px;background:var(--surface);
      border-radius:20px 20px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,0.18);
      z-index:9999;transition:transform 0.3s cubic-bezier(0.34,1.56,0.64,1);
      max-height:80dvh;max-height:80vh;display:flex;flex-direction:column;
    `;

    panel.innerHTML = `
      <div style="padding:16px 20px 12px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
        <div style="font-size:16px;font-weight:700;color:var(--text-primary)">Notifications</div>
        <button id="closeNotifPanel" style="background:none;border:none;cursor:pointer;color:var(--text-hint);display:flex">
          <span class="material-icons-outlined">close</span>
        </button>
      </div>
      <div style="overflow-y:auto;-webkit-overflow-scrolling:touch;flex:1;padding:8px 0 20px">
        ${items.map(n => `
          <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 20px;border-bottom:1px solid var(--border)">
            <div style="width:38px;height:38px;border-radius:50%;background:${n.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <span class="material-icons-outlined" style="font-size:20px;color:${n.color}">${n.icon}</span>
            </div>
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${n.title}</div>
              <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;line-height:1.4">${n.body}</div>
              <div style="font-size:11px;color:var(--text-hint);margin-top:4px">${n.time}</div>
            </div>
          </div>`).join('')}
        <div style="text-align:center;padding:16px;font-size:12px;color:var(--text-hint)">You're all caught up!</div>
      </div>
    `;

    const overlay = document.createElement('div');
    overlay.id = 'notifOverlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:9998;';
    overlay.addEventListener('click', closeNotifPanel);

    document.querySelector('.phone-frame').appendChild(overlay);
    document.querySelector('.phone-frame').appendChild(panel);
    setTimeout(() => { panel.style.transform = 'translateX(-50%) translateY(0)'; }, 10);

    document.getElementById('closeNotifPanel').addEventListener('click', closeNotifPanel);
  }

  function closeNotifPanel() {
    const panel = document.getElementById('notifPanel');
    const overlay = document.getElementById('notifOverlay');
    if (panel) {
      panel.style.transform = 'translateX(-50%) translateY(100%)';
      setTimeout(() => { panel.remove(); if (overlay) overlay.remove(); }, 320);
    } else if (overlay) {
      overlay.remove();
    }
  }

  // Safety net: clear any stuck overlay on blur/focus, back-button navigation, and visibility change.
  // If the user dismisses the notification panel via a swipe or hardware gesture, the overlay
  // can occasionally get orphaned in the DOM and block all touch events.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const stuck = document.getElementById('notifOverlay');
      if (stuck) stuck.remove();
      const stuckPanel = document.getElementById('notifPanel');
      if (stuckPanel) stuckPanel.remove();
    }
  });

  // Also clear on page focus (device wakes up or user returns from another app).
  window.addEventListener('focus', () => {
    const stuck = document.getElementById('notifOverlay');
    if (stuck) stuck.remove();
  });

  // ====== Health Predictions from Tracker Data ======
  function runHealthPredictions() {
    const moodLogs   = (() => { try { return JSON.parse(localStorage.getItem('homatt_mood_logs') || '[]'); } catch(e) { return []; } })();
    const painLogs   = (() => { try { return JSON.parse(localStorage.getItem('homatt_pain_logs') || '[]'); } catch(e) { return []; } })();
    const dietLogs   = (() => { try { return JSON.parse(localStorage.getItem('homatt_diet_logs') || '[]'); } catch(e) { return []; } })();
    const cycleLogs  = (() => { try { return JSON.parse(localStorage.getItem('homatt_cycle_logs') || '[]'); } catch(e) { return []; } })();
    const digestLogs = (() => { try { return JSON.parse(localStorage.getItem('homatt_digestive_logs') || '[]'); } catch(e) { return []; } })();
    const symLogs    = (() => { try { return JSON.parse(localStorage.getItem('homatt_monitoring') || 'null'); } catch(e) { return null; } })();

    const insights = [];

    // — Sleep pattern analysis
    if (moodLogs.length >= 3) {
      const recent = moodLogs.slice(0, 14);
      const avgSleep = recent.reduce((s, l) => s + (parseFloat(l.sleep_hours) || 0), 0) / recent.length;
      const avgMood  = recent.reduce((s, l) => s + (l.mood || 5), 0) / recent.length;
      const avgAnx   = recent.reduce((s, l) => s + (l.anxiety_level || 5), 0) / recent.length;

      if (avgSleep < 6) {
        insights.push({
          icon: 'bedtime', color: '#4527A0', urgency: 'warning',
          title: 'Sleep Deprivation Risk',
          cause: `You are averaging only ${avgSleep.toFixed(1)} hours of sleep.`,
          prediction: 'Chronic sleep loss weakens immunity and raises risk of hypertension, depression, and diabetes.',
          action: 'Aim for 7–9 hours. Set a consistent bedtime and reduce screen time 1 hour before sleep.',
        });
      }
      if (avgAnx >= 7) {
        insights.push({
          icon: 'sentiment_very_dissatisfied', color: '#C62828', urgency: 'warning',
          title: 'High Stress / Anxiety Pattern',
          cause: 'Your logged anxiety levels have been consistently high.',
          prediction: 'Prolonged stress can lead to headaches, digestive issues, high blood pressure, and burnout.',
          action: 'Try 5 minutes of deep breathing daily. Consider talking to someone you trust or a counsellor.',
        });
      }
      if (avgMood < 4 && moodLogs.length >= 5) {
        insights.push({
          icon: 'mood_bad', color: '#7B1FA2', urgency: 'info',
          title: 'Low Mood — Watch Your Mental Health',
          cause: 'Your recent mood logs show consistently low mood scores.',
          prediction: 'Prolonged low mood can progress to depression if not addressed.',
          action: 'Get sunlight daily, exercise, eat well, and connect with friends. Seek help if mood persists.',
        });
      }
    }

    // — Pain pattern analysis
    if (painLogs.length >= 3) {
      const recent = painLogs.slice(0, 10);
      const avgPain = recent.reduce((s, l) => s + (l.intensity || 0), 0) / recent.length;
      const locations = recent.flatMap(l => l.locations || []);
      const headCount = locations.filter(loc => (loc || '').toLowerCase().includes('head')).length;
      const backCount = locations.filter(loc => (loc || '').toLowerCase().includes('back')).length;

      if (avgPain >= 6) {
        insights.push({
          icon: 'healing', color: '#BF360C', urgency: 'danger',
          title: 'Chronic Pain Pattern Detected',
          cause: `Average pain intensity: ${avgPain.toFixed(1)}/10 over recent logs.`,
          prediction: 'Unmanaged chronic pain can affect sleep, mood, and daily function.',
          action: 'Track your pain triggers and consult a health provider. Book a clinic visit on Homatt.',
        });
      }
      if (headCount >= 3) {
        insights.push({
          icon: 'psychology', color: '#1565C0', urgency: 'info',
          title: 'Frequent Headaches — Possible Causes',
          cause: 'You have logged headaches multiple times recently.',
          prediction: 'May indicate dehydration, eye strain, hypertension, or stress.',
          action: 'Drink more water, rest your eyes, and check your blood pressure. See a doctor if headaches are severe.',
        });
      }
      if (backCount >= 3) {
        insights.push({
          icon: 'accessibility_new', color: '#00695C', urgency: 'info',
          title: 'Recurring Back Pain',
          cause: 'Back pain appears frequently in your recent logs.',
          prediction: 'Could signal posture issues, muscle strain, or kidney problems.',
          action: 'Stretch daily, improve sitting posture, and stay hydrated. See a provider if pain is sharp or persistent.',
        });
      }
    }

    // — Diet analysis
    if (dietLogs.length >= 3) {
      const recent = dietLogs.slice(0, 7);
      const avgDiet = recent.reduce((s, l) => s + (l.diet_quality || 5), 0) / recent.length;
      const avgWater = recent.filter(l => (l.water_intake || '') === '8+').length;

      if (avgDiet < 5) {
        insights.push({
          icon: 'restaurant', color: '#E65100', urgency: 'warning',
          title: 'Poor Diet — Nutritional Risk',
          cause: 'Your diet quality ratings have been low.',
          prediction: 'A poor diet increases risk of anaemia, malnutrition, and weakened immunity.',
          action: 'Include vegetables, fruits, and protein in every meal. Reduce fried and sugary foods.',
        });
      }
      if (avgWater === 0 && recent.length >= 3) {
        insights.push({
          icon: 'water_drop', color: '#1565C0', urgency: 'info',
          title: 'Low Water Intake',
          cause: 'You rarely log drinking 8+ glasses of water.',
          prediction: 'Dehydration causes fatigue, headaches, and poor kidney function.',
          action: 'Set a water reminder. Aim for at least 8 glasses (2 litres) per day.',
        });
      }
    }

    // — Active symptom monitoring is shown in the dedicated banner above Health Insights;
    //   no need to duplicate it here.

    // — Positive reinforcement
    if (insights.length === 0 && (moodLogs.length + painLogs.length) >= 5) {
      insights.push({
        icon: 'verified', color: '#2E7D32', urgency: 'good',
        title: 'You Are Doing Great!',
        cause: 'Your tracker data looks healthy and consistent.',
        prediction: 'Keep up your current habits to maintain good health.',
        action: 'Continue logging daily and stay on top of your nutrition, sleep, and exercise.',
      });
    }

    if (insights.length === 0) return; // not enough data yet

    const section = document.getElementById('healthPredictionSection');
    const list = document.getElementById('healthPredictionList');
    if (!section || !list) return;

    const urgencyColors = { danger:'#FFEBEE', warning:'#FFF8E1', info:'#E3F2FD', good:'#E8F5E9' };
    const urgencyBorder = { danger:'#EF9A9A', warning:'#FFE082', info:'#90CAF9', good:'#A5D6A7' };

    list.innerHTML = insights.map(ins => {
      const checkinButtons = ins.type === 'symptom_checkin' ? `
        <div style="display:flex;gap:8px;margin-top:12px">
          <button onclick="window.handleSymptomCheckin('better',this)"
            style="flex:1;padding:10px 6px;background:#E8F5E9;border:2px solid #4CAF50;border-radius:10px;font-size:12px;font-weight:700;color:#2E7D32;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;touch-action:manipulation;transition:transform .12s ease,opacity .12s ease;-webkit-tap-highlight-color:transparent;user-select:none">
            <span class="material-icons-outlined" style="font-size:16px">sentiment_very_satisfied</span>Better
          </button>
          <button onclick="window.handleSymptomCheckin('same',this)"
            style="flex:1;padding:10px 6px;background:#FFF8E1;border:2px solid #FFC107;border-radius:10px;font-size:12px;font-weight:700;color:#F57F17;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;touch-action:manipulation;transition:transform .12s ease,opacity .12s ease;-webkit-tap-highlight-color:transparent;user-select:none">
            <span class="material-icons-outlined" style="font-size:16px">sentiment_neutral</span>Same
          </button>
          <button onclick="window.handleSymptomCheckin('worse',this)"
            style="flex:1;padding:10px 6px;background:#FFEBEE;border:2px solid #EF5350;border-radius:10px;font-size:12px;font-weight:700;color:#C62828;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:4px;touch-action:manipulation;transition:transform .12s ease,opacity .12s ease;-webkit-tap-highlight-color:transparent;user-select:none">
            <span class="material-icons-outlined" style="font-size:16px">sentiment_very_dissatisfied</span>Worse
          </button>
        </div>` : '';
      return `
      <div style="background:${urgencyColors[ins.urgency]||'#F5F5F5'};border:1px solid ${urgencyBorder[ins.urgency]||'#E0E0E0'};border-radius:14px;padding:14px 16px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <div style="width:36px;height:36px;border-radius:10px;background:${ins.color};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <span class="material-icons-outlined" style="font-size:20px;color:#fff">${ins.icon}</span>
          </div>
          <div style="font-size:14px;font-weight:700;color:#1A1A1A;line-height:1.3">${ins.title}</div>
        </div>
        <div style="font-size:12px;color:#555;margin-bottom:6px"><strong>Why:</strong> ${ins.cause}</div>
        <div style="font-size:12px;color:#555;margin-bottom:6px"><strong>Risk:</strong> ${ins.prediction}</div>
        <div style="font-size:12px;font-weight:600;color:${ins.color}"><span class="material-icons-outlined" style="font-size:13px;vertical-align:middle">tips_and_updates</span> ${ins.action}</div>
        ${checkinButtons}
      </div>`;
    }).join('');

    section.style.display = 'block';
  }

  // ─────────────────────────────────────────────────────────────────
  // SYMPTOM MONITORING — banner only shown when check-in is actually due
  // ─────────────────────────────────────────────────────────────────

  function _readMonSession() {
    try { return JSON.parse(localStorage.getItem('homatt_monitoring') || 'null'); } catch(e) { return null; }
  }
  function _saveMonSession(s) {
    try { localStorage.setItem('homatt_monitoring', JSON.stringify(s)); } catch(e) {}
  }
  function _endMonSession(outcome, monSess, extra) {
    localStorage.removeItem('homatt_monitoring');
    if (supabase && session?.user?.id) {
      supabase.from('symptom_monitoring_logs').upsert({
        user_id: session.user.id,
        condition: monSess.condition,
        started_at: monSess.startedAt,
        ended_at: new Date().toISOString(),
        outcome,
        check_ins: monSess.checkIns || [],
        last_checkin_at: new Date().toISOString(),
        ...(extra || {}),
      }, { onConflict: 'user_id,started_at' }).catch(() => {});
    }
  }
  function _updateActiveMonSession(monSess) {
    if (supabase && session?.user?.id) {
      supabase.from('symptom_monitoring_logs').upsert({
        user_id: session.user.id,
        condition: monSess.condition,
        started_at: monSess.startedAt,
        outcome: 'active',
        check_ins: monSess.checkIns || [],
        last_checkin_at: new Date().toISOString(),
        next_checkin_at: monSess.nextCheckinAt || null,
      }, { onConflict: 'user_id,started_at' }).catch(() => {});
    }
  }

  // ── Banner visibility check — only show when check-in is due ──
  function checkActiveMonitoring() {
    const monSession = _readMonSession();
    const banner = document.getElementById('activeMonitorBanner');
    if (!banner) return;

    if (!monSession?.condition) {
      banner.style.display = 'none';
      return;
    }

    const now = Date.now();

    // Auto-expire sessions older than 48 hours with no recent check-in — silent cleanup
    const ageMs = monSession.startedAt ? now - new Date(monSession.startedAt).getTime() : 0;
    const lastCheckinMs = monSession.checkIns?.length
      ? now - new Date(monSession.checkIns[monSession.checkIns.length - 1].time).getTime()
      : ageMs;
    if (ageMs > 48 * 3600000 && lastCheckinMs > 24 * 3600000) {
      _endMonSession('abandoned', monSession);
      banner.style.display = 'none';
      return;
    }

    const nextCheckinAt = monSession.nextCheckinAt
      ? new Date(monSession.nextCheckinAt).getTime()
      : 0; // 0 = due immediately (legacy sessions without nextCheckinAt)
    const checkinPending = monSession.checkinPending === true;

    // Hide the banner when not yet check-in time
    if (!checkinPending && nextCheckinAt > 0 && now < nextCheckinAt) {
      banner.style.display = 'none';
      return;
    }

    // ── Populate header ──
    const condEl = document.getElementById('monitorBannerCondition');
    if (condEl) condEl.textContent = `Condition: ${monSession.condition}`;

    const timeEl = document.getElementById('monitorBannerTime');
    if (timeEl && monSession.startedAt) {
      const diffMs = now - new Date(monSession.startedAt).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1)       timeEl.textContent = 'Just started';
      else if (diffMins < 60) timeEl.textContent = `Started ${diffMins} min ago`;
      else {
        const hrs  = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        timeEl.textContent = `Started ${hrs}h${mins > 0 ? ' ' + mins + 'm' : ''} ago`;
      }
    }

    const checkinsEl = document.getElementById('monitorBannerCheckins');
    if (checkinsEl) {
      const checkIns = monSession.checkIns || [];
      if (checkIns.length > 0) {
        const last  = checkIns[checkIns.length - 1];
        const label = { better:'Better', same:'Same', worse:'Worse' }[last.feeling] || last.feeling;
        checkinsEl.textContent = `Last: ${label} at ${new Date(last.time).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })}`;
      } else {
        checkinsEl.textContent = 'Check-in #1';
      }
    }

    // ── Render the question inside monitorBannerBody ──
    _renderCheckinQuestion();

    banner.style.display = 'block';
    document.querySelector('.app-screen')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Renders the "How are you feeling?" buttons into monitorBannerBody
  function _renderCheckinQuestion() {
    const body = document.getElementById('monitorBannerBody');
    if (!body) return;
    // Replace only the inner content below the time/checkins row
    // (time/checkins elements live as sibling divs inside monitorBannerBody)
    const timeRow = body.querySelector('#monitorBannerTime')?.parentNode;

    // Strip everything after the time row
    const questionHtml = `
      <div style="font-size:13px;font-weight:700;color:#212121;margin-bottom:10px">How are you feeling right now?</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button onclick="window.respondMonitorCheckin('better',this)"
          style="flex:1;padding:10px 6px;border:2px solid #4CAF50;background:#E8F5E9;border-radius:10px;font-size:12px;font-weight:700;color:#2E7D32;cursor:pointer;font-family:inherit;touch-action:manipulation;transition:transform .12s ease,opacity .12s ease;-webkit-tap-highlight-color:transparent;user-select:none">
          😊<br>Better
        </button>
        <button onclick="window.respondMonitorCheckin('same',this)"
          style="flex:1;padding:10px 6px;border:2px solid #FFC107;background:#FFF8E1;border-radius:10px;font-size:12px;font-weight:700;color:#F57F17;cursor:pointer;font-family:inherit;touch-action:manipulation;transition:transform .12s ease,opacity .12s ease;-webkit-tap-highlight-color:transparent;user-select:none">
          😐<br>Same
        </button>
        <button onclick="window.respondMonitorCheckin('worse',this)"
          style="flex:1;padding:10px 6px;border:2px solid #EF5350;background:#FFEBEE;border-radius:10px;font-size:12px;font-weight:700;color:#C62828;cursor:pointer;font-family:inherit;touch-action:manipulation;transition:transform .12s ease,opacity .12s ease;-webkit-tap-highlight-color:transparent;user-select:none">
          😔<br>Worse
        </button>
      </div>
      <button onclick="window.location.href='symptom-checker.html'"
        style="width:100%;padding:10px;background:linear-gradient(135deg,#1B5E20,#2E7D32);color:#fff;border:none;border-radius:10px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px;touch-action:manipulation">
        <span class="material-icons-outlined" style="font-size:16px">stethoscope</span>
        Open Symptom Checker for Full Details
      </button>`;

    // Replace monitorBannerBody entirely but preserve the time/checkins row header
    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-size:12px;color:#9E9E9E" id="monitorBannerTime">${document.getElementById('monitorBannerTime')?.textContent || '—'}</div>
        <div style="font-size:12px;color:#5F6368" id="monitorBannerCheckins">${document.getElementById('monitorBannerCheckins')?.textContent || ''}</div>
      </div>
      ${questionHtml}`;
  }

  // ── Banner check-in response handler ──
  window.respondMonitorCheckin = function(feeling, btn) {
    if (btn) {
      const row = btn.parentNode;
      if (row) row.querySelectorAll('button').forEach(b => {
        b.disabled = true;
        b.style.transform = b === btn ? 'scale(0.91)' : 'scale(1)';
        b.style.opacity   = b === btn ? '1'   : '0.3';
        b.style.transition = 'transform .12s ease, opacity .12s ease';
      });
    }

    const monSession = _readMonSession();
    if (!monSession) return;

    monSession.checkIns = monSession.checkIns || [];
    monSession.checkIns.push({ feeling, time: new Date().toISOString() });
    monSession.symptomsSame = feeling === 'same'
      ? (monSession.symptomsSame || 0) + 1
      : 0;
    monSession.checkinPending = false;

    const body   = document.getElementById('monitorBannerBody');
    const banner = document.getElementById('activeMonitorBanner');

    function _swapBody(html) {
      if (!body) return;
      body.style.transition = 'opacity .15s ease';
      body.style.opacity = '0';
      setTimeout(() => { body.innerHTML = html; body.style.opacity = '1'; }, 150);
    }
    function _fadeOutBanner(delayMs) {
      setTimeout(() => {
        if (!banner) return;
        banner.style.transition = 'opacity .3s ease';
        banner.style.opacity = '0';
        setTimeout(() => {
          banner.style.display = 'none';
          banner.style.opacity = banner.style.transition = '';
        }, 300);
      }, delayMs);
    }

    // ── WORSE — go to clinic immediately ──
    if (feeling === 'worse') {
      _endMonSession('worse', monSession);
      window.location.href = 'symptom-checker.html';
      return;
    }

    // ── BETTER — ask follow-up then end monitoring ──
    if (feeling === 'better') {
      _swapBody(`
        <div style="text-align:center;margin-bottom:14px">
          <span class="material-icons-outlined" style="font-size:36px;color:#2E7D32;display:block;margin-bottom:6px">thumb_up</span>
          <div style="font-size:14px;font-weight:700;color:#1B5E20">Great — you're feeling better!</div>
          <div style="font-size:12px;color:#388E3C;margin-top:4px">Help others like you — what helped?</div>
        </div>
        <div style="font-size:13px;font-weight:600;color:#212121;margin-bottom:8px">What did you do that helped?</div>
        <textarea id="monitorFollowupInput" placeholder="e.g. I rested, drank water, took paracetamol…"
          style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #A5D6A7;border-radius:10px;font-size:13px;font-family:inherit;resize:none;height:80px;color:#212121;outline:none;background:#fff"></textarea>
        <button onclick="window._submitBetterFollowup()"
          style="width:100%;margin-top:10px;padding:12px;background:linear-gradient(135deg,#1B5E20,#2E7D32);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;touch-action:manipulation">
          Save &amp; End Monitoring
        </button>`);

      window._submitBetterFollowup = function() {
        const what = (document.getElementById('monitorFollowupInput')?.value || '').trim();
        _endMonSession('recovered', monSession, { recovery_action: what });
        _swapBody(`
          <div style="text-align:center;padding:12px 0">
            <span class="material-icons-outlined" style="font-size:36px;color:#2E7D32;display:block;margin-bottom:6px">health_and_safety</span>
            <div style="font-size:14px;font-weight:700;color:#1B5E20;margin-bottom:4px">Glad you're feeling better!</div>
            <div style="font-size:12px;color:#388E3C">Monitoring ended. Keep resting and stay hydrated.</div>
          </div>`);
        _fadeOutBanner(2500);
        setTimeout(runHealthPredictions, 4000);
      };
      return;
    }

    // ── SAME (2nd time) — escalate to clinic ──
    if (monSession.symptomsSame >= 2) {
      _endMonSession('escalated', monSession);
      _swapBody(`
        <div style="font-size:13px;font-weight:700;color:#B71C1C;margin-bottom:6px">Symptoms not improving</div>
        <div style="font-size:12px;color:#C62828;margin-bottom:12px">No improvement after multiple check-ins. Please visit a clinic now.</div>
        <button onclick="window.location.href='symptom-checker.html'"
          style="width:100%;padding:12px;background:#D32F2F;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;touch-action:manipulation">
          <span class="material-icons-outlined" style="font-size:18px">local_hospital</span>Find Nearest Clinic
        </button>`);
      const clinicBanner = document.getElementById('clinicReferralBanner');
      if (clinicBanner) { clinicBanner.style.display = 'block'; document.querySelector('.app-screen')?.scrollTo({ top: 0, behavior: 'smooth' }); }
      return;
    }

    // ── SAME (1st time) — ask what they're doing, then schedule next check-in ──
    _saveMonSession(monSession); // persist updated checkIns before async

    _swapBody(`
      <div style="margin-bottom:12px">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px">
          <span class="material-icons-outlined" style="font-size:20px;color:#F57F17">sentiment_neutral</span>
          <div style="font-size:14px;font-weight:700;color:#E65100">Still the same — noted.</div>
        </div>
        <div style="font-size:13px;font-weight:600;color:#212121;margin-bottom:8px">What are you doing to manage your symptoms?</div>
        <textarea id="monitorSameInput" placeholder="e.g. resting, drinking water, took paracetamol…"
          style="width:100%;box-sizing:border-box;padding:10px;border:1.5px solid #FFE082;border-radius:10px;font-size:13px;font-family:inherit;resize:none;height:70px;color:#212121;outline:none;background:#fff"></textarea>
        <div style="font-size:12px;font-weight:600;color:#F57F17;margin-top:8px;display:flex;align-items:flex-start;gap:4px">
          <span class="material-icons-outlined" style="font-size:14px;flex-shrink:0;margin-top:1px">tips_and_updates</span>
          Keep resting, drink ORS/water, and check your temperature every 30 min.
        </div>
      </div>
      <button onclick="window._submitSameFollowup()"
        style="width:100%;padding:12px;background:linear-gradient(135deg,#F57F17,#FFA000);color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;touch-action:manipulation">
        I'll check back in 1 hour
      </button>`);

    window._submitSameFollowup = async function() {
      const what = (document.getElementById('monitorSameInput')?.value || '').trim();
      const ms = _readMonSession() || monSession;
      ms.currentAction   = what;
      ms.checkinPending  = false;
      ms.nextCheckinAt   = new Date(Date.now() + 3600000).toISOString(); // +1 hour
      _saveMonSession(ms);
      _updateActiveMonSession(ms);

      // Schedule push notification for 1 hour from now
      if (supabase && session?.user?.id) {
        try {
          await supabase.functions.invoke('send-notification', {
            body: {
              userId: session.user.id,
              title: 'Symptom Check-in',
              message: `How are you feeling with your ${ms.condition}? Tap to respond.`,
              data: { screen: 'symptom-checkin' },
              scheduleAt: ms.nextCheckinAt,
              buttons: [
                { id: 'feeling_better', text: '😊 Better' },
                { id: 'feeling_same',   text: '😐 Same'   },
                { id: 'feeling_worse',  text: '😔 Worse'  },
              ],
            }
          });
        } catch(e) { console.warn('[Monitor] Schedule push failed:', e); }
      }

      _swapBody(`
        <div style="text-align:center;padding:12px 0">
          <span class="material-icons-outlined" style="font-size:36px;color:#F57F17;display:block;margin-bottom:6px">schedule</span>
          <div style="font-size:14px;font-weight:700;color:#E65100;margin-bottom:4px">Got it — checking again in 1 hour</div>
          <div style="font-size:12px;color:#795548">You'll get a push notification when it's time to check in.</div>
        </div>`);
      _fadeOutBanner(2500);
    };
  };

  // ── Handle push notification tap: ?feeling=better|same|worse or ?screen=symptom-checkin ──
  (function handleNotifParam() {
    const params     = new URLSearchParams(window.location.search);
    const feeling    = params.get('feeling');
    const screen     = params.get('screen');
    const isCheckin  = screen === 'symptom-checkin' || screen === 'dashboard';

    if (feeling && ['better', 'same', 'worse'].includes(feeling)) {
      // Action button tapped in notification — mark pending so banner shows, then auto-respond
      const ms = _readMonSession();
      if (ms?.condition) {
        ms.checkinPending = true;
        _saveMonSession(ms);
        checkActiveMonitoring();
        setTimeout(() => {
          if (_readMonSession()?.condition) window.respondMonitorCheckin(feeling);
          history.replaceState({}, '', window.location.pathname);
        }, 900);
      }
    } else if (isCheckin) {
      // User tapped notification body (no action button) — show banner for them to respond
      const ms = _readMonSession();
      if (ms?.condition) {
        ms.checkinPending = true;
        _saveMonSession(ms);
        checkActiveMonitoring();
      }
      history.replaceState({}, '', window.location.pathname);
    }
  })();

  runHealthPredictions();

  // ── Medication Check-in ──────────────────────────────────────
  window._activeCheckinId = null;

  async function checkPendingCheckins() {
    if (!supabase || !session?.user?.id) return;
    const now = new Date().toISOString();
    const { data: due } = await supabase
      .from('medication_checkins')
      .select('*, medication_dispensing(instructions, warnings)')
      .eq('user_id', session.user.id)
      .eq('status', 'pending')
      .lte('scheduled_at', now)
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!due) return;

    window._activeCheckinId = due.id;
    const disp = due.medication_dispensing || {};
    document.getElementById('checkinMedName').textContent = due.item_name;
    document.getElementById('checkinDosage').textContent = `Dose: ${due.dosage}`;

    const instr = disp.instructions || '';
    const instrEl = document.getElementById('checkinInstructions');
    instrEl.textContent = instr;
    instrEl.style.display = instr ? 'block' : 'none';

    const warn = disp.warnings || '';
    const warnEl = document.getElementById('checkinWarnings');
    warnEl.textContent = warn ? `⚠ ${warn}` : '';
    warnEl.style.display = warn ? 'block' : 'none';

    document.getElementById('medCheckinBanner').style.display = 'block';
  }

  window.respondCheckin = async function(feeling) {
    const id = window._activeCheckinId;
    if (!id || !supabase) return;

    await supabase.from('medication_checkins').update({
      status:             feeling === 'worse' ? 'escalated' : 'completed',
      feeling,
      clinic_recommended: feeling === 'worse',
      responded_at:       new Date().toISOString(),
    }).eq('id', id);

    document.getElementById('medCheckinBanner').style.display = 'none';
    window._activeCheckinId = null;

    if (feeling === 'worse') {
      document.getElementById('clinicReferralBanner').style.display = 'block';
      document.querySelector('.app-screen').scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Check if another check-in is due right after
      checkPendingCheckins();
    }
  };

  checkPendingCheckins();
  checkActiveMonitoring();

  // ── Chronic conditions (show active enrolments or CTA) ──
  (async function loadChronicConditions() {
    const cta  = document.getElementById('chronicEnrollCta');
    const list = document.getElementById('chronicActiveList');
    if (!cta || !list || !supabase || !session?.user?.id) return;
    try {
      const { data: conds } = await supabase
        .from('patient_conditions')
        .select('id,condition,condition_label,medication_name,next_refill_at,status')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .order('enrolled_at', { ascending: false })
        .limit(5);
      if (!conds || !conds.length) return; // keep CTA visible

      cta.style.display = 'none';
      list.style.display = 'flex';
      const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-UG', { day:'numeric', month:'short' }) : '—';
      const ICONS = { diabetes:'bloodtype', hypertension:'favorite', asthma:'air', heart_disease:'monitor_heart', hiv:'health_and_safety', tb:'masks', depression:'psychology', other:'medical_services' };
      const COLORS = { diabetes:'#C62828', hypertension:'#D32F2F', asthma:'#1976D2', heart_disease:'#B71C1C', hiv:'#6A1B9A', tb:'#E65100', depression:'#5E35B1', other:'#37474F' };
      list.innerHTML = conds.map(c => {
        const icon  = ICONS[c.condition]  || 'medical_services';
        const color = COLORS[c.condition] || '#37474F';
        const due   = c.next_refill_at ? `Next refill: ${fmt(c.next_refill_at)}` : 'Refill schedule pending';
        return `
          <div onclick="window.location.href='chronic-disease.html?id=${c.id}'"
            style="cursor:pointer;touch-action:manipulation;background:#fff;border:1px solid var(--border);border-radius:14px;padding:14px 16px;display:flex;align-items:center;gap:14px;box-shadow:0 2px 6px rgba(0,0,0,0.04)">
            <div style="width:42px;height:42px;border-radius:50%;background:${color}15;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <span class="material-icons-outlined" style="font-size:22px;color:${color}">${icon}</span>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:2px">${c.condition_label || c.condition}</div>
              <div style="font-size:12px;color:var(--text-secondary)">${c.medication_name ? c.medication_name + ' — ' : ''}${due}</div>
            </div>
            <span class="material-icons-outlined" style="color:var(--text-hint);flex-shrink:0">chevron_right</span>
          </div>`;
      }).join('');
    } catch(e) { /* table may not exist yet — keep CTA */ }
  })();
});
