// Diagnosis first, phone after; diagnosis suggests; and the name is editable.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const DX=[{id:'dx-9',clinic_id:CID,confirmed_diagnosis:'Malaria',severity:'moderate',
  created_at:new Date().toISOString(),patient_phone:null,patient_name:null,
  patient_type:'outpatient',total_charged_ugx:22000,payment_status:'paid',case_code:'#001M2308O'}];
(async()=>{
  await new Promise(r=>server.listen(8990,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const patches=[];
  await page.route('**/*', route => {
    const rq=route.request(), u=rq.url();
    if (u.startsWith('http://localhost:8990')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/clinic_diagnoses/.test(u) && rq.method()==='PATCH') {
        let bd=null; try{bd=JSON.parse(rq.postData()||'null');}catch(e){}
        patches.push(bd);
        Object.assign(DX[0], bd);
        return route.fulfill({status:200,headers:H,body:JSON.stringify([{id:'dx-9'}])});
      }
      if (/\/rest\/v1\/clinic_diagnoses/.test(u))
        return route.fulfill({status:200,headers:H,body:JSON.stringify(DX)});
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });
  await page.goto('http://localhost:8990/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  // ── 1. Diagnosis comes BEFORE the phone on the consultation screen ───────
  await page.goto('http://localhost:8990/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  const order = await page.evaluate(()=>{
    const dx=document.getElementById('confirmedDx'), ph=document.getElementById('patientPhone');
    const pos = dx.compareDocumentPosition(ph);
    return { dxBeforePhone: !!(pos & Node.DOCUMENT_POSITION_FOLLOWING),
             sub:(document.querySelector('.wiz-screen-sub')||{}).textContent||'',
             optionalNote: /optional/i.test(document.body.textContent) };
  });
  result('the diagnosis now comes before the phone number',
    order.dxBeforePhone && order.optionalNote, 'sub="'+order.sub.slice(0,70)+'"');

  // ── 2. Diagnosis auto-suggestion ────────────────────────────────────────
  const sug = await page.evaluate(async ()=>{
    const i=document.getElementById('confirmedDx');
    i.value='mala'; i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<25;k++){ await new Promise(r=>setTimeout(r,200));
      const bx=document.getElementById('ucgDxRes');
      if(bx && getComputedStyle(bx).display!=='none' && bx.querySelectorAll('[data-d]').length) break; }
    const box=document.getElementById('ucgDxRes');
    return { shown: box?getComputedStyle(box).display!=='none':false,
             items: box?[...box.querySelectorAll('[data-d]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()):[] };
  });
  result('typing "mala" suggests diagnoses to tap',
    sug.shown && sug.items.length>0 && sug.items.some(t=>/Malaria/i.test(t)),
    JSON.stringify(sug.items).slice(0,150));
  const tapped = await page.evaluate(async ()=>{
    document.querySelector('#ucgDxRes [data-d]').click();
    await new Promise(r=>setTimeout(r,300));
    return { val:document.getElementById('confirmedDx').value,
             next:!document.getElementById('step1Next').disabled,
             hidden:getComputedStyle(document.getElementById('ucgDxRes')).display==='none' };
  });
  result('tapping a suggestion fills the diagnosis and unlocks Continue',
    /Malaria/i.test(tapped.val) && tapped.next && tapped.hidden, JSON.stringify(tapped));

  // ── 3. Editing the name from the dashboard ──────────────────────────────
  const p2=await ctx.newPage(); const e2=[]; p2.on('pageerror',x=>e2.push(x.message.split('\n')[0]));
  await p2.route('**/*', r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8990'))return r.continue();
    if(u.startsWith(SB)){
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/\/rest\/v1\/clinic_diagnoses/.test(u)&&r.request().method()==='PATCH'){
        let bd=null; try{bd=JSON.parse(r.request().postData()||'null');}catch(e){}
        patches.push(bd); Object.assign(DX[0],bd);
        return r.fulfill({status:200,headers:H,body:JSON.stringify([{id:'dx-9'}])});
      }
      if(/\/rest\/v1\/clinic_diagnoses/.test(u))
        return r.fulfill({status:200,headers:H,body:JSON.stringify(DX)});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});
  await p2.goto('http://localhost:8990/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await p2.waitForTimeout(6000);
  // The name is added from the row in Active Treatments now: with no name the
  // case number IS the identity, and tapping it opens the editor.
  const cue = await p2.evaluate(()=>{
    const c=document.querySelector('#activeTreatmentsList .pt-row');
    const who=c&&c.querySelector('.pt-who.code.addable');
    return { found:!!c, tappable:!!who, code:!!who,
             text:c?c.textContent.replace(/\s+/g,' ').trim():'' };
  });
  result('an unnamed patient shows its case number, and tapping it opens the editor',
    cue.found && cue.tappable && cue.code, cue.text.slice(0,90));
  const edited = await p2.evaluate(async ()=>{
    document.querySelector('#activeTreatmentsList .pt-who.addable').click();
    await new Promise(r=>setTimeout(r,500));
    const ov=document.getElementById('pxEditOverlay');
    const open = ov && getComputedStyle(ov).display!=='none';
    const caseTxt=(document.getElementById('pxCase')||{}).textContent||'';
    document.getElementById('pxName').value='Okello John';
    document.getElementById('pxPhone').value='0788099425';
    document.getElementById('pxSave').click();
    await new Promise(r=>setTimeout(r,2500));
    return { open, caseTxt,
             closed: getComputedStyle(document.getElementById('pxEditOverlay')).display==='none',
             list:((document.getElementById('activeTreatmentsList')||{}).textContent||'').replace(/\s+/g,' ').trim() };
  });
  const last = patches[patches.length-1]||{};
  result('the editor opens on the case, and saves the name and phone',
    edited.open && /#001M2308O/.test(edited.caseTxt) && edited.closed &&
    last.patient_name==='Okello John' && last.patient_phone==='0788099425',
    'case="'+edited.caseTxt+'" patch='+JSON.stringify(last));
  result('the row shows the new name straight away',
    /Okello John/.test(edited.list), edited.list.slice(0,90));
  result('no page errors', errs.length===0 && e2.length===0, errs.concat(e2).slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
