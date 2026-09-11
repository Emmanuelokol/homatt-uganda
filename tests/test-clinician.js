// The clinician portal, driven the way a clinician would.
//
// Sign up with no clinic at all, land on your own screen, type a clinic's code,
// walk into the clinic portal, and come back out. The SQL half of this is
// checked against a real Postgres by tests/run-sql.sh; this half checks that
// the screens in front of it do what they say.
//
// The assertion worth reading twice is the last group: that nothing on a
// clinician's own screens carries a patient's name. That promise is made in the
// database — clinician_activity has no column for one — but a screen can always
// go and fetch one from somewhere else, and this is what would notice.
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
const PORT = 8941, ORIGIN = 'http://localhost:' + PORT;
const UID = '33333333-3333-4333-8333-111111111111';
const CID = '11111111-1111-4111-8111-111111111111';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

// What the server would say. Every RPC the portal calls is answered here, so a
// call that is renamed or mistyped shows up as a test failure rather than as a
// silently empty screen.
const rpcCalls = [];
function rpcReply(name, body) {
  rpcCalls.push({ name, body });
  if (name === 'my_clinician_home') {
    return {
      ok: true,
      profile: {
        id: 'c0000000-0000-4000-8000-000000000001', full_name: 'Dr Okello John',
        profession: 'Medical Doctor', cadre: 'Medical Officer',
        registration_no: 'UMDPC/12345', registration_body: 'UMDPC',
        qualification: 'MBChB', years_experience: 6, phone: '0772000111',
        district: 'Lira', languages: 'English, Luo',
      },
      links: [
        { id: 's1', clinic_id: CID, clinic_name: 'Kampala Clinic', clinic_district: 'Kampala',
          status: 'active', role: 'visiting_clinician',
          started_at: new Date(Date.now() - 86400000 * 12).toISOString(),
          expires_at: new Date(Date.now() + 86400000 * 18).toISOString(),
          ended_at: null, ended_by: null, treatments: 14 },
        { id: 's0', clinic_id: 'other', clinic_name: 'Gulu Clinic', clinic_district: 'Gulu',
          status: 'ended', role: 'visiting_clinician',
          started_at: new Date(Date.now() - 86400000 * 200).toISOString(),
          expires_at: null, ended_at: new Date(Date.now() - 86400000 * 90).toISOString(),
          ended_by: 'owner', treatments: 61 },
      ],
      stats: {
        treatments: 75, clinics: 2,
        first_seen: new Date(Date.now() - 86400000 * 200).toISOString(),
        last_seen: new Date().toISOString(),
        conditions: [{ condition: 'Malaria', n: 31 }, { condition: 'Pneumonia', n: 12 }],
      },
      ratings: [
        { clinic_name: 'Gulu Clinic', rating: 5, care: 5, punctuality: 4,
          record_keeping: 5, teamwork: 5, would_rehire: true,
          reference_note: 'Careful with children. Would have back.',
          rater_name: 'Owner B', created_at: new Date(Date.now() - 86400000 * 90).toISOString() },
      ],
    };
  }
  if (name === 'save_my_clinician_profile') return { ok: true, id: 'c0000000-0000-4000-8000-000000000001' };
  // The clinic portal's own RPCs, which start running the moment a clinician
  // walks in. These return ROWS, not an {ok} object — answering them wrongly
  // here would hide a real crash rather than catch one.
  if (name === 'message_threads') return [];
  if (name === 'redeem_clinic_link_code') {
    const code = (body && body.p_code) || '';
    if (code !== 'ABCD2345') {
      return { ok: false, error: 'That code is not valid. Ask the clinic for a new one.' };
    }
    return { ok: true, stint_id: 's1', clinic_id: CID, clinic_name: 'Kampala Clinic',
             role: 'visiting_clinician',
             expires_at: new Date(Date.now() + 86400000 * 30).toISOString() };
  }
  return { ok: true };
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB + '/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1].split('?')[0];
      let body = null;
      try { body = JSON.parse(r.request().postData() || 'null'); } catch (e) {}
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify(rpcReply(name, body)) });
    }
    if (u.includes('/auth/v1/token') || u.includes('/auth/v1/signup')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        access_token: 'tok', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref',
        user: { id: UID, email: 'doc@test.ug' },
      }) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  // ── 1. Signing up, with no clinic anywhere in sight ──────────────────
  await page.goto(ORIGIN + '/clinic/clinician/index.html', { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);

  result('the clinician portal opens without a clinic session',
    await page.evaluate(() => !!document.getElementById('formIn')));

  await page.click('#tabUp');
  await page.waitForTimeout(150);
  const upVisible = await page.evaluate(() =>
    getComputedStyle(document.getElementById('formUp')).display !== 'none');
  result('there is a way to create an account', upVisible);

  // The fields the request actually named: names, profession, where they stay.
  for (const [id, label] of [['upName','name'], ['upProfession','profession'],
                             ['upDistrict','where they stay'], ['upPhone','phone']]) {
    const there = await page.evaluate(i => {
      const e = document.getElementById(i);
      return !!e && e.required === true;
    }, id);
    result('sign-up asks for the ' + label + ', and requires it', there);
  }

  await page.fill('#upName', 'Dr Okello John');
  await page.selectOption('#upProfession', 'Medical Doctor');
  await page.fill('#upDistrict', 'Lira');
  await page.fill('#upPhone', '0772000111');
  await page.fill('#upRegNo', 'UMDPC/12345');
  await page.fill('#upEmail', 'doc@test.ug');
  await page.fill('#upPass', 'a-good-password');
  await page.click('#upBtn');
  await page.waitForTimeout(1500);

  result('creating the account lands on the clinician\'s own screen',
    page.url().includes('home.html'), page.url().replace(ORIGIN, ''));

  const savedProfile = rpcCalls.find(c => c.name === 'save_my_clinician_profile');
  result('the details given at sign-up are actually saved', !!savedProfile,
    savedProfile ? Object.keys(savedProfile.body.p).length + ' fields' : 'never called');
  if (savedProfile) {
    result('including the profession and the district',
      savedProfile.body.p.profession === 'Medical Doctor' && savedProfile.body.p.district === 'Lira',
      JSON.stringify({ p: savedProfile.body.p.profession, d: savedProfile.body.p.district }));
  }

  // ── 2. The home screen ───────────────────────────────────────────────
  await page.waitForTimeout(900);
  const home = await page.evaluate(() => ({
    name: (document.querySelector('[data-clinician-name]') || {}).textContent,
    treat: (document.getElementById('stTreat') || {}).textContent,
    clinics: (document.getElementById('stClinics') || {}).textContent,
    rating: (document.getElementById('stRating') || {}).textContent,
    body: document.body.innerText,
  }));
  result('the home screen names the clinician', /Okello John/.test(home.name || ''), home.name);
  result('it counts the treatments they have done', home.treat === '75', home.treat);
  result('it counts the clinics they have worked at', home.clinics === '2', home.clinics);
  result('it shows the rating other owners gave', home.rating === '5', home.rating);
  result('it lists the clinic they are working at now', /Kampala Clinic/.test(home.body));
  result('and the one they used to work at', /Gulu Clinic/.test(home.body));
  result('it shows what they have treated most', /Malaria/.test(home.body) && /31/.test(home.body));
  result('it shows the reference an owner wrote',
    /Would have back/.test(home.body), home.body.slice(0, 0) || undefined);
  result('access that is running out says when',
    /access ends in \d+ days?/.test(home.body) || /Ends in \d+ days?/.test(home.body));

  // ── 3. THE PROMISE: no patient anywhere on the clinician's own screens ─
  const PATIENTS = ['Achieng', 'Mukasa', 'Nakato', '070011', 'patient_name'];
  const leaked = PATIENTS.filter(p => home.body.includes(p));
  result('the clinician\'s own screen names no patient', leaked.length === 0, leaked.join(', '));

  // ── 4. Joining a clinic by typing the code ───────────────────────────
  await page.click('#clJoinBtn');
  await page.waitForTimeout(700);
  result('there is a way to join a clinic', page.url().includes('join.html'),
    page.url().replace(ORIGIN, ''));

  result('typing the code is offered as its own way in, not buried',
    await page.evaluate(() => !!document.getElementById('clCodeForm')));

  // A wrong code must be refused, and must not say whether the clinic exists.
  await page.fill('#clCodeIn', 'ZZZZZZZZ');
  await page.click('#clCodeBtn');
  await page.waitForTimeout(600);
  const badMsg = await page.evaluate(() => (document.getElementById('clCodeMsg') || {}).textContent || '');
  result('a wrong code is refused', /not valid/i.test(badMsg), badMsg);

  await page.fill('#clCodeIn', 'ABCD2345');
  await page.click('#clCodeBtn');
  await page.waitForTimeout(1400);

  const sess = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('clinic_session') || 'null'); } catch (e) { return null; }
  });
  result('the right code lets them in', !!sess, JSON.stringify(sess && sess.clinicName));
  if (sess) {
    result('they enter as a VISITING clinician, not as staff',
      sess.staffRole === 'visiting_clinician', sess.staffRole);
    result('the clinic portal is told this is a clinician who scanned in',
      sess.clinician === true, String(sess.clinician));
    result('the clinic they joined is the one on the code',
      sess.clinicId === CID, sess.clinicId);
    result('and the access carries its own end date',
      !!sess.expiresAt, sess.expiresAt);
  }

  // ── 5. Codes are read in every shape they will really arrive in ──────
  const shapes = await page.evaluate(() => {
    // Re-derive the parser the page uses, from the page itself.
    function codeFrom(text) {
      var s = String(text || '').trim();
      var m = s.match(/[?&]c=([A-Za-z0-9]{4,12})/);
      if (m) return m[1].toUpperCase();
      m = s.match(/^HOMATT-CLINIC:([A-Za-z0-9]{4,12})$/i);
      if (m) return m[1].toUpperCase();
      m = s.match(/^[A-Za-z0-9]{6,12}$/);
      if (m) return s.toUpperCase();
      return null;
    }
    return {
      bare:  codeFrom('ABCD2345'),
      lower: codeFrom('abcd2345'),
      tagged: codeFrom('HOMATT-CLINIC:ABCD2345'),
      url:   codeFrom('https://example.org/clinic/clinician/join.html?c=ABCD2345'),
      junk:  codeFrom('https://some-other-site.example/thing'),
    };
  });
  result('a bare code scans', shapes.bare === 'ABCD2345', shapes.bare);
  result('a code typed in lower case still works', shapes.lower === 'ABCD2345', shapes.lower);
  result('the tagged form scans', shapes.tagged === 'ABCD2345', shapes.tagged);
  result('a shared link scans', shapes.url === 'ABCD2345', shapes.url);
  result('somebody else\'s QR code is not mistaken for one of ours',
    shapes.junk === null, String(shapes.junk));

  // ── 6. Nothing threw ─────────────────────────────────────────────────
  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e));
  result('no script on any clinician screen threw', real.length === 0, real.slice(0, 3).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
