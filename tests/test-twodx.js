// One visit, two conditions. Malaria and typhoid together is the commonest
// pair in Uganda, and the record has to name BOTH — not just the last one
// typed, while dispensing the first one's medicines.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9091,ORIGIN='http://localhost:'+PORT;

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1300},serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  const saved=[];
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_diagnoses/.test(u)&&rq.method()==='POST'){
        let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a; saved.push(row);
        return r.fulfill({status:201,headers:H,body:JSON.stringify([Object.assign({id:'dx1'},row)])});
      }
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);

  // Types the condition OVER whatever is in the box — exactly what a clinician
  // does when looking up the next one — then applies the package.
  async function applyDx(dx, fees){
    return page.evaluate(async ([name, fee])=>{
      const st=window._wizState;
      st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=st.materialsUsed||[];
      const el=document.getElementById('confirmedDx');
      el.focus(); el.select && el.select();
      el.value=name; el.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,600));
      document.getElementById('ucgOneTap').click();
      await new Promise(r=>setTimeout(r,5000));
      const ask=document.getElementById('ucgAsk');
      if(ask&&getComputedStyle(ask).display!=='none'){
        const c=ask.querySelector('[data-h]'); if(c) c.click();
        await new Promise(r=>setTimeout(r,4000));
      }
      if(fee){
        [['ucgFeeC',fee.c],['ucgFeeL',fee.l],['ucgFeeM',fee.m]].forEach(([id,v])=>{
          const f=document.getElementById(id);
          if(f){ f.value=String(v); f.dispatchEvent(new Event('input',{bubbles:true})); }
        });
        await new Promise(r=>setTimeout(r,300));
      }
      const ap=document.getElementById('ucgApply');
      if(!ap) return false;
      ap.click();
      await new Promise(r=>setTimeout(r,1200));
      const no=document.getElementById('ucgLearnNo')||document.querySelector('[data-learn="no"]');
      if(no){ no.click(); await new Promise(r=>setTimeout(r,600)); }
      return true;
    }, [dx, fees]);
  }
  const snap = () => page.evaluate(()=>{const s=window._wizState;return{
    dx:s.confirmedDx, box:document.getElementById('confirmedDx').value,
    meds:(s.medications||[]).map(m=>m.drug), labs:(s.labTests||[]).slice(),
    fees:{c:s.feeConsult,l:s.feeLab,m:s.feeMeds}};});

  await applyDx('Malaria', {c:5000,l:10000,m:20000});
  const one = await snap();
  result('the first condition is recorded on its own',
    one.dx==='Malaria' && one.meds.length>0 && one.labs.length>0, JSON.stringify(one.dx));

  await applyDx('Typhoid', {c:5000,l:15000,m:30000});
  const two = await snap();

  result('BOTH conditions are in the diagnosis, in the order they were treated',
    two.dx==='Malaria + Typhoid' && two.box==='Malaria + Typhoid',
    'state="'+two.dx+'" box="'+two.box+'"');
  result('the medicines for both conditions are prescribed',
    /artemether|lumefantrine/i.test(two.meds.join(' ')) &&
    /ciprofloxacin|ceftriaxone/i.test(two.meds.join(' ')) &&
    two.meds.length>one.meds.length,
    two.meds.length+' medicines');
  result('the lab tests for both conditions are ordered',
    /Malaria RDT/i.test(two.labs.join(' | ')) && /Widal/i.test(two.labs.join(' | ')),
    JSON.stringify(two.labs));
  result('lab and medicine charges add up; the consultation is charged once',
    two.fees.c===5000 && two.fees.l===25000 && two.fees.m===50000,
    JSON.stringify(two.fees));

  // Applying the same package again must change nothing.
  await applyDx('Typhoid', {c:5000,l:15000,m:30000});
  const again = await snap();
  result('re-applying the same condition does not double the diagnosis',
    again.dx==='Malaria + Typhoid', again.dx);
  result('re-applying the same condition does not prescribe the drugs twice',
    again.meds.length===two.meds.length, again.meds.length+' vs '+two.meds.length);
  result('re-applying the same condition does not double the bill',
    again.fees.l===25000 && again.fees.m===50000, JSON.stringify(again.fees));

  // "+ Add another condition" keeps what is there and opens a slot.
  const addBtn = await page.evaluate(async ()=>{
    const el=document.getElementById('confirmedDx');
    el.focus(); el.select && el.select();
    el.value='Pneumonia'; el.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,500));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,5000));
    const ask=document.getElementById('ucgAsk');
    if(ask&&getComputedStyle(ask).display!=='none'){
      const c=ask.querySelector('[data-h]'); if(c) c.click();
      await new Promise(r=>setTimeout(r,4000));
    }
    const btn=document.getElementById('ucgAddCond');
    if(!btn) return {found:false};
    btn.click();
    await new Promise(r=>setTimeout(r,900));
    const no=document.getElementById('ucgLearnNo')||document.querySelector('[data-learn="no"]');
    if(no){ no.click(); await new Promise(r=>setTimeout(r,500)); }
    const box=document.getElementById('confirmedDx');
    return {found:true, box:box.value, caret:box.selectionStart===box.value.length};
  });
  result('"+ Add another condition" keeps the conditions and opens a slot for the next',
    addBtn.found && /Pneumonia \+ $/.test(addBtn.box) &&
    /Malaria/.test(addBtn.box) && /Typhoid/.test(addBtn.box) && addBtn.caret,
    '"'+addBtn.box+'"');

  // Take a condition's treatment off and it drops out of the diagnosis by itself.
  const dropped = await page.evaluate(async ()=>{
    const s=window._wizState;
    // remove everything malaria contributed
    const mal=(s.dxApplied||{})['malaria']||{};
    const md=(mal.drugs||[]).map(d=>String(d).toLowerCase());
    const mt=(mal.tests||[]).map(t=>String(t).toLowerCase());
    s.medications=(s.medications||[]).filter(m=>md.indexOf(String(m.drug).toLowerCase())<0);
    s.labTests=(s.labTests||[]).filter(t=>mt.indexOf(String(t).toLowerCase())<0);
    return true;
  });
  await applyDx('Typhoid', {c:5000,l:15000,m:30000});
  const after = await snap();
  result('a condition whose treatment is removed drops out of the diagnosis',
    !/Malaria/i.test(after.dx) && /Typhoid/i.test(after.dx), after.dx);

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
