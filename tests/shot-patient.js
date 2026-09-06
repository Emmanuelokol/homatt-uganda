// The patient record modal, in both themes, on a phone.
//
// Reproduces the screen from the bug report: an active malaria visit with an
// outstanding balance, a return visit due, and a long medication list.
//   node shot-patient.js <tag>
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = APP;
const TAG = process.argv[2] || 'now';
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server = http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9062';

// The visit from the report, as the database would hand it over.
const VISIT = {
  id: '33333333-3333-4333-8333-333333333333',
  case_code: '#001U3008O',
  patient_name: 'Jackline marcy',
  patient_phone: '0788963323',
  created_at: '2026-08-30T21:43:00Z',
  confirmed_diagnosis: 'Uncomplicated Malaria',
  severity: 'mild',
  patient_type: 'outpatient',
  total_charged_ugx: 60000,
  amount_paid: 0,
  payment_status: 'pending',
  follow_up_days: 7,
  follow_up_reason: '',
  prescription_items: [
    { drug_name:'artemether/lumefantrine 20/120mg', strength:'20/120mg', frequency:'2x/day', duration:5, quantity:20 },
    { drug_name:'artesunate 50mg', strength:'50mg', frequency:'1x/day', duration:5, quantity:5 },
    { drug_name:'amodiaquine 153mg', strength:'153mg', frequency:'2x/day', duration:5, quantity:10 },
    { drug_name:'quinine tablets 300mg', strength:'300mg', frequency:'2x/day', duration:5, quantity:10 },
    { drug_name:'paracetamol 1g', strength:'1g', frequency:'4x/day', duration:5, quantity:20 },
    { drug_name:'sodium bicarbonate 8.4%', strength:'8.4%', frequency:'', duration:0, quantity:1 },
  ],
};
const PAST = [
  { id:'p1', created_at:'2026-08-18T10:00:00Z', confirmed_diagnosis:'Upper respiratory tract infection',
    total_charged_ugx:20000, payment_status:'paid', prescription_items:[{drug_name:'Amoxicillin 500mg'}] },
  { id:'p2', created_at:'2026-07-02T14:30:00Z', confirmed_diagnosis:'Peptic ulcer disease',
    total_charged_ugx:35000, payment_status:'pending', prescription_items:[{drug_name:'Omeprazole 20mg'},{drug_name:'Antacid'}] },
];

(async () => {
  await new Promise(r => server.listen(9062, r));
  const b = await chromium.launch({ executablePath:CHROME, args:['--no-sandbox'] });
  const errs = [];

  for (const theme of ['dark', 'light']) {
    const page = await (await b.newContext({ viewport:{width:412,height:915}, deviceScaleFactor:2, serviceWorkers:'block' })).newPage();
    page.on('pageerror', e => errs.push(theme + ': ' + e.message.split('\n')[0]));
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({ status:200, headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body:'[]' });
      return r.abort();
    });
    await page.goto(ORIGIN + '/clinic/index.html');
    await page.evaluate(([cid, uid, th]) => {
      localStorage.clear();
      localStorage.setItem('homatt_theme', th);
      localStorage.setItem('clinic_session', JSON.stringify({ staffName:'D', clinicName:'Kampala Clinic', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
      localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token:'t', refresh_token:'r', token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{id:uid} }));
    }, [CID, UID, theme]);
    await page.goto(ORIGIN + '/clinic/dashboard.html');
    await page.waitForTimeout(2500);

    await page.evaluate(([visit, past]) => {
      _activeRows = [visit];
      _activeDetailContext = { current: visit, history: past };
      const m = document.getElementById('histModal');
      m.style.display = 'flex';
      document.getElementById('histModalName').textContent = visit.case_code;
      document.getElementById('histModalMeta').innerHTML =
        '<strong>' + visit.patient_name + '</strong> · ' + visit.patient_phone;
      renderActiveDetailView();
    }, [VISIT, PAST]);
    await page.waitForTimeout(700);

    await page.screenshot({ path: `pd-${theme}-${TAG}-top.png` });

    // and the medication list further down
    await page.evaluate(() => {
      const el = document.getElementById('histModalBody');
      el.scrollTop = Math.round(el.scrollHeight * 0.42);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `pd-${theme}-${TAG}-meds.png` });

    // Measure what the eye is complaining about: contrast, and overflow.
    const audit = await page.evaluate(() => {
      function rgb(s){ const m=/rgba?\(([^)]+)\)/.exec(s); if(!m) return null;
        const p=m[1].split(',').map(Number); return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]}; }
      function lum(c){ const f=v=>{v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4);};
        return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); }
      function bgOf(el){ let n=el; while(n && n!==document.documentElement){
        const c=rgb(getComputedStyle(n).backgroundColor); if(c&&c.a>0.5) return c; n=n.parentElement; } return {r:255,g:255,b:255,a:1}; }
      const body = document.getElementById('histModalBody');
      const out = [];
      body.querySelectorAll('*').forEach(el => {
        const t = (el.textContent||'').trim();
        if (!t || el.children.length) return;
        const fg = rgb(getComputedStyle(el).color); if (!fg) return;
        const bg = bgOf(el);
        const L1 = lum(fg), L2 = lum(bg);
        const ratio = (Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
        if (ratio < 4.5) out.push({ text: t.slice(0,44), ratio: Math.round(ratio*100)/100 });
      });
      // anything sticking out of the modal horizontally
      const box = body.getBoundingClientRect();
      const over = [];
      body.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) {
          over.push({ text: (el.textContent||'').trim().slice(0,34),
                      spill: Math.round(Math.max(r.right-box.right, box.left-r.left)) });
        }
      });
      return { low: out, over: over.slice(0, 6), scrollH: body.scrollHeight, clientH: body.clientHeight };
    });
    console.log('── ' + theme + ' ──');
    console.log('  text below 4.5:1 contrast : ' + audit.low.length);
    audit.low.slice(0, 8).forEach(x => console.log('     ' + x.ratio + ':1  "' + x.text + '"'));
    console.log('  elements overflowing      : ' + audit.over.length);
    audit.over.forEach(x => console.log('     +' + x.spill + 'px  "' + x.text + '"'));
    console.log('  body scroll ' + audit.scrollH + 'px in a ' + audit.clientH + 'px window');
    await page.close();
  }
  if (errs.length) console.log('PAGE ERRORS: ' + errs.join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
