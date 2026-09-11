// Changing the address you sign in with.
//
// The report: the owner changed EMAIL ADDRESS in Settings, then could not sign
// in with it — "Invalid login credentials". The app was behaving correctly and
// explaining nothing, which is the worst combination: that field writes to the
// clinics table and is the address patients are given. The login lives in the
// authentication system and nothing on the page could move it.
//
// So there are now two fields, and this checks they stay two: that saving the
// clinic profile never touches the login, that the new card does, and that
// nobody can be locked out by a typo.
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
const PORT = 8952, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const OLD_EMAIL = 'owner@clinic.ug';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

// Everything the page sends, so "did it touch the login?" is answerable.
const calls = [];

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
    let body = null;
    try { body = r.request().postData(); } catch (e) {}
    calls.push({ url: u, method: r.request().method(), body: body });

    // PUT /auth/v1/user is what actually moves the login.
    if (/\/auth\/v1\/user/.test(u) && r.request().method() === 'PUT') {
      let asked = null;
      try { asked = JSON.parse(body || '{}'); } catch (e) {}
      if (asked && /taken@/.test(asked.email || '')) {
        return r.fulfill({ status: 422, headers: H,
          body: JSON.stringify({ message: 'A user with this email address has already been registered' }) });
      }
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        id: UID, email: OLD_EMAIL, new_email: (asked || {}).email,
        email_change_sent_at: new Date().toISOString(),
      }) });
    }
    if (u.includes('/auth/v1/')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        access_token: 'tok', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref',
        user: { id: UID, email: OLD_EMAIL },
      }) });
    }
    if (u.startsWith(SB + '/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1].split('?')[0];
      if (name === 'get_clinic_staff' || name === 'message_threads') {
        return r.fulfill({ status: 200, headers: H, body: '[]' });
      }
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, clinicians: [] }) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid, em]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'Owner', clinicName: 'K', clinicId: cid,
      staffRole: 'owner', level: 'HC3', email: em }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: em } }));
  }, [CID, UID, OLD_EMAIL]);

  await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
  await page.waitForTimeout(2600);

  // ── 1. The two fields are told apart on screen ───────────────────────
  const labels = await page.evaluate(() => {
    const clinicRow = document.getElementById('sClinicEmail');
    const row = clinicRow ? clinicRow.closest('.form-row') : null;
    return {
      clinicLabel: row ? (row.querySelector('label') || {}).innerText || '' : '',
      clinicNote: row ? row.innerText : '',
      card: !!document.getElementById('signinEmailCard'),
      cardText: (document.getElementById('signinEmailCard') || {}).innerText || '',
    };
  });
  result('the clinic\'s email is labelled as the clinic\'s, not the login',
    /not your sign-in email/i.test(labels.clinicLabel + labels.clinicNote),
    labels.clinicLabel.replace(/\s+/g, ' ').slice(0, 60));
  result('and it points at where the sign-in email is changed',
    /Sign-in email/i.test(labels.clinicNote));
  result('there is a card for the sign-in email', labels.card === true);
  result('which says the old address keeps working until the link is opened',
    /keeps working until you open that link/i.test(labels.cardText));

  // ── 2. It shows the address that really signs you in ─────────────────
  const shown = await page.evaluate(() => (document.getElementById('seCurrent') || {}).value || '');
  result('it shows the address you actually sign in with', shown === OLD_EMAIL, shown);

  // ── 3. Saving the CLINIC profile must never touch the login ──────────
  calls.length = 0;
  await page.evaluate(() => {
    document.getElementById('sClinicEmail').value = 'newcontact@clinic.ug';
    if (typeof saveSettings === 'function') saveSettings();
  });
  await page.waitForTimeout(1500);
  const touchedAuth = calls.filter(c => /\/auth\/v1\/user/.test(c.url) && c.method === 'PUT');
  result('saving the clinic profile does NOT change the login',
    touchedAuth.length === 0, touchedAuth.length + ' auth writes');

  // ── 4. A typo is refused before anything is sent ─────────────────────
  calls.length = 0;
  await page.evaluate(() => {
    document.getElementById('seNew').value = 'not-an-email';
    changeSigninEmail();
  });
  await page.waitForTimeout(700);
  let msg = await page.evaluate(() => (document.getElementById('seMsg') || {}).textContent || '');
  result('an address that is not an address is refused', /valid email/i.test(msg), msg.slice(0, 60));
  result('and nothing was sent', calls.filter(c => /\/auth\/v1\/user/.test(c.url) && c.method === 'PUT').length === 0);

  // ── 5. The same address is refused ───────────────────────────────────
  await page.evaluate((em) => {
    document.getElementById('seNew').value = em;
    changeSigninEmail();
  }, OLD_EMAIL);
  await page.waitForTimeout(700);
  msg = await page.evaluate(() => (document.getElementById('seMsg') || {}).textContent || '');
  result('asking for the address you already have is refused',
    /already your sign-in email/i.test(msg), msg.slice(0, 60));

  // ── 6. A real change asks the auth system, and says what happens next ─
  calls.length = 0;
  await page.evaluate(() => {
    document.getElementById('seNew').value = 'daniel@clinic.com';
    changeSigninEmail();
  });
  await page.waitForTimeout(1600);
  const put = calls.find(c => /\/auth\/v1\/user/.test(c.url) && c.method === 'PUT');
  result('a real change goes to the authentication system', !!put, put ? put.body : 'never called');
  if (put) {
    let sent = null; try { sent = JSON.parse(put.body || '{}'); } catch (e) {}
    result('carrying the new address', sent && sent.email === 'daniel@clinic.com', sent && sent.email);
  }
  msg = await page.evaluate(() => (document.getElementById('seMsg') || {}).textContent || '');
  result('and the clinic is told to open the link, and that the old email still works',
    /open the link/i.test(msg) && new RegExp(OLD_EMAIL).test(msg), msg.slice(0, 110));

  // ── 7. An address somebody else uses is named, not shrugged at ───────
  await page.evaluate(() => {
    document.getElementById('seNew').value = 'taken@clinic.com';
    changeSigninEmail();
  });
  await page.waitForTimeout(1500);
  msg = await page.evaluate(() => (document.getElementById('seMsg') || {}).textContent || '');
  result('an email another account already uses is explained',
    /already uses that email/i.test(msg), msg.slice(0, 70));

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
