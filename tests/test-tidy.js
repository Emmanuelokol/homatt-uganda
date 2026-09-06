// Four things at once: a drip must not be dosed like a tablet, every row must
// say WHICH patient it is, Today's Treatments is gone with its counters intact,
// and the cards must stop eating the screen.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9099,ORIGIN='http://localhost:'+PORT;
const TODAY=new Date().toISOString().slice(0,10);

const ACTIVE=[
 {id:'a1',clinic_id:CID,confirmed_diagnosis:'Malaria',created_at:TODAY+'T09:00:00Z',
  patient_name:null,patient_phone:null,case_code:'#001M2708O',follow_up_days:3,
  total_charged_ugx:45000,amount_paid:0,payment_status:'credit'},
 {id:'a2',clinic_id:CID,confirmed_diagnosis:'Typhoid',created_at:TODAY+'T10:00:00Z',
  patient_name:'Okello John',patient_phone:'0788000111',case_code:'#002T2708O',follow_up_days:0,
  total_charged_ugx:30000,amount_paid:30000,payment_status:'paid'},
];
const PENDING=[
 {id:'a1',patient_name:null,patient_phone:null,confirmed_diagnosis:'Malaria',
  total_charged_ugx:45000,amount_paid:0,balance_ugx:45000,payment_status:'credit',
  created_at:TODAY+'T09:00:00Z',last_payment_at:null},
];

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:412,height:915},serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  const inserts=[];
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_inventory/.test(u)&&rq.method()==='POST'){
        let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        inserts.push(Array.isArray(a)?a[0]:a);
        return r.fulfill({status:201,headers:H,body:'[]'});
      }
      if(/get_pending_payments/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(PENDING)});
      if(/clinic_diagnoses/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(ACTIVE)});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  // ── 1. A drip is not a tablet ───────────────────────────────────────────
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);

  const bp = await page.evaluate(()=>{
    const B=window.StockBlueprint; if(!B) return null;
    const u=n=>B.blueprintFor({name:n,itemType:'medicine'}).unit;
    return { dex5:u('Dextrose 5%'), nacl:u('sodium chloride 0.9%'),
             bicarb:u('sodium bicarbonate 8.4%'), dex50:u('Dextrose 50%'),
             amox:u('Amoxicillin 500mg') };
  });
  result('the drips are counted in bottles, the ampoules in vials, tablets in tabs',
    bp && bp.dex5==='bottles' && bp.nacl==='bottles' &&
    bp.bicarb==='vials' && bp.dex50==='vials' && bp.amox==='tabs', JSON.stringify(bp));

  const pkg = await page.evaluate(async ()=>{
    const st=window._wizState;
    st.patient={name:'X',phone:''}; st.severity='severe'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx');
    el.value='Severe Malaria'; el.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,600));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,5000));
    const ask=document.getElementById('ucgAsk');
    if(ask&&getComputedStyle(ask).display!=='none'){
      const c=ask.querySelector('[data-h]'); if(c) c.click();
      await new Promise(r=>setTimeout(r,4500));
    }
    const fluids=[...document.querySelectorAll('.ucg-drug')].filter(d=>{
      const n=(d.querySelector('.nm b')||{}).textContent||'';
      return /dextrose|sodium chloride|sodium bicarbonate|ringer|saline/i.test(n);
    }).map(d=>({
      name:(d.querySelector('.nm b')||{}).textContent||'',
      here: !!d.querySelector('.ucg-here'),
      hasDayFields: !!d.querySelector('[data-fd]'),
      qty: (d.querySelector('[data-qt]')||{}).value,
      unitLabel: (d.querySelector('.fields-here .ucg-lbl')||{}).textContent||'',
    }));
    return { fluids, total: document.querySelectorAll('.ucg-drug').length };
  });
  result('every drip is marked "given here at the clinic"',
    pkg.fluids.length>0 && pkg.fluids.every(f=>f.here),
    JSON.stringify(pkg.fluids.map(f=>f.name)));
  result('a drip is never asked "times a day" or "for how many days"',
    pkg.fluids.every(f=>!f.hasDayFields), JSON.stringify(pkg.fluids.map(f=>f.hasDayFields)));
  result('a drip starts at ONE bag, not ten tablets',
    pkg.fluids.every(f=>Number(f.qty)>=1 && Number(f.qty)<=6),
    JSON.stringify(pkg.fluids.map(f=>f.name+'='+f.qty)));
  result('the drip is counted in bottles or vials — never "tabs"',
    pkg.fluids.every(f=>/bottle|vial|ml|unit/i.test(f.unitLabel)),
    JSON.stringify(pkg.fluids.map(f=>f.unitLabel)));
  result('treatment screen: no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  // ── 2 & 3 & 4. The dashboard ────────────────────────────────────────────
  errs.length=0;
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(9000);

  const dash = await page.evaluate(async ()=>{
    if(window.showSlide) showSlide('patients');
    await new Promise(r=>setTimeout(r,2200));
    const active=[...document.querySelectorAll('#activeTreatmentsList .pt-row')];
    return {
      todayGone: !document.getElementById('ordersList'),
      statToday: (document.getElementById('statToday')||{}).textContent,
      activeCount: (document.getElementById('activeCount')||{}).textContent,
      names: active.map(r=>((r.querySelector('.pt-who')||{}).textContent||'').trim()),
      // The affordance is the case number itself — a chip underneath made the
      // row a third taller, which is the opposite of what was asked for.
      addable: active.filter(r=>r.querySelector('.pt-who.addable')).length,
      heights: active.map(r=>Math.round(r.getBoundingClientRect().height)),
      noSeparateCard: !document.getElementById('needNameList'),
    };
  });
  result('"Today\'s Treatments" is gone', dash.todayGone && dash.noSeparateCard);
  result('and the home counters it fed still work', dash.statToday==='2', 'Today\'s Patients='+dash.statToday);
  result('an unnamed active treatment shows its case number, not "Unnamed"',
    dash.names.some(n=>/^#001M2708O/.test(n)) && dash.names.indexOf('Unnamed')<0,
    JSON.stringify(dash.names));
  result('the missing name is taken on the row itself, without a taller row',
    dash.addable===1 && dash.heights.every(h=>h>0 && h<80),
    'addable='+dash.addable+' heights='+JSON.stringify(dash.heights));
  result('the header says how many still need a name',
    /unnamed/.test(dash.activeCount||''), dash.activeCount);

  const money = await page.evaluate(async ()=>{
    if(window.showSlide) showSlide('money');
    await new Promise(r=>setTimeout(r,2500));
    const el=document.getElementById('pendingPaymentsList')
          || document.querySelector('[id*="ending"]');
    const txt=(el?el.innerText:document.body.innerText);
    return { walkIn:/Walk-in/.test(txt), caseNo:/#001M2708O|CLN-/.test(txt),
             addChip: !!document.querySelector('.px-add') };
  });
  result('Pending Payments identifies the patient instead of saying "Walk-in"',
    !money.walkIn && money.caseNo, JSON.stringify(money));
  result('and offers to put a name to the debt', money.addChip);

  // Height: the same cards, measurably shorter.
  const size = await page.evaluate(async ()=>{
    if(window.showSlide) showSlide('patients');
    await new Promise(r=>setTimeout(r,1500));
    const p=document.querySelector('[data-slide-key="patients"]');
    const cards=[...p.querySelectorAll('.admin-table-wrap')].filter(c=>c.offsetParent!==null);
    // A header holding period buttons (30 days / 90 days) needs a second line —
    // that is the chips, not wasted space. Only plain headers must be compact.
    const plain=[...p.querySelectorAll('.table-header')].filter(h=>
      h.offsetParent!==null && !h.querySelector('.table-filter') && !h.querySelector('button'));
    return { cards:cards.length,
             tallestPlainHeader:Math.max.apply(null,plain.map(h=>Math.round(h.getBoundingClientRect().height)).concat([0])),
             gap: getComputedStyle(cards[0]||document.body).marginBottom };
  });
  result('card headers are a single compact row, not a stacked block',
    size.tallestPlainHeader>0 && size.tallestPlainHeader<=52,
    'tallest plain header '+size.tallestPlainHeader+'px');
  result('the gap between cards is tightened for a phone',
    parseInt(size.gap,10)<=14, 'gap '+size.gap);
  result('dashboard: no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  await page.screenshot({path:'/tmp/claude-0/-home-user-homatt-uganda/f3451427-e03d-514d-8f41-e3e6f96e4176/scratchpad/offline-test/tidy.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
