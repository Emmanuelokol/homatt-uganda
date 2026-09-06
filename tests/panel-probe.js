const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
(async()=>{await new Promise(r=>server.listen(9024,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:1200}})).newPage();
await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:9024'))return r.continue();
 if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});return r.abort();});
await page.goto('http://localhost:9024/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9024/clinic/new-order.html');
await page.waitForFunction(()=>!!window._wizState,{timeout:30000});await page.waitForTimeout(2500);
for (const dx of process.argv.slice(2)) {
  await page.evaluate((d)=>{const st=window._wizState;st.patient={name:'X',phone:''};st.severity='moderate';st.materialsUsed=[];
    const el=document.getElementById('confirmedDx');el.value=d;el.dispatchEvent(new Event('input',{bubbles:true}));},dx);
  await page.click('#ucgOneTap');await page.waitForTimeout(3200);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');if(a&&getComputedStyle(a).display!=='none'){
    const c=a.querySelector('[data-c]')||a.querySelector('[data-h]');if(c)c.click();}});
  await page.waitForTimeout(2800);
  console.log(await page.evaluate((d)=>{const t=el=>(el?el.textContent:'').replace(/\s+/g,' ').trim();
    return {asked:d, opened:t(document.getElementById('ucgTitle')),
      meds:document.querySelectorAll('.ucg-drug').length,
      tests:document.querySelectorAll('#ucgTests .ucg-chip').length,
      notePanels:[...document.querySelectorAll('.ucg-det summary')].map(s=>t(s).replace(/^[a-z_]+/,'').replace('expand_more','')),
      noteChars:[...document.querySelectorAll('.ucg-det-b')].reduce((n,x)=>n+x.textContent.length,0)};},dx));
  await page.evaluate(()=>window.UCGPackage.close());await page.waitForTimeout(300);
}
await b.close();server.close();})();
