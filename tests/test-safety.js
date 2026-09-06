// Who the patient is, and what that must change.
//
//   • 83 conditions can only happen to one sex. Until the sex is recorded they
//     are held back — and the screen says how many, so a blank field never
//     quietly narrows the differential.
//   • A child does not get an adult dose. Every figure in the Uganda
//     guidelines' medicines table is an adult dose, so for a patient under 13
//     the package arrives with nothing ticked and points at the children's
//     weight-band table instead.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
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

(async () => {
  await new Promise(r => server.listen(8937, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:8937')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });
  await page.goto('http://localhost:8937/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName:'D', clinicName:'K', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token:'t', refresh_token:'r', token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{id:uid} }));
  }, [CID, UID]);
  await page.goto('http://localhost:8937/clinic/new-order.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#itTab1', { timeout: 20000 });
  await page.waitForFunction(() => window.Impression && window.Impression.ageBand, { timeout: 20000 });

  // ── Age banding ─────────────────────────────────────────────────────────
  const bands = await page.evaluate(() => ({
    m6:   window.Impression.ageBand(6, 'months'),
    y2:   window.Impression.ageBand(2, 'years'),
    y5:   window.Impression.ageBand(5, 'years'),
    y12:  window.Impression.ageBand(12, 'years'),
    y13:  window.Impression.ageBand(13, 'years'),
    y40:  window.Impression.ageBand(40, 'years'),
    none: window.Impression.ageBand('', 'years'),
  }));
  result('age is banded paediatric (<5) / child (5-12) / adult (>12)',
    bands.m6 === 'paediatric' && bands.y2 === 'paediatric' && bands.y5 === 'child' &&
    bands.y12 === 'child' && bands.y13 === 'adult' && bands.y40 === 'adult' && bands.none === '',
    JSON.stringify(bands));

  // ── Sex gating, straight at the engine ──────────────────────────────────
  await page.evaluate(() => window.Impression.ready());
  await page.waitForTimeout(3000);
  const probe = (sex) => page.evaluate((sx) => {
    const r = window.Impression.suggest({
      sex: sx, age: '26', ageUnit: 'years',
      chief: 'lower abdominal pain', subjective: 'vaginal discharge and fever',
      background: '', vitals: { temp: '38.2' },
    }, 6);
    return { blocked: r.sexBlocked, titles: (r.items || []).map(i => i.title) };
  }, sex);

  const unknown = await probe('');
  result('with the sex blank, sex-specific conditions are held back',
    unknown.blocked > 50, unknown.blocked + ' held back');
  const FEM = /pregnan|ectopic|pelvic inflammatory|vaginal|uterine|cervic|ovarian|obstetric/i;
  result('and none of them reaches the list',
    !unknown.titles.some(t => FEM.test(t)), unknown.titles.join(' | '));

  const female = await probe('female');
  result('once she is recorded as female, they come back',
    female.blocked === 0 && female.titles.length > 0, female.titles.join(' | '));

  const male = await probe('male');
  const MALEONLY = /prostat|scrotal|testic|epididym/i;
  result('a man is never offered a female-only condition',
    !male.titles.some(t => FEM.test(t)), male.titles.join(' | '));

  // The gate must not silently delete male-only conditions for a man: with the
  // sex set to male, nothing is held back at all.
  const maleUro = await page.evaluate(() => {
    const r = window.Impression.suggest({
      sex: 'male', age: '68', ageUnit: 'years',
      chief: 'difficulty passing urine', subjective: 'poor stream, dribbling at night',
      background: '', vitals: {},
    }, 5);
    return { blocked: r.sexBlocked, titles: (r.items || []).map(i => i.title) };
  });
  result('a man has nothing held back — male-only conditions stay reachable',
    maleUro.blocked === 0, 'held back: ' + maleUro.blocked + ' | ' + maleUro.titles.join(' | '));

  const femaleNoProstate = await page.evaluate(() => {
    const r = window.Impression.suggest({
      sex: 'female', age: '68', ageUnit: 'years',
      chief: 'difficulty passing urine', subjective: 'poor stream, dribbling at night',
      background: '', vitals: {},
    }, 5);
    return (r.items || []).map(i => i.title);
  });
  result('a woman with the same symptoms is never offered a prostate condition',
    !femaleNoProstate.some(t => MALEONLY.test(t)), femaleNoProstate.join(' | '));
  void MALEONLY;

  // ── The paediatric lockdown, on the real screen ─────────────────────────
  await page.evaluate(() => {
    document.getElementById('itAge').value = '4';
    document.getElementById('itAge').dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(500);
  const note = await page.evaluate(() => {
    const el = document.getElementById('itWhoNote');
    return { shown: el && getComputedStyle(el).display !== 'none', txt: (el || {}).textContent || '',
             band: (window._wizState || {}).ageBand };
  });
  result('a child is called out under the name, with what to do about the dose',
    note.shown && note.band === 'paediatric' && /weight/i.test(note.txt),
    note.band + ': ' + note.txt.slice(0, 90).replace(/\s+/g, ' '));

  await page.fill('#confirmedDx', 'Uncomplicated Malaria');
  await page.click('#ucgOneTap');
  await page.waitForTimeout(4500);
  const child = await page.evaluate(() => ({
    ticked: [...document.querySelectorAll('.ucg-drug.on')].length,
    warn: !!document.querySelector('.ucg-childwarn'),
    warnTxt: (document.querySelector('.ucg-childwarn') || {}).textContent || '',
  }));
  result('for a child, NOTHING is ticked — no adult dose is ever pre-selected',
    child.ticked === 0, child.ticked + ' ticked');
  result('and the package says to take the dose from the child\'s weight',
    child.warn && /weight/i.test(child.warnTxt), child.warnTxt.slice(0, 100).replace(/\s+/g, ' '));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
