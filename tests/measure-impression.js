// Is the suggestion engine still as good as it was?
//
// The benchmark the engine's own header quotes — "237/241: given the findings
// the WHO book itself lists in favour of a diagnosis, that diagnosis is in the
// top 3" — is rebuilt here from the same source, impression_index.db. Each of
// the 241 differential rows carries its presenting complaint (f2) and the
// findings that count in its favour (f3); feed those back in and the row's own
// diagnosis should come out near the top.
//
// It is not a measure of clinical accuracy — the book is not the patient. It
// is a REGRESSION measure: change how the engine picks its search terms and
// this number says whether you broke it.
//
//   node measure-impression.js
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
const ORIGIN='http://localhost:8951';

(async () => {
  await new Promise(r => server.listen(8951, r));
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
  const ready = await page.evaluate(async () =>
    !!(window.Impression && await window.Impression.ready()));
  if (!ready) { console.error('the engine did not open'); process.exit(1); }

  const out = await page.evaluate(async () => {
    // Read the rows straight out of the same database the engine opened.
    const SQL = await initSqlJs({ locateFile: (f) => 'js/vendor/' + f });
    const buf = await (await fetch('data/impression_index.db?v=144')).arrayBuffer();
    const db = new SQL.Database(new Uint8Array(buf));
    const res = db.exec(
      "select title, f2, f3, age, sex from docs where kind='diff'");
    const rows = (res[0] ? res[0].values : []).map(r => ({
      title: r[0], complaint: r[1] || '', findings: r[2] || '',
      age: r[3] || '', sex: r[4] || '',
    }));

    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    let top1 = 0, top3 = 0, missed = [];
    // A child row must be asked about a child, or the age gate hides it.
    const ageFor = (band) => band === 'child' ? { age: '4', ageUnit: 'years' }
                           : band === 'adult' ? { age: '30', ageUnit: 'years' }
                           : { age: '', ageUnit: '' };
    rows.forEach((r) => {
      const a = ageFor(r.age);
      const got = window.Impression.suggest({
        sex: r.sex === 'm' ? 'male' : r.sex === 'f' ? 'female' : '',
        age: a.age, ageUnit: a.ageUnit,
        chief: r.complaint,
        subjective: r.findings,
        background: '',
        vitals: {},
      }, 3);
      const names = (got.items || []).map(i => norm(i.title));
      const want = norm(r.title);
      if (names[0] === want) top1++;
      if (names.indexOf(want) >= 0) top3++;
      else missed.push(r.title + '  →  ' + (names.join(' / ') || 'nothing'));
    });
    return { n: rows.length, top1, top3, missed: missed.slice(0, 8) };
  });

  console.log('the WHO differential benchmark — the book asked about itself\n');
  console.log(`  in the top 3 : ${out.top3}/${out.n}  (${(100*out.top3/out.n).toFixed(1)}%)`);
  console.log(`  first        : ${out.top1}/${out.n}  (${(100*out.top1/out.n).toFixed(1)}%)`);
  if (out.missed.length) {
    console.log('\n  a few it does not find:');
    out.missed.forEach(m => console.log('    ' + m));
  }
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
