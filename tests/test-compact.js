// Both lists must be scannable at 100 patients: two lines each, tap for detail.
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
const now=Date.now();
const MEDS=[{drug_name:'Ciprofloxacin 500mg',strength:'500mg',frequency:'2x_daily',duration:10,quantity:20}];
const ROWS=Array.from({length:40},(_,i)=>({
  id:'r'+i, clinic_id:CID, confirmed_diagnosis:i%2?'Malaria':'Typhoid fever',
  severity:'moderate', created_at:new Date(now-i*600000).toISOString(),
  patient_phone:i%3?'07880094'+String(i).padStart(2,'0'):null,
  patient_name:i%3?('Patient '+i):null, patient_type:'outpatient',
  total_charged_ugx:20000+i*100, amount_paid:i%2?20000+i*100:0,
  payment_status:i%2?'paid':'pending', follow_up_days:7, follow_up_reason:null,
  prescription_items:MEDS, case_code:'#'+String(i+1).padStart(3,'0')+'T2308O'}));
(async()=>{
  await new Promise(r=>server.listen(8998,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  let patched=null;
  await page.route('**/*',r=>{const u=r.request().url(), m=r.request().method();
    if(u.startsWith('http://localhost:8998'))return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/\/rest\/v1\/clinic_diagnoses/.test(u)&&m==='PATCH'){
        try{patched=JSON.parse(r.request().postData()||'null');}catch(e){}
        return r.fulfill({status:200,headers:H,body:JSON.stringify([{id:'r0'}])});}
      if(/\/rest\/v1\/clinic_diagnoses/.test(u))
        return r.fulfill({status:200,headers:H,body:JSON.stringify(ROWS)});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});
  await page.goto('http://localhost:8998/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:8998/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(7000);
  // Active Treatments lives on the Patients slide; measuring it while hidden
  // gives zero heights and a meaningless pass.
  await page.evaluate(()=>{ const t=[...document.querySelectorAll('.slide-tab')]
    .find(x=>/patie/i.test(x.textContent||'')); if(t) t.click(); });
  await page.waitForTimeout(1500);

  const dense = await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#activeTreatmentsList .pt-row')];
    const heights=rows.slice(0,10).map(r=>Math.round(r.getBoundingClientRect().height));
    const first=rows[0];
    return { n:rows.length, heights,
      max: Math.max.apply(null, heights),
      text: first ? first.textContent.replace(/\s+/g,' ').trim() : '',
      hasTime: !!first.querySelector('.pt-time'),
      hasWho:  !!first.querySelector('.pt-who'),
      hasAmt:  !!first.querySelector('.pt-amt'),
      hasDx:   !!first.querySelector('.pt-dx'),
      hasTag:  !!first.querySelector('.pt-tag'),
      noDischargeInRow: !first.querySelector('button') };
  });
  console.log('   row heights: ' + dense.heights.join(', '));
  result('every active patient is one compact row (under 80px tall)',
    dense.n===40 && dense.max<=80, dense.n+' rows, tallest '+dense.max+'px');
  result('a row carries time, who, amount, illness and payment — nothing else',
    dense.hasTime&&dense.hasWho&&dense.hasAmt&&dense.hasDx&&dense.hasTag&&dense.noDischargeInRow,
    '"'+dense.text+'"');

  const fit = await page.evaluate(()=>{
    const rows=[...document.querySelectorAll('#activeTreatmentsList .pt-row')];
    const h=rows[0].getBoundingClientRect().height + 7;
    return Math.floor(window.innerHeight / h);
  });
  result('several patients fit on one phone screen', fit>=7, fit+' rows per screen');

  // Tapping opens the full detail, and Discharge is there.
  const det = await page.evaluate(async ()=>{
    document.querySelector('#activeTreatmentsList .pt-row').click();
    await new Promise(r=>setTimeout(r,2500));
    const m=document.getElementById('histModal');
    const dc=document.getElementById('histModalDischargeBtn');
    return { open:m&&getComputedStyle(m).display!=='none',
      head:(document.getElementById('histModalName')||{}).textContent||'',
      body:(document.getElementById('histModalBody')||{}).textContent.replace(/\s+/g,' '),
      discharge: dc ? getComputedStyle(dc).display!=='none' : false };
  });
  result('tapping a row opens the full record',
    det.open && /Ciprofloxacin/.test(det.body) && /^#\d{3}/.test(det.head),
    'head="'+det.head+'" body="'+det.body.slice(0,60)+'"');
  result('Discharge moved into the record, where the decision is made',
    det.discharge, 'visible='+det.discharge);

  // "Today's Treatments" was removed — Active Treatments already lists those
  // patients. Adding a name moved onto the row itself: with no name, the case
  // number IS the identity, and tapping it is how a name gets added. It must
  // do that WITHOUT making the row any taller.
  const today = await page.evaluate(async ()=>{
    const m=document.getElementById('histModal'); if(m) m.style.display='none';
    const rows=[...document.querySelectorAll('#activeTreatmentsList .pt-row')];
    const unnamed=rows.find(r=>r.querySelector('.pt-who.addable'));
    const hBefore=unnamed?Math.round(unnamed.getBoundingClientRect().height):0;
    if(unnamed) unnamed.querySelector('.pt-who.addable').click();
    await new Promise(r=>setTimeout(r,700));
    const ov=document.getElementById('pxEditOverlay');
    const open = ov && getComputedStyle(ov).display!=='none';
    if(open){ document.getElementById('pxName').value='Given Later';
      document.getElementById('pxSave').click(); await new Promise(r=>setTimeout(r,2200)); }
    return { gone: !document.getElementById('ordersList'), open, hBefore,
      named: rows.filter(r=>r.querySelector('.pt-who.addable')).length };
  });
  result("the duplicate Today's Treatments list is gone", today.gone);
  result('an unnamed row offers its name without growing a line',
    today.named>0 && today.hBefore>0 && today.hBefore<80, 'row '+today.hBefore+'px');
  result('tapping the case number opens the name editor and saves',
    today.open && patched && patched.patient_name==='Given Later',
    'editor='+today.open+' patch='+JSON.stringify(patched));
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
