// Mobile data is bought by the megabyte here, so a screen left open must not
// quietly spend money. These are the rules that keep it cheap.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=APP;
const MIME={'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server=http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111',UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9046';

(async()=>{
  await new Promise(r=>server.listen(9046,r));
  const b=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
  // The service worker is not the subject here — the API chatter is.
  const page=await (await b.newContext({viewport:{width:430,height:900},serviceWorkers:'block'})).newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message.split('\n')[0]));
  const result=(n,ok,x)=>console.log((ok?'PASS':'FAIL')+'  '+n+(x?'  — '+x:''));

  let api=0, counting=false;
  await page.route('**/*',r=>{const u=r.request().url();
    if(u.startsWith(ORIGIN)) return r.continue();
    if(u.startsWith(SB)){ if(counting) api++;
      return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'}); }
    return r.abort();});

  await page.goto(ORIGIN+'/clinic/index.html');
  await page.evaluate(([cid,uid])=>{localStorage.clear();
    localStorage.setItem('clinic_session',JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth',JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));},[CID,UID]);
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(10000);

  result('every repeating check goes through the pacer',
    await page.evaluate(()=>typeof window.HomattPace === 'object' && typeof HomattPace.every === 'function'));

  // ── With the live socket connected, nothing needs to poll ────────────────
  // (the socket cannot reach a stub server here, and its own failing retry
  // rewrites the flag every few seconds, so the flag is held)
  await page.evaluate(()=>{ setInterval(()=>{ window._homattRtLive = true; }, 300); });
  await page.waitForTimeout(2000);
  api=0; counting=true;
  await page.waitForTimeout(90000);
  counting=false;
  const live90 = api;
  result('with the live socket up, an idle screen is almost silent',
    live90 <= 8, live90+' server calls in 90s  (it was ~53 before this)');

  // ── With the socket down it must still poll — but not constantly ─────────
  await page.evaluate(()=>{ window.__hold && clearInterval(window.__hold); });
  await page.goto(ORIGIN+'/clinic/dashboard.html');
  await page.waitForTimeout(10000);
  api=0; counting=true;
  await page.waitForTimeout(90000);
  counting=false;
  const down90 = api;
  result('with the socket down it still checks, but backs off while nothing changes',
    down90 > 0 && down90 <= 30, down90+' server calls in 90s  (it was ~53 before this)');

  // ── In a pocket it must spend nothing at all ─────────────────────────────
  await page.evaluate(()=>{
    Object.defineProperty(document, 'visibilityState', { get(){ return 'hidden'; }, configurable:true });
    Object.defineProperty(document, 'hidden', { get(){ return true; }, configurable:true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(3000);
  api=0; counting=true;
  await page.waitForTimeout(90000);
  counting=false;
  result('with the phone away, it spends nothing', api === 0, api+' server calls in 90s');

  // ── The service worker must not re-download files it already has ─────────
  const sw = fs.readFileSync(ROOT+'/clinic/clinic-sw.js','utf8');
  result('files that carry their version in the URL are never re-fetched',
    /function isImmutable/.test(sw) && /if \(isImmutable\(url\)\)/.test(sw));
  result('an app update copies unchanged files across instead of downloading them',
    /async function carryOver/.test(sw) && /if \(await carryOver\(c, u\)\) return;/.test(sw));
  result('pages are refreshed on a timer, not on every single open',
    /REVALIDATE_EVERY/.test(sw) && /dueForRefresh/.test(sw));

  // ── Every versioned asset a page asks for must be the one precached ──────
  const pages = fs.readdirSync(ROOT+'/clinic').filter(f=>f.endsWith('.html'));
  const want = {};
  pages.forEach(f=>{ const t=fs.readFileSync(ROOT+'/clinic/'+f,'utf8');
    (t.match(/(?:src|href)="((?:js|css|fonts|icons|\.\.\/js)\/[^"]+)"/g)||[]).forEach(m=>{
      const u=m.replace(/^(?:src|href)="/,'').replace(/"$/,'');
      (want[u.split('?')[0]] = want[u.split('?')[0]] || new Set()).add(u); }); });
  const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/)||[])[1]||'';
  const have = {};
  (shell.match(/'([^']+)'/g)||[]).forEach(m=>{ const u=m.slice(1,-1);
    (have[u.split('?')[0]] = have[u.split('?')[0]] || new Set()).add(u); });
  // EVERY version any page asks for has to be precached, not merely one of
  // them. `.some()` here let a second version of the same file slip in on
  // another page: it worked online and was a cache miss offline, which is the
  // one condition this whole app is built for. Report the exact URL, because
  // "drift" without it sends someone reading five files.
  const drift = [];
  Object.keys(want).forEach(base=>{
    if(!have[base]) return;                    // not precached at all: not this check
    [...want[base]].forEach(u=>{ if(!have[base].has(u)) drift.push(u); });
  });
  result('the service worker precaches the exact file versions the pages ask for',
    drift.length===0, drift.length?'DRIFTED: '+JSON.stringify(drift):Object.keys(have).length+' entries checked');

  result('no page errors', errs.length===0, errs.slice(0,3).join(' | '));
  await b.close(); server.close();
})().catch(e=>{console.error('CRASH',e.message);process.exit(1);});
