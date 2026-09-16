// Changing a sign-in email when the confirmation link can never arrive.
//
// A clinic's account was on a domain that takes no mail. Supabase's "Secure
// email change" sends a confirmation to the OLD address as well as the new
// one, so `auth.updateUser({email})` was refused outright — naming THEIR OWN
// current address as invalid, for a change they had not finished asking for.
//
// The portal could explain that and nothing else. The only remedy on offer was
// "whoever runs the database has to change it there", which for a clinic in
// Uganda means it never happens: the account is stuck on that address for
// ever.
//
// So there is a second route, through an Edge Function with the admin API,
// which sends no mail at all. What replaces the confirmation link is the thing
// the link was actually for: proof that this is the account holder. The link
// proves two things — control of the new mailbox, and identity — and only the
// second is a security property. The first is precisely what is broken here.
//
// So: a valid session AND the current password, verified on the SERVER. That
// is the same bar as changing a password, and an attacker who can clear it
// already owns the account.
//
// What this file checks is mostly the failure directions, because the success
// path is the easy half:
//   · the password is required, and a wrong one changes nothing;
//   · a function that was never deployed says SO, rather than "no connection"
//     — the 404-with-no-CORS trap that `transcribe` already fell into once;
//   · and afterwards every screen says the NEW address is the login, because
//     a "not confirmed yet, keep using the old one" notice left over from the
//     ordinary route would send somebody to an address that no longer exists.
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
const PORT = 8967, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const OLD_EMAIL = 'emmanuel@homatt-health.com';   // the domain that takes no mail
const NEW_EMAIL = 'emmanuel@clinic.com';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

// What the mocked change-email function should do next.
let fnMode = 'ok';
const seen = [];

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1200 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

    if (/\/functions\/v1\/change-email/.test(u)) {
      let body = null;
      try { body = JSON.parse(r.request().postData() || '{}'); } catch (e) {}
      if (r.request().method() === 'POST') seen.push(body);
      if (fnMode === 'notdeployed') {
        /* The real shape of a function that was never deployed: 404 from the
         * gateway with NO Access-Control-Allow-Origin on it. The browser then
         * refuses to hand the reply to JavaScript at all, so it arrives with
         * no status and no body — indistinguishable, from inside the page,
         * from having no signal. Reproduced exactly, header and all. */
        return r.fulfill({ status: 404, headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ message: 'Requested function was not found' }) });
      }
      if (fnMode === 'badpw') {
        return r.fulfill({ status: 401, headers: H,
          body: JSON.stringify({ ok: false, error: 'That password does not match this account.' }) });
      }
      if (fnMode === 'taken') {
        return r.fulfill({ status: 409, headers: H,
          body: JSON.stringify({ ok: false, error: 'Another account already uses that email.' }) });
      }
      return r.fulfill({ status: 200, headers: H,
        body: JSON.stringify({ ok: true, from: OLD_EMAIL, to: (body && body.newEmail) || NEW_EMAIL }) });
    }

    // The ordinary route always refuses the CURRENT address — the clinic's
    // actual situation, reproduced.
    if (/\/auth\/v1\/user/.test(u) && r.request().method() === 'PUT') {
      return r.fulfill({ status: 400, headers: H, body: JSON.stringify({
        code: 'email_address_invalid',
        message: 'Email address "' + OLD_EMAIL + '" is invalid' }) });
    }
    if (u.includes('/auth/v1/')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        access_token: 'tok', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref',
        user: { id: UID, email: OLD_EMAIL } }) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  async function openSettings() {
    await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
    await page.waitForTimeout(2000);
  }

  /* Seed from index.html, NOT from settings.html.
   *
   * settings.html calls requireClinic() on load, which finds no session yet
   * and redirects — so the seeding evaluate raced the redirect and every run
   * died with "Execution context was destroyed". index.html is the unguarded
   * page: with no session it simply stays put. */
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid, em]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'D', clinicName: 'K', clinicId: cid, staffRole: 'owner', email: em }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: em } }));
  }, [CID, UID, OLD_EMAIL]);

  // ── 1. The dead end still happens, and now opens a door ──────────────
  await openSettings();
  const stuck = await page.evaluate(async (next) => {
    document.getElementById('seNew').value = next;
    await changeSigninEmail();
    await new Promise(r => setTimeout(r, 900));
    const box = document.getElementById('seDirect');
    return { msg: (document.getElementById('seMsg') || {}).textContent || '',
             open: box ? getComputedStyle(box).display !== 'none' : false };
  }, NEW_EMAIL);
  result('the ordinary route still refuses, and says which address was refused',
    /being refused is the one you sign in with now/i.test(stuck.msg), stuck.msg.slice(0, 96));
  result('and it no longer ends there — the direct route is offered', stuck.open === true);

  // ── 2. The password is not optional ──────────────────────────────────
  const noPw = await page.evaluate(async () => {
    document.getElementById('seDirectPwd').value = '';
    await changeSigninEmailDirect();
    await new Promise(r => setTimeout(r, 400));
    return (document.getElementById('seMsg') || {}).textContent || '';
  });
  result('it refuses to go ahead without the password',
    /password/i.test(noPw) && seen.length === 0, noPw.slice(0, 80));

  // ── 3. A wrong password changes nothing ──────────────────────────────
  fnMode = 'badpw';
  const wrong = await page.evaluate(async () => {
    document.getElementById('seDirectPwd').value = 'not-the-password';
    await changeSigninEmailDirect();
    await new Promise(r => setTimeout(r, 900));
    return { msg: (document.getElementById('seMsg') || {}).textContent || '',
             stored: localStorage.getItem('homatt_email_change') };
  });
  result('a wrong password is refused by the SERVER, and nothing is recorded',
    /does not match/i.test(wrong.msg) && wrong.stored === null, wrong.msg.slice(0, 80));
  result('and the password really was sent for checking, not judged here',
    seen.length === 1 && seen[0].password === 'not-the-password' &&
    seen[0].newEmail === NEW_EMAIL, JSON.stringify(seen[0] || {}).slice(0, 80));

  // ── 4. An address somebody else holds ────────────────────────────────
  fnMode = 'taken';
  const taken = await page.evaluate(async () => {
    document.getElementById('seDirectPwd').value = 'correct-horse';
    await changeSigninEmailDirect();
    await new Promise(r => setTimeout(r, 900));
    return (document.getElementById('seMsg') || {}).textContent || '';
  });
  result('an address another account already uses is named as that',
    /already uses that email/i.test(taken), taken.slice(0, 70));

  // ── 5. A function nobody deployed says SO ────────────────────────────
  fnMode = 'notdeployed';
  const missing = await page.evaluate(async () => {
    document.getElementById('seDirectPwd').value = 'correct-horse';
    await changeSigninEmailDirect();
    await new Promise(r => setTimeout(r, 1200));
    return (document.getElementById('seMsg') || {}).textContent || '';
  });
  result('a function that was never deployed is named, not reported as a bad connection',
    /not installed|deploy/i.test(missing) && !/could not reach the server/i.test(missing),
    missing.slice(0, 110));

  // ── 6. It works, and says what to use from now on ────────────────────
  fnMode = 'ok';
  const done = await page.evaluate(async () => {
    document.getElementById('seDirectPwd').value = 'correct-horse';
    await changeSigninEmailDirect();
    await new Promise(r => setTimeout(r, 1200));
    let rec = null;
    try { rec = JSON.parse(localStorage.getItem('homatt_email_change') || 'null'); } catch (e) {}
    const box = document.getElementById('seDirect');
    return { msg: (document.getElementById('seMsg') || {}).textContent || '', rec,
             open: box ? getComputedStyle(box).display !== 'none' : false,
             field: (document.getElementById('seNew') || {}).value || '',
             pwd: (document.getElementById('seDirectPwd') || {}).value || '' };
  });
  result('it changes the address and says which one to use now',
    new RegExp('you now sign in with ' + NEW_EMAIL.replace('.', '\\.'), 'i').test(done.msg),
    done.msg.slice(0, 100));
  result('and says the password did not change, because that is the next question',
    /password has not changed/i.test(done.msg));
  result('the change is written down on the device, marked as already done',
    !!done.rec && done.rec.to === NEW_EMAIL && done.rec.from === OLD_EMAIL &&
    done.rec.direct === true, JSON.stringify(done.rec));
  result('and the form is cleared — no password left sitting on screen',
    done.open === false && done.field === '' && done.pwd === '',
    'box=' + done.open + ' new="' + done.field + '" pwd="' + done.pwd + '"');

  // ── 7. Every later screen must say the NEW address is the login ──────
  // A "not confirmed yet — keep using the old one" notice left over from the
  // ordinary route would send somebody to an address that no longer exists.
  await page.evaluate(() => localStorage.removeItem('clinic_session'));
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const banner = await page.evaluate(() => {
    const el = document.getElementById('pendingEmail');
    return { shown: el ? getComputedStyle(el).display !== 'none' : false,
             text: el ? el.textContent : '' };
  });
  result('the sign-in page says the account MOVED, not that it is unconfirmed',
    banner.shown && banner.text.indexOf(NEW_EMAIL) >= 0 &&
    /no longer works|use that from now on/i.test(banner.text) &&
    !/has not been confirmed/i.test(banner.text), banner.text.slice(0, 120));

  const oldTyped = await page.evaluate(async (old) => {
    document.getElementById('email').value = old;
    document.getElementById('password').value = 'correct-horse';
    return _signinFault({ message: 'Invalid login credentials' }, old);
  }, OLD_EMAIL);
  result('and typing the OLD address afterwards explains itself',
    /that is the old address/i.test(oldTyped) && oldTyped.indexOf(NEW_EMAIL) >= 0,
    oldTyped.slice(0, 110));

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
