/**
 * Homatt Health — Onboarding (one-time profile setup)
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Status bar time
  const statusTime = document.getElementById('statusTime');
  if (statusTime) {
    const tick = () => {
      const n = new Date();
      statusTime.textContent =
        n.getHours().toString().padStart(2,'0') + ':' + n.getMinutes().toString().padStart(2,'0');
    };
    tick();
    setInterval(tick, 30000);
  }

  // Verify the user is authenticated
  let userId = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data?.session?.user?.id || null;
  } catch(e) {}

  if (!userId) {
    // Fallback: check localStorage (e.g. email not confirmed yet, session pending)
    try {
      const stored = JSON.parse(localStorage.getItem('homatt_session') || 'null');
      userId = stored?.userId || null;
    } catch(e) {}
  }

  if (!userId) {
    // Not logged in at all
    window.location.replace('signin.html');
    return;
  }

  // ── State ──────────────────────────────────────────────────────────────
  let selectedSex  = '';
  let hasFamily    = false;
  let familySize   = 2;
  const selectedGoals = new Set();

  // ── Sex selector ───────────────────────────────────────────────────────
  document.querySelectorAll('.sex-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sex-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedSex = btn.dataset.value;
    });
  });

  // ── Family toggle ──────────────────────────────────────────────────────
  const familyToggle  = document.getElementById('familyToggle');
  const familySizeRow = document.getElementById('familySizeRow');

  familyToggle.addEventListener('click', () => {
    hasFamily = !hasFamily;
    familyToggle.classList.toggle('on', hasFamily);
    familyToggle.setAttribute('aria-checked', String(hasFamily));
    familySizeRow.classList.toggle('visible', hasFamily);
  });

  // ── Family size counter ────────────────────────────────────────────────
  const sizeDisplay = document.getElementById('familySizeDisplay');

  document.getElementById('decreaseSize').addEventListener('click', () => {
    if (familySize > 1) {
      familySize--;
      sizeDisplay.textContent = familySize;
    }
  });

  document.getElementById('increaseSize').addEventListener('click', () => {
    if (familySize < 20) {
      familySize++;
      sizeDisplay.textContent = familySize;
    }
  });

  // ── Health goals ───────────────────────────────────────────────────────
  document.querySelectorAll('.goal-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const goal = chip.dataset.goal;
      if (selectedGoals.has(goal)) {
        selectedGoals.delete(goal);
        chip.classList.remove('selected');
      } else {
        selectedGoals.add(goal);
        chip.classList.add('selected');
      }
    });
  });

  // ── Form submit ────────────────────────────────────────────────────────
  const errorEl   = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');

  document.getElementById('onboardingForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const firstName = document.getElementById('firstName').value.trim();
    const lastName  = document.getElementById('lastName').value.trim();
    const phone     = document.getElementById('phone').value.trim();
    const dob       = document.getElementById('dob').value;
    const district  = document.getElementById('district').value;
    const city      = document.getElementById('city').value.trim();

    if (!firstName) {
      errorEl.textContent = 'Please enter your first name.';
      errorEl.style.display = 'block';
      document.getElementById('firstName').focus();
      return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="material-icons-outlined" style="animation:spin 0.8s linear infinite">refresh</span>
      Saving…
    `;

    try {
      const profileData = {
        id:           userId,
        first_name:   firstName,
        last_name:    lastName  || null,
        phone_number: phone     || null,
        dob:          dob       || null,
        sex:          selectedSex || null,
        district:     district  || null,
        city:         city      || null,
        has_family:   hasFamily,
        family_size:  hasFamily ? familySize : 1,
        health_goals: Array.from(selectedGoals),
        updated_at:   new Date().toISOString(),
      };

      const { error } = await supabase
        .from('profiles')
        .upsert(profileData, { onConflict: 'id' });

      if (error) throw error;

      // Cache profile in localStorage
      const cachedUser = {
        firstName,
        lastName,
        phone,
        dob,
        sex:        selectedSex,
        district,
        city,
        hasFamily,
        familySize: hasFamily ? familySize : 1,
        healthGoals: Array.from(selectedGoals),
      };
      localStorage.setItem('homatt_user', JSON.stringify(cachedUser));

      // Update session cache
      const existingSession = JSON.parse(localStorage.getItem('homatt_session') || '{}');
      localStorage.setItem('homatt_session', JSON.stringify({
        ...existingSession,
        first_name:   firstName,
        last_name:    lastName,
        name:         (firstName + ' ' + lastName).trim(),
        phone_number: phone,
        district,
      }));

      // Link OneSignal push notifications to this user
      if (typeof oneSignalLogin === 'function') oneSignalLogin(userId);

      window.location.href = 'dashboard.html';
    } catch (err) {
      console.error('[Onboarding] Save error:', err);
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <span class="material-icons-outlined">arrow_forward</span>
        Go to My Dashboard
      `;
      errorEl.textContent = 'Could not save your profile. Please try again.';
      errorEl.style.display = 'block';
    }
  });
});
