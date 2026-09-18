/* DOES AN UPDATE REACH THE INSTALLED APP AT ALL?
 *
 * Everything the self-update mechanism does lives in clinic-sw.js — the build
 * name, the shell list, UPDATE_SOURCES, the staged swap, the downgrade guard,
 * `checkForUpdate`. test-selfupdate.js drives that worker thoroughly and it
 * passes. What nothing asked, for the whole life of the feature, is whether
 * the worker is REGISTERED on the device the feature exists for.
 *
 * It was not. `pwa-install.js` began with
 *
 *     if (isNativeApp()) { ...unregister every worker...; return; }
 *
 * so inside the APK clinic-sw.js never ran, and any worker it found was
 * removed. An installed clinic could therefore only ever change by installing
 * an APK — while every round of work said the opposite — and the version line,
 * which names the homatt-clinic-vNNN cache, had no cache to name and read
 * "Version v?". That is the report, word for word: "it doesn't show me any
 * version", from inside the app, while the web version beside it read v202.
 *
 * A perfect test of a mechanism proves nothing about whether the mechanism is
 * switched on. This file asks that, and only that.
 *
 *   node tests/test-app-updates.js
 */
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
const PORT = 8987, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? '  — ' + detail : '')); }
}

const SEED = ([cid, uid]) => {
  localStorage.setItem('clinic_session', JSON.stringify({ userId: uid, staffName: 'D. Musinguzi',
    clinicName: 'family clinic', clinicId: cid, staffRole: 'owner', level: 'HC III' }));
  localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token: 't', refresh_token: 'r',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: { id: uid } }));
};

/* The Capacitor bridge, as the installed app presents it. Nothing else about
 * this context differs from a browser — which is the point: the ONLY thing
 * that used to decide whether the update mechanism existed was this object. */
const NATIVE = () => {
  window.Capacitor = {
    isNative: true, platform: 'android', isNativePlatform: () => true,
    Plugins: {
      App: { getInfo: () => Promise.resolve({ version: '1.1.582', build: '582' }),
             addListener: () => ({ remove(){} }), getLaunchUrl: () => Promise.resolve(null) },
      StatusBar: { setStyle: () => Promise.resolve(), setBackgroundColor: () => Promise.resolve() },
    },
  };
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  // What the worker itself says its build is. Asserting against the CONSTANT
  // rather than a copy of it — a test that repeats the number cannot see the
  // number go stale, which is how v151 survived two months.
  const swSrc = fs.readFileSync(path.join(APP, 'clinic', 'clinic-sw.js'), 'utf8');
  const CACHE = (swSrc.match(/const CACHE = '([^']+)'/) || [])[1] || '';
  const BUILD = CACHE.replace(/^homatt-clinic-/, '');

  async function open(native) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'allow' });
    if (native) await ctx.addInitScript(NATIVE);
    await ctx.addInitScript(SEED, [CID, UID]);
    const page = await ctx.newPage();
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
      return r.abort();
    });
    await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(6000);
    await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
    await page.waitForTimeout(8000);
    const r = await page.evaluate(async () => {
      let scopes = [], keys = [];
      try { scopes = (await navigator.serviceWorker.getRegistrations()).map(x => x.scope); } catch (e) {}
      try { keys = (await caches.keys()).filter(k => k.indexOf('homatt-clinic-') === 0); } catch (e) {}
      const el = document.getElementById('homattBuildLine');
      const who = document.getElementById('verWho');
      return {
        scopes, keys,
        controlled: !!navigator.serviceWorker.controller,
        line: el ? el.textContent.replace(/\s+/g, ' ').trim() : '',
        who: who ? who.textContent.replace(/\s+/g, ' ').trim() : '',
        body: document.body.innerText.slice(0, 400),
      };
    });
    await ctx.close();
    return r;
  }

  console.log('\n── 1. the worker reaches the INSTALLED app ' + '─'.repeat(22));
  const app = await open(true);
  ok('the clinic worker is registered inside the installed app',
     app.scopes.some(s => /\/clinic\/$/.test(s)),
     'scopes: ' + JSON.stringify(app.scopes));
  ok('...and it is controlling the page', app.controlled);
  ok('...so there is a homatt-clinic cache — the thing an update is written into',
     app.keys.length > 0, 'caches: ' + JSON.stringify(app.keys));
  ok('...and it is THIS build, not an older one left behind',
     app.keys.indexOf(CACHE) >= 0, 'want ' + CACHE + ', got ' + JSON.stringify(app.keys));

  console.log('\n── 2. the version line names a build, in the app ' + '─'.repeat(16));
  /* "it doesn't show me any version". The line read `Version v?` on every
   * installed phone, because both of its sources came from a worker that was
   * never registered. It must name a build and it must say "android app". */
  ok('the side menu names the build rather than saying v?',
     app.line.indexOf('v?') < 0 && app.line.indexOf('Version ' + BUILD) === 0,
     JSON.stringify(app.line));
  ok('...and still says this is the android app, not a browser',
     /android app/.test(app.line), JSON.stringify(app.line));
  ok('Settings names the Android app and its build number',
     /The Android app/.test(app.who) && /build/.test(app.who),
     JSON.stringify(app.who.slice(0, 120)));
  ok('...and does NOT tell somebody holding the APK that they are on the web',
     !/This is the web version/.test(app.who) && !/A browser/.test(app.who),
     JSON.stringify(app.who.slice(0, 120)));

  console.log('\n── 3. the page shown is the real one, never the placeholder ' + '─'.repeat(5));
  /* The objection that kept the worker out of the app for its whole life: a
   * worker whose cache is empty could serve "Setting up…" INSTEAD of the page
   * baked into the APK. It is a real risk and this is what answers it. */
  ok('the settings screen itself rendered, not the "Setting up" placeholder',
     !/Setting up/.test(app.body) && app.body.length > 80,
     JSON.stringify(app.body.slice(0, 120)));

  console.log('\n── 4. the web version is unchanged by all this ' + '─'.repeat(18));
  const web = await open(false);
  ok('the web version still registers the clinic worker',
     web.scopes.some(s => /\/clinic\/$/.test(s)), JSON.stringify(web.scopes));
  ok('...and still names its build', web.line.indexOf('Version ' + BUILD) === 0,
     JSON.stringify(web.line));
  ok('...and still knows it is NOT the installed app',
     /browser|home screen/.test(web.line), JSON.stringify(web.line));
  /* ONE worker per area. A clinic page used to register clinic-sw.js AND the
   * patient app's root-scoped ../sw.js, so two workers raced for the same
   * pages — and in the APK the patient one was the only one there, which is
   * how clinic pages ended up controlled by a worker that knows nothing about
   * clinic builds. */
  ok('exactly one worker controls a clinic page, not two',
     web.scopes.length === 1, JSON.stringify(web.scopes));
  ok('...and the same inside the app', app.scopes.length === 1, JSON.stringify(app.scopes));

  console.log('\n── 5. version.json can answer on its own ' + '─'.repeat(24));
  /* The belt to that brace. Both earlier sources come from the worker; on a
   * first launch, after a cleaner, or before the worker starts, neither
   * exists. version.json is generated FROM clinic-sw.js and ships beside it,
   * so the files can always say which build they are. */
  const vj = JSON.parse(fs.readFileSync(path.join(APP, 'clinic', 'version.json'), 'utf8'));
  ok('version.json agrees with the worker it was generated from',
     vj.cache === CACHE, 'version.json ' + vj.cache + ' vs worker ' + CACHE);
  /* DRIVEN, not read. The first version of this assertion compared where
   * 'version.json' and "'v?'" appear in the source — which is a fact about
   * source order, not about behaviour, and it failed on code that is correct
   * (the fallback is a ternary near the top; the fetch that feeds it is
   * further down). A check that cannot tell those apart is worse than none.
   *
   * So: no worker, no cache — a phone on its very first launch, or one whose
   * storage a cleaner has just wiped — and the version must still name a
   * build, because the files themselves know it. */
  {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 },
                                     serviceWorkers: 'block' });
    await ctx.addInitScript(NATIVE);
    await ctx.addInitScript(SEED, [CID, UID]);
    const page = await ctx.newPage();
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
      return r.abort();
    });
    await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(5000);
    const bare = await page.evaluate(() => {
      const el = document.getElementById('homattBuildLine');
      return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
    });
    ok('with NO worker and NO cache it still names the build, not v?',
       bare.indexOf('v?') < 0 && bare.indexOf('Version ' + BUILD) === 0,
       JSON.stringify(bare));
    await ctx.close();
  }

  console.log('\n' + (fail ? 'FAILED' : 'OK') + ' — ' + pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
