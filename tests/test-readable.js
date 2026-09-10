// Every word, in every colour the app ships in.
//
// Four skins × two themes = eight combinations. A colour written as a literal
// instead of a token is readable in the one the author was looking at and
// invisible in the other seven, and no amount of looking finds that — the
// treatment screen alone had 49 pieces of text below the readable threshold,
// including "Total charged" at 1.06:1 and "Clinic stock" at 1.01:1.
//
// This is the guard, not the survey: `measure-contrast.js` prints the whole
// list with ratios when something breaks. This asserts the count is zero on
// the screens a clinician spends the day in, in the two skin/theme corners
// that broke most often — the whole sweep is six screens × eight passes and
// takes far too long for every run.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.wasm':'application/wasm','.db':'application/octet-stream'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT = 8935, ORIGIN = 'http://localhost:' + PORT;

// The corners that actually broke: the "dark" skin, whose --primary is a
// near-black chrome fill that was being used as words; and forest dark, where
// --primary lightens and white stopped being readable on it.
const COMBOS = [['dark','dark'], ['forest','dark'], ['clay','light']];
const PAGES = ['new-order.html', 'dashboard.html'];

const MEASURE_IN = (sel) => {
  function parse(c){var m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return null;
    var p=m[1].split(',').map(function(x){return parseFloat(x)});
    return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
  function over(f,b){var a=f.a;return{r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a),a:1};}
  function rel(c){function ch(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
    return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b);}
  function ratio(a,b){var l1=rel(a),l2=rel(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
  // Composite every translucent layer. A dark-mode input is a 6% white wash
  // over a dark card; reading that wash as opaque white reports a readable box
  // as 1.16:1 — and would just as easily hide a real failure.
  function bgOf(el){var stack=[],node=el,grad=false;
    while(node&&node.nodeType===1){var cs=getComputedStyle(node);
      if(cs.backgroundImage&&cs.backgroundImage!=='none')grad=true;
      var c=parse(cs.backgroundColor);
      if(c&&c.a>0){stack.push(c);if(c.a>=0.999)break;}
      node=node.parentElement;}
    var base={r:255,g:255,b:255,a:1},last=stack[stack.length-1];
    if(last&&last.a>=0.999){base=last;stack.pop();}
    for(var i=stack.length-1;i>=0;i--)base=over(stack[i],base);
    return {bg:base,gradient:grad};}
  function ownText(el){var t='';for(var i=0;i<el.childNodes.length;i++)
    if(el.childNodes[i].nodeType===3)t+=el.childNodes[i].nodeValue;return t.trim();}
  var root = sel ? document.querySelector(sel) : document.body;
  if (!root) return { n: 0, bad: [] };
  var bad=[],n=0,all=root.querySelectorAll('*');
  for(var i=0;i<all.length;i++){var el=all[i],text=ownText(el);
    if(!text||text.length<2)continue;
    var cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden')continue;
    if(parseFloat(cs.opacity)<0.25)continue;
    var r=el.getBoundingClientRect(); if(r.width<4||r.height<4)continue;
    var fg=parse(cs.color); if(!fg)continue;
    var b=bgOf(el); if(b.gradient)continue;
    if(fg.a<1)fg=over(fg,b.bg);
    var size=parseFloat(cs.fontSize)||14,weight=parseInt(cs.fontWeight,10)||400;
    var need=(size>=24||(size>=18.66&&weight>=700))?3:4.5;
    var got=ratio(fg,b.bg); n++;
    if(got<need)bad.push(text.slice(0,26).replace(/\s+/g,' ')+' ('+Math.round(got*100)/100+':1)');
  }
  return {n:n,bad:bad};
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1400 } })).newPage();
  page.on('pageerror', () => {});
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });
  await page.goto(ORIGIN + '/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);

  let checked = 0;
  for (const p of PAGES) {
    for (const [skin, theme] of COMBOS) {
      await page.evaluate(([s,t]) => {
        localStorage.setItem('homatt_skin', s); localStorage.setItem('homatt_theme', t);
      }, [skin, theme]);
      await page.goto(ORIGIN + '/clinic/' + p, { waitUntil: 'load' });
      await page.waitForTimeout(1600);
      await page.evaluate(([s,t]) => {
        document.documentElement.setAttribute('data-skin', s);
        document.documentElement.setAttribute('data-theme', t);
      }, [skin, theme]);
      // Open what a clinician taps, so a fault inside a panel is not missed.
      // A panel that is display:none on load is still a screen people read,
      // and a colour fault inside one is exactly the kind that survives review.
      if (p === 'new-order.html') {
        await page.evaluate(() => {
          document.querySelectorAll('.wiz-step, .wiz-pane, [data-step]').forEach(function (el) {
            if (getComputedStyle(el).display === 'none') el.style.display = 'block';
          });
          ['itPane1','itPane2','itPane3','itCheck','payPartWrap'].forEach(function (id) {
            var e = document.getElementById(id); if (e) e.style.display = 'block';
          });
        });
      }
      await page.waitForTimeout(300);
      const res = await page.evaluate(MEASURE_IN, null);
      checked += res.n;
      result('every word is readable — ' + p + ' [' + skin + '/' + theme + ']',
        res.bad.length === 0, res.n + ' checked' +
        (res.bad.length ? ', unreadable: ' + res.bad.slice(0, 4).join(' | ') : ''));
    }
  }
  // ── The one-tap package panel ───────────────────────────────────────────
  // The sweep above cannot reach this screen: its stylesheet is injected at
  // runtime and the panel only exists while it is open. That is how it came to
  // be the one screen a clinician photographed — test chips at 1:1, a payment
  // button showing nothing but its emoji — while every page measured clean.
  for (const [skin, theme] of [['dark','dark'], ['clay','light']]) {
    await page.evaluate(([s2,t2]) => {
      localStorage.setItem('homatt_skin', s2); localStorage.setItem('homatt_theme', t2);
      localStorage.setItem('homatt_speak_handoff', JSON.stringify({
        at: Date.now(), heard: 'x', dx: 'Malaria', name: 'A B', sex: 'female',
        age: '30', ageUnit: 'years', chief: 'fever',
        subjective: 'fever for three days with headache', background: '',
        vitals: { temp: '39.1', pulse: '104', sbp: '110', dbp: '70', weight: '58' } }));
    }, [skin, theme]);
    await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
    await page.waitForTimeout(6500);
    await page.evaluate(([s2,t2]) => {
      document.documentElement.setAttribute('data-skin', s2);
      document.documentElement.setAttribute('data-theme', t2);
      const a = document.getElementById('ucgAsk');
      if (a && getComputedStyle(a).display !== 'none') {
        const f = document.querySelector('#ucgAskDiff [data-h]');
        if (f) f.click();
      }
    }, [skin, theme]);
    await page.waitForTimeout(2500);
    const isOpen = await page.evaluate(() => {
      const o = document.getElementById('ucgOverlay');
      return !!o && getComputedStyle(o).display !== 'none';
    });
    if (!isOpen) {
      result('the package panel opened — [' + skin + '/' + theme + ']', false, 'it did not open');
      continue;
    }
    await page.evaluate(() => {
      document.querySelectorAll('#ucgOverlay details').forEach(d => { d.open = true; });
    });
    await page.waitForTimeout(300);
    const pres = await page.evaluate(MEASURE_IN, '#ucgOverlay');
    checked += pres.n;
    result('every word is readable — the package panel [' + skin + '/' + theme + ']',
      pres.bad.length === 0, pres.n + ' checked' +
      (pres.bad.length ? ', unreadable: ' + pres.bad.slice(0, 4).join(' | ') : ''));
  }

  result('and enough of the app was actually looked at', checked > 600, checked + ' pieces of text across ' + (PAGES.length * COMBOS.length) + ' passes');
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
