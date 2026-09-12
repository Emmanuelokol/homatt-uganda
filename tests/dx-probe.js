const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
(async()=>{await new Promise(r=>server.listen(9022,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:1200}})).newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:9022'))return r.continue();
 if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});return r.abort();});
await page.goto('http://localhost:9022/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9022/clinic/new-order.html');
await page.waitForFunction(()=>!!window._wizState,{timeout:20000});await page.waitForTimeout(2200);
for (const q of ['asma','asthma','cold','burn','pain','fever','sepsis','anemia','tb','worms','rabis','tetnus']) {
  await page.evaluate((v)=>{const el=document.getElementById('confirmedDx');el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));},q);
  await page.waitForTimeout(700);
  const s=await page.evaluate(async ()=>{
    for(let k=0;k<20;k++){ await new Promise(r=>setTimeout(r,200));
      const bx=document.getElementById('ucgDxRes');
      if(bx && getComputedStyle(bx).display!=='none' && bx.querySelectorAll('[data-d]').length) break; }
    const box=document.getElementById('ucgDxRes');
    return box?[...box.querySelectorAll('[data-d]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()).slice(0,6):[];});
  console.log('typed "'+q+'"  →  '+JSON.stringify(s));
}
// now the one-tap with typhoid typed
await page.evaluate(()=>{const st=window._wizState;st.patient={name:'X',phone:''};st.severity='moderate';st.materialsUsed=[];
 const el=document.getElementById('confirmedDx');el.value='Typhoid';el.dispatchEvent(new Event('input',{bubbles:true}));});
await page.waitForTimeout(600);
await page.click('#ucgOneTap');await page.waitForTimeout(3500);
console.log('after one-tap with "Typhoid":',await page.evaluate(()=>({
  ask:(document.getElementById('ucgAsk')&&getComputedStyle(document.getElementById('ucgAsk')).display!=='none')
      ?document.getElementById('ucgAskTitle').textContent+' | '+[...document.querySelectorAll('#ucgAsk [data-h],#ucgAsk [data-c]')].map(x=>x.textContent.trim()).join(' / '):'none',
  title:(document.getElementById('ucgTitle')||{}).textContent||'' })));
await page.evaluate(()=>{const a=document.getElementById('ucgAsk');if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-c]')||a.querySelector('[data-h]');if(f)f.click();}});
await page.waitForTimeout(3000);
console.log('package:',await page.evaluate(()=>({title:(document.getElementById('ucgTitle')||{}).textContent||'',
  drugs:[...document.querySelectorAll('.ucg-drug .nm b')].map(x=>x.textContent),
  tests:[...document.querySelectorAll('#ucgTests .ucg-chip')].map(x=>x.textContent.replace('×','').trim())})));
console.log('errs',errs.slice(0,3));
await b.close();server.close();})();
