// What a clinician sees when the database has not been updated yet.
//
// This is the screen Emmanuel photographed: he signed up, typed ten fields,
// landed on his own screen — and found every box empty, "References" stuck on
// "Loading…" for ever, and nothing saying why.
//
// The cause was underneath the app (the migration had never reached Supabase,
// so my_clinician_home does not exist), but the SCREEN is the bug. Three
// separate faults, each of which would produce exactly that photograph:
//
//   1. the catch() path never cleared #clRatings, so a spinner ran for ever;
//   2. nothing kept what he typed at sign-up, so the form could not be filled
//      from it;
//   3. PostgREST's own words ("Could not find the function … in the schema
//      cache") are not an explanation anybody can act on.
//
// A screen that cannot reach its server has to say so and still be useful.
// This checks it does both.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.db':'application/octet-stream'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});

const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT = 8948, ORIGIN = 'http://localhost:' + PORT;
const UID = '33333333-3333-4333-8333-111111111111';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

// Exactly what PostgREST answers when the migration has not been applied.
const NO_FUNCTION = {
  code: 'PGRST202',
  message: 'Could not find the function public.my_clinician_home without parameters in the schema cache',
  hint: null, details: null,
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1600 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB + '/rest/v1/rpc/')) {
      // Every clinician RPC is missing, because the migration never ran.
      return r.fulfill({ status: 404, headers: H, body: JSON.stringify(NO_FUNCTION) });
    }
    if (u.includes('/auth/v1/token') || u.includes('/auth/v1/signup')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        access_token: 'tok', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref',
        user: { id: UID, email: 'kaka@test.ug' },
      }) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  // ── Sign up exactly as he did ────────────────────────────────────────
  await page.goto(ORIGIN + '/clinic/clinician/index.html', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
  await page.click('#tabUp');
  await page.fill('#upName', 'Emmanuel Kaka');
  await page.selectOption('#upProfession', 'Clinical Officer');
  await page.fill('#upCadre', 'Senior CO');
  await page.fill('#upRegNo', 'AHPC/9911');
  await page.fill('#upQual', 'Dip CM');
  await page.fill('#upYears', '7');
  await page.fill('#upDistrict', 'Gulu');
  await page.fill('#upVillage', 'Layibi');
  await page.fill('#upPhone', '0772123456');
  await page.fill('#upLangs', 'English, Luo');
  await page.fill('#upEmail', 'kaka@test.ug');
  await page.fill('#upPass', 'a-good-password');
  await page.click('#upBtn');
  await page.waitForTimeout(2200);

  result('signing up still lands on the clinician\'s own screen',
    page.url().includes('home.html'), page.url().replace(ORIGIN, ''));
  if (!page.url().includes('home.html')) {
    await page.goto(ORIGIN + '/clinic/clinician/home.html', { waitUntil: 'load' });
  }
  await page.waitForTimeout(2200);

  const body = await page.evaluate(() => document.body.innerText);

  // ── 1. Nothing may be left spinning ──────────────────────────────────
  result('no part of the screen is left saying "Loading…" for ever',
    !/Loading…|Loading\.\.\./.test(body),
    (body.match(/Loading[^\n]*/g) || []).join(' | '));

  // ── 2. It says what is wrong, in words a clinician can act on ────────
  result('the screen says the server is not set up, rather than nothing at all',
    /not been set up|not set up|administrator|database/i.test(body),
    (body.split('\n').find(l => /set up|database|administrator/i.test(l)) || '(nothing)').slice(0, 90));

  result('and it does NOT show the database\'s own words',
    !/schema cache|PGRST|public\.my_clinician_home/i.test(body),
    (body.match(/schema cache|PGRST\d+/g) || []).join(', '));

  // ── 3. What he typed at sign-up is still on the screen ───────────────
  const form = await page.evaluate(() => {
    const v = id => (document.getElementById(id) || {}).value || '';
    return {
      name: v('pfName'), profession: v('pfProfession'), cadre: v('pfCadre'),
      reg: v('pfRegNo'), qual: v('pfQual'), years: v('pfYears'),
      district: v('pfDistrict'), phone: v('pfPhone'), langs: v('pfLangs'),
    };
  });
  result('the name he registered with is in the form', form.name === 'Emmanuel Kaka', form.name || '(empty)');
  result('his profession is there', form.profession === 'Clinical Officer', form.profession || '(empty)');
  result('his cadre is there', form.cadre === 'Senior CO', form.cadre || '(empty)');
  result('his registration number is there', form.reg === 'AHPC/9911', form.reg || '(empty)');
  result('his qualification is there', form.qual === 'Dip CM', form.qual || '(empty)');
  result('his years working are there', String(form.years) === '7', form.years || '(empty)');
  result('his district is there', form.district === 'Gulu', form.district || '(empty)');
  result('his phone is there', form.phone === '0772123456', form.phone || '(empty)');
  result('his languages are there', form.langs === 'English, Luo', form.langs || '(empty)');

  // ── 4. The way into a clinic is still offered, and obvious ───────────
  const join = await page.evaluate(() => {
    const btn = document.getElementById('clJoinBtn');
    if (!btn) return { there: false };
    const r = btn.getBoundingClientRect();
    let n = btn, shown = true;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') { shown = false; break; }
      n = n.parentElement;
    }
    return { there: true, shown, text: btn.innerText.trim(), top: Math.round(r.top + window.scrollY) };
  });
  result('the way into a clinic is still on the screen', join.there && join.shown, JSON.stringify(join.text));
  result('and it is near the top, not buried under the profile form',
    join.top < 900, 'y=' + join.top);

  // ── 5. The top bar says who they are ─────────────────────────────────
  const who = await page.evaluate(() => ({
    name: (document.querySelector('[data-clinician-name]') || {}).textContent || '',
    sub: (document.getElementById('clWho') || {}).textContent || '',
  }));
  result('the top bar names them', /Emmanuel Kaka/i.test(who.name), who.name);
  result('and the line under it is not a bare dash',
    who.sub.trim() !== '—' && who.sub.trim().length > 1, JSON.stringify(who.sub));

  // ── 6. Saving says something useful rather than failing silently ─────
  await page.evaluate(() => {
    document.getElementById('pfBtn').click();
  });
  await page.waitForTimeout(900);
  const saveMsg = await page.evaluate(() =>
    (document.getElementById('pfMsg') || {}).textContent || '');
  result('trying to save says why it cannot, in plain words',
    /set up|administrator|database/i.test(saveMsg) && !/schema cache|PGRST/i.test(saveMsg),
    saveMsg.slice(0, 100) || '(nothing said)');

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    // Registering the service worker races the next navigation in a
    // headless run and throws "The object is in an invalid state".
    // It is the harness, not the app, and it fails about one run in
    // four — a random red build teaches nobody anything.
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
