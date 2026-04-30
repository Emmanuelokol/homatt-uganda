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
  home:                   'dashboard.html',
  dashboard:              'dashboard.html',
  bookings:               'clinic-booking.html',
  appointment:            'clinic-booking.html',
  'book-followup':        'clinic-booking.html',
  prescription:           'medicine-orders.html',
  lab_result:             'clinic-booking.html',
  orders:                 'medicine-orders.html',
  medicine_order:         'medicine-orders.html',
  shop_order:             'shop.html',
  'prevention-shop':      'shop.html',
  'health-tracker':       'dashboard.html',
  // 'complete-payment' screen removed — MTN/Airtel MoMo integration is not live yet,
  // so any "please pay via mobile money" push would deep-link nowhere. Reinstate once
  // the wallet top-up flow is wired through relworx-payment.
  'recovery-check':       'dashboard.html',
  'symptom-checkin':      'symptom-checker.html',
  'prescription-checkin': 'symptom-checker.html',
};

// ── Deep link navigation ──────────────────────────────────────
function navigateToScreen(data) {
  if (!data) return;
  const screen      = data.screen || data.type;
  const id          = data.id;
  const clinicId    = data.clinic_id;
  const feeling     = data.feeling;      // set when a notification action button is tapped
  const checkinType = data.checkin_type; // dose_checkin / mid_course / end_of_course
  const drug        = data.drug;         // drug name for dose check-ins

  let url = SCREEN_URLS[screen] || 'dashboard.html';

  // Build query string
  const params = new URLSearchParams();
  if (id)          params.set('notif_id', id);
  if (screen)      params.set('screen', screen);
  if (clinicId)    params.set('clinic_id', clinicId);
  if (feeling)     params.set('feeling', feeling);
  if (checkinType) params.set('checkin_type', checkinType);
  if (drug)        params.set('drug', drug);

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

    const { error: saveErr } = await client
      .from('profiles')
      .update({ onesignal_player_id: playerId })
      .eq('id', session.user.id);

    // Always cache in localStorage as a fast local backup
    localStorage.setItem('homatt_onesignal_player_id', playerId);

    if (saveErr) {
      // Most common cause: onesignal_player_id column doesn't exist yet.
      // Apply supabase/migrations/20260415_fix_missing_clinic_columns.sql in Supabase SQL Editor.
      console.warn('[OneSignal] player_id DB save FAILED (cached in localStorage):', saveErr.message);
    } else {
      console.log('[OneSignal] player_id saved to profiles + localStorage:', playerId.slice(0, 8) + '…');
    }
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
let _oneSignalReady = false;

function initOneSignal() {
  if (typeof window.plugins === 'undefined' || !window.plugins.OneSignal) {
    return; // Not running inside Capacitor — skip silently
  }
  if (_oneSignalReady) return; // already initialised
  _oneSignalReady = true;

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
        const id = event?.current?.id || event?.to?.id || OS.User.pushSubscription.id;
        if (id) {
          console.log('[OneSignal] player_id (change):', id);
          savePlayerIdToSupabase(id);
        }
      } catch (e) {
        console.warn('[OneSignal] subscription change error:', e);
      }
    });

    // Try immediately — for already-subscribed devices the change event won't fire
    try {
      const existingId = OS.User.pushSubscription.id;
      if (existingId) {
        console.log('[OneSignal] player_id (immediate):', existingId);
        savePlayerIdToSupabase(existingId);
      }
    } catch (_) {}

    // Retry with backoff — pushSubscription.id may be null until the native SDK
    // has finished registering, even if permission was already granted.
    (function _retryPlayerIdCapture(attempt) {
      if (attempt > 6) return; // max ~2 min total
      const delay = Math.min(3000 * attempt, 30000); // 3s, 6s, 9s, 12s, 15s, 18s
      setTimeout(() => {
        try {
          const id = OS.User.pushSubscription.id;
          if (id) {
            console.log('[OneSignal] player_id (retry ' + attempt + '):', id);
            savePlayerIdToSupabase(id);
          } else {
            _retryPlayerIdCapture(attempt + 1);
          }
        } catch (_) { _retryPlayerIdCapture(attempt + 1); }
      }, delay);
    })(1);

    // 4. Handle notification tap — navigate to the correct screen
    OS.Notifications.addEventListener('click', (event) => {
      try {
        const data     = event?.notification?.additionalData || event?.data || {};
        // action is set when a notification action button (Better/Same/Worse) is tapped
        const actionId = event?.action || event?.result?.actionId || '';

        if (actionId && actionId.startsWith('feeling_')) {
          const feeling = actionId.replace('feeling_', ''); // better / same / worse
          // Pass the notification data (contains booking id) alongside the feeling
          // so symptom-checker.js can link the response back to the prescription.
          navigateToScreen({ ...data, screen: 'prescription-checkin', feeling });
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
    // Ensure SDK is initialised — critical when this is called from dashboard
    // (auto-login bypasses signin.html so initOneSignal may not have run yet)
    if (!_oneSignalReady) initOneSignal();
    // Link this device to the Supabase user ID as the external_id
    OS.login(supabaseUserId);
    // Set a Data Tag — this is the most reliable targeting method.
    // The edge function filters by tag uid=<userId> which works even before
    // OS.login() has synced with OneSignal's servers.
    OS.User.addTag('uid', supabaseUserId);
    console.log('[OneSignal] OS.login + addTag(uid) called for', supabaseUserId.slice(0, 8) + '…');
    // Save player_id with backoff — subscription.id may not be available immediately
    const _trySave = (attempt) => {
      setTimeout(() => {
        try {
          const id = OS.User.pushSubscription.id;
          if (id) {
            savePlayerIdToSupabase(id);
          } else if (attempt < 5) {
            _trySave(attempt + 1);
          }
        } catch (_) {}
      }, 2000 * attempt);
    };
    _trySave(1);
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
// initOneSignal is safe to call multiple times — _oneSignalReady guard prevents re-init.
// We try four triggers because in a Capacitor WebView the exact timing of deviceready
// vs page-load events varies:
//   1. deviceready — fires once when Capacitor bridge is ready (caught on the FIRST page)
//   2. DOMContentLoaded — useful when onesignal.js loads mid-navigation
//   3. setTimeout fallback — catches the case where readyState is already 'complete'
//      and both event listeners have been missed (e.g. auto-login redirect path)
if (typeof window !== 'undefined') {
  document.addEventListener('deviceready',       initOneSignal, false);
  document.addEventListener('DOMContentLoaded',  initOneSignal, false);
  if (document.readyState === 'interactive' || document.readyState === 'complete') {
    setTimeout(initOneSignal, 500);
  }
}
