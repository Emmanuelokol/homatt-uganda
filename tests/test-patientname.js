// A walk-in is treated first and named later. There must be somewhere obvious
// to type a name and a number DURING the treatment, and a catch-up list for a
// quiet moment afterwards — especially for the patients told to come back.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9097,ORIGIN='http://localhost:'+PORT;
const TODAY=new Date().toISOString().slice(0,10);

// Three open cases: one unnamed and coming back, one unnamed walk-in, one named
// but with no phone. A fourth is complete and must NOT appear in the list.
const ACTIVE=[
 {id:'a1',clinic_id:CID,confirmed_diagnosis:'Malaria',created_at:TODAY+'T09:00:00Z',
  patient_name:null,patient_phone:null,case_code:'#001M2708O',follow_up_days:3,
  total_charged_ugx:45000,amount_paid:45000,payment_status:'paid'},
 {id:'a2',clinic_id:CID,confirmed_diagnosis:'Typhoid',created_at:TODAY+'T10:00:00Z',
  patient_name:null,patient_phone:null,case_code:'#002T2708O',follow_up_days:0,
  total_charged_ugx:30000,amount_paid:0,payment_status:'credit'},
 {id:'a3',clinic_id:CID,confirmed_diagnosis:'UTI',created_at:TODAY+'T11:00:00Z',
  patient_name:'Aciro Grace',patient_phone:null,case_code:'#003U2708O',follow_up_days:0,
  total_charged_ugx:20000,amount_paid:20000,payment_status:'paid'},
 {id:'a4',clinic_id:CID,confirmed_diagnosis:'Cough',created_at:TODAY+'T12:00:00Z',
  patient_name:'Okello John',patient_phone:'0788000111',case_code:'#004C2708O',follow_up_days:0,
  total_charged_ugx:10000,amount_paid:10000,payment_status:'paid'},
];

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:412,height:915},serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  const patches=[]; let offline=false;
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      if(offline) return r.abort();
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_diagnoses/.test(u)&&rq.method()==='PATCH'){
        let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        patches.push(a);
        return r.fulfill({status:200,headers:H,body:JSON.stringify([{id:'a1'}])});
      }
      if(/clinic_diagnoses/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(ACTIVE)});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  // ── 1. During the treatment ─────────────────────────────────────────────
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);

  const fields = await page.evaluate(()=>{
    const n=document.getElementById('quickPatientName');
    const p=document.getElementById('quickPatientPhone');
    const vis=el=>!!el && el.offsetParent!==null && getComputedStyle(el).display!=='none';
    const dx=document.getElementById('confirmedDx');
    return { name:vis(n), phone:vis(p),
             nameLabel:(document.querySelector('label[for="quickPatientName"]')||{}).textContent,
             phoneLabel:(document.querySelector('label[for="quickPatientPhone"]')||{}).textContent,
             optional:/optional/i.test(document.body.innerText),
             // The name now comes FIRST, before the complaint and the
             // diagnosis — the order a consultation actually happens in.
             aboveDx: !!(n && dx && n.getBoundingClientRect().top < dx.getBoundingClientRect().top) };
  });
  result('there is a visible place for the name and the phone on the treatment screen',
    fields.name && fields.phone, JSON.stringify(fields));
  result('they are labelled plainly and marked optional',
    fields.nameLabel==='Name' && fields.phoneLabel==='Phone' && fields.optional);
  result('they come first, before the complaint and the diagnosis', fields.aboveDx);

  const typed = await page.evaluate(async ()=>{
    const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};
    set('quickPatientName','Okello John'); set('quickPatientPhone','0788000111');
    await new Promise(r=>setTimeout(r,200));
    const p=window._wizState.patient||{};
    return { name:p.name, phone:p.phone, next:!document.getElementById('step1Next').disabled };
  });
  result('what is typed lands on the treatment being recorded',
    typed.name==='Okello John' && typed.phone==='0788000111', JSON.stringify(typed));

  // Emptying them must not leave a half-patient behind, and must never block.
  const cleared = await page.evaluate(async ()=>{
    const set=(id,v)=>{const e=document.getElementById(id);e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));};
    set('quickPatientName',''); set('quickPatientPhone','');
    await new Promise(r=>setTimeout(r,200));
    return { patient: window._wizState.patient,
             dxOnlyWorks: (function(){
               const d=document.getElementById('confirmedDx');
               d.value='Malaria'; d.dispatchEvent(new Event('input',{bubbles:true}));
               return !document.getElementById('step1Next').disabled; })() };
  });
  result('clearing them leaves no half-patient, and a nameless treatment still continues',
    cleared.patient===null && cleared.dxOnlyWorks, JSON.stringify(cleared));
  result('treatment screen: no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  // ── 2. Adding the name later, from Active Treatments ────────────────────
  // The separate "Names to add" card was folded into Active Treatments at the
  // clinic's request: an unnamed row shows its case number and takes the name
  // on a tap, without growing a line.
  errs.length=0;
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(9000);
  const list = await page.evaluate(async ()=>{
    if(window.showSlide) showSlide('patients');
    await new Promise(r=>setTimeout(r,2000));
    const rows=[...document.querySelectorAll('#activeTreatmentsList .pt-row')];
    return { count:(document.getElementById('activeCount')||{}).textContent,
             who: rows.map(r=>(r.querySelector('.pt-who')||{}).textContent.trim()),
             addable: rows.filter(r=>r.querySelector('.pt-who.addable')).length,
             heights: rows.map(r=>Math.round(r.getBoundingClientRect().height)),
             noSeparateCard: !document.getElementById('needNameList') };
  });
  result('the separate "Names to add" card is gone — it lives in Active Treatments',
    list.noSeparateCard);
  result('an unnamed treatment shows its case number and offers to take a name',
    list.addable===2 && list.who.some(w=>/#001M2708O/.test(w)) &&
    list.who.some(w=>/#002T2708O/.test(w)), JSON.stringify(list.who));
  result('offering it costs no extra height',
    list.heights.every(h=>h>0 && h<80), JSON.stringify(list.heights));
  result('the header says how many still have no name',
    /2 unnamed/.test(list.count||''), list.count);

  // ── 3. Filling one in ───────────────────────────────────────────────────
  const filled = await page.evaluate(async ()=>{
    document.querySelector('#activeTreatmentsList .pt-who.addable').click();
    await new Promise(r=>setTimeout(r,700));
    const ov=document.getElementById('pxEditOverlay');
    if(!ov || getComputedStyle(ov).display==='none') return {opened:false};
    document.getElementById('pxName').value='Nakato Sarah';
    document.getElementById('pxPhone').value='0788222333';
    document.getElementById('pxSave').click();
    await new Promise(r=>setTimeout(r,2500));
    const rows=[...document.querySelectorAll('#activeTreatmentsList .pt-row')];
    return { opened:true, who:rows.map(r=>(r.querySelector('.pt-who')||{}).textContent.trim()),
             count:(document.getElementById('activeCount')||{}).textContent };
  });
  result('tapping the case number opens the patient-details box', filled.opened);
  result('saving sends the name and number to the treatment',
    patches.length===1 && patches[0].patient_name==='Nakato Sarah' &&
    patches[0].patient_phone==='0788222333', JSON.stringify(patches[0]||{}));
  result('the name replaces the case number the moment it is saved',
    filled.who.some(w=>/Nakato Sarah/.test(w)) && /1 unnamed/.test(filled.count||''),
    JSON.stringify(filled.who)+' '+filled.count);

  // ── 4. With no signal ───────────────────────────────────────────────────
  offline=true;
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});
    window.dispatchEvent(new Event('offline'));});
  const off = await page.evaluate(async ()=>{
    document.querySelector('#activeTreatmentsList .pt-who.addable').click();
    await new Promise(r=>setTimeout(r,700));
    document.getElementById('pxName').value='Opio Peter';
    document.getElementById('pxPhone').value='0788444555';
    document.getElementById('pxSave').click();
    await new Promise(r=>setTimeout(r,2500));
    const q=(window.ClinicOffline&&ClinicOffline.get('outbox',[]))||[];
    return { addable:[...document.querySelectorAll('#activeTreatmentsList .pt-who.addable')].length,
             queued:q.filter(x=>x.type==='table_update').length };
  });
  result('a name added with no signal is queued, not lost', off.queued>0, 'queued='+off.queued);
  result('and the case number becomes the name immediately, offline',
    off.addable===0, 'still unnamed='+off.addable);
  result('dashboard: no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  await page.screenshot({path:'/tmp/claude-0/-home-user-homatt-uganda/f3451427-e03d-514d-8f41-e3e6f96e4176/scratchpad/offline-test/needname.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
