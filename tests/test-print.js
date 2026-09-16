// Printing a patient, and printing a period.
//
// Two things a clinic asks a printer for: one patient in full (the sheet that
// goes in a paper file or travels with a referral), and a register for a day,
// week, month or year with the money on it.
//
// What this has to prove, beyond "a button exists":
//
//   · The sheet carries EVERYTHING. Whoever reads it next cannot tap anything,
//     so a detail missing from the paper is a detail lost.
//   · `@media print` really hides the app. If it does not, a clinic prints the
//     dashboard — navigation, cards and all — over the record.
//   · It is BLACK ON WHITE whatever skin the clinic uses. This is the one
//     surface where the app's colour tokens are wrong: a clinic on the dark
//     skin would otherwise print white on white and get blank paper.
//   · The period boundary is LOCAL midnight, not UTC. Kampala is UTC+3, so a
//     UTC "today" silently drops the first three hours of the clinic's day.
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
const PORT = 8960, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

const VISIT = {
  id: 'v-print-1', patient_name: 'Nakato Sarah', patient_phone: '0772004455',
  patient_age: 29, confirmed_diagnosis: 'Uncomplicated Malaria', severity: 'moderate',
  patient_type: 'outpatient', clinician_name: 'DR OKELLO JOHN',
  clinical_findings: 'Temp 38.9, fever 3 days, no chest signs.',
  lab_tests_ordered: 'Malaria RDT, Full Blood Count',
  lab_results: 'RDT positive for P. falciparum',
  prescription_items: [
    { drug_name: 'Artemether/Lumefantrine 20/120mg', strength: '4 tabs', frequency: '2x_daily', duration: 3 },
    { drug_name: 'Paracetamol 500mg', strength: '1g', frequency: '3x_daily', duration: 3 },
    { drug_name: 'N/A', frequency: '1x/day', duration: 1 },
  ],
  treatment_plan: 'Complete the full course. Return if fever persists past 48 hours.',
  patient_instructions: 'Take with food. Plenty of fluids.',
  follow_up_days: 3, follow_up_reason: 'Check the fever has settled',
  consultation_fee_ugx: 5000, lab_fee_ugx: 10000, meds_fee_ugx: 15000,
  total_charged_ugx: 30000, amount_paid: 20000, payment_status: 'partial',
  created_at: new Date().toISOString(),
};
const HISTORY = [
  { id: 'old1', confirmed_diagnosis: 'Peptic Ulcer Disease', clinician_name: 'DR A',
    total_charged_ugx: 12000, amount_paid: 12000,
    created_at: new Date(Date.now() - 86400000 * 40).toISOString() },
];

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 412, height: 915 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  const PERIOD_ROWS = [
    { id: 'a', patient_name: 'Okello John', patient_phone: '0700111222',
      confirmed_diagnosis: 'Pneumonia', severity: 'severe', clinician_name: 'DR B',
      prescription_items: [{ drug_name: 'Amoxicillin' }],
      total_charged_ugx: 40000, amount_paid: 40000, payment_status: 'paid',
      created_at: new Date().toISOString() },
    { id: 'b', patient_name: 'Achieng Mary', patient_phone: '0700333444',
      confirmed_diagnosis: 'Malaria', severity: 'moderate', clinician_name: 'DR C',
      prescription_items: [{ drug_name: 'Coartem' }, { drug_name: 'N/A' }],
      total_charged_ugx: 25000, amount_paid: 5000, payment_status: 'partial',
      created_at: new Date().toISOString() },
  ];

  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (/clinic_diagnoses/.test(u) && /created_at=gte/.test(u)) {
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify(PERIOD_ROWS) });
    }
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'D. Musinguzi', clinicName: 'Kampala Medical Centre',
      clinicId: cid, staffRole: 'owner', level: 'HC III' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
  }, [CID, UID]);
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);

  // ── 0. Loaded ────────────────────────────────────────────────────────
  const mod = await page.evaluate(() => ({ there: !!window.HomattPrint }));
  result('the print module is loaded', mod.there === true);

  // ── 1. Reachable from the patient file, without costing it height ────
  const entry = await page.evaluate(async (v) => {
    window._activeDetailContext = { current: v, history: [] };
    const m = document.getElementById('histModal');
    if (m) m.style.display = 'flex';
    renderActiveDetailView();
    await new Promise(r => setTimeout(r, 400));
    const btn = document.getElementById('pxPrintBtn');
    const head = btn && btn.parentElement;
    const body = document.getElementById('histModalBody');
    const hero = document.querySelector('.pr-hero');
    return {
      shown: !!(btn && getComputedStyle(btn).display !== 'none'),
      withClose: !!(head && head.querySelector('[aria-label="Close"]')),
      headH: head ? Math.round(head.getBoundingClientRect().height) : 0,
      heroH: hero ? Math.round(hero.getBoundingClientRect().height) : 0,
      recordH: body ? Math.round(body.scrollHeight) : 0,
      roomH: body ? Math.round(body.clientHeight) : 0,
      // Three 34px controls now share this row. It must still not clip.
      overflow: head ? Math.round(head.scrollWidth - head.clientWidth) : 0,
    };
  }, VISIT);
  result('the patient file offers a print button', entry.shown === true);
  result('it is in the header row beside Close', entry.withClose === true);
  result('three controls fit that row without clipping',
    entry.overflow <= 1, 'overflow ' + entry.overflow + 'px, row ' + entry.headH + 'px');
  result('and the record fits the modal it lives in',
    entry.recordH <= entry.roomH, entry.recordH + 'px in ' + entry.roomH + 'px');

  /* THE DELTA, not a threshold.
   *
   * The first version of this asserted `headH <= 62` and `heroH <= 60` — two
   * numbers picked out of the air. Both failed, and neither failure was
   * caused by the print button: the header is 65px because the patient's name
   * and the meta line under it are two lines, and the hero is 81px because
   * "Uncomplicated Malaria" is a long diagnosis that wraps. Measured with the
   * button, without it, and without the camera too, every figure was
   * identical.
   *
   * A threshold tests the fixture. The claim being made is "this control
   * costs the record no height", and the only honest way to check that is to
   * take the control away and measure again — the same discipline as putting
   * a bug back to prove a fix. */
  const delta = await page.evaluate(async () => {
    function snap() {
      const head = document.getElementById('pxPrintBtn').parentElement;
      const body = document.getElementById('histModalBody');
      return { head: Math.round(head.getBoundingClientRect().height),
               record: Math.round(body.scrollHeight) };
    }
    const withBtn = snap();
    document.getElementById('pxPrintBtn').style.display = 'none';
    await new Promise(r => setTimeout(r, 120));
    const without = snap();
    document.getElementById('pxPrintBtn').style.display = 'flex';
    return { withBtn, without };
  });
  result('and it costs the record no height at all — measured both ways',
    delta.withBtn.head === delta.without.head && delta.withBtn.record === delta.without.record,
    'with ' + delta.withBtn.head + '/' + delta.withBtn.record +
    'px, without ' + delta.without.head + '/' + delta.without.record + 'px');

  // ── 2. The sheet carries everything ──────────────────────────────────
  const sheet = await page.evaluate(async ([v, h]) => {
    window.HomattPrint.patient(v, h);
    await new Promise(r => setTimeout(r, 300));
    const root = document.getElementById('hmPrintRoot');
    return { text: root ? root.innerText.replace(/\s+/g, ' ') : '',
             open: getComputedStyle(document.getElementById('hmPrintWrap')).display !== 'none' };
  }, [VISIT, HISTORY]);
  result('the preview opens before anything is printed', sheet.open === true);

  const must = [
    ['the patient', 'Nakato Sarah'], ['the phone', '0772004455'],
    ['the clinic', 'Kampala Medical Centre'], ['who saw them', 'DR OKELLO JOHN'],
    ['the diagnosis', 'Uncomplicated Malaria'], ['the findings', 'fever 3 days'],
    ['the tests', 'Malaria RDT'], ['the results', 'P. falciparum'],
    ['the medicines', 'Artemether/Lumefantrine'], ['the second medicine', 'Paracetamol'],
    ['the plan', 'Complete the full course'], ['the instructions', 'Take with food'],
    ['the follow-up', 'Check the fever'],
    ['what was charged', 'UGX 30,000'], ['what was paid', 'UGX 20,000'],
    ['what is owed', 'UGX 10,000'],
    ['the earlier visit', 'Peptic Ulcer Disease'],
  ];
  const missing = must.filter(([, s]) => sheet.text.indexOf(s) < 0).map(([w]) => w);
  result('the sheet carries every detail of the visit', missing.length === 0,
    missing.length ? 'missing: ' + missing.join(', ') : must.length + ' details present');
  result('and drops the "N/A" placeholder rather than printing it as a medicine',
    !/\bN\/A\b/.test(sheet.text));
  result('the app\'s word is treatment, not the textbook one',
    !/consultation/i.test(sheet.text), sheet.text.slice(0, 0) || 'clean');

  // ── 3. Print media really hides the app ──────────────────────────────
  await page.emulateMedia({ media: 'print' });
  const inPrint = await page.evaluate(async () => {
    document.body.classList.add('hm-printing');
    await new Promise(r => setTimeout(r, 120));
    const kids = [...document.body.children];
    const root = document.getElementById('hmPrintRoot');
    const visibleOthers = kids.filter(el =>
      el !== root && getComputedStyle(el).display !== 'none').map(el => el.tagName + '#' + (el.id || ''));
    const rootShown = getComputedStyle(root).display !== 'none';
    document.body.classList.remove('hm-printing');
    return { visibleOthers, rootShown };
  });
  result('printing shows the sheet', inPrint.rootShown === true);
  result('and hides everything else on the page — the dashboard is not printed',
    inPrint.visibleOthers.length === 0,
    inPrint.visibleOthers.slice(0, 3).join(', ') || 'nothing else visible');
  await page.emulateMedia({ media: 'screen' });

  // ── 4. Black on white, whatever the clinic's skin is ─────────────────
  for (const [skin, theme] of [['dark', 'dark'], ['forest', 'dark']]) {
    const ink = await page.evaluate(async ([s, t]) => {
      document.documentElement.setAttribute('data-skin', s);
      document.documentElement.setAttribute('data-theme', t);
      await new Promise(r => setTimeout(r, 150));
      const el = document.querySelector('#hmPrintRoot .hm-sheet');
      const cs = getComputedStyle(el);
      function lum(c) {
        const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null;
        const p = m[1].split(',').map(parseFloat);
        function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
        return 0.2126 * ch(p[0]) + 0.7152 * ch(p[1]) + 0.0722 * ch(p[2]);
      }
      const fg = lum(cs.color), bg = lum(cs.backgroundColor);
      return { ratio: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
               bg: cs.backgroundColor, fg: cs.color };
    }, [skin, theme]);
    result('the paper is readable on the ' + skin + '/' + theme + ' skin',
      ink.ratio > 15, Math.round(ink.ratio) + ':1  ' + ink.fg + ' on ' + ink.bg);
  }
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-skin', 'forest');
    document.documentElement.setAttribute('data-theme', 'light');
  });

  // ── 5. A period: the picker, the table and the totals ────────────────
  const picker = await page.evaluate(async () => {
    window.HomattPrint.close();
    await new Promise(r => setTimeout(r, 120));
    openPrintPeriod();
    await new Promise(r => setTimeout(r, 400));
    const chips = [...document.querySelectorAll('#hmPrintPaper [data-period]')]
      .map(b => b.getAttribute('data-period'));
    return { chips };
  });
  result('it asks which period before printing anything',
    ['day', 'week', 'month', 'year'].every(k => picker.chips.indexOf(k) >= 0),
    picker.chips.join(', '));

  const reg = await page.evaluate(async () => {
    document.querySelector('#hmPrintPaper [data-period="month"]').click();
    await new Promise(r => setTimeout(r, 900));
    const root = document.getElementById('hmPrintRoot');
    return { text: root.innerText.replace(/\s+/g, ' '),
             rows: root.querySelectorAll('tbody tr').length,
             title: document.getElementById('hmPrintTitle').textContent };
  });
  result('picking a period prints the register for it', /This month/i.test(reg.title), reg.title);
  result('with one row per patient', reg.rows === 2, reg.rows + ' rows');
  result('naming each patient and what they were treated for',
    /Okello John/.test(reg.text) && /Pneumonia/.test(reg.text) &&
    /Achieng Mary/.test(reg.text) && /Malaria/.test(reg.text));
  result('and the money adds up — charged, paid and owing',
    /UGX 65,000/.test(reg.text) && /UGX 45,000/.test(reg.text) && /UGX 20,000/.test(reg.text),
    'expected 65,000 charged · 45,000 paid · 20,000 owing');
  result('the medicine count ignores the "N/A" placeholder',
    /2 patients/.test(reg.text), reg.text.match(/\d+ patients?/) ? reg.text.match(/\d+ patients?/)[0] : '?');

  // ── 6. The period starts at LOCAL midnight ───────────────────────────
  const bounds = await page.evaluate(() => {
    const S = window.HomattPrint._since;
    const d = S('day'), w = S('week'), m = S('month'), y = S('year');
    return {
      dayMidnight: d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0,
      dayIsToday: d.toDateString() === new Date().toDateString(),
      weekBack: Math.round((new Date().setHours(0, 0, 0, 0) - w.getTime()) / 86400000),
      monthFirst: m.getDate() === 1,
      yearJan1: y.getMonth() === 0 && y.getDate() === 1,
    };
  });
  result('"today" starts at local midnight, not UTC',
    bounds.dayMidnight && bounds.dayIsToday,
    'Kampala is UTC+3 — a UTC day would drop the first three hours of the clinic\'s');
  result('"this week" is the last seven days', bounds.weekBack === 6, bounds.weekBack + ' days back');
  result('"this month" starts on the 1st', bounds.monthFirst === true);
  result('"this year" starts on 1 January', bounds.yearJan1 === true);

  // ── 7. Closing puts the app back ─────────────────────────────────────
  const shut = await page.evaluate(async () => {
    window.HomattPrint.close();
    await new Promise(r => setTimeout(r, 150));
    return { wrap: getComputedStyle(document.getElementById('hmPrintWrap')).display,
             printing: document.body.classList.contains('hm-printing'),
             root: document.getElementById('hmPrintRoot').innerHTML.length };
  });
  result('closing hides the sheet and leaves nothing behind',
    shut.wrap === 'none' && shut.printing === false && shut.root === 0,
    shut.wrap + ' · printing=' + shut.printing + ' · ' + shut.root + ' chars left');

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
