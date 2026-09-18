// Accuracy: what the guideline says for a condition must ALL be on the panel,
// in the right place. No medicine skipped, no drip missing, no half-sentence
// offered as a lab test, and no duplicate copy of the whole page.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const { execSync } = require('child_process');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';

// What the book itself holds for this condition — the yardstick.
const TRUTH = JSON.parse(execSync(`python3 -c "
import sqlite3,json
g=sqlite3.connect('${ROOT}/clinic/data/uganda_clinical_guidelines_2023.db')
cid=g.execute('select id from conditions where title=?',('Complicated/Severe Malaria',)).fetchone()[0]
ms=[r[0] for r in g.execute('select name from medicines where condition_id=?',(cid,))]
print(json.dumps({'meds':ms}))
"`).toString());

(async()=>{
  await new Promise(r=>server.listen(9017,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1200},deviceScaleFactor:2,hasTouch:true})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:9017')) return r.continue();
    if(u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});

  await page.goto('http://localhost:9017/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  await page.goto('http://localhost:9017/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window._wizState,{timeout:20000}).catch(()=>{});
  await page.waitForTimeout(2400);
  await page.evaluate(()=>{const st=window._wizState;
    st.patient={name:'Accuracy',phone:'',id:null,clinicPatientId:null};
    st.patientType='outpatient'; st.severity='moderate'; st.materialsUsed=[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#ucgOneTap'); await page.waitForTimeout(3000);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
  await page.waitForTimeout(2500);

  const panel = await page.evaluate(()=>{
    const txt = el => (el?el.textContent:'').replace(/\s+/g,' ').trim();
    return {
      title: txt(document.getElementById('ucgTitle')),
      tests: [...document.querySelectorAll('#ucgTests .ucg-chip')].map(c=>txt(c).replace(/\s*×$/,'')),
      testHeading: txt(document.querySelectorAll('.ucg-bh h4')[0]),
      groups: [...document.querySelectorAll('.ucg-mgh')].map(g=>txt(g)),
      drugs: [...document.querySelectorAll('.ucg-drug .nm b')].map(txt),
      ranked: [...document.querySelectorAll('.ucg-drug')].map(d=>{
        const k=d.querySelector('.ucg-rank'), b=d.querySelector('.nm b');
        return k ? (txt(k)+' :: '+txt(b)) : null;
      }).filter(Boolean),
      treatOrder: [...document.querySelectorAll('.ucg-mg')]
        .filter(g=>/^Treatment/.test(txt(g.querySelector('.ucg-mgh'))))
        .map(g=>[...g.querySelectorAll('.nm b')].map(txt))[0]||[],
      notes: [...document.querySelectorAll('.ucg-note')].map(txt),
      panels: [...document.querySelectorAll('.ucg-det summary')].map(s=>txt(s).replace(/^[a-z_]+/,'')),
      pick: txt(document.getElementById('ucgPick')),
      ticked: [...document.querySelectorAll('.ucg-drug.on .nm b')].map(txt),
      count: txt(document.querySelectorAll('.ucg-count')[1]),
    };
  });

  // ── 1. The duplicate copy of the page is gone ────────────────────────────
  result('the "Full guideline text (source)" panel is gone — it was the same page twice',
    !panel.panels.some(p=>/full guideline text/i.test(p)) && panel.panels.length>=3,
    panel.panels.length+' panels: '+JSON.stringify(panel.panels).slice(0,170));
  result('the guideline\'s investigations text is still there, in the notes where it belongs',
    panel.panels.some(p=>/investigations/i.test(p)),
    JSON.stringify(panel.panels.filter(p=>/investigations/i.test(p))));

  // ── 2. Lab tests are named tests, not sentences ──────────────────────────
  const fragment = panel.tests.filter(t=>t.length>34 || /\s(the|of|is|for|and|with|in|recommended|following)\s/i.test(t));
  result('the lab tests are proper test names — never half a sentence',
    panel.tests.length>0 && fragment.length===0,
    JSON.stringify(panel.tests)+(fragment.length?'  BAD: '+JSON.stringify(fragment):''));
  result('lab tests are separated from the investigations text, and say so',
    /lab tests to order/i.test(panel.testHeading), 'heading="'+panel.testHeading+'"');

  // ── 3. Every medicine in the book reaches the screen ─────────────────────
  const shown = (panel.drugs.join(' | ') + ' || ' + panel.notes.join(' | ')).toLowerCase();
  const missing = TRUTH.meds.filter(m=>{
    const key=String(m).toLowerCase().split(/\s+/).filter(w=>w.length>4)[0];
    return key ? shown.indexOf(key)<0 : false;
  });
  result('every one of the guideline\'s '+TRUTH.meds.length+' medicines reaches the screen — none skipped',
    missing.length===0, missing.length?'MISSING: '+JSON.stringify(missing):panel.drugs.length+' listed + '+panel.notes.length+' as guideline text');

  // The ordinary malaria package carries one drip. It used to carry three
  // because page-range slicing merged the treatment page with "Management of
  // Complications of Severe Malaria" — sodium chloride, bicarbonate and the
  // rest belong to that page, and the book keeps them there.
  const fluids = panel.drugs.filter(d=>/dextrose|sodium chloride|bicarbonate|saline|ringer/i.test(d));
  result('the drips are on the panel, under their own heading',
    fluids.length>=1 && panel.groups.some(g=>/drips/i.test(g)),
    JSON.stringify(fluids)+' groups='+JSON.stringify(panel.groups));

  // The supportive medicines — and the findings they answer — are on the
  // complications page, so that is where this is checked. Each one should say
  // what it is for: paracetamol for hyperpyrexia, diazepam for convulsions.
  const supportive = await (async()=>{
    await page.evaluate(()=>{ const o=document.getElementById('ucgOverlay');
      if(o) o.style.display='none'; });
    await page.waitForTimeout(500);
    await page.evaluate(()=>{const el=document.getElementById('confirmedDx');
      el.value='Management of Complications of Severe Malaria';
      el.dispatchEvent(new Event('input',{bubbles:true}));
      document.getElementById('ucgOneTap').click();});
    await page.waitForTimeout(3000);
    await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
      if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
    await page.waitForTimeout(2000);
    return page.evaluate(()=>({
      title:(document.getElementById('ucgTitle')||{}).textContent||'',
      reasons:[...document.querySelectorAll('.ucg-drug .nm span')]
        .map(s=>s.textContent.replace(/\s+/g,' ').trim()).filter(t=>/ for /.test(t)),
    }));
  })();
  result('supportive medicines say what they are for',
    supportive.reasons.length>=2,
    supportive.title+' → '+JSON.stringify(supportive.reasons).slice(0,140));

  // ── 4. The guideline's first choice is ready; the rest are not ──────────
  // Every medicine is still listed with its dose filled in. What changed is
  // what arrives TICKED: the guideline's first choice, not all thirteen.
  // Eight, not thirteen: the five the book lists on the treatment page plus the
  // three its prose names. The other five were the severe-complications page's.
  result('every medicine is listed, with its dose already filled in',
    /1 of 8/.test(panel.count), 'count="'+panel.count+'"');
  result('only the first choice arrives ticked — the rest are offered',
    panel.ticked.length===1, panel.ticked.length+' ticked: '+JSON.stringify(panel.ticked));
  result('the panel says how many are ticked, and how to add or remove one',
    /of 8/.test(panel.pick) && /×/.test(panel.pick) && /off the shelf/i.test(panel.pick),
    'notice="'+panel.pick.slice(0,140)+'"');
  result('the guideline TEXT lines are not offered as medicines',
    (await page.evaluate(()=>[...document.querySelectorAll('.ucg-mg')]
      .filter(g=>/^Also in the guideline/.test(g.querySelector('.ucg-mgh').textContent))
      .every(g=>!g.querySelector('.ucg-drug')))));
  result('no medicine arrives without a dose — that is what raised the red alarm',
    (await page.evaluate(()=>[...document.querySelectorAll('.ucg-drug')].filter(d=>{
      const s=d.querySelector('.nm span:not(.ucg-rank):not(.ucg-stk)');
      const t=s?s.textContent.trim():'';
      return !t || t.charAt(0)==='\u00b7';
    }).length)) === 0,
    panel.drugs.length+' medicines, every one dosed');

  // ── 5. The alternatives ─────────────────────────────────────────────────
  result('the guideline\'s ranking is shown — first line, alternative, second line',
    panel.ranked.length>=4 &&
    panel.ranked.some(r=>/^FIRST LINE ::/.test(r)) &&
    panel.ranked.some(r=>/ALTERNATIVE ::/.test(r)) &&
    panel.ranked.some(r=>/^SECOND LINE ::/.test(r)),
    JSON.stringify(panel.ranked).slice(0,240));

  result('the medicines stay in the order the book prints them — the first-line one first',
    /artemether/i.test(panel.treatOrder[0]||''),
    JSON.stringify(panel.treatOrder).slice(0,160));

  result('the second-line medicine the extractor never captured is back',
    panel.drugs.some(d=>/dihydroartemisinin/i.test(d)) &&
    panel.ranked.some(r=>/^SECOND LINE :: Dihydroartemisinin/i.test(r)),
    JSON.stringify(panel.drugs.filter(d=>/dihydro|sulph|sulfa/i.test(d))));

  // A recovered medicine used to arrive with no dose at all, and the wizard
  // then refused to save the consultation because of it — the red alarm.
  // The strength is taken from the national medicines list, and it says so.
  result('a recovered medicine carries its published strength, and says where it came from',
    (await page.evaluate(()=>[...document.querySelectorAll('.ucg-drug')]
      .filter(d=>/dihydroartemisinin/i.test(d.textContent))
      .map(d=>d.textContent.replace(/\s+/g,' ').trim())))
      .every(t=>/40 mg \+ 320 mg/.test(t) && /national list/.test(t)));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'complete.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
