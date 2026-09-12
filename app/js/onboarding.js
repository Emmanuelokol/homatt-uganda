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

  // ── Auto-recognition by phone ──────────────────────────────────────────
  // If a clinic (or an earlier booking/shop visit) already registered this
  // phone, recognise the person the moment they type it and pre-fill their
  // details. The DB trigger then links their clinic history to this account
  // automatically when the profile is saved.
  const phoneInput   = document.getElementById('phone');
  const knownBanner  = document.getElementById('knownBanner');
  let   _recognised  = false;

  function applyKnownIdentity(who) {
    if (!who || !who.found) return;
    _recognised = true;

    // Pre-fill only empty fields so we never clobber what the user typed.
    if (who.full_name) {
      const parts = who.full_name.trim().split(/\s+/);
      const fn = document.getElementById('firstName');
      const ln = document.getElementById('lastName');
      if (fn && !fn.value) fn.value = parts.shift() || '';
      if (ln && !ln.value && parts.length) ln.value = parts.join(' ');
    }
    if (who.date_of_birth) {
      const dobEl = document.getElementById('dob');
      if (dobEl && !dobEl.value) dobEl.value = who.date_of_birth;
    }
    if (who.sex) {
      const btn = document.querySelector('.sex-btn[data-value="' + who.sex + '"]');
      if (btn && !selectedSex) {
        document.querySelectorAll('.sex-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedSex = who.sex;
      }
    }
    if (who.district) {
      const dEl = document.getElementById('district');
      if (dEl && !dEl.value) {
        const opt = Array.from(dEl.options).find(o => o.value.toLowerCase() === String(who.district).toLowerCase() || o.text.toLowerCase() === String(who.district).toLowerCase());
        if (opt) dEl.value = opt.value;
      }
    }
    if (who.city) {
      const cEl = document.getElementById('city');
      if (cEl && !cEl.value) cEl.value = who.city;
    }

    // Friendly banner
    if (knownBanner) {
      const name = (who.full_name || '').split(/\s+/)[0] || 'there';
      document.getElementById('knownBannerTitle').textContent = 'Welcome back, ' + name + '!';
      document.getElementById('knownBannerBody').textContent =
        'We found your records and filled in what we already know — just check the details and confirm.';
      knownBanner.style.display = 'flex';
    }
  }

  if (phoneInput && global_HomattIdentity()) {
    let _lkTimer = null;
    const runLookup = async () => {
      const HI = global_HomattIdentity();
      if (!HI || !HI.normPhone(phoneInput.value)) return;
      const who = await HI.lookup(supabase, phoneInput.value);
      applyKnownIdentity(who);
    };
    phoneInput.addEventListener('blur', runLookup);
    phoneInput.addEventListener('input', () => {
      clearTimeout(_lkTimer);
      if (HomattIdentity.normPhone(phoneInput.value)) _lkTimer = setTimeout(runLookup, 600);
    });
  }

  function global_HomattIdentity() {
    return (typeof HomattIdentity !== 'undefined') ? HomattIdentity : null;
  }

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
