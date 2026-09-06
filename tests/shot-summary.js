const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9052';
(async()=>{await new Promise(r=>server.listen(9052,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:390,height:1500},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
  if(u.startsWith(ORIGIN))return r.continue();
  if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
    if(/clinic_diagnoses/.test(u)&&rq.method()==='POST'){let a=null;try{a=JSON.parse(rq.postData()||'null');}catch(e){}
      const row=Array.isArray(a)?a[0]:a;
      return r.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'44444444-4444-4444-8444-444444444444'},row))});}
    if(/get_clinic_stock/.test(u))return r.fulfill({status:200,headers:H,body:JSON.stringify([
      {id:'s1',clinic_id:CID,item_name:'artemether/lumefantrine',item_type:'medicine',unit:'tabs',quantity:60,min_threshold:10,is_active:true}])});
    return r.fulfill({status:200,headers:H,body:'[]'});}
  return r.abort();});
await page.goto(ORIGIN+'/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'Kampala Clinic',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto(ORIGIN+'/clinic/new-order.html');
await page.waitForFunction(()=>!!window._wizState,{timeout:30000});await page.waitForTimeout(2500);
await page.evaluate(()=>{const st=window._wizState;st.patient={name:'Okello John',phone:''};st.severity='moderate';st.materialsUsed=[];
 const el=document.getElementById('confirmedDx');el.value='Malaria';el.dispatchEvent(new Event('input',{bubbles:true}));});
await page.waitForTimeout(500);
await page.evaluate(()=>document.getElementById('ucgOneTap').click());
await page.waitForTimeout(5000);
await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
 if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
await page.waitForTimeout(4000);
// a realistic visit: keep three medicines, drop the rest
await page.evaluate(()=>{
  const rows=[...document.querySelectorAll('.ucg-drug')];
  rows.forEach((r,i)=>{ if(i>=3){ const x=r.querySelector('[data-rmdrug]'); if(x) x.click(); } });
});
await page.waitForTimeout(800);
await page.evaluate(()=>{['ucgFeeC','ucgFeeL','ucgFeeM'].forEach((id,i)=>{const el=document.getElementById(id);
  if(el){el.value=[10000,15000,20000][i];el.dispatchEvent(new Event('input',{bubbles:true}));}});
  const p=document.querySelector('.ucg-paychip[data-pay="credit"]'); if(p) p.click();});
await page.waitForTimeout(600);
await page.evaluate(()=>{const s=document.getElementById('ucgSave'); if(s) s.click();});
await page.waitForTimeout(1500);
await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
 if(a&&getComputedStyle(a).display!=='none'){const n=document.getElementById('ucgAskNo'); if(n) n.click();}});
await page.waitForTimeout(5000);
const seen=await page.evaluate(()=>{const sh=document.getElementById('successSheet');
  return {shown: sh?getComputedStyle(sh).display:'missing',
          text:(document.getElementById('successBody')||{}).textContent||'',
          over: document.documentElement.scrollWidth>document.documentElement.clientWidth+1};});
console.log('sheet:',seen.shown,' overflows:',seen.over);
console.log('summary text:\n  '+seen.text.replace(/\s+/g,' ').trim().slice(0,600));
console.log('errs',errs.slice(0,3));
await page.screenshot({path:'summary.png'});
await b.close();server.close();})();
