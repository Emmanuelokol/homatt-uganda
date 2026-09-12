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
  await new Promise(r=>server.listen(8995,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  for(const theme of ['light','dark']){
  const page=await (await b.newContext({viewport:{width:430,height:1000},deviceScaleFactor:2,hasTouch:true})).newPage();
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8995'))return r.continue();
    if(u.startsWith(SB)){const body=/clinic_diagnoses/.test(u)?JSON.stringify([{patient_name:'Okello John',patient_phone:'0771234567',total_charged_ugx:25000,amount_paid:0,created_at:'2026-08-12T09:00:00Z',case_code:'HC-0042'}]):'[]';
      return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body});}
    return r.abort();});
  await page.goto('http://localhost:8995/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(t=>{localStorage.clear();localStorage.setItem('homatt_theme',t);
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:'11111111-1111-4111-8111-111111111111',staffRole:'owner',userId:'22222222-2222-4222-8222-222222222222',level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'22222222-2222-4222-8222-222222222222'}}));},theme);
  await page.goto('http://localhost:8995/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#itTab1');
  await page.fill('#quickPatientName','Okello John');
  await page.fill('#quickPatientPhone','0771234567');
  await page.click('#itTab2'); await page.fill('#itTemp','39.4'); await page.fill('#itPulse','124');
  await page.fill('#itSbp','118'); await page.fill('#itDbp','76'); await page.fill('#itWeight','24');
  await page.click('#itTab1');
  await page.fill('#itChief','fever headache');
  await page.fill('#itSubjective','joint pain and vomiting for 2 days, no appetite');
  await page.click('#itTab3'); await page.fill('#itBackground','Known sickle cell. Mother treated for TB last year.');
  await page.click('#itTab1');
  await page.waitForTimeout(1800);
  await page.screenshot({path:'intake-'+theme+'.png',fullPage:true});
  await page.click('#itTab2'); await page.waitForTimeout(300);
  await page.screenshot({path:'intake-vitals-'+theme+'.png',fullPage:false});
  await page.close();
  }
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
