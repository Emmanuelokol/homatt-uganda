// How much mobile data does the clinic portal actually use?
// Serves the real app over HTTP and counts every byte that crosses the wire,
// with the real service worker installed, for the phases that matter:
//   A. first ever open on a new phone      (the one-off install cost)
//   B. opening it again the next day       (what it costs every day)
//   C. sitting on the dashboard, idle      (what it costs doing nothing)
//   D. recording one consultation          (what each patient costs)
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
// Serve gzipped, the way any real host does — otherwise the numbers are fiction.
const GZIP=new Set(['.html','.js','.css','.json','.svg']);
const server=http.createServer((rq,rs)=>{
  let p=decodeURIComponent(rq.url.split('?')[0]); if(p.endsWith('/'))p+='index.html';
  fs.readFile(path.join(ROOT,p),(e,d)=>{
    if(e){rs.writeHead(404);rs.end('nf');return;}
    const ext=path.extname(p), h={'Content-Type':MIME[ext]||'application/octet-stream'};
    if(GZIP.has(ext) && /gzip/.test(rq.headers['accept-encoding']||'')){
      d=zlib.gzipSync(d); h['Content-Encoding']='gzip';
    }
    h['Content-Length']=d.length; rs.writeHead(200,h); rs.end(d);
  });
});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT=9040, ORIGIN='http://localhost:'+PORT;

const KB = n => (n/1024).toFixed(1)+' KB';
const MB = n => (n/1048576).toFixed(2)+' MB';
const money = n => 'UGX ~' + Math.round(n/1048576*100).toLocaleString('en-UG'); // ~100/MB

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:900},serviceWorkers:'allow'});
  const page=await ctx.newPage();

  let tally=null;
  function start(name){ tally={name, total:0, byKind:{}, reqs:0, items:{}}; return tally; }
  function record(url, bytes, fromSW){
    if(!tally) return;
    if(fromSW) return;                       // served from the phone, no data used
    tally.reqs++; tally.total += bytes;
    const u=url.replace(ORIGIN,'').split('?')[0];
    const kind = url.startsWith(SB) ? 'supabase'
      : /\.db$/.test(u) ? 'guideline databases'
      : /\.wasm$/.test(u) ? 'sqlite engine'
      : /\.woff2$|fonts\./.test(u) ? 'fonts'
      : /\.js$/.test(u) ? 'scripts'
      : /\.css$/.test(u) ? 'styles'
      : /\.html$|\/$/.test(u) ? 'pages'
      : /\.png$|\.svg$/.test(u) ? 'icons' : 'other';
    tally.byKind[kind]=(tally.byKind[kind]||0)+bytes;
    tally.items[u]=(tally.items[u]||0)+bytes;
  }
  function watch(pg){ pg.on('response', async res=>{
    try{
      const req=res.request();
      // A response the service worker answered from cache never left the phone.
      if (res.fromServiceWorker && res.fromServiceWorker()) return;
      const h=res.headers();
      let n = Number(h['content-length']||0);
      if(!n){ try{ n=(await res.body()).length; }catch(e){ n=0; } }
      record(req.url(), n, false);
    }catch(e){}
  }); }
  watch(page);
  ctx.on('page', p2=>{ watch(p2); p2.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN)) return r.continue();
    if(u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort(); }); });

  // Supabase answers small JSON, like the real thing on a quiet clinic day.
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN)) return r.continue();
    if(u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();
  });

  function report(t, note){
    console.log('\n── '+t.name+' '+'─'.repeat(Math.max(0,52-t.name.length)));
    console.log('   ' + MB(t.total) + '   (' + KB(t.total) + ', ' + t.reqs + ' requests)   ' + money(t.total));
    Object.entries(t.byKind).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>
      console.log('      '+String(v/t.total*100>=1?Math.round(v/t.total*100)+'%':'<1%').padStart(4)+'  '+KB(v).padStart(10)+'  '+k));
    const top=Object.entries(t.items).sort((a,b)=>b[1]-a[1]).slice(0,5).filter(x=>x[1]>2048);
    if(top.length){ console.log('      biggest single files:');
      top.forEach(([u,v])=>console.log('         '+KB(v).padStart(10)+'  '+u.slice(-52))); }
    if(note) console.log('      ' + note);
  }

  // ── A. First ever open on a new phone ────────────────────────────────────
  start('A. first ever open  (index → dashboard → consultation)');
  await page.goto(ORIGIN+'/clinic/index.html',{waitUntil:'networkidle'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(6000);
  await page.goto(ORIGIN+'/clinic/new-order.html',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000}).catch(()=>{});
  await page.waitForTimeout(3000);
  // open a package, which is what pulls the guideline databases in
  await page.evaluate(()=>{const st=window._wizState; if(!st) return;
    st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#ucgOneTap').catch(()=>{});
  await page.waitForTimeout(6000);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
  await page.waitForTimeout(4000);
  const A=tally; report(A, 'paid once, on the day the app is installed');

  // let the service worker finish installing before measuring the warm case
  await page.waitForTimeout(4000);

  // ── B. Opening it again ──────────────────────────────────────────────────
  start('B. opening it again the next day  (same three screens)');
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(6000);
  await page.goto(ORIGIN+'/clinic/new-order.html',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000}).catch(()=>{});
  await page.waitForTimeout(4000);
  await page.evaluate(()=>{const st=window._wizState; if(!st) return;
    st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#ucgOneTap').catch(()=>{});
  await page.waitForTimeout(6000);
  const B=tally; report(B, 'this is what a clinician pays every single day');

  // ── D. The guideline databases — the one big download ────────────────────
  start('D. first time the guideline package is opened');
  const page3 = await ctx.newPage();
  await page3.goto(ORIGIN+'/clinic/new-order.html',{waitUntil:'networkidle'});
  await page3.waitForFunction(()=>!!window._wizState,{timeout:30000}).catch(()=>{});
  await page3.waitForTimeout(2500);
  await page3.evaluate(()=>{const st=window._wizState;
    st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('ucgOneTap').click();});
  await page3.waitForTimeout(15000);
  const D=tally; report(D, 'the clinical guidelines themselves — paid once, then kept');
  await page3.close();

  // ── C. Idle ──────────────────────────────────────────────────────────────
  await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
  await page.waitForTimeout(8000);
  start('C. dashboard left open, untouched, for 3 minutes');
  await page.waitForTimeout(180000);
  const C=tally; report(C, 'per hour that is about ' + KB(C.total*20) + ' of doing nothing');

  console.log('\n═══ summary ' + '═'.repeat(48));
  console.log('  guidelines once   ' + MB(D.total).padStart(9) + '   ' + money(D.total));
  console.log('  install once      ' + MB(A.total).padStart(9) + '   ' + money(A.total));
  console.log('  every day after   ' + MB(B.total).padStart(9) + '   ' + money(B.total));
  console.log('  idle, per hour    ' + MB(C.total*20).padStart(9) + '   ' + money(C.total*20));
  console.log('  → a 30-day month  ' + MB(A.total + B.total*30).padStart(9) + '   ' +
              money(A.total + B.total*30) + '   (opening it once a day)');
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
