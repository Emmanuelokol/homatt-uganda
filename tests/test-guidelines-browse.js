// Can a clinician actually FIND everything in the guideline, and read it?
//
// Two faults, reported together: the book was rendering its bullets as a
// literal "~" with every wrapped line broken, and there was no way to browse
// it at all — 551 sections behind a search box that said "Type a disease or
// condition", so the four chapters that are not diseases (family planning,
// immunisation, nutrition, palliative care) read as missing.
//
// This drives the real screen against the real 4 MB book. It is slower than the
// other tests because it loads the whole database in the browser, which is
// exactly what a clinician's phone does.
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
const PORT = 8951, ORIGIN = 'http://localhost:' + PORT;
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
  // The book is 4 MB and is parsed in the browser by SQLite-WASM.
  await page.waitForFunction(() => {
    const el = document.getElementById('gBrowse');
    return el && el.querySelectorAll('details').length > 0;
  }, { timeout: 60000 }).catch(() => {});

  // ── 1. The whole book is browsable ───────────────────────────────────
  const browse = await page.evaluate(() => {
    const el = document.getElementById('gBrowse');
    if (!el) return { there: false };
    const chs = Array.from(el.querySelectorAll('details'));
    return {
      there: true,
      chapters: chs.length,
      sections: el.querySelectorAll('.g-ch-item').length,
      titles: chs.map(d => (d.querySelector('.g-ch-t') || {}).textContent || ''),
      header: (el.querySelector('.g-browse-n') || {}).textContent || '',
    };
  });
  result('there is a contents page, not only a search box', browse.there === true);
  result('every chapter of the book is listed', browse.chapters === 24, 'chapters=' + browse.chapters);
  // 551 rows in the book's own table, plus the 7 recovered from inside their
  // neighbour — which are real sections of the book with no row of their own.
  result('and every section in it, including the ones with no entry of their own',
    browse.sections === 558, 'sections=' + browse.sections);
  result('the count on screen matches the list under it',
    new RegExp(browse.sections + ' sections · 24 chapters').test(browse.header), browse.header);

  // The chapters he said looked missing, because they are not diseases.
  for (const want of ['FAMILY PLANNING', 'IMMUNIZATION', 'NUTRITION', 'PALLIATIVE CARE', 'ORAL AND DENTAL']) {
    result('the chapter "' + want + '" is there',
      (browse.titles || []).some(t => t.toUpperCase().includes(want)));
  }

  // ── 2. A non-disease section opens from the contents page ────────────
  const opened = await page.evaluate(async () => {
    const items = Array.from(document.querySelectorAll('.g-ch-item'));
    const target = items.find(i => /condom|implant|injectable|pill/i.test(i.textContent));
    if (!target) return { found: false, sample: items.slice(0, 3).map(i => i.textContent.trim()) };
    target.click();
    await new Promise(r => setTimeout(r, 700));
    const card = document.getElementById('gCard');
    return {
      found: true, label: target.textContent.trim(),
      shown: card && getComputedStyle(card).display !== 'none',
      title: (card.querySelector('h2') || {}).textContent || '',
      browseHidden: getComputedStyle(document.getElementById('gBrowse')).display === 'none',
    };
  });
  result('a family-planning section can be opened straight from the contents',
    opened.found && opened.shown, opened.found ? opened.title : JSON.stringify(opened.sample));
  result('and the contents page steps out of the way while it is open', opened.browseHidden === true);

  // ── 3. The text is laid out, not dumped ──────────────────────────────
  const laid = await page.evaluate(() => {
    const card = document.getElementById('gCard');
    const outs = card.querySelectorAll('.g-outline');
    const body = card.innerText;
    // The raw source panel is deliberately raw, so it is excluded here.
    const src = card.querySelector('#gSourcePanel');
    const srcText = src ? src.innerText : '';
    const bodyMinusSource = body.replace(srcText, '');
    return {
      outlines: outs.length,
      bullets: card.querySelectorAll('.g-outline li').length,
      tildesInBody: (bodyMinusSource.match(/(^|\s)~(\s|$)/g) || []).length,
      hasSourcePanel: !!src,
    };
  });
  result('the section is laid out as an outline', laid.outlines > 0, 'blocks=' + laid.outlines);
  result('with real bullets', laid.bullets > 0, 'bullets=' + laid.bullets);
  result('and NO stray "~" left in the readable text',
    laid.tildesInBody === 0, 'tildes=' + laid.tildesInBody);
  result('the raw source panel is still there, for checking against the book',
    laid.hasSourcePanel === true);

  // ── 4. Searching still works, and finds a non-disease topic ──────────
  await page.evaluate(() => {
    const s = document.getElementById('gSearch');
    s.value = 'immuni';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(900);
  const hits = await page.evaluate(() => {
    const box = document.getElementById('gResults');
    return { shown: box && getComputedStyle(box).display !== 'none',
             text: box ? box.innerText : '' };
  });
  result('searching a non-disease topic returns something',
    hits.shown && hits.text.trim().length > 0 && !/Nothing in this book/.test(hits.text),
    hits.text.split('\n').slice(0, 2).join(' / '));

  // ── 5. The seven sections the import buried inside their neighbour ──
  // ~30,000 characters that searching could not reach, because they have no
  // row and no full-text entry — only a heading part-way down someone else's
  // section.
  const buriedNames = ['Adenoid Disease', 'Oesophageal Varices', 'Alcohol Use Disorders',
                       'Substance Abuse', 'Hepatorenal Syndrome'];
  for (const name of buriedNames) {
    const hit = await page.evaluate(async (n) => {
      const s = document.getElementById('gSearch');
      s.value = n.split(' ')[0];
      s.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 800));
      const box = document.getElementById('gResults');
      return box ? box.innerText : '';
    }, name);
    result('searching now finds "' + name + '"',
      hit.toLowerCase().includes(name.toLowerCase().split(' ')[0]),
      hit.split('\n').slice(0, 2).join(' / '));
  }

  // Opening one shows its own text and says where the book prints it.
  const buriedOpen = await page.evaluate(async () => {
    const s = document.getElementById('gSearch');
    s.value = 'adenoid';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 800));
    const first = document.querySelector('#gResults .g-ac-item');
    if (!first) return { opened: false };
    first.click();
    await new Promise(r => setTimeout(r, 800));
    const card = document.getElementById('gCard');
    return { opened: true, title: (card.querySelector('h2') || {}).textContent || '',
             text: card.innerText, note: !!card.querySelector('.g-buried-note') };
  });
  result('and opening it shows that section, not its neighbour',
    /Adenoid Disease/i.test(buriedOpen.title), buriedOpen.title);
  result('with its own clinical text', /Eustachian|mouth breathing|snoring/i.test(buriedOpen.text || ''));
  result('and it says where the book prints it',
    buriedOpen.note === true && /Atrophic Rhinitis/i.test(buriedOpen.text || ''));

  // ── 6. Sections the extraction could not split ──────────────────────
  // 148 of the 551 carry no named field at all. Every one of them used to
  // open as an empty card with a collapsed "view source" panel — a quarter of
  // the book looking missing, and readable only as raw text. This is the
  // section from the first photograph.
  const asPrinted = await page.evaluate(async () => {
    const s = document.getElementById('gSearch');
    s.value = 'malaria prevention';
    s.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));
    const f = document.querySelector('#gResults .g-ac-item');
    if (!f) return { opened: false };
    f.click();
    await new Promise(r => setTimeout(r, 900));
    const c = document.getElementById('gCard');
    const src = c.querySelector('#gSourcePanel');
    const body = c.innerText.replace(src ? src.innerText : '', '');
    return {
      opened: true,
      title: (c.querySelector('h2') || {}).textContent || '',
      bullets: c.querySelectorAll('.g-outline li').length,
      note: !!c.querySelector('.g-asprinted-note'),
      tildes: (body.match(/(^|\s)~(\s|$)/g) || []).length,
      body: body,
    };
  });
  result('a section the extraction could not split still shows its content',
    asPrinted.opened && asPrinted.bullets > 0,
    asPrinted.title + ', bullets=' + asPrinted.bullets);
  result('laid out, with no raw "~" left in it', asPrinted.tildes === 0, 'tildes=' + asPrinted.tildes);
  result('and it says plainly that this is the book\'s own wording',
    asPrinted.note === true);
  result('the clinical content is actually there',
    /bed nets|insecticide|stagnant water/i.test(asPrinted.body || ''));

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
