// A long medicine name must never run under the + Restock button.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const N=(n,q)=>({id:'s'+n,clinic_id:CID,item_name:n,item_type:'medicine',unit:'tabs',quantity:q,
  min_threshold:20,reorder_level:60,is_active:true,is_low_stock:q<=20,is_critical:q===0});
const STOCK=[N('amodiaquine 153mg',-20),N('artemether/lumefantrine 20/120mg',-20),
  N('artesunate 50mg',-10),N('Dextrose 5%',-10),N('Sulphadoxine+ Pyrimethamine',-5),
  N('Dihydroartemisinin + piperaquine',-8),N('Paracetamol 500mg',400)];
(async()=>{await new Promise(r=>server.listen(9027,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:1400},deviceScaleFactor:2,hasTouch:true})).newPage();
const errs=[];page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));
await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:9027'))return r.continue();
 if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
  if(/get_clinic_stock/.test(u))return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
  return r.fulfill({status:200,headers:H,body:'[]'});}
 return r.abort();});
await page.goto('http://localhost:9027/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9027/clinic/dashboard.html');
await page.waitForTimeout(7000);
const r=await page.evaluate(async()=>{
  if(window.showSlide) window.showSlide('stock');
  await new Promise(z=>setTimeout(z,1500));
  const all=[...document.querySelectorAll('.stock-card')];
  const vis=all.filter(c=>c.getBoundingClientRect().width>0);
  window.__dbg={total:all.length, visible:vis.length,
    hosts:[...new Set(all.map(c=>{let p=c.parentElement;return p?(p.id||p.className||'?'):'?';}))]};
  return vis.map(c=>{
    const nm=c.querySelector('.stock-name'), bt=c.querySelector('.stock-restock');
    if(!nm||!bt) return null;
    const a=nm.getBoundingClientRect(), d=bt.getBoundingClientRect();
    return { name:nm.textContent.replace(/\s+/g,' ').trim().slice(0,40),
             overlap: a.right > d.left + 0.5,          // the name reaches under the button
             clipped: nm.scrollWidth > nm.clientWidth + 1,
             btnW: Math.round(d.width), nameW: Math.round(a.width) };
  }).filter(Boolean);
});
console.log('   debug:', await page.evaluate(()=>window.__dbg));
const bad=r.filter(x=>x.overlap||x.clipped);
result('no medicine name runs under or past the + Restock button',
  r.length>=6 && bad.length===0, r.length+' cards; bad='+JSON.stringify(bad).slice(0,220));
result('the buttons are all still their full size', r.every(x=>x.btnW>=70), JSON.stringify(r.map(x=>x.btnW)));
result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
await page.screenshot({path:'stock-cards.png'});
await b.close();server.close();})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
