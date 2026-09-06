const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9061';
(async()=>{await new Promise(r=>server.listen(9061,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
page.on('pageerror',e=>console.log('PAGEERROR',e.message.split('\n')[0]));
await page.route('**/*',r=>{const u=r.request().url();
  if(u.startsWith(ORIGIN))return r.continue();
  if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
  return r.abort();});
await page.goto(ORIGIN+'/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'Kampala Clinic',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto(ORIGIN+'/clinic/dashboard.html');
await page.waitForTimeout(3000);
const probe=await page.evaluate(()=>({
  url: location.pathname,
  hasRows: typeof _activeRows,
  hasRender: typeof renderActiveDetailView,
  hasCtx: typeof _activeDetailContext,
  hasBody: !!document.getElementById('histModalBody'),
}));
console.log(JSON.stringify(probe));
await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
