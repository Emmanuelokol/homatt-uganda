/**
 * Homatt Health — OneSignal Push Notifications
 *
 * Provider  : OneSignal (onesignal-cordova-plugin v5)
 * App ID    : stored in android/app/src/main/res/values/strings.xml
 * REST Key  : stored as Supabase secret ONESIGNAL_REST_API_KEY
 *
 * Responsibilities:
 *  1. Initialize OneSignal on app start
 *  2. Request push permission; show in-app banner if denied
 *  3. Capture OneSignal player ID and save to Supabase profiles
 *  4. Handle notification tap → navigate to the correct screen
 *  5. Expose oneSignalLogin / oneSignalLogout helpers
 */

// App ID is injected by CI into window.HOMATT_CONFIG.ONESIGNAL_APP_ID via config.js.
// The hardcoded fallback is only used for local development; production always uses the secret.
const ONESIGNAL_APP_ID =
  (window.HOMATT_CONFIG && window.HOMATT_CONFIG.ONESIGNAL_APP_ID) ||
  'eb88a928-4a93-4713-9bab-027fd1fbf181';

// ── Screen → URL mapping ──────────────────────────────────────
// Every push notification includes data.screen; map it to an app URL.
const SCREEN_URLS = {
  home:               'dashboard.html',
  dashboard:          'dashboard.html',
  bookings:           'clinic-booking.html',
  appointment:        'clinic-booking.html',
  'book-followup':    'clinic-booking.html',
  prescription:       'medicine-orders.html',
  lab_result:         'clinic-booking.html',
  orders:             'medicine-orders.html',
  medicine_order:     'medicine-orders.html',
  shop_order:         'shop.html',
  'prevention-shop':  'shop.html',
  'health-tracker':   'dashboard.html',
  'complete-payment': 'wallet.html',
  'recovery-check':   'dashboard.html',
  'symptom-checkin':  'dashboard.html',
};

// ── Deep link navigation ──────────────────────────────────────
function navigateToScreen(data) {
  if (!data) return;
  const screen   = data.screen || data.type;
  const id       = data.id;
  const clinicId = data.clinic_id;
  const feeling  = data.feeling; // set when a notification action button is tapped

  let url = SCREEN_URLS[screen] || 'dashboard.html';

  // Build query string
  const params = new URLSearchParams();
  if (id)       params.set('notif_id', id);
  if (screen)   params.set('screen', screen);
  if (clinicId) params.set('clinic_id', clinicId);
  if (feeling)  params.set('feeling', feeling);

  const qs = params.toString();
  window.location.href = qs ? `${url}?${qs}` : url;
}

// ── Save player ID to Supabase profiles ───────────────────────
async function savePlayerIdToSupabase(playerId) {
  if (!playerId) return;
  try {
    const cfg = window.HOMATT_CONFIG || {};
    if (!cfg.SUPABASE_URL || !window.supabase) return;

    const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user?.id) return;

    await client
      .from('profiles')
      .update({ onesignal_player_id: playerId })
      .eq('id', session.user.id);

    console.log('[OneSignal] player_id saved to Supabase profiles');
  } catch (e) {
    console.warn('[OneSignal] could not save player_id:', e);
  }
}

// ── Permission denied banner ──────────────────────────────────
function showPermissionDeniedBanner() {
  if (document.getElementById('_onesignalBanner')) return; // already shown
  const banner = document.createElement('div');
  banner.id = '_onesignalBanner';
  banner.style.cssText = [
    'position:fixed', 'bottom:72px', 'left:12px', 'right:12px',
    'background:#1565C0', 'color:#fff', 'border-radius:12px',
    'padding:12px 16px', 'display:flex', 'align-items:center',
    'gap:10px', 'z-index:9999', 'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
    'font-size:13px', 'line-height:1.4'
  ].join(';');
  banner.innerHTML = `
    <span class="material-icons-outlined" style="font-size:20px;flex-shrink:0">notifications_off</span>
    <span style="flex:1">Enable notifications to get medicine reminders and appointment alerts.</span>
    <button id="_onesignalBannerClose"
      style="background:none;border:none;color:#fff;cursor:pointer;padding:4px;flex-shrink:0">
      <span class="material-icons-outlined" style="font-size:18px">close</span>
    </button>`;
  document.body.appendChild(banner);

  document.getElementById('_onesignalBannerClose').addEventListener('click', () => {
    banner.remove();
    // Don't re-show for 7 days
    localStorage.setItem('_osPermBannerSnoozed', Date.now() + 7 * 24 * 3600 * 1000);
  });
}

function shouldShowPermBanner() {
  const snoozed = parseInt(localStorage.getItem('_osPermBannerSnoozed') || '0', 10);
  return Date.now() > snoozed;
}

// ── Core init ─────────────────────────────────────────────────
function initOneSignal() {
  if (typeof window.plugins === 'undefined' || !window.plugins.OneSignal) {
    return; // Not running inside Capacitor — skip silently
  }

  try {
    const OS = window.plugins.OneSignal;

    // 1. Initialise
    OS.initialize(ONESIGNAL_APP_ID);

    // 2. Request permission and handle response
    OS.Notifications.requestPermission(true).then((granted) => {
      if (!granted && shouldShowPermBanner()) {
        // Short delay so the page has finished rendering
        setTimeout(showPermissionDeniedBanner, 1500);
      }
    }).catch(() => {});

    // 3. Subscription observer — captures player ID whenever it changes
    OS.User.pushSubscription.addEventListener('change', (event) => {
      try {
        const id = event?.current?.id || event?.to?.id;
        if (id) {
          console.log('[OneSignal] player_id:', id);
          savePlayerIdToSupabase(id);
        }
      } catch (e) {
        console.warn('[OneSignal] subscription change error:', e);
      }
    });

    // Also try to get the player ID immediately (may already be subscribed)
    try {
      const existingId = OS.User.pushSubscription.id;
      if (existingId) savePlayerIdToSupabase(existingId);
    } catch (_) {}

    // 4. Handle notification tap — navigate to the correct screen
    OS.Notifications.addEventListener('click', (event) => {
      try {
        const data     = event?.notification?.additionalData || event?.data || {};
        // action is set when a notification action button (Better/Same/Worse) is tapped
        const actionId = event?.action || event?.result?.actionId || '';

        if (actionId && actionId.startsWith('feeling_')) {
          const feeling = actionId.replace('feeling_', ''); // better / same / worse
          navigateToScreen({ screen: 'symptom-checkin', feeling });
          return;
        }
        navigateToScreen(data);
      } catch (e) {
        console.error('[OneSignal] click handler error:', e);
      }
    });

    // 5. Handle foreground notifications — display them normally
    OS.Notifications.addEventListener('foregroundWillDisplay', (event) => {
      try {
        event.getNotification().display();
      } catch (_) {}
    });

    console.log('[OneSignal] Initialized');
  } catch (e) {
    console.error('[OneSignal] Init error:', e);
  }
}

// ── Auth helpers ──────────────────────────────────────────────

/**
 * Call after successful Supabase login.
 * Links push token to the Supabase user UUID via OneSignal external_id.
 * Also re-saves player_id in case it changed.
 * @param {string} supabaseUserId
 */
function oneSignalLogin(supabaseUserId) {
  if (!supabaseUserId) return;
  try {
    const OS = window.plugins?.OneSignal;
    if (!OS) return;
    OS.login(supabaseUserId);
    // Capture player_id after login
    setTimeout(() => {
      try {
        const id = OS.User.pushSubscription.id;
        if (id) savePlayerIdToSupabase(id);
      } catch (_) {}
    }, 2000);
  } catch (e) {
    console.error('[OneSignal] login error:', e);
  }
}

/**
 * Call before supabase.auth.signOut().
 * Does NOT delete the player_id from the database (user may log back in).
 */
function oneSignalLogout() {
  try {
    const OS = window.plugins?.OneSignal;
    if (OS) OS.logout();
  } catch (e) {
    console.error('[OneSignal] logout error:', e);
  }
}

// ── Boot ──────────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  document.addEventListener('deviceready', initOneSignal, false);
  if (document.readyState === 'complete') {
    setTimeout(() => {
      if (typeof window.plugins !== 'undefined' && window.plugins.OneSignal) {
        initOneSignal();
      }
    }, 500);
  }
}
