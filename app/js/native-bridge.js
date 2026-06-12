/**
 * Homatt Health — Native Bridge
 * Handles Capacitor plugin integration for Android features.
 * Safe to load on web (no-ops when Capacitor is not present).
 */

(function () {
  'use strict';

  // ─── VIEWPORT HEIGHT FIX ─────────────────────────────────────────────────────
  // Some Android WebViews (especially Samsung) cache the `100dvh` value at the
  // keyboard-open height and never reset it when the keyboard closes. This leaves
  // the body/phone-frame stuck at half-height with a black native-background gap
  // below. We fix it by writing window.innerHeight to a CSS variable on every
  // resize event — window.innerHeight ALWAYS reflects the correct current height.
  // This IIFE runs immediately when the script loads, before Capacitor is ready,
  // so the variable is set as early as possible on every page.
  (function initViewportHeightVar() {
    function _updateVh() {
      document.documentElement.style.setProperty('--actual-vh', window.innerHeight + 'px');
    }
    window.addEventListener('resize', _updateVh, { passive: true });
    _updateVh(); // set immediately
    // Expose so keyboard hide handlers can call it explicitly
    window._homattUpdateVh = _updateVh;
  })();

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

  // Find the actual scrollable ancestor of the focused input.
  // This walks up the DOM looking for any element that is an overflow:auto/scroll
  // container whose content overflows. This single function handles:
  //   - .bottom-sheet/.sheet-body (profile, symptom-checker, family, etc.)
  //   - .cc-modal (chronic-disease)
  //   - .mo-scroll, .cb-step (medicine-orders, clinic-booking inner scroll)
  //   - .app-screen (default page scroll container)
  // Returns null when no such container exists — which is the correct
  // signal to fall back to scrollIntoView rather than trying to scroll
  // an overflow:hidden element (like .app-screen in medicine-orders) or
  // a position:fixed container that is too short to overflow yet.
  function _findScroller(node) {
    let cur = node.parentElement;
    while (cur && cur !== document.body) {
      const s = getComputedStyle(cur);
      const oy = s.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && cur.scrollHeight > cur.clientHeight) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  function _scrollFocusedInputIntoView() {
    const el = document.activeElement;
    if (!el || el === document.body) return;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return;

    const scroller = _findScroller(el);
    if (scroller) {
      const elRect = el.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      // Center the input within the visible scroller area
      const targetTop = scroller.scrollTop + elRect.top - scrollerRect.top
        - (scroller.clientHeight / 2) + (elRect.height / 2);
      scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'instant' });
    } else {
      // No scrollable container found (overflow:hidden screens, short modals,
      // position:fixed sheets). Let the browser scroll to the element — this
      // correctly handles crx-modal, #cbInner, and other modal scroll containers
      // because scrollIntoView walks the stacking context, not just the DOM.
      try { el.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch(_) {}
    }
  }

  // The app never scrolls the document itself — all scrolling happens inside
  // .app-screen / .sheet-body etc. But while the keyboard is open the WebView
  // is temporarily shorter, content overflows, and the document CAN get
  // scrolled (by the browser revealing the focused input, or by a
  // scrollIntoView fallback). Android WebView does not clamp that scroll back
  // when the keyboard closes, which leaves the page shoved up with a big
  // blank area at the bottom. Restore it explicitly on every keyboard hide.
  function _resetDocumentScroll() {
    // Clinic portal pages use the document as their scroll container (no fixed-height
    // app-screen wrapper). Resetting scrollY there would snap the operator's scroll
    // position back to the top every time the keyboard closes.
    if (window.location.pathname.indexOf('/clinic/') !== -1) return;
    try {
      window.scrollTo(0, 0);
      if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    } catch(_) {}
  }

  function initKeyboard() {
    // Tap outside any input/textarea/select → blur to dismiss keyboard.
    // Walk UP the DOM to detect interactive ancestors — without this, tapping
    // an icon <span> inside a bottom-nav <a> looked non-interactive, blurred
    // the focused input, and the resulting layout reflow ate the click —
    // forcing the user to tap twice or thrice for nav/buttons to register.
    document.addEventListener('touchend', (e) => {
      const interactive = e.target && e.target.closest && e.target.closest(
        'input, textarea, select, button, a, label, [onclick], [role="button"], .cbn-link, .nav-item, .sidebar-link'
      );
      if (interactive) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
        active.blur();
      }
    }, { passive: true });

    if (isNative() && window.Capacitor.Plugins.Keyboard) {
      // Native: Capacitor Keyboard plugin events
      const { Keyboard } = window.Capacitor.Plugins;

      Keyboard.addListener('keyboardWillShow', () => {
        document.body.classList.add('keyboard-open');
        // 550ms: Android keyboard animation is ~300ms; the adjustResize WebView
        // reflow takes another beat after the animation ends. We wait until both
        // settle before scrolling so getBoundingClientRect reads the post-resize layout.
        setTimeout(_scrollFocusedInputIntoView, 550);
      });

      Keyboard.addListener('keyboardWillHide', () => {
        document.body.classList.remove('keyboard-open');
        _resetDocumentScroll();
        // Force --actual-vh back to full height immediately — some WebViews fire
        // the resize event late, leaving the body stuck at keyboard height briefly.
        if (window._homattUpdateVh) window._homattUpdateVh();
      });

      Keyboard.addListener('keyboardDidHide', () => {
        document.body.classList.remove('keyboard-open');
        _resetDocumentScroll();
        if (window._homattUpdateVh) window._homattUpdateVh();
        // Double-check after the WebView finishes growing back
        setTimeout(() => {
          _resetDocumentScroll();
          if (window._homattUpdateVh) window._homattUpdateVh();
        }, 250);
      });
    } else if (window.visualViewport) {
      // Web/PWA fallback: detect the keyboard via visual viewport height changes.
      let baseHeight = window.visualViewport.height;
      window.visualViewport.addEventListener('resize', () => {
        const h = window.visualViewport.height;
        if (h > baseHeight) baseHeight = h; // rotation / chrome UI growth
        const keyboardOpen = baseHeight - h > 150;
        if (keyboardOpen) {
          document.body.classList.add('keyboard-open');
          setTimeout(_scrollFocusedInputIntoView, 300);
        } else {
          document.body.classList.remove('keyboard-open');
          _resetDocumentScroll();
          if (window._homattUpdateVh) window._homattUpdateVh();
          setTimeout(() => {
            _resetDocumentScroll();
            if (window._homattUpdateVh) window._homattUpdateVh();
          }, 250);
        }
      });
    }
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
  // ─── EXTERNAL LINK INTERCEPTOR ──────────────────────────────────────────────
  // Capacitor's WebView swallows clicks on external <a href="https://..."> links
  // and either loads them inside the app or does nothing. Using window.open with
  // the '_system' target tells Android to hand the URL to the device's default
  // browser (Chrome) instead — so Google Maps, WhatsApp, websites, etc. all open
  // correctly. Works for target="_blank" links too.
  function initExternalLinks() {
    const appHost = window.location.hostname; // e.g. homatt-uganda-emmanuelokols-projects.vercel.app or localhost
    document.addEventListener('click', function(e) {
      const anchor = e.target && e.target.closest && e.target.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      // Only intercept fully-qualified external URLs (http / https)
      if (!/^https?:\/\//i.test(href)) return;
      try {
        const url = new URL(href);
        // Let internal app links (same host) load normally
        if (url.hostname === appHost || url.hostname === 'localhost') return;
      } catch(_) { return; }
      // Open in Chrome / system browser
      e.preventDefault();
      e.stopPropagation();
      window.open(href, '_system');
    }, true); // capturing so it fires before any onclick handlers
  }

  function init() {
    initStatusBar();
    initBackButton();
    initNetwork();
    initKeyboard();
    initExternalLinks();
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
