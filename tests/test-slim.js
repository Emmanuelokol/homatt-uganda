// Screen 1 should be ONLY: diagnosis → severity → care level → one-tap → Continue.
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
  await new Promise(r=>server.listen(8992,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const posted=[], rpcs=[];
  await page.route('**/*', route => {
    const rq=route.request(), u=rq.url();
    if (u.startsWith('http://localhost:8992')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/rpc\/record_payment/.test(u)) { rpcs.push(1);
        return route.fulfill({status:200,headers:H,body:'{"ok":true}'}); }
      if (/\/rest\/v1\/clinic_diagnoses/.test(u) && rq.method()==='POST') {
        let bd=null; try{bd=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(bd)?bd[0]:bd; posted.push(row);
        return route.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'dx-s'},row))});
      }
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });
  await page.goto('http://localhost:8992/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:8992/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);

  const vis = await page.evaluate(()=>{
    const seen = (el)=>{ if(!el) return false; const r=el.getBoundingClientRect();
      return r.width>0 && r.height>0 && getComputedStyle(el).visibility!=='hidden'; };
    return {
      dx:      seen(document.getElementById('confirmedDx')),
      oneTap:  seen(document.getElementById('ucgOneTap')),
      sev:     seen(document.getElementById('sevChips')),
      next:    seen(document.getElementById('step1Next')),
      phone:   seen(document.getElementById('patientPhone')),
      lookup:  seen(document.getElementById('lookupTabPhone')),
      labChips:seen(document.querySelector('.lab-chip')),
      labSearchAny: [...document.querySelectorAll('input')]
        .filter(i=>/find a test/i.test(i.placeholder||'')).some(seen),
      bodyText: document.body.innerText.replace(/\s+/g,' ')
    };
  });
  result('screen 1 shows the diagnosis, severity, the package and Continue',
    vis.dx && vis.sev && vis.oneTap && vis.next,
    'dx='+vis.dx+' sev='+vis.sev+' package='+vis.oneTap+' continue='+vis.next);
  result('the phone number and patient lookup are gone from the consultation',
    !vis.phone && !vis.lookup && !/PATIENT PHONE NUMBER/i.test(vis.bodyText),
    'phone visible='+vis.phone+' lookup visible='+vis.lookup);
  result('the standalone lab-test picker is gone',
    !vis.labChips && !vis.labSearchAny && !/LAB TESTS & FINDINGS/i.test(vis.bodyText),
    'chips='+vis.labChips+' search='+vis.labSearchAny);

  // The whole point: the flow still works end to end from the diagnosis.
  await page.evaluate(()=>{const el=document.getElementById('confirmedDx');
    el.value='mala'; el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(900);
  const picked = await page.evaluate(async ()=>{
    const t=document.querySelector('#ucgDxRes [data-d]'); if(t) t.click();
    await new Promise(r=>setTimeout(r,300));
    return document.getElementById('confirmedDx').value;
  });
  await page.click('#ucgOneTap'); await page.waitForTimeout(3000);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]'); if(f)f.click();}});
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{
    ['ucgFeeC','ucgFeeL','ucgFeeM'].forEach((id,i)=>{const el=document.getElementById(id);
      if(el){el.value=[2000,0,20000][i]; el.dispatchEvent(new Event('input',{bubbles:true}));}});
    const p=document.querySelector('#ucgPay [data-pay="paid"]'); if(p) p.click();
    const b=document.getElementById('ucgSave'); if(b) b.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const n=document.getElementById('ucgAskNo'); if(n)n.click();}});
  await page.waitForTimeout(4000);
  const row = posted[0]||null;
  result('diagnosis → suggestion → package → paid → saved, in one flow',
    picked && /malaria/i.test(picked) && posted.length===1 &&
    // amount_paid is 0 on the insert by design — record_payment adds to the
    // row, so writing it here too booked the money twice. The ledger call is
    // the single writer.
    row.payment_status==='paid' && Number(row.amount_paid)===0 &&
    rpcs.length===1 && !row.patient_phone,
    'dx="'+picked+'" saved='+posted.length+' case='+(row&&row.case_code)+
    ' paid='+(row&&row.amount_paid)+' ledger='+rpcs.length+' total='+(row&&row.total_charged_ugx));
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'slim.png',fullPage:true});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
