// Install a NEW version of the Android app over an old one. Does the clinic
// actually see the new one?
//
// "I have downloaded the new app but still no updates." Installing a new APK
// replaces the files inside it — but Android keeps the WebView's storage, so
// the service worker, its caches and the IndexedDB shell copy all survive the
// update. The worker serves the shell CACHE-FIRST, by design, so the app can
// open with no connection. Put those two together and a brand-new APK can go
// on opening the old app out of the old cache.
//
// One server, whose FILES ARE SWAPPED underneath it — which is exactly what
// installing an APK does. The origin never changes, as it does not on a phone.
const path = require('path');
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs');
const { execFileSync } = require('child_process');
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.db':'application/octet-stream'};

const REPO = path.join(__dirname, '..');
const TMP = path.join(REPO, 'tests', '.apk-update-tmp');
const OLD_REF = process.env.OLD_REF || 'c6cad8e';
const PORT = 8931, ORIGIN = 'http://localhost:' + PORT;

// The folder the "phone" serves from. Swapping what is in it = installing an APK.
const ROOT = path.join(TMP, 'installed');

function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) {} }
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

(async () => {
  rmrf(TMP); fs.mkdirSync(TMP, { recursive: true });
  // The version the clinic already has installed.
  const oldSrc = path.join(TMP, 'old');
  fs.mkdirSync(oldSrc, { recursive: true });
  execFileSync('bash', ['-c',
    `git -C ${JSON.stringify(REPO)} archive ${OLD_REF} app | tar -x -C ${JSON.stringify(oldSrc)}`]);
  copyDir(path.join(oldSrc, 'app'), ROOT);

  const server = http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    fs.readFile(path.join(ROOT, p), (e, d) => {
      if (e) { rs.writeHead(404); rs.end('nf'); return; }
      rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
      rs.end(d);
    });
  }).listen(PORT);

  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  // ONE context for the whole run: the phone's storage survives the update.
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => r.request().url().startsWith(ORIGIN) ? r.continue() : r.abort());

  const swVersion = () => page.evaluate(async () => {
    const ks = (await caches.keys()).filter(k => /^homatt-clinic-v\d+$/.test(k));
    return ks.sort().join(',') || '(none)';
  });
  // Something only the NEW build has: the token that made the words readable.
  const cssHasNewTokens = () => page.evaluate(async () => {
    try {
      const r = await fetch('css/clinic.css?probe=' + Date.now());
      const t = await r.text();
      return /--primary-ink|--on-deep/.test(t);
    } catch (e) { return null; }
  });
  const pageIsNew = () => page.evaluate(() =>
    !!getComputedStyle(document.documentElement).getPropertyValue('--primary-ink').trim());

  // ── The clinic is running the old app, offline-ready ────────────────────
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName: 'D', clinicName: 'K', demo: true }));
  });
  await page.waitForTimeout(2500);
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const oldV = await swVersion();
  result('the clinic is running the old app, cached for offline',
    /homatt-clinic-v\d+/.test(oldV), 'cache: ' + oldV);

  // ── They download and install the new APK ───────────────────────────────
  // Every file is replaced. Storage — caches, IndexedDB, localStorage — is not,
  // which is what Android does and what makes this hard.
  rmrf(ROOT);
  copyDir(path.join(REPO, 'app'), ROOT);

  // They open the app.
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  // ...and again, because a worker can need a second load to take over.
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(4000);

  const after = {
    caches: await swVersion(),
    css: await cssHasNewTokens(),
    page: await pageIsNew(),
  };
  result('after installing the new app, the NEW stylesheet is what loads',
    after.css === true, 'caches: ' + after.caches + ', css has new tokens: ' + after.css);
  result('and the page actually uses it',
    after.page === true, '--primary-ink resolves: ' + after.page);

  await b.close();
  server.close();
  rmrf(TMP);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
