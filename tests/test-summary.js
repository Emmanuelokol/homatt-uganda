// After saving, the clinician must see the record of the visit — not just
// "saved". And the app must never add a medicine it then refuses to save.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9053';

(async()=>{
  await new Promise(r=>server.listen(9053,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:390,height:1500},deviceScaleFactor:2,serviceWorkers:'block'});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN)) return r.continue();
    if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_diagnoses/.test(u)&&rq.method()==='POST'){let a=null;try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a;
        return r.fulfill({status:201,headers:H,body:JSON.stringify(Object.assign({id:'44444444-4444-4444-8444-444444444444'},row))});}
      if(/get_clinic_stock/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify([
        {id:'s1',clinic_id:CID,item_name:'artemether/lumefantrine',item_type:'medicine',unit:'tabs',quantity:60,min_threshold:10,is_active:true}])});
      return r.fulfill({status:200,headers:H,body:'[]'});}
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'Kampala Clinic',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{const st=window._wizState; st.patient={name:'Okello John',phone:''};
    st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForTimeout(500);
  await page.evaluate(()=>document.getElementById('ucgOneTap').click());
  await page.waitForTimeout(5000);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
  await page.waitForTimeout(4000);

  // ── Not one medicine may arrive without a dose ───────────────────────────
  const doses = await page.evaluate(()=>[...document.querySelectorAll('.ucg-drug')].map(d=>({
    n:(d.querySelector('.nm b')||{}).textContent||'',
    s:((d.querySelector('.nm span:not(.ucg-rank):not(.ucg-stk)')||{}).textContent||'').trim()})));
  const noDose = doses.filter(d=>!d.s || /^·/.test(d.s));
  result('every medicine the app puts on the list carries a dose',
    doses.length>0 && noDose.length===0,
    noDose.length ? 'NO DOSE: '+JSON.stringify(noDose.map(x=>x.n)) : doses.length+' medicines, all dosed');
  result('the ones recovered from the guideline text carry their published strength',
    doses.some(d=>/Dihydroartemisinin/i.test(d.n) && /40 mg \+ 320 mg/.test(d.s)) &&
    doses.some(d=>/Sulphadoxine/i.test(d.n) && /500 mg \+ 25 mg/.test(d.s)),
    JSON.stringify(doses.filter(d=>/Dihydro|Sulph/i.test(d.n))));

  // Trim to a realistic visit, set the money, save.
  await page.evaluate(async ()=>{
    for (let g=0; g<40; g++) {
      const rows=[...document.querySelectorAll('.ucg-drug')];
      if (rows.length<=3) break;
      const x=rows[rows.length-1].querySelector('[data-rmdrug]'); if(!x) break;
      x.click(); await new Promise(r=>setTimeout(r,60));
    }
  });
  await page.waitForTimeout(600);
  await page.evaluate(()=>{['ucgFeeC','ucgFeeL','ucgFeeM'].forEach((id,i)=>{const el=document.getElementById(id);
    if(el){el.value=[10000,15000,20000][i];el.dispatchEvent(new Event('input',{bubbles:true}));}});
    const p=document.querySelector('.ucg-paychip[data-pay="credit"]'); if(p) p.click();});
  await page.waitForTimeout(500);
  await page.evaluate(()=>{const s=document.getElementById('ucgSave'); if(s) s.click();});
  await page.waitForTimeout(1500);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const n=document.getElementById('ucgAskNo'); if(n) n.click();}});
  await page.waitForTimeout(5000);

  // ── Nothing may block the save ───────────────────────────────────────────
  const blocked = await page.evaluate(()=>{const s=document.getElementById('submitBlock');
    return s && getComputedStyle(s).display!=='none'
      ? (document.getElementById('submitBlockText')||{}).textContent||'blocked' : ''; });
  result('the save is not refused by a medicine the app added itself',
    !blocked, blocked ? 'BLOCKED: '+blocked.slice(0,90) : 'saved cleanly');

  // ── The record of the visit ──────────────────────────────────────────────
  const sum = await page.evaluate(()=>{
    const sh=document.getElementById('successSheet');
    const t=el=>(el?el.textContent:'').replace(/\s+/g,' ').trim();
    return {
      shown: sh?getComputedStyle(sh).display:'missing',
      sections: [...document.querySelectorAll('#successBody .sum-h')].map(t),
      caseCode: t(document.querySelector('.sum-case')),
      who: t(document.querySelector('.sum-who')),
      dx: t(document.querySelector('.sum-dx')),
      meds: [...document.querySelectorAll('#successBody .sum-med')].map(m=>({
        n:t(m.querySelector('.sum-med-n')), s:t(m.querySelector('.sum-med-s')), q:t(m.querySelector('.sum-med-q')) })),
      tests: [...document.querySelectorAll('#successBody .sum-chip')].map(t),
      lines: [...document.querySelectorAll('#successBody .sum-line')].map(t),
      overflows: document.documentElement.scrollWidth > document.documentElement.clientWidth+1,
      actions: [...document.querySelectorAll('.sum-btn')].map(t),
    };
  });

  result('the summary opens and is laid out in sections',
    sum.shown==='flex' && sum.sections.length>=3,
    sum.sections.join(' | '));
  result('it names the case, the patient and the diagnosis',
    /^#\d{3}[A-Z]\d{4}[OI]$/.test(sum.caseCode) && /Okello John/.test(sum.who) && /Malaria/i.test(sum.dx),
    'case="'+sum.caseCode+'" who="'+sum.who+'" dx="'+sum.dx+'"');
  result('every medicine given is listed with dose, frequency, days and what left the shelf',
    sum.meds.length>0 && sum.meds.every(m=>m.n && /×\/day/.test(m.s) && /day/.test(m.s)) &&
    sum.meds.some(m=>/off the shelf/.test(m.q)),
    JSON.stringify(sum.meds[0]));
  result('the lab tests ordered are listed',
    sum.tests.length>=1, JSON.stringify(sum.tests));
  const money = sum.lines.join(' | ');
  result('the money is broken down, totalled, and says what is still owed',
    /Treatment.*10,000/.test(money) && /Lab tests.*15,000/.test(money) &&
    /Medicines.*20,000/.test(money) && /Total charged.*45,000/.test(money) &&
    /On credit/.test(money) && /Still owed.*45,000/.test(money),
    money.slice(0,190));
  result('it says what happens next — reminders, return visit, where the prescription is',
    /Medicine reminders/.test(money) && /Return visit/.test(money) && /Prescription/.test(money),
    money.slice(-150));
  result('it fits the phone — nothing runs off the side',
    !sum.overflows);
  result('it offers the two ways out', sum.actions.length===2, JSON.stringify(sum.actions));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'summary.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
