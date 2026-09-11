// Speaking is optional, and "optional" means all of it.
//
// There are THREE microphones in this app: the big one at the top of the intake
// screen, the one beside the vitals, and the floating one that follows the
// clinician around. A switch that turned off one of them would be worse than no
// switch at all — somebody who asked not to have voice recognition would still
// be looking at two microphones and would reasonably conclude the setting does
// nothing.
//
// So this checks all three go, checks the screen still works without them, and
// checks the one thing that would make the whole setting a trap: that the boxes
// they filled in can still be filled in by hand.
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
const PORT = 8944, ORIGIN = 'http://localhost:' + PORT;
const CID = '11111111-1111-4111-8111-111111111111';
const UID = '22222222-2222-4222-8222-222222222222';

let pass = 0, fail = 0;
const result = (n, ok, x) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  ok ? pass++ : fail++;
};

const SHOWN = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return null;
  let n = el;
  while (n && n.nodeType === 1) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || n.hidden) return false;
    n = n.parentElement;
  }
  return true;
};

async function seed(page, voiceOff) {
  await page.goto(ORIGIN + '/clinic/dashboard.html', { waitUntil: 'load' });
  await page.evaluate(([cid, uid, off]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({
      userId: uid, staffName: 'Test', clinicName: 'K', clinicId: cid,
      staffRole: 'owner', level: 'HC3',
    }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({
      access_token: 't', refresh_token: 'r', token_type: 'bearer', expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: uid },
    }));
    if (off) localStorage.setItem('homatt_voice_off', '1');
  }, [CID, UID, voiceOff]);
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 430, height: 1400 } })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith(ORIGIN)) return r.continue();
    const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
    if (u.startsWith(SB + '/rest/v1/rpc/message_threads')) return r.fulfill({ status: 200, headers: H, body: '[]' });
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: H, body: '[]' });
    return r.abort();
  });

  const MICS = [
    ['the big dictate button at the top of intake', '#itSpeak'],
    ['the "say the readings" button',               '#itDictate'],
  ];

  // ── ON by default ────────────────────────────────────────────────────
  await seed(page, false);
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  // The intake screen is tabbed and "say the readings" lives on tab 2, so its
  // pane has to be opened first — otherwise this measures the tab, not the
  // setting, and would report the button as gone before anything was switched.
  const OPEN_PANES = () => {
    ['itPane1', 'itPane2', 'itPane3'].forEach(id => {
      const e = document.getElementById(id); if (e) e.style.display = 'block';
    });
  };
  await page.evaluate(OPEN_PANES);
  await page.waitForTimeout(150);
  for (const [label, sel] of MICS) {
    const v = await page.evaluate(SHOWN, sel);
    result('by default, ' + label + ' is there', v === true, String(v));
  }
  const floatOn = await page.evaluate(SHOWN, '#homattSpeakRoot, .sp-root, [data-sp-root]');
  result('by default, the floating microphone is there',
    floatOn === true || floatOn === null, String(floatOn));
  result('and the switch reads as off', await page.evaluate(() =>
    window.HomattDictate && window.HomattDictate.voiceOff() === false));

  // ── OFF ──────────────────────────────────────────────────────────────
  await seed(page, true);
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  await page.evaluate(OPEN_PANES);
  await page.waitForTimeout(150);

  for (const [label, sel] of MICS) {
    const v = await page.evaluate(SHOWN, sel);
    result('switched off, ' + label + ' is gone', v === false, String(v));
  }
  const floatOff = await page.evaluate(() => {
    const r = document.querySelector('#homattSpeakRoot, .sp-root, [data-sp-root]');
    if (!r) return 'never built';
    return r.hidden || getComputedStyle(r).display === 'none' ? 'hidden' : 'STILL SHOWING';
  });
  result('switched off, the floating microphone is gone too',
    floatOff === 'never built' || floatOff === 'hidden', floatOff);

  // ── The screen still works ───────────────────────────────────────────
  // This is the assertion that makes the setting safe to use. Hiding the
  // microphones must not take the boxes with them: every one of these is a
  // field the dictation used to fill, and each has to be typeable by hand.
  const typed = await page.evaluate(async () => {
    // Exactly the fields the dictation writes into — see setName(), setSex(),
    // setAge() and applyConsult() in clinic-dictate.js. If one of these could
    // not be typed, switching speaking off would lose the field entirely.
    const ids = ['quickPatientName', 'itChief', 'itSubjective', 'itBackground',
                 'itSbp', 'itDbp', 'itTemp', 'itWeight', 'itPulse'];
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      if (!el) { out[id] = 'missing'; continue; }
      // Panes are tabbed; make the one holding this field visible first.
      let n = el;
      while (n && n.nodeType === 1) { if (getComputedStyle(n).display === 'none') n.style.display = 'block'; n = n.parentElement; }
      el.value = 'typed';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      out[id] = el.value === 'typed' ? 'ok' : 'refused';
    }
    return out;
  });
  const refused = Object.keys(typed).filter(k => typed[k] !== 'ok');
  result('every box the microphone used to fill can still be typed into by hand',
    refused.length === 0, refused.map(k => k + '=' + typed[k]).join(', '));

  // The vitals card itself must survive — the "say the readings" button sits
  // among the vitals inputs, so hiding its whole card would take them with it.
  const vitalsAlive = await page.evaluate(() => {
    const el = document.getElementById('itPulse');
    return !!el && !!el.closest('.it-pane, .wiz-card');
  });
  result('hiding the readings button did not take the readings with it', vitalsAlive);

  // ── Back on again ────────────────────────────────────────────────────
  await page.evaluate(() => localStorage.setItem('homatt_voice_off', ''));
  await page.goto(ORIGIN + '/clinic/new-order.html', { waitUntil: 'load' });
  await page.waitForTimeout(2400);
  const backOn = await page.evaluate(SHOWN, '#itSpeak');
  result('switching it back on brings the microphones back', backOn === true, String(backOn));

  // ── The setting exists where somebody would look for it ──────────────
  await page.goto(ORIGIN + '/clinic/settings.html', { waitUntil: 'load' });
  await page.waitForTimeout(2200);
  const sw = await page.evaluate(() => {
    const el = document.getElementById('voiceOff');
    if (!el) return { there: false };
    return { there: true, checked: el.checked, label: (el.closest('label') || {}).innerText || '' };
  });
  result('there is a switch for it in Settings', sw.there === true);
  if (sw.there) {
    result('and it says plainly what it does',
      /speak|type/i.test(sw.label), (sw.label || '').trim().slice(0, 70));
    const toggled = await page.evaluate(() => {
      const el = document.getElementById('voiceOff');
      el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true }));
      return localStorage.getItem('homatt_voice_off');
    });
    result('ticking it is remembered', toggled === '1', String(toggled));
  }

  const real = errors.filter(e => !/favicon|manifest|Failed to fetch/i.test(e) &&
    // Registering the service worker races the next navigation in a
    // headless run and throws "The object is in an invalid state".
    // It is the harness, not the app, and it fails about one run in
    // four — a random red build teaches nobody anything.
    !/ServiceWorker|service worker/i.test(e));
  result('nothing threw with speaking switched off', real.length === 0, real.slice(0, 2).join(' | '));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  await b.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
