const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
(async()=>{
  await new Promise(r=>server.listen(8977,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1000}})).newPage();
  page.on('pageerror',e=>console.log('  [err]',e.message.split('\n')[0]));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8977'))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto('http://localhost:8977/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:'11111111-1111-4111-8111-111111111111',staffRole:'owner',userId:'22222222-2222-4222-8222-222222222222',level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'22222222-2222-4222-8222-222222222222'}}));});
  for (const term of ['Uncomplicated Malaria','Complicated/Severe Malaria','Typhoid','Tuberculosis (Tb)']) {
    await page.goto('http://localhost:8977/clinic/new-order.html',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('#confirmedDx',{timeout:15000});
    await page.fill('#confirmedDx', term);
    await page.click('#ucgOneTap');
    await page.waitForTimeout(4000);
    const out = await page.evaluate(()=>{
      const chooser=[...document.querySelectorAll('.ucg-pickrow,.ucg-choice,[data-pick]')].map(e=>e.textContent.trim().replace(/\s+/g,' ').slice(0,70));
      const drugs=[...document.querySelectorAll('.ucg-drug')].map(e=>({t:e.textContent.trim().replace(/\s+/g,' ').slice(0,70), on:e.classList.contains('on')}));
      const title=(document.querySelector('.ucg-title,.ucg-h2,#ucgTitle')||{}).textContent||'';
      const tests=[...document.querySelectorAll('#ucgTests .ucg-test,#ucgTests [data-test]')].map(e=>e.textContent.trim().slice(0,40));
      return {chooser:chooser.slice(0,8), title:title.trim().slice(0,60), drugs:drugs.slice(0,20), tests:tests.slice(0,8)};
    });
    console.log('\n===== typed:', term, '=====');
    console.log('  chooser:', JSON.stringify(out.chooser));
    console.log('  package title:', out.title);
    console.log('  tests:', JSON.stringify(out.tests));
    out.drugs.forEach(d=>console.log('   ', d.on?'[x]':'[ ]', d.t));
  }
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
