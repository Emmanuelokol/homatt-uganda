const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
(async()=>{await new Promise(r=>server.listen(9028,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:1300},deviceScaleFactor:2})).newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:9028'))return r.continue();
 if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});return r.abort();});
await page.goto('http://localhost:9028/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9028/clinic/new-order.html');
await page.waitForFunction(()=>!!window._wizState,{timeout:30000});await page.waitForTimeout(2500);
// warm the guideline database first, the way a clinician's first keystrokes do
await page.evaluate(()=>{const i=document.getElementById('confirmedDx');i.focus();i.value='ma';i.dispatchEvent(new Event('input',{bubbles:true}));});
await page.waitForTimeout(4000);
for (const q of (process.argv.slice(2).length?process.argv.slice(2):['malaria','typhoid','pneumo','diabet','cough'])) {
  const sug=await page.evaluate(async(v)=>{
    const i=document.getElementById('confirmedDx'); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<25;k++){await new Promise(r=>setTimeout(r,200));
      const bx=document.getElementById('ucgDxRes');
      if(bx&&getComputedStyle(bx).display!=='none'&&bx.querySelectorAll('[data-d]').length)break;}
    const box=document.getElementById('ucgDxRes');
    return box?[...box.querySelectorAll('[data-d]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()):[];},q);
  console.log('typed "'+q+'"  →');
  sug.forEach(s=>console.log('      '+s));
}
// the chooser
await page.evaluate(()=>{const st=window._wizState;st.patient={name:'X',phone:''};st.severity='moderate';st.materialsUsed=[];
 const el=document.getElementById('confirmedDx');el.value='Malaria';el.dispatchEvent(new Event('input',{bubbles:true}));});
await page.click('#ucgOneTap');await page.waitForTimeout(4000);
const ch=await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
  const open=a&&getComputedStyle(a).display!=='none';
  return {open, title:(document.getElementById('ucgAskTitle')||{}).textContent,
    items:[...document.querySelectorAll('#ucgAskDiff [data-h]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()),
    pkg:(document.getElementById('ucgTitle')||{}).textContent};});
console.log('\nchooser after tapping one-tap with "Malaria":', JSON.stringify(ch,null,1));
if(process.env.SHOT){await page.waitForTimeout(300);await page.screenshot({path:'malaria-chooser.png'});}
console.log('errs',errs.slice(0,3));
await b.close();server.close();})();
