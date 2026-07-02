/* Homatt Health (clinic portal) — Add-to-Home-Screen helper
 *
 * Goal: put a Homatt Health icon on the phone's home screen.
 *
 * Reality of the platform:
 *   • On normal Chrome/Edge (Android) we get a real ONE-TAP install via the
 *     `beforeinstallprompt` event → `prompt()`.
 *   • In a private/Incognito tab, or in browsers that don't implement install
 *     (Firefox, DuckDuckGo, in-app webviews, some "privacy" browsers), that
 *     event NEVER fires — the OS forbids it. No website code can force it.
 *   • iOS Safari has no event either; it's a manual Share → Add to Home Screen.
 *
 * So we: use the one-tap prompt when it's offered, and otherwise show clear,
 * browser-correct guidance (including "open in Chrome" + copy link) instead of
 * a dead button.
 */
(function () {
  'use strict';

  // Register the clinic service worker (needed for the install prompt + offline).
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('clinic-sw.js', { scope: './' }).then(function (reg) {
        // Check for a newer version every time the app opens (and periodically),
        // so staff are never stuck on old code.
        try { reg.update(); } catch (e) {}
        setInterval(function () { try { reg.update(); } catch (e) {} }, 60 * 60 * 1000);
      }).catch(function () {});
    });

    // When a NEW service worker takes control (a fresh version was deployed),
    // reload once so the latest code/UI is shown immediately. Guarded so it
    // fires only on an actual update, never in a loop.
    var _swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (_swReloaded) return;
      _swReloaded = true;
      window.location.reload();
    });
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.indexOf('android-app://') === 0;
  }
  if (isStandalone()) return; // already installed

  try {
    var snooze = parseInt(localStorage.getItem('_homattInstallSnooze') || '0', 10);
    if (snooze && Date.now() < snooze) return;
  } catch (e) {}

  var ICON = 'icons/clinic-192.png?v=2';
  var deferredPrompt = null;

  var ua = navigator.userAgent || '';
  var isIOS        = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  var isSamsung    = /SamsungBrowser/.test(ua);
  var isFirefox    = /Firefox|FxiOS/.test(ua);
  var isDDG        = /DuckDuckGo/.test(ua);
  // Chromium that implements the install prompt API (Chrome, Edge, Brave, etc.)
  var isChromiumInstallable = ('onbeforeinstallprompt' in window);

  function snoozeDismiss() {
    var bar = document.getElementById('_homattInstallBar');
    if (bar) bar.remove();
    try { localStorage.setItem('_homattInstallSnooze', String(Date.now() + 3 * 864e5)); } catch (e) {}
  }

  // ── Guidance shown when no one-tap prompt is available ────────────────────
  function guidanceHTML() {
    if (isIOS) {
      return 'In <b>Safari</b>, tap the <b>Share</b> button ' +
             '<span style="font-size:15px">&#x2191;</span> at the bottom, then ' +
             '<b>“Add to Home Screen”</b>.';
    }
    if (isSamsung) {
      return 'Tap the <b>menu</b> (≡) at the bottom, choose <b>“Add page to”</b>, ' +
             'then <b>“Home screen”</b>.';
    }
    if (isFirefox || isDDG) {
      return 'This browser can’t add apps to the home screen. Please open this ' +
             'page in <b>Google Chrome</b>, then tap <b>Install</b>.<br><br>' +
             'Use <b>Copy link</b> below, open Chrome, paste it, and load the page.';
    }
    if (isChromiumInstallable) {
      // Chrome/Edge but the prompt hasn't been offered — almost always a private
      // tab, or it just needs a moment / a reload.
      return 'Tap the <b>menu</b> (⋮) at the top-right, then ' +
             '<b>“Install app”</b> or <b>“Add to Home screen”</b>.<br><br>' +
             'Don’t see it? You’re probably in a <b>private / Incognito</b> tab — ' +
             'open this page in a <b>normal Chrome tab</b> and the <b>Install</b> ' +
             'button will add it in one tap.';
    }
    return 'Open this page in <b>Google Chrome</b> (a normal, non-private tab), ' +
           'then tap <b>Install</b>. Use <b>Copy link</b> below to move it to Chrome.';
  }

  function showGuidance() {
    var ov = document.getElementById('_homattInstallHelp');
    if (ov) ov.remove();
    ov = document.createElement('div');
    ov.id = '_homattInstallHelp';
    ov.style.cssText = 'position:fixed;inset:0;z-index:12001;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:center;justify-content:center;padding:22px;font-family:inherit';

    var canCopy = !isIOS; // iOS path doesn't need it
    ov.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:430px;width:100%;padding:22px">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
          '<img src="' + ICON + '" alt="" width="46" height="46" style="border-radius:11px">' +
          '<div style="font-size:17px;font-weight:800;color:#111">Add Homatt Health</div>' +
        '</div>' +
        '<p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 18px">' + guidanceHTML() + '</p>' +
        (canCopy ? '<button id="_homattCopy" style="width:100%;padding:12px;background:#fff;color:#1B5E20;border:1.5px solid #1B5E20;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-bottom:8px">Copy link</button>' : '') +
        '<button id="_homattHelpOk" style="width:100%;padding:13px;background:#1B5E20;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Got it</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    var ok = document.getElementById('_homattHelpOk');
    if (ok) ok.onclick = function () { ov.remove(); };
    var cp = document.getElementById('_homattCopy');
    if (cp) cp.onclick = function () {
      var url = window.location.href;
      var done = function () { cp.textContent = 'Link copied ✓'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(done).catch(function () { fallbackCopy(url, done); });
      } else { fallbackCopy(url, done); }
    };
  }

  function fallbackCopy(text, done) {
    try {
      var t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      document.execCommand('copy'); document.body.removeChild(t); done();
    } catch (e) {}
  }

  function nativeInstall() {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
  }

  function onInstallClick() {
    if (deferredPrompt) {
      var bar = document.getElementById('_homattInstallBar');
      if (bar) bar.remove();
      nativeInstall();
    } else {
      showGuidance();
    }
  }

  function showBanner() {
    if (document.getElementById('_homattInstallBar') || isStandalone()) return;
    var bar = document.createElement('div');
    bar.id = '_homattInstallBar';
    bar.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:12000;' +
      'background:#fff;border:1px solid #E0E0E0;border-radius:14px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:12px 14px;' +
      'display:flex;align-items:center;gap:12px;font-family:inherit;max-width:520px;margin:0 auto';
    bar.innerHTML =
      '<img src="' + ICON + '" alt="" width="44" height="44" style="border-radius:10px;flex-shrink:0">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:14px;font-weight:700;color:#111">Install Homatt Health</div>' +
        '<div style="font-size:12px;color:#5F6368;margin-top:1px">Add it to your home screen — opens like an app.</div>' +
      '</div>' +
      '<button id="_homattInstallBtn" style="background:#1B5E20;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Install</button>' +
      '<button id="_homattInstallX" aria-label="Dismiss" style="background:transparent;border:none;color:#9AA0A6;cursor:pointer;font-size:20px;line-height:1;padding:4px 6px">&times;</button>';
    document.body.appendChild(bar);
    document.getElementById('_homattInstallBtn').onclick = onInstallClick;
    document.getElementById('_homattInstallX').onclick   = snoozeDismiss;
  }

  // Capture the native one-tap prompt the moment Chrome offers it.
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showBanner();
    // If the guidance modal happens to be open, upgrade it to a real one-tap
    // install button so the user gets the slick path without re-tapping.
    var ov = document.getElementById('_homattInstallHelp');
    if (ov) {
      ov.remove();
      var bar = document.getElementById('_homattInstallBar');
      if (bar) bar.remove();
      nativeInstall();
    }
  });

  window.addEventListener('appinstalled', function () {
    var bar = document.getElementById('_homattInstallBar');
    if (bar) bar.remove();
    var ov = document.getElementById('_homattInstallHelp');
    if (ov) ov.remove();
  });

  function arm() { setTimeout(showBanner, 1200); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') arm();
  else window.addEventListener('DOMContentLoaded', arm);
})();
