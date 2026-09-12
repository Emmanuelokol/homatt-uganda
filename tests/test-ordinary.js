// A clinician with an ORDINARY malaria case must be able to say so — and get
// the treatment, even though the book prints it under the severe heading.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9054';
(async()=>{
  await new Promise(r=>server.listen(9054,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:390,height:1400},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const posted=[];
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_diagnoses/.test(u)&&rq.method()==='POST'){let a=null;try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a; posted.push(row);
        return r.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'44444444-4444-4444-8444-444444444444'},row))});}
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
   localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
   localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000}); await page.waitForTimeout(2500);
  // warm the guideline database the way a clinician's first keystrokes do
  await page.evaluate(()=>{const i=document.getElementById('confirmedDx');i.focus();i.value='ma';i.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(4000);

  const sug = await page.evaluate(async ()=>{
    const i=document.getElementById('confirmedDx'); i.focus(); i.value='malaria';
    i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<30;k++){ await new Promise(r=>setTimeout(r,200));
      const bx=document.getElementById('ucgDxRes');
      if(bx&&getComputedStyle(bx).display!=='none'&&bx.querySelectorAll('[data-d]').length) break; }
    return [...document.querySelectorAll('#ucgDxRes [data-d]')].map(x=>x.textContent.replace(/\s+/g,' ').trim());
  });
  result('an ordinary malaria case is offered, not only the severe ones',
    sug.some(t=>/Uncomplicated Malaria/i.test(t)), JSON.stringify(sug));

  const ch = await page.evaluate(async ()=>{
    const st=window._wizState; st.patient={name:'Ordinary Case',phone:''}; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    document.getElementById('ucgOneTap').click();
    await new Promise(r=>setTimeout(r,4500));
    return [...document.querySelectorAll('#ucgAskDiff [data-h]')].map(x=>x.textContent.replace(/\s+/g,' ').trim());
  });
  // Five medicines, not thirteen. The thirteen were the severe-malaria
  // protocol, which page-range slicing had merged into this page; the rebuilt
  // database keeps it under the heading the book prints it under.
  result('the ordinary case comes first, and says what it carries',
    /^Uncomplicated Malaria/.test(ch[0]||'') && /5 medicines/.test(ch[0]||'') &&
    /Complicated\/Severe Malaria page/.test(ch[0]||''),
    JSON.stringify(ch[0]));

  const pkg = await page.evaluate(async ()=>{
    const el=[...document.querySelectorAll('#ucgAskDiff [data-h]')]
      .find(x=>/Uncomplicated Malaria/.test(x.textContent));
    if(el) el.click();
    await new Promise(r=>setTimeout(r,4000));
    const t=e=>(e?e.textContent:'').replace(/\s+/g,' ').trim();
    return { title:t(document.getElementById('ucgTitle')),
             from:t(document.querySelector('.ucg-from')),
             drugs:[...document.querySelectorAll('.ucg-drug .nm b')].map(t),
             included:document.querySelectorAll('.ucg-drug.on').length,
             tests:[...document.querySelectorAll('#ucgTests .ucg-chip')].map(x=>t(x).replace(/\s*×$/,'')) };
  });
  result('it opens under the name the clinician chose',
    /Uncomplicated Malaria/.test(pkg.title), 'title="'+pkg.title+'"');
  result('it says where the treatment came from — nothing hidden',
    /Complicated\/Severe Malaria/.test(pkg.from) && /covered together/i.test(pkg.from),
    pkg.from.slice(0,130));
  result('it carries the malaria treatment, first line first',
    pkg.drugs.length>=5 && /artemether/i.test(pkg.drugs[0]),
    pkg.included+' ready of '+pkg.drugs.length+': '+JSON.stringify(pkg.drugs.slice(0,3)));
  // For an uncomplicated case the first choice is oral ACT, and ONLY that.
  result('and ticks the oral ACT alone — no quinine, no artesunate, no drip',
    pkg.included===1, pkg.included+' ticked');
  result('and its lab tests', pkg.tests.length===2, JSON.stringify(pkg.tests));

  // saving records the condition the clinician actually chose
  await page.evaluate(()=>{['ucgFeeC','ucgFeeL','ucgFeeM'].forEach((id,i)=>{const el=document.getElementById(id);
    if(el){el.value=[10000,0,15000][i];el.dispatchEvent(new Event('input',{bubbles:true}));}});});
  await page.waitForTimeout(400);
  await page.evaluate(()=>{const s=document.getElementById('ucgSave'); if(s) s.click();});
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const n=document.getElementById('ucgAskNo'); if(n) n.click();}});
  await page.waitForTimeout(5000);
  const row = posted[0]||{};
  result('the consultation is recorded as the condition the clinician chose',
    posted.length===1 && /Malaria/i.test(row.confirmed_diagnosis||''),
    'saved="'+(row.confirmed_diagnosis||'')+'" drugs='+((row.prescription_items||[]).length));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
