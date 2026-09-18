// What ACTUALLY happens when a widget tap arrives — driven, not reasoned about.
//
// The report: "when I tap on the icon on the widget, instead of taking me to
// the exact feature, they just take me to the app itself, where I left off."
//
// Reading the code gives several candidate causes and no way to choose between
// them. This opens the real dashboard, asks it what it exposes, and then fires
// each target the way the router would, reporting what moved.
//
//   node tests/probe-widget-open.js
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
const PORT = 8981, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

const SEED = ([cid, uid]) => {
  localStorage.clear();
  localStorage.setItem('clinic_session', JSON.stringify({ userId: uid, staffName: 'D. Musinguzi',
    clinicName: 'family clinic', clinicId: cid, staffRole: 'owner', level: 'HC III' }));
  localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token: 't', refresh_token: 'r',
    token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user: { id: uid } }));
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, serviceWorkers: 'block' });
  await ctx.addInitScript(SEED, [CID, UID]);
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 120)));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200,
      headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });

  const say = (k, v) => console.log('  ' + String(k).padEnd(42) + ' ' + v);

  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  console.log('\n── what the dashboard exposes ─────────────────────────────');
  const what = await page.evaluate(() => ({
    router:        typeof window.HomattOpen,
    openQuickSale: typeof window.openQuickSale,
    here:          location.pathname.split('/').pop(),
    activeList:    !!document.getElementById('activeTreatmentsList'),
    activeSearch:  !!document.getElementById('activeSearch'),
  }));
  Object.keys(what).forEach(k => say(k, what[k]));
  say('page errors', errs.length ? errs[0] : 'none');

  // ── quick sale ───────────────────────────────────────────────────────────
  console.log('\n── HomattOpen.go("quick-sale") ────────────────────────────');
  const qsBefore = await page.evaluate(() => {
    // Anything that looks like the quick-sale surface, before we ask for it.
    const ids = ['quickSaleSheet','qsSheet','quickSaleModal','qsModal','quickSale'];
    const found = ids.filter(i => document.getElementById(i));
    const vis = found.filter(i => {
      const el = document.getElementById(i);
      return el && el.offsetParent !== null;
    });
    return { candidateIds: found, visible: vis };
  });
  say('quick-sale containers found', JSON.stringify(qsBefore.candidateIds));
  say('visible before', JSON.stringify(qsBefore.visible));

  const qsResult = await page.evaluate(() => {
    try { return { returned: window.HomattOpen.go('quick-sale') }; }
    catch (e) { return { threw: String(e.message) }; }
  });
  say('go() returned', JSON.stringify(qsResult));
  await page.waitForTimeout(2500);
  const qsAfter = await page.evaluate(() => {
    const ids = ['quickSaleSheet','qsSheet','quickSaleModal','qsModal','quickSale'];
    const vis = ids.filter(i => { const el = document.getElementById(i); return el && el.offsetParent !== null; });
    // How much of the screen does it actually take? "The feature shows itself"
    // is a claim about what somebody sees, so it needs a number.
    const sheet = document.getElementById('qsSheet');
    const sb = sheet ? sheet.getBoundingClientRect() : null;
    const covers = sb
      ? Math.round(sb.width) + 'x' + Math.round(sb.height) + ' of ' + innerWidth + 'x' + innerHeight +
        '  (' + Math.round((sb.width * sb.height) / (innerWidth * innerHeight) * 100) + '% of the screen)'
      : null;
    window.__qsCovers = covers;
    // Also: did ANY full-screen-ish overlay appear?
    const overlays = [...document.querySelectorAll('div,section')].filter(el => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.height > 250 && r.width > 250 && parseInt(cs.zIndex || '0', 10) > 100;
    }).map(el => el.id || el.className.toString().slice(0, 40));
    return { visible: vis, overlays: overlays.slice(0, 6), url: location.pathname.split('/').pop(),
             covers: window.__qsCovers };
  });
  say('visible after', JSON.stringify(qsAfter.visible));
  say('big fixed overlays after', JSON.stringify(qsAfter.overlays));
  say('the sheet covers', String(qsAfter.covers));
  say('still on page', qsAfter.url);

  // ── active ───────────────────────────────────────────────────────────────
  console.log('\n── HomattOpen.go("active") ────────────────────────────────');
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const acResult = await page.evaluate(() => {
    try { return { returned: window.HomattOpen.go('active') }; }
    catch (e) { return { threw: String(e.message) }; }
  });
  say('go() returned', JSON.stringify(acResult));
  await page.waitForTimeout(2500);
  // NOTE: the card (#activeTreatmentsList) is NOT the thing to look at any
  // more. It lives on the hidden "patients" slide; what a widget tap should
  // now produce is the full-screen section view. Checking the card was this
  // probe measuring the wrong element — which reads exactly like a failure.
  const ac = await page.evaluate(() => {
    const l = document.getElementById('activeTreatmentsList');
    const ov = document.getElementById('svOverlay');
    const r = l ? l.getBoundingClientRect() : null;
    return {
      scrollY: Math.round(window.scrollY),
      cardVisible: !!(l && l.offsetParent !== null),
      cardTopInViewport: r ? Math.round(r.top) : null,
      overlayOpen: !!(ov && getComputedStyle(ov).display !== 'none'),
      overlayTitle: (document.getElementById('svTitle') || {}).textContent || null,
      overlayCount: (document.getElementById('svCount') || {}).textContent || null,
      overlayHasSearch: !!document.getElementById('svSearch'),
      overlayBody: ((document.getElementById('svBody') || {}).textContent || '')
        .replace(/\s+/g, ' ').trim().slice(0, 70),
      overlayFillsScreen: (() => {
        if (!ov) return null;
        const b = ov.getBoundingClientRect();
        return Math.round(b.width) + 'x' + Math.round(b.height) +
               ' of ' + innerWidth + 'x' + innerHeight;
      })(),
    };
  });
  say('scrollY before -> after', scrollBefore + ' -> ' + ac.scrollY);
  Object.keys(ac).forEach(k => k !== 'scrollY' && say(k, JSON.stringify(ac[k])));

  // ── new treatment ────────────────────────────────────────────────────────
  console.log('\n── HomattOpen.go("new-treatment") ─────────────────────────');
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.HomattOpen.go('new-treatment'));
  await page.waitForTimeout(3000);
  say('landed on', await page.evaluate(() => location.pathname.split('/').pop()));
  say('session key left behind', await page.evaluate(() => {
    try { return JSON.stringify(sessionStorage.getItem('homatt_open_target')); } catch (e) { return 'err'; }
  }));

  // ── arriving by URL, which is the PWA shortcut route ─────────────────────
  console.log('\n── arriving at ?go=quick-sale (a fresh page load) ──────────');
  await page.goto(ORIGIN + '/clinic/dashboard.html?go=quick-sale', { waitUntil: 'load' });
  await page.waitForTimeout(3500);
  const urlArrive = await page.evaluate(() => {
    const ids = ['quickSaleSheet','qsSheet','quickSaleModal','qsModal','quickSale'];
    return {
      visible: ids.filter(i => { const el = document.getElementById(i); return el && el.offsetParent !== null; }),
      search: location.search,
      page: location.pathname.split('/').pop(),
    };
  });
  say('quick-sale visible', JSON.stringify(urlArrive.visible));
  say('query left in the bar', JSON.stringify(urlArrive.search));

  // ── the pages that carry the router at all ───────────────────────────────
  console.log('\n── which pages could answer a widget tap ──────────────────');
  const TAG = '<script src="js/clinic-open.js';
  for (const f of fs.readdirSync(path.join(APP, 'clinic')).filter(f => f.endsWith('.html'))) {
    const s = fs.readFileSync(path.join(APP, 'clinic', f), 'utf8');
    say(f, s.indexOf(TAG) >= 0 ? 'has the router' : 'NO ROUTER — a tap here is lost');
  }

  console.log('\npage errors: ' + (errs.length ? errs.join(' | ') : 'none'));
  await b.close();
  server.close();
})();
