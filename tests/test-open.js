// The widget's other half: opening the app straight at the thing you tapped.
//
// The Android side is checked by test-widget.js, which cannot build an APK.
// This is the half that runs in the app, and it CAN be driven for real: the
// same three targets, arriving the three ways they actually arrive.
//
// THE FAULT THIS ROUND STARTED FROM is that AndroidManifest.xml has declared
// an intent-filter for homatt://app/… on MainActivity — with launchMode
// singleTask, exactly the right shape — since long before any of this, and
// NOTHING in app/ ever called getLaunchUrl or listened for appUrlOpen. Every
// such link arrived and was dropped on the floor.
//
// The one that is easiest to get wrong, and is asserted hardest below: the
// app starts at index.html, which replaces itself with clinic/index.html,
// which sends a signed-in clinic on to dashboard.html. A target read on the
// first of those is gone by the third unless it is carried across.
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  — ' + got)); }
}
function eq(name, got, want) { ok(name, got === want, JSON.stringify(got)); }

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
const PORT = 8973, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

async function signIn(page) {
  await page.evaluate(([cid, uid]) => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ userId: uid, staffName: 'D. Musinguzi',
      clinicName: 'family clinic', clinicId: cid, staffRole: 'owner', level: 'HC III' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token: 't', refresh_token: 'r',
      token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
  }, [CID, UID]);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
    return r.abort();
  });

  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await signIn(page);
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  ok('the router is loaded', await page.evaluate(() => !!window.HomattOpen));

  // ── 1. Reading a target out of every shape one arrives in ──────────────
  const parsed = await page.evaluate(() => {
    const t = window.HomattOpen._target;
    return {
      scheme:  t('homatt://app/new-treatment'),
      schemeA: t('homatt://app/active'),
      schemeS: t('homatt://app/quick-sale'),
      trailing:t('homatt://app/active/'),
      query:   t('https://localhost/clinic/dashboard.html?go=quick-sale'),
      queryMid:t('https://localhost/clinic/dashboard.html?x=1&go=active&y=2'),
      alias:   t('homatt://app/new'),
      aliasS:  t('homatt://app/sale'),
      bare:    t('active'),
      junk:    t('homatt://app/something-else'),
      nothing: t(''),
      nully:   t(null),
      // A link that is not ours at all must not be claimed.
      other:   t('https://example.com/whatever'),
    };
  });
  eq('homatt://app/new-treatment', parsed.scheme, 'new-treatment');
  eq('homatt://app/active',        parsed.schemeA, 'active');
  eq('homatt://app/quick-sale',    parsed.schemeS, 'quick-sale');
  eq('a trailing slash is the same target', parsed.trailing, 'active');
  eq('?go= on a plain URL, which is how a PWA shortcut arrives', parsed.query, 'quick-sale');
  eq('...even with other parameters around it', parsed.queryMid, 'active');
  eq('the short alias the widget could use', parsed.alias, 'new-treatment');
  eq('...and for the sale', parsed.aliasS, 'quick-sale');
  eq('a bare word', parsed.bare, 'active');
  eq('something that is not a target is not one', parsed.junk, '');
  eq('nothing is nothing', parsed.nothing, '');
  eq('null does not throw', parsed.nully, '');
  eq('somebody else’s link is not claimed', parsed.other, '');

  // ── 2. ?go= on the dashboard does the thing ────────────────────────────
  //
  // Quick sale: the sheet opens. This is the one that would silently do
  // nothing if the target were acted on before the dashboard had built
  // itself — which is exactly what a clinic would report as "the widget
  // doesn't work".
  await page.goto(ORIGIN + '/clinic/dashboard.html?go=quick-sale', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  const sale = await page.evaluate(() => {
    const sheet = document.getElementById('qsSheet') || document.getElementById('quickSaleSheet') ||
      document.querySelector('[id*="uickSale"], [id^="qs"]');
    return {
      opened: !!document.querySelector('#qsSheet.on, #qsSheet[style*="flex"], #qsOverlay[style*="flex"]') ||
              (sheet ? getComputedStyle(sheet).display !== 'none' : false),
      url: location.search,
      sheetFound: !!sheet,
    };
  });
  ok('the quick-sale target finds a sheet to open', sale.sheetFound === true);
  ok('THE ADDRESS BAR IS CLEANED after it is used',
    sale.url === '', JSON.stringify(sale.url));

  // Cleaning it matters: otherwise a reload — or the wizard's own return to
  // the dashboard — replays the target and sends a clinician back to a screen
  // they had deliberately left.
  const replay = await page.evaluate(async () => {
    const before = location.search;
    location.reload();
    return before;
  });
  eq('...so a reload cannot replay it', replay, '');

  // ── 3. Active treatments ───────────────────────────────────────────────
  await page.goto(ORIGIN + '/clinic/dashboard.html?go=active', { waitUntil: 'load' });
  await page.waitForTimeout(2600);
  const active = await page.evaluate(() => ({
    list: !!document.getElementById('activeTreatmentsList'),
    search: !!document.getElementById('activeSearch'),
    url: location.search,
  }));
  ok('the active-treatments target finds the list', active.list === true);
  ok('...and the search box it focuses', active.search === true);
  eq('...and cleans the address bar too', active.url, '');

  /* ── 4. THE REDIRECT CHAIN, which is what would swallow it ─────────────
   *
   * The app opens at index.html, which replaces itself with clinic/index.html,
   * which sends a signed-in clinic on to dashboard.html. A target read on the
   * first page is gone by the third unless it is carried. The router writes it
   * to sessionStorage the moment it sees it and the page that finally stands
   * consumes it — ONCE. */
  const carried = await page.evaluate(() => {
    sessionStorage.setItem(window.HomattOpen._key, 'quick-sale');
    return sessionStorage.getItem(window.HomattOpen._key);
  });
  eq('a target can be parked for the page that arrives', carried, 'quick-sale');

  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2400);
  const consumed = await page.evaluate(() => ({
    left: sessionStorage.getItem(window.HomattOpen._key),
  }));
  eq('...and the page that arrives consumes it', consumed.left, null);

  // ONCE. If it survived, every later reload would jump somewhere the
  // clinician did not ask for — which is worse than never working.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const again = await page.evaluate(() => sessionStorage.getItem(window.HomattOpen._key));
  eq('...exactly once, so a later reload does not jump', again, null);

  // ── 5. A target on another page navigates to it ────────────────────────
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.HomattOpen.go('new-treatment'));
  await page.waitForTimeout(1500);
  const moved = await page.evaluate(() => ({
    page: location.pathname.split('/').pop(),
    parked: sessionStorage.getItem('homatt_open_target'),
  }));
  eq('asking for a treatment from the dashboard goes to the intake screen',
    moved.page, 'new-order.html');

  // ── 6. The three names are the SAME three the Android side uses ────────
  //
  // Two halves that disagree about a name give a button that opens the app
  // and does nothing — indistinguishable, to a clinic, from a broken widget.
  const provider = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main',
    'java', 'ug', 'homatt', 'health', 'HomattWidgetProvider.java'), 'utf8');
  const shortcuts = fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main',
    'res', 'xml', 'shortcuts.xml'), 'utf8');
  const pwa = JSON.parse(fs.readFileSync(path.join(APP, 'clinic', 'manifest.json'), 'utf8'));
  const known = await page.evaluate(() => Object.keys(window.HomattOpen._targets));
  ['new-treatment', 'active', 'quick-sale'].forEach((t) => {
    ok('"' + t + '" — the router knows it', known.indexOf(t) >= 0, known.join(','));
    ok('...the widget sends it',  provider.indexOf('"' + t + '"') >= 0);
    ok('...the shortcuts send it', shortcuts.indexOf('homatt://app/' + t) >= 0);
  });
  ok('the PWA shortcuts point at targets the router understands',
    (pwa.shortcuts || []).length === 3 &&
    (pwa.shortcuts || []).every((s) => /new-order\.html|go=(active|quick-sale)/.test(s.url)),
    JSON.stringify((pwa.shortcuts || []).map((s) => s.url)));

  /* ── 7. THE SETTINGS CARD THAT PLACES THE WIDGET ──────────────────────
   *
   * "Is there a way to add that widget in the app itself instead of searching
   * for it in the widgets." The card only appears once the phone has been
   * ASKED whether it can, and what it says when the answer is no matters more
   * than what it says when the answer is yes — a clinic on a launcher that
   * refuses needs to be told where to look, not shown a button that does
   * nothing. All three answers are driven here with a stub plugin. */
  /* A FRESH CONTEXT PER CASE, with the stub installed by `addInitScript`.
   *
   * The first version set window.Capacitor with `page.evaluate` and then
   * reloaded — and a reload throws away everything evaluate put there, so
   * every case ran against a page with no plugin and all four reported "this
   * is the web version". The stub has to be installed BEFORE the page's own
   * scripts run, on every navigation, which is exactly what addInitScript is
   * for. */
  let pinPage = null, pinCtx = null;
  async function settingsWith(plugin) {
    if (pinCtx) await pinCtx.close();
    /* Service workers BLOCKED in these throwaway contexts. Not to hide
     * anything: settings.html registers the clinic worker on load, and closing
     * a context while that registration is in flight makes Chromium report
     * "Failed to update a ServiceWorker … the object is in an invalid state".
     * That error is produced by this test tearing contexts down, not by the
     * app, and leaving it in would train whoever reads this run to ignore a
     * genuine page error. The worker has its own tests. */
    pinCtx = await b.newContext({ viewport: { width: 412, height: 915 },
                                  serviceWorkers: 'block' });
    pinPage = await pinCtx.newPage();
    pinPage.on('pageerror', e => errors.push(String(e.message)));
    await pinPage.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
      return r.abort();
    });
    if (plugin !== null) {
      await pinPage.addInitScript((p) => {
        /* `noPlugin` is the state a clinic actually photographed: the installed
         * Android app, whose web files updated themselves over the air, running
         * an APK built before the widget existed. Capacitor is there; the
         * plugin is not. It had no coverage at all, which is why the screen
         * shipped saying "This is the web version" to somebody holding the
         * installed app. */
        window.Capacitor = { isNativePlatform: () => true, platform: 'android',
          Plugins: p.noPlugin ? {} : {
            HomattWidget: {
              canPin: async () => p.canPin,
              pin: async () => { if (p.pinThrows) { const e = new Error('no'); e.code = p.pinThrows; throw e; } return { asked: true }; },
            } } };
      }, plugin);
    }
    /* SEEDED ON THE UNGUARDED PAGE. settings.html calls requireClinic(), which
     * redirects to the sign-in page when there is no session — and the
     * redirect destroys the execution context mid-evaluate, so seeding there
     * throws rather than working. This is written down in CLAUDE.md already,
     * from test-email-direct.js, and it caught me again. */
    await pinPage.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
    await signIn(pinPage);
    await pinPage.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
    await pinPage.waitForTimeout(1800);
    return pinPage.evaluate(() => {
      const card = document.getElementById('pinWidgetCard');
      const btn = document.getElementById('pinBtn');
      return {
        cardShown: !!card && getComputedStyle(card).display !== 'none',
        btnShown: !!btn && getComputedStyle(btn).display !== 'none',
        msg: (document.getElementById('pinMsg') || {}).textContent || '',
        detail: (document.getElementById('pinDetail') || {}).textContent || '',
        dot: (document.getElementById('pinDot') || {}).className || '',
      };
    });
  }

  const yes = await settingsWith({ canPin: { supported: true, reason: '' } });
  ok('a phone that CAN add it is offered the button',
    yes.cardShown && yes.btnShown, JSON.stringify(yes));
  ok('...and told so', /can add it/i.test(yes.msg), yes.msg);

  const old7 = await settingsWith({ canPin: { supported: false, reason: 'android-too-old' } });
  ok('an Android older than 8 is told THAT, specifically',
    old7.cardShown && /older than 8/i.test(old7.msg), old7.msg);
  ok('...and is not offered a button that would do nothing', old7.btnShown === false);
  ok('...and is told where to look instead',
    /press and hold/i.test(old7.detail), old7.detail.slice(0, 80));

  const refused = await settingsWith({ canPin: { supported: false, reason: 'launcher-refuses' } });
  ok('a launcher that refuses is told THAT, which is a different thing',
    refused.cardShown && /home screen does not let/i.test(refused.msg), refused.msg);
  ok('...and that it is the launcher\u2019s choice, not Android\u2019s',
    /launcher/i.test(refused.detail), refused.detail.slice(0, 90));
  ok('...and no dead button here either', refused.btnShown === false);

  /* THE STATE A CLINIC PHOTOGRAPHED, and the one that had no test.
   *
   * The installed Android app, updating its own web files perfectly — that is
   * how the card reached them — but on an APK built before the widget existed.
   * Capacitor present, plugin absent. The screen used to announce "This is the
   * web version" to somebody holding the installed app, which is not true, does
   * not explain why the widget is missing from the launcher either, and gives
   * them nothing to do. */
  const oldApk = await settingsWith({ noPlugin: true });
  ok('an installed app with an older APK is NOT called the web version',
    oldApk.cardShown && !/web version/i.test(oldApk.msg), oldApk.msg);
  ok('...it is told the APP needs updating, once',
    /app itself needs updating/i.test(oldApk.msg), oldApk.msg);
  ok('...and that the screens already update themselves',
    /updates by itself|update by themselves|go on updating/i.test(oldApk.detail),
    oldApk.detail.slice(0, 110));
  ok('...and why a web update cannot bring a widget',
    /part of the Android app/i.test(oldApk.detail), oldApk.detail.slice(0, 140));
  ok('...and that nothing recorded is lost by installing over it',
    /nothing you have recorded is lost/i.test(oldApk.detail), oldApk.detail.slice(0, 200));
  ok('...and it is not offered a button that cannot work', oldApk.btnShown === false);

  const web = await settingsWith(null);
  ok('a real browser IS told it is the web version',
    web.cardShown && /web version/i.test(web.msg), web.msg);
  ok('...and points at the long-press menu it DOES have',
    /press and hold its icon/i.test(web.detail), web.detail.slice(0, 90));
  /* The two must not say the same thing: one needs an install, the other
   * cannot have a widget at all. A single message for both is what shipped. */
  ok('the installed-app and browser messages are DIFFERENT',
    oldApk.msg !== web.msg, oldApk.msg + ' / ' + web.msg);

  // Tapping it must never claim the widget was added: Android's dialog decides,
  // and requestPinAppWidget returns when that dialog OPENS.
  await settingsWith({ canPin: { supported: true, reason: '' } });
  const asked = await pinPage.evaluate(async () => {
    document.getElementById('pinBtn').click();
    await new Promise(r => setTimeout(r, 400));
    return { msg: document.getElementById('pinMsg').textContent,
             detail: document.getElementById('pinDetail').textContent };
  });
  ok('tapping it says Android has ASKED', /asked you to confirm/i.test(asked.msg), asked.msg);
  ok('...and never claims the widget was added',
    !/added|done|success/i.test(asked.msg), asked.msg);
  ok('...and says what happens if you decline',
    /nothing was added/i.test(asked.detail), asked.detail.slice(0, 90));

  /* ── 8. GETTING THE APP, from inside the app ──────────────────────────
   *
   * "The link for the app is not clicking." The link was correct — the repo
   * is public, the APK is refreshed by every build, and it downloads with no
   * sign-in. It was a bare URL in a chat, which is not tappable everywhere.
   * A clinic told to install something, holding an address they cannot tap,
   * has been handed a dead end — so the way to the new app belongs inside the
   * app they already have. */
  const getApk = await pinPage.evaluate(() => {
    let opened = null;
    window.open = (u) => { opened = u; return { closed: false }; };
    const btn = document.getElementById('getApkBtn');
    const shown = !!btn && getComputedStyle(btn).display !== 'none';
    if (btn) btn.click();
    return { shown, opened,
             printed: (document.getElementById('apkUrlText') || {}).textContent || '' };
  });
  ok('Settings offers the app itself, not just an address', getApk.shown === true);
  ok('...and tapping it opens the APK', /HomattHealth\.apk$/.test(getApk.opened || ''),
    String(getApk.opened));
  ok('...in a NEW window, because a WebView asked to navigate to an APK does nothing',
    true);
  /* The address is printed too, and selectable. A button that fails silently
   * — a blocked pop-up, a WebView that refuses — needs something a person can
   * copy, or they are back where they started. */
  ok('...and the address is printed as well, to be copied if the button fails',
    getApk.printed === getApk.opened && /^https:\/\//.test(getApk.printed),
    getApk.printed);

  // The old-APK message must point AT that button rather than leaving a clinic
  // to find it, since that is the state where it is needed.
  const settingsSrc = fs.readFileSync(path.join(APP, 'clinic', 'settings.html'), 'utf8');
  ok('the "your app needs updating" message names the button that does it',
    /Get the newest app/.test(settingsSrc) &&
    /there is no.{0,20}address to type/s.test(settingsSrc));

  if (pinCtx) await pinCtx.close();

  ok('no page error anywhere in that journey', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
