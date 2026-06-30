/* Homatt Health (clinic portal) — PWA install helper
 *
 * Why this is "always on": Chrome only fires `beforeinstallprompt` behind
 * engagement heuristics and may never fire it, so a banner gated on that event
 * often never shows. Instead we ALWAYS show an install affordance (unless the
 * app is already installed). If the native one-tap prompt is available we use
 * it; otherwise the button opens short "Add to Home screen" instructions for
 * the user's browser.
 */
(function () {
  'use strict';

  // ── Register the service worker (needed for the native install prompt) ───
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(function () {});
    });
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true ||
           document.referrer.indexOf('android-app://') === 0;
  }
  if (isStandalone()) return; // already installed — nothing to offer

  // Respect a recent dismissal (3 days).
  try {
    var snooze = parseInt(localStorage.getItem('_homattInstallSnooze') || '0', 10);
    if (snooze && Date.now() < snooze) return;
  } catch (e) {}

  var deferredPrompt = null;
  var ICON = 'icons/clinic-192.png?v=2';

  var ua = navigator.userAgent || '';
  var isIOS     = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  var isSamsung = /SamsungBrowser/.test(ua);
  var isFirefox = /Firefox|FxiOS/.test(ua);

  function snoozeDismiss() {
    var bar = document.getElementById('_homattInstallBar');
    if (bar) bar.remove();
    try { localStorage.setItem('_homattInstallSnooze', String(Date.now() + 3 * 864e5)); } catch (e) {}
  }

  // ── Manual "how to install" steps, tailored to the browser ───────────────
  function instructionsHTML() {
    if (isIOS) {
      return 'In Safari, tap the <b>Share</b> button <span style="font-size:15px">&#x2191;</span> at the bottom, ' +
             'then choose <b>“Add to Home Screen”</b>.';
    }
    if (isSamsung) {
      return 'Tap the <b>menu</b> (≡) at the bottom, choose <b>“Add page to”</b>, then <b>“Home screen”</b>.';
    }
    if (isFirefox) {
      return 'Tap the <b>menu</b> (⋮), then choose <b>“Install”</b> or <b>“Add to Home screen”</b>.';
    }
    // Chrome / Edge / generic Android
    return 'Tap the <b>menu</b> (⋮) at the top-right, then choose <b>“Add to Home screen”</b> ' +
           '(or <b>“Install app”</b>).';
  }

  function showInstructions() {
    if (document.getElementById('_homattInstallHelp')) return;
    var ov = document.createElement('div');
    ov.id = '_homattInstallHelp';
    ov.style.cssText = 'position:fixed;inset:0;z-index:12001;background:rgba(0,0,0,0.5);' +
      'display:flex;align-items:center;justify-content:center;padding:22px;font-family:inherit';
    ov.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px">' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">' +
          '<img src="' + ICON + '" alt="" width="46" height="46" style="border-radius:11px">' +
          '<div style="font-size:17px;font-weight:800;color:#111">Add Homatt Health</div>' +
        '</div>' +
        '<p style="font-size:14px;color:#333;line-height:1.6;margin:0 0 18px">' + instructionsHTML() + '</p>' +
        '<button id="_homattHelpOk" style="width:100%;padding:13px;background:#1B5E20;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit">Got it</button>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    var ok = document.getElementById('_homattHelpOk');
    if (ok) ok.onclick = function () { ov.remove(); };
  }

  function onInstallClick() {
    if (deferredPrompt) {
      var bar = document.getElementById('_homattInstallBar');
      if (bar) bar.remove();
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
    } else {
      showInstructions();
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
        '<div style="font-size:12px;color:#5F6368;margin-top:1px">Put it on your home screen — opens like an app.</div>' +
      '</div>' +
      '<button id="_homattInstallBtn" style="background:#1B5E20;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Install</button>' +
      '<button id="_homattInstallX" aria-label="Dismiss" style="background:transparent;border:none;color:#9AA0A6;cursor:pointer;font-size:20px;line-height:1;padding:4px 6px">&times;</button>';
    document.body.appendChild(bar);
    document.getElementById('_homattInstallBtn').onclick = onInstallClick;
    document.getElementById('_homattInstallX').onclick   = snoozeDismiss;
  }

  // Capture the native prompt if/when Chrome offers it (upgrades the button to
  // one-tap install automatically).
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    showBanner();
  });

  window.addEventListener('appinstalled', function () {
    var bar = document.getElementById('_homattInstallBar');
    if (bar) bar.remove();
  });

  // Always show the banner shortly after load (with the manual fallback), so
  // there is an install option even when beforeinstallprompt never fires.
  function arm() { setTimeout(showBanner, 1200); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') arm();
  else window.addEventListener('DOMContentLoaded', arm);
})();
