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
  await new Promise(r=>server.listen(8957,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1000}})).newPage();
  page.on('pageerror',e=>console.log('  [err]',e.message.split('\n')[0]));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8957'))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto('http://localhost:8957/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:'11111111-1111-4111-8111-111111111111',staffRole:'owner',userId:'22222222-2222-4222-8222-222222222222',level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'22222222-2222-4222-8222-222222222222'}}));});
  await page.goto('http://localhost:8957/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#confirmedDx',{timeout:15000});
  await page.fill('#confirmedDx','Typhoid');
  await page.click('#ucgOneTap');
  await page.waitForTimeout(4500);
  const snap = async (label) => {
    const s = await page.evaluate(()=>({
      total:(document.getElementById('ucgTotal')||{}).textContent||'',
      lab:(document.getElementById('ucgFeeL')||{}).value,
      meds:(document.getElementById('ucgFeeM')||{}).value,
      tests:[...document.querySelectorAll('[data-rmtest]')].length,
      drugsOn:[...document.querySelectorAll('.ucg-drug.on')].length,
    }));
    console.log('  ' + label.padEnd(26), JSON.stringify(s));
    return s;
  };
  const a = await snap('after one-tap');
  // tick a couple more drugs so meds has something to price
  const addBtns = await page.$$('.ucg-drug:not(.on)');
  if (addBtns[0]) { await addBtns[0].click(); await page.waitForTimeout(400); }
  if (addBtns[1]) { await addBtns[1].click(); await page.waitForTimeout(400); }
  const b2 = await snap('after ticking 2 drugs');
  // now untick one
  const onBtns = await page.$$('.ucg-drug.on');
  if (onBtns[0]) { await onBtns[0].click(); await page.waitForTimeout(500); }
  const c = await snap('after unticking 1 drug');
  // remove a lab test
  const rm = await page.$('[data-rmtest]');
  if (rm) { await rm.click(); await page.waitForTimeout(500); }
  const d2 = await snap('after removing a test');
  console.log('\n  total changed when drugs/tests changed? ',
    (a.total!==b2.total)||(b2.total!==c.total)||(c.total!==d2.total));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
