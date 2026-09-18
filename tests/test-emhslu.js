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
  await new Promise(r=>server.listen(8974,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  await page.goto('http://localhost:8974/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'Dr. M',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC2'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'tok',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:8974'))return r.continue();return r.abort();});
  await page.goto('http://localhost:8974/clinic/new-order.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await page.waitForTimeout(2500);

  // 1. patient identifier is deterministic and offline-stable
  const pid = await page.evaluate(()=>({
    a: homattPatientId('0788099425'), b: homattPatientId('0788099425'),
    c: homattPatientId('+256788099425'), d: homattPatientId('0700111222'),
    obj: homattPatientId({patient_phone:'0788099425'}), empty: homattPatientId('')
  }));
  result('patient ID is stable for the same phone (works offline, no server)',
    /^HP-[A-Z0-9]{6}$/.test(pid.a) && pid.a===pid.b && pid.a===pid.obj && pid.a!==pid.d,
    JSON.stringify(pid));

  // 2. EMHSLU database is reachable and queryable in the browser
  const em = await page.evaluate(async ()=>{
    const r = await fetch('data/emhslu_2023.db');
    const buf = await r.arrayBuffer();
    return {ok:r.ok, bytes:buf.byteLength, hdr:new TextDecoder().decode(new Uint8Array(buf,0,15))};
  });
  result('EMHSLU 2023 ships with the app (bundled, opens offline)',
    em.ok && em.bytes>500000 && /SQLite format 3/.test(em.hdr), em.bytes+' bytes, hdr="'+em.hdr+'"');

  // 3. drug search now answers from the national list
  await page.evaluate(()=>{const d=document.getElementById('confirmedDx');d.value='Pneumonia';d.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#ucgOneTap'); await page.waitForTimeout(2500);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
  await page.waitForFunction(()=>{const b=document.getElementById('ucgBody');return b&&/Medicines/.test(b.textContent);},{timeout:25000}).catch(()=>{});

  const sug = await page.evaluate(async ()=>{
    const i=document.getElementById('ucgDrugSearch'); i.value='amo'; i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<40;k++){await new Promise(r=>setTimeout(r,250));
      if(document.querySelectorAll('#ucgSearchRes .em-src').length) break;}
    const box=document.getElementById('ucgSearchRes');
    return {items:[...box.querySelectorAll('[data-i]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()).slice(0,4),
      lvlTags:box.querySelectorAll('.em-tag').length, src:box.querySelectorAll('.em-src').length,
      shown:getComputedStyle(box).display!=='none'};
  });
  result('typing "amo" suggests from EMHSLU with strength + facility level + VEN',
    sug.shown && sug.src>0 && sug.lvlTags>=2 && /Amoxicillin/i.test(sug.items.join(' ')),
    JSON.stringify(sug.items).slice(0,220));

  // 4. tapping a suggestion still opens the dosage popup and adds the drug
  const added = await page.evaluate(async ()=>{
    document.querySelector('#ucgSearchRes [data-i]').click();
    await new Promise(r=>setTimeout(r,400));
    const ask=document.getElementById('ucgAsk');
    const open=getComputedStyle(ask).display!=='none';
    const ok=[...ask.querySelectorAll('button')].find(b=>/add|save|ok|done/i.test(b.textContent));
    if(ok) ok.click();
    await new Promise(r=>setTimeout(r,500));
    return {open, inList:/Amoxicillin/i.test(document.getElementById('ucgBody').textContent)};
  });
  result('tapping a suggestion asks the dosage then adds it to the package',
    added.open && added.inList, JSON.stringify(added));

  // 5. dashboard shows the identifier and can search by it
  const p2=await ctx.newPage(); const e2=[]; p2.on('pageerror',e=>e2.push(e.message.split('\n')[0]));
  await p2.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:8974'))return r.continue();return r.abort();});
  await p2.goto('http://localhost:8974/clinic/dashboard.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await p2.waitForTimeout(3000);
  const dash = await p2.evaluate(()=>({
    ph:(document.getElementById('histSearchInput')||{}).placeholder||'',
    fn: typeof homattPatientId==='function',
    sample: typeof homattPatientId==='function' ? homattPatientId('0788099425') : ''
  }));
  result('patient history search accepts the patient ID',
    /HP-/.test(dash.ph) && dash.fn && /^HP-/.test(dash.sample),
    'placeholder="'+dash.ph+'" sample='+dash.sample);

  // 6. settings lets the clinic declare its level (drives EMHSLU)
  const p3=await ctx.newPage(); const e3=[]; p3.on('pageerror',e=>e3.push(e.message.split('\n')[0]));
  await p3.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:8974'))return r.continue();return r.abort();});
  await p3.goto('http://localhost:8974/clinic/settings.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  await p3.waitForTimeout(2500);
  const lvl = await p3.evaluate(async ()=>{
    const g=document.getElementById('levelGrid');
    const before=[...g.querySelectorAll('button')].map(b=>b.textContent.trim());
    const active0=(g.querySelector('.active')||{}).textContent||'';
    [...g.querySelectorAll('button')].find(b=>/Health Centre IV/.test(b.textContent)).click();
    await new Promise(r=>setTimeout(r,250));
    const saved=JSON.parse(localStorage.getItem('clinic_session')||'{}').level;
    return {n:before.length, active0:active0.trim(), saved,
            activeNow:((document.getElementById('levelGrid').querySelector('.active')||{}).textContent||'').trim()};
  });
  result('settings lets the clinic pick its facility level, and it sticks',
    lvl.n===7 && /Health Centre II\b/.test(lvl.active0) && lvl.saved==='HC4' && /Health Centre IV/.test(lvl.activeNow),
    JSON.stringify(lvl));

  // 7. a drug above the clinic level is flagged
  await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('clinic_session'));s.level='HC2';localStorage.setItem('clinic_session',JSON.stringify(s));});
  const warn = await page.evaluate(async ()=>{
    const i=document.getElementById('ucgDrugSearch'); i.value='amoxicillin'; i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<40;k++){await new Promise(r=>setTimeout(r,250));
      if(document.querySelectorAll('#ucgSearchRes .em-src').length) break;}
    const box=document.getElementById('ucgSearchRes');
    return {warn:box.querySelectorAll('.em-tag.warn').length,
      rows:[...box.querySelectorAll('[data-i]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()).slice(0,5)};
  });
  result('drugs above the clinic level are visibly flagged (HC2 clinic vs HC4/RR drugs)',
    warn.warn>0, 'flagged='+warn.warn+' '+JSON.stringify(warn.rows).slice(0,200));
  result('no page errors', errs.length===0 && e2.length===0 && e3.length===0, errs.concat(e2,e3).slice(0,3).join(' | '));
  await page.screenshot({path:'emhslu.png'});
  await b.close();server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
