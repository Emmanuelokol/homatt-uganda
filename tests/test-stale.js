// Does the dashboard EVER show a consultation that exists on the server,
// when this device already has an older (empty) cached copy?
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';

const DX = [{
  id:'33333333-3333-4333-8333-333333333333', clinic_id:CID,
  confirmed_diagnosis:'Malaria', severity:'moderate',
  created_at:new Date().toISOString(),
  patient_phone:'0788099425', patient_name:'Sanya Test', patient_type:'outpatient',
  total_charged_ugx:15000, payment_status:'paid',
  prescription_items:[{drug_name:'Artemether/Lumefantrine',strength:'20/120mg',quantity:24,duration:3}],
  follow_up_days:3, amount_paid:15000, clinician_name:'Sanya',
}];

(async()=>{
  await new Promise(r=>server.listen(8976,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  let dxHits=0, serverHas=true;
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost:8976')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/clinic_diagnoses/.test(u)) { dxHits++;
        return route.fulfill({status:200,headers:H,body:JSON.stringify(serverHas?DX:[])}); }
      if (/\/auth\/v1\/token/.test(u))
        return route.fulfill({status:200,headers:H,body:JSON.stringify(
          {access_token:'tok',refresh_token:'r',token_type:'bearer',expires_in:3600,user:{id:UID}})});
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });

  await page.goto('http://localhost:8976/clinic/index.html',{waitUntil:'domcontentloaded'});
  // This device already has an OLD, EMPTY cached copy — exactly what a phone
  // has after a quiet morning, before the clinician records a consultation.
  await page.evaluate(([cid,uid])=>{
    localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify(
      {staffName:'Sanya',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify(
      {access_token:'tok',refresh_token:'r',token_type:'bearer',expires_in:3600,
       expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
    const old = JSON.stringify({ts:Date.now()-3600000, v:[]});
    ['consultations_today_'+cid,'active_tx_'+cid,'meds_dx_'+cid].forEach(k=>
      localStorage.setItem('_co_'+k, old));
  },[CID,UID]);

  await page.goto('http://localhost:8976/clinic/dashboard.html',{waitUntil:'domcontentloaded'});

  const readPanel = () => page.evaluate(()=>({
    stat:(document.getElementById('statToday')||{}).textContent||'?',
    list:((document.getElementById('ordersList')||{}).textContent||'').replace(/\s+/g,' ').trim().slice(0,60)
  }));

  const timeline=[];
  for (let s=2; s<=70; s+=2){
    await page.waitForTimeout(2000);
    const p = await readPanel();
    timeline.push(s+'s: statToday='+p.stat);
    if (p.stat === '1') break;
  }
  const final = await readPanel();
  console.log('   server was asked for consultations ' + dxHits + ' time(s)');
  console.log('   ' + timeline.filter((v,i)=>i<3 || i>timeline.length-3 || i%5===0).join('\n   '));
  result('a consultation on the server shows on the dashboard within 20s',
    final.stat === '1', 'after '+timeline.length*2+'s statToday='+final.stat+' list="'+final.list+'"');
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));

  // ── Scenario B: the consultation is recorded on ANOTHER phone while this
  //    dashboard is already open. It must appear without touching anything.
  const p2=await ctx.newPage(); const e2=[]; p2.on('pageerror',x=>e2.push(x.message.split('\n')[0]));
  await p2.route('**/*', route => {
    const u = route.request().url();
    if (u.startsWith('http://localhost:8976')) return route.continue();
    if (u.startsWith(SB)) {
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/\/rest\/v1\/clinic_diagnoses/.test(u))
        return route.fulfill({status:200,headers:H,body:JSON.stringify(serverHas?DX:[])});
      return route.fulfill({status:200,headers:H,body:'[]'});
    }
    return route.abort();
  });
  serverHas = false;
  await p2.evaluate(()=>{}).catch(()=>{});
  await p2.goto('http://localhost:8976/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
  await p2.waitForTimeout(6000);
  const before = await p2.evaluate(()=>(document.getElementById('statToday')||{}).textContent);
  serverHas = true;                       // <- a colleague records a consultation
  let sawAt = null;
  for (let s=1; s<=25; s++){
    await p2.waitForTimeout(1000);
    const v = await p2.evaluate(()=>(document.getElementById('statToday')||{}).textContent);
    if (v === '1') { sawAt = s; break; }
  }
  result('a consultation recorded elsewhere appears on an open dashboard',
    sawAt !== null && sawAt <= 20,
    'was '+before+' before; appeared after '+(sawAt===null?'>25':sawAt)+'s');
  result('no page errors (second dashboard)', e2.length===0, e2.slice(0,3).join(' | '));

  await page.screenshot({path:'stale.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
