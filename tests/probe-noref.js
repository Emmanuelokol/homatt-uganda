const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9094,ORIGIN='http://localhost:'+PORT;
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  page.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text().slice(0,120)); });
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  for (const pg of ['dashboard.html','new-order.html','settings.html','guidelines.html','messages.html']) {
    errs.length=0;
    await page.goto(ORIGIN+'/clinic/'+pg);
    await page.waitForTimeout(pg==='new-order.html'?9000:8000);
    const info = await page.evaluate(()=>{
      const t=document.body.innerText;
      return { referWords: (t.match(/Refer(ral)?/gi)||[]).slice(0,5),
               consultWords: (t.match(/[Cc]onsultation/g)||[]).slice(0,5),
               treatment: /Treatment/.test(t) };
    });
    console.log(pg.padEnd(18),
      'errors='+errs.length,
      'refer='+JSON.stringify(info.referWords),
      'consult='+JSON.stringify(info.consultWords));
    if(errs.length) console.log('   ', errs.slice(0,4).join(' | '));
  }
  // Patients slide specifically — that's where the referral cards were
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(7000);
  errs.length=0;
  const pat = await page.evaluate(async ()=>{
    if(window.showSlide) showSlide('patients');
    await new Promise(r=>setTimeout(r,2500));
    const p=document.querySelector('[data-slide-key="patients"]');
    return { text:(p?p.innerText:'').replace(/\s+/g,' ').slice(0,300) };
  });
  console.log('PATIENTS SLIDE errors='+errs.length);
  console.log('  ', pat.text);
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
