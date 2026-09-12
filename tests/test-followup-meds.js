// Adding a medicine on a follow-up visit: suggested, dosed, and on the screen.
//
// Two reports, one modal.
//
//   1. The frequency was OFF THE EDGE OF THE CARD. In the photograph that
//      arrived, "2×" hung outside the medication card, clipped by the phone.
//      The strength box and the frequency select were flex:1 with no
//      min-width:0, and .field-input carries `font-size:16px !important`, so
//      the select's own content set a floor wider than its share and pushed
//      itself out.
//
//   2. There was no suggestion and no dose. Three empty boxes, on the one
//      screen where a clinician is adding a medicine to somebody already
//      diagnosed — while the treatment screen has known these regimens since
//      it was written.
//
// The doses come from js/clinic-regimens.js, which the treatment screen now
// reads too. One table: two screens cannot drift into prescribing different
// doses for the same drug.
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
const PORT = 8956, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

// Open the follow-up form for a patient of a given age, and return the modal.
async function openFollowup(page, age) {
  return page.evaluate(async (a) => {
    window._activeDetailContext = {
      current: {
        id: 'visit-1', patient_name: 'Ssali', patient_phone: '0778000',
        confirmed_diagnosis: 'Malaria', severity: 'moderate',
        patient_age: a, created_at: new Date().toISOString(),
        total_charged_ugx: 30000, amount_paid: 8000, payment_status: 'partial',
        prescription_items: [], lab_tests_ordered: [],
      },
      history: [],
    };
    // The shelf Quick Sale would have loaded.
    window._qsDrugs = [
      { id: 'i1', item_name: 'Amoxicillin 250mg caps', unit: 'capsule', quantity: 40 },
      { id: 'i2', item_name: 'Amoxil syrup', unit: 'bottle', quantity: 6 },
    ];
    /* The modal must be VISIBLE before anything is measured.
     *
     * showFollowupForm() renders into histModalBody, but #histModal starts at
     * display:none — so every getBoundingClientRect() came back zero, and the
     * check "no field is outside the card" passed because nothing had a size
     * at all. A metric the layout satisfies by being invisible is worse than
     * no metric: it reports the fault fixed. The width assertion beside it is
     * what caught this. */
    const modal = document.getElementById('histModal');
    if (modal) modal.style.display = 'flex';
    if (typeof showFollowupForm === 'function') showFollowupForm();
    await new Promise(r => setTimeout(r, 600));
    return true;
  }, age);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  // 360px: the narrow phone the layout fault showed on.
  const page = await (await b.newContext({ viewport: { width: 360, height: 780 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'D', clinicName: 'K', clinicId: cid, staffRole: 'owner', level: 'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
  }, [CID, UID]);
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);

  // ── 0. One table, shared ─────────────────────────────────────────────
  const shared = await page.evaluate(() => ({
    there: !!window.HomattRegimens,
    n: window.HomattRegimens ? window.HomattRegimens.all.length : 0,
  }));
  result('the dose table is loaded, and shared with the treatment screen',
    shared.there && shared.n > 20, shared.n + ' regimens');

  // ── 1. The layout fault, measured at 360px ───────────────────────────
  await openFollowup(page, 30);
  const box = await page.evaluate(() => {
    const row = document.querySelector('.fu-dmed-row');
    if (!row) return { there: false };
    const r = row.getBoundingClientRect();
    const kids = [...row.querySelectorAll('input, select')].map(el => {
      const k = el.getBoundingClientRect();
      return { cls: el.className.split(' ')[0], over: Math.round(k.right - r.right),
               under: Math.round(r.left - k.left), w: Math.round(k.width) };
    });
    return { there: true, rowW: Math.round(r.width), kids };
  });
  result('the medication card is there', box.there === true);
  const outside = (box.kids || []).filter(k => k.over > 1 || k.under > 1);
  result('every field is INSIDE the card at 360px — the "2×" fault',
    outside.length === 0,
    outside.length ? JSON.stringify(outside) : (box.kids || []).length + ' fields, none over');
  result('and none of them is a sliver too narrow to use',
    (box.kids || []).every(k => k.w >= 60), JSON.stringify((box.kids || []).map(k => k.w)));

  // ── 2. Typing suggests, from the shelf first ─────────────────────────
  const sug = await page.evaluate(async () => {
    const inp = document.querySelector('.fu-med-name');
    inp.value = 'amox';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const menu = document.querySelector('.fu-ac');
    return {
      open: menu && getComputedStyle(menu).display !== 'none',
      heads: [...menu.querySelectorAll('.fu-ac-head')].map(e => e.textContent),
      items: [...menu.querySelectorAll('.fu-ac-item')].map(e => e.innerText.replace(/\s+/g, ' ')),
      stockFirst: menu.querySelector('.fu-ac-item') &&
                  menu.querySelector('.fu-ac-item').hasAttribute('data-stock'),
    };
  });
  result('typing three letters suggests something', sug.open === true);
  result('the clinic\'s own shelf comes first — it can be given today',
    sug.stockFirst === true && /shelf/i.test((sug.heads || []).join(' ')),
    (sug.heads || []).join(' | '));
  result('and the common medicines after it',
    (sug.heads || []).length === 2 && /common/i.test(sug.heads[1]), (sug.heads || []).join(' | '));
  result('with the quantity on the shelf, so a clinician knows before promising',
    /40 capsule/.test((sug.items || []).join(' ')), (sug.items || [])[0]);

  // ── 3. Picking one fills the dose — for an ADULT ─────────────────────
  const adult = await page.evaluate(async () => {
    const el = document.querySelector('.fu-ac-item[data-reg]');
    if (!el) return { picked: false };
    el.click();
    await new Promise(r => setTimeout(r, 250));
    const row = document.querySelector('.fu-dmed-row');
    return {
      picked: true,
      name: row.querySelector('.fu-med-name').value,
      strength: row.querySelector('.fu-med-strength').value,
      freq: row.querySelector('.fu-med-freq').value,
      days: row.querySelector('.fu-med-days').value,
      note: (row.querySelector('.fu-med-note') || {}).textContent || '',
    };
  });
  result('picking a medicine fills its dose', adult.picked && !!adult.strength,
    JSON.stringify({ n: adult.name, s: adult.strength, f: adult.freq, d: adult.days }));
  result('the frequency and duration too', adult.freq === '3' && adult.days === '5',
    adult.freq + '× for ' + adult.days + ' days');
  result('and it says where the figure came from', /from the adult dose/i.test(adult.note),
    adult.note.slice(0, 80));

  // ── 4. A CHILD does not silently get the adult dose ──────────────────
  await openFollowup(page, 4);
  const child = await page.evaluate(async () => {
    const inp = document.querySelector('.fu-med-name');
    inp.value = 'amoxicillin';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const el = document.querySelector('.fu-ac-item[data-reg]');
    if (el) el.click();
    await new Promise(r => setTimeout(r, 250));
    const row = document.querySelector('.fu-dmed-row');
    return { strength: row.querySelector('.fu-med-strength').value,
             note: (row.querySelector('.fu-med-note') || {}).textContent || '' };
  });
  result('a four-year-old gets the CHILD dose, not the adult one',
    /mg\/kg/.test(child.strength), child.strength);
  result('and is told it is by weight', /by weight/i.test(child.note), child.note.slice(0, 90));

  // A drug the table has no child figure for must SAY so, not hand over the
  // adult dose quietly. Ciprofloxacin has an adult entry only.
  const fallback = await page.evaluate(async () => {
    const inp = document.querySelector('.fu-med-name');
    inp.value = 'ciprofloxacin';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const el = document.querySelector('.fu-ac-item[data-reg]');
    if (el) el.click();
    await new Promise(r => setTimeout(r, 250));
    const row = document.querySelector('.fu-dmed-row');
    const note = row.querySelector('.fu-med-note');
    return { note: note ? note.textContent : '',
             colour: note ? getComputedStyle(note).color : '' };
  });
  result('where the guide has no dose for this age, the card SAYS it is the adult one',
    /adult dose/i.test(fallback.note) && /check it before/i.test(fallback.note),
    fallback.note.slice(0, 100));

  // ── 5. What is typed is still what is saved ──────────────────────────
  const typed = await page.evaluate(async () => {
    const row = document.querySelector('.fu-dmed-row');
    row.querySelector('.fu-med-strength').value = '250mg';
    row.querySelector('.fu-med-days').value = '7';
    return { s: row.querySelector('.fu-med-strength').value,
             d: row.querySelector('.fu-med-days').value };
  });
  result('the filled dose is a starting point the clinician can still edit',
    typed.s === '250mg' && typed.d === '7', JSON.stringify(typed));

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
