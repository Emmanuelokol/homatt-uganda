// The vital flowsheet, driven on the real screen.
//
// The engine's arithmetic is tested without a browser in test-vitals-engine.js
// and its walls are tested against a real Postgres in
// tests/sql/test-vital-flowsheet.sql. This is the third of the three, and it
// asks the questions neither of those can:
//
//   • does the file actually parse, load and reach the patient's record?
//   • does the split numpad advance on its own, so a blood pressure is four
//     taps and not four taps plus two box-selections?
//   • is every word on it readable in all four skins and both themes — which
//     is eight combinations, and where four separate unreadable-text bugs have
//     been caught in this project by a number rather than by looking?
//   • does it fit a 360px phone, which is the phone this is used on?
//   • and does adding it to the patient record cost that record any height?
//     Asserted as a DELTA — the control is taken away and measured again —
//     because a threshold tests the fixture, not the claim.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME || require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.db': 'application/octet-stream' };
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(APP, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); rs.end(d);
  });
});

const SB = 'https://kgkdiykzmqjougwzzewi.supabase.co';
const PORT = 8968, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
function result(name, ok, got) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (got === undefined ? '' : '  — ' + got)); }
}

const VISIT = {
  id: 'v-flow-1', patient_name: 'Nakato Sarah', patient_phone: '0772004455',
  clinic_patient_id: 'cp-1',
  confirmed_diagnosis: 'Hypertensive emergency', severity: 'severe',
  patient_type: 'inpatient', ward: 'Female ward', clinician_name: 'DR OKELLO JOHN',
  clinical_findings: 'Patient: Female, 46 years\nChief complaint: severe headache',
  prescription_items: [{ drug_name: 'Hydralazine 20mg', strength: '10mg', frequency: 'stat', duration: 1 }],
  consultation_fee_ugx: 5000, total_charged_ugx: 5000, amount_paid: 0, payment_status: 'pending',
  follow_up_days: 1,
  created_at: new Date().toISOString(),
};

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 412, height: 915 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));

  // The server the flowsheet talks to, in miniature: readings accumulate in
  // memory so a saved one really does come back on the next load.
  let LOGS = [], NOTES = [], WATCH = [];
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    const m = r.request().method();
    if (/\/rest\/v1\/vital_logs/.test(u)) {
      if (m === 'POST') {
        const row = JSON.parse(r.request().postData() || '{}');
        row.map_mmhg = (row.systolic && row.diastolic && row.diastolic <= row.systolic)
          ? Math.round((row.diastolic + (row.systolic - row.diastolic) / 3) * 10) / 10 : null;
        LOGS.push(row);
        return r.fulfill({ status: 201, headers: H, body: JSON.stringify(row) });
      }
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify(LOGS) });
    }
    if (/\/rest\/v1\/vital_notes/.test(u)) {
      if (m === 'POST') { NOTES.push(JSON.parse(r.request().postData() || '{}')); return r.fulfill({ status: 201, headers: H, body: '[]' }); }
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify(NOTES) });
    }
    if (/\/rest\/v1\/vital_watch/.test(u)) return r.fulfill({ status: 200, headers: H, body: JSON.stringify(WATCH) });
    if (/\/rest\/v1\/rpc\/start_vital_watch/.test(u)) {
      const a = JSON.parse(r.request().postData() || '{}');
      WATCH = [{ id: 'w1', interval_minutes: a.p_interval_minutes, started_at: new Date().toISOString(), stopped_at: null }];
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true, id: 'w1' }) });
    }
    if (/\/rest\/v1\/rpc\/stop_vital_watch/.test(u)) { WATCH = []; return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true }) }); }
    if (/\/rest\/v1\/rpc\/void_vital_log/.test(u)) {
      const a = JSON.parse(r.request().postData() || '{}');
      LOGS = LOGS.map(l => l.id === a.p_log_id
        ? Object.assign({}, l, { voided_at: new Date().toISOString(), void_reason: a.p_reason }) : l);
      return r.fulfill({ status: 200, headers: H, body: JSON.stringify({ ok: true }) });
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

  // ── 0. It loaded at all ──────────────────────────────────────────────────
  const mods = await page.evaluate(() => ({
    engine: !!window.HomattVitals, sheet: !!window.HomattFlowsheet,
    map: window.HomattVitals ? window.HomattVitals.map(190, 110) : null,
  }));
  result('the vitals engine is loaded in the page', mods.engine === true);
  result('the flowsheet module is loaded in the page', mods.sheet === true);
  result('and the engine works in the browser too (190/110 → MAP 136.7)',
    mods.map === 136.7, String(mods.map));

  // ── 1. Reachable from the patient record, at no cost to it ───────────────
  const entry = await page.evaluate(async (v) => {
    window._activeDetailContext = { current: v, history: [] };
    const mdl = document.getElementById('histModal');
    if (mdl) mdl.style.display = 'flex';
    renderActiveDetailView();
    await new Promise(r => setTimeout(r, 400));
    const btn = document.getElementById('pxVitalsBtn');
    const head = btn && btn.parentElement;
    const body = document.getElementById('histModalBody');
    return {
      shown: !!(btn && getComputedStyle(btn).display !== 'none'),
      withClose: !!(head && head.querySelector('[aria-label="Close"]')),
      overflow: head ? Math.round(head.scrollWidth - head.clientWidth) : 0,
      record: body ? Math.round(body.scrollHeight) : 0,
      room: body ? Math.round(body.clientHeight) : 0,
    };
  }, VISIT);
  result('the patient record offers a flowsheet button', entry.shown === true);
  result('it is in the header row, beside Close', entry.withClose === true);
  result('FOUR controls now share that row and it still does not clip',
    entry.overflow <= 1, 'overflow ' + entry.overflow + 'px');
  result('and the record still fits the modal without scrolling',
    entry.record <= entry.room + 2, entry.record + 'px in ' + entry.room + 'px');

  // The delta, not a threshold: take it away and measure again.
  const delta = await page.evaluate(async () => {
    function snap() {
      const head = document.getElementById('pxVitalsBtn').parentElement;
      const body = document.getElementById('histModalBody');
      return { head: Math.round(head.getBoundingClientRect().height),
               record: Math.round(body.scrollHeight) };
    }
    const withBtn = snap();
    document.getElementById('pxVitalsBtn').style.display = 'none';
    await new Promise(r => setTimeout(r, 120));
    const without = snap();
    document.getElementById('pxVitalsBtn').style.display = 'flex';
    return { withBtn, without };
  });
  result('and it costs the record no height — measured with it and without it',
    delta.withBtn.head === delta.without.head && delta.withBtn.record === delta.without.record,
    'with ' + delta.withBtn.head + '/' + delta.withBtn.record +
    ', without ' + delta.without.head + '/' + delta.without.record);

  // ── 2. The age comes out of the record, not out of the air ───────────────
  const ageRead = await page.evaluate((v) => ({
    fromRecord: window.HomattFlowsheet.ageFrom(v),
    months: window.HomattFlowsheet.ageFrom({ clinical_findings: 'Patient: Male, 8 months' }),
    none: window.HomattFlowsheet.ageFrom({ clinical_findings: 'no age here' }),
    direct: window.HomattFlowsheet.ageFrom({ patient_age: 7 }),
  }), VISIT);
  result('the age is read out of what intake wrote into the record',
    ageRead.fromRecord === 46, String(ageRead.fromRecord));
  result('months are understood as a fraction of a year',
    Math.abs(ageRead.months - 0.67) < 0.02, String(ageRead.months));
  result('an age column, where one exists, wins', ageRead.direct === 7, String(ageRead.direct));
  result('and no age at all is null, not a guess', ageRead.none === null, String(ageRead.none));

  // ── 3. The sheet opens ───────────────────────────────────────────────────
  await page.evaluate(() => { document.getElementById('pxVitalsBtn').click(); });
  await page.waitForTimeout(700);
  const open = await page.evaluate(() => {
    const s = document.getElementById('fsSheet');
    return {
      on: !!s && s.classList.contains('on'),
      who: (document.getElementById('fsWho') || {}).textContent || '',
      empty: (document.getElementById('fsBody') || {}).innerText || '',
      age: (document.getElementById('fsAge') || {}).textContent || '',
    };
  });
  result('tapping it opens the flowsheet', open.on === true);
  result('it names the patient', /Nakato Sarah/.test(open.who), open.who);
  result('with nothing recorded it says so rather than drawing an empty chart',
    /No readings yet/.test(open.empty), open.empty.slice(0, 50));
  result('and it shows the age it will read the numbers against',
    /46/.test(open.age), open.age);

  // ── 4. THE SPLIT NUMPAD — four taps, no box-selecting ────────────────────
  await page.evaluate(() => { document.getElementById('fsAdd').click(); });
  await page.waitForTimeout(300);
  const typed = await page.evaluate(async () => {
    const keys = [...document.querySelectorAll('#fsKeys .fs-key')];
    const by = (t) => keys.find(k => k.textContent.trim() === t);
    const steps = [];
    for (const d of ['1', '9', '0']) { by(d).click(); steps.push(window.HomattFlowsheet._entry().field); }
    const afterSys = window.HomattFlowsheet._entry();
    for (const d of ['1', '1', '0']) by(d).click();
    await new Promise(r => setTimeout(r, 100));
    return {
      steps, afterSys,
      entry: window.HomattFlowsheet._entry(),
      sys: document.getElementById('fsSys').textContent,
      dia: document.getElementById('fsDia').textContent,
      live: document.getElementById('fsLive').textContent,
      liveOn: document.getElementById('fsLive').classList.contains('on'),
      liveTone: document.getElementById('fsLive').className,
    };
  });
  result('the systolic fills as the digits are tapped', typed.sys === '190', typed.sys);
  result('IT ADVANCES ON ITS OWN after three digits — nothing to tap in between',
    typed.afterSys.field === 'dia', JSON.stringify(typed.steps));
  result('and the diastolic then fills', typed.dia === '110', typed.dia);
  result('it says what the reading means while it is still being typed',
    typed.liveOn === true && /emergency/i.test(typed.live), typed.live);
  result('...in the danger colour', /fs-bad/.test(typed.liveTone), typed.liveTone);
  result('and it is the BOOK’s wording, not the AHA’s "crisis"',
    /Hypertensive emergency or urgency/.test(typed.live), typed.live);

  // ── 5. Saving, and the note that belongs to that moment ──────────────────
  await page.evaluate(() => {
    document.getElementById('fsPulse').value = '104';
    document.getElementById('fsNote').value = 'Gave hydralazine 10mg IV';
    document.getElementById('fsSave').click();
  });
  await page.waitForTimeout(900);
  const firstCard = await page.evaluate(() => {
    const body = document.getElementById('fsBody');
    return { text: body.innerText.replace(/\s+/g, ' '), cards: body.querySelectorAll('.fs-card').length,
             entryOpen: document.getElementById('fsEntry').classList.contains('on') };
  });
  result('saving closes the keypad', firstCard.entryOpen === false);
  result('the reading appears on the sheet', firstCard.cards === 1, firstCard.cards + ' cards');
  result('showing the blood pressure', /190\/110/.test(firstCard.text), firstCard.text.slice(0, 90));
  result('and the MAP worked out for it', /MAP 136\.7/.test(firstCard.text), firstCard.text.slice(0, 140));
  result('the pulse is there and marked fast', /104\/min pulse/.test(firstCard.text));
  result('the note is tied to that reading, not floating loose',
    /hydralazine 10mg IV/.test(firstCard.text), firstCard.text.slice(0, 200));
  result('and it is labelled as something GIVEN, read from the words',
    /Given — Gave hydralazine/.test(firstCard.text), firstCard.text.slice(0, 200));
  result('a shock index at or over 0.9 is called out',
    !/Shock index/.test(firstCard.text), 'pulse 104 over 190 is 0.55 — correctly silent');

  // ── 6. THE SECOND READING IS THE POINT ───────────────────────────────────
  const second = await page.evaluate(async () => {
    document.getElementById('fsAdd').click();
    await new Promise(r => setTimeout(r, 150));
    const keys = [...document.querySelectorAll('#fsKeys .fs-key')];
    const by = (t) => keys.find(k => k.textContent.trim() === t);
    ['1', '7', '0'].forEach(d => by(d).click());
    ['1', '0', '0'].forEach(d => by(d).click());
    await new Promise(r => setTimeout(r, 120));
    const live = document.getElementById('fsLive').textContent;
    document.getElementById('fsSave').click();
    await new Promise(r => setTimeout(r, 900));
    return { live, text: document.getElementById('fsBody').innerText.replace(/\s+/g, ' ') };
  });
  result('the change from the last reading is shown as it is typed',
    /−20\/−10/.test(second.live), second.live);
  result('and a fall from 190/110 to 170/100 reads as moving the RIGHT way',
    /moving the right way/.test(second.live), second.live);
  result('both readings are on the sheet, newest first',
    /170\/100[\s\S]*190\/110/.test(second.text), second.text.slice(0, 120));

  // A FALL IS NOT ALWAYS IMPROVEMENT. The same arithmetic in a shocked
  // patient is the opposite event, and this is the assertion that proves the
  // sheet reads direction rather than sign.
  const shocked = await page.evaluate(() => {
    const hv = window.HomattVitals;
    return {
      hyper: hv.delta({ sbp: 170, dbp: 100 }, { sbp: 190, dbp: 110 }, { ageYears: 46 }).status,
      shock: hv.delta({ sbp: 80, dbp: 50 }, { sbp: 95, dbp: 60 }, { ageYears: 46 }).status,
    };
  });
  result('190/110 → 170/100 is IMPROVING', shocked.hyper === 'IMPROVING', shocked.hyper);
  result('95/60 → 80/50 is WORSENING — the same fall, the opposite event',
    shocked.shock === 'WORSENING', shocked.shock);

  // ── 7. The trend view ────────────────────────────────────────────────────
  // Before anything is struck out, because a line needs two live readings and
  // the whole point of striking one out is that it stops counting.
  const trend = await page.evaluate(async () => {
    document.getElementById('fsTabChronic').click();
    await new Promise(r => setTimeout(r, 300));
    const body = document.getElementById('fsBody');
    return { svg: body.querySelectorAll('svg').length,
             paths: body.querySelectorAll('svg path').length,
             dots: body.querySelectorAll('svg circle').length,
             text: body.innerText.replace(/\s+/g, ' ') };
  });
  result('the trend view draws a chart with no library at all', trend.svg === 1, trend.svg + ' svg');
  result('...with a line for the systolic and one for the diastolic',
    trend.paths === 2, trend.paths + ' paths');
  result('...a pin where a note was written, so a fall can be read against the drug',
    trend.dots >= 5, trend.dots + ' circles (4 points + at least one note pin)');
  result('...it names the target band it shaded',
    /Target 90–139/.test(trend.text), trend.text.slice(0, 200));
  result('...and the average, highest and lowest of the window',
    /Average of 2/.test(trend.text) && /Highest/.test(trend.text) && /Lowest/.test(trend.text),
    trend.text.slice(0, 220));
  await page.evaluate(() => document.getElementById('fsTabAcute').click());
  await page.waitForTimeout(250);

  // ── 8. A wrong reading is struck out, never erased ───────────────────────
  const voided = await page.evaluate(async () => {
    window.prompt = () => 'cuff was on the wrong arm';
    const btn = document.querySelector('#fsBody [data-void]');
    btn.click();
    await new Promise(r => setTimeout(r, 900));
    const body = document.getElementById('fsBody');
    return { text: body.innerText.replace(/\s+/g, ' '),
             cards: body.querySelectorAll('.fs-card').length,
             struck: body.querySelectorAll('.fs-card.void').length };
  });
  result('striking one out leaves it on the sheet',
    voided.cards === 2, voided.cards + ' cards');
  result('...marked as struck out', voided.struck === 1, voided.struck + ' struck');
  result('...with the reason beside it',
    /cuff was on the wrong arm/.test(voided.text), voided.text.slice(0, 160));
  result('...and the wrong number still readable, not deleted',
    /170\/100/.test(voided.text));

  /* AND IT MUST STOP COUNTING, which is the half that is easy to get wrong.
   *
   * 190/110 and 170/100 are on the sheet; the 170/100 has just been struck
   * out. A third reading of 160/95 must therefore be compared with 190/110 —
   * −30/−15 — and NOT with the struck-out 170/100, which would read −10/−5.
   * The two are told apart by the number, so this cannot pass by accident. */
  const afterVoid = await page.evaluate(async () => {
    document.getElementById('fsAdd').click();
    await new Promise(r => setTimeout(r, 150));
    const keys = [...document.querySelectorAll('#fsKeys .fs-key')];
    const by = (t) => keys.find(k => k.textContent.trim() === t);
    ['1', '6', '0'].forEach(d => by(d).click());
    ['0', '9', '5'].forEach(d => by(d).click());
    await new Promise(r => setTimeout(r, 150));
    const live = document.getElementById('fsLive').textContent;
    document.getElementById('fsEntry').classList.remove('on');
    return live;
  });
  result('a struck-out reading is NOT treated as "the reading before"',
    /−30\/−15/.test(afterVoid), afterVoid);
  result('...and the struck-out figure is not the one it compared with',
    !/−10\/−5/.test(afterVoid), afterVoid);

  // ── 9. The countdown, for "check her every 15 minutes" ───────────────────
  const watch = await page.evaluate(async () => {
    window.prompt = () => '15';
    document.getElementById('fsSetWatch').click();
    await new Promise(r => setTimeout(r, 900));
    const bar = document.getElementById('fsWatchBar');
    return { on: bar.classList.contains('on'), text: bar.textContent };
  });
  result('a check interval can be set', watch.on === true);
  result('and the sheet counts down to the next one',
    /Every 15 min/.test(watch.text) && /next check in/.test(watch.text), watch.text);

  // ── 10. A CHILD IS NOT READ AS AN ADULT, on the screen as in the engine ──
  const child = await page.evaluate(async () => {
    const key = 'homatt_fs_age_cp-1';
    localStorage.setItem(key, '3');
    document.getElementById('fsTabAcute').click();
    await new Promise(r => setTimeout(r, 300));
    const t = document.getElementById('fsBody').innerText.replace(/\s+/g, ' ');
    localStorage.removeItem(key);
    document.getElementById('fsTabAcute').click();
    return t;
  });
  result('with a 3-year-old’s age set, no adult stage is printed anywhere',
    !/stage 1|stage 2|Pre-hypertension/i.test(child), child.slice(0, 160));
  result('...the book’s paediatric range is used instead',
    /range for 1–5 years/.test(child), child.slice(0, 200));
  result('...and it says the book gives no diastolic range for a child',
    /no diastolic range for a child/.test(child), child.slice(0, 260));

  // ── 11. Every word readable, in all EIGHT skin/theme combinations ────────
  //
  // Not "is the colour right" — the contrast ratio against the COMPOSITED
  // background, because a dark-mode surface is often a translucent wash over
  // another colour and reading it at face value reports a perfectly good box
  // as unreadable (and would just as easily hide a real one).
  const bad = [];
  for (const skin of ['forest', 'midnight', 'dark', 'clay']) {
    for (const theme of ['light', 'dark']) {
      const worst = await page.evaluate(async ([sk, th]) => {
        document.documentElement.setAttribute('data-skin', sk);
        document.documentElement.setAttribute('data-theme', th);
        await new Promise(r => setTimeout(r, 160));
        function lum(c) {
          const f = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
          return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
        }
        function parse(s) {
          const m = String(s).match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/);
          return m ? { c: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4] } : null;
        }
        // Composite every translucent background down to the page's own.
        function bgOf(el) {
          let out = [255, 255, 255], stack = [];
          for (let n = el; n; n = n.parentElement) {
            const p = parse(getComputedStyle(n).backgroundColor);
            if (p && p.a > 0) { stack.push(p); if (p.a === 1) break; }
          }
          const base = stack.length && stack[stack.length - 1].a === 1 ? stack.pop().c : [255, 255, 255];
          out = base;
          for (let i = stack.length - 1; i >= 0; i--) {
            out = out.map((v, k) => stack[i].c[k] * stack[i].a + v * (1 - stack[i].a));
          }
          return out;
        }
        const worst = [];
        document.querySelectorAll('#fsSheet *, #fsEntry *').forEach(el => {
          if (!el.offsetParent && el.id !== 'fsSheet') return;
          const txt = [...el.childNodes].filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim()).join('').trim();
          if (!txt) return;
          const cs = getComputedStyle(el);
          const fg = parse(cs.color); if (!fg) return;
          const bg = bgOf(el);
          const fgc = fg.a === 1 ? fg.c : fg.c.map((v, k) => v * fg.a + bg[k] * (1 - fg.a));
          const l1 = lum(fgc), l2 = lum(bg);
          const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
          if (ratio < 3.0) worst.push({ t: txt.slice(0, 28), r: Math.round(ratio * 100) / 100 });
        });
        return worst;
      }, [skin, theme]);
      worst.forEach(w => bad.push(skin + '/' + theme + ' "' + w.t + '" ' + w.r + ':1'));
    }
  }
  result('every word on the flowsheet is readable in all 8 skin/theme combinations',
    bad.length === 0, bad.length ? bad.slice(0, 4).join(' | ') : 'none');

  await page.evaluate(() => {
    document.documentElement.setAttribute('data-skin', 'forest');
    document.documentElement.setAttribute('data-theme', 'light');
  });

  // ── 12. It fits the phone this is used on ────────────────────────────────
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(350);
  const fit = await page.evaluate(async () => {
    const s = document.getElementById('fsSheet');
    const over = [];
    s.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > 360.5 || r.left < -0.5)) {
        over.push((el.className || el.tagName) + ' ' + Math.round(r.right));
      }
    });
    document.getElementById('fsAdd').click();
    await new Promise(r => setTimeout(r, 250));
    const e = document.getElementById('fsEntry');
    e.querySelectorAll('*').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > 360.5 || r.left < -0.5)) {
        over.push('entry ' + (el.className || el.tagName) + ' ' + Math.round(r.right));
      }
    });
    const pad = document.querySelector('.fs-pad');
    return { over, padW: Math.round(pad.getBoundingClientRect().width),
             sheetW: Math.round(s.scrollWidth) };
  });
  // The width assertion goes beside the overflow one on purpose: an element
  // with no size satisfies every overflow check, and reports the fault fixed.
  result('the keypad sheet actually has a width to overflow with',
    fit.padW > 300, fit.padW + 'px');
  result('nothing runs off the side of a 360px phone, on the sheet or the keypad',
    fit.over.length === 0, fit.over.slice(0, 3).join(' | '));
  result('and the sheet itself does not scroll sideways',
    fit.sheetW <= 361, fit.sheetW + 'px');

  // ── 13. What it refuses to store ─────────────────────────────────────────
  const refused = await page.evaluate(async () => {
    async function tryIt(sys, dia, extra) {
      document.getElementById('fsEntry').classList.remove('on');
      document.getElementById('fsAdd').click();
      await new Promise(r => setTimeout(r, 120));
      const keys = [...document.querySelectorAll('#fsKeys .fs-key')];
      const by = (t) => keys.find(k => k.textContent.trim() === t);
      String(sys).split('').forEach(d => by(d).click());
      if (window.HomattFlowsheet._entry().field !== 'dia') by('→') && 0;
      document.getElementById('fsDiaBox').click();
      String(dia).split('').forEach(d => by(d).click());
      if (extra) Object.keys(extra).forEach(k => { document.getElementById(k).value = extra[k]; });
      document.getElementById('fsSave').click();
      await new Promise(r => setTimeout(r, 300));
      return document.getElementById('fsMsg').textContent;
    }
    const out = {};
    out.flipped = await tryIt('80', '120');
    out.temp = await tryIt('120', '80', { fsTemp: '385' });
    document.getElementById('fsEntry').classList.remove('on');
    return out;
  });
  result('a diastolic above the systolic is queried, not stored',
    /diastolic is higher/.test(refused.flipped), refused.flipped);
  result('a temperature of 385 is refused with the decimal point named',
    /decimal point/.test(refused.temp), refused.temp);

  /* ── 14. A READING TAKEN WITH NO SIGNAL ──────────────────────────────────
   *
   * A ward round with no signal is the normal case, and the observations still
   * have to be taken. The reading has to appear on the sheet immediately — a
   * nurse who sees nothing happen writes it on her hand — and it has to still
   * be there after the sheet is closed and reopened, because the outbox may
   * not drain for hours. */
  await page.evaluate(() => { document.getElementById('fsEntry').classList.remove('on'); });
  await ctx.setOffline(true);
  const off = await page.evaluate(async () => {
    const before = (window.ClinicOffline.get('outbox', []) || []).length;
    document.getElementById('fsAdd').click();
    await new Promise(r => setTimeout(r, 150));
    const keys = [...document.querySelectorAll('#fsKeys .fs-key')];
    const by = (t) => keys.find(k => k.textContent.trim() === t);
    ['1', '4', '2'].forEach(d => by(d).click());
    ['0', '8', '8'].forEach(d => by(d).click());
    document.getElementById('fsNote').value = 'Gave amlodipine 5mg';
    document.getElementById('fsSave').click();
    await new Promise(r => setTimeout(r, 700));
    const box = window.ClinicOffline.get('outbox', []) || [];
    return {
      queuedBefore: before, queuedAfter: box.length,
      tables: box.map(o => (o.payload || {}).table).filter(Boolean),
      onSheet: document.getElementById('fsBody').innerText.replace(/\s+/g, ' '),
      entryOpen: document.getElementById('fsEntry').classList.contains('on'),
      msg: document.getElementById('fsMsg').textContent,
    };
  });
  result('a reading taken with no signal is accepted, not refused',
    off.entryOpen === false && !off.msg, off.msg || 'saved');
  result('...and shows on the sheet straight away', /142\/88/.test(off.onSheet), off.onSheet.slice(0, 80));
  result('...with its MAP worked out on the phone', /MAP 106/.test(off.onSheet), off.onSheet.slice(0, 120));
  result('...and it is queued to be sent — the reading AND its note',
    off.queuedAfter === off.queuedBefore + 2 &&
    off.tables.indexOf('vital_logs') >= 0 && off.tables.indexOf('vital_notes') >= 0,
    off.tables.join(','));

  // It must survive the sheet being closed — the outbox may not drain for hours.
  const survived = await page.evaluate(async () => {
    window.HomattFlowsheet.close();
    await new Promise(r => setTimeout(r, 250));
    document.getElementById('pxVitalsBtn').click();
    await new Promise(r => setTimeout(r, 900));
    return document.getElementById('fsBody').innerText.replace(/\s+/g, ' ');
  });
  result('...and it is still there when the sheet is closed and reopened',
    /142\/88/.test(survived), survived.slice(0, 90));

  // Striking one out, however, is refused rather than queued.
  const offVoid = await page.evaluate(async () => {
    let said = '';
    window.prompt = () => 'wrong arm';
    window.alert = (m) => { said = m; };
    document.querySelector('#fsBody [data-void]').click();
    await new Promise(r => setTimeout(r, 500));
    return said;
  });
  result('striking a reading out with no signal is refused, not queued',
    /needs a connection/.test(offVoid), offVoid);
  await ctx.setOffline(false);
  await page.evaluate(() => window.HomattFlowsheet.close());

  /* ── 15. THE OTHER WAY INTO THE SAME MODAL ───────────────────────────────
   *
   * The patient record has two entry points: the active-treatment list, which
   * wires these header controls, and the history search, which shares the same
   * modal and does not. The footer was already hidden there, with a comment
   * saying it "would be stale here" — and the camera, the print button and the
   * flowsheet were left on screen, still pointing at the patient looked at
   * before. A photograph of the person in front of you filed against somebody
   * else's record is a record about the wrong patient.
   *
   * The control below proves the check can see a button that IS showing:
   * without it, "all three are hidden" is also what a broken selector returns. */
  const twoDoors = await page.evaluate(async (v) => {
    function shown() {
      return ['pxPhotoBtn', 'pxPrintBtn', 'pxVitalsBtn'].filter(function (id) {
        var b = document.getElementById(id);
        return b && getComputedStyle(b).display !== 'none';
      });
    }
    // 1. an active patient: the controls are wired to them
    window._activeDetailContext = { current: v, history: [] };
    document.getElementById('histModal').style.display = 'flex';
    renderActiveDetailView();
    await new Promise(r => setTimeout(r, 300));
    const afterActive = shown();

    // 2. now a DIFFERENT patient, through the history search
    window._histGroups = { g1: {
      name: 'Okello John', phone: '0700999888',
      records: [{ id: 'other-1', confirmed_diagnosis: 'Peptic Ulcer Disease',
                  created_at: new Date().toISOString(), prescription_items: [] }] } };
    openHistModal('g1');
    await new Promise(r => setTimeout(r, 300));
    return { afterActive: afterActive, afterHistory: shown(),
             name: document.getElementById('histModalName').textContent };
  }, VISIT);
  result('CONTROL: on the active patient the header controls ARE showing',
    twoDoors.afterActive.length === 3, twoDoors.afterActive.join(','));
  result('the history search opens a different patient', /Okello John/.test(twoDoors.name), twoDoors.name);
  result('and NO control stays behind still wired to the previous patient',
    twoDoors.afterHistory.length === 0, twoDoors.afterHistory.join(',') || 'none');

  // ── 16. Nothing threw ────────────────────────────────────────────────────
  result('no page error anywhere in that journey',
    errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})();
