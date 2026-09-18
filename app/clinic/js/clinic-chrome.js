/**
 * The phone's own bars — the strip with the clock, and the strip with the
 * back gesture.
 *
 * A clinic chose Midnight blue and photographed a GREEN bar above the app and
 * a GREEN bar below it: "the green at the top and down even when I change the
 * colour". Three separate things were putting it there, and only one of them
 * was in the page:
 *
 *   1. app/js/native-bridge.js called
 *        StatusBar.setBackgroundColor({ color: '#1B5E20' })
 *      on every load of dashboard.html and settings.html. A literal, run at
 *      startup, in the installed app only — so it overrode the theme-color the
 *      page had just worked out, and it did it ONLY in the APK, which is why
 *      the browser looked right and the app did not.
 *   2. android/app/src/main/res/values/styles.xml pins android:statusBarColor
 *      AND android:navigationBarColor to @color/colorPrimaryDark, #1B5E20.
 *      That is a compiled Android resource: nothing served over the air can
 *      change it, and it is what the bottom bar still shows until the next APK.
 *   3. capacitor.config.json repeats #1B5E20 a third time.
 *
 * And the colour the page DID work out was a four-entry map copied into five
 * separate HTML files:
 *
 *      var C={forest:'#0B3D2E',midnight:'#0C2340',dark:'#000000',clay:'#3B2F27'};
 *
 * Five copies of one fact is five chances for a skin to be added to four of
 * them. It is the same mistake as the dose table and the microphone, which
 * this project has already paid for twice, and the fix is the same: one
 * source. The colour now comes from --chrome in clinic.css, where the skin
 * that owns it is defined, and this file is the only thing that reads it.
 *
 * WHAT REACHES A PHONE, AND WHEN. Worth being exact, because half of this
 * arrives by a different road from the other half:
 *
 *   the browser / home-screen web app  <meta name="theme-color">   over the air
 *   the installed app, TOP bar         @capacitor/status-bar       over the air
 *                                      (already in the APK, so this works on
 *                                       the build a clinic is holding today)
 *   the installed app, BOTTOM bar      HomattChrome (Java)         needs the
 *                                      next APK — a window flag has no web API
 *
 * So the top bar is fixed for everybody the moment the pages update, and the
 * bottom bar follows on the next install. Saying that plainly is better than
 * shipping a fix that only half-arrives and letting somebody discover it.
 *
 * THE ICONS ARE COMPUTED, NOT STORED. Android wants a boolean — light icons or
 * dark ones — not a colour. Deriving it from the chrome colour's own luminance
 * means the two cannot disagree; a stored pair can be half-updated, and a bar
 * with its own colour and somebody else's icons is an invisible clock.
 * (The old code asked for Style.LIGHT, which in Capacitor means DARK icons,
 * on a near-black bar. It was wrong in the direction nobody notices because
 * the bar was dark green and the icons were drawn white anyway.)
 */
(function (root) {
  'use strict';

  var LAST = null;   // what we last handed the phone, so we do not repeat it

  function cssChrome() {
    try {
      var v = getComputedStyle(document.documentElement)
        .getPropertyValue('--chrome');
      v = (v || '').trim();
      if (v) return v;
    } catch (e) {}
    return '';
  }

  /* #RGB, #RRGGBB or rgb(...) -> {r,g,b}; anything else -> null.
   * A computed custom property is whatever the stylesheet wrote, so this reads
   * what CSS actually produces rather than assuming one spelling. */
  function parse(c) {
    if (!c) return null;
    c = String(c).trim();
    var m = c.match(/^#([0-9a-fA-F]{3})$/);
    if (m) {
      var s = m[1];
      return { r: parseInt(s[0] + s[0], 16), g: parseInt(s[1] + s[1], 16), b: parseInt(s[2] + s[2], 16) };
    }
    m = c.match(/^#([0-9a-fA-F]{6})$/);
    if (m) {
      return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) };
    }
    m = c.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      var p = m[1].split(',').map(function (x) { return parseFloat(x); });
      if (p.length >= 3) return { r: p[0], g: p[1], b: p[2] };
    }
    return null;
  }

  function hex(c) {
    var v = parse(c);
    if (!v) return null;
    function two(n) {
      n = Math.max(0, Math.min(255, Math.round(n))).toString(16);
      return n.length < 2 ? '0' + n : n;
    }
    return '#' + two(v.r) + two(v.g) + two(v.b);
  }

  /* WCAG relative luminance. The threshold is the one the standard itself
   * uses to split light from dark, so "which icons" is decided the same way
   * the contrast tests decide everything else in this app. */
  function isDark(c) {
    var v = parse(c);
    if (!v) return true;              // unknown: assume dark, which is the
    function ch(x) {                  // safe guess for every skin shipped
      x = x / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    }
    var L = 0.2126 * ch(v.r) + 0.7152 * ch(v.g) + 0.0722 * ch(v.b);
    return L < 0.5;
  }

  function colour() {
    // The token first. The meta tag is the fallback, because the patient app
    // and the clinician screens have their own look and no --chrome, and a
    // page with neither should keep whatever it shipped with rather than being
    // forced to a clinic colour it never asked for.
    var c = hex(cssChrome());
    if (c) return c;
    try {
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) {
        var t = hex(m.getAttribute('content'));
        if (t) return t;
      }
    } catch (e) {}
    return null;
  }

  function native() {
    var C = root.Capacitor;
    if (!C) return null;
    try {
      if (typeof C.isNativePlatform === 'function' && !C.isNativePlatform()) return null;
    } catch (e) {}
    if (!C.isNative && C.platform !== 'android' && C.platform !== 'ios' &&
        typeof C.isNativePlatform !== 'function') return null;
    return C.Plugins || null;
  }

  /**
   * Hand the colour to the page and to the phone. Safe to call as often as
   * you like — it does nothing when nothing has changed, because setting a
   * status bar on every render is a visible flicker on some Samsung builds.
   */
  function apply(force) {
    var c = colour();
    if (!c) return null;
    if (!force && c === LAST) return c;
    LAST = c;

    // 1. The page's own declaration. This is what a browser and a home-screen
    //    web app read, and it costs nothing in the installed app.
    try {
      var m = document.querySelector('meta[name="theme-color"]');
      if (!m) {
        m = document.createElement('meta');
        m.setAttribute('name', 'theme-color');
        (document.head || document.documentElement).appendChild(m);
      }
      m.setAttribute('content', c);
    } catch (e) {}

    var P = native();
    if (!P) return c;

    var dark = isDark(c);

    /* 2. The phone's bars. ONE of these two, never both — two things setting
     *    the same bar in the same moment is a visible flicker on Samsung's
     *    WebView and, worse, makes "which one won?" unanswerable the next time
     *    somebody photographs a wrong colour.
     *
     *    HomattChrome does both bars and is preferred where it exists. It only
     *    exists in an APK built since this was written, so the fallback is not
     *    a nicety: it is what every phone in the field is running today, and
     *    it fixes the top bar for them without an install. */
    try {
      if (P.HomattChrome && P.HomattChrome.set) {
        P.HomattChrome.set({ color: c, lightIcons: dark })['catch'](function () {});
      } else if (P.StatusBar) {
        // Capacitor's names read backwards: Style.Dark means "content FOR a
        // dark background", i.e. light icons. Inverted once, here, in writing.
        if (P.StatusBar.setStyle) P.StatusBar.setStyle({ style: dark ? 'DARK' : 'LIGHT' })['catch'](function () {});
        if (P.StatusBar.setBackgroundColor) P.StatusBar.setBackgroundColor({ color: c })['catch'](function () {});
      }
    } catch (e) {}

    return c;
  }

  /* The skin and the theme are changed live on the settings screen, by writing
   * data-skin / data-theme onto <html>. Watching the attribute rather than
   * asking every screen to remember to call this is what stops the next screen
   * from being the one that forgets. */
  function watch() {
    try {
      if (!root.MutationObserver) return;
      var o = new root.MutationObserver(function () { apply(false); });
      o.observe(document.documentElement, {
        attributes: true, attributeFilter: ['data-skin', 'data-theme'],
      });
    } catch (e) {}
  }

  function start() {
    apply(true);
    watch();
    // Coming back to the front after Android has drawn its own chrome over a
    // suspended WebView: re-assert, because the phone does not remember.
    try {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) apply(true);
      });
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  root.HomattChrome = {
    apply: apply,
    colour: colour,
    _isDark: isDark,
    _parse: parse,
    _hex: hex,
  };
})(typeof window !== 'undefined' ? window : this);
