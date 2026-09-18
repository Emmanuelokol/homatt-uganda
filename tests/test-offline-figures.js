// Everything must still be there with the phone offline: the money, the
// patients, and the Quick Sale stock — including after a consultation has been
// recorded, which is exactly when a clinic goes back out of signal.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9060';

const TODAY = new Date().toISOString().slice(0,10);
const DX = [
  {id:'d1',clinic_id:CID,confirmed_diagnosis:'Malaria',severity:'moderate',patient_name:'Okello John',
   patient_phone:'0788000111',case_code:'#001M0101O',total_charged_ugx:45000,amount_paid:45000,
   payment_status:'paid',created_at:TODAY+'T09:10:00Z',prescription_items:[{drug_name:'Coartem',strength:'20/120mg'}]},
  {id:'d2',clinic_id:CID,confirmed_diagnosis:'Typhoid',severity:'moderate',patient_name:'Aciro Grace',
   patient_phone:'0788000222',case_code:'#002T0101O',total_charged_ugx:30000,amount_paid:0,
   payment_status:'credit',created_at:TODAY+'T10:40:00Z',prescription_items:[{drug_name:'Ciprofloxacin',strength:'500mg'}]},
];
const STOCK = [
  {id:'s1',clinic_id:CID,item_name:'Coartem 20/120mg',item_type:'medicine',unit:'tabs',quantity:240,
   min_threshold:30,reorder_level:60,is_active:true,is_low_stock:false,is_critical:false,selling_price_ugx:1500},
  {id:'s2',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',quantity:800,
   min_threshold:100,reorder_level:200,is_active:true,is_low_stock:false,is_critical:false,selling_price_ugx:200},
];
const PAY = [{id:'p1',clinic_id:CID,amount_ugx:45000,method:'cash',created_at:TODAY+'T09:12:00Z'}];

(async()=>{
  await new Promise(r=>server.listen(9060,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:1200},deviceScaleFactor:2,serviceWorkers:'block'});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  let offline=false;
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN)) return r.continue();
    if(u.startsWith(SB)){
      if(offline) return r.abort();                       // no signal at all
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/get_clinic_stock/.test(u))       return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      if(/clinic_inventory\b/.test(u))     return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      if(/clinic_diagnoses/.test(u)&&rq.method()==='POST'){let a=null;try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a;
        return r.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'new1'},row))});}
      if(/clinic_diagnoses/.test(u))       return r.fulfill({status:200,headers:H,body:JSON.stringify(DX)});
      if(/clinic_payments/.test(u))        return r.fulfill({status:200,headers:H,body:JSON.stringify(PAY)});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  // ── 1. A normal day online: the dashboard and Quick Sale are both opened ──
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(9000);
  await page.evaluate(async ()=>{
    if (window.showSlide) showSlide('money');
    await new Promise(r=>setTimeout(r,1500));
    if (window.openQuickSale) openQuickSale();
    else { const b=[...document.querySelectorAll('button,a')].find(x=>/quick sale/i.test(x.textContent)); if(b) b.click(); }
    await new Promise(r=>setTimeout(r,3000));
  });
  await page.waitForTimeout(2000);
  const cachedAfterOpen = await page.evaluate(()=>Object.keys(localStorage)
    .filter(k=>k.indexOf('_co_')===0).map(k=>k.slice(4).replace(/[0-9a-f-]{36}$/,'…')).sort());
  result('opening the app online saves the money, the patients and the stock for offline',
    cachedAfterOpen.some(k=>/revenue_/.test(k)) && cachedAfterOpen.some(k=>/consultations_today_/.test(k)) &&
    cachedAfterOpen.some(k=>/qs_inventory_/.test(k)),
    JSON.stringify(cachedAfterOpen).slice(0,220));

  // ── 2. Record a consultation, the way a clinic does all day ──────────────
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{const st=window._wizState;
    st.patient={name:'Third Patient',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    st.confirmedDx='Malaria'; st.feeConsult=10000; st.paymentStatus='paid';
    st.medications=[{drug:'Coartem',dosage:'20/120mg',timesPerDay:2,intakeTimes:['08:00','20:00'],
                     durationDays:3,inventoryItemId:'s1',qtyToDeduct:6}];
    document.getElementById('submitBtn').click();});
  await page.waitForTimeout(6000);

  const cachedAfterSave = await page.evaluate(()=>Object.keys(localStorage)
    .filter(k=>k.indexOf('_co_')===0).map(k=>k.slice(4).replace(/[0-9a-f-]{36}$/,'…')).sort());
  const lost = cachedAfterOpen.filter(k=>cachedAfterSave.indexOf(k)<0);
  result('saving a consultation does NOT throw away the offline copies',
    lost.length===0, lost.length ? 'LOST: '+JSON.stringify(lost) : cachedAfterSave.length+' still saved');

  // ── 3. Now the signal goes ───────────────────────────────────────────────
  offline = true;
  await ctx.addInitScript(()=>{ Object.defineProperty(navigator,'onLine',{get(){return false;},configurable:true}); });
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(9000);

  const money = await page.evaluate(async ()=>{
    if (window.showSlide) showSlide('money');
    await new Promise(r=>setTimeout(r,2500));
    const t=id=>{const e=document.getElementById(id); return e?e.textContent.replace(/\s+/g,' ').trim():'(missing)';};
    return { collected:t('finCollected'), demanded:t('finRevenue'), outstanding:t('finOutstanding'),
             margin:t('finMargin'), stockCost:t('finStockCost'), patients:t('finPatients') };
  });
  const blank = Object.entries(money).filter(([k,v])=>!v || v==='—' || v==='-' || v==='(missing)');
  result('offline, the money figures are still there',
    blank.length===0, JSON.stringify(money));

  const patients = await page.evaluate(async ()=>{
    if (window.showSlide) showSlide('patients');
    await new Promise(r=>setTimeout(r,2500));
    return { rows:document.querySelectorAll('.pt-row').length,
             text:(document.body.textContent.match(/Okello John|Aciro Grace/g)||[]).length };
  });
  result('offline, the patients seen today are still listed',
    patients.rows>0 || patients.text>0, JSON.stringify(patients));

  const qs = await page.evaluate(async ()=>{
    if (window.showSlide) showSlide('home');
    await new Promise(r=>setTimeout(r,800));
    if (window.openQuickSale) openQuickSale();
    else { const b=[...document.querySelectorAll('button,a')].find(x=>/quick sale/i.test(x.textContent)); if(b) b.click(); }
    await new Promise(r=>setTimeout(r,3000));
    const body=document.body.textContent;
    const cid=(JSON.parse(localStorage.getItem('clinic_session')||'{}')||{}).clinicId;
    let saved=null; try{ saved=JSON.parse(localStorage.getItem('_co_qs_inventory_'+cid)||'null'); }catch(e){}
    // where is that message, and can the clinician actually see it?
    const hits=[];
    document.querySelectorAll('*').forEach(el=>{
      if(el.children.length) return;
      if(!/No saved stock yet/i.test(el.textContent||'')) return;
      const r=el.getBoundingClientRect(), cs=getComputedStyle(el);
      hits.push({where:(el.parentElement&&(el.parentElement.id||el.parentElement.className))||'?',
                 visible: r.width>0&&r.height>0&&cs.display!=='none'&&cs.visibility!=='hidden'});
    });
    return { msgVisible: hits.some(h=>h.visible), where: hits.slice(0,2),
             items:document.querySelectorAll('.qs-drug-card').length,
             savedCount: saved && saved.v ? saved.v.length : 'no entry' };
  });
  result('offline, Quick Sale still has the stock it saved',
    !qs.msgVisible && qs.items>0, JSON.stringify(qs));

  // ── A clinic that only ever used the Stock Tracker ──────────────────────
  // It has its shelf saved under the tracker's key. Quick Sale should sell
  // from that rather than claiming nothing is saved.
  const fallback = await page.evaluate(async ()=>{
    const cid=(JSON.parse(localStorage.getItem('clinic_session')||'{}')||{}).clinicId;
    localStorage.removeItem('_co_qs_inventory_'+cid);      // never opened Quick Sale
    if (!localStorage.getItem('_co_stock_'+cid)) return { skipped:true };
    location.reload();
    return { reloaded:true };
  });
  await page.waitForTimeout(9000);
  const fb = await page.evaluate(async ()=>{
    if (window.openQuickSale) openQuickSale();
    else { const b=[...document.querySelectorAll('button,a')].find(x=>/quick sale/i.test(x.textContent)); if(b) b.click(); }
    await new Promise(r=>setTimeout(r,3000));
    const cid=(JSON.parse(localStorage.getItem('clinic_session')||'{}')||{}).clinicId;
    return { hadQs: !!localStorage.getItem('_co_qs_inventory_'+cid),
             items: document.querySelectorAll('.qs-drug-card').length };
  });
  result('a clinic that only used the Stock Tracker can still sell offline',
    fb.items>0, JSON.stringify(Object.assign({},fallback,fb)));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'offline-money.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
