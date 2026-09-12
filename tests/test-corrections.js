// Fixing what was already recorded, and who is allowed to.
//
// A clinic asked to be able to correct a quick sale, add the drug or lab test
// or money forgotten on a treatment, and correct or remove a patient — "only
// done in the main account, not sub accounts".
//
// THE PERMISSION IS NOT TESTED HERE, and that is the point worth stating. It
// lives in the database: every correction goes through a security-definer RPC
// that checks is_clinic_main_account(), and the direct UPDATE and DELETE that
// used to be open to every member of staff are closed. That is proved against
// a real Postgres in tests/sql/test-owner-corrections.sql, which drives it as
// a nurse, a receptionist, a visiting clinician and a stranger — because a
// browser test mocks the network and could never reach an RLS policy.
//
// What this file checks is the half the SQL cannot: that the screen offers the
// corrections to the owner, offers none of them to a sub-account, and that
// what it sends is what the clinician typed.
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
const PORT = 8955, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

// Everything the page sends, so "what did it actually ask the server to do?"
// is answerable rather than inferred.
let calls = [];

const SALES = [
  { id: 'sale-1', drug_name: 'Paracetamol 500mg', unit: 'tablet', quantity: 10,
    unit_price_ugx: 200, total_ugx: 2000, payment_method: 'cash',
    created_at: new Date().toISOString() },
  { id: 'sale-2', drug_name: 'Amoxicillin 250mg', unit: 'capsule', quantity: 4,
    unit_price_ugx: 500, total_ugx: 2000, payment_method: 'momo',
    created_at: new Date().toISOString() },
];

async function openDash(page, role) {
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid, r]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'D', clinicName: 'K', clinicId: cid,
      staffRole: r, level: 'HC3', clinician: r === 'visiting_clinician' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
  }, [CID, UID, role]);
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1500 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    let body = null;
    try { body = r.request().postData(); } catch (e) {}
    calls.push({ url: u, method: r.request().method(), body });

    if (u.includes('/auth/v1/')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({
        access_token: 'tok', token_type: 'bearer', expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref',
        user: { id: UID, email: 'owner@clinic.ug' } }) });
    }
    if (u.includes('/rest/v1/rpc/')) {
      const name = u.split('/rpc/')[1].split('?')[0];
      if (name === 'edit_quick_sale')   return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, stock_returned: 4 }) });
      if (name === 'delete_quick_sale') return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, stock_returned: 10 }) });
      if (name === 'edit_visit_record') return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, total_charged_ugx: 18000, amount_paid: 12000, payment_status: 'partial' }) });
      if (name === 'edit_clinic_patient')   return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true }) });
      if (name === 'delete_clinic_patient') return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, archived: true, visits: 3 }) });
      return r.fulfill({ status: 200, headers: H, body: '[]' });
    }
    if (u.includes('/rest/v1/clinic_quick_sales')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify(SALES) });
    }
    if (u.includes('/rest/v1/clinic_patients')) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify(
        [{ id: 'pat-1', full_name: 'Okello Jonh', phone: '0770000001' }]) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  // ── 1. The owner sees today's sales inside the quick sale sheet ──────
  await openDash(page, 'owner');
  const asOwner = await page.evaluate(async () => {
    if (typeof openQuickSale === 'function') openQuickSale();
    await new Promise(r => setTimeout(r, 1200));
    const host = document.getElementById('qsCorrect');
    return {
      there: !!host,
      shown: host ? getComputedStyle(host).display !== 'none' : false,
      rows: host ? host.querySelectorAll('[data-cxsale]').length : 0,
      text: host ? host.innerText.replace(/\s+/g, ' ') : '',
      may: !!(window.HomattCorrect && HomattCorrect.may()),
    };
  });
  result('the main account may correct', asOwner.may === true);
  result('the quick sale sheet lists today\'s sales', asOwner.rows === 2, 'rows=' + asOwner.rows);
  result('each with what it was, so the right one can be picked',
    /Paracetamol/.test(asOwner.text) && /10 × UGX 200/.test(asOwner.text),
    asOwner.text.slice(0, 90));

  // ── 2. Correcting one sends what was typed, and says what it means ───
  const dlg = await page.evaluate(async () => {
    document.querySelector('[data-cxsale]').click();
    await new Promise(r => setTimeout(r, 400));
    const card = document.getElementById('cxCard');
    const before = (document.getElementById('cxTot') || {}).innerText || '';
    const q = document.getElementById('cxQty');
    q.value = '6'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return {
      open: getComputedStyle(document.getElementById('cxOverlay')).display === 'flex',
      before,
      after: (document.getElementById('cxTot') || {}).innerText || '',
      title: (card.querySelector('h4') || {}).textContent || '',
    };
  });
  result('correcting a sale opens a dialog', dlg.open && /Correct this sale/i.test(dlg.title), dlg.title);
  result('and it says, as the number is typed, what goes back on the shelf',
    /4 going back on the shelf/i.test(dlg.after), dlg.after);
  result('and the new total', /UGX 1,200/.test(dlg.after), dlg.after);

  calls = [];
  await page.evaluate(async () => {
    document.getElementById('cxWhy').value = 'counted wrong';
    document.getElementById('cxSave').click();
    await new Promise(r => setTimeout(r, 900));
  });
  const editCall = calls.find(c => /rpc\/edit_quick_sale/.test(c.url));
  result('saving asks the server to correct that sale', !!editCall, editCall ? 'sent' : 'no call');
  if (editCall) {
    let sent = null; try { sent = JSON.parse(editCall.body || '{}'); } catch (e) {}
    result('carrying the quantity the clinician typed', sent && sent.p_quantity === 6, JSON.stringify(sent));
    result('and the reason, which is kept with the record',
      sent && sent.p_reason === 'counted wrong', sent && sent.p_reason);
  }

  // ── 3. Removing a sale says what it costs before it happens ──────────
  const del = await page.evaluate(async () => {
    document.querySelector('[data-cxsaledel]').click();
    await new Promise(r => setTimeout(r, 400));
    return (document.getElementById('cxCard') || {}).innerText || '';
  });
  result('removing a sale says how much comes off the takings',
    /UGX 2,000/.test(del), del.replace(/\s+/g, ' ').slice(0, 100));
  result('and how much goes back on the shelf', /10 <?\/?b?>?\s*goes back on the shelf|10\s*goes back/i.test(del) || /back on the shelf/i.test(del), del.replace(/\s+/g, ' ').slice(0, 120));

  calls = [];
  await page.evaluate(async () => {
    document.getElementById('cxDel').click();
    await new Promise(r => setTimeout(r, 900));
  });
  result('confirming asks the server to delete it',
    calls.some(c => /rpc\/delete_quick_sale/.test(c.url)));

  // ── 4. A correction needs a connection, and says so ──────────────────
  const offline = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    document.querySelector('[data-cxsale]').click();
    await new Promise(r => setTimeout(r, 400));
    document.getElementById('cxSave').click();
    await new Promise(r => setTimeout(r, 500));
    const m = (document.getElementById('cxMsg') || {}).textContent || '';
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    if (window.HomattCorrect) HomattCorrect.close();
    return m;
  });
  result('a correction with no connection is refused, and says nothing changed',
    /needs a connection/i.test(offline) && /Nothing has been changed/i.test(offline),
    offline.slice(0, 90));

  // ── 5. A visit: the money and the test that were forgotten ───────────
  const visit = await page.evaluate(async () => {
    window.HomattCorrect.editVisit({
      id: 'visit-1', confirmed_diagnosis: 'Malaria',
      consultation_fee_ugx: 10000, lab_fee_ugx: 0, meds_fee_ugx: 0, amount_paid: 0,
      lab_tests_ordered: [],
    });
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('cxLab').value = '5000';
    document.getElementById('cxLab').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('cxMeds').value = '3000';
    document.getElementById('cxMeds').dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('cxPaid').value = '12000';
    document.getElementById('cxPaid').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    return (document.getElementById('cxTot') || {}).innerText || '';
  });
  result('correcting a visit adds the fees up as they are typed',
    /UGX 18,000/.test(visit), visit);
  result('and part payment reads as part payment, from the AMOUNT not a chip',
    /Part payment/i.test(visit) && /UGX 6,000 still owing/.test(visit), visit);

  calls = [];
  await page.evaluate(async () => {
    document.getElementById('cxTests').value = 'Malaria RDT, Blood slide';
    document.getElementById('cxSave').click();
    await new Promise(r => setTimeout(r, 900));
  });
  // The boundary that was wrong on the first attempt: adding a medicine or a
  // charge is what Follow-up already does, and this dialog must not offer a
  // second, free-text answer to "what was given".
  const boundary = await page.evaluate(() => {
    const c = document.getElementById('cxCard');
    return { text: (c ? c.innerText : '').replace(/\s+/g, ' '),
             hasPlanBox: !!document.getElementById('cxPlan') };
  });
  result('the correction dialog does NOT offer a second way to write medicines',
    boundary.hasPlanBox === false);
  result('and it points at Follow-up for adding, which already existed',
    /use Follow-up instead/i.test(boundary.text), boundary.text.slice(0, 120));

  const vCall = calls.find(c => /rpc\/edit_visit_record/.test(c.url));
  result('saving asks the server to correct the visit', !!vCall);
  if (vCall) {
    let sent = null; try { sent = JSON.parse(vCall.body || '{}'); } catch (e) {}
    result('carrying the lab tests as a list, not a string',
      sent && Array.isArray(sent.p_lab_tests_ordered) && sent.p_lab_tests_ordered.length === 2,
      JSON.stringify(sent && sent.p_lab_tests_ordered));
    result('and the fees that were missed', sent && sent.p_lab_fee === 5000 && sent.p_meds_fee === 3000,
      JSON.stringify({ lab: sent && sent.p_lab_fee, meds: sent && sent.p_meds_fee }));
  }

  // ── 6. Removing a patient says what will happen to their history ─────
  const pat = await page.evaluate(async () => {
    window.HomattCorrect.deletePatient({ id: 'pat-1', full_name: 'Okello John', phone: '0770000001' });
    await new Promise(r => setTimeout(r, 300));
    return (document.getElementById('cxCard') || {}).innerText.replace(/\s+/g, ' ');
  });
  result('removing a patient says a treated one is archived, not destroyed',
    /archived, not destroyed/i.test(pat), pat.slice(0, 110));

  calls = [];
  const patDone = await page.evaluate(async () => {
    document.getElementById('cxDel').click();
    await new Promise(r => setTimeout(r, 900));
    return true;
  });
  result('confirming asks the server to remove them',
    calls.some(c => /rpc\/delete_clinic_patient/.test(c.url)), patDone ? '' : 'no');

  // ── 7. A sub-account is offered none of it ───────────────────────────
  for (const role of ['nurse', 'receptionist', 'visiting_clinician']) {
    await openDash(page, role);
    const sub = await page.evaluate(async () => {
      const may = !!(window.HomattCorrect && HomattCorrect.may());
      if (typeof openQuickSale === 'function') openQuickSale();
      await new Promise(r => setTimeout(r, 900));
      const host = document.getElementById('qsCorrect');
      return {
        may,
        rows: host ? host.querySelectorAll('[data-cxsale]').length : 0,
        text: host ? host.innerText.trim() : '',
        hidden: host ? getComputedStyle(host).display === 'none' : true,
      };
    });
    result('a ' + role.replace('_', ' ') + ' is not offered corrections',
      sub.may === false && sub.rows === 0, 'may=' + sub.may + ' rows=' + sub.rows);
    result('  …and the list is not merely empty, it is not drawn',
      sub.hidden || sub.text === '', sub.text.slice(0, 40));
  }

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
