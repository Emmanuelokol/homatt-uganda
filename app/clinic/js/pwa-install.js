/* Homatt Clinic — PWA install helper
 * 1. Registers the service worker so the portal meets installability criteria.
 * 2. Shows a friendly "Install" banner when Android/Chrome offers it, so the
 *    owner doesn't need to know the ⋮ menu → "Add to Home screen" trick.
 * 3. Falls back to a one-line hint on iOS Safari (which has no install event).
 */
(function () {
  'use strict';

  // ── 1. Service worker (needed for the install prompt on Chrome) ──────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('../sw.js', { scope: '../' }).catch(function () {});
    });
  }

  // Already running as an installed app? Nothing to prompt.
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }
  if (isStandalone()) return;

  // Don't nag: respect a recent dismissal.
  try {
    var snooze = parseInt(localStorage.getItem('_clinicInstallSnooze') || '0', 10);
    if (snooze && Date.now() < snooze) return;
  } catch (e) {}

  var deferredPrompt = null;

  function buildBanner(onInstall, labelHtml) {
    if (document.getElementById('_clinicInstallBar')) return;
    var bar = document.createElement('div');
    bar.id = '_clinicInstallBar';
    bar.style.cssText =
      'position:fixed;left:12px;right:12px;bottom:12px;z-index:12000;' +
      'background:#fff;border:1px solid #E0E0E0;border-radius:14px;' +
      'box-shadow:0 8px 24px rgba(0,0,0,0.18);padding:12px 14px;' +
      'display:flex;align-items:center;gap:12px;font-family:inherit;max-width:520px;margin:0 auto';
    bar.innerHTML =
      '<img src="icons/clinic-192.png" alt="" width="44" height="44" style="border-radius:10px;flex-shrink:0">' +
      '<div style="flex:1;min-width:0">' +
        '<div style="font-size:14px;font-weight:700;color:#111">Install Homatt Clinic</div>' +
        '<div style="font-size:12px;color:#5F6368;margin-top:1px">' + labelHtml + '</div>' +
      '</div>' +
      '<button id="_clinicInstallBtn" style="background:#1B5E20;color:#fff;border:none;border-radius:9px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">Install</button>' +
      '<button id="_clinicInstallX" aria-label="Dismiss" style="background:transparent;border:none;color:#9AA0A6;cursor:pointer;font-size:20px;line-height:1;padding:4px 6px">&times;</button>';
    document.body.appendChild(bar);

    document.getElementById('_clinicInstallX').onclick = dismiss;
    var btn = document.getElementById('_clinicInstallBtn');
    if (onInstall) btn.onclick = onInstall;
    else btn.style.display = 'none'; // iOS: no button, just the hint
  }

  function dismiss() {
    var bar = document.getElementById('_clinicInstallBar');
    if (bar) bar.remove();
    try { localStorage.setItem('_clinicInstallSnooze', String(Date.now() + 7 * 864e5)); } catch (e) {}
  }

  // ── 2. Android / Chrome: native install prompt ───────────────────────────
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    buildBanner(function () {
      var bar = document.getElementById('_clinicInstallBar');
      if (bar) bar.remove();
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
    }, 'Add it to your home screen — opens like an app, no browser bar.');
  });

  window.addEventListener('appinstalled', function () {
    var bar = document.getElementById('_clinicInstallBar');
    if (bar) bar.remove();
  });

  // ── 3. iOS Safari: no event, so show the manual Share → Add hint ─────────
  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream;
  var isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
  if (isIOS && isSafari) {
    window.addEventListener('load', function () {
      setTimeout(function () {
        buildBanner(null, 'Tap the Share icon, then “Add to Home Screen”.');
      }, 1500);
    });
  }
})();
