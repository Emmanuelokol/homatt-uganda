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
(async()=>{await new Promise(r=>server.listen(9016,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:1500},deviceScaleFactor:2,hasTouch:true})).newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:9016'))return r.continue();
 if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});return r.abort();});
await page.goto('http://localhost:9016/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9016/clinic/new-order.html');await page.waitForTimeout(2600);
await page.evaluate(()=>{const st=window._wizState;st.patient={name:'X',phone:'',id:null,clinicPatientId:null};
 st.patientType='outpatient';st.severity='moderate';st.materialsUsed=[];
 const el=document.getElementById('confirmedDx');el.value='Malaria';el.dispatchEvent(new Event('input',{bubbles:true}));});
await page.click('#ucgOneTap');await page.waitForTimeout(3000);
await page.evaluate(()=>{const a=document.getElementById('ucgAsk');if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
await page.waitForTimeout(2500);
// tick the first treatment drug so the fields show
await page.evaluate(()=>{const t=document.querySelector('[data-tick]');if(t)t.click();});
await page.waitForTimeout(500);
await page.evaluate(()=>{const e=document.getElementById('ucgDrugs');if(e)e.scrollIntoView({block:'start'});});
await page.waitForTimeout(400);
await page.screenshot({path:'meds.png'});
console.log('errs',errs.slice(0,3));
console.log(await page.evaluate(()=>({
  count:(document.querySelector('.ucg-count')||{}).textContent,
  groups:[...document.querySelectorAll('.ucg-mgh')].map(x=>x.textContent.trim()),
  rows:document.querySelectorAll('.ucg-drug').length,
  notes:document.querySelectorAll('.ucg-note').length,
  tests:[...document.querySelectorAll('#ucgTests .ucg-chip')].map(x=>x.textContent.replace('×','').trim()),
})));
await b.close();server.close();})();
