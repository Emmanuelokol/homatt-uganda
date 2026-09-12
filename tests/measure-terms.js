// Does everything the clinician said actually reach the suggestion engine?
//
// suggest() builds its search terms in a fixed order — complaint, then the
// vitals turned into words, then the story, then the background — and then
// cuts the list at 22. So the question is not "are all four used?" (they are)
// but "does the cap ever throw the background away?"
//
// Run in a real browser, because the engine is a browser module.
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
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';

// Realistic consultations, the wordy ones included — a clinician who talks is
// the case where a cap bites.
const CASES = [
  { n: 'short', chief: 'fever', subjective: 'for two days', background: 'known diabetic',
    vitals: { temp: '38.6' } },
  { n: 'ordinary', chief: 'cough and fever',
    subjective: 'for one week, worse at night, no chest pain, has taken panadol',
    background: 'known asthmatic on salbutamol', vitals: { temp: '38.2', pulse: '104' } },
  { n: 'wordy', chief: 'abdominal pain and vomiting',
    subjective: 'started three days ago after eating, worse after food, has vomited ' +
      'four times today, no diarrhoea, no blood in the vomit, took metronidazole ' +
      'from a drug shop with no relief, cannot keep water down',
    background: 'known peptic ulcer disease, drinks alcohol, smokes, on omeprazole ' +
      'previously, family history of stomach cancer',
    vitals: { temp: '37.4', pulse: '112', sbp: '100', dbp: '60' } },
  { n: 'very wordy', chief: 'headache',
    subjective: 'severe headache for five days, worse in the morning, with vomiting ' +
      'and blurred vision, no fever, no neck stiffness, no fits, has taken ' +
      'paracetamol and ibuprofen without relief, cannot sleep, light hurts the eyes',
    background: 'known hypertensive on amlodipine, mother had a stroke, works as a ' +
      'boda rider, does not smoke, no known allergies',
    vitals: { sbp: '178', dbp: '104', pulse: '92' } },
];

(async () => {
  await new Promise(r => server.listen(8953, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext()).newPage();
  await page.route('**/*', r => r.request().url().startsWith('http://localhost:8953')
    ? r.continue() : r.abort());
  await page.goto('http://localhost:8953/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  await page.goto('http://localhost:8953/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const has = await page.evaluate(() => ({
    impression: !!window.Impression, toks: !!(window.Impression && window.Impression._toks) }));
  if (!has.toks) { console.error('engine not present:', JSON.stringify(has),
    'errors:', errs.slice(0,3)); process.exit(1); }
  await page.evaluate(() => window.Impression.ready());

  const rows = await page.evaluate((cases) => cases.map((c) => {
    const T = window.Impression._toks;
    const story = T(c.subjective);
    const back  = T(c.background);
    // suggest() returns the terms it actually searched with, so this reads the
    // engine's real decision rather than re-implementing it here.
    const got = window.Impression.suggest({
      sex: 'female', age: '30', ageUnit: 'years',
      chief: c.chief, subjective: c.subjective,
      background: c.background, vitals: c.vitals }, 3);
    const kept = got.terms || [];
    const all = [];
    [T(c.chief), story, back].forEach(l => l.forEach(t => {
      if (all.indexOf(t) < 0) all.push(t); }));
    const backKept = back.filter(t => kept.indexOf(t) >= 0);
    const backLost = back.filter(t => kept.indexOf(t) < 0);
    const storyKept = story.filter(t => kept.indexOf(t) >= 0);
    return { n: c.n, total: all.length, capped: kept.length >= 22,
             storyKept: storyKept.length, storyLost: story.length - storyKept.length,
             backTotal: back.length, backKept: backKept.length,
             backLost: backLost,
             top: (got.items || []).slice(0, 2).map(i => i.title + ' ' + i.pct + '%') };
  }), CASES);

  console.log('do all the words reach the engine? (cap is 22 terms)\n');
  rows.forEach(r => {
    console.log(`  ${r.n.padEnd(11)} ${String(r.total).padStart(3)} terms` +
      (r.capped ? '  CAPPED' : '        ') +
      `  background ${r.backKept}/${r.backTotal} kept` +
      (r.backLost.length ? `   LOST: ${r.backLost.join(', ')}` : ''));
    console.log(`               → ${r.top.join('  |  ')}`);
  });
  const bad = rows.filter(r => r.backLost.length);
  console.log(`\n  dictations where the background was cut off: ${bad.length}/${rows.length}`);

  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
