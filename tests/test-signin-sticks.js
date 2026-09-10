// Does the clinic stay signed in?
//
// Clinics were being thrown back to the sign-in page in the middle of a
// working day, on phones that had never signed out. The cause is one return
// value doing two jobs:
//
//   supabase.auth.getSession() answers { session: null } WITHOUT THROWING both
//   when there is no sign-in at all AND when there is a perfectly good refresh
//   token that it could not reach the server to exchange.
//
// An access token lasts an hour. A phone in a pocket, or a connection that
// drops for thirty seconds, comes back with an expired one — and the old code
// read that null as "this localStorage was faked", deleted the session and
// redirected. The catch() branch labelled "allow offline access" never ran,
// because nothing had been thrown.
//
// What must still work: a genuinely faked session, and a refresh token the
// SERVER has actually rejected, both still land on the sign-in page.
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
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT = 8938, ORIGIN = 'http://localhost:' + PORT;

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));

  // one run = one fresh context, so nothing leaks between the cases
  async function run(opts) {
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    if (process.env.DEBUG_SIGNIN) {
      page.on('pageerror', e => console.log('   [pageerror]', e.message.split('\n')[0]));
      page.on('console', m => { if (m.type()==='error') console.log('   [console]', m.text().slice(0,120)); });
    }
    const CORS = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' };
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      // The token endpoint is where a renewal happens. Everything the clinic
      // experiences — no signal, a rejected token, a clean renewal — is this
      // one request behaving differently.
      if (/\/auth\/v1\/token/.test(u)) {
        page.evaluate(() => { window.__tokenCalls = (window.__tokenCalls||0) + 1; }).catch(()=>{});
        if (opts.tokenDead) return r.abort();                       // no signal
        if (opts.tokenRejected) return r.fulfill({ status: 400, headers: CORS,
          body: JSON.stringify({ error: 'invalid_grant', error_description: 'Invalid Refresh Token: Already Used' }) });
        return r.fulfill({ status: 200, headers: CORS, body: JSON.stringify({
          access_token: 'fresh', token_type: 'bearer', expires_in: 3600,
          refresh_token: 'r2', user: { id: opts.asUser || UID } }) });
      }
      if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: CORS, body: '[]' });
      return r.abort();
    });
    // The real Supabase library is bundled with the app and will overwrite any
    // stub, so this drives the REAL library and controls only the network —
    // which is the thing that actually varies in a Ugandan clinic.
    await page.addInitScript((o) => {
      window.__tokenCalls = 0;
      if (o.offline) Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    }, opts);

    await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(([cid, uid, storeToken]) => {
      localStorage.clear();
      localStorage.setItem('clinic_session', JSON.stringify({
        staffName:'D', clinicName:'K', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
      if (storeToken) {
        // Expired on purpose: this is a phone that has been in a pocket. The
        // library must go to the network to renew, which is where the fault was.
        localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
          access_token:'t', refresh_token:'r', token_type:'bearer',
          expires_in:3600, expires_at:Math.floor(Date.now()/1000) - 60, user:{id:uid} }));
      }
    }, [CID, UID, opts.storeToken !== false]);

    await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4200);
    const out = {
      where: new URL(page.url()).pathname.split('/').pop(),
      stillHasSession: await page.evaluate(() => !!localStorage.getItem('clinic_session')),
      tokenCalls: await page.evaluate(() => window.__tokenCalls || 0),
      stillHasToken: await page.evaluate(() => !!localStorage.getItem('sb-homatt-clinic-auth')),
      why: await page.evaluate(() => {
        try { return (JSON.parse(localStorage.getItem('homatt_last_signout')||'null')||{}).why || ''; }
        catch (e) { return ''; }
      }),
      saidWhy: await page.evaluate(() => {
        var e = document.getElementById('whySignedOut');
        return e && getComputedStyle(e).display !== 'none' ? e.textContent.trim() : '';
      }),
    };
    await ctx.close();
    return out;
  }

  // 1. The ordinary day: the token renews cleanly.
  let r = await run({});
  result('a signed-in clinic stays on the page',
    r.where === 'dashboard.html' && r.stillHasSession, 'landed on ' + r.where);

  // 2. THE BUG. A real sign-in on a phone with no signal. getSession() answers
  //    { session: null } without throwing, and the old code read that as a
  //    faked login and threw the clinic out mid-clinic.
  r = await run({ offline: true, tokenDead: true });
  result('an offline phone with a real sign-in is NOT signed out',
    r.where === 'dashboard.html' && r.stillHasSession && r.stillHasToken,
    'landed on ' + r.where + ', session kept=' + r.stillHasSession);

  // 3. Online by the browser's reckoning, but the renewal cannot get through —
  //    which is most of what "online" means on a Ugandan connection.
  r = await run({ tokenDead: true });
  result('a renewal that cannot reach the server does not sign anybody out',
    r.where === 'dashboard.html' && r.stillHasSession, 'landed on ' + r.where);

  // 4. The pocket case: expired token, connection is back, renewal works.
  r = await run({});
  result('an expired token is renewed quietly, without a sign-in screen',
    r.where === 'dashboard.html' && r.stillHasSession && r.tokenCalls >= 1,
    'token endpoint called ' + r.tokenCalls + '×');

  // ── and the security this is not allowed to cost ────────────────────────
  r = await run({ storeToken: false });
  result('a faked session with no sign-in behind it is still thrown out',
    r.where === 'index.html' && !r.stillHasSession, 'landed on ' + r.where);

  r = await run({ tokenRejected: true });
  result('a refresh token the SERVER rejects still signs the user out',
    r.where === 'index.html', 'landed on ' + r.where);
  result('and the reason is written down rather than lost',
    !!r.why, 'recorded: "' + r.why + '"');

  // The sign-in page reads that back. Seeded directly so this does not depend
  // on the timing of a redirect — "it logs me out sometimes" is not something
  // anybody can chase, and a reason with a time is.
  {
    const ctx = await b.newContext();
    const page = await ctx.newPage();
    await page.route('**/*', rt => rt.request().url().startsWith(ORIGIN) ? rt.continue() : rt.abort());
    await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { localStorage.clear();
      localStorage.setItem('homatt_last_signout', JSON.stringify({
        why: 'the server refused the saved sign-in', at: new Date().toISOString(), online: false })); });
    await page.goto(ORIGIN + '/clinic/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    const shown = await page.evaluate(() => {
      const e = document.getElementById('whySignedOut');
      return e && getComputedStyle(e).display !== 'none' ? e.textContent.trim() : '';
    });
    result('the sign-in page says WHY, instead of appearing from nowhere',
      /because the server refused the saved sign-in/.test(shown) && /no connection/.test(shown),
      shown.slice(0, 100) || '(nothing shown)');
    await ctx.close();
  }

  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
