// Walk the whole treatment journey on the real screens and report what breaks.
//
// Intake → suggestions → tap one → confirmed diagnosis → one-tap package, plus
// the floating microphone's handoff into the same screen. Prints what it sees;
// asserts nothing. Use it to find faults, then write the assertion in a test.
//
//   node probe-journey.js
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
const PORT = 8942, ORIGIN = 'http://localhost:' + PORT;
const say = (...a) => console.log(...a);

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 1000 } });
  const page = await ctx.newPage();
  const errs = [], warns = [];
  page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  page.on('console', m => { if (m.type() === 'error') warns.push(m.text().slice(0, 160)); });
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });
  const session = ([cid,uid]) => {
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  };
  await page.goto(ORIGIN + '/clinic/index.html');
  await page.evaluate(([c,u]) => { localStorage.clear(); }, [CID,UID]);
  await page.evaluate(session, [CID,UID]);

  const openIntake = async () => {
    await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
    await page.waitForTimeout(4500);
  };

  // ── 1. Type a consultation in by hand and watch the suggestions ──────────
  say('\n── 1. filling the intake screen by hand ──');
  await openIntake();
  const fill = async (id, val) => {
    const ok = await page.evaluate(([i,v]) => {
      const e = document.getElementById(i); if (!e) return false;
      e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); return true;
    }, [id, val]);
    if (!ok) say('   !! no such box: #' + id);
  };
  await fill('itChief', 'lower abdominal pain');
  await fill('itSubjective', 'lower abdominal pain for one week with smelly vaginal discharge and painful urination');
  await fill('itSbp', '112'); await fill('itDbp', '70');
  await fill('itTemp', '38.2'); await fill('itPulse', '96');
  await page.evaluate(() => {
    const s = document.querySelector('.it-sex-btn[data-sex="female"]') ||
              document.querySelector('.it-sex-btn[data-sex="f"]');
    if (s) s.click();
  });
  await fill('itAge', '24');
  await page.waitForTimeout(1600);

  const shown = await page.evaluate(() => {
    const host = document.getElementById('itImpression');
    return {
      picks: [...document.querySelectorAll('.it-pick')].map(b => b.textContent.trim()),
      names: [...document.querySelectorAll('.it-dx-name')].map(b => b.textContent.trim()),
      pcts:  [...document.querySelectorAll('.it-dx-pct')].map(b => b.textContent.trim()),
      warnTitles: [...document.querySelectorAll('.it-check-warn b')].map(b => b.textContent.trim()),
      checkOpen: !!(document.getElementById('itCheck') || {}).offsetHeight,
      hostText: (host ? host.textContent : '').slice(0, 120),
    };
  });
  say('   suggested :', shown.names.map((n,i) => n + ' ' + (shown.pcts[i]||'')).join(' | ') || '(none)');
  say('   warnings  :', shown.warnTitles.join(' | ') || '(none)');

  // ── 2. Tap the first one ────────────────────────────────────────────────
  say('\n── 2. tapping the first suggestion ──');
  const before = await page.evaluate(() => ({
    dx: (document.getElementById('confirmedDx')||{}).value || '',
    labs: (window._wizState && window._wizState.labTests || []).slice(),
  }));
  await page.evaluate(() => { const b = document.querySelector('.it-pick'); if (b) b.click(); });
  await page.waitForTimeout(900);
  const after1 = await page.evaluate(() => ({
    dx: (document.getElementById('confirmedDx')||{}).value || '',
    labs: (window._wizState && window._wizState.labTests || []).slice(),
    tapDisabled: (document.getElementById('ucgOneTap')||{}).disabled,
    trayShown: (function(){ var t=document.getElementById('labSelectedTray');
      return t ? getComputedStyle(t).display + ' :: ' + t.textContent.trim().slice(0,80) : '(no tray)'; })(),
    chipsActive: [...document.querySelectorAll('.lab-chip.active')].map(c=>c.dataset.lab),
    feeLab: (document.getElementById('feeLab')||{}).value,
  }));
  say('   diagnosis :', JSON.stringify(before.dx), '→', JSON.stringify(after1.dx));
  say('   lab tests :', JSON.stringify(before.labs), '→', JSON.stringify(after1.labs));
  say('   one-tap button disabled?', after1.tapDisabled);
  say('   lab tray in the DOM :', after1.trayShown);
  say('   lab chips lit up    :', JSON.stringify(after1.chipsActive));
  say('   lab fee box         :', JSON.stringify(after1.feeLab));

  // ── 3. Change your mind and tap a DIFFERENT one ─────────────────────────
  say('\n── 3. changing the diagnosis to the second suggestion ──');
  await page.evaluate(() => {
    const bs = document.querySelectorAll('.it-pick');
    if (bs[1]) bs[1].click();
  });
  await page.waitForTimeout(900);
  const after2 = await page.evaluate(() => ({
    dx: (document.getElementById('confirmedDx')||{}).value || '',
    labs: (window._wizState && window._wizState.labTests || []).slice(),
  }));
  say('   diagnosis :', JSON.stringify(after1.dx), '→', JSON.stringify(after2.dx));
  say('   lab tests :', JSON.stringify(after1.labs), '→', JSON.stringify(after2.labs));
  if (after2.labs.length > after1.labs.length && after1.labs.length)
    say('   >> the first diagnosis\'s tests are STILL on the bill');

  // ── 4. The floating microphone's handoff into a fresh screen ────────────
  say('\n── 4. handoff from the floating microphone (fresh screen) ──');
  await page.evaluate(() => localStorage.setItem('homatt_speak_handoff', JSON.stringify({
    at: Date.now(), heard: 'the name is Achieng Mary she is 24 years old female with lower abdominal pain',
    dx: 'Pelvic inflammatory disease', name: 'Achieng Mary', sex: 'female', age: '24', ageUnit: 'years',
    chief: 'lower abdominal pain', subjective: 'lower abdominal pain for one week with vaginal discharge',
    background: '', vitals: { temp: '38.2', pulse: '96', sbp: '112', dbp: '70', weight: '' },
  })));
  await page.addInitScript(() => {
    window.__tapClicks = 0;
    document.addEventListener('click', function (e) {
      var t = e.target && e.target.closest && e.target.closest('#ucgOneTap');
      if (t) window.__tapClicks = (window.__tapClicks || 0) + 1;
    }, true);
  });
  await openIntake();
  await page.waitForTimeout(6000);
  const h = await page.evaluate(() => ({
    name: (document.getElementById('quickPatientName')||{}).value || '',
    chief: (document.getElementById('itChief')||{}).value || '',
    subj: (document.getElementById('itSubjective')||{}).value || '',
    age: (document.getElementById('itAge')||{}).value || '',
    temp: (document.getElementById('itTemp')||{}).value || '',
    dx: (document.getElementById('confirmedDx')||{}).value || '',
    sexOn: [...document.querySelectorAll('.it-sex-btn.on')].map(b => b.dataset.sex),
    left: localStorage.getItem('homatt_speak_handoff'),
    overlay: (function(){ var o=document.getElementById('ucgOverlay');
      return o ? getComputedStyle(o).display : '(no #ucgOverlay)'; })(),
    ask: (function(){ var o=document.getElementById('ucgAsk');
      return o ? getComputedStyle(o).display : '(no #ucgAsk)'; })(),
    tapDisabled: (document.getElementById('ucgOneTap')||{}).disabled,
    tapText: ((document.getElementById('ucgOneTap')||{}).textContent||'').trim().slice(0,60),
    clicks: window.__tapClicks || 0,
  }));
  say('   name  :', JSON.stringify(h.name));
  say('   chief :', JSON.stringify(h.chief));
  say('   age/sex:', h.age, h.sexOn.join(','));
  say('   temp  :', JSON.stringify(h.temp));
  say('   dx    :', JSON.stringify(h.dx));
  say('   payload left in localStorage?', h.left === null ? 'no (consumed)' : 'YES — ' + String(h.left).slice(0,40));
  say('   one-tap button:', JSON.stringify(h.tapText), 'disabled =', h.tapDisabled);
  say('   times it was clicked:', h.clicks);
  say('   #ucgOverlay display:', h.overlay, '   #ucgAsk display:', h.ask);

  // ── 5. Handoff onto a screen that already has a different patient ───────
  say('\n── 5. handoff onto a half-entered DIFFERENT patient ──');
  await openIntake();
  await fill('itChief', 'headache');
  await page.evaluate(() => {
    const e = document.getElementById('quickPatientName');
    if (e) { e.value = 'Okello John'; e.dispatchEvent(new Event('input', { bubbles: true })); }
    localStorage.setItem('homatt_speak_handoff', JSON.stringify({
      at: Date.now(), heard: 'x', dx: 'Malaria', name: 'Nakato Sarah', sex: 'female',
      age: '30', ageUnit: 'years', chief: 'fever', subjective: 'fever for three days',
      background: '', vitals: { temp: '39.5', pulse: '110', sbp: '', dbp: '', weight: '' },
    }));
    if (typeof window._speakHandoff === 'function') window._speakHandoff();
  });
  await page.waitForTimeout(2500);
  const m = await page.evaluate(() => ({
    name: (document.getElementById('quickPatientName')||{}).value || '',
    chief: (document.getElementById('itChief')||{}).value || '',
    subj: (document.getElementById('itSubjective')||{}).value || '',
    temp: (document.getElementById('itTemp')||{}).value || '',
    dx: (document.getElementById('confirmedDx')||{}).value || '',
  }));
  say('   name kept as Okello John?', m.name === 'Okello John', '→', JSON.stringify(m.name));
  say('   chief kept as headache?  ', m.chief === 'headache', '→', JSON.stringify(m.chief));
  say('   BUT the story arrived    :', JSON.stringify(m.subj));
  say('   and the temperature      :', JSON.stringify(m.temp));
  say('   and the diagnosis        :', JSON.stringify(m.dx));

  say('\n── page errors ──');
  say(errs.length ? errs.slice(0,8).join('\n  ') : '   none');
  say('── console errors ──');
  say(warns.length ? warns.slice(0,8).join('\n  ') : '   none');

  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
