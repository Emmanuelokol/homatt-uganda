const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9121,ORIGIN='http://localhost:'+PORT;
const UID='11111111-1111-4111-8111-111111111111';
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:1280,height:900},serviceWorkers:'block'})).newPage();
  const blocked=[];
  page.on('console',m=>{if(m.type()==='error')blocked.push('console:'+m.text().slice(0,80));});
  await page.route(/cdn\.jsdelivr\.net/, r=>r.fulfill({status:200,headers:{'Content-Type':'application/javascript'},body:fs.readFileSync(ROOT+'/clinic/js/vendor/supabase.min.js','utf8')}));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','content-range':'*/0'},body:'[]'});
    blocked.push('ABORTED '+u.slice(0,70)); return r.abort();});
  await page.goto(ORIGIN+'/admin/index.html');
  await page.evaluate((uid)=>{localStorage.clear(); sessionStorage.clear();
    const s=JSON.stringify({email:'a@h.com',name:'Admin',userId:uid,isAdmin:true,verifiedAt:Date.now()});
    sessionStorage.setItem('admin_session',s); localStorage.setItem('admin_session',s);
    localStorage.setItem('sb-homatt-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},UID);
  await page.goto(ORIGIN+'/admin/dashboard.html');
  await page.waitForTimeout(8000);
  const out = await page.evaluate(()=>({
    lib: typeof window.supabase,
    hasCreate: typeof (window.supabase||{}).createClient,
    cfg: !!window.HOMATT_CONFIG, url: (window.HOMATT_CONFIG||{}).SUPABASE_URL ? 'set':'MISSING',
    supa: (function(){try{const s=adminSupa();return s? 'client':'NULL';}catch(e){return 'THREW '+e.message;}})(),
    sess: !!(typeof getAdminSession==='function' && getAdminSession()),
  }));
  console.log(JSON.stringify(out,null,1));
  console.log('blocked/errors:', JSON.stringify(blocked.slice(0,6),null,1));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
