// Quick Sale "+ New Item": the name comes off the national list, the app works
// out what kind of thing it is and what it is counted in, and nothing is ever
// refused. Real browser, real EMHSLU database, real sheet.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', PORT=9077, ORIGIN='http://localhost:'+PORT;

const STOCK=[{id:'s1',clinic_id:CID,item_name:'Paracetamol 500mg',item_type:'medicine',unit:'tabs',
  quantity:800,min_threshold:100,reorder_level:200,is_active:true,is_low_stock:false,is_critical:false,
  selling_price_ugx:200}];

(async()=>{
  await new Promise(r=>server.listen(PORT,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  const ctx=await b.newContext({viewport:{width:430,height:1400},deviceScaleFactor:2,serviceWorkers:'block'});
  const page=await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  const inserted=[];
  await page.route('**/*',r=>{const rq=r.request(),u=rq.url();
    if(u.startsWith(ORIGIN)) return r.continue();
    if(u.startsWith(SB)){
      const H={'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if(/clinic_inventory/.test(u)&&rq.method()==='POST'){
        let a=null; try{a=JSON.parse(rq.postData()||'null');}catch(e){}
        const row=Array.isArray(a)?a[0]:a;
        inserted.push(row);
        return r.fulfill({status:201,headers:H,body:JSON.stringify([Object.assign({id:'new-'+inserted.length},row)])});
      }
      // A re-read has to show what was just written, exactly as the real
      // database would — otherwise the test is checking the mock, not the app.
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

  // ── The blueprint module, on its own ───────────────────────────────────
  const bpr = await page.evaluate(()=>{
    const B=window.StockBlueprint; if(!B) return null;
    const g=(n,f,t,s)=>B.blueprintFor({name:n,form:f,itemType:t,spec:s});
    return {
      amox:  g('Amoxicillin 250 mg','Capsule','medicine'),
      para:  g('Paracetamol 500 mg','Tablet','medicine'),
      coart: g('Artemether/Lumefantrine 20/120 mg','Tablet','medicine'),
      cefx:  g('Ceftriaxone 1 g','Powder for injection','medicine'),
      saline:g('Sodium chloride 0.9%','IV infusion','medicine'),
      syrup: g('Amoxicillin 125 mg/5 ml','Oral suspension','medicine'),
      ors:   g('Oral rehydration salts','Powder for solution WHO formula','medicine'),
      liner: g('Bin liners',null,'health_supply','Black, pack of 100'),
      pamp:  g('Pampers (baby diapers)',null,'consumable'),
      cond:  g('Condoms (male)',null,'consumable'),
      condF: g('Condoms (female)',null,'consumable'),
      noform:g('Something brand new',null,'medicine'),
      spec:  [B.parseSpecPack('Black, pack of 100'), B.parseSpecPack('Roll, 25 m'), B.parseSpecPack('Packet of 50 sachets')],
      types: [B.typeFor('medicine'), B.typeFor('health_supply')],
    };
  });
  result('the blueprint module loads', !!bpr);
  result('a capsule is counted in caps, 10 strips x 10 to a box',
    bpr.amox.unit==='caps' && bpr.amox.inner==='strips' && bpr.amox.strips===10 && bpr.amox.units===10,
    JSON.stringify(bpr.amox));
  result('a tablet is counted in tabs, 10 x 10 = 100',
    bpr.para.unit==='tabs' && bpr.para.strips*bpr.para.units===100, JSON.stringify(bpr.para));
  result('Coartem knows its blister is a 24-tablet adult course',
    bpr.coart.units===24 && bpr.coart.inner==='blisters' && bpr.coart.sure===true, JSON.stringify(bpr.coart));
  result('an injection is counted in vials, with no strip question',
    bpr.cefx.unit==='vials' && bpr.cefx.inner==='' && bpr.cefx.units===10, JSON.stringify(bpr.cefx));
  result('a drip is counted in bottles, bought by the carton',
    bpr.saline.unit==='bottles' && bpr.saline.outer==='cartons' && bpr.saline.units===20, JSON.stringify(bpr.saline));
  result('a syrup is counted in bottles, one at a time',
    bpr.syrup.unit==='bottles' && bpr.syrup.units===1, JSON.stringify(bpr.syrup));
  result('ORS is counted in sachets, not tablets',
    bpr.ors.unit==='sachets', JSON.stringify(bpr.ors));
  result('a pack size printed in the national list is used as-is',
    bpr.liner.units===100 && bpr.liner.sure===true, JSON.stringify(bpr.liner));
  result('pampers — which EMHSLU does not carry at all — are still known',
    bpr.pamp.kind==='commodity' && bpr.pamp.unit==='pieces' && bpr.pamp.units===0,
    JSON.stringify(bpr.pamp));
  // Matching on the leading word alone would hand the female packet the male
  // entry's count. The exact name has to win.
  result('male and female condoms keep their own packet sizes',
    bpr.cond.units===3 && bpr.condF.units===2,
    JSON.stringify([bpr.cond.units,bpr.condF.units]));
  result('a name with no dosage form at all still gets a sane starting pack',
    bpr.noform.unit==='tabs' && bpr.noform.strips===10 && bpr.noform.sure===false,
    JSON.stringify(bpr.noform));
  result('"pack of 100" is read; "Roll, 25 m" is not mistaken for a count',
    bpr.spec[0]===100 && bpr.spec[1]===0 && bpr.spec[2]===50, JSON.stringify(bpr.spec));
  result('everything that is not a medicine is sellable, never an internal material',
    bpr.types[0]==='medicine' && bpr.types[1]==='consumable', JSON.stringify(bpr.types));

  // ── "+ New Item" from Quick Sale ────────────────────────────────────────
  const opened = await page.evaluate(async ()=>{
    if (window.openQuickSale) openQuickSale();
    await new Promise(r=>setTimeout(r,1200));
    const btn=document.getElementById('qsAddDrugBtn');
    btn.click(); btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));
    await new Promise(r=>setTimeout(r,900));
    const sheet=document.getElementById('stkOverlay');
    const old=document.getElementById('stockItemModal');
    return {
      sheet: !!(sheet && getComputedStyle(sheet).display!=='none'),
      oldModal: !!(old && getComputedStyle(old).display!=='none'),
      hasSearch: !!document.getElementById('stkSearch'),
    };
  });
  result('"+ New Item" opens the pick-a-name sheet, not the old form',
    opened.sheet && !opened.oldModal && opened.hasSearch, JSON.stringify(opened));

  // The two things the clinic must never have to answer.
  const gone = await page.evaluate(()=>{
    const sh=document.getElementById('stkSheet');
    return { selects: sh.querySelectorAll('select').length,
             unitBox: !!sh.querySelector('input[placeholder*="tabs /"]') };
  });
  result('no Type dropdown and no unit box anywhere in the sheet',
    gone.selects===0 && !gone.unitBox, JSON.stringify(gone));

  async function type(v){
    return page.evaluate(async (val)=>{
      const i=document.getElementById('stkSearch');
      i.value=val; i.dispatchEvent(new Event('input',{bubbles:true}));
      for(let k=0;k<40;k++){ await new Promise(r=>setTimeout(r,200));
        const bx=document.getElementById('stkRes');
        if(bx && bx.style.display==='block' && bx.querySelectorAll('[data-i]').length) break; }
      const bx=document.getElementById('stkRes');
      return [...bx.querySelectorAll('div')].map(d=>({
        name:(d.querySelector('b')||{}).textContent||'',
        tag:(d.querySelector('.t')||{}).textContent||'',
        isNew: d.hasAttribute('data-new'),
      }));
    }, v);
  }

  const amox = await type('amoxicillin');
  result('typing a medicine name lists it straight off the national list',
    amox.some(h=>/^Amoxicillin/.test(h.name) && /EMHSLU medicine/.test(h.tag)),
    JSON.stringify(amox.slice(0,3)));

  const pick = await page.evaluate(async ()=>{
    const bx=document.getElementById('stkRes');
    const hit=[...bx.querySelectorAll('[data-i]')].find(d=>/^Amoxicillin/.test(d.querySelector('b').textContent));
    hit.click();
    await new Promise(r=>setTimeout(r,500));
    const lbl=id=>{const e=document.querySelector('label[for="'+id+'"]'); return e?e.textContent.replace(/\s+/g,' ').trim():null;};
    return {
      title: document.getElementById('stkTitle').textContent,
      sub:   document.getElementById('stkSub').textContent,
      qBox:  lbl('stkBoxes'), qStrips: lbl('stkStrips'), qUnits: lbl('stkUnits'),
      strips: (document.getElementById('stkStrips')||{}).value,
      units:  (document.getElementById('stkUnits')||{}).value,
      thres:  (document.getElementById('stkThreshold')||{}).value,
      priceBox: !!document.getElementById('stkUnitPrice'),
    };
  });
  result('picking it settles the type and the unit with no further questions',
    /Medicine, counted in caps/.test(pick.sub), JSON.stringify(pick.sub));
  result('the three questions are asked in the words on the carton',
    /How many boxes did you receive/.test(pick.qBox||'') &&
    /How many strips are in one box/.test(pick.qStrips||'') &&
    /How many caps are in one strip/.test(pick.qUnits||''),
    JSON.stringify([pick.qBox,pick.qStrips,pick.qUnits]));
  result('the standard pack is already filled in — 10 strips x 10 caps',
    pick.strips==='10' && pick.units==='10', JSON.stringify(pick));
  result('the low-stock warning starts at 10 without being asked',
    pick.thres==='10', pick.thres);
  result('the selling price is asked on the way in', pick.priceBox);

  const sum = await page.evaluate(async ()=>{
    const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));};
    set('stkBoxes','5');
    await new Promise(r=>setTimeout(r,200));
    const s=document.getElementById('stkSum');
    const before={calc:s.querySelector('.calc').textContent.replace(/\s+/g,' '),tot:s.querySelector('.tot').textContent};
    set('stkUnitPrice','500');
    await new Promise(r=>setTimeout(r,200));
    return {before, hint:document.getElementById('stkPriceHint').textContent,
            saveOn: !document.getElementById('stkSave').disabled};
  });
  result('the sum is shown in full so a wrong pack size is obvious',
    /5 boxes × 10 strips × 10 caps/.test(sum.before.calc) && /^500 caps$/.test(sum.before.tot),
    JSON.stringify(sum.before));
  result('the price of a strip is worked out from the price of one capsule',
    /strip of 10 caps sells for UGX 5,000/.test(sum.hint), sum.hint);

  const saved = await page.evaluate(async ()=>{
    document.getElementById('stkSave').click();
    await new Promise(r=>setTimeout(r,2500));
    return { closed: getComputedStyle(document.getElementById('stkOverlay')).display==='none' };
  });
  const row = inserted[0]||{};
  result('saving creates the item with everything worked out for it', saved.closed &&
    row.item_type==='medicine' && row.unit==='caps' && Number(row.quantity)===500 &&
    Number(row.min_threshold)===10, JSON.stringify(row).slice(0,220));
  result('the pack shape and prices go in the columns Quick Sale sells by',
    Number(row.tabs_per_pack)===10 && Number(row.packs_per_box)===10 &&
    Number(row.selling_price_ugx)===500 && Number(row.pack_selling_price_ugx)===5000,
    JSON.stringify(row).slice(0,220));

  const inQs = await page.evaluate(async ()=>{
    if (window.openQuickSale) openQuickSale();
    await new Promise(r=>setTimeout(r,1500));
    const g=document.getElementById('qsDrugGrid');
    return !!g && g.textContent.indexOf('Amoxicillin')>=0;
  });
  result('the new item is sellable in Quick Sale straight away', inQs);

  // ── Nothing is ever refused ─────────────────────────────────────────────
  const unknown = await page.evaluate(async ()=>{
    document.getElementById('stkOverlay').style.display='none';
    window.StockIntake.start(null);
    await new Promise(r=>setTimeout(r,400));
    const i=document.getElementById('stkSearch');
    i.value='Zenolyte Forte'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,900));
    const nw=document.getElementById('stkRes').querySelector('[data-new]');
    const offer=nw?nw.textContent.replace(/\s+/g,' '):null;
    if(nw) nw.click();
    await new Promise(r=>setTimeout(r,400));
    const kinds=[...document.querySelectorAll('.stk-kind button')].map(b=>b.querySelector('b').textContent);
    const other=document.querySelector('.stk-kind [data-k="consumable"]');
    if(other) other.click();
    await new Promise(r=>setTimeout(r,400));
    const lbl=id=>{const e=document.querySelector('label[for="'+id+'"]'); return e?e.textContent.replace(/\s+/g,' ').trim():null;};
    return { offer, kinds, sub:document.getElementById('stkSub').textContent,
             qBox:lbl('stkBoxes'), qUnits:lbl('stkUnits'),
             thres:(document.getElementById('stkThreshold')||{}).value };
  });
  result('a name nothing has ever heard of is offered, not refused',
    /Add “Zenolyte Forte”/.test(unknown.offer||'') && /add it anyway/.test(unknown.offer||''),
    unknown.offer);
  result('the only thing it has to ask is medicine or counter item',
    unknown.kinds.length===2 && /A medicine/.test(unknown.kinds[0]) &&
    /Something else you sell/.test(unknown.kinds[1]), JSON.stringify(unknown.kinds));
  result('a counter item asks packs and pieces, in those words',
    /How many packs did you receive/.test(unknown.qBox||'') &&
    /How many pieces are in one pack/.test(unknown.qUnits||''),
    JSON.stringify([unknown.qBox,unknown.qUnits]));
  result('a brand new counter item also starts at a warning level of 10',
    unknown.thres==='10', unknown.thres);

  // A counter item the app ships a hint for.
  const pamp = await page.evaluate(async ()=>{
    document.getElementById('stkOverlay').style.display='none';
    window.StockIntake.start(null);
    await new Promise(r=>setTimeout(r,400));
    const i=document.getElementById('stkSearch');
    i.value='condom'; i.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,1200));
    const hits=[...document.getElementById('stkRes').querySelectorAll('[data-i]')]
      .map(d=>d.querySelector('b').textContent);
    const c=[...document.getElementById('stkRes').querySelectorAll('[data-i]')]
      .find(d=>/^Condoms \(male\)/.test(d.querySelector('b').textContent));
    if(!c) return {hits, picked:false};
    c.click();
    await new Promise(r=>setTimeout(r,400));
    const set=(id,v)=>{const e=document.getElementById(id); e.value=v; e.dispatchEvent(new Event('input',{bubbles:true}));};
    set('stkBoxes','20');
    await new Promise(r=>setTimeout(r,200));
    return { hits, picked:true, sub:document.getElementById('stkSub').textContent,
             units:(document.getElementById('stkUnits')||{}).value,
             tot:document.getElementById('stkSum').querySelector('.tot').textContent };
  });
  // The national list files condoms under contraceptives — a medicine. To a
  // clinic selling them over the counter they are a counter item.
  result('a counter item the app knows offers its usual packet size',
    pamp.picked && pamp.units==='3' && /60 pieces/.test(pamp.tot||'') &&
    /Counter item, counted in pieces/.test(pamp.sub||''),
    JSON.stringify(pamp).slice(0,220));

  // ── Restocking something already on the shelf ───────────────────────────
  // An item stocked before any pack shape was recorded knows only what it is
  // counted in. Vials are not sold in strips, and must not be asked about.
  const restock = await page.evaluate(async ()=>{
    document.getElementById('stkOverlay').style.display='none';
    const item={id:'v1',clinic_id:'x',item_name:'Ceftriaxone 1 g',item_type:'medicine',
      unit:'vials',quantity:12,min_threshold:10,selling_price_ugx:12000};
    window._stockItems=(window._stockItems||[]).concat([item]);
    window.StockIntake.start(item);
    await new Promise(r=>setTimeout(r,700));
    const lbl=id=>{const e=document.querySelector('label[for="'+id+'"]'); return e?e.textContent.replace(/\s+/g,' ').trim():null;};
    const set=(id,v)=>{const e=document.getElementById(id); if(e){e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));}};
    set('stkBoxes','2');
    await new Promise(r=>setTimeout(r,200));
    const s=document.getElementById('stkSum');
    return { qBox:lbl('stkBoxes'), qStrips:lbl('stkStrips'), qUnits:lbl('stkUnits'),
             shelf:(document.querySelector('.stk-known')||{}).textContent||'',
             price:!!document.getElementById('stkUnitPrice'),
             note:s.querySelector('.note')?s.querySelector('.note').textContent:'' };
  });
  result('a restock of something counted in vials is never asked about strips',
    restock.qStrips===null && /How many vials are in one box/.test(restock.qUnits||''),
    JSON.stringify([restock.qBox,restock.qStrips,restock.qUnits]));
  result('a restock shows what is on the shelf and does not re-ask the price',
    /On the shelf now: 12 vials/.test(restock.shelf) && restock.price===false,
    JSON.stringify(restock.shelf).slice(0,90));
  result('the restock says exactly what the shelf will read afterwards',
    /Shelf goes from 12 to 32 vials/.test(restock.note||''), restock.note);

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await page.screenshot({path:'/tmp/claude-0/-home-user-homatt-uganda/f3451427-e03d-514d-8f41-e3e6f96e4176/scratchpad/offline-test/newitem.png'});
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
