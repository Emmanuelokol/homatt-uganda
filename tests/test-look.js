// Making the portal yours: the four looks, and the clinician's photo.
//
// The look test is the one that matters. Adding a palette is easy; the real
// question is whether the app ACTUALLY recolours, because 116 brand colours
// used to be written into the pages by hand. So this reads the computed colour
// of real elements on the real dashboard and checks they change.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    rs.end(d);
  });
});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const SKINS = ['forest','midnight','dark','clay'];

(async () => {
  await new Promise(r => server.listen(8996, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 950 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:8996')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });

  await page.goto('http://localhost:8996/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName:'D', clinicName:'K', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token:'t', refresh_token:'r', token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{id:uid} }));
  }, [CID, UID]);

  // ── The picker ──────────────────────────────────────────────────────────
  await page.goto('http://localhost:8996/clinic/settings.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#lookPicker .look-opt', { timeout: 15000 });
  const opts = await page.evaluate(() =>
    [...document.querySelectorAll('#lookPicker .look-opt')].map(b => ({
      k: b.dataset.skin, name: (b.querySelector('b')||{}).textContent||'',
      swatches: b.querySelectorAll('.look-sw i').length })));
  result('all four looks are offered, each with its colours shown',
    opts.length === 4 && SKINS.every(k => opts.some(o => o.k === k)) && opts.every(o => o.swatches === 3),
    opts.map(o => o.name).join(', '));

  const named = opts.map(o => o.name.toLowerCase()).join('|');
  result('they are named the way they were asked for',
    /forest green/.test(named) && /midnight blue/.test(named) && /true dark/.test(named) && /clay|brown/.test(named),
    named);

  // ── Does the app really change colour? ──────────────────────────────────
  const seen = {};
  for (const k of SKINS) {
    await page.click(`.look-opt[data-skin="${k}"]`);
    await page.waitForTimeout(150);
    await page.goto('http://localhost:8996/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.home-hero', { timeout: 15000 });
    seen[k] = await page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const hero = document.querySelector('.home-hero');
      const side = document.querySelector('.admin-sidebar');
      return {
        skin: document.documentElement.getAttribute('data-skin'),
        primary: cs.getPropertyValue('--primary').trim(),
        heroBg: getComputedStyle(hero).backgroundImage.slice(0, 90),
        sidebar: getComputedStyle(side).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
      };
    });
    await page.goto('http://localhost:8996/clinic/settings.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#lookPicker .look-opt');
  }
  result('the chosen look survives moving between pages',
    SKINS.every(k => seen[k].skin === k), SKINS.map(k => k + '=' + seen[k].skin).join(' '));

  const primaries = SKINS.map(k => seen[k].primary);
  result('each look really changes the brand colour',
    new Set(primaries).size === 4, primaries.join(' | '));

  const heroes = SKINS.map(k => seen[k].heroBg);
  result('the home banner is recoloured, not just the buttons',
    new Set(heroes).size === 4, heroes.map(h => h.replace(/linear-gradient\(/,'').slice(0,42)).join('  ||  '));

  const sides = SKINS.map(k => seen[k].sidebar);
  result('the side menu follows the look too', new Set(sides).size === 4, sides.join(' | '));

  result('true dark is actually black', /rgb\(0, 0, 0\)/.test(seen.dark.sidebar), seen.dark.sidebar);

  // ── Light / dark still works inside a look ──────────────────────────────
  await page.click('.look-opt[data-skin="midnight"]');
  await page.goto('http://localhost:8996/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.home-hero');
  const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.evaluate(() => { localStorage.setItem('homatt_theme','dark'); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.home-hero');
  const darkPair = await page.evaluate(() => ({
    bg: getComputedStyle(document.body).backgroundColor,
    skin: document.documentElement.getAttribute('data-skin'),
    theme: document.documentElement.getAttribute('data-theme'),
  }));
  result('the light / dark switch still works inside the chosen colour',
    darkPair.skin === 'midnight' && darkPair.theme === 'dark' && darkPair.bg !== lightBg,
    'light=' + lightBg + ' dark=' + darkPair.bg);
  await page.evaluate(() => { localStorage.setItem('homatt_theme','light'); });

  // ── No flash of the wrong look on a cold load ───────────────────────────
  // Read the HTML as the browser receives it: the skin must be set by a script
  // inside <head>, before anything can paint.
  const raw = await (await fetch('http://localhost:8996/clinic/dashboard.html')).text();
  const headEnd = raw.indexOf('</head>');
  const setSkin = raw.indexOf("setAttribute('data-skin'");
  result('the look is applied before the page paints, so there is no flash',
    setSkin > 0 && headEnd > 0 && setSkin < headEnd,
    'data-skin set at ' + setSkin + ', head ends at ' + headEnd);

  // ── The photo ───────────────────────────────────────────────────────────
  await page.goto('http://localhost:8996/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hero-portrait', { timeout: 15000 });
  const slot = await page.evaluate(() => {
    const el = document.querySelector('.hero-portrait');
    const hero = document.querySelector('.home-hero');
    return { there: !!el, inHero: !!(el && hero && hero.contains(el)),
             hasPhoto: el ? el.classList.contains('has-photo') : null };
  });
  result('there is a place for the clinician\'s photo on the home screen',
    slot.there && slot.inHero && slot.hasPhoto === false, JSON.stringify(slot));

  // A big photo with GPS-style metadata, shrunk on the device.
  const shrunk = await page.evaluate(async () => {
    // build a 2000x1400 image so there is something real to shrink
    const c = document.createElement('canvas');
    c.width = 2000; c.height = 1400;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 2000, 1400);
    grd.addColorStop(0, '#8e44ad'); grd.addColorStop(1, '#f39c12');
    g.fillStyle = grd; g.fillRect(0, 0, 2000, 1400);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.95));
    const file = new File([blob], 'portrait.jpg', { type: 'image/jpeg' });
    const out = await window.ClinicLook._shrink(file);
    const img = new Image();
    await new Promise(r => { img.onload = r; img.src = out; });
    return { beforeKB: Math.round(blob.size/1024), afterKB: Math.round(out.length*0.75/1024),
             w: img.naturalWidth, h: img.naturalHeight, isJpeg: out.slice(0,23) === 'data:image/jpeg;base64,' };
  });
  result('a phone photo is shrunk on the device before it goes anywhere',
    shrunk.afterKB < shrunk.beforeKB / 4 && shrunk.afterKB < 120,
    shrunk.beforeKB + ' KB -> ' + shrunk.afterKB + ' KB');
  result('it is squared and capped at 512 px, and re-encoded (which drops the GPS data)',
    shrunk.w === 512 && shrunk.h === 512 && shrunk.isJpeg,
    shrunk.w + 'x' + shrunk.h + ' jpeg=' + shrunk.isJpeg);

  // Offline: a cached photo still shows.
  await page.evaluate((cid) => {
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const g = c.getContext('2d'); g.fillStyle = '#2E7D32'; g.fillRect(0,0,8,8);
    localStorage.setItem('homatt_portrait_' + cid, c.toDataURL('image/jpeg'));
  }, CID);
  await ctx.setOffline(true);
  await page.goto('http://localhost:8996/clinic/dashboard.html', { waitUntil: 'domcontentloaded' }).catch(()=>{});
  await page.waitForTimeout(1200);
  const offline = await page.evaluate(() => {
    const el = document.querySelector('.hero-portrait');
    return el ? { has: el.classList.contains('has-photo'),
                  img: (el.style.backgroundImage||'').slice(0, 24) } : null;
  });
  await ctx.setOffline(false);
  result('the photo still shows with no internet',
    !!offline && offline.has && /url\("data:image/.test(offline.img), JSON.stringify(offline));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
