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
  /**
   * Pages with internal multi-screen flows (e.g. symptom-checker) can set
   *   window.HomattBackHandler = function() { return true; }
   * returning true means "I handled it, don't do the default navigation".
   */
  function initBackButton() {
    // Also wire the browser popstate so in-page back works on Android gesture navigation
    window.addEventListener('popstate', () => {
      if (window.HomattBackHandler && window.HomattBackHandler()) return;
    });

    if (!isNative()) return;
    const { App } = window.Capacitor.Plugins;
    if (!App) return;

    App.addListener('backButton', ({ canGoBack }) => {
      // 1. Let the current page handle it if it registered a custom handler
      if (window.HomattBackHandler && window.HomattBackHandler()) return;

      // 2. Close any open sheet / modal
      const openSheet = document.querySelector('.bottom-sheet.open, .modal.open, .overlay.active');
      if (openSheet) {
        openSheet.classList.remove('open', 'active');
        document.querySelectorAll('.sheet-overlay').forEach(o => o.classList.remove('visible'));
        return;
      }

      // 3. Default page navigation
      const mainPages = ['dashboard.html', 'signin.html', 'index.html'];
      const currentPage = location.pathname.split('/').pop() || 'index.html';
      if (mainPages.includes(currentPage) || !canGoBack) {
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

  // ─── KEYBOARD ────────────────────────────────────────────────────────────────
  function initKeyboard() {
    // Tap outside any input/textarea/select → blur to dismiss keyboard.
    // Use touchend (not touchstart) so taps on buttons near inputs still fire correctly.
    document.addEventListener('touchend', (e) => {
      const tag = e.target && e.target.tagName;
      const interactiveTags = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A', 'LABEL'];
      if (!interactiveTags.includes(tag)) {
        const active = document.activeElement;
        if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
          active.blur();
        }
      }
    }, { passive: true });

    // Capacitor Keyboard plugin listeners (native only)
    if (!isNative()) return;
    const { Keyboard } = window.Capacitor.Plugins;
    if (!Keyboard) return;

    Keyboard.addListener('keyboardWillShow', () => {
      document.body.classList.add('keyboard-open');
      // Scroll focused element into view after keyboard finishes animating in.
      // Skip inputs inside a bottom-sheet: with Capacitor "resize:body" the body shrinks
      // and the sheet rises above the keyboard automatically — calling scrollIntoView here
      // on a sticky-footer input (outside sheet-body's scroll container) would try to
      // scroll the body which has overflow:hidden set by some pages, causing a visual jump.
      setTimeout(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return;
        const sheet = el.closest('.bottom-sheet');
        if (sheet) {
          // Input is inside a bottom-sheet. The sheet body can scroll if needed.
          const sheetBody = sheet.querySelector('.sheet-body');
          if (sheetBody && sheetBody.contains(el)) {
            el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          // If input is in the sticky footer area, it's already at the visible bottom —
          // no scrolling needed; the Capacitor body resize moves the whole sheet up.
        } else {
          // Directly scroll .app-screen to center the input.
          // We avoid el.scrollIntoView() here because .app-screen has CSS
          // scroll-behavior:smooth, which conflicts with behavior:'instant' in
          // Android WebView and causes the page to freeze or visually break.
          const scroller = el.closest('.app-screen') || document.querySelector('.app-screen');
          if (scroller) {
            const elRect = el.getBoundingClientRect();
            const scrollerRect = scroller.getBoundingClientRect();
            const targetTop = scroller.scrollTop + elRect.top - scrollerRect.top
              - (scroller.clientHeight / 2) + (elRect.height / 2);
            scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
          }
        }
      }, 300);
    });

    Keyboard.addListener('keyboardWillHide', () => {
      document.body.classList.remove('keyboard-open');
    });
  }

  // ─── NETWORK STATUS ─────────────────────────────────────────────────────────
  function initNetwork() {
    if (!isNative()) return;
    const { Network } = window.Capacitor.Plugins;
    if (!Network) return;

    // Check current status on startup
    Network.getStatus().then((status) => {
      if (!status.connected) showNetworkBanner('No internet connection', '#F44336');
    }).catch(() => {});

    Network.addListener('networkStatusChange', (status) => {
      if (!status.connected) {
        showNetworkBanner('No internet connection', '#F44336');
      } else {
        // Show brief "back online" notice then hide
        showNetworkBanner('Back online \u2714', '#388E3C');
        setTimeout(hideNetworkBanner, 2000);
      }
    });
  }

  function showNetworkBanner(msg, color) {
    let banner = document.getElementById('_networkBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = '_networkBanner';
      banner.style.cssText = `
        position:fixed; top:0; left:0; right:0; z-index:10000;
        color:#fff; text-align:center;
        padding:8px; font-size:13px; font-weight:500;
        transition: background 0.3s;
      `;
      document.body.appendChild(banner);
    }
    banner.textContent = msg;
    banner.style.background = color || '#F44336';
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
    initKeyboard();
    // Hide splash after a short delay to ensure content is visible
    if (document.readyState === 'complete') {
      hideSplash();
    } else {
      window.addEventListener('load', hideSplash);
    }
  }

  // ─── OFFLINE DATA CACHE HELPERS ─────────────────────────────────────────────
  /**
   * HomattCache — save/load Supabase query results in localStorage
   * so the app can show last-known data when offline.
   *
   * Usage:
   *   HomattCache.save('medicines', data);
   *   const data = HomattCache.load('medicines', []);
   */
  window.HomattCache = {
    save(key, value) {
      try {
        localStorage.setItem('_hc_' + key, JSON.stringify({ ts: Date.now(), v: value }));
      } catch (e) {}
    },
    load(key, fallback) {
      try {
        const raw = localStorage.getItem('_hc_' + key);
        if (!raw) return fallback;
        return JSON.parse(raw).v;
      } catch (e) {
        return fallback;
      }
    },
    age(key) {
      try {
        const raw = localStorage.getItem('_hc_' + key);
        return raw ? Date.now() - JSON.parse(raw).ts : Infinity;
      } catch (e) { return Infinity; }
    },
  };

  // ─── SERVICE WORKER REGISTRATION ────────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      // Determine the SW path relative to where we are in the URL tree
      const swPath = location.pathname.includes('/admin/') ||
                     location.pathname.includes('/pharmacy/') ||
                     location.pathname.includes('/rider/') ||
                     location.pathname.includes('/clinic/')
        ? '../sw.js' : './sw.js';
      navigator.serviceWorker.register(swPath, { scope: swPath.replace('sw.js', '') })
        .catch(() => {}); // silently fail on non-HTTPS or unsupported env
    });
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
