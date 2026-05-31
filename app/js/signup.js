/**
 * Homatt Health — Email/Password Sign Up
 */

document.addEventListener('DOMContentLoaded', () => {
  // Redirect if already logged in
  try {
    const sess = JSON.parse(localStorage.getItem('homatt_session') || 'null');
    if (sess && sess.userId) {
      window.location.replace('dashboard.html');
      return;
    }
  } catch(e) {}

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

  const errorEl   = document.getElementById('authError');
  const submitBtn = document.getElementById('submitBtn');

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
  }
  function hideError() {
    errorEl.style.display = 'none';
  }

  // Password visibility toggle
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

  // Form submission
  document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    if (!email) {
      showError('Please enter your email address.');
      return;
    }
    if (!password || password.length < 6) {
      showError('Password must be at least 6 characters.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating account…';

    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Account';
      showError(error.message);
      return;
    }

    const userId = data.session?.user?.id || data.user?.id;

    // Store minimal session so onboarding knows who is logged in
    localStorage.setItem('homatt_session', JSON.stringify({
      userId,
      email,
    }));

    // Go to onboarding to fill in profile details
    window.location.href = 'onboarding.html';
  });
});
