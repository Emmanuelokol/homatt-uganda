// Typing a name, and being told what the clinic already knows.
//
// Until now the name box on the intake screen did NOTHING. `quickPatientName`
// had one listener, `_syncQuickPatient`, which copied the text into state and
// stopped. The only patient search in the wizard is bound to the PHONE box,
// returns a name and a phone and nothing else, and the money and the history
// are only fetched once somebody has been picked from it.
//
// So a clinic could treat the same person a fourth time, with two unpaid
// visits behind them, and nothing on the screen said so until the bill was
// already being written.
//
// The arithmetic is driven here without a browser; test-intake.js and the
// suite cover the screen. What matters most in this file:
//
//   • ONE PERSON, NOT ONE ROW PER VISIT. +256772004455 and 0772004455 are the
//     same man, and his debt is the sum of his visits.
//   • AN OVER-PAYMENT ON ONE VISIT DOES NOT CANCEL A DEBT ON ANOTHER. Netting
//     them off hides both — the change owed and the money owing.
//   • IT OFFERS, IT NEVER FILLS. Nothing reaches a box without a tap.
const path = require('path');
const fs = require('fs');

let pass = 0, fail = 0;
function ok(name, cond, got) {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  — ' + JSON.stringify(got))); }
}
function eq(name, got, want) { ok(name, got === want, got); }

global.window = global.window || {};
new Function(fs.readFileSync(
  path.join(__dirname, '..', 'app', 'clinic', 'js', 'clinic-whois.js'), 'utf8')).call(global);
const W = global.window.HomattWhoIs;

ok('the module loads', !!W && typeof W.attach === 'function');

const DAY = 86400000;
const now = Date.now();
const V = (name, phone, dx, charged, paid, daysAgo) => ({
  patient_name: name, patient_phone: phone, confirmed_diagnosis: dx,
  total_charged_ugx: charged, amount_paid: paid,
  created_at: new Date(now - daysAgo * DAY).toISOString(),
});

// ── 1. One row per person ────────────────────────────────────────────────
const ROWS = [
  V('Okello John',  '0772004455',    'Malaria',   60000, 20000, 3),
  V('Okello  John', '+256772004455', 'Pneumonia', 30000, 30000, 40),
  V('okello john',  '772004455',     'URTI',      15000,     0, 120),
  V('Achieng Mary', '0700111222',    'Typhoid',   20000, 20000, 1),
];
const g = W._group(ROWS);
eq('three spellings and three phone formats are ONE person', g.length, 2);

const john = g.filter(x => /okello/i.test(x.name))[0];
eq('his visits are counted together', john.visits, 3);
eq('and his debt is the sum of them', john.owed, 40000 + 0 + 15000);
ok('the most recent visit is the one reported',
  /Malaria/.test(john.lastDx), john.lastDx);
eq('the name is tidied, not echoed back with its own typo', john.name, 'Okello John');
ok('a phone is kept even when one of the rows had none', !!john.phone, john.phone);

// ── 2. Phone forms are one key ───────────────────────────────────────────
eq('+256 form', W._normPhone('+256772004455'), '772004455');
eq('0 form',    W._normPhone('0772004455'), '772004455');
eq('bare form', W._normPhone('772004455'), '772004455');
eq('too short to be a line is not a key', W._normPhone('4455'), '');
eq('nothing is not a key', W._normPhone(''), '');

// ── 3. AN OVER-PAYMENT MUST NOT CANCEL A DEBT ────────────────────────────
//
// The clinic's real figures have visits where more was received than charged.
// Netting that against another visit's debt would report a patient as square
// when the clinic is both owed money AND owes change — hiding two facts with
// one subtraction.
const OVER = W._group([
  V('Nakato Sarah', '0788000111', 'Malaria', 10000, 20000, 5),   // 10,000 over
  V('Nakato Sarah', '0788000111', 'URTI',    30000,  5000, 2),   // 25,000 owing
]);
eq('the over-payment and the debt are one person', OVER.length, 1);
eq('the debt is reported in full, not netted down to 15,000', OVER[0].owed, 25000);
eq('and what was charged across both is kept', OVER[0].charged, 40000);
eq('and what was received across both is kept', OVER[0].paid, 25000);

// ── 4. Matching the way a clinic types ───────────────────────────────────
const j = john;
ok('part of a surname finds him',            W._matches(j, 'okel'));
ok('the whole name finds him',               W._matches(j, 'Okello John'));
ok('REVERSED, which is how half of Uganda writes it', W._matches(j, 'john okello'));
ok('different case finds him',               W._matches(j, 'OKELLO'));
ok('extra spaces do not stop it',            W._matches(j, '  okello   john '));
ok('somebody else does not match',           !W._matches(j, 'achieng'));
ok('one word of two must still be his',      !W._matches(j, 'okello mary'));
ok('an empty query matches nobody',          !W._matches(j, ''));

// ── 5. "When did they last come" in words a clinician uses ───────────────
eq('today',        W._ago(now - 0), 'today');
eq('yesterday',    W._ago(now - 1 * DAY), 'yesterday');
eq('this week',    W._ago(now - 4 * DAY), '4 days ago');
eq('last month',   W._ago(now - 35 * DAY), 'last month');
eq('a few months', W._ago(now - 120 * DAY), '4 months ago');
eq('a year',       W._ago(now - 400 * DAY), 'a year ago');
eq('nothing recorded says nothing', W._ago(null), '');

// ── 6. It never throws on what a clinic's records actually contain ───────
ok('rows with missing everything do not throw', (function () {
  const junk = [
    {}, { patient_name: '' }, { patient_phone: '' },
    { patient_name: 'A', created_at: 'not a date' },
    { patient_name: 'B', total_charged_ugx: 'x', amount_paid: null },
    { patient_name: null, patient_phone: null },
  ];
  try {
    const out = W._group(junk);
    // A row with no name and no phone has no key, so it is not a person.
    if (out.some(x => !x.name)) return false;
    out.forEach(x => W._matches(x, 'a'));
    return true;
  } catch (e) { console.log('    threw: ' + e.message); return false; }
})());

eq('a row with neither a name nor a phone is not a person',
  W._group([{ total_charged_ugx: 5000 }]).length, 0);

// ── 7. On the real screen ────────────────────────────────────────────────
//
// The arithmetic above is worth nothing if the box never calls it. This drives
// the actual intake screen: type a name, wait, and check the clinic's own
// records come back with the money on them — and that NOTHING is filled in
// until a row is tapped.
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http');
const APP = path.join(__dirname, '..', 'app');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.db': 'application/octet-stream' };
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});
const PORT = 8971, ORIGIN = 'http://localhost:' + PORT;
const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message)));

  let asked = 0; const askedUrls = [];
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (/\/rest\/v1\/clinic_diagnoses/.test(u) && /patient_name/.test(u)) {
      asked++;
      askedUrls.push(decodeURIComponent(u).slice(0, 200));
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify(ROWS) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ userId: uid, staffName: 'D. Musinguzi',
      clinicName: 'family clinic', clinicId: cid, staffRole: 'owner', level: 'HC III' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token: 't', refresh_token: 'r',
      token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
  }, [CID, UID]);
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  ok('the module reaches the intake screen',
    await page.evaluate(() => !!window.HomattWhoIs));

  // Opening the screen must cost NOTHING. The first keystroke pays for the
  // one fetch; a query per keystroke on a Ugandan connection is the clinic's
  // money and the clinician's time.
  eq('opening the screen asks the server nothing', asked, 0);

  const typed = await page.evaluate(async (rows) => {
    // Seed rather than rely on the route, so this checks the SCREEN rather
    // than the network mock. The fetch path is checked by `asked` below.
    window.HomattWhoIs._seed(rows);
    const box = document.getElementById('quickPatientName');
    box.value = 'okello';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    const list = document.getElementById('whoList');
    return {
      open: !!list && list.className === 'on',
      text: list ? list.innerText.replace(/\s+/g, ' ') : '',
      rows: list ? list.querySelectorAll('.who-row').length : 0,
      owedBadges: list ? list.querySelectorAll('.who-owed').length : 0,
      nameStillTyped: box.value,
      phoneUntouched: document.getElementById('quickPatientPhone').value,
    };
  }, ROWS);

  ok('typing a name opens the list', typed.open === true);
  ok('it finds the person', /Okello John/.test(typed.text), typed.text.slice(0, 140));
  ok('IT SAYS WHAT THEY OWE', /55,000/.test(typed.text) && typed.owedBadges === 1,
    typed.text.slice(0, 160));
  ok('...and when they were last seen, and for what',
    /Last seen 3 days ago/.test(typed.text) && /Malaria/.test(typed.text), typed.text.slice(0, 200));
  ok('...and how many times they have been', /3 visits/.test(typed.text), typed.text.slice(0, 200));
  ok('NOTHING is filled in by the search itself',
    typed.nameStillTyped === 'okello' && typed.phoneUntouched === '',
    JSON.stringify([typed.nameStillTyped, typed.phoneUntouched]));

  const picked = await page.evaluate(async () => {
    document.querySelector('#whoList .who-row').click();
    await new Promise(r => setTimeout(r, 200));
    return {
      name: document.getElementById('quickPatientName').value,
      phone: document.getElementById('quickPatientPhone').value,
      closed: document.getElementById('whoList').className !== 'on',
    };
  });
  ok('tapping a row fills the name', picked.name === 'Okello John', picked.name);
  ok('...and the phone', /772004455/.test(picked.phone), picked.phone);
  ok('...and closes the list', picked.closed === true);

  // Somebody with nothing owing is shown as settled, not as a blank.
  const clear = await page.evaluate(async () => {
    const box = document.getElementById('quickPatientName');
    box.value = 'achieng';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    const list = document.getElementById('whoList');
    return { owed: list.querySelectorAll('.who-owed').length,
             clear: list.querySelectorAll('.who-clear').length,
             text: list.innerText.replace(/\s+/g, ' ') };
  });
  ok('a patient who owes nothing is marked settled, not left blank',
    clear.owed === 0 && clear.clear === 1, JSON.stringify(clear));

  // One letter is not a search.
  const short = await page.evaluate(async () => {
    const box = document.getElementById('quickPatientName');
    box.value = 'o';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
    return document.getElementById('whoList').className !== 'on';
  });
  ok('one letter opens nothing', short === true);

  // And the fetch really is once, not once per keystroke.
  const fetches = await page.evaluate(async () => {
    window.HomattWhoIs._reset();
    const box = document.getElementById('quickPatientName');
    for (const q of ['ok', 'oke', 'okel', 'okell', 'okello']) {
      box.value = q;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 60));
    }
    await new Promise(r => setTimeout(r, 900));
    return document.getElementById('whoList').className === 'on';
  });
  ok('five keystrokes still find the patient', fetches === true);
  /* ONE query for this data on the whole screen — not one per keystroke, and
   * not one for the unpaid check and a second for the name lookup. The first
   * version of this assertion read 2, and that second request was the point:
   * clinic-intake.js already fetches these 400 rows for the unpaid check and
   * for matching a misheard name. The lookup now reads that fetch. */
  eq('ONE query for this data on the whole screen, shared, not one per keystroke',
     asked, 1);
  if (asked !== 1) askedUrls.forEach((u, i) => console.log('    request ' + (i + 1) + ': ' + u));

  ok('no page error anywhere in that journey', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
