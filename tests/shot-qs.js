const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9093,ORIGIN='http://localhost:'+PORT;
const OUT='/tmp/claude-0/-home-user-homatt-uganda/f3451427-e03d-514d-8f41-e3e6f96e4176/scratchpad/offline-test/';
const STOCK=[
 {id:'s1',clinic_id:CID,item_name:'Amoxicillin 500',item_type:'medicine',unit:'tabs',quantity:194,min_threshold:10,is_active:true},
 {id:'s2',clinic_id:CID,item_name:'ampiclox',item_type:'medicine',unit:'tabs',quantity:104,min_threshold:10,is_active:true,selling_price_ugx:300}];
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  for(const theme of ['dark','light']){
  const page=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/get_clinic_stock|clinic_inventory/.test(u))return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid,th])=>{localStorage.clear(); localStorage.setItem('homatt_theme',th);
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID,theme]);
  await page.goto(ORIGIN+'/clinic/dashboard.html'); await page.waitForTimeout(6000);
  await page.evaluate(async ()=>{ openQuickSale(); await new Promise(r=>setTimeout(r,2000));
    const s=document.getElementById('qsSearch'); s.value='c'; s.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400)); });
  await page.screenshot({path:OUT+'qs-'+theme+'.png'});
  await page.evaluate(async ()=>{ const s=document.getElementById('qsSearch'); s.value='Coartem'; s.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,400)); });
  await page.screenshot({path:OUT+'qs-nomatch-'+theme+'.png'});
  await page.close();
  }
  await b.close(); server.close(); console.log('ok');
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
