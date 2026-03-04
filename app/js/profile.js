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

  // Load profile from cache then server
  let user = JSON.parse(localStorage.getItem('homatt_user') || '{}');
  renderProfile(user); // render immediately from cache

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
      avatarUrl: profile.avatar_url || null,
    };
    localStorage.setItem('homatt_user', JSON.stringify(user));
    renderProfile(user);
  }

  // Wallet balance preview in Finance section
  const wallets = JSON.parse(localStorage.getItem('homatt_wallets') || '{"family":0,"care":0}');
  const totalBal = (wallets.family || 0) + (wallets.care || 0);
  const walletPreview = document.getElementById('walletPreviewBalance');
  if (walletPreview) walletPreview.textContent = `UGX ${totalBal.toLocaleString()}`;

  function renderProfile(u) {
    const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'User';
    const phoneFormatted = u.phone ? `+256 ${u.phone}` : '';
    const districtLabel = u.district ? u.district.charAt(0).toUpperCase() + u.district.slice(1).replace(/_/g,' ') : '';
    const location = [districtLabel, u.city].filter(Boolean).join(', ') || 'Uganda';

    // Header hero — show uploaded photo or initials
    const avatarEl = document.getElementById('profileAvatarLg');
    const initial = (u.firstName || 'U').charAt(0).toUpperCase();
    if (u.avatarUrl) {
      avatarEl.innerHTML =
        `<img src="${u.avatarUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` +
        `<button class="profile-avatar-edit-btn" id="avatarEditBtn" title="Change photo"><span class="material-icons-outlined">photo_camera</span></button>`;
    } else {
      avatarEl.innerHTML =
        `<span style="font-size:32px;font-weight:700">${initial}</span>` +
        `<button class="profile-avatar-edit-btn" id="avatarEditBtn" title="Change photo"><span class="material-icons-outlined">photo_camera</span></button>`;
    }

    // Bind avatar edit button
    document.getElementById('avatarEditBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      document.getElementById('avatarInput').click();
    });

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

  // ====== Avatar Photo Upload ======
  document.getElementById('avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Image must be under 5MB'); return; }

    showToast('Uploading photo...');
    const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
    const path = `${session.user.id}/avatar.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) { showToast('Upload failed: ' + uploadError.message); return; }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    const avatarUrl = publicUrl + '?t=' + Date.now(); // cache bust

    await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', session.user.id);

    user.avatarUrl = avatarUrl;
    localStorage.setItem('homatt_user', JSON.stringify(user));
    renderProfile(user);
    showToast('Profile photo updated!');
  });

  // ====== Dark Mode Toggle ======
  const darkToggle = document.getElementById('darkModeToggle');
  let darkOn = localStorage.getItem('homatt_theme') === 'dark';
  darkToggle.classList.toggle('on', darkOn);

  darkToggle.addEventListener('click', () => {
    darkOn = !darkOn;
    darkToggle.classList.toggle('on', darkOn);

    // Smooth fade transition — briefly hide frame, switch theme, restore
    const frame = document.querySelector('.phone-frame');
    if (frame) {
      frame.classList.add('theme-transitioning');
      setTimeout(() => {
        if (darkOn) {
          document.documentElement.setAttribute('data-theme', 'dark');
          localStorage.setItem('homatt_theme', 'dark');
        } else {
          document.documentElement.removeAttribute('data-theme');
          localStorage.setItem('homatt_theme', 'light');
        }
        setTimeout(() => frame.classList.remove('theme-transitioning'), 30);
      }, 120);
    } else {
      if (darkOn) {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('homatt_theme', 'dark');
      } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('homatt_theme', 'light');
      }
    }
    showToast(darkOn ? 'Dark mode on' : 'Dark mode off');
  });

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

  // ====== Sheet Management ======
  const overlay = document.getElementById('sheetOverlay');
  const editSheet = document.getElementById('editProfileSheet');
  const supportSheet = document.getElementById('contactSupportSheet');
  const emergencySheet = document.getElementById('emergencySheet');
  const termsSheet = document.getElementById('termsSheet');

  function openSheet(sheet) {
    overlay.classList.add('visible');
    sheet.classList.add('open');
  }
  function closeAllSheets() {
    overlay.classList.remove('visible');
    document.querySelectorAll('.bottom-sheet').forEach(s => s.classList.remove('open'));
  }

  overlay.addEventListener('click', closeAllSheets);
  document.getElementById('editProfileBtn').addEventListener('click', () => openSheet(editSheet));
  document.getElementById('closeEditSheet').addEventListener('click', closeAllSheets);
  document.getElementById('closeSupportSheet').addEventListener('click', closeAllSheets);
  document.getElementById('closeEmergencySheet').addEventListener('click', closeAllSheets);
  document.getElementById('closeTermsSheet').addEventListener('click', closeAllSheets);

  // ====== Edit Profile ======
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

    if (error) { showToast('Failed to save. Try again.'); return; }

    user.firstName = firstName;
    user.lastName = lastName;
    user.district = district;
    user.city = city;
    localStorage.setItem('homatt_user', JSON.stringify(user));

    renderProfile(user);
    closeAllSheets();
    showToast('Profile updated successfully!');
  });

  // ====== Contact Support ======
  document.getElementById('supportBtn').addEventListener('click', () => openSheet(supportSheet));

  document.getElementById('submitSupportBtn').addEventListener('click', async () => {
    const subject = document.getElementById('supportSubject').value.trim();
    const message = document.getElementById('supportMessage').value.trim();
    const category = document.getElementById('supportCategory').value;

    if (!subject) { showToast('Please enter a subject'); return; }
    if (!message) { showToast('Please describe your issue'); return; }

    const btn = document.getElementById('submitSupportBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined" style="animation:spin 1s linear infinite">refresh</span> Sending...';

    const { error } = await supabase.from('support_tickets').insert({
      user_id: session.user.id,
      user_name: `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'User',
      user_phone: user.phone || null,
      category,
      subject,
      message,
      priority: category === 'emergency' ? 'urgent' : 'normal',
    });

    btn.disabled = false;
    btn.innerHTML = '<span class="material-icons-outlined">send</span> Submit Request';

    if (error) { showToast('Failed to send. Try again.'); return; }

    document.getElementById('supportSubject').value = '';
    document.getElementById('supportMessage').value = '';
    closeAllSheets();
    showToast('Support request sent! We\'ll respond within 24 hours.');
  });

  // ====== Emergency Contacts ======
  document.getElementById('emergencyBtn').addEventListener('click', async () => {
    openSheet(emergencySheet);
    const bodyEl = document.getElementById('emergencySheetBody');

    const { data } = await supabase.from('site_content').select('content').eq('key', 'emergency').single();
    if (data && data.content) {
      bodyEl.innerHTML = `
        <div style="background:#FFEBEE;border-radius:var(--radius-md);padding:14px;margin-bottom:16px;border-left:4px solid #D32F2F">
          <div style="font-size:12px;font-weight:700;color:#D32F2F;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <span class="material-icons-outlined" style="font-size:18px">emergency</span>
            Emergency Information
          </div>
          <p style="font-size:13px;color:#333;line-height:1.7;white-space:pre-line">${data.content}</p>
        </div>
        <a href="tel:999" style="display:flex;align-items:center;gap:12px;background:#D32F2F;color:white;padding:14px 16px;border-radius:var(--radius-md);text-decoration:none;font-weight:600;margin-bottom:10px">
          <span class="material-icons-outlined">phone</span> Call 999 — Police
        </a>
        <a href="tel:911" style="display:flex;align-items:center;gap:12px;background:#E65100;color:white;padding:14px 16px;border-radius:var(--radius-md);text-decoration:none;font-weight:600">
          <span class="material-icons-outlined">local_hospital</span> Call 911 — Ambulance
        </a>`;
    } else {
      bodyEl.innerHTML = '<p style="color:var(--text-hint);font-size:13px;text-align:center;padding:20px">Emergency contacts unavailable</p>';
    }
  });

  // ====== Terms of Service ======
  document.getElementById('termsBtn').addEventListener('click', async () => {
    openSheet(termsSheet);
    const bodyEl = document.getElementById('termsSheetBody');

    const { data } = await supabase.from('site_content').select('title,content,updated_at').eq('key', 'terms').single();
    if (data) {
      const updatedDate = data.updated_at ? new Date(data.updated_at).toLocaleDateString('en-UG', {year:'numeric',month:'long',day:'numeric'}) : '';
      bodyEl.innerHTML = `
        <p style="font-size:11px;color:var(--text-hint);margin-bottom:14px">Last updated: ${updatedDate}</p>
        <p style="font-size:13px;color:var(--text-secondary);line-height:1.8">${data.content}</p>`;
    } else {
      bodyEl.innerHTML = '<p style="color:var(--text-hint);font-size:13px;text-align:center;padding:20px">Terms unavailable</p>';
    }
  });

  // FAQ (inline)
  document.getElementById('faqBtn').addEventListener('click', () => {
    showToast('FAQ — Help centre coming soon!');
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
    localStorage.removeItem('homatt_cart');
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
