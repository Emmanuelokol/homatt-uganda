const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9110,ORIGIN='http://localhost:'+PORT;
const STOCK=[
 {id:'s1',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',quantity:800,min_threshold:100,is_active:true,selling_price_ugx:200,tabs_per_pack:10,pack_selling_price_ugx:2000},
 {id:'s2',clinic_id:CID,item_name:'Amoxicillin syrup 125mg/5ml',item_type:'medicine',unit:'bottles',quantity:12,min_threshold:3,is_active:true,selling_price_ugx:8000}];
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  for (const vp of [{width:412,height:915,n:'tall'},{width:360,height:640,n:'short'},{width:412,height:420,n:'keyboard-open'},{width:360,height:380,n:'small+keyboard'}]) {
  const page=await (await b.newContext({viewport:{width:vp.width,height:vp.height},serviceWorkers:'block'})).newPage();
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/get_clinic_stock|clinic_inventory/.test(u))return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/dashboard.html'); await page.waitForTimeout(7000);
  const out = await page.evaluate(async ()=>{
    openQuickSale(); await new Promise(r=>setTimeout(r,2000));
    const cards=[...document.querySelectorAll('#qsDrugGrid .qs-drug-card')];
    if(cards[0]) cards[0].click();
    await new Promise(r=>setTimeout(r,900));
    // put a second item in the cart, which opens qsCartWrap
    const add=document.getElementById('qsAddAnother');
    if(add){ add.click(); await new Promise(r=>setTimeout(r,700));
      if(cards[1]) cards[1].click(); await new Promise(r=>setTimeout(r,900)); }
    const sheet=document.getElementById('qsSheet');
    const sell=document.getElementById('qsSellBtn');
    const sr=sheet.getBoundingClientRect(), br=sell.getBoundingClientRect();
    const kids=[...sheet.children].map(c=>({id:c.id||c.className.slice(0,18),
      h:Math.round(c.getBoundingClientRect().height), shrink:getComputedStyle(c).flexShrink}));
    return { sheetH:Math.round(sr.height), sheetBottom:Math.round(sr.bottom),
             sellTop:Math.round(br.top), sellBottom:Math.round(br.bottom), sellH:Math.round(br.height),
             visible: br.height>0 && br.bottom<=sr.bottom+1 && br.top>=sr.top-1,
             sumKids:kids.reduce((s,k)=>s+k.h,0), kids };
  });
  console.log('--- '+vp.n+' '+vp.width+'x'+vp.height);
  console.log('   sheet '+out.sheetH+'px, children total '+out.sumKids+'px  → Sell visible: '+out.visible);
  console.log('   sell top='+out.sellTop+' bottom='+out.sellBottom+' sheetBottom='+out.sheetBottom);
  out.kids.forEach(k=>console.log('      '+String(k.h).padStart(4)+'px shrink='+k.shrink+'  '+k.id));
  await page.close();
  }
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
