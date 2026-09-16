// What the sign-in screen tells a clinic, and whether any of it is true.
//
// A clinic sent one photograph of this screen carrying three separate wrong
// things, and the wrong things were ours, not theirs:
//
//   1. An amber banner: "You were asked to sign in again 228 MINUTES ago
//      because the saved sign-in on this device could not be read." Two faults
//      in one sentence. Signing out cleared the session and recorded no
//      reason, so the next guarded page found nothing and called an ordinary
//      sign-out damaged storage; and a successful sign-in never cleared the
//      reason, so it was still being printed nearly four hours later, above a
//      completely unrelated failure. It cost the first hour of the
//      investigation.
//
//   2. A footer reading "v151". That string was typed into index.html on
//      2026-07-05 and never changed, while the worker beside it reached v184.
//      Every clinic on every build reported v151 — the one field designed to
//      be photographed and sent to us, answering confidently and wrongly.
//
//   3. "Invalid login credentials", which is Supabase's sentence passed
//      through untouched. It covers a wrong password, an address with no
//      account, AND an email change that was started and never confirmed —
//      and the third is the only one the clinic cannot possibly work out,
//      because the app is the only thing that knows it happened.
//
// Changing a sign-in email does not move the login until the confirmation link
// is opened, and with Supabase's "Secure email change" a link goes to the OLD
// address too and both must be opened. Until then the old address IS the
// account. That is correct behaviour; being silent about it is not.
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
const PORT = 8959, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';
const OLD_EMAIL = 'owner@clinic.ug';
const NEW_EMAIL = 'lghealthhub@homat.com';   // the address from the report

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

const calls = [];
let signInAs = null;          // which email the mocked server will accept

/* index.html bounces straight to the dashboard when a session exists, and a
 * redirect during navigation reaches Playwright as net::ERR_ABORTED — so the
 * session has to be cleared BEFORE asking for the sign-in page, not after
 * arriving on it. Same origin, so it can be cleared from wherever we are. */
async function gotoSignIn(page, keep) {
  await page.evaluate((k) => {
    var save = {};
    (k || []).forEach(function (key) { save[key] = localStorage.getItem(key); });
    localStorage.clear();
    Object.keys(save).forEach(function (key) {
      if (save[key] != null) localStorage.setItem(key, save[key]);
    });
  }, keep || []);
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
}

function seed(page, extra) {
  return page.evaluate(([cid, uid, email, ex]) => {
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'Owner', clinicName: 'K', clinicId: cid,
      staffRole: 'owner', level: 'HC3', email: email }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid, email: email } }));
    Object.keys(ex || {}).forEach(k => localStorage.setItem(k, ex[k]));
  }, [CID, UID, OLD_EMAIL, extra || {}]);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    let body = null;
    try { body = r.request().postData(); } catch (e) {}
    calls.push({ url: u, method: r.request().method(), body: body });

    if (/\/auth\/v1\/user/.test(u) && r.request().method() === 'PUT') {
      let asked = null; try { asked = JSON.parse(body || '{}'); } catch (e) {}
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        id: UID, email: OLD_EMAIL, new_email: (asked || {}).email,
        email_change_sent_at: new Date().toISOString() }) });
    }
    // The password grant. Only the address the test has decided is live works.
    if (/\/auth\/v1\/token/.test(u)) {
      let asked = null; try { asked = JSON.parse(body || '{}'); } catch (e) {}
      const tried = String((asked && asked.email) || '').toLowerCase();
      if (tried && signInAs && tried !== signInAs) {
        // Supabase's real wording, verbatim — the whole point is what the app
        // does with it.
        return r.fulfill({ status: 400, headers: H, body: JSON.stringify({
          error: 'invalid_grant', error_description: 'Invalid login credentials',
          message: 'Invalid login credentials', code: 400 }) });
      }
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        access_token: 'tok', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref',
        user: { id: UID, email: tried || OLD_EMAIL } }) });
    }
    if (u.includes('/auth/v1/')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        access_token: 'tok', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref',
        user: { id: UID, email: OLD_EMAIL } }) });
    }
    if (/portal_users/.test(u)) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify([{
        id: 'pu1', auth_user_id: UID, clinic_id: CID, role: 'clinic_staff',
        is_active: true, full_name: 'Owner', staff_role: 'owner',
        clinics: { name: 'Kampala Clinic' } }]) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  // ── 1. Signing out is not a fault, and is not announced as one ────────
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await seed(page);
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  await page.evaluate(() => { clinicSignOut(); });
  await page.waitForTimeout(1500);

  const afterOut = await page.evaluate(() => {
    let r = null;
    try { r = JSON.parse(localStorage.getItem('homatt_last_signout') || 'null'); } catch (e) {}
    return { here: location.pathname, rec: r,
             session: localStorage.getItem('clinic_session'),
             banner: (document.getElementById('whySignedOut') || {}).textContent || '',
             shown: !!(document.getElementById('whySignedOut') &&
                       getComputedStyle(document.getElementById('whySignedOut')).display !== 'none') };
  });
  result('signing out is recorded as something the clinic did, not a fault',
    !!afterOut.rec && afterOut.rec.deliberate === true && /signed out/i.test(afterOut.rec.why || ''),
    JSON.stringify(afterOut.rec));
  result('and the sign-in page does not announce it back at them',
    afterOut.shown === false, afterOut.banner.slice(0, 70));

  // Opening a guarded page after signing out must NOT relabel it.
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const relabel = await page.evaluate(() => {
    let r = null;
    try { r = JSON.parse(localStorage.getItem('homatt_last_signout') || 'null'); } catch (e) {}
    return r;
  });
  result('and a guarded page opened afterwards does not call it damaged storage',
    !!relabel && relabel.deliberate === true && !/could not be read/i.test(relabel.why || ''),
    (relabel || {}).why);

  // ── 2. Absent and damaged are different, and say different things ─────
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => localStorage.setItem('clinic_session', '{not json at all'));
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const corrupt = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('homatt_last_signout') || 'null'); } catch (e) { return null; }
  });
  result('a session that IS there but is damaged still says so',
    !!corrupt && /could not be read/i.test(corrupt.why || ''), (corrupt || {}).why);

  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  const absent = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('homatt_last_signout') || 'null'); } catch (e) { return null; }
  });
  result('nothing saved at all is reported as nothing saved, not as damage',
    !!absent && /no sign-in saved/i.test(absent.why || '') &&
    !/could not be read/i.test(absent.why || ''), (absent || {}).why);

  // ── 3. An explanation must not outlive what it explains ───────────────
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('homatt_last_signout', JSON.stringify({
      why: 'the server refused the saved sign-in', online: true,
      at: new Date(Date.now() - 228 * 60000).toISOString() }));   // the real 228 minutes
  });
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const stale = await page.evaluate(() => ({
    shown: !!(document.getElementById('whySignedOut') &&
              getComputedStyle(document.getElementById('whySignedOut')).display !== 'none'),
    kept: localStorage.getItem('homatt_last_signout'),
  }));
  result('a 228-minute-old reason is no longer printed over today’s screen',
    stale.shown === false && stale.kept === null, stale.shown ? 'still shown' : 'dropped');

  await page.evaluate(() => {
    localStorage.setItem('homatt_last_signout', JSON.stringify({
      why: 'the server refused the saved sign-in', online: true,
      at: new Date(Date.now() - 3 * 60000).toISOString() }));
  });
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const fresh = await page.evaluate(() => ({
    shown: getComputedStyle(document.getElementById('whySignedOut')).display !== 'none',
    text: document.getElementById('whySignedOut').textContent,
  }));
  result('but a reason from three minutes ago still is — this is not just deletion',
    fresh.shown === true && /3 minutes ago/.test(fresh.text), fresh.text.slice(0, 60));

  // Signing in ends the story.
  signInAs = OLD_EMAIL;
  await page.evaluate((e) => {
    document.getElementById('email').value = e;
    document.getElementById('password').value = 'pw123456';
  }, OLD_EMAIL);
  await page.evaluate(() => document.getElementById('loginForm')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.waitForTimeout(1800);
  const afterIn = await page.evaluate(() => ({
    here: location.pathname, reason: localStorage.getItem('homatt_last_signout') }));
  result('signing in clears the explanation, so it cannot reappear tomorrow',
    afterIn.reason === null, afterIn.here + ' · ' + afterIn.reason);

  // ── 4. The build in the footer is asked for, not typed ────────────────
  /* Start from a KNOWN storage state, not from whatever is lying around.
   *
   * This read "the highest homatt-clinic cache wins" and simply opened two —
   * which is true only if nothing else has already written an applied-build
   * record, and inside the suite something had: it reported v999+ (the build
   * test-selfupdate.js uses) where v903 was expected. The assertion was
   * describing ambient state rather than the thing it meant to test, and it
   * passed alone and failed in company, which is the worst way for a test to
   * be wrong. Wipe both stores first. */
  await gotoSignIn(page);
  await page.evaluate(async () => {
    for (const k of await caches.keys()) {
      if (k.indexOf('homatt-clinic-') === 0) await caches.delete(k);
    }
    await new Promise((res) => {
      const q = indexedDB.open('homatt-shell', 1);
      q.onupgradeneeded = () => { try { q.result.createObjectStore('files'); } catch (e) {} };
      q.onsuccess = () => {
        try {
          const t = q.result.transaction('files', 'readwrite');
          t.objectStore('files').delete('__meta__appliedBuild');
          t.oncomplete = res; t.onerror = res;
        } catch (e) { res(); }
      };
      q.onerror = res;
    });
    await caches.open('homatt-clinic-v903');
    await caches.open('homatt-clinic-v410');       // an old one left lying about
  });
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const marker1 = await page.evaluate(() => document.getElementById('buildMarker').textContent);
  result('the footer reports the build it is actually running',
    /v903/.test(marker1) && !/v151/.test(marker1) && !/v410/.test(marker1), marker1);

  await page.evaluate(async () => {
    // What the self-update writes when it has put a newer build in place.
    await new Promise((res) => {
      const q = indexedDB.open('homatt-shell', 1);
      q.onupgradeneeded = () => { try { q.result.createObjectStore('files'); } catch (e) {} };
      q.onsuccess = () => {
        const t = q.result.transaction('files', 'readwrite');
        t.objectStore('files').put({ body: 'homatt-clinic-v955', ct: 'text/plain' }, '__meta__appliedBuild');
        t.oncomplete = res; t.onerror = res;
      };
      q.onerror = res;
    });
  });
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const marker2 = await page.evaluate(() => document.getElementById('buildMarker').textContent);
  result('a build taken over the air wins, and is marked as one',
    /v955\+/.test(marker2), marker2);
  result('and the number is never the hard-coded v151 again',
    !/v151/.test(marker1) && !/v151/.test(marker2), marker1 + ' | ' + marker2);

  // ── 5. A half-finished email change, which is what actually happened ──
  await gotoSignIn(page);
  await seed(page);
  const before = calls.length;
  await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  await page.evaluate(async (e) => {
    document.getElementById('seNew').value = e;
    await changeSigninEmail();
    await new Promise(r => setTimeout(r, 800));
  }, NEW_EMAIL);
  await page.waitForTimeout(900);

  const sent = await page.evaluate(() => {
    let p = null;
    try { p = JSON.parse(localStorage.getItem('homatt_email_change') || 'null'); } catch (e) {}
    const box = document.getElementById('sePending');
    return { pend: p, msg: (document.getElementById('seMsg') || {}).textContent || '',
             banner: box ? box.textContent : '',
             shown: box ? getComputedStyle(box).display !== 'none' : false };
  });
  result('the half-finished change is written down on the device',
    !!sent.pend && sent.pend.to === NEW_EMAIL && sent.pend.from === OLD_EMAIL,
    JSON.stringify(sent.pend));
  result('Settings says the change is not finished and which address still works',
    sent.shown === true && sent.banner.indexOf(NEW_EMAIL) >= 0 &&
    sent.banner.indexOf(OLD_EMAIL) >= 0, sent.banner.slice(0, 100));

  /* The staff record must NOT move yet. It used to be written the instant the
   * link was SENT, so every other screen advertised an address that would not
   * sign in — which is how a clinic ends up typing it. */
  const wrote = calls.slice(before).filter(c =>
    /portal_users/.test(c.url) && c.method !== 'GET' && String(c.body || '').indexOf(NEW_EMAIL) >= 0);
  result('and the staff record is NOT moved to an address that cannot sign in yet',
    wrote.length === 0, wrote.length + ' writes: ' + wrote.map(w => w.method).join(','));

  // ── 6. The sign-in screen now knows, and says so ──────────────────────
  await page.evaluate(() => localStorage.removeItem('clinic_session'));
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const warned = await page.evaluate(() => {
    const el = document.getElementById('pendingEmail');
    return { shown: el ? getComputedStyle(el).display !== 'none' : false,
             text: el ? el.textContent : '' };
  });
  result('the sign-in page warns before a word is typed',
    warned.shown === true && warned.text.indexOf(NEW_EMAIL) >= 0 &&
    warned.text.indexOf(OLD_EMAIL) >= 0, warned.text.slice(0, 110));

  // Typing the NEW address — exactly what the clinic did.
  signInAs = OLD_EMAIL;
  await page.evaluate((e) => {
    document.getElementById('email').value = e;
    document.getElementById('password').value = 'pw123456';
    document.getElementById('loginForm')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, NEW_EMAIL);
  await page.waitForTimeout(1600);
  const refused = await page.evaluate(() => ({
    here: location.pathname,
    err: (document.getElementById('loginError') || {}).textContent || '' }));
  result('typing the new address explains itself instead of "Invalid login credentials"',
    !/invalid login credentials/i.test(refused.err) &&
    refused.err.indexOf(OLD_EMAIL) >= 0 && /never confirmed|not your sign-in/i.test(refused.err),
    refused.err.slice(0, 130));

  // A genuinely wrong password on the RIGHT address must not blame the change.
  await page.evaluate(() => { localStorage.removeItem('homatt_email_change'); });
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  signInAs = 'someone-else@clinic.ug';
  await page.evaluate((e) => {
    document.getElementById('email').value = e;
    document.getElementById('password').value = 'wrongpass';
    document.getElementById('loginForm')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, OLD_EMAIL);
  await page.waitForTimeout(1500);
  const plain = await page.evaluate(() =>
    (document.getElementById('loginError') || {}).textContent || '');
  result('an ordinary wrong sign-in is plain, and never claims an account exists',
    /letter by letter/i.test(plain) && plain.indexOf(OLD_EMAIL) >= 0 &&
    !/no account|does not exist|no such/i.test(plain), plain.slice(0, 120));

  // ── 7. Once the link IS opened, everything reconciles ─────────────────
  await page.evaluate((p) => {
    localStorage.setItem('homatt_email_change', JSON.stringify(p));
  }, { from: OLD_EMAIL, to: NEW_EMAIL, at: new Date().toISOString() });
  signInAs = NEW_EMAIL;
  await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
  await page.waitForTimeout(600);
  await page.evaluate((e) => {
    document.getElementById('email').value = e;
    document.getElementById('password').value = 'pw123456';
    document.getElementById('loginForm')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }, NEW_EMAIL);
  await page.waitForTimeout(1800);
  const done = await page.evaluate(() => ({
    here: location.pathname, pend: localStorage.getItem('homatt_email_change') }));
  result('signing in with the new address means it is live — the warning goes',
    done.pend === null && /dashboard/.test(done.here), done.here + ' · ' + done.pend);

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
