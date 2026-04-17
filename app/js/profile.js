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
  const privacySheet = document.getElementById('privacySheet');
  const faqSheet = document.getElementById('faqSheet');

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
  document.getElementById('closePrivacySheet').addEventListener('click', closeAllSheets);
  document.getElementById('closeFaqSheet').addEventListener('click', closeAllSheets);

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
  const EMERGENCY_HTML = `
    <div style="background:#FFEBEE;border-radius:var(--radius-md);padding:12px 14px;margin-bottom:14px;border-left:4px solid #D32F2F">
      <div style="font-size:12px;font-weight:700;color:#D32F2F;margin-bottom:6px;display:flex;align-items:center;gap:6px">
        <span class="material-icons-outlined" style="font-size:16px">warning</span>
        If someone's life is in danger, call immediately.
      </div>
      <p style="font-size:12px;color:#5F6368;line-height:1.6;margin:0">These are Uganda national emergency numbers. Save them on your phone now.</p>
    </div>
    <a href="tel:999" style="display:flex;align-items:center;gap:12px;background:#D32F2F;color:#fff;padding:14px 16px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:8px;touch-action:manipulation">
      <span class="material-icons-outlined">local_police</span><div><div>999 — Police</div><div style="font-size:11px;font-weight:400;opacity:.9">Uganda Police Force — tap to call</div></div>
    </a>
    <a href="tel:0800200999" style="display:flex;align-items:center;gap:12px;background:#C62828;color:#fff;padding:14px 16px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:8px;touch-action:manipulation">
      <span class="material-icons-outlined">local_hospital</span><div><div>0800 200 999 — Ambulance</div><div style="font-size:11px;font-weight:400;opacity:.9">Toll-free — tap to call</div></div>
    </a>
    <a href="tel:0414530020" style="display:flex;align-items:center;gap:12px;background:#B71C1C;color:#fff;padding:14px 16px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:8px;touch-action:manipulation">
      <span class="material-icons-outlined">emergency</span><div><div>Mulago National Referral Hospital</div><div style="font-size:11px;font-weight:400;opacity:.9">+256 414 530 020 — tap to call</div></div>
    </a>
    <a href="tel:0414258701" style="display:flex;align-items:center;gap:12px;background:#E53935;color:#fff;padding:14px 16px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;margin-bottom:8px;touch-action:manipulation">
      <span class="material-icons-outlined">volunteer_activism</span><div><div>Uganda Red Cross</div><div style="font-size:11px;font-weight:400;opacity:.9">+256 414 258 701 — tap to call</div></div>
    </a>
    <a href="tel:+256708520466" style="display:flex;align-items:center;gap:12px;background:#1B5E20;color:#fff;padding:14px 16px;border-radius:12px;text-decoration:none;font-weight:700;font-size:14px;touch-action:manipulation">
      <span class="material-icons-outlined">support_agent</span><div><div>Homatt Health Support</div><div style="font-size:11px;font-weight:400;opacity:.9">+256 708 520 466 — tap to call</div></div>
    </a>`;

  document.getElementById('emergencyBtn').addEventListener('click', async () => {
    openSheet(emergencySheet);
    const bodyEl = document.getElementById('emergencySheetBody');
    // Show static content immediately — don't make user wait
    bodyEl.innerHTML = EMERGENCY_HTML;
    // Try to load extra content from Supabase (non-blocking)
    if (supabase) {
      supabase.from('site_content').select('content').eq('key', 'emergency').maybeSingle()
        .then(({ data }) => {
          if (data?.content) {
            const extra = document.createElement('div');
            extra.style.cssText = 'background:#FFF8E1;border-radius:var(--radius-md);padding:12px 14px;margin-top:12px;font-size:12px;color:#5F6368;line-height:1.7;white-space:pre-line;border-left:4px solid #FFD54F';
            extra.textContent = data.content;
            bodyEl.appendChild(extra);
          }
        }).catch(() => {});
    }
  });

  // ====== Terms of Service ======
  const TERMS_STATIC = `Homatt Health Uganda — Terms of Service

Last updated: April 2026

1. Acceptance
By using Homatt Health you agree to these terms. If you do not agree, do not use the app.

2. Medical Disclaimer
Homatt Health provides health information and AI-assisted triage for guidance only. It is NOT a substitute for professional medical advice, diagnosis, or treatment. Always consult a qualified health professional for medical decisions.

3. Use of the App
You must be 18 or older (or have parental consent) to use this app. You agree not to misuse the service or provide false health information.

4. Privacy
We collect health data to provide personalised services. See our Privacy Policy for details. Your data is stored securely and never sold to third parties.

5. Liability
To the maximum extent permitted by Ugandan law, Homatt Health Uganda Ltd is not liable for medical outcomes resulting from use of AI triage or information provided in the app.

6. Changes
We may update these terms. Continued use after changes means you accept the new terms.

7. Governing Law
These terms are governed by the laws of the Republic of Uganda.

Contact: support@homatt.ug | +256 708 520 466`;

  document.getElementById('termsBtn').addEventListener('click', async () => {
    openSheet(termsSheet);
    const bodyEl = document.getElementById('termsSheetBody');
    bodyEl.innerHTML = `<p style="font-size:13px;color:var(--text-secondary);line-height:1.9;white-space:pre-line">${TERMS_STATIC}</p>`;
    // Try to fetch live version
    if (supabase) {
      supabase.from('site_content').select('title,content,updated_at').eq('key', 'terms').maybeSingle()
        .then(({ data }) => {
          if (data?.content) {
            const updatedDate = data.updated_at ? new Date(data.updated_at).toLocaleDateString('en-UG', {year:'numeric',month:'long',day:'numeric'}) : '';
            bodyEl.innerHTML = `
              <p style="font-size:11px;color:var(--text-hint);margin-bottom:14px">Last updated: ${updatedDate}</p>
              <p style="font-size:13px;color:var(--text-secondary);line-height:1.9">${data.content}</p>`;
          }
        }).catch(() => {});
    }
  });

  // ====== Privacy Policy ======
  const PRIVACY_STATIC = `Homatt Health Uganda — Privacy Policy

Last updated: April 2026

1. Information We Collect
• Personal information: name, date of birth, sex, phone number, district
• Health data: symptoms, diagnoses, medicine orders, tracker entries
• Device data: push notification token (OneSignal player ID)

2. How We Use Your Information
• To provide AI-assisted health triage and clinic recommendations
• To process medicine orders and deliveries
• To send appointment and medication reminders (you can opt out any time)
• To improve our services through anonymised analytics

3. Data Storage & Security
Your data is stored on Supabase (EU-West data centre) using AES-256 encryption at rest. We use HTTPS for all data in transit. Access is restricted to authorised Homatt staff only.

4. Sharing of Data
We do NOT sell your personal data. We share data only with:
• Clinics and pharmacies you book with (for service delivery)
• Payment processors (MTN, Airtel) for transaction verification

5. Your Rights
You have the right to access, correct, or delete your data at any time. Contact us at support@homatt.ug to make a request.

6. Children
Users under 18 must have parental consent. Child growth tracking data is linked to the parent's account.

7. Contact
Homatt Health Uganda Ltd
support@homatt.ug | +256 708 520 466`;

  document.getElementById('privacyBtn').addEventListener('click', async () => {
    openSheet(privacySheet);
    const bodyEl = document.getElementById('privacySheetBody');
    bodyEl.innerHTML = `<p style="font-size:13px;color:var(--text-secondary);line-height:1.9;white-space:pre-line">${PRIVACY_STATIC}</p>`;
    if (supabase) {
      supabase.from('site_content').select('content,updated_at').eq('key', 'privacy').maybeSingle()
        .then(({ data }) => {
          if (data?.content) {
            const updatedDate = data.updated_at ? new Date(data.updated_at).toLocaleDateString('en-UG', {year:'numeric',month:'long',day:'numeric'}) : '';
            bodyEl.innerHTML = `
              <p style="font-size:11px;color:var(--text-hint);margin-bottom:14px">Last updated: ${updatedDate}</p>
              <p style="font-size:13px;color:var(--text-secondary);line-height:1.9">${data.content}</p>`;
          }
        }).catch(() => {});
    }
  });

  // ====== FAQ ======
  const FAQ_ITEMS = [
    { q: 'What is Homatt Health?', a: 'Homatt Health is a Ugandan digital health platform that helps you assess symptoms using AI, book nearby clinics, order medicines, and track your health — all from your phone.' },
    { q: 'Is the AI symptom checker a real diagnosis?', a: 'No. The AI provides a preliminary assessment based on your symptoms. It is NOT a medical diagnosis. Always visit a qualified doctor or clinic to confirm any health concern.' },
    { q: 'How do I order medicines?', a: 'Tap "Order Medicines" on the home screen. Choose your medicines, enter your delivery address, select a pharmacy nearby, and pay. Your medicines are delivered by a Homatt rider.' },
    { q: 'How do I book a clinic?', a: 'Use "Check My Health" to enter your symptoms. After the AI assessment, you will see a list of nearby clinics with fees. Tap a clinic to book an appointment.' },
    { q: 'Is my health data safe?', a: 'Yes. All data is encrypted and stored securely. We never sell your personal or health data to third parties. See our Privacy Policy for details.' },
    { q: 'How do health trackers work?', a: 'Trackers (Malaria, Cycle, Mood & Sleep, Pain, Digestive, Child Growth) let you log daily health entries. The app uses your entries to detect patterns and alert you when something needs attention.' },
    { q: 'How do I update my profile?', a: 'Go to Profile (bottom navigation) and tap the edit icon (pencil) in the top right. You can update your name, district, and phone number.' },
    { q: 'How do I turn off notifications?', a: 'Go to Profile → Settings → Notification Settings. You can turn off individual notification types (appointments, medicine reminders, etc.).' },
    { q: 'What payment methods are accepted?', a: 'We accept MTN Mobile Money, Airtel Money, Pay on Delivery (cash), Bank Transfer (Stanbic, ABSA, Centenary), and Homatt Wallet.' },
    { q: 'How do I contact support?', a: 'Go to Profile → Help & Support → Contact Support. You can call us on +256 708 520 466 or submit a support request form.' },
  ];

  document.getElementById('faqBtn').addEventListener('click', () => {
    openSheet(faqSheet);
    const bodyEl = document.getElementById('faqSheetBody');
    bodyEl.innerHTML = FAQ_ITEMS.map((item, i) => `
      <div style="border-bottom:1px solid var(--border);padding:12px 0" id="faqItem${i}">
        <button type="button" onclick="(function(el){var ans=el.nextElementSibling;var open=ans.style.display==='block';ans.style.display=open?'none':'block';el.querySelector('.faq-chev').textContent=open?'expand_more':'expand_less';})(this)"
          style="width:100%;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;background:none;border:none;padding:0;cursor:pointer;text-align:left;font-family:inherit;touch-action:manipulation">
          <span style="font-size:13px;font-weight:600;color:var(--text-primary);line-height:1.4">${item.q}</span>
          <span class="material-icons-outlined faq-chev" style="font-size:20px;color:var(--primary);flex-shrink:0">expand_more</span>
        </button>
        <div style="display:none;font-size:13px;color:var(--text-secondary);line-height:1.7;padding-top:8px">${item.a}</div>
      </div>`).join('');
  });

  // ====== Logout ======
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    const btn = document.getElementById('logoutBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="material-icons-outlined">hourglass_empty</span> Signing out...';

    // Unlink push token from this user before signing out
    if (typeof oneSignalLogout === 'function') oneSignalLogout();

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
