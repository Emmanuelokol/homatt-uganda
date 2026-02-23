/**
 * Homatt Health - Sign In Page Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signinForm');
  const phoneInput = document.getElementById('phone');
  const passwordInput = document.getElementById('password');
  const togglePassword = document.getElementById('togglePassword');
  const signinError = document.getElementById('signinError');

  // Update status bar time
  function updateTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const mins = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('statusTime').textContent = `${hours}:${mins}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // If already logged in, go to dashboard
  if (localStorage.getItem('homatt_logged_in') === 'true') {
    window.location.href = 'dashboard.html';
    return;
  }

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

    if (val.length > 6) {
      val = val.slice(0, 3) + ' ' + val.slice(3, 6) + ' ' + val.slice(6);
    } else if (val.length > 3) {
      val = val.slice(0, 3) + ' ' + val.slice(3);
    }

    e.target.value = val;
  });

  // Clear errors on input
  document.querySelectorAll('.input-field').forEach(input => {
    input.addEventListener('input', () => {
      const group = input.closest('.input-group');
      if (group) {
        const error = group.querySelector('.input-error');
        if (error) {
          error.textContent = '';
          error.classList.remove('visible');
        }
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
  form.addEventListener('submit', (e) => {
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

    // Check against stored user
    const storedUser = localStorage.getItem('homatt_user');
    if (!storedUser) {
      signinError.textContent = 'No account found. Please sign up first.';
      signinError.classList.add('visible');
      return;
    }

    const user = JSON.parse(storedUser);
    const inputPhone = '+256' + phone.replace(/\s/g, '');

    if (user.phone !== inputPhone) {
      signinError.textContent = 'Phone number not found. Check and try again.';
      signinError.classList.add('visible');
      return;
    }

    if (user.password !== password) {
      signinError.textContent = 'Incorrect password. Please try again.';
      signinError.classList.add('visible');
      return;
    }

    // Login success
    localStorage.setItem('homatt_logged_in', 'true');
    window.location.href = 'dashboard.html';
  });
});
