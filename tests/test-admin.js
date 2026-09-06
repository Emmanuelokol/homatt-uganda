// Two admin faults: no clinic activity showing (and no way to tell why), and
// a delete button that did nothing because window.confirm() is blocked here.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const UID='11111111-1111-4111-8111-111111111111';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9120,ORIGIN='http://localhost:'+PORT;
const TODAY=new Date().toISOString().slice(0,10);

const CLINICS=[{id:'c1',name:'Kampala Clinic',status:'approved',active:true},
               {id:'c2',name:'Mutukula City Care',status:'approved',active:true}];
const DIAGS=[{id:'d1',clinic_id:'c1',total_charged_ugx:45000,amount_paid:45000,created_at:TODAY+'T09:00:00Z'},
             {id:'d2',clinic_id:'c1',total_charged_ugx:30000,amount_paid:0,created_at:TODAY+'T10:00:00Z'},
             {id:'d3',clinic_id:'c2',total_charged_ugx:20000,amount_paid:20000,created_at:TODAY+'T11:00:00Z'}];
const PHARMS=[{id:'p1',name:'Mutukula Pharmacy',status:'approved',active:true,district:'Kampala'}];

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const errs=[];

  async function mk(routes){
    const page=await (await b.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'})).newPage();
    page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
    // Playwright matches the LAST registered route first, so the library has
    // to be served from inside the catch-all, not before it.
    await page.route('**/*', function (r) {
      if (/cdn\.jsdelivr\.net.*supabase/.test(r.request().url())) {
        return r.fulfill({status:200, headers:{'Content-Type':'application/javascript'},
                          body: fs.readFileSync(ROOT+'/clinic/js/vendor/supabase.min.js','utf8')});
      }
      return routes(r);
    });
    await page.goto(ORIGIN+'/admin/index.html');
    // A real admin session: isAdmin + a fresh verifiedAt skips the DB re-check.
    await page.evaluate((uid)=>{localStorage.clear(); sessionStorage.clear();
      const sess=JSON.stringify({email:'a@h.com',name:'Admin',userId:uid,isAdmin:true,verifiedAt:Date.now()});
      sessionStorage.setItem('admin_session',sess);
      localStorage.setItem('admin_session',sess);
      localStorage.setItem('sb-homatt-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
    },UID);
    return page;
  }
  const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};

  // ── 1. Clinic activity shows up ─────────────────────────────────────────
  let asked=[];
  const p1 = await mk(r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      asked.push(u.replace(SB,''));
      if(/\/clinics\b/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(CLINICS)});
      if(/clinic_diagnoses/.test(u)) return r.fulfill({status:200,
        headers:Object.assign({},H,{'content-range':'0-2/3'}),body:JSON.stringify(DIAGS)});
      return r.fulfill({status:200,headers:Object.assign({},H,{'content-range':'*/0'}),body:'[]'});
    }
    return r.abort();});
  await p1.goto(ORIGIN+'/admin/dashboard.html');
  await p1.waitForTimeout(9000);

  const noStatusCol = asked.filter(u=>/clinic_diagnoses/.test(u) && /status=in/.test(u) && !/payment_status/.test(u));
  result('the dashboard no longer asks for a "status" column that does not exist',
    noStatusCol.length===0, JSON.stringify(noStatusCol.slice(0,2)));

  const metrics = await p1.evaluate(()=>{
    const w=document.getElementById('clinicMetricsWrap');
    return { text:(w?w.innerText:'').replace(/\s+/g,' ').trim(),
             bars:document.querySelectorAll('.clinic-metric-bar').length,
             consults:(document.getElementById('statConsultTotal')||{}).textContent };
  });
  result('each clinic appears with the treatments it recorded',
    metrics.bars===2 && /Kampala Clinic/.test(metrics.text) && /Mutukula City Care/.test(metrics.text),
    metrics.bars+' rows: '+metrics.text.slice(0,90));
  result("today's revenue is split per clinic instead of reading 0 for everyone",
    /UGX 75K|UGX 75,000|75K/.test(metrics.text) || /45|30|20/.test(metrics.text),
    metrics.text.slice(0,120));
  result('the totals are counted', metrics.consults && metrics.consults!=='—', 'total='+metrics.consults);

  // ── 2. When it IS empty, it says why ────────────────────────────────────
  const p2 = await mk(r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      // clinics readable but none active; treatments DO exist
      if(/\/clinics\b/.test(u)) return r.fulfill({status:200,headers:H,body:'[]'});
      if(/clinic_diagnoses/.test(u)) return r.fulfill({status:200,headers:H,
        body:JSON.stringify(DIAGS),
        // count comes from the content-range header
      });
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});
  await p2.goto(ORIGIN+'/admin/dashboard.html');
  await p2.waitForTimeout(9000);
  const empty = await p2.evaluate(()=>{
    const w=document.getElementById('clinicMetricsWrap');
    return (w?w.innerText:'').replace(/\s+/g,' ').trim();
  });
  result('an empty list explains itself instead of just saying "no data"',
    /no clinic is marked|not marked|active|No clinic has recorded/i.test(empty), empty.slice(0,130));

  // ── 3. Deleting a pharmacy ──────────────────────────────────────────────
  let rpcCalled=null, softUpdate=null, hardDelete=null;
  const p3 = await mk(r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      if(/rpc\/admin_delete_pharmacy/.test(u)){
        rpcCalled=JSON.parse(rq.postData()||'{}');
        return r.fulfill({status:200,headers:H,body:JSON.stringify({ok:true,deleted:'Mutukula Pharmacy',staff_logins_removed:2})});
      }
      if(/\/pharmacies\b/.test(u)&&rq.method()==='PATCH'){ softUpdate=JSON.parse(rq.postData()||'{}'); return r.fulfill({status:200,headers:H,body:'[]'}); }
      if(/\/pharmacies\b/.test(u)&&rq.method()==='DELETE'){ hardDelete=true; return r.fulfill({status:200,headers:H,body:'[]'}); }
      if(/\/pharmacies\b/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(PHARMS)});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});
  await p3.goto(ORIGIN+'/admin/pharmacies.html');
  await p3.waitForTimeout(7000);

  // A blocked native dialog must not be what stands between an admin and a delete.
  await p3.evaluate((rows)=>{ window.confirm=function(){ return false; };
    if(Array.isArray(window.allPharmacies)) window.allPharmacies.length=0;
    window.allPharmacies=rows; }, PHARMS);

  const del = await p3.evaluate(async ()=>{
    if(typeof removePharmacy!=='function') return {no:'removePharmacy missing'};
    removePharmacy('p1');
    await new Promise(r=>setTimeout(r,700));
    const ov=document.getElementById('adDelOverlay');
    const open = !!(ov && getComputedStyle(ov).display!=='none');
    if(!open) return {opened:false};
    const go=document.getElementById('adDelGo');
    const lockedFirst = go.disabled;
    const inp=document.getElementById('adDelInput');
    inp.value='wrong name'; inp.dispatchEvent(new Event('input',{bubbles:true}));
    const stillLocked = go.disabled;
    inp.value='Mutukula Pharmacy'; inp.dispatchEvent(new Event('input',{bubbles:true}));
    const unlocked = !go.disabled;
    go.click();
    await new Promise(r=>setTimeout(r,1800));
    return { opened:true, lockedFirst, stillLocked, unlocked,
             closed: getComputedStyle(document.getElementById('adDelOverlay')).display==='none' };
  });
  result('the delete works even though window.confirm is blocked',
    del.opened, del.no || ('overlay opened='+del.opened));
  result('it will not fire until the exact name is typed',
    del.lockedFirst && del.stillLocked && del.unlocked,
    JSON.stringify({locked:del.lockedFirst, wrongName:del.stillLocked, rightName:del.unlocked}));
  result('it calls the permanent-delete function, not a status flag',
    rpcCalled && rpcCalled.p_pharmacy_id==='p1' && !softUpdate,
    'rpc='+JSON.stringify(rpcCalled)+' softUpdate='+JSON.stringify(softUpdate));

  // ── 4. No RPC installed → says plainly it was not permanent ─────────────
  let toasts=[];
  const p4 = await mk(r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      if(/rpc\/admin_delete_pharmacy/.test(u))
        return r.fulfill({status:404,headers:H,body:JSON.stringify({message:"Could not find the function public.admin_delete_pharmacy in the schema cache"})});
      if(/\/pharmacies\b/.test(u)&&rq.method()==='DELETE')
        return r.fulfill({status:403,headers:H,body:JSON.stringify({message:'permission denied'})});
      if(/\/pharmacies\b/.test(u)&&rq.method()==='PATCH') return r.fulfill({status:200,headers:H,body:'[]'});
      if(/\/pharmacies\b/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(PHARMS)});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});
  await p4.goto(ORIGIN+'/admin/pharmacies.html');
  await p4.waitForTimeout(7000);
  const honest = await p4.evaluate(async ()=>{
    const said=[];
    window.showAdminToast=function(m){ said.push(m); };
    window.allPharmacies=[{id:'p1',name:'Mutukula Pharmacy'}];
    removePharmacy('p1');
    await new Promise(r=>setTimeout(r,700));
    const inp=document.getElementById('adDelInput');
    inp.value='Mutukula Pharmacy'; inp.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('adDelGo').click();
    await new Promise(r=>setTimeout(r,2200));
    return said;
  });
  result('without the SQL it says the delete was NOT permanent, and names the file',
    honest.some(m=>/NOT permanently deleted/i.test(m) && /APPLY_IN_SQL_EDITOR_admin_delete_facilities/.test(m)),
    JSON.stringify(honest).slice(0,150));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
