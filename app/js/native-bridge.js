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

      // 2. Close any open sheet / modal — also clears any stuck JS-injected overlay.
      const openSheet = document.querySelector('.bottom-sheet.open, .modal.open, .overlay.active');
      if (openSheet) {
        openSheet.classList.remove('open', 'active');
        document.querySelectorAll('.sheet-overlay').forEach(o => o.classList.remove('visible'));
        _clearStuckOverlays();
        return;
      }

      // Safety: even if no open sheet, remove any orphaned overlays before navigating.
      _clearStuckOverlays();

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

  // Remove any JS-injected fixed overlays that may have been orphaned by interrupted
  // navigation or by a hardware gesture dismissing a panel without running its close handler.
  function _clearStuckOverlays() {
    ['notifOverlay', 'notifPanel', '_rtaPanel'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.remove();
    });
    // Also remove any anonymous fixed divs that cover the full screen (z-index > 500).
    document.querySelectorAll('body > div[style*="position:fixed"], body > div[style*="position: fixed"]').forEach(el => {
      const style = el.style;
      const z = parseInt(style.zIndex || '0', 10);
      if (z > 500 && !el.id.startsWith('_network')) el.remove();
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
  // Public helper: dismiss keyboard from anywhere in the app.
  window.HomattDismissKeyboard = function() {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT')) {
      a.blur();
    }
    if (isNative() && window.Capacitor.Plugins.Keyboard) {
      window.Capacitor.Plugins.Keyboard.hide().catch(() => {});
    }
  };

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
      // 550ms: Android keyboard animation is ~300ms; Capacitor resize:body needs another
      // ~100ms to propagate after the animation ends. We wait until both settle before
      // scrolling so our getBoundingClientRect reads the post-resize layout.
      setTimeout(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return;

        // Find the actual scrollable ancestor of the focused input.
        // This walks up the DOM looking for any element that is an overflow:auto/scroll
        // container whose content overflows. This single function handles:
        //   - .bottom-sheet/.sheet-body (symptom-checker, family, etc.)
        //   - .cc-modal (chronic-disease)
        //   - .mo-scroll, .cb-step (medicine-orders, clinic-booking inner scroll)
        //   - .app-screen (default page scroll container)
        const findScroller = (node) => {
          let cur = node.parentElement;
          while (cur && cur !== document.body) {
            const s = getComputedStyle(cur);
            const oy = s.overflowY;
            if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur;
            cur = cur.parentElement;
          }
          return document.querySelector('.app-screen');
        };

        const scroller = findScroller(el);
        if (scroller) {
          const elRect = el.getBoundingClientRect();
          const scrollerRect = scroller.getBoundingClientRect();
          // Center the input within the visible scroller area
          const targetTop = scroller.scrollTop + elRect.top - scrollerRect.top
            - (scroller.clientHeight / 2) + (elRect.height / 2);
          scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
        } else {
          // Last-resort: ask the browser itself
          try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(_) {}
        }
      }, 550);
    });

    Keyboard.addListener('keyboardWillHide', () => {
      document.body.classList.remove('keyboard-open');
    });

    Keyboard.addListener('keyboardDidHide', () => {
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

  // ─── GEOLOCATION — Native wrapper ───────────────────────────────────────────
  /**
   * HomattGeolocation — wraps Capacitor Geolocation on native (which triggers
   * the Android runtime permission dialog) and falls back to the browser API
   * on web. Always use this instead of navigator.geolocation in the app.
   */
  window.HomattGeolocation = {
    /**
     * Returns [lat, lon] or null on failure.
     * On native, requests permission first so Android shows the system dialog.
     */
    async getCurrentPosition(options) {
      if (isNative() && window.Capacitor.Plugins.Geolocation) {
        const { Geolocation } = window.Capacitor.Plugins;
        try {
          const perm = await Geolocation.requestPermissions();
          if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
          const pos = await Geolocation.getCurrentPosition({
            enableHighAccuracy: true,
            timeout: (options && options.timeout) || 8000,
          });
          return [pos.coords.latitude, pos.coords.longitude];
        } catch (e) {
          return null;
        }
      }
      // Web fallback
      return new Promise(resolve => {
        if (!navigator.geolocation) { resolve(null); return; }
        navigator.geolocation.getCurrentPosition(
          pos => resolve([pos.coords.latitude, pos.coords.longitude]),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: (options && options.timeout) || 8000 }
        );
      });
    },

    /**
     * Starts watching position. Calls callback(lat, lon) on each update.
     * Returns a watchId that can be passed to clearWatch().
     */
    async watchPosition(options, callback) {
      if (isNative() && window.Capacitor.Plugins.Geolocation) {
        const { Geolocation } = window.Capacitor.Plugins;
        try {
          const perm = await Geolocation.requestPermissions();
          if (perm.location !== 'granted' && perm.coarseLocation !== 'granted') return null;
          const watchId = await Geolocation.watchPosition(
            { enableHighAccuracy: true, maximumAge: options && options.maximumAge, timeout: options && options.timeout },
            (pos, err) => { if (pos) callback(pos.coords.latitude, pos.coords.longitude); }
          );
          return { native: true, id: watchId };
        } catch (e) {
          return null;
        }
      }
      // Web fallback
      if (!navigator.geolocation) return null;
      const id = navigator.geolocation.watchPosition(
        pos => callback(pos.coords.latitude, pos.coords.longitude),
        null,
        { enableHighAccuracy: true, maximumAge: (options && options.maximumAge) || 15000, timeout: (options && options.timeout) || 10000 }
      );
      return { native: false, id };
    },

    async clearWatch(handle) {
      if (!handle) return;
      if (handle.native && window.Capacitor && window.Capacitor.Plugins.Geolocation) {
        await window.Capacitor.Plugins.Geolocation.clearWatch({ id: handle.id }).catch(() => {});
      } else {
        navigator.geolocation.clearWatch(handle.id);
      }
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

  // ─── SMOOTH NAVIGATION ──────────────────────────────────────────────────────
  // navTo(url) — fades the page out before navigating so there's no white
  // flash between bottom-nav tabs.  Falls back to an instant redirect if the
  // frame element isn't found or animation preference is reduced.
  window.navTo = function(url) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      window.location.href = url;
      return;
    }
    const frame = document.querySelector('.phone-frame');
    if (!frame) { window.location.href = url; return; }
    frame.style.transition = 'opacity 0.12s ease';
    frame.style.opacity = '0';
    setTimeout(() => { window.location.href = url; }, 120);
  };

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
