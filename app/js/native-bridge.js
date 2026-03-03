/**
 * Homatt Health — Native Bridge
 * Handles Capacitor plugin integration for Android features.
 * Safe to load on web (no-ops when Capacitor is not present).
 */

(function () {
  'use strict';

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform());
  }

  // ─── STATUS BAR ─────────────────────────────────────────────────────────────
  function initStatusBar() {
    if (!isNative()) return;
    const { StatusBar } = window.Capacitor.Plugins;
    if (!StatusBar) return;
    StatusBar.setStyle({ style: 'LIGHT' }).catch(() => {});
    StatusBar.setBackgroundColor({ color: '#1B5E20' }).catch(() => {});
  }

  // ─── SPLASH SCREEN ──────────────────────────────────────────────────────────
  function hideSplash() {
    if (!isNative()) return;
    const { SplashScreen } = window.Capacitor.Plugins;
    if (!SplashScreen) return;
    setTimeout(() => SplashScreen.hide({ fadeOutDuration: 300 }).catch(() => {}), 300);
  }

  // ─── BACK BUTTON ────────────────────────────────────────────────────────────
  function initBackButton() {
    if (!isNative()) return;
    const { App } = window.Capacitor.Plugins;
    if (!App) return;

    App.addListener('backButton', ({ canGoBack }) => {
      const openSheet = document.querySelector('.bottom-sheet.open, .modal.open, .overlay.active');
      if (openSheet) {
        // Close the open sheet/modal instead of going back
        openSheet.classList.remove('open', 'active');
        const overlays = document.querySelectorAll('.overlay');
        overlays.forEach(o => o.classList.remove('active'));
        return;
      }
      const dashboardPages = ['dashboard.html', 'index.html'];
      const currentPage = location.pathname.split('/').pop() || 'index.html';
      if (dashboardPages.includes(currentPage) || !canGoBack) {
        // On main page — show exit confirmation
        showExitDialog();
      } else {
        window.history.back();
      }
    });
  }

  let exitDialogShown = false;
  function showExitDialog() {
    if (exitDialogShown) {
      // Second press — exit
      const { App } = window.Capacitor.Plugins;
      if (App) App.exitApp();
      return;
    }
    exitDialogShown = true;
    // Show a small toast
    const toast = document.createElement('div');
    toast.textContent = 'Press back again to exit';
    toast.style.cssText = `
      position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
      background:rgba(0,0,0,0.8); color:#fff; padding:10px 20px;
      border-radius:20px; font-size:14px; z-index:9999; pointer-events:none;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.remove();
      exitDialogShown = false;
    }, 2500);
  }

  // ─── NETWORK STATUS ─────────────────────────────────────────────────────────
  function initNetwork() {
    if (!isNative()) return;
    const { Network } = window.Capacitor.Plugins;
    if (!Network) return;

    Network.addListener('networkStatusChange', (status) => {
      if (!status.connected) {
        showNetworkBanner('No internet connection');
      } else {
        hideNetworkBanner();
      }
    });
  }

  function showNetworkBanner(msg) {
    let banner = document.getElementById('_networkBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = '_networkBanner';
      banner.style.cssText = `
        position:fixed; top:0; left:0; right:0; z-index:10000;
        background:#F44336; color:#fff; text-align:center;
        padding:8px; font-size:13px; font-weight:500;
      `;
      document.body.appendChild(banner);
    }
    banner.textContent = msg;
    banner.style.display = 'block';
  }

  function hideNetworkBanner() {
    const banner = document.getElementById('_networkBanner');
    if (banner) banner.style.display = 'none';
  }

  // ─── CAMERA — Native wrapper ────────────────────────────────────────────────
  /**
   * Opens camera or gallery using Capacitor Camera plugin (native) or
   * falls back to <input type="file"> on web.
   * Returns a { webPath, dataUrl } object or null.
   */
  window.HomattCamera = {
    async pickImage(source) {
      if (isNative() && window.Capacitor.Plugins.Camera) {
        const { Camera } = window.Capacitor.Plugins;
        const { CameraSource, CameraResultType } = window.Capacitor.Plugins.Camera;
        try {
          const photo = await Camera.getPhoto({
            quality: 85,
            allowEditing: false,
            resultType: 'uri',
            source: source === 'camera' ? 'CAMERA' : 'PHOTOS',
            width: 800,
            height: 800,
            correctOrientation: true,
          });
          return photo; // { webPath, path, format }
        } catch (e) {
          if (e && e.message && e.message.includes('cancelled')) return null;
          console.error('Camera error:', e);
          return null;
        }
      } else {
        // Web fallback: file input
        return new Promise((resolve) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          if (source === 'camera') input.capture = 'environment';
          input.onchange = () => {
            const file = input.files[0];
            if (!file) { resolve(null); return; }
            const url = URL.createObjectURL(file);
            resolve({ webPath: url, file });
          };
          input.oncancel = () => resolve(null);
          input.click();
        });
      }
    }
  };

  // ─── LOCAL NOTIFICATIONS — Medication reminders ─────────────────────────────
  window.HomattNotifications = {
    async scheduleReminder({ id, title, body, scheduleAt }) {
      if (!isNative()) return;
      const { LocalNotifications } = window.Capacitor.Plugins;
      if (!LocalNotifications) return;
      try {
        const perm = await LocalNotifications.requestPermissions();
        if (perm.display !== 'granted') return;
        await LocalNotifications.schedule({
          notifications: [{
            id,
            title,
            body,
            schedule: { at: new Date(scheduleAt) },
            smallIcon: 'ic_launcher',
            sound: 'default',
          }]
        });
      } catch (e) {
        console.error('Notification error:', e);
      }
    },

    async cancelReminder(id) {
      if (!isNative()) return;
      const { LocalNotifications } = window.Capacitor.Plugins;
      if (!LocalNotifications) return;
      LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
    }
  };

  // ─── HAPTICS ────────────────────────────────────────────────────────────────
  window.HomattHaptics = {
    light() {
      if (!isNative()) return;
      const { Haptics } = window.Capacitor.Plugins;
      if (Haptics) Haptics.impact({ style: 'LIGHT' }).catch(() => {});
    },
    medium() {
      if (!isNative()) return;
      const { Haptics } = window.Capacitor.Plugins;
      if (Haptics) Haptics.impact({ style: 'MEDIUM' }).catch(() => {});
    },
    notification(type) {
      if (!isNative()) return;
      const { Haptics } = window.Capacitor.Plugins;
      if (Haptics) Haptics.notification({ type: type || 'SUCCESS' }).catch(() => {});
    }
  };

  // ─── INIT ────────────────────────────────────────────────────────────────────
  function init() {
    initStatusBar();
    initBackButton();
    initNetwork();
    // Hide splash after a short delay to ensure content is visible
    if (document.readyState === 'complete') {
      hideSplash();
    } else {
      window.addEventListener('load', hideSplash);
    }
  }

  // Wait for Capacitor bridge to be ready
  if (window.Capacitor) {
    init();
  } else {
    document.addEventListener('deviceready', init);
    // Also try after DOM loads (web fallback)
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

})();
