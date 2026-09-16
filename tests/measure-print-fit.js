// Does the printed sheet actually fit the paper, and how many pages is it?
//
// A clinic photographed the preview on a phone with the medicines table cut
// off down the right-hand edge, and the period buttons — Today, This week,
// This month, This year — invisible. Both are things a number answers and an
// opinion does not.
//
// This prints the sheet to a REAL PDF through Chromium's own print pipeline,
// the same one the clinic's phone uses, and reports:
//
//   · how many pages each sheet comes to;
//   · every element that sticks out past the printable width, and by how much
//     — because the part that hangs off the edge is not clipped on paper, it
//     is simply gone;
//   · the contrast of every word INSIDE the paper, in all four skins and both
//     themes, because the sheet is always white and the app's palette is not.
//
// The last one is the trap that produced the invisible buttons: the paper is
// #fff whatever the clinic's theme is, so anything in it that takes a colour
// from `var(--text)` is white-on-white the moment somebody switches to dark.
//
//     node tests/measure-print-fit.js
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

const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT = 8969, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

// The patient from the photograph: six medicines, four intake times on one of
// them. That table is what ran off the edge.
const VISIT = {
  id: 'v1', patient_name: 'Emmanuel Ssali', patient_phone: '0778000111', patient_age: 34,
  confirmed_diagnosis: 'Acute Organophosphate Poisoning', severity: 'severe',
  patient_type: 'outpatient', clinician_name: 'DANIEL MUSINGUZI',
  clinical_findings: '', lab_tests_ordered: '',
  prescription_items: [
    { drug_name: 'Ciprofloxacin 500mg', strength: '500mg', frequency: '2x_daily', duration: 10, intakeTimes: ['08:00','20:00'] },
    { drug_name: 'Chloramphenicol 500mg', strength: '500mg', frequency: '4x_daily', duration: 10, intakeTimes: ['07:00','12:00','17:00','22:00'] },
    { drug_name: 'Ceftriaxone 1g', strength: '1g IV', frequency: '2x_daily', duration: 10, intakeTimes: ['08:00','20:00'] },
    { drug_name: 'Amoxicillin 1g', strength: '1g', frequency: '3x_daily', duration: 10, intakeTimes: ['08:00','14:00','20:00'] },
    { drug_name: 'Doxycycline 100mg', strength: '100mg', frequency: '2x_daily', duration: 5, intakeTimes: ['08:00','20:00'] },
    { drug_name: 'One single dose of 200mg', strength: '200mg', frequency: '2x_daily', duration: 5, intakeTimes: ['08:00','20:00'] },
  ],
  treatment_plan: 'Admit and observe. Atropine as needed.',
  patient_instructions: 'Return immediately if breathing becomes difficult.',
  follow_up_days: 7,
  consultation_fee_ugx: 10000, lab_fee_ugx: 20000, meds_fee_ugx: 65000,
  total_charged_ugx: 95000, amount_paid: 30000, payment_status: 'partial',
  created_at: new Date().toISOString(),
};
const HISTORY = Array.from({ length: 4 }, (_, i) => ({
  id: 'h' + i, confirmed_diagnosis: ['Malaria', 'Pertussis', 'Influenza', 'Peptic Ulcer Disease'][i],
  clinician_name: 'DANIEL MUSINGUZI', total_charged_ugx: 20000 + i * 5000, amount_paid: 20000,
  created_at: new Date(Date.now() - 86400000 * (30 + i * 20)).toISOString(),
}));

// A register big enough to need more than one page.
const ROWS = Array.from({ length: 34 }, (_, i) => ({
  id: 'r' + i,
  patient_name: ['Pulse Temp', 'Okello John', 'Ssali Emmanuel', 'Musoke Isham', 'Achieng Mary'][i % 5],
  patient_phone: '07880942' + String(10 + (i % 80)),
  confirmed_diagnosis: ['Influenza', 'Acute Organophosphate Poisoning', 'Pertussis', 'Malaria'][i % 4],
  severity: ['mild', 'moderate', 'severe'][i % 3],
  clinician_name: 'DANIEL MUSINGUZI',
  prescription_items: [{ drug_name: 'Amoxicillin' }, { drug_name: 'N/A' }],
  total_charged_ugx: 10000 + (i % 7) * 5000, amount_paid: 5000 + (i % 5) * 5000,
  payment_status: 'partial',
  created_at: new Date(Date.now() - 86400000 * (i % 15)).toISOString(),
}));

const SKINS = [['forest', 'light'], ['forest', 'dark'], ['dark', 'dark'], ['clay', 'light'], ['midnight', 'dark']];

// Contrast of every word inside a given root, compositing translucent layers.
const INK = (sel) => {
  function parse(c){var m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return null;
    var p=m[1].split(',').map(function(x){return parseFloat(x)});
    return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
  function over(f,b){var a=f.a;return{r:f.r*a+b.r*(1-a),g:f.g*a+b.g*(1-a),b:f.b*a+b.b*(1-a),a:1};}
  function rel(c){function ch(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
    return 0.2126*ch(c.r)+0.7152*ch(c.g)+0.0722*ch(c.b);}
  function ratio(a,b){var l1=rel(a),l2=rel(b);return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);}
  function bgOf(el){var stack=[],node=el;
    while(node&&node.nodeType===1){var cs=getComputedStyle(node);
      var c=parse(cs.backgroundColor);
      if(c&&c.a>0){stack.push(c);if(c.a>=0.999)break;}
      node=node.parentElement;}
    var base={r:255,g:255,b:255,a:1},last=stack[stack.length-1];
    if(last&&last.a>=0.999){base=last;stack.pop();}
    for(var i=stack.length-1;i>=0;i--)base=over(stack[i],base);
    return base;}
  function ownText(el){var t='';for(var i=0;i<el.childNodes.length;i++)
    if(el.childNodes[i].nodeType===3)t+=el.childNodes[i].nodeValue;return t.trim();}
  var root=document.querySelector(sel); if(!root) return {n:0,bad:['no root']};
  var bad=[],n=0,all=root.querySelectorAll('*');
  for(var i=0;i<all.length;i++){var el=all[i],text=ownText(el);
    if(!text||text.length<2)continue;
    var cs=getComputedStyle(el);
    if(cs.display==='none'||cs.visibility==='hidden')continue;
    var r=el.getBoundingClientRect(); if(r.width<4||r.height<4)continue;
    var fg=parse(cs.color); if(!fg)continue;
    var bg=bgOf(el); if(fg.a<1)fg=over(fg,bg);
    var size=parseFloat(cs.fontSize)||14,weight=parseInt(cs.fontWeight,10)||400;
    var need=(size>=24||(size>=18.66&&weight>=700))?3:4.5;
    var got=ratio(fg,bg); n++;
    if(got<need)bad.push(text.slice(0,24).replace(/\s+/g,' ')+' ('+Math.round(got*100)/100+':1)');
  }
  return {n:n,bad:bad};
};

// Anything sticking out past the paper's content box, in print media.
const OVERFLOW = () => {
  const root = document.getElementById('hmPrintRoot');
  if (!root) return { w: 0, out: [] };
  const rw = root.getBoundingClientRect().width;
  const out = [];
  root.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2) return;
    const over = Math.round(r.right - (root.getBoundingClientRect().left + rw));
    if (over > 1) out.push((el.tagName + (el.className ? '.' + String(el.className).split(' ')[0] : '')) + ' +' + over + 'px');
  });
  return { w: Math.round(rw), scrollW: Math.round(root.scrollWidth), out: out.slice(0, 8) };
};

function pdfPages(buf) {
  // Count page objects. Good enough and needs no parser.
  const s = Buffer.from(buf).toString('latin1');
  const m = s.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : 0;
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'DANIEL MUSINGUZI', clinicName: 'family clinic',
      clinicId: cid, staffRole: 'owner', level: 'HC III' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
  }, [CID, UID]);
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  const SHEETS = [
    { name: 'one patient, 6 medicines + 4 past visits',
      open: (v, h) => { window.HomattPrint.patient(v, h); }, args: [VISIT, HISTORY] },
    { name: 'the register, 34 patients',
      open: (rows) => {
        const html = window.HomattPrint._periodSheet(rows, 'month');
        document.getElementById('hmPrintRoot').innerHTML = html;
        document.getElementById('hmPrintPaper').innerHTML = html;
        document.getElementById('hmPrintWrap').className = 'hm-noprint on';
      }, args: [ROWS] },
  ];

  console.log('');
  console.log('  Does the printed sheet fit the paper?');
  console.log('  ' + '='.repeat(72));

  for (const s of SHEETS) {
    await page.evaluate(s.open, s.args.length === 1 ? s.args[0] : s.args[0]);
    if (s.args.length === 2) await page.evaluate(([v, h]) => window.HomattPrint.patient(v, h), s.args);
    await page.waitForTimeout(400);

    /* ── on paper ──────────────────────────────────────────────────────
     *
     * MEASURED AT THE PAPER'S WIDTH, not the phone's. Chromium lays a print
     * out at 96dpi: A4 is 210mm = 794px, and 12mm margins leave 186mm = 704px
     * of content. The first version of this file measured the DOM at the
     * 412px phone viewport with print media switched on, which is a different
     * layout entirely — it would have reported a table as overflowing the
     * paper when it fits an A4 perfectly well, and sent the fix off in the
     * wrong direction. */
    const A4_CONTENT = 704;
    await page.setViewportSize({ width: A4_CONTENT, height: 1000 });
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.body.classList.add('hm-printing'));
    await page.waitForTimeout(250);
    const over = await page.evaluate(OVERFLOW);
    const pdf = await page.pdf({ format: 'A4', printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
    const pages = pdfPages(pdf);
    await page.evaluate(() => document.body.classList.remove('hm-printing'));
    await page.emulateMedia({ media: 'screen' });
    await page.setViewportSize({ width: 412, height: 915 });   // back to the phone
    await page.waitForTimeout(200);

    console.log('');
    console.log('  ' + s.name);
    console.log('    A4 pages                 ' + pages);
    console.log('    A4 width used            ' + over.w + 'px of 704  (content needs ' + over.scrollW + 'px)');
    console.log('    hangs off the edge       ' + (over.out.length ? over.out.length + ' element(s)' : 'nothing') +
      (over.out.length ? '  — ' + over.out.join(', ') : ''));

    // ── on a phone, in the preview ────────────────────────────────────
    const prev = await page.evaluate(() => {
      const paper = document.getElementById('hmPrintPaper');
      const scroll = document.getElementById('hmPrintScroll');
      if (!paper) return null;
      // getBoundingClientRect reports the SCALED width; scrollWidth is the
      // unscaled layout. The ratio is the scale actually applied.
      return { paperW: Math.round(paper.getBoundingClientRect().width),
               needs: Math.round(paper.scrollWidth),
               viewW: Math.round(scroll.clientWidth),
               sideways: Math.round(scroll.scrollWidth - scroll.clientWidth) };
    });
    const scale = prev.needs ? (prev.paperW / prev.needs) : 1;
    console.log('    phone preview            the real ' + prev.needs + 'px page, shown at ' +
      Math.round(scale * 100) + '% (' + prev.paperW + 'px) in ' + prev.viewW + 'px' +
      (prev.sideways > 1 ? '  — SCROLLS SIDEWAYS by ' + prev.sideways + 'px' : '  — fits'));

    // ── readable, in every skin ───────────────────────────────────────
    let worst = [];
    for (const [skin, theme] of SKINS) {
      await page.evaluate(([sk, th]) => {
        document.documentElement.setAttribute('data-skin', sk);
        document.documentElement.setAttribute('data-theme', th);
      }, [skin, theme]);
      await page.waitForTimeout(120);
      const r = await page.evaluate(INK, '#hmPrintPaper');
      if (r.bad.length) worst.push(skin + '/' + theme + ': ' + r.bad.length + ' — ' + r.bad.slice(0, 3).join(' · '));
    }
    console.log('    unreadable in the paper  ' + (worst.length ? worst.join('  |  ') : 'none, in any of ' + SKINS.length + ' skins'));
  }

  // ── the period picker, which is what the clinic photographed ────────
  await page.evaluate(() => {
    window.HomattPrint.close();
    window.HomattPrint.askPeriod(async () => []);
  });
  await page.waitForTimeout(400);
  console.log('');
  console.log('  the period picker (Today / This week / This month / This year)');
  for (const [skin, theme] of SKINS) {
    await page.evaluate(([sk, th]) => {
      document.documentElement.setAttribute('data-skin', sk);
      document.documentElement.setAttribute('data-theme', th);
    }, [skin, theme]);
    await page.waitForTimeout(120);
    const r = await page.evaluate(INK, '#hmPrintPaper');
    console.log('    ' + (skin + '/' + theme).padEnd(16) +
      (r.bad.length ? 'UNREADABLE: ' + r.bad.join(' · ') : r.n + ' checked, all readable'));
  }
  console.log('');

  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
