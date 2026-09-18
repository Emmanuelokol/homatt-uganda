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
const STOCK=[{id:'p1',clinic_id:CID,item_name:'Coartem 20/120mg',item_type:'medicine',unit:'tabs',quantity:80,min_threshold:30,reorder_level:120,strips_per_box:4,units_per_strip:6,last_boxes:2,expiry_date:'2026-06-01'}];
const BATCHES=[{id:'b1',clinic_id:CID,inventory_id:'p1',item_name:'Coartem',unit:'tabs',quantity:30,expiry_date:'2026-06-01',expiring_soon:true,expired:false},
 {id:'b2',clinic_id:CID,inventory_id:'p1',item_name:'Coartem',unit:'tabs',quantity:50,expiry_date:'2026-12-01',expiring_soon:false,expired:false}];
(async()=>{await new Promise(r=>server.listen(9008,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await(await b.newContext({viewport:{width:430,height:1180},deviceScaleFactor:2,hasTouch:true})).newPage();
await page.route('**/*',r=>{const u=r.request().url();
 if(u.startsWith('http://localhost:9008'))return r.continue();
 if(u.startsWith(SB)){const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
  if(/v_stock_batches/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(BATCHES)});
  if(/\/rpc\/get_clinic_stock/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
  if(/\/rest\/v1\/clinic_inventory/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
  return r.fulfill({status:200,headers:H,body:'[]'});}
 return r.abort();});
await page.goto('http://localhost:9008/clinic/index.html',{waitUntil:'domcontentloaded'});
await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9008/clinic/dashboard.html',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(7000);
await page.evaluate(()=>{const it=(window._stockItems||[]).find(x=>/coartem/i.test(x.item_name)); window.StockIntake.start(it);});
await page.waitForTimeout(2000);
await page.evaluate(()=>{const bx=document.getElementById('stkBoxes'); if(bx){bx.value='5';bx.dispatchEvent(new Event('input',{bubbles:true}));}});
await page.waitForTimeout(400);
await page.screenshot({path:'batches.png'});
await b.close();server.close();})();
