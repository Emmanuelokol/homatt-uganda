const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9081,ORIGIN='http://localhost:'+PORT;
const STOCK=[{id:'s1',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',quantity:800,min_threshold:100,is_active:true,selling_price_ugx:200}];
(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1400},serviceWorkers:'block'})).newPage();
  page.on('pageerror',e=>console.log('ERR',e.message.split('\n')[0]));
  let offline=false; const hits=[];
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){ if(offline) return r.abort();
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      hits.push(rq.method()+' '+u.replace(SB,''));
      if(/clinic_inventory/.test(u)&&rq.method()==='POST') return r.fulfill({status:201,headers:H,body:'[]'});
      if(/clinic_inventory|get_clinic_stock/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      return r.fulfill({status:200,headers:H,body:'[]'}); }
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/dashboard.html'); await page.waitForTimeout(6000);
  offline=true;
  await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});window.dispatchEvent(new Event('offline'));});
  await page.evaluate(async ()=>{
    window.StockIntake.start(null); await new Promise(r=>setTimeout(r,400));
    const i=document.getElementById('stkSearch'); i.value='ceftriaxone'; i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<40;k++){await new Promise(r=>setTimeout(r,200));const bx=document.getElementById('stkRes');if(bx&&bx.style.display==='block'&&bx.querySelectorAll('[data-i]').length)break;}
    const h=[...document.getElementById('stkRes').querySelectorAll('[data-i]')].find(d=>/^Ceftriaxone/i.test(d.querySelector('b').textContent));
    h.click(); await new Promise(r=>setTimeout(r,500));
    const set=(id,v)=>{const e=document.getElementById(id);if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}};
    set('stkBoxes','3'); set('stkUnitPrice','12000'); await new Promise(r=>setTimeout(r,300));
    document.getElementById('stkSave').click(); await new Promise(r=>setTimeout(r,2000));
  });
  const ob = await page.evaluate(()=>{
    const keys=Object.keys(localStorage);
    return { keys: keys.filter(k=>/stock|outbox|qs_/.test(k)),
             outbox: (ClinicOffline.get('outbox',[])||[]).map(x=>({t:x.type,tbl:x.payload&&x.payload.table,name:x.payload&&x.payload.row&&x.payload.row.item_name})) };
  });
  console.log('KEYS', JSON.stringify(ob.keys,null,1));
  console.log('OUTBOX', JSON.stringify(ob.outbox));
  offline=false; hits.length=0;
  const fl = await page.evaluate(async ()=>{
    Object.defineProperty(navigator,'onLine',{get:()=>true,configurable:true});
    window.dispatchEvent(new Event('online'));
    const before=(ClinicOffline.get('outbox',[])||[]).length;
    await ClinicOffline.flush(true);
    await new Promise(r=>setTimeout(r,3000));
    return {before, after:(ClinicOffline.get('outbox',[])||[]).length,
            supa: !!(window.supabase&&window.supabase.from),
            hasCreate: typeof (window.supabase||{}).createClient,
            getClinic: (function(){try{return _getClinicSupabase()?'client':'null';}catch(e){return 'THREW: '+e.message;}})()};
  });
  console.log('FLUSH', JSON.stringify(fl));
  console.log('HITS', JSON.stringify(hits.slice(0,12),null,1));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
