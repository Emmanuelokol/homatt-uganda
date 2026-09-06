// Two faults: the Sell button vanished once the keyboard was up, and a course
// of syrup came off the shelf as one bottle PER DOSE.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9111,ORIGIN='http://localhost:'+PORT;
const STOCK=[
 {id:'s1',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',
  quantity:800,min_threshold:100,is_active:true,selling_price_ugx:200},
 {id:'s2',clinic_id:CID,item_name:'Amoxicillin 125mg/5ml',item_type:'medicine',unit:'bottles',
  quantity:12,min_threshold:3,is_active:true,selling_price_ugx:8000},
 {id:'s3',clinic_id:CID,item_name:'Salbutamol',item_type:'medicine',unit:'inhalers',
  quantity:6,min_threshold:2,is_active:true,selling_price_ugx:15000}];

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const errs=[];

  // ── 1. The Sell button, at every height a phone can give it ─────────────
  for (const vp of [{w:412,h:915,n:'normal'},{w:360,h:640,n:'small phone'},
                    {w:412,h:420,n:'keyboard up'},{w:360,h:380,n:'small + keyboard'}]) {
    const page=await (await b.newContext({viewport:{width:vp.w,height:vp.h},serviceWorkers:'block'})).newPage();
    page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
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
    const seen = await page.evaluate(async ()=>{
      openQuickSale(); await new Promise(r=>setTimeout(r,1800));
      const cards=[...document.querySelectorAll('#qsDrugGrid .qs-drug-card')];
      if(cards[0]) cards[0].click();
      await new Promise(r=>setTimeout(r,900));
      const add=document.getElementById('qsAddAnother');
      if(add){ add.click(); await new Promise(r=>setTimeout(r,600));
        if(cards[1]) cards[1].click(); await new Promise(r=>setTimeout(r,800)); }
      const sh=document.getElementById('qsSheet').getBoundingClientRect();
      const s=document.getElementById('qsSellBtn').getBoundingClientRect();
      return { ok: s.height>0 && s.bottom<=sh.bottom+1 && s.top>=sh.top-1,
               overflow: Math.round(s.bottom - sh.bottom) };
    });
    result('the Sell button stays on screen — '+vp.n+' ('+vp.w+'x'+vp.h+')',
      seen.ok, seen.ok ? '' : (seen.overflow+'px below the sheet'));
    await page.close();
  }

  // ── 2. Liquids come off the shelf as containers, not doses ──────────────
  const page=await (await b.newContext({viewport:{width:430,height:1300},serviceWorkers:'block'})).newPage();
  page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
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
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);

  // The shelf the wizard matches against
  await page.evaluate((stock)=>{ window._wizState.clinicInventory = stock; }, STOCK);

  const liq = await page.evaluate(async ()=>{
    const st=window._wizState;
    st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx');
    el.value='Pneumonia'; el.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,600));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,5000));
    const ask=document.getElementById('ucgAsk');
    if(ask&&getComputedStyle(ask).display!=='none'){
      const h=ask.querySelector('[data-h]'); if(h) h.click(); await new Promise(r=>setTimeout(r,4500));
    }
    // add a syrup and an inhaler by hand — both are containers on the shelf
    async function addByName(n){
      const inp=document.getElementById('ucgDrugSearch');
      inp.value=n; inp.dispatchEvent(new Event('input',{bubbles:true}));
      for(let k=0;k<40;k++){ await new Promise(r=>setTimeout(r,200));
        const bx=document.getElementById('ucgSearchRes');
        if(bx&&bx.style.display==='block'&&bx.querySelectorAll('[data-i]').length) break; }
      // Pick the hit whose FORM is a container, not just the first match:
      // searching "Fluconazole" offers the capsule before the suspension.
      const hits=[...document.querySelectorAll('#ucgSearchRes [data-i]')];
      const hit=hits.find(h=>/suspension|syrup|solution|inhalation|drops|ointment|cream/i.test(h.textContent))||hits[0];
      if(!hit) return false;
      hit.click(); await new Promise(r=>setTimeout(r,500));
      const f=document.getElementById('dqF'), d=document.getElementById('dqD');
      if(f){ f.value='3'; f.dispatchEvent(new Event('change',{bubbles:true})); }
      if(d){ d.value='5'; d.dispatchEvent(new Event('change',{bubbles:true})); }
      await new Promise(r=>setTimeout(r,200));
      const dq=(document.getElementById('dqQ')||{}).value;
      document.getElementById('ucgAskYes').click();
      await new Promise(r=>setTimeout(r,700));
      return dq;
    }
    const askedQty = await addByName('Fluconazole');
    const rows=[...document.querySelectorAll('.ucg-drug')].map(r=>({
      name:(r.querySelector('.nm b')||{}).textContent||'',
      qty:(r.querySelector('[data-qt]')||{}).value,
      qtyLabel:(()=>{const ls=[...r.querySelectorAll('.ucg-lbl')];return ls.length?ls[ls.length-1].textContent:'';})(),
      tpd:(r.querySelector('[data-fd]')||{}).value,
      days:(r.querySelector('[data-dd]')||{}).value,
    }));
    return { askedQty, rows };
  });

  const syrup = liq.rows.find(r=>/Fluconazole/i.test(r.name)) || {};
  result('a syrup course takes ONE bottle off the shelf, not one per dose',
    Number(syrup.qty)===1, JSON.stringify({name:syrup.name, qty:syrup.qty, tpd:syrup.tpd, days:syrup.days}));
  result('the quantity box says what it is counting — bottles, not a bare "Qty"',
    /bottle/i.test(syrup.qtyLabel||''), 'label="'+syrup.qtyLabel+'"');
  result("the patient's instructions are untouched — 3 times a day for 5 days",
    syrup.tpd==='3' && syrup.days==='5', JSON.stringify({tpd:syrup.tpd, days:syrup.days}));

  // Tablets must still count in doses.

  result('a tablet still counts every dose off the shelf',
    liq.rows.some(r=>!/bottle|inhaler|tube/i.test(r.qtyLabel||'') &&
                     Number(r.qty)===Number(r.tpd)*Number(r.days)),
    JSON.stringify(liq.rows.filter(r=>/^Qty$/.test(r.qtyLabel||'')).slice(0,2)));

  // Changing the days must not multiply bottles.
  const after = await page.evaluate(async ()=>{
    const row=[...document.querySelectorAll('.ucg-drug')].find(r=>/Fluconazole/i.test((r.querySelector('.nm b')||{}).textContent||''));
    const dd=row.querySelector('[data-dd]');
    dd.value='10'; dd.dispatchEvent(new Event('change',{bubbles:true}));
    await new Promise(r=>setTimeout(r,700));
    const r2=[...document.querySelectorAll('.ucg-drug')].find(r=>/Fluconazole/i.test((r.querySelector('.nm b')||{}).textContent||''));
    return { qty:(r2.querySelector('[data-qt]')||{}).value, days:(r2.querySelector('[data-dd]')||{}).value };
  });
  result('doubling the days does not double the bottles',
    Number(after.qty)===1 && after.days==='10', JSON.stringify(after));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
