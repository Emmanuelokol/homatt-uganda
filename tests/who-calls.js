const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9045';
(async()=>{await new Promise(r=>server.listen(9045,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
// no service worker: we only care about the API chatter
const page=await (await b.newContext({viewport:{width:430,height:900},serviceWorkers:'block'})).newPage();
await page.route('**/*',r=>{const u=r.request().url();
  if(u.startsWith(ORIGIN))return r.continue();
  if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
  return r.abort();});
await page.goto(ORIGIN+'/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto(ORIGIN+'/clinic/dashboard.html');
await page.waitForTimeout(12000);
const setup=await page.evaluate(()=>{
  window.__calls=[];
  const of=window.fetch;
  window.fetch=function(u){ try{ const s=String(u);
    if(s.indexOf('supabase.co')>=0){ const st=(new Error()).stack||''; 
      const frames=st.split('\n').slice(1).map(l=>l.trim().replace('http://localhost:9045/clinic/','')).filter(l=>l.indexOf('supabase.min.js')<0);
      window.__calls.push({t:Date.now(), u:s.split('?')[0].split('/v1/')[1]||s, from:frames.slice(0,3).join(' <- ').slice(0,190)}); } }catch(e){}
    return of.apply(this,arguments); };
  return { pacer: typeof window.HomattPace, live: window._homattRtLive, fresh: /lastRun = Date.now\(\)/.test(String(window.HomattPace.every)) };
});
console.log('HomattPace present:', setup.pacer, ' rtLive:', setup.live, ' new code loaded:', setup.fresh);
// pretend the socket is up, the normal case
// hold the flag: the failing retry loop rewrites it every few seconds
 await page.evaluate(()=>{ setInterval(()=>{ window._homattRtLive = true; }, 300); });
await page.waitForTimeout(120000);
const calls=await page.evaluate(()=>window.__calls);
console.log('paced runs:', JSON.stringify(await page.evaluate(()=>window.__paceLog||[])));
console.log('\nAPI calls in 120s with the socket UP: '+calls.length);
const byFrom={}; calls.forEach(c=>byFrom[c.from]=(byFrom[c.from]||0)+1);
Object.entries(byFrom).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([k,v])=>console.log('   '+String(v).padStart(3)+'  '+k));
const t0=calls.length?calls[0].t:0;
console.log('\nfull timeline (seconds since the first call):');
calls.forEach(c=>console.log('   +'+((c.t-t0)/1000).toFixed(0).padStart(3)+'s  '+c.u.slice(0,34).padEnd(36)+c.from.slice(0,60)));
await b.close();server.close();})();
