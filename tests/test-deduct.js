// Does a one-tap package actually take the medicine OFF the shelf?
// Pass 1 learns what the package prescribes. Pass 2 puts the FIRST drug on the
// shelf (under a shorter name, no strength) and leaves the SECOND one off it,
// then checks: the first is deducted from the existing row, the second gets a
// shelf slot opened at zero so it goes NEGATIVE.
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

let STOCK=[];                       // mutated between passes
const inserted=[], deducts=[], posted=[];

(async()=>{
  await new Promise(r=>server.listen(9011,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:1000},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  await page.route('**/*',r=>{
    const rq=r.request(), u=rq.url(), m=rq.method();
    if(u.startsWith('http://localhost:9011')) return r.continue();
    if(u.startsWith(SB)){
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/\/rpc\/get_clinic_stock/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      if(/\/rpc\/deduct_inventory/.test(u)){ let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        deducts.push(a); return r.fulfill({status:200,headers:H,body:'{"ok":true,"low_stock":[]}'}); }
      if(/\/rest\/v1\/clinic_inventory/.test(u)&&m==='POST'){ let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a; inserted.push(row);
        return r.fulfill({status:201,headers:H,body:JSON.stringify({id:row.id||'srv-'+inserted.length})}); }
      if(/\/rest\/v1\/clinic_diagnoses/.test(u)&&m==='POST'){ let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a; posted.push(row);
        return r.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'44444444-4444-4444-8444-444444444444'},row))}); }
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();
  });

  await page.goto('http://localhost:9011/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  async function applyPackage(send){
    inserted.length=0; deducts.length=0; posted.length=0;
    await page.goto('http://localhost:9011/clinic/new-order.html',{waitUntil:'domcontentloaded'});
    // Drop the offline stock cache so each pass sees the stubbed shelf.
    await page.evaluate(()=>{ Object.keys(localStorage).filter(k=>k.indexOf('stock_')>=0||k.indexOf('qs_inventory')>=0).forEach(k=>localStorage.removeItem(k)); });
    await page.reload({waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2500);
    await page.evaluate(()=>{ const st=window._wizState;
      st.patient={name:'Deduct Test',phone:'',id:null,clinicPatientId:null};
      st.patientType='outpatient'; st.severity='moderate'; st.materialsUsed=st.materialsUsed||[];
      const el=document.getElementById('confirmedDx');
      el.value='Malaria'; el.dispatchEvent(new Event('input',{bubbles:true})); });
    await page.click('#ucgOneTap'); await page.waitForTimeout(3000);
    await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
      if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
    await page.waitForTimeout(2500);
    // The package now arrives with only the guideline's FIRST CHOICE ticked —
    // ticking all thirteen was how IV quinine and a dextrose drip ended up
    // pre-selected for an outpatient. This test is about what happens to the
    // ones a clinician DOES choose, so tick them all first, the way a finger
    // would, and carry on.
    await page.evaluate(async () => {
      for (let guard = 0; guard < 40; guard++) {
        const off = document.querySelector('.ucg-drug:not(.on) [data-tick]');
        if (!off) break;
        off.click();
        await new Promise(r => setTimeout(r, 60));
      }
    });
    await page.waitForTimeout(500);
    // Now the clinician takes out what this patient is not getting,
    // leaving the first two.
    // Each removal re-renders the list, so take the last row off one at a
    // time and look again — the same way a finger does.
    await page.evaluate(async ()=>{
      for (let guard=0; guard<40; guard++) {
        const rows=[...document.querySelectorAll('.ucg-drug')];
        if (rows.length<=2) break;
        const x=rows[rows.length-1].querySelector('[data-rmdrug]');
        if(!x) break;
        x.click();
        await new Promise(r=>setTimeout(r,60));
      }
    });
    await page.waitForTimeout(600);
    const shot = await page.evaluate(()=>{
      const rows=[...document.querySelectorAll('.ucg-drug.on')];
      // Overlap check: the name block must sit ABOVE the ×/day field, not across it.
      const bad = rows.map(rw=>{
        const nm=rw.querySelector('.nm'), f=rw.querySelector('.fields>div');
        if(!nm||!f) return 'missing';
        const a=nm.getBoundingClientRect(), c=f.getBoundingClientRect();
        return (a.bottom<=c.top+1 && a.width>0 && c.width>0) ? '' :
          'name['+Math.round(a.top)+'-'+Math.round(a.bottom)+'] field['+Math.round(c.top)+'-'+Math.round(c.bottom)+']';
      }).filter(Boolean);
      return { drugRows: rows.length, overlaps: bad,
               names: rows.map(rw=>(rw.querySelector('.nm b')||{}).textContent||''),
               tags: rows.map(rw=>{const t=rw.querySelector('.ucg-stk');
                 return t?(t.className.replace('ucg-stk ','')+':'+t.textContent):'none';}) };
    });
    if(!send) return shot;
    await page.evaluate(()=>{const b=document.getElementById('ucgSave'); if(b) b.click();});
    await page.waitForTimeout(1200);
    await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
      if(a&&getComputedStyle(a).display!=='none'){const n=document.getElementById('ucgAskNo'); if(n) n.click();}});
    await page.waitForTimeout(4500);
    const meds = await page.evaluate(()=>(window._wizState.medications||[]).map(m=>({
      drug:m.drug, id:m.inventoryItemId||null, qty:m.qtyToDeduct||0 })));
    return Object.assign(shot,{meds});
  }

  // ── Pass 1: no stock at all — learn the package and check the layout ──────
  STOCK=[];
  const p1 = await applyPackage(false);
  result('the drug name sits ABOVE the ×/day field — no overlap',
    p1.drugRows===2 && p1.overlaps.length===0,
    'rows='+p1.drugRows+' bad='+p1.overlaps.slice(0,2).join(' ; ')+' names='+JSON.stringify(p1.names).slice(0,110));
  await page.screenshot({path:'deduct-rows.png'});

  const first = (p1.names[0]||'').trim();
  const second = (p1.names[1]||'').trim();
  
  // Shelf name = the drug WITHOUT its strength, the way an owner types it.
  const shelfName = first.replace(/\s*\d.*$/,'').trim() || first;

  // ── Pass 2: first drug IS on the shelf, second is not ────────────────────
  STOCK=[{id:'stk-1',clinic_id:CID,item_name:shelfName,item_type:'medicine',unit:'tabs',
          quantity:40,min_threshold:10,reorder_level:60,is_active:true}];
  const p2 = await applyPackage(true);
  const linked = (p2.meds||[]).find(m=>m.drug===first);
  result('a package drug already on the shelf is linked to it ("'+shelfName+'" ⇄ "'+first+'")',
    !!linked && linked.id==='stk-1' && linked.qty>0,
    JSON.stringify(linked));

  result('each ticked drug says whether the clinic actually holds it',
    (p2.tags||[]).length===2 && p2.tags[0].indexOf('ok:in stock: 40 tabs')===0 &&
    p2.tags[1].indexOf('no:not in your stock')===0,
    JSON.stringify(p2.tags).slice(0,180));

  const newSlot = inserted.find(r=>r&&r.item_name===second);
  result('a ticked drug the clinic has never stocked gets a shelf slot opened at zero',
    !!second && !!newSlot && Number(newSlot.quantity)===0 && newSlot.item_type==='medicine' &&
    inserted.length===1,
    'second="'+second+'" inserted='+JSON.stringify(inserted.map(r=>r.item_name)));

  const d = deducts[0]||{};
  const items = d.p_items||[];
  result('every TICKED medicine is deducted — including the new one, driving it negative',
    items.length === 2 && items.length === (p2.meds||[]).length &&
    items.every(i=>i.item_id&&i.qty>0) && items.some(i=>i.item_id==='stk-1'),
    'deducted='+items.length+' of '+((p2.meds||[]).length)+' → '+JSON.stringify(items).slice(0,140));

  result('the consultation still saved', posted.length===1, 'posted='+posted.length);
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
