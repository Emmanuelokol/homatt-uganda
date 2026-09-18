// Restock in seconds: type "coar", answer three questions, app does the maths.
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
// A shelf that has gone NEGATIVE: 20 tablets were dispensed that weren't there.
const STOCK=[
 {id:'s1',clinic_id:CID,item_name:'Coartem 20/120mg',item_type:'medicine',unit:'tabs',
  quantity:-20,min_threshold:30,reorder_level:120,unit_cost_ugx:500,
  is_low_stock:true,is_critical:true,strips_per_box:4,units_per_strip:6,last_boxes:5},
 {id:'s2',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',
  quantity:480,min_threshold:100,reorder_level:200,unit_cost_ugx:50,is_low_stock:false,is_critical:false}];
(async()=>{
  await new Promise(r=>server.listen(9002,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const rpcs=[], inserts=[], patches=[];
  await page.route('**/*',r=>{const u=r.request().url(), m=r.request().method();
    if(u.startsWith('http://localhost:9002'))return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/\/rpc\/(adjust_inventory|add_stock_batch)/.test(u)){ let a=null; try{a=JSON.parse(r.request().postData()||'null');}catch(e){}
        rpcs.push(a); return r.fulfill({status:200,headers:H,body:'{"ok":true,"quantity_after":100}'});}
      if(/\/rest\/v1\/clinic_inventory/.test(u)&&m==='POST'){ let a=null; try{a=JSON.parse(r.request().postData()||'null');}catch(e){}
        inserts.push(a); return r.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'new1'},a))});}
      if(/\/rest\/v1\/clinic_inventory/.test(u)&&m==='PATCH'){ let a=null; try{a=JSON.parse(r.request().postData()||'null');}catch(e){}
        patches.push(a); return r.fulfill({status:200,headers:H,body:'[]'});}
      if(/\/rpc\/get_clinic_stock/.test(u))
        return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      if(/\/rest\/v1\/clinic_inventory/.test(u))
        return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});
  await page.goto('http://localhost:9002/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:9002/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(7000);

  // 1. The alarm names what is owed and is tappable.
  const alarm = await page.evaluate(()=>{
    const b=document.getElementById('lowStockBanner');
    return { shown:b&&getComputedStyle(b).display!=='none',
      count:(document.getElementById('lowStockCount')||{}).textContent||'',
      text:(document.getElementById('lowStockList')||{}).textContent.replace(/\s+/g,' ').trim(),
      tappable:!!document.querySelector('#lowStockList [data-restock]') };
  });
  result('the alarm says what has been dispensed but not bought',
    alarm.shown && /short by 20 tabs/i.test(alarm.text) && alarm.tappable,
    'count="'+alarm.count+'" "'+alarm.text.slice(0,70)+'"');

  // 2. Known item → ONE question, template already applied.
  const known = await page.evaluate(async ()=>{
    document.querySelector('#lowStockList [data-restock]').click();
    await new Promise(r=>setTimeout(r,900));
    const ov=document.getElementById('stkOverlay');
    return { open: ov&&getComputedStyle(ov).display!=='none',
      title:(document.getElementById('stkTitle')||{}).textContent||'',
      sub:(document.getElementById('stkSub')||{}).textContent||'',
      askedBoxes:!!document.getElementById('stkBoxes'),
      askedStrips:!!document.getElementById('stkStrips'),
      known:[...document.querySelectorAll('.stk-known')].map(x=>x.textContent.replace(/\s+/g,' ').trim()).join(' | ') };
  });
  result('a medicine stocked before asks only how many boxes',
    known.open && known.askedBoxes && !known.askedStrips && /4 blisters/.test(known.known),
    'title="'+known.title+'" "'+known.known.slice(0,90)+'"');

  // 3. The arithmetic, shown in full.
  const calc = await page.evaluate(async ()=>{
    const bx=document.getElementById('stkBoxes');
    bx.value='5'; bx.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    return { sum:(document.getElementById('stkSum')||{}).textContent.replace(/\s+/g,' ').trim(),
             canSave:!document.getElementById('stkSave').disabled };
  });
  await page.screenshot({path:'stock-sheet.png'});
  result('5 boxes x 4 blisters x 6 tabs = 120, and it clears the shortfall',
    /5 boxes × 4 blisters × 6 tabs/.test(calc.sum) && /120 tabs/.test(calc.sum) &&
    /Clears a shortfall of 20/.test(calc.sum) && /100 tabs/.test(calc.sum) && calc.canSave,
    calc.sum.slice(0,130));

  // 4. Saving sends the right amount and remembers the template.
  await page.evaluate(()=>document.getElementById('stkSave').click());
  await page.waitForTimeout(2500);
  const sent = rpcs[0]||{};
  var _addQty = Number(sent.p_qty_change) || Number(sent.p_qty);
  result('saving adds exactly 120 units (as a batch) and records how it was counted',
    _addQty===120 && /5 box/.test(sent.p_notes||''),
    JSON.stringify(sent).slice(0,120));
  result('the pack template is stored for next time',
    patches.some(p=>Number(p.strips_per_box)===4&&Number(p.units_per_strip)===6&&Number(p.last_boxes)===5),
    JSON.stringify(patches[0]||null));

  // 5. A brand-new medicine: search suggests it, three questions, creates it.
  const fresh = await page.evaluate(async ()=>{
    window.openStockIntake();
    await new Promise(r=>setTimeout(r,600));
    const i=document.getElementById('stkSearch');
    i.value='coar'; i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<40;k++){ await new Promise(r=>setTimeout(r,250));
      if(document.querySelectorAll('#stkRes div').length) break; }
    const items=[...document.querySelectorAll('#stkRes div')].map(x=>x.textContent.replace(/\s+/g,' ').trim());
    return { items };
  });
  result('typing "coar" suggests Coartem',
    fresh.items.length>0 && /coartem/i.test(fresh.items.join(' ')),
    JSON.stringify(fresh.items).slice(0,150));

  const made = await page.evaluate(async ()=>{
    const i=document.getElementById('stkSearch');
    i.value='Amoxicillin 250 mg'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,700));
    const nw=document.querySelector('#stkRes [data-new]') || document.querySelector('#stkRes div');
    nw.click(); await new Promise(r=>setTimeout(r,500));
    const three = !!document.getElementById('stkStrips') && !!document.getElementById('stkUnits');
    document.getElementById('stkBoxes').value='2';
    document.getElementById('stkStrips').value='10';
    document.getElementById('stkUnits').value='10';
    ['stkBoxes','stkStrips','stkUnits'].forEach(id=>document.getElementById(id)
      .dispatchEvent(new Event('input',{bubbles:true})));
    await new Promise(r=>setTimeout(r,300));
    const sum=(document.getElementById('stkSum')||{}).textContent.replace(/\s+/g,' ').trim();
    document.getElementById('stkSave').click();
    await new Promise(r=>setTimeout(r,2500));
    return { three, sum };
  });
  result('a new medicine asks all three questions',
    made.three && /2 boxes × 10 strips × 10 caps/.test(made.sum) && /200 caps/.test(made.sum),
    made.sum.slice(0,110));
  const ins = inserts[0]||{};
  result('the new item is created with the total and its template',
    Number(ins.quantity)===200 && Number(ins.strips_per_box)===10 && Number(ins.units_per_strip)===10,
    JSON.stringify(ins).slice(0,140));
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'stock.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
