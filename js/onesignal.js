/**
 * Homatt Health — OneSignal Push Notifications
 *
 * Provider  : OneSignal (onesignal-cordova-plugin v5)
 * App ID    : stored in android/app/src/main/res/values/strings.xml
 * REST Key  : stored as Supabase secret ONESIGNAL_REST_API_KEY
 *
 * Notification payload schema:
 *   { screen: 'appointment', id: '...' }
 *   { screen: 'prescription', id: '...' }
 *   { screen: 'lab_result', id: '...' }
 *   { screen: 'shop_order', id: '...' }
 *   { screen: 'medicine_order', id: '...' }
 */

const ONESIGNAL_APP_ID = 'eb88a928-4a93-4713-9bab-027fd1fbf181';

// Screen → URL mapping for notification tap navigation
const SCREEN_URLS = {
  appointment:    'clinic-booking.html',
  prescription:   'medicine-orders.html',
  lab_result:     'clinic-booking.html',
  shop_order:     'family.html',
  medicine_order: 'medicine-orders.html',
  dashboard:      'dashboard.html',
};

function navigateToScreen(data) {
  if (!data) return;
  const screen = data.screen || data.type;
  const id = data.id;
  const url = SCREEN_URLS[screen] || 'dashboard.html';
  // Append id as query param so the target page can highlight/open the item
  window.location.href = id ? `${url}?notif_id=${id}&screen=${screen}` : url;
}

function initOneSignal() {
  if (typeof window.plugins === 'undefined' || !window.plugins.OneSignal) {
    // Running in browser / PWA — OneSignal native plugin not available, skip silently
    return;
  }

  try {
    const OS = window.plugins.OneSignal;

    // 1. Initialize with App ID
    OS.initialize(ONESIGNAL_APP_ID);

    // 2. Request notification permission (non-blocking — don't await)
    OS.Notifications.requestPermission(true).catch(() => {});

    // 3. Handle notification tap — navigate to the correct screen
    OS.Notifications.addEventListener('click', (event) => {
      try {
        const data = event?.notification?.additionalData || event?.data || {};
        navigateToScreen(data);
      } catch (e) {
        console.error('[OneSignal] click handler error:', e);
      }
    });

    // 4. Handle foreground notifications — show a toast instead of system notification
    OS.Notifications.addEventListener('foregroundWillDisplay', (event) => {
      try {
        // Let the notification display normally
        event.getNotification().display();
      } catch (e) {}
    });

    console.log('[OneSignal] Initialized');
  } catch (e) {
    console.error('[OneSignal] Init error:', e);
  }
}

/**
 * Call after successful Supabase login to link push tokens to this user.
 * @param {string} supabaseUserId — the Supabase auth user UUID
 */
function oneSignalLogin(supabaseUserId) {
  if (!supabaseUserId) return;
  try {
    const OS = window.plugins?.OneSignal;
    if (OS) OS.login(supabaseUserId);
  } catch (e) {
    console.error('[OneSignal] login error:', e);
  }
}

/**
 * Call on logout to unlink push tokens from this user.
 */
function oneSignalLogout() {
  try {
    const OS = window.plugins?.OneSignal;
    if (OS) OS.logout();
  } catch (e) {
    console.error('[OneSignal] logout error:', e);
  }
}

// Initialize after Capacitor/Cordova bridge is ready
if (typeof window !== 'undefined') {
  document.addEventListener('deviceready', initOneSignal, false);
  // Also try immediately in case deviceready already fired (page loaded late)
  if (document.readyState === 'complete') {
    setTimeout(() => {
      if (typeof window.plugins !== 'undefined' && window.plugins.OneSignal) {
        initOneSignal();
      }
    }, 500);
  }
}
