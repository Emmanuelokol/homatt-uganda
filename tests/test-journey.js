// The whole treatment journey, on the real screens.
//
//   type or dictate → suggestions → tap one → confirmed diagnosis →
//   lab tests ordered → one-tap standard package
//
// Three faults this locks down, all found by walking the journey rather than
// by reading it:
//
//   • Confirming a suggestion ordered its lab tests and put them on the bill
//     with NOTHING on the screen to show it — the tray stayed hidden, no chip
//     lit, the lab fee did not move.
//   • Changing your mind left the first diagnosis's tests on the bill, so the
//     patient paid for the diagnosis that was discarded.
//   • A handoff from the floating microphone filled the EMPTY boxes of a
//     screen that already had a different patient on it, producing one record
//     describing two people.
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
const PORT = 8943, ORIGIN = 'http://localhost:' + PORT;

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1000 } })).newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
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

  const openIntake = async () => {
    await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
    await page.waitForTimeout(4500);
  };
  const fill = (id, val) => page.evaluate(([i,v]) => {
    const e = document.getElementById(i); if (!e) return false;
    e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); return true;
  }, [id, val]);
  const look = () => page.evaluate(() => ({
    dx: (document.getElementById('confirmedDx')||{}).value || '',
    name: (document.getElementById('quickPatientName')||{}).value || '',
    chief: (document.getElementById('itChief')||{}).value || '',
    subj: (document.getElementById('itSubjective')||{}).value || '',
    temp: (document.getElementById('itTemp')||{}).value || '',
    age: (document.getElementById('itAge')||{}).value || '',
    labs: (window._wizState && window._wizState.labTests || []).slice(),
    trayDisplay: (function(){ var t=document.getElementById('labSelectedTray');
      return t ? getComputedStyle(t).display : '(none)'; })(),
    trayText: (function(){ var t=document.getElementById('labSelectedTray');
      return t ? t.textContent.replace(/\s+/g,' ').trim() : ''; })(),
    chips: [...document.querySelectorAll('.lab-chip.active')].map(c=>c.dataset.lab),
    picks: document.querySelectorAll('.it-pick').length,
    names: [...document.querySelectorAll('.it-dx-name')].map(x=>x.textContent.trim()),
    handAsk: !!document.querySelector('.it-hand'),
    checkShown: (function(){ var c=document.getElementById('itCheck');
      return c ? getComputedStyle(c).display : '(none)'; })(),
    overlay: (function(){ var o=document.getElementById('ucgOverlay');
      return o ? getComputedStyle(o).display : '(none)'; })(),
  }));

  // ── The list, and confirming from it ────────────────────────────────────
  await openIntake();
  await fill('itChief', 'lower abdominal pain');
  await fill('itSubjective', 'lower abdominal pain for one week with smelly vaginal discharge and painful urination');
  await fill('itSbp','112'); await fill('itDbp','70');
  await fill('itTemp','38.2'); await fill('itPulse','96');
  await page.evaluate(() => { const s=document.querySelector('.it-sex-btn[data-sex="female"]'); if (s) s.click(); });
  await fill('itAge','24');
  await page.waitForTimeout(1600);
  let v = await look();
  result('the books suggest something for a typed treatment', v.picks > 0, v.names.join(' · '));

  await page.evaluate(() => { const b=document.querySelector('.it-pick'); if (b) b.click(); });
  await page.waitForTimeout(800);
  const one = await look();
  result('tapping a suggestion sets the confirmed diagnosis', !!one.dx, JSON.stringify(one.dx));
  result('the tests it orders are actually ON the visit', one.labs.length > 0, JSON.stringify(one.labs));
  // The whole point: they are ordered AND priced, so they must be visible at
  // the moment they are added, not discovered later on the bill.
  result('and the lab tray shows them instead of staying hidden',
    one.trayDisplay !== 'none' && one.trayText.length > 0,
    one.trayDisplay + ' :: ' + one.trayText);
  result('and the matching lab chip lights up',
    one.chips.length > 0 && one.labs.every(t => one.chips.indexOf(t) >= 0),
    JSON.stringify(one.chips));

  // ── Changing your mind ──────────────────────────────────────────────────
  // A test the clinician ticked themselves must survive; the one the discarded
  // diagnosis brought must not.
  await page.evaluate(() => {
    const s = window._wizState;
    if (s && Array.isArray(s.labTests)) s.labTests.push('Malaria RDT');
  });
  await page.evaluate(() => { const bs=document.querySelectorAll('.it-pick'); if (bs[1]) bs[1].click(); });
  await page.waitForTimeout(800);
  const two = await look();
  result('changing the diagnosis takes the old one\'s tests off the bill',
    one.labs.every(t => two.labs.indexOf(t) < 0),
    JSON.stringify(one.labs) + ' → ' + JSON.stringify(two.labs));
  result('but a test the clinician added themselves is left alone',
    two.labs.indexOf('Malaria RDT') >= 0, JSON.stringify(two.labs));

  // ── The handoff, onto an empty screen ───────────────────────────────────
  const payload = (over) => Object.assign({
    at: Date.now(), heard: 'she is 24 years old female with lower abdominal pain',
    dx: 'Pelvic inflammatory disease', name: 'Achieng Mary', sex: 'female',
    age: '24', ageUnit: 'years', chief: 'lower abdominal pain',
    subjective: 'lower abdominal pain for one week with vaginal discharge',
    background: '', vitals: { temp: '38.2', pulse: '96', sbp: '112', dbp: '70', weight: '' },
  }, over || {});

  await page.evaluate((p) => localStorage.setItem('homatt_speak_handoff', JSON.stringify(p)), payload());
  await openIntake();
  await page.waitForTimeout(5000);
  const h = await look();
  result('a handoff fills an empty screen', h.name === 'Achieng Mary' && !!h.chief,
    JSON.stringify(h.name) + ' / ' + JSON.stringify(h.chief));
  result('and carries the diagnosis through', h.dx === 'Pelvic inflammatory disease', JSON.stringify(h.dx));
  result('and opens the one-tap standard package', h.overlay === 'flex', 'overlay ' + h.overlay);
  const left = await page.evaluate(() => localStorage.getItem('homatt_speak_handoff'));
  result('and is consumed exactly once', left === null, String(left).slice(0, 30));

  // ── The handoff, onto somebody else ─────────────────────────────────────
  await openIntake();
  await fill('quickPatientName', 'Okello John');
  await fill('itChief', 'headache');
  await page.evaluate((p) => {
    localStorage.setItem('homatt_speak_handoff', JSON.stringify(p));
    if (typeof window._speakHandoff === 'function') window._speakHandoff();
  }, payload({ name: 'Nakato Sarah', chief: 'fever', subjective: 'fever for three days',
               dx: 'Malaria', vitals: { temp: '39.5', pulse: '110', sbp: '', dbp: '', weight: '' } }));
  await page.waitForTimeout(1800);
  const clash = await look();
  result('a handoff for a DIFFERENT patient writes nothing at all',
    clash.subj === '' && clash.temp === '' && clash.dx === '',
    'story ' + JSON.stringify(clash.subj) + ', temp ' + JSON.stringify(clash.temp) +
      ', dx ' + JSON.stringify(clash.dx));
  result('the patient already on the screen is untouched',
    clash.name === 'Okello John' && clash.chief === 'headache',
    JSON.stringify(clash.name) + ' / ' + JSON.stringify(clash.chief));
  result('and a person is asked which of the two it is',
    clash.handAsk && clash.checkShown === 'block', 'check panel ' + clash.checkShown);

  // Keeping what is on the screen must leave it exactly as it was.
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.it-hand')].find(x => x.dataset.hand === 'keep');
    if (b) b.click();
  });
  await page.waitForTimeout(700);
  const kept = await look();
  result('"keep what is on the screen" changes nothing and puts the question away',
    kept.name === 'Okello John' && kept.chief === 'headache' && kept.subj === '' && !kept.handAsk,
    JSON.stringify(kept.name) + ' / ' + JSON.stringify(kept.chief));

  // Replacing must replace — no box left over from the other patient.
  await openIntake();
  await fill('quickPatientName', 'Okello John');
  await fill('itChief', 'headache');
  await fill('itBackground', 'known asthmatic');
  await page.evaluate((p) => {
    localStorage.setItem('homatt_speak_handoff', JSON.stringify(p));
    if (typeof window._speakHandoff === 'function') window._speakHandoff();
  }, payload({ name: 'Nakato Sarah', chief: 'fever', subjective: 'fever for three days',
               dx: '', background: '', vitals: { temp: '39.5', pulse: '110', sbp: '', dbp: '', weight: '' } }));
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('.it-hand')].find(x => x.dataset.hand === 'use');
    if (b) b.click();
  });
  await page.waitForTimeout(1200);
  const rep = await look();
  result('"clear this and use what was said" replaces the patient',
    rep.name === 'Nakato Sarah' && rep.chief === 'fever' && rep.temp === '39.5',
    JSON.stringify(rep.name) + ' / ' + JSON.stringify(rep.chief) + ' / ' + JSON.stringify(rep.temp));
  const bg = await page.evaluate(() => (document.getElementById('itBackground')||{}).value || '');
  result('and leaves nothing of the previous one behind', bg === '', JSON.stringify(bg));

  // ── The same patient, half entered, is NOT a clash ──────────────────────
  await openIntake();
  await fill('quickPatientName', 'Achieng Mary');
  await page.evaluate((p) => {
    localStorage.setItem('homatt_speak_handoff', JSON.stringify(p));
    if (typeof window._speakHandoff === 'function') window._speakHandoff();
  }, payload({ dx: '' }));
  await page.waitForTimeout(1500);
  const same = await look();
  result('the same patient, half entered, still just fills the empty boxes',
    !same.handAsk && same.name === 'Achieng Mary' && !!same.subj && same.temp === '38.2',
    'asked? ' + same.handAsk + ', story ' + JSON.stringify(same.subj.slice(0, 30)));

  // ── A child's package, and which section the book offers ────────────────
  // "Pneumonia" is five sections, three of them split by age. The age is
  // already on the screen, so offering all five unmarked is how the adult page
  // gets opened for a three-year-old.
  await page.evaluate((p) => localStorage.setItem('homatt_speak_handoff', JSON.stringify(p)),
    payload({ name: 'Opio Samuel', sex: 'male', age: '3', ageUnit: 'years',
              chief: 'cough', subjective: 'fever for three days with cough and fast breathing',
              dx: 'Pneumonia', vitals: { temp: '39.1', pulse: '140', sbp: '', dbp: '', weight: '12' } }));
  await openIntake();
  await page.waitForTimeout(7000);
  const ask = await page.evaluate(() => {
    const a = document.getElementById('ucgAsk');
    const rows = [...document.querySelectorAll('#ucgAskDiff [data-h]')].map(e => ({
      title: (e.querySelector('div') || {}).textContent || '',
      fits: !!e.querySelector('.ucg-agefit'),
      no: !!e.querySelector('.ucg-ageno'),
    }));
    return { open: a ? getComputedStyle(a).display : '(none)',
             text: (document.getElementById('ucgAskText') || {}).textContent || '', rows: rows };
  });
  result('a condition with several sections asks which one',
    ask.open === 'flex' && ask.rows.length > 1, ask.rows.length + ' sections');
  result('the section for this child\'s age is marked and comes first',
    !!ask.rows[0] && ask.rows[0].fits && /2 months-5 years/.test(ask.rows[0].title),
    ask.rows[0] ? ask.rows[0].title.trim() : '(none)');
  result('the adult section is marked as the wrong age group',
    ask.rows.some(r => />\s*5 years and adults/.test(r.title) && r.no),
    ask.rows.filter(r => r.no).map(r => r.title.trim().slice(0, 34)).join(' | '));
  result('and the screen says the marking came from the recorded age',
    /age on the screen \(3 years\)/.test(ask.text) && /You still choose/.test(ask.text), '');

  // Open the right one and check the child gate.
  await page.evaluate(() => {
    const e = document.querySelector('#ucgAskDiff [data-h]');
    if (e) e.click();
  });
  await page.waitForTimeout(2500);
  const kid = await page.evaluate(() => {
    const o = document.getElementById('ucgOverlay');
    const txt = (o ? o.textContent : '').replace(/\s+/g, ' ');
    return { open: o ? getComputedStyle(o).display : '(none)',
             warns: document.querySelectorAll('.ucg-childwarn').length,
             ticked: document.querySelectorAll('.ucg-drug.on').length,
             drugs: document.querySelectorAll('.ucg-drug').length,
             split: /medicine\s*This is a child|so\s*This is a child/.test(txt) };
  });
  result('choosing a section opens its package', kid.open === 'flex', 'overlay ' + kid.open);
  result('a child\'s package says so exactly once, not three times',
    kid.warns === 1, kid.warns + ' copies of the warning');
  result('and the pricing sentence is not cut in half by it',
    !kid.split, kid.split ? 'spliced mid-sentence' : '');
  result('and nothing is ticked for a child',
    kid.ticked === 0, kid.ticked + ' of ' + kid.drugs + ' medicines ticked');

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
