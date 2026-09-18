// Typed slightly wrong, and written as an abbreviation.
// A clinician typing between patients drops a letter or swaps two, and the
// guideline itself writes some medicines only as programme abbreviations.
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
  await new Promise(r=>server.listen(9025,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1100}})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:9025')) return r.continue();
    if(u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});

  await page.goto('http://localhost:9025/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:9025/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);

  async function suggest(q){
    return page.evaluate(async (v)=>{
      const i=document.getElementById('confirmedDx');
      i.value=v; i.dispatchEvent(new Event('input',{bubbles:true}));
      for(let k=0;k<25;k++){ await new Promise(r=>setTimeout(r,200));
        const bx=document.getElementById('ucgDxRes');
        if(bx && getComputedStyle(bx).display!=='none' && bx.querySelectorAll('[data-d]').length) break; }
      const box=document.getElementById('ucgDxRes');
      return box?[...box.querySelectorAll('[data-d]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()):[];
    }, q);
  }

  // ── Spelt right: still an exact match, no "did you mean" noise ────────────
  const right = {};
  for (const q of ['typhoid','malaria','pneumonia','asthma']) right[q]=await suggest(q);
  result('spelt correctly, it still matches exactly — no guessing',
    Object.keys(right).every(q=>right[q].length>0 && !/did you mean/i.test(right[q][0])),
    Object.keys(right).map(q=>q+'→'+(right[q][0]||'none')).join(' | ').slice(0,190));

  // ── Spelt wrong: the app knows what was meant ────────────────────────────
  const typos = { typiod:'Typhoid', tyfoid:'Typhoid', malara:'Malaria', pnemonia:'Pneumonia',
                  asma:'Asthma', diabets:'Diabetes', tetnus:'Tetanus', hypertention:'Hypertension' };
  const got = {};
  for (const q of Object.keys(typos)) got[q]=await suggest(q);
  const missed = Object.keys(typos).filter(q=>!(got[q]||[]).some(t=>new RegExp(typos[q],'i').test(t)));
  result('a mistyped diagnosis still finds the right condition',
    missed.length===0,
    missed.length ? 'NOT FOUND: '+JSON.stringify(missed)
                  : Object.keys(typos).map(q=>q+'→'+got[q][0].replace(/did you mean\?$/,'')).join(' | ').slice(0,220));
  result('a corrected suggestion says it is a guess',
    (got.typiod||[]).some(t=>/did you mean/i.test(t)), JSON.stringify((got.typiod||[]).slice(0,2)));

  // ── One-tap on a mistyped diagnosis opens the right package ──────────────
  const pkg = await page.evaluate(async ()=>{
    const st=window._wizState; st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx');
    el.value='typiod'; el.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,3500));
    const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const c=a.querySelector('[data-c]')||a.querySelector('[data-h]'); if(c)c.click();}
    await new Promise(r=>setTimeout(r,3000));
    return { title:(document.getElementById('ucgTitle')||{}).textContent||'',
             drugs:[...document.querySelectorAll('.ucg-drug .nm b')].map(x=>x.textContent),
             tests:[...document.querySelectorAll('#ucgTests .ucg-chip')].map(x=>x.textContent.replace('×','').trim()) };
  });
  result('tapping the package with "typiod" typed opens Typhoid, with its medicines',
    /typhoid/i.test(pkg.title) && pkg.drugs.length>=4 && pkg.tests.some(t=>/Widal/i.test(t)),
    'opened="'+pkg.title+'" drugs='+pkg.drugs.length+' tests='+JSON.stringify(pkg.tests));

  await page.evaluate(()=>window.UCGPackage.close());

  // ── Medicines the book writes only as an abbreviation ────────────────────
  async function open(dx){
    return page.evaluate(async (d)=>{
      const st=window._wizState; st.patient={name:'X',phone:''}; st.severity='moderate'; st.materialsUsed=[];
      const el=document.getElementById('confirmedDx'); el.value=d; el.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(r=>setTimeout(r,300));
      document.getElementById('ucgOneTap').click();
      await new Promise(r=>setTimeout(r,3200));
      const a=document.getElementById('ucgAsk');
      if(a&&getComputedStyle(a).display!=='none'){const c=a.querySelector('[data-c]')||a.querySelector('[data-h]'); if(c)c.click();}
      await new Promise(r=>setTimeout(r,3000));
      const out={ title:(document.getElementById('ucgTitle')||{}).textContent||'',
                  drugs:[...document.querySelectorAll('.ucg-drug .nm b')].map(x=>x.textContent) };
      window.UCGPackage.close();
      return out;
    }, dx);
  }
  const pep = await open('Post-Exposure Prophylaxis');
  result('an HIV regimen written only as "TDF+3TC+ATV/r" lists its real medicines',
    /Tenofovir/i.test(pep.drugs.join(' ')) && /Lamivudine/i.test(pep.drugs.join(' ')) &&
    /Atazanavir/i.test(pep.drugs.join(' ')),
    'opened="'+pep.title+'" '+JSON.stringify(pep.drugs));

  const deh = await open('Dehydration in Children under 5 years');
  result('ORS is listed where the guideline writes only "ORS"',
    /oral rehydration/i.test(deh.drugs.join(' ')), JSON.stringify(deh.drugs).slice(0,150));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
