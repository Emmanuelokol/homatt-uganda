// What does an idle dashboard actually talk to, and how often?
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
const SECS = Number(process.env.SECS||180);
(async()=>{await new Promise(r=>server.listen(9041,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:900}})).newPage();
const hits={}; let counting=false; const times=[];
await page.route('**/*',r=>{const u=r.request().url();
  if(u.startsWith('http://localhost:9041')) return r.continue();
  if(u.startsWith(SB)){
    if(counting){ const k=u.replace(SB,'').split('?')[0].replace(/\/rest\/v1\//,'').replace(/\/rpc\//,'rpc:');
      hits[k]=(hits[k]||0)+1; times.push(Date.now()); }
    return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});}
  return r.abort();});
await page.goto('http://localhost:9041/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9041/clinic/dashboard.html');
await page.waitForTimeout(10000);
console.log('now idling for '+SECS+'s …');
counting=true; const t0=Date.now();
await page.waitForTimeout(SECS*1000);
counting=false;
const total=Object.values(hits).reduce((a,c)=>a+c,0);
console.log('\nrequests while idle: '+total+' in '+SECS+'s  = one every '+(SECS/total).toFixed(1)+'s');
Object.entries(hits).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('   '+String(v).padStart(4)+'  '+k));
// how much would that cost on a real link? each HTTPS request carries headers.
const OVERHEAD=1200;  // request+response headers, conservative for supabase+JWT
console.log('\nat ~'+OVERHEAD+' bytes of headers per request (JWT is large):');
console.log('   idle 3 min : '+((total*OVERHEAD)/1024).toFixed(0)+' KB');
console.log('   idle 1 hr  : '+((total*OVERHEAD*3600/SECS)/1048576).toFixed(2)+' MB');
console.log('   an 8-hr day: '+((total*OVERHEAD*8*3600/SECS)/1048576).toFixed(2)+' MB');
await b.close();server.close();})();
