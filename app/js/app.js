/**
 * Homatt Health - Sign Up Page Logic
 * Multi-step form with validation
 */

document.addEventListener('DOMContentLoaded', () => {
  // State
  let currentStep = 1;
  const totalSteps = 3;
  let familySize = 2;
  const selectedGoals = new Set();

  // Elements
  const form = document.getElementById('signupForm');
  const steps = document.querySelectorAll('.form-step');
  const btnNext = document.getElementById('btnNext');
  const btnBack = document.getElementById('btnBack');
  const btnSubmit = document.getElementById('btnSubmit');
  const successModal = document.getElementById('successModal');
  const modalClose = document.getElementById('modalClose');

  // Update status bar time
  function updateTime() {
    const now = new Date();
    const hours = now.getHours().toString().padStart(2, '0');
    const mins = now.getMinutes().toString().padStart(2, '0');
    document.getElementById('statusTime').textContent = `${hours}:${mins}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // ====== Step Navigation ======

  function goToStep(step) {
    // Hide current step
    document.getElementById(`step${currentStep}`).classList.remove('active');

    currentStep = step;

    // Show new step
    document.getElementById(`step${currentStep}`).classList.add('active');

    // Update step indicator
    for (let i = 1; i <= totalSteps; i++) {
      const dot = document.getElementById(`step${i}-dot`);
      const line = document.getElementById(`line${i - 1}`);

      dot.classList.remove('active', 'completed');

      if (i < currentStep) {
        dot.classList.add('completed');
      } else if (i === currentStep) {
        dot.classList.add('active');
      }

      if (line) {
        line.classList.toggle('active', i < currentStep);
      }
    }

    // Update line2
    const line2 = document.getElementById('line2');
    if (line2) {
      line2.classList.toggle('active', currentStep > 2);
    }

    // Update buttons
    btnBack.style.display = currentStep > 1 ? 'flex' : 'none';
    btnNext.style.display = currentStep < totalSteps ? 'flex' : 'none';
    btnSubmit.style.display = currentStep === totalSteps ? 'flex' : 'none';

    // Scroll to top of form
    document.querySelector('.app-screen').scrollTo({ top: 0, behavior: 'smooth' });
  }

  btnNext.addEventListener('click', () => {
    if (validateStep(currentStep)) {
      goToStep(currentStep + 1);
    }
  });

  btnBack.addEventListener('click', () => {
    goToStep(currentStep - 1);
  });

  // ====== Sex Selector ======

  document.querySelectorAll('.sex-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sex-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('sex').value = btn.dataset.value;
      clearError('sexError');
    });
  });

  // ====== Family Toggle ======

  document.querySelectorAll('.toggle-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      document.getElementById('hasFamily').value = btn.dataset.value;

      const familySizeGroup = document.getElementById('familySizeGroup');
      if (btn.dataset.value === 'yes') {
        familySizeGroup.style.display = 'block';
      } else {
        familySizeGroup.style.display = 'none';
      }
      clearError('familyError');
    });
  });

  // ====== Family Size Counter ======

  document.getElementById('familyMinus').addEventListener('click', () => {
    if (familySize > 2) {
      familySize--;
      updateFamilySize();
    }
  });

  document.getElementById('familyPlus').addEventListener('click', () => {
    if (familySize < 20) {
      familySize++;
      updateFamilySize();
    }
  });

  function updateFamilySize() {
    document.getElementById('familySizeDisplay').textContent = familySize;
    document.getElementById('familySize').value = familySize;
  }

  // ====== Health Goals ======

  document.querySelectorAll('.goal-card').forEach(card => {
    card.addEventListener('click', () => {
      const goal = card.dataset.goal;

      if (selectedGoals.has(goal)) {
        selectedGoals.delete(goal);
        card.classList.remove('selected');
      } else {
        selectedGoals.add(goal);
        card.classList.add('selected');
      }

      document.getElementById('healthGoals').value = Array.from(selectedGoals).join(',');
      clearError('goalsError');
    });
  });

  // ====== Validation ======

  function showError(elementId, message) {
    const el = document.getElementById(elementId);
    el.textContent = message;
    el.classList.add('visible');

    // Shake the parent input group
    const group = el.closest('.input-group');
    if (group) {
      group.classList.add('shake');
      setTimeout(() => group.classList.remove('shake'), 300);
    }
  }

  function clearError(elementId) {
    const el = document.getElementById(elementId);
    if (el) {
      el.textContent = '';
      el.classList.remove('visible');
    }
  }

  function validateStep(step) {
    let valid = true;

    if (step === 1) {
      const firstName = document.getElementById('firstName').value.trim();
      const lastName = document.getElementById('lastName').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const sex = document.getElementById('sex').value;

      if (!firstName) {
        showError('firstNameError', 'Please enter your first name');
        valid = false;
      } else {
        clearError('firstNameError');
      }

      if (!lastName) {
        showError('lastNameError', 'Please enter your last name');
        valid = false;
      } else {
        clearError('lastNameError');
      }

      if (!phone) {
        showError('phoneError', 'Please enter your phone number');
        valid = false;
      } else if (!/^[0-9]{9}$/.test(phone.replace(/\s/g, ''))) {
        showError('phoneError', 'Enter a valid 9-digit number (e.g. 7XX XXX XXX)');
        valid = false;
      } else {
        clearError('phoneError');
      }

      if (!sex) {
        showError('sexError', 'Please select your sex');
        valid = false;
      } else {
        clearError('sexError');
      }
    }

    if (step === 2) {
      const location = document.getElementById('location').value;
      const city = document.getElementById('city').value.trim();
      const hasFamily = document.getElementById('hasFamily').value;

      if (!location) {
        showError('locationError', 'Please select your district');
        valid = false;
      } else {
        clearError('locationError');
      }

      if (!city) {
        showError('cityError', 'Please enter your city or town');
        valid = false;
      } else {
        clearError('cityError');
      }

      if (!hasFamily) {
        showError('familyError', 'Please select an option');
        valid = false;
      } else {
        clearError('familyError');
      }
    }

    if (step === 3) {
      if (selectedGoals.size === 0) {
        showError('goalsError', 'Please select at least one health goal');
        valid = false;
      } else {
        clearError('goalsError');
      }
    }

    return valid;
  }

  // Input focus/blur effects for wrapper highlighting
  document.querySelectorAll('.input-field').forEach(input => {
    input.addEventListener('input', () => {
      // Clear error on typing
      const group = input.closest('.input-group');
      if (group) {
        const error = group.querySelector('.input-error');
        if (error) {
          error.textContent = '';
          error.classList.remove('visible');
        }
      }
    });
  });

  // Phone number formatting
  const phoneInput = document.getElementById('phone');
  phoneInput.addEventListener('input', (e) => {
    let val = e.target.value.replace(/\D/g, '');
    if (val.length > 9) val = val.slice(0, 9);

    // Format: 7XX XXX XXX
    if (val.length > 6) {
      val = val.slice(0, 3) + ' ' + val.slice(3, 6) + ' ' + val.slice(6);
    } else if (val.length > 3) {
      val = val.slice(0, 3) + ' ' + val.slice(3);
    }

    e.target.value = val;
  });

  // ====== Form Submit ======

  form.addEventListener('submit', (e) => {
    e.preventDefault();

    if (!validateStep(3)) return;

    // Collect all data
    const formData = {
      firstName: document.getElementById('firstName').value.trim(),
      lastName: document.getElementById('lastName').value.trim(),
      phone: '+256' + document.getElementById('phone').value.replace(/\s/g, ''),
      sex: document.getElementById('sex').value,
      location: document.getElementById('location').value,
      city: document.getElementById('city').value.trim(),
      hasFamily: document.getElementById('hasFamily').value === 'yes',
      familySize: document.getElementById('hasFamily').value === 'yes'
        ? parseInt(document.getElementById('familySize').value)
        : 0,
      healthGoals: Array.from(selectedGoals),
    };

    console.log('Sign Up Data:', formData);

    // Show success modal
    successModal.classList.add('visible');
  });

  modalClose.addEventListener('click', () => {
    successModal.classList.remove('visible');
  });
});
