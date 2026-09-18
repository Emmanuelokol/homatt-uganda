const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const server = http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
(async()=>{
  await new Promise(r=>server.listen(8970,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await(await b.newContext({viewport:{width:430,height:950},deviceScaleFactor:2})).newPage();
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  // OFFLINE-style: only this local server, nothing external
  await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:8970'))return r.continue();return r.abort();});
  await page.goto('http://localhost:8970/clinic/guidelines.html',{waitUntil:'domcontentloaded'}).catch(()=>{});
  // wait for the DB to open
  await page.waitForFunction(()=>{const i=document.getElementById('gDbInfo');return i&&/conditions/.test(i.textContent);},{timeout:30000}).catch(()=>{});
  const boot=await page.evaluate(()=>({info:(document.getElementById('gDbInfo')||{}).textContent||'',
    disabled:(document.getElementById('gSearch')||{}).disabled, status:(document.getElementById('gStatus')||{}).textContent||''}));
  result('database opens offline (bundled .db + wasm)', /conditions/.test(boot.info) && boot.disabled===false, 'info="'+boot.info+'" status="'+boot.status+'"');
  result('disclaimer is visible and mentions verifying dosages',
    await page.evaluate(()=>{const d=document.querySelector('.g-disclaimer');return !!d&&getComputedStyle(d).display!=='none'&&/verify dosages/i.test(d.textContent);}));

  // autocomplete (partial term)
  await page.fill('#gSearch','malar');
  await page.waitForTimeout(700);
  const ac=await page.evaluate(()=>{const b=document.getElementById('gResults');
    return {shown:getComputedStyle(b).display!=='none',n:b.querySelectorAll('.g-ac-item').length,first:(b.querySelector('.g-ac-title')||{}).textContent||''};});
  result('autocomplete matches a partial term via FTS5', ac.shown && ac.n>0 && /malaria/i.test(ac.first), 'n='+ac.n+' first="'+ac.first+'"');

  // typo tolerance / prefix on a second term
  await page.fill('#gSearch','pneumo');
  await page.waitForTimeout(700);
  const ac2=await page.evaluate(()=>{const b=document.getElementById('gResults');return {n:b.querySelectorAll('.g-ac-item').length,titles:[...b.querySelectorAll('.g-ac-title')].map(x=>x.textContent).slice(0,3)};});
  result('partial "pneumo" finds pneumonia entries', ac2.n>0 && /pneumon/i.test(ac2.titles.join(' ')), JSON.stringify(ac2.titles));

  // Open a condition that carries a treatment of its own. "Pneumonia" is a
  // parent heading: the book prints its definition, causes and investigations
  // on that page and the actual regimens under "Pneumonia in an Infant", "…in
  // a Child" and so on. Before the database was rebuilt on the book's own
  // headings, the parent appeared to hold its children's drugs because the
  // page-range slicing handed them over, so this test used to pass on text
  // that belonged to a different section.
  await page.fill('#gSearch','pneumonia in a child');
  await page.waitForTimeout(700);
  await page.evaluate(()=>{const i=document.querySelector('#gResults .g-ac-item'); if(i) i.click();});
  await page.waitForTimeout(900);
  const card=await page.evaluate(()=>{
    const c=document.getElementById('gCard');
    const heads=[...c.querySelectorAll('.g-sec h3, .g-collapse summary')].map(x=>x.textContent.trim());
    return {shown:getComputedStyle(c).display!=='none', title:(c.querySelector('.g-head h2')||{}).textContent||'',
      chips:[...c.querySelectorAll('.g-chip')].map(x=>x.textContent), heads,
      src:!!c.querySelector('#gSourcePanel'), srcLen:((c.querySelector('.g-src')||{}).textContent||'').length,
      locs:[...c.querySelectorAll('.g-loc-h')].map(x=>x.textContent.split('—')[0].trim()),
      medRows:c.querySelectorAll('.g-table tbody tr').length};
  });
  result('consultation card renders for the selected condition', card.shown && card.title.length>3, 'title="'+card.title+'"');
  result('header shows number / chapter / page (+ICD-10 when present)', card.chips.length>=2, JSON.stringify(card.chips).slice(0,110));
  result('"View source guideline text" panel is ALWAYS present', card.src && card.srcLen>50, 'srcLen='+card.srcLen);
  result('sections render in order with treatments/medicines', card.heads.length>=3, JSON.stringify(card.heads).slice(0,190));
  result('treatment steps grouped by level of care', card.locs.length>0, 'levels='+JSON.stringify(card.locs));
  result('medicines table populated', card.medRows>0, 'rows='+card.medRows);

  // severity
  await page.evaluate(()=>{document.querySelector('.g-sev-btn[data-sev="severe"]').click();});
  await page.waitForTimeout(800);
  const sev=await page.evaluate(()=>{const c=document.getElementById('gCard');
    return {chip:!!c.querySelector('.g-chip.sev'),box:!!c.querySelector('.g-sevbox'),marks:c.querySelectorAll('.g-mark').length};});
  result('severity selection highlights the relevant management text', sev.chip && (sev.box||sev.marks>0), 'box='+sev.box+' highlights='+sev.marks);
  result('no page errors', errs.length===0, errs.slice(0,2).join(' | '));
  await page.screenshot({path:'ucg-card.png',fullPage:false});
  await page.evaluate(()=>{const d=document.getElementById('gSourcePanel'); if(d) d.open=true;});
  await page.waitForTimeout(400);
  await page.screenshot({path:'ucg-source.png'});
  await b.close();server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
