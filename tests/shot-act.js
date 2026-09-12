const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const now=new Date();
const MEDS=[{drug_name:'Ciprofloxacin 500mg',strength:'500mg',frequency:'2x_daily',duration:10,quantity:20},
 {drug_name:'Chloramphenicol 500mg',strength:'500mg',frequency:'4x_daily',duration:10,quantity:40},
 {drug_name:'Ceftriaxone 1g',strength:'1g IV',frequency:'2x_daily',duration:10,quantity:20},
 {drug_name:'Amoxicillin 1g',strength:'1g',frequency:'3x_daily',duration:10,quantity:30},
 {drug_name:'Doxycycline 100mg',strength:'100mg',frequency:'2x_daily',duration:5,quantity:10},
 {drug_name:'Azithromycin 200mg',strength:'200mg',frequency:'2x_daily',duration:5,quantity:10}];
const NAMES=['Emmanuel Ssali','Okello John','Nakato Grace','','Mukasa Peter','','Achan Mary','Ojok Denis'];
const DXS=['Typhoid fever','Malaria','Upper respiratory tract infection','Typhoid','Pneumonia','Urinary tract infection','Malaria','Peptic ulcer disease'];
const ROWS=NAMES.map(function(n,i){return{
  id:'r'+i, clinic_id:CID, confirmed_diagnosis:DXS[i], severity:i%3===0?'severe':'moderate',
  created_at:new Date(now.getTime()-i*3600000-(i>4?2*86400000:0)).toISOString(),
  patient_phone:n?'078800942'+i:null, patient_name:n||null, patient_type:'outpatient',
  total_charged_ugx:[20000,40000,15000,0,32000,18000,25000,12000][i],
  amount_paid:[0,40000,15000,0,10000,18000,0,0][i],
  payment_status:[ 'pending','paid','paid','waived','partial','paid','credit','pending'][i],
  follow_up_days:i%2?7:1, follow_up_reason:i===0?'BP recheck':null,
  prescription_items:MEDS.slice(0,(i%6)+1), case_code:'#00'+(i+1)+DXS[i][0]+'2308O'};});
const _OLD=[
 {id:'a1',clinic_id:CID,confirmed_diagnosis:'Typhoid fever',severity:'moderate',created_at:now.toISOString(),
  patient_phone:null,patient_name:null,patient_type:'outpatient',total_charged_ugx:20000,amount_paid:0,
  payment_status:'pending',follow_up_days:7,follow_up_reason:'BP recheck',prescription_items:MEDS,case_code:'#001T2508O'},
 {id:'a2',clinic_id:CID,confirmed_diagnosis:'Malaria',severity:'severe',created_at:new Date(now-2*86400000).toISOString(),
  patient_phone:'0788099425',patient_name:'Okello John',patient_type:'inpatient',total_charged_ugx:40000,amount_paid:40000,
  payment_status:'paid',follow_up_days:1,follow_up_reason:null,prescription_items:MEDS.slice(0,3),case_code:'#002M2308I'}];
(async()=>{await new Promise(r=>server.listen(8996,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:430,height:1100},deviceScaleFactor:2,hasTouch:true});
const page=await ctx.newPage();
await page.route('**/*',r=>{const u=r.request().url();
 if(u.startsWith('http://localhost:8996'))return r.continue();
 if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
  if(/\/rest\/v1\/clinic_diagnoses/.test(u))return r.fulfill({status:200,headers:H,body:JSON.stringify(ROWS)});
  return r.fulfill({status:200,headers:H,body:'[]'});}
 return r.abort();});
await page.goto('http://localhost:8996/clinic/index.html',{waitUntil:'domcontentloaded'});
await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:8996/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(6000);
await page.evaluate(()=>{ const t=[...document.querySelectorAll('.slide-tab')]
  .find(x=>/patie/i.test(x.textContent||'')); if(t) t.click(); });
await page.waitForTimeout(1500);
await page.evaluate(()=>{const c=document.querySelector('.act-card'); if(c) c.scrollIntoView({block:'center'});});
await page.waitForTimeout(400);
const box = await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('#activeTreatmentsList .pt-row')];
  if(!rows.length) return null;
  const first=rows[0].getBoundingClientRect(), last=rows[rows.length-1].getBoundingClientRect();
  return {n:rows.length, top:first.top+window.scrollY-40, h:(last.bottom-first.top)+80};
});
console.log('rows:', box && box.n);
if(box){ await page.setViewportSize({width:430,height:Math.min(1600,Math.ceil(box.h))});
  await page.evaluate(y=>window.scrollTo(0,y), box.top); await page.waitForTimeout(600); }
await page.screenshot({path:'act-dark.png'});
// open the patient detail to see the drug list
await page.evaluate(()=>{const c=document.querySelector('.act-card'); if(c) c.click();});
await page.waitForTimeout(2500);
await page.screenshot({path:'act-meds-dark.png'});
await b.close();server.close();})();
