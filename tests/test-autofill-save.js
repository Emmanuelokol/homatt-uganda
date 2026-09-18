// THE REAL PATH: type a diagnosis, tap the one-tap package, Apply to
// consultation, then Send. Does anything reach the server?
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
  await new Promise(r=>server.listen(8980,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  const posted=[];
  await page.route('**/*', route => {
    const rq=route.request(), u=rq.url();
    if (u.startsWith('http://localhost:8980')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/clinic_diagnoses/.test(u) && rq.method()==='POST') {
        let body=null; try{ body=JSON.parse(rq.postData()||'null'); }catch(e){}
        posted.push(Array.isArray(body)?body[0]:body);
        return route.fulfill({status:201,headers:H,body:JSON.stringify(
          Object.assign({id:'44444444-4444-4444-8444-444444444444'}, Array.isArray(body)?body[0]:body))});
      }
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });

  await page.goto('http://localhost:8980/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{ localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify(
      {staffName:'Sanya',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify(
      {access_token:'tok',refresh_token:'r',token_type:'bearer',expires_in:3600,
       expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  async function run(dx, label) {
    posted.length = 0;
    await page.goto('http://localhost:8980/clinic/new-order.html',{waitUntil:'domcontentloaded'});
    await page.waitForTimeout(2500);
    await page.evaluate(()=>{
      const st = window._wizState;
      st.patient={name:'Sanya Test',phone:'0788099425',id:null,clinicPatientId:null};
      st.patientType='outpatient'; st.severity='moderate';
      st.materialsUsed = st.materialsUsed || [];
    });
    // type the diagnosis exactly as a clinician would
    await page.evaluate((d)=>{ const el=document.getElementById('confirmedDx');
      el.value=d; el.dispatchEvent(new Event('input',{bubbles:true})); }, dx);
    await page.click('#ucgOneTap');
    await page.waitForTimeout(3000);
    // a severity chooser may appear first
    await page.evaluate(()=>{ const a=document.getElementById('ucgAsk');
      if(a && getComputedStyle(a).display!=='none'){ const f=a.querySelector('[data-h]'); if(f) f.click(); } });
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
    const pkg = await page.evaluate(()=>{
      const ov=document.getElementById('ucgOverlay');
      return { open: ov ? getComputedStyle(ov).display!=='none' : false,
               title:(document.getElementById('ucgTitle')||{}).textContent||'' };
    });
    // The guideline offers a CHOICE of medicines, so the clinician ticks the
    // ones actually being given — nothing is prescribed until they do.
    const ticked = await page.evaluate(()=>{
      const t=[...document.querySelectorAll('[data-tick]')];
      return { available:t.length,
               already:document.querySelectorAll('.ucg-drug.on').length,
               notice:((document.getElementById('ucgPick')||{}).textContent||'').replace(/\s+/g,' ').trim() };
    });
    await page.waitForTimeout(400);
    // the clinician enters the money, then applies
    await page.evaluate(()=>{
      ['ucgFeeC','ucgFeeL','ucgFeeM'].forEach((id,i)=>{ const el=document.getElementById(id);
        if(el){ el.value=[10000,5000,8000][i]; el.dispatchEvent(new Event('input',{bubbles:true})); } });
    });
    // ONE TAP: the package's own "Save consultation" button does the lot.
    await page.evaluate(()=>{ const b=document.getElementById('ucgSave'); if(b) b.click(); });
    await page.waitForTimeout(1200);
    await page.evaluate(()=>{ const a=document.getElementById('ucgAsk');   // "save as standard?"
      if(a && getComputedStyle(a).display!=='none'){ const n=document.getElementById('ucgAskNo'); if(n) n.click(); } });
    await page.waitForTimeout(4000);

    const meds = await page.evaluate(()=>(window._wizState.medications||[]).map(m=>({
      drug:m.drug, dosage:m.dosage, times:(m.intakeTimes||[]).length })));
    const blk = await page.evaluate(()=>{
      const s=document.getElementById('submitBlock');
      return { shown:s?getComputedStyle(s).display:'missing',
               text:(document.getElementById('submitBlockText')||{}).textContent||'' };
    });
    console.log('   ['+label+'] package="'+pkg.title+'" meds='+JSON.stringify(meds).slice(0,160));
    if (blk.shown!=='none') console.log('   ['+label+'] BLOCKED: '+blk.text.slice(0,110));
    return { posted: posted.length, meds, blk, pkg, ticked, row: posted[0] || null };
  }

  const a = await run('Malaria', 'with drugs');
  result('auto-fill → Apply → Send actually saves the consultation',
    a.posted === 1, 'posted='+a.posted+' blocked="'+(a.blk.shown!=='none'?a.blk.text.slice(0,70):'no')+'"');
  result('every medicine the package added has intake times',
    a.meds.length>0 && a.meds.every(m=>m.times>0),
    JSON.stringify(a.meds).slice(0,180));
  // Six, not thirteen. "Uncomplicated Malaria" used to inherit the whole
  // severe-malaria protocol because sections were cut by page rather than by
  // heading; the rebuilt database keeps the IV drugs on the severe page.
  result('the package lists ALL the guideline\'s medicines, each addable in one tap',
    a.ticked.available>=4 && a.ticked.already===a.ticked.available &&
    /ready to give/i.test(a.ticked.notice),
    'offered='+a.ticked.available+' included='+a.ticked.already+' "'+a.ticked.notice.slice(0,60)+'"');
  result('all of them are carried into the consultation, none left behind',
    a.meds.length===a.ticked.available, a.meds.length+' of '+a.ticked.available);

  const r = a.row || {};
  result('the saved consultation carries the diagnosis, the drugs and the money',
    !!r && /malaria/i.test(r.confirmed_diagnosis||'') &&
    (r.prescription_items||[]).length === a.meds.length &&
    Number(r.total_charged_ugx) === 23000,
    'dx="'+(r.confirmed_diagnosis||'')+'" drugs='+((r.prescription_items||[]).length)+
    ' total='+r.total_charged_ugx+' lab='+(r.lab_tests_ordered||[]).length);

  const c = await run('Malaria Prophylaxis', 'no drugs');
  result('an auto-fill package with no medicines also saves',
    c.posted === 1, 'posted='+c.posted+' blocked="'+(c.blk.shown!=='none'?c.blk.text.slice(0,70):'no')+'"');


  // ── The situation in the clinic's screenshot: package built, NO patient. ──
  posted.length = 0;
  await page.goto('http://localhost:8980/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{ const st=window._wizState; st.patient=null;
    st.materialsUsed=st.materialsUsed||[];
    const el=document.getElementById('confirmedDx');
    el.value='Malaria'; el.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.click('#ucgOneTap'); await page.waitForTimeout(3000);
  await page.evaluate(()=>{ const a=document.getElementById('ucgAsk');
    if(a && getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]'); if(f) f.click();} });
  await page.waitForTimeout(2500);
  // Only the first choice arrives ticked now — tick the rest, as a clinician
  // giving the whole list would.
  await page.evaluate(async () => {
    for (let guard = 0; guard < 40; guard++) {
      const off = document.querySelector('.ucg-drug:not(.on) [data-tick]');
      if (!off) break;
      off.click();
      await new Promise(r => setTimeout(r, 60));
    }
  });
  await page.waitForTimeout(500);
  await page.evaluate(()=>{ window.__t=[]; const o=window.showToast;
    window.showToast=function(m,t){ window.__t.push(String(m)); return o&&o.apply(this,arguments); }; });
  await page.evaluate(()=>{ const b=document.getElementById('ucgSave'); if(b) b.click(); });
  await page.waitForTimeout(1200);
  // "Save this as your standard?" — same prompt run() answers. Ticking the
  // whole list makes the package differ from the learned standard, so it now
  // appears here too and the save waits behind it.
  await page.evaluate(()=>{ const a=document.getElementById('ucgAsk');
    if(a && getComputedStyle(a).display!=='none'){ const n=document.getElementById('ucgAskNo'); if(n) n.click(); } });
  await page.waitForTimeout(2500);
  const noP = await page.evaluate(()=>({
    toasts: window.__t||[],
    kept: (window._wizState.medications||[]).filter(m=>(m.drug||'').trim()).length
  }));
  const noPRow = posted[0] || null;
  result('package with NO patient saves anyway — the phone is optional now',
    posted.length === 1 && noP.kept > 0 &&
    !noP.toasts.some(t=>/choose the patient/i.test(t)) &&
    !noPRow.patient_phone && !noPRow.patient_name,
    'saved='+posted.length+' drugs='+noP.kept+
    ' phone='+JSON.stringify(noPRow&&noPRow.patient_phone)+
    ' case='+(noPRow&&noPRow.case_code));

  // Once it is saved, that is the end of it: the confirmation sheet is up and
  // Send is dead, so a second tap cannot record the same visit twice.
  const after = await page.evaluate(()=>({
    sheet: (document.getElementById('successSheet')||{}).style.display||'',
    disabled: !!(document.getElementById('submitBtn')||{}).disabled,
    ways: [...document.querySelectorAll('#successSheet button')].map(b=>b.textContent.trim()),
  }));
  result('after saving, the confirmation sheet is up and Send cannot fire again',
    after.sheet==='flex' && after.disabled && after.ways.length===2,
    'sheet='+after.sheet+' sendDisabled='+after.disabled+' ways='+JSON.stringify(after.ways));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'autofill-save.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
