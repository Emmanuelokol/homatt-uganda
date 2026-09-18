// The referral feature was removed at the clinic's request. This checks it is
// GONE — not merely hidden — and that removing it broke nothing around it.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9096,ORIGIN='http://localhost:'+PORT;

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:412,height:915},serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  let hitReferralTable=false;
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      if(/clinic_referrals|set_referral_status/.test(u)) hitReferralTable=true;
      return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    }
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  // ── Dashboard ───────────────────────────────────────────────────────────
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(8000);
  const dash = await page.evaluate(async ()=>{
    if(window.showSlide) showSlide('patients');
    await new Promise(r=>setTimeout(r,2500));
    const ids=['dashRefModal','refInList','refOutList','refInCount','refOutCount'];
    return {
      leftoverIds: ids.filter(i=>!!document.getElementById(i)),
      fns: ['openDashReferral','startReferralConsult','setReferralStatus']
             .filter(f=>typeof window[f] === 'function'),
      svRenderers: Object.keys(window._svRenderers||{}).filter(k=>/refer/i.test(k)),
      bodyText: /Refer a Patient|Referrals Received|Referrals I Sent|Refer now/i.test(document.body.innerText),
      patientsSlide: (document.querySelector('[data-slide-key="patients"]')||{}).innerText || '',
    };
  });
  result('no referral markup is left on the dashboard',
    dash.leftoverIds.length===0 && !dash.bodyText, JSON.stringify(dash.leftoverIds));
  result('no referral functions are left on the page',
    dash.fns.length===0, JSON.stringify(dash.fns));
  result('no referral section-views are registered',
    dash.svRenderers.length===0, JSON.stringify(dash.svRenderers));
  result('the Patients slide still renders its remaining sections',
    /Patient History/.test(dash.patientsSlide) && /Active Treatments/.test(dash.patientsSlide),
    dash.patientsSlide.replace(/\s+/g,' ').slice(0,80));
  result('the dashboard never asks the server about referrals', !hitReferralTable);
  result('dashboard: no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  // ── The treatment wizard ────────────────────────────────────────────────
  errs.length=0; hitReferralTable=false;
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(3000);
  const wiz = await page.evaluate(()=>({
    leftoverIds: ['refModal','referOutBtn','refNeededItem','refError','refCancelBtn']
                   .filter(i=>!!document.getElementById(i)),
    reasons: document.querySelectorAll('.ref-reason').length,
    bodyText: /Refer to partner clinic|Refer patient/i.test(document.body.innerText),
  }));
  result('the treatment wizard has no refer-to-partner step',
    wiz.leftoverIds.length===0 && wiz.reasons===0 && !wiz.bodyText,
    JSON.stringify(wiz.leftoverIds));

  // A treatment must still save end to end with the referral hooks gone.
  const saved = await page.evaluate(async ()=>{
    const st=window._wizState;
    st.patient={name:'Test Patient',phone:'0788000111'};
    st.confirmedDx='Malaria'; st.severity='moderate';
    st.medications=[{drug:'Coartem',dosage:'20/120mg',timesPerDay:2,intakeTimes:['08:00','20:00'],durationDays:3}];
    st.labTests=[]; st.materialsUsed=[];
    return typeof window._wizState==='object';
  });
  result('the wizard state survives with the referral hooks removed', saved);
  result('wizard: no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  // ── Wording ─────────────────────────────────────────────────────────────
  const words = {};
  for (const pg of ['dashboard.html','new-order.html','settings.html']) {
    await page.goto(ORIGIN+'/clinic/'+pg);
    await page.waitForTimeout(7000);
    words[pg] = await page.evaluate(()=>{
      const t=document.body.innerText;
      return { consult: (t.match(/consultation/gi)||[]), treatment: /[Tt]reatment/.test(t) };
    });
  }
  result('no screen says "consultation" anywhere a user can read it',
    Object.values(words).every(w=>w.consult.length===0),
    JSON.stringify(Object.fromEntries(Object.entries(words).map(([k,v])=>[k,v.consult]))));
  result('the screens say "treatment" instead',
    Object.values(words).every(w=>w.treatment));

  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
