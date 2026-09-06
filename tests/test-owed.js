// A medicine given in a consultation but never registered in the Stock Tracker
// must appear there by itself, owed (negative), and be TAPPABLE — straight into
// the restock sheet, no searching. And a second consultation for the same
// medicine must add to the debt, not start a new one.
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

// The shelf as the server sees it after two consultations gave out Artesunate
// that was never bought: 6 + 9 = 15 owed.
let STOCK=[
  {id:'s-owed',clinic_id:CID,item_name:'Artesunate 50mg',item_type:'medicine',unit:'tabs',
   quantity:-15,min_threshold:5,reorder_level:10,is_active:true,is_low_stock:true,is_critical:false},
  {id:'s-ok',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',
   quantity:400,min_threshold:50,reorder_level:100,is_active:true,is_low_stock:false,is_critical:false},
];

(async()=>{
  await new Promise(r=>server.listen(9014,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:1100},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const seen={inserted:[],deducts:[]};

  await page.route('**/*',r=>{const rq=r.request(),u=rq.url(),m=rq.method();
    if(u.startsWith('http://localhost:9014')) return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/\/rpc\/get_clinic_stock/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      if(/\/rpc\/deduct_inventory/.test(u)){let a=null;try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        seen.deducts.push(a); return r.fulfill({status:200,headers:H,body:'{"ok":true,"low_stock":[]}'});}
      if(/\/rest\/v1\/clinic_inventory/.test(u)&&m==='POST'){let a=null;try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a; seen.inserted.push(row);
        return r.fulfill({status:201,headers:H,body:JSON.stringify({id:row.id||'srv-new'})});}
      if(/\/rest\/v1\/clinic_diagnoses/.test(u)&&m==='POST'){let a=null;try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a;
        return r.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'44444444-4444-4444-8444-444444444444'},row))});}
      if(/v_stock_batches/.test(u)) return r.fulfill({status:200,headers:H,body:'[]'});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});

  await page.goto('http://localhost:9014/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  // ── A. The Stock Tracker shows it, owed, and the alert is tappable ────────
  await page.goto('http://localhost:9014/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(7000);

  const alert = await page.evaluate(()=>{
    const banner=document.getElementById('lowStockBanner');
    const pills=[...document.querySelectorAll('#lowStockList [data-restock]')];
    return { shown: banner?getComputedStyle(banner).display:'missing',
             count:(document.getElementById('lowStockCount')||{}).textContent||'',
             pills:pills.map(p=>p.textContent.replace(/\s+/g,' ').trim()),
             tappable:pills.length>0 && pills.every(p=>p.tagName==='BUTTON') };
  });
  result('the medicine the clinic owes shows as its own alert',
    alert.shown!=='none' && /1 owed/.test(alert.count) &&
    alert.pills.some(t=>/Artesunate 50mg — short by 15 tabs/.test(t)),
    'count="'+alert.count+'" '+JSON.stringify(alert.pills));

  const card = await page.evaluate(async ()=>{
    if (window._svOpen) window._svOpen('stock');
    else document.querySelector('[data-slide="stock"]').click();
    await new Promise(r=>setTimeout(r,1200));
    const cards=[...document.querySelectorAll('.stock-card')];
    const owed=cards.find(c=>/Artesunate/.test(c.textContent));
    return { n:cards.length,
             text: owed?owed.textContent.replace(/\s+/g,' ').trim():'',
             pill: owed?(owed.querySelector('.pill-s')||{}).textContent||'':'',
             restock: owed?!!owed.querySelector('[data-restock]'):false };
  });
  result('in the Stock Tracker it reads OWED, with its own + Restock button',
    card.pill==='OWED' && /short by 15 tabs/.test(card.text) && card.restock,
    'pill="'+card.pill+'" restock='+card.restock+' "'+card.text.slice(0,70)+'"');

  const tapped = await page.evaluate(async ()=>{
    const p=document.querySelector('#lowStockList [data-restock]');
    p.click();
    await new Promise(r=>setTimeout(r,1500));
    return { title:(document.getElementById('stkTitle')||{}).textContent||'',
             sub:(document.getElementById('stkSub')||{}).textContent||'',
             shelf:(document.querySelector('.stk-known')||{}).textContent||'',
             asksBoxes:!!document.getElementById('stkBoxes'),
             asksStrips:!!document.getElementById('stkStrips'),
             asksExpiry:!!document.getElementById('stkExpiry') };
  });
  result('tapping the alert opens the restock sheet on that medicine — no searching',
    /Artesunate 50mg/.test(tapped.title) && tapped.asksBoxes &&
    /short by 15 tabs/.test(tapped.shelf),
    'title="'+tapped.title+'" shelf="'+tapped.shelf.slice(0,50)+'"');
  result('being brand new, it asks the three pack questions and the expiry',
    tapped.asksBoxes && tapped.asksStrips && tapped.asksExpiry,
    'boxes='+tapped.asksBoxes+' strips='+tapped.asksStrips+' expiry='+tapped.asksExpiry);
  await page.screenshot({path:'owed.png'});

  // ── B. A second consultation adds to the SAME debt ────────────────────────
  async function consult(){
    // The wizard boots asynchronously (it opens two bundled databases first);
    // give it as long as it needs, and reload once if it never arrives.
    for (let attempt=0; attempt<3; attempt++) {
      await page.goto('http://localhost:9014/clinic/new-order.html',{waitUntil:'domcontentloaded'});
      try { await page.waitForFunction(()=>!!window._wizState,{timeout:20000}); break; }
      catch (e) { if (attempt===2) throw new Error('the wizard never finished loading'); }
    }
    await page.waitForTimeout(2000);
    await page.evaluate(()=>{const st=window._wizState;
      st.patient={name:'Owed Test',phone:'',id:null,clinicPatientId:null};
      st.patientType='outpatient'; st.severity='moderate'; st.materialsUsed=st.materialsUsed||[];
      st.medications=[{drug:'Artesunate 50mg',dosage:'50mg',timesPerDay:1,intakeTimes:['08:00'],
                       durationDays:3,inventoryItemId:null,qtyToDeduct:6}];
      st.confirmedDx='Malaria'; st.feeConsult=5000; st.paymentStatus='paid';});
    // Send it the way the last screen does (the button lives on the final step).
    await page.evaluate(()=>{ document.getElementById('submitBtn').click(); });
    await page.waitForTimeout(4500);
  }
  seen.deducts.length=0; seen.inserted.length=0;
  await consult();
  const firstDeduct=(seen.deducts[0]||{}).p_items||[];
  result('the first consultation links the medicine to the shelf slot it owes',
    firstDeduct.length===1 && firstDeduct[0].item_id==='s-owed' && firstDeduct[0].qty===6 &&
    seen.inserted.length===0,
    'deducted='+JSON.stringify(firstDeduct)+' newRows='+seen.inserted.length);

  seen.deducts.length=0;
  await consult();
  const secondDeduct=(seen.deducts[0]||{}).p_items||[];
  result('a second consultation deducts from the SAME slot — the debt adds up',
    secondDeduct.length===1 && secondDeduct[0].item_id==='s-owed' &&
    seen.inserted.length===0,
    'deducted='+JSON.stringify(secondDeduct)+' newRows='+seen.inserted.length);

  result('no page errors', errs.length===0, errs.slice(0,4).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
