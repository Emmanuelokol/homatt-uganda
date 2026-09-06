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
  await new Promise(r=>server.listen(8992,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  for (const theme of ['light','dark']){
  const page=await (await b.newContext({viewport:{width:430,height:1100},deviceScaleFactor:2,hasTouch:true})).newPage();
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8992'))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto('http://localhost:8992/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(t=>{localStorage.clear();localStorage.setItem('homatt_theme',t);
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:'11111111-1111-4111-8111-111111111111',staffRole:'owner',userId:'22222222-2222-4222-8222-222222222222',level:'HC3'}));},theme);
  await page.goto('http://localhost:8992/clinic/guidelines.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!document.getElementById('gSearch').disabled,{timeout:30000});
  await page.click('.g-book-btn[data-book="who"]');
  await page.waitForFunction(()=>/conditions/.test(document.getElementById('gDbInfo').textContent),{timeout:60000});
  await page.click('.g-mode-btn[data-mode="doses"]');
  await page.fill('#gSearch','amoxicillin');
  await page.waitForSelector('.g-ac-item'); await page.click('.g-ac-item');
  await page.waitForSelector('#gCard .g-doses');
  await page.fill('#gWeight','11'); await page.waitForTimeout(700);
  await page.screenshot({path:'who-dose-'+theme+'.png',fullPage:true});
  // and the condition view
  await page.click('.g-mode-btn[data-mode="conditions"]');
  await page.fill('#gSearch','pneumonia');
  await page.waitForSelector('.g-ac-item'); await page.click('.g-ac-item');
  await page.waitForSelector('#gCard .g-head h2'); await page.waitForTimeout(400);
  await page.screenshot({path:'who-cond-'+theme+'.png',fullPage:true});
  await page.close();
  }
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
