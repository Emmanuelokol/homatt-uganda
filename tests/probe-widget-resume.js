// A widget tap ALWAYS arrives on a page that was just backgrounded.
//
// That is the one condition every test so far has missed. `test-open.js` calls
// HomattOpen.go() on a page that is wide awake — but a clinician tapping a
// home-screen widget has, by definition, left the app: the WebView was hidden,
// and it becomes visible again in the same instant the intent is delivered.
//
// The report that sent me here:
//   "quick sale ... takes straight to the quick sale, but the active treatment
//    or active doesn't take me to the active treatment section, it takes me to
//    the home page, and also same with the new treatment"
//
// Quick sale working is the clue. All three go through the same router, so the
// link IS arriving and IS being parsed. Whatever separates them happens after.
//
//   node tests/probe-widget-resume.js
const path = require('path');
const fs = require('fs');
const http = require('http');
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');

const APP = path.join(__dirname, '..', 'app');
const MIME = { '.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.db':'application/octet-stream' };
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});
const PORT = 8982, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

/* The phone: a Capacitor bridge whose appUrlOpen listener we can fire, exactly
 * as Android does when a widget PendingIntent reaches a running app. */
const FAKE_PHONE = () => {
  window.__listeners = [];
  window.Capacitor = {
    isNative: true, platform: 'android', isNativePlatform: () => true,
    Plugins: {
      App: {
        addListener: (ev, fn) => { if (ev === 'appUrlOpen') window.__listeners.push(fn); return { remove(){} }; },
        getLaunchUrl: () => Promise.resolve(null),
      },
      StatusBar: { setStyle: () => Promise.resolve(), setBackgroundColor: () => Promise.resolve() },
    },
  };
  // Drive document.hidden the way Android does when the app leaves the front.
  window.__setHidden = (v) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => v });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (v ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  window.__tapWidget = (target) => {
    const url = 'homatt://app/' + target;
    window.__listeners.forEach(fn => { try { fn({ url }); } catch (e) {} });
    return window.__listeners.length;
  };
};

const SEED = ([cid, uid]) => {
  /* NOT sessionStorage.clear(). This runs on EVERY page load, and the router
   * carries the tapped target across a navigation in sessionStorage — so
   * clearing it here would wipe the thing being measured on the very page
   * that is supposed to act on it, and report the app broken when it is the
   * instrument. (It did exactly that on the first run.) */
  localStorage.clear();
  localStorage.setItem('clinic_session', JSON.stringify({ userId: uid, staffName: 'D. Musinguzi',
    clinicName: 'family clinic', clinicId: cid, staffRole: 'owner', level: 'HC III' }));
  localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token: 't', refresh_token: 'r',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: { id: uid } }));
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  async function run(label, startPage, target) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.addInitScript(FAKE_PHONE);
    await ctx.addInitScript(SEED, [CID, UID]);
    const page = await ctx.newPage();
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
      return r.abort();
    });
    await page.goto(ORIGIN + '/clinic/' + startPage, { waitUntil: 'load' });
    await page.waitForTimeout(2600);

    // 1. They press HOME. The app goes to the background.
    await page.evaluate(() => window.__setHidden(true));
    await page.waitForTimeout(3200);          // longer than the wizard's 2500ms

    /* 2. They tap the widget. Android delivers the intent to the running app
     *    and brings it forward — the tap and the wake are the same instant.
     *
     *    Either of these can navigate the page out from under us, which
     *    destroys the execution context. That is not an error, it is the
     *    behaviour being measured, so both are tolerated. */
    let fired = 0;
    try { fired = await page.evaluate((t) => window.__tapWidget(t), target); } catch (e) { fired = -1; }
    await page.waitForTimeout(400);
    try { await page.evaluate(() => window.__setHidden(false)); } catch (e) {}

    await page.waitForTimeout(3000);
    const where = await page.evaluate(() => {
      const ov = document.getElementById('svOverlay');
      const qs = document.getElementById('qsSheet');
      const slide = document.querySelector('.slide-tab.active');
      return {
        page: location.pathname.split('/').pop(),
        slide: slide ? slide.textContent.replace(/\s+/g, ' ').trim() : null,
        activeFullView: !!(ov && getComputedStyle(ov).display !== 'none'),
        quickSaleOpen: !!(qs && qs.offsetParent !== null),
      };
    });
    console.log('  ' + label.padEnd(46) +
      'landed on ' + String(where.page).padEnd(17) +
      (where.slide ? 'slide=' + where.slide.padEnd(9) : '                ') +
      (where.activeFullView ? ' ACTIVE-FULL-VIEW' : '') +
      (where.quickSaleOpen ? ' QUICK-SALE-OPEN' : '') +
      (fired ? '' : '  (no listener!)'));
    await ctx.close();
    return where;
  }

  console.log('\n── tapped from the home screen, app was on the DASHBOARD ──');
  await run('New treatment', 'dashboard.html', 'new-treatment');
  await run('Active',        'dashboard.html', 'active');
  await run('Quick sale',    'dashboard.html', 'quick-sale');

  console.log('\n── tapped from the home screen, app was on NEW-ORDER ──────');
  await run('New treatment', 'new-order.html', 'new-treatment');
  await run('Active',        'new-order.html', 'active');
  await run('Quick sale',    'new-order.html', 'quick-sale');

  console.log('\n── tapped from the home screen, app was on SETTINGS ───────');
  await run('New treatment', 'settings.html', 'new-treatment');
  await run('Active',        'settings.html', 'active');
  await run('Quick sale',    'settings.html', 'quick-sale');

  /* ── COLD START, which is how a widget is most often tapped ──────────────
   *
   * The app is not running at all. Android launches MainActivity with the
   * intent, and the app begins at app/index.html, which replaces itself with
   * clinic/index.html, which sends a signed-in clinic on to dashboard.html.
   * Three navigations before anything that can act on the target.
   *
   * On that path the ONLY thing that can recover the tap is
   * App.getLaunchUrl() — the appUrlOpen event fired long before any of our
   * code existed. If that is not consulted on whichever page finally stands
   * still, the clinician lands on the dashboard: "it takes me to the home
   * page", which is the report, word for word. */
  console.log('\n── COLD START: app not running, launched BY the widget ────');
  for (const target of ['new-treatment', 'active', 'quick-sale']) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.addInitScript((t) => {
      window.__listeners = [];
      window.Capacitor = {
        isNative: true, platform: 'android', isNativePlatform: () => true,
        Plugins: {
          App: {
            addListener: (ev, fn) => { if (ev === 'appUrlOpen') window.__listeners.push(fn); return { remove(){} }; },
            // Android hands the launch intent's data back here, for the whole
            // life of the activity — which is what makes a cold start
            // recoverable at all.
            getLaunchUrl: () => Promise.resolve({ url: 'homatt://app/' + t }),
          },
          StatusBar: { setStyle: () => Promise.resolve(), setBackgroundColor: () => Promise.resolve() },
        },
      };
    }, target);
    await ctx.addInitScript(SEED, [CID, UID]);
    const page = await ctx.newPage();
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
      return r.abort();
    });
    // The REAL entry point the APK opens, not the clinic page directly.
    await page.goto(ORIGIN + '/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(6000);
    const where = await page.evaluate(() => {
      const ov = document.getElementById('svOverlay');
      const qs = document.getElementById('qsSheet');
      return {
        page: location.pathname.split('/').pop(),
        activeFullView: !!(ov && getComputedStyle(ov).display !== 'none'),
        quickSaleOpen: !!(qs && qs.offsetParent !== null),
      };
    }).catch(() => ({ page: '(gone)' }));
    console.log('  ' + ('cold start -> ' + target).padEnd(46) +
      'landed on ' + String(where.page).padEnd(17) +
      (where.activeFullView ? ' ACTIVE-FULL-VIEW' : '') +
      (where.quickSaleOpen ? ' QUICK-SALE-OPEN' : ''));
    await ctx.close();
  }

  // The control: no widget at all, just leaving and coming back. If this also
  // lands on the dashboard then the bounce is nothing to do with the widget.
  console.log('\n── CONTROL: backgrounded and resumed, NO widget tap ───────');
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
    await ctx.addInitScript(FAKE_PHONE);
    await ctx.addInitScript(SEED, [CID, UID]);
    const page = await ctx.newPage();
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
      return r.abort();
    });
    await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
    await page.waitForTimeout(2600);
    await page.evaluate(() => window.__setHidden(true));
    await page.waitForTimeout(3200);
    await page.evaluate(() => window.__setHidden(false));
    await page.waitForTimeout(2500);
    console.log('  ' + 'on new-order, leave and come back'.padEnd(46) +
      'landed on ' + await page.evaluate(() => location.pathname.split('/').pop()));
    await ctx.close();
  }

  await b.close(); server.close();
})();
