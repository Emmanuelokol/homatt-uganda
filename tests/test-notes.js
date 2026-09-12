// "Guideline notes for this condition" must read like notes, not like a PDF
// dump: headings that look like headings, bullets that look like bullets,
// warnings that stand out, and a visible break between one point and the next.
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
  await new Promise(r=>server.listen(9013,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:1000},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:9013')) return r.continue();
    if(u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});

  await page.goto('http://localhost:9013/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear(); localStorage.setItem('homatt_theme','dark');
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  await page.goto('http://localhost:9013/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForTimeout(2500);
  await page.evaluate(()=>{const st=window._wizState;
    st.patient={name:'Notes Test',phone:'',id:null,clinicPatientId:null};
    st.patientType='outpatient'; st.severity='moderate'; st.materialsUsed=st.materialsUsed||[];
    const el=document.getElementById('confirmedDx'); el.value='Malaria';
    el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('#ucgOneTap'); await page.waitForTimeout(3000);
  await page.evaluate(()=>{const a=document.getElementById('ucgAsk');
    if(a&&getComputedStyle(a).display!=='none'){const f=a.querySelector('[data-h]');if(f)f.click();}});
  await page.waitForTimeout(2500);

  // Open every notes panel
  const opened = await page.evaluate(async ()=>{
    const dets=[...document.querySelectorAll('.ucg-det')];
    dets.forEach(d=>d.open=true);
    await new Promise(r=>setTimeout(r,400));
    return dets.map(d=>(d.querySelector('summary')||{}).textContent.replace(/expand_more|\s+/g,' ').trim());
  });
  result('the notes are still there, one panel per topic',
    opened.length>=3, opened.length+' panels: '+JSON.stringify(opened).slice(0,150));

  const shape = await page.evaluate(()=>{
    const body=[...document.querySelectorAll('.ucg-det-b')];
    const all=body.map(b=>b.innerHTML).join('');
    const first=document.querySelector('.ucg-det-b');
    const h=[...document.querySelectorAll('.ucg-det-b .gl-h')].map(x=>x.textContent.trim());
    const li=[...document.querySelectorAll('.ucg-det-b .gl-ul li')].map(x=>x.textContent.trim());
    const wn=[...document.querySelectorAll('.ucg-det-b .gl-warn')].map(x=>x.textContent.trim());
    // A heading must be visibly separated from what came before it.
    const sep=[...document.querySelectorAll('.ucg-det-b .gl-h')].map(x=>{
      const st=getComputedStyle(x);
      return {rule:st.borderTopWidth, gap:parseFloat(st.marginTop), weight:st.fontWeight, first:x.matches(':first-child')};
    });
    // Nothing may still be rendered as one pre-formatted block.
    const ws=first?getComputedStyle(first).whiteSpace:'';
    return {headings:h, bullets:li.length, warns:wn, sep, ws,
            raw:/~ /.test(all)||/---/.test(all),
            hasRunningHeader:/Uganda Clinical Guidelines 20/.test(all),
            sampleH:h.slice(0,6), sampleLi:li.slice(0,3)};
  });

  result('headings are marked up, not left as ordinary lines',
    shape.headings.length>=3, shape.headings.length+' → '+JSON.stringify(shape.sampleH).slice(0,150));
  result('every heading after the first is separated by a rule',
    shape.sep.length>0 && shape.sep.filter(s=>!s.first).every(s=>parseFloat(s.rule)>0 && s.gap>=10) &&
    shape.sep.every(s=>Number(s.weight)>=700),
    JSON.stringify(shape.sep.slice(0,3)));
  result('the book\'s bullets are real bullets now, not "~"',
    shape.bullets>0 && !shape.raw, shape.bullets+' bullets, leftover ~/--- = '+shape.raw+' '+JSON.stringify(shape.sampleLi).slice(0,120));
  result('the printer\'s page header is gone from the middle of the text',
    !shape.hasRunningHeader);
  result('the text is laid out, not dumped as pre-formatted lines',
    shape.ws!=='pre-line' && shape.ws!=='pre', 'white-space='+shape.ws);

  // Sentences chopped by the page width are stitched back together.
  const joined = await page.evaluate(()=>{
    const t=[...document.querySelectorAll('.ucg-det-b')].map(b=>b.textContent).join(' ');
    return {sample:t.slice(0,200),
      // this sentence is broken across two lines in the source
      stitched:/investigate according to the flowchart below|where the parental medicine is available/.test(t)};
  });
  result('sentences broken by the page width are joined back up',
    joined.stitched, joined.sample.replace(/\s+/g,' ').slice(0,120));

  // Dark mode: everything must be readable against the sheet.
  const dark = await page.evaluate(()=>{
    function lum(c){const m=c.match(/\d+/g)||[0,0,0];const [r,g,b]=m.map(Number);
      return (0.2126*r+0.7152*g+0.0722*b)/255;}
    const bg=getComputedStyle(document.querySelector('.ucg-det')).backgroundColor;
    const parts=[...document.querySelectorAll('.ucg-det-b .gl-h, .ucg-det-b .gl-p, .ucg-det-b .gl-ul li, .ucg-det-b .gl-warn')];
    const bad=parts.map(p=>({t:p.textContent.slice(0,24), d:Math.abs(lum(getComputedStyle(p).color)-lum(bg))}))
                   .filter(x=>x.d<0.25);
    return {theme:document.documentElement.getAttribute('data-theme'), n:parts.length, bad:bad.slice(0,3)};
  });
  result('all of it is readable in dark mode',
    dark.theme==='dark' && dark.n>0 && dark.bad.length===0,
    dark.n+' blocks, low-contrast: '+JSON.stringify(dark.bad));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.evaluate(()=>{const b=document.getElementById('ucgBody');
    const d=document.querySelector('.ucg-det'); if(d) d.scrollIntoView();});
  await page.waitForTimeout(300);
  await page.screenshot({path:'notes.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
