// What the clinic portal really costs in mobile data.
// Counted AT THE SERVER — bytes that genuinely crossed the wire. (Counting in
// the browser is useless once a service worker is installed: every response
// reports as service-worker-served whether or not it went to the network.)
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const GZIP=new Set(['.html','.js','.css','.json','.svg','.wasm','.db']);
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT=9043, ORIGIN='http://localhost:'+PORT;

let bill=null;                                   // the meter
function charge(url, n){ if(!bill) return; bill.total+=n; bill.reqs++;
  const u=url.split('?')[0]; bill.items[u]=(bill.items[u]||0)+n; }

const server=http.createServer((rq,rs)=>{
  let p=decodeURIComponent(rq.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
  fs.readFile(path.join(ROOT,p),(e,d)=>{
    if(e){rs.writeHead(404);rs.end('nf');return;}
    const ext=path.extname(p),h={'Content-Type':MIME[ext]||'application/octet-stream'};
    if(GZIP.has(ext)&&/gzip/.test(rq.headers['accept-encoding']||'')){d=zlib.gzipSync(d);h['Content-Encoding']='gzip';}
    h['Content-Length']=d.length; charge(rq.url, d.length + 400);   // +400 ≈ headers
    rs.writeHead(200,h); rs.end(d);
  });
});

const KB=n=>(n/1024).toFixed(1)+' KB', MB=n=>(n/1048576).toFixed(2)+' MB';
const UGX=n=>'UGX ~'+Math.round(n/1048576*100).toLocaleString('en-UG');   // ≈100/MB

// Every Supabase call costs headers even when the answer is empty: a JWT
// bearer token, the apikey, CORS preflight. 1.2 KB per round trip is modest.
const API_OVERHEAD = 1200;
let apiCalls = 0, apiWho = {};

function start(name){ bill={name,total:0,reqs:0,items:{}}; apiCalls=0; apiWho={}; }
function stop(note){
  const api = apiCalls*API_OVERHEAD;
  const total = bill.total + api;
  console.log('\n── '+bill.name);
  console.log('   '+MB(total)+'   ('+KB(total)+')   '+UGX(total));
  console.log('      files      '+KB(bill.total).padStart(11)+'   '+bill.reqs+' downloads');
  console.log('      API calls  '+KB(api).padStart(11)+'   '+apiCalls+' round trips');
  Object.entries(bill.items).sort((a,b)=>b[1]-a[1]).slice(0,6).filter(x=>x[1]>4096)
    .forEach(([u,v])=>console.log('         '+KB(v).padStart(11)+'  '+u));
  const who=Object.entries(apiWho).sort((a,b)=>b[1]-a[1]).slice(0,6);
  if(who.length) console.log('      who is calling: '+who.map(([k,v])=>k+'×'+v).join(', '));
  if(note) console.log('      '+note);
  return total;
}

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:900},serviceWorkers:'allow'});
  async function route(pg){
    await pg.route('**/*',r=>{const u=r.request().url();
      if(u.startsWith(ORIGIN)) return r.continue();
      if(u.startsWith(SB)){ apiCalls++;
        const k=u.replace(SB,'').split('?')[0].replace('/rest/v1/','');
        apiWho[k]=(apiWho[k]||0)+1;
        return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'}); }
      return r.abort();});
  }
  const page=await ctx.newPage(); await route(page);
  ctx.on('page',p2=>route(p2).catch(()=>{}));

  async function signIn(){
    await page.goto(ORIGIN+'/clinic/index.html',{waitUntil:'networkidle'});
    await page.evaluate(([cid,uid])=>{localStorage.clear();
      localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
      localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  }
  async function openPackage(){
    await page.goto(ORIGIN+'/clinic/new-order.html',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>!!window._wizState,{timeout:30000}).catch(()=>{});
    await page.waitForTimeout(1200);
    await page.evaluate(()=>{const st=window._wizState; if(!st) return;
      st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
      const el=document.getElementById('confirmedDx'); el.value='Malaria';
      el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.waitForTimeout(400);
    await page.evaluate(()=>{const t=document.getElementById('ucgOneTap'); if(t) t.click();});
    await page.waitForTimeout(15000);
    return page.evaluate(()=>({drugs:document.querySelectorAll('.ucg-drug').length,
      chooser:document.querySelectorAll('#ucgAskDiff [data-h]').length}));
  }

  // ── A. Day one: install the app and use it ───────────────────────────────
  start('A. DAY ONE — first open, dashboard, and the guideline package');
  await signIn();
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(6000);
  const p1=await openPackage();
  const A=stop('paid once, the day it is installed  (package: '+(p1.drugs||p1.chooser)+' rows)');
  // Let the worker finish installing and precaching before measuring a normal
  // day — otherwise the install burst is charged to the wrong scenario.
  await page.waitForTimeout(15000);
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(10000);

  // ── B. Every day after ───────────────────────────────────────────────────
  start('B. EVERY DAY AFTER — same screens, same package');
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(6000);
  await openPackage();
  stop('first normal day (the worker is still filling its cache)');
  start('B. A SETTLED DAY — everything already on the phone');
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(6000);
  await openPackage();
  const B=stop('what a clinician pays for a normal day of use');

  // ── C. Idle, socket down (the village-link worst case) ───────────────────
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(9000);
  start('C. IDLE 3 min — live socket DOWN (bad link: the app must poll)');
  await page.waitForTimeout(180000);
  const C=stop('per hour: '+KB((bill.total+apiCalls*API_OVERHEAD)*20));

  // ── D. Idle, socket up (the normal case) ─────────────────────────────────
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(9000);
  // pretend the realtime socket connected, which is the normal case on a
  // working link — the websocket cannot reach a stub server in this harness
  // hold the flag: in this harness the websocket cannot reach a stub server,
  // so the failing retry loop would keep resetting it to false
  await page.evaluate(()=>{ setInterval(()=>{ window._homattRtLive = true; }, 300); });
  await page.waitForTimeout(2000);
  start('D. IDLE 3 min — live socket UP (normal: nothing needs polling)');
  await page.waitForTimeout(180000);
  const D=stop('per hour: '+KB((bill.total+apiCalls*API_OVERHEAD)*20));

  console.log('\n═══ what it costs ══════════════════════════════════════════');
  console.log('   day one, all in        '+MB(A).padStart(9)+'   '+UGX(A));
  console.log('   each day after         '+MB(B).padStart(9)+'   '+UGX(B));
  console.log('   idle/hr, bad link      '+MB(C*20).padStart(9)+'   '+UGX(C*20));
  console.log('   idle/hr, socket up     '+MB(D*20).padStart(9)+'   '+UGX(D*20));
  console.log('   ── a 30-day month, opened daily, 8 idle hrs/day ──');
  console.log('   with a good link       '+MB(A+B*30+D*20*8*30).padStart(9)+'   '+UGX(A+B*30+D*20*8*30));
  console.log('   with a bad link        '+MB(A+B*30+C*20*8*30).padStart(9)+'   '+UGX(A+B*30+C*20*8*30));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
