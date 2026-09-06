// The New Treatment intake, in a real browser.
//
// The important one is PARITY: the suggestion engine was tuned and measured in
// Python against the real databases; this checks the JavaScript on the page
// gives the SAME answers. Without that, the 98%/94% measured during tuning
// says nothing about what a nurse actually sees.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const { execSync } = require('child_process');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    rs.end(d);
  });
});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';

const CASES = [
  { want:'Malaria',       chief:'fever headache', subj:'joint pain and vomiting for 2 days', v:{temp:'39.2'} },
  { want:'Pneumonia',     chief:'cough fever',    subj:'fast breathing and chest indrawing', v:{temp:'38.6',pulse:'130'} },
  { want:'Meningitis',    chief:'severe headache',subj:'neck stiffness and vomiting, confused', v:{temp:'39.5'} },
  { want:'Tuberculosis',  chief:'cough for 3 weeks', subj:'night sweats and weight loss', v:{temp:'37.9'} },
  { want:'Urinary tract infection', chief:'burning when passing urine', subj:'frequency and lower abdominal pain', v:{} },
  { want:'Asthma',        chief:'wheezing',       subj:'difficulty breathing at night, recurrent', v:{} },
];

// What the tuned Python says for the same inputs — the reference to match.
const PY = JSON.parse(execSync(`python3 - <<'PY'
import sys,json
sys.path.insert(0,'/tmp/claude-0/-home-user-homatt-uganda/f3451427-e03d-514d-8f41-e3e6f96e4176/scratchpad/impr')
from engine2 import Index
IX=Index()
cases=${JSON.stringify(CASES)}
out=[]
for c in cases:
    v={k:float(x) for k,x in c['v'].items() if x}
    r=IX.suggest(c['chief'],c['subj'],'',v,3)
    out.append([x['title'] for x in r])
print(json.dumps(out))
PY`).toString());

(async () => {
  await new Promise(r => server.listen(8993, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 950 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:8993')) return r.continue();
    if (u.startsWith(SB)) {
      // One patient who never paid, so the alert has something real to find.
      const body = /clinic_diagnoses/.test(u)
        ? JSON.stringify([{ patient_name:'Okello John', patient_phone:'0771234567',
            total_charged_ugx:25000, amount_paid:0, created_at:'2026-08-12T09:00:00Z',
            case_code:'HC-0042' }])
        : '[]';
      return r.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body });
    }
    return r.abort();
  });

  await page.goto('http://localhost:8993/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName:'D', clinicName:'K', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token:'t', refresh_token:'r', token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{id:uid} }));
  }, [CID, UID]);

  await page.goto('http://localhost:8993/clinic/new-order.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#itTab1', { timeout: 15000 });

  // 1. The name is the first thing on the screen.
  const order = await page.evaluate(() => {
    const y = id => { const e = document.getElementById(id); return e ? e.getBoundingClientRect().top + window.scrollY : 1e9; };
    const x = id => { const e = document.getElementById(id); return e ? e.getBoundingClientRect().left : 1e9; };
    return { name:y('quickPatientName'), tab1:y('itTab1'),
             x1:x('itTab1'), x2:x('itTab2'), x3:x('itTab3'),
             imp:y('itImpression'), dx:y('confirmedDx'), tap:y('ucgOneTap') };
  });
  result('the name and phone come before everything else',
    order.name < order.tab1 && order.tab1 < order.imp, JSON.stringify(order));
  result('complaint, then vitals, then background — in that order',
    order.x1 < order.x2 && order.x2 < order.x3, JSON.stringify([order.x1,order.x2,order.x3]));
  result('suggestions sit above the diagnosis box and the package',
    order.imp < order.dx && order.dx < order.tap, '');

  // 2. Tabs open on click and only one pane shows.
  const tabs = [];
  for (const n of ['1','2','3']) {
    await page.click('#itTab' + n);
    tabs.push(await page.evaluate(() => ['1','2','3'].map(k =>
      getComputedStyle(document.getElementById('itPane'+k)).display === 'block' ? k : '').join('')));
  }
  result('each tab opens its own pane, one at a time',
    tabs.join(',') === '1,2,3', tabs.join(','));

  // 3. Vitals are dedicated micro-inputs, and an abnormal one shows as abnormal.
  await page.click('#itTab2');
  await page.fill('#itTemp', '40.2');
  await page.fill('#itPulse', '132');
  await page.waitForTimeout(400);
  const vit = await page.evaluate(() => ({
    fields: ['itSbp','itDbp','itTemp','itWeight','itPulse'].every(i => !!document.getElementById(i)),
    tempRed: document.getElementById('itTemp').classList.contains('out'),
    pulseRed: document.getElementById('itPulse').classList.contains('out'),
    tabAlert: document.getElementById('itTab2').classList.contains('alert'),
  }));
  result('BP, temperature, weight and pulse each have their own box',
    vit.fields, '');
  result('a reading outside the normal range is shown as abnormal',
    vit.tempRed && vit.pulseRed && vit.tabAlert, JSON.stringify(vit));

  // 4. Hyperpyrexia is called out in words, not just colour.
  await page.click('#itTab1');
  await page.fill('#itChief', 'fever');
  await page.waitForTimeout(1200);
  const flag = await page.textContent('#itImpression').catch(() => '');
  result('a very high temperature is spelled out as a danger sign',
    /hyperpyrexia/i.test(flag) || /very high fever/i.test(flag), (flag||'').slice(0,80).replace(/\s+/g,' '));

  // 5. PARITY — the browser must agree with the tuned engine.
  let same = 0;
  const seen = [];
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    await page.click('#itTab2');
    for (const [k, id] of [['temp','itTemp'],['pulse','itPulse'],['sbp','itSbp'],['dbp','itDbp']]) {
      await page.fill('#' + id, c.v[k] || '');
    }
    await page.click('#itTab1');
    await page.fill('#itChief', c.chief);
    await page.fill('#itSubjective', c.subj);
    await page.waitForTimeout(900);
    const titles = await page.evaluate(() =>
      [...document.querySelectorAll('#itImpression .it-dx-name')].map(e => e.textContent.trim()));
    seen.push(titles);
    if (JSON.stringify(titles) === JSON.stringify(PY[i])) same++;
  }
  result('the browser gives the same suggestions as the tuned engine',
    same === CASES.length, same + '/' + CASES.length +
    (same === CASES.length ? '' : '  browser=' + JSON.stringify(seen[seen.findIndex((t,i)=>JSON.stringify(t)!==JSON.stringify(PY[i]))]) +
     ' python=' + JSON.stringify(PY[seen.findIndex((t,i)=>JSON.stringify(t)!==JSON.stringify(PY[i]))])));

  const found = seen.map((t, i) => t.some(x => x.toLowerCase().includes(CASES[i].want.toLowerCase().split(' ')[0]))).filter(Boolean).length;
  result('the expected condition is offered for realistic presentations',
    found >= CASES.length - 1, found + '/' + CASES.length);

  // 6. Every suggestion shows its evidence, its book, and the tests.
  const card = await page.evaluate(() => {
    const d = document.querySelector('#itImpression .it-dx');
    if (!d) return null;
    return {
      pct: (d.querySelector('.it-dx-pct') || {}).textContent || '',
      labels: [...d.querySelectorAll('.it-lbl')].map(e => e.textContent.trim()),
      srcs: [...d.querySelectorAll('.it-ev.src')].map(e => e.textContent.trim()),
      tests: [...d.querySelectorAll('.it-ev.test')].map(e => e.textContent.trim()),
      pick: !!d.querySelector('.it-pick'),
      note: (document.querySelector('.it-imp-note') || {}).textContent || '',
    };
  });
  result('each suggestion says what pointed to it and which book it came from',
    !!card && card.labels.some(l => /because you wrote/i.test(l)) && card.srcs.length > 0,
    card ? card.srcs.join(' | ') : 'no card');
  const noTestNote = await page.evaluate(() =>
    (document.querySelector('#itImpression .it-dx .it-note') || {}).textContent || '');
  result('when the book names no test it says so, instead of inventing one',
    !!card && (card.tests.length > 0 || noTestNote.length > 0),
    card.tests.length ? card.tests.join(', ') : 'note: ' + noTestNote.slice(0, 70));

  // A condition the books DO name tests for.
  await page.click('#itTab2');
  await page.fill('#itTemp', '39.2');
  await page.click('#itTab1');
  await page.fill('#itChief', 'fever headache');
  await page.fill('#itSubjective', 'joint pain and vomiting for 2 days');
  await page.waitForTimeout(900);
  const withTests = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#itImpression .it-dx')];
    const all = cards.map(d => ({ name: (d.querySelector('.it-dx-name')||{}).textContent||'',
      tests: [...d.querySelectorAll('.it-ev.test')].map(e => e.textContent.trim()) }));
    return all;
  });
  result('the tests that would confirm it are listed where the book names them',
    withTests.some(c => c.tests.length > 0),
    withTests.map(c => c.name + ': ' + (c.tests.join(', ') || '—')).join('  |  '));
  result('the screen says the figure is a match, not a probability',
    !!card && /not a diagnosis/i.test(card.note) && /not a chance of having it/i.test(card.note),
    (card && card.note || '').slice(0, 90).replace(/\s+/g, ' '));

  // 7. Confirming one fills the diagnosis and hands over to the package.
  const picked = await page.evaluate(() => document.querySelector('#itImpression .it-dx-name').textContent.trim());
  await page.click('#itImpression .it-pick');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    dx: document.getElementById('confirmedDx').value,
    labs: (window._wizState && window._wizState.labTests) || [],
  }));
  result('confirming a suggestion sets the diagnosis for the package',
    after.dx === picked, 'dx="' + after.dx + '" picked="' + picked + '"');
  const proseLike = after.labs.filter(t => /^(is |diagnosis|specialised|the |a |consider|depend)/i.test(t) || t.length > 60);
  result('only real, named tests are ordered — never a sentence from the book',
    proseLike.length === 0, proseLike.join(' | ') || 'ordered: ' + after.labs.join(', '));

  // 8. Everything typed is kept on the record.
  await page.click('#itTab2');
  await page.fill('#itTemp', '38.4');
  await page.fill('#itWeight', '62');
  await page.click('#itTab3');
  await page.fill('#itBackground', 'Known diabetic on metformin. Mother had TB.');
  await page.waitForTimeout(400);
  const rec = await page.evaluate(() => window._intakeSummary());
  result('complaint, history, vitals and background all reach the record',
    /Chief complaint:/.test(rec) && /History:/.test(rec) && /Vitals:/.test(rec) &&
    /Temp/.test(rec) && /Background:/.test(rec) && /diabetic/.test(rec),
    JSON.stringify(rec).slice(0, 150));

  // 8b. A patient who still owes is flagged right where the name is typed.
  await page.fill('#quickPatientName', 'Okello');
  await page.waitForTimeout(1400);
  const debt = await page.evaluate(() => {
    const d = document.getElementById('itDebt');
    return { shown: d && getComputedStyle(d).display !== 'none', text: (d||{}).textContent || '' };
  });
  result('a patient who still owes is flagged beside the name',
    debt.shown && /25,000/.test(debt.text), debt.text.slice(0, 110).replace(/\s+/g,' '));

  await page.fill('#quickPatientName', 'Nakato Grace');
  await page.waitForTimeout(1000);
  const clear = await page.evaluate(() => {
    const d = document.getElementById('itDebt');
    return d ? getComputedStyle(d).display === 'none' : true;
  });
  result('a patient who owes nothing is not accused of owing', clear, '');

  // 9. Nothing is compulsory.
  const blocked = await page.evaluate(() => {
    const n = document.getElementById('wizNext1') || document.querySelector('[data-next="1"]');
    return n ? n.disabled : null;
  });
  result('a diagnosis typed by hand still works — nothing above is required',
    blocked === false || blocked === null, 'nextDisabled=' + blocked);

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'intake.png', fullPage: true });
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
