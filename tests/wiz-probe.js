// What actually lands in the wizard after applying the malaria package?
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9050';
const TICK_ALL = process.env.TICK_ALL==='1';
(async()=>{await new Promise(r=>server.listen(9050,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:1400},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
await page.route('**/*',r=>{const u=r.request().url();
  if(u.startsWith(ORIGIN))return r.continue();
  if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
  return r.abort();});
await page.goto(ORIGIN+'/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto(ORIGIN+'/clinic/new-order.html');
await page.waitForFunction(()=>!!window._wizState,{timeout:30000});await page.waitForTimeout(2500);
await page.evaluate(()=>{const st=window._wizState;st.patient={name:'X',phone:''};st.severity='moderate';st.materialsUsed=[];
 const el=document.getElementById('confirmedDx');el.value='Malaria';el.dispatchEvent(new Event('input',{bubbles:true}));});
await page.waitForTimeout(500);
await page.evaluate(()=>document.getElementById('ucgOneTap').click());
await page.waitForTimeout(5000);
await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
 if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
await page.waitForTimeout(4000);
if(TICK_ALL) await page.evaluate(()=>{document.querySelectorAll('[data-tick]').forEach(t=>{ if(!t.classList.contains('on')) t.click(); });});
await page.waitForTimeout(600);
console.log('ticked in panel:', await page.evaluate(()=>document.querySelectorAll('.ucg-drug.on').length),
            'of', await page.evaluate(()=>document.querySelectorAll('.ucg-drug').length));
// Apply & review
await page.evaluate(()=>{const btns=[...document.querySelectorAll('.ucg-btn')];
 const ap=btns.find(x=>/apply/i.test(x.textContent)); if(ap) ap.click();});
await page.waitForTimeout(2500);
const meds=await page.evaluate(()=>(window._wizState.medications||[]).map((m,i)=>({
  i:i+1, drug:m.drug||'(blank)', dosage:m.dosage||'(none)', times:(m.intakeTimes||[]).length, qty:m.qtyToDeduct||0})));
console.log('\nrows now in the wizard: '+meds.length);
meds.forEach(m=>console.log('   '+String(m.i).padStart(2)+'  '+String(m.drug).slice(0,36).padEnd(38)+'dosage='+String(m.dosage).padEnd(12)+'times='+m.times+'  qty='+m.qty));
const bad=meds.filter(m=>m.drug==='(blank)'||m.dosage==='(none)'||!m.times);
console.log('\nrows that would trigger the red alarm: '+bad.length+(bad.length?'  → '+JSON.stringify(bad.map(x=>x.i+':'+x.drug)):''));
// what does the wizard row look like?
await page.evaluate(()=>{ if(window._showStep) window._showStep(2); });
await page.waitForTimeout(1200);
const lay=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.med-card, .medication-row, [class*=med]')].slice(0,3);
  const host=document.querySelector('#medsList')||document.body;
  return { hostScrollW: host.scrollWidth, hostClientW: host.clientWidth,
           docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth,
           firstRowClass: rows[0]?rows[0].className:'(none)' };
});
console.log('\nlayout: page scrollWidth='+lay.docScrollW+' clientWidth='+lay.docClientW+
            (lay.docScrollW>lay.docClientW+1?'   ← OVERFLOWS SIDEWAYS':'   (fits)'));
console.log('        meds list scrollWidth='+lay.hostScrollW+' clientWidth='+lay.hostClientW);
console.log('errs',errs.slice(0,3));
await page.screenshot({path:'wiz-meds.png',fullPage:false});
await b.close();server.close();})();
