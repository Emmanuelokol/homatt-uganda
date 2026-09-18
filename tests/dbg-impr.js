const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
(async()=>{
  await new Promise(r=>server.listen(8994,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:950}})).newPage();
  page.on('console',m=>console.log('  [console]',m.text().slice(0,200)));
  page.on('pageerror',e=>console.log('  [pageerror]',e.message.split('\n')[0]));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8994'))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto('http://localhost:8994/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{localStorage.clear();localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:'11111111-1111-4111-8111-111111111111',staffRole:'owner',userId:'22222222-2222-4222-8222-222222222222',level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'22222222-2222-4222-8222-222222222222'}}));});
  await page.goto('http://localhost:8994/clinic/new-order.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#itTab1');
  await page.waitForTimeout(6000);
  const out=await page.evaluate(async()=>{
    const R={};
    R.hasImpression=!!window.Impression;
    R.hasUCG=!!(window.UCGPackage&&window.UCGPackage.db);
    try{ await window.Impression.ready(); }catch(e){ R.readyErr=e.message; }
    R.ucgDb=!!(window.UCGPackage&&window.UCGPackage.db&&window.UCGPackage.db());
    // poke the index directly
    try{
      const SQL=await initSqlJs({locateFile:f=>'js/vendor/'+f});
      const res=await fetch('data/impression_index.db');
      R.idxStatus=res.status;
      const db=new SQL.Database(new Uint8Array(await res.arrayBuffer()));
      const st=db.prepare("select count(*) n from differentials"); st.step(); R.nDiff=st.getAsObject().n; st.free();
      try{
        const s2=db.prepare("select d.diagnosis, bm25(differentials_fts,4.0,1.0,10.0) rk from differentials_fts f join differentials d on d.id=f.rowid where differentials_fts match ? order by rk limit 3");
        s2.bind(['"fever"* OR "headach"*']); const got=[]; while(s2.step()) got.push(s2.getAsObject()); s2.free();
        R.ftsSample=got;
      }catch(e){ R.ftsErr=e.message; }
    }catch(e){ R.idxErr=e.message; }
    try{ R.sug=window.Impression.suggest({chief:'fever headache',subjective:'joint pain and vomiting',background:'',vitals:{temp:'39.2'}},3); }
    catch(e){ R.sugErr=e.message; }
    return JSON.parse(JSON.stringify(R));
  });
  console.log(JSON.stringify(out,null,1).slice(0,2500));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
