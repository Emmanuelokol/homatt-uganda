/**
 * Homatt Health - Sign In Page Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const cfg = window.HOMATT_CONFIG || {};

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    document.getElementById('signinError').textContent = 'App configuration error. Please reload the page.';
    document.getElementById('signinError').classList.add('visible');
    return;
  }

  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const form = document.getElementById('signinForm');
  const phoneInput = document.getElementById('phone');
  const passwordInput = document.getElementById('password');
  const togglePassword = document.getElementById('togglePassword');
  const signinError = document.getElementById('signinError');
  const submitBtn = form.querySelector('button[type="submit"]');

  // Update status bar time
  function updateTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const mins = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('statusTime').textContent = `${hours}:${mins}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // If already logged in via Supabase session, go to dashboard
  supabase.auth.getSession().then(({ data: { session } }) => {
    if (session) window.location.href = 'dashboard.html';
  });

  // Password toggle
  togglePassword.addEventListener('click', () => {
    const type = passwordInput.type === 'password' ? 'text' : 'password';
    passwordInput.type = type;
    togglePassword.querySelector('.material-icons-outlined').textContent =
      type === 'password' ? 'visibility_off' : 'visibility';
  });

  // Phone number formatting
  phoneInput.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 9) val = val.slice(0, 9);
    if (val.length > 6) val = val.slice(0, 3) + ' ' + val.slice(3, 6) + ' ' + val.slice(6);
    else if (val.length > 3) val = val.slice(0, 3) + ' ' + val.slice(3);
    e.target.value = val;
  });

  // Clear errors on input
  document.querySelectorAll('.input-field').forEach(input => {
    input.addEventListener('input', () => {
      const group = input.closest('.input-group');
      if (group) {
        const error = group.querySelector('.input-error');
        if (error) { error.textContent = ''; error.classList.remove('visible'); }
      }
      signinError.textContent = '';
      signinError.classList.remove('visible');
    });
  });

  function showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.add('visible');
    const group = el.closest('.input-group');
    if (group) {
      group.classList.add('shake');
      setTimeout(() => group.classList.remove('shake'), 300);
    }
  }

  // Form submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const phone = phoneInput.value.trim();
    const password = passwordInput.value;
    let valid = true;

    if (!phone) {
      showError('phoneError', 'Please enter your phone number');
      valid = false;
    } else if (!/^[0-9]{9}$/.test(phone.replace(/\s/g, ''))) {
      showError('phoneError', 'Enter a valid 9-digit number');
      valid = false;
    }

    if (!password) {
      showError('passwordError', 'Please enter your password');
      valid = false;
    }

    if (!valid) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in\u2026';

    const phoneDigits = phone.replace(/\s/g, '');
    const email = '256' + phoneDigits + '@homatt.ug';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
      signinError.textContent = error.message.includes('Invalid login')
        ? 'Incorrect phone number or password.'
        : error.message;
      signinError.classList.add('visible');
      return;
    }

    // Load profile and cache locally for fast reads
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profile) {
      localStorage.setItem('homatt_user', JSON.stringify({
        firstName: profile.first_name,
        lastName: profile.last_name,
        phone: profile.phone_number,
        dob: profile.dob,
        sex: profile.sex,
        district: profile.district,
        city: profile.city,
        hasFamily: profile.has_family,
        familySize: profile.family_size,
        healthGoals: profile.health_goals,
      }));
    }

    window.location.href = 'dashboard.html';
  });
});
