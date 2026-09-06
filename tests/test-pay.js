// Are the pending-payment amounts unambiguous, and does a missing patient say so?
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
  await new Promise(r=>server.listen(8982,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8982'))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto('http://localhost:8982/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:8982/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(3000);
  // The two real rows from the screenshot.
  const html = await page.evaluate(()=>{
    const rows=[
      {id:'a',patient_name:'okol leo',patient_phone:'0788099525',confirmed_diagnosis:'malaria, typiod',
       total_charged_ugx:17000,amount_paid:0,balance_ugx:17000,payment_status:'credit',
       created_at:new Date(Date.now()-15*86400000).toISOString(),last_payment_at:null},
      {id:'b',patient_name:'Samalulu',patient_phone:'07788099425',confirmed_diagnosis:'Malaria',
       total_charged_ugx:62000,amount_paid:52000,balance_ugx:10000,payment_status:'partial',
       created_at:new Date(Date.now()-49*86400000).toISOString(),
       last_payment_at:new Date(Date.now()-12*86400000).toISOString()},
      {id:'c',patient_name:'Mixed Up',patient_phone:'0700111000',confirmed_diagnosis:'Cough',
       total_charged_ugx:20000,amount_paid:8000,balance_ugx:12000,payment_status:'credit',
       created_at:new Date().toISOString(),last_payment_at:new Date().toISOString()}];
    return rows.map(r=>window._payRowHtml ? _payRowHtml(r) : '').join('');
  });
  const txt = html.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ');
  console.log('   ' + txt.slice(0,420));
  result('every amount is labelled — bill, paid and still owed',
    /STILL OWED/.test(html) && /Bill .*17,000/.test(txt) && /Paid .*0/.test(txt) &&
    /Owing .*17,000/.test(txt) && /Bill .*62,000/.test(txt) && /Owing .*10,000/.test(txt),
    txt.slice(0,150));
  result('a visit marked "credit" that has been part-paid now reads PART-PAID',
    (txt.match(/PART-PAID/g)||[]).length === 2 && /ON CREDIT/.test(txt),
    'part-paid='+((txt.match(/PART-PAID/g)||[]).length)+' credit='+((txt.match(/ON CREDIT/g)||[]).length));

  // The phone is OPTIONAL now: a walk-in with no patient details must SAVE,
  // identified by its case number, with the name and contact added later.
  let saved = 0;
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8982'))return r.continue();
    if(u.startsWith(SB)){
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/\/rest\/v1\/clinic_diagnoses/.test(u) && r.request().method()==='POST'){
        let bd=null; try{bd=JSON.parse(r.request().postData()||'null');}catch(e){}
        const row=Array.isArray(bd)?bd[0]:bd; saved++;
        return r.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'x'},row))});
      }
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});
  await page.goto('http://localhost:8982/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{ const st=window._wizState;
    st.patient=null; st.confirmedDx='Malaria'; st.severity='moderate';
    st.medications=[]; st.labTests=[]; st.materialsUsed=[];
    st.feeConsult=10000; st.paymentStatus='partial';
    if(window._showStep) window._showStep(2); });
  await page.click('#submitBtn'); await page.waitForTimeout(3000);
  const blk = await page.evaluate(()=>{const s=document.getElementById('submitBlock');
    return {shown:s?getComputedStyle(s).display:'missing',
            text:(document.getElementById('submitBlockText')||{}).textContent||''};});
  result('a walk-in with no phone or name is saved, not blocked',
    saved===1 && blk.shown==='none', 'saved='+saved+' blocked="'+blk.text.slice(0,70)+'"');
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
