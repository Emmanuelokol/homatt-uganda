// The Record Payment modal, measured and photographed in every skin.
//   node shot-pay.js <tag>
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const TAG=process.argv[2]||'now';
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9065';

const AUDIT = `(() => {
  function rgb(s){const m=/rgba?\\(([^)]+)\\)/.exec(s);if(!m)return null;
    const p=m[1].split(',').map(Number);return{r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]};}
  function lum(c){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}
  function bgOf(el){let n=el;while(n&&n!==document.documentElement){
    const c=rgb(getComputedStyle(n).backgroundColor);if(c&&c.a>0.5)return c;n=n.parentElement;}
    return {r:255,g:255,b:255,a:1};}
  const root=document.getElementById('paymentModal');
  const low=[];
  root.querySelectorAll('*').forEach(el=>{
    const t=(el.textContent||'').trim();
    if(!t||el.children.length)return;
    if(!el.getClientRects().length)return;
    const fg=rgb(getComputedStyle(el).color);if(!fg)return;
    const bg=bgOf(el);const L1=lum(fg),L2=lum(bg);
    const r=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    if(r<4.5)low.push({text:t.slice(0,34),ratio:Math.round(r*100)/100});
  });
  // placeholders are text too, and they were the same colour trick
  const ph=[];
  root.querySelectorAll('input,textarea,select').forEach(el=>{
    const cs=getComputedStyle(el);
    const fg=rgb(cs.color); const bg=bgOf(el);
    if(!fg) return;
    const L1=lum(fg),L2=lum(bg);
    const r=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    if(r<4.5) ph.push({el:el.id||el.tagName, ratio:Math.round(r*100)/100});
  });
  return {low, fields: ph};
})()`;

(async()=>{await new Promise(r=>server.listen(9065,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const combos=[['forest','dark'],['forest','light'],['midnight','dark'],['dark','dark'],['clay','light'],['clay','dark'],['midnight','light'],['dark','light']];
for (const [skin,theme] of combos) {
  const page=await (await b.newContext({viewport:{width:412,height:915},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
  page.on('pageerror',e=>console.log('PAGEERROR',skin,theme,e.message.split('\n')[0]));
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid,th,sk])=>{localStorage.clear();
    localStorage.setItem('homatt_theme',th); localStorage.setItem('homatt_skin',sk);
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID,theme,skin]);
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(2200);
  await page.evaluate(()=>openPaymentModal('d1','Jackline marcy',60000,0,60000));
  await page.waitForTimeout(400);
  const a=await page.evaluate(AUDIT);
  console.log(`${skin}/${theme}  unreadable=${a.low.length}  fields=${a.fields.length}` +
    (a.low.length? '  ' + a.low.slice(0,4).map(x=>x.ratio+':1 "'+x.text+'"').join(', ') : ''));
  if(skin==='forest') await page.screenshot({path:`pay-${theme}-${TAG}.png`});
  await page.close();
}
await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
