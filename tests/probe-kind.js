const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9078,ORIGIN='http://localhost:'+PORT;
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1200},serviceWorkers:'block'})).newPage();
  page.on('pageerror',e=>console.log('ERR',e.message.split('\n')[0]));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(6000);
  const out = await page.evaluate(async ()=>{
    window.StockIntake.start(null);
    await new Promise(r=>setTimeout(r,400));
    const i=document.getElementById('stkSearch');
    i.value='condom'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,1500));
    const raw = window.StockIntake.suggest('condom');
    const dom = [...document.getElementById('stkRes').querySelectorAll('[data-i]')]
      .map(d=>({i:d.dataset.i, n:d.querySelector('b').textContent, t:d.querySelector('.t').textContent}));
    const c = [...document.getElementById('stkRes').querySelectorAll('[data-i]')]
      .find(d=>/^Condoms \(male\)/.test(d.querySelector('b').textContent));
    c.click();
    await new Promise(r=>setTimeout(r,400));
    return { raw: raw.map(h=>({n:h.name,t:h.itemType,tag:h.tag})), dom,
             sub: document.getElementById('stkSub').textContent };
  });
  console.log(JSON.stringify(out,null,1));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
