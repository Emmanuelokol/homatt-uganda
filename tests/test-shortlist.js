// Typing a condition must offer the sections that carry something — and must
// never hide a condition just because the book is thin on it.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';

(async()=>{
  await new Promise(r=>server.listen(9030,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1300},deviceScaleFactor:2})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:9030')) return r.continue();
    if(u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});

  await page.goto('http://localhost:9030/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:9030/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);

  async function suggest(q){
    return page.evaluate(async (v)=>{
      const i=document.getElementById('confirmedDx');
      i.focus(); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true}));
      for(let k=0;k<30;k++){ await new Promise(r=>setTimeout(r,200));
        const bx=document.getElementById('ucgDxRes');
        if(bx && getComputedStyle(bx).display!=='none' && bx.querySelectorAll('[data-d]').length) break; }
      const box=document.getElementById('ucgDxRes');
      return box?[...box.querySelectorAll('[data-d]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()):[];
    }, q);
  }

  // The very first thing typed must already be answered from the book — the
  // database opens on the first keystroke and the list repaints when it lands.
  const first = await suggest('malaria');
  result('the first word typed is answered from the guidelines, not a stale list',
    first.length>0 && first.every(t=>/UCG 2023|your standard/.test(t)),
    JSON.stringify(first));

  result('typing "malaria" offers the sections that carry a treatment — including the ordinary case',
    first.length===4 &&
    first.some(t=>/Uncomplicated Malaria/.test(t)) &&
    first.some(t=>/Complicated\/Severe Malaria/.test(t)) &&
    first.some(t=>/Management of Complications of Severe Malaria/.test(t)) &&
    first.some(t=>/Malaria in Pregnancy/.test(t)) &&
    // the empty shells and the pages holding another disease's text stay out
    !first.some(t=>/Malaria Prophylaxis|Prevention and Control/i.test(t)),
    JSON.stringify(first));

  // …but a thin section must still be findable when it is all there is.
  const thin = {};
  for (const q of ['ectopic','fracture','cataract','asthma','regimen'])  thin[q]=await suggest(q);
  result('a condition the book is thin on is still findable — nothing is hidden outright',
    /Ectopic Pregnancy/.test((thin.ectopic||[]).join(' ')) &&
    /Fractures/.test((thin.fracture||[]).join(' ')) &&
    /Cataract/.test((thin.cataract||[]).join(' ')),
    Object.keys(thin).map(k=>k+'→'+((thin[k]||[])[0]||'NONE')).join(' | ').slice(0,200));
  result('asthma, whose guidance is all under investigations, is still offered',
    /Asthma/.test((thin.asthma||[])[0]||''), JSON.stringify(thin.asthma));
  result('an HIV regimen page written only in abbreviations is still offered',
    /First Line Regimens/.test((thin.regimen||[]).join(' ')), JSON.stringify(thin.regimen));

  // ── The chooser ──────────────────────────────────────────────────────────
  const ch = await page.evaluate(async ()=>{
    const st=window._wizState; st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,4000));
    const a=document.getElementById('ucgAsk');
    return { open: !!(a && getComputedStyle(a).display!=='none'),
             items:[...document.querySelectorAll('#ucgAskDiff [data-h]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()) };
  });
  result('the "Which one?" list offers only sections with a treatment, and says what each holds',
    ch.open && ch.items.length===4 &&
    ch.items.every(t=>/medicine|lab test/.test(t)),
    JSON.stringify(ch.items));
  result('the ordinary case comes first, and says whose page its treatment is on',
    /^Uncomplicated Malaria/.test(ch.items[0]||'') &&
    /from the Complicated\/Severe Malaria page/.test(ch.items[0]||''),
    (ch.items[0]||'').slice(0,90));

  // Choosing one still opens a real package.
  const pkg = await page.evaluate(async ()=>{
    const el=document.querySelector('#ucgAskDiff [data-h]'); if(el) el.click();
    await new Promise(r=>setTimeout(r,3500));
    return { title:(document.getElementById('ucgTitle')||{}).textContent||'',
             drugs:document.querySelectorAll('.ucg-drug').length,
             ticked:document.querySelectorAll('.ucg-drug.on').length,
             tests:document.querySelectorAll('#ucgTests .ucg-chip').length };
  });
  // Four medicines, not thirteen: the ordinary case gets the oral ACT and the
  // alternatives, and the severe protocol stays on the severe page where the
  // book prints it.
  result('choosing one opens its package, with the medicines for that case',
    /Malaria/.test(pkg.title) && pkg.drugs>=4 && pkg.ticked === 1 && pkg.tests===2,
    JSON.stringify(pkg));

  // ── Cold start ───────────────────────────────────────────────────────────
  // Deciding whether a section carries a treatment needs the national
  // medicines list, and that can be asked for a moment before it has finished
  // loading. Remembering the empty answer would switch off drug recovery for
  // the rest of the session — so a fresh page must still recover them.
  const cold = await page.evaluate(async ()=>{
    const r = await fetch('clinic/'); return true;
  }).catch(()=>true);
  const page2 = await page.context().newPage();
  await page2.goto('http://localhost:9030/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page2.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page2.waitForTimeout(2500);
  const recovered = await page2.evaluate(async ()=>{
    // ask "does this section carry a treatment?" the instant the panel opens,
    // before anything has warmed the medicines list
    const st=window._wizState; st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Poisoning';
    el.dispatchEvent(new Event('input',{bubbles:true}));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,3500));
    const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const n=document.getElementById('ucgAskNo'); if(n) n.click();}
    await new Promise(r=>setTimeout(r,500));
    // now open a package whose medicines exist ONLY as abbreviations
    el.value='Post-Exposure Prophylaxis'; el.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,300));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,4500));
    const a2=document.getElementById('ucgAsk');
    if(a2&&getComputedStyle(a2).display!=='none'){const c=a2.querySelector('[data-h]'); if(c) c.click(); await new Promise(r=>setTimeout(r,3000));}
    return [...document.querySelectorAll('.ucg-drug .nm b')].map(x=>x.textContent);
  });
  result('after a cold start, medicines written only as abbreviations are still recovered',
    /Tenofovir/i.test(recovered.join(' ')) && /Lamivudine/i.test(recovered.join(' ')),
    JSON.stringify(recovered).slice(0,180));
  await page2.close();

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
