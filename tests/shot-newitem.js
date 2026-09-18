const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9082,ORIGIN='http://localhost:'+PORT;
const OUT='/tmp/claude-0/-home-user-homatt-uganda/f3451427-e03d-514d-8f41-e3e6f96e4176/scratchpad/offline-test/';
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  for (const theme of ['light','dark']) {
  const page=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid,th])=>{localStorage.clear(); localStorage.setItem('homatt_theme',th);
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID,theme]);
  await page.goto(ORIGIN+'/clinic/dashboard.html'); await page.waitForTimeout(6000);
  await page.evaluate(async ()=>{
    window.StockIntake.start(null); await new Promise(r=>setTimeout(r,400));
    const i=document.getElementById('stkSearch'); i.value='amoxicillin'; i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<40;k++){await new Promise(r=>setTimeout(r,200));const bx=document.getElementById('stkRes');if(bx&&bx.style.display==='block'&&bx.querySelectorAll('[data-i]').length)break;}
  });
  await page.screenshot({path:OUT+'ni-search-'+theme+'.png'});
  await page.evaluate(async ()=>{
    const h=[...document.getElementById('stkRes').querySelectorAll('[data-i]')].find(d=>/^Amoxicillin 250/.test(d.querySelector('b').textContent));
    h.click(); await new Promise(r=>setTimeout(r,500));
    const set=(id,v)=>{const e=document.getElementById(id);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}};
    set('stkBoxes','5'); set('stkUnitPrice','500'); await new Promise(r=>setTimeout(r,300));
  });
  await page.screenshot({path:OUT+'ni-count-'+theme+'.png'});
  await page.evaluate(()=>{document.getElementById('stkBody').scrollTop=9999;});
  await page.waitForTimeout(300);
  await page.screenshot({path:OUT+'ni-bottom-'+theme+'.png'});
  await page.close();
  }
  await b.close(); server.close(); console.log('shots done');
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
