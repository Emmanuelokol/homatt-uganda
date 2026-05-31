/**
 * Homatt Health — Email/Password Sign In
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

  const authLoading = document.getElementById('authLoading');
  const signInUI    = document.getElementById('signInUI');

  function showSignInUI() {
    authLoading.style.display = 'none';
    signInUI.style.display = 'block';
  }

  // ── Handle profile caching and routing after a successful login ──────────
  async function handlePostLogin(session) {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .maybeSingle();

      if (profile && profile.first_name) {
        // Full profile exists — cache and go to dashboard
        localStorage.setItem('homatt_user', JSON.stringify({
          firstName:   profile.first_name,
          lastName:    profile.last_name,
          phone:       profile.phone_number,
          dob:         profile.dob,
          sex:         profile.sex,
          district:    profile.district,
          city:        profile.city,
          hasFamily:   profile.has_family,
          familySize:  profile.family_size,
          healthGoals: profile.health_goals,
        }));
        localStorage.setItem('homatt_session', JSON.stringify({
          userId:       session.user.id,
          first_name:   profile.first_name,
          last_name:    profile.last_name,
          name:         ((profile.first_name || '') + ' ' + (profile.last_name || '')).trim(),
          phone_number: profile.phone_number,
          district:     profile.district,
        }));

        if (typeof oneSignalLogin === 'function') oneSignalLogin(session.user.id);
        window.location.href = 'dashboard.html';
      } else {
        // No profile yet (or profile with no name) — go to onboarding
        localStorage.setItem('homatt_session', JSON.stringify({
          userId: session.user.id,
          email:  session.user.email,
        }));
        window.location.href = 'onboarding.html';
      }
    } catch (err) {
      console.error('[Auth] Post-login error:', err);
      // Still store session and send to onboarding as a safe fallback
      localStorage.setItem('homatt_session', JSON.stringify({
        userId: session.user.id,
        email:  session.user.email,
      }));
      window.location.href = 'onboarding.html';
    }
  }

  // ── Check for an existing active session first ──────────────────────────
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await handlePostLogin(session);
      return;
    }
  } catch (e) {
    console.warn('[Auth] Session check failed:', e.message);
  }

  showSignInUI();

  // ── Password visibility toggle ──────────────────────────────────────────
  document.getElementById('togglePassword').addEventListener('click', () => {
    const input = document.getElementById('password');
    const icon  = document.getElementById('eyeIcon');
    if (input.type === 'password') {
      input.type = 'text';
      icon.textContent = 'visibility_off';
    } else {
      input.type = 'password';
      icon.textContent = 'visibility';
    }
  });

  // ── Sign-in form submit ─────────────────────────────────────────────────
  const errorEl   = document.getElementById('authError');
  const submitBtn = document.getElementById('submitBtn');

  document.getElementById('signInForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.style.display = 'none';

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email || !password) {
      errorEl.textContent = 'Please enter your email and password.';
      errorEl.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
      errorEl.textContent = error.message;
      errorEl.style.display = 'block';
      return;
    }

    await handlePostLogin(data.session);
  });
});
