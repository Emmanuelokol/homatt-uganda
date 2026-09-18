const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9051';
(async()=>{await new Promise(r=>server.listen(9051,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
for (const W of [320,360,390,430]) {
  const page=await (await b.newContext({viewport:{width:W,height:1200},deviceScaleFactor:2,serviceWorkers:'block'})).newPage();
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN))return r.continue();
    if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort();});
  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();localStorage.setItem('homatt_theme','dark');
   localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
   localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/new-order.html');
  await page.waitForFunction(()=>!!window._wizState,{timeout:30000});await page.waitForTimeout(2000);
  const r=await page.evaluate(()=>{
    const st=window._wizState;
    st.medications=[{drug:'Artemether/Lumefantrine 20/120mg',dosage:'20/120mg',timesPerDay:2,intakeTimes:['08:00','20:00'],durationDays:5,qtyToDeduct:10,inventoryItemId:'x'},
                    {drug:'Sulphadoxine+ Pyrimethamine',dosage:'500 mg + 25 mg',timesPerDay:1,intakeTimes:['08:00'],durationDays:3,qtyToDeduct:3,inventoryItemId:'y'}];
    st.clinicInventory=[{id:'x',item_name:'Artemether/Lumefantrine',unit:'tabs',quantity:-20,is_low_stock:true,is_critical:false},
                        {id:'y',item_name:'Sulphadoxine+ Pyrimethamine',unit:'tabs',quantity:-10,is_low_stock:true,is_critical:false}];
    if(window._wizRefreshAfterAutofill) window._wizRefreshAfterAutofill();
    if(window._showStep) window._showStep(2);
    return document.querySelectorAll('#medsContainer .med-row').length;
  });
  await page.waitForTimeout(1500);
  const m=await page.evaluate(()=>{
    const doc=document.documentElement;
    const cards=[...document.querySelectorAll('#medsContainer .med-row')];
    const over=[];
    document.querySelectorAll('#medsContainer *').forEach(el=>{
      const b=el.getBoundingClientRect();
      if(b.width>0 && b.right > doc.clientWidth+1) over.push((el.className||el.tagName)+' right='+Math.round(b.right));
    });
    // walk up from a clipped chip to find WHERE the width comes from
    const chip=document.querySelector('#medsContainer .sev-chips');
    const chain=[];
    for(let el=chip; el && el!==document.documentElement; el=el.parentElement){
      const b=el.getBoundingClientRect(), cs=getComputedStyle(el);
      chain.push((el.id?'#'+el.id:'')+'.'+String(el.className).split(' ')[0]+
        ' w='+Math.round(b.width)+' left='+Math.round(b.left)+
        (cs.display!=='block'?' ['+cs.display+']':'')+
        (cs.minWidth!=='0px'&&cs.minWidth!=='auto'?' minW='+cs.minWidth:'')+
        (cs.overflowX!=='visible'?' ovx='+cs.overflowX:''));
    }
    return {docScroll:doc.scrollWidth, docClient:doc.clientWidth, cards:cards.length, over:over.slice(0,2), chain};
  });
  console.log(String(W)+'px: page '+m.docScroll+'/'+m.docClient+
    (m.docScroll>m.docClient+1?'  ← OVERFLOWS':'  ok')+'   cards='+m.cards+
    (m.over.length?'   clipped: '+m.over.join(' | ').slice(0,80):''));
  if(W===430) m.chain.forEach(c=>console.log('        '+c));
  if(W===360) await page.screenshot({path:'wiz-360.png'});
  await page.context().close();
}
await b.close();server.close();})();
