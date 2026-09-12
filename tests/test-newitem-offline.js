// Adding a new item with no signal at all. A delivery arrives when the network
// is down more often than not, so this has to work exactly the same, be visible
// on the shelf immediately, be sellable in Quick Sale immediately, and go up
// the moment there is signal again.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9079,ORIGIN='http://localhost:'+PORT;

const STOCK=[{id:'s1',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',
  quantity:800,min_threshold:100,reorder_level:200,is_active:true,is_low_stock:false,is_critical:false,
  selling_price_ugx:200}];

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:430,height:1400},serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  let offline=false; const inserted=[];
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN)) return r.continue();
    if(u.startsWith(SB)){
      if(offline) return r.abort();                       // no signal at all
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_inventory/.test(u)&&rq.method()==='POST'){
        let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        (Array.isArray(a)?a:[a]).forEach(x=>inserted.push(x));
        return r.fulfill({status:201,headers:H,body:JSON.stringify([Object.assign({},Array.isArray(a)?a[0]:a)])});
      }
      if(/get_clinic_stock/.test(u)||/clinic_inventory/.test(u))
        return r.fulfill({status:200,headers:H,body:JSON.stringify(STOCK)});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);

  // One normal online open, so Quick Sale has been seeded — exactly what the
  // clinic does once, with data, before going back out of signal.
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(6000);
  await page.evaluate(async ()=>{ if(window.openQuickSale) openQuickSale(); await new Promise(r=>setTimeout(r,2500));
    if(window.closeQuickSale) closeQuickSale(); });
  await page.waitForTimeout(1000);

  // ── Signal gone ─────────────────────────────────────────────────────────
  offline = true;
  await page.evaluate(()=>{ Object.defineProperty(navigator,'onLine',{get:()=>false,configurable:true});
    window.dispatchEvent(new Event('offline')); });
  await page.waitForTimeout(500);

  const added = await page.evaluate(async ()=>{
    window.StockIntake.start(null);
    await new Promise(r=>setTimeout(r,400));
    const i=document.getElementById('stkSearch');
    i.value='ceftriaxone'; i.dispatchEvent(new Event('input',{bubbles:true}));
    for(let k=0;k<40;k++){ await new Promise(r=>setTimeout(r,200));
      const bx=document.getElementById('stkRes');
      if(bx&&bx.style.display==='block'&&bx.querySelectorAll('[data-i]').length) break; }
    const hit=[...document.getElementById('stkRes').querySelectorAll('[data-i]')]
      .find(d=>/^Ceftriaxone/i.test(d.querySelector('b').textContent));
    if(!hit) return {found:false};
    const name=hit.querySelector('b').textContent;
    hit.click();
    await new Promise(r=>setTimeout(r,500));
    const lbl=id=>{const e=document.querySelector('label[for="'+id+'"]'); return e?e.textContent.replace(/\s+/g,' ').trim():null;};
    const set=(id,v)=>{const e=document.getElementById(id); if(!e) return; e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));};
    set('stkBoxes','3'); set('stkUnitPrice','12000');
    await new Promise(r=>setTimeout(r,300));
    const tot=document.getElementById('stkSum').querySelector('.tot').textContent;
    document.getElementById('stkSave').click();
    await new Promise(r=>setTimeout(r,2000));
    return { found:true, name, qBox:lbl('stkBoxes'), qStrips:lbl('stkStrips'), tot,
             closed: getComputedStyle(document.getElementById('stkOverlay')).display==='none' };
  });

  result('the national list is still searchable with no signal',
    added.found && /Ceftriaxone/i.test(added.name||''), added.name);
  result('an injection asks only for boxes of vials — no strip question',
    /How many boxes did you receive/.test(added.qBox||'') && added.qStrips===null,
    JSON.stringify([added.qBox,added.qStrips]));
  result('3 boxes of 10 vials is 30 vials, worked out offline',
    /^30 vials$/.test(added.tot||''), added.tot);
  result('it saves with no signal', added.closed);
  result('nothing reached the server while the signal was down', inserted.length===0,
    JSON.stringify(inserted).slice(0,120));

  const state = await page.evaluate(()=>{
    const q=(window.ClinicOffline&&ClinicOffline.get('outbox',[]))||[];
    const keys=Object.keys(localStorage);
    const stockKey=keys.find(k=>/stock_/.test(k)&&!/stock_packs/.test(k));
    const qsKey=keys.find(k=>/qs_inventory_/.test(k));
    const read=k=>{try{const r=JSON.parse(localStorage.getItem(k));return r&&r.v!==undefined?r.v:r;}catch(e){return null;}};
    const shelf=(read(stockKey)||[]).filter(x=>/Ceftriaxone/i.test(x.item_name||''));
    const qs=(read(qsKey)||[]).filter(x=>/Ceftriaxone/i.test(x.item_name||''));
    return { queued:(q||[]).length, outboxKeys:keys.filter(k=>/outbox/i.test(k)),
             shelf, qs, inStockList:(window._stockItems||[]).some(x=>/Ceftriaxone/i.test(x.item_name||'')) };
  });
  result('the delivery is queued, not lost', state.queued>0 || state.outboxKeys.length>0,
    JSON.stringify({q:state.queued,k:state.outboxKeys}));
  result('it is on the shelf immediately, offline', state.shelf.length===1 &&
    Number(state.shelf[0].quantity)===30 && state.shelf[0].unit==='vials',
    JSON.stringify(state.shelf).slice(0,200));
  result('it is sellable in Quick Sale immediately, offline',
    state.qs.length===1 && Number(state.qs[0].selling_price_ugx)===12000,
    JSON.stringify(state.qs).slice(0,200));

  // Quick Sale actually renders it, with no signal.
  const shown = await page.evaluate(async ()=>{
    if(window.openQuickSale) openQuickSale();
    await new Promise(r=>setTimeout(r,2500));
    const g=document.getElementById('qsDrugGrid');
    return { txt: g? g.textContent.replace(/\s+/g,' ').slice(0,300):'' };
  });
  result('Quick Sale shows it with no signal', /Ceftriaxone/i.test(shown.txt), shown.txt.slice(0,120));

  // ── Signal comes back ───────────────────────────────────────────────────
  offline = false;
  await page.evaluate(async ()=>{
    Object.defineProperty(navigator,'onLine',{get:()=>true,configurable:true});
    window.dispatchEvent(new Event('online'));
    if(window.ClinicOffline && ClinicOffline.flush) await ClinicOffline.flush();
    await new Promise(r=>setTimeout(r,2500));
  });
  await page.waitForTimeout(2000);
  const sent = inserted.filter(x=>x && /Ceftriaxone/i.test(x.item_name||''));
  result('when the signal returns it goes up exactly once', sent.length===1 &&
    Number(sent[0].quantity)===30 && sent[0].unit==='vials' && Number(sent[0].min_threshold)===10,
    JSON.stringify(sent[0]||{}).slice(0,220));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
