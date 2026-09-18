// The one-tap package panel — the screen in the photographs.
//
// The page sweep could never see this one: the panel's stylesheet is injected
// by ucg-autofill.js at runtime and the panel only exists while it is open. So
// "0 unreadable" was true of the pages and told us nothing about the screen a
// clinician actually complained about.
//
//   node measure-panel-contrast.js
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
const PORT = 8930, ORIGIN = 'http://localhost:' + PORT;
const COMBOS = [['forest','dark'], ['midnight','dark'], ['dark','dark'], ['clay','dark'],
                ['forest','light'], ['clay','light']];

const MEASURE = () => {
  function parse(c){var m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return null;
    var p=m[1].split(',').map(function(x){return parseFloat(x)});
    return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
  function over(f,b){var a=f.a;return{r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a),a:1};}
  function rel(c){function ch(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
    return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b);}
  function ratio(a,b){var l1=rel(a),l2=rel(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
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
  function pathOf(el){var b=[];for(var n=el;n&&n.nodeType===1&&b.length<3;n=n.parentElement){
    b.unshift(n.tagName.toLowerCase()+(n.id?'#'+n.id:'')+
      (n.className&&typeof n.className==='string'&&n.className.trim()
        ?'.'+n.className.trim().split(/\s+/).slice(0,2).join('.'):''));}return b.join('>');}

  // ONLY inside the package panel — that is the screen being measured.
  var root = document.getElementById('ucgOverlay');
  if (!root) return { n: 0, bad: [], note: 'panel not open' };
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
    if(got<need)bad.push({where:pathOf(el),text:text.slice(0,34).replace(/\s+/g,' '),
                          fg:cs.color,ratio:Math.round(got*100)/100,need:need});
  }
  return {n:n,bad:bad};
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1400 } })).newPage();
  page.on('pageerror', () => {});
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

  const worst = new Map();
  let total = 0, opened = 0;
  for (const [skin, theme] of COMBOS) {
    await page.evaluate(([s,t]) => {
      localStorage.setItem('homatt_skin', s); localStorage.setItem('homatt_theme', t);
      // The package the photographs were of.
      localStorage.setItem('homatt_speak_handoff', JSON.stringify({
        at: Date.now(), heard: 'x', dx: 'Malaria', name: 'A B', sex: 'female',
        age: '30', ageUnit: 'years', chief: 'fever',
        subjective: 'fever for three days with headache', background: '',
        vitals: { temp: '39.1', pulse: '104', sbp: '110', dbp: '70', weight: '58' } }));
    }, [skin, theme]);
    await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
    await page.waitForTimeout(6500);
    await page.evaluate(([s,t]) => {
      document.documentElement.setAttribute('data-skin', s);
      document.documentElement.setAttribute('data-theme', t);
      // If it asked "which one?", take the first — the panel behind it is
      // the screen we are here to measure.
      const a = document.getElementById('ucgAsk');
      if (a && getComputedStyle(a).display !== 'none') {
        const first = document.querySelector('#ucgAskDiff [data-h]');
        if (first) first.click();
      }
    }, [skin, theme]);
    await page.waitForTimeout(2500);
    // Show every collapsed section, so the whole panel is measured.
    await page.evaluate(() => {
      document.querySelectorAll('#ucgOverlay details').forEach(d => { d.open = true; });
      document.querySelectorAll('#ucgOverlay [style*="display:none"], #ucgOverlay [style*="display: none"]')
        .forEach(e => { e.style.display = ''; });
    });
    await page.waitForTimeout(400);
    const res = await page.evaluate(MEASURE);
    if (res.note) { console.log('  [' + skin + '/' + theme + '] ' + res.note); continue; }
    opened++; total += res.n;
    res.bad.forEach(x => {
      const k = x.where + '|' + x.text;
      const prev = worst.get(k);
      if (!prev || x.ratio < prev.ratio) worst.set(k, Object.assign({}, x, { skin, theme }));
    });
  }

  const rows = [...worst.values()].sort((a,b) => a.ratio - b.ratio);
  console.log('\nthe one-tap package panel — can every word be read?\n');
  console.log('  panels opened : ' + opened + ' of ' + COMBOS.length);
  console.log('  text measured : ' + total);
  console.log('  unreadable    : ' + rows.length + '\n');
  rows.slice(0, 40).forEach(x => {
    console.log('  ' + String(x.ratio).padStart(5) + ':1  (needs ' + x.need + ')  [' + x.skin + '/' + x.theme + ']');
    console.log('           ' + x.where);
    console.log('           "' + x.text + '"   colour ' + x.fg);
  });
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
