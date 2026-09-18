const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const CID='11111111-1111-4111-8111-111111111111';
(async()=>{
  await new Promise(r=>server.listen(8987,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:760},deviceScaleFactor:2,hasTouch:true});
  const page=await ctx.newPage();
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith('http://localhost:8987'))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto('http://localhost:8987/clinic/index.html',{waitUntil:'domcontentloaded'});
  await page.evaluate(cid=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'Dr Achen',clinicName:'Kampala Medical Centre',clinicId:cid,staffRole:'owner',userId:'22222222-2222-4222-8222-222222222222',level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'22222222-2222-4222-8222-222222222222'}}));
    // a stand-in portrait so the slot shows a real photo
    const c=document.createElement('canvas');c.width=c.height=256;const g=c.getContext('2d');
    const gr=g.createLinearGradient(0,0,256,256);gr.addColorStop(0,'#6D4C41');gr.addColorStop(1,'#D7CCC8');
    g.fillStyle=gr;g.fillRect(0,0,256,256);
    g.fillStyle='rgba(255,255,255,.9)';g.beginPath();g.arc(128,100,44,0,7);g.fill();
    g.beginPath();g.ellipse(128,230,74,80,0,0,7);g.fill();
    localStorage.setItem('homatt_portrait_'+cid,c.toDataURL('image/jpeg',.9));},CID);
  for (const [skin,theme] of [['forest','light'],['midnight','light'],['dark','dark'],['clay','light']]){
    await page.evaluate(([s,t])=>{localStorage.setItem('homatt_skin',s);localStorage.setItem('homatt_theme',t);},[skin,theme]);
    await page.goto('http://localhost:8987/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
    await page.waitForSelector('.home-hero'); await page.waitForTimeout(900);
    await page.screenshot({path:'look-'+skin+'.png'});
  }
  await page.evaluate(()=>{localStorage.setItem('homatt_skin','forest');localStorage.setItem('homatt_theme','light');});
  await page.goto('http://localhost:8987/clinic/settings.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#lookPicker .look-opt'); await page.waitForTimeout(600);
  await page.screenshot({path:'look-settings.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
