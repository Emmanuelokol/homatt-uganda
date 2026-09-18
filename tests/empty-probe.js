// For the conditions where no medicine can be extracted, is the guideline's own
// text still on the panel? Nothing may be silently lost.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const {execSync}=require('child_process');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const LIST=JSON.parse(execSync(`python3 -c "
import sqlite3,json
g=sqlite3.connect('${ROOT}/clinic/data/uganda_clinical_guidelines_2023.db')
out=[]
for cid,t,pg,mg,inv in g.execute('select id,title,page,management,investigations from conditions'):
  n=g.execute('select count(*) from medicines where condition_id=?',(cid,)).fetchone()[0]
  if n==0 and not (inv or '').strip() and len((mg or '').strip())>150:
    out.append({'id':cid,'title':t,'page':pg,'chars':len(mg)})
print(json.dumps(out))
"`,{maxBuffer:1<<30}).toString());
(async()=>{await new Promise(r=>server.listen(9026,r));
const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
const page=await (await b.newContext({viewport:{width:430,height:1000}})).newPage();
await page.route('**/*',r=>{const u=r.request().url();if(u.startsWith('http://localhost:9026'))return r.continue();
 if(u.startsWith(SB))return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});return r.abort();});
await page.goto('http://localhost:9026/clinic/index.html');
await page.evaluate(([cid,uid])=>{localStorage.clear();
 localStorage.setItem('clinic_session',JSON.stringify({staffName:'S',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
 localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
await page.goto('http://localhost:9026/clinic/new-order.html');
await page.waitForFunction(()=>!!window._wizState,{timeout:30000});await page.waitForTimeout(2500);
await page.evaluate(()=>window.UCGPackage.start('Malaria','moderate',window._wizState));await page.waitForTimeout(4000);
await page.evaluate(()=>window.UCGPackage.close());
let withNotes=0, noNotes=[], withMeds=0, chars=0, chooser=0; const chSample=[];
for (const c of LIST){
  const r=await page.evaluate(async(c)=>{
    await window.UCGPackage.open(c.id,c.title,'moderate',c.page);
    for(let k=0;k<60;k++){await new Promise(z=>setTimeout(z,50));
      if(document.getElementById('ucgDrugs'))break;}
    const out={panels:document.querySelectorAll('.ucg-det').length,
      chooser:[...document.querySelectorAll('#ucgAskDiff [data-h]')].map(x=>x.textContent.replace(/\s+/g,' ').trim()).slice(0,4),
      chars:[...document.querySelectorAll('.ucg-det-b')].reduce((n,x)=>n+x.textContent.length,0),
      meds:document.querySelectorAll('.ucg-drug').length};
    const a=document.getElementById('ucgAsk'); if(a) a.style.display='none';
    window.UCGPackage.close(); return out;},c);
  if(r.panels>0){withNotes++; chars+=r.chars;}
  else if(r.chooser.length){chooser++; if(chSample.length<6)chSample.push(c.title+' → '+r.chooser.join(' / ').slice(0,70));}
  else noNotes.push(c.title);
  if(r.meds>0) withMeds++;
}
console.log('pages where the book has text but no dosed medicine:',LIST.length);
console.log('  the guideline text IS shown on the panel :',withNotes);
console.log('  offered a choice of its sub-sections     :',chooser);
console.log('  showing nothing at all (must be 0)       :',noNotes.length);
console.log('  now also listing at least one medicine   :',withMeds);
console.log('  average guideline text shown             :',withNotes?Math.round(chars/withNotes):0,'characters');
if(chSample.length) console.log('\nsub-section choosers:',chSample);
if(noNotes.length) console.log('\nSHOWING NOTHING:',noNotes.slice(0,12));
await b.close();server.close();})();
