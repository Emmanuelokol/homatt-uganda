// Exactly which files does the server send while the dashboard sits idle?
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),zlib=require('zlib');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const GZIP=new Set(['.html','.js','.css','.json','.svg','.wasm','.db']);
let t0=0, log=[];
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';
  fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}
    const ext=path.extname(p),h={'Content-Type':MIME[ext]||'application/octet-stream'};
    if(GZIP.has(ext)&&/gzip/.test(rq.headers['accept-encoding']||'')){d=zlib.gzipSync(d);h['Content-Encoding']='gzip';}
    h['Content-Length']=d.length;
    if(t0) log.push({t:((Date.now()-t0)/1000).toFixed(0), u:rq.url, n:d.length, sw:(rq.headers['service-worker']||'')});
    rs.writeHead(200,h);rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9044';
(async()=>{await new Promise(r=>server.listen(9044,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const ctx=await b.newContext({viewport:{width:430,height:900},serviceWorkers:'allow'});
const page=await ctx.newPage();
await page.route('**/*',r=>{const u=r.request().url();
  if(u.startsWith(ORIGIN))return r.continue();
  if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
  return r.abort();});
await page.goto(ORIGIN+'/clinic/index.html',{waitUntil:'networkidle'});
await page.evaluate(([cid,uid])=>{localStorage.clear();
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
await page.waitForTimeout(20000);
await page.goto(ORIGIN+'/clinic/new-order.html',{waitUntil:'networkidle'});
await page.waitForTimeout(12000);
console.log('--- everything is now cached; here is a SETTLED day: open the dashboard, then the wizard ---');
t0=Date.now();
await page.goto(ORIGIN+'/clinic/dashboard.html',{waitUntil:'networkidle'});
await page.waitForTimeout(8000);
await page.goto(ORIGIN+'/clinic/new-order.html',{waitUntil:'networkidle'});
await page.waitForTimeout(8000);
const tot=log.reduce((a,c)=>a+c.n,0);
console.log('files the server had to send: '+log.length+'   '+(tot/1024).toFixed(1)+' KB');
log.slice(0,30).forEach(x=>console.log('   +'+String(x.t).padStart(3)+'s  '+String((x.n/1024).toFixed(1)+'K').padStart(8)+
  (x.sw?'  [sw]':'      ')+'  '+x.u));
await b.close();server.close();})();
