// What does the engine say TODAY for the two presentations the guards are for?
//
// Run before and after changing clinic-impression.js. It changes nothing and
// asserts nothing — it prints the top 5 with the words each one matched on,
// so the effect of a rule is visible rather than argued about.
//
//   node probe-guards.js
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
const ORIGIN='http://localhost:8944';

// The cases the two rules are about, plus the ones that must NOT change.
const CASES = [
  { name: 'RIGIDITY GUARD — denial written out',
    input: { sex: 'f', age: '26', chief: 'abdominal pain',
      subjective: 'lower abdominal pain for two days, no rigidity, no guarding, no rebound tenderness, bowel sounds present',
      background: '', vitals: { temp: '37.8', pulse: '88', sbp: '118', dbp: '76' } } },
  { name: 'RIGIDITY GUARD — same words, no denial (must be unchanged)',
    input: { sex: 'f', age: '26', chief: 'abdominal pain',
      subjective: 'lower abdominal pain for two days, rigidity, guarding and rebound tenderness',
      background: '', vitals: { temp: '37.8', pulse: '88', sbp: '118', dbp: '76' } } },
  { name: 'RIGIDITY GUARD — denied but the patient is shocked (must NOT be demoted)',
    input: { sex: 'm', age: '34', chief: 'abdominal pain',
      subjective: 'severe abdominal pain, distended abdomen, no rigidity, no guarding, vomiting',
      background: '', vitals: { temp: '39.4', pulse: '132', sbp: '82', dbp: '54' } } },

  { name: 'REPRODUCTIVE PRIORITY — woman, lower pain + discharge',
    input: { sex: 'f', age: '24', chief: 'lower abdominal pain',
      subjective: 'lower abdominal pain for one week with smelly vaginal discharge and painful urination',
      background: '', vitals: { temp: '38.2', pulse: '96', sbp: '112', dbp: '70' } } },
  { name: 'REPRODUCTIVE PRIORITY — same woman WITH diarrhoea (parasites allowed back)',
    input: { sex: 'f', age: '24', chief: 'lower abdominal pain',
      subjective: 'lower abdominal pain with vaginal discharge, painful urination and bloody diarrhoea for three days',
      background: '', vitals: { temp: '38.2', pulse: '96', sbp: '112', dbp: '70' } } },
  { name: 'REPRODUCTIVE PRIORITY — man with the same pain (must NOT fire)',
    input: { sex: 'm', age: '24', chief: 'lower abdominal pain',
      subjective: 'lower abdominal pain and painful urination for one week',
      background: '', vitals: { temp: '38.2', pulse: '96', sbp: '112', dbp: '70' } } },
  { name: 'UNRELATED — child with fever and cough (nothing should change)',
    input: { sex: 'm', age: '3', chief: 'fever and cough',
      subjective: 'fever for three days with cough and fast breathing',
      background: '', vitals: { temp: '39.1', pulse: '140', sbp: '', dbp: '' } } },
];

(async () => {
  await new Promise(r => server.listen(8944, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext()).newPage();
  await page.route('**/*', r => r.request().url().startsWith(ORIGIN) ? r.continue() : r.abort());
  await page.goto(ORIGIN + '/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(4000);
  const ok = await page.evaluate(async () => !!(window.Impression && await window.Impression.ready()));
  if (!ok) { console.error('the engine did not open'); process.exit(1); }

  for (const c of CASES) {
    const r = await page.evaluate((inp) => window.Impression.suggest(inp, 5), c.input);
    console.log('\n■ ' + c.name);
    console.log('  said: ' + c.input.subjective);
    console.log('  searched on: ' + (r.terms || []).join(' '));
    if (r.dropped && r.dropped.length) console.log('  denied, so dropped: ' + r.dropped.join(' '));
    if (r.rules && r.rules.length) console.log('  rules fired: ' + r.rules.join(', '));
    (r.items || []).forEach((it, i) => {
      console.log('   ' + (i + 1) + '. ' + String(it.pct).padStart(3) + '%  ' +
        it.title + (it.demoted ? '   [demoted]' : '') +
        '\n         because: ' + (it.matched || []).slice(0, 6).join(', '));
    });
    (r.flags || []).forEach(f => {
      if (f.k === 'danger' || f.rule) console.log('   ⚠ ' + f.t + (f.w ? ' — ' + f.w : ''));
    });
  }
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
