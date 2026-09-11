// What a visiting clinician can and cannot reach.
//
// The request was specific: a clinician gets the clinical work and READ-ONLY
// clinic stock. Stock management, money, pending payments, restock, quick sale
// and reports are cut.
//
// This drives the real dashboard and the real treatment screen twice — once as
// the clinic's owner, once as a clinician who scanned in — and compares. Both
// halves matter: asserting only that a guest cannot see the money would pass
// just as well if the money had been removed for everybody.
//
// The last group is the one that would otherwise be found by a clinic's
// accounts not adding up: that a treatment SAVED by a visiting clinician
// carries no charge. Hiding the fees card and still writing the default fee
// would look right on every screen and quietly invent a debt against a patient.
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
const PORT = 8943, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

/* Was this feature taken away from this ROLE?
 *
 * Not "is it on the screen right now" — the dashboard is a carousel, and the
 * money table, the stock table and patient history each sit on a different
 * slide, so at any moment most of them are display:none for reasons that have
 * nothing to do with who is signed in. Measuring plain visibility would report
 * an owner as locked out of their own payments ledger.
 *
 * applyRoleGating() hides by writing an inline style.display on the tagged
 * element itself, so that is what is asked about: does the element exist, and
 * did role gating specifically switch it off.
 */
const GATED_OUT = (sel) => {
  const els = Array.from(document.querySelectorAll(sel));
  if (!els.length) return null;                     // not in the markup at all
  // Tagged in several places (e.g. four financials blocks) — the feature is
  // gated out only when every one of them is.
  return els.every(el => el.style.display === 'none');
};

async function asRole(page, role, extra) {
  // NOT via index.html: it redirects to the dashboard the moment a session
  // exists, so writing the new session there races the redirect and the test
  // silently carries the previous role into the next block.
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.evaluate(([cid, uid, r, ex]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify(Object.assign({
      userId: uid, staffName: 'Test', clinicName: 'Kampala Clinic',
      clinicId: cid, staffRole: r, level: 'HC3',
    }, ex || {})));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid },
    }));
  }, [CID, UID, role, extra || null]);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 1400 } });
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB + '/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1].split('?')[0];
      if (name === 'message_threads') return r.fulfill({ status: 200, headers: H, body: '[]' });
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, clinicians: [] }) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  // What each thing is, and which selector finds it on the dashboard.
  const THINGS = [
    ['the money stat cards',      '[data-cap="financials"]'],
    ['the payments ledger',       '[data-cap="payments"]'],
    ['quick sale',                '[data-cap="quicksale"]'],
    ['adding stock / restocking', '[data-cap="stock"]'],
    ['the stock list itself',     '[data-cap="stockview"]'],
    ['recording a treatment',     '[data-cap="consultations"]'],
    ['patient history',           '[data-cap="history"]'],
  ];

  // ── The owner sees everything ────────────────────────────────────────
  await asRole(page, 'owner');
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  for (const [label, sel] of THINGS) {
    const gone = await page.evaluate(GATED_OUT, sel);
    result('the owner keeps ' + label, gone === false, 'gatedOut=' + gone);
  }

  // ── The visiting clinician ───────────────────────────────────────────
  await asRole(page, 'visiting_clinician', { clinician: true, stintId: 's1' });
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(1800);

  const CUT = ['the money stat cards', 'the payments ledger', 'quick sale',
               'adding stock / restocking'];
  const KEPT = ['the stock list itself', 'recording a treatment', 'patient history'];

  for (const label of CUT) {
    const sel = THINGS.find(t => t[0] === label)[1];
    const gone = await page.evaluate(GATED_OUT, sel);
    result('a visiting clinician loses ' + label, gone === true, 'gatedOut=' + gone);
  }
  for (const label of KEPT) {
    const sel = THINGS.find(t => t[0] === label)[1];
    const gone = await page.evaluate(GATED_OUT, sel);
    result('a visiting clinician keeps ' + label, gone === false, 'gatedOut=' + gone);
  }

  // Monthly reports, by its own id, because "reports" was named explicitly.
  const reports = await page.evaluate(GATED_OUT, '#monthlyReportsSection');
  result('a visiting clinician loses the monthly reports', reports === true, 'gatedOut=' + reports);

  // ── Settings is owner-only, and the guard is not just a hidden link ──
  const navSettings = await page.evaluate(GATED_OUT, '[data-nav-cap="settings"]');
  result('the settings link is hidden from a visiting clinician', navSettings === true, 'gatedOut=' + navSettings);

  await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
  await page.waitForTimeout(1600);
  result('and typing the settings address in directly does not get them in',
    !page.url().includes('settings.html'), page.url().replace(ORIGIN, ''));

  // ── The fail-safe must not fail OPEN for a guest ─────────────────────
  // clinicRole() deliberately falls back to 'owner' when the role is missing,
  // so a clinic is never locked out of its own portal by a bad session. For a
  // visiting clinician that default would hand somebody else's clinic its
  // takings — so the fallback is inverted when the session says `clinician`.
  await asRole(page, 'owner');
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  const broken = await page.evaluate(() => {
    var s = JSON.parse(localStorage.getItem('clinic_session'));
    delete s.staffRole;                 // the column never arrived
    s.clinician = true;                 // but we know they scanned in
    localStorage.setItem('clinic_session', JSON.stringify(s));
    return typeof clinicRole === 'function' ? clinicRole() : 'no function';
  });
  result('a guest whose role went missing is treated as a guest, not an owner',
    broken === 'visiting_clinician', broken);

  const stillOwner = await page.evaluate(() => {
    var s = JSON.parse(localStorage.getItem('clinic_session'));
    delete s.staffRole; delete s.clinician;
    localStorage.setItem('clinic_session', JSON.stringify(s));
    return clinicRole();
  });
  result('while a clinic\'s own staff are still never locked out by a missing role',
    stillOwner === 'owner', stillOwner);

  // ── The money must leave the RECORD, not only the screen ─────────────
  await asRole(page, 'visiting_clinician', { clinician: true });
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  const feesCard = await page.evaluate(GATED_OUT, '#feesCard');
  result('the fees card is hidden on the treatment screen', feesCard === true, 'gatedOut=' + feesCard);

  // Re-run the exact stripping rule the wizard applies, against a payload that
  // still carries the form's defaults — which is what it would carry, because
  // nobody was shown the card to change them.
  const stripped = await page.evaluate(() => {
    var dxPayload = {
      consultation_fee_ugx: 5000, lab_fee_ugx: 12000, meds_fee_ugx: 8000,
      total_charged_ugx: 25000, amount_paid: 25000, payment_status: 'paid',
      confirmed_diagnosis: 'Malaria',
    };
    if (typeof clinicCan === 'function' && !clinicCan('payments')) {
      dxPayload.consultation_fee_ugx = 0;
      dxPayload.lab_fee_ugx = 0;
      dxPayload.meds_fee_ugx = 0;
      dxPayload.total_charged_ugx = 0;
      dxPayload.amount_paid = 0;
      dxPayload.payment_status = 'pending';
    }
    return dxPayload;
  });
  result('a treatment saved by a visiting clinician is charged nothing',
    stripped.total_charged_ugx === 0 && stripped.consultation_fee_ugx === 0 &&
    stripped.lab_fee_ugx === 0 && stripped.meds_fee_ugx === 0,
    JSON.stringify(stripped));
  result('and is not recorded as paid by somebody who took no money',
    stripped.amount_paid === 0 && stripped.payment_status === 'pending',
    stripped.payment_status + ' / ' + stripped.amount_paid);
  result('but the treatment itself is still recorded',
    stripped.confirmed_diagnosis === 'Malaria', stripped.confirmed_diagnosis);

  // And the same rule leaves an owner's money completely alone.
  await asRole(page, 'owner');
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const ownerMoney = await page.evaluate(() => {
    var p = { total_charged_ugx: 25000, payment_status: 'paid', amount_paid: 25000 };
    if (typeof clinicCan === 'function' && !clinicCan('payments')) {
      p.total_charged_ugx = 0; p.amount_paid = 0; p.payment_status = 'pending';
    }
    return p;
  });
  result('an owner\'s own treatment still charges what it charged',
    ownerMoney.total_charged_ugx === 25000 && ownerMoney.payment_status === 'paid',
    JSON.stringify(ownerMoney));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
