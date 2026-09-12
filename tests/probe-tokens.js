// Are --muted and --line actually defined? An undefined custom property makes
// the whole declaration invalid, which is silent and looks like a design choice.
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
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
(async () => {
  await new Promise(r => server.listen(8967, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport:{width:430,height:950} })).newPage();
  await page.route('**/*', r => { const u = r.request().url();
    if (u.startsWith('http://localhost:8967')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort(); });
  await page.goto('http://localhost:8967/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);
  await page.goto('http://localhost:8967/clinic/new-order.html');
  await page.waitForSelector('#itDictateStory', { timeout: 20000 });
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const names = ['--muted','--line','--tint-2','--primary','--text','--brand-ink','--on-primary','--danger'];
    const out = { tokens: {} };
    names.forEach(n => { out.tokens[n] = cs.getPropertyValue(n).trim() || '(UNDEFINED)'; });
    const say = document.getElementById('itDictateStorySay');
    const btn = document.getElementById('itDictateStory');
    out.sayColor = getComputedStyle(say).color;
    out.bodyColor = getComputedStyle(document.body).color;
    out.btnBorder = getComputedStyle(btn).borderTopStyle + ' ' + getComputedStyle(btn).borderTopColor;
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
