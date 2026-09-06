// Speaking comes first, and the phone shows it is listening.
//
// Three things a clinician standing in front of a patient needs:
//   1. the button is the FIRST thing on the intake screen, before the name
//   2. while it is recording, something on screen MOVES with their voice — a
//      label alone looks identical on a dead microphone
//   3. when it will not work, the message names the actual fault and the way
//      round it. "Could not reach the dictation service" for a function that
//      was never deployed sends a clinic to look at their internet for a week.
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

(async () => {
  await new Promise(r => server.listen(8963, r));
  const b = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport:{width:430,height:950}, hasTouch:true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message.split('\n')[0]));
  const result = (n, ok, x) => console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  await page.route('**/*', r => { const u = r.request().url();
    if (u.startsWith('http://localhost:8963')) return r.continue();
    if (u.startsWith(SB)) return r.fulfill({status:200,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'*'},body:'[]'});
    return r.abort(); });

  await page.goto('http://localhost:8963/clinic/index.html');
  await page.evaluate(([cid,uid]) => { localStorage.clear();
    localStorage.setItem('clinic_session', JSON.stringify({staffName:'D',clinicName:'K',clinicId:cid,staffRole:'owner',userId:uid,level:'HC3'}));
    localStorage.setItem('sb-homatt-clinic-auth', JSON.stringify({access_token:'t',refresh_token:'r',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user:{id:uid}}));
  }, [CID,UID]);
  await page.goto('http://localhost:8963/clinic/new-order.html');
  await page.waitForSelector('#itDictateStory', { timeout: 20000 });

  // ── 1. First on the screen ───────────────────────────────────────────────
  const order = await page.evaluate(() => {
    const y = id => { const e = document.getElementById(id);
      if (!e || e.offsetParent === null && getComputedStyle(e).display === 'none') return null;
      return e.getBoundingClientRect().top + window.scrollY; };
    return { speak: y('itDictateStory'), name: y('quickPatientName'),
             chief: y('itChief'), tabs: y('itTab1'),
             inPane1: !!(document.getElementById('itPane1') || {})
               .contains?.(document.getElementById('itDictateStory')) };
  });
  result('the dictate button comes before the patient\'s name',
    order.speak !== null && order.name !== null && order.speak < order.name,
    'speak ' + Math.round(order.speak) + ' · name ' + Math.round(order.name));
  result('and before the complaint and the tabs, so it is the first thing done',
    order.speak < order.chief && order.speak < order.tabs,
    'chief ' + Math.round(order.chief) + ' · tabs ' + Math.round(order.tabs));
  result('it is no longer buried inside the complaint tab',
    order.inPane1 === false);

  // ── 2. It shows that it is listening, and the bars move with the sound ───
  const listening = await page.evaluate(async () => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
    // A real MediaStream from an oscillator, so the analyser has something to
    // read — a stubbed stream would let a broken meter pass.
    const ac = new AudioContext();
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    gain.gain.value = 0.9;
    const dest = ac.createMediaStreamDestination();
    osc.connect(gain); gain.connect(dest); osc.frequency.value = 220; osc.start();
    navigator.mediaDevices.getUserMedia = async () => dest.stream;
    window.MediaRecorder = function () {
      this.state='recording'; this.start=()=>{};
      this.stop=()=>{ this.state='inactive';
        if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
        if(this.onstop) this.onstop(); };
    };
    window._getClinicSupabase = () => ({ functions: { invoke: async () =>
      ({ data: { text: 'complains of fever' } }) } });

    const btn = document.getElementById('itDictateStory');
    btn.click();
    await new Promise(r => setTimeout(r, 700));
    const live = document.getElementById('itDictateLive');
    const bars = [...document.querySelectorAll('#itDictateBars i')];
    const shown = live && !live.hidden && getComputedStyle(live).display !== 'none';
    const scales = () => bars.map(x => x.style.transform || '');
    const first = scales();
    await new Promise(r => setTimeout(r, 600));
    const second = scales();
    const time = (document.getElementById('itDictateTime') || {}).textContent || '';
    const btnOn = btn.classList.contains('on');
    // stop
    btn.click();
    await new Promise(r => setTimeout(r, 500));
    const after = document.getElementById('itDictateLive');
    try { osc.stop(); ac.close(); } catch (e) {}
    return { shown, bars: bars.length, first, second, time, btnOn,
             hiddenAfter: !!after.hidden };
  });
  result('while it records, the screen says so and the button is lit',
    listening.shown && listening.btnOn,
    'shown=' + listening.shown + ' lit=' + listening.btnOn);
  result('a row of bars moves with the sound coming in, not on a timer',
    listening.bars >= 5 &&
    listening.first.some(s => /scaleY/.test(s)) &&
    listening.first.join('|') !== listening.second.join('|'),
    listening.first.slice(0, 3).join(' ') + '  →  ' + listening.second.slice(0, 3).join(' '));
  result('the seconds are counted so a long dictation is visible',
    /^\d+:\d\d$/.test(listening.time), listening.time);
  result('and all of it goes away the moment recording stops',
    listening.hiddenAfter === true);

  // ── 3. The microphone being refused says what to do about it ────────────
  async function micFails(name) {
    return page.evaluate(async (n) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.permissions = undefined;
      navigator.mediaDevices.getUserMedia = async () => {
        const e = new Error('nope'); e.name = n; throw e;
      };
      document.getElementById('itDictateStory').click();
      await new Promise(r => setTimeout(r, 300));
      return { said: (document.getElementById('itDictateStorySay')||{}).textContent || '',
               live: !!(document.getElementById('itDictateLive')||{}).hidden };
    }, name);
  }
  const refused = await micFails('NotAllowedError');
  result('a refused microphone says where to turn it back on',
    /Settings/.test(refused.said) && /Microphone/i.test(refused.said) &&
    refused.live === true,
    refused.said.slice(0, 95));

  const busy = await micFails('NotReadableError');
  result('a microphone another app is holding is told apart from a refusal',
    /used by something else|end the call/i.test(busy.said) &&
    !/Settings/.test(busy.said), busy.said.slice(0, 80));

  const none = await micFails('NotFoundError');
  result('a phone with no microphone says so instead of asking for permission',
    /no microphone/i.test(none.said), none.said.slice(0, 70));

  // ── 4. The server fault is named, not guessed ───────────────────────────
  async function serverSays(status, body) {
    return page.evaluate(async ([st, bd]) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
      window.MediaRecorder = function () {
        this.state='recording'; this.start=()=>{};
        this.stop=()=>{ this.state='inactive';
          if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
          if(this.onstop) this.onstop(); };
      };
      window._getClinicSupabase = () => ({ functions: { invoke: async () => ({
        data: null,
        error: { context: { status: st, json: async () => {
          if (bd === null) throw new Error('no json'); return bd; } } },
      }) } });
      const btn = document.getElementById('itDictateStory');
      btn.click(); await new Promise(r => setTimeout(r, 60));
      btn.click(); await new Promise(r => setTimeout(r, 450));
      return { said: (document.getElementById('itDictateStorySay')||{}).textContent || '',
               stored: localStorage.getItem('homatt_dictation_fault') || '' };
    }, [status, body]);
  }

  // This is the one in the screenshot: the Edge Function is not deployed.
  const notThere = await serverSays(404, { error: 'Requested function was not found' });
  result('a function that was never deployed says it is not set up, not "no network"',
    /not been switched on|not set up/i.test(notThere.said) &&
    !/Could not reach/i.test(notThere.said) &&
    /"kind":"unconfigured"/.test(notThere.stored),
    notThere.said.slice(0, 95));
  result('and it does not repeat the gateway\'s own words at a nurse',
    !/Requested function was not found/.test(notThere.said),
    notThere.said.slice(0, 60));

  const noKey = await serverSays(503, {
    error: 'Dictation is not configured on this server. Set DEEPGRAM_API_KEY or ' +
           'OPENAI_API_KEY in Supabase secrets.', kind: 'unconfigured' });
  result('a deployed function with no key says which secret is missing',
    /DEEPGRAM_API_KEY/.test(noKey.said), noKey.said.slice(0, 80));

  const signedOut = await serverSays(401, null);
  result('an expired session says to sign in, not that the account is empty',
    /signed out/i.test(signedOut.said) && !/credit/i.test(signedOut.said),
    signedOut.said.slice(0, 70));

  const brokeDown = await serverSays(500, null);
  result('a server fault at their end is not blamed on the clinic\'s connection',
    /at its end/i.test(brokeDown.said), brokeDown.said.slice(0, 70));

  // ── The case that actually happened, and was invisible ──────────────────
  // A function that was never deployed answers 404 from the gateway with no
  // CORS headers, so the browser hides it and fetch() just rejects — exactly
  // like a dead connection. The app has to tell them apart by asking whether
  // Supabase itself is reachable.
  async function noStatusWith(supabaseUp) {
    return page.evaluate(async (up) => {
      Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
      navigator.mediaDevices.getUserMedia = async () => ({ getTracks: () => [{ stop(){} }] });
      window.MediaRecorder = function () {
        this.state='recording'; this.start=()=>{};
        this.stop=()=>{ this.state='inactive';
          if(this.ondataavailable) this.ondataavailable({data:new Blob(['x'])});
          if(this.onstop) this.onstop(); };
      };
      // The CORS-blocked failure: an error with no readable status at all.
      window._getClinicSupabase = () => ({ functions: { invoke: async () => ({
        data: null, error: new TypeError('Failed to fetch'),
      }) } });
      // and whether a plain reachability check gets through
      const realFetch = window.fetch;
      window.__probed = null;
      window.fetch = function (u, o) {
        if (String(u).indexOf('/auth/v1/health') >= 0) {
          window.__probed = String(u);
          return up ? Promise.resolve(new Response(null, { status: 200 }))
                    : Promise.reject(new TypeError('Failed to fetch'));
        }
        return realFetch.apply(this, arguments);
      };
      const btn = document.getElementById('itDictateStory');
      btn.click(); await new Promise(r => setTimeout(r, 60));
      btn.click(); await new Promise(r => setTimeout(r, 600));
      window.fetch = realFetch;
      return { said: (document.getElementById('itDictateStorySay')||{}).textContent || '',
               stored: localStorage.getItem('homatt_dictation_fault') || '',
               probed: window.__probed };
    }, supabaseUp);
  }

  const serverUpFnMissing = await noStatusWith(true);
  result('a server that answers but has no transcribe function says exactly that',
    /not been switched on|never installed|not installed/i.test(serverUpFnMissing.said) &&
    !/Could not reach/i.test(serverUpFnMissing.said) &&
    /"kind":"unconfigured"/.test(serverUpFnMissing.stored),
    serverUpFnMissing.said.slice(0, 100));
  result('it works that out by asking whether Supabase answers at all',
    /\/auth\/v1\/health$/.test(serverUpFnMissing.probed || ''),
    String(serverUpFnMissing.probed));

  const genuinelyOffline = await noStatusWith(false);
  result('and a phone that truly cannot reach the server is still told so',
    /Could not reach/i.test(genuinelyOffline.said) &&
    /type it in/i.test(genuinelyOffline.said) &&
    /"kind":"unreachable"/.test(genuinelyOffline.stored),
    genuinelyOffline.said.slice(0, 70));

  const outOfCredit = await serverSays(402, {
    error: 'The dictation account is out of credit. Dictation will not work ' +
           'until it is topped up — type the readings for now.', kind: 'credit' });
  result('an empty account still says so plainly, as before',
    /out of credit/i.test(outOfCredit.said) && /"kind":"credit"/.test(outOfCredit.stored),
    outOfCredit.said.slice(0, 70));

  // ── 5. Readable, in all four looks ──────────────────────────────────────
  const contrast = [];
  for (const skin of ['forest','midnight','dark','clay']) {
    for (const theme of ['light','dark']) {
      await page.evaluate(([s,t]) => {
        document.documentElement.setAttribute('data-skin', s);
        document.documentElement.setAttribute('data-theme', t);
        const l = document.getElementById('itDictateLive');
        if (l) l.hidden = false;               // measure it as it appears
      }, [skin, theme]);
      await page.waitForTimeout(70);
      const bad = await page.evaluate(() => {
        const lum = c => { const m = c.match(/[\d.]+/g).map(Number);
          const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
          return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); };
        const bgOf = el => { let n = el;
          while (n && n !== document.documentElement) {
            const c = getComputedStyle(n).backgroundColor;
            if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c;
            n = n.parentElement; }
          return getComputedStyle(document.body).backgroundColor; };
        const ratio = el => { const a = lum(getComputedStyle(el).color), c = lum(bgOf(el));
          return (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05); };
        const out = {};
        const add = (k, sel) => { const e = document.querySelector(sel);
          if (e && e.offsetParent !== null) out[k] = ratio(e); };
        add('title', '.it-speak-h b');
        add('sub', '.it-speak-h i');
        add('button', '#itDictateStory');
        add('time', '#itDictateTime');
        add('hint', '.it-live-hint');
        add('say', '#itDictateStorySay');
        return out;
      });
      Object.entries(bad).forEach(([k,v]) => {
        if (v < 4.5) contrast.push(`${skin}/${theme} ${k}=${v.toFixed(2)}`);
      });
    }
  }
  result('every word of the speak panel is readable in all four looks',
    contrast.length === 0, contrast.slice(0, 5).join(' · '));

  // The lit button is a different colour again — measure that too.
  const litOk = [];
  for (const skin of ['forest','midnight','dark','clay']) {
    for (const theme of ['light','dark']) {
      const v = await page.evaluate(([s,t]) => {
        document.documentElement.setAttribute('data-skin', s);
        document.documentElement.setAttribute('data-theme', t);
        const btn = document.getElementById('itDictateStory');
        btn.classList.add('on');
        const lum = c => { const m = c.match(/[\d.]+/g).map(Number);
          const f = x => { x/=255; return x<=0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055,2.4); };
          return 0.2126*f(m[0])+0.7152*f(m[1])+0.0722*f(m[2]); };
        const cs = getComputedStyle(btn);
        const a = lum(cs.color), c = lum(cs.backgroundColor);
        btn.classList.remove('on');
        return (Math.max(a,c)+0.05)/(Math.min(a,c)+0.05);
      }, [skin, theme]);
      if (v < 4.5) litOk.push(`${skin}/${theme}=${v.toFixed(2)}`);
    }
  }
  result('and the lit "listening" button is readable too',
    litOk.length === 0, litOk.join(' · '));

  result('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await b.close(); server.close();
})().catch(e => { console.error('CRASH', e.message); process.exit(1); });
