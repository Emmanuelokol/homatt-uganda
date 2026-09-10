// Can an installed app update itself, without downloading a new APK?
//
// The Android build has the whole portal baked into the APK file. Inside it,
// self.registration.update() re-fetches the worker from its OWN origin — the
// installed file — so it always finds itself, and a clinic sees no change at
// all until somebody downloads a new APK. That is the bug this covers.
//
// Two servers stand in for the two sides:
//   INSTALLED  — the phone, serving the OLD build (this is the "APK")
//   WEB        — where new versions are published (GitHub Pages)
// They are different origins, exactly as they are in real life.
//
// What matters as much as updating: the origin must NOT change. localStorage,
// IndexedDB and the offline outbox of unsynced consultations are all
// per-origin, so an "update" that moved the app somewhere else would strand
// every consultation a clinic had not yet synced.
const path = require('path');
const APP = path.join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs');
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.db':'application/octet-stream'};

const INSTALLED_PORT = 8933, WEB_PORT = 8934;
const INSTALLED = 'http://localhost:' + INSTALLED_PORT;
const WEB = 'http://localhost:' + WEB_PORT;

// The "web" side serves the real app but pretending to be a NEWER build, and
// with CORS on, which is what GitHub Pages does.
function serve(port, { rewrite, cors }) {
  return http.createServer((rq, rs) => {
    let p = decodeURIComponent(rq.url.split('?')[0]);
    if (p.endsWith('/')) p += 'index.html';
    fs.readFile(path.join(APP, p), (e, d) => {
      if (e) { rs.writeHead(404); rs.end('nf'); return; }
      let body = d;
      if (rewrite) { const r = rewrite(p, d); if (r != null) body = r; }
      const h = { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' };
      if (cors) h['Access-Control-Allow-Origin'] = '*';
      rs.writeHead(200, h); rs.end(body);
    });
  }).listen(port);
}

const NEWV = 'homatt-clinic-v999';

(async () => {
  const installed = serve(INSTALLED_PORT, {});
  const web = serve(WEB_PORT, {
    cors: true,
    rewrite(p, d) {
      // Pretend this side is a newer build.
      if (p.endsWith('version.json')) {
        const j = JSON.parse(d.toString('utf8'));
        j.cache = NEWV;
        return Buffer.from(JSON.stringify(j));
      }
      // Something visible in the served page, so "did the new code arrive?"
      // is answered by the page itself and not by a cache name.
      if (p.endsWith('/clinic/dashboard.html')) {
        return Buffer.from(d.toString('utf8')
          .replace('</title>', '</title><meta name="homatt-build" content="NEW">'));
      }
      return null;
    },
  });

  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext();
  if (process.env.SWLOG) {
    ctx.on('serviceworker', (w) => { try { w.on('console', (m) => console.log('   [sw]', m.text())); } catch (e) {} });
  }
  const page = await ctx.newPage();
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  // Everything else off the network, as in the other tests.
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(INSTALLED) || u.startsWith(WEB)) return r.continue();
    return r.abort();
  });

  // Point the worker's update source at our stand-in "web".
  await page.addInitScript(() => {});
  const swPath = path.join(APP, 'clinic', 'clinic-sw.js');
  const swReal = fs.readFileSync(swPath, 'utf8');
  let swTest = swReal.replace(
    /const UPDATE_BASE = '[^']*';/,
    "const UPDATE_BASE = '" + WEB + "/clinic/';");
  if (process.env.SWLOG) {
    swTest = swTest.replace('const CACHE =',
      'const _origOpen = caches.open.bind(caches);\n' +
      'caches.open = async function (n) { const c = await _origOpen(n); const p = c.put.bind(c);\n' +
      '  c.put = function (rq, rs) { const u = (rq && rq.url) || String(rq);\n' +
      '    if (u.indexOf("dashboard.html") >= 0) console.log("PUT " + n + " " + u + " stale=" + (typeof localIsStale === "function" ? localIsStale() : "?"));\n' +
      '    return p(rq, rs); }; return c; };\n' +
      'const CACHE =');
  }
  const pointed = swTest !== swReal;
  fs.writeFileSync(swPath, swTest);

  try {
    result('the worker has an update source that can be aimed elsewhere', pointed,
      pointed ? '' : 'UPDATE_BASE not found in clinic-sw.js');

    await page.goto(INSTALLED + '/clinic/index.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.clear();
      // Something only this origin can see. If an "update" moved the app, this
      // is what a clinic would lose.
      localStorage.setItem('clinic_session', JSON.stringify({
        staffName: 'D', clinicName: 'K', demo: true }));
      localStorage.setItem('homatt_outbox_probe', 'one unsynced consultation');
    });
    // Let the worker install and take control.
    await page.waitForTimeout(2500);
    await page.goto(INSTALLED + '/clinic/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(2500);

    const before = await page.evaluate(async () => ({
      controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
      caches: (await caches.keys()).filter(k => k.indexOf('homatt-clinic-v') === 0),
      build: (document.querySelector('meta[name="homatt-build"]') || {}).content || '(old)',
    }));
    result('the installed app is running its own worker', before.controlled,
      'caches: ' + JSON.stringify(before.caches));
    result('and it is serving the OLD build', before.build === '(old)', before.build);

    // Ask it to update, the same way the Settings button does.
    const reply = await page.evaluate(() => new Promise((resolve) => {
      const ch = new MessageChannel();
      let done = false;
      ch.port1.onmessage = (ev) => { done = true; resolve(ev.data || {}); };
      navigator.serviceWorker.controller.postMessage({ type: 'checkForUpdate' }, [ch.port2]);
      setTimeout(() => { if (!done) resolve({ reason: 'timed out' }); }, 60000);
    }));
    // It may already have taken it: the worker checks on the first navigation
    // of a session, which is the path that matters most — a clinic that never
    // opens Settings still gets the fix.
    result('it finds the newer build and takes it',
      !!(reply && reply.latest === NEWV && (reply.updated || reply.current === NEWV)),
      JSON.stringify(reply).slice(0, 160));

    // The point of the whole exercise: the NEW code is what the app now serves.
    await page.goto(INSTALLED + '/clinic/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({
      build: (document.querySelector('meta[name="homatt-build"]') || {}).content || '(old)',
      origin: location.origin,
      session: localStorage.getItem('clinic_session'),
      outbox: localStorage.getItem('homatt_outbox_probe'),
    }));
    result('the app now serves the NEW build, with no new APK', after.build === 'NEW',
      after.build);

    // And the reason this had to be done this way rather than by pointing the
    // app at the web address.
    result('it is still the same origin, so nothing local was stranded',
      after.origin === INSTALLED, after.origin);
    result('the clinic session survived the update', !!after.session, String(after.session).slice(0, 40));
    result('and so did an unsynced consultation',
      after.outbox === 'one unsynced consultation', String(after.outbox));

    // Asking again must not re-download a build it already has.
    const again = await page.evaluate(() => new Promise((resolve) => {
      const ch = new MessageChannel();
      let done = false;
      ch.port1.onmessage = (ev) => { done = true; resolve(ev.data || {}); };
      navigator.serviceWorker.controller.postMessage({ type: 'checkForUpdate' }, [ch.port2]);
      setTimeout(() => { if (!done) resolve({ reason: 'timed out' }); }, 60000);
    }));
    result('asking again does not download it a second time',
      !!again && again.updated !== true, JSON.stringify(again).slice(0, 120));

    // A dead update server must leave the working app alone.
    await new Promise(r => web.close(r));
    const dead = await page.evaluate(() => new Promise((resolve) => {
      const ch = new MessageChannel();
      let done = false;
      ch.port1.onmessage = (ev) => { done = true; resolve(ev.data || {}); };
      navigator.serviceWorker.controller.postMessage({ type: 'checkForUpdate' }, [ch.port2]);
      setTimeout(() => { if (!done) resolve({ reason: 'timed out' }); }, 60000);
    }));
    await page.goto(INSTALLED + '/clinic/dashboard.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const survived = await page.evaluate(() =>
      (document.querySelector('meta[name="homatt-build"]') || {}).content || '(old)');
    result('an update server that cannot be reached breaks nothing',
      dead && dead.updated !== true && survived === 'NEW',
      'reason: ' + ((dead && dead.reason) || '?') + ', still serving ' + survived);

    await b.close();
  } finally {
    fs.writeFileSync(swPath, swReal);          // always put the worker back
    try { installed.close(); } catch (e) {}
    try { web.close(); } catch (e) {}
  }
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
