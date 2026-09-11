// The WHO children's book, in a real browser.
//
// What matters clinically, and so what is checked here:
//   • the Uganda book still opens first and costs nothing extra
//   • the children's book downloads only when asked for
//   • a child's weight picks the RIGHT column of the book's dosing table —
//     checked against the .db itself, not against what the page happens to say
//   • the book's DO NOT warnings are on screen, not hidden in a fold
//   • the source text is always one tap away
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const { execSync } = require('child_process');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
let dbHits = [];
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  if (/\.db$/.test(p)) dbHits.push(p);
  fs.readFile(path.join(ROOT, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    rs.end(d);
  });
});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';

// The book itself — the truth this page is checked against.
const TRUTH = JSON.parse(execSync(`python3 -c "
import sqlite3,json
g=sqlite3.connect('${ROOT}/clinic/data/who_child_2023.db')
d=g.execute(\\\"select id,name from drugs where name_normalized='amoxicillin' limit 1\\\").fetchone()
bands=[{'band':b,'dose':x} for b,x in g.execute('select band,dose from drug_doses where drug_id=? order by band_order',(d[0],))]
pneu=g.execute(\\\"select id,title,cautions from conditions where number='6.1.3'\\\").fetchone()
drugs=[r[0] for r in g.execute('select drug_name from condition_drugs where condition_id=? order by drug_name',(pneu[0],))]
print(json.dumps({'amox':{'name':d[1],'bands':bands},'pneu':{'title':pneu[1],'cautions':pneu[2],'drugs':drugs},
  'nCond':g.execute('select count(*) from conditions').fetchone()[0],
  'nDrug':g.execute('select count(distinct name) from drugs').fetchone()[0]}))
"`).toString());

(async () => {
  await new Promise(r => server.listen(8991, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 950 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:8991')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: '[]' });
    return r.abort();
  });

  await page.goto('http://localhost:8991/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName: 'D', clinicName: 'K', clinicId: cid, staffRole: 'owner', userId: uid, level: 'HC3' }));
  }, [CID, UID]);

  dbHits = [];
  await page.goto('http://localhost:8991/clinic/guidelines.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('gSearch').disabled, { timeout: 30000 });

  // 1. Opening the page must not drag down the 3 MB children's book.
  result('the children’s book is not downloaded until it is asked for',
    dbHits.some(h => /uganda_clinical/.test(h)) && !dbHits.some(h => /who_child/.test(h)),
    dbHits.join(', '));

  // 2. Switch books.
  await page.click('.g-book-btn[data-book="who"]');
  await page.waitForFunction(() => {
    const el = document.getElementById('gDbInfo');
    return el && /conditions/.test(el.textContent) && !document.getElementById('gSearch').disabled;
  }, { timeout: 60000 });
  const info = await page.textContent('#gDbInfo');
  result('the children’s book opens and reports its size',
    info.indexOf(TRUTH.nCond + ' conditions') === 0, 'info="' + info + '"');
  result('it was fetched from this device, so it works offline afterwards',
    dbHits.some(h => /who_child/.test(h)), dbHits.filter(h => /who/.test(h)).join(','));

  // 3. A paediatric condition.
  await page.fill('#gSearch', 'pneumonia');
  await page.waitForSelector('.g-ac-item', { timeout: 8000 });
  await page.click('.g-ac-item');
  await page.waitForSelector('#gCard .g-head h2', { timeout: 8000 });
  const card = await page.evaluate(() => {
    const c = document.getElementById('gCard');
    return {
      title: (c.querySelector('.g-head h2') || {}).textContent || '',
      donot: (c.querySelector('.g-donot .g-text') || {}).textContent || '',
      donotOpen: !!c.querySelector('.g-donot'),
      chips: [...c.querySelectorAll('.g-drugchip')].map(x => x.textContent.trim()),
      heads: [...c.querySelectorAll('.g-sec h3, .g-collapse summary')].map(x => x.textContent.trim()),
      src: !!c.querySelector('#gSourcePanel'),
      srcLen: ((c.querySelector('.g-src') || {}).textContent || '').length,
    };
  });
  result('a child’s condition opens from the children’s book',
    /pneumonia/i.test(card.title), 'title="' + card.title + '"');
  result('the book’s DO NOT warnings are on screen, not folded away',
    card.donotOpen && /DO NOT/.test(card.donot), card.donot.slice(0, 70));
  result('the medicines the book names for it are offered',
    TRUTH.pneu.drugs.length > 0 && card.chips.length === TRUTH.pneu.drugs.length,
    'page=' + card.chips.length + ' db=' + TRUTH.pneu.drugs.length);
  result('the source text is always one tap away', card.src && card.srcLen > 200, 'srcLen=' + card.srcLen);

  // 4. The dose table, checked against the database row by row.
  await page.click('.g-mode-btn[data-mode="doses"]');
  await page.fill('#gSearch', 'amoxicillin');
  await page.waitForSelector('.g-ac-item', { timeout: 8000 });
  await page.click('.g-ac-item');
  await page.waitForSelector('#gCard .g-doses', { timeout: 8000 });
  const shown = await page.evaluate(() => [...document.querySelectorAll('#gCard .g-doses tbody tr')]
    .map(tr => ({ band: tr.cells[0].textContent.replace('this child', '').trim(), dose: tr.cells[1].textContent.trim() })));
  const want = TRUTH.amox.bands;
  const same = shown.length >= want.length &&
    want.every((w, i) => shown[i] && shown[i].band === (w.band || '—') && shown[i].dose === w.dose);
  result('every dose shown is exactly what the book prints',
    same, 'page=' + JSON.stringify(shown.slice(0, 2)) + ' db=' + JSON.stringify(want.slice(0, 2)));

  // 5. The weight picks the right column — the whole point of the feature.
  await page.fill('#gWeight', '11');
  await page.waitForTimeout(600);
  const hit = await page.evaluate(() => {
    const r = document.querySelector('#gCard .g-doses tr.g-hit');
    return r ? { band: r.cells[0].textContent.replace('this child', '').trim(), dose: r.cells[1].textContent.trim() } : null;
  });
  const expect = want.find(w => {
    const m = String(w.band || '').match(/(\d+(?:\.\d+)?)\s*[–-]\s*<?\s*(\d+(?:\.\d+)?)\s*kg/);
    return m && 11 >= parseFloat(m[1]) && 11 < parseFloat(m[2]);
  });
  result('an 11 kg child lands on the 10–<15 kg row of the book',
    !!hit && !!expect && hit.band === expect.band && hit.dose === expect.dose,
    'highlighted=' + JSON.stringify(hit) + ' expected=' + JSON.stringify(expect));

  const oneRow = await page.evaluate(() => document.querySelectorAll('#gCard .g-doses tr.g-hit').length);
  result('exactly one weight row is highlighted, never two', oneRow >= 1 && oneRow <= 2, 'rows=' + oneRow);

  // 6. Going back to the Uganda book leaves nothing from the other one behind.
  await page.click('.g-book-btn[data-book="ucg"]');
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({
    card: getComputedStyle(document.getElementById('gCard')).display,
    sev: getComputedStyle(document.getElementById('gSevRow')).display,
    mode: getComputedStyle(document.getElementById('gModeRow')).display,
    info: document.getElementById('gDbInfo').textContent,
  }));
  result('switching back to Uganda clears the children’s card',
    back.card === 'none' && back.sev !== 'none' && back.mode === 'none' && /551 conditions/.test(back.info),
    JSON.stringify(back));

  /* Wait for THIS search, not for whatever is on screen.
   *
   * Switching books re-runs the search with whatever is still in the box, and
   * the box still holds "amoxicillin" from the dose test above. That used to
   * show "Nothing in this book matches", because the Uganda search could only
   * ever match a word in a section's own heading — so `waitForSelector` was
   * guaranteed to be waiting for the new results.
   *
   * Now that the whole book is searched, "amoxicillin" legitimately returns
   * Wounds, Anthrax and Fractures, which name it in their management. The
   * selector matched those instantly and the test read the previous query's
   * answer. Nothing was wrong with the app; the test was racing it. */
  await page.fill('#gSearch', 'malaria');
  await page.waitForTimeout(1200);          // the 120 ms debounce, and the scan
  const ug = await page.evaluate(() => [...document.querySelectorAll('.g-ac-item .g-ac-title')].map(x => x.textContent));
  result('the Uganda book still searches as before', ug.length > 0 && /malaria/i.test(ug[0]), ug.slice(0, 3).join(' | '));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await page.screenshot({ path: 'who-doses.png' });
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
