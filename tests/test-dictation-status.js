// Knowing dictation has been cut off — from the settings screen, before a
// clinician meets a dead button with a patient in front of them.
//
// The property that matters is the one the clinic can act on: "the account is
// empty" must not read like "the network is slow". They are different problems
// with different fixes, and only one of them costs money to solve.
const APP = require('path').join(__dirname, '..', 'app');
const CHROME = process.env.HOMATT_CHROME ||
  require('./chrome').find();
const { chromium } = require('playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = APP;
const MIME = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.wasm':'application/wasm','.db':'application/octet-stream','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.json':'application/json'};
const server = http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(ROOT, p), (e, d) => {
    if (e) { rs.writeHead(404); rs.end('nf'); return; }
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    rs.end(d);
  });
});
const CID='11111111-1111-4111-8111-111111111111', UID='22222222-2222-4222-8222-222222222222';
const SB='https://kgkdiykzmqjougwzzewi.supabase.co';

(async () => {
  await new Promise(r => server.listen(8971, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 430, height: 950 }, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => {
    const u = r.request().url();
    if (u.startsWith('http://localhost:8971')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({ status: 200, headers: { 'Content-Type':'application/json','Access-Control-Allow-Origin':'*' }, body: '[]' });
    return r.abort();
  });

  await page.goto('http://localhost:8971/clinic/index.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([cid, uid]) => {
    localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({ staffName:'D', clinicName:'K', clinicId:cid, staffRole:'owner', userId:uid, level:'HC3' }));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({ access_token:'t', refresh_token:'r', token_type:'bearer', expires_in:3600, expires_at:Math.floor(Date.now()/1000)+3600, user:{id:uid} }));
  }, [CID, UID]);

  async function openSettings() {
    await page.goto('http://localhost:8971/clinic/settings.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#dictationCard', { timeout: 15000 });
  }

  await openSettings();
  const placed = await page.evaluate(() => {
    const c = document.getElementById('dictationCard');
    return { exists: !!c, hasBtn: !!document.getElementById('dictCheckBtn'),
             text: c ? c.textContent.replace(/\s+/g,' ').trim().slice(0, 70) : '' };
  });
  result('the settings screen has a place that answers "is dictation working?"',
    placed.exists && placed.hasBtn, placed.text);

  // Ask the server, with the server answering each of the ways it can.
  async function check(reply, status) {
    return page.evaluate(async ([r, st]) => {
      _supa = { functions: { invoke: async (name, req) => {
        window.__probe = { name, body: req && req.body };
        if (st && st >= 400) {
          return { data: null, error: { context: { json: async () => r } } };
        }
        return { data: r, error: null };
      } } };
      document.getElementById('dictCheckBtn').click();
      await new Promise(x => setTimeout(x, 300));
      return {
        dot: (document.getElementById('dictDot') || {}).className || '',
        msg: (document.getElementById('dictMsg') || {}).textContent || '',
        detail: (document.getElementById('dictDetail') || {}).textContent || '',
        asked: window.__probe,
      };
    }, [reply, status || 200]);
  }

  const working = await check({
    checked: true, ok: true, kind: '',
    message: 'Dictation is working. $42.10 left on the account.',
    providers: [{ name: 'deepgram', ok: true, kind: '', balance: 42.1,
                  message: 'Dictation is working. $42.10 left on the account.' }],
  });
  result('a working service says so, and says what is left on the account',
    / ok\b/.test(working.dot) && /\$42\.10/.test(working.msg),
    working.dot + ' · ' + working.msg.slice(0, 60));
  result('it asks the transcribe function, and sends no audio to do it',
    working.asked && working.asked.name === 'transcribe' &&
    working.asked.body && working.asked.body.probe === true,
    JSON.stringify(working.asked));

  const low = await check({
    checked: true, ok: true, kind: 'low',
    message: 'Dictation is working, but only $3.20 is left on the Deepgram ' +
             'account. Top it up before it runs out.',
    providers: [{ name: 'deepgram', ok: true, kind: 'low', balance: 3.2,
                  message: 'running low' }],
  });
  result('a thin balance is a warning while dictation still works',
    / low\b/.test(low.dot) && /top it up/i.test(low.msg),
    low.dot + ' · ' + low.msg.slice(0, 60));

  const empty = await check({
    checked: true, ok: false, kind: 'credit',
    message: 'The Deepgram account is empty. Dictation will not work until it ' +
             'is topped up.',
    providers: [{ name: 'deepgram', ok: false, kind: 'credit', balance: 0,
                  message: 'The Deepgram account is empty.' }],
  }, 200);
  result('an empty account is shown as cut off, not as a glitch',
    / bad\b/.test(empty.dot) && /empty/i.test(empty.msg) &&
    !/try again/i.test(empty.msg),
    empty.dot + ' · ' + empty.msg.slice(0, 60));

  const unset = await check({
    checked: true, ok: false, kind: 'unconfigured',
    message: 'Dictation is not set up on this server. Set DEEPGRAM_API_KEY in ' +
             'Supabase secrets.',
    providers: [],
  }, 503);
  result('a key that was never set is told apart from one that ran out',
    /not set up/i.test(unset.msg) && /DEEPGRAM_API_KEY/.test(unset.msg),
    unset.msg.slice(0, 70));

  const revoked = await check({
    checked: true, ok: false, kind: 'auth',
    message: 'The dictation key was refused. It may have been revoked or ' +
             'replaced — type the readings for now.',
    providers: [{ name: 'deepgram', ok: false, kind: 'auth',
                  message: 'The dictation key was refused.' }],
  }, 200);
  result('a revoked key says the key is the problem',
    / bad\b/.test(revoked.dot) && /revoked|refused/i.test(revoked.msg),
    revoked.msg.slice(0, 60));

  // What the clinician's own phone last ran into.
  const remembered = await page.evaluate(async () => {
    localStorage.setItem('homatt_dictation_fault', JSON.stringify({
      kind: 'credit', at: '2026-09-04T09:15:00.000Z',
      message: 'The dictation account is out of credit.' }));
    return true;
  });
  await openSettings();
  const onLoad = await page.evaluate(() => ({
    dot: (document.getElementById('dictDot') || {}).className || '',
    msg: (document.getElementById('dictMsg') || {}).textContent || '',
    detail: (document.getElementById('dictDetail') || {}).textContent || '',
    shown: getComputedStyle(document.getElementById('dictDetail')).display,
  }));
  result('a failure this phone already hit is shown without being asked',
    remembered && / bad\b/.test(onLoad.dot) && /out of credit/i.test(onLoad.detail) &&
    onLoad.shown !== 'none',
    onLoad.msg.slice(0, 50) + ' · ' + onLoad.detail.slice(0, 50));

  // Offline it must say so rather than reporting the service as broken.
  const offline = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => false, configurable: true });
    document.getElementById('dictCheckBtn').click();
    await new Promise(x => setTimeout(x, 250));
    return { dot: (document.getElementById('dictDot') || {}).className || '',
             msg: (document.getElementById('dictMsg') || {}).textContent || '' };
  });
  result('with no connection it says so, instead of blaming the account',
    /offline/i.test(offline.msg) && !/empty|credit/i.test(offline.msg),
    offline.msg.slice(0, 70));

  // Readable in both themes and all four skins — the same fault that hid the
  // payment sheet and the patient record earlier.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  });
  const contrast = [];
  for (const skin of ['forest', 'midnight', 'dark', 'clay']) {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(([s, t]) => {
        document.documentElement.setAttribute('data-skin', s);
        document.documentElement.setAttribute('data-theme', t);
      }, [skin, theme]);
      await page.waitForTimeout(60);
      const r = await page.evaluate(() => {
        const lum = (c) => {
          const m = c.match(/[\d.]+/g).map(Number);
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
          return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
        };
        // Composite translucent layers over what is behind them, the way the
        // browser paints. Reading rgba(255,255,255,.06) as opaque white makes
        // a readable dark input look like a contrast failure — and, worse,
        // could make a real one look fine.
        const rgb = (c) => { const m = (c || '').match(/[\d.]+/g); return m ? m.map(Number) : null; };
        const bgOf = (el) => {
          let n = el; const layers = [];
          while (n && n !== document.documentElement) {
            const c = rgb(getComputedStyle(n).backgroundColor);
            if (c) { const a = c.length > 3 ? c[3] : 1;
              if (a > 0) { layers.push([c[0], c[1], c[2], a]); if (a >= 1) break; } }
            n = n.parentElement;
          }
          const base = rgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];
          let out = [base[0], base[1], base[2]];
          for (let i = layers.length - 1; i >= 0; i--) {
            const [r, g, b, a] = layers[i];
            out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
          }
          return 'rgb(' + out.join(', ') + ')';
        };
        const ratio = (el) => {
          const a = lum(getComputedStyle(el).color), c = lum(bgOf(el));
          return (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
        };
        const out = {};
        [['msg', 'dictMsg'], ['detail', 'dictDetail'], ['btn', 'dictCheckBtn']]
          .forEach(([k, id]) => { const e = document.getElementById(id); if (e) out[k] = ratio(e); });
        const note = document.querySelector('.dict-note');
        if (note) out.note = ratio(note);
        return out;
      });
      Object.entries(r).forEach(([k, v]) => {
        if (v < 4.5) contrast.push(`${skin}/${theme} ${k}=${v.toFixed(2)}`);
      });
    }
  }
  result('every word of it is readable in all four looks, light and dark',
    contrast.length === 0, contrast.slice(0, 4).join(' · '));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
