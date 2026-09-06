const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const DX = process.argv[2] || 'Malaria';
(async()=>{await new Promise(r=>server.listen(9019,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:1400},deviceScaleFactor:2})).newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:9019'))return r.continue();
 if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});return r.abort();});
await page.goto('http://localhost:9019/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9019/clinic/new-order.html');
await page.waitForFunction(()=>!!window._wizState,{timeout:20000});await page.waitForTimeout(2000);
await page.evaluate((dx)=>{const st=window._wizState;st.patient={name:'X',phone:''};st.severity='moderate';st.materialsUsed=[];
 const el=document.getElementById('confirmedDx');el.value=dx;el.dispatchEvent(new Event('input',{bubbles:true}));},DX);
await page.click('#ucgOneTap');await page.waitForTimeout(3500);
await page.evaluate(()=>{const a=document.getElementById('ucgAsk');if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
await page.waitForTimeout(3000);
const out=await page.evaluate(()=>{
  const res=[];
  document.querySelectorAll('.ucg-mg').forEach(g=>{
    res.push('## '+g.querySelector('.ucg-mgh').textContent.trim());
    g.querySelectorAll('.ucg-drug').forEach(d=>{
      const on=d.classList.contains('on')?'[TICKED] ':'         ';
      const k=d.querySelector('.ucg-rank'), b=d.querySelector('.nm b');
      const sp=[...d.querySelectorAll('.nm span')].filter(x=>!x.classList.contains('ucg-rank'))[0];
      res.push('   '+on+(k?'['+k.textContent+'] ':'')+b.textContent+(sp&&sp.textContent.trim()?'  ('+sp.textContent.trim()+')':''));
    });
    g.querySelectorAll('.ucg-note').forEach(n=>res.push('   “'+n.textContent.trim().slice(0,70)+'”'));
  });
  res.push('NOTICE: '+((document.getElementById('ucgPick')||{}).textContent||'none').replace(/\s+/g,' ').trim().slice(0,110));
  res.push('COUNT: '+((document.querySelectorAll('.ucg-count')[1]||{}).textContent||''));
  return res;
});
console.log('=== '+DX); console.log(out.join('\n'));console.log('errs',errs.slice(0,3));
if(process.env.SHOT){await page.evaluate(()=>{const e=document.getElementById('ucgDrugs');if(e)e.scrollIntoView({block:'start'});});await page.waitForTimeout(400);await page.screenshot({path:'ranks.png'});}
await b.close();server.close();})();
