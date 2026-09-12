const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server = http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
(async()=>{
  await new Promise(r=>server.listen(8971,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await(await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true})).newPage();
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  await page.goto('http://localhost:8971/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{
    localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'Dr. M',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'tok',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  },[CID,UID]);
  // offline-style: only local server
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:8971'))return r.continue();return r.abort();});
  await page.goto('http://localhost:8971/clinic/new-order.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(2500);

  result('one-tap button present in the wizard',
    await page.evaluate(()=>!!document.getElementById('ucgOneTap')));

  // type diagnosis + tap
  await page.evaluate(()=>{const d=document.getElementById('confirmedDx');d.value='Malaria';d.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#ucgOneTap');
  await page.waitForTimeout(2500);
  // may show a "which condition?" chooser
  const chooser = await page.evaluate(()=>{
    const a=document.getElementById('ucgAsk');
    if(a && getComputedStyle(a).display!=='none' && /Which (one|condition)/i.test(document.getElementById('ucgAskTitle').textContent)){
      const first=a.querySelector('[data-h]'); if(first){first.click(); return true;}
    } return false;
  });
  await page.waitForFunction(()=>{const b=document.getElementById('ucgBody');return b&&/Investigations|Medicines/.test(b.textContent);},{timeout:25000}).catch(()=>{});
  const panel = await page.evaluate(()=>{
    const b=document.getElementById('ucgBody');
    return {open:getComputedStyle(document.getElementById('ucgOverlay')).display!=='none',
      title:(document.getElementById('ucgTitle')||{}).textContent||'',
      kicker:(document.getElementById('ucgKicker')||{}).textContent||'',
      tests:b.querySelectorAll('[data-rmtest]').length,
      drugs:b.querySelectorAll('[data-rmdrug]').length,
      groups:[...b.querySelectorAll('.ucg-mgh')].map(x=>x.textContent.trim().replace(/\s+/g,' ')),
      // Only the rows that are actually prescribable. A guideline TEXT line
      // ("haemodialysis (bicarbonate + ...)") is shown for reference and has
      // no tick, so matching drug words against the whole panel would flag it.
      names:[...b.querySelectorAll('.ucg-drug')].filter(x=>x.querySelector('[data-tick]'))
        .map(x=>x.textContent.toLowerCase()).join(' | '),
      ticks:b.querySelectorAll('[data-tick]').length,
      // Quantity fields belong to a medicine that is actually being given, so
      // tick one and look again.
      // Quantity fields belong to a medicine being given — the guideline's
      // first choice arrives ticked, so they are already there.
      hasQty:!!b.querySelector('[data-qt]'),
      ticked:b.querySelectorAll('.ucg-drug.on').length,
      hasFees:!!document.getElementById('ucgFeeC'),
      hasFollow:!!document.getElementById('ucgFollow'),
      hasAddTest:!!document.getElementById('ucgAddTest'), hasAddDrug:!!document.getElementById('ucgDrugSearch'),
      hasAddCond:!!document.getElementById('ucgAddCond')};
  });
  result('package panel opens with the guideline package', panel.open && panel.title.length>2, 'title="'+panel.title+'" chooser='+chooser);
  // Everything the guideline lists is still SHOWN — nothing is hidden — but
  // only the first choice arrives ticked. Ticking all thirteen was how IV
  // quinine and a dextrose drip ended up pre-selected for an outpatient.
  // The package for an ORDINARY malaria case must be the oral one. It used to
  // carry thirteen medicines because the section boundaries were cut by page
  // rather than by heading, so "Uncomplicated Malaria" inherited the whole
  // severe-malaria protocol — IV artesunate, phenobarbital, furosemide,
  // sodium bicarbonate. The rebuilt database ends that, so this now checks
  // what the package IS, not merely how long it is.
  result('shows the lab tests and the oral ACT the guideline lists for the ordinary case',
    panel.tests>0 && panel.hasQty && panel.drugs>=4 &&
    /artemether\/lumefantrine/.test(panel.names),
    'tests='+panel.tests+' drugs='+panel.drugs+' groups='+JSON.stringify(panel.groups));

  result('and NOT the intravenous severe-malaria protocol',
    !/phenobarbital|furosemide|sodium bicarbonate/.test(panel.names),
    panel.names.slice(0,150));
  result('but only ONE of them arrives ticked — the rest are offered, not given',
    panel.ticked===1, panel.ticked+' of '+panel.drugs+' ticked');
  result('has [x] remove on prefilled items and + add buttons', panel.hasAddTest&&panel.hasAddDrug&&panel.hasAddCond);
  result('has money fields the clinician fills + follow-up', panel.hasFees&&panel.hasFollow);

  // drug search: "amo" -> results -> tap -> dosage popup -> add
  const search = await page.evaluate(async ()=>{
    const i=document.getElementById('ucgDrugSearch'); i.value='amo'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,600));
    const box=document.getElementById('ucgSearchRes');
    const items=[...box.querySelectorAll('[data-i]')].map(x=>x.textContent.trim());
    if(items.length) box.querySelector('[data-i]').click();
    await new Promise(r=>setTimeout(r,300));
    const ask=document.getElementById('ucgAsk');
    return {items:items.slice(0,3), popup:getComputedStyle(ask).display!=='none',
      f:!!document.getElementById('dqF'), d:!!document.getElementById('dqD'), q:!!document.getElementById('dqQ'),
      title:(document.getElementById('ucgAskTitle')||{}).textContent||''};
  });
  result('typing "amo" finds amoxicillin-style drugs', search.items.length>0 && /amo/i.test(search.items.join(' ')), JSON.stringify(search.items));
  result('tapping a drug asks the dosage (x/day, days, qty)', search.popup&&search.f&&search.d&&search.q, 'popup title="'+search.title+'"');

  const added = await page.evaluate(async ()=>{
    document.getElementById('dqF').value='3'; document.getElementById('dqF').dispatchEvent(new Event('change'));
    document.getElementById('dqD').value='5'; document.getElementById('dqD').dispatchEvent(new Event('change'));
    const q=document.getElementById('dqQ').value;
    document.getElementById('ucgAskYes').click();
    await new Promise(r=>setTimeout(r,400));
    return {qty:q, drugs:document.querySelectorAll('[data-rmdrug]').length};
  });
  result('"3x daily for 5 days" computes quantity 15 and adds the drug', added.qty==='15'&&added.drugs>0, 'qty='+added.qty+' drugs='+added.drugs);

  // edit: remove first test, set money, apply
  const applied = await page.evaluate(async ()=>{
    const rm=document.querySelector('[data-rmtest]'); if(rm) rm.click();
    await new Promise(r=>setTimeout(r,200));
    const c=document.getElementById('ucgFeeC'); c.value='10000'; c.dispatchEvent(new Event('input'));
    const l=document.getElementById('ucgFeeL'); l.value='8000'; l.dispatchEvent(new Event('input'));
    const m=document.getElementById('ucgFeeM'); m.value='27000'; m.dispatchEvent(new Event('input'));
    const total=(document.getElementById('ucgTotal')||{}).textContent||'';
    document.getElementById('ucgApply').click();
    await new Promise(r=>setTimeout(r,600));
    const st=window._wizState;
    return {total, tests:st.labTests.length, meds:st.medications.length,
      qty:(st.medications[0]||{}).qtyToDeduct, fees:[st.feeConsult,st.feeLab,st.feeMeds],
      askShown:getComputedStyle(document.getElementById('ucgAsk')).display!=='none',
      askTitle:(document.getElementById('ucgAskTitle')||{}).textContent||''};
  });
  result('total updates as the clinician types money', /45,000/.test(applied.total), 'total="'+applied.total+'"');
  result('applied into the consultation (tests, meds w/ qty, fees)',
    applied.meds>0 && applied.fees[0]===10000 && applied.fees[2]===27000, 'meds='+applied.meds+' qty='+applied.qty+' fees='+JSON.stringify(applied.fees));
  result('ASKS before learning the change', applied.askShown && /standard/i.test(applied.askTitle), 'ask="'+applied.askTitle+'"');

  const learned = await page.evaluate(async ()=>{
    document.getElementById('ucgAskYes').click();
    await new Promise(r=>setTimeout(r,400));
    const raw=localStorage.getItem('ucg_packages_11111111-1111-4111-8111-111111111111');
    const all=raw?JSON.parse(raw):{};
    const k=Object.keys(all)[0];
    return {saved:!!k, fees:k?all[k].fees:null, drugs:k?all[k].drugs.length:0, uses:k?all[k].uses:0};
  });
  result('saving stores the standard INCLUDING the money', learned.saved && learned.fees && learned.fees.consult===10000, JSON.stringify(learned.fees));

  // reopen -> should now be "Your clinic standard" with money prefilled
  const reopen = await page.evaluate(async ()=>{
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,900));
    const a=document.getElementById('ucgAsk');
    if(a && getComputedStyle(a).display!=='none'){ const f=a.querySelector('[data-h]'); if(f){f.click(); await new Promise(r=>setTimeout(r,700));} }
    return {kicker:(document.getElementById('ucgKicker')||{}).textContent||'',
      fee:(document.getElementById('ucgFeeC')||{}).value,
      tag:(document.getElementById('ucgTags')||{}).textContent||''};
  });
  result('next time it auto-fills the LEARNED package incl. money',
    /clinic standard/i.test(reopen.kicker) && reopen.fee==='10000', 'kicker="'+reopen.kicker+'" fee='+reopen.fee+' tags="'+reopen.tag+'"');
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'onetap-panel.png'});
  await b.close();server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
