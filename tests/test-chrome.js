// The phone's own bars — the strip with the clock, and the strip with the
// back gesture.
//
// THE REPORT: a clinic chose Midnight blue and photographed a GREEN bar above
// the app and a GREEN bar below it. "the green at the top and down even when I
// change the colour".
//
// Three things were putting it there and only one was in the page:
//   1. app/js/native-bridge.js ran StatusBar.setBackgroundColor('#1B5E20') on
//      every load of dashboard.html and settings.html — a literal, in the
//      INSTALLED APP ONLY. So the browser looked right and the app did not,
//      which is how it survived being reported: whoever checks is usually on
//      the wrong one of the two.
//   2. res/values/styles.xml pins both bars to colorPrimaryDark, compiled.
//   3. capacitor.config.json says #1B5E20 a third time.
//
// ...and the colour the page DID work out came from a four-entry map copied
// into five separate HTML files.
//
// So this file measures the thing that matters rather than the code that does
// it: for every skin and both themes, on every clinic page, what colour does
// the page hand the phone — and does it match the skin the clinic chose?
//
// The native side is STUBBED rather than assumed. A test that only reads
// source would pass on a call that never fires; this one installs a fake
// Capacitor bridge, drives the real pages, and records what the app actually
// asked the phone for.
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  — ' + got)); }
}

const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http');
const APP = path.join(__dirname, '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.db': 'application/octet-stream' };
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});
const PORT = 8975, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const SKINS = ['forest', 'midnight', 'dark', 'clay'];
const THEMES = ['light', 'dark'];
// Pages a clinician actually spends the day in. index.html is included because
// it is the one screen somebody sees before they are signed in, and the first
// impression of "did my colour take?" is made there.
const PAGES = ['index.html', 'dashboard.html', 'settings.html', 'new-order.html',
               'messages.html', 'guidelines.html'];

/* WCAG relative luminance, the same arithmetic the app uses to decide which
 * way the icons go. Duplicated here on purpose: a test that imports the
 * function under test cannot catch that function being wrong. */
function lum(hex) {
  let h = String(hex).trim().replace('#', '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const ch = (v) => { v = parseInt(v, 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * ch(h.slice(0, 2)) + 0.7152 * ch(h.slice(2, 4)) + 0.0722 * ch(h.slice(4, 6));
}
function contrast(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function toHex(c) {
  const m = String(c).match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(',').map(Number);
    return '#' + p.slice(0, 3).map(n => ('0' + Math.round(n).toString(16)).slice(-2)).join('');
  }
  let h = String(c).trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(h)) h = '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return h;
}

/* The fake phone. Installed with addInitScript so it survives the navigation
 * index.html performs, and it RECORDS rather than no-ops — "did it call the
 * plugin" is the whole question, and a silent stub answers it the same way a
 * broken app does. */
const FAKE_NATIVE = () => {
  window.__bars = [];
  const rec = (kind, arg) => { window.__bars.push({ kind, arg: JSON.parse(JSON.stringify(arg || {})) }); return Promise.resolve({}); };
  window.Capacitor = {
    isNative: true,
    platform: 'android',
    isNativePlatform: () => true,
    Plugins: {
      StatusBar: {
        setStyle: (o) => rec('style', o),
        setBackgroundColor: (o) => rec('statusBar', o),
        setOverlaysWebView: (o) => rec('overlay', o),
      },
      HomattChrome: { set: (o) => rec('chrome', o) },
    },
  };
};
// The APK a clinic is holding TODAY: Capacitor is there, HomattChrome is not,
// because it is Java and only arrives with an install. This is the build most
// phones will be on for a while, so the fallback is the live path, not a
// theoretical one.
const FAKE_OLD_APK = () => {
  window.__bars = [];
  const rec = (kind, arg) => { window.__bars.push({ kind, arg: JSON.parse(JSON.stringify(arg || {})) }); return Promise.resolve({}); };
  window.Capacitor = {
    isNative: true,
    platform: 'android',
    isNativePlatform: () => true,
    Plugins: {
      StatusBar: {
        setStyle: (o) => rec('style', o),
        setBackgroundColor: (o) => rec('statusBar', o),
      },
    },
  };
};

const seed = (skin, theme) => [skin, theme, CID, UID];
const SEED = ([skin, theme, cid, uid]) => {
  try {
    localStorage.setItem('homatt_skin', skin);
    localStorage.setItem('homatt_theme', theme);
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'D. Musinguzi', clinicName: 'family clinic',
      clinicId: cid, staffRole: 'owner', level: 'HC III',
    }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid },
    }));
  } catch (e) {}
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  const route = (page) => page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
    return r.abort();
  });

  // ══ 1. The token exists for every skin, in both themes ═══════════════
  //
  // A skin that forgets --chrome would silently inherit forest's green, which
  // is the exact bug wearing a new hat.
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await route(page);
    await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });

    const table = {};
    for (const skin of SKINS) {
      for (const theme of THEMES) {
        table[skin + '/' + theme] = await page.evaluate(([s, t]) => {
          document.documentElement.setAttribute('data-skin', s);
          document.documentElement.setAttribute('data-theme', t);
          const cs = getComputedStyle(document.documentElement);
          return {
            chrome: cs.getPropertyValue('--chrome').trim(),
            grad1: cs.getPropertyValue('--grad-1').trim(),
          };
        }, [skin, theme]);
      }
    }

    const missing = Object.keys(table).filter(k => !table[k].chrome);
    ok('every skin and theme defines --chrome', missing.length === 0, missing.join(', '));

    // Four skins must not all be the same colour, or "it ignores my choice" is
    // still true — just in a different file.
    const distinct = new Set(SKINS.map(s => table[s + '/light'].chrome));
    ok('the four skins give four different bar colours', distinct.size === 4,
      [...distinct].join(' '));

    // Every one of them is dark, which is why light icons are always right
    // today — asserted rather than assumed, because the day somebody adds a
    // pale skin this is the line that should fail.
    const pale = SKINS.filter(s => lum(toHex(table[s + '/light'].chrome)) >= 0.5);
    ok('every shipped bar colour is dark, so light icons are correct',
      pale.length === 0, pale.join(', '));

    // The clock and the battery are drawn ON this colour by Android. If the
    // bar were close to white the light icons would vanish; 4.5:1 against
    // white is the same bar the rest of this app is held to.
    const thin = SKINS.filter(s => contrast(toHex(table[s + '/light'].chrome), '#ffffff') < 4.5);
    ok('white icons are readable on every bar colour', thin.length === 0,
      thin.map(s => s + ' ' + contrast(toHex(table[s + '/light'].chrome), '#ffffff').toFixed(2)).join(', '));

    console.log('      ' + SKINS.map(s => s + ' ' + table[s + '/light'].chrome).join('  ·  '));
    await ctx.close();
  }

  // ══ 2. Every page hands the phone the skin's colour, not a literal ═══
  //
  // Six pages × four skins. The old map lived in five files and guidelines.html
  // had a sixth hard-coded value of its own (#0E7C5A) that followed nothing.
  {
    const wrong = [];
    for (const skin of SKINS) {
      const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
      await ctx.addInitScript(SEED, seed(skin, 'light'));
      const page = await ctx.newPage();
      await route(page);
      for (const p of PAGES) {
        await page.goto(ORIGIN + '/clinic/' + p, { waitUntil: 'load' });
        await page.waitForTimeout(450);
        const got = await page.evaluate(() => {
          const m = document.querySelector('meta[name="theme-color"]');
          return {
            meta: (m && m.getAttribute('content') || '').trim(),
            chrome: getComputedStyle(document.documentElement).getPropertyValue('--chrome').trim(),
            skin: document.documentElement.getAttribute('data-skin'),
            url: location.pathname,
          };
        });
        if (!got.chrome || toHex(got.meta) !== toHex(got.chrome)) {
          wrong.push(skin + ' ' + p + ': meta=' + got.meta + ' chrome=' + got.chrome + ' skin=' + got.skin);
        }
      }
      await ctx.close();
    }
    ok('every page declares the skin\'s own bar colour (' + (PAGES.length * SKINS.length) + ' checked)',
      wrong.length === 0, wrong.slice(0, 4).join(' | '));
  }

  // ══ 3. The installed app is actually TOLD, and told the right thing ══
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.addInitScript(FAKE_NATIVE);
    await ctx.addInitScript(SEED, seed('midnight', 'light'));
    const page = await ctx.newPage();
    await route(page);
    await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
    await page.waitForTimeout(900);

    const calls = await page.evaluate(() => window.__bars || []);
    const chromeCalls = calls.filter(c => c.kind === 'chrome');
    const sbCalls = calls.filter(c => c.kind === 'statusBar');

    ok('the installed app is told the bar colour at all', chromeCalls.length > 0,
      JSON.stringify(calls).slice(0, 160));
    ok('...and it is the MIDNIGHT colour, not the brand green',
      chromeCalls.length > 0 && toHex(chromeCalls[0].arg.color) === '#0c2340',
      (chromeCalls[0] || {}).arg && chromeCalls[0].arg.color);
    ok('...with light icons, because that colour is dark',
      chromeCalls.length > 0 && chromeCalls[0].arg.lightIcons === true,
      JSON.stringify((chromeCalls[0] || {}).arg));

    /* Two plugins setting the same bar in the same moment is a visible
     * flicker, and makes "which one won?" unanswerable the next time somebody
     * photographs a wrong colour. Where HomattChrome exists it does both bars
     * and StatusBar is left alone. */
    ok('the old status-bar plugin is NOT also called, so nothing races',
      sbCalls.length === 0, JSON.stringify(sbCalls));

    // Live skin change — this is the settings screen, where somebody taps a
    // colour and watches. The bar has to move with the page, not on reload.
    await page.evaluate(() => {
      window.__bars.length = 0;
      document.documentElement.setAttribute('data-skin', 'clay');
    });
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => window.__bars.filter(c => c.kind === 'chrome'));
    ok('changing the colour moves the bars there and then',
      after.length > 0 && toHex(after[0].arg.color) === '#3b2f27',
      JSON.stringify(after).slice(0, 140));

    await ctx.close();
  }

  // ══ 3b. THE REAL PICKER, not an attribute set by the test ════════════
  //
  // clinic-look.js has its own paintThemeColor(), called from applySkin() —
  // a SIXTH place that set this colour, and it read `--grad-1` where
  // everything else now reads `--chrome`. Same value today, which is exactly
  // why it would have gone unnoticed. Driving the attribute directly (above)
  // exercises the observer and walks straight past this path; tapping the
  // button a clinician taps is the only thing that covers it.
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.addInitScript(FAKE_NATIVE);
    await ctx.addInitScript(SEED, seed('forest', 'light'));
    const page = await ctx.newPage();
    await route(page);
    await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    const tapped = await page.evaluate(() => {
      window.__bars.length = 0;
      const b = document.querySelector('.look-opt[data-skin="clay"]');
      if (!b) return false;
      b.click();
      return true;
    });
    ok('the colour picker is on the settings screen', tapped);
    await page.waitForTimeout(600);

    const out = await page.evaluate(() => ({
      calls: window.__bars.filter(c => c.kind === 'chrome'),
      meta: (document.querySelector('meta[name="theme-color"]') || {}).content,
      skin: document.documentElement.getAttribute('data-skin'),
    }));
    ok('tapping a colour actually changes the skin', out.skin === 'clay', out.skin);
    ok('...and the phone is told, through the one path', out.calls.length > 0 &&
      toHex(out.calls[out.calls.length - 1].arg.color) === '#3b2f27',
      JSON.stringify(out.calls).slice(0, 140));
    ok('...and the page agrees with what the phone was told',
      toHex(out.meta) === '#3b2f27', out.meta);
    await ctx.close();
  }

  // ══ 4. The APK a clinic is holding TODAY ═════════════════════════════
  //
  // HomattChrome is Java, so it only arrives with an install. The top bar has
  // to be fixed for everybody NOW, through the plugin every shipped APK
  // already carries — otherwise this fix reaches nobody until they install,
  // which is the complaint it is answering.
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.addInitScript(FAKE_OLD_APK);
    await ctx.addInitScript(SEED, seed('dark', 'dark'));
    const page = await ctx.newPage();
    await route(page);
    await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    const calls = await page.evaluate(() => window.__bars || []);
    const sb = calls.filter(c => c.kind === 'statusBar');
    const st = calls.filter(c => c.kind === 'style');
    ok('an APK without the new plugin still gets its top bar set',
      sb.length > 0, JSON.stringify(calls).slice(0, 160));
    ok('...to black, for the True dark skin',
      sb.length > 0 && toHex(sb[sb.length - 1].arg.color) === '#000000',
      sb.map(c => c.arg.color).join(','));
    /* Capacitor's names read backwards: Style.Dark means "content FOR a dark
     * background", i.e. LIGHT icons. The old code asked for LIGHT — dark icons
     * — on a near-black bar, and got away with it only because Android drew
     * white anyway. */
    ok('...and asks for light icons (Capacitor spells that "DARK")',
      st.length > 0 && st[st.length - 1].arg.style === 'DARK',
      st.map(c => c.arg.style).join(','));
    // And no green anywhere in what the phone was told.
    const green = calls.filter(c => /1b5e20/i.test(JSON.stringify(c.arg)));
    ok('the phone is never told #1B5E20 again', green.length === 0, JSON.stringify(green));
    await ctx.close();
  }

  // ══ 5. A browser is unaffected, and nothing calls a plugin that is absent ══
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.addInitScript(SEED, seed('clay', 'light'));
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
    await route(page);
    await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(900);
    const meta = await page.evaluate(() => {
      const m = document.querySelector('meta[name="theme-color"]');
      return m && m.getAttribute('content');
    });
    ok('a plain browser still gets the right colour', toHex(meta) === '#3b2f27', meta);
    ok('...and no error from looking for a bridge that is not there',
      errors.length === 0, errors[0]);
    await ctx.close();
  }

  // ══ 6. The sources the bug actually lived in ═════════════════════════
  {
    const nb = read('app/js/native-bridge.js');
    const statusFn = nb.slice(nb.indexOf('function initStatusBar'),
                              nb.indexOf('function hideSplash'));
    ok('native-bridge no longer hard-codes a bar colour',
      !/#1B5E20/i.test(statusFn), 'still has the literal');
    ok('...and defers to the portal where the portal owns the chrome',
      /HomattChrome/.test(statusFn));

    // Five copies of one fact is five chances for the next skin to reach four
    // of them. Assert on the MAP, not on the colour: #0B3D2E is still a legal
    // value of --chrome and must not make this fail.
    const maps = [];
    for (const f of ['index', 'dashboard', 'settings', 'new-order', 'messages', 'guidelines']) {
      const s = read('app/clinic/' + f + '.html');
      if (/midnight\s*:\s*'#/.test(s)) maps.push(f + '.html');
    }
    ok('the colour map is not copied into any page any more', maps.length === 0, maps.join(', '));

    // The nav bar has no web API, so this is the only thing that can move it.
    const plug = read('android/app/src/main/java/ug/homatt/health/HomattChromePlugin.java');
    ok('the native plugin sets the NAVIGATION bar, which no web API can',
      /setNavigationBarColor/.test(plug));
    ok('...and is registered before the bridge is built, or JS cannot see it',
      (() => {
        const m = read('android/app/src/main/java/ug/homatt/health/MainActivity.java')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');   // comments lie
        return m.indexOf('registerPlugin(HomattChromePlugin') >= 0 &&
               m.indexOf('registerPlugin(HomattChromePlugin') < m.indexOf('super.onCreate');
      })());
    ok('...and the colour is remembered, so a launch does not flash green first',
      /SharedPreferences/.test(plug) && /applyRemembered/.test(plug));
    ok('...and the remembered colour is applied on launch',
      /applyRemembered/.test(read('android/app/src/main/java/ug/homatt/health/MainActivity.java')));
  }

  await b.close();
  server.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
