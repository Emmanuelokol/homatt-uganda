// The reported bug: on a database WITHOUT the pack columns, adding an item the
// first time and coming back a second time still asked all three questions.
// Plus: an expiry date per batch.
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
// Un-migrated DB: no strips_per_box/units_per_strip/expiry_date columns. Any
// insert/patch that names them is REJECTED, exactly like PostgREST would.
let STOCK=[];
(async()=>{
  await new Promise(r=>server.listen(9004,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:1100},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const inserts=[];
  function hasPackCol(o){ return o && (('strips_per_box' in o)||('units_per_strip' in o)||('last_boxes' in o)||('expiry_date' in o)); }
  await page.route('**/*',r=>{const u=r.request().url(), m=r.request().method();
    if(u.startsWith('http://localhost:9004'))return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/\/rpc\/adjust_inventory/.test(u)) return r.fulfill({status:200,headers:H,body:'{"ok":true,"quantity_after":0}'});
      if(/\/rest\/v1\/clinic_inventory/.test(u)&&m==='POST'){ let a=null; try{a=JSON.parse(r.request().postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a;
        if(hasPackCol(row)) return r.fulfill({status:400,headers:H,body:JSON.stringify(
          {message:"Could not find the 'strips_per_box' column of 'clinic_inventory' in the schema cache"})});
        inserts.push(row);
        const saved=Object.assign({id:'panadol1'},row); STOCK=[saved];
        return r.fulfill({status:201,headers:H,body:JSON.stringify(saved)});}
      if(/\/rest\/v1\/clinic_inventory/.test(u)&&m==='PATCH'){ let a=null; try{a=JSON.parse(r.request().postData()||'null');}catch(e){}
        if(hasPackCol(a)) return r.fulfill({status:400,headers:H,body:JSON.stringify(
          {message:"Could not find the 'expiry_date' column of 'clinic_inventory' in the schema cache"})});
        return r.fulfill({status:200,headers:H,body:'[]'});}
      if(/\/rpc\/get_clinic_stock/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      if(/\/rest\/v1\/clinic_inventory/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});
  await page.goto('http://localhost:9004/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:9004/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(7000);

  // FIRST TIME: add Panadol as a new item — three questions + expiry.
  const first = await page.evaluate(async ()=>{
    window.openStockIntake();
    await new Promise(r=>setTimeout(r,600));
    const i=document.getElementById('stkSearch');
    i.value='Panadol'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,700));
    (document.querySelector('#stkRes [data-new]')||document.querySelector('#stkRes div')).click();
    await new Promise(r=>setTimeout(r,500));
    // Panadol is a brand the national list does not carry, so the one thing
    // that cannot be worked out is asked: medicine, or counter item?
    const askedKind = !!document.querySelector('.stk-kind [data-k="medicine"]');
    const km=document.querySelector('.stk-kind [data-k="medicine"]');
    if (km) { km.click(); await new Promise(r=>setTimeout(r,500)); }
    const three = !!document.getElementById('stkStrips') && !!document.getElementById('stkUnits');
    const hasExpiry = !!document.getElementById('stkExpiry');
    document.getElementById('stkBoxes').value='10';
    document.getElementById('stkStrips').value='10';
    document.getElementById('stkUnits').value='10';
    ['stkBoxes','stkStrips','stkUnits'].forEach(id=>document.getElementById(id).dispatchEvent(new Event('input',{bubbles:true})));
    const xp=document.getElementById('stkExpiry'); xp.value='2027-03-01'; xp.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    document.getElementById('stkSave').click();
    await new Promise(r=>setTimeout(r,2500));
    return { three, hasExpiry, askedKind };
  });
  result('a brand the national list does not carry is added anyway, after one question',
    first.askedKind, 'kind-asked='+first.askedKind);
  result('first time asks all three questions and offers an expiry date',
    first.three && first.hasExpiry, 'three='+first.three+' expiry='+first.hasExpiry);
  result('it saved on an un-migrated database (the pack columns were stripped)',
    inserts.length>=1 && inserts.every(o=>!('strips_per_box' in o)),
    'inserts='+inserts.length);

  // SECOND TIME: reopen Panadol — must ask ONLY for boxes, template remembered.
  await page.waitForTimeout(1500);
  const second = await page.evaluate(async ()=>{
    window.openStockIntake();
    await new Promise(r=>setTimeout(r,600));
    const i=document.getElementById('stkSearch');
    i.value='Panadol'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,700));
    // pick the "in your stock" row
    const rows=[...document.querySelectorAll('#stkRes [data-i]')];
    (rows[0]||document.querySelector('#stkRes div')).click();
    await new Promise(r=>setTimeout(r,500));
    return { askedBoxes: !!document.getElementById('stkBoxes'),
             askedStrips: !!document.getElementById('stkStrips'),
             askedUnits: !!document.getElementById('stkUnits'),
             known:[...document.querySelectorAll('.stk-known')].map(x=>x.textContent.replace(/\s+/g,' ').trim()).join(' | '),
             sub:(document.getElementById('stkSub')||{}).textContent||'' };
  });
  result('second time asks ONLY for boxes — the pack size is remembered',
    second.askedBoxes && !second.askedStrips && !second.askedUnits && /10 strips/.test(second.known),
    'strips-asked='+second.askedStrips+' units-asked='+second.askedUnits+' "'+second.known.slice(0,80)+'"');

  // The expiry field is on the second visit too, since each batch differs.
  const batchExp = await page.evaluate(()=>!!document.getElementById('stkExpiry'));
  result('a new expiry can be entered for the new batch', batchExp);

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
