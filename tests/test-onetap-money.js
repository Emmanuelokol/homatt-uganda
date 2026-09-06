// Four fixes: Save must not divert to the phone; lab tests must auto-suggest;
// payment chips must be in the panel; and PAID must register the money.
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
  await new Promise(r=>server.listen(8988,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const posted=[], rpcs=[];
  await page.route('**/*', route => {
    const rq=route.request(), u=rq.url();
    if (u.startsWith('http://localhost:8988')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/rpc\/record_payment/.test(u)) {
        let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        rpcs.push(a);
        return route.fulfill({status:200,headers:H,body:JSON.stringify({ok:true})});
      }
      if (/\/rest\/v1\/clinic_diagnoses/.test(u) && rq.method()==='POST') {
        let bd=null; try{bd=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(bd)?bd[0]:bd; posted.push(row);
        return route.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'dx-1'},row))});
      }
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });
  await page.goto('http://localhost:8988/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  async function openPkg(dx){
    await page.goto('http://localhost:8988/clinic/new-order.html',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2500);
    await page.evaluate(()=>{ window._wizState.patient=null;
      window._wizState.materialsUsed=window._wizState.materialsUsed||[]; });
    await page.evaluate((d)=>{const el=document.getElementById('confirmedDx');
      el.value=d; el.dispatchEvent(new Event('input',{bubbles:true}));},dx);
    await page.click('#ucgOneTap'); await page.waitForTimeout(3000);
    await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
      if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]'); if(f)f.click();}});
    await page.waitForTimeout(2500);
  }

  // ── 1. Payment chips live in the panel ─────────────────────────────────
  await openPkg('Malaria');
  const chips = await page.evaluate(()=>{
    const g=document.getElementById('ucgPay');
    return { n:g?g.querySelectorAll('[data-pay]').length:0,
             labels:g?[...g.querySelectorAll('[data-pay]')].map(b=>b.dataset.pay):[],
             on:g?(g.querySelector('.on')||{}).dataset?.pay:null,
             hint:(document.getElementById('ucgPayHint')||{}).textContent||'' };
  });
  result('Paid / Pending / Credit / Waived are in the one-tap panel',
    chips.n===4 && ['paid','pending','credit','waived'].every(k=>chips.labels.includes(k)),
    JSON.stringify(chips.labels)+' selected='+chips.on);

  // ── 2. Lab test auto-suggestion ────────────────────────────────────────
  const sug = await page.evaluate(async ()=>{
    document.getElementById('ucgAddTest').click();
    await new Promise(r=>setTimeout(r,300));
    const i=document.getElementById('ucgNewTest');
    i.value='mal'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    const box=document.getElementById('ucgTestRes');
    return { shown:box?getComputedStyle(box).display!=='none':false,
             items:box?[...box.querySelectorAll('[data-t]')].map(x=>x.textContent.trim()):[] };
  });
  result('typing "mal" in Add test suggests lab tests',
    sug.shown && sug.items.length>0 && sug.items.some(t=>/Malaria/i.test(t)),
    JSON.stringify(sug.items).slice(0,140));
  const picked = await page.evaluate(async ()=>{
    document.querySelector('#ucgTestRes [data-t]').click();
    await new Promise(r=>setTimeout(r,400));
    return (document.getElementById('ucgBody').textContent||'').replace(/\s+/g,' ');
  });
  result('tapping a suggestion adds it to the package',
    /Malaria/i.test(picked), picked.slice(0,80));

  // ── 3. Save must NOT divert to the phone, and PAID must book the money ──
  await page.evaluate(()=>{
    ['ucgFeeC','ucgFeeL','ucgFeeM'].forEach((id,i)=>{const el=document.getElementById(id);
      if(el){el.value=[2000,0,20000][i]; el.dispatchEvent(new Event('input',{bubbles:true}));}});
    const paid=document.querySelector('#ucgPay [data-pay="paid"]'); if(paid) paid.click();
  });
  await page.evaluate(()=>{ window.__t=[]; const o=window.showToast;
    window.showToast=function(m,k){window.__t.push(String(m)); return o&&o.apply(this,arguments);}; });
  await page.evaluate(()=>{ const b=document.getElementById('ucgSave'); if(b) b.click(); });
  await page.waitForTimeout(1200);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const n=document.getElementById('ucgAskNo'); if(n)n.click();}});
  await page.waitForTimeout(4000);
  const after = await page.evaluate(()=>({
    toasts: window.__t||[],
    focus: (document.activeElement||{}).id||'',
    blocked: (function(){const s=document.getElementById('submitBlock');
      return s&&getComputedStyle(s).display!=='none' ? (document.getElementById('submitBlockText')||{}).textContent : '';})()
  }));
  const row = posted[0]||null;
  result('Save consultation no longer diverts to the phone number',
    posted.length===1 && after.focus!=='patientPhone' &&
    !after.toasts.some(t=>/choose the patient/i.test(t)),
    'saved='+posted.length+' focus="'+after.focus+'" blocked="'+after.blocked.slice(0,50)+'"');
  const total = row ? Number(row.total_charged_ugx) : -1;
  result('the saved consultation is marked paid, with the FULL amount recorded',
    row && row.payment_status==='paid' && total>0 && Number(row.amount_paid)===total,
    'status='+(row&&row.payment_status)+' amount_paid='+(row&&row.amount_paid)+' total='+total);
  result('a payment for exactly that amount reaches the ledger the dashboard reads',
    rpcs.length===1 && Number(rpcs[0].p_amount)===total && rpcs[0].p_diagnosis_id==='dx-1',
    'record_payment calls='+rpcs.length+' amount='+(rpcs[0]&&rpcs[0].p_amount)+' vs total='+total);

  // ── 4. Credit must NOT book money ──────────────────────────────────────
  posted.length=0; rpcs.length=0;
  await openPkg('Typhoid');
  await page.evaluate(()=>{
    ['ucgFeeC','ucgFeeL','ucgFeeM'].forEach((id,i)=>{const el=document.getElementById(id);
      if(el){el.value=[5000,0,0][i]; el.dispatchEvent(new Event('input',{bubbles:true}));}});
    const c=document.querySelector('#ucgPay [data-pay="credit"]'); if(c) c.click();
    const b=document.getElementById('ucgSave'); if(b) b.click();
  });
  await page.waitForTimeout(1200);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const n=document.getElementById('ucgAskNo'); if(n)n.click();}});
  await page.waitForTimeout(4000);
  const cr = posted[0]||null;
  result('a CREDIT visit saves as owed, and books no money',
    posted.length===1 && cr.payment_status==='credit' &&
    Number(cr.amount_paid)===0 && rpcs.length===0,
    'status='+(cr&&cr.payment_status)+' amount_paid='+(cr&&cr.amount_paid)+' ledger calls='+rpcs.length);

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'onetap-money.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
