// Can a clinician find family planning, and does a heading show its contents?
//
// Two reports, one screen:
//
//   1. Typing "Family" returned "Nothing in this book matches". Chapter 15 of
//      the Uganda Clinical Guidelines IS "FAMILY PLANNING (FP)". The cause was
//      not the book: every index in every book here is `USING fts5`, and the
//      SQLite compiled into js/vendor/sql-wasm.wasm has FTS3 and FTS4 but no
//      FTS5. MATCH threw on every search, a catch swallowed it, and the app
//      silently searched `title LIKE '%term%'` and nothing else — so only a
//      word in a section's own heading could ever be found.
//
//   2. Opening "Malnutrition" gave a card with no malnutrition in it. 53 of
//      the 551 sections are headings the book prints with no text of their own
//      — all of their content is in the sub-sections beneath them — and the
//      card listed none of those sub-sections.
//
// This drives the real screen against the real 4 MB book, in the browser, with
// the real WASM engine — which is the only place the FTS5 fault is visible at
// all. It is slow for that reason.
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
const PORT = 8953, ORIGIN = 'http://localhost:' + PORT;
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

  // The engine really is the one without FTS5. If a later build fixes that,
  // this says so rather than quietly measuring something else.
  const engine = await page.evaluate(async () => {
    try {
      const S = await initSqlJs({ locateFile: f => 'js/vendor/' + f });
      const d = new S.Database();
      try { d.run('CREATE VIRTUAL TABLE t USING fts5(a)'); return { fts5: true }; }
      catch (e) { return { fts5: false, why: String(e.message || e) }; }
    } catch (e) { return { fts5: null, why: String(e.message || e) }; }
  });
  console.log('      (the shipped SQLite has FTS5: ' + engine.fts5 +
    (engine.why ? ' — ' + engine.why : '') + ')');

  const type = async (term) => {
    await page.evaluate((t) => {
      const s = document.getElementById('gSearch');
      s.value = t;
      s.dispatchEvent(new Event('input', { bubbles: true }));
    }, term);
    await page.waitForTimeout(800);
    return page.evaluate(() => {
      const box = document.getElementById('gResults');
      return {
        shown: box && getComputedStyle(box).display !== 'none',
        empty: !!(box && box.querySelector('.g-ac-empty')),
        n: box ? box.querySelectorAll('.g-ac-item').length : 0,
        first: box && box.querySelector('.g-ac-item')
          ? box.querySelector('.g-ac-item').innerText.replace(/\s+/g, ' ').trim() : '',
        chapter: !!(box && box.querySelector('.g-ac-chapter')),
        alias: box && box.querySelector('.g-ac-alias')
          ? box.querySelector('.g-ac-alias').innerText : '',
        text: box ? box.innerText : '',
      };
    });
  };

  // ── 1. The report: "Family" ──────────────────────────────────────────
  let r = await type('Family');
  result('typing "Family" finds something', r.n > 0 && !r.empty, r.first || r.text.slice(0, 60));
  result('and the whole FAMILY PLANNING chapter is offered first',
    r.chapter && /family planning/i.test(r.first), r.first);

  // Tapping it opens the contents at that chapter, with its sections listed.
  const chap = await page.evaluate(async () => {
    const first = document.querySelector('#gResults .g-ac-chapter');
    if (!first) return { ok: false };
    first.click();
    await new Promise(res => setTimeout(res, 700));
    const br = document.getElementById('gBrowse');
    const open = br ? br.querySelector('details[open]') : null;
    return {
      ok: true,
      browseShown: br && getComputedStyle(br).display !== 'none',
      cardHidden: getComputedStyle(document.getElementById('gCard')).display === 'none',
      openTitle: open ? (open.querySelector('.g-ch-t') || {}).textContent || '' : '',
      items: open ? open.querySelectorAll('.g-ch-item').length : 0,
      onlyOne: br ? br.querySelectorAll('details[open]').length : 0,
      names: open ? Array.from(open.querySelectorAll('.g-ci-t')).map(e => e.textContent).join(' | ') : '',
    };
  });
  result('tapping the chapter opens the contents there', chap.ok && chap.browseShown && chap.cardHidden);
  result('showing FAMILY PLANNING, and only it',
    /family planning/i.test(chap.openTitle) && chap.onlyOne === 1,
    chap.openTitle + ', ' + chap.onlyOne + ' open');
  result('with its sections listed', chap.items > 10, chap.items + ' sections');
  result('including the methods a clinician would look for',
    /condom/i.test(chap.names) && /implant/i.test(chap.names) && /IUD/i.test(chap.names));

  // ── 2. Words that are nowhere in any heading ─────────────────────────
  // These are the ones the title-only fallback could never reach. Each is a
  // real word in the body of the book.
  for (const [term, want] of [
    ['mosquito', /malaria/i], ['rehydration', /./], ['ceftriaxone', /./],
    ['metformin', /diabet/i], ['chest indrawing', /./], ['bed nets', /./],
  ]) {
    r = await type(term);
    result('"' + term + '" is found in the body of the book, not only in a heading',
      r.n > 0 && !r.empty && want.test(r.text), r.first.slice(0, 52) || r.text.slice(0, 52));
  }

  // ── 3. The book's own numbering goes straight there ──────────────────
  r = await type('19.2');
  result('typing a section number opens that section, not a title that contains "19"',
    /malnutrition/i.test(r.first), r.first);

  // ── 4. A word the book does not use is named, not shrugged at ────────
  r = await type('coartem');
  result('a brand name the guideline never prints still finds the medicine',
    r.n > 0 && !r.empty, r.first.slice(0, 52));
  result('and the screen says which word it searched instead',
    /lumefantrine/i.test(r.alias), r.alias.replace(/\s+/g, ' ').slice(0, 90));

  /* ── 5. The reference matter, which had no section at all ────────────
   *
   * measure-book-coverage.js counted what a clinician could not reach: the
   * book prints 91,666 characters outside its numbered spine and the app had
   * none of it. Not front matter in any dismissible sense — PRESCRIPTION
   * WRITING RULES, INJECTIONS, antimicrobial resistance, and Appendix 3, the
   * national laboratory test menu, which says which tests an HC II or HC IV
   * can actually run. */
  for (const [term, want] of [
    ['prescription writing', /prescription/i],
    ['antimicrobial resistance', /antimicrobial|resistance/i],
    ['laboratory test menu', /laboratory|test menu/i],
    ['abbreviations', /abbreviation/i],
    ['infection control', /infection/i],
    ['pharmacovigilance', /pharmacovigilance|adverse/i],
  ]) {
    r = await type(term);
    result('"' + term + '" is in the book, and now in the app',
      r.n > 0 && !r.empty && want.test(r.text), r.first.slice(0, 56) || r.text.slice(0, 56));
  }

  // Opening one shows the book's own words, laid out, with no page cited —
  // the front matter is paginated in roman numerals the index does not carry,
  // and a wrong page on a card that cites the book is worse than none.
  const ref = await page.evaluate(async () => {
    const s = document.getElementById('gSearch');
    s.value = 'prescription writing';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(res => setTimeout(res, 900));
    const f = document.querySelector('#gResults .g-ac-item');
    if (!f) return { opened: false };
    f.click();
    await new Promise(res => setTimeout(res, 900));
    const c = document.getElementById('gCard');
    const src = c.querySelector('#gSourcePanel');
    return {
      opened: true,
      title: (c.querySelector('h2') || {}).textContent || '',
      chips: Array.from(c.querySelectorAll('.g-chip')).map(e => e.textContent).join(' | '),
      body: c.innerText.replace((src || {}).innerText || '', ''),
      bullets: c.querySelectorAll('.g-outline li').length,
    };
  });
  result('a reference section opens', ref.opened && /prescription/i.test(ref.title), ref.title);
  result('with the book\'s own rules in it, laid out',
    /legal document|dose size|duration of treatment|generic/i.test(ref.body || '') && ref.bullets > 0,
    'bullets=' + ref.bullets);
  result('filed under the reference chapter, not a clinical one',
    /REFERENCE/i.test(ref.chips || ''), ref.chips.slice(0, 70));
  result('and it cites no page, because the book numbers this part in roman',
    !/p\.\d/.test(ref.chips || ''), ref.chips.slice(0, 70));

  // ── 6. Nothing that worked before may have stopped working ───────────
  for (const [term, want] of [['malaria', /malaria/i], ['typhoid', /typhoid/i],
                              ['asthma', /asthma/i], ['cataract', /cataract/i]]) {
    r = await type(term);
    result('"' + term + '" still finds itself first', want.test(r.first), r.first.slice(0, 52));
  }

  // ── 6. A heading with no text of its own shows what is under it ──────
  const heading = await page.evaluate(async () => {
    const s = document.getElementById('gSearch');
    s.value = '19.2';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(res => setTimeout(res, 800));
    const f = document.querySelector('#gResults .g-ac-item');
    if (!f) return { opened: false };
    f.click();
    await new Promise(res => setTimeout(res, 900));
    const c = document.getElementById('gCard');
    return {
      opened: true,
      title: (c.querySelector('h2') || {}).textContent || '',
      note: (c.querySelector('.g-asprinted-note') || {}).innerText || '',
      kids: c.querySelectorAll('.g-kid').length,
      names: Array.from(c.querySelectorAll('.g-kid-t')).map(e => e.textContent).join(' | '),
      text: c.innerText,
    };
  });
  result('a heading with no text of its own opens', heading.opened && /malnutrition/i.test(heading.title),
    heading.title);
  result('and lists the sections that hold its content', heading.kids > 0,
    heading.kids + ': ' + heading.names.slice(0, 80));
  result('the ones the book actually prints under it',
    /introduction on malnutrition/i.test(heading.names) &&
    /management of acute malnutrition/i.test(heading.names), heading.names.slice(0, 110));
  result('and it says plainly why the heading itself is bare',
    /prints no text under it directly/i.test(heading.note), heading.note.slice(0, 80));
  result('the number of sections it claims matches the number it lists',
    new RegExp('in the ' + heading.kids + ' section').test(heading.note), heading.note.slice(0, 80));

  // Tapping one opens it, with real content.
  const kid = await page.evaluate(async () => {
    const k = document.querySelector('#gCard .g-kid');
    if (!k) return { ok: false };
    k.click();
    await new Promise(res => setTimeout(res, 900));
    const c = document.getElementById('gCard');
    const src = c.querySelector('#gSourcePanel');
    return { ok: true, title: (c.querySelector('h2') || {}).textContent || '',
             body: c.innerText.replace(src ? src.innerText : '', '') };
  });
  result('tapping one of them opens that section', kid.ok && /malnutrition/i.test(kid.title), kid.title);
  result('with the book\'s own clinical text in it',
    (kid.body || '').replace(/\s+/g, ' ').length > 400, (kid.body || '').length + ' chars');

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
