// Restocking records a BATCH with its own expiry; the sheet shows the batches
// soonest-first; and on an un-migrated DB it falls back to a flat top-up.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const STOCK=[{id:'p1',clinic_id:CID,item_name:'Coartem',item_type:'medicine',unit:'tabs',
  quantity:80,min_threshold:30,reorder_level:120,strips_per_box:4,units_per_strip:6,last_boxes:2,expiry_date:'2026-06-01'}];
const BATCHES=[
  {id:'b1',clinic_id:CID,inventory_id:'p1',item_name:'Coartem',unit:'tabs',quantity:30,expiry_date:'2026-06-01',expiring_soon:true,expired:false},
  {id:'b2',clinic_id:CID,inventory_id:'p1',item_name:'Coartem',unit:'tabs',quantity:50,expiry_date:'2026-12-01',expiring_soon:false,expired:false}];
async function scenario(batchesDeployed){
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:1100},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const rpcs={};
  await page.route('**/*',r=>{const u=r.request().url(), m=r.request().method();
    if(u.startsWith('http://localhost:9006'))return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/\/rpc\/add_stock_batch/.test(u)){ let a=null; try{a=JSON.parse(r.request().postData()||'null');}catch(e){}
        (rpcs.add_stock_batch=rpcs.add_stock_batch||[]).push(a);
        if(!batchesDeployed) return r.fulfill({status:404,headers:H,body:JSON.stringify(
          {message:"Could not find the function public.add_stock_batch in the schema cache"})});
        return r.fulfill({status:200,headers:H,body:'{"ok":true,"quantity_after":110}'});}
      if(/\/rpc\/adjust_inventory/.test(u)){ let a=null; try{a=JSON.parse(r.request().postData()||'null');}catch(e){}
        (rpcs.adjust_inventory=rpcs.adjust_inventory||[]).push(a);
        return r.fulfill({status:200,headers:H,body:'{"ok":true,"quantity_after":110}'});}
      if(/v_stock_batches/.test(u))
        return r.fulfill({status:200,headers:H,body:JSON.stringify(batchesDeployed?BATCHES:[])});
      if(/\/rpc\/get_clinic_stock/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      if(/\/rest\/v1\/clinic_inventory/.test(u)&&m==='PATCH') return r.fulfill({status:200,headers:H,body:'[]'});
      if(/\/rest\/v1\/clinic_inventory/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});
  await page.goto('http://localhost:9006/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:9006/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(7000);
  // open restock on Coartem
  const opened = await page.evaluate(async ()=>{
    const it=(window._stockItems||[]).find(x=>/coartem/i.test(x.item_name));
    window.StockIntake.start(it||null);
    await new Promise(r=>setTimeout(r,1500));
    const batchTxt=(document.getElementById('stkBatches')||{}).textContent||'';
    return { open:!!document.getElementById('stkBoxes'), batchTxt: batchTxt.replace(/\s+/g,' ').trim() };
  });
  // fill boxes + expiry, save
  await page.evaluate(async ()=>{
    document.getElementById('stkBoxes').value='5';
    document.getElementById('stkBoxes').dispatchEvent(new Event('input',{bubbles:true}));
    const xp=document.getElementById('stkExpiry'); xp.value='2027-05-01'; xp.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    document.getElementById('stkSave').click();
    await new Promise(r=>setTimeout(r,2500));
  });
  await b.close();
  return { opened, rpcs, errs };
}
(async()=>{
  await new Promise(r=>server.listen(9006,r));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  const A = await scenario(true);
  const add = (A.rpcs.add_stock_batch||[])[0]||{};
  result('restock records a BATCH with this delivery\'s expiry',
    (A.rpcs.add_stock_batch||[]).length===1 && add.p_expiry==='2027-05-01' && Number(add.p_qty)===120,
    'qty='+add.p_qty+' expiry='+add.p_expiry);
  result('the sheet lists the existing batches, soonest first, flagged NEXT OUT',
    /1 Jun 2026/.test(A.opened.batchTxt) && /NEXT OUT/.test(A.opened.batchTxt) && /1 Dec 2026/.test(A.opened.batchTxt),
    A.opened.batchTxt.slice(0,120));
  result('no page errors (batches deployed)', A.errs.length===0, A.errs.slice(0,3).join(' | '));

  const B = await scenario(false);
  result('on a database without batches, it falls back to a flat top-up',
    (B.rpcs.add_stock_batch||[]).length===1 && (B.rpcs.adjust_inventory||[]).length===1 &&
    Number((B.rpcs.adjust_inventory[0]||{}).p_qty_change)===120,
    'tried batch='+((B.rpcs.add_stock_batch||[]).length)+' fell-back flat='+((B.rpcs.adjust_inventory||[]).length));
  result('no page errors (un-migrated)', B.errs.length===0, B.errs.slice(0,3).join(' | '));
  server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
