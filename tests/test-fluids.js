// Whether a patient needs a drip is a bedside decision, not something the
// chapter can know. The book names a fluid on only 23 of its 340 treatable
// conditions — so on every OTHER condition there must still be somewhere to
// hang one, and anything fluid-like must land there rather than under Treatment.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9101,ORIGIN='http://localhost:'+PORT;

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1300},serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);

  async function openDx(dx){
    return page.evaluate(async (name)=>{
      const st=window._wizState;
      st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
      const c=document.getElementById('ucgOverlay'); if(c) c.style.display='none';
      const el=document.getElementById('confirmedDx');
      el.focus(); el.select && el.select();
      el.value=name; el.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,600));
      document.getElementById('ucgOneTap').click();
      await new Promise(r=>setTimeout(r,5000));
      const ask=document.getElementById('ucgAsk');
      if(ask&&getComputedStyle(ask).display!=='none'){
        const h=ask.querySelector('[data-h]'); if(h) h.click();
        await new Promise(r=>setTimeout(r,4500));
      }
      const groups=[...document.querySelectorAll('.ucg-mg')].map(g=>({
        title:(g.querySelector('.ucg-mgh')||{}).textContent.replace(/\s+/g,' ').trim(),
        rows:g.querySelectorAll('.ucg-drug').length,
        quickFluids:g.querySelectorAll('[data-qf]').length,
        hint:(g.querySelector('.ucg-mgi')||{}).textContent.replace(/\s+/g,' ').trim(),
      }));
      return { groups, opened: getComputedStyle(document.getElementById('ucgOverlay')).display!=='none' };
    }, dx);
  }

  // ── Conditions the book names NO fluid for ──────────────────────────────
  const DRY = ['Typhoid', 'Pneumonia', 'Urinary Tract Infection', 'Peptic Ulcer Disease', 'Asthma'];
  const dry = {};
  for (const d of DRY) dry[d] = await openDx(d);

  const shown = DRY.filter(d=>(dry[d].groups||[]).some(g=>/Drips, fluids & blood/.test(g.title)));
  result('the drips section is offered on every condition, not just malaria',
    shown.length===DRY.length, shown.join(', ') + ' of ' + DRY.join(', '));

  const empties = DRY.map(d=>((dry[d].groups||[]).find(g=>/Drips/.test(g.title))||{}));
  result('when the book names no drip it says so, and invites one',
    empties.every(g=>g.rows===0 && /does not name a drip/.test(g.hint||'')),
    JSON.stringify(empties.map(g=>g.rows)));
  result('the common drips are one tap away on every condition',
    empties.every(g=>g.quickFluids>=6), JSON.stringify(empties.map(g=>g.quickFluids)));

  // ── One tap really hangs one, correctly ─────────────────────────────────
  const added = await page.evaluate(async ()=>{
    const g=[...document.querySelectorAll('.ucg-mg')].find(x=>/Drips/.test(x.textContent));
    const btns=[...g.querySelectorAll('[data-qf]')];
    const saline=btns.find(b=>/Normal saline/.test(b.textContent));
    saline.click();
    await new Promise(r=>setTimeout(r,700));
    const g2=[...document.querySelectorAll('.ucg-mg')].find(x=>/Drips/.test(x.textContent));
    const row=g2.querySelector('.ucg-drug');
    return {
      inFluidSection: !!row,
      name:(row&&row.querySelector('.nm b')||{}).textContent||'',
      givenHere: !!(row&&row.querySelector('.ucg-here')),
      noDayFields: !(row&&row.querySelector('[data-fd]')),
      qty:(row&&row.querySelector('[data-qt]')||{}).value,
      unit:(row&&row.querySelector('.fields-here .ucg-lbl')||{}).textContent||'',
      notInTreatment: !([...document.querySelectorAll('.ucg-mg')]
        .find(x=>/^Treatment/.test(x.textContent))||{textContent:''}).textContent.match(/Sodium chloride/i),
    };
  });
  result('tapping a drip adds it to Drips, fluids & blood — not to Treatment',
    added.inFluidSection && /Sodium chloride/i.test(added.name) && added.notInTreatment,
    JSON.stringify({name:added.name, notInTreatment:added.notInTreatment}));
  result('and it arrives hung, not dosed like a tablet',
    added.givenHere && added.noDayFields && Number(added.qty)===1 && /bottle/i.test(added.unit),
    JSON.stringify({here:added.givenHere, qty:added.qty, unit:added.unit}));

  // ── Searching a fluid by name files it in the right place too ───────────
  const searched = await page.evaluate(async ()=>{
    const inp=document.getElementById('ucgDrugSearch');
    inp.value='Dextrose'; inp.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<40;k++){ await new Promise(r=>setTimeout(r,200));
      const bx=document.getElementById('ucgSearchRes');
      if(bx && bx.style.display==='block' && bx.querySelectorAll('[data-i]').length) break; }
    const hit=document.querySelector('#ucgSearchRes [data-i]');
    if(!hit) return {found:false};
    hit.click();
    await new Promise(r=>setTimeout(r,600));
    const yes=document.getElementById('ucgAskYes');
    if(yes) yes.click();
    await new Promise(r=>setTimeout(r,800));
    const fluid=[...document.querySelectorAll('.ucg-mg')].find(x=>/Drips/.test(x.textContent));
    const treat=[...document.querySelectorAll('.ucg-mg')].find(x=>/^Treatment/.test(x.textContent));
    return { found:true,
             inFluid: /dextrose/i.test(fluid?fluid.textContent:''),
             inTreatment: /dextrose/i.test(treat?treat.textContent:'') };
  });
  result('searching "Dextrose" files it under Drips, not under Treatment',
    searched.found && searched.inFluid && !searched.inTreatment, JSON.stringify(searched));

  // ── The condition that DOES name fluids still works ─────────────────────
  const mal = await openDx('Severe Malaria');
  const malFluid = (mal.groups||[]).find(g=>/Drips/.test(g.title)) || {};
  result('a condition the book DOES name fluids for still lists them',
    malFluid.rows>0 && malFluid.quickFluids>=6,
    'rows='+malFluid.rows+' quick='+malFluid.quickFluids);

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'/tmp/claude-0/-home-user-homatt-uganda/f3451427-e03d-514d-8f41-e3e6f96e4176/scratchpad/offline-test/fluids.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
