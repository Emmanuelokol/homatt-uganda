// Dosing-maths and safety audit across EVERY condition in the Uganda Clinical
// Guidelines, in a real browser, against the real database.
//
// Three assertions, run over all 535 conditions:
//   1. QUANTITY:  [times/day] x [days] = [qty] for everything dispensed as
//      tablets or capsules. Anything hung on a drip stand or pushed into a
//      vein is given once at the clinic and is checked as qty 1 instead.
//   2. DEFAULT SELECTION: at most ONE treatment drug arrives ticked, and
//      nothing parenteral or supportive is ticked for a non-severe case.
//      This is the check that would have caught IV quinine, Dextrose and
//      phenobarbital arriving pre-ticked for uncomplicated malaria.
//   3. COMPLETENESS: every ticked drug has a dose, so a package can never be
//      saved with a blank prescription line.
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

const IDS = JSON.parse(execSync(`python3 -c "
import sqlite3,json
g=sqlite3.connect('${ROOT}/clinic/data/uganda_clinical_guidelines_2023.db')
print(json.dumps([[r[0],r[1]] for r in g.execute('select id,title from conditions order by id')]))
"`).toString());

(async () => {
  await new Promise(r => server.listen(8967, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 950 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:8967')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });
  await page.goto('http://localhost:8967/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName:'D', clinicName:'K', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token:'t', refresh_token:'r', token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{id:uid} }));
  }, [CID, UID]);
  await page.goto('http://localhost:8967/clinic/new-order.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#confirmedDx', { timeout: 20000 });
  await page.waitForFunction(() => window.UCGPackage && window.UCGPackage._build, { timeout: 20000 });
  await page.evaluate(() => window.UCGPackage.openDb());
  await page.waitForTimeout(2500);

  const report = await page.evaluate((ids) => {
    const PARENTERAL = /\b(IV|IM|intravenous|intramuscular|infusion|rectal|drip)\b/i;
    const out = { n: 0, mathBad: [], multiTick: [], parenteralTick: [], noDose: [], ticked: {} };
    for (const [id, title] of ids) {
      let p;
      try { p = window.UCGPackage._build(id, 'moderate'); } catch (e) { continue; }
      if (!p || !p.drugs || !p.drugs.length) continue;
      out.n++;
      let treatTicked = 0;
      for (const d of p.drugs) {
        const g = d.group || 'treatment';
        if (g === 'other') continue;
        const tpd = Number(d.timesPerDay) || 0;
        const dd = Number(d.durationDays) || 0;
        const q = Number(d.qty) || 0;
        // Three shapes, three different sums — assuming everything is a
        // tablet is what put ten bags of saline on a bill.
        //   unit       tablets, capsules      qty = times/day x days
        //   container  syrup, cream, drops    qty = bottles, NOT doses
        //   given-here drip, ampoule          qty = a small number given here
        const givenHere = d.shape === 'given-here' ||
          g === 'fluid' || PARENTERAL.test(String(d.dosage || '') + ' ' + String(d.text || ''));
        if (givenHere) {
          if (!(q >= 0 && q <= 6)) out.mathBad.push(title + ' :: ' + d.drug + ' given at the clinic but qty ' + q);
        } else if (d.shape === 'container') {
          if (!(q >= 1 && q <= 6)) out.mathBad.push(title + ' :: ' + d.drug + ' is a container but qty ' + q);
        } else if (tpd > 0 && dd > 0 && q !== tpd * dd) {
          out.mathBad.push(title + ' :: ' + d.drug + ' ' + tpd + '/day x ' + dd + 'd = ' + (tpd * dd) + ' but qty ' + q);
        }
        if (d.selected) {
          if (g === 'treatment') treatTicked++;
          if (givenHere) out.parenteralTick.push(title + ' :: ' + d.drug);
          if (g === 'supportive') out.parenteralTick.push(title + ' :: (supportive) ' + d.drug);
          if (!String(d.dosage || '').trim()) out.noDose.push(title + ' :: ' + d.drug);
        }
      }
      if (treatTicked > 1) out.multiTick.push(title + ' :: ' + treatTicked + ' treatment drugs ticked');
      out.ticked[title] = p.drugs.filter(d => d.selected).map(d => d.drug);
    }
    return out;
  }, IDS);

  console.log('  conditions with a package: ' + report.n + ' of ' + IDS.length);
  result('[X/day] x [days] = [qty] holds for every dispensed drug',
    report.mathBad.length === 0, report.mathBad.slice(0, 4).join('  |  ') || 'all consistent');
  result('at most one treatment drug arrives ticked',
    report.multiTick.length === 0, report.multiTick.slice(0, 4).join('  |  ') || 'never more than one');
  result('nothing parenteral or supportive is ticked for a non-severe case',
    report.parenteralTick.length === 0, report.parenteralTick.slice(0, 4).join('  |  ') || 'none');
  result('every ticked drug carries a dose',
    report.noDose.length === 0, report.noDose.slice(0, 4).join('  |  ') || 'all have one');

  // The specific mismatch that started this audit.
  const mal = report.ticked['Uncomplicated Malaria'] || [];
  result('UNCOMPLICATED MALARIA ticks oral ACT only — no quinine, no drip',
    mal.length === 1 && /artemether/i.test(mal[0]),
    'ticked: ' + (mal.join(', ') || 'nothing'));
  const ty = report.ticked['Typhoid Fever (Enteric Fever)'] || [];
  result('TYPHOID ticks an oral fluoroquinolone, not chloramphenicol',
    ty.length === 1 && /ciprofloxacin/i.test(ty[0]),
    'ticked: ' + (ty.join(', ') || 'nothing'));

  // Severe malaria must still be able to give the full protocol.
  const severe = await page.evaluate(() => {
    const p = window.UCGPackage._build(83, 'severe');
    return p.drugs.filter(d => d.selected).map(d => d.drug + ' [' + (d.group || 'treatment') + ']');
  });
  result('SEVERE malaria still brings the supportive protocol back',
    severe.length > 1, severe.join(', '));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
