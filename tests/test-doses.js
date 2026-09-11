// A drug must be printed under the heading it is offered for.
//
// The one-tap package reads `medicines WHERE condition_id = ?` and offers
// every row as that condition's drug, with a dose, a tick box and a price. So
// a row filed against the wrong condition is not untidy — it is a prescription
// for somebody else's illness.
//
// Measured over all 1,008 rows (tests/measure-doses.js):
//
//   source line verbatim in its own section : 1008 of 1008
//   dose readable in that line              :  982 of 982
//   MEDICINES PRINTED UNDER ANOTHER HEADING :   28
//
// The first two lines are why this was invisible. Every row IS a real line of
// the book and IS inside the full_text it is filed under — because one section
// in 551 ran past its own end and swallowed six more. That section is
// "9.2.4.1 Postnatal Psychosis": 21,058 characters where its neighbours are
// two or three thousand, absorbing Anxiety, Depression, Postnatal Depression,
// Suicidal Behaviour, Bipolar Disorder and Psychosis.
//
// The consequence: a woman who had just given birth, and is breastfeeding, was
// offered a package built from lithium, carbamazepine, clozapine, alprazolam,
// fluoxetine and bupropion.
//
// Two more sit under a heading the import buried with NO row of its own:
// Oesophageal Varices' propranolol, filed under Hepatic Encephalopathy, and
// Alcohol Use Disorders' thiamine. 28 rows in all, across two sections.
//
// This drives the real guideline screen against the real 4 MB book, and tests
// the boundary finder directly on the cases where it must NOT fire — which is
// the half that matters, because a rule that hides a drug needs a test for
// what it must not hide.
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
const PORT = 8954, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

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

  await page.goto(ORIGIN + '/clinic/guidelines.html', { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const el = document.getElementById('gBrowse');
    return el && el.querySelectorAll('details').length > 0;
  }, { timeout: 60000 }).catch(() => {});

  result('the boundary finder is loaded on the page',
    await page.evaluate(() => !!(window.HomattUcgSections && window.HomattUcgSections.attribute)));

  // ── 1. It fires where it must, on the real book ─────────────────────
  const open = async (title) => {
    await page.evaluate((t) => {
      const s = document.getElementById('gSearch');
      s.value = t;
      s.dispatchEvent(new Event('input', { bubbles: true }));
    }, title);
    await page.waitForTimeout(900);
    const ok = await page.evaluate(async (t) => {
      const items = Array.from(document.querySelectorAll('#gResults .g-ac-item'));
      const hit = items.find(i => i.innerText.toLowerCase().includes(t.toLowerCase())) || items[0];
      if (!hit) return false;
      hit.click();
      await new Promise(r => setTimeout(r, 900));
      return true;
    }, title);
    if (!ok) return null;
    return page.evaluate(() => {
      const c = document.getElementById('gCard');
      const rows = Array.from(c.querySelectorAll('table.g-table tbody tr'));
      return {
        title: (c.querySelector('h2') || {}).textContent || '',
        meds: rows.length,
        flagged: rows.filter(r => r.classList.contains('g-md-else')).length,
        flaggedNames: rows.filter(r => r.classList.contains('g-md-else'))
          .map(r => (r.querySelector('.g-md-name') || {}).textContent || '').join(' | '),
        cleanNames: rows.filter(r => !r.classList.contains('g-md-else'))
          .map(r => (r.querySelector('.g-md-name') || {}).textContent || '').join(' | '),
        warn: !!c.querySelector('.g-verify-warn'),
        under: Array.from(c.querySelectorAll('.g-md-under')).map(e => e.textContent).join(' | '),
      };
    });
  };

  let r = await open('Postnatal Psychosis');
  result('the corrupted section opens', !!r && /postnatal psychosis/i.test(r.title), r && r.title);
  result('and the medicines it was given from other sections are marked',
    r && r.flagged === 26, r && (r.flagged + ' of ' + r.meds + ' rows'));
  result('the dangerous ones by name',
    r && /lithium/i.test(r.flaggedNames) && /clozapine/i.test(r.flaggedNames) &&
    /alprazolam/i.test(r.flaggedNames) && /bupropion/i.test(r.flaggedNames),
    r && r.flaggedNames.slice(0, 90));
  result('each labelled with the section that really prints it',
    r && /Anxiety/.test(r.under) && /Depression/.test(r.under) &&
    /Bipolar/.test(r.under) && /Psychosis/.test(r.under), r && r.under.slice(0, 100));
  result('and the reader is told why, in the book\'s terms',
    r && r.warn === true);

  // ── 2. Where it must NOT fire ───────────────────────────────────────
  // A wrapped dose looks exactly like a numbered heading. "Benzathine
  // penicillin 2.4 MU IM single dose" breaking onto a new line reads as a
  // heading numbered "2.4"; a looser rule condemned the whole genital ulcer
  // disease page and the congenital syphilis page with it. This is the half
  // of the rule that matters.
  for (const [name, drug] of [
    ['Genital Ulcer Disease', /benzathine|aciclovir|ciprofloxacin/i],
    ['Congenital Syphilis', /penicillin/i],
    // Named exactly, because "Malaria" and "Pneumonia" are parent headings in
    // this book and carry no medicines of their own.
    ['Complicated/Severe Malaria', /artesunate|artemether|quinine/i],
    ['Pneumonia in a Child of 2 months', /amoxicillin|penicillin|ceftriaxone|gentamicin/i],
    ['Malaria in Pregnancy', /artemether|lumefantrine|quinine|sulfadoxine|sulphadoxine/i],
    ['Diabetes Mellitus', /metformin|insulin|glibenclamide|glimepiride/i],
  ]) {
    r = await open(name);
    result('"' + name + '" keeps all of its own medicines',
      !!r && r.flagged === 0 && r.meds > 0,
      r ? (r.flagged + ' wrongly marked, ' + r.meds + ' rows') : 'did not open');
    result('  …including the ones the book actually gives',
      !!r && drug.test(r.cleanNames), r ? r.cleanNames.slice(0, 70) : '');
  }

  // ── 3. Across the WHOLE book, exactly one section is affected ───────
  // Anything else means the rule has started firing where it should not, and
  // a test that only checked the one known case would never say so.
  const sweep = await page.evaluate(async () => {
    const S = await initSqlJs({ locateFile: f => 'js/vendor/' + f });
    const buf = await (await fetch('data/uganda_clinical_guidelines_2023.db?v=144')).arrayBuffer();
    const db = new S.Database(new Uint8Array(buf));
    const all = (sql, p) => {
      const st = db.prepare(sql); const out = [];
      try { st.bind(p || []); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); }
      return out;
    };
    const conds = all('SELECT id, number, title, chapter_number, full_text FROM conditions');
    const byNum = {}, titles = {};
    conds.forEach(c => {
      byNum[c.number] = { id: c.id, title: c.title };
      titles[String(c.title || '').toLowerCase().replace(/[^a-z]/g, '')] = 1;
    });
    // The same two-kinds lookup the screens use: a section with a row, or one
    // of the seven headings the import buried inside a neighbour.
    const tt = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
    const lookupFor = host => (n, t) => {
      const s = String(t || '').trim();
      // The number alone is not enough — the extraction mis-numbered part of
      // the book, so a row can carry a number whose heading says something
      // else entirely.
      if (byNum[n] && tt(s).indexOf(tt(byNum[n].title).slice(0, 12)) === 0) return byNum[n];
      if (s.length < 4 || /^(MU|IU|mg|ml|g|kg|mcg|units?)\b/i.test(s)) return null;
      if (String(n).split('.')[0] !== String(host.chapter_number)) return null;
      const k = s.toLowerCase().replace(/[^a-z]/g, '');
      if (!k || titles[k]) return null;
      return { title: s, buried: true };
    };
    let sections = 0, marked = 0, names = [];
    for (const c of conds) {
      const meds = all('SELECT name, source_line FROM medicines WHERE condition_id = ?', [c.id]);
      if (!meds.length) continue;
      const done = window.HomattUcgSections.attribute(c, meds, lookupFor(c));
      const n = done.filter(m => m.printedUnder).length;
      if (n) { sections++; marked += n; names.push(c.title + ' (' + n + ')'); }
    }
    db.close();
    return { total: conds.length, sections, marked, names };
  });
  /* Three section ROWS, 28 medicines. Worth reading slowly, because the shape
   * of the damage is the evidence that the rule is finding real boundaries
   * and not inventing them:
   *
   *   Postnatal Psychosis  (26)  the row numbered 9.2.4.1, which swallowed
   *                              Anxiety, Depression, Postnatal Depression,
   *                              Suicidal Behaviour, Bipolar and Psychosis —
   *                              all six have rows of their own.
   *   Postnatal Psychosis   (1)  a SECOND row with the same title, numbered
   *                              9.1.1.1, which swallowed Alcohol Use
   *                              Disorders. Its thiamine.
   *   Hepatic Encephalopathy (1) Oesophageal Varices' propranolol. That
   *                              heading has no row at all.
   *
   * The duplicate title is not a mistake in this test. The extraction really
   * did produce two "Postnatal Psychosis" rows, and both ran on. */
  result('across all 551 sections, exactly three are affected',
    sweep.sections === 3, sweep.sections + ': ' + sweep.names.join(', '));
  result('and exactly 28 medicines are marked, book-wide',
    sweep.marked === 28, String(sweep.marked));
  result('including the two under a heading that has no section of its own',
    /Hepatic Encephalopathy[^,]*\(1\)/.test(sweep.names.join(', ')) &&
    /Postnatal Psychosis \(1\)/.test(sweep.names.join(', ')), sweep.names.join(', '));

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
