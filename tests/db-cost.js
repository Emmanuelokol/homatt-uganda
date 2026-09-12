// What does opening the guideline package cost the FIRST time, and after?
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const GZIP=new Set(['.html','.js','.css','.json','.svg','.wasm','.db']);   // real hosts gzip these too
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';
  fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}
    const ext=path.extname(p),h={'Content-Type':MIME[ext]||'application/octet-stream'};
    if(GZIP.has(ext)&&/gzip/.test(rq.headers['accept-encoding']||'')){d=zlib.gzipSync(d);h['Content-Encoding']='gzip';}
    h['Content-Length']=d.length;rs.writeHead(200,h);rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const ORIGIN='http://localhost:9042';
const KB=n=>(n/1024).toFixed(1)+' KB', MB=n=>(n/1048576).toFixed(2)+' MB';
(async()=>{await new Promise(r=>server.listen(9042,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:430,height:900},serviceWorkers:'allow'});
const page=await ctx.newPage();
let bytes={}, on=false;
page.on('response',async res=>{try{
  if(res.fromServiceWorker&&res.fromServiceWorker())return; if(!on)return;
  const u=res.request().url().replace(ORIGIN,'').split('?')[0];
  let n=Number(res.headers()['content-length']||0); if(!n){try{n=(await res.body()).length;}catch(e){}}
  if(n>1024) bytes[u]=(bytes[u]||0)+n;
}catch(e){}});
await page.route('**/*',r=>{const u=r.request().url();
  if(u.startsWith(ORIGIN))return r.continue();
  if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
  return r.abort();});
await page.goto(ORIGIN+'/clinic/index.html',{waitUntil:'networkidle'});
await page.evaluate(([cid,uid])=>{localStorage.clear();
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
async function openPackage(label){
  bytes={}; on=true;
  await page.goto(ORIGIN+'/clinic/new-order.html',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{const st=window._wizState;
    st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(400);
  await page.evaluate(()=>document.getElementById('ucgOneTap').click());
  await page.waitForTimeout(18000);
  const opened=await page.evaluate(()=>({drugs:document.querySelectorAll('.ucg-drug').length,
    ask:!!(document.getElementById('ucgAsk')&&getComputedStyle(document.getElementById('ucgAsk')).display!=='none')}));
  on=false;
  const tot=Object.values(bytes).reduce((a,c)=>a+c,0);
  console.log('\n── '+label);
  console.log('   package opened: '+(opened.drugs?opened.drugs+' medicines':(opened.ask?'chooser shown':'NOT OPENED')));
  console.log('   downloaded: '+MB(tot)+'  ('+KB(tot)+')');
  Object.entries(bytes).sort((a,b)=>b[1]-a[1]).slice(0,6).forEach(([u,v])=>console.log('      '+KB(v).padStart(11)+'  '+u));
  return tot;
}
const first=await openPackage('FIRST time a clinician opens the standard package');
await page.waitForTimeout(5000);
const again=await openPackage('EVERY time after that');
console.log('\n   one-off cost of the clinical guidelines : '+MB(first));
console.log('   every use after                        : '+MB(again));
await b.close();server.close();})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
