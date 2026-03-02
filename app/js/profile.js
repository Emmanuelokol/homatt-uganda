/**
 * Homatt Health — Profile Page
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Auth check
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { window.location.href = 'signin.html'; return; }

  // Status bar time
  function updateTime() {
    const n = new Date();
    document.getElementById('statusTime').textContent =
      `${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}`;
  }
  updateTime();
  setInterval(updateTime, 30000);

  // Load profile
  let user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', session.user.id)
    .single();

  if (profile) {
    user = {
      id: session.user.id,
      firstName: profile.first_name,
      lastName: profile.last_name,
      phone: profile.phone_number,
      dob: profile.dob,
      sex: profile.sex,
      district: profile.district,
      city: profile.city,
      hasFamily: profile.has_family,
      familySize: profile.family_size,
      healthGoals: profile.health_goals || [],
    };
    localStorage.setItem('homatt_user', JSON.stringify(user));
  }

  renderProfile(user);

  function renderProfile(u) {
    const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'User';
    const phoneFormatted = u.phone ? `+256 ${u.phone}` : '';
    const districtLabel = u.district ? u.district.charAt(0).toUpperCase() + u.district.slice(1).replace(/_/g,' ') : '';
    const location = [districtLabel, u.city].filter(Boolean).join(', ') || 'Uganda';

    // Header hero
    const avatarEl = document.getElementById('profileAvatarLg');
    const initial = (u.firstName || 'U').charAt(0).toUpperCase();
    avatarEl.innerHTML = `<span style="font-size:32px;font-weight:700">${initial}</span>` +
      `<button class="profile-avatar-edit-btn" id="avatarEditBtn" title="Change photo"><span class="material-icons-outlined">photo_camera</span></button>`;

    document.getElementById('profileFullName').textContent = fullName;
    document.getElementById('profilePhone').textContent = phoneFormatted;
    document.getElementById('locationText').textContent = location;

    // Info rows
    document.getElementById('infoName').textContent = fullName;
    document.getElementById('infoDob').textContent = formatDob(u.dob);
    document.getElementById('infoSex').textContent = u.sex ? (u.sex.charAt(0).toUpperCase() + u.sex.slice(1)) : '—';
    document.getElementById('infoLocation').textContent = location || '—';
    document.getElementById('infoPhone').textContent = phoneFormatted || '—';

    // Health goals
    const goalLabels = {
      weight: 'Weight Management', nutrition: 'Better Nutrition',
      fitness: 'Stay Fit & Active', mental: 'Mental Wellness',
      chronic: 'Manage Chronic Illness', maternal: 'Maternal Health',
      preventive: 'Preventive Care', family_health: 'Family Health',
    };
    const goals = Array.isArray(u.healthGoals) ? u.healthGoals : [];
    const goalsEl = document.getElementById('goalsChips');
    if (goals.length > 0) {
      goalsEl.innerHTML = goals.map(g =>
        `<span class="goal-chip-ro">${goalLabels[g] || g}</span>`
      ).join('');
    } else {
      goalsEl.innerHTML = '<span style="font-size:12px;color:var(--text-hint);padding:4px 0">No health goals set</span>';
    }

    // Pre-fill edit form
    document.getElementById('editFirstName').value = u.firstName || '';
    document.getElementById('editLastName').value = u.lastName || '';
    document.getElementById('editDistrict').value = u.district || '';
    document.getElementById('editCity').value = u.city || '';
  }

  function formatDob(dob) {
    if (!dob) return '—';
    const d = new Date(dob);
    return d.toLocaleDateString('en-UG', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  // ====== Notifications toggle ======
  const notifToggle = document.getElementById('notifToggle');
  let notifOn = localStorage.getItem('homatt_notif') !== 'off';
  if (!notifOn) notifToggle.classList.remove('on');

  notifToggle.addEventListener('click', () => {
    notifOn = !notifOn;
    notifToggle.classList.toggle('on', notifOn);
    localStorage.setItem('homatt_notif', notifOn ? 'on' : 'off');
    showToast(notifOn ? 'Reminders enabled' : 'Reminders disabled');
  });

  // ====== Edit Profile Sheet ======
  const overlay = document.getElementById('sheetOverlay');
  const editSheet = document.getElementById('editProfileSheet');

  function openSheet(sheet) {
    overlay.classList.add('visible');
    sheet.classList.add('open');
  }
  function closeSheet(sheet) {
    overlay.classList.remove('visible');
    sheet.classList.remove('open');
  }

  document.getElementById('editProfileBtn').addEventListener('click', () => openSheet(editSheet));
  document.getElementById('closeEditSheet').addEventListener('click', () => closeSheet(editSheet));
  overlay.addEventListener('click', () => {
    closeSheet(editSheet);
  });

  document.getElementById('saveProfileBtn').addEventListener('click', async () => {
    const firstName = document.getElementById('editFirstName').value.trim();
    const lastName = document.getElementById('editLastName').value.trim();
    const district = document.getElementById('editDistrict').value;
    const city = document.getElementById('editCity').value.trim();

    if (!firstName) { showToast('First name is required'); return; }

    const saveBtn = document.getElementById('saveProfileBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 1s linear infinite">refresh</span> Saving...';

    const { error } = await supabase
      .from('profiles')
      .update({ first_name: firstName, last_name: lastName, district, city })
      .eq('id', session.user.id);

    saveBtn.disabled = false;
    saveBtn.innerHTML = '<span class="material-icons-outlined">save</span> Save Changes';

    if (error) {
      showToast('Failed to save. Try again.');
      return;
    }

    user.firstName = firstName;
    user.lastName = lastName;
    user.district = district;
    user.city = city;
    localStorage.setItem('homatt_user', JSON.stringify(user));

    renderProfile(user);
    closeSheet(editSheet);
    showToast('Profile updated successfully!');
  });

  // ====== Logout ======
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    const btn = document.getElementById('logoutBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Signing out...';

    await supabase.auth.signOut();
    localStorage.removeItem('homatt_user');
    localStorage.removeItem('homatt_wallets');
    localStorage.removeItem('homatt_quiz_streak');
    window.location.href = 'signin.html';
  });

  // ====== Toast ======
  function showToast(msg) {
    const t = document.getElementById('profileToast');
    t.textContent = msg;
    t.classList.add('visible');
    setTimeout(() => t.classList.remove('visible'), 2800);
  }
});
