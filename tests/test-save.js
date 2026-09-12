// Can a consultation with NO medicines be saved at all?
// (A prophylaxis visit, a counselling visit, a lab-only visit —
//  all real consultations that dispense nothing.)
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

(async()=>{
  await new Promise(r=>server.listen(8978,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  const posted=[];
  await page.route('**/*', route => {
    const rq=route.request(), u=rq.url();
    if (u.startsWith('http://localhost:8978')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/clinic_diagnoses/.test(u) && rq.method()==='POST') {
        let body=null; try{ body=JSON.parse(rq.postData()||'null'); }catch(e){}
        posted.push(body);
        return route.fulfill({status:201,headers:H,body:JSON.stringify(
          Object.assign({id:'44444444-4444-4444-8444-444444444444'}, Array.isArray(body)?body[0]:body))});
      }
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });

  await page.goto('http://localhost:8978/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{ localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify(
      {staffName:'Sanya',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify(
      {access_token:'tok',refresh_token:'r',token_type:'bearer',expires_in:3600,
       expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  await page.goto('http://localhost:8978/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);

  // A real walk-in: patient, diagnosis, no drugs dispensed (prophylaxis advice).
  const setup = await page.evaluate(()=>{
    const st = window._wizState;
    st.patient = { name:'Sanya Test', phone:'0788099425', id:null, clinicPatientId:null };
    st.confirmedDx = 'Malaria Prophylaxis';
    st.severity = 'moderate';
    st.patientType = 'outpatient';
    st.labTests = [];
    st.medications = [];              // nothing dispensed — this is the case
    st.materialsUsed = st.materialsUsed || [];
    st.feeConsult = 10000; st.feeLab = 0; st.feeMeds = 0;
    st.paymentStatus = 'paid';
    if (window._showStep) window._showStep(2);
    return { meds: st.medications.length, dx: st.confirmedDx };
  });

  const toasts=[];
  await page.evaluate(()=>{ window.__toasts=[]; const o=window.showToast;
    window.showToast=function(m,t){ window.__toasts.push(String(m)); return o&&o.apply(this,arguments); }; });

  await page.click('#submitBtn');
  await page.waitForTimeout(3500);

  const after = await page.evaluate(()=>({
    toasts: window.__toasts||[],
    sheet: (function(){ const s=document.getElementById('successSheet');
      return s ? getComputedStyle(s).display : 'missing'; })(),
    outbox: (function(){ try { return (window.ClinicOffline
      ? (ClinicOffline.get('outbox',[])||[]) : []).length; } catch(e){ return -1; } })(),
    btn: (document.getElementById('submitBtn')||{}).textContent.replace(/\s+/g,' ').trim()
  }));

  console.log('   diagnosis="'+setup.dx+'", medicines='+setup.meds);
  console.log('   toasts: ' + JSON.stringify(after.toasts));
  console.log('   POSTs to clinic_diagnoses: ' + posted.length);
  console.log('   offline outbox items: ' + after.outbox);

  result('a consultation with no medicines is saved (sent to the server, or queued)',
    posted.length === 1 || after.outbox > 0,
    'posted='+posted.length+' queued='+after.outbox+' sheet='+after.sheet);
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  // ── B: a normal consultation WITH a medicine still saves ────────────────
  await page.goto('http://localhost:8978/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2200);
  posted.length = 0;
  await page.evaluate(()=>{
    const st = window._wizState;
    st.patient={name:'Ana B',phone:'0700111222',id:null,clinicPatientId:null};
    st.confirmedDx='Malaria'; st.severity='moderate'; st.patientType='outpatient';
    st.labTests=['Malaria RDT']; st.materialsUsed=st.materialsUsed||[];
    st.medications=[{drug:'Artemether/Lumefantrine',dosage:'20/120mg',timesPerDay:2,
                     intakeTimes:['08:00','20:00'],durationDays:3,
                     inventoryItemId:null,qtyToDeduct:0}];
    st.feeConsult=10000; st.feeLab=5000; st.feeMeds=8000; st.paymentStatus='paid';
    if (window._showStep) window._showStep(2);
  });
  await page.click('#submitBtn'); await page.waitForTimeout(3500);
  const bOk = await page.evaluate(()=>({
    sheet:(function(){const s=document.getElementById('successSheet');return s?getComputedStyle(s).display:'missing';})(),
    block:(function(){const s=document.getElementById('submitBlock');return s?getComputedStyle(s).display:'missing';})()
  }));
  const bDrugs = posted.length ? (Array.isArray(posted[0])?posted[0][0]:posted[0]) : null;
  result('a normal consultation with a medicine still saves',
    posted.length===1 && bOk.block==='none' &&
    (bDrugs&&bDrugs.prescription_items||[]).length===1,
    'posted='+posted.length+' drugs='+((bDrugs&&bDrugs.prescription_items||[]).length)+' block='+bOk.block);

  // ── C: a HALF-filled medicine is still refused, and says so ON SCREEN ────
  await page.goto('http://localhost:8978/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2200);
  posted.length = 0;
  await page.evaluate(()=>{
    const st = window._wizState;
    st.patient={name:'Half Row',phone:'0700111333',id:null,clinicPatientId:null};
    st.confirmedDx='Cough'; st.severity='mild'; st.patientType='outpatient';
    st.labTests=[]; st.materialsUsed=st.materialsUsed||[];
    st.medications=[{drug:'Amoxicillin',dosage:'',timesPerDay:2,
                     intakeTimes:['08:00','20:00'],durationDays:5,
                     inventoryItemId:null,qtyToDeduct:0}];
    st.feeConsult=5000; st.feeLab=0; st.feeMeds=0; st.paymentStatus='pending';
    if (window._showStep) window._showStep(2);
  });
  await page.click('#submitBtn'); await page.waitForTimeout(2500);
  const cBlk = await page.evaluate(()=>{
    const s=document.getElementById('submitBlock');
    return { shown:s?getComputedStyle(s).display:'missing',
             text:(document.getElementById('submitBlockText')||{}).textContent||'' };
  });
  result('a half-filled medicine is refused with a message that STAYS on screen',
    posted.length===0 && cBlk.shown!=='none' && /Amoxicillin/.test(cBlk.text),
    'posted='+posted.length+' shown='+cBlk.shown+' "'+cBlk.text.slice(0,90)+'"');

  await page.screenshot({path:'save.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
