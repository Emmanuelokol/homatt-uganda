// Start from the DIAGNOSIS. No phone, no name. Does it save, and does the
// consultation carry a case number the clinic can say out loud?
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
  await new Promise(r=>server.listen(8986,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const posted=[]; let rejectCaseCode=false;
  await page.route('**/*', route => {
    const rq=route.request(), u=rq.url();
    if (u.startsWith('http://localhost:8986')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/clinic_diagnoses/.test(u) && rq.method()==='POST') {
        let bd=null; try{ bd=JSON.parse(rq.postData()||'null'); }catch(e){}
        const row=Array.isArray(bd)?bd[0]:bd;
        if (rejectCaseCode && row && 'case_code' in row)
          return route.fulfill({status:400,headers:H,body:JSON.stringify(
            {message:"Could not find the 'case_code' column of 'clinic_diagnoses' in the schema cache"})});
        posted.push(row);
        return route.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'44444444-4444-4444-8444-444444444444'},row))});
      }
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });
  await page.goto('http://localhost:8986/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  async function walkIn(dx, type) {
    posted.length=0;
    await page.goto('http://localhost:8986/clinic/new-order.html',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2500);
    // Straight to the diagnosis — the phone box is never touched.
    await page.evaluate((d)=>{const el=document.getElementById('confirmedDx');
      el.value=d; el.dispatchEvent(new Event('input',{bubbles:true}));},dx);
    await page.evaluate((t)=>{ window._wizState.patientType=t;
      window._wizState.materialsUsed=window._wizState.materialsUsed||[]; },type);
    const gate = await page.evaluate(()=>({
      nextEnabled: !document.getElementById('step1Next').disabled,
      phone: (document.getElementById('patientPhone')||{}).value||''
    }));
    await page.click('#step1Next'); await page.waitForTimeout(500);
    await page.evaluate(()=>{ const st=window._wizState;
      st.medications=[{drug:'Artemether/Lumefantrine',dosage:'20/120mg',timesPerDay:2,
        intakeTimes:['08:00','20:00'],durationDays:3,inventoryItemId:null,qtyToDeduct:0}];
      st.feeConsult=10000; st.feeLab=5000; st.feeMeds=8000; st.paymentStatus='partial'; });
    await page.click('#submitBtn'); await page.waitForTimeout(3500);
    const blk = await page.evaluate(()=>{const s=document.getElementById('submitBlock');
      return {shown:s?getComputedStyle(s).display:'?',text:(document.getElementById('submitBlockText')||{}).textContent||''};});
    return { gate, row: posted[0]||null, n: posted.length, blk };
  }

  const a = await walkIn('Malaria','outpatient');
  result('the Continue button unlocks on the diagnosis alone — no phone typed',
    a.gate.nextEnabled && a.gate.phone === '', 'enabled='+a.gate.nextEnabled+' phone="'+a.gate.phone+'"');
  result('a walk-in with NO phone and NO name is saved',
    a.n === 1 && !a.row.patient_phone && !a.row.patient_name,
    'saved='+a.n+' phone='+JSON.stringify(a.row&&a.row.patient_phone)+' name='+JSON.stringify(a.row&&a.row.patient_name)+
    ' blocked="'+(a.blk.shown!=='none'?a.blk.text.slice(0,60):'no')+'"');
  const cc = a.row && a.row.case_code;
  result('it carries a case number: seq + diagnosis letter + day/month + O or I',
    /^#\d{3}M\d{4}O$/.test(cc||''), 'case_code='+cc);

  const bIn = await walkIn('Typhoid','inpatient');
  result('an inpatient case ends in I, and the number moves on',
    /^#\d{3}T\d{4}I$/.test(bIn.row&&bIn.row.case_code||'') &&
    bIn.row.case_code !== cc,
    'first='+cc+' second='+(bIn.row&&bIn.row.case_code));

  // A clinic that has NOT run the migration must still save the consultation.
  rejectCaseCode = true;
  const c = await walkIn('Cough','outpatient');
  result('a database without the case_code column still saves the consultation',
    c.n === 1 && !('case_code' in (c.row||{})),
    'saved='+c.n+' kept case_code='+('case_code' in (c.row||{}))+
    ' blocked="'+(c.blk.shown!=='none'?c.blk.text.slice(0,60):'no')+'"');
  rejectCaseCode = false;


  // ── The case number must be VISIBLE on the dashboard ────────────────────
  const DXROWS=[{id:'d1',clinic_id:CID,confirmed_diagnosis:'Malaria',severity:'moderate',
    created_at:new Date().toISOString(),patient_phone:null,patient_name:null,
    patient_type:'outpatient',total_charged_ugx:23000,payment_status:'partial',
    case_code:'#001M2208O'}];
  let sendCase=true, askedWithCase=0, askedWithout=0;
  const p2=await ctx.newPage(); const e2=[]; p2.on('pageerror',x=>e2.push(x.message.split('\n')[0]));
  await p2.route('**/*', route => {
    const u=route.request().url();
    if (u.startsWith('http://localhost:8986')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/clinic_diagnoses/.test(u)) {
        const wants = /case_code/.test(decodeURIComponent(u));
        if (wants) { askedWithCase++;
          if (!sendCase) return route.fulfill({status:400,headers:H,body:JSON.stringify(
            {message:"column clinic_diagnoses.case_code does not exist"})});
        } else askedWithout++;
        return route.fulfill({status:200,headers:H,body:JSON.stringify(
          DXROWS.map(r=>{const c=Object.assign({},r); if(!wants) delete c.case_code; return c;}))});
      }
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });
  await p2.goto('http://localhost:8986/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await p2.waitForTimeout(6000);
  const shown = await p2.evaluate(()=>({
    stat:(document.getElementById('statToday')||{}).textContent||'',
    list:((document.getElementById('activeTreatmentsList')||{}).textContent||'').replace(/\s+/g,' ').trim()
  }));
  result('the case number is shown against the consultation on the dashboard',
    shown.stat==='1' && /#001M2208O/.test(shown.list),
    'stat='+shown.stat+' "'+shown.list.slice(0,110)+'"');

  // Same dashboard against a database WITHOUT the column.
  sendCase=false; askedWithout=0;
  const p3=await ctx.newPage(); const e3=[]; p3.on('pageerror',x=>e3.push(x.message.split('\n')[0]));
  await p3.route('**/*', route => {
    const u=route.request().url();
    if (u.startsWith('http://localhost:8986')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/clinic_diagnoses/.test(u)) {
        if (/case_code/.test(decodeURIComponent(u)))
          return route.fulfill({status:400,headers:H,body:JSON.stringify(
            {message:"column clinic_diagnoses.case_code does not exist"})});
        askedWithout++;
        return route.fulfill({status:200,headers:H,body:JSON.stringify(
          DXROWS.map(r=>{const c=Object.assign({},r); delete c.case_code; return c;}))});
      }
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });
  await p3.goto('http://localhost:8986/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await p3.waitForTimeout(8000);
  const noCol = await p3.evaluate(()=>({
    stat:(document.getElementById('statToday')||{}).textContent||'',
    list:((document.getElementById('activeTreatmentsList')||{}).textContent||'').replace(/\s+/g,' ').trim()
  }));
  result('a database WITHOUT the column still lists the consultations',
    noCol.stat==='1' && /Malaria/.test(noCol.list) && askedWithout>0,
    'stat='+noCol.stat+' retried-without-column='+askedWithout);
  result('no dashboard errors', e2.length===0 && e3.length===0, e2.concat(e3).slice(0,3).join(' | '));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
