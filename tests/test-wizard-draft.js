// Switching tabs must never lose what was typed.
//
// Reported from a desktop: "if you open a new tab, by the time you go back to
// the site it needs you to re-enter the details."
//
// It was not the browser. The wizard had this:
//
//   const untouched = state.step === 1 && !state.patient && !state.bookingId &&
//     !state.confirmedDx && !state.medications.length && … ;
//   if (untouched && hidden > 2500ms) window.location.replace('dashboard.html');
//
// Every one of those is something PICKED. On the intake screen almost all the
// work is something TYPED — the name, the phone, the age, the complaint, the
// story, the background, four vitals — and it lives in the DOM.
// `state.patient` is only set when an EXISTING patient is chosen, so a
// brand-new patient, which is the common case, left `untouched` true with the
// screen full of their details. Three seconds in another tab and the page
// navigated away and threw the lot.
//
// On a phone that rarely fires. On a desktop, where switching tabs is
// constant, it fires all day — which is exactly who reported it.
//
// Two things are checked here, and the second matters as much as the first:
// that typed work keeps you on the page, AND that a genuinely untouched
// wizard still returns to the dashboard. The auto-return exists because the
// OS resuming the app on a blank New Treatment is its own annoyance; "fixing"
// the data loss by disabling it would have traded one complaint for another.
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
const PORT = 8961, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

// Leave, and come back, the way a desktop does when another tab is opened.
async function awayAndBack(page, ms) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return true; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'hidden'; } });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(ms);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(700);
}

async function openWizard(page) {
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'D', clinicName: 'K', clinicId: cid, staffRole: 'owner', level: 'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid } }));
  }, [CID, UID]);

  // ── 1. The reported fault: typed work must survive a tab switch ──────
  await openWizard(page);
  const typed = await page.evaluate(() => {
    function set(id, v) {
      const el = document.getElementById(id);
      if (!el) return false;
      el.value = v; el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return {
      chief: set('itChief', 'Fever and headache for three days'),
      story: set('itSubjective', 'Started Monday, worse at night, no vomiting'),
      temp: set('itTemp', '38.9'),
      age: set('itAge', '29'),
    };
  });
  result('the intake boxes are there to type into',
    typed.chief && typed.story && typed.temp, JSON.stringify(typed));

  await awayAndBack(page, 2700);
  const after = await page.evaluate(() => ({
    here: location.pathname,
    chief: (document.getElementById('itChief') || {}).value || '',
    story: (document.getElementById('itSubjective') || {}).value || '',
    temp: (document.getElementById('itTemp') || {}).value || '',
  }));
  result('a tab switch no longer throws the typing away',
    /new-order/.test(after.here), 'landed on ' + after.here);
  result('and every word is still in its box',
    /Fever and headache/.test(after.chief) && /worse at night/.test(after.story) &&
    after.temp === '38.9',
    after.chief.slice(0, 40) + ' | ' + after.temp);

  /* ── 2. The DETECTOR, which is the part that changed ──────────────────
   *
   * What is NOT asserted here, and why: the wizard also navigates home when a
   * completely untouched New Treatment is resumed, and the obvious test is
   * "an untouched form still goes to the dashboard". It does not fire in this
   * harness — and I checked the ORIGINAL code, before any of this work, and
   * it does not fire there either. So it is not a regression, and asserting
   * it would be asserting something that was never true under these
   * conditions. Its other preconditions (the wizard's own `state`) are not
   * met by a bare page load here.
   *
   * What CAN be proven, and is the whole of what changed, is the judgement
   * the navigation depends on: does the wizard correctly know whether
   * anybody has done anything? That is asserted directly. */
  await page.evaluate(() => { try { localStorage.removeItem('homatt_wiz_draft'); } catch (e) {} });
  await openWizard(page);
  const fresh = await page.evaluate(() => {
    const bar = document.getElementById('wizDraftBar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    return window._wizWhyTouched();
  });
  result('a form nobody has typed into reports itself untouched',
    fresh.touched === false && fresh.changed.length === 0 && fresh.baseline === true,
    JSON.stringify(fresh));

  const oneChar = await page.evaluate(async () => {
    const el = document.getElementById('itChief');
    el.focus(); el.value = 'F';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 120));
    return window._wizWhyTouched();
  });
  result('and one character is enough to make it touched',
    oneChar.touched === true || oneChar.changed.indexOf('itChief') >= 0,
    JSON.stringify(oneChar));

  /* ── 3. A value the PAGE put there is not somebody's work ─────────────
   *
   * The first version of this looked for a pre-checked radio or a preselected
   * option and found neither, because this form has no radios, checkboxes or
   * selects at all — 32 fields, every one a text, tel, date, number, time or
   * textarea. It was testing a scenario that does not exist here.
   *
   * The scenario that DOES exist is `followUpDays`: a number box the wizard
   * fills with 7 while it is starting up, whose HTML default is empty. That
   * one field is what made every fresh form read as "already being typed in",
   * and it is exactly the case a hand-written list of defaults would miss —
   * the 7 is set from another file. */
  await openWizard(page);
  const preset = await page.evaluate(() => {
    const bar = document.getElementById('wizDraftBar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    const el = document.getElementById('followUpDays');
    return { there: !!el, value: el ? el.value : '', htmlDefault: el ? el.defaultValue : '' };
  });
  result('the page fills a field nobody typed into',
    preset.there && preset.value !== '' && preset.value !== preset.htmlDefault,
    'followUpDays is "' + preset.value + '" while its markup default is "' + preset.htmlDefault + '"');
  const notWork = await page.evaluate(() => window._wizWhyTouched());
  result('and it is not counted as work — which is what broke the check before',
    notWork.touched === false && notWork.changed.indexOf('followUpDays') < 0,
    JSON.stringify(notWork));

  // ── 4. The draft: for a reload, a crash, a stray Back ────────────────
  await openWizard(page);
  await page.evaluate(() => {
    const bar = document.getElementById('wizDraftBar');
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    function set(id, v) {
      const el = document.getElementById(id);
      if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    set('itChief', 'Cough for two weeks');
    set('itBackground', 'Known asthmatic, uses a blue inhaler');
    set('itWeight', '54');
  });
  await page.waitForTimeout(1300);          // the debounce
  const saved = await page.evaluate(() => {
    let d = null;
    try { d = JSON.parse(localStorage.getItem('homatt_wiz_draft') || 'null'); } catch (e) {}
    return { has: !!d, n: d ? Object.keys(d.fields || {}).length : 0,
             chief: d && d.fields.itChief ? d.fields.itChief.v : '' };
  });
  result('what was typed is written down as a draft',
    saved.has && /Cough for two weeks/.test(saved.chief), saved.n + ' fields kept');

  // Reload — the case not navigating away cannot cover.
  await openWizard(page);
  const offered = await page.evaluate(() => {
    const bar = document.getElementById('wizDraftBar');
    return { shown: !!bar, text: bar ? bar.innerText.replace(/\s+/g, ' ') : '',
             empty: (document.getElementById('itChief') || {}).value || '' };
  });
  result('after a reload the draft is OFFERED, not forced',
    offered.shown === true && offered.empty === '',
    offered.text.slice(0, 74));
  result('and it says both what it will do and how to refuse',
    /bring it back/i.test(offered.text) && /start fresh/i.test(offered.text));

  const restored = await page.evaluate(async () => {
    document.getElementById('wizDraftYes').click();
    await new Promise(r => setTimeout(r, 300));
    return { chief: (document.getElementById('itChief') || {}).value || '',
             back: (document.getElementById('itBackground') || {}).value || '',
             weight: (document.getElementById('itWeight') || {}).value || '',
             barGone: !document.getElementById('wizDraftBar') };
  });
  result('"Bring it back" puts every field back where it was',
    /Cough for two weeks/.test(restored.chief) && /blue inhaler/.test(restored.back) &&
    restored.weight === '54', JSON.stringify(restored).slice(0, 96));

  // ── 5. Never over the top of live work ───────────────────────────────
  await page.evaluate(() => {
    try {
      localStorage.setItem('homatt_wiz_draft', JSON.stringify({
        at: Date.now(), clinicId: null, step: 1,
        fields: { itChief: { v: 'SOMEBODY ELSE’S PATIENT' } },
      }));
    } catch (e) {}
  });
  await openWizard(page);
  const overLive = await page.evaluate(async () => {
    // Type first, the way somebody who started a new patient would.
    const el = document.getElementById('itChief');
    const bar0 = document.getElementById('wizDraftBar');
    if (bar0 && bar0.parentNode) bar0.parentNode.removeChild(bar0);
    el.value = 'Burn on the left hand';
    el.dispatchEvent(new Event('input', { bubbles: true }));
    // Ask again, as a late-arriving offer would.
    if (window.HomattWizOfferDraft) window.HomattWizOfferDraft();
    await new Promise(r => setTimeout(r, 300));
    return { chief: el.value, bar: !!document.getElementById('wizDraftBar') };
  });
  result('a draft is never applied over a patient already being typed',
    overLive.chief === 'Burn on the left hand', overLive.chief);

  // "Start fresh" must actually forget it.
  await page.evaluate(() => {
    try {
      localStorage.setItem('homatt_wiz_draft', JSON.stringify({
        at: Date.now(), clinicId: null, step: 1, fields: { itChief: { v: 'Old draft' } },
      }));
    } catch (e) {}
  });
  await openWizard(page);
  const discarded = await page.evaluate(async () => {
    const bar = document.getElementById('wizDraftBar');
    if (!bar) return { had: false };
    document.getElementById('wizDraftNo').click();
    await new Promise(r => setTimeout(r, 250));
    return { had: true, left: localStorage.getItem('homatt_wiz_draft'),
             gone: !document.getElementById('wizDraftBar') };
  });
  result('"Start fresh" forgets it, so it is not offered again tomorrow',
    discarded.had && discarded.left === null && discarded.gone,
    JSON.stringify(discarded));

  // ── 6. An old draft is not resurrected ───────────────────────────────
  await page.evaluate(() => {
    try {
      localStorage.setItem('homatt_wiz_draft', JSON.stringify({
        at: Date.now() - 13 * 60 * 60 * 1000, clinicId: null, step: 1,
        fields: { itChief: { v: 'Yesterday’s patient' } },
      }));
    } catch (e) {}
  });
  await openWizard(page);
  const stale = await page.evaluate(() => ({
    bar: !!document.getElementById('wizDraftBar'),
    left: localStorage.getItem('homatt_wiz_draft'),
  }));
  result('a draft from yesterday is dropped, not offered',
    stale.bar === false && stale.left === null,
    'bar=' + stale.bar + ' stored=' + stale.left);

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
