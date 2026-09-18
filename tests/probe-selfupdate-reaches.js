/* DOES THE SELF-UPDATE MECHANISM EXIST INSIDE THE INSTALLED APP AT ALL?
 *
 * Every round of "the screens update themselves after one more install" rests
 * on one assumption nothing had ever checked: that clinic-sw.js is RUNNING in
 * the Android app. The worker is the whole mechanism — it fetches the newer
 * build from where the web version lives and writes it into this origin's
 * cache. No worker, no update, for ever.
 *
 * This asks the only question that matters, in both states:
 *   - is a service worker registered?
 *   - does a homatt-clinic-vNNN cache exist?
 *   - what does the version line say?
 *
 *   node tests/probe-selfupdate-reaches.js
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
const PORT = 8986, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

const SEED = ([cid, uid]) => {
  localStorage.setItem('clinic_session', JSON.stringify({ userId: uid, staffName: 'D. Musinguzi',
    clinicName: 'family clinic', clinicId: cid, staffRole: 'owner', level: 'HC III' }));
  localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token: 't', refresh_token: 'r',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: { id: uid } }));
};

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

  async function look(label, native) {
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
    // A second load, because an install completes between the two — this is the
    // ordinary case, not the first-ever launch.
    await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
    await page.waitForTimeout(8000);

    const r = await page.evaluate(async () => {
      let regs = [], keys = [], controller = null;
      try { regs = (await navigator.serviceWorker.getRegistrations()).map(x => x.scope); } catch (e) {}
      try { keys = (await caches.keys()).filter(k => k.indexOf('homatt-clinic-') === 0); } catch (e) {}
      try { controller = navigator.serviceWorker.controller ? 'yes' : 'no'; } catch (e) {}
      const el = document.getElementById('homattBuildLine');
      return { regs: regs.length, keys, controller,
               line: el ? el.textContent.replace(/\s+/g, ' ').trim() : '(none)' };
    });
    console.log('\n── ' + label + ' ' + '─'.repeat(Math.max(0, 50 - label.length)));
    console.log('  service worker registrations : ' + r.regs);
    console.log('  controlling this page        : ' + r.controller);
    console.log('  homatt-clinic caches         : ' +
      (r.keys.length ? r.keys.join(', ') : 'NONE — nothing to update, and nothing to name'));
    console.log('  the version line             : ' + r.line);
    await ctx.close();
    return r;
  }

  const web = await look('the WEB version (a browser)', false);
  const app = await look('the INSTALLED ANDROID APP', true);

  console.log('\n' + '='.repeat(64));
  if (app.regs === 0 && web.regs > 0) {
    console.log('The self-update mechanism is NOT PRESENT in the installed app.');
    console.log('clinic-sw.js is the whole mechanism, and pwa-install.js returns');
    console.log('early — and unregisters — whenever Capacitor is there. So an');
    console.log('installed clinic can only ever change by installing an APK.');
  } else if (app.regs > 0 && app.keys.length) {
    console.log('The worker IS running in the app and has a cache: ' + app.keys.join(', '));
  } else {
    console.log('Mixed: registrations=' + app.regs + ' caches=' + app.keys.length);
  }
  console.log('='.repeat(64));

  await b.close(); server.close();
})();
