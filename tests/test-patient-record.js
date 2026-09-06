// The patient record sheet — readable, in every theme, in every state.
//
// The bug this guards: the sheet was built from inline styles with light-mode
// colours, and dark mode patched them by matching those colours as SUBSTRINGS
// of the style attribute. Only listed colours were caught, so a cream card kept
// its cream while the grey text on it was rewritten for dark — 1.43:1, and the
// clinician could not read what the patient had been billed.
//
// So contrast is MEASURED here, in all four skins in both themes, rather than
// eyeballed once.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server = http.createServer((rq,rs)=>{let p=decodeURIComponent(rq.url.split('?')[0]);if(p.endsWith('/'))p+='index.html';fs.readFile(path.join(ROOT,p),(e,d)=>{if(e){rs.writeHead(404);rs.end('nf');return;}rs.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'application/octet-stream'});rs.end(d);});});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co', ORIGIN='http://localhost:9063';
const result = (n, ok, x) => console.log((ok?'PASS':'FAIL') + '  ' + n + (x ? '  — ' + x : ''));

const BASE = {
  id:'33333333-3333-4333-8333-333333333333', case_code:'#001U3008O',
  patient_name:'Jackline marcy', patient_phone:'0788963323',
  created_at:'2026-08-30T21:43:00Z', confirmed_diagnosis:'Uncomplicated Malaria',
  severity:'mild', patient_type:'outpatient',
  total_charged_ugx:60000, amount_paid:0, payment_status:'pending',
  follow_up_days:7, follow_up_reason:'',
  prescription_items:[
    {drug_name:'artemether/lumefantrine 20/120mg',strength:'20/120mg',frequency:'2x/day',duration:5,quantity:20},
    {drug_name:'artesunate 50mg',strength:'50mg',frequency:'1x/day',duration:5,quantity:5},
    {drug_name:'amodiaquine 153mg',strength:'153mg',frequency:'2x/day',duration:5,quantity:10},
    {drug_name:'quinine tablets 300mg',strength:'300mg',frequency:'2x/day',duration:5,quantity:10},
    {drug_name:'paracetamol 1g',strength:'1g',frequency:'4x/day',duration:5,quantity:20},
    {drug_name:'sodium bicarbonate 8.4%',strength:'8.4%',frequency:'',duration:0,quantity:1},
  ],
};
const PAST = [
  {id:'p1',created_at:'2026-08-18T10:00:00Z',confirmed_diagnosis:'Upper respiratory tract infection',total_charged_ugx:20000,payment_status:'paid',prescription_items:[{drug_name:'Amoxicillin 500mg'}]},
  {id:'p2',created_at:'2026-07-02T14:30:00Z',confirmed_diagnosis:'Peptic ulcer disease',total_charged_ugx:35000,payment_status:'pending',prescription_items:[{drug_name:'Omeprazole 20mg'},{drug_name:'Antacid'}]},
];
// The states a real clinic produces, not just the happy one.
const STATES = {
  owing:    BASE,
  settled:  Object.assign({}, BASE, { amount_paid:60000, payment_status:'paid' }),
  overdue:  Object.assign({}, BASE, { created_at:'2026-07-01T09:00:00Z', follow_up_days:3 }),
  noReturn: Object.assign({}, BASE, { follow_up_days:0 }),
  noMeds:   Object.assign({}, BASE, { prescription_items:[] }),
  longDx:   Object.assign({}, BASE, { confirmed_diagnosis:'Complicated/Severe Malaria with cerebral involvement and severe anaemia', severity:'critical' }),
  free:     Object.assign({}, BASE, { total_charged_ugx:0, amount_paid:0 }),
};

const AUDIT = `(() => {
  function rgb(s){const m=/rgba?\\(([^)]+)\\)/.exec(s);if(!m)return null;
    const p=m[1].split(',').map(Number);return{r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]};}
  function lum(c){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}
  function bgOf(el){let n=el;while(n&&n!==document.documentElement){
    const c=rgb(getComputedStyle(n).backgroundColor);if(c&&c.a>0.5)return c;n=n.parentElement;}
    return {r:255,g:255,b:255,a:1};}
  const body=document.getElementById('histModalBody');
  const low=[];
  body.querySelectorAll('*').forEach(el=>{
    const t=(el.textContent||'').trim();
    if(!t||el.children.length)return;
    if(getComputedStyle(el).visibility==='hidden'||!el.getClientRects().length)return;
    const fg=rgb(getComputedStyle(el).color);if(!fg)return;
    const bg=bgOf(el);const L1=lum(fg),L2=lum(bg);
    const r=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
    if(r<4.5)low.push({text:t.slice(0,40),ratio:Math.round(r*100)/100});
  });
  const box=body.getBoundingClientRect();const over=[];
  body.querySelectorAll('*').forEach(el=>{const r=el.getBoundingClientRect();
    if(r.width&&(r.right>box.right+1||r.left<box.left-1))
      over.push({text:(el.textContent||'').trim().slice(0,30),spill:Math.round(Math.max(r.right-box.right,box.left-r.left))});});
  return {low, over: over.slice(0,4)};
})()`;

const BASE_FOR_PAGE = BASE, PAST_FOR_PAGE = PAST;

// Three patients whose names all start "Emmanuel", one of them with three
// visits — the shape of the record in the report.
const SEARCH_ROWS = [
  {id:'a1',patient_name:'Emmanuel ssail',patient_phone:'0778963596',confirmed_diagnosis:'Typhoid fever',severity:'moderate',patient_type:'outpatient',created_at:'2026-08-20T09:00:00Z',total_charged_ugx:30000,amount_paid:30000,payment_status:'paid',prescription_items:[{drug_name:'Ciprofloxacin 500mg',frequency:'2x/day',duration:7,quantity:14}]},
  {id:'b1',patient_name:'emmanuel okol',patient_phone:'0788099425',confirmed_diagnosis:'',severity:'moderate',patient_type:'outpatient',created_at:'2026-08-11T09:00:00Z',clinician_name:'DANIEL MUSINGUZI',clinical_findings:'Negative for all the tests',lab_tests_ordered:'B/P, CRP, Full Blood Count (FBC), BP Measurement',consultation_fee_ugx:2000,lab_fee_ugx:4000,total_charged_ugx:6000,amount_paid:0,payment_status:'pending',prescription_items:[{drug_name:'N/A',frequency:'1x/day',duration:1}]},
  {id:'b2',patient_name:'emmanuel okol',patient_phone:'0788099425',confirmed_diagnosis:'Wounds',severity:'moderate',patient_type:'outpatient',created_at:'2026-07-27T00:13:00Z',total_charged_ugx:12000,amount_paid:12000,payment_status:'paid',prescription_items:[{drug_name:'Amoxicillin 500mg',frequency:'3x/day',duration:1,quantity:3}]},
  {id:'b3',patient_name:'emmanuel okol',patient_phone:'0788099425',confirmed_diagnosis:'Malaria',severity:'mild',patient_type:'outpatient',created_at:'2026-06-02T09:00:00Z',total_charged_ugx:15000,amount_paid:15000,payment_status:'paid',prescription_items:[{drug_name:'artemether/lumefantrine 20/120mg',frequency:'2x/day',duration:3,quantity:12}]},
  {id:'c1',patient_name:'Emmanuel Kato',patient_phone:'0700111222',confirmed_diagnosis:'Malaria',severity:'mild',patient_type:'outpatient',created_at:'2026-06-02T09:00:00Z',total_charged_ugx:15000,amount_paid:0,payment_status:'pending',prescription_items:[]},
];

(async () => {
  await new Promise(r => server.listen(9063, r));
  const b = await chromium.launch({ executablePath:CHROME, args:['--no-sandbox'] });
  const errs = [];

  async function open(page, visit, past) {
    await page.evaluate(([v, h]) => {
      _activeRows = [v];
      _activeDetailContext = { current: v, history: h };
      const m = document.getElementById('histModal');
      m.style.display = 'flex';
      document.getElementById('histModalName').textContent = v.case_code;
      document.getElementById('histModalMeta').innerHTML =
        '<strong>' + v.patient_name + '</strong> · ' + v.patient_phone;
      renderActiveDetailView();
    }, [visit, past]);
    await page.waitForTimeout(250);
  }

  async function boot(skin, theme) {
    const page = await (await b.newContext({ viewport:{width:412,height:915}, deviceScaleFactor:2, serviceWorkers:'block' })).newPage();
    page.on('pageerror', e => errs.push(skin+'/'+theme+': '+e.message.split('\n')[0]));
    await page.route('**/*', r => {
      const u = r.request().url();
      if (u.startsWith(ORIGIN)) return r.continue();
      if (u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
      return r.abort();
    });
    await page.goto(ORIGIN + '/clinic/index.html');
    await page.evaluate(([cid,uid,th,sk]) => {
      localStorage.clear();
      localStorage.setItem('homatt_theme', th);
      localStorage.setItem('homatt_skin', sk);
      localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
      localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
    }, [CID, UID, theme, skin]);
    await page.goto(ORIGIN + '/clinic/dashboard.html');
    await page.waitForTimeout(2200);
    return page;
  }

  // ── 1. Readable in every skin, in both themes ───────────────────────────
  const bad = [];
  for (const skin of ['forest','midnight','dark','clay']) {
    for (const theme of ['light','dark']) {
      const page = await boot(skin, theme);
      await open(page, BASE, PAST);
      const a = await page.evaluate(AUDIT);
      if (a.low.length) bad.push(skin+'/'+theme+': '+a.low.map(x=>x.ratio+':1 "'+x.text+'"').join(', '));
      if (a.over.length) bad.push(skin+'/'+theme+' OVERFLOW: '+JSON.stringify(a.over));
      await page.close();
    }
  }
  result('every word is readable in all four skins, light and dark',
    bad.length === 0, bad.length ? bad[0].slice(0,150) : '8 combinations, nothing under 4.5:1');

  // ── 2. Every state a clinic actually produces ───────────────────────────
  const page = await boot('forest', 'dark');
  const stateBad = [];
  for (const [name, visit] of Object.entries(STATES)) {
    await open(page, visit, name === 'noMeds' ? [] : PAST);
    const a = await page.evaluate(AUDIT);
    if (a.low.length) stateBad.push(name + ': ' + a.low.map(x=>x.ratio+':1 "'+x.text+'"').join(', '));
    if (a.over.length) stateBad.push(name + ' OVERFLOW: ' + JSON.stringify(a.over));
  }
  result('and in every state — owing, settled, overdue, no return, no medicines',
    stateBad.length === 0, stateBad.length ? stateBad[0].slice(0,150) : Object.keys(STATES).length + ' states');

  // ── 3. The things the clinician came to see ─────────────────────────────
  await open(page, BASE, PAST);
  const shape = await page.evaluate(() => {
    const body = document.getElementById('histModalBody');
    const y = s => { const e = body.querySelector(s); return e ? e.getBoundingClientRect().top : 1e9; };
    const tiles = [...body.querySelectorAll('.pr-tile')];
    return {
      dx: (body.querySelector('.pr-hero-dx')||{}).textContent || '',
      dxY: y('.pr-hero-dx'), stripY: y('.pr-strip'), medsY: y('.pr-sec'), pastY: y('.pr-past'),
      tiles: tiles.map(t => (t.querySelector('.pr-tile-k')||{}).textContent || ''),
      owedValue: (body.querySelector('.pr-tile.owe .pr-tile-v')||{}).textContent || '',
      // the figure must never wrap — it used to break across two lines
      owedLines: (() => { const e = body.querySelector('.pr-tile.owe .pr-tile-v');
        return e ? Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) : 0; })(),
      meds: body.querySelectorAll('.pr-med').length,
      pastOpen: !!(body.querySelector('.pr-past') || {}).open,
      payBtn: !!body.querySelector('[data-action="record-payment"]'),
      scrollH: body.scrollHeight, clientH: body.clientHeight,
    };
  });
  result('the diagnosis is the headline, above everything else',
    /Uncomplicated Malaria/.test(shape.dx) && shape.dxY < shape.stripY, shape.dx);
  result('what needs doing — money and the return date — comes next, side by side',
    shape.tiles.length === 2 && /OWED/i.test(shape.tiles[0]) && /BACK/i.test(shape.tiles[1]) &&
    shape.stripY < shape.medsY, JSON.stringify(shape.tiles));
  result('the amount owed is on one line, not broken in half',
    shape.owedLines === 1 && /60,000/.test(shape.owedValue),
    shape.owedValue + ' on ' + shape.owedLines + ' line(s)');
  result('the payment shortcut is still there and still wired',
    shape.payBtn);
  result('all six medicines are listed, each on its own row',
    shape.meds === 6, shape.meds + ' rows');
  result('previous visits are folded away, below the current one',
    shape.pastY > shape.medsY && shape.pastOpen === false);
  result('the whole record fits without scrolling on a 412x915 phone',
    shape.scrollH <= shape.clientH + 2, shape.scrollH + 'px in ' + shape.clientH + 'px');

  // ── 4. The fold opens ───────────────────────────────────────────────────
  const opened = await page.evaluate(() => {
    const d = document.getElementById('histModalBody').querySelector('.pr-past');
    d.open = true;
    return d.querySelectorAll('.pr-row').length;
  });
  result('opening previous visits shows them', opened === 2, opened + ' visits');

  // ── 5. No colour is written into the markup any more ────────────────────
  const inline = await page.evaluate(() => {
    const body = document.getElementById('histModalBody');
    const hits = [];
    body.querySelectorAll('[style]').forEach(el => {
      const s = el.getAttribute('style') || '';
      if (/#[0-9a-f]{3,8}\b|rgba?\(/i.test(s)) hits.push(s.slice(0, 60));
    });
    return hits;
  });
  result('no hard-coded colour survives in the markup, so the theme governs it',
    inline.length === 0, inline.length ? inline[0] : 'none');


  // ── 6. The OTHER way into the same sheet ────────────────────────────────
  // openHistModal (from the patient-history search) renders into the same
  // #histModalBody with a different function. It was still drawing itself with
  // hard-coded colours, so the same record was legible from one entry point and
  // not from the other.
  const viaSearch = [];
  for (const theme of ['light','dark']) {
    const pg = await boot('forest', theme);
    const ok = await pg.evaluate(([rec, past]) => {
      window._histGroups = { g1: { name:'Jackline marcy', phone:'0788963323',
                                   records: [rec].concat(past) } };
      openHistModal('g1');
      return document.querySelectorAll('#histModalBody .pr-visit').length;
    }, [BASE_FOR_PAGE, PAST_FOR_PAGE]);
    const a = await pg.evaluate(AUDIT);
    if (!ok) viaSearch.push(theme + ': rendered no visit cards');
    if (a.low.length) viaSearch.push(theme + ': ' + a.low.map(x=>x.ratio+':1 "'+x.text+'"').join(', '));
    if (a.over.length) viaSearch.push(theme + ' OVERFLOW: ' + JSON.stringify(a.over));
    await pg.close();
  }
  result('the same record opened from the history search is just as readable',
    viaSearch.length === 0, viaSearch.length ? viaSearch[0].slice(0,150) : 'light and dark, 3 visits');


  // ── 7. Finding a patient, and finding a visit ───────────────────────────
  const search = await boot('forest','dark');
  await search.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    if (u.startsWith(SB)) {
      const H = {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'};
      if (/clinic_diagnoses/.test(u)) return r.fulfill({status:200,headers:H,body:JSON.stringify(SEARCH_ROWS)});
      return r.fulfill({status:200,headers:H,body:'[]'});
    }
    return r.abort();
  });

  const typed = await search.evaluate(async () => {
    // Show the Patients slide the way a clinician does, so the rows have a
    // real height to measure rather than being display:none.
    const tab = [...document.querySelectorAll('.slide-tab')].find(b=>/patie/i.test(b.textContent));
    if (tab) tab.click();
    await new Promise(r => setTimeout(r, 400));
    const inp = document.getElementById('histSearchInput');
    inp.value = 'emmanuel';
    // typing alone must find them — no button press
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 1400));
    const res = document.getElementById('histResults');
    const rows = [...res.querySelectorAll('.ph-row')];
    return { n: rows.length,
             h: rows.map(r => Math.round(r.getBoundingClientRect().height)),
             align: rows.length ? getComputedStyle(rows[0]).textAlign : '',
             count: (res.querySelector('.ph-count')||{}).textContent || '' };
  });
  result('typing a name finds the patient — no button press',
    typed.n === 3, typed.n + ' rows, ' + typed.count.trim());
  result('a patient is two tidy lines, not a card the size of the screen',
    typed.h.every(h => h <= 72) && typed.align === 'left',
    'row heights ' + JSON.stringify(typed.h) + ', aligned ' + typed.align);

  // Inside one patient's record: find the visit, not scroll for it.
  const inside = await search.evaluate(async () => {
    // the one with three visits, not the one with one
    const row = [...document.querySelectorAll('#histResults .ph-row')]
      .find(r => /okol/i.test(r.textContent));
    row.click();
    await new Promise(r => setTimeout(r, 500));
    const body = document.getElementById('histModalBody');
    const all = body.querySelectorAll('.ph-visit').length;
    const fi = document.getElementById('histVisitFilter');
    if (!fi) return { all, filter: false };
    fi.value = 'wounds';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const shown = [...body.querySelectorAll('.ph-visit')].filter(e => e.style.display !== 'none').length;
    fi.value = 'zzzz';
    fi.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    const none = document.getElementById('histVisitNone');
    const noneShown = none && none.style.display !== 'none';
    document.getElementById('histVisitClear').click();
    await new Promise(r => setTimeout(r, 120));
    const back = [...body.querySelectorAll('.ph-visit')].filter(e => e.style.display !== 'none').length;
    return { all, filter: true, shown, noneShown, back };
  });
  result('a patient with several visits can be searched through',
    inside.filter && inside.all === 3 && inside.shown === 1,
    inside.all + ' visits, "wounds" -> ' + inside.shown);
  result('a search that matches nothing says so, and Clear brings them back',
    inside.noneShown === true && inside.back === inside.all,
    'none shown: ' + inside.noneShown + ', after clear: ' + inside.back);

  // "N/A" is a placeholder, not a drug.
  const na = await search.evaluate(() => {
    const body = document.getElementById('histModalBody');
    return { rows: body.querySelectorAll('.pr-med').length,
             text: body.textContent.replace(/\s+/g,' ') };
  });
  result('a placeholder medicine is not shown as a prescription',
    !/N\/A 1x\/day/.test(na.text), na.rows + ' medicine rows shown');

  await search.close();


  // ── 8. Record Payment ───────────────────────────────────────────────────
  // The same fault, one modal along: a cream summary card whose colour was not
  // on the dark-mode substring list, carrying text whose colours were. The
  // patient's name and the amount owed measured 1.09:1 — white on cream.
  const payBad = [];
  const PAY_AUDIT = AUDIT.replace("getElementById('histModalBody')", "getElementById('paymentModal')");
  for (const skin of ['forest','midnight','dark','clay']) {
    for (const theme of ['light','dark']) {
      const pg = await boot(skin, theme);
      await pg.evaluate(() => openPaymentModal('d1','Jackline marcy',60000,0,60000));
      await pg.waitForTimeout(250);
      const a = await pg.evaluate(PAY_AUDIT);
      if (a.low.length) payBad.push(skin+'/'+theme+': '+a.low.map(x=>x.ratio+':1 "'+x.text+'"').join(', '));
      await pg.close();
    }
  }
  result('the payment sheet is readable in all four skins, light and dark',
    payBad.length === 0, payBad.length ? payBad[0].slice(0,150) : '8 combinations');

  const pay = await boot('forest','dark');
  const paid = await pay.evaluate(async () => {
    openPaymentModal('d1','Jackline marcy',60000,20000,40000);
    await new Promise(r => setTimeout(r, 200));
    const t = id => (document.getElementById(id)||{}).textContent || '';
    const before = { who:t('pmPatientName'), total:t('pmTotal'), paid:t('pmPaid'), bal:t('pmBalance') };
    // the two shortcuts must still put the right number in the box
    setPmQuickAmount('full');
    const full = document.getElementById('pmAmount').value;
    setPmQuickAmount('half');
    const half = document.getElementById('pmAmount').value;
    // and an error must be visible when it is shown
    const err = document.getElementById('pmError');
    err.textContent = 'Enter an amount.'; err.style.display = 'block';
    const errVisible = err.getClientRects().length > 0;
    return { before, full, half, errVisible };
  });
  result('the bill, what is paid and what is owed all say their figure',
    /Jackline/.test(paid.before.who) && /60,000/.test(paid.before.total) &&
    /20,000/.test(paid.before.paid) && /40,000/.test(paid.before.bal),
    JSON.stringify(paid.before));
  result('Half and Full balance still fill in the right amount',
    paid.full === '40000' && paid.half === '20000',
    'full=' + paid.full + ' half=' + paid.half);
  result('an error message is actually shown', paid.errVisible === true);

  const payInline = await pay.evaluate(() => {
    const hits = [];
    document.querySelectorAll('#paymentModal [style]').forEach(el => {
      const st = el.getAttribute('style') || '';
      if (/#[0-9a-f]{3,8}\b/i.test(st)) hits.push(st.slice(0, 60));
    });
    return hits;
  });
  result('no hard-coded colour is left in the payment markup',
    payInline.length === 0, payInline.length ? payInline[0] : 'none');
  await pay.close();

  result('no page errors', errs.length === 0, errs.slice(0,3).join(' | '));
  await page.close(); await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
