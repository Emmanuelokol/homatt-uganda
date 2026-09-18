const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
(async()=>{
  await new Promise(r=>server.listen(8972,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await(await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true})).newPage();
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  await page.goto('http://localhost:8972/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'Dr. M',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'tok',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:8972'))return r.continue();return r.abort();});
  await page.goto('http://localhost:8972/clinic/new-order.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(2500);

  // A. After a consultation the figures must refresh — but the saved copy is
  // the clinic's only data when the signal goes, so it is marked out of date,
  // never deleted.
  const inv = await page.evaluate(()=>{
    const now=Date.now();
    localStorage.setItem('_co_consultations_today_x','{"ts":'+now+',"v":[1,2,3]}');
    localStorage.setItem('_co_meds_dx_x','{"ts":'+now+',"v":[1]}');
    localStorage.setItem('_co_keepme','{"ts":'+now+',"v":[1]}');
    ClinicOffline.invalidate(['consultations_today_','meds_dx_']);
    const rd=k=>{try{return JSON.parse(localStorage.getItem(k)||'null');}catch(e){return null;}};
    const a=rd('_co_consultations_today_x'), b=rd('_co_meds_dx_x'), c=rd('_co_keepme');
    return { stillThere: !!(a&&a.v&&a.v.length===3) && !!(b&&b.v),
             markedStale: !!(a&&a.ts===0) && !!(b&&b.ts===0),
             othersUntouched: !!(c&&c.ts===now),
             stillReadable: ClinicOffline.get('consultations_today_x',null)!==null };
  });
  result('after a consultation the figures are marked stale, NOT thrown away',
    inv.stillThere && inv.markedStale && inv.othersUntouched && inv.stillReadable,
    JSON.stringify(inv));

  // B. open a known condition
  await page.evaluate(()=>{const d=document.getElementById('confirmedDx');d.value='Pneumonia';d.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#ucgOneTap'); await page.waitForTimeout(2500);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
  await page.waitForFunction(()=>{const b=document.getElementById('ucgBody');return b&&/Medicines/.test(b.textContent);},{timeout:25000}).catch(()=>{});

  // C. drug search is ALWAYS visible and suggests inline
  const sug = await page.evaluate(async ()=>{
    const w=document.getElementById('ucgSearchWrap');
    const visible = w && getComputedStyle(w).display!=='none';
    const i=document.getElementById('ucgDrugSearch'); i.value='amo'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,700));
    const box=document.getElementById('ucgSearchRes');
    const st=getComputedStyle(box), rect=box.getBoundingClientRect();
    return {visible, shown:st.display!=='none', pos:st.position,
      items:[...box.querySelectorAll('[data-i]')].map(x=>x.textContent.trim()).slice(0,3),
      onScreen: rect.width>0 && rect.height>0 && rect.top < window.innerHeight};
  });
  result('drug search box is always visible (no hidden toggle)', sug.visible);
  result('typing "amo" shows suggestions INLINE (not clipped)',
    sug.shown && sug.items.length>0 && sug.pos!=='absolute' && sug.onScreen,
    'pos='+sug.pos+' onScreen='+sug.onScreen+' '+JSON.stringify(sug.items));

  // D. add buttons are prominent
  const btns = await page.evaluate(()=>{
    const a=document.querySelector('.ucg-add'); const st=a?getComputedStyle(a):null;
    return a?{h:a.getBoundingClientRect().height, bg:st.backgroundImage.slice(0,20), color:st.color}:null;
  });
  result('add buttons are large and solid (easy to see/tap)', btns && btns.h>=38 && /gradient/.test(btns.bg), JSON.stringify(btns));

  // E. collapsible guideline notes
  const guid = await page.evaluate(async ()=>{
    const dets=[...document.querySelectorAll('.ucg-det')];
    const titles=dets.map(d=>d.querySelector('summary').textContent.replace(/expand_more|\s+/g,' ').trim());
    let opened=false, body='';
    if(dets.length){ dets[0].open=true; await new Promise(r=>setTimeout(r,150));
      opened=dets[0].open; body=(dets[0].querySelector('.ucg-det-b')||{}).textContent||''; }
    return {n:dets.length, titles:titles.slice(0,6), opened, len:body.length};
  });
  result('has tap-to-open guideline notes (management, what to check, etc.)',
    guid.n>=3 && guid.opened && guid.len>20, 'sections='+guid.n+' '+JSON.stringify(guid.titles).slice(0,190));

  // F. a disease NOT in the guidelines still opens a worksheet
  const unknown = await page.evaluate(async ()=>{
    document.getElementById('ucgCancel').click();
    const d=document.getElementById('confirmedDx'); d.value='Zzq unknown ailment'; d.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,2200));
    const ov=document.getElementById('ucgOverlay');
    return {open:getComputedStyle(ov).display!=='none',
      kicker:(document.getElementById('ucgKicker')||{}).textContent||'',
      title:(document.getElementById('ucgTitle')||{}).textContent||'',
      hasAdd:!!document.querySelector('.ucg-add'), hasFees:!!document.getElementById('ucgFeeC'),
      hasSearch:!!document.getElementById('ucgDrugSearch')};
  });
  result('unknown disease still opens an empty editable package',
    unknown.open && /unknown ailment/i.test(unknown.title) && unknown.hasAdd && unknown.hasFees && unknown.hasSearch,
    'kicker="'+unknown.kicker+'" title="'+unknown.title+'"');
  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'onetap2.png'});
  await b.close();server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
