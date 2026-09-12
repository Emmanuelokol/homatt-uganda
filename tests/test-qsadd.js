// Selling something not on the shelf yet is the commonest reason a sale stalls.
// The way in must sit under the search, carry the typed word across, and come
// back to the sale afterwards.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co',PORT=9092,ORIGIN='http://localhost:'+PORT;

const STOCK=[{id:'s1',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',
  quantity:800,min_threshold:100,reorder_level:200,is_active:true,is_low_stock:false,is_critical:false,
  selling_price_ugx:200}];

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const page=await (await b.newContext({viewport:{width:412,height:915},serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  const inserted=[];
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB)){
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_inventory/.test(u)&&rq.method()==='POST'){
        let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a; inserted.push(row);
        return r.fulfill({status:201,headers:H,body:JSON.stringify([Object.assign({id:'new-'+inserted.length},row)])});
      }
      if(/get_clinic_stock/.test(u)||/clinic_inventory/.test(u))
        return r.fulfill({status:200,headers:H,body:JSON.stringify(
          STOCK.concat(inserted.map((row,i)=>Object.assign({id:'new-'+(i+1),is_low_stock:false,is_critical:false},row))))});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(6000);

  // ── The label everywhere it appears ─────────────────────────────────────
  const labels = await page.evaluate(()=>{
    const t = document.body.innerText;
    return { treatment: /New Treatment/.test(t), consultation: /New Consultation/.test(t),
             cta: [...document.querySelectorAll('a.home-cta,.sidebar-link')]
                    .map(a=>a.textContent.replace(/\s+/g,' ').trim())
                    .filter(s=>/New /.test(s)) };
  });
  result('the dashboard says "New Treatment", never "New Consultation"',
    labels.treatment && !labels.consultation, JSON.stringify(labels.cta));

  // ── The add button under the search ─────────────────────────────────────
  const open = await page.evaluate(async ()=>{
    openQuickSale();
    await new Promise(r=>setTimeout(r,2000));
    const btn=document.getElementById('qsAddFromSearch');
    const search=document.getElementById('qsSearch');
    if(!btn||!search) return {found:false};
    const rb=btn.getBoundingClientRect(), rs=search.getBoundingClientRect();
    return { found:true, label:document.getElementById('qsAddFromSearchLabel').textContent,
             belowSearch: rb.top >= rs.bottom - 1,
             visible: rb.height>0 && getComputedStyle(btn).display!=='none' };
  });
  result('an add button sits directly under the search box',
    open.found && open.belowSearch && open.visible, JSON.stringify(open));
  // The add row costs height, and this sheet has none spare with the keyboard
  // up — adding it once pushed the Sell button clean off the bottom.
  const sell = await page.evaluate(()=>{
    const sh=document.getElementById('qsSheet').getBoundingClientRect();
    const s=document.getElementById('qsSellBtn').getBoundingClientRect();
    return { ok: s.height>0 && s.bottom<=sh.bottom+1, over: Math.round(s.bottom-sh.bottom) };
  });
  result('and the Sell button is still on the sheet, not pushed off it',
    sell.ok, sell.ok ? '' : sell.over+'px below the sheet');
  result('with nothing typed it offers to add an item or medicine',
    open.label==='Add an item or medicine', open.label);

  // Typing carries into the button and the empty state.
  const typed = await page.evaluate(async ()=>{
    const s=document.getElementById('qsSearch');
    s.value='Coartem'; s.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,400));
    const nm=document.getElementById('qsNoMatch');
    return { label:document.getElementById('qsAddFromSearchLabel').textContent,
             noMatch: nm && getComputedStyle(nm).display!=='none' ? nm.textContent.replace(/\s+/g,' ').trim() : '' };
  });
  result('the button offers to add exactly what was typed',
    typed.label==='Add “Coartem”', typed.label);
  result('"no match" says what was searched for and points at the way out',
    /Nothing on the shelf matches Coartem/.test(typed.noMatch) && /Add it below/.test(typed.noMatch),
    typed.noMatch.slice(0,90));

  // ── Tapping it carries the word into the sheet ──────────────────────────
  const carried = await page.evaluate(async ()=>{
    const btn=document.getElementById('qsAddFromSearch');
    btn.click(); btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    await new Promise(r=>setTimeout(r,1500));
    const sheet=document.getElementById('stkOverlay');
    const inp=document.getElementById('stkSearch');
    // give the national list time to answer
    for(let k=0;k<40;k++){ await new Promise(r=>setTimeout(r,200));
      const bx=document.getElementById('stkRes');
      if(bx && bx.style.display==='block' && bx.querySelectorAll('div').length) break; }
    const bx=document.getElementById('stkRes');
    return { open: !!(sheet && getComputedStyle(sheet).display!=='none'),
             qsClosed: getComputedStyle(document.getElementById('qsOverlay')).display==='none',
             value: inp?inp.value:null,
             offers: bx?[...bx.querySelectorAll('div')].map(d=>d.textContent.replace(/\s+/g,' ').trim()):[] };
  });
  result('the sheet opens with the typed word already in it — never typed twice',
    carried.open && carried.qsClosed && carried.value==='Coartem', JSON.stringify(carried.value));
  result('and it is already offering to add that exact name',
    carried.offers.some(o=>/Add “Coartem”/.test(o)), JSON.stringify(carried.offers).slice(0,140));

  // ── Adding it returns to the sale, with the item found ──────────────────
  const back = await page.evaluate(async ()=>{
    const nw=document.getElementById('stkRes').querySelector('[data-new]');
    if(!nw) return {step:'no-add-row'};
    nw.click();
    await new Promise(r=>setTimeout(r,500));
    const km=document.querySelector('.stk-kind [data-k="medicine"]');
    if(km){ km.click(); await new Promise(r=>setTimeout(r,500)); }
    const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}};
    set('stkBoxes','2'); set('stkUnitPrice','1500');
    await new Promise(r=>setTimeout(r,300));
    document.getElementById('stkSave').click();
    await new Promise(r=>setTimeout(r,3000));
    const qs=document.getElementById('qsOverlay');
    const grid=document.getElementById('qsDrugGrid');
    return { step:'done',
             qsReopened: !!(qs && getComputedStyle(qs).display!=='none'),
             search: (document.getElementById('qsSearch')||{}).value,
             gridHasIt: !!grid && /Coartem/i.test(grid.textContent),
             visibleCards: grid ? [...grid.querySelectorAll('.qs-drug-card')]
                 .filter(c=>c.style.display!=='none').map(c=>c.textContent.replace(/\s+/g,' ').trim()) : [] };
  });
  result('saving brings the sale back up, ready to continue',
    back.qsReopened, JSON.stringify(back.step));
  result('the new item is searched for and on screen, sellable',
    back.search==='Coartem' && back.gridHasIt &&
    back.visibleCards.length===1 && /Coartem/i.test(back.visibleCards[0]) &&
    /1,500/.test(back.visibleCards[0]),
    JSON.stringify(back.visibleCards).slice(0,140));
  result('it was created as a real stock item',
    inserted.length===1 && /Coartem/i.test(inserted[0].item_name||'') &&
    Number(inserted[0].selling_price_ugx)===1500,
    JSON.stringify(inserted[0]||{}).slice(0,160));

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'/tmp/claude-0/-home-user-homatt-uganda/f3451427-e03d-514d-8f41-e3e6f96e4176/scratchpad/offline-test/qsadd.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
