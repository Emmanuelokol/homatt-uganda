/* WHAT DOES THE APP ACTUALLY TELL SOMEBODY ABOUT WHICH BUILD THEY HOLD?
 *
 * The report:
 *   "in the profile it still shows me that am on web, yet it did download ...
 *    if possible please fix it, it doesn't show me any version"
 *
 * Two claims, and both are answerable from here rather than by argument:
 *   1. the app says "web" to somebody who installed the APK
 *   2. no version is shown at all
 *
 * A phone can be in exactly four states, and the app has to tell them apart.
 * Every earlier assertion drove only the first and the last.
 *
 *   browser      no Capacitor at all
 *   home-screen  no Capacitor, display-mode: standalone   <- looks like an app
 *   old APK      Capacitor, but no App plugin and no HomattWidget
 *   new APK      Capacitor with both
 *
 *   node tests/probe-which-build.js
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
const PORT = 8985, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

const SEED = ([cid, uid]) => {
  localStorage.setItem('clinic_session', JSON.stringify({ userId: uid, staffName: 'D. Musinguzi',
    clinicName: 'family clinic', clinicId: cid, staffRole: 'owner', level: 'HC III' }));
  localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token: 't', refresh_token: 'r',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: { id: uid } }));
};

/* The bridge, in the shapes a real phone presents it.
 * `kind` is one of 'none' | 'old-apk' | 'new-apk'. */
const BRIDGE = (kind) => {
  if (kind === 'none') return;
  const P = {
    StatusBar: { setStyle: () => Promise.resolve(), setBackgroundColor: () => Promise.resolve() },
  };
  if (kind === 'new-apk') {
    P.App = {
      getInfo: () => Promise.resolve({ name: 'Homatt Clinic', id: 'ug.homatt.health',
                                       version: '1.1.582', build: '582' }),
      addListener: () => ({ remove() {} }),
      getLaunchUrl: () => Promise.resolve(null),
    };
    P.HomattWidget = { canPin: () => Promise.resolve({ supported: true }) };
    P.HomattChrome = { set: () => Promise.resolve() };
  }
  window.Capacitor = {
    isNative: true, platform: 'android', isNativePlatform: () => true, Plugins: P,
  };
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

  async function look(label, kind, standalone) {
    const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'allow' });
    await ctx.addInitScript(BRIDGE, kind);
    if (standalone) {
      // How a home-screen web app presents itself, and the ONLY signal it has.
      await ctx.addInitScript(() => {
        const real = window.matchMedia.bind(window);
        window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q)
          ? { matches: true, media: q, addListener(){}, removeListener(){},
              addEventListener(){}, removeEventListener(){} }
          : real(q));
      });
    }
    await ctx.addInitScript(SEED, [CID, UID]);
    const page = await ctx.newPage();
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status: 200,
        headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
      return r.abort();
    });
    const errs = [];
    page.on('pageerror', e => errs.push(String(e.message || e).slice(0, 120)));
    await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
    await page.waitForTimeout(9000);

    const r = await page.evaluate(() => {
      const t = (id) => {
        const el = document.getElementById(id);
        return el ? el.textContent.replace(/\s+/g, ' ').trim() : '(no element)';
      };
      return {
        verWho: t('verWho'),
        sideMenu: t('homattBuildLine'),
        widgetMsg: t('pinMsg'),
      };
    });
    console.log('\n── ' + label + ' ' + '─'.repeat(Math.max(0, 58 - label.length)));
    console.log('  version card : ' + (r.verWho || '(EMPTY)'));
    console.log('  side menu    : ' + (r.sideMenu || '(EMPTY)'));
    console.log('  widget card  : ' + (r.widgetMsg || '(EMPTY)'));
    if (errs.length) console.log('  PAGE ERRORS  : ' + errs.join(' | '));
    await ctx.close();
    return r;
  }

  await look('a plain BROWSER', 'none', false);
  await look('added to the HOME SCREEN (looks like an app)', 'none', true);
  await look('an OLD APK — Capacitor, but no App plugin', 'old-apk', false);
  await look('the NEWEST APK', 'new-apk', false);

  await b.close(); server.close();
})();
