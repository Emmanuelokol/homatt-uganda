// Does it hold for EVERY illness in the book, not just malaria?
// This opens the real package panel, in a real browser, for all 535 conditions
// in the Uganda Clinical Guidelines and checks each one against the database
// it came from. It reports what is right and — importantly — what is not.
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

// The book itself — every condition, and every medicine it lists for each.
const BOOK = JSON.parse(execSync(`python3 -c "
import sqlite3,json
g=sqlite3.connect('${ROOT}/clinic/data/uganda_clinical_guidelines_2023.db')
out=[]
for cid,t,pg in g.execute('select id,title,page from conditions order by id'):
  ms=[r[0] for r in g.execute('select name from medicines where condition_id=?',(cid,))]
  iv=g.execute('select investigations from conditions where id=?',(cid,)).fetchone()[0] or ''
  out.append({'id':cid,'title':t,'page':pg,'meds':ms,'hasInv':bool(iv.strip())})
print(json.dumps(out))
"`,{maxBuffer:1<<30}).toString());

const LIMIT = Number(process.env.LIMIT || 0) || BOOK.length;

(async()=>{
  await new Promise(r=>server.listen(9023,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1000}})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:9023')) return r.continue();
    if(u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});

  await page.goto('http://localhost:9023/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto('http://localhost:9023/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});
  await page.waitForTimeout(2500);
  // Warm both bundled databases once.
  await page.evaluate(()=>window.UCGPackage.start('Malaria','moderate',window._wizState));
  await page.waitForTimeout(4000);
  await page.evaluate(()=>window.UCGPackage.close());

  const S = { done:0, opened:0, empty:0, crashed:[], skipped:[],
              medsShown:0, medsInBook:0, medsMissing:[], recovered:0,
              ranked:0, condRanked:0, withTests:0, testsTotal:0, badTest:[],
              groups:{treatment:0,supportive:0,fluid:0,other:0},
              autoTicked:0, tickedSomething:0, notesPanels:0, hasFullText:[] };

  for (let i=0;i<LIMIT;i++) {
    const c = BOOK[i];
    let r;
    try {
      r = await page.evaluate(async (c)=>{
        await window.UCGPackage.open(c.id, c.title, 'moderate', c.page);
        // wait for the panel to finish building
        for (let k=0;k<60;k++){ await new Promise(z=>setTimeout(z,50));
          if (document.getElementById('ucgDrugs') || /No medicines/.test(document.getElementById('ucgBody').textContent)) break; }
        const txt = el => (el?el.textContent:'').replace(/\s+/g,' ').trim();
        const out = {
          drugs:[...document.querySelectorAll('.ucg-drug .nm b')].map(txt),
          notes:[...document.querySelectorAll('.ucg-note')].map(txt),
          ranks:[...document.querySelectorAll('.ucg-rank')].map(txt),
          groups:[...document.querySelectorAll('.ucg-mgh')].map(g=>txt(g).replace(/\d+$/,'').trim()),
          recovered:[...document.querySelectorAll('.ucg-drug .nm span')].filter(s=>/set the dose yourself/.test(s.textContent)).length,
          tests:[...document.querySelectorAll('#ucgTests .ucg-chip')].map(c=>txt(c).replace(/\s*×$/,'')),
          ticked:document.querySelectorAll('.ucg-tick.on').length,
          panels:[...document.querySelectorAll('.ucg-det summary')].map(s=>txt(s).replace(/^[a-z_]+/,'')),
          body:txt(document.getElementById('ucgBody')).slice(0,60),
        };
        window.UCGPackage.close();
        return out;
      }, c);
    } catch (e) { S.crashed.push(c.title+' :: '+String(e.message).slice(0,70)); continue; }

    S.done++;
    if (!r.drugs.length && !r.notes.length && !r.tests.length) { S.empty++; }
    else S.opened++;

    // Every medicine the book lists must be somewhere on the panel.
    const shown = (r.drugs.join(' | ')+' || '+r.notes.join(' | ')).toLowerCase();
    S.medsInBook += c.meds.length;
    S.medsShown  += r.drugs.length;
    c.meds.forEach(m=>{
      const key=String(m).toLowerCase().split(/\s+/).filter(w=>w.length>4)[0];
      if (key && shown.indexOf(key)<0) S.medsMissing.push(c.title.slice(0,26)+' :: '+m);
    });
    S.recovered += r.recovered;
    if (r.ranks.length) { S.ranked += r.ranks.length; S.condRanked++; }
    r.groups.forEach(g=>{
      if (/^Treatment/.test(g)) S.groups.treatment++;
      else if (/^Supportive/.test(g)) S.groups.supportive++;
      else if (/^Drips/.test(g)) S.groups.fluid++;
      else if (/^Also/.test(g)) S.groups.other++;
    });
    if (r.tests.length) { S.withTests++; S.testsTotal += r.tests.length; }
    // A lab test must be a NAME, never a piece of a sentence.
    r.tests.forEach(t=>{
      if (t.length>34 || /\s(the|of|is|for|and|with|in|recommended|following)\s/i.test(t))
        S.badTest.push(c.title.slice(0,24)+' :: '+t);
    });
    if (r.ticked) S.tickedSomething++;
    S.notesPanels += r.panels.length;
    if (r.panels.some(p=>/full guideline text/i.test(p))) S.hasFullText.push(c.title);
    if (i && i%50===0) process.stderr.write('  …'+i+'/'+LIMIT+'\n');
  }

  const pct = (n,d) => d ? Math.round(n/d*100)+'%' : '—';
  console.log('CONDITIONS CHECKED            ', S.done, 'of', LIMIT);
  console.log('  package opened with content ', S.opened, '('+pct(S.opened,S.done)+')');
  console.log('  opened but the book has     ');
  console.log('    nothing to show for it    ', S.empty);
  console.log('  crashed                     ', S.crashed.length);
  console.log('');
  console.log('MEDICINES');
  console.log('  listed in the book          ', S.medsInBook);
  console.log('  reaching the screen         ', S.medsShown, '(plus guideline-text lines)');
  console.log('  MISSING from the panel      ', S.medsMissing.length);
  console.log('  recovered (named in the text', S.recovered);
  console.log('   but never extracted)       ');
  console.log('');
  console.log('THE BOOK\'S RANKING');
  console.log('  medicines labelled          ', S.ranked, 'across', S.condRanked, 'conditions');
  console.log('');
  console.log('GROUPS SHOWN (conditions)');
  console.log('  Treatment                   ', S.groups.treatment);
  console.log('  Supportive treatment        ', S.groups.supportive);
  console.log('  Drips, fluids & blood       ', S.groups.fluid);
  console.log('  Also in the guideline       ', S.groups.other);
  console.log('');
  console.log('LAB TESTS');
  console.log('  conditions suggesting tests ', S.withTests, '  total chips', S.testsTotal);
  console.log('  chips that are NOT a proper ');
  console.log('   test name (must be 0)      ', S.badTest.length);
  console.log('');
  console.log('SAFETY');
  console.log('  conditions where a medicine ');
  console.log('   was ticked for you         ', S.tickedSomething, '('+pct(S.tickedSomething,S.done)+')');
  console.log('  "Full guideline text" panel ', S.hasFullText.length, '(must be 0)');
  console.log('  page errors                 ', errs.length);
  if (S.medsMissing.length) { console.log('\nMISSING MEDICINES:'); S.medsMissing.slice(0,25).forEach(x=>console.log('   ',x)); }
  if (S.badTest.length)     { console.log('\nBAD TEST CHIPS:');    S.badTest.slice(0,25).forEach(x=>console.log('   ',x)); }
  if (S.crashed.length)     { console.log('\nCRASHES:');           S.crashed.slice(0,15).forEach(x=>console.log('   ',x)); }
  if (errs.length)          { console.log('\nPAGE ERRORS:');       [...new Set(errs)].slice(0,10).forEach(x=>console.log('   ',x)); }
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
