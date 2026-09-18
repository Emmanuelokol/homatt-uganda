// The patient-history search results, on a phone.
//   node shot-plist.js <tag>
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const TAG=process.argv[2]||'now';
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9064';

const ROWS = [
  {id:'a1',patient_name:'Emmanuel ssail',patient_phone:'0778963596',confirmed_diagnosis:'Typhoid fever',severity:'moderate',patient_type:'outpatient',created_at:'2026-08-20T09:00:00Z',total_charged_ugx:30000,amount_paid:30000,payment_status:'paid',prescription_items:[{drug_name:'Ciprofloxacin 500mg',frequency:'2x/day',duration:7,quantity:14}]},
  {id:'b1',patient_name:'emmanuel okol',patient_phone:'0788099425',confirmed_diagnosis:'',severity:'moderate',patient_type:'outpatient',created_at:'2026-08-11T09:00:00Z',clinician_name:'DANIEL MUSINGUZI',clinical_findings:'Negative for all the tests',lab_tests_ordered:'B/P, CRP, Full Blood Count (FBC), BP Measurement',expected_recovery:'2026-08-11',consultation_fee_ugx:2000,lab_fee_ugx:4000,total_charged_ugx:6000,amount_paid:0,payment_status:'pending',prescription_items:[{drug_name:'N/A',frequency:'1x/day',duration:1}]},
  {id:'b2',patient_name:'emmanuel okol',patient_phone:'0788099425',confirmed_diagnosis:'Wounds',severity:'moderate',patient_type:'outpatient',created_at:'2026-07-27T00:13:00Z',total_charged_ugx:12000,amount_paid:12000,payment_status:'paid',prescription_items:[{drug_name:'Amoxicillin 500mg',frequency:'3x/day',duration:1,quantity:3}]},
  {id:'c1',patient_name:'Emmanuel Kato',patient_phone:'0700111222',confirmed_diagnosis:'Malaria',severity:'mild',patient_type:'outpatient',created_at:'2026-06-02T09:00:00Z',total_charged_ugx:15000,amount_paid:0,payment_status:'pending',prescription_items:[]},
];

(async()=>{await new Promise(r=>server.listen(9064,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
for (const theme of ['dark','light']) {
  const page=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
  page.on('pageerror',e=>console.log('PAGEERROR',theme,e.message.split('\n')[0]));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_diagnoses/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(ROWS)});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid,th])=>{localStorage.clear();localStorage.setItem('homatt_theme',th);
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID,theme]);
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(2500);

  // Show the Patients slide, then run the REAL search.
  await page.evaluate(()=>{
    document.querySelectorAll('[data-slide]').forEach(el=>{ if(el.dataset.slide==='patients') el.style.display=''; });
    const btn=[...document.querySelectorAll('.slide-tab')].find(b=>/patie/i.test(b.textContent));
    if(btn) btn.click();
    const inp=document.getElementById('histSearchInput');
    if(inp) inp.value='emmanuel';
    searchPatientHistory();
  });
  await page.waitForTimeout(1400);
  await page.evaluate(()=>{
    const r=document.getElementById('histResults');
    if(r) r.scrollIntoView({block:'start'});
  });
  await page.waitForTimeout(300);

  const shot = await page.evaluate(()=>{
    const res=document.getElementById('histResults');
    if(!res) return {err:'no histResults'};
    const cards=[...res.querySelectorAll('.ph-row')];
    return { align: (res.querySelector('.ph-list')?getComputedStyle(res.querySelector('.ph-list')).textAlign:'n/a'), n: cards.length,
             heights: cards.map(c=>Math.round(c.getBoundingClientRect().height)),
             text: (cards[0]||{}).textContent ? cards[0].textContent.replace(/\s+/g,' ').trim().slice(0,60) : '' };
  });
  console.log('── '+theme+' ── align='+shot.align+'  cards='+shot.n+'  heights='+JSON.stringify(shot.heights));
  if(shot.text) console.log('   first: '+shot.text);
  await page.screenshot({path:`plist-${theme}-${TAG}.png`});
  // and the record itself, with the in-record search
  await page.evaluate(async ()=>{
    const row=[...document.querySelectorAll('#histResults .ph-row')].find(r=>/okol/i.test(r.textContent));
    if(row) row.click();
    await new Promise(r=>setTimeout(r,600));
  });
  await page.waitForTimeout(500);
  await page.screenshot({path:`precord-${theme}-${TAG}.png`});
  await page.close();
}
await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
