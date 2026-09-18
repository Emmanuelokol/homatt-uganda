/* Homatt Health — opening the app straight at the thing you wanted
 *
 * A clinician on the home screen taps "New treatment" and expects the intake
 * screen, not the dashboard with four taps still to go. That is what the
 * home-screen widget and the long-press shortcuts are for, and this is the
 * half that runs inside the app.
 *
 * ── THE LINK ALREADY EXISTED AND NOTHING WAS LISTENING ───────────────────
 *
 * AndroidManifest.xml has declared an intent-filter for `homatt://app/…` on
 * MainActivity, with `launchMode="singleTask"`, since long before this. It is
 * exactly the right shape. But nothing in the whole of `app/` ever called
 * `getLaunchUrl` or listened for `appUrlOpen`, so every such link has been
 * arriving and being dropped on the floor — the app opened at its start page
 * and the rest of the URL went nowhere.
 *
 * ── TWO WAYS IN, BECAUSE THERE ARE TWO SITUATIONS ────────────────────────
 *
 *   COLD START      the app was not running. Capacitor's App plugin keeps the
 *                   launch URL and hands it over via `getLaunchUrl()`. The
 *                   `appUrlOpen` event may have fired before any of our code
 *                   existed, so relying on the event alone loses exactly the
 *                   case the widget is for.
 *   ALREADY OPEN    `appUrlOpen` fires on the running app. `singleTask` means
 *                   Android delivers it to the existing activity rather than
 *                   starting a second one, so there is one app and one
 *                   listener.
 *
 * Both are handled. Neither is enough on its own.
 *
 * ── AND THE REDIRECT CHAIN, WHICH IS WHAT WOULD SWALLOW IT ───────────────
 *
 * The app starts at `index.html`, which replaces itself with
 * `clinic/index.html`, which sends a signed-in clinic on to `dashboard.html`.
 * A target read on the first of those is gone by the third. So the target is
 * written to `sessionStorage` the moment it is seen and consumed by whichever
 * page is finally standing — once, and then cleared, or every later reload
 * would jump somewhere the clinician did not ask for.
 *
 * ── THE SAME THREE TARGETS SERVE A PLAIN URL ─────────────────────────────
 *
 * `?go=quick-sale` does the same thing, because the PWA's own shortcuts (the
 * long-press menu on an installed web app) navigate by URL and cannot use a
 * custom scheme. One list of targets, two ways to name them.
 */
(function (root) {
  'use strict';

  var KEY = 'homatt_open_target';

  /* Where each target lives, and what to do once there. A target that needs a
   * different page navigates; one that is already on this page just runs. */
  var TARGETS = {
    'new-treatment': { page: 'new-order.html' },
    'active':        { page: 'dashboard.html', run: 'active' },
    'quick-sale':    { page: 'dashboard.html', run: 'quicksale' }
  };
  // What the widget and the shortcuts may say, mapped to the canonical name.
  var ALIAS = {
    'new': 'new-treatment', 'newtreatment': 'new-treatment',
    'new-treatment': 'new-treatment', 'treatment': 'new-treatment',
    'active': 'active', 'active-treatments': 'active', 'treatments': 'active',
    'sale': 'quick-sale', 'quicksale': 'quick-sale', 'quick-sale': 'quick-sale'
  };

  function canonical(s) {
    var k = String(s == null ? '' : s).toLowerCase().replace(/^\/+|\/+$/g, '').trim();
    return ALIAS[k] || '';
  }

  /* Read a target out of anything that might carry one: `homatt://app/active`,
   * `https://localhost/clinic/dashboard.html?go=active`, or the bare word. */
  function targetFrom(url) {
    var s = String(url == null ? '' : url);
    if (!s) return '';
    var m = s.match(/[?&]go=([^&#]+)/i);
    if (m) return canonical(decodeURIComponent(m[1]));
    m = s.match(/^homatt:\/\/app\/?(.*)$/i);
    if (m) return canonical((m[1] || '').split(/[?#]/)[0]);
    return canonical(s);
  }

  function remember(t) {
    if (!t) return;
    try { sessionStorage.setItem(KEY, t); } catch (e) {}
  }
  function take() {
    var t = '';
    try { t = sessionStorage.getItem(KEY) || ''; sessionStorage.removeItem(KEY); } catch (e) {}
    return canonical(t);
  }

  function here() {
    var p = String(location.pathname || '');
    var i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(i + 1) : p;
  }

  /* ── Doing it ────────────────────────────────────────────────────────────
   * If the target lives on another page, go there — and keep the target in
   * sessionStorage so the page that arrives can finish the job. If it is this
   * page, run it now. */
  function go(t) {
    t = canonical(t);
    var spec = TARGETS[t];
    if (!spec) return false;
    var page = here();

    /* THE SIGN-IN PAGE IS NOT SOMEWHERE TO NAVIGATE AWAY FROM.
     *
     * Sending a signed-out clinician to dashboard.html only has the guard send
     * them straight back here — and the target is consumed on the way, so the
     * tap is lost and the round trip is invisible. Remember it instead: the
     * dashboard picks it up from sessionStorage the moment they are in, so
     * tapping "Quick sale" while signed out now ends at quick sale rather than
     * at a dashboard they did not ask for. */
    if (page === 'index.html' || page === '') {
      remember(t);
      return true;
    }

    if (page !== spec.page) {
      remember(t);
      location.replace(spec.page);
      return true;
    }
    if (spec.run) run(spec.run);
    return true;
  }

  /* The dashboard is a single page with everything on it, so "active
   * treatments" is a place on it rather than a page of its own. Scrolled to
   * and its search focused — a clinician who asked for the list wants to find
   * somebody in it. */
  function run(what) {
    if (what === 'quicksale') {
      whenReady(function () {
        if (typeof root.openQuickSale === 'function') { root.openQuickSale(); return true; }
        return false;
      }, 40, 'quick sale');
      return;
    }
    if (what === 'active') {
      /* THIS ONE RETURNED TRUE AND DID NOTHING, AND THAT IS WHY IT WAS
       * REPORTED AS "it just takes me to the app".
       *
       * Driven on the real dashboard: go('active') returned true, scrollY went
       * 0 -> 0, and the list's offsetParent was null. The dashboard lays its
       * cards out on four SLIDES — home, patients, money, stock — and opens on
       * "home". #activeTreatmentsList is on "patients", so on arrival it is in
       * the document and off the screen.
       *
       * The old check was `if (!list) return false`, which asks whether the
       * element EXISTS. It does. So whenReady succeeded on the first try, never
       * retried, and called scrollIntoView on a hidden element — which is a
       * no-op that reports nothing. Existence is not the question; being
       * lookable-at is. */
      whenReady(function () {
        // The dashboard's own full-screen list, where this build has one. It
        // is the same rows as the card, rendered by the same function, with a
        // search box and nothing else on the screen — which is what somebody
        // who tapped "Active" on their home screen actually asked for.
        if (typeof root.openSectionView === 'function' &&
            root._svRenderers && root._svRenderers.active) {
          root.openSectionView('active');
          return true;
        }

        // Older build, arriving over the air before the dashboard has caught
        // up: put the right slide up and scroll to the card.
        var list = document.getElementById('activeTreatmentsList');
        if (!list) return false;
        if (typeof root.showSlide === 'function') {
          try { root.showSlide('patients'); } catch (e) {}
        }
        if (list.offsetParent === null) return false;   // still hidden: wait
        var card = list.closest ? (list.closest('.admin-card') || list.parentElement) : list.parentElement;
        try { (card || list).scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (e) { try { (card || list).scrollIntoView(); } catch (e2) {} }
        var s = document.getElementById('activeSearch');
        // Focused, but NOT on a touch screen — raising the keyboard over the
        // list somebody just asked to look at is the opposite of helping.
        if (s && !('ontouchstart' in root)) { try { s.focus(); } catch (e) {} }
        return true;
      }, 40, 'active treatments');
    }
  }

  /* The dashboard builds itself over several hundred milliseconds — the
   * session check, the clinic id, then the cards. A target acted on too early
   * finds nothing and silently does nothing, which reads to a clinician as a
   * widget that does not work. So it retries, briefly, and gives up quietly
   * rather than hanging on. */
  function whenReady(fn, tries, what) {
    tries = tries === undefined ? 40 : tries;      // ~8 seconds, then stop
    if (fn()) return;
    if (tries <= 0) { giveUp(what); return; }
    setTimeout(function () { whenReady(fn, tries - 1, what); }, 200);
  }

  /* GIVING UP QUIETLY IS THE WORST THING THIS FILE CAN DO.
   *
   * "Nothing happened" is exactly what was reported, and a silent return is
   * indistinguishable from a widget that was never wired up — so a clinician
   * stops using it and never says why. Eight seconds is already a long time to
   * stare at a screen; at the end of it the app owes them a sentence.
   *
   * The dashboard's own toast where there is one, because it is the thing they
   * already recognise; a plain banner otherwise, so a page without a toast is
   * not silently exempt from the rule. */
  function giveUp(what) {
    var msg = 'Could not open ' + (what || 'that') + '. Open it from this screen instead.';
    try {
      if (typeof root.showToast === 'function') { root.showToast(msg, 'error'); return; }
    } catch (e) {}
    try {
      var d = document.createElement('div');
      d.setAttribute('role', 'status');
      d.style.cssText = 'position:fixed;left:16px;right:16px;bottom:22px;z-index:99998;' +
        'background:var(--danger, #D32F2F);color:#fff;padding:12px 14px;border-radius:12px;' +
        'font-size:13.5px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.28);' +
        'font-family:inherit';
      d.textContent = msg;
      (document.body || document.documentElement).appendChild(d);
      setTimeout(function () { try { d.remove(); } catch (e) {} }, 6000);
    } catch (e) {}
  }

  // ── Where a target can arrive from ───────────────────────────────────────

  function fromCurrentUrl() {
    var t = targetFrom(location.href);
    if (!t) return false;
    /* Take it out of the address bar. Otherwise a reload — or the wizard's own
     * return-to-dashboard — replays it, and the clinician is sent back to a
     * screen they had deliberately left. */
    try {
      var clean = location.pathname + location.hash;
      history.replaceState(null, '', clean);
    } catch (e) {}
    return go(t);
  }

  function fromStorage() {
    var t = take();
    return t ? go(t) : false;
  }

  function fromNative() {
    var C = root.Capacitor;
    var App = C && C.Plugins && C.Plugins.App;
    if (!App) return;
    // Already running: the intent is delivered to this activity.
    try {
      App.addListener('appUrlOpen', function (e) {
        var t = targetFrom(e && e.url);
        if (t) go(t);
      });
    } catch (e) {}
    // Cold start: the event may have fired before this file existed.
    try {
      var p = App.getLaunchUrl();
      if (p && typeof p.then === 'function') {
        p.then(function (r) {
          var t = targetFrom(r && r.url);
          if (t) go(t);
        }).catch(function () {});
      }
    } catch (e) {}
  }

  function start() {
    // The address bar first — it is the one that is certainly for this page.
    if (fromCurrentUrl()) { fromNative(); return; }
    fromStorage();
    fromNative();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  root.HomattOpen = {
    go: go,
    _target: targetFrom,
    _canonical: canonical,
    _targets: TARGETS,
    _key: KEY
  };
})(window);
