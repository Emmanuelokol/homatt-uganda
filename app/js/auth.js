/**
 * Homatt Health — Google OAuth Authentication
 */

document.addEventListener('DOMContentLoaded', async () => {
  const cfg = window.HOMATT_CONFIG || {};
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // Status bar time
  const statusTime = document.getElementById('statusTime');
  if (statusTime) {
    const updateTime = () => {
      const n = new Date();
      statusTime.textContent =
        `${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}`;
    };
    updateTime();
    setInterval(updateTime, 30000);
  }

  const authLoading = document.getElementById('authLoading');
  const signInUI   = document.getElementById('signInUI');
  const authError  = document.getElementById('authError');

  function showError(msg) {
    authError.textContent = msg;
    authError.classList.add('visible');
  }

  function showSignInUI() {
    authLoading.style.display = 'none';
    signInUI.style.display = 'block';
  }

  // ── Handle profile creation / caching after sign-in ──────────────────────
  async function handlePostLogin(session) {
    try {
      // Check if profile exists
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!existing) {
        // First-time Google sign-in: create profile from Google metadata
        const meta = session.user.user_metadata || {};
        const fullName = (meta.full_name || meta.name || '').trim();
        const parts = fullName.split(' ');
        const firstName = parts[0] || 'User';
        const lastName  = parts.slice(1).join(' ') || '';
        const avatarUrl = meta.avatar_url || meta.picture || null;

        await supabase.from('profiles').insert({
          id:         session.user.id,
          first_name: firstName,
          last_name:  lastName,
          avatar_url: avatarUrl,
        });

        localStorage.setItem('homatt_user', JSON.stringify({
          firstName, lastName, avatarUrl,
        }));
        localStorage.setItem('homatt_session', JSON.stringify({
          userId:     session.user.id,
          first_name: firstName,
          last_name:  lastName,
          name:       (firstName + ' ' + lastName).trim(),
        }));
      } else {
        // Returning user: load and cache full profile
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile) {
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
            avatarUrl:   profile.avatar_url,
          }));
          localStorage.setItem('homatt_session', JSON.stringify({
            userId:       session.user.id,
            first_name:   profile.first_name,
            last_name:    profile.last_name,
            name:         ((profile.first_name || '') + ' ' + (profile.last_name || '')).trim(),
            phone_number: profile.phone_number,
            district:     profile.district,
          }));
        }
      }

      // Link OneSignal push token to this user
      if (typeof oneSignalLogin === 'function') oneSignalLogin(session.user.id);

      window.location.href = 'dashboard.html';
    } catch (err) {
      console.error('[Auth] Post-login error:', err);
      showSignInUI();
      showError('Something went wrong. Please try again.');
    }
  }

  // ── Check existing session first ─────────────────────────────────────────
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await handlePostLogin(session);
      return;
    }
  } catch (e) {
    console.warn('[Auth] Session check failed:', e.message);
  }

  // ── Listen for OAuth redirect callback ───────────────────────────────────
  supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      await handlePostLogin(session);
    }
  });

  // No session — show the sign-in UI
  showSignInUI();

  // ── Google Sign-In button ─────────────────────────────────────────────────
  const googleBtn = document.getElementById('googleSignInBtn');
  if (googleBtn) {
    googleBtn.addEventListener('click', async () => {
      googleBtn.disabled = true;
      googleBtn.innerHTML = `
        <span class="material-icons-outlined" style="font-size:20px;animation:spin 1s linear infinite">refresh</span>
        Opening Google…
      `;
      authError.classList.remove('visible');

      // Redirect URL: come back to this page so we can handle the session
      const redirectTo = window.location.origin + '/signin.html';

      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });

      if (error) {
        googleBtn.disabled = false;
        googleBtn.innerHTML = `
          <svg viewBox="0 0 24 24" style="width:22px;height:22px;flex-shrink:0" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Continue with Google
        `;
        showError('Google sign-in failed: ' + error.message);
      }
    });
  }
});
