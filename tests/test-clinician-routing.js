// Where signing in as a clinician should actually put you.
//
// The report: "When I sign in as a clinical officer it takes me back to the
// profile page, not the portal you said it would take me to."
//
// He is right. landAfterAuth() sent everybody to home.html — their own profile
// and work record — whatever their situation. For somebody who already works
// at a clinic that is the wrong screen every single morning: they signed in to
// treat people, and got their own CV plus a button to tap.
//
// A sub-account does not do that, and "just like a sub-account" is what was
// asked for. So:
//
//   working at exactly one clinic  → straight into that clinic's portal
//   working at several             → their own screen, to choose
//   working at none                → their own screen, to join one
//
// And the way back has to exist, or entering a clinic is a trap.
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
const PORT = 8949, ORIGIN = 'http://localhost:' + PORT;
const UID = '33333333-3333-4333-8333-111111111111';
const CID = '11111111-1111-4111-8111-111111111111';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

const PROFILE = {
  id: 'c1', full_name: 'Emmanuel Kaka', profession: 'Clinical Officer',
  cadre: 'Senior CO', registration_no: 'AHPC/9911', qualification: 'Dip CM',
  years_experience: 7, phone: '0772123456', district: 'Gulu', languages: 'English, Luo',
};

function link(id, name, clinicId, opts) {
  opts = opts || {};
  return {
    id: id, clinic_id: clinicId, clinic_name: name, clinic_district: 'Gulu',
    status: opts.status || 'active', role: 'visiting_clinician',
    started_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    expires_at: opts.expires === null ? null
      : new Date(Date.now() + 86400000 * (opts.days == null ? 20 : opts.days)).toISOString(),
    ended_at: opts.ended || null, ended_by: null, treatments: 14,
  };
}

// `links` is swapped between cases so one browser covers all three situations.
let LINKS = [];
function home() {
  return { ok: true, profile: PROFILE, links: LINKS,
           stats: { treatments: 75, clinics: LINKS.length, conditions: [] },
           ratings: [] };
}

async function signIn(page) {
  // Clear the session from a page that does NOT redirect. Doing it on
  // clinician/index.html races that page's own "already signed in" jump — the
  // very behaviour under test — and the reload lands mid-navigation.
  await page.goto(ORIGIN + '/clinic/clinician/join.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(ORIGIN + '/clinic/clinician/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(350);
  await page.fill('#inEmail', 'kaka@test.ug');
  await page.fill('#inPass', 'a-good-password');
  await page.click('#inBtn');
  await page.waitForTimeout(2200);
  return page.url().replace(ORIGIN, '');
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1400 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB + '/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1].split('?')[0];
      if (name === 'my_clinician_home') {
        return r.fulfill({ status: 200, headers: H, body: JSON.stringify(home()) });
      }
      if (name === 'message_threads') return r.fulfill({ status: 200, headers: H, body: '[]' });
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true }) });
    }
    if (u.includes('/auth/v1/')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        access_token: 'tok', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref',
        user: { id: UID, email: 'kaka@test.ug' },
      }) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  // ── 1. Working at one clinic: straight in ────────────────────────────
  LINKS = [link('s1', 'Kampala Clinic', CID)];
  let where = await signIn(page);
  result('signing in while working at one clinic goes STRAIGHT to the clinic portal',
    /dashboard\.html/.test(where), where);

  const sess = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('clinic_session') || 'null'); } catch (e) { return null; }
  });
  result('and it enters as a visiting clinician, not as staff',
    !!sess && sess.staffRole === 'visiting_clinician', sess && sess.staffRole);
  result('at the right clinic', !!sess && sess.clinicId === CID, sess && sess.clinicName);

  // ── 2. The way back has to exist ─────────────────────────────────────
  // Otherwise signing straight in is a trap: they can never reach their own
  // record, their references, or a second clinic again.
  const back = await page.evaluate(() => {
    const el = document.getElementById('clinicianHomeLink');
    if (!el) return { there: false };
    let n = el, shown = true;
    while (n && n.nodeType === 1) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') { shown = false; break; }
      n = n.parentElement;
    }
    return { there: true, shown, text: (el.innerText || '').trim(), href: el.getAttribute('href') || '' };
  });
  result('there is a way back to their own account from inside the clinic',
    back.there && back.shown, JSON.stringify(back.text));
  if (back.there) {
    result('and it goes to the clinician portal', /clinician\/home\.html/.test(back.href), back.href);
  }

  // A clinic's OWN staff must not be shown it — it is not their portal.
  await page.evaluate(() => {
    var s = null;
    try { s = JSON.parse(localStorage.getItem('clinic_session') || 'null'); } catch (e) {}
    if (!s) s = { userId: 'u', staffName: 'Owner', clinicName: 'Kampala Clinic',
                  clinicId: '11111111-1111-4111-8111-111111111111', level: 'HC3' };
    delete s.clinician; s.staffRole = 'owner';
    localStorage.setItem('clinic_session', JSON.stringify(s));
  });
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const ownerSees = await page.evaluate(() => !!document.getElementById('clinicianHomeLink'));
  result('a clinic\'s own staff are not shown a link to somebody else\'s account',
    ownerSees === false, String(ownerSees));

  // ── 3. Working at several clinics: they choose ───────────────────────
  LINKS = [link('s1', 'Kampala Clinic', CID), link('s2', 'Gulu Clinic', 'other-clinic')];
  where = await signIn(page);
  result('signing in while working at two clinics lands on their own screen, to choose',
    /home\.html/.test(where), where);
  const both = await page.evaluate(() => document.body.innerText);
  result('and both clinics are offered', /Kampala Clinic/.test(both) && /Gulu Clinic/.test(both));

  // ── 4. Working at none: their own screen ─────────────────────────────
  LINKS = [];
  where = await signIn(page);
  result('signing in with no clinic lands on their own screen',
    /home\.html/.test(where), where);
  const none = await page.evaluate(() => document.body.innerText);
  result('and it offers the way to join one', /Scan a clinic/i.test(none));

  // ── 5. An attachment that has run out is not "working there" ─────────
  LINKS = [link('s1', 'Kampala Clinic', CID, { status: 'ended', ended: new Date().toISOString() })];
  where = await signIn(page);
  result('an ENDED job does not send them into that clinic',
    /home\.html/.test(where), where);

  LINKS = [link('s1', 'Kampala Clinic', CID, { days: -3 })];
  where = await signIn(page);
  result('nor does one whose access ran out yesterday',
    /home\.html/.test(where), where);

  // ── 6. Opening the app again, already signed in ──────────────────────
  // The same decision, or the fix only works on the day they type a password.
  LINKS = [link('s1', 'Kampala Clinic', CID)];
  await signIn(page);
  await page.goto(ORIGIN + '/clinic/clinician/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  result('re-opening the app while already signed in also goes straight to the clinic',
    /dashboard\.html/.test(page.url()), page.url().replace(ORIGIN, ''));

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
